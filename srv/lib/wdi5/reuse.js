// What the plan can take over from an existing wdi5 project instead of writing again (see catalogue.js):
// a helper that already presses this control or types into it, a selector the project already defines,
// the project's login and start helpers. The plan stays plain data; the choice is made when the files are rendered,
// and a step can opt out (`noReuse`) in the step table.
import { findReusable, findSelector, findSetup } from './catalogue.js'

const ACTING = new Set(['press', 'enterText', 'search'])

/**
 * @returns {{steps: Map<string, object>, locators: Map<string, object>, setup: {login?: object, open?: object}}}
 */
export function resolveReuse(plan, catalogue) {
  const steps = new Map()
  const locators = new Map()
  const selectorsOf = (key) => [
    plan.locators[key].selector,
    ...plan.locators[key].alternatives.map((a) => a.selector),
  ]

  for (const s of plan.steps) {
    if (!s.enabled || s.noReuse || !s.locator || !ACTING.has(s.kind) || !plan.locators[s.locator])
      continue
    const helper = findReusable(catalogue, selectorsOf(s.locator), s.kind)
    if (helper) steps.set(s.id, helper)
  }
  const used = new Set(plan.steps.filter((s) => s.enabled && s.locator).map((s) => s.locator))
  for (const key of used) {
    const found = plan.locators[key] && findSelector(catalogue, selectorsOf(key))
    if (found) locators.set(key, found)
  }
  const setup = {}
  const open = plan.steps.find((s) => s.kind === 'open')
  if (!open?.noReuse) {
    const found = findSetup(catalogue)
    if (found.login) setup.login = found.login
    if (found.open) setup.open = found.open
  }
  return { steps, locators, setup }
}

/** What the designer shows next to each step: "uses searchFor() of e2e/pages/main.page.js". */
export function describeReuse(reuse) {
  return {
    steps: [...reuse.steps].map(([stepID, h]) => ({ stepID, name: h.name, file: h.file })),
    locators: [...reuse.locators].map(([key, h]) => ({ locator: key, name: h.name, file: h.file })),
    setup: Object.entries(reuse.setup).map(([role, h]) => ({ role, name: h.name, file: h.file })),
  }
}
