import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, test, expect } from '@playwright/test'
import { loadSources } from '../helpers/sources.js'

// The panel of the extension: one project chosen once for everything, four tabs for what to do, and buttons that stop
// something only while there is something to stop.

const EXTENSION = resolve('extension')
const TOURD = process.env.TOURD_URL ?? 'http://localhost:4044'
const API = `${TOURD}/odata/v4/tour`
const DEMO = 'http://localhost:8081/index.html'
const SOURCES = loadSources('samples/demo-app', 'samples/demo-app')
const DEVTOOLS = readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')

test.describe.configure({ mode: 'serial' })

let context
let userData
let extensionId
let worker

const post = async (path, data) => {
  const r = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`)
  return r.json()
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`)

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'tourd-panel-'))
  context = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  })
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 20_000 }))
  extensionId = new URL(worker.url()).host
})

test.afterAll(async () => {
  await context?.close()
  rmSync(userData, { recursive: true, force: true })
})

/** A project that has the demo app, and a tour made from a recording of it. */
async function projectWithTour(name) {
  const project = await post('Projects', { name: `${name} ${Date.now()}` })
  await post('importSources', { projectID: project.ID, files: SOURCES, replace: true })
  const rec = await post('importRecording', { projectID: project.ID, raw: DEVTOOLS })
  let job = await post('generateTour', {
    projectID: project.ID,
    recordingID: rec.ID,
    provider: 'rules',
  })
  for (let i = 0; i < 100 && !['done', 'failed'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 100))
    job = await (await fetch(`${API}/GenerationJobs(${job.ID})`)).json()
  }
  expect(job.status).toBe('done')
  return project
}

