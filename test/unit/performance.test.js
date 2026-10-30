import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { focusInventory } from '../../srv/lib/context/budget.js'
import { buildPrompt } from '../../srv/lib/llm/prompt.js'
import { lintTour } from '../../srv/lib/validate/lint.js'
import { buildPreviewApp } from '../../srv/lib/preview/model.js'
import { buildBundle } from '../../srv/lib/export/bundle.js'
import { bigApp } from '../helpers/big-app.js'
import { readFileSync } from 'node:fs'

// A large app (40 views, ~1000 controls): everything must stay quick, and the AI prompt must stay within its budget.
const sources = bigApp({ views: 40 })
const bytes = sources.reduce((n, s) => n + s.content.length, 0)

const timed = (label, fn) => {
  const t0 = performance.now()
  const result = fn()
  const ms = Math.round(performance.now() - t0)
  console.log(`[perf] ${label}: ${ms} ms`)
  return { result, ms }
}

describe('a large app (40 views)', () => {
  it('has the size we mean to test', () => {
    expect(sources.filter((s) => s.path.endsWith('.view.xml'))).toHaveLength(40)
    expect(bytes).toBeGreaterThan(150_000)
  })

  const { result: inventory, ms } = timed('buildInventory (40 views)', () =>
    buildInventory(sources),
  )

  it('is inventoried in well under a second or two', () => {
    expect(ms).toBeLessThan(2500)
    expect(inventory.views).toHaveLength(40)
    expect(inventory.controls.length).toBeGreaterThanOrEqual(1000)
    expect(inventory.warnings.filter((w) => w.code.endsWith('.parse'))).toEqual([])
  })

  const recording = (views) => ({
    steps: views.map((viewName, index) => ({
      index,
      action: 'click',
      ui5: viewName ? { viewName, localId: 'createBtn' } : undefined,
    })),
  })

  it('keeps the AI prompt within the token budget by dropping source files, never the inventory', () => {
    for (const views of [
      ['big.app.view.View1', 'big.app.view.View2'],
      [null, null],
    ]) {
      const { result: prompt, ms: promptMs } = timed('buildPrompt', () =>
        buildPrompt({ inventory, recording: recording(views), sources, budgetTokens: 60000 }),
      )
      expect(promptMs).toBeLessThan(1500)
      expect(prompt.context.tokens).toBeLessThanOrEqual(60000)
      expect(prompt.context.excluded.length).toBeGreaterThan(0) // not everything fits
      expect(prompt.context.files.length).toBeGreaterThan(0) // but the most relevant files do
      expect(prompt.user).toContain('createBtn') // the inventory is always there
    }
  })

  it('restricts the inventory to the pages of the recording when even that is too big', () => {
    const prompt = buildPrompt({
      inventory,
      recording: recording(['big.app.view.View3']),
      sources,
      budgetTokens: 12000,
    })
    expect(prompt.user).toContain('Only the pages used in the recording are listed: View3')
    expect(prompt.user).not.toContain('Screen 20')
    expect(prompt.context.tokens).toBeLessThanOrEqual(12000)
  })

  it('can focus on the views a recording touches', () => {
    const focused = focusInventory(inventory, ['big.app.view.View1', 'big.app.view.View2'])
    expect(focused.views).toHaveLength(2)
    expect(focused.controls.length).toBeLessThan(inventory.controls.length / 10)
  })

  it('a 15-step tour is checked quickly', () => {
    const steps = inventory.controls
      .filter((c) => c.hasStableId && c.viewName)
      .slice(0, 15)
      .map((c, i) => ({
        id: `s${i}`,
        title: `Step ${i}`,
        text: 'x',
        placement: 'PreferredBottomOrFlip',
        before: [],
        target: { viewName: c.viewName, controlId: c.localId, fallbacks: [] },
      }))
    const tour = {
      schemaVersion: 1,
      id: 'big',
      title: 'Big',
      options: { showProgress: true, allowSkip: true, overlay: true, interactive: true, waitTimeoutMs: 5000 },
      steps,
    }
    const { result, ms: lintMs } = timed('lintTour (15 steps)', () => lintTour(tour, inventory))
    expect(lintMs).toBeLessThan(500)
    expect(result.summary.errors).toBe(0)
    const { ms: exportMs } = timed('buildBundle', () =>
      buildBundle({
        tour,
        inventory,
        playerSource: readFileSync('player/TourPlayer.js', 'utf8'),
        schemaJson: '{}',
      }),
    )
    expect(exportMs).toBeLessThan(1500)
  })

  it('the sandbox copy is built quickly, with sample data for every list', () => {
    const { result, ms: previewMs } = timed('buildPreviewApp (40 views)', () =>
      buildPreviewApp(sources),
    )
    expect(previewMs).toBeLessThan(2500)
    expect(result.files.size).toBeGreaterThan(80)
    expect(Object.keys(result.info.mockModels)).not.toHaveLength(0)
    const component = result.files.get('Component.js').body
    expect(component).toContain('"Items40"')
  })
})
