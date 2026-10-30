import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { buildPlan, identifier, selectorCandidates, slug } from '../../srv/lib/wdi5/plan.js'
import { validatePlan } from '../../shared/wdi5-plan.mjs'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const mappedOf = (file) =>
  mapRecording(parseRecording(readFileSync(`test/fixtures/recordings/${file}`, 'utf8')), inventory)
const planOf = (file = 'demo-create-order.tourd.json', settings = {}) =>
  buildPlan({ mapped: mappedOf(file), inventory, name: 'Create an order', settings })

describe('identifier / slug', () => {
  it('make safe names', () => {
    expect(identifier('Create an order!')).toBe('createAnOrder')
    expect(identifier('  --  ', 'x')).toBe('x')
    expect(identifier('9 lives', 'x')).toBe('x')
    expect(identifier('Größe & Übersicht')).toBe('groEUbersicht')
    expect(slug('Create an order!')).toBe('create-an-order')
    expect(slug('日本語', 'journey')).toBe('journey')
  })
})

describe('buildPlan from the TourD recorder', () => {
  const plan = planOf()

  it('turns every action into a step, with the checks after it', () => {
    expect(plan.steps.map((s) => [s.kind, s.locator, s.assertion?.type ?? null])).toEqual([
      ['open', null, null],
      ['search', 'searchField', null],
      ['assert', 'searchField', 'value'],
      ['press', 'createBtn', null],
      ['assert', null, 'url'],
      ['enterText', 'customerInput', null],
      ['assert', 'customerInput', 'value'],
      ['select', 'statusSelect', null],
      ['assert', 'statusSelect', 'selectedKey'],
      ['press', 'saveBtn', null],
      ['assert', null, 'url'],
    ])
    expect(plan.steps.filter((s) => s.kind === 'assert').every((s) => s.heuristic)).toBe(true)
    expect(plan.steps.find((s) => s.kind === 'select')).toMatchObject({ choice: 'Shipped' })
    expect(
      plan.steps.filter((s) => s.assertion?.type === 'url').map((s) => s.assertion.expected),
    ).toEqual(['order/new', ''])
  })

  it('finds controls by their id and the view they are in', () => {
    expect(plan.locators.createBtn).toMatchObject({
      strategy: 'id',
      selector: { id: 'createBtn', viewName: 'demo.orders.view.Main' },
    })
    // the recorder knew the i18n key and the text: those stay as alternatives
    expect(plan.locators.createBtn.alternatives.map((a) => a.strategy)).toEqual(['i18n', 'text'])
    expect(plan.locators.createBtn.alternatives[0].selector).toEqual({
      controlType: 'sap.m.Button',
      viewName: 'demo.orders.view.Main',
      i18NText: { propertyName: 'text', key: 'create' },
    })
  })

  it('is valid, and a plan survives JSON', () => {
    expect(validatePlan(plan).ok).toBe(true)
    expect(validatePlan(JSON.parse(JSON.stringify(plan))).ok).toBe(true)
    expect(plan.app).toEqual({ id: 'demo.orders', url: 'http://localhost:8081/index.html' })
    expect(plan.settings).toMatchObject({
      framework: 'mocha',
      auth: 'none',
      baseUrl: 'http://localhost:8081/index.html',
    })
  })

  it('takes settings from the caller', () => {
    expect(
      planOf('demo-create-order.tourd.json', { framework: 'jasmine', auth: 'basic' }).settings,
    ).toMatchObject({ framework: 'jasmine', auth: 'basic' })
  })
})

describe('buildPlan from a DevTools recording', () => {
  it('matches the same controls through the app files', () => {
    const plan = planOf('demo-create-order.devtools.json')
    expect(Object.keys(plan.locators)).toEqual(
      expect.arrayContaining(['searchField', 'createBtn', 'customerInput']),
    )
    expect(
      plan.steps.filter(
        (s) => s.enabled && ['press', 'enterText', 'search', 'select'].includes(s.kind),
      ).length,
    ).toBeGreaterThanOrEqual(5)
    expect(validatePlan(plan).ok).toBe(true)
  })
})

describe('what cannot be found stays visible', () => {
  it('keeps a step whose control is unknown, switched off, with the reason', () => {
    const mapped = mappedOf('demo-create-order.tourd.json')
    mapped.steps = mapped.steps.map((s) =>
      s.action === 'click' && s.ui5?.localId === 'createBtn' ? { ...s, ui5: undefined } : s,
    )
    const plan = buildPlan({ mapped, inventory, name: 'x' })
    const step = plan.steps.find((s) => s.title.startsWith('Press'))
    expect(step).toMatchObject({ enabled: false, locator: null })
    expect(step.note).toMatch(/not found in the app's files/)
    // no check follows a step that was not understood
    expect(plan.steps.find((s) => s.assertion?.expected === 'order/new')).toBeUndefined()
  })

  it('falls back to text and label when a control has no id', () => {
    const exportButton = {
      ui5: {
        viewName: 'demo.orders.view.Main',
        localId: null,
        type: 'sap.m.Button',
        display: 'Export',
        hasStableId: false,
      },
    }
    const c = selectorCandidates({
      ...exportButton,
      control: inventory.controls.find((x) => x.display === 'Export'),
    })
    expect(c.map((x) => x.strategy)).toEqual(['text'])
    expect(c[0].selector).toEqual({
      controlType: 'sap.m.Button',
      viewName: 'demo.orders.view.Main',
      properties: { text: 'Export' },
    })

    const input = selectorCandidates({
      ui5: { viewName: 'v', localId: null, type: 'sap.m.Input', hasStableId: false },
      recorded: { label: 'Customer' },
    })
    expect(input).toEqual([
      {
        strategy: 'label',
        selector: { controlType: 'sap.m.Input', viewName: 'v', labelFor: { text: 'Customer' } },
      },
    ])
    expect(
      selectorCandidates({
        ui5: { viewName: 'v', localId: null, type: 'sap.m.Panel', hasStableId: false },
      }),
    ).toEqual([])
  })

  it('gives every locator its own name', () => {
    const mapped = mappedOf('demo-create-order.tourd.json')
    // two controls of the same id in different views
    const twin = {
      ...mapped.steps.find((s) => s.ui5?.localId === 'saveBtn'),
      ui5: {
        ...mapped.steps.find((s) => s.ui5?.localId === 'saveBtn').ui5,
        viewName: 'demo.orders.view.Main',
      },
    }
    mapped.steps.push(twin)
    const plan = buildPlan({ mapped, inventory, name: 'x' })
    const names = Object.keys(plan.locators)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(expect.arrayContaining(['saveBtn', 'mainSaveBtn']))
  })
})

describe('validatePlan', () => {
  it('rejects unknown fields and locators that do not exist', () => {
    const plan = planOf()
    expect(validatePlan({ ...plan, extra: 1 }).ok).toBe(false)
    const broken = structuredClone(plan)
    broken.steps[1].locator = 'nope'
    const r = validatePlan(broken)
    expect(r.ok).toBe(false)
    expect(r.issues[0].message).toMatch(/Unknown locator/)
    const bad = structuredClone(plan)
    bad.settings.framework = 'cypress'
    expect(validatePlan(bad).ok).toBe(false)
  })
})
