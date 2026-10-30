import cds from '@sap/cds'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { validateRecording } from '../../shared/recording-schema.mjs'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { generateTourFromRules } from '../../srv/lib/llm/rules.js'
import { buildPrompt } from '../../srv/lib/llm/prompt.js'
import { buildPlan } from '../../srv/lib/wdi5/plan.js'
import { demoSources } from '../helpers/sources.js'

// What a recording is for (tour, tests or both) and the words an author writes under a step.

const { GET, POST } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const fails = (p) =>
  p.then(
    (r) => ({ status: r.status, message: 'unexpected success' }),
    (e) => ({ status: e.response?.status, message: e.response?.data?.error?.message ?? e.message }),
  )

const raw = readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')
const fixture = () => JSON.parse(raw)
const inventory = buildInventory(demoSources())
const plain = (x) => JSON.parse(JSON.stringify(x))

const mapped = (rec) => mapRecording(parseRecording(rec), inventory)
const tourOf = (rec) => generateTourFromRules({ recording: mapped(rec), inventory }).tour

describe('recording format: purpose and explain', () => {
  it('accepts a purpose and the words under a step', () => {
    const rec = fixture()
    rec.purpose = 'tour'
    rec.steps[2].explain = 'Starts a new order.'
    expect(validateRecording(rec).ok).toBe(true)
  })

  it('refuses an unknown purpose and a very long text', () => {
    const rec = fixture()
    rec.purpose = 'demo'
    expect(validateRecording(rec).ok).toBe(false)
    const long = fixture()
    long.steps[2].explain = 'x'.repeat(601)
    expect(validateRecording(long).ok).toBe(false)
  })

  it('still accepts a recording that does not say what it is for', () => {
    expect(validateRecording(fixture()).ok).toBe(true)
  })
})

describe('the words of the author in a tour', () => {
  it('become the text of the step, the title stays what the control is', () => {
    const rec = fixture()
    const at = rec.steps.findIndex((s) => s.control?.localId === 'createBtn')
    rec.steps[at].explain = 'Starts a new order: the first thing to do here.'
    const tour = tourOf(rec)
    const step = tour.steps.find((s) => s.target?.controlId === 'createBtn')
    expect(step.text).toBe('Starts a new order: the first thing to do here.')
    expect(step.title).toBeTruthy()
    // the steps without words keep the text that is made from the control
    const other = tour.steps.find((s) => s.target?.controlId === 'saveBtn')
    expect(other.text).not.toBe(step.text)
  })

  it('survive when a click and the entry into the same field are merged into one step', () => {
    const rec = fixture()
    const at = rec.steps.findIndex((s) => s.control?.localId === 'customerInput')
    rec.steps.splice(at, 0, { ...rec.steps[at], type: 'press', explain: 'Who orders?' })
    rec.steps.forEach((s, i) => (s.index = i))
    const tour = tourOf(rec)
    expect(tour.steps.find((s) => s.target?.controlId === 'customerInput').text).toBe('Who orders?')
  })

  it('go to the AI as "author\'s words", with the rule to keep their meaning', () => {
    const rec = fixture()
    const at = rec.steps.findIndex((s) => s.control?.localId === 'createBtn')
    rec.steps[at].explain = 'Starts a new order.'
    const p = buildPrompt({ inventory, recording: mapped(rec), sources: [] })
    expect(JSON.stringify(p)).toContain('author\'s words: \\"Starts a new order.\\"')
    expect(p.system).toContain('Keep their meaning')
  })
})

describe('notes typed while recording', () => {
  const withNote = (position, note) => {
    const rec = fixture()
    rec.steps.splice(position, 0, { index: 0, t: 1, type: 'note', note })
    rec.steps.forEach((s, i) => (s.index = i))
    return rec
  }

  it('are steps of the tour without a control, in the place where they were typed', () => {
    const tour = tourOf(withNote(2, 'Orders are saved as drafts first.'))
    const note = tour.steps.find((s) => s.text === 'Orders are saved as drafts first.')
    expect(note).toBeTruthy()
    expect(note.target).toBeUndefined()
    const at = tour.steps.indexOf(note)
    expect(tour.steps[at - 1].target).toBeTruthy() // after a step with a control
  })

  it('open the tour themselves: no second, generated welcome', () => {
    const tour = tourOf(withNote(0, 'Welcome to the orders'))
    expect(tour.steps[0].text).toBe('Welcome to the orders')
    expect(tour.steps.filter((s) => s.id === 'intro')).toHaveLength(0)
  })

  it('and the words under a step change nothing in the wdi5 plan', () => {
    const plain = buildPlan({ mapped: mapped(fixture()), inventory, name: 'x' })
    const rec = withNote(fixture().steps.length, 'Orders are saved as drafts first.') // (at the end: nothing shifts)
    rec.steps.forEach((s) => s.control && (s.explain = 'Words for the tour.'))
    const withWords = buildPlan({ mapped: mapped(rec), inventory, name: 'x' })
    expect(withWords.steps.map((s) => [s.action, s.locator, s.value])).toEqual(
      plain.steps.map((s) => [s.action, s.locator, s.value]),
    )
  })
})

