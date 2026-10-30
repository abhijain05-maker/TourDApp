// Maps a normalised recording onto the control inventory and collapses recorder noise.
// DOM ids like "container-demo---main--createBtn-BDI-content" are resolved to the control "createBtn".

const CSS_ID = /#((?:\\.|[\w\- -￿])+)/g
const XPATH_ID = /@id\s*=\s*(?:"([^"]+)"|'([^']+)')/g
const INTERACTIVE_TYPE =
  /(Button|Input|Select|Link|Field|ComboBox|CheckBox|RadioButton|Switch|Picker|Filter|ListItem)$/
const STOP = new Set([
  'the',
  'a',
  'an',
  'button',
  'btn',
  'field',
  'input',
  'link',
  'tab',
  'dropdown',
  'icon',
  'box',
  'select',
  'menu',
  'of',
  'on',
  'in',
  'to',
])

/** Element ids mentioned by CSS / pierce / xpath selectors (aria/ and text/ selectors carry none). */
export function domIdsOf(selectors = []) {
  const ids = []
  for (const s of selectors) {
    if (s.startsWith('aria/') || s.startsWith('text/')) continue
    if (s.startsWith('xpath/')) {
      for (const m of s.matchAll(XPATH_ID)) ids.push(m[1] ?? m[2])
    } else {
      for (const m of s.replace(/^pierce\//, '').matchAll(CSS_ID))
        ids.push(m[1].replace(/\\(.)/g, '$1'))
    }
  }
  return [...new Set(ids)]
}

const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
const namesOf = (c) =>
  [c.display, c.text, c.title, c.tooltip, c.label, c.placeholder]
    .filter((v) => typeof v === 'string')
    .map(norm)

function summarize(c, via, confidence, alternatives = []) {
  return {
    viewName: c.viewName,
    localId: c.localId,
    ...(c.globalId ? { globalId: c.globalId } : {}),
    type: c.type,
    display: c.display,
    hasStableId: c.hasStableId,
    via,
    confidence,
    ...(alternatives.length
      ? { alternatives: alternatives.map((a) => ({ viewName: a.viewName, localId: a.localId })) }
      : {}),
  }
}

function pick(scored, via, uniqueConfidence, ambiguousConfidence) {
  if (!scored.length) return null
  const top = Math.max(...scored.map((s) => s.score))
  const best = scored.filter((s) => s.score === top).map((s) => s.c)
  return summarize(
    best[0],
    via,
    best.length === 1 ? uniqueConfidence : ambiguousConfidence,
    best.slice(1),
  )
}

function matchByDomId(domId, inventory, viewIds) {
  const scored = []
  for (const c of inventory.controls) {
    if (!c.localId) continue
    if (c.globalId) {
      if (domId === c.globalId || domId.startsWith(c.globalId + '-'))
        scored.push({ c, score: c.globalId.length })
      continue
    }
    const token = '--' + c.localId
    for (let from = 0, i; (i = domId.indexOf(token, from)) >= 0; from = i + 1) {
      const end = i + token.length
      if (end === domId.length || domId[end] === '-') {
        const viewId = viewIds.get(c.viewName)
        const hint =
          viewId && (domId.includes('---' + viewId + '--') || domId.startsWith(viewId + '--'))
            ? 0.5
            : 0
        scored.push({ c, score: c.localId.length + hint })
        break
      }
    }
  }
  return pick(scored, 'id', 0.95, 0.6)
}

function matchByText(label, inventory) {
  const needle = norm(label)
  if (!needle) return null
  const scored = inventory.controls
    .filter((c) => namesOf(c).includes(needle))
    .map((c) => ({ c, score: (c.hasStableId ? 2 : 0) + (INTERACTIVE_TYPE.test(c.type) ? 1 : 0) }))
  return pick(scored, 'text', 0.7, 0.4)
}

const words = (s) =>
  String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))

function matchByTokens(text, inventory) {
  const target = words(text)
  if (!target.length) return null
  const scored = []
  for (const c of inventory.controls) {
    const have = new Set([...words(c.display), ...words(c.localId)])
    if (target.every((w) => have.has(w))) scored.push({ c, score: target.length / have.size })
  }
  return pick(scored, 'text', 0.6, 0.35)
}

function verifyTestRecorder(ui5, inventory) {
  // our own recorder reads the live control, so a match on view + id is certain
  const own = ui5.via === 'tourd-recorder'
  const via = own ? 'recorder' : 'test-recorder'
  const byId = inventory.controls.find(
    (c) => c.viewName === ui5.viewName && c.localId === ui5.controlId && ui5.controlId,
  )
  if (byId) return summarize(byId, via, own ? 1 : 0.98)
  if (ui5.controlId && !ui5.viewName) {
    const global = inventory.controls.find(
      (c) => c.globalId === ui5.controlId || c.localId === ui5.controlId,
    )
    if (global) return summarize(global, via, 0.9)
  }
  if (ui5.text) {
    const m = matchByText(ui5.text, {
      controls: inventory.controls.filter(
        (c) =>
          (!ui5.viewName || c.viewName === ui5.viewName) &&
          (!ui5.controlType || c.type === ui5.controlType),
      ),
    })
    if (m) return { ...m, via: via + '-text' }
  }
  // Not in the uploaded files: Fiori elements apps and other generated UIs have no view with these controls. Our
  // own recorder read the control from the running app, so what it recorded is as good as a match in the sources.
  if (own && ui5.viewName && (ui5.controlId || ui5.text || ui5.selector)) {
    const live = {
      viewName: ui5.viewName,
      localId: ui5.controlId ?? undefined,
      type: ui5.controlType,
      display: ui5.text ?? undefined,
      hasStableId: Boolean(ui5.controlId),
    }
    const found = summarize(live, 'recorder-live', ui5.controlId ? 0.85 : ui5.text ? 0.5 : 0.4)
    // no id and no text (a table row, a dialog button): only UI5's own selector can find it again, which tests use
    // and a tour cannot
    return ui5.controlId || ui5.text
      ? found
      : { ...found, selectorOnly: true, selector: ui5.selector }
  }
  return null
}

