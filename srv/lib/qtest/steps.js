// The bridge between a manual test case and a wdi5 plan (shared/wdi5-plan.mjs).
//
//   stepsFromPlan()      plan -> manual steps (text a tester can follow), each remembering its plan steps (`auto`)
//   alignSteps()         manual steps + a plan made elsewhere (a recording) -> which plan steps belong to which step
//   interpretRules()     manual step text -> what to do in the app (rules; a model does the same in ai.js)
//   planFromSteps()      interpretations + the app's controls -> a plan, through the same buildPlan the recorder uses
//
// Nothing is guessed silently: a step whose control cannot be found stays in the plan, switched off, with the reason,
// and a check that cannot be turned into an assertion stays a manual check.
import { buildPlan } from '../wdi5/plan.js'

const lastSegment = (t) => String(t ?? '').split('.').pop()

const TYPE_WORD = [
  [/Button$/, 'button'],
  [/Link$/, 'link'],
  [/IconTabFilter$/, 'tab'],
  [/(ComboBox|Select)$/, 'dropdown'],
  [/SearchField$/, 'search field'],
  [/CheckBox$/, 'checkbox'],
  [/RadioButton$/, 'radio button'],
  [/Switch$/, 'switch'],
  [/ListItem$/, 'list item'],
  [/(Input|TextArea|DatePicker|TimePicker|DateTimePicker|StepInput)$/, 'field'],
]
const wordOf = (type) => TYPE_WORD.find(([re]) => re.test(lastSegment(type)))?.[1] ?? 'control'

// ---- plan -> manual steps ------------------------------------------------------------------------------------------

/** @returns {{id: string, action: string, data: string, expected: string, auto: string[]}[]} */
export function stepsFromPlan(plan) {
  const out = []
  let n = 0
  const add = (action, data, auto) => out.push({ id: `st${++n}`, action, data: data ?? '', expected: '', auto: [auto] })
  for (const s of plan.steps) {
    if (s.enabled === false) continue
    const lo = s.locator ? plan.locators[s.locator] : null
    const name = lo?.display || null
    const label = name ? `"${name}" ${wordOf(lo.controlType)}` : null
    if (s.kind === 'open') add(s.hash ? `Open the application at "#/${s.hash.replace(/^#?\/?/, '')}"` : 'Open the application', '', s.id)
    else if (s.kind === 'press') add(label ? `Click the ${label}` : s.title, '', s.id)
    else if (s.kind === 'enterText') add(label ? `Enter the value in the ${label}` : s.title, s.value ?? '', s.id)
    else if (s.kind === 'search') add(label ? `Search in the ${label}` : 'Search', s.value ?? '', s.id)
    else if (s.kind === 'select') add(label ? `Choose an entry in the ${label}` : s.title, s.choice ?? '', s.id)
    else if (s.kind === 'assert') {
      // a check belongs to the action before it (or opens the case when nothing came before)
      if (!out.length) add('Check the application', '', s.id)
      const last = out[out.length - 1]
      last.expected = last.expected ? `${last.expected}; ${s.title}` : s.title
      if (!last.auto.includes(s.id)) last.auto.push(s.id)
    }
  }
  return out
}

// ---- manual steps + plan -> map -----------------------------------------------------------------------------------

