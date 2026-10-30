import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording, collapseSteps, domIdsOf } from '../../srv/lib/recordings/map.js'
import { demoSources } from '../helpers/sources.js'

const fx = (n) => readFileSync(`test/fixtures/recordings/demo-create-order.${n}`, 'utf8')
const inventory = buildInventory(demoSources())
const mapped = (n) => mapRecording(parseRecording(fx(n)), inventory)
const brief = (rec) =>
  rec.steps.map((s) => [s.action, s.ui5 ? `${s.ui5.localId ?? '-'}:${s.ui5.via}` : s.ui5, s.value])

describe('domIdsOf', () => {
  it('extracts ids from css, pierce and xpath selectors and ignores aria/text', () => {
    expect(
      domIdsOf([
        'aria/Create',
        'text/Create',
        '#a--b-inner',
        'pierce/#c',
        'xpath///*[@id="d"]',
        String.raw`div.x > #e\.f`,
      ]),
    ).toEqual(['a--b-inner', 'c', 'd', 'e.f'])
  })
})

describe('mapRecording - DevTools Recorder export', () => {
  const rec = mapped('devtools.json')

  it('maps DOM ids (incl. UI5 inner suffixes) to controls and collapses click+change+Enter', () => {
    expect(brief(rec)).toEqual([
      ['navigate', undefined, undefined],
      ['input', 'searchField:id', 'Acme'],
      ['click', 'createBtn:id', undefined],
      ['input', 'customerInput:id', 'Acme Corp'],
      ['click', 'statusSelect:id', undefined],
      ['click', 'saveBtn:id', undefined],
      ['click', '-:aria', undefined],
    ])
    expect(rec.steps[1].submit).toBe(true)
  })

  it('resolves the view and keeps the navigation info', () => {
    expect(rec.steps[2].ui5).toMatchObject({
      viewName: 'demo.orders.view.Main',
      confidence: 0.95,
      hasStableId: true,
    })
    expect(rec.steps[3].ui5.viewName).toBe('demo.orders.view.Detail')
    expect(rec.steps[2].navigatesTo).toBe('order/new')
    expect(rec.steps[5].navigatesTo).toBe('')
  })

  it('falls back to the aria label for an auto-id control', () => {
    expect(rec.steps[6].ui5).toMatchObject({
      viewName: 'demo.orders.view.Main',
      localId: null,
      display: 'Export',
      hasStableId: false,
      via: 'aria',
    })
  })

  it('reports how much was mapped', () => {
    expect(rec.mapping).toEqual({ actionable: 6, mapped: 6, unmapped: 0 })
  })
})

describe('mapRecording - other formats', () => {
  it('verifies UI5 Test Recorder locators against the inventory', () => {
    const rec = mapped('opa5.js')
    expect(brief(rec)).toEqual([
      ['click', 'createBtn:test-recorder', undefined],
      ['input', 'customerInput:test-recorder', 'Acme Corp'],
      ['click', 'saveBtn:test-recorder', undefined],
      ['click', '-:test-recorder-text', undefined],
    ])
    expect(rec.steps[0].ui5.confidence).toBe(0.98)
  })

  it('leaves a locator unmapped when the control does not exist', () => {
    const rec = mapRecording(
      parseRecording(
        'When.waitFor({ id: "ghost", viewName: "demo.orders.view.Main", actions: new Press() });',
      ),
      inventory,
    )
    expect(rec.steps[0].ui5).toBeNull()
    expect(rec.mapping).toEqual({ actionable: 1, mapped: 0, unmapped: 1 })
  })

  it('maps plain-text targets by words', () => {
    const rec = mapped('txt')
    expect(brief(rec).slice(0, 5)).toEqual([
      ['input', 'searchField:text', 'Acme'],
      ['click', 'createBtn:text', undefined],
      ['input', 'customerInput:text', 'Acme Corp'],
      ['click', 'statusSelect:text', undefined],
      ['click', 'saveBtn:text', undefined],
    ])
    expect(rec.steps[5].action).toBe('note')
  })
})

describe('mapRecording - ambiguity', () => {
  const ctl = (viewName, extra = {}) => ({
    viewName,
    localId: 'title',
    type: 'sap.m.Title',
    display: 'Title',
    hasStableId: true,
    ...extra,
  })
  const inv = {
    views: [
      { viewName: 'v.A', viewId: 'a' },
      { viewName: 'v.B', viewId: 'b' },
    ],
    controls: [ctl('v.A'), ctl('v.B')],
  }
  const click = (id) => ({
    format: 'x',
    steps: [{ index: 0, action: 'click', dom: { selectors: ['#' + id] } }],
  })

  it('uses the manifest view id embedded in the DOM id to pick the right view', () => {
    expect(mapRecording(click('comp---b--title'), inv).steps[0].ui5).toMatchObject({
      viewName: 'v.B',
      confidence: 0.95,
    })
    expect(mapRecording(click('comp---a--title-inner'), inv).steps[0].ui5.viewName).toBe('v.A')
  })

  it('reports lower confidence and alternatives when nothing disambiguates', () => {
    const ui5 = mapRecording(click('__xmlview0--title'), inv).steps[0].ui5
    expect(ui5.confidence).toBe(0.6)
    expect(ui5.alternatives).toEqual([{ viewName: 'v.B', localId: 'title' }])
  })

  it('does not match a localId that is only a prefix of another id', () => {
    const i2 = {
      views: [],
      controls: [ctl(null, { localId: 'tab', globalId: 'tab' }), ctl('v.A', { localId: 'tabs' })],
    }
    expect(mapRecording(click('x--tabs-inner'), i2).steps[0].ui5.localId).toBe('tabs')
    expect(mapRecording(click('x--tabsX'), i2).steps[0].ui5).toBeNull()
  })
})

describe('collapseSteps', () => {
  const dom = (id) => ({ selectors: ['#' + id] })
  it('merges click+change, drops duplicate clicks and Enter/Escape noise', () => {
    const out = collapseSteps([
      { index: 0, action: 'click', dom: dom('a') },
      { index: 1, action: 'input', value: 'x', dom: dom('a') },
      { index: 2, action: 'key', value: 'Enter' },
      { index: 3, action: 'click', dom: dom('b') },
      { index: 4, action: 'click', dom: dom('b') },
      { index: 5, action: 'key', value: 'Escape' },
      { index: 6, action: 'click', dom: dom('c'), navigatesTo: 'x' },
      { index: 7, action: 'click', dom: dom('c') },
    ])
    expect(out.map((s) => [s.action, s.index, s.value, s.submit])).toEqual([
      ['input', 0, 'x', true],
      ['click', 3, undefined, undefined],
      ['click', 6, undefined, undefined],
      ['click', 7, undefined, undefined],
    ])
  })

  it('keeps clicks on different controls and a click before an input elsewhere', () => {
    const out = collapseSteps([
      { index: 0, action: 'click', dom: dom('a') },
      { index: 1, action: 'input', value: 'x', dom: dom('b') },
    ])
    expect(out.map((s) => s.action)).toEqual(['click', 'input'])
  })
})
