import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import {
  patchController,
  patchI18n,
  patchManifest,
  patchView,
  planTourApply,
} from '../../srv/lib/export/apply.js'
import { buildPreviewApp } from '../../srv/lib/preview/model.js'
import { demoSources } from '../helpers/sources.js'

const tour = () => JSON.parse(readFileSync('samples/demo-app/webapp/tourd/tour.json', 'utf8'))
const playerSource = readFileSync('player/TourPlayer.js', 'utf8')

/** The demo app as it was before anyone added a tour to it. */
function plainFiles() {
  return demoSources().map((f) => {
    let content = f.content
    if (f.path.endsWith('/manifest.json')) {
      const m = JSON.parse(content)
      delete m['sap.ui5'].resourceRoots
      content = JSON.stringify(m, null, '\t')
    }
    if (f.path.endsWith('Main.view.xml'))
      content = content.replace(/^\s*<Button id="startTourBtn".*\n/m, '')
    if (f.path.endsWith('Main.controller.js'))
      content = content.replace(/,\s*\/\/ Same shape[\s\S]*$/, '\n\t\t\t});\n\t\t}\n\t);\n')
    return { path: f.path, content }
  })
}
const plan = (files = plainFiles(), t = tour()) =>
  planTourApply({ tour: t, inventory: buildInventory(files), files, playerSource })
const edit = (p, path) => p.edits.find((e) => e.path === path)
/** The files after the plan was applied. */
const applied = (files, p) => {
  const map = new Map(files.map((f) => [f.path, f.content]))
  for (const e of p.edits) map.set(e.path, e.after)
  return map
}

