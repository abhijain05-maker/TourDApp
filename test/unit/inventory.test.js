import { describe, it, expect } from 'vitest'
import { buildInventory, indexInventory, classifySource } from '../../srv/lib/context/inventory.js'
import { demoSources, messySources } from '../helpers/sources.js'

const control = (inv, viewName, localId, extra = {}) =>
  inv.controls.find(
    (c) =>
      c.viewName === viewName &&
      c.localId === localId &&
      Object.entries(extra).every(([k, v]) => c[k] === v),
  )

describe('classifySource', () => {
  it('classifies by file name', () => {
    expect(classifySource('webapp/manifest.json')).toBe('manifest')
    expect(classifySource('manifest.json')).toBe('manifest')
    expect(classifySource('webapp/view/Main.view.xml')).toBe('view')
    expect(classifySource('webapp/fragment/X.fragment.xml')).toBe('fragment')
    expect(classifySource('webapp/controller/Main.controller.js')).toBe('controller')
    expect(classifySource('webapp/controller/Main.controller.ts')).toBe('controller')
    expect(classifySource('webapp/i18n/i18n_de.properties')).toBe('i18n')
    expect(classifySource('webapp/Component.js')).toBe('other')
  })
})

describe('buildInventory - demo app', () => {
  const inv = buildInventory(demoSources())

  it('derives app basics and view names from paths', () => {
    expect(inv.appId).toBe('demo.orders')
    expect(inv.minUI5Version).toBe('1.108.0')
    expect(inv.i18nModel).toBe('i18n')
    expect(inv.views.map((v) => v.viewName)).toEqual([
      'demo.orders.view.App',
      'demo.orders.view.Detail',
      'demo.orders.view.Main',
    ])
    expect(inv.warnings).toEqual([])
  })

  it('links views to routes, manifest view ids and controllers', () => {
    const main = inv.views.find((v) => v.viewName === 'demo.orders.view.Main')
    expect(main).toMatchObject({
      viewId: 'main',
      routes: ['main'],
      controllerName: 'demo.orders.controller.Main',
    })
    expect(inv.views.find((v) => v.viewName === 'demo.orders.view.Detail').routes).toEqual([
      'detail',
    ])
  })

  it('resolves i18n text and labels for controls', () => {
    expect(control(inv, 'demo.orders.view.Main', 'createBtn')).toMatchObject({
      type: 'sap.m.Button',
      text: 'Create',
      display: 'Create',
      hasStableId: true,
      handlers: { press: 'onCreate' },
    })
    expect(control(inv, 'demo.orders.view.Detail', 'customerInput')).toMatchObject({
      type: 'sap.m.Input',
      label: 'Customer',
      display: 'Customer',
    })
    expect(control(inv, 'demo.orders.view.Detail', 'statusSelect').display).toBe('Status')
    expect(control(inv, 'demo.orders.view.Main', 'searchField').placeholder).toBe(
      'Search customers',
    )
  })

  it('keeps an id-less interactive control and flags it unstable', () => {
    const exp = inv.controls.find(
      (c) => c.viewName === 'demo.orders.view.Main' && c.localId === null,
    )
    expect(exp).toMatchObject({ type: 'sap.m.Button', display: 'Export', hasStableId: false })
  })

  it('drops id-less non-interactive controls and template cells', () => {
    expect(inv.controls.some((c) => c.type === 'sap.m.Column')).toBe(false)
    expect(inv.controls.filter((c) => c.template)).toEqual([])
  })

  it('maps fragment controls to the view whose controller loads them', () => {
    expect(inv.fragments).toEqual([
      {
        fragmentName: 'demo.orders.fragment.ConfirmDialog',
        path: 'webapp/fragment/ConfirmDialog.fragment.xml',
        hosts: [{ viewName: 'demo.orders.view.Detail', idMode: 'view', idPrefix: null }],
      },
    ])
    expect(control(inv, 'demo.orders.view.Detail', 'confirmBtn')).toMatchObject({
      scope: 'fragment',
      display: 'Delete',
      fragmentName: 'demo.orders.fragment.ConfirmDialog',
    })
  })

  it('exposes controller facts and the route table', () => {
    expect(
      inv.controllers
        .find((c) => c.controllerName === 'demo.orders.controller.Detail')
        .methods.map((m) => m.name),
    ).toContain('onOpenDialog')
    expect(inv.routes.map((r) => r.name)).toEqual(['main', 'detail'])
  })

  it('is JSON-serialisable and indexable', () => {
    const copy = JSON.parse(JSON.stringify(inv))
    const idx = indexInventory(copy)
    expect(idx.byLocalId.get('createBtn')).toHaveLength(1)
    expect(idx.byViewId.get('detail')).toBe('demo.orders.view.Detail')
  })
})

