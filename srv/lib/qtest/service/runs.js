// Runs: a round of testing. Items carry a snapshot of the case, the result of every step, and who ran it when.
// Results of automated runs are read from the runner's files and matched to the cases by the code in the test name.
import cds from '@sap/cds'
import { runRows } from '../metrics.js'
import { resolve, RESULTS } from '../meta.js'
import { matchResults, parseResults } from '../results.js'
import { clip, parseSteps } from '../validate.js'
import { actor, json, parseJson, Q, uuid } from './common.js'

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql

const ITEM_COLUMNS = ['ID', 'run_ID', 'testCase_ID', 'caseCode', 'caseTitle', 'status', 'actual', 'defect', 'executedBy', 'executedAt', 'duration', 'source']

export function registerRuns(srv, { project, guarded, items }) {
  const { Runs, RunItems, TestCases } = Q()

  const run = async (req, ID) => (await SELECT.one.from(Runs).where({ ID })) ?? req.reject(404, 'Run not found')
  const open = (req, r) => (r.status === 'closed' ? req.reject(409, 'The run is closed: reopen it to change results') : r)

  const snapshotOf = (c) => json({ code: c.code, title: c.title, objective: c.objective ?? '', preconditions: c.preconditions ?? '', priority: c.priority, steps: parseSteps(c.steps) })

  const itemRow = (runID, c) => ({ ID: uuid(), run_ID: runID, testCase_ID: c.ID, caseCode: c.code, caseTitle: c.title, snapshot: snapshotOf(c), status: 'notrun', steps: '[]', source: 'manual' })

  const detail = async (runID) => {
    const r = await SELECT.one.from(Runs).where({ ID: runID })
    if (!r) return null
    const list = await SELECT.from(RunItems).columns(...ITEM_COLUMNS).where({ run_ID: runID }).orderBy('caseCode')
    const [row] = runRows([r], list)
    return { ...row, items: list }
  }

  /** The cases a run is made of: the ones named, or the ones a filter picks (deprecated cases never). */
  const pickCases = async (projectID, caseIDs, filter) => {
    const where = { project_ID: projectID, status: { '!=': 'deprecated' } }
    if (caseIDs?.length) where.ID = { in: caseIDs }
    const rows = await SELECT.from(TestCases).where(where).orderBy('seq')
    if (caseIDs?.length || !filter) return rows
    const f = filter
    const has = (v, list) => !Array.isArray(list) || !list.length || list.includes(v)
    return rows.filter((c) => has(c.status, f.status) && has(c.kind, f.kinds) && has(c.priority, f.priority) && has(c.automation, f.automation) && (!f.tags?.length || String(c.tags ?? '').split(',').some((t) => f.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase()))))
  }

  const refreshCase = async (caseID) => {
    if (!caseID) return
    const latest = await SELECT.one.from(RunItems).columns('status', 'executedAt').where({ testCase_ID: caseID, status: { '!=': 'notrun' } }).orderBy('executedAt desc')
    await UPDATE(TestCases).set({ lastResult: latest?.status ?? null, lastRunAt: latest?.executedAt ?? null }).where({ ID: caseID })
  }

  srv.on('listRuns', async (req) => {
    await project(req, req.data.projectID, ['ID'])
    const runs = await SELECT.from(Runs).where({ project_ID: req.data.projectID }).orderBy('createdAt desc')
    const list = runs.length ? await SELECT.from(RunItems).columns('run_ID', 'status').where({ run_ID: { in: runs.map((r) => r.ID) } }) : []
    return json(runRows(runs, list))
  })

  srv.on('getRun', async (req) => json((await detail(req.data.runID)) ?? req.reject(404, 'Run not found')))

  srv.on('getRunItem', async (req) => {
    const i = await SELECT.one.from(RunItems).where({ ID: req.data.itemID })
    if (!i) return req.reject(404, 'Run item not found')
    return json({ ...i, snapshot: parseJson(req, i.snapshot, 'snapshot', {}), steps: parseSteps(i.steps) })
  })

  srv.on(
    'createRun',
    guarded(async (req) => {
      const { projectID, caseIDs } = req.data
      await project(req, projectID, ['ID'])
      const name = clip(req.data.name, 200)
      if (!name) return req.reject(400, 'A run needs a name')
      const filter = req.data.filter ? parseJson(req, req.data.filter, 'filter') : null
      const cases = await pickCases(projectID, caseIDs, filter)
      if (!cases.length) return req.reject(409, 'There is no test case to run: choose some, or loosen the filter')
      const ID = uuid()
      await INSERT.into(Runs).entries({ ID, project_ID: projectID, name, build: clip(req.data.build, 100) || null, environment: clip(req.data.environment, 100) || null, note: clip(req.data.note, 1000) || null, status: 'open' })
      await INSERT.into(RunItems).entries(cases.map((c) => itemRow(ID, c)))
      return json(await detail(ID))
    }),
  )

  srv.on('updateRun', async (req) => {
    const r = await run(req, req.data.runID)
    const set = {}
    if (req.data.name !== undefined && req.data.name !== null) set.name = clip(req.data.name, 200) || r.name
    for (const [k, n] of [['build', 100], ['environment', 100], ['note', 1000]]) if (req.data[k] !== undefined && req.data[k] !== null) set[k] = clip(req.data[k], n) || null
    if (Object.keys(set).length) await UPDATE(Runs).set(set).where({ ID: r.ID })
    return json(await detail(r.ID))
  })

  srv.on('closeRun', async (req) => {
    const r = await run(req, req.data.runID)
    await UPDATE(Runs).set(req.data.reopen ? { status: 'open', closedAt: null } : { status: 'closed', closedAt: new Date().toISOString() }).where({ ID: r.ID })
    return json(await detail(r.ID))
  })

  srv.on('deleteRun', async (req) => {
    const r = await run(req, req.data.runID)
    const cases = (await SELECT.from(RunItems).columns('testCase_ID').where({ run_ID: r.ID })).map((i) => i.testCase_ID)
    await DELETE.from(RunItems).where({ run_ID: r.ID })
    await DELETE.from(Runs).where({ ID: r.ID })
    for (const id of new Set(cases)) await refreshCase(id)
    return true
  })

  srv.on('addRunCases', async (req) => {
    const r = open(req, await run(req, req.data.runID))
    const have = new Set((await SELECT.from(RunItems).columns('testCase_ID').where({ run_ID: r.ID })).map((i) => i.testCase_ID))
    const cases = (await pickCases(r.project_ID, req.data.caseIDs ?? [], null)).filter((c) => !have.has(c.ID))
    if (cases.length) await INSERT.into(RunItems).entries(cases.map((c) => itemRow(r.ID, c)))
    return cases.length
  })

  srv.on('removeRunItems', async (req) => {
    const r = open(req, await run(req, req.data.runID))
    const ids = req.data.itemIDs ?? []
    if (!ids.length) return 0
    const found = await SELECT.from(RunItems).columns('ID', 'testCase_ID').where({ run_ID: r.ID, ID: { in: ids } })
    await DELETE.from(RunItems).where({ ID: { in: found.map((i) => i.ID) } })
    for (const c of new Set(found.map((i) => i.testCase_ID))) await refreshCase(c)
    return found.length
  })

  srv.on(
    'recordResult',
    guarded(async (req) => {
      const item = (await SELECT.one.from(RunItems).where({ ID: req.data.itemID })) ?? req.reject(404, 'Run item not found')
      open(req, await run(req, item.run_ID))
      const steps = req.data.steps ? parseJson(req, req.data.steps, 'step results') : parseSteps(item.steps)
      if (!Array.isArray(steps)) return req.reject(400, 'The step results must be a list')
      const cleanSteps = steps.slice(0, 200).map((s) => ({ id: String(s.id ?? '').slice(0, 20), status: resolve(RESULTS, s.status) ?? 'notrun', actual: clip(s.actual, 2000), note: clip(s.note, 1000) }))
      // no result named: it follows the steps (a failed step fails the case, all steps passed passes it)
      let status = resolve(RESULTS, req.data.status)
      if (req.data.status && !status) return req.reject(400, `"${req.data.status}" is not a result`)
      if (!status) status = cleanSteps.some((s) => s.status === 'failed') ? 'failed' : cleanSteps.some((s) => s.status === 'blocked') ? 'blocked' : cleanSteps.length && cleanSteps.every((s) => s.status === 'passed') ? 'passed' : 'notrun'
      const set = {
        status,
        steps: json(cleanSteps),
        actual: req.data.actual !== undefined && req.data.actual !== null ? clip(req.data.actual, 20000) : item.actual,
        defect: req.data.defect !== undefined && req.data.defect !== null ? clip(req.data.defect, 300) || null : item.defect,
        duration: Number.isFinite(req.data.duration) ? Math.max(0, req.data.duration) : item.duration,
        executedBy: status === 'notrun' ? null : actor(req),
        executedAt: status === 'notrun' ? null : new Date().toISOString(),
        source: 'manual',
      }
      await UPDATE(RunItems).set(set).where({ ID: item.ID })
      await refreshCase(item.testCase_ID)
      const row = await SELECT.one.from(RunItems).columns(...ITEM_COLUMNS).where({ ID: item.ID })
      return json({ ...row, stepResults: cleanSteps })
    }),
  )

  srv.on(
    'importResults',
    guarded(async (req) => {
      const { projectID, runID } = req.data
      await project(req, projectID, ['ID'])
      const parsed = parseResults(req.data.content)
      const cases = await SELECT.from(TestCases).where({ project_ID: projectID })
      const { matched, unmatched } = matchResults(parsed.tests, new Map(cases.map((c) => [c.code, c])))
      if (!matched.length) return req.reject(409, `None of the ${parsed.tests.length} tests has the code of a test case in its name (for example "TC-012 ..."). Name the tests after the cases, or import the results by hand.`)
      let id = runID
      if (id) open(req, await run(req, id))
      else {
        id = uuid()
        await INSERT.into(Runs).entries({ ID: id, project_ID: projectID, name: clip(req.data.name, 200) || `Automated run ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, environment: 'wdi5', status: 'open' })
      }
      const byCode = new Map(cases.map((c) => [c.code, c]))
      const existing = new Map((await SELECT.from(RunItems).columns('ID', 'testCase_ID').where({ run_ID: id })).map((i) => [i.testCase_ID, i.ID]))
      const now = new Date().toISOString()
      const counts = { passed: 0, failed: 0, skipped: 0, blocked: 0 }
      for (const m of matched) {
        const c = byCode.get(m.code)
        const set = { status: m.status, actual: clip(m.messages.join('\n'), 20000) || null, duration: Math.round(m.durationMs / 1000), executedBy: 'wdi5', executedAt: now, source: 'wdi5' }
        if (existing.has(c.ID)) await UPDATE(RunItems).set(set).where({ ID: existing.get(c.ID) })
        else await INSERT.into(RunItems).entries({ ...itemRow(id, c), ...set })
        counts[m.status] = (counts[m.status] ?? 0) + 1
        await refreshCase(c.ID)
      }
      return json({ runID: id, format: parsed.format, matched: matched.length, counts, unmatched: unmatched.slice(0, 50), total: parsed.tests.length })
    }),
  )

  return { refreshCase }
}
