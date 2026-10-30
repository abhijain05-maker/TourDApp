import { test, expect } from '@playwright/test'
import { API, tid } from '../helpers/e2e-tour.js'

// Pairing a browser extension from the designer: create a token, see it once, revoke it.

test('creates a token that is shown once, lists it, and revokes it', async ({ page, request }) => {
  await page.goto('/designer/')
  await tid(page, 'open-extension').click()
  const dialog = tid(page, 'extension-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Load unpacked')

  const name = `Laptop ${Date.now()}`
  await expect(tid(page, 'token-create')).toHaveAttribute('disabled', '') // a name is needed
  await tid(page, 'token-name').locator('input').fill(name)
  await tid(page, 'token-create').click()
  await expect(tid(page, 'token-created')).toBeVisible()
  const token = (await tid(page, 'token-value').textContent()).trim()
  expect(token).toMatch(/^tourd_[A-Za-z0-9_-]{32,}$/)
  const row = tid(page, 'token-row').filter({ hasText: name })
  await expect(row).toContainText(token.slice(0, 10))
  await expect(row).toContainText('never')

  // it is real: an extension request with it is accepted
  const paired = await request.get(`${API}/Projects?$top=1`, {
    headers: { 'X-TourD-Token': token },
  })
  expect(paired.status()).toBe(200)

  // it is not shown again
  await dialog.getByText('Close', { exact: true }).click()
  await tid(page, 'open-extension').click()
  await expect(tid(page, 'token-created')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(token)
  await expect(row).toBeVisible()

  // revoke
  await row.locator('[data-testid="token-revoke"]').click()
  await expect(row).toContainText('revoked')
  await expect(row.locator('[data-testid="token-revoke"]')).toHaveCount(0)
  const after = await request.get(`${API}/Projects?$top=1`, { headers: { 'X-TourD-Token': token } })
  expect(after.status()).toBe(403)
  expect(await after.text()).toContain('revoked')
})

test('the console snippet records in an app without the extension', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/designer/')
  await tid(page, 'open-extension').click()
  await tid(page, 'snippet-copy').click()
  await expect(tid(page, 'snippet-copied')).toBeVisible()
  const snippet = (await page.evaluate(() => navigator.clipboard.readText()))
    .split('\r\n')
    .join('\n')
  expect(snippet).toContain('TourD recorder - paste into the browser console')

  const demo = await context.newPage()
  await demo.goto('http://localhost:8081/index.html?ui5=1.120')
  await expect(demo.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
  await demo.evaluate(snippet)
  expect(await demo.evaluate(() => window.__tourdRecorder.isRecording())).toBe(true)
  await demo.locator('[data-sap-ui$="--createBtn"]').click()
  const rec = await demo.evaluate(() => window.__tourdRecorder.stop())
  expect(rec.steps.map((s) => [s.type, s.control?.localId ?? s.hash])).toEqual([
    ['press', 'createBtn'],
    ['navigate', '/order/new'],
  ])
})