function mapStep(step, inventory, viewIds) {
  if (step.action === 'navigate' || step.action === 'key' || step.action === 'note') return step
  let ui5 = null
  if (step.ui5) {
    ui5 = verifyTestRecorder(step.ui5, inventory)
  } else if (step.dom) {
    for (const id of domIdsOf(step.dom.selectors)) {
      ui5 = matchByDomId(id, inventory, viewIds)
      if (ui5) break
    }
    ui5 ??=
      (step.dom.ariaLabel && matchByText(step.dom.ariaLabel, inventory)) ||
      (step.dom.text && matchByText(step.dom.text, inventory)) ||
      null
    if (ui5 && ui5.via === 'text') ui5 = { ...ui5, via: 'aria' }
  } else if (step.text) {
    ui5 = matchByTokens(step.text, inventory)
  }
  return { ...step, ui5, ...(step.ui5?.via === 'tourd-recorder' ? { recorded: step.ui5 } : {}) }
}

const targetKey = (s) =>
  s.ui5
    ? s.ui5.selectorOnly
      ? JSON.stringify(s.ui5.selector)
      : `${s.ui5.viewName}::${s.ui5.localId ?? s.ui5.display}`
    : s.dom
      ? s.dom.selectors.join('|')
      : (s.text ?? '')

/** click + change on one control -> one input; input + Enter -> submit; duplicate clicks -> one. */
export function collapseSteps(steps) {
  const out = []
  for (const s of steps) {
    const prev = out[out.length - 1]
    // (a tick is not a click into a field that is typed into next: a checkbox and the field around it have the same name)
    if (
      s.action === 'input' &&
      prev?.action === 'click' &&
      prev.toggled === undefined &&
      targetKey(prev) === targetKey(s)
    ) {
      out[out.length - 1] = {
        ...s,
        index: prev.index,
        ...(prev.navigatesTo ? { navigatesTo: prev.navigatesTo } : {}),
        ...(s.explain || prev.explain ? { explain: s.explain ?? prev.explain } : {}),
      }
    } else if (s.action === 'key' && s.value === 'Enter' && prev?.action === 'input') {
      out[out.length - 1] = { ...prev, submit: true }
    } else if (s.action === 'key') {
      continue
    } else if (
      s.action === 'click' &&
      prev?.action === 'click' &&
      targetKey(prev) === targetKey(s) &&
      !prev.navigatesTo
    ) {
      if (s.explain && !prev.explain) prev.explain = s.explain // the same click twice: the words survive
      continue
    } else {
      out.push(s)
    }
  }
  return out
}

/**
 * @param {object} recording normalised recording (see recordings/index.js)
 * @param {object} inventory from buildInventory()
 */
/** Adds the controller and the event handler of the matched control (from the uploaded views) to a mapped step. */
function withController(step, inventory) {
  if (!step.ui5) return step
  const control = inventory.controls.find(
    (c) => c.viewName === step.ui5.viewName && c.localId === step.ui5.localId && step.ui5.localId,
  )
  const view = inventory.views.find((v) => v.viewName === step.ui5.viewName)
  const handler = control?.handlers?.press ?? Object.values(control?.handlers ?? {})[0]
  return {
    ...step,
    ui5: {
      ...step.ui5,
      ...((view?.controllerName ?? step.recorded?.controllerName)
        ? { controllerName: view?.controllerName ?? step.recorded.controllerName }
        : {}),
      ...(handler ? { handler } : {}),
    },
  }
}

export function mapRecording(recording, inventory) {
  const viewIds = new Map(inventory.views.map((v) => [v.viewName, v.viewId]))
  const mapped = recording.steps.map((s) =>
    withController(mapStep(s, inventory, viewIds), inventory),
  )
  const steps = collapseSteps(mapped)
  const actionable = steps.filter((s) => ['click', 'input'].includes(s.action))
  return {
    ...recording,
    steps,
    mapping: {
      actionable: actionable.length,
      mapped: actionable.filter((s) => s.ui5).length,
      unmapped: actionable.filter((s) => !s.ui5).length,
    },
  }
}

/**
 * The inventory plus the controls our recorder saw in the running app that the uploaded files do not contain
 * (Fiori elements and other generated UIs). Generation and the checks then treat them as controls of the app.
 */
export function withLiveControls(inventory, mapped) {
  const known = new Set(inventory.controls.map((c) => `${c.viewName}::${c.localId ?? c.display}`))
  const extra = []
  for (const s of mapped.steps) {
    const u = s.ui5
    if (u?.via !== 'recorder-live' || u.selectorOnly) continue
    const key = `${u.viewName}::${u.localId ?? u.display}`
    if (known.has(key)) continue
    known.add(key)
    extra.push({
      viewName: u.viewName,
      ...(u.localId ? { localId: u.localId } : {}),
      type: u.type,
      ...(u.display ? { display: u.display, text: u.display } : {}),
      hasStableId: Boolean(u.hasStableId),
      path: [],
      live: true,
    })
  }
  return extra.length ? { ...inventory, controls: [...inventory.controls, ...extra] } : inventory
}
