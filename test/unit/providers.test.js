import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  createGeminiProvider,
  friendlyGeminiError,
  DEFAULT_GEMINI_MODEL,
} from '../../srv/lib/llm/gemini.js'
import {
  createSapAiCoreProvider,
  neutralizePlaceholders,
  friendlySapError,
} from '../../srv/lib/llm/sap-ai-core.js'
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
const step = (o) => ({
  title: 'T',
  text: 'x',
  viewName: '',
  controlId: '',
  controlText: '',
  placement: 'PreferredBottomOrFlip',
  navigateTo: '',
  recordingStep: -1,
  ...o,
})
const ANSWER = JSON.stringify({
  title: 'Orders',
  steps: [step({ title: 'Create', viewName: MAIN, controlId: 'createBtn', recordingStep: 6 })],
})
const messages = [
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'draft' },
  { role: 'user', content: 'fix it' },
]

describe('Gemini provider', () => {
  const fakeClient = (reply, calls = []) => ({
    models: {
      generateContent: async (params) => {
        calls.push(params)
        if (reply instanceof Error) throw reply
        return reply
      },
    },
  })
  const reply = {
    text: ANSWER,
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
  }
  const make = (env = {}, r = reply, calls = []) =>
    createGeminiProvider({
      env: { GEMINI_API_KEY: 'k', ...env },
      createClient: () => fakeClient(r, calls),
    })

  it('sends the conversation with the verified SDK parameters and reads text and usage', async () => {
    const calls = []
    const out = await make({}, reply, calls).complete({
      system: 'SYS',
      messages,
      schema: DRAFT_SCHEMA,
      model: 'gemini-x',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('gemini-x')
    expect(calls[0].contents).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'draft' }] },
      { role: 'user', parts: [{ text: 'fix it' }] },
    ])
    expect(calls[0].config).toMatchObject({
      systemInstruction: 'SYS',
      responseMimeType: 'application/json',
      responseJsonSchema: DRAFT_SCHEMA,
    })
    expect(calls[0].config.httpOptions.timeout).toBeGreaterThan(0)
    expect(out).toEqual({
      text: ANSWER,
      finishReason: 'STOP',
      usage: { inputTokens: 1000, outputTokens: 500 },
    })
  })

  it('uses gemini-3.8-flash unless configured otherwise and never leaks the key into requests', async () => {
    expect(make().defaultModel()).toBe(DEFAULT_GEMINI_MODEL)
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.8-flash')
    expect(make({ GEMINI_MODEL: 'gemini-other' }).defaultModel()).toBe('gemini-other')
    const calls = []
    await make({}, reply, calls).complete({ system: 's', messages, schema: DRAFT_SCHEMA })
    expect(calls[0].model).toBe('gemini-3.8-flash')
    expect(JSON.stringify(calls)).not.toContain('"k"')
  })

  it('is configured only with a key and can be switched off by the operator', () => {
    expect(createGeminiProvider({ env: {} }).isConfigured()).toBe(false)
    expect(make().isConfigured()).toBe(true)
    expect(make({ TOURD_DISABLE_AI: '1' }).isConfigured()).toBe(false)
    expect(make({ TOURD_DISABLED_PROVIDERS: 'sap-ai-core, gemini' }).isConfigured()).toBe(false)
    expect(make({ TOURD_DISABLED_PROVIDERS: 'sap-ai-core' }).isConfigured()).toBe(true)
  })

  it('maps errors to actionable messages and flags transient ones', () => {
    const api = (status, message = 'boom') => Object.assign(new Error(message), { status })
    expect(friendlyGeminiError(api(401)).message).toMatch(/rejected the API key/)
    expect(friendlyGeminiError(api(403)).retryable).toBe(false)
    expect(friendlyGeminiError(api(404, 'models/x not found')).message).toMatch(
      /does not know this model/,
    )
    expect(friendlyGeminiError(api(429))).toMatchObject({
      retryable: true,
      message: expect.stringContaining('rate limit'),
    })
    expect(friendlyGeminiError(api(503)).retryable).toBe(true)
    expect(
      friendlyGeminiError(Object.assign(new Error('x'), { code: 'ECONNRESET' })).retryable,
    ).toBe(true)
    expect(friendlyGeminiError(api(400, 'bad schema')).message).toBe('bad schema')
  })

  it('wraps SDK failures raised during complete()', async () => {
    const p = make({}, Object.assign(new Error('quota'), { status: 429 }))
    await expect(p.complete({ system: 's', messages, schema: DRAFT_SCHEMA })).rejects.toMatchObject(
      { retryable: true },
    )
  })

  it('generates a verified tour end to end and reports the provider', async () => {
    const { tour, report } = await make().generate({
      inventory,
      recording,
      sources,
      retryDelayMs: 0,
    })
    expect(tour.steps[0].target).toMatchObject({ viewName: MAIN, controlId: 'createBtn' })
    expect(report).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      repairs: 0,
      usage: { inputTokens: 1000, outputTokens: 500 },
    })
  })
})

