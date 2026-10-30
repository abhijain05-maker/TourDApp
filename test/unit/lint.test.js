import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { lintTour } from '../../srv/lib/validate/lint.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const MAIN = 'demo.orders.view.Main'
const DETAIL = 'demo.orders.view.Detail'

const tourOf = (...steps) => ({
  schemaVersion: 1,
  id: 't',
  title: 'T',
  steps: steps.map((s, i) => ({ id: `s${i + 1}`, title: 'Title', text: 'Some text', ...s })),
})
const codes = (tour, opts) => lintTour(tour, inventory, opts).issues.map((i) => i.code)
const tgt = (viewName, controlId, extra = {}) => ({ target: { viewName, controlId, ...extra } })

describe('lintTour', () => {
  it('accepts a correct tour', () => {
    const t = tourOf(tgt(MAIN, 'createBtn'), {
      ...tgt(DETAIL, 'saveBtn'),
      before: [{ type: 'navigate', hash: 'order/new' }],
    })
    expect(lintTour(t, inventory)).toEqual({
      issues: [],
      summary: { errors: 0, warnings: 0, infos: 0 },
    })
  })

  it('returns only schema errors for an invalid document', () => {
    const r = lintTour({ schemaVersion: 1, id: 't', title: 'T', steps: [{ id: 's1' }] }, inventory)
    expect(r.summary.errors).toBeGreaterThan(0)
    expect(r.issues.every((i) => i.severity === 'error')).toBe(true)
  })

  it('reports a control that does not exist', () => {
    const r = lintTour(tourOf(tgt(MAIN, 'ghost')), inventory)
    expect(r.issues[0]).toMatchObject({
      code: 'target.notFound',
      severity: 'error',
      stepId: 's1',
      path: 'steps[0].target',
    })
  })

  it('reports a control that exists in another view', () => {
    const r = lintTour(tourOf(tgt(MAIN, 'saveBtn')), inventory)
    expect(r.issues[0]).toMatchObject({ code: 'target.wrongView', severity: 'error' })
    expect(r.issues[0].message).toContain(DETAIL)
  })

  it('downgrades an unknown id to a warning when a text fallback matches', () => {
    const t = tourOf(tgt(MAIN, 'oldBtn', { fallbacks: [{ by: 'text', value: 'Create' }] }))
    expect(codes(t)).toEqual(['target.idNotFound'])
  })

  it('flags id-less targets and unmatched text fallbacks', () => {
    expect(
      codes(tourOf({ target: { viewName: MAIN, fallbacks: [{ by: 'text', value: 'Export' }] } })),
    ).toEqual(['target.noId'])
    expect(
      codes(tourOf({ target: { viewName: MAIN, fallbacks: [{ by: 'text', value: 'Nope' }] } })),
    ).toEqual(['target.notFound'])
  })

  it('warns when a step needs a navigate action to show its view', () => {
    const r = lintTour(tourOf(tgt(DETAIL, 'saveBtn')), inventory)
    expect(r.issues[0]).toMatchObject({ code: 'step.wrongRoute', severity: 'warning' })
  })

  it('carries the route over to later steps like the player does', () => {
    const t = tourOf(
      { ...tgt(DETAIL, 'saveBtn'), before: [{ type: 'navigate', hash: '#/order/7' }] },
      tgt(DETAIL, 'deleteBtn'),
      tgt(MAIN, 'createBtn'),
    )
    expect(codes(t)).toEqual(['step.wrongRoute']) // only the last step: back on Detail's route while targeting Main
  })

  it('knows the start route', () => {
    expect(codes(tourOf(tgt(DETAIL, 'saveBtn')), { startHash: 'order/1' })).toEqual([])
  })

  it('warns about navigation to a route that is not in the manifest', () => {
    const t = tourOf({
      ...tgt(MAIN, 'createBtn'),
      before: [{ type: 'navigate', hash: 'nowhere/x/y' }],
    })
    expect(codes(t)).toContain('navigate.unknownRoute')
  })

  it('warns about duplicate targets and wrong order against the recording', () => {
    expect(codes(tourOf(tgt(MAIN, 'createBtn'), tgt(MAIN, 'createBtn')))).toEqual([
      'step.duplicateTarget',
    ])
    const recording = {
      steps: [
        { ui5: { viewName: MAIN, localId: 'searchField' } },
        { ui5: { viewName: MAIN, localId: 'createBtn' } },
      ],
    }
    expect(codes(tourOf(tgt(MAIN, 'createBtn'), tgt(MAIN, 'searchField')), { recording })).toEqual([
      'step.order',
    ])
    expect(codes(tourOf(tgt(MAIN, 'searchField'), tgt(MAIN, 'createBtn')), { recording })).toEqual(
      [],
    )
  })

  it('checks text length, empty text and i18n keys', () => {
    const t = tourOf(
      { title: 'x'.repeat(61), text: 'y'.repeat(301), ...tgt(MAIN, 'createBtn') },
      { title: '{i18n>create}', text: '{i18n>doesNotExist}', ...tgt(MAIN, 'searchField') },
      { text: '', ...tgt(MAIN, 'ordersTable') },
    )
    expect(codes(t).sort()).toEqual(['i18n.missingKey', 'text.empty', 'text.long', 'title.long'])
  })

  it('flags auto ids, unresolved steps (from the schema) and very long tours', () => {
    const t = tourOf(
      ...Array.from({ length: 16 }, (_, i) => ({
        ...tgt(MAIN, i === 0 ? '__button3' : 'createBtn'),
        meta: i === 0 ? { unresolved: true } : undefined,
      })),
    )
    const c = codes(t)
    expect(c).toContain('target.unstableId')
    expect(c).toContain('step.unresolved')
    expect(c).toContain('tour.long')
  })

  it('sorts errors before warnings before infos', () => {
    const t = tourOf(
      { text: '', ...tgt(MAIN, 'createBtn') },
      tgt(MAIN, 'ghost'),
      tgt(DETAIL, 'saveBtn'),
    )
    const sev = lintTour(t, inventory).issues.map((i) => i.severity)
    expect(sev).toEqual(
      [...sev].sort(
        (a, b) => ({ error: 0, warning: 1, info: 2 })[a] - { error: 0, warning: 1, info: 2 }[b],
      ),
    )
    expect(lintTour(t, inventory).summary).toEqual({ errors: 1, warnings: 1, infos: 1 })
  })
})
