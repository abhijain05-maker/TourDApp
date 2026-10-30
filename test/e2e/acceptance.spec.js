import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { unzipSync } from 'fflate'
import { tid, field } from '../helpers/e2e-tour.js'
import { withApp } from '../helpers/plain-app.js'

// The acceptance run (Phase 9): what a person does, from nothing to a tour playing in their app - only through
// the designer's screens (the one exception is the downloaded zip, which is applied to the app by the test
// the way the README tells a person to).

const DEVTOOLS = readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')
const liveRegion = (page) => page.locator('[id^="DndLiveRegion"]')
const frame = (page) => page.frameLocator('[data-testid="sandbox-frame"]')

test('from the files of an app to a tour that plays in that app', async ({ page }) => {
  const name = `Acceptance ${Date.now()}`

  await test.step('create a project and give it the app', async () => {
    await page.goto('/designer/')
    await tid(page, 'new-project').click()
    await field(page, 'project-name').fill(name)
    await tid(page, 'create-project').click()
    await expect(tid(page, 'project-title')).toHaveText(name)
    await tid(page, 'input-folder').setInputFiles('samples/demo-app')
    await expect(tid(page, 'import-result')).toContainText('Imported 17 file(s) of demo.orders')
    await expect(tid(page, 'inventory-summary')).toContainText('3 views')
  })

  await test.step('import the recording of the flow', async () => {
    await page.getByRole('tab', { name: 'Recordings' }).click()
    await field(page, 'rec-name').fill('Create an order')
    await field(page, 'rec-raw').fill(DEVTOOLS)
    await tid(page, 'rec-import').click()
    await expect(tid(page, 'rec-result')).toContainText('6 of 6 matched')
  })

  await test.step('generate the tour (rule-based: no AI and no key needed)', async () => {
    await page.getByRole('tab', { name: 'Tours' }).click()
    await tid(page, 'generate-tour').click()
    await tid(page, 'generate-start').click()
    await expect(page).toHaveURL(/#\/tours\//, { timeout: 20_000 })
    await expect(tid(page, 'step-item')).toHaveCount(7)
  })

  let order
  await test.step('reorder and reword in the editor', async () => {
    // Search and Press Create swap places (both are on the first page, so the tour still makes sense)
    const grip = tid(page, 'step-grip').nth(1)
    await grip.focus()
    await page.keyboard.press('Space')
    await expect(liveRegion(page)).toContainText('moved over droppable area s1')
    await page.keyboard.press('ArrowDown')
    await expect(liveRegion(page)).toContainText('moved over droppable area s2')
    await page.keyboard.press('Space')
    await expect(liveRegion(page)).toContainText('dropped over')

    await tid(page, 'step-item').nth(0).click()
    await field(page, 'step-title').fill('Welcome to your orders')
    await field(page, 'step-text').fill('This tour shows how to **create an order**.')
    await expect(tid(page, 'save-state')).toContainText('All changes saved', { timeout: 10_000 })

    order = await tid(page, 'step-item-title').allInnerTexts()
    expect(order).toEqual([
      'Welcome to your orders',
      'Press Create',
      'Search',
      'Customer',
      'Choose status',
      'Press Save',
      'Press Export',
    ])
  })

  await test.step('watch it in the sandbox', async () => {
    await page.getByRole('tab', { name: 'Sandbox' }).click()
    const title = frame(page).locator('.tourd-title')
    await expect(title).toHaveText('Welcome to your orders', { timeout: 45_000 })
    await expect(frame(page).locator('.tourd-body strong')).toHaveText('create an order')
    await frame(page).locator('.tourd-btn--primary').click()
    await expect(title).toHaveText('Press Create')
    await expect(tid(page, 'step-item').nth(1)).toHaveAttribute('aria-current', 'step')
  })

  let files
  await test.step('export it', async () => {
    await tid(page, 'open-export').click()
    await expect(tid(page, 'export-ready')).toBeVisible()
    const download = page.waitForEvent('download')
    await tid(page, 'export-download').click()
    files = unzipSync(new Uint8Array(readFileSync(await (await download).path())))
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['README.md', 'tourd/TourPlayer.js', 'tourd/tour.json']),
    )
    await page.keyboard.press('Escape')
  })

  await test.step('add the bundle to a copy of the app and play the whole tour', async () => {
    await withApp(files, {}, async (url) => {
      await page.goto(`${url}/index.html`)
      const start = page.locator('[data-sap-ui$="--startTourBtn"]')
      await expect(start).toBeVisible({ timeout: 45_000 })
      await start.click()
      const seen = []
      for (let i = 0; i < order.length; i++) {
        await expect(page.locator('.tourd-progress')).toHaveText(`Step ${i + 1} of ${order.length}`)
        await expect(page.locator('.tourd-warn')).toHaveCount(0)
        seen.push(await page.locator('.tourd-title').textContent())
        await page.locator('.tourd-btn--primary').click()
      }
      expect(seen).toEqual(order)
      await expect(page.locator('.tourd-bubble')).toHaveCount(0)
    })
  })
})
