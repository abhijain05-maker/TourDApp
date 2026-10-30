import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { validateRecording } from '../../shared/recording-schema.mjs'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { buildPlan } from '../../srv/lib/wdi5/plan.js'
import { renderSpec } from '../../srv/lib/wdi5/render.js'
import { generateTourFromRules } from '../../srv/lib/llm/rules.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const base = JSON.parse(
  readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8'),
)
const customer = base.steps.find((s) => s.control?.localId === 'customerInput').control

/** The demo recording with checks pointed at while recording, after the step with this index. */
function withChecks(checks) {
  const rec = structuredClone(base)
  const steps = []
  for (const s of rec.steps) {
    steps.push(s)
    for (const c of checks.filter((x) => x.after === s.index))
      steps.push({
        type: 'check',
        event: 'check',
        t: s.t + 1,
        control: c.control ?? customer,
        check: c.check,
      })
  }
  rec.steps = steps.map((s, i) => ({ ...s, index: i }))
  return rec
}
const parse = (rec) => parseRecording(JSON.stringify(rec))

describe('a "check" step in a recording', () => {
  it('is valid with a control and a check, and nothing else is', () => {
    const rec = withChecks([{ after: 3, check: { kind: 'value', expected: 'Acme Corp' } }])
    expect(validateRecording(rec).ok).toBe(true)
    const noCheck = structuredClone(rec)
    delete noCheck.steps.find((s) => s.type === 'check').check
    expect(validateRecording(noCheck).issues[0].message).toMatch(/needs a check/)
    const noControl = structuredClone(rec)
    delete noControl.steps.find((s) => s.type === 'check').control
    expect(validateRecording(noControl).issues[0].message).toMatch(/needs a control/)
    const odd = structuredClone(rec)
    odd.steps.find((s) => s.type === 'check').check.kind = 'colour'
    expect(validateRecording(odd).ok).toBe(false)
  })

  it('is read as a check on the control, and is neither a tour step nor a click', () => {
    const rec = parse(withChecks([{ after: 3, check: { kind: 'value', expected: 'Acme Corp' } }]))
    const check = rec.steps.find((s) => s.action === 'check')
    expect(check).toMatchObject({
      check: { kind: 'value', expected: 'Acme Corp' },
      ui5: { controlId: 'customerInput' },
    })
    const mapped = mapRecording(rec, inventory)
    expect(mapped.steps.find((s) => s.action === 'check').ui5).toMatchObject({
      localId: 'customerInput',
      via: 'recorder',
    })
    // tours do not count it, as a step or as one that was left out
    const tour = generateTourFromRules({ recording: mapped, inventory })
    const plain = generateTourFromRules({
      recording: mapRecording(parse(base), inventory),
      inventory,
    })
    expect(tour.tour.steps.length).toBe(plain.tour.steps.length)
  })

  it('becomes a check in the test plan, where it was pointed at', () => {
    const mapped = mapRecording(
      parse(
        withChecks([
          { after: 3, check: { kind: 'value', expected: 'Acme Corp' } },
          { after: 3, check: { kind: 'visible' } },
        ]),
      ),
      inventory,
    )
    const plan = buildPlan({ mapped, inventory, name: 'x' })
    const checks = plan.steps.filter((s) => s.kind === 'assert' && !s.heuristic)
    expect(checks.map((s) => [s.title, s.locator, s.assertion])).toEqual([
      ['Customer holds "Acme Corp"', 'customerInput', { type: 'value', expected: 'Acme Corp' }],
      ['Customer is shown', 'customerInput', { type: 'visible' }],
    ])
    const spec = renderSpec(plan, 'x.journey')
    expect(spec).toContain(
      'expect(await browser.asControl(locators.customerInput).getVisible()).toBe(true)',
    )
  })

  it('a check on a control that is not in the app is kept, switched off, with the reason', () => {
    const rec = parse(withChecks([{ after: 3, check: { kind: 'text', expected: 'x' } }]))
    const mapped = mapRecording(rec, inventory)
    mapped.steps = mapped.steps.map((s) => (s.action === 'check' ? { ...s, ui5: undefined } : s))
    const step = buildPlan({ mapped, inventory, name: 'x' }).steps.find(
      (s) => s.kind === 'assert' && !s.heuristic,
    )
    expect(step).toMatchObject({ enabled: false, locator: null })
    expect(step.note).toMatch(/not found in the app's files/)
  })

  it('a check right after opening the app is a test of its own', () => {
    const rec = structuredClone(base)
    rec.steps = [
      { type: 'check', event: 'check', t: 1, control: customer, check: { kind: 'visible' } },
      ...rec.steps,
    ].map((s, i) => ({ ...s, index: i }))
    const plan = buildPlan({ mapped: mapRecording(parse(rec), inventory), inventory, name: 'x' })
    const spec = renderSpec(plan, 'x.journey')
    expect(spec).toMatch(
      /it\("Customer is shown", async \(\) => \{\n\s+\/\/ Customer is shown\n\s+expect\(await browser\.asControl\(locators\.customerInput\)\.getVisible\(\)\)/,
    )
  })
})
