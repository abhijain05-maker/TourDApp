import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { parseXmlView } from '../../srv/lib/parsers/xml-view.js'
import {
  buildBundle,
  checkExport,
  hostView,
  i18nKeysOf,
  slugOf,
} from '../../srv/lib/export/bundle.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const demoTour = () => JSON.parse(readFileSync('samples/demo-app/webapp/tourd/tour.json', 'utf8'))
const playerSource = readFileSync('player/TourPlayer.js', 'utf8')
const schemaJson = readFileSync('shared/tour.schema.json', 'utf8')
const bundle = (tour = demoTour(), extra = {}) =>
  buildBundle({ tour, inventory, playerSource, schemaJson, ...extra })
const withStep = (patch) => {
  const t = demoTour()
  t.steps[1] = { ...t.steps[1], ...patch }
  return t
}

describe('slugOf', () => {
  it('makes a safe file name', () => {
    expect(slugOf('Create an order!')).toBe('create-an-order')
    expect(slugOf('  ../../etc/passwd ')).toBe('etc-passwd')
    expect(slugOf('Größe & Übersicht')).toBe('gro-e-ubersicht')
    expect(slugOf('')).toBe('tour')
    expect(slugOf('日本語')).toBe('tour')
    expect(slugOf('x'.repeat(200)).length).toBeLessThanOrEqual(50)
  })
})

describe('checkExport', () => {
  it('accepts the demo tour', () => {
    const r = checkExport(demoTour(), inventory)
    expect(r.blocking).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.checkedTargets).toBe(true)
  })

  it('blocks a control that does not exist', () => {
    const r = checkExport(
      withStep({
        target: { viewName: 'demo.orders.view.Main', controlId: 'ghost', fallbacks: [] },
      }),
      inventory,
    )
    expect(r.ok).toBe(false)
    expect(r.blocking[0]).toMatchObject({ code: 'target.notFound' })
    expect(r.blocking[0].stepId).toBeTruthy()
  })

  it('blocks a step that is still flagged as needing a control', () => {
    const r = checkExport(withStep({ meta: { unresolved: true, note: 'AI guessed' } }), inventory)
    expect(r.ok).toBe(false)
    expect(r.blocking.map((b) => b.code)).toContain('export.unresolved')
    expect(r.blocking.find((b) => b.code === 'export.unresolved').message).toContain('AI guessed')
  })

  it('blocks a tour that is not valid', () => {
    const r = checkExport({ schemaVersion: 1, id: 'x', title: '', steps: [] }, inventory)
    expect(r.ok).toBe(false)
    expect(r.blocking.length).toBeGreaterThan(0)
  })

  it('does not block on warnings, and says when it could not look at the controls', () => {
    const noTitle = checkExport(demoTour(), null)
    expect(noTitle.ok).toBe(true)
    expect(noTitle.checkedTargets).toBe(false)
    expect(noTitle.warnings.map((w) => w.code)).toContain('export.unchecked')
  })

  it('survives garbage', () => {
    expect(() => checkExport(null, inventory)).not.toThrow()
    expect(checkExport({}, inventory).ok).toBe(false)
  })
})

