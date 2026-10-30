import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { DRAFT_SCHEMA, draftToTour, closestControls } from '../../srv/lib/llm/draft.js'
import { PLACEMENTS } from '../../shared/tour-schema.mjs'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const MAIN = 'demo.orders.view.Main'
const DETAIL = 'demo.orders.view.Detail'

const step = (over = {}) => ({
  title: 'T',
  text: 'Text',
  viewName: '',
  controlId: '',
  controlText: '',
  placement: 'PreferredBottomOrFlip',
  navigateTo: '',
  recordingStep: -1,
  ...over,
})
const convert = (steps, extra = {}) =>
  draftToTour({ title: 'Orders', steps }, { inventory, ...extra })

describe('DRAFT_SCHEMA', () => {
  const SUPPORTED = new Set([
    'type',
    'properties',
    'required',
    'items',
    'enum',
    'description',
    'additionalProperties',
  ])
  const keywords = (node, out = new Set()) => {
    if (Array.isArray(node)) node.forEach((n) => keywords(n, out))
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k !== 'properties') out.add(k)
        if (k === 'properties') Object.values(v).forEach((p) => keywords(p, out))
        else keywords(v, out)
      }
    }
    return out
  }

  it('only uses keywords that both Gemini (responseJsonSchema) and OpenAI-style strict mode support', () => {
    expect([...keywords(DRAFT_SCHEMA)].filter((k) => !SUPPORTED.has(k))).toEqual([])
  })

  it('is strict-mode shaped: every property required, no additional properties, enum from the contract', () => {
    const objects = [DRAFT_SCHEMA, DRAFT_SCHEMA.properties.steps.items]
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false)
      expect([...o.required].sort()).toEqual(Object.keys(o.properties).sort())
    }
    expect(DRAFT_SCHEMA.properties.steps.items.properties.placement.enum).toEqual(PLACEMENTS)
  })
})

describe('draftToTour - targets', () => {
  it('accepts exact targets and adds a text fallback for buttons', () => {
    const { tour, problems, fixes } = convert([
      step({ viewName: MAIN, controlId: 'createBtn' }),
      step({ viewName: MAIN, controlId: 'searchField' }),
    ])
    expect(problems).toEqual([])
    expect(fixes).toEqual([])
    expect(tour.steps[0].target).toEqual({
      viewName: MAIN,
      controlId: 'createBtn',
      fallbacks: [{ by: 'text', value: 'Create' }],
    })
    expect(tour.steps[1].target.fallbacks).toEqual([])
    expect(tour.steps[0].meta).toMatchObject({ source: 'ai', confidence: 0.9, unresolved: false })
  })

  it('corrects a wrong or missing viewName when the id is unique, and says so', () => {
    const { tour, fixes } = convert([
      step({ viewName: MAIN, controlId: 'saveBtn' }),
      step({ controlId: 'customerInput' }),
    ])
    expect(tour.steps[0].target.viewName).toBe(DETAIL)
    expect(tour.steps[1].target.viewName).toBe(DETAIL)
    expect(tour.steps[0].meta.confidence).toBe(0.7)
    expect(fixes).toHaveLength(2)
    expect(fixes[0]).toContain('Step 1')
  })

  it('finds an id-less control by its text', () => {
    const { tour } = convert([step({ viewName: MAIN, controlText: 'Export' })])
    expect(tour.steps[0].target).toEqual({
      viewName: MAIN,
      fallbacks: [{ by: 'text', value: 'Export' }],
    })
  })

  it('flags a control that does not exist, keeps the step unresolved and offers the closest controls', () => {
    const { tour, problems } = convert([step({ viewName: DETAIL, controlId: 'customerField' })])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ step: 1, code: 'target.notFound' })
    expect(problems[0].message).toContain('customerInput')
    expect(tour.steps[0].target).toBeUndefined()
    expect(tour.steps[0].meta).toMatchObject({ unresolved: true, confidence: 0 })
    expect(tour.steps[0].meta.note).toContain('customerField')
  })

  it('reports an id that exists in several views as ambiguous', () => {
    const inv = {
      ...inventory,
      controls: [
        ...inventory.controls,
        { ...inventory.controls.find((c) => c.localId === 'saveBtn'), viewName: MAIN },
      ],
    }
    const { problems } = draftToTour(
      { title: 'x', steps: [step({ controlId: 'saveBtn' })] },
      { inventory: inv },
    )
    expect(problems[0]).toMatchObject({ code: 'target.ambiguous' })
    expect(problems[0].message).toContain(MAIN)
  })

  it('never trusts a model-invented id even if the text looks right', () => {
    const { problems } = convert([step({ viewName: MAIN, controlId: 'ghostBtn' })])
    expect(problems[0].code).toBe('target.notFound')
  })
})

describe('draftToTour - the rest of a step', () => {
  it('gives a target-less first step the id "intro" and later ones sequential ids', () => {
    const { tour } = convert([step(), step({ viewName: MAIN, controlId: 'createBtn' })])
    expect(tour.steps.map((s) => s.id)).toEqual(['intro', 's2'])
    expect(tour.steps[0].target).toBeUndefined()
  })

  it('turns navigateTo into a before action, skipping repeats and normalising the hash', () => {
    const { tour } = convert([
      step({ viewName: MAIN, controlId: 'createBtn' }),
      step({ viewName: DETAIL, controlId: 'customerInput', navigateTo: '#/order/new' }),
      step({ viewName: DETAIL, controlId: 'saveBtn', navigateTo: 'order/new' }),
    ])
    expect(tour.steps.map((s) => s.before)).toEqual([
      [],
      [{ type: 'navigate', hash: 'order/new' }],
      [],
    ])
  })

  it('falls back for an invalid placement and an empty title', () => {
    const { tour } = convert([
      step({ title: '  ', placement: 'Sideways', viewName: MAIN, controlId: 'createBtn' }),
    ])
    expect(tour.steps[0]).toMatchObject({ title: 'Step 1', placement: 'PreferredBottomOrFlip' })
  })

  it('links a step to the recording step it explains, only if that step exists', () => {
    const recording = { steps: [{ index: 3 }, { index: 6 }] }
    const { tour } = convert([step({ recordingStep: 6 }), step({ recordingStep: 99 })], {
      recording,
    })
    expect(tour.steps.map((s) => s.meta.source)).toEqual(['recording:6', 'ai'])
  })

  it('uses the given title as fallback and slugs the id', () => {
    const { tour } = draftToTour(
      { title: '', steps: [step()] },
      { inventory, title: 'My App Tour!' },
    )
    expect(tour).toMatchObject({ title: 'My App Tour!', id: 'my-app-tour' })
  })

  it('throws when the draft has no steps', () => {
    expect(() => convert([])).toThrow(/cannot be turned into a valid tour/)
  })
})

describe('closestControls', () => {
  it('ranks by shared words in id and text and returns nothing for no hint', () => {
    expect(closestControls(inventory, 'customerField')[0].localId).toBe('customerInput')
    expect(closestControls(inventory, 'zzz')).toEqual([])
    expect(closestControls(inventory)).toEqual([])
  })
})
