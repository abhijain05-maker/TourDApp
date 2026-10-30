// Recording -> wdi5 test plan. The input is a mapped recording (srv/lib/recordings/map.js: every step that could be
// matched carries `ui5`, the TourD recorder adds `recorded`), the output is plain data (shared/wdi5-plan.mjs) that
// the designer shows as a table and that render.js turns into files. Rules only, nothing guessed: a step whose
// control could not be found stays in the plan, switched off, with the reason.
import { DEFAULT_SETTINGS, PLAN_VERSION } from '../../../shared/wdi5-plan.mjs'

const TEXT_PROPERTY = new Map([
  ['sap.m.Button', 'text'],
  ['sap.m.ToggleButton', 'text'],
  ['sap.m.MenuButton', 'text'],
  ['sap.m.Link', 'text'],
  ['sap.m.IconTabFilter', 'text'],
  ['sap.m.StandardListItem', 'title'],
  ['sap.m.ObjectListItem', 'title'],
])
const LABELLED =
  /^sap\.m\.(Input|TextArea|Select|ComboBox|DatePicker|CheckBox|Switch|MultiComboBox)$/
const VALUE_CONTROLS = new Set(['sap.m.Input', 'sap.m.TextArea', 'sap.m.SearchField'])

const lastSegment = (name) =>
  String(name ?? '')
    .split('.')
    .pop()
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** "Create an order!" -> "createAnOrder"; always a valid JavaScript identifier. */
export function identifier(text, fallback = 'control') {
  const words = String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const id = words.map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : cap(w))).join('')
  return /^[A-Za-z_]/.test(id) ? id.slice(0, 40) : fallback
}

/** "Create-an-order" for file names. */
export function slug(text, fallback = 'journey') {
  const s = String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return s || fallback
}

/** The ways to find a control, best first. */
export function selectorCandidates({ ui5, recorded, control }) {
  const controlType = ui5?.type ?? recorded?.controlType ?? null
  const viewName = ui5?.viewName ?? recorded?.viewName ?? null
  // A control in a dialog is looked for in the open dialogs: without that a button named Save is the Save of the page,
  // and its view is not the view the dialog is in.
  const inDialog = recorded?.inDialog === true
  const base = {
    ...(controlType ? { controlType } : {}),
    ...(inDialog ? { searchOpenDialogs: true } : viewName ? { viewName } : {}),
  }
  const out = []
  const localId = ui5?.localId ?? recorded?.controlId ?? null
  if (localId && (ui5?.hasStableId ?? recorded?.stableId ?? true) && viewName)
    out.push({ strategy: 'id', selector: { id: localId, viewName } })
  const i18n = recorded?.i18n
  if (i18n?.key && controlType && viewName)
    out.push({
      strategy: 'i18n',
      selector: { ...base, i18NText: { propertyName: i18n.property, key: i18n.key } },
    })
  const property = TEXT_PROPERTY.get(controlType)
  const text = recorded?.text ?? control?.text ?? null
  if (property && text && controlType && viewName)
    out.push({ strategy: 'text', selector: { ...base, properties: { [property]: text } } })
  const label = recorded?.label ?? control?.label ?? null
  if (label && LABELLED.test(controlType ?? '') && viewName)
    out.push({ strategy: 'label', selector: { ...base, labelFor: { text: label } } })
  if (recorded?.bindingPath && !isTransient(recorded.bindingPath) && controlType && viewName)
    out.push({
      strategy: 'binding',
      selector: { ...base, bindingPath: { propertyPath: recorded.bindingPath } },
    })
  // UI5's own selector for this very control (what its Test Recorder would write): the way to find a control that
  // has no id of its own. With an id the id stays first, it is the most readable.
  const own = ownSelector(withoutTransient(recorded?.selector, recorded))
  if (own && !out.some((c) => JSON.stringify(c.selector) === JSON.stringify(own))) {
    const idFirst = out[0]?.strategy === 'id'
    out.splice(idFirst ? 1 : 0, 0, { strategy: 'ui5', selector: own })
  }
  return out
}

// A path like /TravelStatus($uid=id-1793188072908-826) names a row by a client-side id that is made up again in every
// session: a selector that holds one finds nothing the next time.
const TRANSIENT = /[$]uid=/
export const isTransient = (value) =>
  TRANSIENT.test(typeof value === 'string' ? value : JSON.stringify(value ?? ''))

