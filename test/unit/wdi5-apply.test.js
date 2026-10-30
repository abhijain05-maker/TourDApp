import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { buildPlan } from '../../srv/lib/wdi5/plan.js'
import { planTestApply, projectRoot } from '../../srv/lib/wdi5/apply.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const plan = (settings = {}) =>
  buildPlan({
    mapped: mapRecording(
      parseRecording(readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')),
      inventory,
    ),
    inventory,
    name: 'Create an order',
    settings,
  })
const app = (prefix = '') =>
  demoSources().map((f) => ({ path: prefix + f.path, content: f.content }))

describe('projectRoot', () => {
  it('is the folder above webapp/, or the folder of the manifest', async () => {
    expect(projectRoot('webapp/manifest.json')).toBe('')
    expect(projectRoot('demo-app/webapp/manifest.json')).toBe('demo-app/')
    expect(projectRoot('src/manifest.json')).toBe('src/')
    expect(projectRoot('manifest.json')).toBe('')
    expect(projectRoot('x/webapp/manifest.json', '/e2e-tests/')).toBe('e2e-tests/')
  })
})

describe('planTestApply', () => {
  it('adds the tests next to the app folder', async () => {
    const p = await planTestApply({ plan: plan(), files: app('demo-app/') })
    expect(p.ok).toBe(true)
    expect(p.edits.map((e) => [e.action, e.path])).toEqual([
      ['add', 'demo-app/wdio.conf.js'],
      ['add', 'demo-app/.env.example'],
      ['add', 'demo-app/test/e2e/helpers/ui5.js'],
      ['add', 'demo-app/test/e2e/journeys/create-an-order.journey.js'],
      ['add', 'demo-app/test/e2e/specs/create-an-order.test.js'],
      ['add', 'demo-app/test/e2e/README.md'],
      ['modify', 'demo-app/package.json'], // the demo app has one: scripts and dev dependencies are added
    ])
    expect(p.edits.find((e) => e.path.endsWith('wdio.conf.js')).after).toContain(
      'specs: ["./test/e2e/specs/**/*.test.js"]',
    )
  })

  it('is idempotent: planning again after applying has nothing left to do', async () => {
    const files = app()
    const first = await planTestApply({ plan: plan(), files })
    const after = [...files, ...first.edits.map((e) => ({ path: e.path, content: e.after }))]
    const again = await planTestApply({ plan: plan(), files: after })
    expect(again.edits.filter((e) => e.action !== 'unchanged')).toEqual([])
    expect(again.notes).toEqual([])
  })

  it('leaves an existing wdio config and helpers alone, and merges package.json', async () => {
    const files = [
      ...app(),
      { path: 'wdio.conf.js', content: 'exports.config = {}' },
      { path: 'test/e2e/helpers/ui5.js', content: 'module.exports = { typeInto() {} }' },
      {
        path: 'package.json',
        content: JSON.stringify({ name: 'mine', scripts: { start: 'x' } }, null, 2),
      },
    ]
    const p = await planTestApply({ plan: plan(), files })
    expect(p.edits.map((e) => e.path)).not.toContain('wdio.conf.js')
    expect(p.edits.map((e) => e.path)).not.toContain('test/e2e/helpers/ui5.js')
    expect(p.notes.map((n) => n.code)).toEqual(
      expect.arrayContaining(['tests.config', 'tests.helpers']),
    )
    expect(p.notes.find((n) => n.code === 'tests.helpers').message).toMatch(/no choose/)
    const pkg = p.edits.find((e) => e.path === 'package.json')
    expect(pkg.action).toBe('modify')
    expect(JSON.parse(pkg.after).name).toBe('mine')
    expect(JSON.parse(pkg.after).scripts.start).toBe('x')
  })

  it('replaces an earlier journey, and says when it was edited by hand', async () => {
    const files = app()
    const first = await planTestApply({ plan: plan(), files })
    const journey = first.edits.find((e) => e.path.endsWith('.journey.js'))
    const edited = [
      ...files,
      ...first.edits.map((e) => ({
        path: e.path,
        content: e.path === journey.path ? `${e.after}// mine\n` : e.after,
        edited: e.path === journey.path,
      })),
    ]
    const again = await planTestApply({ plan: plan(), files: edited })
    expect(again.edits.filter((e) => e.action !== 'unchanged').map((e) => e.path)).toEqual([
      journey.path,
    ])
    expect(again.notes.map((n) => n.code)).toContain('tests.edited')
  })

  it('refuses with a reason: no app, nothing switched on, a step without a control', async () => {
    expect((await planTestApply({ plan: plan(), files: [] })).blocking[0].code).toBe(
      'tests.manifest',
    )
    const off = plan()
    off.steps.forEach((s) => (s.enabled = false))
    expect(
      (await planTestApply({ plan: off, files: app() })).blocking.map((b) => b.code),
    ).toContain('tests.empty')
    const lost = plan()
    lost.steps.find((s) => s.kind === 'press').locator = null
    expect((await planTestApply({ plan: lost, files: app() })).blocking[0]).toMatchObject({
      code: 'tests.locator',
    })
  })

  it('a disabled step needs no control', async () => {
    const p = plan()
    const s = p.steps.find((x) => x.kind === 'press')
    s.enabled = false
    s.locator = null
    expect((await planTestApply({ plan: p, files: app() })).ok).toBe(true)
  })

  it('a project without a package.json gets one', async () => {
    const p = await planTestApply({ plan: plan(), files: app() })
    expect(
      JSON.parse(p.edits.find((e) => e.path === 'package.json').after).devDependencies.webdriverio,
    ).toBe('^9')
  })
})
