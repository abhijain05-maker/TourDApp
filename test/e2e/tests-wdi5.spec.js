import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import vm from 'node:vm'
import { test, expect } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { API, field, tid } from '../helpers/e2e-tour.js'
import { demoSources } from '../helpers/sources.js'

// Phase 6: a recording becomes wdi5 tests: a plan as a table, edited, added to the project, handed over.

const RECORDING = readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')

async function projectWithRecording(request) {
  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const project = await post('Projects', {
    name: `Wdi5 ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  })
  await post('importSources', { projectID: project.ID, files: demoSources(), replace: true })
  await post('importRecording', { projectID: project.ID, name: 'Create an order', raw: RECORDING })
  return project.ID
}

// the panels of the plan page are closed until opened (only the generated code is open): open the ones a step needs
const openCard = async (page, id) => {
  const toggle = tid(page, id).locator('[data-testid="card-toggle"]').first()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

const pick = async (page, testId, text) => {
  await expect(async () => {
    await tid(page, testId).click()
    await page.locator('ui5-option', { hasText: text }).first().click({ timeout: 2000 })
  }).toPass()
}

test('recording -> test plan -> edit the table -> add to the project -> download', async ({
  page,
  request,
}) => {
  const projectID = await projectWithRecording(request)

  await test.step('a new plan from the recording', async () => {
    await page.goto(`/designer/#/projects/${projectID}?tab=tests`)
    await expect(tid(page, 'tests-tab')).toBeVisible()
    await tid(page, 'new-test-plan').click()
    await tid(page, 'create-test-plan').click()
    await expect(tid(page, 'test-plan-page')).toBeVisible()
    await expect(tid(page, 'plan-name').locator('input')).toHaveValue('Create an order')
    for (const id of ['plan-settings', 'plan-steps', 'plan-locators']) await openCard(page, id)
    await expect(tid(page, 'plan-step')).toHaveCount(11)
    await expect(tid(page, 'plan-locator')).toHaveCount(5)
    await expect(
      tid(page, 'plan-step').locator('ui5-tag', { hasText: 'added by QuickDev' }),
    ).toHaveCount(5)
  })

  await test.step('edit: rename a step, switch a check off, change the framework, add a check', async () => {
    const kind = (k) => page.locator(`[data-testid="plan-step"][data-kind="${k}"]`)
    const press = kind('press').first()
    await press.locator('[data-testid="step-title"]').locator('input').fill('Open the order form')
    await expect(tid(page, 'plan-state')).toContainText('Unsaved changes')
    await expect(press.getByText('changed')).toBeVisible()
    await expect(tid(page, 'plan-apply')).toHaveAttribute('disabled', '') // save first

    await kind('assert').last().locator('ui5-checkbox').click() // the check after Save: back on the start page
    await pick(page, 'plan-framework', 'Jasmine')
    await kind('press').last().locator('[data-testid="add-check"]').click()
    await expect(tid(page, 'plan-step')).toHaveCount(12)

    await page.keyboard.press('Control+s')
    await expect(tid(page, 'plan-state')).toContainText('Saved')
    await expect(tid(page, 'plan-version')).toContainText('v2')
  })

  await test.step('the plan survives a reload', async () => {
    const kind = (k) => page.locator(`[data-testid="plan-step"][data-kind="${k}"]`)
    await page.reload()
    for (const id of ['plan-steps', 'plan-locators']) await openCard(page, id)
    await expect(tid(page, 'plan-step')).toHaveCount(12)
    await expect(kind('press').first().locator('[data-testid="step-title"] input')).toHaveValue(
      'Open the order form',
    )
  })

  await test.step('dry run and the generated code, before anything is added', async () => {
    await expect(tid(page, 'dry-summary')).toContainText('5 control(s) found')
    await expect(
      tid(page, 'plan-locator').first().locator('[data-testid="locator-dry"]'),
    ).toContainText('found in the app')
    await expect(tid(page, 'plan-files')).toBeVisible()
    await expect(tid(page, 'file-tab')).toHaveCount(7)
    await tid(page, 'file-tab').filter({ hasText: 'wdio.conf.js' }).click()
    await expect(tid(page, 'plan-files')).toContainText('exports.config')
    await expect(tid(page, 'run-box')).toContainText('npx wdio run wdio.conf.js')
  })

  await test.step('review the files and add them to the project', async () => {
    await tid(page, 'plan-apply').click()
    await expect(tid(page, 'apply-file').filter({ hasText: 'wdio.conf.js' })).toHaveCount(1)
    await expect(tid(page, 'apply-file').filter({ hasText: 'package.json' })).toContainText(
      'The wdi5 scripts and dev dependencies',
    )
    await tid(page, 'apply-file')
      .filter({ hasText: 'create-an-order.test.js' })
      .getByRole('button')
      .click()
    await expect(tid(page, 'diff-view')).toContainText('Open the order form')
    await tid(page, 'apply-confirm').click()
    await expect(tid(page, 'apply-done')).toBeVisible()
    await tid(page, 'apply-open-workspace').click()
    await expect(tid(page, 'workspace')).toBeVisible()
    await expect(
      tid(page, 'change-row').filter({ hasText: 'create-an-order.test.js' }),
    ).toBeVisible()
  })

  await test.step('what is handed over is what was edited', async () => {
    const zip = await request.get(`/export/project/${projectID}/changes.zip`)
    expect(zip.ok()).toBe(true)
    const files = unzipSync(new Uint8Array(await zip.body()))
    const text = (name) => strFromU8(files[name])
    expect(Object.keys(files).sort()).toEqual([
      '.env.example',
      'CHANGES.md',
      'package.json',
      'test/e2e/README.md',
      'test/e2e/helpers/ui5.js',
      'test/e2e/journeys/create-an-order.journey.js',
      'test/e2e/specs/create-an-order.test.js',
      'wdio.conf.js',
    ])
    expect(text('wdio.conf.js')).toContain('framework: "jasmine"')
    const spec = text('test/e2e/specs/create-an-order.test.js')
    expect(spec).toContain('beforeAll(')
    expect(spec).toContain('it("Open the order form"')
    expect(spec).not.toContain('Back on the start page') // switched off
    for (const name of Object.keys(files).filter((n) => n.endsWith('.js')))
      expect(() => new vm.Script(text(name))).not.toThrow()
    const pkg = JSON.parse(text('package.json'))
    expect(pkg.devDependencies['@wdio/jasmine-framework']).toBe('^9')
    expect(pkg.scripts.wdi5).toBe('wdio run wdio.conf.js')
  })
})

