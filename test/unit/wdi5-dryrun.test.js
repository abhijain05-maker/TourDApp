import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { buildPlan } from '../../srv/lib/wdi5/plan.js'
import { checkSelector, dryRun } from '../../srv/lib/wdi5/dryrun.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const plan = () =>
  buildPlan({
    mapped: mapRecording(
      parseRecording(readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')),
      inventory,
    ),
    inventory,
    name: 'x',
  })

describe('checkSelector', () => {
  it('finds a control by id in its view, and says when the id or the view is wrong', () => {
    expect(
      checkSelector({ id: 'createBtn', viewName: 'demo.orders.view.Main' }, inventory),
    ).toMatchObject({ status: 'found', count: 1 })
    expect(
      checkSelector({ id: 'createBtn', viewName: 'demo.orders.view.Detail' }, inventory),
    ).toMatchObject({
      status: 'missing',
      note: expect.stringContaining('no control with the id "createBtn"'),
    })
    expect(checkSelector({ id: 'createBtn', viewName: 'nope.View' }, inventory).note).toMatch(
      /no view "nope.View"/,
    )
  })

  it('finds by text and label, and flags a text that is on several controls or none', () => {
    const exportBtn = {
      controlType: 'sap.m.Button',
      viewName: 'demo.orders.view.Main',
      properties: { text: 'Export' },
    }
    expect(checkSelector(exportBtn, inventory)).toMatchObject({
      status: 'found',
      note: expect.stringContaining('no id'),
    })
    expect(
      checkSelector({ ...exportBtn, properties: { text: 'Nothing like it' } }, inventory).status,
    ).toBe('missing')
    expect(
      checkSelector(
        {
          controlType: 'sap.m.Input',
          viewName: 'demo.orders.view.Detail',
          labelFor: { text: 'Customer' },
        },
        inventory,
      ).status,
    ).toBe('found')
    const twin = structuredClone(inventory)
    twin.controls.push({ ...twin.controls.find((c) => c.display === 'Export') })
    expect(checkSelector(exportBtn, twin)).toMatchObject({ status: 'ambiguous', count: 2 })
  })

  it('knows what only the running app can tell', () => {
    expect(
      checkSelector(
        { controlType: 'sap.m.Text', viewName: 'v', bindingPath: { propertyPath: '/Orders/0/id' } },
        inventory,
      ).status,
    ).toBe('unchecked')
    expect(
      checkSelector(
        {
          controlType: 'sap.m.Button',
          viewName: 'demo.orders.view.Main',
          i18NText: { propertyName: 'text', key: 'create' },
        },
        inventory,
      ).status,
    ).toBe('unchecked')
    expect(
      checkSelector(
        {
          controlType: 'sap.m.Button',
          viewName: 'demo.orders.view.Main',
          i18NText: { propertyName: 'text', key: 'nope' },
        },
        inventory,
      ),
    ).toMatchObject({ status: 'missing', note: expect.stringContaining('"nope"') })
    expect(checkSelector({ controlType: 'sap.m.Button' }, inventory).status).toBe('unchecked')
  })
})

describe('dryRun', () => {
  it('checks every control a plan uses, per locator and per step', () => {
    const r = dryRun(plan(), inventory)
    expect(r.summary).toEqual({ found: 5, missing: 0, ambiguous: 0, unchecked: 0 })
    expect(Object.values(r.steps).every((s) => s === 'found')).toBe(true)
  })

  it('catches a plan that no longer fits the app', () => {
    const p = plan()
    p.locators.createBtn.selector.id = 'createButton' // renamed in the view
    const r = dryRun(p, inventory)
    expect(r.locators.createBtn.status).toBe('missing')
    expect(r.summary.missing).toBe(1)
    expect(Object.entries(r.steps).filter(([, s]) => s === 'missing').length).toBeGreaterThan(0)
    // a locator that no enabled step uses is not counted
    p.steps.filter((s) => s.locator === 'createBtn').forEach((s) => (s.enabled = false))
    expect(dryRun(p, inventory).summary.missing).toBe(0)
  })
})
