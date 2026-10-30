import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { loadSources } from '../helpers/sources.js'

// The tour editor (Phase 6) in a real browser: every test starts from a freshly generated tour.

const API = '/odata/v4/tour'
const DEVTOOLS = readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')
const SOURCES = loadSources('samples/demo-app', 'samples/demo-app')
const tid = (page, id) => page.locator(`[data-testid="${id}"]`)
const field = (page, id) => tid(page, id).locator('input, textarea').first()

/** Project -> files -> recording -> generated tour, through the API. Returns the ids and the tour document. */
async function makeTour(request, name = 'Editor') {
  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const project = await post('Projects', {
    name: `${name} ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  })
  await post('importSources', { projectID: project.ID, files: SOURCES, replace: true })
  const rec = await post('importRecording', { projectID: project.ID, raw: DEVTOOLS })
  let job = await post('generateTour', {
    projectID: project.ID,
    recordingID: rec.ID,
    provider: 'rules',
  })
  for (let i = 0; i < 100 && !['done', 'failed'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 100))
    job = await (await request.get(`${API}/GenerationJobs(${job.ID})`)).json()
  }
  expect(job.status).toBe('done')
  const tour = await (await request.get(`${API}/Tours(${job.tour_ID})`)).json()
  return { projectID: project.ID, tourID: tour.ID, doc: JSON.parse(tour.definition) }
}

const open = async (page, tourID) => {
  await page.goto(`/designer/#/tours/${tourID}`)
  await expect(tid(page, 'step-item').first()).toBeVisible()
}
/** Replaces the whole content of the JSON editor by pasting, then returns to the top (CodeMirror renders only visible lines). */
async function pasteJson(page, text) {
  await tid(page, 'json-panel').locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.evaluate((txt) => {
    const data = new DataTransfer()
    data.setData('text/plain', txt)
    // CodeMirror lives in its own shadow root (see JsonPanel.tsx)
    document
      .querySelector('[data-testid="json-panel"]')
      .shadowRoot.querySelector('.cm-content')
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
  }, text)
  await page.keyboard.press('Control+Home')
}
const liveRegion = (page) => page.locator('[id^="DndLiveRegion"]')
const titles = (page) => tid(page, 'step-item-title').allInnerTexts()
const saved = (page) =>
  expect(tid(page, 'save-state')).toContainText('All changes saved', { timeout: 10_000 })
const selectStep = (page, n) => tid(page, 'step-item').nth(n).click()
const versionOf = async (request, tourID) =>
  (await (await request.get(`${API}/Tours(${tourID})`)).json()).version
const docOf = async (request, tourID) =>
  JSON.parse((await (await request.get(`${API}/Tours(${tourID})`)).json()).definition)

test('shows the steps, their targets and a matching preview', async ({ page, request }) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await expect(tid(page, 'step-item')).toHaveCount(7)
  expect(await titles(page)).toEqual([
    'Create an order',
    'Search',
    'Press Create',
    'Customer',
    'Choose status',
    'Press Save',
    'Press Export',
  ])

  await selectStep(page, 2)
  await expect(field(page, 'step-title')).toHaveValue('Press Create')
  await expect(tid(page, 'target-name')).toHaveText('Create')
  await expect(tid(page, 'target-section')).toContainText('found in your files')
  await expect(tid(page, 'preview-title')).toHaveText('Press Create')
  await expect(tid(page, 'bubble-preview')).toContainText('Step 3 of 7')
  await expect(tid(page, 'preview-where')).toContainText('below “Create”')

  await selectStep(page, 0) // the centered intro step has no control
  await expect(tid(page, 'target-section')).toContainText('no control')
  await expect(tid(page, 'preview-where')).toContainText('middle of the screen')
  await expect(tid(page, 'placement-picker')).toHaveCount(0)
})

test('editing text updates the list and the preview, autosaves, and survives a reload', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 2)

  await field(page, 'step-title').fill('Create a new order')
  await field(page, 'step-text').fill('Press **Create** now.\n\n- it opens an empty order')
  await expect(tid(page, 'step-item-title').nth(2)).toHaveText('Create a new order')
  await expect(tid(page, 'preview-title')).toHaveText('Create a new order')
  await expect(tid(page, 'preview-text').locator('strong')).toHaveText('Create')
  await expect(tid(page, 'preview-text').locator('li')).toHaveText('it opens an empty order')
  await expect(tid(page, 'save-state')).toContainText(/Unsaved|Saving|saved/)

  await saved(page)
  expect((await docOf(request, tourID)).steps[2].title).toBe('Create a new order')

  // a second burst of edits is coalesced into the same autosave version
  const v = await versionOf(request, tourID)
  await field(page, 'step-title').fill('Create a new order today')
  await saved(page)
  expect(await versionOf(request, tourID)).toBe(v)

  await page.reload()
  await expect(tid(page, 'step-item-title').nth(2)).toHaveText('Create a new order today')
})

