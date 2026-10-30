// The LLM answers in a small, flat "draft" format (easy for every provider to produce, no nesting,
// no optional fields). This module owns that schema and turns a draft into a real tour - verifying every
// target against the inventory on the way. Nothing the model says about a control is trusted.
import { PLACEMENTS, SCHEMA_VERSION, validateTour } from '../../../shared/tour-schema.mjs'
import { normalizeHash } from '../parsers/manifest.js'

/** Strict-mode friendly: every property required, no additionalProperties, "" instead of null. */
export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'steps'],
  properties: {
    title: { type: 'string', description: 'Tour title, at most 60 characters' },
    steps: {
      type: 'array',
      description: 'The tour steps in the order the user should see them',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'text',
          'viewName',
          'controlId',
          'controlText',
          'placement',
          'navigateTo',
          'recordingStep',
        ],
        properties: {
          title: { type: 'string', description: 'Short step title (max 60 characters)' },
          text: {
            type: 'string',
            description:
              'One or two short sentences; Markdown allowed (**bold** for control names)',
          },
          viewName: {
            type: 'string',
            description:
              'viewName of the target control, copied from the inventory; empty for an intro/outro step without a control',
          },
          controlId: {
            type: 'string',
            description:
              'localId of the target control, copied from the inventory; empty if the control has no id or the step has no control',
          },
          controlText: {
            type: 'string',
            description:
              'Only for a control listed without an id: its visible text, copied from the inventory; otherwise empty',
          },
          placement: {
            type: 'string',
            enum: PLACEMENTS,
            description: 'Where the bubble appears relative to the control',
          },
          navigateTo: {
            type: 'string',
            description:
              'Router hash to open before this step (e.g. "order/new"); empty when the page does not change',
          },
          recordingStep: {
            type: 'integer',
            description: 'Number of the recording step this step explains; -1 if none',
          },
        },
      },
    },
  },
}

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tour'
const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
const BUTTONISH = /\.(Button|ToggleButton|MenuButton|Link|IconTabFilter|SegmentedButtonItem)$/

const words = (s) =>
  String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Controls whose id/text share words with the given strings - offered to the model as corrections. */
