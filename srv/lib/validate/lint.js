// Lints a tour against the app inventory (and optionally the recording it came from).
// Schema problems are errors; things that will probably misbehave at runtime are warnings; hints are infos.
import { validateTour } from '../../../shared/tour-schema.mjs'
import { matchRoute, normalizeHash } from '../parsers/manifest.js'

const I18N_REF = /^\{[\w.-]+>([^}]+)\}$/
const LIMITS = { title: 60, text: 300, steps: 15 }

const keyOf = (viewName, id) => `${viewName ?? ''}::${id}`

function findControls(inventory, target) {
  if (!target.controlId) return []
  return inventory.controls.filter(
    (c) =>
      (c.localId === target.controlId && (!target.viewName || c.viewName === target.viewName)) ||
      c.globalId === target.controlId,
  )
}

function textFallbackMatches(inventory, target) {
  const wanted = (target.fallbacks ?? [])
    .filter((f) => f.by === 'text')
    .map((f) => f.value.trim().toLowerCase())
  return inventory.controls.filter(
    (c) =>
      (!target.viewName || c.viewName === target.viewName) &&
      [c.display, c.text, c.title].some((t) => t && wanted.includes(t.trim().toLowerCase())),
  )
}

/** Views whose controls exist on screen for a route: its views, their nested views and the root view. */
function visibleViews(inventory, route) {
  const shown = new Set(route.viewNames)
  for (const name of [...shown]) {
    for (const nested of inventory.views.find((v) => v.viewName === name)?.nestedViews ?? [])
      shown.add(nested)
  }
  if (inventory.rootViewName) shown.add(inventory.rootViewName)
  return shown
}

/**
 * @param {object} tour tour document (validated here)
 * @param {object} inventory from buildInventory()
 * @param {{recording?: object, startHash?: string}} [options] mapped recording for order checks; the route the app starts on
 * @returns {{issues: Array<{path: string, code: string, severity: 'error'|'warning'|'info', message: string, stepId?: string}>, summary: {errors: number, warnings: number, infos: number}}}
 */
