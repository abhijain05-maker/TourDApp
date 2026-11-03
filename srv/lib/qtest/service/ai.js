// The AI actions only PROPOSE: they return items for the person to review, nothing is stored (saveBatch stores what was accepted).
// Without a model, requirements and test cases can still be drafted by rules (ai.js), and improving needs a model.
import cds from '@sap/cds'
import { getProvider } from '../../llm/provider.js'
import { scrub } from '../../llm/secrets.js'
import { inventoryWithLive } from '../../service/live-inventory.js'
import { aiCases, aiImprove, aiRequirements, rulesCases, rulesRequirements } from '../ai.js'
import { SETS } from '../meta.js'
import { controlsOf } from '../steps.js'
import { clip, parseSteps } from '../validate.js'
import { isObject, parseJson, Q, T, json } from './common.js'

const { SELECT } = cds.ql
const LOG = cds.log('qtest')

export function registerAi(srv, { project, guarded }) {
  const { Requirements, TestCases } = Q()

  /** The provider that can answer, or null for "no model" (rules). A named but unusable provider is an error. */
  const providerFor = (req, id) => {
    if (!id || id === 'rules') return null
    const provider = getProvider(id)
    if (!provider?.complete) return req.reject(400, `Provider "${id}" cannot write test material`)
    if (!provider.isConfigured()) return req.reject(400, `Provider "${id}" is not configured on the server`)
    return provider
  }

  const instructionOf = (req) => {
    const text = String(req.data.instruction ?? '').trim()
    return text.length > 600 ? req.reject(400, 'The instruction is too long (600 characters at most)') : text
  }

  const failed = (req, what, e) => {
    LOG.error(`${what} failed:`, scrub(e?.stack ?? e))
    return req.reject(502, `The AI could not ${what}: ${scrub(e.message)}`)
  }

  srv.on('testProvider', async (req) => {
    const id = String(req.data.provider ?? '')
    const provider = getProvider(id)
    if (!provider?.complete) return req.reject(400, `"${id}" is not an AI provider`)
    if (!provider.isConfigured()) return json({ ok: false, message: 'Not configured on the server: the credentials are missing' })
    const model = req.data.model || provider.defaultModel()
    const started = Date.now()
    try {
      await provider.complete({
        system: 'Answer with JSON only.',
        messages: [{ role: 'user', content: 'Return {"ok": true}' }],
        schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
        schemaName: 'ping',
        model,
        signal: AbortSignal.timeout(45_000),
      })
      return json({ ok: true, model, ms: Date.now() - started })
    } catch (e) {
      return json({ ok: false, model, message: scrub(e?.message ?? String(e)) })
    }
  })

  srv.on(
    'aiRequirements',
    guarded(async (req) => {
      const p = await project(req, req.data.projectID, ['ID', 'name'])
      const text = String(req.data.text ?? '').trim()
      if (text.length < 8) return req.reject(400, 'Paste the text the requirements should come from')
      if (text.length > 60000) return req.reject(400, 'The text is too long (60,000 characters at most): split it')
      const provider = providerFor(req, req.data.provider)
      if (!provider) return json({ generator: 'rules', items: rulesRequirements(text), note: 'Drafted by rules from the structure of the text. Choose an AI provider for a smarter reading.' })
      const existing = (await SELECT.from(Requirements).columns('title').where({ project_ID: p.ID }).orderBy('seq')).map((r) => r.title)
      try {
        const out = await aiRequirements({ complete: (r) => provider.complete(r), text, instruction: instructionOf(req), app: p.name, existing, model: req.data.model || provider.defaultModel() })
        return json({ generator: provider.id, model: req.data.model || provider.defaultModel(), items: out.items, usage: out.usage })
      } catch (e) {
        return failed(req, 'read the requirements', e)
      }
    }),
  )

  srv.on(
    'aiCases',
    guarded(async (req) => {
      const p = await project(req, req.data.projectID, ['ID', 'name', 'inventory'])
      const ids = [...new Set(req.data.requirementIDs ?? [])]
      if (!ids.length) return req.reject(400, 'Choose at least one requirement')
      if (ids.length > 20) return req.reject(400, 'Choose 20 requirements at most per run')
      const requirements = await SELECT.from(Requirements).where({ project_ID: p.ID, ID: { in: ids } }).orderBy('seq')
      if (!requirements.length) return req.reject(404, 'Requirements not found')
      const kinds = (req.data.kinds ?? []).filter((k) => SETS.caseKind.includes(k))
      const count = Math.min(8, Math.max(1, Number(req.data.count) || 3))
      const provider = providerFor(req, req.data.provider)
      const keyed = (items) => items.map((c, i) => ({ key: `p${i + 1}`, ...c }))
      const idOf = new Map(requirements.map((r) => [r.code, r.ID]))
      const withIds = (items) => items.map((c) => ({ ...c, requirementIDs: (c.requirementCodes ?? []).map((code) => idOf.get(code)).filter(Boolean) }))
      if (!provider)
        return json({ generator: 'rules', items: keyed(withIds(requirements.flatMap((r) => rulesCases(r, kinds.length ? kinds : ['functional'])))), note: 'Skeletons from the acceptance criteria: finish the steps by hand, or choose an AI provider.' })
      let screens = []
      if (p.inventory) screens = [...new Set(controlsOf(await inventoryWithLive(JSON.parse(p.inventory), p.ID), 150).map((c) => c.display).filter(Boolean))]
      const existingTitles = (await SELECT.from(TestCases).columns('title').where({ project_ID: p.ID }).orderBy('seq')).map((c) => c.title)
      try {
        const out = await aiCases({ complete: (r) => provider.complete(r), requirements, kinds: kinds.length ? kinds : ['functional'], count, instruction: instructionOf(req), app: p.name, screens, existingTitles, model: req.data.model || provider.defaultModel() })
        return json({ generator: provider.id, model: req.data.model || provider.defaultModel(), items: keyed(withIds(out.items)), usage: out.usage })
      } catch (e) {
        return failed(req, 'write the test cases', e)
      }
    }),
  )

  srv.on(
    'aiImprove',
    guarded(async (req) => {
      const p = await project(req, req.data.projectID, ['ID', 'name'])
      const entity = req.data.entity === 'testcase' ? 'testcase' : req.data.entity === 'requirement' ? 'requirement' : null
      if (!entity) return req.reject(400, 'entity must be "requirement" or "testcase"')
      const draft = parseJson(req, req.data.draft, 'draft')
      if (!isObject(draft)) return req.reject(400, 'The draft must be a JSON object')
      const provider = providerFor(req, req.data.provider)
      if (!provider) return req.reject(400, 'Choose an AI provider (Gemini or SAP Generative AI Hub): improving needs a model')
      const slim = entity === 'testcase'
        ? { title: draft.title, objective: draft.objective, preconditions: draft.preconditions, priority: draft.priority, kind: draft.kind, steps: (Array.isArray(draft.steps) ? draft.steps : parseSteps(draft.steps)).map(({ action, data, expected }) => ({ action, data, expected })) }
        : { title: draft.title, description: draft.description, acceptance: draft.acceptance, priority: draft.priority, kind: draft.kind }
      try {
        const out = await aiImprove({ complete: (r) => provider.complete(r), entity, draft: slim, instruction: instructionOf(req), app: p.name, model: req.data.model || provider.defaultModel() })
        return json({ generator: provider.id, item: out.item })
      } catch (e) {
        return failed(req, 'improve it', e)
      }
    }),
  )
}
