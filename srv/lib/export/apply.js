// "Add the tour to the project": the same four steps the export README describes (copy tourd/, resourceRoots in the
// manifest, a start button in the host view, its handler in the controller), worked out as real edits of the
// project's files. Nothing is written here: the plan lists every file with what it is now and what it would be, and
// every edit is idempotent (a project that already has the button, the handler or the entry is left alone).
import * as acorn from 'acorn'
import { toTourJsonSchema } from '../../../shared/tour-schema.mjs'
import { checkExport, hostView, i18nKeysOf } from './bundle.js'
import { classifySource, pickManifest } from '../context/inventory.js'

const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/') + 1))
const BUTTON_ID = 'startTourBtn'
const HANDLER = 'onStartTour'

/** Tabs or spaces, as the file already does it. */
export function indentUnit(text) {
  if (/^\t/m.test(text)) return '\t'
  const m = /^( +)\S/m.exec(text)
  return m ? ' '.repeat(Math.min(m[1].length, 4)) : '\t'
}

export const lineIndent = (text, index) => {
  const start = text.lastIndexOf('\n', index - 1) + 1
  return /^[ \t]*/.exec(text.slice(start, index + 1))[0]
}

// ---- manifest.json ---------------------------------------------------------------------------------------------

/** Index of the "}" that closes the object opened at `open`; strings are skipped. -1 when it never closes. */
function closingBrace(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
    } else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

/** Puts `"name": value` first into the object that opens at `open`, in the file's own layout. */
function insertFirst(text, open, entry) {
  const after = text.slice(open + 1)
  const empty = /^\s*\}/.test(after)
  const outer = lineIndent(text, open)
  const nl = /^[ \t]*\r?\n([ \t]*)\S/.exec(after)
  const inner = nl ? nl[1] : outer + indentUnit(text)
  if (empty)
    return `${text.slice(0, open + 1)}\n${inner}${entry}\n${outer}${text.slice(open + 1).replace(/^\s*/, '')}`
  if (!nl) return `${text.slice(0, open + 1)} ${entry},${text.slice(open + 1)}`
  return `${text.slice(0, open + 1)}\n${inner}${entry},${text.slice(open + 1)}`
}

/** The manifest with `"sap.ui5".resourceRoots.tourd = "./tourd/"`; null when it is there already. */
export function patchManifest(text) {
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    return { error: 'manifest.json is not valid JSON' }
  }
  const roots = manifest?.['sap.ui5']?.resourceRoots
  if (roots?.tourd === './tourd/') return { text: null }
  const entry = '"tourd": "./tourd/"'
  const ui5 = /"sap\.ui5"\s*:\s*\{/.exec(text)
  let out = null
  if (ui5) {
    const open = ui5.index + ui5[0].length - 1
    const end = closingBrace(text, open)
    const body = text.slice(open, end + 1)
    const rr = /"resourceRoots"\s*:\s*\{/.exec(body)
    if (rr && !roots?.tourd) out = insertFirst(text, open + rr.index + rr[0].length - 1, entry)
    else if (!rr) out = insertFirst(text, open, `"resourceRoots": { ${entry} }`)
  }
  // the surgical edit has to give valid JSON with the entry; otherwise write the whole file again
  try {
    if (out && JSON.parse(out)['sap.ui5']?.resourceRoots?.tourd === './tourd/') return { text: out }
  } catch {
    /* fall through */
  }
  const copy = JSON.parse(text)
  copy['sap.ui5'] = { ...copy['sap.ui5'], resourceRoots: { ...roots, tourd: './tourd/' } }
  const unit = indentUnit(text)
  return {
    text: JSON.stringify(copy, null, unit) + (text.endsWith('\n') ? '\n' : ''),
    reformatted: true,
  }
}

// ---- the view --------------------------------------------------------------------------------------------------

/** The XML prefix of the sap.m namespace in the view's root tag ('' = default namespace); null when not declared. */
function mPrefix(text) {
  const root = /<(?:\w+:)?View\b[^>]*>/.exec(text)?.[0] ?? ''
  if (/\sxmlns\s*=\s*"sap\.m"/.test(root)) return ''
  const m = /\sxmlns:(\w+)\s*=\s*"sap\.m"/.exec(root)
  return m ? `${m[1]}:` : null
}

/** The view with a "Start tour" button in the header of its Page; null when it has one. */
export function patchView(text) {
  if (text.includes(`id="${BUTTON_ID}"`) || new RegExp(`press="\\.${HANDLER}"`).test(text))
    return { text: null }
  const p = mPrefix(text)
  if (p === null) return { error: 'the view does not use the sap.m namespace' }
  const page = new RegExp(`<${p}Page\\b[^>]*[^/]>`).exec(text)
  if (!page) return { error: 'the view has no sap.m Page to put the button into' }
  const unit = indentUnit(text)
  const pageIndent = lineIndent(text, page.index)
  const button = (indent) =>
    `${indent}<${p}Button id="${BUTTON_ID}" icon="sap-icon://hint" tooltip="Start the tour" press=".${HANDLER}" />`
  const header = new RegExp(`<${p}headerContent>`).exec(text.slice(page.index))
  if (header) {
    const at = page.index + header.index + header[0].length
    const next = /^[ \t]*\r?\n([ \t]*)\S/.exec(text.slice(at))
    const indent = next ? next[1] : pageIndent + unit + unit
    return { text: `${text.slice(0, at)}\n${button(indent)}${text.slice(at)}` }
  }
  const at = page.index + page[0].length
  const inner = pageIndent + unit
  const block = `\n${inner}<${p}headerContent>\n${button(inner + unit)}\n${inner}</${p}headerContent>`
  return { text: `${text.slice(0, at)}${block}${text.slice(at)}` }
}

// ---- the controller --------------------------------------------------------------------------------------------

function handlerSource(indent, unit, asClass) {
  const lines = [
    asClass ? `${HANDLER}() {` : `${HANDLER}: function () {`,
    `${unit}var oComponent = this.getOwnerComponent();`,
    `${unit}sap.ui.require(["tourd/TourPlayer"], function (TourPlayer) {`,
    `${unit}${unit}TourPlayer.start(sap.ui.require.toUrl("tourd/tour.json"), { component: oComponent });`,
    `${unit}});`,
    '}',
  ]
  return lines.map((l) => indent + l).join('\n')
}

/** The syntax tree of a UI5 script (plain or module); null when it cannot be read (TypeScript, a broken file). */
export function parseJs(text) {
  const base = {
    ecmaVersion: 'latest',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
  }
  try {
    return acorn.parse(text, { ...base, sourceType: 'script' })
  } catch {
    try {
      return acorn.parse(text, { ...base, sourceType: 'module' })
    } catch {
      return null
    }
  }
}

/**
 * The body that `X.extend({...})` or `class ... extends X {...}` defines (the first one in the file):
 * { kind: 'object' | 'class', node: the body, base: the node of X for `X.extend`, items: its members }.
 */
export function findExtendTarget(ast) {
  let target = null
  const visit = (node) => {
    if (!node || typeof node.type !== 'string' || target) return
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.property.name === 'extend'
    ) {
      const body = node.arguments.at(-1)
      if (body?.type === 'ObjectExpression')
        target = { kind: 'object', node: body, base: node.callee.object, items: body.properties }
    }
    if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.superClass)
      target = { kind: 'class', node: node.body, base: node.superClass, items: node.body.body }
    if (!target)
      for (const key of Object.keys(node)) {
        const v = node[key]
        if (Array.isArray(v)) v.forEach(visit)
        else if (v && typeof v.type === 'string') visit(v)
      }
  }
  visit(ast)
  return target
}

