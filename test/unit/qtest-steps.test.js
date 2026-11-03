import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { demoSources } from '../helpers/sources.js'
import { validatePlan } from '../../shared/wdi5-plan.mjs'
import {
  alignSteps,
  controlsOf,
  findControl,
  interpretRules,
  planFromSteps,
  quoted,
  stepsFromPlan,
} from '../../srv/lib/qtest/steps.js'
import { parseResults, matchResults } from '../../srv/lib/qtest/results.js'

const inventory = buildInventory(demoSources())
const controls = controlsOf(inventory)

const STEPS = [
  { id: 'st1', action: 'Open the application', data: '', expected: '' },
  { id: 'st2', action: 'Click the "Create" button', data: '', expected: 'The order form opens' },
  { id: 'st3', action: 'Enter the customer', data: 'ACME', expected: '' },
  { id: 'st4', action: 'Enter "ACME" in the "Customer" field', data: '', expected: 'The field "Customer" contains "ACME"' },
  { id: 'st5', action: 'Press "Save"', data: '', expected: 'A message "Order saved" is shown' },
  { id: 'st6', action: 'Press "Nonexistent thing"', data: '', expected: 'Something nice happens' },
]

describe('reading manual step text', () => {
  it('finds quoted names in several styles', () => {
    expect(quoted(`Press "Save" or “Cancel” or 'Delete'`)).toEqual(['Save', 'Cancel', 'Delete'])
    expect(quoted(`It's fine`)).toEqual([])
  })

  it('finds a control by its text, preferring the kind that fits', () => {
    expect(findControl('save', controls, /Button$/).control.localId).toBe('saveBtn')
    expect(findControl('Customer', controls, /Input$/).control.localId).toBe('customerInput')
    expect(findControl('nothing like it', controls, null)).toBeNull()
  })

  it('turns steps into actions and checks', () => {
    const press = interpretRules(STEPS[1], controls)
    expect(press.actions[0]).toMatchObject({ kind: 'press', control: { localId: 'createBtn' } })
    expect(press.manual).toEqual(['The order form opens']) // cannot be asserted: stays a human check

    const enter = interpretRules(STEPS[3], controls)
    expect(enter.actions[0]).toMatchObject({ kind: 'enterText', value: 'ACME', control: { localId: 'customerInput' } })
    expect(enter.checks[0]).toMatchObject({ kind: 'value', expected: 'ACME', control: { localId: 'customerInput' } })

    const save = interpretRules(STEPS[4], controls)
    expect(save.checks[0]).toEqual({ kind: 'toast', expected: 'Order saved' })

    expect(interpretRules(STEPS[0], controls).actions[0].kind).toBe('open')
    expect(interpretRules(STEPS[2], controls).actions[0]).toMatchObject({ kind: 'enterText', value: 'ACME' })
  })
})

describe('manual steps -> wdi5 plan', () => {
  const its = STEPS.map((s) => interpretRules(s, controls))
  const { plan, mapping, report } = planFromSteps(STEPS, its, { inventory, name: 'TC-001 Create an order' })

  it('makes a valid plan with the locators of the app', () => {
    expect(validatePlan(plan).ok).toBe(true)
    expect(plan.name).toBe('TC-001 Create an order')
    const press = plan.steps.find((s) => s.kind === 'press' && s.locator === 'createBtn')
    expect(press).toBeTruthy()
    expect(plan.locators.createBtn.selector).toMatchObject({ id: 'createBtn' })
    expect(plan.steps.find((s) => s.kind === 'enterText').value).toBe('ACME')
    expect(plan.steps.find((s) => s.kind === 'assert' && s.assertion.type === 'toast').assertion.expected).toBe('Order saved')
  })

  it('keeps a step that cannot be found, switched off, with the reason', () => {
    const bad = plan.steps.find((s) => s.title.includes('Nonexistent'))
    expect(bad).toMatchObject({ enabled: false })
    expect(bad.note).toMatch(/not found/)
    expect(report.unresolved).toBeGreaterThan(0)
  })

  it('remembers which plan steps belong to which manual step', () => {
    expect(mapping.get('st1')).toEqual([plan.steps[0].id]) // the plan opens the app
    expect(mapping.get('st2').length).toBeGreaterThan(0)
    expect(mapping.get('st5').length).toBeGreaterThanOrEqual(2) // the press and the toast check
    expect(report.manualOnly.map((m) => m.why)).toContain('The order form opens')
  })
})

