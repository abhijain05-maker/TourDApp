import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import {
  buildPlan,
  isTransient,
  selectorCandidates,
  withoutTransient,
} from '../../srv/lib/wdi5/plan.js'
import { validateRecording } from '../../shared/recording-schema.mjs'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())

// A Fiori elements list report: the value help of a filter field (rows with a temporary binding path) and the table.
const LR = 'sap.fe.templates.ListReport.ListReport'
const TABLE =
  'sap.fe.cap.travel::TravelList--fe::FilterBar::Travel::FilterFieldValueHelp::TravelStatus_code::Popover::qualifier::::SuggestTable'
const uid = (n) => `/TravelStatus($uid=id-1793188072908-${n})`

const checkBoxSelector = (n) => ({
  ancestor: {
    ancestor: { id: TABLE, searchOpenDialogs: true },
    bindingPath: { path: uid(n) },
    controlType: 'sap.m.ColumnListItem',
    viewId: 'sap.fe.cap.travel::TravelList',
    viewName: LR,
  },
  controlType: 'sap.m.CheckBox',
  properties: { editable: true },
  searchOpenDialogs: true,
  viewId: 'sap.fe.cap.travel::TravelList',
  viewName: LR,
})
const rowSelector = (n) => ({
  controlType: 'sap.m.ColumnListItem',
  descendant: {
    bindingPath: { path: uid(n), propertyPath: 'name' },
    controlType: 'sap.m.Text',
    searchOpenDialogs: true,
    viewId: 'sap.fe.cap.travel::TravelList',
    viewName: LR,
  },
  properties: { type: 'Active' },
  searchOpenDialogs: true,
  viewId: 'sap.fe.cap.travel::TravelList',
  viewName: LR,
})
const TRAVEL_ROW = "/Travel(TravelUUID='47757221A8E4645C17002DF03754AB66',IsActiveEntity=true)"

const control = (extra) => ({
  id: '__item21-__clone97',
  localId: '__item21-__clone97',
  viewName: LR,
  controllerName: 'sap.fe.templates.ListReport.ListReportController',
  stableId: false,
  inList: true,
  ...extra,
})
const recording = (withRowText, withRowClicks = false) => ({
  format: 'tourd-recording',
  version: 1,
  recordedAt: '2026-10-31T10:00:00.000Z',
  recorder: 'tourd-recorder 0.1.0',
  app: {
    url: 'http://localhost:4005/index.html',
    startHash: '',
    title: 'Travels',
    ui5Version: '1.139.0',
    appId: 'sap.fe.cap.travel',
    locale: 'en',
  },
  steps: [
    {
      type: 'press',
      event: 'press',
      index: 0,
      t: 10,
      control: {
        id: 'sap.fe.cap.travel::TravelList--fe::FilterBar::Travel::FilterField::TravelStatus_code-inner-vhi',
        localId: 'fe::FilterBar::Travel::FilterField::TravelStatus_code-inner-vhi',
        viewName: LR,
        controllerName: 'sap.fe.templates.ListReport.ListReportController',
        controlType: 'sap.ui.core.Icon',
        stableId: true,
      },
    },
    ...[
      ['Accepted', 826],
      ['Canceled', 827],
    ].flatMap(([name, n], i) => {
      const text = withRowText
        ? { itemText: name, itemTextType: 'sap.m.Text', itemTextProperty: 'text' }
        : {}
      const box = {
        type: 'press',
        event: 'press',
        index: 1 + 2 * i,
        t: 20 + i,
        control: control({
          controlType: 'sap.m.CheckBox',
          bindingPath: uid(n),
          selector: checkBoxSelector(n),
          ...text,
        }),
      }
      // one tick in the list is reported twice: the checkbox, and the row around it
      const row = {
        type: 'press',
        event: 'press',
        index: 2 + 2 * i,
        t: 21 + i,
        control: control({
          controlType: 'sap.m.ColumnListItem',
          bindingPath: uid(n),
          selector: rowSelector(n),
          ...text,
        }),
      }
      return withRowClicks ? [box, row] : [box]
    }),
    {
      type: 'press',
      event: 'press',
      index: 3,
      t: 40,
      control: control({
        controlType: 'sap.m.ColumnListItem',
        bindingPath: TRAVEL_ROW,
        selector: {
          bindingPath: { path: TRAVEL_ROW, propertyPath: 'TravelUUID' },
          controlType: 'sap.m.ColumnListItem',
          viewId: 'sap.fe.cap.travel::TravelList',
          viewName: LR,
        },
        ...(withRowText
          ? {
              itemText: 'Sightseeing in New York City',
              itemTextType: 'sap.m.ObjectIdentifier',
              itemTextProperty: 'title',
            }
          : {}),
      }),
    },
  ],
})
const planOf = (withRowText, withRowClicks = false) => {
  const raw = recording(withRowText, withRowClicks)
  raw.steps = raw.steps.map((s, i) => ({ ...s, index: i })) // the format wants 0, 1, 2, ...
  expect(validateRecording(raw).ok, JSON.stringify(validateRecording(raw).issues)).toBe(true)
  return buildPlan({
    mapped: mapRecording(parseRecording(JSON.stringify(raw)), inventory),
    inventory,
    name: 'Travels',
  })
}

