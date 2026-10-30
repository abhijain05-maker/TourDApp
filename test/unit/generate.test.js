import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { generateWithLlm, extractJson, ModelAnswerError } from '../../srv/lib/llm/generate.js'
import { DRAFT_SCHEMA } from '../../srv/lib/llm/draft.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { demoSources } from '../helpers/sources.js'

const sources = demoSources()
const inventory = buildInventory(sources)
const recording = mapRecording(
  parseRecording(readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')),
  inventory,
)
const MAIN = 'demo.orders.view.Main'
const DETAIL = 'demo.orders.view.Detail'

const s = (over) => ({
  title: 'T',
  text: 'Text.',
  viewName: '',
  controlId: '',
  controlText: '',
  placement: 'PreferredBottomOrFlip',
  navigateTo: '',
  recordingStep: -1,
  ...over,
})
const goodDraft = (patch = (steps) => steps) => ({
  title: 'Create an order',
  steps: patch([
    s({ title: 'Welcome', text: 'Learn to create orders.' }),
    s({ title: 'Search', viewName: MAIN, controlId: 'searchField', recordingStep: 2 }),
    s({ title: 'Press Create', viewName: MAIN, controlId: 'createBtn', recordingStep: 6 }),
    s({
      title: 'Customer',
      viewName: DETAIL,
      controlId: 'customerInput',
      navigateTo: 'order/new',
      recordingStep: 7,
    }),
    s({
      title: 'Save',
      viewName: DETAIL,
      controlId: 'saveBtn',
      placement: 'PreferredTopOrFlip',
      recordingStep: 10,
    }),
    s({
      title: 'Export',
      viewName: MAIN,
      controlText: 'Export',
      navigateTo: '',
      recordingStep: 11,
    }),
  ]),
})

// A scripted model: returns the queued answers in order and records every request.
function fakeModel(...answers) {
  const calls = []
  const complete = async (req) => {
    calls.push(structuredClone(req))
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    return typeof a === 'string'
      ? { text: a, usage: { inputTokens: 100, outputTokens: 50 } }
      : { usage: { inputTokens: 100, outputTokens: 50 }, ...a }
  }
  return { complete, calls }
}
const run = (model, extra = {}) =>
  generateWithLlm({
    complete: model.complete,
    inventory,
    recording,
    sources,
    model: 'm1',
    retryDelayMs: 0,
    ...extra,
  })
const json = (o) => JSON.stringify(o)

describe('extractJson', () => {
  it('reads plain, fenced and chatty answers', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure! Here it is:\n{"a":{"b":2}}\nHope that helps')).toEqual({
      a: { b: 2 },
    })
  })
  it('throws a ModelAnswerError otherwise', () => {
    expect(() => extractJson('no json here')).toThrow(ModelAnswerError)
    expect(() => extractJson('{ broken')).toThrow(/not valid JSON/)
  })
})