describe('adding a tour to a project', () => {
  it('adds the player and the tour and edits manifest, view and controller', () => {
    const p = plan()
    expect(p.ok).toBe(true)
    expect(p.edits.map((e) => [e.action, e.path])).toEqual([
      ['add', 'webapp/tourd/TourPlayer.js'],
      ['add', 'webapp/tourd/tour.json'],
      ['add', 'webapp/tourd/tour.schema.json'],
      ['modify', 'webapp/manifest.json'],
      ['modify', 'webapp/view/Main.view.xml'],
      ['modify', 'webapp/controller/Main.controller.js'],
    ])
    expect(p.notes).toEqual([])
  })

  it('gives files that are valid after the edits', () => {
    const files = plainFiles()
    const after = applied(files, plan(files))
    expect(JSON.parse(after.get('webapp/manifest.json'))['sap.ui5'].resourceRoots).toEqual({
      tourd: './tourd/',
    })
    expect(after.get('webapp/view/Main.view.xml')).toMatch(
      /<headerContent>\s*<Button id="startTourBtn"[^>]*press="\.onStartTour"/,
    )
    // the controller still runs, and has the handler next to the old methods
    const calls = []
    const sap = {
      ui: {
        define: (deps, f) => calls.push(f({ extend: (name, body) => body }, {}, {}, {}, {})),
      },
    }
    vm.runInNewContext(after.get('webapp/controller/Main.controller.js'), { sap })
    expect(Object.keys(calls[0])).toContain('onStartTour')
    expect(Object.keys(calls[0])).toContain('onSearch')
  })

  it('the sandbox is built from the edited files and still runs a stub for the handler', () => {
    const files = plainFiles()
    const after = applied(files, plan(files))
    const app = buildPreviewApp([...after].map(([path, content]) => ({ path, content })))
    expect(app.files.get('view/Main.view.xml').body).toContain('id="startTourBtn"')
    expect(app.files.get('controller/Main.controller.js').body).toContain('onStartTour')
    expect(app.files.has('tourd/TourPlayer.js')).toBe(false) // the sandbox has its own player
  })

  it('is idempotent: planning again after applying changes nothing', () => {
    const files = plainFiles()
    const first = plan(files)
    const after = applied(files, first)
    const again = plan([...after].map(([path, content]) => ({ path, content })))
    expect(again.edits.filter((e) => e.action !== 'unchanged')).toEqual([])
    expect(again.notes).toEqual([])
  })

  it('leaves a project alone that already has everything (the demo app)', () => {
    const files = demoSources()
    const p = plan(files)
    expect(p.edits.filter((e) => e.action === 'modify' && !/tourd\//.test(e.path))).toEqual([])
  })

  it('keeps the layout of the manifest', () => {
    const text =
      '{\n\t"_version": "1.60.0",\n\t"sap.ui5": {\n\t\t"rootView": { "viewName": "a.View" },\n\t\t"resourceRoots": {\n\t\t\t"other": "./other/"\n\t\t}\n\t}\n}\n'
    const out = patchManifest(text).text
    expect(out).toBe(
      text.replace('"other": "./other/"', '"tourd": "./tourd/",\n\t\t\t"other": "./other/"'),
    )
    const spaces = '{\n  "sap.ui5": {\n    "models": {}\n  }\n}\n'
    expect(patchManifest(spaces).text).toBe(
      '{\n  "sap.ui5": {\n    "resourceRoots": { "tourd": "./tourd/" },\n    "models": {}\n  }\n}\n',
    )
    expect(patchManifest('{ "sap.ui5": {} }').text).toContain('"tourd": "./tourd/"')
    expect(patchManifest('{ nope').error).toMatch(/not valid JSON/)
    expect(
      patchManifest('{ "sap.ui5": { "resourceRoots": { "tourd": "./tourd/" } } }').text,
    ).toBeNull()
  })

  it('puts the button into an existing headerContent, a new one, or says it cannot', () => {
    const page = (inner) =>
      `<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">\n  <Page id="p">${inner}\n  </Page>\n</mvc:View>`
    const withHeader = patchView(
      page('\n    <headerContent>\n      <Button id="a" />\n    </headerContent>'),
    ).text
    expect(withHeader).toContain('<headerContent>\n      <Button id="startTourBtn"')
    expect(patchView(page('\n    <content/>')).text).toContain(
      '  <Page id="p">\n    <headerContent>\n      <Button id="startTourBtn"',
    )
    const prefixed =
      '<mvc:View xmlns:m="sap.m" xmlns:mvc="sap.ui.core.mvc"><m:Page id="p"><m:content/></m:Page></mvc:View>'
    expect(patchView(prefixed).text).toContain('<m:Button id="startTourBtn"')
    expect(
      patchView('<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc"><App id="a"/></mvc:View>')
        .error,
    ).toMatch(/no sap.m Page/)
    expect(patchView('<mvc:View xmlns:mvc="sap.ui.core.mvc"><x/></mvc:View>').error).toMatch(
      /namespace/,
    )
    expect(patchView(withHeader).text).toBeNull()
  })

  it('adds the handler to Controller.extend, to a class and to an empty controller', () => {
    const extend =
      'sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {\n\treturn Controller.extend("a.C", {\n\t\tonInit: function () {}\n\t});\n});\n'
    expect(patchController(extend).text).toContain(
      'onInit: function () {},\n\n\t\tonStartTour: function () {',
    )
    const empty =
      'sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {\n\treturn Controller.extend("a.C", {});\n});\n'
    expect(patchController(empty).text).toContain('onStartTour: function')
    const klass =
      'sap.ui.define(["sap/ui/core/mvc/Controller"], (Controller) => {\n  return class C extends Controller {\n    onInit() {}\n  };\n});\n'
    const out = patchController(klass).text
    expect(out).toContain('    onStartTour() {')
    expect(() => new vm.Script(out)).not.toThrow()
    expect(() => new vm.Script(patchController(extend).text)).not.toThrow()
    expect(patchController(patchController(extend).text).text).toBeNull()
    expect(patchController('this is not (javascript').error).toMatch(/could not be read/)
    expect(patchController('var x = 1;').error).toMatch(/no controller/)
  })

  it('adds the texts the tour uses and the app lacks', () => {
    const out = patchI18n('a=1\nb=2', ['b', 'c.d'])
    expect(out.missing).toEqual(['c.d'])
    expect(out.text).toBe('a=1\nb=2\n\n# added by TourD: fill in the texts of the tour\nc.d=\n')
    expect(patchI18n('a=1\n', ['a']).text).toBeNull()

    const t = tour()
    t.steps[0].title = '{i18n>newTourTitle}'
    const files = plainFiles()
    const p = plan(files, t)
    expect(edit(p, 'webapp/i18n/i18n.properties').after).toMatch(/newTourTitle=\n$/)
  })

  it('stops, with reasons, when the tour is not fit or the project is not an app', () => {
    const t = tour()
    t.steps[1].meta = { unresolved: true }
    expect(plan(plainFiles(), t).ok).toBe(false)
    const noManifest = plainFiles().filter((f) => !f.path.endsWith('manifest.json'))
    const p = plan(noManifest)
    expect(p.ok).toBe(false)
    expect(p.blocking[0].message).toMatch(/manifest\.json/)
  })

  it('says what it could not do instead of guessing', () => {
    const files = plainFiles().map((f) =>
      f.path.endsWith('Main.view.xml')
        ? {
            ...f,
            content: f.content.replace(/<Page\b/g, '<Panel').replace(/<\/Page>/g, '</Panel>'),
          }
        : f,
    )
    const p = plan(files)
    expect(p.edits.some((e) => e.path.endsWith('Main.view.xml'))).toBe(false)
    expect(p.notes.map((n) => n.code)).toContain('apply.view')
    expect(p.edits.some((e) => e.path.endsWith('Main.controller.js'))).toBe(true)
  })

  it('tells when another tour is replaced', () => {
    const files = [
      ...plainFiles(),
      {
        path: 'webapp/tourd/tour.json',
        content: JSON.stringify({ id: 'other', title: 'Old tour' }),
      },
    ]
    expect(plan(files).notes.map((n) => n.code)).toContain('apply.replaces')
  })
})
