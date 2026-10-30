import cds from '@sap/cds'
import { buildInventory } from './lib/context/inventory.js'
import { parseRecording } from './lib/recordings/index.js'
import { mapRecording, withLiveControls } from './lib/recordings/map.js'
import { inventoryWithLive } from './lib/service/live-inventory.js'
import { routerHashOf } from './lib/recordings/devtools-recorder.js'
import { lintTour as lint } from './lib/validate/lint.js'
import { validateTour } from '../shared/tour-schema.mjs'
import { PURPOSES } from '../shared/recording-schema.mjs'
import { prepareFiles, InputError, LIMITS, sha256 } from './lib/service/sources.js'
import { backfillWorkspace, registerWorkspace } from './lib/service/workspace.js'
import { registerTourApply } from './lib/service/tour-apply.js'
import { registerTestPlans } from './lib/service/test-plans.js'
import { registerHelp } from './lib/service/help.js'
import { registerPreviewRecording } from './lib/service/preview-recording.js'
import { registerAuthz } from './lib/service/authz.js'
import { mint, SCOPES } from './lib/capability.js'
import { getProvider, listProviders, defaultProviderId } from './lib/llm/provider.js'
import { refineStep } from './lib/llm/refine.js'
import { scrub } from './lib/llm/secrets.js'
import { newToken } from './lib/service/tokens.js'

const LOG = cds.log('tourd')
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql
const uuid = () => cds.utils.uuid()
const json = (v) => JSON.stringify(v)

