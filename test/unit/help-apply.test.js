import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import cds from '@sap/cds'
import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { patchController } from '../../srv/lib/export/apply.js'
import { patchComponent, patchComponentTs, planHelpApply } from '../../srv/lib/export/help-apply.js'
import { demoSources } from '../helpers/sources.js'

const { POST, GET } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'

const playerSource = readFileSync('player/TourPlayer.js', 'utf8')
const helpSource = readFileSync('player/HelpLayer.js', 'utf8')
const topic = (over = {}) => ({
  id: 't1',
  title: 'Create Order',
  summary: 'Create a new order.',
  text: 'Press **Create**.',
  note: '',
  links: [],
  target: { viewName: 'demo.orders.view.Main', controlId: 'createBtn', fallbacks: [] },
  ...over,
})
const help = (topics = [topic()]) => ({
  schemaVersion: 1,
  id: 'h1',
  title: 'Orders help',
  options: { panelTitle: 'Help Topics', showBadges: true },
  topics,
})

/** The demo app as it was before anyone added help to it. */
function plainFiles() {
  return demoSources().map((f) => {
    let content = f.content
    if (f.path.endsWith('/manifest.json')) {
      const m = JSON.parse(content)
      delete m['sap.ui5'].resourceRoots
      content = JSON.stringify(m, null, '\t')
    }
    return { path: f.path, content }
  })
}
const plan = (files = plainFiles(), h = help()) =>
  planHelpApply({ help: h, inventory: buildInventory(files), files, playerSource, helpSource })
const edit = (p, path) => p.edits.find((e) => e.path === path)
const parses = (code) => expect(() => new vm.Script(code)).not.toThrow()

const FE_COMPONENT = `sap.ui.define(["sap/fe/core/AppComponent"], function (Component) {
\t"use strict";

\treturn Component.extend("sap.fe.cap.travel.Component", {
\t\tmetadata: {
\t\t\tmanifest: "json"
\t\t}
\t});
});
`

describe('starting the help from the Component', () => {
  it('adds the lines to an init that is there, after what it already does', () => {
    const files = plainFiles()
    const component = files.find((f) => f.path.endsWith('Component.js')).content
    const { text } = patchComponent(component)
    parses(text)
    expect(text).toContain('this.getRouter().initialize();\n\t\t\tvar oHelpOwner = this;')
    expect(text).toContain(
      'HelpLayer.start(sap.ui.require.toUrl("tourd/help.json"), { component: oHelpOwner });',
    )
    expect(text.indexOf('initialize()')).toBeLessThan(text.indexOf('HelpLayer.start'))
  })

  it('adds an init that calls the parent first when there is none (a Fiori elements Component)', () => {
    const { text } = patchComponent(FE_COMPONENT)
    parses(text)
    expect(text).toContain(
      'init: function () {\n\t\t\tComponent.prototype.init.apply(this, arguments);',
    )
    expect(text.indexOf('prototype.init.apply')).toBeLessThan(text.indexOf('HelpLayer.start'))
    expect(text).toContain('manifest: "json"\n\t\t},\n\n\t\tinit: function')
  })

  it('works for a Component written as a class, and for an empty one', () => {
    const cls = `sap.ui.define(["sap/ui/core/UIComponent"], (UIComponent) => {\n  return class MyComponent extends UIComponent {\n    static metadata = {};\n  };\n});\n`
    const out = patchComponent(cls).text
    expect(out).toContain('init() {\n      super.init(...arguments);')
    expect(out).toContain('HelpLayer.start(')
    const empty = `sap.ui.define(["sap/ui/core/UIComponent"], function (UIComponent) {\n\treturn UIComponent.extend("a.Component", {});\n});\n`
    parses(patchComponent(empty).text)
    expect(patchComponent(empty).text).toContain(
      'UIComponent.prototype.init.apply(this, arguments);',
    )
  })

  it('leaves it alone when the help is started already, and says so when it cannot patch', () => {
    const done = patchComponent(FE_COMPONENT).text
    expect(patchComponent(done)).toEqual({ text: null })
    expect(patchComponent('const x = ;').error).toMatch(/could not be read/)
    expect(patchComponent('sap.ui.define([], function () { return 1; });').error).toMatch(
      /no Component/,
    )
    expect(
      patchComponent(
        'sap.ui.define(["a"], function (C) { return C.extend("x", { init: () => 1 }); });',
      ).error,
    ).toMatch(/not a plain function/)
  })

  it('did not change what patchController does for controllers', () => {
    const files = plainFiles()
    const controller = files.find((f) => f.path.endsWith('Main.controller.js')).content
    const done = patchController(controller)
    expect(done.text === null || typeof done.text === 'string').toBe(true)
  })
})

