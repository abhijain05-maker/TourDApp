// The SAPUI5 designer (app/designer-ui5, served at /designer-ui5/): the same work as designer.spec.js and its neighbours,
// done in the UI5 app. Each test makes its own project through the API and removes it afterwards.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test, expect } from '@playwright/test'

const BASE = '/odata/v4/tour'
const APP = '/designer-ui5/index.html'
const DEMO = join(import.meta.dirname, '../../samples/demo-app/webapp')
const RECORDING = join(import.meta.dirname, '../fixtures/recordings/demo-create-order.txt')

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
const demoFiles = () =>
  walk(DEMO)
    .filter((f) => !f.endsWith('TourPlayer.js'))
    .map((f) => ({ path: relative(DEMO, f).replaceAll('\\', '/'), content: readFileSync(f, 'utf8'), binary: false }))

/** A project through the API: with the demo app's files, and optionally a recording. */
async function seed(request, name, { sources = true, recording = false } = {}) {
  const project = await (await request.post(`${BASE}/Projects`, { data: { name } })).json()
  if (sources) await request.post(`${BASE}/importSources`, { data: { projectID: project.ID, files: demoFiles(), replace: false } })
  if (recording) {
    await request.post(`${BASE}/importRecording`, {
      data: { projectID: project.ID, name: 'order flow', raw: readFileSync(RECORDING, 'utf8'), format: 'plain-text', purpose: 'both' },
    })
  }
  return project
}
const remove = (request, project) => request.delete(`${BASE}/Projects(${project.ID})`)
const rows = async (request, path) => (await (await request.get(`${BASE}${path}`)).json()).value

// the tour page has three columns: give it room
test.use({ viewport: { width: 1700, height: 1000 } })

// ids of UI5 controls end with the id of the control in its view
const id = (page, suffix) => page.locator(`[id$="${suffix}"]`)

test.describe('designer-ui5: projects and recordings', () => {
  test('creates, opens and deletes a project, and switches the appearance', async ({ page, request }) => {
    const name = `UI5 projects ${Date.now()}`
    await page.goto(APP)
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'New project' }).click()
    await page.getByLabel('Name', { exact: true }).fill(name)
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(id(page, 'projectTitle')).toHaveText(name)
    await expect(id(page, 'tileSources')).toContainText('Files')

    await id(page, 'themeButton').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/)

    await page.getByRole('link', { name: 'Projects' }).first().click()
    await expect(id(page, 'projectsTable').getByText(name)).toBeVisible()
    await page.locator('[id$="projectsTable"] tbody tr', { hasText: name }).getByRole('button', { name: 'Delete project' }).click()
    await page.locator('.sapMDialog').getByRole('button', { name: 'Delete' }).click()
    await expect(id(page, 'projectsTable').getByText(name)).toHaveCount(0)
  })

  test('imports a recording, relabels it and shows how the steps were matched', async ({ page, request }) => {
    const project = await seed(request, `UI5 recordings ${Date.now()}`)
    try {
      await page.goto(`${APP}#/projects/${project.ID}?tab=recordings`)
      await id(page, 'recRaw').locator('textarea').fill(readFileSync(RECORDING, 'utf8'))
      await id(page, 'recName').locator('input').fill('plain order')
      await id(page, 'recImport').click()
      await expect(page.getByText(/Imported a Plain text recording/)).toBeVisible({ timeout: 15_000 })

      const row = page.locator('[id$="recordingsTable"] tbody tr').first()
      await row.locator('.sapMSlt').click()
      await page.getByRole('option', { name: 'Tests', exact: true }).click()
      await expect.poll(async () => (await rows(request, `/Recordings?$filter=project_ID eq ${project.ID}`))[0]?.purpose).toBe('test')

      await page.getByRole('button', { name: 'Show how the steps were matched' }).first().click()
      await expect(page.getByText('Matched by')).toBeVisible()
      await page.getByRole('button', { name: 'Close' }).last().click()
    } finally {
      await remove(request, project)
    }
  })
})

