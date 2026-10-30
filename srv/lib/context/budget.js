// Decides how much raw source code fits into the model prompt next to the (always included) inventory.
import { classifySource } from './inventory.js'

/** Conservative estimate for code/XML (~3.5 chars per token). */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 3.5)

const KIND_ORDER = { manifest: 0, view: 1, fragment: 2, controller: 3 }

/** Compact stand-in for a controller that is too large to include: names, params, navigation. */
export function controllerSummary(controller) {
  const methods = controller.methods.map(
    (m) => `${m.async ? 'async ' : ''}${m.name}(${m.params.join(', ')})`,
  )
  const nav = controller.navigations.map(
    (n) =>
      `${n.method ?? '?'} -> navTo(${n.route ?? '<dynamic>'}${n.args.length ? ', {' + n.args.join(', ') + '}' : ''})`,
  )
  const frags = controller.fragments.map((f) => `${f.method ?? '?'} loads fragment ${f.name}`)
  return [`// ${controller.controllerName} (summary)`, ...methods, ...nav, ...frags].join('\n')
}

/** Restrict an inventory to the views a recording touches (for apps whose full inventory exceeds the budget). */
export function focusInventory(inventory, viewNames) {
  const wanted = new Set(viewNames)
  return {
    ...inventory,
    views: inventory.views.filter((v) => wanted.has(v.viewName)),
    controls: inventory.controls.filter((c) => c.viewName === null || wanted.has(c.viewName)),
    focused: [...wanted],
  }
}

/**
 * @param {{sources: Array<{path: string, content: string}>, inventory: object, budgetTokens?: number, priorityPaths?: string[]}} args
 */
export function planContext({ sources, inventory, budgetTokens = 60000, priorityPaths = [] }) {
  const inventoryTokens = estimateTokens(JSON.stringify(inventory))
  const priority = new Set(priorityPaths)
  const candidates = sources
    .map((s) => ({
      path: s.path,
      kind: classifySource(s.path),
      content: s.content,
      tokens: estimateTokens(s.content),
    }))
    .filter((s) => s.kind in KIND_ORDER)
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (priority.has(b.path) ? 1 : 0) - (priority.has(a.path) ? 1 : 0) ||
        a.tokens - b.tokens,
    )

  let used = inventoryTokens
  const included = []
  const excluded = []
  for (const c of candidates) {
    if (used + c.tokens <= budgetTokens) {
      included.push({ path: c.path, kind: c.kind, tokens: c.tokens, text: c.content })
      used += c.tokens
      continue
    }
    const ctrl =
      c.kind === 'controller' ? inventory.controllers.find((x) => x.path === c.path) : null
    const summary = ctrl ? controllerSummary(ctrl) : null
    const summaryTokens = summary ? estimateTokens(summary) : Infinity
    if (summary && used + summaryTokens <= budgetTokens) {
      included.push({
        path: c.path,
        kind: 'controller-summary',
        tokens: summaryTokens,
        text: summary,
      })
      used += summaryTokens
    } else {
      excluded.push({ path: c.path, kind: c.kind, tokens: c.tokens, reason: 'over budget' })
    }
  }

  const rawIncluded = included.filter((i) => i.kind !== 'controller-summary').length
  const mode =
    inventoryTokens > budgetTokens
      ? 'inventory-overflow'
      : excluded.length === 0 && !included.some((i) => i.kind === 'controller-summary')
        ? 'full'
        : rawIncluded === 0
          ? 'inventory-only'
          : 'partial'
  return { mode, budgetTokens, inventoryTokens, usedTokens: used, included, excluded }
}
