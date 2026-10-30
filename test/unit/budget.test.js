import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import {
  estimateTokens,
  planContext,
  focusInventory,
  controllerSummary,
} from '../../srv/lib/context/budget.js'
import { demoSources } from '../helpers/sources.js'

const sources = demoSources()
const inventory = buildInventory(sources)

describe('estimateTokens', () => {
  it('is proportional to length and handles empty input', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null)).toBe(0)
    expect(estimateTokens('x'.repeat(350))).toBe(100)
  })
})

describe('planContext', () => {
  it('includes everything when the budget is generous', () => {
    const plan = planContext({ sources, inventory, budgetTokens: 200000 })
    expect(plan.mode).toBe('full')
    expect(plan.excluded).toEqual([])
    const kinds = plan.included.map((i) => i.kind)
    expect(kinds[0]).toBe('manifest')
    expect(kinds.filter((k) => k === 'view')).toHaveLength(3)
    expect(plan.usedTokens).toBeLessThanOrEqual(plan.budgetTokens)
  })

  it('orders manifest, views, fragments, controllers and ignores i18n/other files', () => {
    const plan = planContext({ sources, inventory, budgetTokens: 200000 })
    const order = ['manifest', 'view', 'fragment', 'controller']
    const ranks = plan.included.map((i) => order.indexOf(i.kind))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(
      plan.included.some((i) => i.path.includes('i18n') || i.path.endsWith('Component.js')),
    ).toBe(false)
  })

  it('falls back to inventory-only when nothing else fits', () => {
    const budget = estimateTokens(JSON.stringify(inventory)) + 10
    const plan = planContext({ sources, inventory, budgetTokens: budget })
    expect(plan.mode).toBe('inventory-only')
    expect(plan.included).toEqual([])
    expect(plan.excluded.length).toBeGreaterThan(0)
  })

  it('degrades a controller that does not fit into a summary', () => {
    const big = { path: 'webapp/controller/Big.controller.js', content: 'x'.repeat(20000) }
    const inv = buildInventory([...sources, big])
    inv.controllers.find((c) => c.path === big.path).methods = [
      { name: 'onGo', async: false, params: ['e'] },
    ]
    const budget = estimateTokens(JSON.stringify(inv)) + 4000
    const plan = planContext({ sources: [...sources, big], inventory: inv, budgetTokens: budget })
    expect(plan.included.find((i) => i.path === big.path)?.kind).toBe('controller-summary')
    expect(plan.mode).toBe('partial')
  })

  it('prefers priority paths within a kind, otherwise smaller files first', () => {
    const tok = (p) => estimateTokens(sources.find((s) => s.path.endsWith(p)).content)
    // room for the inventory, the manifest and the (largest) Main view, but not for the other views as well
    const budget =
      estimateTokens(JSON.stringify(inventory)) + tok('manifest.json') + tok('Main.view.xml') + 5
    const main = 'webapp/view/Main.view.xml'
    const prioritised = planContext({
      sources,
      inventory,
      budgetTokens: budget,
      priorityPaths: [main],
    })
    expect(prioritised.included.map((i) => i.path)).toContain(main)
    const plain = planContext({ sources, inventory, budgetTokens: budget })
    expect(plain.included.map((i) => i.path)).not.toContain(main)
    expect(plain.included.map((i) => i.path)).toContain('webapp/view/App.view.xml')
  })

  it('reports an overflowing inventory', () => {
    expect(planContext({ sources, inventory, budgetTokens: 50 }).mode).toBe('inventory-overflow')
  })
})

describe('focusInventory / controllerSummary', () => {
  it('limits controls to the given views but keeps global fragment controls', () => {
    const f = focusInventory(inventory, ['demo.orders.view.Detail'])
    expect(f.views.map((v) => v.viewName)).toEqual(['demo.orders.view.Detail'])
    expect(
      f.controls.every((c) => c.viewName === 'demo.orders.view.Detail' || c.viewName === null),
    ).toBe(true)
    expect(f.controls.length).toBeLessThan(inventory.controls.length)
    expect(f.focused).toEqual(['demo.orders.view.Detail'])
  })

  it('summarises a controller compactly', () => {
    const c = inventory.controllers.find((x) => x.controllerName.endsWith('Main'))
    const s = controllerSummary(c)
    expect(s).toContain('onCreate()')
    expect(s).toContain('onCreate -> navTo(detail, {orderId})')
    expect(s.length).toBeLessThan(600)
  })
})
