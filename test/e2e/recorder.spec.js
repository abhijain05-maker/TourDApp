import { readFileSync, writeFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { loadSources } from '../helpers/sources.js'
import { API } from '../helpers/e2e-tour.js'

// The TourD recorder (Phase 1 of v2) in a real UI5 app: what it writes must name the exact controls, and
// TourD must be able to turn it into a tour without a single unresolved step.

const DEMO = 'http://localhost:8081/index.html'
const SOURCES = loadSources('samples/demo-app', 'samples/demo-app')

async function openDemo(page, ui5) {
  await page.goto(`${DEMO}?ui5=${ui5}`)
  await expect(page.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  await page.addScriptTag({ path: 'recorder/recorder.js' })
}

/** The flow of the demo app: search, create an order, fill it in, choose a status, save. */
async function recordOrderFlow(page) {
  await page.evaluate(() => window.__tourdRecorder.start())
  await page.locator('[data-sap-ui$="--searchField"] input').fill('Acme')
  await page.keyboard.press('Enter')
  await page.locator('[data-sap-ui$="--createBtn"]').click()
  const customer = page.locator('[data-sap-ui$="--customerInput"] input')
  await customer.waitFor()
  await customer.fill('Acme Corp')
  await page.keyboard.press('Tab')
  // the form may still be re-rendering after the previous field was left: open the list again if it closed
  await expect(async () => {
    await page.locator('[data-sap-ui$="--statusSelect"]').click()
    await page.getByRole('option', { name: 'Shipped' }).click({ timeout: 3000 })
  }).toPass({ timeout: 20_000 })
  await page.locator('[data-sap-ui$="--saveBtn"]').click()
  await expect(page.locator('[data-sap-ui$="--ordersTable"]')).toBeVisible()
  return page.evaluate(() => window.__tourdRecorder.stop())
}

for (const ui5 of ['1.120', 'latest']) {
  test(`records what a person does with the exact controls, views and controllers (UI5 ${ui5})`, async ({
    page,
  }) => {
    await openDemo(page, ui5)
    const rec = await recordOrderFlow(page)

    expect(rec).toMatchObject({
      format: 'tourd-recording',
      version: 1,
      app: { appId: 'demo.orders', title: 'Demo Orders', url: 'http://localhost:8081/index.html' },
    })
    expect(rec.app.ui5Version).toMatch(/^1\.\d+/)

    const brief = rec.steps.map((s) => [s.type, s.control?.localId ?? s.hash, s.value])
    expect(brief).toEqual([
      ['search', 'searchField', 'Acme'],
      ['press', 'createBtn', undefined],
      ['navigate', '/order/new', undefined],
      ['input', 'customerInput', 'Acme Corp'],
      ['select', 'statusSelect', 'Shipped'],
      ['press', 'saveBtn', undefined],
      ['navigate', '', undefined],
    ])
    // the recorder knows what DevTools can only guess
    const create = rec.steps[1].control
    expect(create).toMatchObject({
      id: expect.stringMatching(/--createBtn$/),
      viewName: 'demo.orders.view.Main',
      controllerName: 'demo.orders.controller.Main',
      controlType: 'sap.m.Button',
      stableId: true,
      text: 'Create',
      i18n: { property: 'text', model: 'i18n', key: 'create' },
    })
    expect(rec.steps[3].control).toMatchObject({
      viewName: 'demo.orders.view.Detail',
      controllerName: 'demo.orders.controller.Detail',
      label: 'Customer',
    })
    expect(rec.steps[4].valueText).toBe('Shipped')
    // a navigation belongs to the action that caused it
    expect(rec.steps[2].causedBy).toBe(1)
    expect(rec.steps[6].causedBy).toBe(5)

    if (process.env.TOURD_WRITE_FIXTURES === '1' && ui5 === '1.120')
      writeFileSync(
        'test/fixtures/recordings/demo-create-order.tourd.json',
        JSON.stringify(rec, null, 2) + '\n',
      )
  })
}

test('never records passwords or other secrets, and says that it left them out', async ({
  page,
}) => {
  await openDemo(page, '1.120')
  await page.evaluate(() => {
    return new Promise((resolve) => {
      sap.ui.require(['sap/m/Input', 'sap/m/VBox'], (Input, VBox) => {
        new VBox({
          items: [
            new Input('pw', { type: 'Password', placeholder: 'Your login' }),
            new Input('apiKey', { placeholder: 'API key' }),
            new Input('plain', { placeholder: 'Nickname' }),
          ],
        }).placeAt(document.body)
        resolve()
      })
    })
  })
  await page.evaluate(() => window.__tourdRecorder.start())
  for (const [id, value] of [
    ['pw', 'hunter2'],
    ['apiKey', 'sk-secret-123'],
    ['plain', 'Anna'],
  ]) {
    await page.locator(`[id="${id}"] input`).fill(value)
    await page.keyboard.press('Tab')
  }
  const rec = await page.evaluate(() => window.__tourdRecorder.stop())

  const byId = Object.fromEntries(rec.steps.map((s) => [s.control.localId ?? s.control.id, s]))
  expect(byId.pw).toMatchObject({ type: 'input', redacted: true })
  expect(byId.pw.value).toBeUndefined()
  expect(byId.apiKey).toMatchObject({ type: 'input', redacted: true })
  expect(byId.plain).toMatchObject({ type: 'input', value: 'Anna' })
  expect(JSON.stringify(rec)).not.toMatch(/hunter2|sk-secret/)
})

test('a check on a secret field says only that it is there', async ({ page }) => {
  await openDemo(page, '1.120')
  await page.evaluate(() => {
    return new Promise((resolve) => {
      sap.ui.require(['sap/m/Input'], (Input) => {
        new Input('pw', { type: 'Password', value: 'hunter2' }).placeAt(document.body)
        new Input('apiKey', { value: 'sk-secret-123', placeholder: 'API key' }).placeAt(
          document.body,
        )
        resolve()
      })
    })
  })
  await page.evaluate(() => window.__tourdRecorder.start())
  for (const id of ['pw', 'apiKey']) {
    await page.evaluate(() => window.__tourdRecorder.pickCheck())
    await page.locator(`[id="${id}"]`).click()
  }
  const rec = await page.evaluate(() => window.__tourdRecorder.stop())
  expect(rec.steps.map((s) => s.check)).toEqual([{ kind: 'visible' }, { kind: 'visible' }])
  expect(JSON.stringify(rec)).not.toMatch(/hunter2|sk-secret/)
})

test('pick mode describes the control that is clicked, without clicking it', async ({ page }) => {
  await openDemo(page, '1.120')
  await page.evaluate(() => {
    window.__picked = undefined
    window.__tourdRecorder.pick((d) => (window.__picked = d))
  })
  await page.locator('[data-sap-ui$="--createBtn"]').click()
  const picked = await page.evaluate(() => window.__picked)
  expect(picked).toMatchObject({
    controlType: 'sap.m.Button',
    viewName: 'demo.orders.view.Main',
    text: 'Create',
  })
  await expect(page.locator('[data-sap-ui$="--ordersTable"]')).toBeVisible() // the app did not react: still on the list
  expect(page.url()).not.toContain('order/new')
})

test('a check records what the pointed-at control shows now, and never a secret', async ({
  page,
}) => {
  await openDemo(page, '1.120')
  await page.evaluate(() => window.__tourdRecorder.start())
  await page.locator('[data-sap-ui$="--createBtn"]').click()
  const customer = page.locator('[data-sap-ui$="--customerInput"] input')
  await customer.waitFor()
  await customer.fill('Acme Corp')
  await page.keyboard.press('Tab')

  const pickAndClick = async (locator) => {
    await page.evaluate(() => window.__tourdRecorder.pickCheck())
    await locator.click()
  }
  await pickAndClick(page.locator('[data-sap-ui$="--customerInput"]')) // an input: its value
  await pickAndClick(page.locator('[data-sap-ui$="--saveBtn"]')) // a button: its text
  await pickAndClick(page.locator('[data-sap-ui$="--orderForm"]')) // a form: it is there

  const rec = await page.evaluate(() => window.__tourdRecorder.stop())
  const checks = rec.steps.filter((s) => s.type === 'check')
  expect(checks.map((s) => [s.control.localId, s.check])).toEqual([
    ['customerInput', { kind: 'value', expected: 'Acme Corp' }],
    ['saveBtn', { kind: 'text', expected: 'Save' }],
    [expect.stringMatching(/^orderForm/), { kind: 'visible' }], // the form (its inner grid is what was hit)
  ])
  // the pick did not click anything: still on the form, nothing saved
  expect(page.url()).toContain('order/new')
  expect((await import('../../shared/recording-schema.mjs')).validateRecording(rec).ok).toBe(true)
})

test('the recording imports into TourD and becomes a tour with every control resolved', async ({
  page,
  request,
}) => {
  await openDemo(page, '1.120')
  const rec = await recordOrderFlow(page)

  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const project = await post('Projects', { name: `Recorder ${Date.now()}` })
  await post('importSources', { projectID: project.ID, files: SOURCES, replace: true })
  const imported = await post('importRecording', {
    projectID: project.ID,
    raw: JSON.stringify(rec),
  })
  expect(imported).toMatchObject({
    format: 'tourd-recorder',
    actionable: 5,
    mapped: 5,
    unmapped: 0,
  })

  let job = await post('generateTour', {
    projectID: project.ID,
    recordingID: imported.ID,
    provider: 'rules',
  })
  for (let i = 0; i < 100 && !['done', 'failed'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 100))
    job = await (await request.get(`${API}/GenerationJobs(${job.ID})`)).json()
  }
  expect(job.status, job.error).toBe('done')
  const tour = JSON.parse(
    (await (await request.get(`${API}/Tours(${job.tour_ID})`)).json()).definition,
  )
  expect(tour.steps.map((s) => s.title)).toEqual([
    'Demo Orders',
    'Search',
    'Press Create',
    'Customer',
    'Choose status',
    'Press Save',
  ])
  expect(tour.steps.filter((s) => s.meta?.unresolved)).toEqual([])
  expect(tour.steps[3]).toMatchObject({
    target: { viewName: 'demo.orders.view.Detail', controlId: 'customerInput' },
  })
  expect(tour.steps[3].before).toEqual([{ type: 'navigate', hash: 'order/new' }])
  const lint = await (await request.get(`${API}/lintTour(tourID=${job.tour_ID})`)).json()
  expect(lint.errors).toBe(0)
  expect(lint.issues.filter((i) => i.severity === 'error')).toEqual([])
})

test('the designer imports a TourD recording and shows view, controller and handler of every step', async ({
  page,
}) => {
  const tid = (id) => page.locator(`[data-testid="${id}"]`)
  const field = (id) => tid(id).locator('input, textarea').first()
  await page.goto('/designer/')
  await tid('new-project').click()
  await field('project-name').fill(`Recorder UI ${Date.now()}`)
  await tid('create-project').click()
  await expect(tid('project-title')).toBeVisible()
  await tid('input-folder').setInputFiles('samples/demo-app')
  await expect(tid('import-result')).toContainText('Imported 17 file(s) of demo.orders')

  await page.getByRole('tab', { name: 'Recordings' }).click()
  await field('rec-name').fill('Recorded in the app')
  await field('rec-raw').fill(
    readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8'),
  )
  await tid('rec-import').click()
  await expect(tid('rec-result')).toContainText(
    'Imported a TourD recorder recording: 6 step(s), 5 of 5 matched',
  )
  await expect(tid('recording-row')).toContainText('QuickDev recorder')

  await tid('rec-details').click()
  const dialog = tid('rec-details-dialog')
  await expect(dialog.locator('[data-testid="rec-step"]')).toHaveCount(6)
  await expect(dialog).toContainText('recorder (100%)')
  const create = dialog.locator('[data-testid="rec-step"]', { hasText: 'createBtn' })
  await expect(create).toContainText('Main · Main · onCreate()') // view · controller · handler
  await expect(create).toContainText('opens "order/new"')
  await expect(
    dialog.locator('[data-testid="rec-step"]', { hasText: 'statusSelect' }),
  ).toContainText('chooses "Shipped"')
})
