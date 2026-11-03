// Downloads of QuickTest (plain GET routes, so a link in the page is enough):
//   /qtest/template.xlsx
//   /qtest/project/<id>/testbook.xlsx | testbook.json | cases.csv       the test book, to keep or to upload into another project
//   /qtest/project/<id>/wdi5.zip[?cases=<id>,<id>]                      the wdi5 tests of the automated cases (all, or the ones named)
//   /qtest/run/<id>/report.xlsx | report.html | junit.xml               the result of a run
import cds from '@sap/cds'
import { zipSync, strToU8 } from 'fflate'
import { exportFlatRows, exportJson, exportXlsx, templateXlsx } from './lib/qtest/bundle.js'
import { toCsv } from './lib/qtest/csv.js'
import { writeXlsx } from './lib/qtest/xlsx.js'
import { RESULTS } from './lib/qtest/meta.js'
import { runReportHtml } from './lib/qtest/report.js'
import { parseSteps } from './lib/qtest/validate.js'
import { linkCodes, loadBook } from './lib/qtest/service/common.js'
import { planTestApply } from './lib/wdi5/apply.js'
import { slugOf } from './lib/export/bundle.js'
import { protect, through } from './lib/protect.js'

const { SELECT } = cds.ql
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PROJECT = new RegExp(`^/project/(${UUID})/(testbook\\.xlsx|testbook\\.json|cases\\.csv|wdi5\\.zip)$`, 'i')
const RUN = new RegExp(`^/run/(${UUID})/(report\\.xlsx|report\\.html|junit\\.xml)$`, 'i')
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

const TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
  html: 'text/html; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
}

const send = (res, filename, body) =>
  res
    .status(200)
    .set({ ...NO_STORE, 'Content-Type': TYPES[filename.split('.').pop()] ?? 'application/octet-stream', 'Content-Disposition': `attachment; filename="${filename}"` })
    .send(typeof body === 'string' ? body : Buffer.from(body))

const fail = (res, status, error) => res.status(status).set(NO_STORE).json({ error })

