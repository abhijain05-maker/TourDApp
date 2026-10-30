// A recording written by the TourD recorder (shared/recording-schema.mjs) -> normalised recording.
// Unlike the other formats it already names the exact control (view + local id), so mapping is 1:1.
import { looksLikeRecording, validateRecording } from '../../../shared/recording-schema.mjs'
import { routerHashOf } from './devtools-recorder.js'

export const FORMAT = 'tourd-recorder'

function toObject(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw.replace(/^﻿/, ''))
  } catch {
    return null
  }
}

export function detect(raw) {
  return looksLikeRecording(toObject(raw))
}

/** Id as written in the view; a clone made by a list binding ("row-3") is traced back to its template ("row"). */
function viewLocalId(control) {
  if (!control.stableId) {
    if (control.inList && control.localId && !/^__/.test(control.localId)) {
      const m = /^(.+)-\d+$/.exec(control.localId)
      if (m) return m[1]
    }
    return null
  }
  return control.localId
}

function ui5Of(control) {
  return {
    viewName: control.viewName,
    controlId: viewLocalId(control),
    controlType: control.controlType,
    text: control.text ?? control.label ?? null,
    bindingPath: control.bindingPath ?? null,
    via: 'tourd-recorder',
    // facts only this recorder knows; the designer shows them
    controllerName: control.controllerName,
    label: control.label ?? null,
    i18n: control.i18n ?? null,
    stableId: control.stableId,
    ...(control.inList ? { inList: true } : {}),
    ...(control.itemText
      ? {
          itemText: control.itemText,
          itemTextType: control.itemTextType,
          itemTextProperty: control.itemTextProperty,
        }
      : {}),
    ...(control.inDialog ? { inDialog: true } : {}),
    runtimeId: control.id,
    ...(control.selector ? { selector: control.selector } : {}),
  }
}

const hashOf = (step) => routerHashOf(step.url ?? `http://app/#${step.hash ?? ''}`)

export function parse(raw) {
  const check = validateRecording(toObject(raw))
  if (!check.ok) {
    const first = check.issues
      .slice(0, 3)
      .map((i) => `${i.path || 'recording'}: ${i.message}`)
      .join('; ')
    throw new Error(`Not a valid TourD recording (${first})`)
  }
  const rec = check.recording
  const steps = []
  // steps by recorder index -> position in `steps`, so a navigation can be attached to the action behind it
  const position = new Map()
  let skipped = 0

  const startUrl = rec.app.url + (rec.app.startHash ? `#${rec.app.startHash}` : '')
  steps.push({
    index: 0,
    source: FORMAT,
    action: 'navigate',
    url: startUrl,
    hash: routerHashOf(startUrl),
  })

  for (const s of rec.steps) {
    const base = { index: steps.length, source: FORMAT }
    if (s.type === 'navigate') {
      const target = s.causedBy !== undefined ? steps[position.get(s.causedBy)] : null
      if (target && target.navigatesTo === undefined) {
        target.navigatesTo = hashOf(s) // like a DevTools click that asserts a navigation
      } else {
        steps.push({ ...base, action: 'navigate', url: s.url ?? startUrl, hash: hashOf(s) })
      }
      continue
    }
    if (s.type === 'note') {
      steps.push({ ...base, action: 'note', note: s.note, text: s.note, authored: true })
      continue
    }
    const ui5 = s.control ? ui5Of(s.control) : undefined // (a message toast check has no control)
    let step
    switch (s.type) {
      case 'press':
        step = { ...base, action: 'click', ui5 }
        break
      case 'input':
        step = { ...base, action: 'input', value: String(s.value ?? ''), ui5 }
        break
      case 'search':
        step = { ...base, action: 'input', value: String(s.value ?? ''), submit: true, ui5 }
        break
      case 'select':
        step = {
          ...base,
          action: 'click',
          choice: s.valueText ?? (s.value === undefined ? undefined : String(s.value)),
          ...(s.value === undefined ? {} : { choiceKey: String(s.value) }),
          ui5,
        }
        break
      case 'toggle':
        step = { ...base, action: 'click', toggled: s.value === true, ui5 }
        break
      case 'check':
        // something the person wanted checked, not something they did: tests turn it into an assertion
        step = { ...base, action: 'check', check: s.check, ui5 }
        break
      default:
        skipped++
        continue
    }
    if (s.redacted) step.redacted = true
    if (s.explain) step.explain = s.explain
    position.set(s.index, steps.length)
    steps.push(step)
  }

  return {
    format: FORMAT,
    title: rec.app.title || null,
    startUrl,
    app: { appId: rec.app.appId, ui5Version: rec.app.ui5Version, locale: rec.app.locale },
    steps,
    skipped,
    ...(rec.purpose ? { purpose: rec.purpose } : {}),
  }
}
