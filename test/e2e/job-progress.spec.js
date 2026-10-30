import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

// The rule generator is too fast to watch, so the progress view is tested with a controlled job endpoint:
// the test decides what the server "reports" and checks that the UI follows it.

const tid = (page, id) => page.locator(`[data-testid="${id}"]`)
const type = (page, id, value) => tid(page, id).locator('input, textarea').first().fill(value)
const DEVTOOLS = readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')

const stage = (page, id) => page.locator(`[data-testid="job-progress"] li[data-stage="${id}"]`)

test('the progress view follows the job: stages, automatic correction, and failure', async ({
  page,
}) => {
  // set up a project with files and a recording through the UI
  await page.goto('/designer/')
  await tid(page, 'new-project').click()
  await type(page, 'project-name', 'Progress demo')
  await tid(page, 'create-project').click()
  await tid(page, 'input-folder').setInputFiles('samples/demo-app')
  await expect(tid(page, 'import-result')).toBeVisible()
  await page.getByRole('tab', { name: 'Recordings' }).click()
  await type(page, 'rec-raw', DEVTOOLS)
  await tid(page, 'rec-import').click()
  await expect(tid(page, 'rec-result')).toBeVisible()
  await page.getByRole('tab', { name: 'Tours' }).click()

  // what the job endpoint reports from now on
  const job = { status: 'running', stage: 'context', error: null, report: null, tour_ID: null }
  await page.route(/GenerationJobs\([^)]+\)/, async (route) => {
    const real = await (await route.fetch()).json()
    await route.fulfill({ json: { ...real, ...job } })
  })

  await tid(page, 'generate-tour').click()
  await tid(page, 'generate-start').click()
  await expect(tid(page, 'job-progress')).toBeVisible()

  await expect(stage(page, 'context')).toHaveAttribute('data-state', 'active')
  await expect(stage(page, 'generate')).toHaveAttribute('data-state', 'pending')
  await expect(stage(page, 'repair')).toHaveCount(0) // only shown when it happens

  Object.assign(job, { stage: 'generate' })
  await expect(stage(page, 'context')).toHaveAttribute('data-state', 'done')
  await expect(stage(page, 'generate')).toHaveAttribute('data-state', 'active')

  Object.assign(job, { stage: 'repair' })
  await expect(stage(page, 'repair')).toHaveAttribute('data-state', 'active')
  await expect(stage(page, 'generate')).toHaveAttribute('data-state', 'done')
  await expect(stage(page, 'validate')).toHaveAttribute('data-state', 'pending')

  Object.assign(job, { status: 'failed', stage: 'generate', error: 'Gemini rejected the API key' })
  await expect(tid(page, 'job-error')).toContainText('Gemini rejected the API key')
  await expect(stage(page, 'generate')).toHaveAttribute('data-state', 'failed')
  await expect(page).not.toHaveURL(/#\/tours\//) // a failed job does not navigate away

  // closing returns to the project; the UI only reflects what the server reported (the real job did succeed here)
  await tid(page, 'generate-close').click()
  await expect(tid(page, 'generate-dialog')).not.toBeVisible()
  await expect(page).toHaveURL(/#\/projects\//)
})
