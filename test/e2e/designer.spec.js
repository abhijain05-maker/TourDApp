import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { loadSources } from '../helpers/sources.js'

// Drives the real designer in a browser against the real server: the Phase 5 acceptance test.

const DEVTOOLS = readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')
const tid = (page, id) => page.locator(`[data-testid="${id}"]`)
// UI5 inputs render a native <input>/<textarea> in their shadow DOM; Playwright pierces open shadow roots.
const tab = (page, name) => page.getByRole('tab', { name })
const field = (page, id) => tid(page, id).locator('input, textarea').first()
const type = async (page, id, value) => field(page, id).fill(value)

async function newProject(page, name) {
  await page.goto('/designer/')
  await tid(page, 'new-project').click()
  await type(page, 'project-name', name)
  await tid(page, 'create-project').click()
  await expect(tid(page, 'project-title')).toHaveText(name)
}

const uploadDemoFolder = async (page) => {
  await tid(page, 'input-folder').setInputFiles('samples/demo-app')
  await expect(tid(page, 'import-result')).toContainText(
    'Imported 17 file(s) of demo.orders: 3 view(s), 19 control(s)',
  )
}

test.describe.configure({ mode: 'serial' })

test('the whole journey: project -> files -> recording -> generated tour -> clean up', async ({
  page,
}) => {
  await test.step('create a project', async () => {
    await newProject(page, 'Orders demo')
    await expect(tid(page, 'sources-tab')).toBeVisible()
  })

  await test.step('recordings need the files first', async () => {
    await tab(page, 'Recordings').click()
    await expect(tid(page, 'need-sources')).toBeVisible()
    await expect(tid(page, 'rec-import')).toHaveAttribute('disabled', '')
    await tab(page, 'Workspace').click()
  })

  await test.step('upload the demo app as a folder', async () => {
    await uploadDemoFolder(page)
    await expect(tid(page, 'workspace')).toContainText('Files')
    await expect(tid(page, 'inventory-summary')).toContainText('3 views')
    await expect(tid(page, 'inventory-summary')).toContainText('19 controls')
    await expect(tid(page, 'unstable-tag')).toContainText('1 without a stable id') // the id-less Export button
    await expect(page.locator('.chip', { hasText: 'demo.orders' }).first()).toBeVisible() // app id tag in the header
  })

  await test.step('import a DevTools Recorder export', async () => {
    await tab(page, 'Recordings').click()
    await expect(tid(page, 'need-sources')).toHaveCount(0)
    await type(page, 'rec-name', 'Create order')
    await type(page, 'rec-raw', DEVTOOLS)
    await tid(page, 'rec-import').click()
    await expect(tid(page, 'rec-result')).toContainText(
      'DevTools Recorder recording: 7 step(s), 6 of 6 matched',
    )
    await expect(tid(page, 'recording-row')).toHaveCount(1)
    await expect(tid(page, 'recording-row')).toContainText('Create order')
  })

  await test.step('see how the steps were matched', async () => {
    await tid(page, 'rec-details').click()
    const dialog = tid(page, 'rec-details-dialog')
    await expect(dialog.locator('[data-testid="rec-step"]')).toHaveCount(7) // the start navigation + 6 actions (key presses are folded into their input)
    await expect(dialog).toContainText('Create')
    await expect(dialog).toContainText('createBtn')
    await expect(dialog).toContainText('opens "order/new"')
    await dialog.getByText('Close', { exact: true }).click()
    await expect(dialog).not.toBeVisible()
  })

  await test.step('generate a tour with the rule generator and watch the progress', async () => {
    await tab(page, 'Tours').click()
    await expect(tid(page, 'need-recording')).toHaveCount(0)
    await tid(page, 'generate-tour').click()
    await expect(tid(page, 'generate-dialog')).toBeVisible()
    await expect(tid(page, 'privacy-notice')).toHaveCount(0) // no AI, nothing leaves the server
    await tid(page, 'generate-start').click()
    await expect(page).toHaveURL(/#\/tours\//, { timeout: 20_000 })
  })

  await test.step('the tour opens in the editor with its steps and checks', async () => {
    await expect(field(page, 'tour-title-input')).toHaveValue('Create an order')
    await expect(tid(page, 'step-item')).toHaveCount(7)
    await expect(tid(page, 'step-item').nth(0)).toContainText('Create an order')
    await expect(tid(page, 'step-item').nth(2)).toContainText('Press Create')
    await expect(tid(page, 'step-item').nth(2)).toContainText('createBtn')
    await expect(tid(page, 'step-item').nth(6)).toContainText('1 warning(s)') // the id-less Export button
    await page.getByRole('tab', { name: /Checks/ }).click()
    await expect(tid(page, 'check-issue')).toHaveCount(1)
    await expect(tid(page, 'check-issue')).toContainText('no id')
  })

  await test.step('the tour is listed on the project with its badges', async () => {
    await page.getByRole('link', { name: 'Tours' }).click()
    await expect(tid(page, 'tour-row')).toHaveCount(1)
    await expect(tid(page, 'tour-row')).toContainText('v1')
    await expect(tid(page, 'tour-row')).toContainText('rules')
    await expect(tid(page, 'tour-row')).toContainText('1 warning(s)')
  })

  await test.step('data survives a reload', async () => {
    await page.reload()
    await expect(tid(page, 'tour-row')).toHaveCount(1)
  })

  await test.step('delete the tour', async () => {
    await tid(page, 'delete-tour').click()
    await tid(page, 'confirm-yes').click()
    await expect(tid(page, 'tour-row')).toHaveCount(0)
  })

  await test.step('delete the project', async () => {
    await page.goto('/designer/')
    // other specs run in parallel against the same server: only look at this test's own project
    const row = tid(page, 'project-row').filter({ hasText: 'Orders demo' })
    await expect(row).toHaveCount(1)
    await row.locator('[data-testid="delete-project"]').click()
    await tid(page, 'confirm-yes').click()
    await expect(row).toHaveCount(0)
  })
})

test('a zip file works like a folder', async ({ page }) => {
  await newProject(page, 'Zip demo')
  const sources = loadSources('samples/demo-app', 'samples/demo-app')
  const buffer = Buffer.from(
    zipSync(Object.fromEntries(sources.map((s) => [s.path, strToU8(s.content)]))),
  )
  await tid(page, 'input-zip').setInputFiles({
    name: 'app.zip',
    mimeType: 'application/zip',
    buffer,
  })
  await expect(tid(page, 'import-result')).toContainText('Imported 15 file(s) of demo.orders')
  await expect(tid(page, 'workspace')).toContainText(/Filess*15/)
})

test('a broken zip and a selection without usable files give clear messages', async ({ page }) => {
  await newProject(page, 'Bad input')
  await tid(page, 'input-zip').setInputFiles({
    name: 'x.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a zip'),
  })
  await expect(tid(page, 'error')).toContainText('not a readable zip')

  const dir = mkdtempSync(join(tmpdir(), 'tourd-ui-'))
  try {
    writeFileSync(join(dir, 'notes.txt'), 'nothing useful')
    await tid(page, 'input-folder').setInputFiles(dir)
    await expect(tid(page, 'error')).toContainText('No views, fragments, controllers')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('single files can be added, pasted and removed', async ({ page }) => {
  await newProject(page, 'Loose files')
  await uploadDemoFolder(page)

  await tid(page, 'paste-file').click()
  await type(page, 'paste-path', 'webapp/view/Extra.view.xml')
  await type(
    page,
    'paste-content',
    '<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc"><Button id="extraBtn" text="Extra"/></mvc:View>',
  )
  await tid(page, 'paste-add').click()
  await expect(tid(page, 'workspace')).toContainText(/Filess*18/)
  await tid(page, 'tree-filter').fill('Extra') // a search opens every folder
  await expect(page.locator('[data-path$="Extra.view.xml"]')).toBeVisible()
  await expect(tid(page, 'inventory-summary')).toContainText('4 views')

  await page.locator('[data-path$="Extra.view.xml"]').hover()
  await page
    .locator('[data-path$="Extra.view.xml"]')
    .getByRole('button', { name: 'Remove file' })
    .click()
  await page.locator('[data-testid="confirm-yes"]', { hasText: 'Remove' }).click()
  await expect(page.locator('[data-path$="Extra.view.xml"]')).toHaveCount(0)
  await expect(tid(page, 'inventory-summary')).toContainText('3 views')
})

test('recording errors are explained, and AI providers need configuration', async ({ page }) => {
  await newProject(page, 'Recording errors')
  await uploadDemoFolder(page)
  await tab(page, 'Recordings').click()

  await type(page, 'rec-raw', 'click Create')
  await tid(page, 'rec-format').click()
  await page.getByText('Chrome DevTools Recorder (JSON)').click()
  await tid(page, 'rec-import').click()
  await expect(tid(page, 'error')).toContainText('DevTools Recorder export')

  await tid(page, 'rec-format').click()
  await page.getByText('Plain text (one step per line)').click()
  await type(page, 'rec-raw', 'Click Create\nEnter "x" in Customer\nClick Save')
  await tid(page, 'rec-import').click()
  await expect(tid(page, 'rec-result')).toContainText(
    'Plain text recording: 3 step(s), 3 of 3 matched',
  )

  await tab(page, 'Tours').click()
  await tid(page, 'generate-tour').click()
  await tid(page, 'gen-provider').click()
  await page.getByText('Google Gemini (not configured on the server)').click()
  await expect(tid(page, 'privacy-notice')).toContainText('sent to Google Gemini')
  await expect(tid(page, 'generate-start')).toHaveAttribute('disabled', '')
})