test('undo and redo (buttons and keyboard)', async ({ page, request }) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await expect(tid(page, 'undo')).toHaveAttribute('disabled', '')

  await selectStep(page, 1)
  await field(page, 'step-title').fill('Find orders')
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Find orders')
  await tid(page, 'undo').click()
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Search')
  await tid(page, 'redo').click()
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Find orders')

  await page.locator('body').click({ position: { x: 5, y: 400 } }) // focus outside any field
  await page.keyboard.press('Control+z')
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Search')
  await page.keyboard.press('Control+y')
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Find orders')
})

test('reorders steps with the keyboard and with the mouse, and keeps the order', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)

  // keyboard: focus the grip of step 2, Space picks it up, ArrowDown moves it, Space drops it
  const grip = tid(page, 'step-grip').nth(1)
  await grip.focus()
  await page.keyboard.press('Space')
  await expect(liveRegion(page)).toContainText('moved over droppable area s1')
  await page.keyboard.press('ArrowDown')
  await expect(liveRegion(page)).toContainText('moved over droppable area s2')
  await page.keyboard.press('Space')
  await expect(liveRegion(page)).toContainText('dropped over')
  expect((await titles(page)).slice(0, 4)).toEqual([
    'Create an order',
    'Press Create',
    'Search',
    'Customer',
  ])
  await expect(tid(page, 'bubble-preview')).toContainText(/Step \d of 7/)

  // mouse: drag the last step to the top
  const last = await tid(page, 'step-grip').nth(6).boundingBox()
  const first = await tid(page, 'step-grip').nth(0).boundingBox()
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + 4, (last.y + first.y) / 2, { steps: 8 })
  await page.mouse.move(first.x + 4, first.y - 4, { steps: 12 })
  await page.mouse.up()
  expect((await titles(page))[0]).toBe('Press Export')

  await saved(page)
  const order = (await docOf(request, tourID)).steps.map((s) => s.title)
  expect(order.slice(0, 3)).toEqual(['Press Export', 'Create an order', 'Press Create'])
  await page.reload()
  expect((await titles(page)).slice(0, 3)).toEqual([
    'Press Export',
    'Create an order',
    'Press Create',
  ])
})

test('adds, duplicates and deletes steps (never the last one)', async ({ page, request }) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 1)

  await tid(page, 'step-add').click()
  await expect(tid(page, 'step-item')).toHaveCount(8)
  expect((await titles(page))[2]).toBe('New step') // after the selected step, and selected
  await expect(field(page, 'step-title')).toHaveValue('New step')

  await tid(page, 'step-item').nth(1).locator('[data-testid="step-duplicate"]').click()
  expect((await titles(page))[2]).toBe('Search (copy)')

  await tid(page, 'step-item').nth(2).locator('[data-testid="step-delete"]').click()
  await expect(tid(page, 'step-item')).toHaveCount(8)
  await tid(page, 'step-item').nth(2).locator('[data-testid="step-delete"]').click()
  await expect(tid(page, 'step-item')).toHaveCount(7)

  await saved(page)
  expect((await docOf(request, tourID)).steps).toHaveLength(7)
})

test('points a step at another control with the picker, with search', async ({ page, request }) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 1) // Search -> searchField
  await expect(tid(page, 'target-name')).toHaveText('Search customers')

  await tid(page, 'choose-control').click()
  await expect(tid(page, 'target-picker')).toBeVisible()
  const all = await tid(page, 'target-option').count()
  expect(all).toBeGreaterThan(15)
  await field(page, 'target-search').fill('export')
  await expect(tid(page, 'target-option')).toHaveCount(1)
  await expect(tid(page, 'target-option')).toContainText('Export')
  await expect(tid(page, 'target-option')).toContainText('unstable') // no id
  await field(page, 'target-search').fill('delete')
  await tid(page, 'target-option').first().click()

  await expect(tid(page, 'target-picker')).not.toBeVisible()
  await expect(tid(page, 'target-name')).toHaveText('Delete')
  await expect(tid(page, 'step-item').nth(1)).toContainText('Detail / deleteBtn')
  await saved(page)
  expect((await docOf(request, tourID)).steps[1].target).toMatchObject({
    viewName: 'demo.orders.view.Detail',
    controlId: 'deleteBtn',
  })

  await tid(page, 'remove-target').click() // a centered step
  await expect(tid(page, 'target-section')).toContainText('no control')
  await expect(tid(page, 'step-item').nth(1)).toContainText('no control')
})

