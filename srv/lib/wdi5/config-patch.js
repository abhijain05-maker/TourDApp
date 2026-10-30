// The smallest change to an existing wdio config that makes it run the new spec: add the spec to "specs" when no
// glob reaches it, and the "ui5" service when it is missing. Text edits, so the rest of the file stays as it is; the
// result is parsed again and a change that would not parse is not made (the caller then says what to do by hand).
import * as acorn from 'acorn'
import { specGlobMatches } from './catalogue.js'

const parses = (text) => {
  for (const sourceType of ['script', 'module']) {
    try {
      acorn.parse(text, { ecmaVersion: 'latest', sourceType, allowReturnOutsideFunction: true })
      return true
    } catch {
      /* try the other one */
    }
  }
  return false
}

/** Adds `item` (source text of a string) to the array literal in text[start, end). */
function addToArray(text, { start, end }, item) {
  const inner = text.slice(start + 1, end - 1)
  const multiline = inner.includes('\n')
  const empty = inner.trim() === ''
  if (empty) return `${text.slice(0, start + 1)}${item}${text.slice(end - 1)}`
  const trimmed = inner.replace(/\s+$/, '')
  const tail = inner.slice(trimmed.length)
  const hasTrailingComma = trimmed.endsWith(',')
  if (multiline) {
    const indent = /\n([ \t]*)\S[^\n]*$/.exec(trimmed.replace(/,$/, ''))?.[1] ?? '  '
    return `${text.slice(0, start + 1)}${trimmed}${hasTrailingComma ? '' : ','}\n${indent}${item}${hasTrailingComma ? ',' : ''}${tail}${text.slice(end - 1)}`
  }
  return `${text.slice(0, start + 1)}${trimmed}${hasTrailingComma ? '' : ','} ${item}${hasTrailingComma ? ',' : ''}${tail}${text.slice(end - 1)}`
}

/**
 * @param {string} text the config
 * @param {object} info what catalogue.js read from it
 * @param {{specPath: string, glob: string, quote: string}} want
 * @returns {{text: string, changes: string[], notes: string[]}}
 */
export function patchConfig(text, info, { specPath, glob, quote = '"' }) {
  let out = text
  const changes = []
  const notes = []
  const s = (v) => `${quote}${v}${quote}`
  const configDir = info.path.includes('/') ? info.path.slice(0, info.path.lastIndexOf('/')) : ''

  if (!info.readable)
    return {
      text,
      changes,
      notes: [`${info.path} could not be read: add the spec ${specPath} to "specs" yourself.`],
    }

  // 1. the spec must be reached by "specs"
  if (!info.specsNode?.literal)
    notes.push(`"specs" in ${info.path} is not a plain list: make sure it reaches ${specPath}.`)
  else if (!specGlobMatches(info.specs, configDir, specPath)) {
    const next = addToArray(out, info.specsNode, s(glob))
    if (parses(next)) {
      out = next
      changes.push(`"specs" now also has ${glob}`)
    } else notes.push(`${info.path} was not changed: add ${glob} to "specs" yourself.`)
  }

  // 2. the ui5 service (positions of the services list moved if specs came before it)
  if (!info.services.includes('ui5')) {
    const moved = parseConfigRanges(out)
    if (!moved.servicesNode)
      notes.push(
        `${info.path} has no "services" list: add ${s('ui5')} to it (wdi5 is the "ui5" service).`,
      )
    else {
      const next = addToArray(out, moved.servicesNode, s('ui5'))
      if (parses(next)) {
        out = next
        changes.push('the "ui5" service was added')
      } else notes.push(`${info.path} was not changed: add ${s('ui5')} to "services" yourself.`)
    }
  }
  return { text: out, changes, notes }
}

/** Positions of `services` and `specs` in a (possibly already changed) config. */
function parseConfigRanges(text) {
  const out = {}
  let ast
  for (const sourceType of ['script', 'module']) {
    try {
      ast = acorn.parse(text, {
        ecmaVersion: 'latest',
        sourceType,
        allowReturnOutsideFunction: true,
      })
      break
    } catch {
      /* next */
    }
  }
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'Property' && !node.computed) {
      const k = node.key.type === 'Identifier' ? node.key.name : node.key.value
      if (k === 'services' && node.value.type === 'ArrayExpression')
        out.servicesNode = { start: node.value.start, end: node.value.end }
    }
    for (const key of Object.keys(node)) {
      const v = node[key]
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(ast)
  return out
}
