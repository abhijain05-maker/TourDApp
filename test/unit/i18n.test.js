import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseProperties, createTextResolver } from '../../srv/lib/parsers/i18n.js'

describe('parseProperties', () => {
  it('parses = : and whitespace separators, comments and blank lines', () => {
    const p = parseProperties('# c\n! c2\n\na=1\nb: 2\nc 3\nd =  spaced  \nempty=\nnovalue')
    expect(p).toEqual({ a: '1', b: '2', c: '3', d: 'spaced  ', empty: '', novalue: '' })
  })

  it('handles escapes, unicode and line continuations', () => {
    const p = parseProperties('a=line1\\nline2\nb=caf\\u00e9\nc=one \\\n   two\nd=back\\\\slash')
    expect(p.a).toBe('line1\nline2')
    expect(p.b).toBe('café')
    expect(p.c).toBe('one two')
    expect(p.d).toBe('back\\slash')
  })

  it('parses the demo app bundle', () => {
    const p = parseProperties(readFileSync('samples/demo-app/webapp/i18n/i18n.properties', 'utf8'))
    expect(p.create).toBe('Create')
    expect(p.confirmText).toBe('Do you really want to delete this order?')
  })
})

describe('createTextResolver', () => {
  const t = createTextResolver({ create: 'Create', appTitle: 'Demo Orders' })

  it('resolves i18n bindings in both syntaxes', () => {
    expect(t('{i18n>create}')).toBe('Create')
    expect(t('{{appTitle}}')).toBe('Demo Orders')
  })

  it('returns null for unknown keys, data bindings and expressions', () => {
    expect(t('{i18n>missing}')).toBeNull()
    expect(t('{customer}')).toBeNull()
    expect(t('{= ${status} === "Open" }')).toBeNull()
    expect(t('Order {id}')).toBeNull()
    expect(t(undefined)).toBeNull()
  })

  it('passes plain text through', () => {
    expect(t(' Hello ')).toBe('Hello')
  })
})
