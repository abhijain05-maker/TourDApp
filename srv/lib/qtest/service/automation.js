// Automation of a test case: a wdi5 plan (tourd.TestPlans) behind the manual steps.
//   caseFromRecording   record once -> a manual test case and its wdi5 test, step by step mapped
//   attachRecording     a case written by hand + a recording -> the plan, the steps mapped by text
//   automateCase        a case written by hand, no recording -> the plan from the step texts (rules or a model)
// The plan is the one the QuickDev designer edits (#/tests/<id>), so a tester can refine it there.
import cds from '@sap/cds'
import { DEFAULT_SETTINGS, validatePlan } from '../../../../shared/wdi5-plan.mjs'
import { parseRecording } from '../../recordings/index.js'
import { mapRecording } from '../../recordings/map.js'
import { buildPlan } from '../../wdi5/plan.js'
import { planTestApply } from '../../wdi5/apply.js'
import { dryRun } from '../../wdi5/dryrun.js'
import { getProvider } from '../../llm/provider.js'
import { scrub } from '../../llm/secrets.js'
import { inventoryWithLive } from '../../service/live-inventory.js'
import { aiInterpret } from '../ai.js'
import { alignSteps, controlsOf, interpretRules, planFromSteps, stepsFromPlan } from '../steps.js'
import { cleanSteps, parseSteps } from '../validate.js'
import { isObject, json, parseJson, Q, T, uuid } from './common.js'

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql
const LOG = cds.log('qtest')

const message = (issues) => issues.map((i) => `${i.path} ${i.message}`.trim()).join('; ')

