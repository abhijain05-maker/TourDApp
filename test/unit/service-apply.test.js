import cds from '@sap/cds'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { demoSources } from '../helpers/sources.js'

const { GET, POST } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const tourDoc = () => readFileSync('samples/demo-app/webapp/tourd/tour.json', 'utf8')

/** The demo app without its tour, as a project, with a tour in it. */
async function setup() {
  const projectID = (await POST(`${BASE}/Projects`, { name: `Apply ${Math.random()}` })).data.ID
  const files = demoSources().map((f) => {
    let content = f.content
    if (f.path.endsWith('/manifest.json')) {
      const m = JSON.parse(content)
      delete m['sap.ui5'].resourceRoots
      content = JSON.stringify(m, null, '\t')
    }
    if (f.path.endsWith('Main.view.xml'))
      content = content.replace(/^\s*<Button id="startTourBtn".*\n/m, '')
    return { path: f.path, content }
  })
  await POST(`${BASE}/importSources`, { projectID, files, replace: true })
  const tour = (
    await POST(`${BASE}/createTour`, { projectID, name: 'Applied', definition: tourDoc() })
  ).data
  const list = async () =>
    (await GET(`${BASE}/Sources?$filter=project_ID eq ${projectID} and deleted eq false`)).data
      .value
  const changes = async () => (await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value
  return { projectID, tourID: tour.ID, list, changes }
}

describe('previewTourApply / applyTourToProject', () => {
  it('previews the edits without touching any file', async () => {
    const { tourID, changes } = await setup()
    const plan = (await POST(`${BASE}/previewTourApply`, { tourID })).data
    expect(plan.ok).toBe(true)
    expect(plan.edits.map((e) => e.path)).toEqual(
      expect.arrayContaining([
        'webapp/tourd/TourPlayer.js',
        'webapp/tourd/tour.json',
        'webapp/manifest.json',
        'webapp/view/Main.view.xml',
      ]),
    )
    const view = plan.edits.find((e) => e.path === 'webapp/view/Main.view.xml')
    expect(view.before).not.toContain('startTourBtn')
    expect(view.after).toContain('startTourBtn')
    expect(await changes()).toEqual([])
  })

  it('applies all edits as workspace changes, and a second time changes nothing', async () => {
    const { projectID, tourID, changes, list } = await setup()
    const done = (await POST(`${BASE}/applyTourToProject`, { tourID })).data
    expect(done.applied).toBeGreaterThanOrEqual(5)
    const byPath = Object.fromEntries((await changes()).map((c) => [c.path, c.status]))
    expect(byPath['webapp/tourd/TourPlayer.js']).toBe('added')
    expect(byPath['webapp/manifest.json']).toBe('modified')
    expect(byPath['webapp/view/Main.view.xml']).toBe('modified')
    expect((await list()).find((f) => f.path === 'webapp/tourd/tour.json')).toBeTruthy()

    const patch = await GET(`/export/project/${projectID}/changes.patch`)
    expect(patch.data).toMatch(/^[+]\s*<Button id="startTourBtn"/m)

    const again = (await POST(`${BASE}/applyTourToProject`, { tourID })).data
    expect(again.applied).toBe(0)
    const plan = (await POST(`${BASE}/previewTourApply`, { tourID })).data
    expect(plan.edits).toEqual([])
  })

  it('applies only the accepted files', async () => {
    const { tourID, changes } = await setup()
    const done = (
      await POST(`${BASE}/applyTourToProject`, { tourID, paths: ['webapp/tourd/tour.json'] })
    ).data
    expect(done.paths).toEqual(['webapp/tourd/tour.json'])
    expect((await changes()).map((c) => c.path)).toEqual(['webapp/tourd/tour.json'])
  })

  it('keeps the inventory current and refuses a tour that is not fit', async () => {
    const { projectID, tourID } = await setup()
    await POST(`${BASE}/applyTourToProject`, { tourID })
    const inv = JSON.parse((await GET(`${BASE}/getInventory(projectID=${projectID})`)).data.value)
    expect(inv.controls.some((c) => c.localId === 'startTourBtn')).toBe(true)

    const bad = JSON.parse(tourDoc())
    bad.steps[0].meta = { unresolved: true }
    const t2 = (
      await POST(`${BASE}/createTour`, { projectID, name: 'Bad', definition: JSON.stringify(bad) })
    ).data
    const plan = (await POST(`${BASE}/previewTourApply`, { tourID: t2.ID })).data
    expect(plan.ok).toBe(false)
    const r = await POST(`${BASE}/applyTourToProject`, { tourID: t2.ID }).catch((e) => e.response)
    expect(r.status).toBe(409)
  })

  it('an unknown tour is a 404', async () => {
    const r = await POST(`${BASE}/previewTourApply`, {
      tourID: '00000000-0000-4000-8000-000000000000',
    }).catch((e) => e.response)
    expect(r.status).toBe(404)
  })
})