describe('generateWithLlm', () => {
  it('turns a correct answer into a verified tour without any repair', async () => {
    const model = fakeModel(json(goodDraft()))
    const { tour, report } = await run(model)
    expect(model.calls).toHaveLength(1)
    expect(tour.steps.map((x) => x.id)).toEqual(['intro', 's2', 's3', 's4', 's5', 's6'])
    expect(tour.steps[3]).toMatchObject({
      before: [{ type: 'navigate', hash: 'order/new' }],
      target: { controlId: 'customerInput' },
    })
    expect(tour.steps[5].target).toEqual({
      viewName: MAIN,
      fallbacks: [{ by: 'text', value: 'Export' }],
    })
    expect(report).toMatchObject({
      generator: 'llm',
      model: 'm1',
      steps: 6,
      unresolved: 0,
      repairs: 0,
      remainingProblems: [],
    })
    expect(report.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  it('hands the provider the system prompt, the schema and the model name', async () => {
    const model = fakeModel(json(goodDraft()))
    await run(model)
    expect(model.calls[0]).toMatchObject({ model: 'm1', schema: DRAFT_SCHEMA })
    expect(model.calls[0].system).toContain('guided tours')
    expect(model.calls[0].messages).toHaveLength(1)
    expect(model.calls[0].messages[0].content).toContain('createBtn | Button')
  })

  it('accepts fenced JSON without bothering the model again', async () => {
    const model = fakeModel('```json\n' + json(goodDraft()) + '\n```')
    await run(model)
    expect(model.calls).toHaveLength(1)
  })

  it('repairs a hallucinated control id by telling the model what exists', async () => {
    const bad = goodDraft((steps) =>
      steps.map((x) => (x.controlId === 'customerInput' ? { ...x, controlId: 'custInput' } : x)),
    )
    const stages = []
    const model = fakeModel(json(bad), json(goodDraft()))
    const { tour, report } = await run(model, { onStage: (st) => stages.push(st) })

    expect(model.calls).toHaveLength(2)
    expect(stages).toEqual(['repair'])
    const msgs = model.calls[1].messages
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(msgs[1].content).toBe(json(bad))
    expect(msgs[2].content).toContain('Step 4:')
    expect(msgs[2].content).toContain('"custInput"')
    expect(msgs[2].content).toContain('customerInput')
    expect(tour.steps.find((x) => x.target?.controlId === 'customerInput')).toBeTruthy()
    expect(report).toMatchObject({ repairs: 1, unresolved: 0, remainingProblems: [] })
    expect(report.usage).toEqual({ inputTokens: 200, outputTokens: 100 })
  })

  it('keeps a still-hallucinated step but flags it as unresolved after the repair rounds are used up', async () => {
    const bad = goodDraft((steps) =>
      steps.map((x) => (x.controlId === 'saveBtn' ? { ...x, controlId: 'sendBtn' } : x)),
    )
    const model = fakeModel(json(bad))
    const { tour, report } = await run(model)
    expect(model.calls).toHaveLength(3) // initial + 2 repairs
    const save = tour.steps.find((x) => x.title === 'Save')
    expect(save.meta).toMatchObject({ unresolved: true })
    expect(save.target).toBeUndefined()
    expect(report).toMatchObject({ repairs: 2, unresolved: 1 })
    expect(report.remainingProblems[0]).toContain('sendBtn')
  })

  it('makes the model fix missing navigation (lint: step on a page that is not shown)', async () => {
    const forgot = goodDraft((steps) => steps.map((x) => ({ ...x, navigateTo: '' })))
    const model = fakeModel(json(forgot), json(goodDraft()))
    const { tour, report } = await run(model)
    expect(model.calls[1].messages[2].content).toContain(
      'Routes: "" shows Main; "order/{orderId}" shows Detail',
    )
    expect(tour.steps.some((x) => x.before.length)).toBe(true)
    expect(report.repairs).toBe(1)
  })

  it('asks again when the answer is not JSON, and for a shorter one when it was cut off', async () => {
    const model = fakeModel(
      'I cannot do that',
      { text: '{"title": "x", "steps": [', finishReason: 'MAX_TOKENS' },
      json(goodDraft()),
    )
    const { report } = await run(model)
    expect(model.calls).toHaveLength(3)
    expect(model.calls[1].messages[2].content).toContain('not valid JSON')
    expect(model.calls[2].messages[4].content).toContain('cut off')
    expect(report.repairs).toBe(2)
  })

  it('gives up with a clear error when the model never produces a usable answer', async () => {
    const model = fakeModel('nonsense')
    await expect(run(model)).rejects.toThrow(/did not return a usable tour after 3 attempts/)
    expect(model.calls).toHaveLength(3)
  })

  it('treats an answer without steps as unusable and repairs it', async () => {
    const model = fakeModel(json({ title: 'Empty', steps: [] }), json(goodDraft()))
    const { tour } = await run(model)
    expect(tour.steps).toHaveLength(6)
  })

  it('retries transient provider errors but not permanent ones', async () => {
    const transient = Object.assign(new Error('rate limited'), { retryable: true })
    const flaky = fakeModel(transient, transient, json(goodDraft()))
    await run(flaky)
    expect(flaky.calls).toHaveLength(3)

    const down = fakeModel(transient)
    await expect(run(down)).rejects.toThrow('rate limited')
    expect(down.calls).toHaveLength(3)

    const denied = fakeModel(new Error('invalid API key'))
    await expect(run(denied)).rejects.toThrow('invalid API key')
    expect(denied.calls).toHaveLength(1)
  })

  it('honours maxRepairs = 0', async () => {
    const bad = goodDraft((steps) =>
      steps.map((x) => (x.controlId === 'saveBtn' ? { ...x, controlId: 'nope' } : x)),
    )
    const model = fakeModel(json(bad))
    const { report } = await run(model, { maxRepairs: 0 })
    expect(model.calls).toHaveLength(1)
    expect(report.unresolved).toBe(1)
  })

  it('reports the prompt context (files sent, redaction)', async () => {
    const { report } = await run(fakeModel(json(goodDraft())), { redact: true })
    expect(report.context).toMatchObject({ redacted: true })
    expect(report.context.files.length).toBeGreaterThan(3)
  })
})
