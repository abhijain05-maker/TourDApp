import cds from '@sap/cds'
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { demoSources } from '../helpers/sources.js'
import { registerProvider } from '../../srv/lib/llm/provider.js'

const { GET, POST } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const fx = (n) => readFileSync(`test/fixtures/recordings/demo-create-order.${n}`, 'utf8')

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

const newProject = async (name = 'P') => (await POST(`${BASE}/Projects`, { name })).data.ID
const withSources = async () => {
  const projectID = await newProject()
  await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
  return projectID
}
const importRec = (projectID, raw, extra = {}) =>
  POST(`${BASE}/importRecording`, { projectID, raw, ...extra })

describe('recordings', () => {
  let projectID
  beforeAll(async () => {
    projectID = await withSources()
  })

  it('needs the sources first', async () => {
    const empty = await newProject('Empty')
    expect(await fails(importRec(empty, fx('devtools.json')))).toMatchObject({ status: 409 })
  })

  it('imports a DevTools recording, auto-detecting the format and mapping it', async () => {
    const { data } = await importRec(projectID, fx('devtools.json'), { name: 'Create order' })
    expect(data).toMatchObject({
      format: 'devtools-recorder',
      steps: 7,
      actionable: 6,
      mapped: 6,
      unmapped: 0,
      skipped: 2,
    })
    const row = (await GET(`${BASE}/Recordings(${data.ID})`)).data
    expect(row).toMatchObject({ name: 'Create order', format: 'devtools-recorder' })
    expect(row).not.toHaveProperty('raw')
    expect(JSON.parse(row.summary)).toMatchObject({ mapped: 6 })
  })

  it('returns the recording mapped against the current inventory', async () => {
    const { data } = await importRec(projectID, fx('opa5.js'))
    const mapped = JSON.parse(
      (await GET(`${BASE}/getRecording(recordingID=${data.ID})`)).data.value,
    )
    expect(mapped.format).toBe('ui5-test-recorder')
    expect(mapped.steps.map((s) => s.ui5?.localId ?? null)).toEqual([
      'createBtn',
      'customerInput',
      'saveBtn',
      null,
    ])
  })

  it('accepts plain text and an explicit format', async () => {
    expect((await importRec(projectID, fx('txt'))).data.format).toBe('plain-text')
    expect((await importRec(projectID, fx('txt'), { format: 'plain-text' })).data.mapped).toBe(5)
  })

  it('rejects empty, oversized and mismatching recordings', async () => {
    expect(await fails(importRec(projectID, '   '))).toMatchObject({ status: 400 })
    expect(await fails(importRec(projectID, 'x'.repeat(2 * 1024 * 1024 + 1)))).toMatchObject({
      status: 400,
      message: expect.stringContaining('too large'),
    })
    expect(
      await fails(importRec(projectID, 'click Create', { format: 'devtools-recorder' })),
    ).toMatchObject({ status: 400, message: expect.stringContaining('DevTools') })
    expect(await fails(importRec(projectID, 'click Create', { format: 'nope' }))).toMatchObject({
      status: 400,
      message: expect.stringContaining('Unknown recording format'),
    })
  })
})

describe('generateTour', () => {
  let projectID
  let recordingID
  beforeAll(async () => {
    projectID = await withSources()
    recordingID = (await importRec(projectID, fx('devtools.json'))).data.ID
  })

  it('runs the rule generator as a job and stores the tour with its first version', async () => {
    const { data: job } = await POST(`${BASE}/generateTour`, {
      projectID,
      recordingID,
      title: 'Orders tour',
    })
    expect(job).toMatchObject({ provider: 'rules', status: 'queued' })

    const done = await waitFor(job.ID)
    expect(done).toMatchObject({ status: 'done', stage: 'done', error: null })
    expect(JSON.parse(done.report)).toMatchObject({
      generator: 'rules',
      steps: 7,
      lint: { errors: 0, warnings: 1 },
    })

    const tour = (await GET(`${BASE}/Tours(${done.tour_ID})`)).data
    expect(tour).toMatchObject({
      name: 'Orders tour',
      generator: 'rules',
      version: 1,
      recording_ID: recordingID,
    })
    const def = JSON.parse(tour.definition)
    expect(def.steps).toHaveLength(7)
    expect(def.steps[1].target.controlId).toBe('searchField')

    const versions = (await GET(`${BASE}/TourVersions?$filter=tour_ID eq ${tour.ID}`)).data.value
    expect(versions).toHaveLength(1)
    expect(versions[0]).not.toHaveProperty('definition')
  })

  it('lintTour reports the id-less control', async () => {
    const job = await waitFor(
      (await POST(`${BASE}/generateTour`, { projectID, recordingID })).data.ID,
    )
    const { data } = await GET(`${BASE}/lintTour(tourID=${job.tour_ID})`)
    expect(data).toMatchObject({ errors: 0, warnings: 1, infos: 0 })
    expect(data.issues[0]).toMatchObject({ code: 'target.noId', severity: 'warning', stepId: 's6' })
  })

  it('validates the request', async () => {
    const other = await withSources()
    const empty = await newProject('Empty')
    expect(
      (await fails(POST(`${BASE}/generateTour`, { projectID, recordingID, provider: 'nope' })))
        .status,
    ).toBe(400)
    expect(
      (await fails(POST(`${BASE}/generateTour`, { projectID: other, recordingID }))).status,
    ).toBe(404) // recording of another project
    expect(
      (await fails(POST(`${BASE}/generateTour`, { projectID: empty, recordingID }))).status,
    ).toBe(409)
  })

  it('refuses a provider that is not configured', async () => {
    registerProvider({
      id: 'offline',
      label: 'Offline',
      isConfigured: () => false,
      defaultModel: () => 'm',
      generate: async () => ({}),
    })
    expect(
      await fails(POST(`${BASE}/generateTour`, { projectID, recordingID, provider: 'offline' })),
    ).toMatchObject({ status: 400, message: expect.stringContaining('not configured') })
    const list = (await GET(`${BASE}/providers()`)).data.value
    expect(list.find((p) => p.id === 'offline')).toMatchObject({ configured: false, model: 'm' })
  })

  it('reports a failing provider on the job instead of hanging', async () => {
    registerProvider({
      id: 'boom',
      label: 'Boom',
      isConfigured: () => true,
      defaultModel: () => 'x',
      generate: async () => {
        throw new Error('kaput')
      },
    })
    const job = await waitFor(
      (await POST(`${BASE}/generateTour`, { projectID, recordingID, provider: 'boom' })).data.ID,
    )
    expect(job).toMatchObject({ status: 'failed', stage: 'generate', error: 'kaput', model: 'x' })
    expect(job.tour_ID).toBeNull()
  })

  it('fails the job at validation when a provider returns an invalid tour', async () => {
    registerProvider({
      id: 'sloppy',
      label: 'Sloppy',
      isConfigured: () => true,
      defaultModel: () => null,
      generate: async () => ({
        tour: { schemaVersion: 1, id: 'x', title: 'X', steps: [] },
        report: {},
      }),
    })
    const job = await waitFor(
      (await POST(`${BASE}/generateTour`, { projectID, recordingID, provider: 'sloppy' })).data.ID,
    )
    expect(job).toMatchObject({ status: 'failed', stage: 'validate' })
    expect(job.error).toContain('invalid')
  })
})