describe('buildInventory - messy fixture', () => {
  const inv = buildInventory(messySources())
  const O = 'messy.app.view.Overview'

  it('resolves labels, placeholders and i18n (including continuation lines)', () => {
    expect(control(inv, O, 'nameInput')).toMatchObject({
      label: 'Name',
      placeholder: 'Your name',
      display: 'Name',
    })
    expect(control(inv, O, 'saveBtn').display).toBe('Save changes')
    expect(control(inv, 'messy.app.view.Child', 'childTitle').display).toBe('Child view')
  })

  it('keeps custom controls and id-less buttons, drops html and dynamic text', () => {
    expect(control(inv, O, 'special').type).toBe('messy.app.control.Special')
    expect(inv.controls.find((c) => c.display === 'No id here')).toMatchObject({
      localId: null,
      hasStableId: false,
    })
    expect(inv.controls.some((c) => c.type.includes('html'))).toBe(false)
    expect(inv.controls.some((c) => c.type === 'sap.m.Text' && c.localId === null)).toBe(false)
  })

  it('flags template controls as unstable', () => {
    expect(control(inv, O, 'cellText')).toMatchObject({ template: true, hasStableId: false })
    expect(control(inv, O, 'listItem')).toMatchObject({ template: true, hasStableId: false })
    expect(control(inv, O, 'table')).toMatchObject({ template: false, hasStableId: true })
  })

  it('supports multi-target routes', () => {
    expect(inv.views.find((v) => v.viewName === 'messy.app.view.Child')).toMatchObject({
      viewId: 'childView',
      routes: ['item'],
    })
    expect(inv.views.find((v) => v.viewName === O).nestedViews).toEqual(['messy.app.view.Child'])
  })

  it('gives a fragment one control set per way it is loaded, with its global id when not view-local', () => {
    const inline = inv.controls.filter((c) => c.localId === 'inlineBtn')
    expect(inline).toHaveLength(2)
    expect(inline.find((c) => c.viewName === O)).toMatchObject({
      scope: 'fragment',
      display: 'Inline fragment button',
    })
    expect(inline.find((c) => c.viewName === null)).toMatchObject({
      idPrefix: 'customPrefix',
      globalId: 'customPrefix--inlineBtn',
    })
    expect(control(inv, O, 'popupOk')).toMatchObject({ scope: 'fragment', display: 'OK' })
  })

  it('has no warnings for a consistent app', () => {
    expect(inv.warnings).toEqual([])
  })
})

describe('buildInventory - degraded inputs', () => {
  it('guesses the namespace from controllers when the manifest is missing', () => {
    const inv = buildInventory(messySources().filter((s) => !s.path.endsWith('manifest.json')))
    expect(inv.appId).toBe('messy.app')
    expect(inv.warnings.map((w) => w.code)).toContain('manifest.missing')
    expect(inv.routes).toEqual([])
    expect(inv.views.map((v) => v.viewName)).toContain('messy.app.view.Overview')
  })

  it('accepts an explicit namespace when there is nothing to infer it from', () => {
    const only = demoSources().filter((s) => s.path.endsWith('Main.view.xml'))
    const inv = buildInventory(only, { namespace: 'demo.orders' })
    expect(inv.views[0].viewName).toBe('demo.orders.view.Main')
    expect(inv.warnings.map((w) => w.code).sort()).toEqual([
      'controller.missing',
      'manifest.missing',
    ])
  })

  it('warns about an orphan fragment and exposes its controls by global id', () => {
    const frag = messySources().filter(
      (s) => s.path.endsWith('Popup.fragment.xml') || s.path.endsWith('manifest.json'),
    )
    const inv = buildInventory(frag)
    expect(inv.warnings.map((w) => w.code)).toContain('fragment.orphan')
    expect(inv.controls.find((c) => c.localId === 'popupOk')).toMatchObject({
      viewName: null,
      globalId: 'popupOk',
    })
  })

  it('warns about duplicate ids within one view and about missing fragments', () => {
    const dupe =
      '<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc" xmlns:core="sap.ui.core" controllerName="a.controller.A">' +
      '<Button id="x"/><Button id="x"/><core:Fragment fragmentName="a.fragment.Gone"/></mvc:View>'
    const inv = buildInventory([{ path: 'webapp/view/A.view.xml', content: dupe }], {
      namespace: 'a',
    })
    const codes = inv.warnings.map((w) => w.code)
    expect(codes).toContain('id.duplicate')
    expect(codes).toContain('fragment.missing')
  })

  it('survives an invalid manifest and unparsable controllers', () => {
    const inv = buildInventory([
      { path: 'webapp/manifest.json', content: '{ nope' },
      {
        path: 'webapp/controller/X.controller.js',
        content: 'sap.ui.define([], function () { return {',
      },
    ])
    const codes = inv.warnings.map((w) => w.code)
    expect(codes).toContain('manifest.invalid')
    expect(codes).toContain('controller.parse')
  })
})