test('a step the AI could not attach is flagged until a control is chosen', async ({
  page,
  request,
}) => {
  const { tourID, doc } = await makeTour(request)
  doc.steps[3] = {
    ...doc.steps[3],
    target: undefined,
    meta: {
      source: 'ai',
      confidence: 0,
      unresolved: true,
      note: 'The AI chose a control that does not exist (x / custInput)',
    },
  }
  await request.post(`${API}/saveTour`, {
    data: { tourID, definition: JSON.stringify(doc), note: 'AI draft' },
  })

  await open(page, tourID)
  await expect(tid(page, 'step-item').nth(3)).toContainText('needs review')
  await selectStep(page, 3)
  await expect(tid(page, 'step-unresolved')).toContainText('custInput')

  await tid(page, 'choose-control').click()
  await field(page, 'target-search').fill('customer')
  await tid(page, 'target-option').first().click()
  await expect(tid(page, 'step-unresolved')).toHaveCount(0)
  await expect(tid(page, 'step-item').nth(3)).not.toContainText('needs review')
  await saved(page)
  expect((await docOf(request, tourID)).steps[3].meta.unresolved).toBe(false)
})

test('chooses the bubble position and whether it may flip', async ({ page, request }) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 2)
  await expect(tid(page, 'placement-value')).toContainText('PreferredBottomOrFlip')

  await tid(page, 'placement-Top').click()
  await expect(tid(page, 'placement-value')).toContainText('PreferredTopOrFlip')
  await expect(tid(page, 'preview-where')).toContainText('above “Create”')

  await tid(page, 'placement-flip').click()
  await expect(tid(page, 'placement-value')).toContainText('Top')
  await expect(tid(page, 'placement-value')).not.toContainText('Preferred')
  await expect(tid(page, 'preview-where')).not.toContainText('other side')

  await tid(page, 'placement-Right').click()
  await saved(page)
  expect((await docOf(request, tourID)).steps[2].placement).toBe('Right')
})

test('edits the page a step opens, with suggestions from the manifest and a warning for unknown routes', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 3) // Customer: opens order/new
  await expect(tid(page, 'navigate-toggle')).toHaveAttribute('checked', '')
  await expect(field(page, 'step-hash')).toHaveValue('order/new')
  await expect(tid(page, 'navigation-section')).toContainText('Shows Detail')

  await field(page, 'step-hash').fill('nowhere/1/2')
  await expect(tid(page, 'navigation-section')).not.toContainText('Shows Detail')
  await page.getByRole('tab', { name: /Checks/ }).click()
  await expect(tid(page, 'checks-panel')).toContainText('matches no route')

  await selectStep(page, 4) // Choose status: no navigation of its own
  await expect(tid(page, 'navigate-toggle')).not.toHaveAttribute('checked', '')
  await tid(page, 'navigate-toggle').click()
  await expect(field(page, 'step-hash')).toBeVisible()
  await field(page, 'step-hash').fill('order/7')
  await saved(page)
  expect((await docOf(request, tourID)).steps[4].before).toEqual([
    { type: 'navigate', hash: 'order/7' },
  ])
})

test('the JSON tab shows errors where they are and applies valid edits to the form', async ({
  page,
  request,
}) => {
  const { tourID, doc } = await makeTour(request)
  await open(page, tourID)
  await page.getByRole('tab', { name: 'JSON' }).click()
  const editor = tid(page, 'json-panel').locator('.cm-content')
  await expect(editor).toContainText('"schemaVersion"')

  // valid edits are applied to the working copy immediately
  const edited = structuredClone(doc)
  edited.steps[1].title = 'Typed in JSON'
  await pasteJson(page, JSON.stringify(edited, null, 2))
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Typed in JSON')
  await expect(tid(page, 'json-panel').locator('.cm-lint-marker-error')).toHaveCount(0)

  // invalid: the problem is marked at the exact text, and the working copy keeps its last valid state
  const broken = structuredClone(edited)
  broken.id = ''
  await pasteJson(page, JSON.stringify(broken, null, 2))
  await expect(tid(page, 'json-panel').locator('.cm-lint-marker-error')).not.toHaveCount(0) // the gutter marker (an empty styled element)
  await expect(tid(page, 'json-panel').locator('.cm-lintRange-error').first()).toContainText('""')
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Typed in JSON')

  // a form edit flows back into the text
  await pasteJson(page, JSON.stringify(edited, null, 2))
  await selectStep(page, 1)
  await field(page, 'step-title').fill('Typed in the form')
  await expect(editor).toContainText('Typed in the form')
  await saved(page)
})