test('a step without a control is shown switched off and keeps the plan from being added when it is switched on', async ({
  page,
  request,
}) => {
  const projectID = await projectWithRecording(request)
  const plan = await (
    await request.post(`${API}/createTestPlan`, {
      data: {
        projectID,
        recordingID: (
          await (await request.get(`${API}/Recordings?$filter=project_ID eq ${projectID}`)).json()
        ).value[0].ID,
        name: 'Broken',
      },
    })
  ).json()
  const doc = JSON.parse(plan.definition)
  const step = doc.steps.find((s) => s.kind === 'press')
  step.locator = null
  await request.post(`${API}/saveTestPlan`, {
    data: { planID: plan.ID, definition: JSON.stringify(doc), baseVersion: 1 },
  })
  await page.goto(`/designer/#/tests/${plan.ID}`)
  await tid(page, 'plan-apply').click()
  await expect(tid(page, 'apply-blocked')).toBeVisible()
  await expect(tid(page, 'apply-dialog').getByText('has no control')).toBeVisible()
  await expect(tid(page, 'apply-confirm')).toHaveAttribute('disabled', '')
})

test('the test plan page has no serious accessibility violations', async ({ page, request }) => {
  const projectID = await projectWithRecording(request)
  await page.goto(`/designer/#/projects/${projectID}?tab=tests`)
  await tid(page, 'new-test-plan').click()
  await tid(page, 'create-test-plan').click()
  for (const id of ['plan-settings', 'plan-steps', 'plan-locators']) await openCard(page, id)
  await expect(tid(page, 'plan-step')).toHaveCount(11)
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  const result = await new AxeBuilder({ page })
    .include('[data-testid="test-plan-page"]')
    .disableRules(['color-contrast'])
    .analyze()
  expect(
    result.violations
      .filter((v) => ['serious', 'critical'].includes(v.impact))
      .map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 140)}`),
  ).toEqual([])
})

test('in a project that has wdi5 the plan says what it reuses, and a step can opt out', async ({
  page,
  request,
}) => {
  const fixture = 'test/fixtures/wdi5-projects/cjs-pages'
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
    )
  const files = [
    ...demoSources().filter((f) => f.path !== 'package.json'),
    ...walk(fixture).map((p) => ({
      path: p
        .slice(fixture.length + 1)
        .split(sep)
        .join('/'),
      content: readFileSync(p, 'utf8'),
    })),
  ]
  const post = async (path, data) => {
    const r = await request.post(`${API}/${path}`, { data })
    expect(r.ok(), `${path}: ${await r.text()}`).toBe(true)
    return r.json()
  }
  const project = await post('Projects', { name: `Wdi5 existing ${Date.now()}` })
  await post('importSources', { projectID: project.ID, files, replace: true })
  const rec = await post('importRecording', {
    projectID: project.ID,
    name: 'Create an order',
    raw: RECORDING,
  })
  const plan = await post('createTestPlan', {
    projectID: project.ID,
    recordingID: rec.ID,
    name: 'Create an order',
  })

  await page.goto(`/designer/#/tests/${plan.ID}`)
  await expect(tid(page, 'plan-existing')).toContainText('already has wdi5')
  await expect(tid(page, 'plan-existing')).toContainText('e2e/specs/create-an-order.spec.js')
  await openCard(page, 'plan-steps')
  await expect(tid(page, 'step-reuse')).toHaveCount(2)
  await expect(tid(page, 'step-reuse').first()).toContainText('searchFor() of your project')

  await page.getByRole('link', { name: 'Do not use it' }).first().click()
  await expect(tid(page, 'plan-state')).toContainText('Unsaved changes')
  await page.keyboard.press('Control+s')
  await expect(tid(page, 'plan-state')).toContainText('Saved')
  await expect(tid(page, 'step-reuse')).toHaveCount(1)
  await expect(page.getByText('writes its own code')).toBeVisible()

  await tid(page, 'plan-apply').click()
  await expect(tid(page, 'apply-file')).toHaveCount(3)
  await tid(page, 'apply-file')
    .filter({ hasText: 'create-an-order.journey.js' })
    .getByRole('button')
    .click()
  await expect(tid(page, 'diff-view')).toContainText('mainPage')
  await tid(page, 'apply-confirm').click()
  await expect(tid(page, 'apply-done')).toBeVisible()
})
