import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  buildCatalogue,
  detectStyle,
  findReusable,
  findSelector,
  findSetup,
  specGlobMatches,
} from '../../srv/lib/wdi5/catalogue.js'

const load = (dir, base = dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory()
      ? load(full, base)
      : [{ path: relative(base, full).split(sep).join('/'), content: readFileSync(full, 'utf8') }]
  })
const project = (name) => load(`test/fixtures/wdi5-projects/${name}`)

describe('a project with page objects and helpers (CommonJS, Mocha)', () => {
  const c = buildCatalogue(project('cjs-pages'))

  it('knows it is a wdi5 project and reads its config', () => {
    expect(c.wdi5).toBe(true)
    expect(c.config).toMatchObject({
      path: 'wdio.conf.js',
      framework: 'mocha',
      services: ['ui5'],
      specs: ['./e2e/**/*.spec.js'],
      baseUrl: 'http://localhost:8080/index.html',
      esm: false,
    })
    expect(c.esm).toBe(false)
    expect(c.specs.map((s) => s.path)).toEqual(['e2e/specs/orders.spec.js'])
    expect(c.specDir).toBe('e2e/specs')
  })

  it('lists what the helpers do: which control, which action, with which argument', () => {
    const names = c.helpers.flatMap((h) => h.exports.map((e) => `${h.path}:${e.name}`)).sort()
    expect(names).toEqual([
      'e2e/helpers/login.js:login',
      'e2e/pages/main.page.js:searchFor',
      'e2e/pages/main.page.js:startNewOrder',
    ])
    const page = c.helpers.find((h) => h.path.endsWith('main.page.js'))
    const search = page.exports.find((e) => e.name === 'searchFor')
    expect(search).toMatchObject({
      params: ['text'],
      async: true,
      doc: 'Looks for customers.',
      owner: 'MainPage',
      access: { kind: 'module', object: true, hint: 'MainPage' },
    })
    expect(search.uses).toEqual([
      {
        selector: { id: 'searchField', viewName: 'demo.orders.view.Main' },
        action: 'enterText',
        valueParam: 0,
      },
      // browser.keys is not a control action: it is not recorded
    ])
    expect(page.exports.find((e) => e.name === 'startNewOrder').uses).toEqual([
      {
        selector: { id: 'createBtn', viewName: 'demo.orders.view.Main' },
        action: 'press',
        valueParam: null,
      },
    ])
  })

  it('finds the helper that does what a step does', () => {
    const create = { id: 'createBtn', viewName: 'demo.orders.view.Main' }
    expect(findReusable(c, [create], 'press')).toMatchObject({
      file: 'e2e/pages/main.page.js',
      name: 'startNewOrder',
      access: { kind: 'module', object: true },
    })
    expect(
      findReusable(c, [{ id: 'searchField', viewName: 'demo.orders.view.Main' }], 'search'),
    ).toMatchObject({ name: 'searchFor', valueParam: 0 })
    // another control, another action, a select: nothing to reuse
    expect(
      findReusable(c, [{ id: 'saveBtn', viewName: 'demo.orders.view.Detail' }], 'press'),
    ).toBeNull()
    expect(findReusable(c, [create], 'enterText')).toBeNull()
    expect(findReusable(c, [create], 'select')).toBeNull()
    // any of the ways a control can be found counts
    expect(
      findReusable(c, [{ controlType: 'sap.m.Button', viewName: 'x' }, create], 'press').name,
    ).toBe('startNewOrder')
  })

  it('finds selectors the project defines, and setup helpers', () => {
    expect(c.selectors.map((s) => s.name).sort()).toEqual(['createButton', 'searchField'])
    expect(findSelector(c, [{ id: 'createBtn', viewName: 'demo.orders.view.Main' }])).toMatchObject(
      {
        file: 'e2e/pages/main.page.js',
        name: 'createButton',
        access: { kind: 'module', object: true, hint: 'MainPage' },
      },
    )
    expect(findSetup(c)).toMatchObject({
      login: { name: 'login', file: 'e2e/helpers/login.js' },
      open: null,
    })
  })

  it('reads how the code is written', () => {
    expect(c.style).toEqual({ useTabs: false, tabWidth: 2, singleQuote: true, semi: true })
  })
})

