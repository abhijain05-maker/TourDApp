import { test, expect } from '@playwright/test'
import { loadSources } from '../helpers/sources.js'
import { makeTour, openTour, tid, field, docOf } from '../helpers/e2e-tour.js'

// The sandbox preview (Phase 7a): the tour plays in a sandboxed copy of the app inside the designer.

const frameOf = (page) => page.frameLocator('[data-testid="sandbox-frame"]')
const bubbleTitle = (page) => frameOf(page).locator('.tourd-title')
const selectStep = (page, n) => tid(page, 'step-item').nth(n).click()
const openSandbox = async (page) => {
  await page.getByRole('tab', { name: 'Sandbox' }).click()
  await expect(tid(page, 'sandbox')).toBeVisible()
}
// UI5 comes from the CDN and the first start of the sandbox takes a few seconds
const started = (page) => expect(bubbleTitle(page)).toHaveText(/./, { timeout: 45_000 })

test('plays the tour in a sandboxed copy of the app, with sample data', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Sandbox')
  await openTour(page, tourID)
  await openSandbox(page)

  await started(page)
  await expect(bubbleTitle(page)).toHaveText('Create an order')
  await expect(frameOf(page).locator('.tourd-progress')).toHaveText('Step 1 of 7')
  // the app behind the tour is the uploaded one, filled with generated rows
  await expect(frameOf(page).locator('[data-sap-ui$="--createBtn"]')).toBeVisible()
  await expect(frameOf(page).locator('[id$="ordersTable"] tbody tr')).toHaveCount(4)
  await expect(frameOf(page).getByText('Acme Corp')).toBeVisible()
  await expect(tid(page, 'sandbox-loading')).toHaveCount(0)
  await expect(tid(page, 'sandbox')).toContainText('UI5 1.120')
})

test('the frame has no access to the designer (no same-origin)', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Sandbox isolation')
  await openTour(page, tourID)
  await openSandbox(page)
  await started(page)

  await expect(tid(page, 'sandbox-frame')).toHaveAttribute('sandbox', 'allow-scripts')
  const frame = page.frames().find((f) => f.url().includes('/preview/'))
  const probe = await frame.evaluate(() => {
    let parentDocument = 'reachable'
    try {
      parentDocument = typeof window.parent.document.title
    } catch (e) {
      parentDocument = e.name
    }
    let storage = 'reachable'
    try {
      storage = typeof localStorage.length
    } catch (e) {
      storage = e.name
    }
    return { origin: window.origin, parentDocument, storage }
  })
  expect(probe.origin).toBe('null')
  expect(probe.parentDocument).toBe('SecurityError')
  expect(probe.storage).toBe('SecurityError')
})

test('the selected step and the step in the frame follow each other', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Sandbox sync')
  await openTour(page, tourID)
  await openSandbox(page)
  await started(page)

  // editor -> sandbox
  await selectStep(page, 2)
  await expect(bubbleTitle(page)).toHaveText('Press Create')
  await expect(frameOf(page).locator('[data-sap-ui$="--createBtn"]')).toBeVisible()

  // sandbox -> editor, across a page change (the Create step leads to the detail page)
  await frameOf(page).locator('.tourd-btn--primary').click()
  await expect(bubbleTitle(page)).toHaveText('Customer')
  await expect(tid(page, 'step-item').nth(3)).toHaveAttribute('aria-current', 'step')
  await expect(field(page, 'step-title')).toHaveValue('Customer')
  await expect(frameOf(page).locator('[data-sap-ui$="--customerInput"]')).toBeVisible()
  await expect(frameOf(page).locator('.tourd-warn')).toHaveCount(0) // the control was found

  await frameOf(page).locator('.tourd-btn:not(.tourd-btn--primary)').click() // Back
  await expect(bubbleTitle(page)).toHaveText('Press Create')
  await expect(field(page, 'step-title')).toHaveValue('Press Create')
})

