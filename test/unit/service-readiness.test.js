import cds from '@sap/cds'
import { describe, it, expect, beforeAll } from 'vitest'
import { readinessProject } from '../helpers/readiness-project.js'
import { reconcile, summarize } from '../../srv/lib/service/readiness.js'

const { GET, POST, DELETE, axios } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const fails = (p) =>
  p.then(
    (r) => ({ status: r.status, message: 'unexpected success' }),
    (e) => ({ status: e.response?.status, message: e.response?.data?.error?.message ?? e.message }),
  )
const items = async (projectID) =>
  (await GET(`${BASE}/ReadinessItems?$filter=project_ID eq ${projectID}`)).data.value
const byKey = (rows, key) => rows.find((r) => r.itemKey === key)
const summary = async (projectID) =>
  JSON.parse((await GET(`${BASE}/readinessSummary(projectID=${projectID})`)).data.value)
const scan = async (projectID) =>
  JSON.parse((await POST(`${BASE}/scanReadiness`, { projectID })).data.value)

describe('readiness: the checklist of a project', () => {
  let projectID

  beforeAll(async () => {
    projectID = (await POST(`${BASE}/Projects`, { name: `Readiness ${Math.random()}` })).data.ID
  })

  it('has nothing to scan before files are uploaded', async () => {
    expect(await fails(POST(`${BASE}/scanReadiness`, { projectID }))).toMatchObject({ status: 409 })
    expect(await summary(projectID)).toMatchObject({ total: 0, hasFiles: false, scan: null })
  })

  it('describes categories and answers for the designer', async () => {
    const meta = JSON.parse((await GET(`${BASE}/readinessMeta()`)).data.value)
    expect(meta.categories.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        'destinations',
        'apis',
        'auth',
        'workzone',
        'bpa',
        'btp',
        'config',
        'other',
      ]),
    )
    expect(meta.statuses.map((s) => s.id)).toEqual(['open', 'working', 'broken', 'na'])
  })

  it('lists the dependencies of the uploaded files', async () => {
    await POST(`${BASE}/importSources`, { projectID, files: readinessProject(), replace: true })
    const result = await scan(projectID)
    expect(result.total).toBeGreaterThan(20)
    expect(result.added.length).toBe(result.total)
    const rows = await items(projectID)
    expect(rows).toHaveLength(result.total)
    const dest = byKey(rows, 'destinations:destination:S4_DEV')
    expect(dest).toMatchObject({
      category: 'destinations',
      status: 'open',
      origin: 'scan',
      present: true,
      severity: 'high',
    })
    const data = JSON.parse(dest.data)
    expect(data.sources.length).toBeGreaterThan(1)
    expect(data.fields[0].id).toBe('target')
  })

  it("keeps a person's answer when the project is scanned again", async () => {
    const rows = await items(projectID)
    const dest = byKey(rows, 'destinations:destination:S4_DEV')
    const saved = (
      await POST(`${BASE}/checkReadiness`, {
        itemID: dest.ID,
        status: 'working',
        note: 'Checked with Check Connection',
        owner: 'Kiran',
        inputs: JSON.stringify({ target: 'S4D / 100' }),
      })
    ).data
    expect(saved).toMatchObject({
      status: 'working',
      note: 'Checked with Check Connection',
      owner: 'Kiran',
    })
    expect(saved.checkedAt).toBeTruthy()

    const again = await scan(projectID)
    expect(again.added).toEqual([])
    expect(again.removed).toEqual([])
    const after = byKey(await items(projectID), 'destinations:destination:S4_DEV')
    expect(after).toMatchObject({
      ID: dest.ID,
      status: 'working',
      note: 'Checked with Check Connection',
      owner: 'Kiran',
    })
    expect(JSON.parse(after.inputs)).toEqual({ target: 'S4D / 100' })
  })

  it('rejects an answer it does not know and values that are not an object', async () => {
    const dest = byKey(await items(projectID), 'destinations:destination:S4_DEV')
    expect(
      await fails(POST(`${BASE}/checkReadiness`, { itemID: dest.ID, status: 'maybe' })),
    ).toMatchObject({ status: 400 })
    expect(
      await fails(POST(`${BASE}/checkReadiness`, { itemID: dest.ID, inputs: '[1]' })),
    ).toMatchObject({ status: 400 })
    expect(
      await fails(POST(`${BASE}/checkReadiness`, { itemID: dest.ID, inputs: '{oops' })),
    ).toMatchObject({ status: 400 })
  })

  it('counts progress and attention per category', async () => {
    const s = await summary(projectID)
    expect(s.working).toBe(1)
    expect(s.attention).toBeGreaterThan(0) // errors found by the scan that nobody has answered
    expect(s.progress).toBeGreaterThan(0)
    expect(s.categories.find((c) => c.id === 'destinations')).toMatchObject({ working: 1 })
    expect(s.scan.files).toBeGreaterThan(5)
    expect(s.outdated).toBe(false)
    expect(s.hasFiles).toBe(true)
  })

  it('says the list is outdated once a file changed, and hides what a rescan no longer finds', async () => {
    const files = (
      await GET(`${BASE}/Sources?$filter=project_ID eq ${projectID} and path eq 'xs-security.json'`)
    ).data.value
    const file = (await GET(`${BASE}/getFile(fileID=${files[0].ID})`)).data
    const without = JSON.parse(file.content)
    without.scopes = without.scopes.filter((s) => !s.name.endsWith('.Unused'))
    await POST(`${BASE}/saveFile`, {
      fileID: file.ID,
      content: JSON.stringify(without),
      expectedHash: file.hash,
    })
    expect((await summary(projectID)).outdated).toBe(true)

    const again = await scan(projectID)
    expect(again.removed).toEqual(['auth:scope:Unused'])
    const gone = byKey(await items(projectID), 'auth:scope:Unused')
    expect(gone.present).toBe(false)
    expect((await summary(projectID)).outdated).toBe(false)
    expect((await summary(projectID)).absent).toBe(1)

    // an absent check can be removed; one the scan still finds cannot
    expect(
      await fails(
        POST(`${BASE}/removeReadinessItem`, {
          itemID: byKey(await items(projectID), 'auth:scope:Admin').ID,
        }),
      ),
    ).toMatchObject({ status: 409 })
    await POST(`${BASE}/removeReadinessItem`, { itemID: gone.ID })
    expect(byKey(await items(projectID), 'auth:scope:Unused')).toBeUndefined()
  })

  it('takes a check that only a person can know, and a rescan leaves it alone', async () => {
    const row = (
      await POST(`${BASE}/addReadinessItem`, {
        projectID,
        category: 'other',
        title: 'Cloud Connector shows the S/4 virtual host',
        summary: 'Ask the basis team',
      })
    ).data
    expect(row).toMatchObject({ origin: 'manual', status: 'open', category: 'other' })
    await scan(projectID)
    expect((await items(projectID)).find((r) => r.ID === row.ID)).toMatchObject({ present: true })
    expect(
      await fails(POST(`${BASE}/addReadinessItem`, { projectID, category: 'nope', title: 'x' })),
    ).toMatchObject({ status: 400 })
    expect(
      await fails(POST(`${BASE}/addReadinessItem`, { projectID, category: 'other', title: '  ' })),
    ).toMatchObject({ status: 400 })
    await POST(`${BASE}/removeReadinessItem`, { itemID: row.ID })
  })

  it('records every scan and says what the last one could not read', async () => {
    const report = JSON.parse(
      (await GET(`${BASE}/readinessScanReport(projectID=${projectID})`)).data.value,
    )
    expect(report).toMatchObject({
      files: expect.any(Number),
      added: expect.any(Array),
      removed: expect.any(Array),
      warnings: [],
    })
    const scans = (await GET(`${BASE}/ReadinessScans?$filter=project_ID eq ${projectID}`)).data
      .value
    expect(scans.length).toBeGreaterThanOrEqual(3)
    expect(scans[0].report).toBeUndefined()
  })

  it('goes away with the project', async () => {
    await DELETE(`${BASE}/Projects(${projectID})`)
    expect(
      (await GET(`${BASE}/ReadinessItems?$filter=project_ID eq ${projectID}`)).data.value,
    ).toEqual([])
    expect(axios).toBeTruthy()
  })
})

