// Invents believable sample data from the data bindings in the views, so the sandbox shows filled
// lists and fields instead of an empty shell. Only the shape matters for a tour preview.
import { parseXmlView } from '../parsers/xml-view.js'

const COMPANIES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella Ltd', 'Hooli']
const STATUSES = ['Open', 'In process', 'Shipped', 'Delivered']
const ROWS = 4
// attributes that carry a list binding; their children are the row template even without an <items> wrapper
const LIST_PROPS = new Set([
  'items',
  'rows',
  'columns',
  'cells',
  'suggestionItems',
  'tabs',
  'sections',
  'steps',
  'content',
  'buttons',
  'tokens',
  'menuItems',
  'attachments',
  'links',
])

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** A plausible value for a field called `name` in row `i`. */
export function sampleValue(name, i = 0) {
  const n = String(name).toLowerCase()
  if (/^(is|has|can|show|enable)[a-z]|enabled|visible|active|selected|checked/.test(n)) return true
  if (/(^|[^a-z])id$|^id|^key$/.test(n) || /id$/.test(n)) return String(1001 + i)
  if (/customer|company|supplier|vendor|client/.test(n)) return COMPANIES[i % COMPANIES.length]
  if (/status|state/.test(n)) return STATUSES[i % STATUSES.length]
  if (/date|time|created|changed|valid/.test(n))
    return new Date(Date.UTC(2026, i % 12, 10 + i)).toISOString().slice(0, 10)
  if (/amount|price|total|sum|cost|quantity|qty|count|number|value|rating|weight/.test(n))
    return Number(((i + 1) * 249.5).toFixed(2))
  return `${cap(String(name).split(/[./]/).pop())} ${i + 1}`
}

/** Sets data[a][b]... = value; numeric segments become arrays. */
function setPath(data, segments, value) {
  let node = data
  segments.forEach((seg, idx) => {
    const last = idx === segments.length - 1
    const key = /^\d+$/.test(seg) ? Number(seg) : seg
    if (last) {
      if (node[key] === undefined) node[key] = value
      return
    }
    if (node[key] === null || typeof node[key] !== 'object')
      node[key] = /^\d+$/.test(segments[idx + 1]) ? [] : {}
    node = node[key]
  })
}

/** Top-level "{...}" groups of an attribute value (braces may nest in complex bindings). */
function groups(value) {
  const out = []
  let depth = 0
  let start = -1
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}' && depth > 0) {
      depth--
      if (depth === 0) out.push(value.slice(start + 1, i))
    }
  }
  return out
}

/** Data bindings of one attribute value: [{model, path}] ("" = default model). Expressions and i18n are skipped. */
export function bindingsOf(value, skipModels = new Set(['i18n'])) {
  if (typeof value !== 'string' || !value.includes('{') || value.startsWith('{{')) return []
  const found = []
  for (const body of groups(value)) {
    const text = body.trim()
    if (!text || text.startsWith('=')) continue
    let model = ''
    let path = null
    if (/^[\w$.]*\s*:/.test(text) || text.startsWith('path') || text.startsWith('parts')) {
      path = /path\s*:\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null
      model = /model\s*:\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? ''
      if (path && /^[\w$]+>/.test(path)) {
        model = path.slice(0, path.indexOf('>'))
        path = path.slice(path.indexOf('>') + 1)
      }
    } else {
      const m = /^(?:([\w$]+)>)?([^\s,{}'"]+)$/.exec(text)
      if (m) {
        model = m[1] ?? ''
        path = m[2]
      }
    }
    if (!path || skipModels.has(model)) continue
    found.push({ model, path })
  }
  return found
}

const segs = (p) => p.split('/').filter(Boolean)

/**
 * @param {Array<{content: string}>} xmlSources view and fragment sources
 * @param {{skipModels?: Set<string>}} [options] models that are not data (resource bundles)
 * @returns {Record<string, object>} model name -> data
 */
export function inferMockData(xmlSources, options = {}) {
  const skip = options.skipModels ?? new Set(['i18n'])
  const models = {}
  const root = (name) => (models[name] ??= {})

  for (const src of xmlSources) {
    let parsed
    try {
      parsed = parseXmlView(src.content)
    } catch {
      continue
    }
    const controls = parsed.controls
    const handled = new Set()

    // lists: a control binds an absolute path and has template children -> an array of rows
    controls.forEach((c, ci) => {
      const local = c.type.split('.').pop()
      for (const [key, value] of Object.entries(c.props)) {
        const own = bindingsOf(value, skip).filter((b) => b.path.startsWith('/'))
        if (own.length !== 1) continue
        // <List items="{/X}"> with the template written straight inside it, or inside <items>
        const below = (t) =>
          t !== c &&
          t.path.length > c.path.length &&
          c.path.every((p, k) => t.path[k] === p) &&
          t.path[c.path.length].startsWith(local)
        const children = controls.filter((t) => below(t) && (t.template || LIST_PROPS.has(key)))
        if (!children.length) continue
        const { model, path } = own[0]
        const fields = new Set()
        for (const t of children)
          for (const v of Object.values(t.props))
            for (const b of bindingsOf(v, skip))
              if (!b.path.startsWith('/') && b.model === model) fields.add(b.path)
        const rows = Array.from({ length: ROWS }, (_, i) => {
          const row = {}
          for (const f of fields) setPath(row, segs(f), sampleValue(segs(f).pop(), i))
          return row
        })
        const target = root(model)
        const parts = segs(path)
        const last = parts.pop()
        let node = target
        for (const p of parts) node = node[p] ??= {}
        if (node[last] === undefined) node[last] = rows
        handled.add(ci)
        children.forEach((t) => handled.add(controls.indexOf(t)))
      }
    })

    // everything else with an absolute path is a scalar
    controls.forEach((c, ci) => {
      if (handled.has(ci)) return
      for (const value of Object.values(c.props))
        for (const b of bindingsOf(value, skip))
          if (b.path.startsWith('/')) {
            const parts = segs(b.path)
            if (parts.length) setPath(root(b.model), parts, sampleValue(parts[parts.length - 1], 0))
          }
    })
  }
  return models
}
