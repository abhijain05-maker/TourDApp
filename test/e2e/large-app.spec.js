import { test, expect } from '@playwright/test'
import { bigApp } from '../helpers/big-app.js'
import { API, tid } from '../helpers/e2e-tour.js'

// The designer with a large app (40 views, 1000+ controls) must stay usable.

async function bigProject(request) {
  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const project = await post('Projects', {
    name: `Large ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  })
  const imported = await post('importSources', {
    projectID: project.ID,
    files: bigApp({ views: 40 }),
    replace: true,
  })
  const steps = [1, 4, 8, 12, 16, 20, 24, 28, 32, 36, 38, 40].map((n, i) => ({
    id: `s${i + 1}`,
    title: `Step ${i + 1} on screen ${n}`,
    text: 'Press the button.',
    target: { viewName: `big.app.view.View${n}`, controlId: 'createBtn', fallbacks: [] },
  }))
  const tour = await post('createTour', {
    projectID: project.ID,
    name: 'Large tour',
    definition: JSON.stringify({ schemaVersion: 1, id: 'large', title: 'Large tour', steps }),
  })
  return { projectID: project.ID, tourID: tour.ID, imported }
}

test('imports a large app and opens its tour, the control list and the search without lag', async ({
  page,
  request,
}) => {
  const t0 = Date.now()
  const { tourID, imported } = await bigProject(request)
  console.log(`[perf] import of 40 views through the API: ${Date.now() - t0} ms`)
  expect(imported.views).toBe(40)
  expect(imported.controls).toBeGreaterThanOrEqual(1000)

  const opened = Date.now()
  await page.goto(`/designer/#/tours/${tourID}`)
  await expect(tid(page, 'step-item')).toHaveCount(12)
  console.log(`[perf] tour editor ready: ${Date.now() - opened} ms`)
  expect(Date.now() - opened).toBeLessThan(15000)
  await expect(tid(page, 'save-state')).toContainText('All changes saved')
  // every target exists; the checks only point out that the steps do not open their pages
  await page.getByRole('tab', { name: /Checks/ }).click()
  await expect(tid(page, 'checks-panel')).toContainText('add a navigate action')
  await expect(tid(page, 'checks-panel')).not.toContainText('no control')
  await page.getByRole('tab', { name: 'Preview' }).click()

  // the control list draws a bounded number of rows however big the app is
  await tid(page, 'step-item').nth(2).click()
  await tid(page, 'choose-control').click()
  const pickerOpened = Date.now()
  await expect(tid(page, 'target-option').first()).toBeVisible()
  console.log(`[perf] control picker open: ${Date.now() - pickerOpened} ms`)
  expect(Date.now() - pickerOpened).toBeLessThan(10000)
  expect(await tid(page, 'target-option').count()).toBeLessThanOrEqual(150)
  await expect(tid(page, 'target-truncated')).toContainText('Showing the first 150 of')

  // typing narrows it down quickly to the control that is wanted
  const typed = Date.now()
  await tid(page, 'target-search').locator('input').fill('field 5 of screen 33')
  await expect(tid(page, 'target-option')).toHaveCount(1)
  console.log(`[perf] picker search: ${Date.now() - typed} ms`)
  expect(Date.now() - typed).toBeLessThan(8000)
  await expect(tid(page, 'target-truncated')).toHaveCount(0)
  await tid(page, 'target-option').click()
  await expect(tid(page, 'target-name')).toContainText('Field 5 of screen 33')
})
