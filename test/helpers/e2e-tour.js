import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import { loadSources } from './sources.js'

// Helpers for browser tests that start from a freshly generated tour of the demo app.

export const API = '/odata/v4/tour'
export const tid = (page, id) => page.locator(`[data-testid="${id}"]`)
export const field = (page, id) => tid(page, id).locator('input, textarea').first()

const DEVTOOLS = readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')
const SOURCES = loadSources('samples/demo-app', 'samples/demo-app')

/** Project -> files -> recording -> generated tour, through the API. Returns the ids and the tour document. */
export async function makeTour(request, name = 'Tour', { files = SOURCES } = {}) {
  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const project = await post('Projects', {
    name: `${name} ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  })
  await post('importSources', { projectID: project.ID, files, replace: true })
  const rec = await post('importRecording', { projectID: project.ID, raw: DEVTOOLS })
  let job = await post('generateTour', {
    projectID: project.ID,
    recordingID: rec.ID,
    provider: 'rules',
  })
  for (let i = 0; i < 100 && !['done', 'failed'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 100))
    job = await (await request.get(`${API}/GenerationJobs(${job.ID})`)).json()
  }
  expect(job.status).toBe('done')
  const tour = await (await request.get(`${API}/Tours(${job.tour_ID})`)).json()
  return { projectID: project.ID, tourID: tour.ID, doc: JSON.parse(tour.definition) }
}

export const openTour = async (page, tourID) => {
  await page.goto(`/designer/#/tours/${tourID}`)
  await expect(tid(page, 'step-item').first()).toBeVisible()
}

export const docOf = async (request, tourID) =>
  JSON.parse((await (await request.get(`${API}/Tours(${tourID})`)).json()).definition)