export function closestControls(inventory, ...hints) {
  const want = new Set(hints.flatMap(words))
  if (!want.size) return []
  return inventory.controls
    .map((c) => {
      const have = new Set([...words(c.localId), ...words(c.display)])
      let score = 0
      for (const w of want) if (have.has(w)) score++
      return { c, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.c)
}

const describe = (c) =>
  `${c.viewName ?? '(global)'} / ${c.localId ?? '(no id)'}${c.display ? ` "${c.display}"` : ''}`

/** Finds the inventory control the draft step refers to. */
function resolveTarget(step, inventory) {
  const view = step.viewName?.trim() || null
  const id = step.controlId?.trim() || null
  const text = step.controlText?.trim() || null
  const all = inventory.controls

  if (id) {
    const exact =
      all.find((c) => c.viewName === view && c.localId === id) ?? all.find((c) => c.globalId === id)
    if (exact) return { control: exact, how: 'exact' }
    const sameId = all.filter((c) => c.localId === id)
    const views = [...new Set(sameId.map((c) => c.viewName))]
    if (views.length === 1) return { control: sameId[0], how: 'fixed-view' }
    if (views.length > 1) {
      return {
        problem: {
          code: 'target.ambiguous',
          message: `controlId "${id}" exists in several views (${views.join(', ')}); give the right viewName`,
        },
      }
    }
  }
  if (text) {
    const hits = all.filter(
      (c) =>
        [c.display, c.text, c.title, c.tooltip, c.label].some((t) => t && norm(t) === norm(text)) &&
        (!view || c.viewName === view),
    )
    const preferred = hits.filter((c) => !c.localId)
    const pool = preferred.length ? preferred : hits
    if (pool.length === 1) return { control: pool[0], how: 'by-text' }
    if (pool.length > 1) return { control: pool[0], how: 'by-text-ambiguous' }
  }
  if (!id && !text) return { control: null, how: 'none' }
  const near = closestControls(inventory, id, text)
  return {
    problem: {
      code: 'target.notFound',
      message:
        `${id ? `controlId "${id}"` : `controlText "${text}"`}${view ? ` in view ${view}` : ''} does not exist in the inventory.` +
        (near.length ? ` Closest controls: ${near.map(describe).join('; ')}` : ''),
    },
  }
}

export function targetFor(control) {
  if (!control.localId) {
    return {
      ...(control.viewName ? { viewName: control.viewName } : {}),
      fallbacks: control.display ? [{ by: 'text', value: control.display }] : [],
    }
  }
  const fallbacks =
    control.display &&
    (control.text === control.display || control.title === control.display) &&
    BUTTONISH.test(control.type)
      ? [{ by: 'text', value: control.display }]
      : []
  return {
    ...(control.viewName ? { viewName: control.viewName } : {}),
    controlId: control.globalId ?? control.localId,
    fallbacks,
  }
}

/**
 * @param {{title: string, steps: object[]}} draft parsed model output
 * @param {{inventory: object, recording?: object, title?: string}} ctx
 * @returns {{tour: object, problems: Array<{step: number, code: string, message: string}>, fixes: string[]}}
 *   `step` is 1-based. Steps whose target cannot be verified are kept but flagged `meta.unresolved`.
 */
export function draftToTour(draft, { inventory, recording, title }) {
  const problems = []
  const fixes = []
  const sourceOf = new Set((recording?.steps ?? []).map((s) => s.index))
  const steps = []
  let hash = null

  ;(draft.steps ?? []).forEach((d, i) => {
    const n = i + 1
    const resolved = resolveTarget(d, inventory)
    const id = steps.length === 0 && resolved.how === 'none' ? 'intro' : `s${n}`
    const step = {
      id,
      title:
        String(d.title ?? '')
          .trim()
          .slice(0, 120) || `Step ${n}`,
      text: String(d.text ?? '').trim(),
      placement: PLACEMENTS.includes(d.placement) ? d.placement : 'PreferredBottomOrFlip',
      before: [],
      meta: {
        source:
          Number.isInteger(d.recordingStep) && sourceOf.has(d.recordingStep)
            ? `recording:${d.recordingStep}`
            : 'ai',
        confidence: 0.9,
        unresolved: false,
      },
    }

    if (resolved.problem) {
      problems.push({ step: n, ...resolved.problem })
      step.meta = {
        ...step.meta,
        confidence: 0,
        unresolved: true,
        note: `The AI chose a control that does not exist (${d.viewName || '?'} / ${d.controlId || d.controlText || '?'})`,
      }
    } else if (resolved.control) {
      step.target = targetFor(resolved.control)
      if (resolved.how !== 'exact') {
        step.meta.confidence = 0.7
        fixes.push(`Step ${n}: target corrected (${resolved.how}) to ${describe(resolved.control)}`)
      }
    }

    const nav =
      typeof d.navigateTo === 'string' && d.navigateTo.trim() ? normalizeHash(d.navigateTo) : null
    if (nav !== null && nav !== hash) {
      step.before = [{ type: 'navigate', hash: nav }]
      hash = nav
    }
    steps.push(step)
  })

  const tourTitle = String(draft.title ?? '').trim() || title || 'Guided tour'
  const result = validateTour({
    schemaVersion: SCHEMA_VERSION,
    id: slug(tourTitle),
    title: tourTitle,
    steps,
  })
  if (!result.ok) {
    throw new Error(
      `The AI answer cannot be turned into a valid tour: ${result.issues
        .slice(0, 3)
        .map((x) => `${x.path}: ${x.message}`)
        .join('; ')}`,
    )
  }
  return { tour: result.tour, problems, fixes }
}
