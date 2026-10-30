import cds from '@sap/cds'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, it, expect } from 'vitest'
import { demoSources } from '../helpers/sources.js'

const { GET, POST, DELETE } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const fails = (p) =>
  p.then(
    (r) => ({ status: r.status, message: 'unexpected success' }),
    (e) => ({ status: e.response?.status, message: e.response?.data?.error?.message ?? e.message }),
  )

async function setup(recordingFile = 'demo-create-order.tourd.json') {
  const projectID = (await POST(`${BASE}/Projects`, { name: `Tests ${Math.random()}` })).data.ID
  await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
  const rec = (
    await POST(`${BASE}/importRecording`, {
      projectID,
      raw: readFileSync(`test/fixtures/recordings/${recordingFile}`, 'utf8'),
    })
  ).data
  const plan = (
    await POST(`${BASE}/createTestPlan`, {
      projectID,
      recordingID: rec.ID,
      name: 'Create an order',
    })
  ).data
  const doc = async () => JSON.parse((await GET(`${BASE}/TestPlans(${plan.ID})`)).data.definition)
  return { projectID, recordingID: rec.ID, plan, doc }
}

describe('test plans in a project that has wdi5 already', () => {
  const fixture = (dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => ({
        path: join(e.parentPath, e.name)
          .slice(dir.length + 1)
          .split(sep)
          .join('/'),
        content: readFileSync(join(e.parentPath, e.name), 'utf8'),
      }))

  it('reuses the helpers of the project and says so in the preview', async () => {
    const projectID = (await POST(`${BASE}/Projects`, { name: `Existing ${Math.random()}` })).data
      .ID
    const files = [
      ...demoSources().filter((f) => f.path !== 'package.json'),
      ...fixture('test/fixtures/wdi5-projects/cjs-pages'),
    ]
    await POST(`${BASE}/importSources`, { projectID, files, replace: true })
    const rec = (
      await POST(`${BASE}/importRecording`, {
        projectID,
        raw: readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8'),
      })
    ).data
    const plan = (
      await POST(`${BASE}/createTestPlan`, {
        projectID,
        recordingID: rec.ID,
        name: 'Create an order',
      })
    ).data
    const preview = (await POST(`${BASE}/previewTestApply`, { planID: plan.ID })).data
    const existing = JSON.parse(preview.existing)
    expect(existing).toMatchObject({
      config: 'wdio.conf.js',
      framework: 'mocha',
      specFile: 'e2e/specs/create-an-order.spec.js',
    })
    expect(existing.reuse.steps.map((s) => s.name).sort()).toEqual(['searchFor', 'startNewOrder'])
    expect(preview.edits.map((e) => e.path).sort()).toEqual([
      'e2e/helpers/ui5.js',
      'e2e/journeys/create-an-order.journey.js',
      'e2e/specs/create-an-order.spec.js',
    ])

    // one step opts out
    const doc = JSON.parse(plan.definition)
    doc.steps.find((s) => s.locator === 'createBtn' && s.kind === 'press').noReuse = true
    await POST(`${BASE}/saveTestPlan`, {
      planID: plan.ID,
      definition: JSON.stringify(doc),
      baseVersion: 1,
    })
    const again = JSON.parse(
      (await POST(`${BASE}/previewTestApply`, { planID: plan.ID })).data.existing,
    )
    expect(again.reuse.steps.map((s) => s.name)).toEqual(['searchFor'])

    await POST(`${BASE}/applyTestToProject`, { planID: plan.ID })
    const changes = (await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value
    expect(changes.map((c) => c.path).sort()).toEqual([
      'e2e/helpers/ui5.js',
      'e2e/journeys/create-an-order.journey.js',
      'e2e/specs/create-an-order.spec.js',
    ])
  })
})

describe('test plans', () => {
  it('are made from a recording, with the steps, locators and settings', async () => {
    const { plan, doc } = await setup()
    expect(plan).toMatchObject({ name: 'Create an order', version: 1, generator: 'rules' })
    const d = await doc()
    expect(d.steps.some((s) => s.kind === 'press' && s.locator === 'createBtn')).toBe(true)
    expect(d.settings).toMatchObject({ framework: 'mocha', auth: 'none' })
  })

  it('can be checked against the files of the app without a browser', async () => {
    const { plan, doc } = await setup()
    const dry = async () =>
      JSON.parse((await GET(`${BASE}/dryRunTestPlan(planID=${plan.ID})`)).data.value)
    expect((await dry()).summary).toEqual({ found: 5, missing: 0, ambiguous: 0, unchecked: 0 })
    const d = await doc()
    d.locators.createBtn.selector.id = 'renamedInTheView'
    await POST(`${BASE}/saveTestPlan`, {
      planID: plan.ID,
      definition: JSON.stringify(d),
      baseVersion: 1,
    })
    const after = await dry()
    expect(after.summary.missing).toBe(1)
    expect(after.locators.createBtn.note).toMatch(/no control with the id "renamedInTheView"/)
  })

  it('take settings from the caller and refuse invalid ones', async () => {
    const { projectID, recordingID } = await setup()
    const ok = (
      await POST(`${BASE}/createTestPlan`, {
        projectID,
        recordingID,
        settings: JSON.stringify({ framework: 'jasmine', auth: 'basic' }),
      })
    ).data
    expect(JSON.parse(ok.definition).settings).toMatchObject({
      framework: 'jasmine',
      auth: 'basic',
    })
    expect(
      await fails(POST(`${BASE}/createTestPlan`, { projectID, recordingID, settings: '{ nope' })),
    ).toMatchObject({ status: 400, message: /not valid JSON/ })
    expect(
      await fails(
        POST(`${BASE}/createTestPlan`, {
          projectID,
          recordingID,
          settings: JSON.stringify({ framework: 'cypress' }),
        }),
      ),
    ).toMatchObject({ status: 400, message: /settings are not valid/ })
  })

  it('save edits, check them and notice a second writer', async () => {
    const { plan, doc } = await setup()
    const d = await doc()
    d.steps[1].title = 'Look for Acme'
    d.steps[1].edited = true
    const saved = (
      await POST(`${BASE}/saveTestPlan`, {
        planID: plan.ID,
        definition: JSON.stringify(d),
        baseVersion: 1,
      })
    ).data
    expect(saved).toMatchObject({ version: 2, generator: 'manual' })
    expect((await doc()).steps[1].title).toBe('Look for Acme')
    expect(
      await fails(
        POST(`${BASE}/saveTestPlan`, {
          planID: plan.ID,
          definition: JSON.stringify(d),
          baseVersion: 1,
        }),
      ),
    ).toMatchObject({ status: 409 })
    d.steps[1].locator = 'nope'
    expect(
      await fails(
        POST(`${BASE}/saveTestPlan`, {
          planID: plan.ID,
          definition: JSON.stringify(d),
          baseVersion: 2,
        }),
      ),
    ).toMatchObject({ status: 400, message: /Unknown locator/ })
    expect(
      await fails(
        POST(`${BASE}/saveTestPlan`, { planID: plan.ID, definition: '{', baseVersion: 2 }),
      ),
    ).toMatchObject({ status: 400 })
  })

  it('can be rebuilt from the recording, keeping the settings', async () => {
    const { plan, doc } = await setup()
    const d = await doc()
    d.steps[1].title = 'Changed'
    d.settings.framework = 'jasmine'
    await POST(`${BASE}/saveTestPlan`, {
      planID: plan.ID,
      definition: JSON.stringify(d),
      baseVersion: 1,
    })
    await POST(`${BASE}/rebuildTestPlan`, { planID: plan.ID })
    const again = await doc()
    expect(again.steps[1].title).not.toBe('Changed')
    expect(again.settings.framework).toBe('jasmine')
  })

  it('are previewed and written into the project as ordinary changes', async () => {
    const { projectID, plan } = await setup()
    const preview = (await POST(`${BASE}/previewTestApply`, { planID: plan.ID })).data
    expect(preview.ok).toBe(true)
    expect(preview.edits.map((e) => e.path)).toContain('test/e2e/specs/create-an-order.test.js')
    expect((await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value).toEqual([])

    const done = (await POST(`${BASE}/applyTestToProject`, { planID: plan.ID })).data
    expect(done.applied).toBe(preview.edits.length)
    const changes = (await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value
    expect(changes.map((c) => c.path)).toContain('test/e2e/journeys/create-an-order.journey.js')
    expect(changes.find((c) => c.path === 'package.json').status).toBe('modified')
    expect((await POST(`${BASE}/applyTestToProject`, { planID: plan.ID })).data.applied).toBe(0)
  })

  it('can be added and made part of the project at once, so they are no changes', async () => {
    const { projectID, plan } = await setup()
    const done = (await POST(`${BASE}/applyTestToProject`, { planID: plan.ID, accept: true })).data
    expect(done.applied).toBeGreaterThan(0)
    expect((await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value).toEqual([])
    const files = (await GET(`${BASE}/Sources?$filter=project_ID eq ${projectID} and deleted eq false`)).data.value
    expect(files.map((f) => f.path)).toContain('test/e2e/specs/create-an-order.test.js')
    // the plan sees them as there already
    expect((await POST(`${BASE}/applyTestToProject`, { planID: plan.ID })).data.applied).toBe(0)
  })

  it('can be added and only some of the files made part of the project', async () => {
    const { projectID, plan } = await setup()
    await POST(`${BASE}/applyTestToProject`, { planID: plan.ID })
    const changes = (await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value
    const readme = changes.find((c) => c.path === 'test/e2e/README.md')
    const n = (await POST(`${BASE}/acceptChanges`, { projectID, fileIDs: [readme.ID] })).data.value
    expect(n).toBe(1)
    const left = (await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value
    expect(left.map((c) => c.path)).not.toContain('test/e2e/README.md')
    expect(left).toHaveLength(changes.length - 1)
  })

  it('apply only what was accepted, and refuse a plan that cannot work', async () => {
    const { projectID, plan, doc } = await setup()
    const done = (
      await POST(`${BASE}/applyTestToProject`, { planID: plan.ID, paths: ['test/e2e/README.md'] })
    ).data
    expect(done.paths).toEqual(['test/e2e/README.md'])
    const d = await doc()
    d.steps.forEach((s) => (s.enabled = false))
    await POST(`${BASE}/saveTestPlan`, { planID: plan.ID, definition: JSON.stringify(d) })
    const preview = (await POST(`${BASE}/previewTestApply`, { planID: plan.ID })).data
    expect(preview.ok).toBe(false)
    expect(await fails(POST(`${BASE}/applyTestToProject`, { planID: plan.ID }))).toMatchObject({
      status: 409,
      message: /nothing to test/,
    })
    expect(
      (await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value.map((c) => c.path),
    ).toEqual(['test/e2e/README.md'])
  })

  it('go away with their project; unknown ones are 404; direct writes are refused', async () => {
    const { projectID, plan } = await setup()
    expect(
      await fails(
        POST(`${BASE}/TestPlans`, { project_ID: projectID, name: 'x', definition: '{}' }),
      ),
    ).toMatchObject({ status: 405 })
    expect(
      await fails(
        POST(`${BASE}/previewTestApply`, { planID: '00000000-0000-4000-8000-000000000000' }),
      ),
    ).toMatchObject({ status: 404 })
    await DELETE(`${BASE}/Projects(${projectID})`)
    expect(await fails(GET(`${BASE}/TestPlans(${plan.ID})`))).toMatchObject({ status: 404 })
  })
})
