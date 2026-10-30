import { test, expect } from '@playwright/test'
import { unzipSync } from 'fflate'
import { makeTour, openTour, tid } from '../helpers/e2e-tour.js'
import { plainSources, withChanges } from '../helpers/plain-app.js'

// Phase 5: the tour goes into the project's own files, is reviewed as diffs, downloaded as "changes" and unzipped
// over the app - and the tour plays.

test('add a tour to the project, review it, download the changes, play it in the app', async ({
  page,
  request,
}) => {
  const { projectID, tourID, doc } = await makeTour(request, 'Apply run', { files: plainSources() })

  await test.step('the plan lists the files and shows each one as a diff', async () => {
    await openTour(page, tourID)
    await tid(page, 'open-apply').click()
    await expect(tid(page, 'apply-file')).toHaveCount(6)
    await expect(tid(page, 'apply-file').first()).toContainText('webapp/manifest.json')
    await expect(tid(page, 'diff-view')).toBeVisible()
    await tid(page, 'apply-file').filter({ hasText: 'Main.view.xml' }).getByRole('button').click()
    await expect(tid(page, 'diff-view')).toContainText('startTourBtn')
    await expect(tid(page, 'apply-confirm')).toContainText('Add 6 files')
  })

  await test.step('a file can be left out, then the rest is added', async () => {
    await page.getByLabel('Include webapp/tourd/tour.schema.json').uncheck()
    await expect(tid(page, 'apply-confirm')).toContainText('Add 5 files')
    await tid(page, 'apply-confirm').click()
    await expect(tid(page, 'apply-done')).toContainText('5 file(s) were added')
    await tid(page, 'apply-open-workspace').click()
  })

  await test.step('they are ordinary changes of the workspace', async () => {
    await expect(tid(page, 'workspace')).toBeVisible()
    await expect(tid(page, 'changes-count')).toHaveText('5')
    await expect(tid(page, 'change-row').filter({ hasText: 'Main.controller.js' })).toBeVisible()
    await tid(page, 'change-row')
      .filter({ hasText: 'Main.view.xml' })
      .getByRole('button')
      .first()
      .click()
    await expect(tid(page, 'diff-view')).toContainText('startTourBtn')
  })

  await test.step('adding it again offers only what was left out', async () => {
    await openTour(page, tourID)
    await tid(page, 'open-apply').click()
    await expect(tid(page, 'apply-file')).toHaveCount(1)
    await expect(tid(page, 'apply-file')).toContainText('tour.schema.json')
    await tid(page, 'apply-close').click()
  })

  await test.step('the changes unzipped over the app make the tour play', async () => {
    const zip = await request.get(`/export/project/${projectID}/changes.zip`)
    expect(zip.ok()).toBe(true)
    const files = unzipSync(new Uint8Array(await zip.body()))
    expect(Object.keys(files).sort()).toEqual([
      'CHANGES.md',
      'webapp/controller/Main.controller.js',
      'webapp/manifest.json',
      'webapp/tourd/TourPlayer.js',
      'webapp/tourd/tour.json',
      'webapp/view/Main.view.xml',
    ])
    await withChanges(files, async (url) => {
      await page.goto(`${url}/index.html`)
      const button = page.locator('[data-sap-ui$="--startTourBtn"]')
      await expect(button).toBeVisible({ timeout: 45_000 })
      await button.click()
      for (let i = 0; i < doc.steps.length; i++) {
        await expect(page.locator('.tourd-progress')).toHaveText(
          `Step ${i + 1} of ${doc.steps.length}`,
        )
        await expect(page.locator('.tourd-warn')).toHaveCount(0)
        await page.locator('.tourd-btn--primary').click()
      }
      await expect(page.locator('.tourd-bubble')).toHaveCount(0)
    })
  })
})

test('a tour that is not ready says why and cannot be added', async ({ page, request }) => {
  const { tourID } = await makeTour(request, 'Apply blocked', { files: plainSources() })
  const got = await (await request.get(`/odata/v4/tour/Tours(${tourID})`)).json()
  const doc = JSON.parse(got.definition)
  doc.steps[1].meta = { ...doc.steps[1].meta, unresolved: true, note: 'pick it' }
  const saved = await request.post('/odata/v4/tour/saveTour', {
    data: { tourID, definition: JSON.stringify(doc), autosave: false, baseVersion: got.version },
  })
  expect(saved.ok(), await saved.text()).toBe(true)
  await openTour(page, tourID)
  await tid(page, 'open-apply').click()
  await expect(tid(page, 'apply-blocked')).toBeVisible()
  await expect(tid(page, 'apply-confirm')).toHaveAttribute('disabled', '')
})
