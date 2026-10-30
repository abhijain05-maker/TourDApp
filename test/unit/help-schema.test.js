import { describe, it, expect } from 'vitest'
import {
  createEmptyHelp,
  removeTopic,
  toHelpJsonSchema,
  upsertTopic,
  validateHelp,
} from '../../shared/help-schema.mjs'
import { helpAsPredefine, playerAsPredefine } from '../../shared/live-snippet.mjs'

const topic = (over = {}) => ({
  id: 't1',
  title: 'Create Space',
  text: 'Create a space in your organization.',
  target: { viewName: 'my.app.view.Main', controlId: 'createBtn' },
  ...over,
})
const help = (topics = [topic()]) => ({
  schemaVersion: 1,
  id: 'h1',
  title: 'Help',
  topics,
})

describe('help contract', () => {
  it('accepts a topic bound to a control and fills in the defaults', () => {
    const r = validateHelp(help())
    expect(r.ok).toBe(true)
    expect(r.help.options).toEqual({
      panelTitle: 'Help Topics',
      showBadges: true,
      buttonPosition: 'top',
    })
    expect(r.help.topics[0]).toMatchObject({ summary: '', note: '', links: [] })
    expect(r.help.topics[0].target.fallbacks).toEqual([])
  })

  it('needs a target with a control id or a fallback, like a tour step', () => {
    expect(validateHelp(help([topic({ target: {} })])).ok).toBe(false)
    expect(validateHelp(help([topic({ target: undefined })])).ok).toBe(false)
    expect(
      validateHelp(
        help([topic({ target: { fallbacks: [{ by: 'text', value: 'Create Space' }] } })]),
      ).ok,
    ).toBe(true)
  })

  it('refuses links that are not http(s), unknown keys and duplicate ids', () => {
    const bad = (t) => validateHelp(help([topic(t)])).ok
    expect(bad({ links: [{ label: 'x', url: 'javascript:alert(1)' }] })).toBe(false)
    expect(bad({ links: [{ label: 'x', url: 'https://help.sap.com/x' }] })).toBe(true)
    expect(bad({ surprise: true })).toBe(false)
    expect(validateHelp(help([topic(), topic()])).issues[0].message).toMatch(/Duplicate topic id/)
  })

  it('warns about generated ids and empty topics, but stays valid', () => {
    const r = validateHelp(
      help([topic({ text: '', target: { viewName: 'v', controlId: '__button3' } })]),
    )
    expect(r.ok).toBe(true)
    expect(r.issues.map((i) => i.code).sort()).toEqual(['target.unstableId', 'topic.empty'])
  })

  it('adds, replaces and removes topics without touching the rest', () => {
    const base = createEmptyHelp({ id: 'h', title: 'Help' })
    const one = upsertTopic(base, topic())
    const two = upsertTopic(one, topic({ id: 't2', title: 'Other' }))
    expect(two.topics.map((t) => t.id)).toEqual(['t1', 't2'])
    const renamed = upsertTopic(two, topic({ title: 'Renamed' }))
    expect(renamed.topics.map((t) => t.title)).toEqual(['Renamed', 'Other'])
    expect(removeTopic(renamed, 't1').topics.map((t) => t.id)).toEqual(['t2'])
  })

  it('writes a JSON schema', () => {
    expect(toHelpJsonSchema().properties.topics).toBeTruthy()
  })
})

describe('help layer as a predefined module', () => {
  it('is registered under its own name, the player under its own', () => {
    expect(helpAsPredefine('/*x*/ sap.ui.define([], function () {})')).toContain(
      'sap.ui.predefine("tourd/live/HelpLayer", ',
    )
    expect(playerAsPredefine('sap.ui.define([], function () {})')).toContain(
      'sap.ui.predefine("tourd/live/TourPlayer", ',
    )
    expect(() => helpAsPredefine('nothing')).toThrow(/HelpLayer.js/)
  })
})
