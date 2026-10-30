// Help sets: the topics of an app's context help (shared/help-schema.mjs). The browser extension adds and removes
// single topics while the author points at controls of the running app; the designer saves the whole set.
import cds from '@sap/cds'
import { readFile } from 'node:fs/promises'
import {
  createEmptyHelp,
  removeTopic,
  upsertTopic,
  validateHelp,
} from '../../../shared/help-schema.mjs'
import { planHelpApply } from '../export/help-apply.js'
import { getProvider, defaultProviderId } from '../llm/provider.js'
import { rulesHelp, writeHelp } from '../llm/help.js'
import { scrub } from '../llm/secrets.js'
import { normalizeSourcePath } from './sources.js'

const LOG = cds.log('tourd')
const { SELECT, INSERT, UPDATE } = cds.ql

const message = (issues) => issues.map((i) => `${i.path} ${i.message}`.trim()).join('; ')

export function registerHelp(srv, { project, rebuildInventory, guarded, workspace }) {
  const { HelpSets, Sources } = cds.entities('tourd')
  const json = (v) => JSON.stringify(v)

  const row = async (req, ID) =>
    (await SELECT.one.from(HelpSets).where({ ID })) ?? req.reject(404, 'Help not found')

  const parse = (req, text, what) => {
    try {
      return JSON.parse(text)
    } catch {
      return req.reject(400, `The ${what} is not valid JSON`)
    }
  }

  const planFor = async (req, helpID) => {
    const r = await row(req, helpID)
    const p = await project(req, r.project_ID)
    let inventory = null
    try {
      inventory = p.inventory ? JSON.parse(p.inventory) : null
    } catch {
      /* the plan then says the controls could not be checked */
    }
    const files = await SELECT.from(Sources)
      .columns('path', 'content')
      .where({ project_ID: r.project_ID, deleted: false, binary: false })
    const read = (name) => readFile(new URL(`../../../player/${name}`, import.meta.url), 'utf8')
    return {
      projectID: r.project_ID,
      plan: planHelpApply({
        help: parse(req, r.definition, 'stored help'),
        inventory,
        files,
        playerSource: await read('TourPlayer.js'),
        helpSource: await read('HelpLayer.js'),
      }),
    }
  }

  const checked = (req, doc) => {
    const r = validateHelp(doc)
    if (!r.ok) return req.reject(400, `The help is not valid: ${message(r.issues)}`)
    return r.help
  }

  const write = async (req, r, help, generator) => {
    await UPDATE(HelpSets)
      .set({ definition: json(help), version: r.version + 1, generator })
      .where({ ID: r.ID })
    return SELECT.one.from(HelpSets).where({ ID: r.ID })
  }

  const create = async (projectID, name) => {
    const ID = cds.utils.uuid()
    const title = (name || 'Help').slice(0, 200)
    await INSERT.into(HelpSets).entries({
      ID,
      project_ID: projectID,
      name: title,
      definition: json(createEmptyHelp({ id: ID, title })),
      version: 1,
      generator: 'extension',
    })
    return SELECT.one.from(HelpSets).where({ ID })
  }

  srv.before('CREATE', srv.entities.HelpSets, (req) => req.reject(405, 'Use createHelpSet'))

  srv.on(
    'createHelpSet',
    guarded(async (req) => {
      await project(req, req.data.projectID, ['ID'])
      return create(req.data.projectID, req.data.name)
    }),
  )

  srv.on(
    'saveHelpSet',
    guarded(async (req) => {
      const { helpID, definition, baseVersion } = req.data
      const r = await row(req, helpID)
      if (baseVersion != null && baseVersion !== r.version)
        return req.reject(
          409,
          'The help was changed elsewhere (another tab). Reload it to continue.',
        )
      const help = checked(req, parse(req, definition, 'help'))
      return write(req, r, help, 'designer')
    }),
  )

  // One topic from the extension: added to the help set of the project (the one named, else the newest, else a new one).
  srv.on(
    'saveHelpTopic',
    guarded(async (req) => {
      const { projectID, helpID } = req.data
      await project(req, projectID, ['ID'])
      const topic = parse(req, req.data.topic, 'topic')
      if (!topic || typeof topic !== 'object' || Array.isArray(topic))
        return req.reject(400, 'The topic must be a JSON object')
      if (!topic.id) topic.id = `t-${cds.utils.uuid().slice(0, 8)}`
      let r
      if (helpID) {
        r = await row(req, helpID)
        if (r.project_ID !== projectID) return req.reject(404, 'Help not found')
      } else {
        r =
          (await SELECT.one
            .from(HelpSets)
            .where({ project_ID: projectID })
            .orderBy('modifiedAt desc')) ?? (await create(projectID, 'Help'))
      }
      const current = checked(req, parse(req, r.definition, 'stored help'))
      const help = checked(req, upsertTopic(current, topic))
      return write(req, r, help, 'extension')
    }),
  )

  srv.on('previewHelpApply', async (req) => {
    const { plan } = await planFor(req, req.data.helpID)
    return {
      ok: plan.ok,
      blocking: plan.blocking,
      notes: plan.notes,
      edits: plan.edits
        .filter((e) => e.action !== 'unchanged')
        // the edits of existing code first: those are the ones to read
        .sort((x, y) => (x.action === y.action ? 0 : x.action === 'modify' ? -1 : 1))
        .map(({ path, action, what, before, after }) => ({ path, action, what, before, after })),
    }
  })

  srv.on(
    'applyHelpToProject',
    guarded(async (req) => {
      const { projectID, plan } = await planFor(req, req.data.helpID)
      if (!plan.ok) return req.reject(409, plan.blocking[0]?.message ?? 'The help cannot be added')
      const wanted = Array.isArray(req.data.paths)
        ? new Set(req.data.paths.map(normalizeSourcePath))
        : null
      const todo = plan.edits.filter(
        (e) => e.action !== 'unchanged' && (!wanted || wanted.has(e.path)),
      )
      for (const e of todo) await workspace.writeFile(req, projectID, e.path, e.after)
      if (todo.length) await rebuildInventory(projectID)
      if (req.data.accept && todo.length)
        await workspace.accept(projectID, { paths: todo.map((e) => e.path) })
      return { applied: todo.length, paths: todo.map((e) => e.path) }
    }),
  )

  // Writes the words of a topic with the AI (or a rule-based draft when no AI is chosen and there is nothing to improve).
  srv.on(
    'improveHelpTopic',
    guarded(async (req) => {
      const p = await project(req, req.data.projectID, ['ID', 'name'])
      const topic = req.data.topic ? parse(req, req.data.topic, 'topic') : {}
      const control = req.data.control ? parse(req, req.data.control, 'control') : undefined
      const instruction = String(req.data.instruction ?? '').trim()
      if (instruction.length > 500)
        return req.reject(400, 'The instruction is too long (500 characters at most)')
      const providerId = req.data.provider || defaultProviderId()
      const provider = getProvider(providerId)
      const hasText = !!(topic?.text || topic?.summary)

      if (!provider?.complete) {
        if (hasText || instruction)
          return req.reject(
            400,
            'Choose an AI provider (Gemini or SAP Generative AI Hub): the rule-based draft can only write a first version',
          )
        return json({ ...rulesHelp({ topic, control }), generator: 'rules' })
      }
      if (!provider.isConfigured())
        return req.reject(400, `Provider "${providerId}" is not configured on the server`)
      try {
        const out = await writeHelp({
          complete: (r) => provider.complete(r),
          topic,
          control,
          instruction,
          app: p.name,
          screen: String(req.data.screen ?? '').slice(0, 200),
          model: req.data.model || provider.defaultModel(),
        })
        return json({ ...out.topic, generator: providerId })
      } catch (e) {
        LOG.error('improveHelpTopic failed:', scrub(e?.stack ?? e))
        return req.reject(502, `The AI could not write the help: ${scrub(e.message)}`)
      }
    }),
  )

  srv.on(
    'deleteHelpTopic',
    guarded(async (req) => {
      const r = await row(req, req.data.helpID)
      const current = checked(req, parse(req, r.definition, 'stored help'))
      if (!current.topics.some((t) => t.id === req.data.topicID))
        return req.reject(404, 'Topic not found')
      return write(req, r, checked(req, removeTopic(current, req.data.topicID)), r.generator)
    }),
  )
}
