// What an extractor works with: the project's files, and a way to report what it found.
//
// An extractor calls ctx.add({...}) for every thing the project depends on. Several extractors (and several files)
// often describe the same thing, a destination is named in mta.yaml, in package.json and in xs-app.json; they all
// use the same category / kind / name, and the context merges them into one item that remembers every place.
import { CATEGORY_IDS, CATEGORIES, LEVELS, SEVERITIES } from './categories.js'
import { asArray, isObject, parseJson, parseYaml } from './util.js'

const RANK = (list, v) => {
  const i = list.indexOf(v)
  return i < 0 ? list.length : i
}

export const itemKey = (category, kind, name) => `${category}:${kind}:${String(name).trim()}`

const sameSource = (a, b) => a.path === b.path && (a.line ?? 0) === (b.line ?? 0)

function mergeInto(item, p) {
  if (!item.title && p.title) item.title = p.title
  if (!item.summary && p.summary) item.summary = p.summary
  if (
    p.severity &&
    (!item.severity || RANK(SEVERITIES, p.severity) < RANK(SEVERITIES, item.severity))
  )
    item.severity = p.severity
  for (const s of asArray(p.source ?? p.sources))
    if (s?.path && !item.sources.some((x) => sameSource(x, s)))
      item.sources.push({ path: s.path, ...(s.line ? { line: s.line } : {}) })
  for (const [k, v] of Object.entries(p.attrs ?? {}))
    if (v !== undefined && v !== null && v !== '') item.attrs[k] ??= v
  for (const v of asArray(p.verify)) if (v && !item.verify.includes(v)) item.verify.push(v)
  for (const f of asArray(p.fields))
    if (f?.id && !item.fields.some((x) => x.id === f.id)) item.fields.push(f)
  for (const s of asArray(p.signals))
    if (s && !item.signals.some((x) => x.code === s.code && x.message === s.message))
      item.signals.push(s)
}

/**
 * @param {Array<{path: string, content: string}>} files text files of the project (working copies)
 */
export function createContext(files) {
  const items = new Map()
  const relations = []
  const warnings = []
  const cache = new Map()
  const shared = {}

  const ctx = {
    files,

    /** A scratch space extractors use to hand parsed data to later ones (memoise with ctx.once). */
    shared,

    once(name, make) {
      return name in shared ? shared[name] : (shared[name] = make())
    },

    /** Files whose path matches a RegExp or a predicate, in path order. */
    find(test) {
      const fn = test instanceof RegExp ? (p) => test.test(p) : test
      return files.filter((f) => fn(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1))
    },

    file: (path) => files.find((f) => f.path === path),

    /** Parsed JSON of a file; a file that cannot be read is reported once and gives undefined. */
    json(file) {
      return parseOnce(file, 'json', parseJson)
    },

    yaml(file) {
      return parseOnce(file, 'yaml', parseYaml)
    },

    /**
     * Adds a thing, or merges into the thing with the same category / kind / name.
     * @param {object} p
     * @param {string} p.category one of the ids in categories.js
     * @param {string} p.kind     what it is inside the category: 'destination', 'odata-v2', 'scope' ...
     * @param {string} p.name     what the project calls it; with category and kind it is the identity
     * @param {string} [p.title]
     * @param {string} [p.summary]
     * @param {'high'|'normal'|'low'} [p.severity] how likely it stops the app when it is missing
     * @param {{path: string, line?: number}} [p.source] where it is declared or used
     * @param {object} [p.attrs]   facts (shown as a list, read by checks)
     * @param {string[]} [p.verify] how a person checks it
     * @param {Array<{id: string, label: string, hint?: string}>} [p.fields] what a person writes down about it
     * @param {Array<{level: string, code: string, message: string}>} [p.signals] what the scan found out about it
     * @returns {string} the key of the item
     */
    add(p) {
      if (!CATEGORY_IDS.has(p.category))
        throw new Error(`Unknown readiness category "${p.category}"`)
      if (!p.kind || !p.name) throw new Error('A readiness item needs a kind and a name')
      const key = itemKey(p.category, p.kind, p.name)
      let item = items.get(key)
      if (!item) {
        item = {
          key,
          category: p.category,
          kind: p.kind,
          name: String(p.name).trim(),
          title: '',
          summary: '',
          severity: null,
          sources: [],
          attrs: {},
          links: [],
          verify: [],
          fields: [],
          signals: [],
        }
        items.set(key, item)
      }
      mergeInto(item, p)
      return key
    },

    get: (key) => items.get(key),

    /** All items of a category (and kind). */
    items(category, kind) {
      return [...items.values()].filter(
        (i) => (!category || i.category === category) && (!kind || i.kind === kind),
      )
    },

    /** Reports a finding about an item that exists (or is created by add() first). */
    signal(key, level, code, message) {
      if (!LEVELS.includes(level)) throw new Error(`Unknown level "${level}"`)
      const item = items.get(key)
      if (item && !item.signals.some((s) => s.code === code && s.message === message))
        item.signals.push({ level, code, message })
    },

    /** "from uses to": both items show the link. Links to items that do not exist are dropped at the end. */
    relate(from, to, rel = 'uses') {
      if (from && to && from !== to) relations.push({ from, to, rel })
    },

    warn(code, message, path) {
      warnings.push({ code, message, ...(path ? { path } : {}) })
    },

    warnings,

    /** The finished items: relations resolved, sorted by category, then severity, then name. */
    finish() {
      for (const { from, to, rel } of relations) {
        const a = items.get(from)
        const b = items.get(to)
        if (!a || !b) continue
        const inverse = rel === 'uses' ? 'usedBy' : 'uses'
        if (!a.links.some((l) => l.key === to && l.rel === rel)) a.links.push({ key: to, rel })
        if (!b.links.some((l) => l.key === from && l.rel === inverse))
          b.links.push({ key: from, rel: inverse })
      }
      const order = new Map(CATEGORIES.map((c) => [c.id, c.order]))
      return [...items.values()]
        .map((i) => ({ ...i, severity: i.severity ?? 'normal', title: i.title || i.name }))
        .sort(
          (a, b) =>
            order.get(a.category) - order.get(b.category) ||
            RANK(SEVERITIES, a.severity) - RANK(SEVERITIES, b.severity) ||
            a.title.localeCompare(b.title),
        )
    },
  }

  function parseOnce(file, how, parse) {
    const id = `${how}:${file.path}`
    if (!cache.has(id)) {
      let value
      try {
        value = parse(file.content)
      } catch (e) {
        ctx.warn(
          'unreadable-file',
          `${file.path} could not be read (${String(e.message).split('\n')[0]}), so it was skipped.`,
          file.path,
        )
      }
      cache.set(id, isObject(value) || Array.isArray(value) ? value : undefined)
    }
    return cache.get(id)
  }

  return ctx
}
