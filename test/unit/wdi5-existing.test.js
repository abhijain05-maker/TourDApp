import vm from 'node:vm'
import * as acorn from 'acorn'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { buildPlan } from '../../srv/lib/wdi5/plan.js'
import { planTestApply } from '../../srv/lib/wdi5/apply.js'
import { patchConfig } from '../../srv/lib/wdi5/config-patch.js'
import { buildCatalogue } from '../../srv/lib/wdi5/catalogue.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const plan = (settings = {}, edit = (p) => p) =>
  edit(
    buildPlan({
      mapped: mapRecording(
        parseRecording(
          readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8'),
        ),
        inventory,
      ),
      inventory,
      name: 'Create an order',
      settings,
    }),
  )
const load = (dir) => {
  const walk = (d) =>
    readdirSync(d).flatMap((name) => {
      const full = join(d, name)
      return statSync(full).isDirectory()
        ? walk(full)
        : [{ path: relative(dir, full).split(sep).join('/'), content: readFileSync(full, 'utf8') }]
    })
  return walk(dir)
}
/** The demo app (for its manifest) with the files of a fixture project next to it. */
const project = (name) => [
  ...demoSources().filter((f) => f.path !== 'package.json'),
  ...load(`test/fixtures/wdi5-projects/${name}`),
]
const after = (files, result) => {
  const map = new Map(files.map((f) => [f.path, f.content]))
  for (const e of result.edits) map.set(e.path, e.after)
  return map
}
const edit = (r, path) => r.edits.find((e) => e.path === path)

/** Runs a CommonJS spec of the project with a fake wdio: what it does to the controls is returned. */
async function runSpec(files, specPath) {
  const calls = []
  const control = (locator) => {
    const id =
      locator.selector.id ?? JSON.stringify(locator.selector.properties ?? locator.selector)
    return new Proxy(
      {},
      {
        get:
          (_, action) =>
          async (...args) => (
            calls.push([id, action, ...args]),
            action === 'getValue' ? '' : undefined
          ),
      },
    )
  }
  const browser = new Proxy(
    {
      asControl: control,
      keys: async (k) => calls.push(['keys', k]),
      pause: async () => {},
      url: async () => {},
    },
    { get: (t, k) => t[k] ?? (async () => {}) },
  )
  const tests = []
  const hooks = []
  const cache = new Map()
  const load = (path) => {
    if (!cache.has(path)) {
      const module = { exports: {} }
      cache.set(path, module)
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const resolve = (spec) => {
        if (!spec.startsWith('.')) return null
        const parts = `${dir}/${spec}`.split('/').filter(Boolean)
        const out = []
        for (const p of parts) p === '..' ? out.pop() : p !== '.' && out.push(p)
        const base = out.join('/')
        return [base, `${base}.js`].find((c) => files.has(c))
      }
      const req = (spec) =>
        spec.startsWith('.')
          ? load(resolve(spec))
          : spec === 'wdio-ui5-service'
            ? { wdi5: { goTo: async () => {} } }
            : {}
      vm.runInNewContext(files.get(path), {
        module,
        exports: module.exports,
        require: req,
        browser,
        expect: Object.assign(() => ({ toHaveUrl: async () => {}, toBe() {} }), {
          stringContaining: (s) => s,
          stringMatching: (s) => s,
        }),
        describe: (n, f) => f(),
        it: (n, f) => tests.push([n, f]),
        xit: () => {},
        before: (f) => hooks.push(f),
        beforeAll: (f) => hooks.push(f),
      })
    }
    return cache.get(path).exports
  }
  load(specPath)
  for (const h of hooks) await h()
  for (const [, f] of tests) await f()
  return calls
}

