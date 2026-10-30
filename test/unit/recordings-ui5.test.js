import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseRecording } from '../../srv/lib/recordings/index.js'

const fx = (n) => readFileSync(`test/fixtures/recordings/demo-create-order.${n}`, 'utf8')
const simple = (rec) =>
  rec.steps.map((s) =>
    [s.action, s.ui5?.controlId ?? s.ui5?.text, s.value].filter((v) => v !== undefined),
  )

describe('ui5-test-recorder adapter - OPA5', () => {
  const rec = parseRecording(fx('opa5.js'))

  it('turns Press / EnterText actions into steps and ignores assertions', () => {
    expect(simple(rec)).toEqual([
      ['click', 'createBtn'],
      ['input', 'customerInput', 'Acme Corp'],
      ['click', 'saveBtn'],
      ['click', 'Export'],
    ])
  })

  it('keeps the locator facts', () => {
    expect(rec.steps[0].ui5).toMatchObject({
      viewName: 'demo.orders.view.Main',
      controlType: 'sap.m.Button',
      via: 'test-recorder',
    })
    expect(rec.steps[3].ui5).toMatchObject({ controlId: null, text: 'Export' })
    expect(rec.steps.every((s) => s.dialect === 'opa5')).toBe(true)
  })
})

describe('ui5-test-recorder adapter - wdi5', () => {
  const rec = parseRecording(fx('wdi5.js'))

  it('handles chained calls and calls through a variable, in source order', () => {
    expect(simple(rec)).toEqual([
      ['click', 'createBtn'],
      ['input', 'customerInput', 'Acme Corp'],
      ['click', 'saveBtn'],
    ])
    expect(rec.steps.every((s) => s.dialect === 'wdi5')).toBe(true)
  })

  it('ignores read-only calls such as getValue()', () => {
    expect(rec.steps.some((s) => s.ui5.controlId === 'searchField')).toBe(false)
  })
})

describe('ui5-test-recorder adapter - raw selector and robustness', () => {
  it('reads a bare selector as an assumed press', () => {
    const rec = parseRecording(fx('raw.js'))
    expect(rec.steps).toHaveLength(1)
    expect(rec.steps[0]).toMatchObject({
      action: 'click',
      dialect: 'raw',
      ui5: { controlId: 'createBtn' },
    })
    expect(rec.steps[0].note).toMatch(/assumed/)
  })

  it('reads a wrapped wdi5 selector and a regex id', () => {
    const rec = parseRecording(
      'await browser.asControl({ selector: { id: /.*saveBtn$/, controlType: "sap.m.Button" } }).press()',
    )
    expect(rec.steps[0].ui5).toMatchObject({
      controlId: null,
      idPattern: '.*saveBtn$',
      controlType: 'sap.m.Button',
    })
  })

  it('supports an array of OPA5 actions', () => {
    const rec = parseRecording(
      'When.waitFor({ id: "x", viewName: "v", actions: [new EnterText({ text: "a" }), new Press()] });',
    )
    expect(rec.steps.map((s) => s.action)).toEqual(['input', 'click'])
  })

  it('throws a clear error for code it cannot read', () => {
    expect(() => parseRecording('When.waitFor({ id: ', { format: 'ui5-test-recorder' })).toThrow()
  })
})

describe('plain-text adapter', () => {
  const rec = parseRecording(fx('txt'))

  it('recognises verbs, quoted values and search shortcuts', () => {
    expect(rec.steps.map((s) => [s.action, s.text, s.value])).toEqual([
      ['input', 'search field', 'Acme'],
      ['click', 'Create', undefined],
      ['input', 'Customer', 'Acme Corp'],
      ['click', 'status', undefined],
      ['click', 'Save', undefined],
      ['note', 'Remember to mention that saving returns to the list.', undefined],
    ])
    expect(rec.steps[0].submit).toBe(true)
  })

  it('supports bullets, navigation and field: value forms', () => {
    const r = parseRecording('- go to #/order/new\n* Type name: "Bob"\n3) press the Save button.')
    expect(r.steps.map((s) => [s.action, s.hash ?? s.text, s.value])).toEqual([
      ['navigate', 'order/new', undefined],
      ['input', 'name', 'Bob'],
      ['click', 'Save button', undefined],
    ])
  })
})