describe('plan -> manual steps and back', () => {
  const its = STEPS.slice(0, 5).map((s) => interpretRules(s, controls))
  const { plan } = planFromSteps(STEPS.slice(0, 5), its, { inventory, name: 'x' })

  it('writes steps a tester can follow, with the checks as expected results', () => {
    const steps = stepsFromPlan(plan)
    expect(steps[0].action).toBe('Open the application')
    expect(steps.some((s) => s.action === 'Click the "Create" button')).toBe(true)
    const enter = steps.find((s) => s.action.startsWith('Enter the value'))
    expect(enter.data).toBe('ACME')
    expect(steps.every((s) => s.auto.length >= 1)).toBe(true)
    expect(steps.find((s) => /Save/.test(s.action)).expected).toMatch(/Order saved/)
  })

  it('aligns hand written steps with a plan made elsewhere, in order', () => {
    const map = alignSteps(STEPS.slice(0, 5), plan)
    expect(map.get('st1').length).toBe(1)
    expect(map.get('st2').length).toBeGreaterThan(0)
    expect(map.get('st5')).toContain(plan.steps.find((s) => s.title.includes('Save')).id)
    const unrelated = alignSteps([{ id: 'x', action: 'Water the plants', data: '', expected: '' }], plan)
    expect(unrelated.get('x')).toEqual([])
  })
})

describe('results of automated runs', () => {
  const byCode = new Map([['TC-001', {}], ['TC-002', {}]])

  it('reads JUnit and matches by the code in the name', () => {
    const xml = `<?xml version="1.0"?><testsuites><testsuite name="s"><testcase classname="TC-001 Create" name="creates" time="1.5"/>
      <testcase classname="TC-002 Delete" name="deletes" time="0.2"><failure message="boom">stack</failure></testcase>
      <testcase classname="x" name="TC-002 second" time="1"><skipped/></testcase>
      <testcase name="No code here" time="1"/></testsuite></testsuites>`
    const r = parseResults(xml)
    expect(r.format).toBe('junit')
    const m = matchResults(r.tests, byCode)
    expect(m.matched.find((x) => x.code === 'TC-001')).toMatchObject({ status: 'passed', durationMs: 1500 })
    expect(m.matched.find((x) => x.code === 'TC-002')).toMatchObject({ status: 'failed', tests: 2 })
    expect(m.unmatched).toHaveLength(1)
  })

  it('reads mocha json, mochawesome and wdio json', () => {
    const mocha = JSON.stringify({ stats: {}, tests: [{ fullTitle: 'TC-001 a', duration: 5 }, { fullTitle: 'TC-002 b', err: { message: 'x' } }], failures: [{ fullTitle: 'TC-002 b' }], passes: [], pending: [] })
    expect(parseResults(mocha).tests.map((t) => t.status)).toEqual(['passed', 'failed'])
    const awesome = JSON.stringify({ results: [{ suites: [{ tests: [{ fullTitle: 'TC-001 a', state: 'passed' }], suites: [{ tests: [{ fullTitle: 'TC-002 b', state: 'failed', err: { message: 'm' } }] }] }] }] })
    expect(parseResults(awesome).tests.map((t) => t.status)).toEqual(['passed', 'failed'])
    const wdio = JSON.stringify({ suites: [{ name: 'TC-001 Create', tests: [{ name: 'works', state: 'passed' }, { name: 'second', state: 'skipped' }] }] })
    expect(parseResults(wdio).tests.map((t) => t.codes[0])).toEqual(['TC-001', 'TC-001'])
  })

  it('says when it cannot read a file', () => {
    expect(() => parseResults('')).toThrow(/empty/)
    expect(() => parseResults('{"a":1}')).toThrow(/QuickTest knows/)
    expect(() => parseResults('nonsense')).toThrow(/neither/)
  })
})