describe('a project that has wdi5 with page objects and a login helper', () => {
  const files = project('cjs-pages')
  it("puts the new files next to the project's own specs, in the style of the project", async () => {
    const r = await planTestApply({ plan: plan(), files })
    expect(r.ok).toBe(true)
    expect(r.existing).toMatchObject({
      config: 'wdio.conf.js',
      framework: 'mocha',
      esm: false,
      specFile: 'e2e/specs/create-an-order.spec.js',
      journeyFile: 'e2e/journeys/create-an-order.journey.js',
      configReaches: true,
      style: { useTabs: false, tabWidth: 2, singleQuote: true, semi: true },
    })
    expect(r.edits.map((e) => [e.action, e.path]).sort()).toEqual([
      ['add', 'e2e/helpers/ui5.js'],
      ['add', 'e2e/journeys/create-an-order.journey.js'],
      ['add', 'e2e/specs/create-an-order.spec.js'],
    ])
    // not a line of the new files is in the generator's own style
    const journey = edit(r, 'e2e/journeys/create-an-order.journey.js').after
    expect(journey).toContain("require('../pages/main.page')")
    const code = journey.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // titles in comments keep their quotes
    expect(code).not.toMatch(/"/)
    expect(journey).toMatch(/;\n/)
    expect(journey).toMatch(/\n {2}\S/)
    expect(r.notes).toEqual([])
  })

  it('calls what the project already has instead of doing it again', async () => {
    const r = await planTestApply({ plan: plan(), files })
    const journey = edit(r, 'e2e/journeys/create-an-order.journey.js').after
    expect(journey).toContain('await mainPage.startNewOrder();')
    expect(journey).toContain("await mainPage.searchFor('Acme');")
    expect(journey).toContain('createBtn: mainPage.createButton')
    expect(journey).toContain('searchField: mainPage.searchField')
    expect(journey).toContain("const { login } = require('../helpers/login');")
    expect(journey).toMatch(/async function openApp\(\) \{\n {2}await login\(\);/)
    // the project has nothing for these: the generated helpers do it
    expect(journey).toContain("await typeInto(locators.customerInput, 'Acme Corp');")
    expect(journey).toContain("await choose(locators.statusSelect, 'Shipped');")
    expect(r.existing.reuse.steps.map((s) => s.name).sort()).toEqual(['searchFor', 'startNewOrder'])
    expect(r.existing.reuse.setup).toEqual([
      { role: 'login', name: 'login', file: 'e2e/helpers/login.js' },
    ])
  })

  it('a step can opt out of reuse', async () => {
    const p = plan({}, (x) => {
      x.steps.find((s) => s.kind === 'press' && s.locator === 'createBtn').noReuse = true
      return x
    })
    const journey = edit(
      await planTestApply({ plan: p, files }),
      'e2e/journeys/create-an-order.journey.js',
    ).after
    expect(journey).toContain('browser.asControl(locators.createBtn).press();')
    expect(journey).not.toContain('startNewOrder')
  })

  it('what is written does what the recording did (run with a fake browser)', async () => {
    const r = await planTestApply({ plan: plan(), files })
    const all = after(files, r)
    const calls = await runSpec(all, 'e2e/specs/create-an-order.spec.js')
    // the project's own page object ran: it presses createBtn and types into the search field, then Enter
    const acted = calls.filter((c) => !/^get/.test(c[1]))
    expect(acted.map((c) => c.slice(0, 3))).toEqual([
      ['searchField', 'enterText', 'Acme'],
      ['keys', 'Enter'],
      ['createBtn', 'press'],
      ['customerInput', 'enterText', 'Acme Corp'],
      ['statusSelect', 'open'],
      ['{"text":"Shipped"}', 'press'], // the item of the select, found by its text
      ['saveBtn', 'press'],
    ])
  })

  it('is idempotent', async () => {
    const files2 = project('cjs-pages')
    const first = await planTestApply({ plan: plan(), files: files2 })
    const all = [...after(files2, first)].map(([path, content]) => ({ path, content }))
    const again = await planTestApply({ plan: plan(), files: all })
    expect(again.edits.filter((e) => e.action !== 'unchanged')).toEqual([])
    expect(again.notes).toEqual([])
  })
})

describe('a project in ES modules with Jasmine, tabs and no helpers', () => {
  const files = project('esm-plain')
  it('writes ES modules for Jasmine in its style, next to its tests', async () => {
    const r = await planTestApply({ plan: plan({ framework: 'mocha' }), files })
    expect(r.existing).toMatchObject({
      framework: 'jasmine',
      esm: true,
      specFile: 'test/create-an-order.test.js',
      journeyFile: 'test/journeys/create-an-order.journey.js',
      configReaches: true,
    })
    expect(r.notes.map((n) => n.code)).toEqual(['tests.framework'])
    const spec = edit(r, 'test/create-an-order.test.js').after
    expect(spec).toContain("import * as journey from './journeys/create-an-order.journey.js'")
    expect(spec).toContain('beforeAll(')
    expect(spec).toMatch(/\n\tit\(/) // tabs
    expect(spec).not.toMatch(/;\n/)
    const journey = edit(r, 'test/journeys/create-an-order.journey.js').after
    expect(journey).toContain("import { choose, typeInto } from '../helpers/ui5.js'")
    expect(journey).toMatch(/\nexport \{\s*locators,\s*openApp,/)
    expect(edit(r, 'test/helpers/ui5.js').after).toContain('export async function typeInto')
    for (const e of r.edits)
      if (e.path.endsWith('.js'))
        expect(() =>
          acorn.parse(e.after, { ecmaVersion: 'latest', sourceType: 'module' }),
        ).not.toThrow()
    // the config and package.json already fit: untouched
    expect(r.edits.map((e) => e.path)).not.toContain('wdio.conf.js')
    expect(r.edits.map((e) => e.path)).not.toContain('package.json')
  })
})

describe('changing the config as little as possible', () => {
  const info = (text) => buildCatalogue([{ path: 'wdio.conf.js', content: text }]).config
  const want = { specPath: 'tests/e2e/x.test.js', glob: './tests/e2e/**/*.test.js', quote: "'" }

  it('adds the spec glob and the ui5 service, nothing else', () => {
    const text =
      "exports.config = {\n  specs: [\n    './tests/login.js'\n  ],\n  services: ['chromedriver'],\n  framework: 'mocha'\n}\n"
    const out = patchConfig(text, info(text), want)
    expect(out.text).toBe(
      "exports.config = {\n  specs: [\n    './tests/login.js',\n    './tests/e2e/**/*.test.js'\n  ],\n  services: ['chromedriver', 'ui5'],\n  framework: 'mocha'\n}\n",
    )
    expect(out.changes).toEqual([
      '"specs" now also has ./tests/e2e/**/*.test.js',
      'the "ui5" service was added',
    ])
    expect(() => new vm.Script(out.text)).not.toThrow()
  })

  it('works for a one-line list and for ES modules', () => {
    const text = "export const config = { specs: ['./a.js'], services: [] }\n"
    expect(patchConfig(text, info(text), want).text).toBe(
      "export const config = { specs: ['./a.js', './tests/e2e/**/*.test.js'], services: ['ui5'] }\n",
    )
  })

  it('leaves a config alone that already does it, and says when it cannot help', () => {
    const fine = "exports.config = { specs: ['./tests/**/*.test.js'], services: ['ui5'] }"
    const out = patchConfig(fine, info(fine), want)
    expect(out).toMatchObject({ text: fine, changes: [], notes: [] })
    const odd = 'exports.config = { specs: getSpecs(), services: [] }'
    const r = patchConfig(odd, info(odd), want)
    expect(r.notes.join(' ')).toMatch(/not a plain list/)
    expect(r.text).toContain("services: ['ui5']")
    expect(
      patchConfig('exports.config = { specs: [', info('exports.config = { specs: ['), want)
        .notes[0],
    ).toMatch(/could not be read/)
  })

  it('a project whose config misses the new spec gets the patch as a reviewable edit', async () => {
    const files = [
      ...demoSources().filter((f) => f.path !== 'package.json'),
      {
        path: 'wdio.conf.js',
        content:
          "exports.config = {\n  specs: ['./checks/login.js'],\n  services: [],\n  framework: 'mocha'\n}\n",
      },
      {
        path: 'checks/login.js',
        content: 'describe("login", () => { it("x", async () => { await browser.url("/") }) })',
      },
      { path: 'package.json', content: '{"name":"x","devDependencies":{"wdio-ui5-service":"^3"}}' },
    ]
    const r = await planTestApply({ plan: plan(), files })
    // wdio's "specs" lists a file, not a glob: the new spec is added as a glob, and the ui5 service is added
    const config = edit(r, 'wdio.conf.js')
    expect(config).toMatchObject({ action: 'modify' })
    expect(config.after).toContain("'./checks/**/*.test.js'")
    expect(config.after).toContain("services: ['ui5']")
    expect(r.existing.configReaches).toBe(false)
    expect(edit(r, 'package.json').after).toContain('@wdio/mocha-framework')
  })
})
