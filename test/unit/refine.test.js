import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { refineStep, stepToDraft, REFINE_SCHEMA } from '../../srv/lib/llm/refine.js'
import { generateTourFromRules } from '../../srv/lib/llm/rules.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const recording = mapRecording(
  parseRecording(readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')),
  inventory,
)
const { tour } = generateTourFromRules({ recording, inventory })
const MAIN = 'demo.orders.view.Main'
const DETAIL = 'demo.orders.view.Detail'

// s3 = "Customer" input in the detail view (navigates to order/new first)
const target = tour.steps.find((s) => s.id === 's3')

function model(reply) {
  const calls = []
  return {
    calls,
    complete: async (req) => {
      calls.push(req)
      return {
        text: JSON.stringify(typeof reply === 'function' ? reply(req) : reply),
        usage: { inputTokens: 10, outputTokens: 5 },
      }
    },
  }
}
const run = (m, extra = {}) =>
  refineStep({
    complete: m.complete,
    tour,
    stepId: 's3',
    instruction: 'make it shorter',
    inventory,
    ...extra,
  })
const proposal = (over) => ({ ...stepToDraft(target), ...over })

describe('stepToDraft', () => {
  it('flattens a step into the model format', () => {
    expect(stepToDraft(target)).toEqual({
      title: 'Customer',
      text: 'Fill in **Customer**.',
      viewName: DETAIL,
      controlId: 'customerInput',
      controlText: '',
      placement: 'PreferredRightOrFlip',
      navigateTo: 'order/new',
      recordingStep: -1,
    })
  })

  it('uses controlText for controls without an id and empty fields for a centered step', () => {
    expect(stepToDraft(tour.steps.find((s) => s.id === 's6'))).toMatchObject({
      controlId: '',
      controlText: 'Export',
      viewName: MAIN,
    })
    expect(stepToDraft(tour.steps[0])).toMatchObject({
      viewName: '',
      controlId: '',
      controlText: '',
      navigateTo: '',
    })
  })
})

describe('refineStep', () => {
  it('applies a text edit and leaves everything else untouched', async () => {
    const m = model(proposal({ title: 'Customer name', text: 'Enter the **customer**.' }))
    const out = await run(m)
    const step = out.tour.steps.find((s) => s.id === 's3')
    expect(step).toMatchObject({ title: 'Customer name', text: 'Enter the **customer**.' })
    expect(step.target).toEqual(target.target)
    expect(step.before).toEqual(target.before)
    expect(out.tour.steps.filter((s) => s.id !== 's3')).toEqual(
      tour.steps.filter((s) => s.id !== 's3'),
    )
    expect(out.ignored).toBeNull()
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('sends the instruction, the current step, the inventory and the single-step schema', async () => {
    const m = model(proposal())
    await run(m, { instruction: 'translate to German', model: 'm1' })
    const req = m.calls[0]
    expect(req).toMatchObject({ model: 'm1', schema: REFINE_SCHEMA })
    expect(req.messages[0].content).toContain('Instruction: translate to German')
    expect(req.messages[0].content).toContain('"controlId": "customerInput"')
    expect(req.messages[0].content).toContain(
      'Previous step: "Choose status"'.replace('Choose status', tour.steps[2].title),
    )
    expect(req.messages[0].content).toContain('saveBtn | Button | "Save"')
  })

  it('retargets to another control when it exists in the inventory', async () => {
    const out = await run(model(proposal({ viewName: DETAIL, controlId: 'saveBtn' })))
    const step = out.tour.steps.find((s) => s.id === 's3')
    expect(step.target).toMatchObject({ viewName: DETAIL, controlId: 'saveBtn' })
    expect(step.meta).toMatchObject({ unresolved: false })
    expect(out.ignored).toBeNull()
  })

  it('ignores a hallucinated retarget but still applies the text', async () => {
    const out = await run(model(proposal({ title: 'New title', controlId: 'ghostInput' })))
    const step = out.tour.steps.find((s) => s.id === 's3')
    expect(step.title).toBe('New title')
    expect(step.target).toEqual(target.target)
    expect(out.ignored).toContain('ghostInput')
  })

  it('takes over a new navigation hash and a valid placement, ignores an invalid placement', async () => {
    const a = await run(model(proposal({ navigateTo: '#/order/42', placement: 'Top' })))
    const stepA = a.tour.steps.find((s) => s.id === 's3')
    expect(stepA.before).toEqual([{ type: 'navigate', hash: 'order/42' }])
    expect(stepA.placement).toBe('Top')
    const b = await run(model(proposal({ placement: 'Sideways' })))
    expect(b.tour.steps.find((s) => s.id === 's3').placement).toBe(target.placement)
  })

  it('falls back to the current values for fields the model leaves out or nulls', async () => {
    const out = await run(model({ title: 'Only a title', text: null }))
    expect(out.tour.steps.find((s) => s.id === 's3')).toMatchObject({
      title: 'Only a title',
      text: target.text,
      target: target.target,
    })
  })

  it('does not drop the target when the model returns empty target fields', async () => {
    const out = await run(model(proposal({ viewName: '', controlId: '', controlText: '' })))
    expect(out.tour.steps.find((s) => s.id === 's3').target).toEqual(target.target)
  })

  it('rejects an unknown step and unusable answers', async () => {
    await expect(
      refineStep({
        complete: model({}).complete,
        tour,
        stepId: 'nope',
        instruction: 'x',
        inventory,
      }),
    ).rejects.toThrow(/no step "nope"/)
    await expect(run({ complete: async () => ({ text: 'sorry, no' }) })).rejects.toThrow(
      /not valid JSON/,
    )
  })
})