describe('a project in ES modules with Jasmine and no helpers', () => {
  const c = buildCatalogue(project('esm-plain'))
  it('is read as such', () => {
    expect(c).toMatchObject({ wdi5: true, esm: true, helpers: [], selectors: [], specDir: 'test' })
    expect(c.config).toMatchObject({
      framework: 'jasmine',
      specs: ['./test/**/*.test.js'],
      esm: true,
    })
    expect(c.style).toEqual({ useTabs: true, tabWidth: 4, singleQuote: true, semi: false })
    expect(findSetup(c)).toEqual({ login: null, open: null })
  })
})

describe('other projects', () => {
  it('a project without wdi5 has no config', () => {
    const c = buildCatalogue([
      { path: 'package.json', content: '{"name":"x"}' },
      { path: 'webapp/Component.js', content: 'sap.ui.define([], function () { browser.x })' },
    ])
    expect(c).toMatchObject({ wdi5: false, config: null, specs: [], helpers: [], specDir: null })
  })

  it('a config that cannot be read, or TypeScript, is reported and not guessed', () => {
    const broken = buildCatalogue([
      { path: 'wdio.conf.js', content: 'exports.config = { specs: [' },
    ])
    expect(broken.config).toMatchObject({ path: 'wdio.conf.js', readable: false })
    const ts = buildCatalogue([{ path: 'test/a.test.ts', content: 'describe("x", () => {})' }])
    expect(ts.typescript).toBe(true)
  })

  it("the app's own code is not a helper", () => {
    const c = buildCatalogue([
      {
        path: 'webapp/controller/Main.controller.js',
        content: 'module.exports = { f() { return sap.ui.Device.browser.name } }',
      },
    ])
    expect(c.helpers).toEqual([])
  })

  it('helpers in ES module form and with arrow functions', () => {
    const c = buildCatalogue([
      {
        path: 'e2e/pages.js',
        content: `export const save = { selector: { id: "saveBtn", viewName: "v.D" } }
/** Press save */
export const pressSave = async () => { await browser.asControl(save).press() }
export async function typeName(name) { const c = await browser.asControl({ selector: { id: "nameInput", viewName: "v.D" } }); await c.enterText(name) }
`,
      },
    ])
    expect(c.helpers[0].exports.map((e) => [e.name, e.uses[0].action, e.doc])).toEqual([
      ['pressSave', 'press', 'Press save'],
      ['typeName', 'enterText', null],
    ])
    expect(c.helpers[0].exports[1].uses[0]).toMatchObject({ valueParam: 0 })
    expect(c.selectors).toEqual([
      {
        name: 'save',
        selector: { id: 'saveBtn', viewName: 'v.D' },
        path: 'e2e/pages.js',
        access: { kind: 'named', object: false, importName: 'save' },
      },
    ])
    expect(c.helpers[0].exports[0].access).toEqual({
      kind: 'named',
      object: false,
      importName: 'pressSave',
    })
  })
})

describe('specGlobMatches / detectStyle', () => {
  it('matches the globs of wdio the way it does', () => {
    expect(specGlobMatches(['./e2e/**/*.spec.js'], '', 'e2e/specs/a.spec.js')).toBe(true)
    expect(specGlobMatches(['./e2e/**/*.spec.js'], '', 'e2e/specs/a.test.js')).toBe(false)
    expect(specGlobMatches(['./test/*.test.js'], '', 'test/a/b.test.js')).toBe(false)
    expect(specGlobMatches(['./test/**/*.test.js'], 'app', 'app/test/x/y.test.js')).toBe(true)
    expect(specGlobMatches(['./test/**/*.test.js'], '', 'test/y.test.js')).toBe(true)
  })

  it('judges spaces, tabs, quotes and semicolons', () => {
    expect(detectStyle(['function a() {\n    const x = "1"\n    return x\n}\n'])).toEqual({
      useTabs: false,
      tabWidth: 4,
      singleQuote: false,
      semi: false,
    })
    expect(detectStyle(["function a() {\n  const x = '1';\n  return x;\n}\n"])).toEqual({
      useTabs: false,
      tabWidth: 2,
      singleQuote: true,
      semi: true,
    })
  })
})
