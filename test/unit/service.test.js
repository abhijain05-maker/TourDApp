import cds from '@sap/cds'
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { demoSources } from '../helpers/sources.js'

const { GET, POST, PATCH, DELETE } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const fx = (n) => readFileSync(`test/fixtures/recordings/demo-create-order.${n}`, 'utf8')

// cds.test's HTTP client rejects non-2xx responses; normalise to { status, message } for assertions.
const fails = (p) =>
  p.then(
    (r) => ({ status: r.status, message: 'unexpected success' }),
    (e) => ({
      status: e.response?.status ?? e.code,
      message: e.response?.data?.error?.message ?? e.message,
    }),
  )

async function waitFor(jobID) {
  for (let i = 0; i < 100; i++) {
    const { data } = await GET(`${BASE}/GenerationJobs(${jobID})`)
    if (data.status === 'done' || data.status === 'failed') return data
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('job did not finish')
}

const newProject = async (name = 'Demo') => (await POST(`${BASE}/Projects`, { name })).data.ID
const importDemo = (projectID, extra = {}) =>
  POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true, ...extra })

describe('sources', () => {
  let projectID
  beforeAll(async () => {
    projectID = await newProject()
  })

  it('a new project is empty', async () => {
    const { data } = await GET(`${BASE}/Projects(${projectID})`)
    expect(data).toMatchObject({ name: 'Demo', parseStatus: 'empty', ui5Version: '1.120' })
    expect(data).not.toHaveProperty('inventory')
    expect((await fails(GET(`${BASE}/getInventory(projectID=${projectID})`))).status).toBe(409)
  })

  it('imports the whole demo app as a workspace and builds the inventory', async () => {
    const { data } = await importDemo(projectID)
    expect(data).toMatchObject({
      imported: 15,
      appId: 'demo.orders',
      views: 3,
      warnings: [],
      ignored: [],
      skipped: [],
      complete: true,
    })
    expect(data.controls).toBeGreaterThan(15)
    // files the parsers do not read belong to the project too
    const all = (await GET(`${BASE}/Sources?$filter=project_ID eq ${projectID}`)).data.value
    expect(all.find((s) => s.path === 'webapp/Component.js')).toMatchObject({
      kind: 'other',
      status: 'unchanged',
    })
    expect(all.map((s) => s.path)).toContain('package.json')

    const project = (await GET(`${BASE}/Projects(${projectID})`)).data
    expect(project).toMatchObject({ appId: 'demo.orders', parseStatus: 'ok' })
    const inv = JSON.parse((await GET(`${BASE}/getInventory(projectID=${projectID})`)).data.value)
    expect(inv.views.map((v) => v.viewName)).toContain('demo.orders.view.Main')
  })

  it('lists sources without their content and serves content on request', async () => {
    const { data } = await GET(
      `${BASE}/Sources?$filter=project_ID eq ${projectID} and kind eq 'manifest'`,
    )
    expect(data.value).toHaveLength(1)
    expect(data.value[0]).not.toHaveProperty('content')
    const content = (await GET(`${BASE}/getSourceContent(sourceID=${data.value[0].ID})`)).data.value
    expect(JSON.parse(content)['sap.app'].id).toBe('demo.orders')
  })

  it('re-importing without replace updates files in place', async () => {
    const files = demoSources()
      .filter((s) => s.path.endsWith('Main.view.xml'))
      .map((s) => ({ ...s, content: s.content.replace('{i18n>create}', 'Neu anlegen') }))
    const { data } = await POST(`${BASE}/importSources`, { projectID, files })
    expect(data.imported).toBe(1)
    const sources = (await GET(`${BASE}/Sources?$filter=project_ID eq ${projectID}`)).data.value
    expect(sources).toHaveLength(15)
    // an upload is the new starting point of its files: nothing counts as changed
    expect(sources.find((s) => s.path.endsWith('Main.view.xml')).status).toBe('unchanged')
    const inv = JSON.parse((await GET(`${BASE}/getInventory(projectID=${projectID})`)).data.value)
    expect(inv.controls.find((c) => c.localId === 'createBtn').text).toBe('Neu anlegen')
  })

  it('deleting a source rebuilds the inventory', async () => {
    const detail = (await GET(`${BASE}/Sources?$filter=endswith(path,'Detail.view.xml')`)).data
      .value[0]
    await DELETE(`${BASE}/Sources(${detail.ID})`)
    const inv = JSON.parse((await GET(`${BASE}/getInventory(projectID=${projectID})`)).data.value)
    expect(inv.views.map((v) => v.viewName)).not.toContain('demo.orders.view.Detail')
    expect((await GET(`${BASE}/Projects(${projectID})`)).data.parseStatus).toBe('warnings')
  })

  it('parseProject rebuilds on demand', async () => {
    const { data } = await POST(`${BASE}/parseProject`, { projectID })
    expect(data.views).toBe(2)
  })
})

describe('source validation', () => {
  let projectID
  beforeAll(async () => {
    projectID = await newProject('Validation')
  })
  const post = (files) => fails(POST(`${BASE}/importSources`, { projectID, files }))

  it('rejects path traversal, empty and oversized uploads and files of unknown kinds only', async () => {
    expect(await post([{ path: '../../etc/manifest.json', content: '{}' }])).toMatchObject({
      status: 400,
      message: expect.stringContaining('..'),
    })
    expect(await post([{ path: 'webapp/a/../b.view.xml', content: '<x/>' }])).toMatchObject({
      status: 400,
    })
    expect(await post([])).toMatchObject({ status: 400 })
    expect(
      await post([{ path: 'webapp/big.view.xml', content: 'x'.repeat(1024 * 1024 + 1) }]),
    ).toMatchObject({ status: 400, message: expect.stringContaining('too large') })
    expect(await post([{ path: 'logo.png', content: 'x' }])).toMatchObject({
      status: 400,
      message: expect.stringContaining('None of the files'),
    })
  })

  it('normalises windows paths and leading slashes', async () => {
    const win = String.fromCharCode(92)
    const { data } = await POST(`${BASE}/importSources`, {
      projectID,
      files: [{ path: `.${win}webapp${win}manifest.json`, content: '{"sap.app":{"id":"x"}}' }],
    })
    expect(data.imported).toBe(1)
    const rows = (await GET(`${BASE}/Sources?$filter=project_ID eq ${projectID}`)).data.value
    expect(rows.map((r) => r.path)).toEqual(['webapp/manifest.json'])
  })

  it('returns 404 for an unknown project', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000'
    expect(
      (
        await fails(
          POST(`${BASE}/importSources`, {
            projectID: unknown,
            files: [{ path: 'a.view.xml', content: '<x/>' }],
          }),
        )
      ).status,
    ).toBe(404)
  })

  it('blocks direct writes to derived data', async () => {
    expect(
      (
        await fails(
          POST(`${BASE}/Sources`, { project_ID: projectID, path: 'x.view.xml', kind: 'view' }),
        )
      ).status,
    ).toBe(405)
    expect(
      (
        await fails(
          POST(`${BASE}/Recordings`, { project_ID: projectID, name: 'x', format: 'plain-text' }),
        )
      ).status,
    ).toBe(405)
    expect(
      (await fails(POST(`${BASE}/Tours`, { project_ID: projectID, name: 'x', definition: '{}' })))
        .status,
    ).toBe(405)
    await PATCH(`${BASE}/Projects(${projectID})`, { appId: 'hacked', name: 'Renamed' }).catch(
      () => {},
    )
    const p = (await GET(`${BASE}/Projects(${projectID})`)).data
    expect(p.appId).not.toBe('hacked')
  })
})
