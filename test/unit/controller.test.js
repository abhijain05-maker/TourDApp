import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseController } from '../../srv/lib/parsers/controller.js'

const read = (p) => readFileSync(p, 'utf8')
const demo = (n) => parseController(read(`samples/demo-app/webapp/controller/${n}.controller.js`))
const messy = parseController(
  read('test/fixtures/messy-app/webapp/controller/Overview.controller.js'),
)

describe('parseController - demo app', () => {
  it('finds the controller name and its methods with source', () => {
    const main = demo('Main')
    expect(main.controllerName).toBe('demo.orders.controller.Main')
    expect(main.methods.map((m) => m.name)).toEqual([
      'onSearch',
      'onCreate',
      'onItemPress',
      'onExport',
      'onStartTour',
    ])
    expect(main.methods.find((m) => m.name === 'onCreate').source).toContain('navTo("detail"')
    expect(main.methods.find((m) => m.name === 'onSearch').params).toEqual(['oEvent'])
  })

  it('records navigation with the route params and the owning method', () => {
    const main = demo('Main')
    expect(main.navigations).toEqual([
      {
        route: 'detail',
        dynamic: false,
        args: ['orderId'],
        argValues: { orderId: 'new' },
        method: 'onCreate',
      },
      { route: 'detail', dynamic: false, args: ['orderId'], argValues: {}, method: 'onItemPress' },
    ])
    const detail = demo('Detail')
    expect(detail.navigations.map((n) => [n.route, n.method])).toEqual([
      ['main', 'onNavBack'],
      ['main', 'onSave'],
      ['main', 'onConfirmDelete'],
    ])
  })

  it('records fragments loaded with the view id and referenced controls', () => {
    const detail = demo('Detail')
    expect(detail.fragments).toEqual([
      {
        name: 'demo.orders.fragment.ConfirmDialog',
        idMode: 'view',
        idPrefix: null,
        method: 'onOpenDialog',
      },
    ])
    expect(detail.byIds).toEqual(['confirmDialog'])
    expect(detail.routes).toEqual(['detail'])
  })
})

describe('parseController - messy fixture', () => {
  it('handles async methods and helpers outside the class', () => {
    expect(messy.controllerName).toBe('messy.app.controller.Overview')
    expect(messy.methods.map((m) => m.name)).toEqual([
      'onInit',
      'onLive',
      'onItem',
      'onSave',
      '_onItem',
    ])
    expect(messy.methods.find((m) => m.name === 'onSave').async).toBe(true)
  })

  it('flags navTo with a variable route name as dynamic', () => {
    expect(messy.navigations).toEqual([
      {
        route: null,
        dynamic: true,
        args: ['id', 'tab'],
        argValues: { tab: 'info' },
        method: 'onItem',
      },
      { route: 'overview', dynamic: false, args: [], argValues: {}, method: 'onItem' },
    ])
  })

  it('classifies fragment loading styles', () => {
    expect(messy.fragments).toEqual([
      { name: 'messy.app.fragment.Popup', idMode: 'view', idPrefix: null, method: 'onSave' },
      {
        name: 'messy.app.fragment.Inline',
        idMode: 'custom',
        idPrefix: 'customPrefix',
        method: 'onSave',
      },
      { name: 'messy.app.fragment.Inline', idMode: 'view', idPrefix: null, method: 'onSave' },
    ])
  })
})

describe('parseController - robustness', () => {
  it('supports ES class controllers', () => {
    const r = parseController(
      'export default class Main extends Controller { onInit() {} async onPress() { this.getRouter().navTo("x"); } }',
    )
    expect(r.methods.map((m) => m.name)).toEqual(['onInit', 'onPress'])
    expect(r.navigations[0]).toMatchObject({ route: 'x', method: 'onPress' })
  })

  it('reports a parse error instead of throwing', () => {
    const r = parseController('sap.ui.define([], function () { return {')
    expect(r.parseError).toBeTruthy()
    expect(r.methods).toEqual([])
  })

  it('truncates very long method bodies', () => {
    const r = parseController(
      'Controller.extend("a.B", { big: function () { var x = "' + 'y'.repeat(6000) + '"; } })',
    )
    expect(r.methods[0].source.length).toBeLessThan(4100)
    expect(r.methods[0].source).toContain('truncated')
  })
})