export default class TourService extends cds.ApplicationService {
  init() {
    const { Projects, Sources, Recordings, Tours, TourVersions, GenerationJobs, ExtensionTokens } =
      cds.entities('tourd')
    const srv = this.entities

    // who may do what (only where the deployment enforces roles)
    registerAuthz(this)

    // ---- helpers -------------------------------------------------------------------------------

    // Never hold a database transaction while waiting for a model (seconds to minutes): on SQLite one open
    // transaction blocks every other request, including the designer polling a job. Long-running work
    // therefore reads and writes in separate short transactions of its own.
    const inTx = (fn) => cds.tx({ user: cds.User.privileged }, fn)

    const guarded = (fn) => async (req) => {
      try {
        return await fn(req)
      } catch (e) {
        if (e instanceof InputError) return req.reject(400, e.message)
        throw e
      }
    }

    const project = async (req, id, columns = ['ID', 'name', 'inventory', 'ui5Version']) => {
      const p = await SELECT.one
        .from(Projects)
        .columns(...columns)
        .where({ ID: id })
      return p ?? req.reject(404, `Project ${id} not found`)
    }

    const inventoryOf = async (req, id) => {
      const p = await project(req, id)
      if (!p.inventory)
        return req.reject(409, 'Import the app sources first: the project has no inventory yet')
      return inventoryWithLive(JSON.parse(p.inventory), id)
    }

    /** Rebuilds the derived inventory from all stored sources of a project. */
    const rebuildInventory = async (projectID) => {
      const sources = await SELECT.from(Sources)
        .columns('path', 'content')
        .where({ project_ID: projectID, deleted: false, binary: false })
      const inv = buildInventory(sources)
      await UPDATE(Projects)
        .set({
          inventory: sources.length ? json(inv) : null,
          appId: inv.appId,
          parseStatus: !sources.length ? 'empty' : inv.warnings.length ? 'warnings' : 'ok',
        })
        .where({ ID: projectID })
      return inv
    }

    const importResult = (inv, imported = 0, ignored = [], skipped = []) => ({
      imported,
      ignored,
      skipped,
      complete: skipped.every((s) => s.expected),
      appId: inv.appId,
      views: inv.views.length,
      controls: inv.controls.length,
      warnings: inv.warnings.map(({ code, message }) => ({ code, message })),
    })

    const skippedOf = (p) => {
      try {
        return p.skipped ? JSON.parse(p.skipped) : []
      } catch {
        return []
      }
    }

    const mappedRecording = async (rec, inventory) =>
      mapRecording(parseRecording(rec.raw, { format: rec.format }), inventory)

    /** The inventory with the controls the recorder saw in the running app (a Fiori elements app has none in its files). */
    const liveInventory = (inventory, mapped) => withLiveControls(inventory, mapped)

    const tourRow = (ID) => SELECT.one.from(srv.Tours).where({ ID })

    const AUTOSAVE_NOTE = 'Autosave'
    const AUTOSAVE_WINDOW_MS = 10 * 60 * 1000

    /**
     * Appends a new version of a tour (no-op when nothing changed). An autosave that follows a recent
     * autosave overwrites that version instead of adding one, so editing does not flood the history.
     */
    const saveVersion = async (
      tour,
      definitionJson,
      note,
      { autosave = false, label = false } = {},
    ) => {
      if (tour.definition === definitionJson) {
        // "Save a named version" of what is already stored: label the latest version instead of ignoring the request,
        // unless that version already carries a name of its own - then keep both as separate snapshots.
        if (!label) return tour.version
        const last = await SELECT.one
          .from(TourVersions)
          .where({ tour_ID: tour.ID, version: tour.version })
        if (last && (!last.note || last.note === AUTOSAVE_NOTE)) {
          await UPDATE(TourVersions).set({ note }).where({ ID: last.ID })
          return tour.version
        }
      }
      if (autosave) {
        const last = await SELECT.one
          .from(TourVersions)
          .where({ tour_ID: tour.ID, version: tour.version })
        if (
          last?.note === AUTOSAVE_NOTE &&
          Date.now() - new Date(last.createdAt).getTime() < AUTOSAVE_WINDOW_MS
        ) {
          await UPDATE(TourVersions).set({ definition: definitionJson }).where({ ID: last.ID })
          await UPDATE(Tours).set({ definition: definitionJson }).where({ ID: tour.ID })
          return tour.version
        }
        note = AUTOSAVE_NOTE
      }
      const version = (tour.version ?? 1) + 1
      await UPDATE(Tours).set({ definition: definitionJson, version }).where({ ID: tour.ID })
      await INSERT.into(TourVersions).entries({
        ID: uuid(),
        tour_ID: tour.ID,
        version,
        definition: definitionJson,
        note: note ?? null,
      })
      return version
    }

    const parseDefinition = (req, definition) => {
      let doc
      try {
        doc = typeof definition === 'string' ? JSON.parse(definition) : definition
      } catch (e) {
        return req.reject(400, `The tour definition is not valid JSON: ${e.message}`)
      }
      const result = validateTour(doc)
      if (!result.ok) {
        const first = result.issues
          .slice(0, 5)
          .map((i) => `${i.path || '(root)'}: ${i.message}`)
          .join('; ')
        return req.reject(400, `The tour is invalid (${result.issues.length} problem(s)): ${first}`)
      }
      return result.tour
    }

    // ---- direct writes: only what is safe -------------------------------------------------------

    this.before(['CREATE', 'UPDATE'], [srv.Sources, srv.Recordings], (req) =>
      req.reject(405, 'Use importSources / importRecording to add or replace files'),
    )
    this.before('CREATE', srv.Tours, (req) => req.reject(405, 'Use createTour or generateTour'))
    this.before('UPDATE', srv.Tours, (req) => {
      const allowed = new Set(['ID', 'name'])
      const forbidden = Object.keys(req.data).filter((k) => !allowed.has(k) && !k.startsWith('@'))
      if (forbidden.length)
        req.reject(
          400,
          `Only the name of a tour can be changed directly (not: ${forbidden.join(', ')}); use saveTour`,
        )
    })
    // (deleting a file is part of the workspace: see registerWorkspace)

    // ---- sources --------------------------------------------------------------------------------

    this.on(
      'importSources',
      guarded(async (req) => {
        const { projectID, files, replace } = req.data
        const proj = await project(req, projectID, ['ID', 'skipped'])
        const { accepted, ignored, skipped } = prepareFiles(files)
        if (!accepted.some((f) => f.kind !== 'other')) {
          const already =
            !replace &&
            (await SELECT.one
              .from(Sources)
              .columns('ID')
              .where({ project_ID: projectID, deleted: false, kind: { '!=': 'other' } }))
          if (!already)
            return req.reject(
              400,
              'None of the files is a view, fragment, controller, manifest or i18n file',
            )
        }

        if (replace) await DELETE.from(Sources).where({ project_ID: projectID })
        const existing = new Map(
          (await SELECT.from(Sources).columns('ID', 'path').where({ project_ID: projectID })).map(
            (r) => [r.path, r.ID],
          ),
        )
        const fresh = []
        for (const f of accepted) {
          const hash = sha256(f.content)
          // an upload is the new starting point of its files: nothing is "changed" yet
          const data = {
            kind: f.kind,
            content: f.content,
            base: null,
            binary: f.binary,
            size: f.size,
            hash,
            baseHash: hash,
            origin: 'upload',
            edited: false,
            deleted: false,
          }
          if (existing.has(f.path))
            await UPDATE(Sources)
              .set(data)
              .where({ ID: existing.get(f.path) })
          else fresh.push({ ID: uuid(), project_ID: projectID, path: f.path, ...data })
        }
        if (fresh.length) await INSERT.into(Sources).entries(fresh)

        const kept = replace
          ? []
          : skippedOf(proj).filter((s) => !accepted.some((a) => a.path === s.path))
        const allSkipped = [...kept, ...skipped]
        await UPDATE(Projects)
          .set({ skipped: allSkipped.length ? json(allSkipped) : null })
          .where({ ID: projectID })
        return importResult(await rebuildInventory(projectID), accepted.length, ignored, allSkipped)
      }),
    )

    this.on('parseProject', async (req) => {
      const proj = await project(req, req.data.projectID, ['ID', 'skipped'])
      return importResult(await rebuildInventory(req.data.projectID), 0, [], skippedOf(proj))
    })

    this.on('getInventory', async (req) => {
      const p = await project(req, req.data.projectID)
      if (!p.inventory) return req.reject(409, 'The project has no inventory yet')
      return json(await inventoryWithLive(JSON.parse(p.inventory), req.data.projectID))
    })

    this.on('getSourceContent', async (req) => {
      const row = await SELECT.one.from(Sources).columns('content').where({ ID: req.data.sourceID })
      return row ? row.content : req.reject(404, 'Source not found')
    })

    // ---- recordings -----------------------------------------------------------------------------

    this.on(
      'importRecording',
      guarded(async (req) => {
        const { projectID, name, raw, format, purpose: asked } = req.data
        if (asked && !PURPOSES.includes(asked))
          return req.reject(400, `purpose must be one of: ${PURPOSES.join(', ')}`)
        const inventory = await inventoryOf(req, projectID)
        if (typeof raw !== 'string' || !raw.trim()) return req.reject(400, 'The recording is empty')
        if (Buffer.byteLength(raw, 'utf8') > LIMITS.recordingBytes)
          return req.reject(
            400,
            `The recording is too large; the limit is ${LIMITS.recordingBytes} bytes`,
          )

        let normalized
        try {
          normalized = parseRecording(raw, { format: format || undefined })
        } catch (e) {
          return req.reject(400, e.message)
        }
        const mapped = mapRecording(normalized, inventory)
        const summary = { steps: mapped.steps.length, skipped: mapped.skipped, ...mapped.mapping }
        const ID = uuid()
        // what was asked, else what the recorder wrote into the file, else both (a file does not say)
        const purpose = asked || normalized.purpose || 'both'
        await INSERT.into(Recordings).entries({
          ID,
          project_ID: projectID,
          purpose,
          name: (
            name ||
            normalized.title ||
            `Recording ${new Date().toISOString().slice(0, 16)}`
          ).slice(0, 200),
          format: normalized.format,
          raw,
          summary: json(summary),
        })
        return {
          ID,
          format: normalized.format,
          steps: summary.steps,
          actionable: summary.actionable,
          mapped: summary.mapped,
          unmapped: summary.unmapped,
          skipped: summary.skipped,
          purpose,
        }
      }),
    )

    // the label "for tours / for tests / for both" can be changed later; the recording itself never is
    this.on('setRecordingPurpose', async (req) => {
      const { recordingID, purpose } = req.data
      if (!PURPOSES.includes(purpose))
        return req.reject(400, `purpose must be one of: ${PURPOSES.join(', ')}`)
      const n = await UPDATE(Recordings).set({ purpose }).where({ ID: recordingID })
      if (!n) return req.reject(404, 'Recording not found')
      return SELECT.one.from(srv.Recordings).where({ ID: recordingID })
    })

    this.on('getRecording', async (req) => {
      const rec = await SELECT.one.from(Recordings).where({ ID: req.data.recordingID })
      if (!rec) return req.reject(404, 'Recording not found')
      return json(await mappedRecording(rec, await inventoryOf(req, rec.project_ID)))
    })

    // ---- tours ----------------------------------------------------------------------------------

    this.on('createTour', async (req) => {
      const { projectID, name, definition } = req.data
      await project(req, projectID, ['ID'])
      const tour = parseDefinition(req, definition)
      const ID = uuid()
      const def = json(tour)
      await INSERT.into(Tours).entries({
        ID,
        project_ID: projectID,
        name: (name || tour.title).slice(0, 200),
        definition: def,
        version: 1,
        generator: 'manual',
      })
      await INSERT.into(TourVersions).entries({
        ID: uuid(),
        tour_ID: ID,
        version: 1,
        definition: def,
        note: 'Created',
      })
      return tourRow(ID)
    })

    this.on('saveTour', async (req) => {
      const { tourID, definition, note, autosave, baseVersion } = req.data
      const current = await SELECT.one.from(Tours).where({ ID: tourID })
      if (!current) return req.reject(404, `Tour ${tourID} not found`)
      if (baseVersion != null && baseVersion !== current.version) {
        return req.reject(
          409,
          `The tour was changed elsewhere (it is now version ${current.version}). Reload it to continue.`,
        )
      }
      await saveVersion(current, json(parseDefinition(req, definition)), note, {
        autosave: !!autosave,
        label: !autosave && !!note,
      })
      return tourRow(tourID)
    })

    this.on('restoreVersion', async (req) => {
      const { tourID, version } = req.data
      const current = await SELECT.one.from(Tours).where({ ID: tourID })
      if (!current) return req.reject(404, `Tour ${tourID} not found`)
      const old = await SELECT.one.from(TourVersions).where({ tour_ID: tourID, version })
      if (!old) return req.reject(404, `Version ${version} of the tour does not exist`)
      await saveVersion(current, old.definition, `Restored version ${version}`)
      return tourRow(tourID)
    })

    this.on('refineStep', async (req) => {
      const { tourID, stepID, provider: wanted } = req.data
      const instruction = String(req.data.instruction ?? '').trim()
      if (!instruction) return req.reject(400, 'Tell the AI what to change')
      if (instruction.length > 500)
        return req.reject(400, 'The instruction is too long (500 characters at most)')
      const providerId = wanted || defaultProviderId()
      const provider = getProvider(providerId)
      if (!provider?.complete)
        return req.reject(
          400,
          'Choose an AI provider (Gemini or SAP Generative AI Hub): the rule-based generator cannot edit a step',
        )
      if (!provider.isConfigured())
        return req.reject(400, `Provider "${providerId}" is not configured on the server`)

      const { current, inventory } = await inTx(async () => {
        const current = await SELECT.one.from(Tours).where({ ID: tourID })
        if (!current) return req.reject(404, `Tour ${tourID} not found`)
        return { current, inventory: await inventoryOf(req, current.project_ID) }
      })
      const tour = JSON.parse(current.definition)
      if (!tour.steps.some((st) => st.id === stepID))
        return req.reject(404, `The tour has no step "${stepID}"`)

      let out
      try {
        out = await refineStep({
          complete: (r) => provider.complete(r),
          tour,
          stepId: stepID,
          instruction,
          inventory,
          model: req.data.model || provider.defaultModel(),
        })
      } catch (e) {
        LOG.error('refineStep failed:', scrub(e?.stack ?? e))
        return req.reject(502, `The AI could not edit the step: ${scrub(e.message)}`)
      }
      if (out.ignored) req.warn(`The new target was ignored: ${out.ignored}`)
      await inTx(() => saveVersion(current, json(out.tour), `AI: ${instruction.slice(0, 120)}`))
      return tourRow(tourID)
    })

    this.on('getTourVersion', async (req) => {
      const row = await SELECT.one
        .from(TourVersions)
        .columns('definition')
        .where({ tour_ID: req.data.tourID, version: req.data.version })
      return row ? row.definition : req.reject(404, 'Version not found')
    })

    this.on('lintTour', async (req) => {
      const tour = await SELECT.one.from(Tours).where({ ID: req.data.tourID })
      if (!tour) return req.reject(404, 'Tour not found')
      let inventory = await inventoryOf(req, tour.project_ID)
      let recording
      if (tour.recording_ID) {
        const rec = await SELECT.one.from(Recordings).where({ ID: tour.recording_ID })
        if (rec) {
          recording = await mappedRecording(rec, inventory)
          inventory = liveInventory(inventory, recording)
        }
      }
      const startHash = recording?.startUrl ? routerHashOf(recording.startUrl) : ''
      const { issues, summary } = lint(JSON.parse(tour.definition), inventory, {
        recording,
        startHash,
      })
      return {
        errors: summary.errors,
        warnings: summary.warnings,
        infos: summary.infos,
        issues: issues.map(({ path, code, severity, message, stepId }) => ({
          path,
          code,
          severity,
          message,
          stepId,
        })),
      }
    })

    // ---- generation -----------------------------------------------------------------------------

    this.on('generateTour', async (req) => {
      const { projectID, recordingID, title } = req.data
      await inventoryOf(req, projectID)
      const rec = await SELECT.one
        .from(Recordings)
        .columns('ID', 'project_ID')
        .where({ ID: recordingID })
      if (!rec || rec.project_ID !== projectID)
        return req.reject(404, 'Recording not found in this project')
      const providerId = req.data.provider || defaultProviderId()
      const provider = getProvider(providerId)
      if (!provider) return req.reject(400, `Unknown provider "${providerId}"`)
      if (!provider.isConfigured())
        return req.reject(400, `Provider "${providerId}" is not configured on the server`)

      const ID = uuid()
      const model = req.data.model || provider.defaultModel()
      await INSERT.into(GenerationJobs).entries({
        ID,
        project_ID: projectID,
        recording_ID: recordingID,
        provider: providerId,
        model,
        status: 'queued',
      })
      // start only once this request has committed the job row, so the job can see it
      req.on('succeeded', () => setImmediate(() => runJob(ID, { provider, model, title })))
      return SELECT.one.from(srv.GenerationJobs).where({ ID })
    })

    const runJob = async (jobID, { provider, model, title }) => {
      const setStage = (stage) =>
        inTx(() => UPDATE(GenerationJobs).set({ status: 'running', stage }).where({ ID: jobID }))
      let current = 'context'
      try {
        let { job, inventory, rec, sources } = await inTx(async () => {
          await UPDATE(GenerationJobs)
            .set({ status: 'running', stage: 'context' })
            .where({ ID: jobID })
          const job = await SELECT.one.from(GenerationJobs).where({ ID: jobID })
          const proj = await SELECT.one
            .from(Projects)
            .columns('inventory')
            .where({ ID: job.project_ID })
          return {
            job,
            inventory: JSON.parse(proj.inventory),
            rec: await SELECT.one.from(Recordings).where({ ID: job.recording_ID }),
            sources: await SELECT.from(Sources)
              .columns('path', 'content')
              .where({ project_ID: job.project_ID, deleted: false, binary: false }),
          }
        })
        const recording = await mappedRecording(rec, inventory)
        inventory = liveInventory(inventory, recording)

        current = 'generate'
        await setStage(current)
        const { tour, report } = await provider.generate({
          inventory,
          recording,
          sources,
          title: title || undefined,
          model,
          onStage: setStage,
        })

        current = 'validate'
        await setStage(current)
        const checked = validateTour(tour)
        if (!checked.ok) {
          throw new Error(
            `The generated tour is invalid: ${checked.issues
              .slice(0, 3)
              .map((i) => `${i.path}: ${i.message}`)
              .join('; ')}`,
          )
        }
        const startHash = recording.startUrl ? routerHashOf(recording.startUrl) : ''
        const { summary } = lint(checked.tour, inventory, { recording, startHash })

        current = 'save'
        await inTx(async () => {
          const tourID = uuid()
          const def = json(checked.tour)
          await INSERT.into(Tours).entries({
            ID: tourID,
            project_ID: job.project_ID,
            recording_ID: job.recording_ID,
            name: checked.tour.title.slice(0, 200),
            definition: def,
            version: 1,
            generator: provider.id,
            model,
          })
          await INSERT.into(TourVersions).entries({
            ID: uuid(),
            tour_ID: tourID,
            version: 1,
            definition: def,
            note: `Generated by ${provider.id}`,
          })
          await UPDATE(GenerationJobs)
            .set({
              status: 'done',
              stage: 'done',
              tour_ID: tourID,
              report: json({ ...report, lint: summary }),
            })
            .where({ ID: jobID })
        })
      } catch (e) {
        LOG.error(`generation ${jobID} failed during ${current}:`, scrub(e?.stack ?? e))
        await inTx(() =>
          UPDATE(GenerationJobs)
            .set({ status: 'failed', stage: current, error: scrub(e.message) })
            .where({ ID: jobID }),
        ).catch((err) => LOG.error('could not record the failure', err))
      }
    }

    const workspace = registerWorkspace(this, { project, rebuildInventory, guarded })
    registerTourApply(this, { project, rebuildInventory, guarded, workspace })
    registerTestPlans(this, { project, rebuildInventory, guarded, workspace })
    registerHelp(this, { project, rebuildInventory, guarded, workspace })
    registerPreviewRecording(this, { project, guarded })
    // files uploaded before the workspace existed get their hashes once
    cds.once('served', () =>
      backfillWorkspace().catch((e) => LOG.error('workspace backfill failed', e)),
    )

    this.on('providers', () => listProviders())

    // a short-lived link token for what runs without a login (the console snippet): see lib/capability.js
    this.on('capability', (req) => {
      const { scope, id } = req.data
      if (!SCOPES.includes(scope) || !/^[0-9a-f-]{36}$/i.test(String(id)))
        return req.reject(400, 'Unknown scope')
      return mint(`${scope}:${id}`)
    })

    // ---- pairing the browser extension -----------------------------------------------------------
    this.on('createExtensionToken', async (req) => {
      const name = String(req.data.name ?? '').trim()
      if (!name)
        return req.reject(400, 'Give the extension a name, for example the name of your laptop.')
      if (name.length > 120)
        return req.reject(400, 'The name is too long (120 characters at most).')
      const { token, prefix, tokenHash } = newToken()
      const ID = uuid()
      await INSERT.into(ExtensionTokens).entries({ ID, name, prefix, tokenHash })
      return { ID, name, token } // the only time the token is shown
    })
    this.on('revokeExtensionToken', async (req) => {
      const n = await UPDATE(ExtensionTokens).set({ revoked: true }).where({ ID: req.data.ID })
      if (!n) return req.reject(404, 'Unknown token')
      return true
    })

    // A job runs inside the server process: after a restart nobody is working on it any more. Jobs that have shown no
    // progress for a while are marked failed, so the designer does not wait for them forever.
    cds.once('served', async () => {
      try {
        const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
        await UPDATE(GenerationJobs)
          .set({
            status: 'failed',
            error: 'The server was restarted while this was running. Start it again.',
          })
          .where({ status: 'running', modifiedAt: { '<': stale } })
      } catch (e) {
        LOG.warn('could not clean up generation jobs:', e.message)
      }
    })

    return super.init()
  }
}