const xml = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function projectFiles(res, id, what, query) {
  const { Projects, Sources, TestPlans } = cds.entities('tourd')
  const project = await SELECT.one.from(Projects).columns('name').where({ ID: id })
  if (!project) return fail(res, 404, 'Unknown project')
  const slug = slugOf(project.name)

  if (what === 'wdi5.zip') {
    const { TestCases } = cds.entities('qtest')
    const wanted = String(query.cases ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const where = { project_ID: id, plan_ID: { '!=': null } }
    if (wanted.length) where.ID = { in: wanted }
    const cases = await SELECT.from(TestCases).columns('code', 'title', 'plan_ID').where(where).orderBy('seq')
    if (!cases.length) return fail(res, 409, 'There is no automated test case yet')
    const sources = await SELECT.from(Sources).columns('path', 'content', 'edited').where({ project_ID: id, deleted: false, binary: false })
    // each plan is added to the files the plans before it produced, so the config and the helpers are written once
    const files = sources.map((f) => ({ ...f }))
    const out = new Map()
    const skipped = []
    for (const c of cases) {
      const plan = await SELECT.one.from(TestPlans).columns('definition').where({ ID: c.plan_ID })
      const result = await planTestApply({ plan: JSON.parse(plan.definition), files })
      if (!result.ok) {
        skipped.push(`${c.code} ${c.title}: ${result.blocking[0]?.message ?? 'cannot be written'}`)
        continue
      }
      for (const e of result.edits) {
        if (e.action === 'unchanged') continue
        out.set(e.path, e.after)
        const at = files.findIndex((f) => f.path === e.path)
        if (at >= 0) files[at].content = e.after
        else files.push({ path: e.path, content: e.after })
      }
    }
    if (!out.size) return fail(res, 409, `Nothing could be written. ${skipped.join(' ')}`)
    const readme = [
      `# wdi5 tests from QuickTest (${project.name})`,
      '',
      'These files are the new and the changed files of the project. Copy them into your project keeping the paths,',
      'run `npm install` in the folder that holds the new package.json (or merge its scripts and devDependencies),',
      'then `npm run wdi5`. Every test is named after its test case ("TC-012 ..."), so the results can be uploaded to QuickTest.',
      ...(skipped.length ? ['', '## Not written', ...skipped.map((s) => `- ${s}`)] : []),
    ].join('\n')
    const zip = zipSync({ 'QUICKTEST-README.md': strToU8(readme), ...Object.fromEntries([...out].map(([p, c]) => [p, strToU8(c)])) })
    return send(res, `${slug}-wdi5-tests.zip`, zip)
  }

  const book = await loadBook(id, { steps: true })
  const links = linkCodes(book)
  if (what === 'testbook.xlsx') return send(res, `${slug}-testbook.xlsx`, exportXlsx({ ...book, links }))
  if (what === 'testbook.json') return send(res, `${slug}-testbook.json`, exportJson({ projectName: project.name, ...book, links }))
  return send(res, `${slug}-test-cases.csv`, toCsv(exportFlatRows({ cases: book.cases, links })))
}

async function runReport(res, id, what) {
  const { Runs, RunItems } = cds.entities('qtest')
  const { Projects } = cds.entities('tourd')
  const run = await SELECT.one.from(Runs).where({ ID: id })
  if (!run) return fail(res, 404, 'Unknown run')
  const project = await SELECT.one.from(Projects).columns('name').where({ ID: run.project_ID })
  const items = await SELECT.from(RunItems).where({ run_ID: id }).orderBy('caseCode')
  const label = Object.fromEntries(RESULTS.map((r) => [r.id, r.label]))
  const slug = `${slugOf(project?.name ?? 'project')}-${slugOf(run.name)}`
  const counts = Object.fromEntries(RESULTS.map((r) => [r.id, items.filter((i) => i.status === r.id).length]))

  if (what === 'junit.xml') {
    const body = items
      .map((i) => {
        const time = Number(i.duration ?? 0)
        const failure = i.status === 'failed' ? `<failure message="${xml((i.actual ?? 'Failed').split('\n')[0].slice(0, 200))}">${xml(i.actual ?? '')}</failure>` : i.status === 'blocked' ? `<failure message="Blocked">${xml(i.actual ?? '')}</failure>` : i.status === 'skipped' || i.status === 'notrun' ? '<skipped/>' : ''
        return `  <testcase classname="${xml(i.caseCode)}" name="${xml(`${i.caseCode} ${i.caseTitle}`)}" time="${time}">${failure}</testcase>`
      })
      .join('\n')
    const failures = counts.failed + counts.blocked
    return send(res, `${slug}-junit.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n<testsuite name="${xml(run.name)}" tests="${items.length}" failures="${failures}" skipped="${counts.skipped + counts.notrun}">\n${body}\n</testsuite>\n</testsuites>\n`)
  }

  if (what === 'report.html') {
    const detail = items.map((i) => ({ ...i, steps: parseSteps(i.steps), snapshot: i.snapshot ? JSON.parse(i.snapshot) : null }))
    return send(res, `${slug}-report.html`, runReportHtml({ run, projectName: project?.name ?? '', items: detail, counts, label }))
  }

  const summary = [['Run', run.name], ['Project', project?.name ?? ''], ['Build', run.build ?? ''], ['Environment', run.environment ?? ''], ['Status', run.status], ...RESULTS.map((r) => [r.label, counts[r.id]]), ['Total', items.length]]
  const results = [['Test case', 'Title', 'Result', 'Executed by', 'Executed at', 'Duration (s)', 'Defect', 'Actual result']].concat(
    items.map((i) => [i.caseCode, i.caseTitle, label[i.status], i.executedBy ?? '', i.executedAt ?? '', i.duration ?? '', i.defect ?? '', i.actual ?? '']),
  )
  const steps = [['Test case', 'Step', 'Action', 'Test data', 'Expected result', 'Result', 'Actual result']]
  for (const i of items) {
    const snap = i.snapshot ? JSON.parse(i.snapshot) : { steps: [] }
    const done = new Map(parseSteps(i.steps).map((s) => [s.id, s]))
    snap.steps.forEach((s, n) => steps.push([i.caseCode, n + 1, s.action, s.data, s.expected, label[done.get(s.id)?.status ?? 'notrun'], done.get(s.id)?.actual ?? '']))
  }
  return send(res, `${slug}-report.xlsx`, writeXlsx([{ name: 'Summary', rows: [['Item', 'Value'], ...summary], widths: [18, 50] }, { name: 'Results', rows: results, widths: [11, 44, 11, 16, 22, 12, 20, 60] }, { name: 'Steps', rows: steps, widths: [11, 6, 44, 24, 44, 11, 44] }]))
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed')
  try {
    if (req.path === '/template.xlsx') return send(res, 'quicktest-template.xlsx', templateXlsx())
    const p = PROJECT.exec(req.path)
    if (p) return await projectFiles(res, p[1], p[2].toLowerCase(), req.query)
    const r = RUN.exec(req.path)
    if (r) return await runReport(res, r[1], r[2].toLowerCase())
    return fail(res, 404, 'Not found')
  } catch (e) {
    cds.log('qtest').error('download failed', e)
    return fail(res, 500, 'The file could not be built')
  }
}

export function registerQTestRoutes(app) {
  const viewer = protect('Viewer')
  app.use('/qtest', (req, res, next) => through(viewer, req, res, next), (req, res) => handle(req, res))
}