/**
 * The selector with its temporary binding paths replaced by the text the row showed when it was recorded: a row (or the
 * text inside it) that shows that text is the same row in the next session.
 * @returns the selector, or null when it has a temporary path and the row's text is not known
 */
export function withoutTransient(selector, recorded) {
  if (!isTransient(selector)) return selector
  const text = recorded?.itemText
  if (!text) return null
  const prop = recorded.itemTextProperty || 'text'
  const type = recorded.itemTextType || 'sap.m.Text'
  const rewrite = (node) => {
    if (Array.isArray(node)) return node.map(rewrite)
    if (!node || typeof node !== 'object') return node
    const out = {}
    for (const [key, value] of Object.entries(node))
      if (key !== 'bindingPath') out[key] = rewrite(value)
    if (node.bindingPath !== undefined && !isTransient(node.bindingPath))
      out.bindingPath = node.bindingPath
    if (isTransient(node.bindingPath)) {
      if (node.controlType === type) out.properties = { ...(out.properties ?? {}), [prop]: text }
      else
        out.descendant = out.descendant ?? {
          controlType: type,
          properties: { [prop]: text },
          ...(node.searchOpenDialogs ? { searchOpenDialogs: true } : {}),
          ...(node.viewId ? { viewId: node.viewId } : {}),
          ...(node.viewName ? { viewName: node.viewName } : {}),
        }
    }
    return out
  }
  return rewrite(selector)
}

/** The selector UI5 gave, as a wdi5 selector: only what wdi5 understands, nothing that is not plain data. */
function ownSelector(selector) {
  if (!selector || typeof selector !== 'object') return null
  const allowed = [
    'id',
    'viewName',
    'controlType',
    'properties',
    'bindingPath',
    'i18NText',
    'labelFor',
    'ancestor',
    'descendant',
    'sibling',
    'interaction',
    'searchOpenDialogs',
    'viewId',
  ]
  const out = {}
  for (const key of allowed) if (selector[key] !== undefined) out[key] = selector[key]
  return Object.keys(out).length ? out : null
}

const typeOf = (s) => s.ui5?.type ?? s.recorded?.controlType ?? ''
const idOf = (s) => s.recorded?.controlId ?? s.ui5?.localId ?? ''
// the id of a control in a dialog has no view in front of it: its full id is all there is
const anyIdOf = (s) => idOf(s) || s.recorded?.runtimeId || ''
// the fields around a control: sap.ui.mdc.Field, sap.fe.macros.Field, FieldAPI
const WRAPPER = /\.Field(Base|API)?$/

/**
 * One action on a Fiori elements screen is reported by several controls: the field and the control inside it, the
 * filter bar and its API, the picker icon before a typed date. Leaves the step that really does the thing, so the
 * generated test does not type the same text three times or "search" with nothing in it.
 */
export function tidySteps(steps) {
  const list = steps ?? []
  const actionable = (s) => s.action === 'click' || s.action === 'input'
  return list.filter((s, i) => {
    const type = typeOf(s)
    const id = idOf(s)
    if (s.action === 'input' && /\.FilterBar(API)?$/.test(type)) return false // the Go button does the search
    if (/HideFormGroupAutomatically$|RowActionItem$/.test(type)) return false // helpers of the screen, not of the person
    if (!actionable(s)) return true
    const near = [list[i - 2], list[i - 1], list[i + 1], list[i + 2]].filter(
      (x) => x && actionable(x),
    )
    // the field around the control that was typed into / toggled
    if (s.action === 'input' && WRAPPER.test(type)) {
      const mine = anyIdOf(s)
      // the control inside it has a step of its own (its id continues the id of the field): that is what was done
      if (
        mine &&
        list.some((o) => {
          if (o === s || !actionable(o) || WRAPPER.test(typeOf(o))) return false
          const theirs = anyIdOf(o)
          return (
            theirs !== mine && theirs.startsWith(mine) && /^[-:]/.test(theirs.slice(mine.length))
          )
        })
      )
        return false
      if (
        mine &&
        near.some(
          (o) =>
            anyIdOf(o) !== mine &&
            ((o.action === 'input' && o.value === s.value && anyIdOf(o).startsWith(mine)) ||
              (o.toggled !== undefined && /^(true|false)$/.test(String(s.value)))),
        )
      )
        return false
    }
    // One tick in a list reports two clicks: the checkbox (or radio button) and the row around it. Replaying both would
    // switch the item on and off again, so the row step is left out; the box is the one that says what happened.
    if (s.action === 'click' && /ListItem$/.test(type)) {
      const before = list[i - 1]
      const row = s.recorded?.bindingPath
      if (
        before &&
        before.action === 'click' &&
        /(CheckBox|RadioButton)$/.test(typeOf(before)) &&
        row &&
        before.recorded?.bindingPath === row
      )
        return false
    }
    // the picker icon that opened the date that was typed next
    if (s.action === 'click' && /-edit-icon$/.test(id))
      if (near.some((o) => o.action === 'input' && idOf(o) === id.replace(/-edit-icon$/, '-edit')))
        return false
    return true
  })
}

