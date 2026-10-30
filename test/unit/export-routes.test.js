import cds from '@sap/cds'
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { demoSources } from '../helpers/sources.js'

const { POST, axios } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const raw = (path, config = {}) => axios.get(path, { validateStatus: () => true, ...config })
const bytes = (path, config = {}) => raw(path, { responseType: 'arraybuffer', ...config })

const demoTour = () => JSON.parse(readFileSync('samples/demo-app/webapp/tourd/tour.json', 'utf8'))

describe('export routes', () => {
  let projectID
  const create = async (definition, name = 'Tour') =>
    (
      await POST(`${BASE}/createTour`, {
        projectID,
        name,
        definition: JSON.stringify(definition),
      })
    ).data.ID

  beforeAll(async () => {
    projectID = (await POST(`${BASE}/Projects`, { name: 'Export' })).data.ID
    await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
  })

  it('downloads the bundle of a good tour', async () => {
    const id = await create(demoTour())
    const r = await bytes(`/export/${id}.zip`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('application/zip')
    expect(r.headers['content-disposition']).toBe(
      'attachment; filename="create-your-first-order-tourd.zip"',
    )
    expect(r.headers['cache-control']).toBe('no-store')
    const files = unzipSync(new Uint8Array(r.data))
    expect(Object.keys(files)).toContain('tourd/TourPlayer.js')
    expect(JSON.parse(strFromU8(files['tourd/tour.json'])).title).toBe('Create your first order')
    expect(strFromU8(files['tourd/TourPlayer.js'])).toBe(
      readFileSync('player/TourPlayer.js', 'utf8'),
    )
    expect(strFromU8(files['README.md'])).toContain('`demo.orders.view.Main`')
    expect(files['PROBLEMS.txt']).toBeUndefined()
  })

  it('exports the saved version, not an older one', async () => {
    const id = await create(demoTour())
    const changed = { ...demoTour(), title: 'A newer title' }
    await POST(`${BASE}/saveTour`, { tourID: id, definition: JSON.stringify(changed) })
    const files = unzipSync(new Uint8Array((await bytes(`/export/${id}.zip`)).data))
    expect(JSON.parse(strFromU8(files['tourd/tour.json'])).title).toBe('A newer title')
  })

  const broken = () => {
    const t = demoTour()
    t.steps[1].target = { viewName: 'demo.orders.view.Main', controlId: 'ghost', fallbacks: [] }
    return t
  }

  it('refuses a tour with problems and lists them', async () => {
    const id = await create(broken())
    const r = await raw(`/export/${id}.zip`)
    expect(r.status).toBe(409)
    expect(r.data.error).toContain('must be fixed')
    expect(r.data.blocking[0]).toMatchObject({ code: 'target.notFound' })
    expect(r.headers['content-type']).toMatch(/json/)
  })

  it('exports it anyway when asked to, with the problems written into the bundle', async () => {
    const id = await create(broken())
    const r = await bytes(`/export/${id}.zip?force=1`)
    expect(r.status).toBe(200)
    const files = unzipSync(new Uint8Array(r.data))
    expect(strFromU8(files['PROBLEMS.txt'])).toContain('ghost')
    expect(strFromU8(files['README.md'])).toContain('Exported with open problems')
  })

  it('describes what an export would contain', async () => {
    const id = await create(demoTour())
    const r = await raw(`/export/${id}/check.json`)
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({
      ok: true,
      blocking: [],
      title: 'Create your first order',
      filename: 'create-your-first-order-tourd.zip',
      version: 1,
    })
    expect(r.data.files).toContain('tourd/tour.json')

    const bad = await raw(`/export/${await create(broken())}/check.json`)
    expect(bad.status).toBe(200)
    expect(bad.data.ok).toBe(false)
    expect(bad.data.blocking.length).toBeGreaterThan(0)
  })

  it('exports a tour of a project without files, with a warning', async () => {
    const bare = (await POST(`${BASE}/Projects`, { name: 'Bare' })).data.ID
    const tour = (
      await POST(`${BASE}/createTour`, {
        projectID: bare,
        name: 'Bare',
        definition: JSON.stringify(demoTour()),
      })
    ).data.ID
    const check = (await raw(`/export/${tour}/check.json`)).data
    expect(check.ok).toBe(true)
    expect(check.checkedTargets).toBe(false)
    expect(check.warnings.map((w) => w.code)).toContain('export.unchecked')
    expect((await bytes(`/export/${tour}.zip`)).status).toBe(200)
  })

  it('answers 404 for unknown or malformed ids, other paths, and 405 for writes', async () => {
    const zero = `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`
    expect((await raw(`/export/${zero}.zip`)).status).toBe(404)
    expect((await raw(`/export/${zero}/check.json`)).status).toBe(404)
    expect((await raw('/export/nope.zip')).status).toBe(404)
    expect((await raw(`/export/${zero}.zip/../x`)).status).toBe(404)
    expect((await raw('/export/')).status).toBe(404)
    const post = await axios.post(`/export/${zero}.zip`, {}, { validateStatus: () => true })
    expect(post.status).toBe(405)
  })
})