const STOP = new Set(['the', 'and', 'for', 'with', 'into', 'click', 'press', 'enter', 'choose', 'select', 'page', 'button', 'field', 'then', 'that', 'this', 'から'])
const tokens = (s) =>
  new Set(
    String(s ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )
const overlap = (a, b) => {
  if (!a.size || !b.size) return 0
  let hit = 0
  for (const w of a) if (b.has(w)) hit++
  return hit / Math.min(a.size, b.size)
}
const OPEN_WORDS = /\b(open|launch|start|navigate|go to|visit|load|call)\b/i

/**
 * For each manual step the plan steps that do it (plus the checks that follow). Steps are matched in order, so a plan
 * step is used once. Manual steps without a match keep an empty `auto`: they stay manual.
 * @returns {Map<string, string[]>} step id -> plan step ids
 */
export function alignSteps(manual, plan, threshold = 0.34) {
  const plans = plan.steps.filter((s) => s.enabled !== false)
  const map = new Map()
  let at = 0
  for (const m of manual) {
    const want = tokens(`${m.action} ${m.data}`)
    let best = -1
    let bestScore = 0
    for (let i = at; i < plans.length; i++) {
      const p = plans[i]
      if (p.kind === 'assert') continue
      const lo = p.locator ? plan.locators[p.locator] : null
      let score = overlap(want, tokens(`${p.title} ${lo?.display ?? ''} ${p.value ?? ''} ${p.choice ?? ''}`))
      if (p.kind === 'open' && OPEN_WORDS.test(m.action)) score = Math.max(score, 0.9)
      if (score > bestScore + 1e-9) (best = i), (bestScore = score)
      if (score >= 0.99) break
    }
    if (best < 0 || bestScore < threshold) {
      map.set(m.id, [])
      continue
    }
    const ids = [plans[best].id]
    let j = best + 1
    while (j < plans.length && plans[j].kind === 'assert') ids.push(plans[j++].id)
    map.set(m.id, ids)
    at = j
  }
  return map
}

// ---- manual step text -> actions (rules) --------------------------------------------------------------------------

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
const namesOf = (c) => [c.display, c.text, c.title, c.tooltip, c.label, c.placeholder].filter((v) => typeof v === 'string' && v.trim()).map(norm)

const CLICKABLE = /(Button|Link|IconTabFilter|ListItem|CheckBox|RadioButton|Switch|ToggleButton|MenuButton|Tile|Item)$/
const TYPEABLE = /(Input|TextArea|DatePicker|TimePicker|DateTimePicker|StepInput|ComboBox|SearchField|Field)$/
const CHOOSABLE = /(Select|ComboBox|MultiComboBox)$/

export function quoted(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(/["“”„«»]([^"“”„«»]{1,160})["“”„«»]|(?<![A-Za-z0-9])'([^']{1,160})'(?![A-Za-z0-9])/g)) out.push((m[1] ?? m[2]).trim())
  return out.filter(Boolean)
}

/** The control a label names: equal text first, then a text that contains it; controls that fit the type win. */
export function findControl(label, controls, typeRe) {
  const needle = norm(label)
  if (!needle) return null
  const rank = (c) => (typeRe?.test(c.type) ? 2 : 0) + (c.hasStableId ? 1 : 0)
  const exact = controls.filter((c) => namesOf(c).includes(needle))
  const pool = exact.length ? exact : needle.length >= 3 ? controls.filter((c) => namesOf(c).some((n) => n.includes(needle))) : []
  if (!pool.length) return null
  const fitting = typeRe ? pool.filter((c) => typeRe.test(c.type)) : []
  const chosen = (fitting.length ? fitting : pool).slice().sort((a, b) => rank(b) - rank(a))
  return { control: chosen[0], exact: exact.length > 0, ambiguous: chosen.length > 1 && rank(chosen[0]) === rank(chosen[1]) }
}

const afterVerb = (text) => {
  const m = /\b(?:click|press|tap|hit|choose|select|open|activate|push|expand|go to|navigate to)(?: on)?(?: the)?\s+(.+?)(?:\s+(?:button|link|tab|icon|item|field|checkbox|radio button|dropdown|menu|tile|switch))?\s*[.!]?$/i.exec(text)
  return m ? m[1].replace(/^(a|an|the)\s+/i, '').trim() : ''
}

/**
 * What a manual step asks the app to do, as far as the rules can tell.
 * @returns {{actions: object[], checks: object[], manual: string[]}} actions: {kind, control?, label?, value?, choice?, submit?}
 *   checks: {kind: visible|value|toast, control?, expected?}; manual: the parts that stay a human check
 */
export function interpretRules(step, controls) {
  const text = step.action ?? ''
  const data = (step.data ?? '').trim()
  const q = quoted(text)
  const actions = []
  const checks = []
  const manual = []

  if (text.trim()) {
    const isSearch = /\bsearch/i.test(text)
    const isEnter = /\b(enter|type|fill|input|write|provide)\b/i.test(text)
    const isChoose = /\b(choose|select|pick)\b/i.test(text) && (data || q.length > 1 || /\b(from|in)\b.*\b(dropdown|list|select|box)\b|\b(dropdown|combo)\b/i.test(text))
    const isOpen = OPEN_WORDS.test(text) && !/\b(button|link|tab|dialog|menu|row|item|tile)\b/i.test(text)
    const isPress = /\b(click|press|tap|hit|push|activate|expand|confirm|submit|save|create|add|delete|choose|select)\b/i.test(text)

    if (isSearch) {
      const field = controls.find((c) => /SearchField$/.test(c.type))
      actions.push({ kind: 'search', control: field ?? null, label: 'search field', value: data || q[0] || '', submit: true })
    } else if (isEnter) {
      let label = ''
      let value = data
      if (data) label = q[0] ?? ''
      else if (q.length >= 2) {
        // "Enter "ACME" in the "Customer" field": the quoted text that names a field is the label
        const a = findControl(q[1], controls, TYPEABLE)
        const b = findControl(q[0], controls, TYPEABLE)
        if (a && (!b || a.exact >= b.exact)) (value = q[0]), (label = q[1])
        else (value = q[1]), (label = q[0])
      } else if (q.length === 1) label = q[0]
      if (!label) label = /\b(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+(?:field|input|box))?\s*$/i.exec(text)?.[1] ?? ''
      const hit = label ? findControl(label, controls, TYPEABLE) : null
      actions.push({ kind: 'enterText', control: hit?.control ?? null, label: label || 'input field', value })
    } else if (isChoose) {
      const choice = data || q[0] || ''
      const label = data ? (q[0] ?? '') : (q[1] ?? '')
      const hit = label ? findControl(label, controls, CHOOSABLE) : null
      actions.push({ kind: 'select', control: hit?.control ?? controls.find((c) => CHOOSABLE.test(c.type) && !label) ?? null, label: label || 'dropdown', choice })
    } else if (isOpen && !q.length) {
      actions.push({ kind: 'open' })
    } else if (isPress || q.length) {
      const label = q[0] || afterVerb(text)
      const hit = label ? findControl(label, controls, CLICKABLE) : null
      actions.push({ kind: 'press', control: hit?.control ?? null, label: label || 'control' })
    } else if (isOpen) {
      actions.push({ kind: 'open' })
    } else {
      manual.push(text)
    }
  }

  const expected = step.expected ?? ''
  for (const part of expected.split(/[;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    const pq = quoted(part)
    if (/\b(message|toast|notification|snackbar)\b/i.test(part) && pq.length) {
      checks.push({ kind: 'toast', expected: pq[0] })
      continue
    }
    if (pq.length && /\b(contains?|holds?|shows?|has|equals?|is set to|displays?)\b/i.test(part) && /\b(field|input|value|box)\b/i.test(part)) {
      const hit = findControl(pq[1] ?? pq[0], controls, TYPEABLE) ?? (pq.length === 1 ? null : findControl(pq[0], controls, TYPEABLE))
      if (hit && pq.length >= 2) {
        checks.push({ kind: 'value', control: hit.control, expected: hit.control === findControl(pq[1], controls, TYPEABLE)?.control ? pq[0] : pq[1] })
        continue
      }
    }
    if (pq.length && /\b(visible|displayed|shown|appears?|present|available|opens?|is open)\b/i.test(part)) {
      const hit = findControl(pq[0], controls, null)
      if (hit) {
        checks.push({ kind: 'visible', control: hit.control })
        continue
      }
    }
    manual.push(part)
  }
  return { actions, checks, manual }
}

// ---- interpretations -> plan --------------------------------------------------------------------------------------

const ui5Of = (c) => ({
  viewName: c.viewName,
  localId: c.localId,
  ...(c.globalId ? { globalId: c.globalId } : {}),
  type: c.type,
  display: c.display,
  hasStableId: c.hasStableId,
  via: 'text',
  confidence: 0.6,
})
const recordedOf = (c) => (c.scope === 'fragment' ? { inDialog: true, controlType: c.type, controlId: c.localId, stableId: c.hasStableId, text: c.text ?? undefined, label: c.label ?? undefined } : undefined)

/**
 * @param {{id: string, action: string, data: string, expected: string}[]} steps
 * @param {object[]} interpretations   one per step: {actions, checks, manual}
 * @param {{inventory: object|null, name: string, settings?: object}} ctx
 * @returns {{plan: object, mapping: Map<string, string[]>, report: {automated: number, manualOnly: {stepId: string, why: string}[], unresolved: number}}}
 */
export function planFromSteps(steps, interpretations, { inventory, name, settings = {} }) {
  const mappedSteps = []
  const owner = [] // index in the synthetic recording -> step id
  const add = (stepId, s) => {
    const index = mappedSteps.length
    mappedSteps.push({ index, ...s })
    owner[index] = stepId
  }
  mappedSteps.push({ index: 0, action: 'navigate' })
  owner[0] = steps.find((_, i) => interpretations[i]?.actions?.some((a) => a.kind === 'open'))?.id ?? steps[0]?.id ?? null
  const manualOnly = []
  steps.forEach((step, i) => {
    const it = interpretations[i] ?? { actions: [], checks: [], manual: [] }
    for (const a of it.actions) {
      if (a.kind === 'open') continue // the plan opens the app first anyway; the step that asked for it owns that step
      const c = a.control
      const base = { ui5: c ? ui5Of(c) : undefined, recorded: c ? recordedOf(c) : { text: a.label, controlType: a.kind === 'enterText' ? 'sap.m.Input' : a.kind === 'select' ? 'sap.m.Select' : 'sap.m.Button' } }
      if (a.kind === 'press') add(step.id, { ...base, action: 'click' })
      else if (a.kind === 'enterText') add(step.id, { ...base, action: 'input', value: a.value ?? '' })
      else if (a.kind === 'search') add(step.id, { ...base, action: 'input', value: a.value ?? '', submit: true })
      else if (a.kind === 'select') add(step.id, { ...base, action: 'click', choice: a.choice ?? '', choiceKey: undefined })
    }
    // the plan checks a typed value by itself (buildPlan adds it): a second check of the same would only repeat it
    const typed = it.actions.filter((x) => x.kind === 'enterText' && x.control)
    const checks = it.checks.filter((k) => !(k.kind === 'value' && typed.some((x) => x.control === k.control && String(x.value) === String(k.expected))))
    for (const k of checks) add(step.id, { action: 'check', ui5: k.control ? ui5Of(k.control) : undefined, recorded: k.control ? recordedOf(k.control) : undefined, check: { kind: k.kind, expected: k.expected } })
    for (const m of it.manual) manualOnly.push({ stepId: step.id, why: m })
  })
  const plan = buildPlan({ mapped: { steps: mappedSteps, name }, inventory, name, settings })
  // plan step -> manual step: through the index of the synthetic recording; checks TourD added by itself follow their action
  const mapping = new Map(steps.map((s) => [s.id, []]))
  let current = steps[0]?.id ?? null
  for (const p of plan.steps) {
    const idx = p.from?.index
    if (idx !== undefined && idx !== null && owner[idx]) current = owner[idx]
    if (current && mapping.has(current)) mapping.get(current).push(p.id)
  }
  const automated = steps.filter((s) => mapping.get(s.id).length).length
  return { plan, mapping, report: { automated, manualOnly, unresolved: plan.steps.filter((s) => s.enabled === false).length } }
}

/** The controls a rule or a model may pick from: interactive ones with a text or an id, most useful first. */
export function controlsOf(inventory, limit = 400) {
  const list = (inventory?.controls ?? []).filter((c) => c.type && (c.display || c.localId))
  const useful = (c) => (c.display ? 2 : 0) + (c.hasStableId ? 1 : 0) + (CLICKABLE.test(c.type) || TYPEABLE.test(c.type) || CHOOSABLE.test(c.type) ? 2 : 0)
  return list.slice().sort((a, b) => useful(b) - useful(a)).slice(0, limit)
}
