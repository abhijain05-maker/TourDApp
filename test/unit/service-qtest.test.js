import cds from '@sap/cds'
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll } from 'vitest'
import { demoSources } from '../helpers/sources.js'
import { exportXlsx } from '../../srv/lib/qtest/bundle.js'

const { GET, POST, DELETE } = cds.test(import.meta.dirname + '/../..')
const Q = '/odata/v4/qtest'
const T = '/odata/v4/tour'
const fails = (p) =>
  p.then(
    (r) => ({ status: r.status, message: 'unexpected success' }),
    (e) => ({ status: e.response?.status, message: e.response?.data?.error?.message ?? e.message }),
  )
const fn = async (name) => JSON.parse((await GET(`${Q}/${name}`)).data.value)
const act = async (name, body) => JSON.parse((await POST(`${Q}/${name}`, body)).data.value)
const bytes = (r) => Buffer.from(r.data)

describe('QuickTest service', () => {
  let projectID
  let req1, tc1

  beforeAll(async () => {
    projectID = (await POST(`${T}/Projects`, { name: `QT ${Math.random()}` })).data.ID
  })

  it('describes its vocabulary', async () => {
    const meta = await fn('qtestMeta()')
    expect(meta.priorities.map((p) => p.id)).toEqual(['critical', 'high', 'medium', 'low'])
    expect(meta.results.map((r) => r.id)).toContain('passed')
  })

  it('saves requirements with running codes', async () => {
    req1 = await act('saveRequirement', { projectID, data: JSON.stringify({ title: 'Create an order', priority: 'high', acceptance: 'A\nB' }) })
    const req2 = await act('saveRequirement', { projectID, data: JSON.stringify({ title: 'Delete an order' }) })
    expect([req1.code, req2.code]).toEqual(['REQ-001', 'REQ-002'])
    expect(await fails(POST(`${Q}/saveRequirement`, { projectID, data: JSON.stringify({ title: 'x', priority: 'huge' }) }))).toMatchObject({ status: 400 })
    expect(await fails(POST(`${Q}/saveRequirement`, { projectID, data: JSON.stringify({ title: '' }) }))).toMatchObject({ status: 400 })
    const updated = await act('saveRequirement', { projectID, ID: req1.ID, data: JSON.stringify({ status: 'approved' }) })
    expect(updated).toMatchObject({ status: 'approved', title: 'Create an order' })
  })

  it('saves a test case with steps, a link and a version history', async () => {
    tc1 = await act('saveCase', {
      projectID,
      data: JSON.stringify({ title: 'Create with valid data', steps: [{ action: 'Open the app' }, { action: 'Click the "Create" button', expected: 'Form opens' }], requirementIDs: [req1.ID] }),
    })
    expect(tc1.code).toBe('TC-001')
    expect(tc1.steps).toHaveLength(2)
    expect(tc1.requirements.map((r) => r.code)).toEqual(['REQ-001'])
    const saved = await act('saveCase', { projectID, ID: tc1.ID, data: JSON.stringify({ title: 'Create with valid data!', steps: [{ action: 'Open the app' }] }), note: 'shorter' })
    expect(saved.version).toBe(2)
    expect(saved.requirements).toHaveLength(1) // links stay when not sent
    const same = await act('saveCase', { projectID, ID: tc1.ID, data: JSON.stringify({ owner: 'kim' }) })
    expect(same.version).toBe(2)
    const versions = await fn(`caseVersions(caseID=${tc1.ID})`)
    expect(versions.map((v) => v.version)).toEqual([2, 1])
    const restored = await act('restoreCaseVersion', { caseID: tc1.ID, version: 1 })
    expect(restored.steps).toHaveLength(2)
    expect(restored.version).toBe(3)
  })

  it('derives coverage in the lists, the matrix and the dashboard', async () => {
    const reqs = await fn(`listRequirements(projectID=${projectID})`)
    expect(reqs.find((r) => r.code === 'REQ-001')).toMatchObject({ caseCount: 1, verification: 'untested' })
    expect(reqs.find((r) => r.code === 'REQ-002')).toMatchObject({ caseCount: 0, verification: 'uncovered' })
    const cases = await fn(`listCases(projectID=${projectID})`)
    expect(cases[0]).toMatchObject({ code: 'TC-001', stepCount: 2, requirementCodes: ['REQ-001'] })
    const m = await fn(`matrix(projectID=${projectID})`)
    expect(m.links).toEqual([[req1.ID, tc1.ID]])
    const d = await fn(`dashboard(projectID=${projectID})`)
    expect(d.requirements).toMatchObject({ total: 2, covered: 1, coveragePct: 50 })
    expect(d.gaps.uncovered.map((g) => g.code)).toEqual(['REQ-002'])
  })

  it('links in both directions and toggles', async () => {
    const cases = await fn(`listCases(projectID=${projectID})`)
    const r2 = (await fn(`listRequirements(projectID=${projectID})`)).find((r) => r.code === 'REQ-002')
    await POST(`${Q}/setCoverage`, { requirementID: r2.ID, caseID: cases[0].ID, linked: true })
    expect((await fn(`getRequirement(ID=${r2.ID})`)).cases).toHaveLength(1)
    await POST(`${Q}/linkCases`, { requirementID: r2.ID, caseIDs: [] })
    expect((await fn(`getRequirement(ID=${r2.ID})`)).cases).toHaveLength(0)
  })

  it('applies a bulk change and a reviewed batch', async () => {
    const cases = await fn(`listCases(projectID=${projectID})`)
    await POST(`${Q}/bulk`, { projectID, entity: 'cases', ids: [cases[0].ID], patch: JSON.stringify({ status: 'ready', addTags: 'smoke' }) })
    expect(await fn(`getCase(ID=${cases[0].ID})`)).toMatchObject({ status: 'ready', tagList: ['smoke'] })
    const made = await act('saveBatch', {
      projectID,
      payload: JSON.stringify({ requirements: [{ key: 'a', title: 'From AI' }], cases: [{ title: 'AI case', steps: [{ action: 'x' }], requirementKeys: ['a'] }] }),
    })
    expect(made.cases[0].code).toBe('TC-002')
    const detail = await fn(`getCase(ID=${made.cases[0].ID})`)
    expect(detail.origin).toBe('ai')
    expect(detail.requirements[0].code).toBe(made.requirements[0].code)
  })

  it('writes without AI: rules propose requirements and test cases, nothing is stored', async () => {
    const r = await act('aiRequirements', { projectID, text: 'As a buyer, I want to filter orders by status, so that I find open ones.\n\nThe app must show an error when the customer is missing.' })
    expect(r.generator).toBe('rules')
    expect(r.items.length).toBe(2)
    const before = await fn(`listRequirements(projectID=${projectID})`)
    const c = await act('aiCases', { projectID, requirementIDs: [before[0].ID], kinds: ['functional', 'negative'], count: 2 })
    expect(c.items.length).toBeGreaterThanOrEqual(2)
    expect(c.items[0].requirementIDs).toEqual([before[0].ID])
    expect((await fn(`listRequirements(projectID=${projectID})`)).length).toBe(before.length)
    expect(await fails(POST(`${Q}/aiImprove`, { projectID, entity: 'requirement', draft: '{"title":"x"}' }))).toMatchObject({ status: 400 })
  })

  it('imports a workbook: preview first, then apply, ids kept', async () => {
    const book = Buffer.from(
      exportXlsx({
        requirements: [{ code: 'REQ-050', title: 'Imported requirement', priority: 'low' }],
        cases: [{ code: 'TC-050', title: 'Imported case', steps: JSON.stringify([{ action: 'Do it', expected: 'Done' }]) }],
        links: [{ requirementCode: 'REQ-050', caseCode: 'TC-050' }],
      }),
    ).toString('base64')
    const args = { projectID, filename: 'book.xlsx', content: book, encoding: 'base64' }
    const preview = await act('importBook', { ...args, mode: 'preview' })
    expect(preview.applied).toBe(false)
    expect(preview.counts.requirements.create).toBe(1)
    expect((await fn(`listRequirements(projectID=${projectID})`)).some((r) => r.code === 'REQ-050')).toBe(false)
    const done = await act('importBook', { ...args, mode: 'apply' })
    expect(done.applied).toBe(true)
    expect((await fn(`listRequirements(projectID=${projectID})`)).find((r) => r.code === 'REQ-050').caseCount).toBe(1)
    const again = await act('importBook', { ...args, mode: 'preview' })
    expect(again.counts.cases).toMatchObject({ create: 0, unchanged: 1 })
    expect(await fails(POST(`${Q}/importBook`, { ...args, content: 'not a workbook', mode: 'preview' }))).toMatchObject({ status: 400 })
  })

  it('runs: execute, record, import automated results, close', async () => {
    const cases = await fn(`listCases(projectID=${projectID})`)
    const run = await act('createRun', { projectID, name: 'Sprint 1', build: '1.0', caseIDs: cases.slice(0, 2).map((c) => c.ID) })
    expect(run).toMatchObject({ total: 2, progress: 0 })
    const item = run.items[0]
    const full = await fn(`getRunItem(itemID=${item.ID})`)
    const result = await act('recordResult', {
      itemID: item.ID,
      steps: JSON.stringify(full.snapshot.steps.map((s, i) => ({ id: s.id, status: i === 0 ? 'passed' : 'failed', actual: i ? 'boom' : '' }))),
    })
    expect(result.status).toBe('failed') // derived from the steps
    expect((await fn(`getCase(ID=${item.testCase_ID})`)).lastResult).toBe('failed')
    await act('recordResult', { itemID: item.ID, status: 'passed' })
    expect((await fn(`getCase(ID=${item.testCase_ID})`)).lastResult).toBe('passed')
    expect(await fails(POST(`${Q}/recordResult`, { itemID: item.ID, status: 'great' }))).toMatchObject({ status: 400 })

    const junit = `<testsuites><testsuite><testcase classname="${cases[1].code} x" name="a" time="2"><failure message="no">no</failure></testcase><testcase name="unknown" time="1"/></testsuite></testsuites>`
    const imported = await act('importResults', { projectID, runID: run.ID, content: junit })
    expect(imported).toMatchObject({ matched: 1, counts: { failed: 1 } })
    expect(imported.unmatched).toHaveLength(1)
    expect(await fails(POST(`${Q}/importResults`, { projectID, content: '<testsuites><testsuite><testcase name="nothing"/></testsuite></testsuites>' }))).toMatchObject({ status: 409 })

    const closed = await act('closeRun', { runID: run.ID })
    expect(closed.status).toBe('closed')
    expect(await fails(POST(`${Q}/recordResult`, { itemID: item.ID, status: 'passed' }))).toMatchObject({ status: 409 })
    const runs = await fn(`listRuns(projectID=${projectID})`)
    expect(runs[0].counts.passed).toBe(1)
    expect((await fn(`dashboard(projectID=${projectID})`)).runs.total).toBe(1)
  })

  it('downloads: workbook, json, csv, report, junit', async () => {
    const get = (p) => GET(p, { responseType: 'arraybuffer' })
    const xlsx = await get(`/qtest/project/${projectID}/testbook.xlsx`)
    expect(xlsx.headers['content-disposition']).toMatch(/testbook\.xlsx/)
    expect(bytes(xlsx).subarray(0, 2).toString()).toBe('PK')
    expect(JSON.parse(bytes(await get(`/qtest/project/${projectID}/testbook.json`)).toString()).cases.length).toBeGreaterThan(2)
    expect(bytes(await get(`/qtest/project/${projectID}/cases.csv`)).toString()).toContain('TC-001')
    const run = (await fn(`listRuns(projectID=${projectID})`))[0]
    expect(bytes(await get(`/qtest/run/${run.ID}/report.html`)).toString()).toContain('passed of')
    expect(bytes(await get(`/qtest/run/${run.ID}/junit.xml`)).toString()).toContain('<testsuite')
    expect(bytes(await get(`/qtest/run/${run.ID}/report.xlsx`)).subarray(0, 2).toString()).toBe('PK')
    expect(await fails(GET(`/qtest/project/${projectID}/wdi5.zip`))).toMatchObject({ status: 409 })
    expect(bytes(await get('/qtest/template.xlsx')).subarray(0, 2).toString()).toBe('PK')
  })

  it('automates a case from its steps (rules) once the app is uploaded', async () => {
    const pid = (await POST(`${T}/Projects`, { name: `QT app ${Math.random()}` })).data.ID
    const noApp = await act('saveCase', { projectID: pid, data: JSON.stringify({ title: 'Create', steps: [{ action: 'Open the application' }] }) })
    expect(await fails(POST(`${Q}/automateCase`, { caseID: noApp.ID }))).toMatchObject({ status: 409 })
    await POST(`${T}/importSources`, { projectID: pid, files: demoSources(), replace: true })
    const c = await act('saveCase', {
      projectID: pid,
      data: JSON.stringify({
        title: 'Create an order',
        steps: [{ action: 'Open the application' }, { action: 'Click the "Create" button', expected: 'The order form opens' }, { action: 'Press "Save"', expected: 'A message "Order saved" is shown' }],
      }),
    })
    const out = await act('automateCase', { caseID: c.ID, provider: 'rules' })
    expect(out.report.automated).toBe(3)
    expect(out.case).toMatchObject({ automation: 'automated' })
    expect(out.case.plan.name).toBe(`${c.code} Create an order`)
    expect(out.case.steps.every((s) => s.auto.length)).toBe(true)
    const auto = await fn(`getAutomation(caseID=${c.ID})`)
    expect(auto.dryRun).toBeTruthy()
    const code = await fn(`automationCode(caseID=${c.ID})`)
    expect(code.ok).toBe(true)
    expect(code.files[0].content).toContain(`${c.code} Create an order`)
    const zip = await GET(`/qtest/project/${pid}/wdi5.zip`, { responseType: 'arraybuffer' })
    expect(bytes(zip).subarray(0, 2).toString()).toBe('PK')
    // renaming the case renames the test
    await act('saveCase', { projectID: pid, ID: c.ID, data: JSON.stringify({ title: 'Create an order fast' }) })
    expect((await fn(`getCase(ID=${c.ID})`)).plan.name).toBe(`${c.code} Create an order fast`)
    const detached = await act('detachAutomation', { caseID: c.ID })
    expect(detached).toMatchObject({ automation: 'manual', plan: null })
    await DELETE(`${T}/Projects(${pid})`)
  })

  it('record once: a test case with manual steps and a wdi5 test, each step mapped', async () => {
    const pid = (await POST(`${T}/Projects`, { name: `QT rec ${Math.random()}` })).data.ID
    await POST(`${T}/importSources`, { projectID: pid, files: demoSources(), replace: true })
    const rec = (await POST(`${T}/importRecording`, { projectID: pid, raw: readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8') })).data
    const requirement = await act('saveRequirement', { projectID: pid, data: JSON.stringify({ title: 'Create an order' }) })

    const made = await act('caseFromRecording', { projectID: pid, recordingID: rec.ID, name: 'Create an order (recorded)', requirementIDs: [requirement.ID] })
    expect(made).toMatchObject({ origin: 'recording', automation: 'automated', code: 'TC-001' })
    expect(made.requirements.map((r) => r.code)).toEqual(['REQ-001'])
    expect(made.steps.length).toBeGreaterThan(2)
    expect(made.steps.every((s) => s.auto.length >= 1)).toBe(true)
    expect(made.plan.name).toBe('TC-001 Create an order (recorded)')
    const auto = await fn(`getAutomation(caseID=${made.ID})`)
    expect(auto.coverage.mapped).toBe(made.steps.length)
    expect(auto.plan.steps.some((s) => s.kind === 'press')).toBe(true)

    // a case written by hand gets the recording attached: its steps are matched by text, in order
    const hand = await act('saveCase', {
      projectID: pid,
      data: JSON.stringify({ title: 'By hand', steps: [{ action: 'Open the application' }, { action: 'Click the Create button' }, { action: 'Water the plants' }] }),
    })
    const attached = await act('attachRecording', { caseID: hand.ID, recordingID: rec.ID })
    expect(attached.steps).toBe(3)
    expect(attached.mapped).toBe(2)
    expect(attached.case.steps[2].auto).toEqual([]) // stays manual
    expect(attached.case.automation).toBe('automated')
    expect(await fails(POST(`${Q}/caseFromRecording`, { projectID: pid, recordingID: '00000000-0000-4000-8000-000000000000' }))).toMatchObject({ status: 404 })
    await DELETE(`${T}/Projects(${pid})`)
  })

  it('removes everything with the project', async () => {
    await DELETE(`${T}/Projects(${projectID})`)
    expect((await GET(`${Q}/Requirements?$filter=project_ID eq ${projectID}`)).data.value).toHaveLength(0)
    expect((await GET(`${Q}/TestCases?$filter=project_ID eq ${projectID}`)).data.value).toHaveLength(0)
    expect((await GET(`${Q}/Runs?$filter=project_ID eq ${projectID}`)).data.value).toHaveLength(0)
  })
})