test.describe('designer-ui5: workspace', () => {
  test('uploads a folder, edits and saves a file in CodeMirror, compares and accepts', async ({ page, request }) => {
    const project = await seed(request, `UI5 workspace ${Date.now()}`, { sources: false })
    try {
      await page.goto(`${APP}#/projects/${project.ID}?tab=sources`)
      await expect(page.getByText('Upload your app to see its files here.')).toBeVisible({ timeout: 30_000 })

      const chooser = page.waitForEvent('filechooser')
      await id(page, 'pickFolder').click()
      await (await chooser).setFiles(DEMO)
      await expect(id(page, 'importResult')).toContainText('Imported', { timeout: 20_000 })
      await expect(id(page, 'importResult')).toContainText('control(s)')

      await page.getByText('Main.controller.js', { exact: true }).click()
      const editor = id(page, 'editor').locator('.cm-content')
      await expect(editor).toContainText('sap.ui.define')
      await editor.click()
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('// edited in the SAPUI5 designer\n')
      await id(page, 'saveFile').click()
      await expect
        .poll(async () => (await rows(request, `/Sources?$filter=project_ID eq ${project.ID}`)).find((r) => r.path.endsWith('Main.controller.js'))?.status)
        .toBe('modified')

      await id(page, 'showDiff').click()
      await expect(id(page, 'diff').locator('.cm-mergeView')).toBeVisible()

      await id(page, 'acceptAll').click()
      await page.locator('.sapMDialog').getByRole('button', { name: 'Accept all changes' }).click()
      await expect.poll(async () => (await rows(request, `/Sources?$filter=project_ID eq ${project.ID}`)).every((r) => r.status === 'unchanged')).toBe(true)

      // full screen folds the side menu away, and Esc gives it back
      const menuWidth = () => id(page, 'sideNav').evaluate((e) => e.getBoundingClientRect().width)
      const before = await menuWidth()
      await id(page, 'fullScreen').click()
      await expect.poll(menuWidth).toBeLessThan(before / 2)
      await page.keyboard.press('Escape')
      await expect.poll(menuWidth).toBeGreaterThan(before - 5)

      await id(page, 'newFile').click()
      await id(page, 'nameInput').locator('input').fill('webapp/notes/readme.md')
      await id(page, 'nameConfirm').click()
      await expect(id(page, 'fileTree').getByText('readme.md', { exact: true })).toBeVisible()
    } finally {
      await remove(request, project)
    }
  })

  test('copies the recorder as a console snippet', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(APP)
    await id(page, 'extensionButton').click()
    await expect(id(page, 'extAddress').locator('input')).toHaveValue(/^http/)
    await id(page, 'snippetCopy').click()
    await expect(page.getByText('Copied')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('__tourdRecorder')
  })
})

test.describe('designer-ui5: tours', () => {
  test('generates a tour, edits it with autosave and undo, and checks the export', async ({ page, request }) => {
    const project = await seed(request, `UI5 tours ${Date.now()}`, { recording: true })
    try {
      await page.goto(`${APP}#/projects/${project.ID}?tab=tours`)
      await id(page, 'generateTour').click()
      await expect(id(page, 'genStart')).toBeEnabled({ timeout: 15_000 })
      await id(page, 'genStart').click()
      await expect(id(page, 'tourTitle')).toBeVisible({ timeout: 60_000 })

      const first = id(page, 'stepTitle').locator('input')
      await first.fill('Hello from SAPUI5')
      await expect(id(page, 'saveState')).toContainText('All changes saved', { timeout: 10_000 })
      const tour = (await rows(request, `/Tours?$filter=project_ID eq ${project.ID}`))[0]
      expect(JSON.parse(tour.definition).steps[0].title).toBe('Hello from SAPUI5')

      await id(page, 'undo').click()
      await expect(first).not.toHaveValue('Hello from SAPUI5')
      await id(page, 'redo').click()
      await expect(first).toHaveValue('Hello from SAPUI5')

      await id(page, 'rightTabs').getByText('JSON', { exact: true }).locator('visible=true').first().click()
      await expect(id(page, 'jsonEditor').locator('.cm-content')).toContainText('schemaVersion')

      await id(page, 'openExport').click()
      await expect(id(page, 'exportFiles')).toContainText('tour.json', { timeout: 15_000 })
      await page.getByRole('button', { name: 'Close' }).last().click()

      await id(page, 'openApply').click()
      await expect(id(page, 'applyConfirm')).toBeEnabled({ timeout: 15_000 })
      await id(page, 'applyConfirm').click()
      await expect(page.getByText('were added to the project')).toBeVisible({ timeout: 15_000 })
      expect((await rows(request, `/getChanges(projectID=${project.ID})`)).length).toBeGreaterThan(0)
    } finally {
      await remove(request, project)
    }
  })
})