test('edits show up in the frame without a reload', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Sandbox edit')
  await openTour(page, tourID)
  await selectStep(page, 1)
  await openSandbox(page)
  await started(page)
  await expect(bubbleTitle(page)).toHaveText('Search')

  await field(page, 'step-title').fill('Find an order')
  await field(page, 'step-text').fill('Type a **customer** name.')
  await expect(bubbleTitle(page)).toHaveText('Find an order', { timeout: 10_000 })
  await expect(frameOf(page).locator('.tourd-body strong')).toHaveText('customer')
  await expect(frameOf(page).locator('.tourd-progress')).toHaveText('Step 2 of 7') // still on the same step
})

test('picks a control by clicking it in the app', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Sandbox pick')
  await openTour(page, tourID)
  await selectStep(page, 1) // Search
  await openSandbox(page)
  await started(page)

  await tid(page, 'sandbox-pick').click()
  await expect(tid(page, 'sandbox-picking')).toBeVisible()
  await frameOf(page).locator('[data-sap-ui$="--createBtn"]').click()
  await expect(tid(page, 'sandbox-picked')).toContainText('"createBtn" is now this step')
  await expect(tid(page, 'target-name')).toHaveText('Create')
  await expect(tid(page, 'sandbox-picking')).toHaveCount(0)
  await expect(tid(page, 'save-state')).toContainText('All changes saved', { timeout: 10_000 })
  const step = (await docOf(request, tourID)).steps[1]
  expect(step.target).toMatchObject({
    viewName: 'demo.orders.view.Main',
    controlId: 'createBtn',
    fallbacks: [{ by: 'text', value: 'Create' }],
  })

  // the click was only a pick: the app did not react to it, and the tour went on at the new target
  await expect(frameOf(page).locator('[data-sap-ui$="--createBtn"]')).toBeVisible()
  await expect(bubbleTitle(page)).toHaveText('Search')
})

test('a click inside a control picks the control around it that has an id, and Cancel leaves everything as it was', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Sandbox pick parent')
  await openTour(page, tourID)
  await selectStep(page, 1)
  await openSandbox(page)
  await started(page)

  await tid(page, 'sandbox-pick').click()
  await frameOf(page).getByText('Acme Corp').click() // a cell: no id of its own, the table has one
  await expect(tid(page, 'sandbox-picked')).toContainText('"ordersTable"')
  await expect(tid(page, 'sandbox-picked')).toContainText('inside a')

  await selectStep(page, 4)
  await tid(page, 'sandbox-pick').click()
  await expect(tid(page, 'sandbox-pick')).toContainText('Cancel picking')
  await tid(page, 'sandbox-pick').click()
  await expect(tid(page, 'sandbox-picking')).toHaveCount(0)
  await expect(tid(page, 'sandbox-pick')).toContainText('Pick control')
})

test('can open any page of the app', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Sandbox pages')
  await openTour(page, tourID)
  await openSandbox(page)
  await started(page)

  await tid(page, 'sandbox-page').click()
  await page.getByRole('option', { name: 'detail' }).click()
  await expect(frameOf(page).locator('[data-sap-ui$="--customerInput"]')).toBeVisible({
    timeout: 15_000,
  })
})

test('does not play a tour that has problems, and says so', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Sandbox invalid')
  await openTour(page, tourID)
  await openSandbox(page)
  await started(page)

  await selectStep(page, 1)
  await field(page, 'step-title').fill('')
  await expect(tid(page, 'sandbox-invalid')).toBeVisible()
  await expect(tid(page, 'sandbox-restart')).toHaveAttribute('disabled', '')
  await field(page, 'step-title').fill('Search again')
  await expect(tid(page, 'sandbox-invalid')).toHaveCount(0)
})

