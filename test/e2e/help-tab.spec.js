import { test, expect } from '@playwright/test'
import { unzipSync } from 'fflate'
import { API, tid } from '../helpers/e2e-tour.js'
import { plainSources, withChanges } from '../helpers/plain-app.js'

// Phase 11: help written in the extension is reviewed in the designer, added to the project's files, downloaded as
// "changes", and unzipped over the app: an end user then has the help (panel, badges, popovers) without TourD.

test('review a topic, add the help to the project, download it and see it in the app', async ({
  page,
  request,
}) => {
  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const project = await post('Projects', {
    name: `Help tab ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  })
  await post('importSources', { projectID: project.ID, files: plainSources(), replace: true })
  const topic = (title, controlId) => ({
    title,
    summary: `About ${title}`,
    text: `Use **${title}**.`,
    note: '',
    links: [],
    target: { viewName: 'demo.orders.view.Main', controlId, fallbacks: [] },
    meta: { source: 'extension', controlType: 'sap.m.Button', screen: 'Orders' },
  })
  const set = await post('saveHelpTopic', {
    projectID: project.ID,
    topic: JSON.stringify(topic('Create Order', 'createBtn')),
  })
  await post('saveHelpTopic', {
    projectID: project.ID,
    helpID: set.ID,
    topic: JSON.stringify(topic('Search orders', 'searchField')),
  })

  await test.step('the Help tab lists the topics with their controls', async () => {
    await page.goto(`/designer/#/projects/${project.ID}?tab=help`)
    await expect(tid(page, 'help-topic-row')).toHaveCount(2)
    await expect(tid(page, 'help-table')).toContainText('Create Order')
    await expect(tid(page, 'help-table')).toContainText('Main · createBtn')
    await expect(tid(page, 'help-table')).toContainText('Orders')
  })

  await test.step('a topic can be edited, with a preview, and AI is only offered when the server has one', async () => {
    await tid(page, 'edit-help-topic').first().click()
    await expect(tid(page, 'help-edit-dialog')).toBeVisible()
    await expect(tid(page, 'help-improve')).toHaveAttribute('disabled', '') // this server has no AI provider
    await expect(tid(page, 'help-edit-dialog')).toContainText('No AI provider is configured')
    await tid(page, 'help-edit-text')
      .locator('textarea')
      .fill('Press **Create** to start a new order.')
    await expect(tid(page, 'help-edit-preview').locator('strong')).toHaveText('Create')
    await tid(page, 'help-edit-save').click()
    await expect(tid(page, 'help-edit-dialog')).toBeHidden()
    const row = (
      await (await request.get(`${API}/HelpSets?$filter=project_ID eq ${project.ID}`)).json()
    ).value[0]
    expect(JSON.parse(row.definition).topics[0].text).toBe('Press **Create** to start a new order.')
  })

  await test.step('the help is added to the files as reviewable diffs', async () => {
    await tid(page, 'add-help-to-project').click()
    await expect(tid(page, 'apply-file')).toHaveCount(6)
    await expect(tid(page, 'apply-dialog')).toContainText('webapp/Component.js')
    await tid(page, 'apply-file').filter({ hasText: 'Component.js' }).getByRole('button').click()
    await expect(tid(page, 'diff-view')).toContainText('HelpLayer.start')
    await tid(page, 'apply-confirm').click()
    await expect(tid(page, 'apply-done')).toContainText('6 file(s) were added')
    await tid(page, 'apply-close').click()
  })

  await test.step('adding it again has nothing to do', async () => {
    await tid(page, 'add-help-to-project').click()
    await expect(tid(page, 'apply-nothing')).toContainText('already has this help')
    await tid(page, 'apply-close').click()
  })

  await test.step('the changes unzipped over the app give end users the help', async () => {
    const zip = await request.get(`/export/project/${project.ID}/changes.zip`)
    expect(zip.ok()).toBe(true)
    const files = unzipSync(new Uint8Array(await zip.body()))
    expect(Object.keys(files).sort()).toEqual([
      'CHANGES.md',
      'webapp/Component.js',
      'webapp/manifest.json',
      'webapp/tourd/HelpLayer.js',
      'webapp/tourd/TourPlayer.js',
      'webapp/tourd/help.json',
      'webapp/tourd/help.schema.json',
    ])
    await withChanges(files, async (url) => {
      await page.goto(`${url}/index.html`)
      await expect(page.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })
      await page.locator('.tourd-help-toggle').click()
      await expect(page.locator('.tourd-help-item')).toHaveCount(2)
      await page.locator('.tourd-help-badge[aria-label="Search orders"]').click()
      await expect(page.locator('.tourd-help-pop')).toContainText('Search orders')
    })
  })

  await test.step('a topic can be deleted', async () => {
    await page.goto(`/designer/#/projects/${project.ID}?tab=help`)
    await tid(page, 'delete-help-topic').last().click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(tid(page, 'help-topic-row')).toHaveCount(1)
  })
})
