import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  validateTour,
  createEmptyTour,
  toTourJsonSchema,
  PLACEMENTS,
  SCHEMA_VERSION,
} from '../../shared/tour-schema.mjs'

const minimal = () => ({
  schemaVersion: SCHEMA_VERSION,
  id: 'demo',
  title: 'Demo',
  steps: [{ id: 's1', title: 'Hello' }],
})

describe('tour schema', () => {
  it('accepts a minimal tour and applies defaults', () => {
    const r = validateTour(minimal())
    expect(r.ok).toBe(true)
    expect(r.tour.options).toEqual({
      showProgress: true,
      allowSkip: true,
      overlay: true,
      interactive: true,
      waitTimeoutMs: 5000,
    })
    expect(r.tour.steps[0]).toMatchObject({
      text: '',
      placement: 'PreferredBottomOrFlip',
      before: [],
    })
    expect(r.issues).toEqual([])
  })

  it('accepts a full step with target, fallbacks, navigation and meta', () => {
    const t = minimal()
    t.steps = [
      {
        id: 's1',
        title: 'Create',
        text: 'Press **Create**',
        placement: 'Top',
        target: {
          viewName: 'demo.orders.view.Main',
          controlId: 'createBtn',
          fallbacks: [{ by: 'text', value: 'Create' }],
        },
        before: [{ type: 'navigate', hash: 'order/new' }],
        meta: { source: 'recording:3', confidence: 0.9 },
      },
    ]
    const r = validateTour(t)
    expect(r.ok).toBe(true)
    expect(r.tour.steps[0].meta.unresolved).toBe(false)
    expect(r.tour.steps[0].target.fallbacks).toHaveLength(1)
  })

  it('accepts a target-less (centered) step', () => {
    expect(validateTour(minimal()).tour.steps[0].target).toBeUndefined()
  })

  it.each(PLACEMENTS)('accepts placement %s', (placement) => {
    const t = minimal()
    t.steps[0].placement = placement
    expect(validateTour(t).ok).toBe(true)
  })

  it('rejects an unknown placement with a precise path', () => {
    const t = minimal()
    t.steps[0].placement = 'Sideways'
    const r = validateTour(t)
    expect(r.ok).toBe(false)
    expect(r.issues[0]).toMatchObject({ path: 'steps[0].placement', severity: 'error' })
  })

  it('rejects typos in keys (strict objects)', () => {
    const t = minimal()
    t.steps[0].placment = 'Top'
    const r = validateTour(t)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.path === 'steps[0]')).toBe(true)
  })

  it('rejects empty steps, wrong schemaVersion, missing title', () => {
    expect(validateTour({ ...minimal(), steps: [] }).ok).toBe(false)
    expect(validateTour({ ...minimal(), schemaVersion: 2 }).ok).toBe(false)
    const t = minimal()
    delete t.steps[0].title
    expect(validateTour(t).issues[0].path).toBe('steps[0].title')
  })

  it('rejects duplicate step ids', () => {
    const t = minimal()
    t.steps.push({ id: 's1', title: 'Again' })
    const r = validateTour(t)
    expect(r.ok).toBe(false)
    expect(r.issues[0]).toMatchObject({ path: 'steps[1].id', code: 'custom' })
  })

  it('rejects out-of-range confidence and unknown action types', () => {
    const t = minimal()
    t.steps[0].meta = { confidence: 1.5 }
    expect(validateTour(t).ok).toBe(false)
    const u = minimal()
    u.steps[0].before = [{ type: 'press', hash: 'x' }]
    expect(validateTour(u).ok).toBe(false)
  })

  it('warns (does not fail) on unresolved steps and auto-generated ids', () => {
    const t = minimal()
    t.steps[0].target = { controlId: '__button3' }
    t.steps[0].meta = { unresolved: true }
    const r = validateTour(t)
    expect(r.ok).toBe(true)
    expect(r.issues.map((i) => i.code).sort()).toEqual(['step.unresolved', 'target.unstableId'])
    expect(r.issues.every((i) => i.severity === 'warning')).toBe(true)
  })

  it('createEmptyTour returns a valid tour', () => {
    const tour = createEmptyTour({ id: 'x', title: 'X' })
    expect(validateTour(tour).ok).toBe(true)
  })

  it('shared/tour.schema.json is in sync with the Zod contract (run `npm run build:schema`)', () => {
    const onDisk = JSON.parse(
      readFileSync(new URL('../../shared/tour.schema.json', import.meta.url), 'utf8'),
    )
    expect(onDisk).toEqual(toTourJsonSchema())
  })
})

describe('target without a control id', () => {
  const withTarget = (target) => {
    const t = minimal()
    t.steps[0].target = target
    return validateTour(t)
  }

  it('is valid when a fallback is present (controls without an id)', () => {
    const r = withTarget({ viewName: 'a.view.Main', fallbacks: [{ by: 'text', value: 'Export' }] })
    expect(r.ok).toBe(true)
    expect(r.tour.steps[0].target.controlId).toBeUndefined()
  })

  it('is rejected when there is neither a controlId nor a fallback', () => {
    const r = withTarget({ viewName: 'a.view.Main' })
    expect(r.ok).toBe(false)
    expect(r.issues[0].path).toBe('steps[0].target.controlId')
  })
})
