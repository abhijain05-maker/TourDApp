import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, test, expect } from '@playwright/test'
import { loadSources } from '../helpers/sources.js'

// Writing help through the browser extension (Phase 11): point at a control of the demo app, type the text, see the
// help in the app as a preview (help panel, "?" badge, popover), save it in TourD.

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
  userData = mkdtempSync(join(tmpdir(), 'tourd-help-'))
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

const tid = (page, id) => page.locator(`[data-testid="${id}"]`)

test('writes a help topic for a control through the panel, previews it in the app and saves it', async () => {
  const { token } = await post('createExtensionToken', { name: 'help e2e' })
  const project = await post('Projects', { name: `Help ${Date.now()}` })
  await post('importSources', { projectID: project.ID, files: SOURCES, replace: true })

  const demo = await context.newPage()
  await demo.goto(`${DEMO}?ui5=1.120`)
  await expect(demo.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((t) => t.url && t.url.includes('8081'))?.id
  })

  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`)
  await panel.locator('body[data-ready="true"]').waitFor()
  if (await tid(panel, 'settings').isHidden()) await tid(panel, 'open-settings').click()
  await tid(panel, 'tourd-url').fill(TOURD)
  await tid(panel, 'tourd-token').fill(token)
  await tid(panel, 'save-settings').click()
  await expect(tid(panel, 'connection')).toContainText('Connected')

  // start: the help panel of the app is shown (empty so far)
  await tid(panel, 'help-project').selectOption(project.ID)
  await tid(panel, 'help-start').click()
  await expect(tid(panel, 'help-work')).toBeVisible()
  await demo.bringToFront()
  await expect(demo.locator('.tourd-help-panel')).toBeVisible({ timeout: 30_000 })
  await expect(demo.locator('.tourd-help-panel')).toContainText(
    'There is no help for this screen yet',
  )

  // point at the Create button: nothing is pressed, the panel offers the form
  await panel.bringToFront()
  await tid(panel, 'help-pick').click()
  // the panel says so once the picker is armed in the app; a click before that would press the button
  await expect(tid(panel, 'help-message')).toContainText('Click the control in the app')
  await demo.bringToFront()
  await demo.locator('[data-sap-ui$="--createBtn"]').click()
  await expect(tid(panel, 'help-form')).toBeVisible()
  await expect(tid(panel, 'help-control')).toContainText('Button')
  await expect(demo.locator('[data-sap-ui$="--ordersTable"]')).toBeVisible() // still on the list page
  expect(await demo.evaluate(() => location.hash)).not.toContain('detail')

  // clearing the title to type one's own must not take the highlight off the control
  await tid(panel, 'help-title').fill('')
  await expect(demo.locator('.tourd-help-pop')).toContainText('New topic')
  await expect(demo.locator('.tourd-help-badge')).toHaveCount(1)
  await expect(demo.locator('.tourd-help-spot')).toBeVisible()

  // "Write with AI" (no AI configured here: the simple draft), seen in the app at once, and undone again
  await tid(panel, 'help-provider').selectOption('rules')
  await tid(panel, 'help-ai').click()
  await expect(tid(panel, 'help-text')).toHaveValue('Choose **Create** to run this action.')
  await expect(tid(panel, 'help-title')).toHaveValue('Create')
  await expect(demo.locator('.tourd-help-pop')).toContainText('to run this action', {
    timeout: 15_000,
  })
  await tid(panel, 'help-undo').click()
  await expect(tid(panel, 'help-text')).toHaveValue('')

  // type: the app shows the help while typing
  await tid(panel, 'help-title').fill('Create Order')
  await tid(panel, 'help-summary').fill('Create a new order.')
  await tid(panel, 'help-text').fill('Press **Create** to open the order form.')
  await tid(panel, 'help-note').fill('You need the Sales role.')
  await tid(panel, 'help-links').fill('Orders guide | https://example.com/orders')
  const pop = demo.locator('.tourd-help-pop')
  await expect(pop).toBeVisible({ timeout: 15_000 })
  await expect(pop).toContainText('Create Order')
  await expect(pop.locator('strong')).toHaveText('Create')
  await expect(pop.locator('.tourd-help-note')).toContainText('You need the Sales role.')
  await expect(pop.locator('a[href="https://example.com/orders"]')).toHaveText('Orders guide')
  await expect(demo.locator('.tourd-help-badge')).toHaveCount(1)
  await expect(demo.locator('.tourd-help-panel .tourd-help-item')).toContainText(
    'Create a new order.',
  )

  // save
  await tid(panel, 'help-save').click()
  await expect(tid(panel, 'help-message')).toContainText('Saved')
  await expect(tid(panel, 'help-topic')).toHaveCount(1)
  const sets = (await (await fetch(`${API}/HelpSets?$filter=project_ID eq ${project.ID}`)).json())
    .value
  expect(sets).toHaveLength(1)
  const doc = JSON.parse(sets[0].definition)
  expect(doc.topics[0]).toMatchObject({
    title: 'Create Order',
    note: 'You need the Sales role.',
    target: { viewName: expect.stringContaining('Main'), controlId: 'createBtn' },
    links: [{ label: 'Orders guide', url: 'https://example.com/orders' }],
  })

  // what the author sees is what the end user gets: the same help.json shown by the layer
  await demo.bringToFront()
  await demo.locator('.tourd-help-pop .tourd-help-x').click()
  await expect(pop).toBeHidden()
  await demo.locator('.tourd-help-panel .tourd-help-item').hover()
  await expect(demo.locator('.tourd-help-line line')).toHaveCount(1)
  await demo.locator('.tourd-help-badge').click()
  await expect(pop).toBeVisible()

  // a second topic, edited later
  await tid(panel, 'help-topic').first().click()
  await tid(panel, 'help-title').fill('Create an order')
  await tid(panel, 'help-save').click()
  await expect(tid(panel, 'help-message')).toContainText('version')
  const again = (await (await fetch(`${API}/HelpSets?$filter=project_ID eq ${project.ID}`)).json())
    .value
  expect(JSON.parse(again[0].definition).topics).toHaveLength(1)
  expect(JSON.parse(again[0].definition).topics[0].title).toBe('Create an order')

  // the next topic: pointing again starts a new one and leaves the saved topic alone
  const waiting = demo.getByText('Click the control the help is about')
  await tid(panel, 'help-pick').click()
  await expect(tid(panel, 'help-title')).toHaveValue('')
  await expect(tid(panel, 'help-form')).toBeHidden() // nothing to write until a control is chosen
  await expect(tid(panel, 'help-pick')).toContainText('Cancel pointing')
  await expect(waiting).toBeVisible() // the app says it is waiting for a click
  // give up with the button, and with Esc in the panel (the focus is there after a click on the button)
  await tid(panel, 'help-pick').click()
  await expect(tid(panel, 'help-pick')).toContainText('Point at a control')
  await expect(waiting).toHaveCount(0)
  await tid(panel, 'help-pick').click()
  await expect(waiting).toBeVisible()
  await panel.bringToFront() // (a real user has just clicked in the panel: the focus is there)
  await panel.keyboard.press('Escape')
  await expect(tid(panel, 'help-pick')).toContainText('Point at a control')
  await expect(waiting).toHaveCount(0)
  // and now pick the search field
  await tid(panel, 'help-pick').click()
  await expect(waiting).toBeVisible()
  await demo.bringToFront()
  await demo.locator('[data-sap-ui$="--searchField"]').click()
  await expect(tid(panel, 'help-control')).toContainText('SearchField')
  await expect(waiting).toHaveCount(0)
  await tid(panel, 'help-title').fill('Search orders')
  await tid(panel, 'help-text').fill('Type a customer name.')
  await tid(panel, 'help-save').click()
  await expect(tid(panel, 'help-topic')).toHaveCount(2)
  const two = JSON.parse(
    (await (await fetch(`${API}/HelpSets?$filter=project_ID eq ${project.ID}`)).json()).value[0]
      .definition,
  )
  expect(two.topics.map((t) => [t.title, t.target.controlId])).toEqual([
    ['Create an order', 'createBtn'],
    ['Search orders', 'searchField'],
  ])

  // point at another control for a saved topic without losing its words
  await tid(panel, 'help-topic').first().click()
  await tid(panel, 'help-repoint').click()
  await expect(tid(panel, 'help-pick')).toContainText('Cancel pointing')
  await tid(panel, 'help-repoint').click()
  await expect(tid(panel, 'help-pick')).toContainText('Point at a control')
  await expect(tid(panel, 'help-title')).toHaveValue('Create an order')

  // done: the help is gone from the app, the pick is not left behind
  await tid(panel, 'help-stop').click()
  await expect(demo.locator('.tourd-help')).toHaveCount(0)
})

test('says to reload the tab when it still has the help layer of an older extension, and works after the reload', async () => {
  const { token } = await post('createExtensionToken', { name: 'help stale' })
  const project = await post('Projects', { name: `Stale ${Date.now()}` })
  const leftovers = context.pages() // the pages of the test before: its demo tab would be found by its address
  const demo = await context.newPage()
  await Promise.all(leftovers.map((p) => p.close()))
  await demo.goto(`${DEMO}?ui5=1.120`)
  await expect(demo.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({})
    return tabs.find((t) => t.url && t.url.includes('8081'))?.id
  })
  // what an update of the extension leaves behind in a tab that was not reloaded
  await demo.evaluate(
    () =>
      new Promise((resolve) => {
        sap.ui.predefine('tourd/live/HelpLayer', [], () => ({
          version: '0.0.1',
          update: () => Promise.resolve(),
          openTopic: () => Promise.resolve(),
          stop() {},
        }))
        sap.ui.require(['tourd/live/HelpLayer'], resolve)
      }),
  )
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/panel.html?tabId=${tabId}`)
  await panel.locator('body[data-ready="true"]').waitFor()
  await worker.evaluate(() => chrome.storage.session.clear())
  if (await tid(panel, 'settings').isHidden()) await tid(panel, 'open-settings').click()
  await tid(panel, 'tourd-url').fill(TOURD)
  await tid(panel, 'tourd-token').fill(token)
  await tid(panel, 'save-settings').click()
  await expect(tid(panel, 'connection')).toContainText('Connected')
  await tid(panel, 'help-project').selectOption(project.ID)
  await tid(panel, 'help-start').click()
  await expect(tid(panel, 'help-message')).toContainText('older version of the extension')
  await expect(demo.locator('.tourd-help')).toHaveCount(0)

  // after the reload the page gets the current layer by itself
  await demo.reload()
  await expect(demo.locator('.tourd-help-panel')).toBeVisible({ timeout: 45_000 })
})
