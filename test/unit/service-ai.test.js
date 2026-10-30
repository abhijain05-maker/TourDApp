import cds from '@sap/cds'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { demoSources } from '../helpers/sources.js'
import { registerProvider } from '../../srv/lib/llm/provider.js'
import { generateWithLlm } from '../../srv/lib/llm/generate.js'

const { GET, POST } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const MAIN = 'demo.orders.view.Main'
const DETAIL = 'demo.orders.view.Detail'

const fails = (p) =>
  p.then(
    (r) => ({ status: r.status, message: 'unexpected success' }),
    (e) => ({
      status: e.response?.status ?? e.code,
      message: e.response?.data?.error?.message ?? e.message,
    }),
  )

async function waitFor(jobID) {
  for (let i = 0; i < 100; i++) {
    const { data } = await GET(`${BASE}/GenerationJobs(${jobID})`)
    if (data.status === 'done' || data.status === 'failed') return data
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('job did not finish')
}

const s = (o) => ({
  title: 'T',
  text: 'x.',
  viewName: '',
  controlId: '',
  controlText: '',
  placement: 'PreferredBottomOrFlip',
  navigateTo: '',
  recordingStep: -1,
  ...o,
})
const good = (customerId = 'customerInput') => ({
  title: 'Create an order',
  steps: [
    s({ title: 'Welcome' }),
    s({ title: 'Press Create', viewName: MAIN, controlId: 'createBtn', recordingStep: 6 }),
    s({
      title: 'Customer',
      viewName: DETAIL,
      controlId: customerId,
      navigateTo: 'order/new',
      recordingStep: 7,
    }),
    s({ title: 'Save', viewName: DETAIL, controlId: 'saveBtn', recordingStep: 10 }),
  ],
})

// A scripted AI provider built from the real generation loop; only the model is fake.
const script = { answers: [], calls: [], onCall: null }
const fakeComplete = async (req) => {
  script.calls.push(req)
  await script.onCall?.(script.calls.length)
  const a = script.answers[Math.min(script.calls.length - 1, script.answers.length - 1)]
  if (a instanceof Error) throw a
  return { text: JSON.stringify(a), usage: { inputTokens: 10, outputTokens: 5 } }
}
const fakeAi = {
  id: 'fake-ai',
  label: 'Fake AI',
  isConfigured: () => true,
  defaultModel: () => 'fake-1',
  complete: fakeComplete,
  async generate(ctx) {
    const { tour, report } = await generateWithLlm({
      ...ctx,
      model: ctx.model || 'fake-1',
      complete: fakeComplete,
      retryDelayMs: 0,
    })
    return { tour, report: { ...report, provider: 'fake-ai' } }
  },
}
const reset = (...answers) => Object.assign(script, { answers, calls: [], onCall: null })

let ctx
beforeAll(async () => {
  registerProvider(fakeAi)
  registerProvider({ ...fakeAi, id: 'offline-ai', isConfigured: () => false })
  const projectID = (await POST(`${BASE}/Projects`, { name: 'AI' })).data.ID
  await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
  const raw = readFileSync('test/fixtures/recordings/demo-create-order.devtools.json', 'utf8')
  const recordingID = (await POST(`${BASE}/importRecording`, { projectID, raw })).data.ID
  ctx = { projectID, recordingID }
})
afterAll(() => {
  delete process.env.TOURD_LLM_PROVIDER
})

const generate = async (extra = {}) =>
  waitFor((await POST(`${BASE}/generateTour`, { ...ctx, ...extra })).data.ID)

describe('AI generation through the service', () => {
  it('runs the model, repairs a hallucinated id on the job and stores a verified tour', async () => {
    reset(good('custInput'), good())
    const seen = []
    script.onCall = async (n) => {
      if (n === 2)
        seen.push(
          (
            await GET(
              `${BASE}/GenerationJobs?$filter=provider eq 'fake-ai' and status eq 'running'`,
            )
          ).data.value[0]?.stage,
        )
    }
    const job = await generate({ provider: 'fake-ai', title: 'Orders' })

    expect(seen).toEqual(['repair'])
    expect(job).toMatchObject({ status: 'done', provider: 'fake-ai', model: 'fake-1', error: null })
    const report = JSON.parse(job.report)
    expect(report).toMatchObject({
      provider: 'fake-ai',
      repairs: 1,
      unresolved: 0,
      steps: 4,
      usage: { inputTokens: 20, outputTokens: 10 },
    })

    const tour = (await GET(`${BASE}/Tours(${job.tour_ID})`)).data
    expect(tour).toMatchObject({ generator: 'fake-ai', model: 'fake-1' })
    const def = JSON.parse(tour.definition)
    expect(def.steps.find((x) => x.target?.controlId === 'customerInput')).toBeTruthy()
    expect(JSON.stringify(def)).not.toContain('custInput')
  })

  it('keeps serving other requests while the model is still thinking (no transaction held open)', async () => {
    reset(good())
    let release
    const gate = new Promise((r) => (release = r))
    script.onCall = () => gate // the model call stays pending until we let it go
    const { data: queued } = await POST(`${BASE}/generateTour`, { ...ctx, provider: 'fake-ai' })

    const started = Date.now()
    for (let i = 0; i < 100 && script.calls.length === 0; i++)
      await new Promise((r) => setTimeout(r, 20))
    expect(script.calls).toHaveLength(1) // the job is now waiting for the model

    const [projects, job] = await Promise.all([
      GET(`${BASE}/Projects`),
      GET(`${BASE}/GenerationJobs(${queued.ID})`),
    ])
    expect(projects.status).toBe(200)
    expect(job.data).toMatchObject({ status: 'running', stage: 'generate' })
    expect(Date.now() - started).toBeLessThan(2000)

    release()
    expect((await waitFor(queued.ID)).status).toBe('done')
  })

  it('keeps an unfixable step visible as unresolved and reports it on the job', async () => {
    reset(good('custInput'))
    const job = await generate({ provider: 'fake-ai' })
    expect(job.status).toBe('done')
    expect(JSON.parse(job.report)).toMatchObject({ repairs: 2, unresolved: 1 })
    const def = JSON.parse((await GET(`${BASE}/Tours(${job.tour_ID})`)).data.definition)
    expect(def.steps.filter((x) => x.meta.unresolved)).toHaveLength(1)
  })

  it('reports a provider outage on the job', async () => {
    reset(new Error('Gemini rejected the API key'))
    const job = await generate({ provider: 'fake-ai' })
    expect(job).toMatchObject({
      status: 'failed',
      stage: 'generate',
      error: 'Gemini rejected the API key',
    })
  })

  it('uses the provider from TOURD_LLM_PROVIDER when the request names none', async () => {
    reset(good())
    process.env.TOURD_LLM_PROVIDER = 'fake-ai'
    const job = await generate()
    expect(job.provider).toBe('fake-ai')
    process.env.TOURD_LLM_PROVIDER = 'offline-ai' // not configured -> falls back to the rules
    expect((await generate()).provider).toBe('rules')
    delete process.env.TOURD_LLM_PROVIDER
  })
})

describe('refineStep', () => {
  let tourID
  beforeAll(async () => {
    reset(good())
    tourID = (await generate({ provider: 'fake-ai' })).tour_ID
  })

  const refine = (body) => POST(`${BASE}/refineStep`, { tourID, provider: 'fake-ai', ...body })
  const stepOf = async (id) =>
    JSON.parse((await GET(`${BASE}/Tours(${tourID})`)).data.definition).steps.find(
      (x) => x.id === id,
    )

  it('applies an AI edit as a new version with the instruction as note', async () => {
    const before = await stepOf('s3')
    reset({
      ...s({}),
      title: 'Kunde',
      text: 'Geben Sie den **Kunden** ein.',
      viewName: before.target.viewName,
      controlId: before.target.controlId,
      placement: before.placement,
      navigateTo: before.before[0].hash,
    })
    const { data } = await refine({ stepID: 's3', instruction: 'translate to German' })
    expect(data.version).toBe(2)
    expect(await stepOf('s3')).toMatchObject({
      title: 'Kunde',
      text: 'Geben Sie den **Kunden** ein.',
      target: before.target,
    })
    const note = (await GET(`${BASE}/TourVersions?$filter=tour_ID eq ${tourID} and version eq 2`))
      .data.value[0].note
    expect(note).toBe('AI: translate to German')
  })

  it('ignores a hallucinated retarget but keeps the rest of the edit', async () => {
    const before = await stepOf('s3')
    reset({
      ...s({}),
      title: 'Client',
      text: before.text,
      viewName: DETAIL,
      controlId: 'ghostInput',
      placement: before.placement,
      navigateTo: before.before[0].hash,
    })
    const res = await refine({ stepID: 's3', instruction: 'point at the ghost' })
    expect(res.status).toBe(200)
    const after = await stepOf('s3')
    expect(after.title).toBe('Client')
    expect(after.target).toEqual(before.target)
  })

  it('validates the request', async () => {
    expect(await fails(refine({ stepID: 's3', instruction: '  ' }))).toMatchObject({ status: 400 })
    expect(await fails(refine({ stepID: 's3', instruction: 'x'.repeat(501) }))).toMatchObject({
      status: 400,
    })
    expect(await fails(refine({ stepID: 'nope', instruction: 'shorter' }))).toMatchObject({
      status: 404,
    })
    expect(
      await fails(refine({ stepID: 's3', instruction: 'shorter', provider: 'rules' })),
    ).toMatchObject({ status: 400, message: expect.stringContaining('AI provider') })
    expect(
      await fails(refine({ stepID: 's3', instruction: 'shorter', provider: 'offline-ai' })),
    ).toMatchObject({ status: 400, message: expect.stringContaining('not configured') })
    expect(
      await fails(
        POST(`${BASE}/refineStep`, {
          tourID: '00000000-0000-0000-0000-000000000000',
          stepID: 's3',
          instruction: 'x',
          provider: 'fake-ai',
        }),
      ),
    ).toMatchObject({ status: 404 })
  })

  it('reports a failing model as 502 and leaves the tour unchanged', async () => {
    const versionBefore = (await GET(`${BASE}/Tours(${tourID})`)).data.version
    reset(new Error('model down'))
    const r = await fails(refine({ stepID: 's3', instruction: 'shorter' }))
    expect(r).toMatchObject({ status: 502, message: expect.stringContaining('model down') })
    expect((await GET(`${BASE}/Tours(${tourID})`)).data.version).toBe(versionBefore)
  })
})
