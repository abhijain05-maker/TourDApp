import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, test, expect } from '@playwright/test'
import { loadSources } from '../helpers/sources.js'
import { validateRecording } from '../../shared/recording-schema.mjs'

// The browser extension (Phase 2 of v2), loaded into a real Chromium: record in the demo app through its panel,
// send the recording to TourD, and play a tour back in the page.

const EXTENSION = resolve('extension')
const TOURD = process.env.TOURD_URL ?? 'http://localhost:4044'
const API = `${TOURD}/odata/v4/tour`
const DEMO = 'http://localhost:8081/index.html'
const SOURCES = loadSources('samples/demo-app', 'samples/demo-app')

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

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'tourd-ext-'))
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

// every test starts like a fresh install: not paired, nothing recorded
test.beforeEach(async () => {
  await worker.evaluate(async () => {
    await chrome.storage.local.clear()
    await chrome.storage.session.clear()
  })
})

test.afterAll(async () => {
  await context?.close()
  rmSync(userData, { recursive: true, force: true })
})

const tid = (page, id) => page.locator(`[data-testid="${id}"]`)

/** The app in a tab, ready for UI5 to be used. */
async function openDemo() {
  const page = await context.newPage()
  await page.goto(`${DEMO}?ui5=1.120`)
  await expect(page.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  return page
}

const tabIdOf = (urlPart) =>
  worker.evaluate(async (part) => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((t) => t.url && t.url.includes(part))?.id
  }, urlPart)

