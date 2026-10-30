import { describe, it, expect } from 'vitest'
import {
  addStep,
  buildPlacement,
  deleteStep,
  duplicateStep,
  moveStep,
  parsePlacement,
  setTarget,
  uniqueStepId,
  updateStep,
} from '../../designer/src/editor/model.ts'
import {
  canRedo,
  canUndo,
  createHistory,
  push,
  redo,
  undo,
} from '../../designer/src/editor/history.ts'
import { validateTour } from '../../shared/tour-schema.mjs'

const step = (id, extra = {}) => ({
  id,
  title: `Step ${id}`,
  text: '',
  placement: 'PreferredBottomOrFlip',
  before: [],
  ...extra,
})
const doc = (...ids) => ({
  schemaVersion: 1,
  id: 't',
  title: 'T',
  options: { showProgress: true, allowSkip: true, overlay: true, interactive: true, waitTimeoutMs: 5000 },
  steps: ids.map((i) => step(i)),
})
const ids = (d) => d.steps.map((s) => s.id)

describe('editor model', () => {
  it('never mutates its input', () => {
    const d = doc('a', 'b', 'c')
    const frozen = structuredClone(d)
    moveStep(d, 0, 2)
    addStep(d, 'a')
    duplicateStep(d, 'b')
    deleteStep(d, 'c')
    updateStep(d, 'a', { title: 'x' })
    setTarget(d, 'a', { controlId: 'x', fallbacks: [] })
    expect(d).toEqual(frozen)
  })

  it('uniqueStepId fills gaps and avoids clashes', () => {
    expect(uniqueStepId(doc('s1', 's3'))).toBe('s2')
    expect(uniqueStepId(doc('intro'))).toBe('s1')
  })

  it('moveStep reorders and ignores impossible moves', () => {
    const d = doc('a', 'b', 'c', 'd')
    expect(ids(moveStep(d, 0, 2))).toEqual(['b', 'c', 'a', 'd'])
    expect(ids(moveStep(d, 3, 0))).toEqual(['d', 'a', 'b', 'c'])
    expect(moveStep(d, 1, 1)).toBe(d)
    expect(moveStep(d, -1, 2)).toBe(d)
    expect(moveStep(d, 0, 9)).toBe(d)
  })

  it('addStep inserts after the given step (or at the end) with a valid empty step', () => {
    const d = doc('a', 'b')
    const afterA = addStep(d, 'a')
    expect(ids(afterA.doc)).toEqual(['a', 's1', 'b'])
    expect(afterA.id).toBe('s1')
    expect(ids(addStep(d).doc)).toEqual(['a', 'b', 's1'])
    expect(ids(addStep(d, 'zzz').doc)[0]).toBe('s1') // unknown anchor: inserted first, never lost
    expect(validateTour(afterA.doc).ok).toBe(true)
  })

  it('duplicateStep copies deeply with a fresh id, right after the original', () => {
    const d = {
      ...doc('a', 'b'),
      steps: [
        step('a', {
          target: { controlId: 'x', fallbacks: [{ by: 'text', value: 'X' }] },
          meta: { unresolved: true, note: 'n' },
        }),
        step('b'),
      ],
    }
    const r = duplicateStep(d, 'a')
    expect(ids(r.doc)).toEqual(['a', 's1', 'b'])
    expect(r.doc.steps[1].title).toBe('Step a (copy)')
    expect(r.doc.steps[1].target).toEqual(d.steps[0].target)
    expect(r.doc.steps[1].target).not.toBe(d.steps[0].target)
    expect(validateTour(r.doc).ok).toBe(true)
    expect(duplicateStep(d, 'nope').doc).toBe(d)
  })

  it('deleteStep keeps at least one step and selects a neighbour', () => {
    const d = doc('a', 'b', 'c')
    expect(deleteStep(d, 'b')).toMatchObject({ selectId: 'c' })
    expect(ids(deleteStep(d, 'b').doc)).toEqual(['a', 'c'])
    expect(deleteStep(d, 'c').selectId).toBe('b')
    const one = doc('a')
    expect(deleteStep(one, 'a').doc).toBe(one)
    expect(deleteStep(d, 'nope').doc).toBe(d)
  })

  it('setTarget clears the review flag and note; removing the target keeps it flagged-free too', () => {
    const d = {
      ...doc('a'),
      steps: [
        step('a', {
          meta: { unresolved: true, confidence: 0, note: 'AI guessed wrong', source: 'ai' },
        }),
      ],
    }
    const withTarget = setTarget(d, 'a', { viewName: 'v.A', controlId: 'x', fallbacks: [] })
    expect(withTarget.steps[0].meta).toEqual({ unresolved: false, confidence: 1, source: 'ai' })
    expect(withTarget.steps[0].target.controlId).toBe('x')
    const cleared = setTarget(withTarget, 'a', undefined)
    expect(cleared.steps[0].target).toBeUndefined()
    expect(cleared.steps[0].meta.unresolved).toBe(false)
  })

  it('updateStep ignores unknown ids', () => {
    const d = doc('a')
    expect(updateStep(d, 'zzz', { title: 'x' })).toBe(d)
  })
})

describe('placement helpers', () => {
  it('round-trips side and flip', () => {
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
      for (const flip of [true, false])
        expect(parsePlacement(buildPlacement(side, flip))).toEqual({ side, flip })
    }
    expect(buildPlacement('Top', true)).toBe('PreferredTopOrFlip')
    expect(parsePlacement('Vertical')).toEqual({ side: null, flip: false })
  })
})

describe('history', () => {
  it('undoes and redoes, and a new edit drops the redo branch', () => {
    let h = createHistory(0)
    h = push(h, 1)
    h = push(h, 2)
    expect([canUndo(h), canRedo(h)]).toEqual([true, false])
    h = undo(h)
    expect(h.present).toBe(1)
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toBe(2)
    h = undo(undo(h))
    expect(h.present).toBe(0)
    h = push(h, 9)
    expect(canRedo(h)).toBe(false)
    expect(undo(h).present).toBe(0)
  })

  it('merges rapid edits with the same key into one undo step', () => {
    let h = createHistory('')
    h = push(h, 'h', { key: 'title', now: 1000 })
    h = push(h, 'he', { key: 'title', now: 1200 })
    h = push(h, 'hel', { key: 'title', now: 1500 })
    expect(h.past).toEqual([''])
    h = push(h, 'hello', { key: 'text', now: 1600 }) // another field: a new step
    expect(undo(h).present).toBe('hel')
    expect(undo(undo(h)).present).toBe('')
  })

  it('does not merge after a pause or after undo, and ignores no-op pushes', () => {
    let h = createHistory('a')
    h = push(h, 'b', { key: 'k', now: 0 })
    h = push(h, 'c', { key: 'k', now: 5000 })
    expect(h.past).toEqual(['a', 'b'])
    expect(push(h, h.present)).toBe(h)
    const undone = undo(h)
    expect(push(undone, 'x', { key: 'k', now: 5100 }).past.length).toBe(undone.past.length + 1)
  })

  it('caps the history at 100 steps', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 150; i++) h = push(h, i)
    expect(h.past).toHaveLength(100)
    expect(h.past[0]).toBe(50)
  })

  it('undo/redo on an empty stack is a no-op', () => {
    const h = createHistory('x')
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })
})
