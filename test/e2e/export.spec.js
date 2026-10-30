import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { API, docOf, makeTour, openTour, tid } from '../helpers/e2e-tour.js'
import { bundleOf, withApp } from '../helpers/plain-app.js'

// The export bundle (Phase 8): what TourD hands over must work in an app that has nothing of it yet,
// using only what the README says.

for (const ui5 of ['1.120', 'latest']) {
  test(`the exported bundle plays the whole tour in an app that had nothing of it (UI5 ${ui5})`, async ({
    page,
    request,
  }) => {
    const { tourID, doc } = await makeTour(request, 'Export run')
    const files = await bundleOf(request, tourID)
    await withApp(files, {}, async (url) => {
      await page.goto(`${url}/index.html?ui5=${ui5}`)
      await page.evaluate(() => {
        window.__events = []
        for (const t of ['started', 'stepChanged', 'completed', 'skipped', 'error'])
          window.addEventListener(`tourd:${t}`, (e) => window.__events.push([t, e.detail?.index]))
      })
      await expect(page.locator('[data-sap-ui$="--startTourBtn"]')).toBeVisible({ timeout: 45_000 })
      await page.locator('[data-sap-ui$="--startTourBtn"]').click()

      const titles = []
      for (let i = 0; i < doc.steps.length; i++) {
        await expect(page.locator('.tourd-progress')).toHaveText(
          `Step ${i + 1} of ${doc.steps.length}`,
        )
        titles.push(await page.locator('.tourd-title').textContent())
        await expect(page.locator('.tourd-warn')).toHaveCount(0) // every target was found
        await page.locator('.tourd-btn--primary').click()
      }
      expect(titles).toEqual(doc.steps.map((s) => s.title))
      await expect(page.locator('.tourd-bubble')).toHaveCount(0)
      const events = await page.evaluate(() => window.__events)
      expect(events.filter(([t]) => t === 'completed')).toHaveLength(1)
      expect(events.filter(([t]) => t === 'error')).toEqual([])
    })
  })
}

test('the auto-start snippet shows the tour once per browser', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Export auto')
  const files = await bundleOf(request, tourID)
  await withApp(files, { autoStart: true }, async (url) => {
    await page.goto(`${url}/index.html`)
    await expect(page.locator('.tourd-title')).toHaveText('Create an order', { timeout: 45_000 })
    await page.locator('.tourd-close').click() // closing counts as seen
    await expect(page.locator('.tourd-bubble')).toHaveCount(0)

    await page.reload()
    await expect(page.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
    await page.waitForTimeout(2000)
    await expect(page.locator('.tourd-bubble')).toHaveCount(0)

    await page.evaluate(() => localStorage.clear()) // a browser that has not seen it
    await page.reload()
    await expect(page.locator('.tourd-title')).toHaveText('Create an order', { timeout: 15_000 })
  })
})

test('the export dialog downloads the bundle and copies tour.json', async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { tourID, doc } = await makeTour(request, 'Export dialog')
  await openTour(page, tourID)

  await tid(page, 'open-export').click()
  await expect(tid(page, 'export-ready')).toBeVisible()
  await expect(tid(page, 'export-dialog')).toContainText('create-an-order-tourd.zip')
  await expect(tid(page, 'export-files')).toContainText('tourd/TourPlayer.js')
  await expect(tid(page, 'export-force')).toHaveCount(0)

  const download = page.waitForEvent('download')
  await tid(page, 'export-download').click()
  const d = await download
  expect(d.suggestedFilename()).toBe('create-an-order-tourd.zip')
  const path = await d.path()
  const files = unzipSync(new Uint8Array(readFileSync(path)))
  expect(JSON.parse(strFromU8(files['tourd/tour.json']))).toEqual(await docOf(request, tourID))

  await tid(page, 'export-copy-json').click()
  await expect(tid(page, 'export-copied')).toBeVisible()
  const copied = (await page.evaluate(() => navigator.clipboard.readText()))
    .split('\r\n')
    .join('\n')
  expect(JSON.parse(copied).title).toBe(doc.title)
})

test('exports what is on screen: unsaved edits are saved first', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Export unsaved')
  await openTour(page, tourID)
  await tid(page, 'step-item').nth(1).click()
  await tid(page, 'step-title').locator('input').fill('Look it up')
  await tid(page, 'open-export').click() // right away, before the autosave
  await expect(tid(page, 'export-ready')).toBeVisible()
  const files = await bundleOf(request, tourID)
  expect(JSON.parse(strFromU8(files['tourd/tour.json'])).steps[1].title).toBe('Look it up')
})

test('a tour with problems is blocked: the problems are listed, jump to their step, and "download anyway" says so in the bundle', async ({
  page,
  request,
}) => {
  const { tourID, doc } = await makeTour(request, 'Export blocked')
  const broken = structuredClone(doc)
  broken.steps[2].target = { viewName: 'demo.orders.view.Main', controlId: 'ghost', fallbacks: [] }
  const saved = await request.post(`${API}/saveTour`, {
    data: { tourID, definition: JSON.stringify(broken), note: 'Broken on purpose' },
  })
  expect(saved.ok()).toBe(true)
  const refused = await request.get(`/export/${tourID}.zip`)
  expect(refused.status()).toBe(409)

  await openTour(page, tourID)
  await tid(page, 'open-export').click()
  await expect(tid(page, 'export-blocked')).toBeVisible()
  await expect(tid(page, 'export-blocking')).toHaveCount(1)
  await expect(tid(page, 'export-blocking')).toContainText('ghost')
  await expect(tid(page, 'export-download')).toHaveAttribute('disabled', '')

  const download = page.waitForEvent('download')
  await tid(page, 'export-force').click()
  const files = unzipSync(new Uint8Array(readFileSync(await (await download).path())))
  expect(strFromU8(files['PROBLEMS.txt'])).toContain('ghost')

  await tid(page, 'export-blocking').click()
  await expect(tid(page, 'step-item').nth(2)).toHaveAttribute('aria-current', 'step') // jumped to the step
  await expect(tid(page, 'export-dialog')).not.toBeVisible()
})

test('sanity: without the manifest step of the README the tour cannot start (the test can fail)', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request, 'Export sanity')
  const files = await bundleOf(request, tourID)
  await withApp(files, { skipManifest: true }, async (url) => {
    await page.goto(`${url}/index.html`)
    await expect(page.locator('[data-sap-ui$="--startTourBtn"]')).toBeVisible({ timeout: 45_000 })
    await page.locator('[data-sap-ui$="--startTourBtn"]').click()
    await page.waitForTimeout(1500)
    await expect(page.locator('.tourd-bubble')).toHaveCount(0)
  })
})