test.describe('designer-ui5: tests, help and the palette', () => {
  test('makes wdi5 tests from a recording, edits and saves the plan, adds the files', async ({ page, request }) => {
    const project = await seed(request, `UI5 tests ${Date.now()}`, { recording: true })
    try {
      await page.goto(`${APP}#/projects/${project.ID}?tab=tests`)
      await id(page, 'newTestPlan').click()
      await id(page, 'testName').locator('input').fill('Order tests')
      await expect(id(page, 'createTestPlan')).toBeEnabled()
      await id(page, 'createTestPlan').click()
      await expect(id(page, 'planName')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText(/control\(s\) found/)).toBeVisible({ timeout: 15_000 })

      await page.locator('[id$="planStepsTable"] tbody tr').nth(1).locator('input[type="text"]').first().fill('Press the Create button')
      await expect(id(page, 'planState')).toContainText('Unsaved')
      await id(page, 'planSave').click()
      await expect(id(page, 'planState')).toContainText('Saved')

      await id(page, 'planApply').click()
      await expect(id(page, 'applyConfirm')).toBeEnabled({ timeout: 15_000 })
      await id(page, 'applyConfirm').click()
      await expect(page.getByText('were added to the project')).toBeVisible({ timeout: 15_000 })
    } finally {
      await remove(request, project)
    }
  })

  test('lists, edits and deletes help topics; the palette jumps to a file', async ({ page, request }) => {
    const project = await seed(request, `UI5 help ${Date.now()}`)
    try {
      const set = await (await request.post(`${BASE}/createHelpSet`, { data: { projectID: project.ID, name: 'Help' } })).json()
      await request.post(`${BASE}/saveHelpTopic`, {
        data: {
          projectID: project.ID,
          helpID: set.ID,
          topic: JSON.stringify({
            id: 'search',
            title: 'Search orders',
            summary: 'Find an order',
            text: 'Type a customer name.',
            note: '',
            links: [],
            target: { viewName: 'demo.orders.view.Main', controlId: 'searchField', fallbacks: [] },
            meta: { controlType: 'sap.m.SearchField', screen: 'Orders' },
          }),
        },
      })
      await page.goto(`${APP}#/projects/${project.ID}?tab=help`)
      await page.getByText('Search orders').first().click()
      await id(page, 'helpEditText').locator('textarea').fill('Type a customer name. It is **fast**.')
      await id(page, 'helpEditSave').click()
      await expect
        .poll(async () => JSON.parse((await rows(request, `/HelpSets?$filter=project_ID eq ${project.ID}`))[0].definition).topics[0].text)
        .toContain('fast')
      await id(page, 'helpTable').getByRole('button', { name: 'Delete this topic' }).first().click()
      await page.locator('.sapMDialog').getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByText('No topics yet.')).toBeVisible()

      await page.goto(`${APP}#/projects/${project.ID}?tab=sources`)
      await expect(page.getByText('Main.view.xml', { exact: true })).toBeVisible({ timeout: 20_000 })
      await page.keyboard.press('Control+k')
      await id(page, 'paletteInput').locator('input').fill('detail.contr')
      await page.keyboard.press('Enter')
      await expect(id(page, 'filePath')).toContainText('Detail.controller.js')
    } finally {
      await remove(request, project)
    }
  })
})