test('an invalid working copy is not saved, and the checks say why', async ({ page, request }) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 1)
  const v = await versionOf(request, tourID)

  await field(page, 'step-title').fill('')
  await expect(tid(page, 'save-state')).toContainText('fix the problems')
  await expect(tid(page, 'save-version')).toHaveAttribute('disabled', '')
  await page.getByRole('tab', { name: /Checks/ }).click()
  await expect(tid(page, 'checks-panel')).toContainText('title')
  await page.waitForTimeout(2500) // longer than the autosave delay
  expect(await versionOf(request, tourID)).toBe(v)

  await field(page, 'step-title').fill('Search again')
  await saved(page)
})

test('lists the problems of the tour and jumps to the step', async ({ page, request }) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await expect(tid(page, 'step-item').nth(6)).toContainText('1 warning(s)') // the Export step has no id
  await page.getByRole('tab', { name: /Checks/ }).click()
  await expect(tid(page, 'check-issue')).toHaveCount(1)
  await tid(page, 'check-issue').click()
  await expect(field(page, 'step-title')).toHaveValue('Press Export')
})

test('version history: named versions, restore (undoable), and coalesced autosaves', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 1)
  await field(page, 'step-title').fill('First change')
  await saved(page)

  await tid(page, 'save-version').click()
  await field(page, 'version-note').fill('Reviewed with Anna')
  await tid(page, 'version-save').click()
  await expect(tid(page, 'version-dialog')).not.toBeVisible()
  // the autosave of the same content is labelled, not duplicated
  await expect(tid(page, 'tour-version')).toContainText('v2')

  await tid(page, 'open-history').click()
  const rows = tid(page, 'version-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Reviewed with Anna')
  await expect(rows.nth(0)).toContainText('current')
  await expect(rows.nth(1)).toContainText('Generated by rules')

  await rows.nth(1).locator('[data-testid="version-restore"]').click()
  await expect(tid(page, 'history-dialog')).not.toBeVisible()
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Search')
  await expect(tid(page, 'tour-version')).toContainText('v3')
  await tid(page, 'undo').click() // restoring is just another edit
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('First change')
  await saved(page)
})

test('notices when the tour was changed elsewhere instead of overwriting it', async ({
  page,
  request,
}) => {
  const { tourID, doc } = await makeTour(request)
  await open(page, tourID)
  const other = structuredClone(doc)
  other.title = 'Edited in another tab'
  await request.post(`${API}/saveTour`, {
    data: { tourID, definition: JSON.stringify(other), note: 'Other tab' },
  })

  await selectStep(page, 1)
  await field(page, 'step-title').fill('My edit')
  await expect(tid(page, 'conflict')).toContainText('changed elsewhere', { timeout: 10_000 })
  await expect(tid(page, 'save-state')).toContainText('Changed elsewhere')
  expect((await docOf(request, tourID)).title).toBe('Edited in another tab')
  expect((await docOf(request, tourID)).steps[1].title).toBe('Search') // not overwritten
})

test('asking the AI explains when no provider is configured', async ({ page, request }) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 1)
  await tid(page, 'ask-ai').click()
  await expect(tid(page, 'ai-dialog')).toBeVisible()
  await expect(tid(page, 'ai-unavailable')).toContainText('No AI provider is configured')
  await field(page, 'ai-instruction').fill('make it shorter')
  await expect(tid(page, 'ai-run')).toHaveAttribute('disabled', '')
})

