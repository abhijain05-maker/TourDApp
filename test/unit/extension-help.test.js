import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { validateHelp } from '../../shared/help-schema.mjs'

// the extension's pure helpers for help topics (extension/shared.js is a plain script, run it like the panel does)
const context = vm.createContext({})
vm.runInContext(readFileSync('extension/shared.js', 'utf8'), context)
const T = context.TourdExt
const plain = (x) => JSON.parse(JSON.stringify(x))

const picked = {
  id: '__xmlview0--createBtn',
  localId: 'createBtn',
  viewName: 'my.app.view.Main',
  controlType: 'sap.m.Button',
  text: 'Create Space',
  stableId: true,
}

describe('help target of a picked control', () => {
  it('uses the view and the local id, the global id and the text as fallbacks', () => {
    expect(plain(T.helpTarget(picked))).toEqual({
      viewName: 'my.app.view.Main',
      controlId: 'createBtn',
      fallbacks: [
        { by: 'id', value: '__xmlview0--createBtn' },
        { by: 'text', value: 'Create Space' },
      ],
    })
  })

  it('works for a control outside a view, and for one that has only text', () => {
    expect(plain(T.helpTarget({ id: 'shell-btn' }))).toEqual({
      controlId: 'shell-btn',
      fallbacks: [],
    })
    expect(plain(T.helpTarget({ text: 'Save' }))).toEqual({
      fallbacks: [{ by: 'text', value: 'Save' }],
    })
    expect(plain(T.helpTarget({}))).toEqual({ fallbacks: [] })
  })
})

describe('links', () => {
  it('reads one link per line and ignores what is not one', () => {
    expect(
      plain(
        T.parseLinks(
          'Create Spaces | https://help.sap.com/a\nhttps://example.com/b\nnot a link\nbad | javascript:alert(1)\n',
        ),
      ),
    ).toEqual([
      { label: 'Create Spaces', url: 'https://help.sap.com/a' },
      { label: 'https://example.com/b', url: 'https://example.com/b' },
    ])
  })

  it('writes them back the way they are read', () => {
    const links = [{ label: 'Docs', url: 'https://help.sap.com/a' }]
    expect(plain(T.parseLinks(T.formatLinks(links)))).toEqual(links)
  })
})

describe('the topic of the form', () => {
  const form = {
    title: ' Create Space ',
    summary: '',
    text: 'Text',
    note: '',
    links: '',
    screen: 'Spaces',
    hash: '/spaces',
  }

  it('makes a valid topic for the server from a picked control', () => {
    const topic = plain(T.draftTopic(form, picked, { id: 't-1' }))
    expect(topic).toMatchObject({ id: 't-1', title: 'Create Space', text: 'Text' })
    expect(topic.meta).toEqual({
      source: 'extension',
      controlType: 'sap.m.Button',
      screen: 'Spaces',
      hash: '/spaces',
    })
    const r = validateHelp({ schemaVersion: 1, id: 'h', title: 'Help', topics: [topic] })
    expect(r.ok, JSON.stringify(r.issues)).toBe(true)
  })

  it('keeps the saved target when only the text of a saved topic is edited', () => {
    const existing = {
      id: 't-2',
      target: { controlId: 'x', fallbacks: [] },
      meta: { source: 'extension', screen: 'Old' },
    }
    const topic = plain(T.draftTopic({ ...form, title: 'New title' }, null, existing))
    expect(topic.target).toEqual(existing.target)
    expect(topic.meta.screen).toBe('Old')
  })

  it('shows the draft next to the saved topics, replacing one with the same id', () => {
    const saved = {
      schemaVersion: 1,
      id: 'h',
      title: 'Help',
      options: {},
      topics: [{ id: 'a', title: 'A', target: {} }],
    }
    const draft = { id: 'b', title: 'B', target: { controlId: 'b' } }
    expect(T.withDraft(saved, draft).topics.map((t) => t.id)).toEqual(['a', 'b'])
    expect(
      T.withDraft(saved, { ...draft, id: 'a', title: 'A2' }).topics.map((t) => t.title),
    ).toEqual(['A2'])
    // no title for a moment (the author is retyping it): the control keeps its highlight, with a stand-in title
    expect(T.withDraft(saved, { ...draft, title: '' }).topics.map((t) => t.title)).toEqual([
      'A',
      'New topic',
    ])
    expect(T.withDraft(saved, { id: 'c', title: 'C' }).topics).toHaveLength(1) // no control yet: nothing to show
    expect(T.withDraft(null, draft).topics).toHaveLength(1)
  })
})
