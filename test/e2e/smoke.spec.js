import { test, expect } from '@playwright/test'

test('the server answers and the designer shell loads and reaches it', async ({
  page,
  request,
}) => {
  const providers = await request.get('/odata/v4/tour/providers()')
  expect(providers.ok()).toBe(true)
  expect((await providers.json()).value.map((p) => p.id)).toEqual(
    expect.arrayContaining(['rules', 'gemini', 'sap-ai-core']),
  )

  await page.goto('/designer/')
  await expect(page.getByText('QuickDev', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="error"]')).toHaveCount(0) // the project list was loaded without an error
})
