import { test, expect } from '@playwright/test'
import { makeTour, openTour, tid, field } from '../helpers/e2e-tour.js'

// The live preview (Phase 7b): the tour is played inside the real, running app through a console snippet.

const DEMO = 'http://localhost:8081/index.html'

const openLive = async (page) => {
  await page.getByRole('tab', { name: 'Live' }).click()
  await expect(tid(page, 'live-panel')).toBeVisible()
}
const textOf = (page, id) => tid(page, id).evaluate((el) => el.value)

/** The running app (not the sandbox): the demo app on its own server. */
async function openDemo(context, ui5 = '1.120') {
  const demo = await context.newPage()
  await demo.goto(`${DEMO}?ui5=${ui5}`)
  await expect(demo.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  return demo
}

/** Runs a snippet like a user does in the console, then walks the first steps. */
async function expectTourRuns(demo) {
  await expect(demo.locator('.tourd-title')).toHaveText('Create an order', { timeout: 15_000 })
  await expect(demo.locator('.tourd-progress')).toHaveText('Step 1 of 7')
  await demo.locator('.tourd-btn--primary').click()
  await expect(demo.locator('.tourd-title')).toHaveText('Search')
  await demo.locator('.tourd-btn--primary').click()
  await expect(demo.locator('.tourd-title')).toHaveText('Press Create')
  await demo.locator('.tourd-btn--primary').click() // leads to the detail page
  await expect(demo.locator('.tourd-title')).toHaveText('Customer')
  await expect(demo.locator('[data-sap-ui$="--customerInput"]')).toBeVisible()
  await expect(demo.locator('.tourd-warn')).toHaveCount(0)
}

test('shows the snippet, copies it, and the bookmarklet carries the tour', async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { tourID, doc } = await makeTour(request, 'Live copy')
  await openTour(page, tourID)
  await openLive(page)

  const snippet = await textOf(page, 'live-snippet')
  expect(snippet).toContain('sap.ui.predefine("tourd/live/TourPlayer"')
  expect(snippet).toContain('"Create an order"')
  await tid(page, 'live-copy').click()
  await expect(tid(page, 'live-copy-done')).toBeVisible()
  // the Windows clipboard turns line feeds into CR LF
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.split('\r\n').join('\n')).toBe(snippet)

  const href = await tid(page, 'live-bookmarklet').getAttribute('href')
  expect(href.startsWith('javascript:')).toBe(true)
  expect(decodeURIComponent(href.slice('javascript:'.length))).toBe(snippet)
  expect(await tid(page, 'live-bookmarklet').textContent()).toContain(doc.title)
})

test('the snippet reflects unsaved edits', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Live edits')
  await openTour(page, tourID)
  await tid(page, 'step-item').nth(1).click()
  await field(page, 'step-title').fill('Look for an order')
  await openLive(page)
  expect(await textOf(page, 'live-snippet')).toContain('Look for an order')
})

for (const ui5 of ['1.120', 'latest']) {
  test(`the pasted snippet plays the tour inside the running app (UI5 ${ui5})`, async ({
    page,
    context,
    request,
  }) => {
    const { tourID } = await makeTour(request, 'Live inline')
    await openTour(page, tourID)
    await openLive(page)
    const snippet = await textOf(page, 'live-snippet')

    const demo = await openDemo(context, ui5)
    await demo.evaluate(snippet)
    await expectTourRuns(demo)
    await demo.close()
  })
}

test('the loader snippet fetches player and saved tour from TourD', async ({
  page,
  context,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Live loader')
  await openTour(page, tourID)
  await openLive(page)
  const loader = await textOf(page, 'live-loader')
  expect(loader).toContain(tourID)
  expect(loader).toContain('/tour.json')

  const demo = await openDemo(context) // another origin than TourD: the routes allow it
  await demo.evaluate(loader)
  await expectTourRuns(demo)
  await demo.close()
})

test('running the snippet again replaces the tour that is showing', async ({
  page,
  context,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Live twice')
  await openTour(page, tourID)
  await openLive(page)
  const snippet = await textOf(page, 'live-snippet')

  const demo = await openDemo(context)
  await demo.evaluate(snippet)
  await expect(demo.locator('.tourd-title')).toHaveText('Create an order')
  await demo.evaluate(snippet)
  await expect(demo.locator('.tourd-bubble')).toHaveCount(1)
  await demo.close()
})

test('a page that is not a UI5 app gets a clear message instead of an error', async ({
  page,
  context,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Live no ui5')
  await openTour(page, tourID)
  await openLive(page)
  const snippet = await textOf(page, 'live-snippet')

  const other = await context.newPage()
  await other.goto('http://localhost:4044/odata/v4/tour/$metadata')
  const messages = []
  other.on('dialog', async (d) => {
    messages.push(d.message())
    await d.dismiss()
  })
  await other.evaluate(snippet)
  expect(messages.join()).toContain('does not look like a UI5 app')
  await other.close()
})

test('no snippet while the tour has problems', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Live invalid')
  await openTour(page, tourID)
  await tid(page, 'step-item').nth(1).click()
  await field(page, 'step-title').fill('')
  await openLive(page)
  await expect(tid(page, 'live-invalid')).toBeVisible()
  await expect(tid(page, 'live-copy')).toHaveAttribute('disabled', '')
  expect(await textOf(page, 'live-snippet')).toBe('')
})

test('a step retargeted by clicking in the sandbox points at that control in the running app too', async ({
  page,
  context,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Sandbox to live')
  await openTour(page, tourID)
  await tid(page, 'step-item').nth(1).click() // "Search"
  await page.getByRole('tab', { name: 'Sandbox' }).click()
  await expect(
    page.frameLocator('[data-testid="sandbox-frame"]').locator('.tourd-title'),
  ).toHaveText('Search', {
    timeout: 45_000,
  })
  await tid(page, 'sandbox-pick').click()
  await page
    .frameLocator('[data-testid="sandbox-frame"]')
    .locator('[data-sap-ui$="--createBtn"]')
    .click()
  await expect(tid(page, 'target-name')).toHaveText('Create')

  await openLive(page)
  const snippet = await textOf(page, 'live-snippet')
  const demo = await openDemo(context)
  await demo.evaluate(snippet)
  await expect(demo.locator('.tourd-title')).toHaveText('Create an order')
  await demo.locator('.tourd-btn--primary').click()
  await expect(demo.locator('.tourd-title')).toHaveText('Search')
  const [spot, button] = await Promise.all([
    demo.locator('.tourd-spot').boundingBox(),
    demo.locator('[data-sap-ui$="--createBtn"]').boundingBox(),
  ])
  expect(Math.abs(spot.x + spot.width / 2 - (button.x + button.width / 2))).toBeLessThan(2)
  expect(Math.abs(spot.y + spot.height / 2 - (button.y + button.height / 2))).toBeLessThan(2)
  await demo.close()
})