test('asking the AI applies its edit as an undoable change (provider and model call mocked, saving is real)', async ({
  page,
  request,
}) => {
  const { tourID, doc } = await makeTour(request)
  // the e2e server has no AI keys: pretend one provider is configured ...
  await page.route(/providers\(\)/, async (route) => {
    const real = await (await route.fetch()).json()
    await route.fulfill({
      json: {
        ...real,
        value: [
          ...real.value,
          { id: 'fake-ai', label: 'Fake AI', configured: true, model: 'fake-1' },
        ],
      },
    })
  })
  // ... and answer refineStep like the server would after a successful model call: store the edit as a new version
  let asked
  await page.route(/refineStep/, async (route) => {
    asked = route.request().postDataJSON()
    const edited = structuredClone(doc)
    edited.steps[1].title = 'Find orders fast'
    edited.steps[1].text = 'Type a **customer name** to narrow down the list.'
    const saved = await request.post(`${API}/saveTour`, {
      data: { tourID, definition: JSON.stringify(edited), note: `AI: ${asked.instruction}` },
    })
    await route.fulfill({ json: await saved.json() })
  })

  await open(page, tourID)
  await selectStep(page, 1)
  await field(page, 'step-title').fill('My own wording') // unsaved work must be saved before the AI edits
  await tid(page, 'ask-ai').click()
  await expect(tid(page, 'ai-unavailable')).toHaveCount(0)
  await field(page, 'ai-instruction').fill('make it friendlier')
  await tid(page, 'ai-run').click()

  await expect(tid(page, 'ai-dialog')).not.toBeVisible()
  expect(asked).toMatchObject({
    tourID,
    stepID: doc.steps[1].id,
    instruction: 'make it friendlier',
    provider: 'fake-ai',
  })
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('Find orders fast')
  await expect(tid(page, 'preview-text').locator('strong')).toHaveText('customer name')
  await saved(page)

  // the user's own edit was stored before the AI step: it is in the history
  const versions = await (
    await request.get(`${API}/TourVersions?$filter=tour_ID eq ${tourID}&$orderby=version`)
  ).json()
  expect(versions.value.map((v) => v.note)).toEqual([
    'Generated by rules',
    'Autosave',
    'AI: make it friendlier',
  ])
  expect(
    JSON.parse(
      (await (await request.get(`${API}/getTourVersion(tourID=${tourID},version=2)`)).json()).value,
    ).steps[1].title,
  ).toBe('My own wording')

  await tid(page, 'undo').click() // the AI edit is one undo step
  await expect(tid(page, 'step-item-title').nth(1)).toHaveText('My own wording')
})

test('has no serious accessibility violations in the parts TourD renders itself (and the scan can fail)', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request)
  await open(page, tourID)
  await selectStep(page, 2)
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  const scan = () =>
    new AxeBuilder({ page })
      .include('[data-testid="step-list"]') // our own markup: UI5 web components are covered by their own test suite
      .include('[data-testid="bubble-preview"]')
      .disableRules(['color-contrast']) // theme colours come from UI5
      .analyze()
  const serious = (r) =>
    r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)

  const clean = await scan()
  expect(serious(clean)).toEqual([])
  const checked = clean.passes.reduce((n, p) => n + p.nodes.length, 0)
  expect(checked).toBeGreaterThan(20) // it really looked at the step list and the preview

  // sanity: take the accessible name off a drag handle and the scan must complain
  await page.evaluate(() =>
    document.querySelector('[data-testid="step-grip"]').removeAttribute('aria-label'),
  )
  expect(serious(await scan())).toContain('button-name')
})

test('asking for a save while an autosave is still on its way does not conflict with itself', async ({
  page,
  request,
}) => {
  const { tourID } = await makeTour(request)
  let sent = 0
  await page.route(/saveTour/, async (route) => {
    sent++
    if (sent === 1) await new Promise((r) => setTimeout(r, 1500)) // the first request is slow to reach the server
    await route.continue()
  })
  await open(page, tourID)
  await selectStep(page, 1)
  await field(page, 'step-title').fill('Look for orders')
  await expect.poll(() => sent, { timeout: 10_000 }).toBe(1) // the autosave started and is on its way

  // actions that work on the stored tour save first; that must wait for the request that is already under way
  await tid(page, 'open-export').click()
  await expect(tid(page, 'export-ready')).toBeVisible({ timeout: 15_000 })
  await expect(tid(page, 'conflict')).toHaveCount(0)
  await expect(tid(page, 'save-state')).toContainText('All changes saved')
  expect(sent).toBe(1) // nothing was left to save
  expect((await docOf(request, tourID)).steps[1].title).toBe('Look for orders')
})