async function openPanel(forTabId) {
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${forTabId}`)
  await panel.locator('body[data-ready="true"]').waitFor()
  return panel
}

/** Pairs the panel with TourD through its settings, like a user would. */
async function pair(panel, token) {
  if (await tid(panel, 'settings').isHidden()) await tid(panel, 'open-settings').click()
  await tid(panel, 'tourd-url').fill(TOURD)
  await tid(panel, 'tourd-token').fill(token)
  await tid(panel, 'save-settings').click()
}

/** The recorder was injected and is running in the page. */
const recording = async (page) => {
  await page.bringToFront()
  await expect
    .poll(
      () => page.evaluate(() => !!(window.__tourdRecorder && window.__tourdRecorder.isRecording())),
      {
        timeout: 20_000,
      },
    )
    .toBe(true)
}

const newToken = async (name = 'e2e') => (await post('createExtensionToken', { name })).token

async function newProject(name) {
  const project = await post('Projects', { name: `${name} ${Date.now()}` })
  await post('importSources', { projectID: project.ID, files: SOURCES, replace: true })
  return project
}

async function flow(page) {
  // the panel was opened after the app, so it is in front; a UI5 popup closes when its page loses focus
  await page.bringToFront()
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
}

test('records in the app through the panel, sends the recording to TourD, and plays the tour back in the page', async () => {
  const token = await newToken()
  const project = await newProject('Extension')
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'))

  // connect
  await pair(panel, token)
  await expect(tid(panel, 'connection')).toContainText('Connected')

  // record a tour: its tab asks for the words of every step
  await tid(panel, 'tab-tour').click()
  await expect(tid(panel, 'add-check')).toBeHidden()
  await expect(tid(panel, 'status')).toHaveText('Ready')
  await tid(panel, 'start').click()
  await expect(tid(panel, 'status')).toHaveText('Recording')
  await recording(demo)
  await expect
    .poll(() =>
      demo.evaluate(() => !!(window.__tourdRecorder && window.__tourdRecorder.isRecording())),
    )
    .toBe(true)
  await flow(demo)
  await expect(tid(panel, 'step')).toHaveCount(7)
  await expect(tid(panel, 'steps')).toContainText('Press Create')
  await expect(tid(panel, 'steps')).toContainText('Enter Customer')
  await expect(tid(panel, 'steps')).toContainText('Acme Corp')
  await expect(tid(panel, 'steps')).toContainText('Detail · customerInput')
  await expect(tid(panel, 'step-count')).toHaveText('7 steps')

  // every step can say what it is for: under the first one
  await expect(tid(panel, 'explain')).toHaveCount(5) // (the two page changes have nothing to explain)
  await tid(panel, 'explain')
    .first()
    .fill('Starts a new order: the first thing to do on this page.')

  // an introduction step can be added and taken out again
  await tid(panel, 'note').fill('This is where the order is created')
  await tid(panel, 'add-note').click()
  await expect(tid(panel, 'step')).toHaveCount(8)
  await tid(panel, 'step-delete').last().click()
  await expect(tid(panel, 'step')).toHaveCount(7)

  // stop and send
  await tid(panel, 'stop').click()
  await expect(tid(panel, 'status')).toHaveText('Stopped')
  await expect
    .poll(() =>
      demo.evaluate(() => !!(window.__tourdRecorder && window.__tourdRecorder.isRecording())),
    )
    .toBe(false)
  await expect(tid(panel, 'send-card')).toBeVisible()
  await tid(panel, 'project').selectOption(project.ID)
  await tid(panel, 'send').click()
  await expect(tid(panel, 'send-message')).toContainText('Sent. 5 of 5 steps matched')

  // TourD has it, with every control found
  const recordings = (
    await (await fetch(`${API}/Recordings?$filter=project_ID eq ${project.ID}`)).json()
  ).value
  expect(recordings).toHaveLength(1)
  expect(recordings[0]).toMatchObject({ format: 'tourd-recorder', purpose: 'tour' }) // from the tab it was recorded in
  const raw = JSON.parse(recordings[0].raw ?? '{}')
  void raw

  // make a tour of it
  let job = await post('generateTour', {
    projectID: project.ID,
    recordingID: recordings[0].ID,
    provider: 'rules',
  })
  for (let i = 0; i < 100 && !['done', 'failed'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 100))
    job = await (await fetch(`${API}/GenerationJobs(${job.ID})`)).json()
  }
  expect(job.status, job.error).toBe('done')
  // the words written under the step are the text of the tour step
  const made = await (await fetch(`${API}/Tours(${job.tour_ID})`)).json()
  expect(JSON.parse(made.definition).steps.map((s) => s.text)).toContain(
    'Starts a new order: the first thing to do on this page.',
  )

  // play it in the app (the panel was opened before the tour existed: reload it, state survives in the extension)
  await panel.reload()
  await expect(tid(panel, 'status')).toHaveText('Stopped')
  await tid(panel, 'project').selectOption(project.ID)
  await tid(panel, 'tab-tour').click()
  await expect(tid(panel, 'play-tour')).not.toHaveText('')
  await tid(panel, 'play').click()
  await expect(tid(panel, 'play-message')).toContainText('Playing')
  await expect(demo.locator('.tourd-title')).toHaveText('Demo Orders', { timeout: 15_000 })
  await demo.locator('.tourd-btn--primary').click()
  await expect(demo.locator('.tourd-title')).toHaveText('Search')
  await tid(panel, 'stop-tour').click()
  await expect(demo.locator('.tourd-bubble')).toHaveCount(0)

  await demo.close()
  await panel.close()
})

test('does not answer without being paired, and says how to pair', async () => {
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'))
  await expect(tid(panel, 'settings')).toBeVisible() // no token yet: the settings open by themselves
  await pair(panel, 'tourd_not-a-real-token')
  await expect(tid(panel, 'connection')).toContainText('not paired')
  await pair(panel, '')
  await expect(tid(panel, 'connection')).toContainText('not paired')
  await demo.close()
  await panel.close()
})

test('a revoked token stops working', async () => {
  const made = await post('createExtensionToken', { name: 'to revoke' })
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'))
  await pair(panel, made.token)
  await expect(tid(panel, 'connection')).toContainText('Connected')
  await post('revokeExtensionToken', { ID: made.ID })
  await pair(panel, made.token)
  await expect(tid(panel, 'connection')).toContainText('revoked')
  await demo.close()
  await panel.close()
})

test('says so on a page that does not use UI5', async () => {
  const page = await context.newPage()
  await page.goto(`${TOURD}/designer/`)
  const panel = await openPanel(await tabIdOf('/designer/'))
  await tid(panel, 'start').click()
  await expect(tid(panel, 'rec-message')).toContainText('does not use UI5')
  await expect(tid(panel, 'status')).toHaveText('Ready')
  await page.close()
  await panel.close()
})

test('pausing stops recording, resuming continues', async () => {
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'))
  await tid(panel, 'start').click()
  await expect(tid(panel, 'status')).toHaveText('Recording')
  await recording(demo)
  await demo.locator('[data-sap-ui$="--searchField"] input').fill('first')
  await demo.keyboard.press('Enter')
  await expect(tid(panel, 'step')).toHaveCount(1)

  await tid(panel, 'pause').click()
  await expect(tid(panel, 'status')).toHaveText('Paused')
  await demo.locator('[data-sap-ui$="--searchField"] input').fill('while paused')
  await demo.keyboard.press('Enter')
  await demo.waitForTimeout(500)
  await expect(tid(panel, 'step')).toHaveCount(1)

  await tid(panel, 'resume').click()
  await demo.locator('[data-sap-ui$="--searchField"] input').fill('after')
  await demo.keyboard.press('Enter')
  await expect(tid(panel, 'step')).toHaveCount(2)
  await expect(tid(panel, 'steps')).not.toContainText('while paused')
  await tid(panel, 'stop').click()
  await demo.close()
  await panel.close()
})

test('keeps recording when the page is reloaded', async () => {
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'))
  await tid(panel, 'start').click()
  await expect(tid(panel, 'status')).toHaveText('Recording')
  await recording(demo)

  await demo.reload()
  await expect(demo.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  await expect
    .poll(
      () => demo.evaluate(() => !!(window.__tourdRecorder && window.__tourdRecorder.isRecording())),
      { timeout: 20_000 },
    )
    .toBe(true)
  await demo.locator('[data-sap-ui$="--createBtn"]').click()
  await expect(tid(panel, 'steps')).toContainText('Press Create')
  await expect(tid(panel, 'status')).toHaveText('Recording')
  await tid(panel, 'stop').click()
  await demo.close()
  await panel.close()
})

// a page of another origin than the app (127.0.0.1 and localhost), both on this machine, served for real:
// Chrome refuses a frame from a page it treats as public to a local address
let shell
let shellHtml = ''
const shellPage = async (html) => {
  shellHtml = html
  shell ??= await new Promise((resolve) => {
    const server = createServer((req, res) =>
      res.writeHead(200, { 'content-type': 'text/html' }).end(shellHtml),
    )
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/host.html` }),
    )
  })
  return shell.url
}
test.afterAll(() => shell?.server.close())