describe('temporary ids in selectors', () => {
  it('recognises a $uid path anywhere in a selector', () => {
    expect(isTransient(uid(1))).toBe(true)
    expect(isTransient(checkBoxSelector(1))).toBe(true)
    expect(isTransient({ bindingPath: { path: TRAVEL_ROW } })).toBe(false)
    expect(isTransient(null)).toBe(false)
  })

  it('replaces them by the text of the row: a checkbox in a row, and the row itself', () => {
    const rec = { itemText: 'Accepted', itemTextType: 'sap.m.Text', itemTextProperty: 'text' }
    const box = withoutTransient(checkBoxSelector(826), rec)
    expect(isTransient(box)).toBe(false)
    expect(box.controlType).toBe('sap.m.CheckBox')
    expect(box.ancestor.ancestor.id).toBe(TABLE) // the table of the popup stays
    expect(box.ancestor.controlType).toBe('sap.m.ColumnListItem')
    expect(box.ancestor.descendant).toMatchObject({
      controlType: 'sap.m.Text',
      properties: { text: 'Accepted' },
    })
    const row = withoutTransient(rowSelector(826), rec)
    expect(isTransient(row)).toBe(false)
    expect(row.descendant).toMatchObject({
      controlType: 'sap.m.Text',
      properties: { text: 'Accepted' },
    })
    expect(row.descendant.bindingPath).toBeUndefined()
  })

  it('cannot do it without the text, and says so by returning null', () => {
    expect(withoutTransient(checkBoxSelector(826), {})).toBeNull()
    expect(withoutTransient({ id: 'a' }, {})).toEqual({ id: 'a' }) // nothing temporary: untouched
  })

  it('never offers a binding strategy on a temporary path', () => {
    const c = selectorCandidates({
      ui5: { viewName: LR, type: 'sap.m.CheckBox' },
      recorded: {
        controlType: 'sap.m.CheckBox',
        viewName: LR,
        bindingPath: uid(826),
        selector: checkBoxSelector(826),
        itemText: 'Accepted',
        itemTextType: 'sap.m.Text',
        itemTextProperty: 'text',
      },
    })
    expect(c.map((x) => x.strategy)).toEqual(['ui5'])
    expect(JSON.stringify(c)).not.toContain('$uid')
  })
})

