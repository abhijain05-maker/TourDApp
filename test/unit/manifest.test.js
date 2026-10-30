import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseManifest, matchRoute } from '../../srv/lib/parsers/manifest.js'

const demo = parseManifest(readFileSync('samples/demo-app/webapp/manifest.json', 'utf8'))
const messy = parseManifest(readFileSync('test/fixtures/messy-app/webapp/manifest.json', 'utf8'))

describe('parseManifest - demo app', () => {
  it('reads app basics', () => {
    expect(demo.appId).toBe('demo.orders')
    expect(demo.minUI5Version).toBe('1.108.0')
    expect(demo.libs).toEqual(['sap.ui.core', 'sap.m', 'sap.ui.layout'])
    expect(demo.rootView).toEqual({ viewName: 'demo.orders.view.App', id: 'app' })
    expect(demo.resourceRoots).toEqual({ tourd: './tourd/' })
    expect(demo.models.find((m) => m.name === 'i18n').bundleName).toBe('demo.orders.i18n.i18n')
    expect(demo.i18nPath).toBe('i18n/i18n.properties')
  })

  it('resolves targets to full view names and routes to views', () => {
    expect(demo.targets.main).toEqual({
      name: 'main',
      viewName: 'demo.orders.view.Main',
      viewId: 'main',
      viewLevel: 1,
    })
    expect(demo.routes.map((r) => [r.name, r.pattern, r.params, r.viewNames])).toEqual([
      ['main', '', [], ['demo.orders.view.Main']],
      ['detail', 'order/{orderId}', ['orderId'], ['demo.orders.view.Detail']],
    ])
  })
})

describe('parseManifest - messy fixture', () => {
  it('handles multi-target routes, per-target viewPath and query params', () => {
    expect(messy.routes[0]).toMatchObject({
      name: 'overview',
      pattern: ':?query:',
      params: [],
      viewNames: ['messy.app.view.Overview'],
    })
    expect(messy.routes[1]).toMatchObject({
      name: 'item',
      params: ['id', 'tab'],
      viewNames: ['messy.app.view.Overview', 'messy.app.view.Child'],
    })
  })

  it('accepts a string rootView and the newer name/path/id target keys', () => {
    const m = parseManifest({
      'sap.app': { id: 'x' },
      'sap.ui5': {
        rootView: 'x.view.App',
        routing: {
          config: { path: 'x.view' },
          targets: { t: { type: 'View', name: 'Home', id: 'home' } },
          routes: [{ name: 'r', pattern: 'a', target: 't' }],
        },
      },
    })
    expect(m.rootView).toEqual({ viewName: 'x.view.App', id: null })
    expect(m.targets.t).toMatchObject({ viewName: 'x.view.Home', viewId: 'home' })
    expect(m.routes[0].viewNames).toEqual(['x.view.Home'])
  })

  it('survives a manifest without routing', () => {
    const m = parseManifest('{"sap.app":{"id":"y"}}')
    expect(m).toMatchObject({ appId: 'y', routes: [], targets: {}, models: [] })
  })
})

describe('matchRoute', () => {
  it('matches hashes in all common notations', () => {
    for (const h of [
      'order/1001',
      '#/order/1001',
      '/order/1001',
      '#order/1001',
      'order/1001?x=1',
    ]) {
      expect(matchRoute(demo.routes, h)).toMatchObject({
        route: { name: 'detail' },
        args: { orderId: '1001' },
      })
    }
  })

  it('matches the empty (default) route', () => {
    for (const h of ['', '#/', '/', '#']) expect(matchRoute(demo.routes, h).route.name).toBe('main')
  })

  it('returns null for unknown hashes', () => {
    expect(matchRoute(demo.routes, 'nowhere/1/2')).toBeNull()
  })

  it('handles multiple params and optional query-only patterns', () => {
    expect(matchRoute(messy.routes, 'item/7/info')).toMatchObject({
      route: { name: 'item' },
      args: { id: '7', tab: 'info' },
    })
    expect(matchRoute(messy.routes, '').route.name).toBe('overview')
  })
})