export function lintTour(tour, inventory, { recording, startHash = '' } = {}) {
  const base = validateTour(tour)
  const issues = base.issues.map((i) => ({ ...i }))
  const finish = () => {
    const rank = { error: 0, warning: 1, info: 2 }
    issues.sort((a, b) => rank[a.severity] - rank[b.severity])
    return {
      issues,
      summary: {
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        infos: issues.filter((i) => i.severity === 'info').length,
      },
    }
  }
  if (!base.ok) return finish()

  const steps = base.tour.steps
  const add = (i, code, severity, message, sub = '') =>
    issues.push({ path: `steps[${i}]${sub}`, code, severity, message, stepId: steps[i].id })
  const recordedOrder = new Map()
  for (const s of recording?.steps ?? []) {
    const k = s.ui5?.localId ? keyOf(s.ui5.viewName, s.ui5.localId) : null
    if (k && !recordedOrder.has(k)) recordedOrder.set(k, recordedOrder.size)
  }

  let hash = normalizeHash(startHash)
  let lastRecordedIndex = -1
  const seenTargets = new Map()
  const i18nKeys = inventory.i18nKeys?.length ? new Set(inventory.i18nKeys) : null

  steps.forEach((step, i) => {
    for (const a of step.before) {
      hash = normalizeHash(a.hash)
      if (inventory.routes.length && !matchRoute(inventory.routes, hash)) {
        add(
          i,
          'navigate.unknownRoute',
          'warning',
          `Step "${step.id}" navigates to "${a.hash}", which matches no route in the manifest`,
          '.before',
        )
      }
    }

    for (const field of ['title', 'text']) {
      const m = I18N_REF.exec(step[field])
      if (m && i18nKeys && !i18nKeys.has(m[1]))
        add(
          i,
          'i18n.missingKey',
          'warning',
          `Step "${step.id}": i18n key "${m[1]}" does not exist in the i18n bundle`,
          `.${field}`,
        )
    }
    if (step.title.length > LIMITS.title)
      add(
        i,
        'title.long',
        'warning',
        `Step "${step.id}": title has ${step.title.length} characters (recommended: up to ${LIMITS.title})`,
        '.title',
      )
    if (step.text.length > LIMITS.text)
      add(
        i,
        'text.long',
        'warning',
        `Step "${step.id}": text has ${step.text.length} characters (recommended: up to ${LIMITS.text})`,
        '.text',
      )
    if (step.target && !step.text.trim())
      add(i, 'text.empty', 'info', `Step "${step.id}" has no explanatory text`, '.text')

    const t = step.target
    if (!t) return
    const controls = findControls(inventory, t)
    const sub = '.target'

    if (t.controlId && !controls.length) {
      const elsewhere = inventory.controls.filter((c) => c.localId === t.controlId)
      if (elsewhere.length) {
        const views = [...new Set(elsewhere.map((c) => c.viewName))].join(', ')
        add(
          i,
          'target.wrongView',
          'error',
          `Step "${step.id}": "${t.controlId}" is not in ${t.viewName ?? 'any named view'}; it exists in ${views}`,
          sub,
        )
      } else if (textFallbackMatches(inventory, t).length) {
        add(
          i,
          'target.idNotFound',
          'warning',
          `Step "${step.id}": id "${t.controlId}" is unknown; the text fallback will be used`,
          sub,
        )
      } else {
        add(
          i,
          'target.notFound',
          'error',
          `Step "${step.id}": no control "${t.controlId}" exists in the app sources`,
          sub,
        )
      }
    } else if (!t.controlId) {
      const hits = textFallbackMatches(inventory, t)
      if (!hits.length)
        add(
          i,
          'target.notFound',
          'error',
          `Step "${step.id}": no control matches the text fallback`,
          sub,
        )
      else
        add(
          i,
          'target.noId',
          'warning',
          `Step "${step.id}": the control has no id and is found by its text only; give it an id in the view`,
          sub,
        )
    }

    const c = controls[0]
    if (c?.template)
      add(
        i,
        'target.template',
        'warning',
        `Step "${step.id}": "${c.localId}" lives in a bound aggregation, so its runtime id is not stable`,
        sub,
      )

    // is the target's view actually on screen at this point of the tour?
    const route = inventory.routes.length ? matchRoute(inventory.routes, hash) : null
    if (route && (t.viewName || c?.viewName) && controls.length && !c?.live) {
      const shown = visibleViews(inventory, route.route)
      const view = t.viewName ?? c.viewName
      if (!shown.has(view)) {
        add(
          i,
          'step.wrongRoute',
          'warning',
          `Step "${step.id}" targets ${view}, but at route "${hash || '(default)'}" the app shows ${[...route.route.viewNames].join(', ')}; add a navigate action`,
          '.before',
        )
      }
    }

    if (t.controlId) {
      const key = keyOf(t.viewName ?? c?.viewName, t.controlId)
      if (seenTargets.has(key))
        add(
          i,
          'step.duplicateTarget',
          'warning',
          `Step "${step.id}" highlights the same control as step "${steps[seenTargets.get(key)].id}"`,
          sub,
        )
      else seenTargets.set(key, i)
      const ri = recordedOrder.get(key)
      if (ri !== undefined) {
        if (ri < lastRecordedIndex)
          add(
            i,
            'step.order',
            'warning',
            `Step "${step.id}" comes in a different order than in the recording`,
            sub,
          )
        lastRecordedIndex = Math.max(lastRecordedIndex, ri)
      }
    }
  })

  if (steps.length > LIMITS.steps)
    issues.push({
      path: 'steps',
      code: 'tour.long',
      severity: 'info',
      message: `The tour has ${steps.length} steps; tours of up to ${LIMITS.steps} are easier to follow`,
    })
  return finish()
}
