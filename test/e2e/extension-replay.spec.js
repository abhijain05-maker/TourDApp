import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, test, expect } from '@playwright/test'
import { loadSources } from '../helpers/sources.js'

// Phase 8: a test plan replayed in the app that is open, through the browser extension (UI5's own record/replay API).

const EXTENSION = resolve('extension')
const TOURD = process.env.TOURD_URL ?? 'http://localhost:4044'
const API = `${TOURD}/odata/v4/tour`
const DEMO = 'http://localhost:8081/index.html'
const SOURCES = loadSources('samples/demo-app', 'samples/demo-app')
const RECORDING = readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')

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
  userData = mkdtempSync(join(tmpdir(), 'tourd-ext-replay-'))
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

async function openDemo() {
  const page = await context.newPage()
  await page.goto(`${DEMO}?ui5=1.120`)
  await expect(page.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  return page
}

const tabIdOf = (part) =>
  worker.evaluate(
    async (p) => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes(p))?.id,
    part,
  )

/** Other specs create projects at the same time: pick the one of this test, not "the newest". */
async function chooseProject(panel, project) {
  await tid(panel, 'project').selectOption(project.ID)
  await tid(panel, 'tab-tests').click() // the tests are on their own tab
}

async function openPanel(forTabId, token) {
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${forTabId}`)
  await panel.locator('body[data-ready="true"]').waitFor()
  if (await tid(panel, 'settings').isHidden()) await tid(panel, 'open-settings').click()
  await tid(panel, 'tourd-url').fill(TOURD)
  await tid(panel, 'tourd-token').fill(token)
  await tid(panel, 'save-settings').click()
  await expect(tid(panel, 'connection')).toContainText('Connected')
  return panel
}

async function projectWithPlan(name, edit = () => {}) {
  const project = await post('Projects', { name: `${name} ${Date.now()}` })
  await post('importSources', { projectID: project.ID, files: SOURCES, replace: true })
  const rec = await post('importRecording', {
    projectID: project.ID,
    name: 'Create an order',
    raw: RECORDING,
  })
  const plan = await post('createTestPlan', {
    projectID: project.ID,
    recordingID: rec.ID,
    name: 'Create an order',
  })
  const doc = JSON.parse(plan.definition)
  edit(doc)
  await post('saveTestPlan', { planID: plan.ID, definition: JSON.stringify(doc), baseVersion: 1 })
  return project
}

test('replays the tests of a project in the open app: every step passes and the app really did it', async () => {
  const token = (await post('createExtensionToken', { name: 'replay' })).token
  const project = await projectWithPlan('Replay')
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'), token)
  await chooseProject(panel, project)

  await expect(tid(panel, 'replay-plan').locator('option')).toHaveCount(1)
  await demo.bringToFront()
  await tid(panel, 'replay').click()
  await expect(tid(panel, 'replay-message')).not.toBeEmpty({ timeout: 90_000 })
  await expect(tid(panel, 'replay-message')).toContainText('All 11 steps passed')
  await expect(tid(panel, 'replay-step')).toHaveCount(11)
  await expect(tid(panel, 'replay-results')).toContainText('The page is "#/order/new"')
  await expect(tid(panel, 'replay-step').first()).toHaveAttribute('data-status', 'passed')

  // the app was driven for real: the order is in the list and we are back on the start page
  await expect(demo.locator('[data-sap-ui$="--ordersTable"]')).toContainText('Acme Corp')
  expect(await demo.evaluate(() => location.hash)).toMatch(/^#?\/?$/)
})

test('says which step failed and why, and does not run the rest', async () => {
  const token = (await post('createExtensionToken', { name: 'replay-fail' })).token
  const project = await projectWithPlan('Replay failing', (doc) => {
    doc.locators.customerInput.selector.id = 'customerInputRenamed'
  })
  const demo = await openDemo()
  const panel = await openPanel(await tabIdOf('8081'), token)
  await chooseProject(panel, project)
  await expect(tid(panel, 'replay-plan').locator('option')).toHaveCount(1)

  await demo.bringToFront()
  await tid(panel, 'replay').click()
  await expect(tid(panel, 'replay-message')).toContainText('failed', { timeout: 90_000 })
  const failed = tid(panel, 'replay-step').and(panel.locator('[data-status="failed"]'))
  await expect(failed).toHaveCount(1)
  await expect(failed).toContainText('customerInputRenamed')
  await expect(
    tid(panel, 'replay-step').and(panel.locator('[data-status="not-run"]')).first(),
  ).toContainText('an earlier step failed')
  // what ran before the failure did run
  await expect(tid(panel, 'replay-step').first()).toHaveAttribute('data-status', 'passed')
})

test('a page without UI5 says so', async () => {
  const token = (await post('createExtensionToken', { name: 'replay-none' })).token
  const project = await projectWithPlan('Replay no ui5')
  const plain = await context.newPage()
  await plain.goto(`${TOURD}/designer/`) // a page without sap.ui
  const panel = await openPanel(await tabIdOf(`${new URL(TOURD).port}/designer`), token)
  await chooseProject(panel, project)
  await expect(tid(panel, 'replay-plan').locator('option')).toHaveCount(1)
  await tid(panel, 'replay').click()
  await expect(tid(panel, 'replay-message')).toContainText('does not use UI5')
})
