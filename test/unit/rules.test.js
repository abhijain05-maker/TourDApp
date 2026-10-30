import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { generateTourFromRules } from '../../srv/lib/llm/rules.js'
import { lintTour } from '../../srv/lib/validate/lint.js'
import { validateTour } from '../../shared/tour-schema.mjs'
import { demoSources } from '../helpers/sources.js'

const fx = (n) => readFileSync(`test/fixtures/recordings/demo-create-order.${n}`, 'utf8')
const inventory = buildInventory(demoSources())
const run = (n, opts = {}) => {
  const recording = mapRecording(parseRecording(fx(n)), inventory)
  return { recording, ...generateTourFromRules({ recording, inventory, ...opts }) }
}

describe('generateTourFromRules - DevTools Recorder flow', () => {
  const { tour, report, recording } = run('devtools.json')

  it('produces a schema-valid tour with an intro step', () => {
    expect(validateTour(tour).ok).toBe(true)
    expect(tour.id).toBe('create-an-order')
    expect(tour.steps.map((s) => s.id)).toEqual(['intro', 's1', 's2', 's3', 's4', 's5', 's6'])
    expect(tour.steps[0]).toMatchObject({ title: 'Create an order' })
    expect(tour.steps[0].target).toBeUndefined()
    expect(report).toEqual({ steps: 7, unresolved: 0, skipped: 0 })
  })

  it('writes titles, texts and targets from the control facts', () => {
    const by = Object.fromEntries(tour.steps.map((s) => [s.id, s]))
    expect(by.s1).toMatchObject({
      title: 'Search',
      target: { viewName: 'demo.orders.view.Main', controlId: 'searchField', fallbacks: [] },
    })
    expect(by.s2).toMatchObject({ title: 'Press Create', text: 'Press **Create** to continue.' })
    expect(by.s2.target.fallbacks).toEqual([{ by: 'text', value: 'Create' }])
    expect(by.s3).toMatchObject({
      title: 'Customer',
      text: 'Fill in **Customer**.',
      target: { controlId: 'customerInput' },
    })
    expect(by.s4).toMatchObject({ title: 'Choose status', text: 'Pick a value for **Status**.' })
    expect(by.s5).toMatchObject({ title: 'Press Save', text: 'Press **Save** to continue.' })
  })

  it('does not leak recorded input values into the tour', () => {
    expect(JSON.stringify(tour)).not.toContain('Acme')
  })

  it('chooses placements from the control type and position', () => {
    const p = Object.fromEntries(tour.steps.map((s) => [s.id, s.placement]))
    expect(p).toMatchObject({
      s2: 'PreferredBottomOrFlip',
      s3: 'PreferredRightOrFlip',
      s4: 'PreferredRightOrFlip',
      s5: 'PreferredTopOrFlip',
    })
  })

  it('adds navigate actions where the recorded app changed route', () => {
    const before = Object.fromEntries(tour.steps.map((s) => [s.id, s.before]))
    expect(before.s2).toEqual([])
    expect(before.s3).toEqual([{ type: 'navigate', hash: 'order/new' }])
    expect(before.s4).toEqual([])
    expect(before.s6).toEqual([{ type: 'navigate', hash: '' }])
  })

  it('targets an id-less control by its text and records provenance', () => {
    const exp = tour.steps.find((s) => s.id === 's6')
    expect(exp.target).toEqual({
      viewName: 'demo.orders.view.Main',
      fallbacks: [{ by: 'text', value: 'Export' }],
    })
    expect(exp.text).toBe('Press **Export**.')
    expect(exp.meta).toMatchObject({ source: 'recording:11', unresolved: false })
  })

  it('lints clean apart from the id-less control', () => {
    const { issues } = lintTour(tour, inventory, { recording })
    expect(issues.map((i) => [i.code, i.stepId])).toEqual([['target.noId', 's6']])
  })

  it('supports options: title, id, no intro', () => {
    const r = run('devtools.json', { title: 'My Tour', id: 'mine', intro: false })
    expect(r.tour).toMatchObject({ id: 'mine', title: 'My Tour' })
    expect(r.tour.steps[0].id).toBe('s1')
  })
})

describe('generateTourFromRules - other recordings', () => {
  it('flags steps whose control could not be found', () => {
    const recording = mapRecording(
      parseRecording(
        'When.waitFor({ id: "ghost", viewName: "demo.orders.view.Main", actions: new Press() });',
      ),
      inventory,
    )
    const { tour, report } = generateTourFromRules({ recording, inventory, intro: false })
    expect(report.unresolved).toBe(1)
    expect(tour.steps[0]).toMatchObject({ meta: { unresolved: true }, title: 'Step 1' })
    expect(tour.steps[0].target).toBeUndefined()
  })

  it('throws when the recording has nothing to build steps from', () => {
    const recording = mapRecording(parseRecording('Just a remark without any action.'), inventory)
    expect(() => generateTourFromRules({ recording, inventory, intro: false })).toThrow(/no usable/)
  })

  it('works for plain text and counts ignored notes', () => {
    const recording = mapRecording(parseRecording(fx('txt')), inventory)
    const { tour, report } = generateTourFromRules({ recording, inventory })
    expect(report.skipped).toBe(1)
    expect(tour.steps.map((s) => s.target?.controlId)).toEqual([
      undefined,
      'searchField',
      'createBtn',
      'customerInput',
      'statusSelect',
      'saveBtn',
    ])
  })

  it('infers navigation from the controller when the recording has no URLs', () => {
    const recording = mapRecording(parseRecording(fx('opa5.js')), inventory)
    const { tour } = generateTourFromRules({ recording, inventory })
    const hashes = tour.steps.map((s) => [
      s.target?.controlId ?? s.target?.fallbacks?.[0]?.value,
      s.before.map((b) => b.hash),
    ])
    expect(hashes.filter(([, h]) => h.length)).toEqual([
      ['customerInput', ['order/new']], // onCreate -> navTo("detail", { orderId: "new" })
      ['Export', ['']], // onSave -> navTo("main")
    ])
    expect(lintTour(tour, inventory, { recording }).issues.map((i) => i.code)).toEqual([
      'target.noId',
    ])
  })

  it('cannot infer navigation when the route argument is not a literal, and lint says so', () => {
    const src = (path, content) => ({ path, content })
    const inv = buildInventory([
      ...demoSources().filter((x) => !x.path.endsWith('Main.controller.js')),
      src(
        'webapp/controller/Main.controller.js',
        'sap.ui.define(["sap/ui/core/mvc/Controller"], function (C) { return C.extend("demo.orders.controller.Main", { onCreate: function () { var id = Math.random(); this.getOwnerComponent().getRouter().navTo("detail", { orderId: id }); } }); });',
      ),
    ])
    const recording = mapRecording(parseRecording(fx('opa5.js')), inv)
    const { tour } = generateTourFromRules({ recording, inventory: inv })
    expect(tour.steps.find((s) => s.target?.controlId === 'customerInput').before).toEqual([])
    expect(lintTour(tour, inv, { recording }).issues.map((i) => i.code)).toContain(
      'step.wrongRoute',
    )
  })
})
