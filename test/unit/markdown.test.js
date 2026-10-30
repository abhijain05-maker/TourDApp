import { describe, it, expect } from 'vitest'
import { parseInline, parseMarkdown } from '../../designer/src/markdown.ts'

describe('parseInline', () => {
  it('reads bold, italic, code and links', () => {
    expect(
      parseInline('Press **Save**, *then* `Enter` or [docs](https://example.com/a?b=1).'),
    ).toEqual([
      { type: 'text', text: 'Press ' },
      { type: 'strong', text: 'Save' },
      { type: 'text', text: ', ' },
      { type: 'em', text: 'then' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'Enter' },
      { type: 'text', text: ' or ' },
      { type: 'link', text: 'docs', href: 'https://example.com/a?b=1' },
      { type: 'text', text: '.' },
    ])
  })

  it('leaves plain text, lone asterisks and unsafe links as text', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }])
    const unsafe = parseInline('[x](javascript:alert(1)) <b>y</b>')
    expect(unsafe.every((n) => n.type === 'text')).toBe(true)
    expect(unsafe.map((n) => n.text).join('')).toBe('[x](javascript:alert(1)) <b>y</b>')
  })
})

describe('parseMarkdown', () => {
  it('splits paragraphs and keeps line breaks inside them', () => {
    const blocks = parseMarkdown('One\ntwo\n\nThree')
    expect(blocks.map((b) => b.type)).toEqual(['p', 'p'])
    expect(blocks[0].lines).toHaveLength(2)
  })

  it('recognises bullet lists with - and *', () => {
    const [list] = parseMarkdown('- Required\n* Free **text**')
    expect(list.type).toBe('ul')
    expect(list.items).toHaveLength(2)
    expect(list.items[1][1]).toEqual({ type: 'strong', text: 'text' })
  })

  it('handles empty input and windows line endings', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('a\r\n\r\nb')).toHaveLength(2)
  })
})
