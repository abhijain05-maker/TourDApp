import { test, expect } from '@playwright/test'

// The workspace: upload a project, read and edit files, review the changes, take them along.

const tid = (page, id) => page.locator(`[data-testid="${id}"]`)
const field = (page, id) => tid(page, id).locator('input, textarea').first()
const row = (page, path) => page.locator(`[data-testid="source-row"][data-path$="${path}"]`)
const projectID = (page) => page.url().match(/projects\/([^/?#]+)/)[1]

async function project(page, name) {
  await page.goto('/designer/')
  await tid(page, 'new-project').click()
  await field(page, 'project-name').fill(name)
  await tid(page, 'create-project').click()
  await expect(tid(page, 'project-title')).toHaveText(name)
  await tid(page, 'input-folder').setInputFiles('samples/demo-app')
  await expect(tid(page, 'import-result')).toContainText('Imported 17 file(s)')
  await expect(tid(page, 'workspace')).toBeVisible()
}

/** The code editor lives in a shadow root; click into it and type at the end of the document. */
async function typeAtEnd(page, text) {
  const content = tid(page, 'workspace').locator('.cm-content').first()
  await content.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}

test.describe.configure({ mode: 'serial' })

test('open, edit and save a file; the change shows up in the changes list and as a diff', async ({
  page,
}) => {
  await project(page, 'Workspace edit')
  await expect(tid(page, 'changes-count')).toHaveText('0')

  await row(page, 'Main.controller.js').click()
  await expect(tid(page, 'file-path')).toContainText('Main.controller.js')
  await expect(tid(page, 'file-status')).toHaveText(/as uploaded/i)
  await expect(tid(page, 'save-file')).toHaveAttribute('disabled', '')

  await typeAtEnd(page, '\n// edited in the workspace')
  await expect(page.locator('.dirty')).toBeVisible()
  await expect(tid(page, 'save-file')).not.toHaveAttribute('disabled')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.dirty')).toHaveCount(0)
  await expect(tid(page, 'file-status')).toHaveText(/changed/i)
  await expect(tid(page, 'changes-count')).toHaveText('1')
  await expect(row(page, 'Main.controller.js')).toContainText('M')

  await tid(page, 'show-diff').click()
  await expect(tid(page, 'diff-view')).toBeVisible()
  await expect(tid(page, 'diff-view')).toContainText('edited in the workspace')

  // the saved text is what the server hands out
  const patch = await page.request.get(`/export/project/${projectID(page)}/changes.patch`)
  expect(patch.ok()).toBe(true)
  expect(await patch.text()).toContain('+// edited in the workspace')
})

test('add, rename, remove and put back files', async ({ page }) => {
  await project(page, 'Workspace files')

  await tid(page, 'new-file').click()
  await tid(page, 'new-file-dialog').locator('input').fill('webapp/test/notes.md')
  await tid(page, 'new-file-dialog').getByTestId('name-confirm').click()
  await expect(tid(page, 'file-path')).toContainText('webapp/test/notes.md')
  await expect(tid(page, 'changes-count')).toHaveText('1')

  const notes = row(page, 'notes.md')
  await notes.hover()
  await notes.getByRole('button', { name: 'Rename file' }).click()
  await tid(page, 'rename-dialog').locator('input').fill('webapp/test/README.md')
  await tid(page, 'rename-dialog').getByTestId('name-confirm').click()
  await expect(row(page, 'README.md')).toBeVisible()
  await expect(row(page, 'notes.md')).toHaveCount(0)

  // an uploaded file that is removed can be put back
  await tid(page, 'tree-filter').fill('i18n.properties')
  const i18n = row(page, 'i18n/i18n.properties')
  await i18n.hover()
  await i18n.getByRole('button', { name: 'Remove file' }).click()
  await page.locator('[data-testid="confirm-yes"]', { hasText: 'Remove' }).click()
  await expect(tid(page, 'changes-count')).toHaveText('2')
  await expect(i18n).toHaveCount(0) // gone from the tree, listed under the changes
  await expect(tid(page, 'change-row').filter({ hasText: 'i18n.properties' })).toContainText('D')

  await page.getByRole('button', { name: /^Put back .*i18n\.properties/ }).click()
  await page.locator('[data-testid="confirm-yes"]', { hasText: 'Put back' }).click()
  await expect(tid(page, 'changes-count')).toHaveText('1')
})

test('a file changed elsewhere is not overwritten by accident', async ({ page, request }) => {
  await project(page, 'Workspace conflict')
  await row(page, 'Component.js').click()
  await typeAtEnd(page, '\n// mine')

  const filter = `project_ID eq ${projectID(page)} and endswith(path,'Component.js')`
  const sources = await request.get(
    `/odata/v4/tour/Sources?$filter=${encodeURIComponent(filter)}&$select=ID`,
  )
  const fileID = (await sources.json()).value[0].ID
  const other = await request.post('/odata/v4/tour/saveFile', {
    data: { fileID, content: '// someone else\n' },
  })
  expect(other.ok()).toBe(true)

  await page.keyboard.press('Control+s')
  await expect(tid(page, 'file-conflict')).toBeVisible()
  await page.getByRole('link', { name: 'Save mine anyway' }).click()
  await expect(tid(page, 'file-conflict')).toHaveCount(0)
  await expect(tid(page, 'changes-count')).toHaveText('1')
})

test('the command palette finds files; the theme can be switched', async ({ page }) => {
  await project(page, 'Workspace palette')
  await page.keyboard.press('Control+k')
  await expect(tid(page, 'palette-input')).toBeVisible()
  await tid(page, 'palette-input').fill('manifest')
  await expect(tid(page, 'palette-item').first()).toContainText('manifest.json')
  await page.keyboard.press('Enter')
  await expect(tid(page, 'file-path')).toContainText('manifest.json')

  await page.keyboard.press('Control+k')
  await tid(page, 'palette-input').fill('appearance')
  await expect(tid(page, 'theme-toggle')).toContainText('auto')
  await page.keyboard.press('Enter')
  await expect(tid(page, 'theme-toggle')).not.toContainText('auto')
})

test('the file tree works with the keyboard', async ({ page }) => {
  await project(page, 'Workspace keys')
  await tid(page, 'tree-filter').fill('Main.view')
  await row(page, 'Main.view.xml').focus()
  await page.keyboard.press('Enter')
  await expect(tid(page, 'file-path')).toContainText('Main.view.xml')
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('[data-testid="folder-row"]:focus')).toHaveCount(1)

  // without a search, Left closes an open folder and Right opens it again
  await tid(page, 'tree-filter').fill('')
  const view = page.locator('[data-testid="folder-row"][data-path$="webapp/view"]')
  await view.focus()
  await expect(view).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(view).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ArrowRight')
  await expect(view).toHaveAttribute('aria-expanded', 'true')
})

test('the workspace has no serious accessibility violations', async ({ page }) => {
  await project(page, 'Workspace a11y')
  await row(page, 'Main.view.xml').click()
  await expect(tid(page, 'file-path')).toBeVisible()
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  const result = await new AxeBuilder({ page })
    .include('[data-testid="workspace"]')
    .disableRules(['color-contrast'])
    .analyze()
  const serious = result.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`)
  expect(serious).toEqual([])
})

test('the shell, the project list and the command palette have no serious accessibility violations', async ({
  page,
}) => {
  await page.goto('/designer/')
  await expect(tid(page, 'new-project')).toBeVisible()
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  const serious = async () =>
    (await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()).violations
      .filter((v) => ['serious', 'critical'].includes(v.impact))
      .map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`)
  expect(await serious()).toEqual([])

  await page.keyboard.press('Control+k')
  await expect(tid(page, 'palette-input')).toBeVisible()
  expect(await serious()).toEqual([])
})

test('the project overview shows where the project stands and what to do next', async ({
  page,
}) => {
  await page.goto('/designer/')
  await tid(page, 'new-project').click()
  await field(page, 'project-name').fill('Overview')
  await tid(page, 'create-project').click()
  await expect(tid(page, 'project-title')).toHaveText('Overview')
  await expect(tid(page, 'tile-sources')).toContainText('upload your app')
  await expect(tid(page, 'next-step')).toContainText('uploading your app')

  await tid(page, 'input-folder').setInputFiles('samples/demo-app')
  await expect(tid(page, 'import-result')).toBeVisible()
  await expect(tid(page, 'tile-sources')).toContainText('17')
  await expect(tid(page, 'tile-sources')).toContainText('as uploaded')
  await expect(tid(page, 'next-step')).toContainText('Record a flow')

  await tid(page, 'tile-tests').click()
  await expect(tid(page, 'tests-tab')).toBeVisible()
  await expect(tid(page, 'tile-tests')).toContainText('0')
  await tid(page, 'next-step').getByRole('link', { name: 'Open' }).click()
  await expect(tid(page, 'recordings-tab')).toBeVisible()
})
