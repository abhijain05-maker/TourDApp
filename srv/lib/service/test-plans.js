// wdi5 test plans: made from a recording, edited as a table in the designer, written into the project's files.
import { inventoryWithLive } from './live-inventory.js'
import cds from '@sap/cds'
import { parseRecording } from '../recordings/index.js'
import { mapRecording } from '../recordings/map.js'
import { buildPlan } from '../wdi5/plan.js'
import { planTestApply } from '../wdi5/apply.js'
import { dryRun } from '../wdi5/dryrun.js'
import { validatePlan } from '../../../shared/wdi5-plan.mjs'
import { normalizeSourcePath } from './sources.js'

const { SELECT, INSERT, UPDATE } = cds.ql

export function registerTestPlans(srv, { project, rebuildInventory, guarded, workspace }) {
  const { Recordings, Sources, TestPlans } = cds.entities('tourd')
  const json = (v) => JSON.stringify(v)

  const inventoryOf = async (req, projectID) => {
    const p = await project(req, projectID)
    if (!p.inventory) return req.reject(409, 'Upload the app first: the tests need its views')
    return JSON.parse(p.inventory)
  }

  const planFrom = async (req, projectID, recordingID, name, settings) => {
    const inventory = await inventoryOf(req, projectID)
    const rec = await SELECT.one.from(Recordings).where({ ID: recordingID, project_ID: projectID })
    if (!rec) return req.reject(404, 'Recording not found')
    const mapped = mapRecording(parseRecording(rec.raw, { format: rec.format }), inventory)
    const plan = buildPlan({ mapped, inventory, name: name || rec.name, settings })
    const checked = validatePlan(plan)
    if (!checked.ok)
      return req.reject(
        400,
        `The settings are not valid: ${checked.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
      )
    return { plan: checked.plan, rec }
  }

  const row = async (req, ID) =>
    (await SELECT.one.from(TestPlans).where({ ID })) ?? req.reject(404, 'Test plan not found')

  srv.before('CREATE', srv.entities.TestPlans, (req) => req.reject(405, 'Use createTestPlan'))
  srv.before('UPDATE', srv.entities.TestPlans, (req) => {
    const forbidden = Object.keys(req.data).filter(
      (k) => !['ID', 'name'].includes(k) && !k.startsWith('@'),
    )
    if (forbidden.length)
      req.reject(
        400,
        `Only the name of a test plan can be changed directly (not: ${forbidden.join(', ')}); use saveTestPlan`,
      )
  })

  srv.on(
    'createTestPlan',
    guarded(async (req) => {
      const { projectID, recordingID, name } = req.data
      let settings = {}
      try {
        settings = req.data.settings ? JSON.parse(req.data.settings) : {}
      } catch {
        return req.reject(400, 'The settings are not valid JSON')
      }
      const { plan, rec } = await planFrom(req, projectID, recordingID, name, settings)
      const ID = cds.utils.uuid()
      await INSERT.into(TestPlans).entries({
        ID,
        project_ID: projectID,
        recording_ID: rec.ID,
        name: plan.name.slice(0, 200),
        definition: json(plan),
        version: 1,
        generator: 'rules',
      })
      return SELECT.one.from(TestPlans).where({ ID })
    }),
  )

  srv.on(
    'saveTestPlan',
    guarded(async (req) => {
      const { planID, definition, baseVersion } = req.data
      const r = await row(req, planID)
      if (baseVersion != null && baseVersion !== r.version)
        return req.reject(
          409,
          'The test plan was changed elsewhere (another tab). Reload it to continue.',
        )
      let doc
      try {
        doc = JSON.parse(definition)
      } catch {
        return req.reject(400, 'The plan is not valid JSON')
      }
      const checked = validatePlan(doc)
      if (!checked.ok)
        return req.reject(
          400,
          `The plan is not valid: ${checked.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
        )
      await UPDATE(TestPlans)
        .set({
          definition: json(checked.plan),
          name: checked.plan.name.slice(0, 200),
          version: r.version + 1,
          generator: 'manual',
        })
        .where({ ID: planID })
      return SELECT.one.from(TestPlans).where({ ID: planID })
    }),
  )

  srv.on(
    'rebuildTestPlan',
    guarded(async (req) => {
      const r = await row(req, req.data.planID)
      if (!r.recording_ID)
        return req.reject(409, 'The recording of this plan was deleted: nothing to rebuild it from')
      const old = JSON.parse(r.definition)
      const { plan } = await planFrom(req, r.project_ID, r.recording_ID, old.name, old.settings)
      await UPDATE(TestPlans)
        .set({ definition: json(plan), version: r.version + 1, generator: 'rules' })
        .where({ ID: r.ID })
      return SELECT.one.from(TestPlans).where({ ID: r.ID })
    }),
  )

  const planFor = async (req, planID) => {
    const r = await row(req, planID)
    const files = await SELECT.from(Sources)
      .columns('path', 'content', 'edited')
      .where({ project_ID: r.project_ID, deleted: false, binary: false })
    return { r, result: await planTestApply({ plan: JSON.parse(r.definition), files }) }
  }

  // does every selector find exactly one control of the app? (from the app's files, no browser)
  srv.on('dryRunTestPlan', async (req) => {
    const r = await row(req, req.data.planID)
    const inventory = await inventoryOf(req, r.project_ID)
    // controls only the recorder saw (Fiori elements) count as found: the files cannot contain them
    return JSON.stringify(dryRun(JSON.parse(r.definition), await inventoryWithLive(inventory, r.project_ID)))
  })

  srv.on('previewTestApply', async (req) => {
    const { result } = await planFor(req, req.data.planID)
    return {
      ok: result.ok,
      blocking: result.blocking,
      notes: result.notes,
      // what was found in a project that has wdi5 already (JSON), or null
      existing: result.existing ? JSON.stringify(result.existing) : null,
      edits: result.edits
        .filter((e) => e.action !== 'unchanged')
        .sort((x, y) => (x.action === y.action ? 0 : x.action === 'modify' ? -1 : 1))
        .map((e) => ({
          path: e.path,
          action: e.action,
          what: e.what,
          before: e.before,
          after: e.after,
        })),
    }
  })

  srv.on(
    'applyTestToProject',
    guarded(async (req) => {
      const { r, result } = await planFor(req, req.data.planID)
      if (!result.ok)
        return req.reject(409, result.blocking[0]?.message ?? 'The tests cannot be added')
      const wanted = Array.isArray(req.data.paths)
        ? new Set(req.data.paths.map(normalizeSourcePath))
        : null
      const todo = result.edits.filter(
        (e) => e.action !== 'unchanged' && (!wanted || wanted.has(e.path)),
      )
      for (const e of todo) await workspace.writeFile(req, r.project_ID, e.path, e.after)
      if (todo.length) await rebuildInventory(r.project_ID)
      // "also make them part of the project": they do not show up as changes
      if (req.data.accept && todo.length)
        await workspace.accept(r.project_ID, { paths: todo.map((e) => e.path) })
      return { applied: todo.length, paths: todo.map((e) => e.path) }
    }),
  )
}
