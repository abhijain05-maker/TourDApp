// The Markdown subset tour texts use (same as the player): **bold**, *italic*, `code`, [text](https://link),
// "- " bullet lists and paragraphs. Parsed into plain data and rendered as React elements, so no HTML is ever injected.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export type Block = { type: 'p'; lines: Inline[][] } | { type: 'ul'; items: Inline[][] }

const TOKEN = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g

export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const m of source.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push({ type: 'text', text: source.slice(last, at) })
    if (m[1] !== undefined) out.push({ type: 'strong', text: m[1] })
    else if (m[2] !== undefined) out.push({ type: 'em', text: m[2] })
    else if (m[3] !== undefined) out.push({ type: 'code', text: m[3] })
    else out.push({ type: 'link', text: m[4], href: m[5] })
    last = at + m[0].length
  }
  if (last < source.length) out.push({ type: 'text', text: source.slice(last) })
  return out
}

const BULLET = /^\s*[-*]\s+/

export function parseMarkdown(markdown: string): Block[] {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .filter((b) => b.trim())
    .map((block): Block => {
      const lines = block.split('\n')
      if (lines.every((l) => BULLET.test(l))) {
        return { type: 'ul', items: lines.map((l) => parseInline(l.replace(BULLET, ''))) }
      }
      return { type: 'p', lines: lines.map(parseInline) }
    })
}