test('records inside a frame, like an app in the Fiori launchpad', async () => {
  const shellUrl = await shellPage(
    `<title>Shell</title><iframe id="app" src="${DEMO}?ui5=1.120" style="width:1100px;height:700px;border:0"></iframe>`,
  )
  const page = await context.newPage()
  await page.goto(shellUrl)
  const app = page.frameLocator('#app')
  await expect(app.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  const panel = await openPanel(await tabIdOf('host.html'))

  await tid(panel, 'start').click()
  await expect(tid(panel, 'status')).toHaveText('Recording')
  await expect
    .poll(
      async () =>
        await page
          .frames()
          .find((f) => f.url().startsWith(DEMO))
          .evaluate(() => !!(window.__tourdRecorder && window.__tourdRecorder.isRecording())),
      { timeout: 20_000 },
    )
    .toBe(true)
  await app.locator('[data-sap-ui$="--createBtn"]').click()
  await app.locator('[data-sap-ui$="--customerInput"] input').fill('Acme')
  await page.keyboard.press('Tab')
  await expect(tid(panel, 'steps')).toContainText('Press Create')
  await expect(tid(panel, 'steps')).toContainText('Enter Customer')
  await tid(panel, 'stop').click()

  const rec = await panel.evaluate(
    async (id) => chrome.runtime.sendMessage({ cmd: 'recording', tabId: id }),
    await tabIdOf('host.html'),
  )
  expect(rec.app).toMatchObject({ appId: 'demo.orders', url: DEMO }) // described by the app's frame, not by the shell
  expect(rec.steps.map((s) => s.type)).toEqual(['press', 'navigate', 'input'])
  expect(rec.steps[1].causedBy).toBe(0)
  await page.close()
  await panel.close()
})

test('records in a frame that opens while recording', async () => {
  const page = await context.newPage()
  await page.goto(`${DEMO}?ui5=1.120`)
  await expect(page.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  const panel = await openPanel(await tabIdOf('8081'))
  await tid(panel, 'start').click()
  await recording(page)

  // a second copy of the app appears in a frame (a launchpad opening another app)
  await page.evaluate((src) => {
    const f = document.createElement('iframe')
    f.id = 'late'
    f.src = src
    f.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff;z-index:9999'
    document.body.appendChild(f)
  }, `${DEMO}?ui5=1.120`)
  const late = page.frameLocator('#late')
  await expect(late.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  await expect
    .poll(
      async () =>
        await page
          .frames()
          .find((f) => f.parentFrame())
          .evaluate(() => !!(window.__tourdRecorder && window.__tourdRecorder.isRecording())),
      { timeout: 20_000 },
    )
    .toBe(true)
  await late.locator('[data-sap-ui$="--createBtn"]').click()
  await expect(tid(panel, 'steps')).toContainText('Press Create')
  await tid(panel, 'stop').click()
  await page.close()
  await panel.close()
})

test('saves the recording as a file that TourD accepts', async () => {
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'))
  await tid(panel, 'start').click()
  await recording(demo)
  await demo.locator('[data-sap-ui$="--searchField"] input').fill('Acme')
  await demo.keyboard.press('Enter')
  await expect(tid(panel, 'step')).toHaveCount(1)
  await tid(panel, 'stop').click()

  const download = panel.waitForEvent('download')
  await tid(panel, 'save-file').click()
  const file = await download
  expect(file.suggestedFilename()).toBe('tourd-recording.json')
  const rec = JSON.parse(readFileSync(await file.path(), 'utf8'))
  expect(validateRecording(rec).issues).toEqual([])
  expect(rec.steps[0]).toMatchObject({
    type: 'search',
    value: 'Acme',
    control: { localId: 'searchField' },
  })
  expect(rec.recorder).toMatch(/^tourd-extension .* \+ tourd-recorder /)
  await demo.close()
  await panel.close()
})

test('"Add a check" points at a control in the app and the recording gets a check of what it shows', async () => {
  const token = await newToken()
  await newProject('Extension check')
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'))
  await pair(panel, token)
  await expect(tid(panel, 'connection')).toContainText('Connected')
  await expect(tid(panel, 'add-check')).toBeHidden() // only while recording

  await tid(panel, 'start').click()
  await recording(demo)
  await expect(tid(panel, 'add-check')).toBeVisible()
  await demo.bringToFront()
  await demo.locator('[data-sap-ui$="--searchField"] input').fill('Acme')
  await demo.keyboard.press('Enter')
  await expect(tid(panel, 'step')).toHaveCount(1)

  // Escape gives up: nothing is recorded, and the app is not clicked
  await tid(panel, 'add-check').click()
  await expect(tid(panel, 'rec-message')).toContainText('Click the control')
  await demo.bringToFront()
  await demo.keyboard.press('Escape')
  await demo.locator('[data-sap-ui$="--createBtn"]').hover()
  await expect(tid(panel, 'step')).toHaveCount(1)

  // pointing at the search field records what it holds now
  await tid(panel, 'add-check').click()
  await demo.bringToFront()
  await demo.locator('[data-sap-ui$="--searchField"]').click()
  await expect(tid(panel, 'step')).toHaveCount(2)
  await expect(tid(panel, 'steps')).toContainText('Check')
  await expect(tid(panel, 'steps')).toContainText('holds “Acme”')
  await expect(tid(panel, 'rec-message')).toBeHidden()

  await tid(panel, 'stop').click()
  const rec = await panel.evaluate(() =>
    chrome.runtime.sendMessage({
      cmd: 'recording',
      tabId: Number(new URLSearchParams(location.search).get('tabId')),
    }),
  )
  expect(rec.steps.map((s) => s.type)).toEqual(['search', 'check'])
  expect(rec.steps[1]).toMatchObject({
    control: { localId: 'searchField' },
    check: { kind: 'value', expected: 'Acme' },
  })
  expect(validateRecording(rec).ok).toBe(true)
  await demo.close() // (the next test looks for the first app tab)
  await panel.close()
})

test('a message toast can be checked: it is recorded after the step that shows it, tried, and kept in the plan', async () => {
  const token = await newToken('toast')
  const project = await newProject('Toast')
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'))
  await pair(panel, token)
  await expect(tid(panel, 'connection')).toContainText('Connected')
  await tid(panel, 'project').selectOption(project.ID)
  await tid(panel, 'tab-tests').click()

  // the toast is gone after three seconds and cannot be pointed at: the next one becomes a check
  await expect(tid(panel, 'add-toast-check')).toBeHidden()
  await tid(panel, 'start').click()
  await recording(demo)
  await expect(tid(panel, 'add-toast-check')).toBeVisible()
  await tid(panel, 'add-toast-check').click()
  await expect(tid(panel, 'rec-message')).toContainText('next message toast')
  await flow(demo) // ... ends with Save, which shows "Order saved"
  await expect(tid(panel, 'steps')).toContainText('Check the message shown')
  await expect(tid(panel, 'steps')).toContainText('“Order saved”')
  // after the press of Save that caused it
  const steps = await tid(panel, 'step').allInnerTexts()
  const save = steps.findIndex((t) => t.includes('Press Save'))
  expect(save).toBeGreaterThanOrEqual(0)
  expect(steps.findIndex((t) => t.includes('Check the message shown'))).toBeGreaterThan(save)
  // only the next one: a second Save would not add a second check
  await expect(tid(panel, 'step').filter({ hasText: 'Check the message shown' })).toHaveCount(1)
  await tid(panel, 'stop').click()

  // tried: the replay waits for the toast and finds it
  await demo.bringToFront()
  await tid(panel, 'try').click()
  await expect(tid(panel, 'try-message')).toContainText('passed', { timeout: 90_000 })
  await expect(tid(panel, 'try-message')).not.toContainText('failed')
  await expect(tid(panel, 'try-results')).toContainText('A message shows "Order saved"')

  // sent: the plan has a check without a control, and the test waits for the toast
  await tid(panel, 'send').click()
  await expect(tid(panel, 'send-message')).toContainText('Sent.')
  const recordings = (
    await (await fetch(`${API}/Recordings?$filter=project_ID eq ${project.ID}`)).json()
  ).value
  const plan = await post('createTestPlan', {
    projectID: project.ID,
    recordingID: recordings[0].ID,
    name: 'Toast',
  })
  const step = JSON.parse(plan.definition).steps.find((s) => s.assertion?.type === 'toast')
  expect(step).toMatchObject({ locator: null, assertion: { expected: 'Order saved' } })
  await demo.close()
  await panel.close()
})