describe('extension: purpose and explain', () => {
  const context = vm.createContext({})
  vm.runInContext(readFileSync('extension/shared.js', 'utf8'), context)
  const T = context.TourdExt
  const step = (type, extra = {}) => ({ type, ...extra })

  it('puts the purpose into the recording and the state of the panel', () => {
    const s = T.idleState()
    s.purpose = 'tour'
    expect(plain(T.buildRecording(s)).purpose).toBe('tour')
    expect(plain(T.publicState(s)).purpose).toBe('tour')
    s.purpose = 'whatever'
    expect(plain(T.buildRecording(s)).purpose).toBe('both')
  })

  it('keeps the words of a step, trims them, and takes them away when emptied', () => {
    const s = T.idleState()
    s.steps = [step('press'), step('navigate'), step('check')]
    expect(T.setExplain(s, 0, '  Starts   a new order  ')).toBe(true)
    expect(s.steps[0].explain).toBe('Starts a new order')
    expect(T.setExplain(s, 0, '   ')).toBe(true)
    expect(s.steps[0].explain).toBeUndefined()
    // only a step that is shown in a tour can say what it is for
    expect(T.setExplain(s, 1, 'x')).toBe(false)
    expect(T.setExplain(s, 2, 'x')).toBe(false)
    expect(T.setExplain(s, 9, 'x')).toBe(false)
  })
})

describe('service: what a recording is for', () => {
  const projectWithSources = async () => {
    const projectID = (await POST(`${BASE}/Projects`, { name: `Purpose ${Math.random()}` })).data.ID
    await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
    return projectID
  }

  it('is asked at the import, written in the file, or both when nobody says', async () => {
    const projectID = await projectWithSources()
    const asked = (await POST(`${BASE}/importRecording`, { projectID, raw, purpose: 'test' })).data
    expect(asked.purpose).toBe('test')

    const inFile = { ...fixture(), purpose: 'tour' }
    const written = (
      await POST(`${BASE}/importRecording`, { projectID, raw: JSON.stringify(inFile) })
    ).data
    expect(written.purpose).toBe('tour')

    // what was asked wins over what the file says
    const both = (
      await POST(`${BASE}/importRecording`, {
        projectID,
        raw: JSON.stringify(inFile),
        purpose: 'test',
      })
    ).data
    expect(both.purpose).toBe('test')

    const none = (await POST(`${BASE}/importRecording`, { projectID, raw })).data
    expect(none.purpose).toBe('both')
  })

  it('refuses a purpose that does not exist', async () => {
    const projectID = await projectWithSources()
    const r = await fails(POST(`${BASE}/importRecording`, { projectID, raw, purpose: 'demo' }))
    expect(r.status).toBe(400)
    expect(r.message).toMatch(/purpose must be one of/)
  })

  it('can be changed afterwards, and only to a known purpose', async () => {
    const projectID = await projectWithSources()
    const rec = (await POST(`${BASE}/importRecording`, { projectID, raw })).data
    const changed = (
      await POST(`${BASE}/setRecordingPurpose`, { recordingID: rec.ID, purpose: 'tour' })
    ).data
    expect(changed).toMatchObject({ ID: rec.ID, purpose: 'tour' })
    const bad = await fails(
      POST(`${BASE}/setRecordingPurpose`, { recordingID: rec.ID, purpose: 'x' }),
    )
    expect(bad.status).toBe(400)
    const missing = await fails(
      POST(`${BASE}/setRecordingPurpose`, {
        recordingID: '00000000-0000-4000-8000-000000000000',
        purpose: 'tour',
      }),
    )
    expect(missing.status).toBe(404)
  })
})

describe('service: try a recording before it is sent', () => {
  const setup = async () => {
    const projectID = (await POST(`${BASE}/Projects`, { name: `Preview ${Math.random()}` })).data.ID
    await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
    return projectID
  }
  const preview = (projectID, kind, rec = raw) =>
    POST(`${BASE}/previewRecording`, { projectID, raw: rec, kind })

  it('builds the test plan the real import would, and saves nothing', async () => {
    const projectID = await setup()
    const r = (await preview(projectID, 'test')).data
    expect(r).toMatchObject({ kind: 'test', actionable: 5, mapped: 5, unmapped: 0 })
    const plan = JSON.parse(r.definition)
    expect(plan.steps.some((s) => s.kind === 'press')).toBe(true)
    // nothing was saved
    expect(
      (await GET(`${BASE}/Recordings?$filter=project_ID eq ${projectID}`)).data.value,
    ).toHaveLength(0)
    // the same recording, imported and made into a plan, gives the same steps
    const rec = (await POST(`${BASE}/importRecording`, { projectID, raw })).data
    const real = JSON.parse(
      (await POST(`${BASE}/createTestPlan`, { projectID, recordingID: rec.ID, name: 'Preview' }))
        .data.definition,
    )
    expect(plan.steps.map((s) => [s.kind, s.locator])).toEqual(
      real.steps.map((s) => [s.kind, s.locator]),
    )
  })

  it('builds the tour with the words of the author', async () => {
    const projectID = await setup()
    const rec = fixture()
    const at = rec.steps.findIndex((s) => s.control?.localId === 'createBtn')
    rec.steps[at].explain = 'Starts a new order.'
    const r = (await preview(projectID, 'tour', JSON.stringify(rec))).data
    const tour = JSON.parse(r.definition)
    expect(tour.steps.map((s) => s.text)).toContain('Starts a new order.')
  })

  it('says what is wrong instead of failing: no kind, empty, not a recording, no app files', async () => {
    const projectID = await setup()
    expect((await fails(preview(projectID, 'demo'))).status).toBe(400)
    expect((await fails(preview(projectID, 'test', ' '))).status).toBe(400)
    expect(
      (
        await fails(
          preview(projectID, 'test', JSON.stringify({ format: 'tourd-recording', version: 1 })),
        )
      ).status,
    ).toBe(400)
    const empty = (await POST(`${BASE}/Projects`, { name: `No files ${Math.random()}` })).data.ID
    expect((await fails(preview(empty, 'test'))).status).toBe(409)
  })
})
