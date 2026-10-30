import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseXmlView } from '../../srv/lib/parsers/xml-view.js'

const read = (p) => readFileSync(p, 'utf8')
const demo = (f) => parseXmlView(read(`samples/demo-app/webapp/${f}`))
const messy = (f) => parseXmlView(read(`test/fixtures/messy-app/webapp/${f}`))
const byId = (r, id) => r.controls.find((c) => c.localId === id)

describe('parseXmlView - demo app', () => {
  const main = demo('view/Main.view.xml')

  it('detects kind and controller', () => {
    expect(main.kind).toBe('view')
    expect(main.controllerName).toBe('demo.orders.controller.Main')
    expect(main.rootType).toBe('sap.ui.core.mvc.View')
  })

  it('collects ids, namespace-resolved types and handlers', () => {
    expect(byId(main, 'createBtn')).toMatchObject({
      type: 'sap.m.Button',
      handlers: { press: 'onCreate' },
      props: { type: 'Emphasized', text: '{i18n>create}' },
    })
    expect(byId(main, 'searchField').handlers).toEqual({ search: 'onSearch' })
    expect(byId(main, 'mainPage').type).toBe('sap.m.Page')
  })

  it('keeps controls without an id (localId null)', () => {
    const noId = main.controls.filter((c) => c.type === 'sap.m.Button' && c.localId === null)
    expect(noId).toHaveLength(1)
    expect(noId[0].props.text).toBe('{i18n>export}')
  })

  it('records aggregation and ancestor path', () => {
    expect(byId(main, 'mainToolbar').aggregation).toBe('subHeader')
    expect(byId(main, 'searchField').path).toEqual(['Page#mainPage', 'Toolbar#mainToolbar'])
    expect(byId(main, 'startTourBtn').aggregation).toBe('headerContent')
  })

  it('marks controls inside a bound aggregation as template', () => {
    const cells = main.controls.filter((c) => c.template)
    expect(cells.length).toBeGreaterThan(3)
    expect(cells.every((c) => c.path.includes('Table#ordersTable'))).toBe(true)
    expect(byId(main, 'ordersTable').template).toBe(false)
    expect(byId(main, 'createBtn').template).toBe(false)
  })
})

describe('parseXmlView - demo detail view and fragment', () => {
  it('maps Label labelFor to control ids', () => {
    const detail = demo('view/Detail.view.xml')
    expect(detail.labelFor).toEqual({
      customerInput: '{i18n>customer}',
      statusSelect: '{i18n>status}',
      dateInput: '{i18n>date}',
    })
    expect(byId(detail, 'statusSelect').type).toBe('sap.m.Select')
    expect(detail.controls.find((c) => c.type === 'sap.ui.core.Item').props.key).toBe('Open')
  })

  it('parses a fragment', () => {
    const f = demo('fragment/ConfirmDialog.fragment.xml')
    expect(f.kind).toBe('fragment')
    expect(f.controls.map((c) => c.localId)).toEqual([
      'confirmDialog',
      null,
      'confirmBtn',
      'cancelBtn',
    ])
    expect(byId(f, 'confirmBtn').handlers).toEqual({ press: 'onConfirmDelete' })
    expect(byId(f, 'confirmBtn').aggregation).toBe('beginButton')
  })
})

describe('parseXmlView - messy fixture', () => {
  const ov = messy('view/Overview.view.xml')

  it('ignores foreign (html) namespaces', () => {
    expect(ov.controls.some((c) => /html|div|span/i.test(c.type))).toBe(false)
  })

  it('handles custom control namespaces', () => {
    expect(byId(ov, 'special').type).toBe('messy.app.control.Special')
  })

  it('records nested views and fragment references instead of controls', () => {
    expect(ov.viewRefs).toEqual([{ name: 'messy.app.view.Child', localId: 'childHost' }])
    expect(ov.fragmentRefs).toEqual([{ name: 'messy.app.fragment.Inline', aggregation: 'content' }])
    expect(ov.controls.some((c) => c.type === 'sap.ui.core.Fragment')).toBe(false)
  })

  it('detects handlers with and without a dot, and with arguments', () => {
    expect(byId(ov, 'nameInput').handlers).toEqual({ liveChange: 'onLive' })
    expect(ov.controls.find((c) => c.props.text === 'No id here').handlers).toEqual({
      press: 'onNoId',
    })
    expect(byId(ov, 'saveBtn').handlers).toEqual({ press: 'onSave' })
  })

  it('treats object-style bindings as templates too', () => {
    expect(byId(ov, 'cellText').template).toBe(true)
    expect(byId(ov, 'listItem').template).toBe(true)
    expect(byId(ov, 'table').template).toBe(false)
  })

  it('keeps expression bindings raw for later resolution', () => {
    const t = ov.controls.find((c) => c.type === 'sap.m.Text' && c.props.text.startsWith('{='))
    expect(t).toBeTruthy()
  })

  it('works without an XML declaration and with a default-less root', () => {
    const child = messy('view/Child.view.xml')
    expect(child.controls.map((c) => c.localId)).toEqual(['box', 'childTitle'])
  })

  it('throws on empty input', () => {
    expect(() => parseXmlView('')).toThrow()
  })
})