describe('a plan for the value help of a filter and a table row', () => {
  it('gives every control its own locator (they used to share one named checkBox)', () => {
    const plan = planOf(true)
    const names = plan.steps.filter((s) => s.locator).map((s) => s.locator)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(4)
    expect(Object.keys(plan.locators)).toEqual(names)
  })

  it('finds the two items by their text and the table row by its record key', () => {
    const plan = planOf(true)
    const [, icon, a, b, row] = plan.steps
    expect(icon.locator).toBe('feFilterBarTravelFilterFieldTravelStatus')
    expect(JSON.stringify(plan.locators[a.locator].selector)).toContain('"text":"Accepted"')
    expect(JSON.stringify(plan.locators[b.locator].selector)).toContain('"text":"Canceled"')
    expect(a.locator).not.toBe(b.locator)
    expect(JSON.stringify(plan.locators[row.locator].selector)).toContain(
      "TravelUUID='47757221A8E4645C17002DF03754AB66'",
    )
    expect(JSON.stringify(plan)).not.toContain('$uid')
    expect(a.title).toBe('Press the CheckBox of "Accepted"')
  })

  it('switches off a step whose row text was not recorded, and says what to do about it', () => {
    const plan = planOf(false)
    const [, icon, a, b, row] = plan.steps
    expect(icon.enabled).toBe(true)
    for (const s of [a, b]) {
      expect(s.enabled).toBe(false)
      expect(s.locator).toBeNull()
      expect(s.note).toMatch(/temporary id.*Record the flow again/)
    }
    expect(row.enabled).toBe(true) // its record key is a stable path
    expect(JSON.stringify(plan)).not.toContain('$uid')
  })
})

describe('one tick in a list is one step', () => {
  it('leaves out the row press that follows the checkbox of the same row', () => {
    const plan = planOf(true, true)
    expect(plan.steps.map((s) => s.title)).toEqual([
      'Open the app',
      'Press fe::FilterBar::Travel::FilterField::TravelStatus_code-inner-vhi',
      'Press the CheckBox of "Accepted"',
      'Press the CheckBox of "Canceled"',
      'Press the ColumnListItem of "Sightseeing in New York City"',
    ])
  })

  it('keeps a row press that has no checkbox before it (a normal table row)', () => {
    const plan = planOf(true, false)
    expect(plan.steps.filter((s) => /ColumnListItem/.test(s.title))).toHaveLength(1)
  })
})

// A Fiori elements object page (cap-sflight): the booking fee is an amount and a currency, and Save opens a dialog that
// has a Save of its own. Recorded with the first version of the recorder, which wrote the value of the field around the
// input the way the model holds it ("12,USD,") and found no selector for the dialog's Save (it closes at once).
describe('an edit with a dialog on a Fiori elements object page', () => {
  const raw = readFileSync('test/fixtures/recordings/fe-edit-save-dialog.tourd.json', 'utf8')
  const plan = () =>
    buildPlan({
      mapped: mapRecording(parseRecording(raw), buildInventory([])),
      inventory: buildInventory([]),
      name: 'x',
    })

  it('types the amount once, as the person typed it, and nothing into the fields around the input', () => {
    const steps = plan().steps.filter((s) => s.kind === 'enterText')
    expect(steps.map((s) => s.value)).toEqual(['12.00'])
  })

  it('ticks the box in the dialog instead of typing "true" into its field', () => {
    const p = plan()
    const tick = p.steps.find((s) => /Trees-4-Tickets/.test(s.title))
    expect(tick.kind).toBe('press')
    expect(p.steps.some((s) => s.kind === 'enterText' && s.value === 'true')).toBe(false)
  })

  it('presses the Save of the dialog, not the Save of the page twice', () => {
    const p = plan()
    const saves = p.steps.filter((s) => s.kind === 'press' && /Save/.test(s.title))
    expect(saves).toHaveLength(2)
    expect(saves[0].locator).not.toBe(saves[1].locator)
    const dialogSave = p.locators[saves[1].locator].selector
    expect(dialogSave).toMatchObject({ searchOpenDialogs: true })
    expect(dialogSave.viewName).toBeUndefined() // the dialog is not in the view
    expect(JSON.stringify(dialogSave)).toMatch(/Save/)
  })

  it('looks for a control that was recorded in a dialog in the open dialogs', () => {
    const [candidate] = selectorCandidates({
      ui5: { type: 'sap.m.Button', viewName: LR, display: 'Save' },
      recorded: {
        controlType: 'sap.m.Button',
        viewName: LR,
        text: 'Save',
        inDialog: true,
      },
    })
    expect(candidate.selector).toEqual({
      controlType: 'sap.m.Button',
      searchOpenDialogs: true,
      properties: { text: 'Save' },
    })
  })

  it('a tick and the field around the checkbox, which carry the same name, stay a tick', () => {
    const p = plan()
    expect(p.steps.filter((s) => /Trees-4-Tickets/.test(s.title))).toHaveLength(1)
  })
})