/** The app in a tab, and the panel for it, paired with TourD. */
async function open() {
  const { token } = await post('createExtensionToken', { name: 'panel' })
  const leftovers = context.pages() // the pages of the test before: their address would be found first
  const demo = await context.newPage()
  await Promise.all(leftovers.map((p) => p.close()))
  await demo.goto(`${DEMO}?ui5=1.120`)
  await expect(demo.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((t) => t.url && t.url.includes('8081'))?.id
  })
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`)
  await panel.locator('body[data-ready="true"]').waitFor()
  await worker.evaluate(async () => {
    await chrome.storage.local.clear()
    await chrome.storage.session.clear()
  })
  await panel.reload()
  await panel.locator('body[data-ready="true"]').waitFor()
  if (await tid(panel, 'settings').isHidden()) await tid(panel, 'open-settings').click()
  await tid(panel, 'tourd-url').fill(TOURD)
  await tid(panel, 'tourd-token').fill(token)
  await tid(panel, 'save-settings').click()
  await expect(tid(panel, 'connection')).toContainText('Connected')
  return { demo, panel }
}

test('one project for everything: it matches the open app, and the tabs follow it', async () => {
  const mine = await projectWithTour('Panel app')
  const newer = await post('Projects', { name: `Panel other ${Date.now()}` }) // newest, but not this app
  const { demo, panel } = await open()

  // the project of the app that is open is chosen, not the newest one
  await expect(tid(panel, 'project')).toHaveValue(mine.ID)
  await expect(tid(panel, 'project-hint')).toContainText('belongs to the app that is open')

  // three tabs, in the order of how often they are used: Tests first, and open; the others wait to be chosen
  await expect(panel.locator('.tab')).toHaveText(['Tests', 'Help', 'Tour'])
  await expect(tid(panel, 'pane-tests')).toBeVisible()
  for (const pane of ['pane-help', 'pane-tour']) await expect(tid(panel, pane)).toBeHidden()

  // the tours of that project are on the Tour tab, its tests on the Tests tab
  await tid(panel, 'tab-tour').click()
  await expect(tid(panel, 'pane-tour')).toBeVisible()
  await expect(tid(panel, 'pane-tests')).toBeHidden()
  await expect(tid(panel, 'play-tour').locator('option')).toHaveCount(1)
  await tid(panel, 'tab-tests').click()
  await expect(tid(panel, 'replay-plan').locator('option')).toHaveCount(0)

  // another project picked by hand stays picked, also when the panel gets the focus again
  await tid(panel, 'project').selectOption(newer.ID)
  await tid(panel, 'tab-tour').click()
  await expect(tid(panel, 'play-tour').locator('option')).toHaveCount(0)
  await panel.evaluate(() => window.dispatchEvent(new Event('focus')))
  await panel.waitForTimeout(500)
  await expect(tid(panel, 'project')).toHaveValue(newer.ID)

  // the tab is remembered for the next time the panel opens
  await tid(panel, 'tab-help').click()
  await panel.reload()
  await panel.locator('body[data-ready="true"]').waitFor()
  await expect(tid(panel, 'pane-help')).toBeVisible()
  void demo
})

test('a stop button shows only while there is something to stop', async () => {
  const mine = await projectWithTour('Panel stop')
  const { demo, panel } = await open()
  await expect(tid(panel, 'project')).toHaveValue(mine.ID)

  // nothing runs: nothing to stop
  await expect(tid(panel, 'stop')).toBeHidden() // recording
  await tid(panel, 'tab-tour').click()
  await expect(tid(panel, 'stop-tour')).toBeHidden()
  await tid(panel, 'tab-help').click()
  await expect(tid(panel, 'help-hide')).toBeHidden()
  await expect(tid(panel, 'help-stop')).toBeHidden()
  await tid(panel, 'tab-tests').click()
  await expect(tid(panel, 'stop-replay')).toBeHidden()

  // a tour plays: "Stop tour" is there, and gone when it is stopped
  await tid(panel, 'tab-tour').click()
  await demo.bringToFront()
  await tid(panel, 'play').click()
  await expect(tid(panel, 'play-message')).toContainText('Playing')
  await expect(tid(panel, 'stop-tour')).toBeVisible()
  await expect(tid(panel, 'tab-tour')).toHaveAttribute('data-live', '')
  await tid(panel, 'stop-tour').click()
  await expect(tid(panel, 'stop-tour')).toBeHidden()
  await expect(tid(panel, 'tab-tour')).not.toHaveAttribute('data-live', '')

  // the same when the tour ends by itself: the button notices
  await tid(panel, 'play').click()
  await expect(tid(panel, 'stop-tour')).toBeVisible()
  await demo.evaluate(
    () =>
      new Promise((resolve) =>
        sap.ui.require(['tourd/live/TourPlayer'], (P) => {
          P.stop()
          resolve()
        }),
      ),
  )
  await expect(tid(panel, 'stop-tour')).toBeHidden({ timeout: 10_000 })

  // recording: "Stop" is there while recording, and gone after
  await tid(panel, 'tab-tests').click()
  await tid(panel, 'start').click()
  await expect(tid(panel, 'stop')).toBeVisible()
  await expect(tid(panel, 'tab-tests')).toHaveAttribute('data-live', '')
  await tid(panel, 'tab-tour').click() // seen from another tab too, which says where the recording is
  await expect(tid(panel, 'tab-tests')).toHaveAttribute('data-live', '')
  await expect(tid(panel, 'rec-elsewhere-text')).toContainText('running in the Tests tab')
  await expect(tid(panel, 'start')).toBeHidden()
  await tid(panel, 'rec-go').click()
  await tid(panel, 'stop').click()
  await expect(tid(panel, 'stop')).toBeHidden()
  await expect(tid(panel, 'tab-tests')).not.toHaveAttribute('data-live', '')
})

test('show the saved help in the app, and hide it again; writing help has its own stop', async () => {
  const mine = await projectWithTour('Panel help')
  const { demo, panel } = await open()
  await expect(tid(panel, 'project')).toHaveValue(mine.ID)
  await tid(panel, 'tab-help').click()

  // no help yet: it says what to do
  await tid(panel, 'help-view').click()
  await expect(tid(panel, 'help-view-message')).toContainText('no help yet')
  await expect(tid(panel, 'help-hide')).toBeHidden()

  // one topic is saved, then shown
  await post('saveHelpTopic', {
    projectID: mine.ID,
    topic: JSON.stringify({
      title: 'Create Order',
      text: 'Press **Create**.',
      target: { viewName: 'demo.orders.view.Main', controlId: 'createBtn', fallbacks: [] },
    }),
  })
  await demo.bringToFront()
  await tid(panel, 'help-view').click()
  await expect(tid(panel, 'help-view-message')).toContainText('Showing 1 topic')
  await expect(demo.locator('.tourd-help-panel')).toBeVisible()
  await expect(demo.locator('.tourd-help-item')).toContainText('Create Order')
  await expect(tid(panel, 'help-hide')).toBeVisible()
  await expect(tid(panel, 'tab-help')).toHaveAttribute('data-live', '')

  // hidden again: the button goes with it
  await tid(panel, 'help-hide').click()
  await expect(demo.locator('.tourd-help')).toHaveCount(0)
  await expect(tid(panel, 'help-hide')).toBeHidden()

  // writing help: its own stop button, and no "show" while writing (the app shows the help already)
  await tid(panel, 'help-start').click()
  await expect(tid(panel, 'help-stop')).toBeVisible()
  await expect(tid(panel, 'help-view')).toBeDisabled()
  await expect(tid(panel, 'help-hide')).toBeHidden()
  await tid(panel, 'help-stop').click()
  await expect(tid(panel, 'help-stop')).toBeHidden()
  await expect(tid(panel, 'help-view')).toBeEnabled()
})

test('a recording belongs to the tab it was started in: tests get checks, tours get words', async () => {
  const mine = await projectWithTour('Panel purpose')
  const { demo, panel } = await open()
  await expect(tid(panel, 'project')).toHaveValue(mine.ID)
  const recording = () =>
    expect
      .poll(() =>
        demo.evaluate(() => !!(window.__tourdRecorder && window.__tourdRecorder.isRecording())),
      )
      .toBe(true)

  // Tests tab: a check can be added, nothing asks for words
  await expect(panel.locator('#rec-title')).toHaveText('Record a test')
  await tid(panel, 'start').click()
  await recording()
  await demo.locator('[data-sap-ui$="--createBtn"]').click()
  await expect(tid(panel, 'step').first()).toContainText('Press Create')
  await expect(tid(panel, 'add-check')).toBeVisible()
  await expect(tid(panel, 'explain')).toHaveCount(0)
  await expect(tid(panel, 'note')).toBeHidden()
  await tid(panel, 'stop').click()
  await expect(tid(panel, 'status')).toHaveText('Stopped')

  // the Tour tab does not start a second recording over it: it says where the first one is
  await tid(panel, 'tab-tour').click()
  await expect(tid(panel, 'rec-elsewhere-text')).toContainText('waiting to be sent')
  await expect(tid(panel, 'start')).toBeHidden()

  // ... unless it is given up on purpose
  await tid(panel, 'rec-fresh').click()
  await expect(tid(panel, 'rec-elsewhere')).toBeHidden()
  await expect(panel.locator('#rec-title')).toHaveText('Record a tour')
  await expect(tid(panel, 'start')).toBeVisible()

  // Tour tab: every step has a field for what it is for, an introduction step can be added, no checks
  await demo.goto(`${DEMO}?ui5=1.120`)
  await expect(demo.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  await tid(panel, 'start').click()
  await recording()
  await demo.locator('[data-sap-ui$="--createBtn"]').click()
  await expect(tid(panel, 'explain')).toHaveCount(1)
  await expect(tid(panel, 'add-check')).toBeHidden()
  await tid(panel, 'explain').fill('Starts a new order.')
  await tid(panel, 'note').fill('Welcome to the orders')
  await tid(panel, 'add-note').click()
  await expect(tid(panel, 'explain')).toHaveValue('Starts a new order.') // typing survives the new step
  await tid(panel, 'stop').click() // saves what was typed
  await tid(panel, 'send').click()
  await expect(tid(panel, 'send-message')).toContainText('generate a tour')
  const rows = (await (await fetch(`${API}/Recordings?$filter=project_ID eq ${mine.ID}`)).json())
    .value
  // (the project had a DevTools recording already: that file does not say what it is for)
  expect(rows.map((r) => r.purpose).sort()).toEqual(['both', 'tour'])
})

test('a recording can be tried before it is sent, and nothing is saved by trying', async () => {
  const mine = await projectWithTour('Panel try')
  const { demo, panel } = await open()
  await expect(tid(panel, 'project')).toHaveValue(mine.ID)
  const recordings = async () =>
    (await (await fetch(`${API}/Recordings?$filter=project_ID eq ${mine.ID}`)).json()).value.length
  const before = await recordings()
  const recording = () =>
    expect
      .poll(() =>
        demo.evaluate(() => !!(window.__tourdRecorder && window.__tourdRecorder.isRecording())),
      )
      .toBe(true)

  // nothing to try while recording or before anything is recorded
  await expect(tid(panel, 'try-card')).toBeHidden()

  // as a test: the app is opened again at the start and the steps run
  await tid(panel, 'start').click()
  await recording()
  await demo.locator('[data-sap-ui$="--createBtn"]').click()
  await expect(demo).toHaveURL(/order\/new/)
  await expect(tid(panel, 'try-card')).toBeHidden()
  await tid(panel, 'stop').click()
  await expect(tid(panel, 'try-card')).toBeVisible()
  await demo.bringToFront()
  await tid(panel, 'try').click()
  await expect(tid(panel, 'try-message')).toContainText('passed', { timeout: 90_000 })
  await expect(tid(panel, 'try-message')).not.toContainText('failed')
  await expect(tid(panel, 'try-results').locator('[data-status="passed"]').first()).toBeVisible()
  await expect(demo).toHaveURL(/order\/new/) // the press did it again, from the start page

  // "Record again" starts over where the recording started, not on the order form the try left
  await expect(tid(panel, 'start')).toContainText('Record again')
  await tid(panel, 'start').click()
  await expect(tid(panel, 'status')).toHaveText('Recording')
  await expect(demo).not.toHaveURL(/order\/new/)
  await recording()
  await tid(panel, 'stop').click()

  // as a tour: the tour TourD would make is played, with the words of the author
  await tid(panel, 'tab-tour').click()
  await tid(panel, 'rec-fresh').click()
  await demo.goto(`${DEMO}?ui5=1.120`) // (the try left the app on the order form)
  await expect(demo.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  await tid(panel, 'start').click()
  await recording()
  await demo.locator('[data-sap-ui$="--createBtn"]').click()
  await tid(panel, 'explain').first().fill('Starts a new order, written by the author.')
  await tid(panel, 'stop').click()
  await demo.bringToFront()
  await tid(panel, 'try').click()
  await expect(tid(panel, 'try-message')).toContainText('Playing the tour', { timeout: 90_000 })
  await expect(demo.locator('.tourd-bubble')).toBeVisible({ timeout: 15_000 })
  await demo.locator('.tourd-btn--primary').click()
  await expect(demo.locator('.tourd-bubble')).toContainText(
    'Starts a new order, written by the author.',
  )
  await tid(panel, 'stop-tour').click()

  // trying saved nothing
  expect(await recordings()).toBe(before)
})