describe('readiness: reconcile and summarize', () => {
  const item = (key, over = {}) => ({
    key,
    category: 'apis',
    kind: 'x',
    title: key,
    severity: 'normal',
    signals: [],
    sources: [],
    attrs: {},
    links: [],
    verify: [],
    fields: [],
    ...over,
  })

  it('inserts new things, updates known ones, hides the ones that went, and never touches manual checks', () => {
    const existing = [
      { ID: '1', itemKey: 'a', origin: 'scan', present: true },
      { ID: '2', itemKey: 'b', origin: 'scan', present: true },
      { ID: '3', itemKey: 'c', origin: 'scan', present: false },
      { ID: '4', itemKey: 'apis:manual:4', origin: 'manual', present: true },
    ]
    const plan = reconcile(existing, [item('a'), item('d')])
    expect(plan.update.map((u) => u.ID)).toEqual(['1'])
    expect(plan.insert.map((r) => r.itemKey)).toEqual(['d'])
    expect(plan.insert[0]).toMatchObject({ origin: 'scan', status: 'open' })
    expect(plan.hide).toEqual(['2']) // 3 is hidden already, 4 is manual
    expect(plan.removed).toEqual(['b'])
  })

  it('brings a hidden thing back when it is found again', () => {
    const plan = reconcile([{ ID: '3', itemKey: 'c', origin: 'scan', present: false }], [item('c')])
    expect(plan.update[0].row.present).toBe(true)
    expect(plan.insert).toEqual([])
  })

  it('counts an unanswered error as needing attention, an answered one not', () => {
    const rows = [
      { category: 'apis', status: 'open', level: 'error', present: true },
      { category: 'apis', status: 'working', level: 'error', present: true },
      { category: 'auth', status: 'broken', level: '', present: true },
      { category: 'auth', status: 'na', level: '', present: true },
      { category: 'auth', status: 'open', level: 'warning', present: false },
    ]
    const s = summarize(rows)
    expect(s).toMatchObject({
      total: 4,
      attention: 2,
      working: 1,
      broken: 1,
      na: 1,
      open: 1,
      absent: 1,
    })
    expect(s.progress).toBeCloseTo(0.5)
    expect(s.categories.find((c) => c.id === 'apis')).toMatchObject({
      total: 2,
      attention: 1,
      progress: 0.5,
    })
  })
})
