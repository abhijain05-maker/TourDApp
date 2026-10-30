import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { API, tid } from '../helpers/e2e-tour.js'
import { demoSources } from '../helpers/sources.js'

// A recording says what it is for (tour, tests, both): TourD shows it, asks for it, and offers each recording where
// it fits.

const RECORDING = readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')

async function project(request) {
  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const p = await post('Projects', {
    name: `Purpose ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  })
  await post('importSources', { projectID: p.ID, files: demoSources(), replace: true })
  for (const [name, purpose] of [
    ['For the tour', 'tour'],
    ['For the tests', 'test'],
    ['For both', 'both'],
  ])
    await post('importRecording', { projectID: p.ID, name, raw: RECORDING, purpose })
  return p.ID
}

const names = (page, testId) =>
  page
    .locator(`[data-testid="${testId}"] ui5-option`)
    .evaluateAll((os) => os.map((o) => o.textContent.trim()))

const pick = async (page, testId, text) => {
  await expect(async () => {
    await tid(page, testId).click()
    await page
      .locator('ui5-option')
      .filter({ hasText: new RegExp(`^${text}$`) })
      .first()
      .click({ timeout: 2000 })
  }).toPass()
}

test('the recordings list says what each one is for, and filters', async ({ page, request }) => {
  const id = await project(request)
  await page.goto(`/designer/#/projects/${id}?tab=recordings`)
  await expect(tid(page, 'recording-row')).toHaveCount(3)
  await expect(tid(page, 'rec-purpose-row').nth(0)).toHaveAttribute(
    'data-testid',
    'rec-purpose-row',
  )

  await tid(page, 'rec-filter-tour').click() // a tour is made from those for tours, and those for both
  await expect(tid(page, 'recording-row')).toHaveCount(2)
  await expect(tid(page, 'recording-row').filter({ hasText: 'For the tests' })).toHaveCount(0)
  await tid(page, 'rec-filter-test').click()
  await expect(tid(page, 'recording-row').filter({ hasText: 'For the tour' })).toHaveCount(0)
  await tid(page, 'rec-filter-all').click()
  await expect(tid(page, 'recording-row')).toHaveCount(3)
})

test('the label of a recording can be changed in the list', async ({ page, request }) => {
  const id = await project(request)
  await page.goto(`/designer/#/projects/${id}?tab=recordings`)
  const row = tid(page, 'recording-row').filter({ hasText: 'For the tests' })
  const select = row.locator('[data-testid="rec-purpose-row"]')
  await select.click()
  await select
    .locator('ui5-option')
    .filter({ hasText: /^Tour and tests$/ })
    .click()
  await expect(async () => {
    const rows = (await (await request.get(`${API}/Recordings?$filter=project_ID eq ${id}`)).json())
      .value
    expect(rows.find((r) => r.name === 'For the tests').purpose).toBe('both')
  }).toPass()
})

test('an import asks what the recording is for; a file from the extension answers it already', async ({
  page,
  request,
}) => {
  const id = await project(request)
  await page.goto(`/designer/#/projects/${id}?tab=recordings`)
  await tid(page, 'rec-name').locator('input').fill('Pasted for tests')
  await tid(page, 'rec-raw').locator('textarea').fill(RECORDING)
  const chosen = () =>
    tid(page, 'rec-purpose').evaluate((el) => el.selectedOption?.textContent.trim())
  expect(await chosen()).toBe('Tour and tests') // a file does not say: both
  await pick(page, 'rec-purpose', 'Tests')
  await tid(page, 'rec-import').click()
  await expect(tid(page, 'rec-result')).toContainText('Made for tests')

  // the extension writes its purpose into the file: it is chosen when the file is pasted
  await tid(page, 'rec-raw')
    .locator('textarea')
    .fill(JSON.stringify({ ...JSON.parse(RECORDING), purpose: 'tour' }))
  await expect.poll(chosen).toBe('Tour')
})

test('generating a tour offers the recordings for tours; the others on request', async ({
  page,
  request,
}) => {
  const id = await project(request)
  await page.goto(`/designer/#/projects/${id}?tab=tours`)
  await tid(page, 'generate-tour').click()
  await expect(tid(page, 'generate-dialog')).toBeVisible()
  expect(await names(page, 'gen-recording')).toEqual(['For the tour', 'For both'].sort())
  await tid(page, 'gen-show-all').click()
  expect(await names(page, 'gen-recording')).toHaveLength(3)
  expect((await names(page, 'gen-recording')).join(' ')).toContain('For the tests (tests)')
})

test('new tests offer the recordings for tests; the others on request', async ({
  page,
  request,
}) => {
  const id = await project(request)
  await page.goto(`/designer/#/projects/${id}?tab=tests`)
  await tid(page, 'new-test-plan').click()
  expect(await names(page, 'test-recording')).toEqual(['For the tests', 'For both'].sort())
  await tid(page, 'test-show-all').click()
  expect(await names(page, 'test-recording')).toHaveLength(3)
})

test('when no recording was made for tests, all are shown, with a note', async ({
  page,
  request,
}) => {
  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const p = await post('Projects', { name: `Purpose tour only ${Date.now()}` })
  await post('importSources', { projectID: p.ID, files: demoSources(), replace: true })
  await post('importRecording', {
    projectID: p.ID,
    name: 'Only a tour',
    raw: RECORDING,
    purpose: 'tour',
  })
  await page.goto(`/designer/#/projects/${p.ID}?tab=tests`)
  await tid(page, 'new-test-plan').click()
  await expect(tid(page, 'test-none-fit')).toBeVisible()
  expect((await names(page, 'test-recording')).join(' ')).toContain('Only a tour')
})
