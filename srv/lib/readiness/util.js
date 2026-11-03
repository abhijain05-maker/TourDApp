// Small helpers the extractors share. Nothing here knows about a specific kind of file.
import YAML from 'yaml'

export const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
export const basename = (p) => p.slice(p.lastIndexOf('/') + 1)
export const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** 1-based line of a character index. */
export function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** Line of the first place that matches (string or RegExp), or undefined. */
export function lineOf(text, needle) {
  const i = needle instanceof RegExp ? text.search(needle) : text.indexOf(needle)
  return i < 0 ? undefined : lineAt(text, i)
}

/** Every match of a regular expression with the line it is on. The expression needs the g flag. */
export function* matches(text, re) {
  re.lastIndex = 0
  let m
  while ((m = re.exec(text))) {
    yield { m, line: lineAt(text, m.index) }
    if (m[0] === '') re.lastIndex++
  }
}

/** JSON as people write it in config files: comments and trailing commas are allowed. */
export function parseJson(text) {
  const src = String(text ?? '').replace(/^﻿/, '')
  try {
    return JSON.parse(src)
  } catch (strictError) {
    let out = ''
    let inString = false
    for (let i = 0; i < src.length; i++) {
      const c = src[i]
      if (inString) {
        out += c
        if (c === '\\') out += src[++i] ?? ''
        else if (c === '"') inString = false
      } else if (c === '"') {
        inString = true
        out += c
      } else if (c === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++
        out += '\n'
      } else if (c === '/' && src[i + 1] === '*') {
        i += 2
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
        i++
      } else out += c
    }
    try {
      return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
    } catch {
      throw strictError
    }
  }
}

export const parseYaml = (text) => YAML.parse(String(text ?? ''), { prettyErrors: false }) ?? {}

/** Code that runs on the server (not the browser app, not a test). */
export const isServerCode = (path) =>
  /\.(m?js|cjs|ts)$/.test(path) &&
  !/(^|\/)(test|tests|__tests__|spec|node_modules|webapp|dist|gen)\//.test(path) &&
  !/\.(test|spec)\.[cm]?[jt]s$/.test(path)

export const isCode = (path) =>
  /\.(m?js|cjs|ts)$/.test(path) &&
  !/(^|\/)(test|tests|__tests__|spec|node_modules|dist|gen)\//.test(path) &&
  !/\.(test|spec)\.[cm]?[jt]s$/.test(path)

/** "$XSAPPNAME.Admin" and "my-app!t123.Admin" both mean the role "Admin". */
export const roleName = (scope) =>
  String(scope)
    .replace(/^\$XSAPPNAME\./, '')
    .replace(/^.*![tb]\d+\./, '')

/** A value is a placeholder (filled in at deploy time), not a real value. */
export const isPlaceholder = (v) =>
  /^(~\{.*\}|\$\{.*\}|<.*>|\*+|\{\{.*\}\})$/.test(String(v ?? '').trim())

export const humanize = (key) => {
  const s = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