describe('buildBundle', () => {
  const b = bundle()
  const unzipped = Object.fromEntries(
    Object.entries(unzipSync(b.zip)).map(([k, v]) => [k, strFromU8(v)]),
  )

  it('contains the player, the tour, the schema, the snippets and a README', () => {
    expect(Object.keys(unzipped).sort()).toEqual([
      'README.md',
      'snippets/AutoStart.controller.js',
      'snippets/Start.controller.js',
      'snippets/Start.view.xml',
      'snippets/manifest.resourceRoots.json',
      'tourd/TourPlayer.js',
      'tourd/tour.json',
      'tourd/tour.schema.json',
    ])
    expect(b.filename).toBe('create-your-first-order-tourd.zip')
  })

  it('ships the player and the tour exactly', () => {
    expect(unzipped['tourd/TourPlayer.js']).toBe(playerSource)
    expect(JSON.parse(unzipped['tourd/tour.json'])).toEqual(demoTour())
    expect(JSON.parse(unzipped['tourd/tour.schema.json']).type).toBe('object')
  })

  it('is the same bytes for the same input', () => {
    expect(Buffer.from(bundle().zip).equals(Buffer.from(b.zip))).toBe(true)
  })

  it('has snippets that are valid code', () => {
    expect(JSON.parse(unzipped['snippets/manifest.resourceRoots.json'])).toEqual({
      'sap.ui5': { resourceRoots: { tourd: './tourd/' } },
    })
    for (const name of ['Start', 'AutoStart'])
      expect(
        () => new vm.Script(`({ ${unzipped[`snippets/${name}.controller.js`]} })`),
        name,
      ).not.toThrow()
    const view = parseXmlView(
      `<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">${unzipped['snippets/Start.view.xml']}</mvc:View>`,
    )
    expect(view.controls[0]).toMatchObject({
      type: 'sap.m.Button',
      localId: 'startTourBtn',
      handlers: { press: 'onStartTour' },
    })
  })

  it('has a start handler that does what the demo app does', () => {
    const start = unzipped['snippets/Start.controller.js']
    expect(start).toContain('sap.ui.require(["tourd/TourPlayer"]')
    expect(start).toContain('sap.ui.require.toUrl("tourd/tour.json")')
    expect(start).toContain('component: oComponent')
  })

  it("writes a README with the app's own names", () => {
    const readme = unzipped['README.md']
    expect(readme).toContain('# Tour "Create your first order" for demo.orders')
    expect(readme).toContain('`demo.orders.view.Main`')
    expect(readme).toContain('`demo.orders.controller.Main`')
    expect(readme).toContain('Copy the folder `tourd/`')
    expect(readme).toContain('1.108')
    expect(readme).not.toContain('PROBLEMS')
  })

  it('auto-start remembers per tour in local storage and never throws when storage is blocked', () => {
    const auto = unzipped['snippets/AutoStart.controller.js']
    expect(auto).toContain(`"tourd.${demoTour().id}.seen"`)
    expect(auto).toMatch(/completed.*skipped/)
    expect(auto.match(/try \{/g).length).toBeGreaterThanOrEqual(2)
  })

  it('refuses a tour with problems, and with force says so loudly', () => {
    const broken = withStep({ meta: { unresolved: true } })
    let error
    try {
      bundle(broken)
    } catch (e) {
      error = e
    }
    expect(error.message).toContain('must be fixed')
    expect(error.check.blocking.length).toBeGreaterThan(0)

    const forced = bundle(broken, { force: true })
    const files = unzipSync(forced.zip)
    expect(strFromU8(files['PROBLEMS.txt'])).toContain('still needs a control')
    expect(strFromU8(files['README.md'])).toContain('Exported with open problems')
  })
})

describe('i18n', () => {
  const tour = () => {
    const t = demoTour()
    t.steps[0].title = '{i18n>tourWelcome}'
    t.steps[0].text = 'See {i18n>create} and {i18n>tourWelcome}.'
    return t
  }

  it('finds the keys a tour refers to', () => {
    const keys = i18nKeysOf(tour())
    expect([...keys.keys()].sort()).toEqual(['create', 'tourWelcome'])
    expect([...keys.get('tourWelcome')]).toEqual([tour().steps[0].id])
  })

  it('lists only the keys the app does not have yet', () => {
    expect(inventory.i18nKeys).toContain('create')
    const files = unzipSync(bundle(tour()).zip)
    expect(strFromU8(files['snippets/i18n.properties'])).toBe('tourWelcome=\n')
    expect(strFromU8(files['README.md'])).toContain('`tourWelcome`')
    expect(strFromU8(files['README.md'])).not.toContain('`create`')
  })

  it('has no i18n file when nothing is missing', () => {
    expect(unzipSync(bundle().zip)['snippets/i18n.properties']).toBeUndefined()
  })
})

describe('hostView', () => {
  it('is the view of the default route', () => {
    expect(hostView(inventory)).toMatchObject({
      viewName: 'demo.orders.view.Main',
      controllerName: 'demo.orders.controller.Main',
    })
  })

  it('falls back to the root view, and to nothing without an inventory', () => {
    expect(
      hostView({ routes: [], rootViewName: 'a.View', views: [{ viewName: 'a.View' }] }),
    ).toMatchObject({
      viewName: 'a.View',
    })
    expect(hostView(null)).toBeNull()
  })

  it('the README still works without an inventory', () => {
    const b = buildBundle({ tour: demoTour(), inventory: null, playerSource, schemaJson })
    expect(strFromU8(unzipSync(b.zip)['README.md'])).toContain('the view of your start page')
  })
})
