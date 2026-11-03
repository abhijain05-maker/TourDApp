// Turns whatever arrives (the designer, an upload, a model) into a row the tables accept. Text is clipped, an unknown
// priority / kind / status is refused for a save (the designer offers lists) and coerced, with a warning, for an
// upload (`lenient`), where other tools use their own words.
import { InputError } from '../service/sources.js'
import {
  AUTOMATION,
  CASE_KINDS,
  CASE_STATUSES,
  PRIORITIES,
  REQUIREMENT_KINDS,
  REQUIREMENT_STATUSES,
  resolve,
} from './meta.js'

export const MAX_STEPS = 200
const TEXT = 20000

export const clip = (v, n) =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, n)

/** Tags as a clean comma separated list without duplicates ("smoke, Login ,smoke" -> "smoke,Login"). */
export function cleanTags(v) {
  const parts = (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/))
    .map((t) => String(t).trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  const seen = new Set()
  const out = []
  for (const t of parts) {
    const k = t.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out.join(',').slice(0, 300)
}

export const tagList = (tags) => (tags ? String(tags).split(',').filter(Boolean) : [])

function choose(rows, value, field, { lenient, warnings, fallback }) {
  const id = resolve(rows, value)
  if (id) return id
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  if (lenient) {
    warnings?.push(`${field} "${String(value).slice(0, 40)}" is not known; "${fallback}" was used`)
    return fallback
  }
  throw new InputError(`${field} "${String(value).slice(0, 40)}" is not one of: ${rows.map((r) => r.id).join(', ')}`)
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined

/**
 * @param {object} input     the fields that were sent
 * @param {{create?: boolean, lenient?: boolean, warnings?: string[]}} [opts]  create: title is required and defaults apply
 * @returns {object} only the columns that were sent (all of them for a create)
 */
export function cleanRequirement(input, { create = false, lenient = false, warnings } = {}) {
  const i = input && typeof input === 'object' ? input : {}
  const out = {}
  const o = { lenient, warnings }
  if (create || has(i, 'title')) {
    out.title = clip(i.title, 300)
    if (!out.title) throw new InputError('A requirement needs a title')
  }
  for (const [key, max] of [['description', TEXT], ['acceptance', TEXT], ['source', 300], ['owner', 120]])
    if (has(i, key)) out[key] = clip(i[key], max)
  if (has(i, 'tags')) out.tags = cleanTags(i.tags)
  if (create || has(i, 'priority')) out.priority = choose(PRIORITIES, i.priority, 'priority', { ...o, fallback: 'medium' })
  if (create || has(i, 'kind')) out.kind = choose(REQUIREMENT_KINDS, i.kind, 'type', { ...o, fallback: 'functional' })
  if (create || has(i, 'status')) out.status = choose(REQUIREMENT_STATUSES, i.status, 'status', { ...o, fallback: 'draft' })
  return out
}

/** Steps: [{id, action, data, expected, auto}]. A row with no text at all is dropped; ids are made when missing. */
export function cleanSteps(list, { lenient = false } = {}) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw new InputError('The steps must be a list')
  if (list.length > MAX_STEPS) throw new InputError(`A test case can have ${MAX_STEPS} steps at most`)
  const used = new Set()
  const out = []
  for (const raw of list) {
    const s = raw && typeof raw === 'object' ? raw : { action: String(raw ?? '') }
    const step = {
      id: '',
      action: clip(s.action ?? s.step, 2000),
      data: clip(s.data ?? s.testData, 2000),
      expected: clip(s.expected ?? s.expectedResult, 2000),
      auto: Array.isArray(s.auto) ? s.auto.map((x) => String(x).slice(0, 40)).slice(0, 50) : [],
    }
    if (!step.action && !step.data && !step.expected) {
      if (lenient) continue
    }
    let id = String(s.id ?? '').slice(0, 20)
    if (!id || used.has(id)) {
      let n = out.length + 1
      while (used.has(`st${n}`)) n++
      id = `st${n}`
    }
    used.add(id)
    step.id = id
    out.push(step)
  }
  return out
}

export function parseSteps(text) {
  if (!text) return []
  try {
    const v = JSON.parse(text)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** @returns the columns of TestCases that were sent; `steps` comes back as an array under `stepList` (the caller stores it) */
export function cleanCase(input, { create = false, lenient = false, warnings } = {}) {
  const i = input && typeof input === 'object' ? input : {}
  const out = {}
  const o = { lenient, warnings }
  if (create || has(i, 'title')) {
    out.title = clip(i.title, 300)
    if (!out.title) throw new InputError('A test case needs a title')
  }
  for (const [key, max] of [['objective', TEXT], ['preconditions', TEXT], ['owner', 120]])
    if (has(i, key)) out[key] = clip(i[key], max)
  if (has(i, 'tags')) out.tags = cleanTags(i.tags)
  if (create || has(i, 'priority')) out.priority = choose(PRIORITIES, i.priority, 'priority', { ...o, fallback: 'medium' })
  if (create || has(i, 'kind')) out.kind = choose(CASE_KINDS, i.kind, 'type', { ...o, fallback: 'functional' })
  if (create || has(i, 'status')) out.status = choose(CASE_STATUSES, i.status, 'status', { ...o, fallback: 'draft' })
  if (has(i, 'automation')) out.automation = choose(AUTOMATION, i.automation, 'automation', { ...o, fallback: 'manual' })
  if (has(i, 'steps')) out.stepList = cleanSteps(i.steps, { lenient })
  else if (create) out.stepList = []
  return out
}

/** The same description text of a case as a table row for the list (counts instead of the steps). */
export const stepCount = (steps) => parseSteps(steps).length

/** Compares what a row has with what an upload brings: the names of the fields that differ. */
export function changedFields(row, next) {
  const diff = []
  for (const [k, v] of Object.entries(next)) {
    if (k === 'stepList') {
      const was = parseSteps(row.steps).map((s) => [s.action, s.data, s.expected].join('\u0001'))
      const now = v.map((s) => [s.action, s.data, s.expected].join('\u0001'))
      if (was.length !== now.length || was.some((x, n) => x !== now[n])) diff.push('steps')
      continue
    }
    if (String(row[k] ?? '') !== String(v ?? '')) diff.push(k)
  }
  return diff
}