/** The text with `method` (already indented) added as the last member of the body `target`. */
export function addMember(text, target, method) {
  const last = target.items.at(-1)
  if (target.kind === 'class') {
    const close = target.node.end - 1
    const before = text.slice(0, close).replace(/\s*$/, '')
    return `${before}\n\n${method}\n${lineIndent(text, target.node.start)}${text.slice(close)}`
  }
  if (!last) {
    const open = target.node.start + 1
    return `${text.slice(0, open)}\n${method}\n${lineIndent(text, target.node.start)}${text.slice(open).replace(/^\s*/, '')}`
  }
  return `${text.slice(0, last.end)},\n\n${method}${text.slice(last.end)}`
}

/** The indent members of this body have (or should have, when it has none). */
export function memberIndent(text, target) {
  return target.items.length
    ? lineIndent(text, target.items[0].start)
    : lineIndent(text, target.node.start) + indentUnit(text)
}

/** The controller with the start handler; null when it has one. */
export function patchController(text) {
  const ast = parseJs(text)
  if (!ast) return { error: 'the controller could not be read (is it TypeScript?)' }
  const target = findExtendTarget(ast)
  if (!target)
    return { error: 'no controller (Controller.extend or a class) was found in the file' }

  const has = target.items.some((m) => {
    const k = m.key
    return k && (k.name === HANDLER || k.value === HANDLER)
  })
  if (has) return { text: null }

  const method = handlerSource(
    memberIndent(text, target),
    indentUnit(text),
    target.kind === 'class',
  )
  return { text: addMember(text, target, method) }
}

// ---- i18n ------------------------------------------------------------------------------------------------------

/** The bundle with the keys the tour uses and the app lacks (empty, to be filled in). */
export function patchI18n(text, keys) {
  const have = new Set([...text.matchAll(/^\s*([\w.-]+)\s*[=:]/gm)].map((m) => m[1]))
  const missing = keys.filter((k) => !have.has(k))
  if (!missing.length) return { text: null, missing }
  const glue = text === '' || text.endsWith('\n') ? '' : '\n'
  return {
    text: `${text}${glue}\n# added by TourD: fill in the texts of the tour\n${missing.map((k) => `${k}=`).join('\n')}\n`,
    missing,
  }
}

// ---- the plan --------------------------------------------------------------------------------------------------

/**
 * @param {{tour: object, inventory: object|null, files: {path: string, content: string, binary?: boolean}[],
 *          playerSource: string}} args  `files` are the project's current (not removed) files
 * @returns {{ok: boolean, blocking: object[], notes: object[], edits: {path: string, action: 'add'|'modify'|'unchanged',
 *            before: string|null, after: string, what: string}[]}}
 */