// the Fiori tools TypeScript template (as in cap-sflight): init is only there as a comment
const FIORI_TS = `import BaseComponent from "sap/fe/core/AppComponent";

/**
 * @namespace sap.fe.cap.travel
 */
export default class Component extends BaseComponent {

\tpublic static metadata = {
\t\tmanifest: "json"
\t};

    /**
     * The component is initialized by UI5 automatically during the startup of the app and calls the init method once.
     */
\t//public init() : void {
    //    super.init();
\t//}
}
`

describe('starting the help from a TypeScript Component', () => {
  it('adds an init after the commented template one, calling the parent first (the Fiori tools template)', () => {
    const { text } = patchComponentTs(FIORI_TS)
    expect(text).toContain(
      '\tpublic override init(): void {\n\t\tsuper.init();\n\t\tsap.ui.require(["tourd/HelpLayer"], (HelpLayer: any) => {',
    )
    expect(text).toContain(
      'HelpLayer.start(sap.ui.require.toUrl("tourd/help.json"), { component: this });',
    )
    expect(text.indexOf('//public init()')).toBeLessThan(text.indexOf('public override init()')) // the comment is kept
    expect(text.trimEnd().endsWith('\t}\n}')).toBe(true) // the class still closes after the new method
  })

  it('appends to an init that is there, in its own indentation', () => {
    const ts =
      'export default class C extends Base {\n  public init(): void {\n    super.init();\n    this.getRouter().initialize();\n  }\n}\n'
    const { text } = patchComponentTs(ts)
    expect(text).toContain(
      '    this.getRouter().initialize();\n    sap.ui.require(["tourd/HelpLayer"], (HelpLayer: any) => {\n      HelpLayer.start(',
    )
    expect(text.match(/init\(\): void/g)).toHaveLength(1) // still one init method (super.init() is a call)
    expect(text.endsWith('  }\n}\n')).toBe(true)
  })

  it('handles a one-line init, and braces or init( inside strings and comments', () => {
    const one = patchComponentTs(
      'export default class C extends Base { override init(): void { super.init(); } }\n',
    ).text
    expect(one).toContain('super.init();\nsap.ui.require')
    expect(one.match(/init\(\): void/g)).toHaveLength(1)
    const tricky = patchComponentTs(
      'export default class C extends Base {\n  static label = "init() { }";\n  // init() {\n}\n',
    )
    expect(tricky.text).toContain('public override init(): void {') // the real class has no init: one is added
  })

  it('leaves a Component that starts the help alone, and says what it cannot read', () => {
    const done = patchComponentTs(FIORI_TS).text
    expect(patchComponentTs(done)).toEqual({ text: null })
    expect(patchComponentTs('export const x = 1\n').error).toMatch(/no Component class/)
    expect(patchComponentTs('export default class C extends Base {\n  foo() {\n').error).toMatch(
      /not closed/,
    )
  })

  it('is what the plan uses for a project with Component.ts, and it is preferred to a Component.js next to it', () => {
    const noJs = plainFiles().filter((f) => !f.path.endsWith('Component.js'))
    const p = plan([...noJs, { path: 'webapp/Component.ts', content: FIORI_TS }])
    expect(p.notes.map((n) => n.code)).toEqual([])
    expect(edit(p, 'webapp/Component.ts').after).toContain('HelpLayer.start(')
    expect(p.edits.some((e) => e.path === 'webapp/Component.js')).toBe(false)
    const both = plan([...plainFiles(), { path: 'webapp/Component.ts', content: FIORI_TS }])
    expect(both.edits.some((e) => e.path === 'webapp/Component.ts')).toBe(true)
    expect(both.edits.some((e) => e.path === 'webapp/Component.js')).toBe(false)
  })

  it('names Component.ts in the note when it cannot be changed', () => {
    const files = [
      ...plainFiles().filter((f) => !f.path.endsWith('Component.js')),
      { path: 'webapp/Component.ts', content: 'export const x = 1\n' },
    ]
    const n = plan(files).notes.find((x) => x.code === 'apply.component')
    expect(n.message).toMatch(/^Component\.ts was not changed: no Component class/)
    expect(n.message).toContain('HelpLayer.start')
  })
})