describe('SAP Generative AI Hub provider', () => {
  const makeClient = (reply, record) => (config, deployment) => ({
    chatCompletion: async (request, requestConfig) => {
      record.push({ config, deployment, request, requestConfig })
      if (typeof reply === 'function') return reply(record.length)
      return reply
    },
  })
  const response = (text = ANSWER) => ({
    getContent: () => text,
    getFinishReason: () => 'stop',
    getTokenUsage: () => ({ prompt_tokens: 900, completion_tokens: 120 }),
  })
  const make = (env = {}, reply = response(), record = []) =>
    createSapAiCoreProvider({
      env: { AICORE_SERVICE_KEY: '{}', AICORE_MODEL: 'gpt-x', ...env },
      createClient: makeClient(reply, record),
    })
  const complete = (p, extra = {}) =>
    p.complete({ system: 'SYS', messages, schema: DRAFT_SCHEMA, ...extra })

  it('configures model and a json_schema response format in the orchestration config', async () => {
    const record = []
    const out = await complete(make({ AICORE_RESOURCE_GROUP: 'rg1' }, response(), record))
    expect(record).toHaveLength(1)
    expect(record[0].config).toEqual({
      promptTemplating: {
        model: { name: 'gpt-x' },
        prompt: {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'tour_draft', strict: true, schema: DRAFT_SCHEMA },
          },
        },
      },
    })
    expect(record[0].deployment).toEqual({ resourceGroup: 'rg1' })
    expect(record[0].request.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ])
    expect(out).toEqual({
      text: ANSWER,
      finishReason: 'stop',
      usage: { inputTokens: 900, outputTokens: 120 },
    })
  })

  it('prefers the model chosen per request and demands one when none is configured', async () => {
    const record = []
    await complete(make({}, response(), record), { model: 'other-model' })
    expect(record[0].config.promptTemplating.model.name).toBe('other-model')
    await expect(complete(make({ AICORE_MODEL: '' }))).rejects.toThrow(/AICORE_MODEL/)
  })

  it('breaks "{{?placeholder}}" sequences in prompts so the templating engine leaves them alone', async () => {
    expect(neutralizePlaceholders('a {{?x}} b {{key}} c')).toBe('a { {?x}} b {{key}} c')
    const record = []
    await p_(make({}, response(), record), 'code with {{?x}}')
    expect(JSON.stringify(record[0].request)).not.toContain('{{?')

    async function p_(p, content) {
      return p.complete({
        system: 'S {{?s}}',
        messages: [{ role: 'user', content }],
        schema: DRAFT_SCHEMA,
      })
    }
  })

  it('retries once without response_format when the model rejects it', async () => {
    const record = []
    const reject = Object.assign(new Error('Request failed'), {
      cause: {
        response: { status: 400, data: { error: 'response_format json_schema is not supported' } },
      },
    })
    const out = await complete(
      make({}, (n) => (n === 1 ? Promise.reject(reject) : response()), record),
    )
    expect(record).toHaveLength(2)
    expect(record[0].config.promptTemplating.prompt).toBeDefined()
    expect(record[1].config.promptTemplating).toEqual({ model: { name: 'gpt-x' } })
    expect(out.text).toBe(ANSWER)
  })

  it('does not retry other client errors and maps them', async () => {
    const record = []
    const bad = Object.assign(new Error('Request failed'), {
      cause: { response: { status: 401, data: {} } },
    })
    await expect(complete(make({}, () => Promise.reject(bad), record))).rejects.toThrow(
      /rejected the credentials/,
    )
    expect(record).toHaveLength(1)
    expect(
      friendlySapError(Object.assign(new Error('x'), { cause: { response: { status: 429 } } })),
    ).toMatchObject({ retryable: true, status: 429 })
    expect(
      friendlySapError(Object.assign(new Error('x'), { cause: { response: { status: 404 } } }))
        .message,
    ).toMatch(/no deployment/)
    expect(
      friendlySapError(Object.assign(new Error('x'), { cause: { code: 'ETIMEDOUT' } })).retryable,
    ).toBe(true)
  })

  it('is configured with a service key or an AI Core binding, unless disabled', () => {
    expect(createSapAiCoreProvider({ env: {} }).isConfigured()).toBe(false)
    expect(make().isConfigured()).toBe(true)
    expect(
      createSapAiCoreProvider({ env: { VCAP_SERVICES: '{"aicore":[{}]}' } }).isConfigured(),
    ).toBe(true)
    expect(make({ TOURD_DISABLED_PROVIDERS: 'sap-ai-core' }).isConfigured()).toBe(false)
    expect(make().defaultModel()).toBe('gpt-x')
  })

  it('generates a verified tour end to end', async () => {
    const { tour, report } = await make().generate({
      inventory,
      recording,
      sources,
      retryDelayMs: 0,
    })
    expect(tour.steps[0].target.controlId).toBe('createBtn')
    expect(report).toMatchObject({
      provider: 'sap-ai-core',
      model: 'gpt-x',
      usage: { inputTokens: 900, outputTokens: 120 },
    })
  })
})
