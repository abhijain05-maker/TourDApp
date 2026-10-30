// .properties parsing and i18n text resolution.

const ESCAPES = { n: '\n', t: '\t', r: '\r', f: '\f' }

function unescapeProperty(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) =>
    c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : (ESCAPES[c] ?? c),
  )
}

/** Parse the content of a Java-style .properties file into a plain object. */
export function parseProperties(text) {
  const out = {}
  const lines = String(text)
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\s+/, '')
    if (!line || line[0] === '#' || line[0] === '!') continue
    // a line ending in an odd number of backslashes continues on the next line
    while (/(?:^|[^\\])(?:\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i].replace(/^\s+/, '')
    }
    const m = /^((?:\\.|[^=:\s\\])*)(?:\s*[=:]\s*|\s+)?(.*)$/.exec(line)
    if (!m || !m[1]) continue
    out[unescapeProperty(m[1])] = unescapeProperty(m[2])
  }
  return out
}

const I18N_BINDING = /^\{(?:@?i18n|[\w.-]+)>([^}]+)\}$/
const MANIFEST_BINDING = /^\{\{([^}]+)\}\}$/

/**
 * Returns a function that turns a raw XML/manifest attribute value into display text:
 * "{i18n>key}" and "{{key}}" are looked up, plain text is returned as is, anything dynamic
 * (data bindings, expressions) yields null.
 */
export function createTextResolver(texts = {}) {
  return function resolveText(raw) {
    if (typeof raw !== 'string') return null
    const value = raw.trim()
    if (!value) return null
    const m = I18N_BINDING.exec(value) || MANIFEST_BINDING.exec(value)
    if (m) return texts[m[1]] ?? null
    if (value.includes('{')) return null
    return value
  }
}