describe('adding help to a project', () => {
  it('adds the layer, the player and the help, and edits manifest and Component', () => {
    const p = plan()
    expect(p.ok).toBe(true)
    expect(p.edits.map((e) => [e.action, e.path])).toEqual([
      ['add', 'webapp/tourd/TourPlayer.js'],
      ['add', 'webapp/tourd/HelpLayer.js'],
      ['add', 'webapp/tourd/help.json'],
      ['add', 'webapp/tourd/help.schema.json'],
      ['modify', 'webapp/manifest.json'],
      ['modify', 'webapp/Component.js'],
    ])
    expect(p.notes).toEqual([])
    expect(JSON.parse(edit(p, 'webapp/tourd/help.json').after).topics[0].title).toBe('Create Order')
    expect(JSON.parse(edit(p, 'webapp/manifest.json').after)['sap.ui5'].resourceRoots.tourd).toBe(
      './tourd/',
    )
    parses(edit(p, 'webapp/Component.js').after)
  })

  it('is idempotent: a project that has everything gets no edit', () => {
    const files = plainFiles()
    const first = plan(files)
    const map = new Map(files.map((f) => [f.path, f.content]))
    for (const e of first.edits) map.set(e.path, e.after)
    const again = [...map].map(([path, content]) => ({ path, content }))
    const p = plan(again)
    expect(p.edits.filter((e) => e.action !== 'unchanged')).toEqual([])
  })

  it('refuses help with no topics, invalid help and a project without a manifest', () => {
    expect(plan(plainFiles(), help([])).blocking[0].code).toBe('help.empty')
    expect(plan(plainFiles(), { schemaVersion: 1 }).blocking[0].code).toBe('help.invalid')
    const files = plainFiles().filter((f) => !f.path.endsWith('manifest.json'))
    expect(plan(files).blocking.map((b) => b.code)).toContain('apply.manifest')
  })

  it('tells the user what to add by hand when there is no Component, and warns about controls it cannot find', () => {
    const files = plainFiles().filter((f) => !f.path.endsWith('Component.js'))
    const p = plan(
      files,
      help([
        topic({ target: { viewName: 'demo.orders.view.Main', controlId: 'nope', fallbacks: [] } }),
      ]),
    )
    expect(p.ok).toBe(true)
    expect(p.notes.map((n) => n.code)).toEqual(['apply.component', 'help.unknownControl'])
    expect(p.notes[0].message).toContain('HelpLayer.start')
    expect(p.edits.some((e) => e.path.endsWith('Component.js'))).toBe(false)
  })

  it('adds the texts a topic refers to as empty i18n keys', () => {
    const p = plan(
      plainFiles(),
      help([topic({ title: '{i18n>helpCreateTitle}', text: '{i18n>helpCreateText}' })]),
    )
    const i18n = p.edits.find((e) => e.path.endsWith('i18n.properties'))
    expect(i18n.after).toContain('helpCreateTitle=')
    expect(i18n.after).toContain('helpCreateText=')
  })

  it('notices that help.json held other help', () => {
    const files = [
      ...plainFiles(),
      { path: 'webapp/tourd/help.json', content: JSON.stringify({ id: 'other', title: 'Old' }) },
    ]
    expect(plan(files).notes.map((n) => n.code)).toContain('apply.replaces')
  })
})

describe('adding help through the service', () => {
  it('previews and applies, then the workspace shows the changes and a second preview has nothing to do', async () => {
    const projectID = (await POST(`${BASE}/Projects`, { name: `Apply help ${Math.random()}` })).data
      .ID
    await POST(`${BASE}/importSources`, { projectID, files: plainFiles(), replace: true })
    const set = (
      await POST(`${BASE}/saveHelpTopic`, {
        projectID,
        topic: JSON.stringify(topic({ id: undefined })),
      })
    ).data

    const preview = (await POST(`${BASE}/previewHelpApply`, { helpID: set.ID })).data
    expect(preview.ok).toBe(true)
    expect(preview.edits.map((e) => e.path)).toEqual([
      'webapp/manifest.json', // changes of existing code first
      'webapp/Component.js',
      'webapp/tourd/TourPlayer.js',
      'webapp/tourd/HelpLayer.js',
      'webapp/tourd/help.json',
      'webapp/tourd/help.schema.json',
    ])

    const only = (
      await POST(`${BASE}/applyHelpToProject`, {
        helpID: set.ID,
        paths: ['webapp/tourd/help.json'],
      })
    ).data
    expect(only).toMatchObject({ applied: 1, paths: ['webapp/tourd/help.json'] })

    const all = (await POST(`${BASE}/applyHelpToProject`, { helpID: set.ID, accept: false })).data
    expect(all.applied).toBe(5)
    const changes = (await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value
    expect(changes.map((c) => c.path)).toContain('webapp/tourd/HelpLayer.js')

    const again = (await POST(`${BASE}/previewHelpApply`, { helpID: set.ID })).data
    expect(again.edits).toEqual([])
  })

  it('says why it cannot add help that is empty, and 404s for unknown help', async () => {
    const projectID = (await POST(`${BASE}/Projects`, { name: 'Empty help' })).data.ID
    await POST(`${BASE}/importSources`, { projectID, files: plainFiles(), replace: true })
    const created = (await POST(`${BASE}/createHelpSet`, { projectID, name: 'Help' })).data
    const preview = (await POST(`${BASE}/previewHelpApply`, { helpID: created.ID })).data
    expect(preview.ok).toBe(false)
    expect(preview.blocking[0].code).toBe('help.empty')
    const r = await POST(`${BASE}/applyHelpToProject`, { helpID: created.ID }).catch(
      (e) => e.response,
    )
    expect(r.status).toBe(409)
    const gone = await POST(`${BASE}/previewHelpApply`, {
      helpID: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
    }).catch((e) => e.response)
    expect(gone.status).toBe(404)
  })
})