export function planTourApply({ tour, inventory, files, playerSource }) {
  const notes = []
  const edits = []
  const byPath = new Map(files.map((f) => [f.path, f]))

  const check = checkExport(tour, inventory)
  const blocking = [...check.blocking]
  const manifestFile = pickManifest(files.filter((f) => classifySource(f.path) === 'manifest'))
  if (!manifestFile)
    blocking.push({
      code: 'apply.manifest',
      message: 'The project has no manifest.json: upload the whole app first.',
    })
  if (blocking.length) return { ok: false, blocking, notes, edits }
  const root = dirOf(manifestFile.path)

  const put = (path, after, what) => {
    const current = byPath.get(path)
    if (!current) return edits.push({ path, action: 'add', before: null, after, what })
    edits.push({
      path,
      action: current.content === after ? 'unchanged' : 'modify',
      before: current.content,
      after,
      what,
    })
  }

  // 1. the player and the tour
  put(
    `${root}tourd/TourPlayer.js`,
    playerSource,
    'The tour player (a normal UI5 module, no dependencies)',
  )
  const tourText = JSON.stringify(tour, null, 2) + '\n'
  const was = byPath.get(`${root}tourd/tour.json`)
  if (was) {
    try {
      const old = JSON.parse(was.content)
      if (old.id && old.id !== tour.id)
        notes.push({
          code: 'apply.replaces',
          message: `tourd/tour.json held another tour ("${old.title}"); it is replaced by this one.`,
        })
    } catch {
      /* not a tour: replaced all the same */
    }
  }
  put(`${root}tourd/tour.json`, tourText, 'The tour: texts, targets, order')
  put(
    `${root}tourd/tour.schema.json`,
    JSON.stringify(toTourJsonSchema(), null, 2) + '\n',
    'JSON schema of tour.json, for editors and CI',
  )

  // 2. UI5 finds the folder
  const manifest = patchManifest(manifestFile.content)
  if (manifest.error)
    notes.push({
      code: 'apply.manifest',
      message: `manifest.json was not changed: ${manifest.error}. Add "resourceRoots": { "tourd": "./tourd/" } under "sap.ui5" yourself.`,
    })
  else if (manifest.text !== null) {
    put(manifestFile.path, manifest.text, 'Tells UI5 where tourd/ is (resourceRoots)')
    if (manifest.reformatted)
      notes.push({
        code: 'apply.reformatted',
        message: 'manifest.json was written again as a whole, so its layout may differ from yours.',
      })
  }

  // 3. and 4. the button and its handler
  const host = hostView(inventory)
  if (!host)
    notes.push({
      code: 'apply.host',
      message:
        'No view was found for the start page. Add the button and its handler yourself (see the export README).',
    })
  else {
    const view = byPath.get(host.path)
    const patched = view
      ? patchView(view.content)
      : { error: 'the view file is not in the project' }
    if (patched.error)
      notes.push({
        code: 'apply.view',
        message: `${host.viewName} was not changed: ${patched.error}. Add a button with press=".${HANDLER}" where users will look for help.`,
      })
    else if (patched.text !== null)
      put(host.path, patched.text, `A "Start tour" button in ${host.viewName}`)

    const controller = inventory.controllers?.find((c) => c.controllerName === host.controllerName)
    const file = controller && byPath.get(controller.path)
    if (!host.controllerName || !file)
      notes.push({
        code: 'apply.controller',
        message: `The controller of ${host.viewName} was not found in the project. Add the ${HANDLER} handler to the controller of your start page (see the export README).`,
      })
    else {
      const done = patchController(file.content)
      if (done.error)
        notes.push({
          code: 'apply.controller',
          message: `${controller.controllerName} was not changed: ${done.error}. Add the ${HANDLER} handler yourself (see the export README).`,
        })
      else if (done.text !== null)
        put(file.path, done.text, `The ${HANDLER} handler in ${controller.controllerName}`)
    }
  }

  // texts the tour refers to
  const keys = [...i18nKeysOf(tour).keys()]
  if (keys.length && inventory) {
    const bundles = files.filter((f) => classifySource(f.path) === 'i18n')
    const bundle =
      bundles.find((f) => f.path === `${root}i18n/i18n.properties`) ??
      bundles.find((f) => /(^|\/)i18n\.properties$/.test(f.path)) ??
      bundles[0]
    const missing = keys.filter((k) => !new Set(inventory.i18nKeys).has(k))
    if (missing.length && bundle) {
      const patched = patchI18n(bundle.content, missing)
      if (patched.text !== null)
        put(bundle.path, patched.text, 'The texts the tour uses (empty: fill them in)')
    } else if (missing.length)
      notes.push({
        code: 'apply.i18n',
        message: `The tour uses texts your app does not have: ${missing.join(', ')}.`,
      })
  }

  return {
    ok: true,
    blocking: [],
    notes: [...notes, ...check.warnings.map((w) => ({ code: w.code, message: w.message }))],
    edits,
  }
}
