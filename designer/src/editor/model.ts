// Pure operations on a tour document. Every function returns a new document and never mutates its input,
// which is what makes undo/redo and React state trivial.
import type { TourDocument, TourStep } from '../types'

export type Target = NonNullable<TourStep['target']>

/** The smallest unused "sN" id. */
export function uniqueStepId(doc: TourDocument, prefix = 's'): string {
  const used = new Set(doc.steps.map((s) => s.id))
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`
}

export function updateStep(doc: TourDocument, id: string, patch: Partial<TourStep>): TourDocument {
  if (!doc.steps.some((s) => s.id === id)) return doc
  return { ...doc, steps: doc.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

export function moveStep(doc: TourDocument, from: number, to: number): TourDocument {
  const n = doc.steps.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return doc
  const steps = doc.steps.slice()
  const [moved] = steps.splice(from, 1)
  steps.splice(to, 0, moved)
  return { ...doc, steps }
}

/** Adds an empty step after the given step id (at the end when there is none). */
export function addStep(doc: TourDocument, afterId?: string | null): { doc: TourDocument; id: string } {
  const id = uniqueStepId(doc)
  const step: TourStep = {
    id,
    title: 'New step',
    text: '',
    placement: 'PreferredBottomOrFlip',
    before: [],
    meta: { source: 'manual', unresolved: false },
  }
  const at = afterId ? doc.steps.findIndex((s) => s.id === afterId) + 1 : doc.steps.length
  const steps = doc.steps.slice()
  steps.splice(at, 0, step)
  return { doc: { ...doc, steps }, id }
}

export function duplicateStep(doc: TourDocument, id: string): { doc: TourDocument; id: string } {
  const index = doc.steps.findIndex((s) => s.id === id)
  if (index < 0) return { doc, id }
  const copyId = uniqueStepId(doc)
  const copy: TourStep = structuredClone(doc.steps[index])
  copy.id = copyId
  copy.title = `${copy.title} (copy)`
  copy.meta = { ...copy.meta, source: 'manual', unresolved: copy.meta?.unresolved ?? false }
  const steps = doc.steps.slice()
  steps.splice(index + 1, 0, copy)
  return { doc: { ...doc, steps }, id: copyId }
}

/** Deletes a step; a tour always keeps at least one. Returns the id to select next. */
export function deleteStep(doc: TourDocument, id: string): { doc: TourDocument; selectId: string } {
  const index = doc.steps.findIndex((s) => s.id === id)
  if (index < 0 || doc.steps.length <= 1) return { doc, selectId: id }
  const steps = doc.steps.filter((s) => s.id !== id)
  return { doc: { ...doc, steps }, selectId: steps[Math.min(index, steps.length - 1)].id }
}

/** Points a step at a control (or at nothing); a manual choice clears the "needs review" flag. */
export function setTarget(doc: TourDocument, id: string, target: Target | undefined): TourDocument {
  const step = doc.steps.find((s) => s.id === id)
  if (!step) return doc
  const meta = { ...step.meta, unresolved: false }
  delete meta.note
  if (target) meta.confidence = 1
  return updateStep(doc, id, { target, meta })
}

export const SIDES = ['Top', 'Bottom', 'Left', 'Right'] as const
export type Side = (typeof SIDES)[number]

/** "PreferredTopOrFlip" -> { side: "Top", flip: true }; "Vertical"/"Horizontal" have no single side. */
export function parsePlacement(placement: string): { side: Side | null; flip: boolean } {
  const m = /^Preferred(Top|Bottom|Left|Right)OrFlip$/.exec(placement)
  if (m) return { side: m[1] as Side, flip: true }
  if ((SIDES as readonly string[]).includes(placement)) return { side: placement as Side, flip: false }
  return { side: null, flip: false }
}

export const buildPlacement = (side: Side, flip: boolean) => (flip ? `Preferred${side}OrFlip` : side)
