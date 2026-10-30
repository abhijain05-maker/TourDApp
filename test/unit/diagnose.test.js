import { describe, it, expect } from 'vitest'
import { diagnose } from '../../designer/src/editor/diagnose.ts'

const tour = (patch = (t) => t) =>
  JSON.stringify(
    patch({
      schemaVersion: 1,
      id: 't',
      title: 'T',
      steps: [
        { id: 's1', title: 'One' },
        { id: 's2', title: 'Two', placement: 'Top' },
      ],
    }),
    null,
    2,
  )
const covered = (text, d) => text.slice(d.from, d.to)

describe('diagnose (JSON editor markers)', () => {
  it('reports nothing for a valid tour', () => {
    expect(diagnose(tour())).toEqual([])
  })

  it('marks JSON syntax errors at their position', () => {
    const text = '{\n  "schemaVersion": 1,\n  "id": "t" "title": "T"\n}'
    const [d] = diagnose(text)
    expect(d.severity).toBe('error')
    expect(d.from).toBeGreaterThan(text.indexOf('"id"'))
    expect(d.message).toMatch(/comma|expected/i)
  })

  it('highlights the exact value that violates the schema', () => {
    const text = tour((t) => ((t.steps[1].placement = 'Sideways'), t))
    const ds = diagnose(text)
    expect(ds).toHaveLength(1)
    expect(covered(text, ds[0])).toBe('"Sideways"')
    expect(ds[0].message).toContain('steps[1].placement')
  })

  it('highlights the duplicate id', () => {
    const text = tour((t) => ((t.steps[1].id = 's1'), t))
    const ds = diagnose(text)
    expect(ds).toHaveLength(1)
    expect(covered(text, ds[0])).toBe('"s1"')
    expect(text.indexOf('"s1"', ds[0].from)).toBe(ds[0].from)
    expect(ds[0].from).toBeGreaterThan(text.indexOf('"s2"') - 40) // the second occurrence, not the first
  })

  it('falls back to the closest existing parent for a missing property', () => {
    const text = tour((t) => (delete t.steps[0].title, t))
    const ds = diagnose(text)
    expect(ds).toHaveLength(1)
    expect(covered(text, ds[0])).toContain('"id": "s1"') // the whole step object
    expect(ds[0].message).toContain('steps[0].title')
  })

  it('flags unknown keys (typos) on the object that has them', () => {
    const text = tour((t) => ((t.steps[0].placment = 'Top'), t))
    const ds = diagnose(text)
    expect(ds.length).toBeGreaterThan(0)
    expect(ds[0].message).toContain('steps[0]')
  })

  it('handles an empty document', () => {
    expect(diagnose('').length).toBeGreaterThan(0)
  })
})