export function registerAutomation(srv, { project, guarded, items }) {
  const { TestCases, Coverage } = Q()
  const { Recordings, TestPlans, Sources } = T()

  const inventoryOf = async (req, projectID) => {
    const p = await project(req, projectID)
    if (!p.inventory) return req.reject(409, 'Upload the app first (Setup tab): automation needs the views of the app to find its controls')
    return inventoryWithLive(JSON.parse(p.inventory), projectID)
  }

  const settingsOf = (req, text) => {
    const s = text ? parseJson(req, text, 'settings') : {}
    return isObject(s) ? s : req.reject(400, 'The settings must be a JSON object')
  }

  const namePlan = (c) => `${c.code} ${c.title}`.slice(0, 200)

  /** Saves the plan of a case (a new row, or the definition of the one it has) and ties it to the case. */
  const savePlan = async (req, c, plan, generator, extra = {}) => {
    const named = { ...plan, name: namePlan(c) }
    const checked = validatePlan(named)
    if (!checked.ok) return req.reject(400, `The plan is not valid: ${message(checked.issues)}`)
    if (c.plan_ID) {
      const old = await SELECT.one.from(TestPlans).columns('version').where({ ID: c.plan_ID })
      if (old) {
        await UPDATE(TestPlans).set({ definition: json(checked.plan), name: checked.plan.name, version: old.version + 1, generator }).where({ ID: c.plan_ID })
        return c.plan_ID
      }
    }
    const ID = uuid()
    await INSERT.into(TestPlans).entries({ ID, project_ID: c.project_ID, recording_ID: extra.recording_ID ?? null, name: checked.plan.name, definition: json(checked.plan), version: 1, generator })
    return ID
  }

  const planFromRecording = async (req, projectID, recordingID, name, settings) => {
    const inventory = await inventoryOf(req, projectID)
    const rec = await SELECT.one.from(Recordings).where({ ID: recordingID, project_ID: projectID })
    if (!rec) return req.reject(404, 'Recording not found')
    const mapped = mapRecording(parseRecording(rec.raw, { format: rec.format }), inventory)
    return { plan: buildPlan({ mapped, inventory, name, settings }), rec }
  }

  const detail = (ID) => items.caseDetail(ID)

  srv.on(
    'caseFromRecording',
    guarded(async (req) => {
      const { projectID, recordingID, requirementIDs } = req.data
      const settings = settingsOf(req, req.data.settings)
      const rec = await SELECT.one.from(Recordings).columns('name').where({ ID: recordingID, project_ID: projectID })
      if (!rec) return req.reject(404, 'Recording not found')
      const title = String(req.data.name || rec.name || 'Recorded flow').trim().slice(0, 300)
      const { plan } = await planFromRecording(req, projectID, recordingID, title, settings)
      const steps = cleanSteps(stepsFromPlan(plan))
      const c = await items.createCase(projectID, { title, objective: 'Recorded in the running app.', preconditions: '', priority: 'medium', kind: 'functional', status: 'draft', tags: 'recorded', stepList: steps }, { origin: 'recording', extra: { recording_ID: recordingID, automation: 'automated' }, note: 'Created from a recording' })
      const planID = await savePlan(req, { ...c, plan_ID: null }, plan, 'rules', { recording_ID: recordingID })
      await UPDATE(TestCases).set({ plan_ID: planID }).where({ ID: c.ID })
      if (requirementIDs?.length) await items.setLinks(projectID, c.ID, requirementIDs)
      return json(await detail(c.ID))
    }),
  )

  srv.on(
    'attachRecording',
    guarded(async (req) => {
      const c = await items.testCase(req, req.data.caseID)
      const settings = settingsOf(req, req.data.settings)
      const { plan } = await planFromRecording(req, c.project_ID, req.data.recordingID, namePlan(c), settings)
      let steps = parseSteps(c.steps)
      let mapped = 0
      if (!steps.length) steps = cleanSteps(stepsFromPlan(plan))
      else {
        const map = alignSteps(steps, plan)
        steps = steps.map((s) => ({ ...s, auto: map.get(s.id) ?? [] }))
        mapped = steps.filter((s) => s.auto.length).length
      }
      const planID = await savePlan(req, c, plan, 'rules', { recording_ID: req.data.recordingID })
      await UPDATE(TestCases).set({ plan_ID: planID, recording_ID: req.data.recordingID, automation: 'automated', steps: json(steps) }).where({ ID: c.ID })
      return json({ case: await detail(c.ID), mapped, steps: steps.length })
    }),
  )

  const providerFor = (req, id) => {
    if (!id || id === 'rules') return null
    const provider = getProvider(id)
    if (!provider?.complete) return req.reject(400, `Provider "${id}" cannot write automation`)
    if (!provider.isConfigured()) return req.reject(400, `Provider "${id}" is not configured on the server`)
    return provider
  }

  srv.on(
    'automateCase',
    guarded(async (req) => {
      const c = await items.testCase(req, req.data.caseID)
      const steps = parseSteps(c.steps)
      if (!steps.some((s) => s.action?.trim())) return req.reject(409, 'Write the steps of the test case first')
      const inventory = await inventoryOf(req, c.project_ID)
      const controls = controlsOf(inventory)
      if (!controls.length) return req.reject(409, 'The app has no controls the tests can find: upload its views, or record a flow in the running app first')
      const provider = providerFor(req, req.data.provider)
      const p = await project(req, c.project_ID, ['ID', 'name'])
      let interpretations
      let generator = 'rules'
      if (provider) {
        try {
          const out = await aiInterpret({ complete: (r) => provider.complete(r), steps, controls, app: p.name, model: req.data.model || provider.defaultModel() })
          interpretations = out.interpretations
          generator = provider.id
        } catch (e) {
          LOG.error('automateCase failed:', scrub(e?.stack ?? e))
          return req.reject(502, `The AI could not read the steps: ${scrub(e.message)}`)
        }
      } else interpretations = steps.map((s) => interpretRules(s, controls))
      const old = c.plan_ID ? await SELECT.one.from(TestPlans).columns('definition').where({ ID: c.plan_ID }) : null
      const keep = old ? JSON.parse(old.definition).settings : {}
      const { plan, mapping, report } = planFromSteps(steps, interpretations, { inventory, name: namePlan(c), settings: { ...keep, ...settingsOf(req, req.data.settings) } })
      const planID = await savePlan(req, c, plan, generator)
      const withAuto = steps.map((s) => ({ ...s, auto: mapping.get(s.id) ?? [] }))
      const automated = report.automated > 0
      await UPDATE(TestCases).set({ plan_ID: planID, automation: automated ? 'automated' : c.automation, steps: json(withAuto) }).where({ ID: c.ID })
      return json({ case: await detail(c.ID), report: { generator, steps: steps.length, automated: report.automated, unresolved: report.unresolved, manualOnly: report.manualOnly.slice(0, 50) } })
    }),
  )

  srv.on(
    'automationSettings',
    guarded(async (req) => {
      const c = await items.testCase(req, req.data.caseID)
      if (!c.plan_ID) return req.reject(409, 'This test case has no automation yet')
      const row = await SELECT.one.from(TestPlans).where({ ID: c.plan_ID })
      const plan = JSON.parse(row.definition)
      const allowed = Object.keys(DEFAULT_SETTINGS).concat('authSelectors')
      const patch = Object.fromEntries(Object.entries(settingsOf(req, req.data.settings)).filter(([k]) => allowed.includes(k)))
      plan.settings = { ...plan.settings, ...patch }
      const checked = validatePlan(plan)
      if (!checked.ok) return req.reject(400, `The settings are not valid: ${message(checked.issues)}`)
      await UPDATE(TestPlans).set({ definition: json(checked.plan), version: row.version + 1 }).where({ ID: row.ID })
      return json(await automation(c.ID))
    }),
  )

  srv.on('detachAutomation', async (req) => {
    const c = await items.testCase(req, req.data.caseID)
    const steps = parseSteps(c.steps).map((s) => ({ ...s, auto: [] }))
    await UPDATE(TestCases).set({ plan_ID: null, recording_ID: null, automation: 'manual', steps: json(steps) }).where({ ID: c.ID })
    if (c.plan_ID) await DELETE.from(TestPlans).where({ ID: c.plan_ID })
    return json(await detail(c.ID))
  })

  /** The plan, whether its controls are still in the app, and how much of the manual steps it covers. */
  const automation = async (caseID) => {
    const c = await SELECT.one.from(TestCases).where({ ID: caseID })
    if (!c?.plan_ID) return null
    const row = await SELECT.one.from(TestPlans).where({ ID: c.plan_ID })
    if (!row) return null
    const plan = JSON.parse(row.definition)
    const p = await SELECT.one.from(T().Projects).columns('inventory').where({ ID: c.project_ID })
    let dry = null
    if (p?.inventory) dry = dryRun(plan, await inventoryWithLive(JSON.parse(p.inventory), c.project_ID))
    const steps = parseSteps(c.steps)
    const planSteps = plan.steps
    const mappedIds = new Set(steps.flatMap((s) => s.auto ?? []))
    return {
      planID: row.ID,
      version: row.version,
      generator: row.generator,
      recording_ID: row.recording_ID,
      plan,
      dryRun: dry,
      coverage: { steps: steps.length, mapped: steps.filter((s) => s.auto?.length).length, planSteps: planSteps.length, unmappedPlanSteps: planSteps.filter((s) => !mappedIds.has(s.id)).map((s) => s.id) },
    }
  }

  srv.on('getAutomation', async (req) => json(await automation(req.data.caseID)))

  srv.on('automationCode', async (req) => {
    const c = await items.testCase(req, req.data.caseID)
    if (!c.plan_ID) return req.reject(409, 'This test case has no automation yet')
    const row = await SELECT.one.from(TestPlans).where({ ID: c.plan_ID })
    const files = await SELECT.from(Sources).columns('path', 'content', 'edited').where({ project_ID: c.project_ID, deleted: false, binary: false })
    const result = await planTestApply({ plan: JSON.parse(row.definition), files })
    const rank = (e) => (/\.(test|spec|e2e)\./.test(e.path) ? 0 : /journey/.test(e.path) ? 1 : e.action === 'modify' ? 3 : 2)
    return json({
      ok: result.ok,
      blocking: result.blocking,
      notes: result.notes,
      files: result.edits.filter((e) => e.action !== 'unchanged').sort((a, b) => rank(a) - rank(b)).map((e) => ({ path: e.path, action: e.action, what: e.what, content: e.after, before: e.before })),
    })
  })

  return { automation }
}
