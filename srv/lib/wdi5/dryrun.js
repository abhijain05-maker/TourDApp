// Dry run of a test plan against the app's files (the control inventory): does every selector find exactly one
// control? Nothing is executed; this is the check that can be done before anyone starts a browser. What can only be
// known at run time (a binding path, a generated id) is reported as "unchecked", not as found.

const norm = (v) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** The controls of the inventory that a selector can mean. */
function candidates(selector, inventory) {
  const controls = inventory.controls ?? []
  const inView = (c) => !selector.viewName || c.viewName === selector.viewName
  const ofType = (c) => !selector.controlType || c.type === selector.controlType
  if (selector.id && typeof selector.id === 'string')
    return controls.filter((c) => inView(c) && c.localId === selector.id)
  if (selector.i18NText) return controls.filter((c) => inView(c) && ofType(c))
  if (selector.properties) {
    const entries = Object.entries(selector.properties)
    return controls.filter(
      (c) =>
        inView(c) &&
        ofType(c) &&
        entries.every(([k, v]) =>
          k === 'text' || k === 'title'
            ? [c.text, c.title, c.display].some((x) => norm(x) === norm(v))
            : false,
        ),
    )
  }
  if (selector.labelFor)
    return controls.filter(
      (c) => inView(c) && ofType(c) && norm(c.label) === norm(selector.labelFor.text),
    )
  return null
}

/**
 * @returns {{status: 'found'|'missing'|'ambiguous'|'unchecked', count: number, note: string}}
 */
export function checkSelector(selector, inventory) {
  // selectors UI5 made for a control without an id use things only a running app has
  const onlyAtRunTime =
    selector.ancestor ||
    selector.descendant ||
    selector.sibling ||
    (selector.properties &&
      Object.keys(selector.properties).some((k) => k !== 'text' && k !== 'title'))
  if (onlyAtRunTime && !selector.bindingPath)
    return {
      status: 'unchecked',
      count: 0,
      note: 'This selector uses properties or neighbours that are only known when the app runs.',
    }
  if (selector.bindingPath)
    return {
      status: 'unchecked',
      count: 0,
      note: 'A binding path is only known when the app runs.',
    }
  if (selector.i18NText) {
    const key = selector.i18NText.key
    if (!(inventory.i18nKeys ?? []).includes(key))
      return {
        status: 'missing',
        count: 0,
        note: `The i18n key "${key}" is not in the app's texts.`,
      }
    const list = candidates(selector, inventory) ?? []
    return {
      status: 'unchecked',
      count: list.length,
      note: 'The key exists; which control shows it is only known when the app runs.',
    }
  }
  const list = candidates(selector, inventory)
  if (list === null)
    return {
      status: 'unchecked',
      count: 0,
      note: 'This kind of selector can only be checked in the running app.',
    }
  if (selector.id && list.length === 0) {
    const view = (inventory.views ?? []).some((v) => v.viewName === selector.viewName)
    return {
      status: 'missing',
      count: 0,
      note: view
        ? `The view has no control with the id "${selector.id}".`
        : `The app has no view "${selector.viewName}".`,
    }
  }
  if (list.length === 0)
    return { status: 'missing', count: 0, note: 'No control of the app matches.' }
  if (list.length > 1)
    return {
      status: 'ambiguous',
      count: list.length,
      note: `${list.length} controls match: the first one is used. Give the one you mean an id.`,
    }
  const only = list[0]
  if (!selector.id && !only.hasStableId)
    return { status: 'found', count: 1, note: 'Found by its text; it has no id of its own.' }
  return { status: 'found', count: 1, note: '' }
}

/** @returns {{locators: Record<string, object>, steps: Record<string, string>, summary: Record<string, number>}} */
export function dryRun(plan, inventory) {
  const locators = {}
  for (const [key, l] of Object.entries(plan.locators))
    locators[key] = { strategy: l.strategy, ...checkSelector(l.selector, inventory) }
  const steps = {}
  for (const s of plan.steps) {
    if (!s.enabled || s.kind === 'open' || !s.locator) continue
    steps[s.id] = locators[s.locator]?.status ?? 'missing'
  }
  const summary = { found: 0, missing: 0, ambiguous: 0, unchecked: 0 }
  const used = new Set(plan.steps.filter((s) => s.enabled && s.locator).map((s) => s.locator))
  for (const key of used) if (locators[key]) summary[locators[key].status]++
  return { locators, steps, summary }
}
