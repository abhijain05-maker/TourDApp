import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { validateTour } from '../../shared/tour-schema.mjs'

describe('demo app sample tour', () => {
  it('satisfies the tour schema without warnings', () => {
    const raw = JSON.parse(
      readFileSync(
        new URL('../../samples/demo-app/webapp/tourd/tour.json', import.meta.url),
        'utf8',
      ),
    )
    const r = validateTour(raw)
    expect(r.issues).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.tour.steps).toHaveLength(7)
  })
})
