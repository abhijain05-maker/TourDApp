import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { detectFormat, parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording, withLiveControls } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { generateTourFromRules } from '../../srv/lib/llm/rules.js'
import { validateTour } from '../../shared/tour-schema.mjs'
import { demoSources } from '../helpers/sources.js'

const raw = readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')
const fixture = () => JSON.parse(raw)
const inventory = buildInventory(demoSources())

const control = (extra = {}) => ({
  id: 'container-demo---main--createBtn',
  localId: 'createBtn',
  viewName: 'demo.orders.view.Main',
  controllerName: 'demo.orders.controller.Main',
  controlType: 'sap.m.Button',
  stableId: true,
  text: 'Create',
  ...extra,
})
const recording = (steps) => ({
  format: 'tourd-recording',
  version: 1,
  recordedAt: '2026-10-27T10:00:00.000Z',
  recorder: 'test',
  app: {
    url: 'http://localhost:8081/index.html',
    startHash: '',
    title: 'Demo Orders',
    ui5Version: '1.120.0',
    appId: 'demo.orders',
    locale: 'en',
  },
  steps: steps.map((s, index) => ({ index, t: index * 100, ...s })),
})

describe('TourD recorder adapter', () => {
  it('is recognised on its own, before the other formats', () => {
    expect(detectFormat(raw)).toBe('tourd-recorder')
    expect(detectFormat(fixture())).toBe('tourd-recorder')
  })

  it('turns the recording into normalised steps', () => {
    const r = parseRecording(raw)
    expect(r).toMatchObject({
      format: 'tourd-recorder',
      title: 'Demo Orders',
      startUrl: 'http://localhost:8081/index.html',
      app: { appId: 'demo.orders' },
    })
    expect(r.steps.map((s) => [s.action, s.ui5?.controlId, s.value, s.navigatesTo])).toEqual([
      ['navigate', undefined, undefined, undefined],
      ['input', 'searchField', 'Acme', undefined], // a search
      ['click', 'createBtn', undefined, 'order/new'], // the navigation it caused belongs to it
      ['input', 'customerInput', 'Acme Corp', undefined],
      ['click', 'statusSelect', undefined, undefined], // choosing a value
      ['click', 'saveBtn', undefined, ''],
    ])
    expect(r.steps[1].submit).toBe(true)
    expect(r.steps[4].choice).toBe('Shipped')
    expect(r.steps[0]).toMatchObject({ action: 'navigate', hash: '' })
  })

  it('keeps what only this recorder knows', () => {
    const [, search, create] = parseRecording(raw).steps
    expect(create.ui5).toMatchObject({
      via: 'tourd-recorder',
      controllerName: 'demo.orders.controller.Main',
      viewName: 'demo.orders.view.Main',
      controlType: 'sap.m.Button',
      i18n: { property: 'text', model: 'i18n', key: 'create' },
      stableId: true,
    })
    expect(search.ui5.i18n.key).toBe('searchPlaceholder')
  })

  it('maps onto the uploaded files with certainty, and adds the controller and the handler', () => {
    const mapped = mapRecording(parseRecording(raw), inventory)
    expect(mapped.mapping).toEqual({ actionable: 5, mapped: 5, unmapped: 0 })
    const create = mapped.steps.find((s) => s.ui5?.localId === 'createBtn')
    expect(create.ui5).toMatchObject({
      via: 'recorder',
      confidence: 1,
      controllerName: 'demo.orders.controller.Main',
      handler: 'onCreate',
    })
  })

  it('gives a tour with every control resolved, the navigation, and no unresolved step', () => {
    const mapped = mapRecording(parseRecording(raw), inventory)
    const { tour } = generateTourFromRules({ recording: mapped, inventory })
    expect(validateTour(tour).ok).toBe(true)
    expect(tour.steps.map((s) => s.title)).toEqual([
      'Demo Orders',
      'Search',
      'Press Create',
      'Customer',
      'Choose status',
      'Press Save',
    ])
    expect(tour.steps.filter((s) => s.meta?.unresolved)).toEqual([])
    expect(tour.steps[3].before).toEqual([{ type: 'navigate', hash: 'order/new' }])
  })

  it('uses the Fiori launchpad hash inside "&/" as the router hash', () => {
    const rec = recording([
      { type: 'press', control: control() },
      {
        type: 'navigate',
        hash: 'Shell-home&/order/42',
        url: 'https://x/index.html#Shell-home&/order/42',
        causedBy: 0,
      },
    ])
    expect(parseRecording(rec).steps[1].navigatesTo).toBe('order/42')
  })

  it('keeps a navigation that nothing caused (back button, typed address) as a step of its own', () => {
    const rec = recording([
      { type: 'press', control: control() },
      { type: 'navigate', hash: '/order/new' },
    ])
    expect(parseRecording(rec).steps.map((s) => s.action)).toEqual([
      'navigate',
      'click',
      'navigate',
    ])
  })

  it('traces a clone from a list binding back to the id written in the view', () => {
    const rec = recording([
      {
        type: 'press',
        control: control({
          id: 'v--row-3',
          localId: 'row-3',
          controlType: 'sap.m.ColumnListItem',
          stableId: false,
          inList: true,
          bindingPath: '/Orders/3',
          text: undefined,
        }),
      },
      {
        type: 'press',
        control: control({ localId: '__item4-x', stableId: false, inList: true, text: 'Row' }),
      },
    ])
    const [, a, b] = parseRecording(rec).steps
    expect(a.ui5).toMatchObject({ controlId: 'row', bindingPath: '/Orders/3', inList: true })
    expect(b.ui5.controlId).toBeNull() // generated: only the text can find it
    expect(b.ui5.text).toBe('Row')
  })

  it('leaves secrets out and says so', () => {
    const rec = recording([
      {
        type: 'input',
        control: control({ localId: 'pw', controlType: 'sap.m.Input' }),
        redacted: true,
      },
    ])
    const step = parseRecording(rec).steps[1]
    expect(step).toMatchObject({ action: 'input', value: '', redacted: true })
  })

  it('turns toggles and notes into steps too', () => {
    const rec = recording([
      { type: 'toggle', control: control({ controlType: 'sap.m.CheckBox' }), value: true },
      { type: 'note', note: 'explain this' },
    ])
    const [, toggle, note] = parseRecording(rec).steps
    expect(toggle).toMatchObject({ action: 'click', toggled: true })
    expect(note).toMatchObject({ action: 'note', note: 'explain this' })
  })

  it('says what is wrong with a recording that is not valid', () => {
    const rec = fixture()
    rec.steps[1].type = 'rightClick'
    expect(() => parseRecording(rec, { format: 'tourd-recorder' })).toThrow(
      /Not a valid TourD recording/,
    )
    expect(() => parseRecording('{ not json', { format: 'tourd-recorder' })).toThrow(/Not a valid/)
  })

  it('a control the files do not have is taken from what the recorder saw (Fiori elements), with its exact id', () => {
    const rec = recording([
      { type: 'press', control: control({ localId: 'fe::FooterBar::StandardAction::Save', viewName: 'ObjectPage', text: 'Save' }) },
    ])
    const mapped = mapRecording(parseRecording(rec), inventory)
    expect(mapped.mapping).toMatchObject({ mapped: 1, unmapped: 0 })
    const { tour } = generateTourFromRules({ recording: mapped, inventory })
    const step = tour.steps.at(-1)
    expect(step.meta.unresolved).toBe(false)
    expect(step.target).toMatchObject({ viewName: 'ObjectPage', controlId: 'fe::FooterBar::StandardAction::Save' })
  })

  it('a control with neither an id nor a text is reported as unmapped, not guessed', () => {
    const rec = recording([
      { type: 'press', control: control({ localId: null, stableId: false, text: undefined }) },
    ])
    const mapped = mapRecording(parseRecording(rec), inventory)
    expect(mapped.mapping.unmapped).toBe(1)
    const { tour } = generateTourFromRules({ recording: mapped, inventory })
    expect(tour.steps.at(-1).meta.unresolved).toBe(true)
  })

  it('the controls only the recorder saw are added to the inventory for generation and the checks', () => {
    const rec = recording([
      { type: 'press', control: control({ localId: 'fe::FooterBar::StandardAction::Save', viewName: 'ObjectPage', text: 'Save' }) },
      { type: 'press', control: control({ localId: 'createBtn' }) }, // in the files already
    ])
    const mapped = mapRecording(parseRecording(rec), inventory)
    const live = withLiveControls(inventory, mapped)
    const added = live.controls.filter((c) => c.live)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ viewName: 'ObjectPage', localId: 'fe::FooterBar::StandardAction::Save', display: 'Save' })
    expect(live.controls).toHaveLength(inventory.controls.length + 1)
    expect(inventory.controls.some((c) => c.live)).toBe(false) // the original is not changed
    expect(withLiveControls(inventory, mapRecording(parseRecording(recording([])), inventory))).toBe(inventory)
  })
})
