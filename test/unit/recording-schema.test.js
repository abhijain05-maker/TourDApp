import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  looksLikeRecording,
  toRecordingJsonSchema,
  validateRecording,
} from '../../shared/recording-schema.mjs'

const fixture = () =>
  JSON.parse(readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8'))
const errorsOf = (r) => r.issues.map((i) => `${i.path}: ${i.message}`)

describe('tourd-recording schema', () => {
  it('accepts a real recording made by the recorder in the demo app', () => {
    const r = validateRecording(fixture())
    expect(errorsOf(r)).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.recording.steps).toHaveLength(7)
  })

  it('knows its own format from the outside', () => {
    expect(looksLikeRecording(fixture())).toBe(true)
    expect(looksLikeRecording({ steps: [] })).toBe(false)
    expect(looksLikeRecording(null)).toBe(false)
    expect(looksLikeRecording('tourd-recording')).toBe(false)
  })

  it('rejects another format or version', () => {
    expect(validateRecording({ ...fixture(), format: 'something' }).ok).toBe(false)
    expect(validateRecording({ ...fixture(), version: 2 }).ok).toBe(false)
    expect(validateRecording(null).ok).toBe(false)
  })

  it('is strict: unknown fields are errors, so typos do not slip into generated code', () => {
    const rec = fixture()
    rec.steps[1].control.stabelId = true
    const r = validateRecording(rec)
    expect(r.ok).toBe(false)
    expect(errorsOf(r).join('\n')).toContain('steps[1].control')
  })

  it('wants the steps numbered 0, 1, 2, ...', () => {
    const rec = fixture()
    rec.steps[2].index = 7
    expect(errorsOf(validateRecording(rec)).join('\n')).toContain('steps[2].index')
  })

  it('wants a control for the steps that act on one, a hash for navigations, a text for notes', () => {
    const rec = fixture()
    delete rec.steps[1].control
    delete rec.steps[2].hash
    rec.steps.push({ index: 7, t: 1, type: 'note' })
    const issues = errorsOf(validateRecording(rec)).join('\n')
    expect(issues).toContain('steps[1].control')
    expect(issues).toContain('steps[2].hash')
    expect(issues).toContain('steps[7].note')
  })

  it('does not accept a step type it does not know', () => {
    const rec = fixture()
    rec.steps[1].type = 'rightClick'
    expect(validateRecording(rec).ok).toBe(false)
  })

  it('has a JSON schema for tools', () => {
    const schema = toRecordingJsonSchema()
    expect(schema.properties.format.const).toBe('tourd-recording')
    expect(schema.properties.steps.type).toBe('array')
  })
})