test('runs on another UI5 version', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Sandbox version')
  await openTour(page, tourID)
  await openSandbox(page)
  await started(page)

  await tid(page, 'sandbox-ui5').click()
  await page.getByRole('option', { name: 'UI5 1.148' }).click()
  await expect(tid(page, 'sandbox')).toContainText('UI5 1.148', { timeout: 45_000 })
  await expect(bubbleTitle(page)).toHaveText('Create an order', { timeout: 45_000 })
  await expect(frameOf(page).locator('[data-sap-ui$="--createBtn"]')).toBeVisible()
})

test('stub controllers by default; the uploaded ones only when asked, with a warning', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Sandbox controllers')
  await openTour(page, tourID)
  await openSandbox(page)
  await started(page)
  await expect(tid(page, 'sandbox-real-warning')).toHaveCount(0)

  // the uploaded Export handler shows a message toast; the stub does nothing
  await frameOf(page).locator('.tourd-close').click()
  await frameOf(page).getByRole('button', { name: 'Export' }).click()
  await page.waitForTimeout(500)
  await expect(frameOf(page).getByText('Export is not implemented')).toHaveCount(0)

  await tid(page, 'sandbox-real').click()
  await expect(tid(page, 'sandbox-real-warning')).toBeVisible()
  await expect(tid(page, 'sandbox-frame')).toHaveAttribute('src', /controllers=real/)
  await expect(frameOf(page).locator('[data-sap-ui$="--createBtn"]')).toBeVisible({
    timeout: 45_000,
  })
  await frameOf(page).locator('.tourd-close').click()
  await frameOf(page).getByRole('button', { name: 'Export' }).click()
  await expect(frameOf(page).getByText('Export is not implemented')).toBeVisible()
})

test('explains why there is no sandbox when the project has no manifest', async ({
  page,
  request,
}) => {
  const files = loadSources('samples/demo-app', 'samples/demo-app').filter(
    (f) => !f.path.endsWith('manifest.json'),
  )
  const { tourID } = await makeTour(request, 'Sandbox no manifest', { files })
  await openTour(page, tourID)
  await page.getByRole('tab', { name: 'Sandbox' }).click()
  await expect(tid(page, 'sandbox-unavailable')).toContainText('manifest.json')
})

test('has no serious accessibility violations in the sandbox frame and the live panel (and the scan can fail)', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Sandbox a11y')
  await openTour(page, tourID)
  await openSandbox(page)
  await started(page)
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  const scan = (selector) =>
    new AxeBuilder({ page }).include(selector).disableRules(['color-contrast']).analyze()
  const serious = (r) =>
    r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)

  const frame = await scan('[data-testid="sandbox-frame"]')
  expect(serious(frame)).toEqual([])
  expect(frame.passes.reduce((n, p) => n + p.nodes.length, 0)).toBeGreaterThan(0)
  await page.evaluate(() =>
    document.querySelector('[data-testid="sandbox-frame"]').removeAttribute('title'),
  )
  expect(serious(await scan('[data-testid="sandbox-frame"]'))).toContain('frame-title')

  await page.getByRole('tab', { name: 'Live' }).click()
  await expect(tid(page, 'live-panel')).toBeVisible()
  const live = await scan('[data-testid="live-panel"]')
  expect(serious(live)).toEqual([])
  expect(live.passes.reduce((n, p) => n + p.nodes.length, 0)).toBeGreaterThan(3)
})

test('says so when UI5 cannot be loaded (offline), and recovers on reload', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Sandbox offline')
  await openTour(page, tourID)
  await page.route('**/ui5.sap.com/**', (route) => route.abort())
  await openSandbox(page)

  await expect(tid(page, 'sandbox-message')).toContainText('could not be loaded from ui5.sap.com', {
    timeout: 20_000,
  })
  await expect(tid(page, 'sandbox-loading')).toHaveCount(0)
  await expect(frameOf(page).locator('#tourd-status')).toContainText('Are you offline?')

  await page.unroute('**/ui5.sap.com/**')
  await tid(page, 'sandbox-reload').click()
  await started(page)
  await expect(tid(page, 'sandbox-message')).toHaveCount(0)
})