const controlOf = (inventory, ui5) =>
  inventory?.controls?.find(
    (c) =>
      c.viewName === ui5?.viewName &&
      (ui5.localId ? c.localId === ui5.localId : !c.localId && c.display === ui5.display),
  ) ?? null

/**
 * @param {{mapped: object, inventory: object|null, name: string, settings?: object}} args
 * @returns {object} a plan (see shared/wdi5-plan.mjs)
 */
export function buildPlan({ mapped, inventory, name, settings = {} }) {
  const locators = {}
  const used = new Set()
  const keyFor = (ui5, recorded) => {
    const view = lastSegment(ui5?.viewName ?? recorded?.viewName).replace(/View$/, '')
    const own = ui5?.localId ?? recorded?.controlId
    const display = ui5?.display
    const type = lastSegment(ui5?.type ?? recorded?.controlType)
    const bases = [
      identifier(own, ''),
      identifier(`${display ?? ''} ${type}`, ''),
      identifier(`${recorded?.itemText ?? ''} ${type}`, ''),
      identifier(type, 'control'),
    ]
    const base = bases.find(Boolean)
    for (const candidate of [base, identifier(`${view} ${base}`, base)])
      if (!used.has(candidate)) return candidate
    let n = 2
    while (used.has(`${base}${n}`)) n++
    return `${base}${n}`
  }
  const locatorFor = (step) => {
    const { ui5, recorded } = step
    const candidates = selectorCandidates({ ui5, recorded, control: controlOf(inventory, ui5) })
    if (!candidates.length) return null
    // (not the view and id alone: controls without an id are told apart by their selector)
    const id = JSON.stringify([ui5.viewName, candidates[0].selector])
    const existing = Object.entries(locators).find(([, l]) => l.__id === id)
    if (existing) return existing[0]
    const key = keyFor(ui5, recorded)
    used.add(key)
    const [best, ...alternatives] = candidates
    locators[key] = {
      name: key,
      strategy: best.strategy,
      selector: best.selector,
      alternatives,
      controlType: ui5.type ?? recorded?.controlType ?? null,
      viewName: ui5.viewName ?? null,
      display: ui5.display ?? null,
      ...(best.strategy !== 'id'
        ? {
            note: 'No stable id: found by its text or label. Give the control an id in the view for a sturdier test.',
          }
        : {}),
    }
    Object.defineProperty(locators[key], '__id', { value: id, enumerable: false })
    return key
  }

  const steps = []
  let n = 0
  const add = (s) => steps.push({ id: `s${++n}`, enabled: true, locator: null, ...s })
  const from = (s) => ({
    index: s.index ?? null,
    via: s.ui5?.via ?? null,
    confidence: s.ui5?.confidence ?? null,
  })

  let opened = false
  for (const s of tidySteps(mapped.steps)) {
    if (s.action === 'navigate') {
      if (opened) continue
      opened = true
      add({
        kind: 'open',
        title: 'Open the app',
        ...(s.hash ? { hash: s.hash } : {}),
        from: from(s),
      })
      continue
    }
    if (!['click', 'input', 'check'].includes(s.action)) continue
    if (!opened) {
      opened = true
      add({ kind: 'open', title: 'Open the app' })
    }
    if (s.action === 'check' && s.check?.kind === 'toast') {
      // the app showed a message toast: no control to find, the text of the message is the whole check. It is put
      // right after the step that showed it, before the checks TourD adds by itself (the page is the start page
      // again): those wait for the app to settle, and a toast is gone after about three seconds.
      add({
        kind: 'assert',
        title: `A message shows "${s.check.expected ?? ''}"`,
        locator: null,
        assertion: { type: 'toast', expected: s.check.expected ?? '' },
        from: from(s),
      })
      const made = steps.pop()
      let at = steps.length
      while (at > 0 && steps[at - 1].heuristic) at--
      steps.splice(at, 0, made)
      continue
    }
    if (s.action === 'check') {
      // something the person pointed at while recording: a check of what the control showed then
      const shown = s.ui5?.display ?? s.recorded?.text ?? s.ui5?.localId ?? 'the control'
      const locator = s.ui5 ? locatorFor(s) : null
      const kind = s.check?.kind ?? 'visible'
      const expected = s.check?.expected ?? ''
      add({
        kind: 'assert',
        title:
          kind === 'visible'
            ? `${shown} is shown`
            : kind === 'value'
              ? `${shown} holds "${expected}"`
              : `${shown} shows "${expected}"`,
        locator,
        assertion: kind === 'visible' ? { type: 'visible' } : { type: kind, expected },
        from: from(s),
        ...(locator
          ? {}
          : {
              enabled: false,
              note: "The control was not found in the app's files: pick one in the step table or leave the check out.",
            }),
      })
      continue
    }
    const type = s.ui5?.type ?? s.recorded?.controlType ?? ''
    const shown =
      s.ui5?.display ??
      s.recorded?.text ??
      s.dom?.ariaLabel ??
      s.ui5?.localId ??
      (s.recorded?.itemText && type
        ? `the ${lastSegment(type)} of "${s.recorded.itemText}"`
        : type
          ? `the ${lastSegment(type)}`
          : 'the control')
    const locator = s.ui5 ? locatorFor(s) : null
    const unresolved = !locator
    const temporary = isTransient(s.recorded?.selector) || isTransient(s.recorded?.bindingPath)
    const note = unresolved
      ? temporary
        ? 'This item can only be found by a temporary id that is made up again in every session. Record the flow again with the updated extension (it notes the text of the row), or leave the step out.'
        : `The control was not found in the app's files${s.dom?.ariaLabel ? ` ("${s.dom.ariaLabel}")` : ''}: pick one in the step table or leave the step out.`
      : undefined
    const base = { locator, from: from(s), ...(unresolved ? { enabled: false, note } : {}) }

    if (s.action === 'click' && s.choice !== undefined && /Select$|ComboBox$/.test(type)) {
      add({ ...base, kind: 'select', title: `Choose "${s.choice}" in ${shown}`, choice: s.choice })
      if (!unresolved && type === 'sap.m.Select' && s.choiceKey !== undefined)
        add({
          kind: 'assert',
          title: `${shown} shows "${s.choice}"`,
          locator,
          assertion: { type: 'selectedKey', expected: s.choiceKey },
          heuristic: true,
        })
    } else if (s.action === 'click') {
      add({ ...base, kind: 'press', title: `Press ${shown}` })
      if (!unresolved && s.navigatesTo !== undefined)
        add({
          kind: 'assert',
          title: s.navigatesTo ? `The page is "#/${s.navigatesTo}"` : 'Back on the start page',
          assertion: { type: 'url', expected: s.navigatesTo },
          heuristic: true,
        })
    } else {
      const search = /SearchField$/.test(type)
      add({
        ...base,
        kind: search ? 'search' : 'enterText',
        title: search ? `Search for "${s.value ?? ''}"` : `Enter "${s.value ?? ''}" in ${shown}`,
        value: s.value ?? '',
        ...(s.submit ? { submit: true } : {}),
      })
      if (!unresolved && VALUE_CONTROLS.has(type) && s.value)
        add({
          kind: 'assert',
          title: `${shown} holds "${s.value}"`,
          locator,
          assertion: { type: 'value', expected: s.value },
          heuristic: true,
        })
    }
  }
  if (!steps.length) add({ kind: 'open', title: 'Open the app' })

  const appUrl =
    mapped.app?.url ?? mapped.steps?.find((s) => s.action === 'navigate' && s.url)?.url ?? null
  return {
    version: PLAN_VERSION,
    name: name || mapped.name || 'Journey',
    app: { id: inventory?.appId ?? mapped.app?.appId ?? null, url: appUrl },
    settings: {
      ...DEFAULT_SETTINGS,
      ...(appUrl ? { baseUrl: appUrl.replace(/#.*$/, '') } : {}),
      ...settings,
    },
    locators,
    steps,
  }
}
