// Rule-based tour generator: deterministic, offline, no AI. It is the fallback when no provider is
// configured, the oracle in tests, and what the AI output is compared against.
import { validateTour, SCHEMA_VERSION } from '../../../shared/tour-schema.mjs'

const BUTTONISH = /\.(Button|ToggleButton|MenuButton|Link|IconTabFilter|SegmentedButtonItem)$/
const FIELDISH = /\.(Input|TextArea|DatePicker|DateTimePicker|TimePicker|StepInput|MaskInput)$/
const CHOICE = /\.(Select|ComboBox|MultiComboBox|MultiInput)$/
const TOGGLE = /\.(CheckBox|RadioButton|Switch)$/
const SEARCH = /\.SearchField$/
const LISTISH = /\.(Table|List|Tree|ListItemBase|StandardListItem|ObjectListItem|ColumnListItem)$/

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tour'
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

/** "onSave" -> "save"; only single-word verbs are useful in a sentence. */
function handlerVerb(handlers = {}) {
  const name = handlers.press ?? Object.values(handlers)[0]
  if (!name) return null
  const words = name
    .replace(/^(on|handle)/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
  return words.length === 1 && words[0] ? words[0] : null
}

function describeStep(control, step, display) {
  const type = control?.type ?? ''
  const name = display ?? 'this control'
  if (step.action === 'input' && SEARCH.test(type)) {
    return { title: 'Search', text: 'Type here to narrow down the list.' }
  }
  if (SEARCH.test(type)) return { title: 'Search', text: 'Use the search to find what you need.' }
  if (CHOICE.test(type))
    return { title: `Choose ${lower(name)}`, text: `Pick a value for **${name}**.` }
  if (FIELDISH.test(type) || step.action === 'input') {
    return { title: name, text: `Fill in **${name}**.` }
  }
  if (TOGGLE.test(type)) return { title: name, text: `Switch **${name}** on or off as needed.` }
  if (LISTISH.test(type))
    return { title: name, text: `Here you see **${name}**. Pick an entry to open it.` }
  if (BUTTONISH.test(type) || step.action === 'click') {
    const verb = handlerVerb(control?.handlers)
    const tail =
      step.navigatesTo !== undefined
        ? ' to continue'
        : verb && verb !== lower(name)
          ? ` to ${verb}`
          : ''
    return { title: `Press ${name}`, text: `Press **${name}**${tail}.` }
  }
  return { title: name, text: `This is **${name}**.` }
}

function placementFor(control) {
  const type = control?.type ?? ''
  const inFooter = (control?.path ?? []).some((p) => /footer/i.test(p))
  if (inFooter) return 'PreferredTopOrFlip'
  if (FIELDISH.test(type) || CHOICE.test(type)) return 'PreferredRightOrFlip'
  if (LISTISH.test(type)) return 'PreferredTopOrFlip'
  return 'PreferredBottomOrFlip'
}

function targetFor(ui5, control) {
  const fallbacks = []
  const display = ui5.display
  if (!ui5.localId) {
    if (display) fallbacks.push({ by: 'text', value: display })
    return { ...(ui5.viewName ? { viewName: ui5.viewName } : {}), fallbacks }
  }
  // a text fallback only helps when the control carries that text itself (buttons, links, ...)
  if (
    display &&
    control &&
    (control.text === display || control.title === display) &&
    BUTTONISH.test(control.type)
  ) {
    fallbacks.push({ by: 'text', value: display })
  }
  return {
    ...(ui5.viewName ? { viewName: ui5.viewName } : {}),
    controlId: ui5.globalId ?? ui5.localId,
    fallbacks,
  }
}

/**
 * The hash a press leads to, read from the controller: the control's handler calls navTo("route", {literal args}).
 * Null when there is no such handler, the route name is dynamic, or an argument is not a literal.
 */
export function navigationFromHandler(inventory, control) {
  const handler = control?.handlers?.press ?? Object.values(control?.handlers ?? {})[0]
  const view = inventory.views.find((v) => v.viewName === control?.viewName)
  const ctrl = inventory.controllers.find((c) => c.controllerName === view?.controllerName)
  const navs = (ctrl?.navigations ?? []).filter((n) => n.method === handler && !n.dynamic)
  if (navs.length !== 1) return null
  const route = inventory.routes.find((r) => r.name === navs[0].route)
  if (!route) return null
  return fillPattern(route.pattern, navs[0].argValues ?? {})
}

/** "order/{orderId}" + { orderId: "new" } -> "order/new"; null if a required parameter has no literal value. */
function fillPattern(pattern, values) {
  const out = []
  for (const seg of pattern.split('/')) {
    if (seg.startsWith('{') && seg.endsWith('}')) {
      const name = seg.slice(1, -1)
      if (name.startsWith('?')) continue // query parameter
      const value = values[name.split('*').join('')]
      if (value === undefined) return null
      out.push(value)
    } else if (seg.startsWith(':') && seg.endsWith(':') && seg.length > 1) {
      const name = seg.slice(1, -1)
      const value = name.startsWith('?') ? undefined : values[name]
      if (value !== undefined) out.push(value) // optional segment
    } else if (seg) {
      out.push(seg)
    }
  }
  return out.join('/')
}

/** Hash of a parameter-free route that shows the view, or null when it cannot be inferred. */
function routeHashFor(inventory, viewName) {
  const names = inventory.views.find((v) => v.viewName === viewName)?.routes ?? []
  const route = inventory.routes.find(
    (r) => names.includes(r.name) && r.params.length === 0 && !/[{:]/.test(r.pattern),
  )
  return route ? route.pattern : null
}

/**
 * @param {{recording: object, inventory: object, title?: string, id?: string, intro?: boolean}} args
 *   `recording` must already be mapped (mapRecording).
 * @returns {{tour: object, report: {steps: number, unresolved: number, skipped: number}}}
 */
export function generateTourFromRules({ recording, inventory, title, id, intro = true }) {
  const tourTitle = title ?? recording.title ?? 'Guided tour'
  const find = (ui5) =>
    inventory.controls.find(
      (c) =>
        c.viewName === ui5.viewName &&
        c.localId === ui5.localId &&
        (ui5.localId || c.display === ui5.display),
    )
  const steps = []
  let skipped = 0
  let currentHash = recording.steps.find((s) => s.action === 'navigate')?.hash ?? null
  let pendingHash = null
  let seenFirstNavigate = false
  let lastView = null

  for (const s of recording.steps) {
    if (s.action === 'navigate') {
      if (seenFirstNavigate) pendingHash = s.hash
      seenFirstNavigate = true
      continue
    }
    if (s.action === 'check') continue // for tests, not for tours
    if (s.action !== 'click' && s.action !== 'input') {
      skipped++
      continue
    }
    const n = steps.length + 1
    // recordings without URLs (Test Recorder, plain text): infer the route from the manifest when the view changes
    if (pendingHash === null && s.ui5?.viewName && lastView && s.ui5.viewName !== lastView) {
      pendingHash = routeHashFor(inventory, s.ui5.viewName)
    }
    if (s.ui5?.viewName) lastView = s.ui5.viewName
    const before =
      pendingHash !== null && pendingHash !== currentHash
        ? [{ type: 'navigate', hash: pendingHash }]
        : []
    if (before.length) currentHash = pendingHash
    pendingHash = null

    if (s.ui5 && !s.ui5.selectorOnly) {
      const control = find(s.ui5)
      const { title: t, text } = describeStep(control, s, s.ui5.display)
      steps.push({
        id: `s${n}`,
        title: t,
        text,
        target: targetFor(s.ui5, control),
        placement: placementFor(control),
        before,
        meta: { source: `recording:${s.index}`, confidence: s.ui5.confidence, unresolved: false },
      })
    } else {
      const label = s.dom?.ariaLabel ?? s.dom?.text ?? s.text ?? null
      steps.push({
        id: `s${n}`,
        title: label ? `Press ${label}` : `Step ${n}`,
        text: label ? `Press **${label}**.` : '',
        before,
        meta: {
          source: `recording:${s.index}`,
          confidence: 0,
          unresolved: true,
          note: s.ui5?.selectorOnly
            ? 'This control has no id and no text: tests can find it, a tour cannot'
            : 'No matching control found in the app sources',
        },
      })
    }
    const inferred =
      s.navigatesTo === undefined && s.ui5 ? navigationFromHandler(inventory, find(s.ui5)) : null
    if (s.navigatesTo !== undefined) pendingHash = s.navigatesTo
    else if (inferred !== null) pendingHash = inferred
  }

  if (intro) {
    steps.unshift({
      id: 'intro',
      title: tourTitle,
      text: `Let us walk through **${tourTitle}** step by step.`,
      meta: { source: 'rules' },
    })
  }
  if (!steps.length) throw new Error('The recording contains no usable click or input steps')

  const draft = {
    schemaVersion: SCHEMA_VERSION,
    id: id ?? slug(tourTitle),
    title: tourTitle,
    steps,
  }
  const result = validateTour(draft)
  if (!result.ok)
    throw new Error(
      'Rule generator produced an invalid tour: ' +
        result.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
    )
  return {
    tour: result.tour,
    report: {
      steps: steps.length,
      unresolved: steps.filter((st) => st.meta?.unresolved).length,
      skipped,
    },
  }
}
