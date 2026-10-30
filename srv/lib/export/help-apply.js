// "Add the help to the project": the files of the help layer (tourd/HelpLayer.js with the player it needs, help.json),
// the resourceRoots entry in the manifest and a few lines in the Component's init that start the layer - worked out as
// real edits of the project's files, like planTourApply does for a tour. The Component is the one place both freestyle
// and Fiori elements apps have (a Fiori elements app has no view of its own to put a button into).
// Nothing is written here; every edit is idempotent.
import { toHelpJsonSchema, validateHelp } from '../../../shared/help-schema.mjs'
import { classifySource, pickManifest } from '../context/inventory.js'
import {
  addMember,
  findExtendTarget,
  indentUnit,
  lineIndent,
  memberIndent,
  parseJs,
  patchI18n,
  patchManifest,
} from './apply.js'

const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/') + 1))
const MARK = 'tourd/HelpLayer'
const I18N_REF = /\{i18n>([^}]+)\}/g

const startLines = (indent, unit) =>
  [
    'var oHelpOwner = this;',
    'sap.ui.require(["tourd/HelpLayer"], function (HelpLayer) {',
    `${unit}HelpLayer.start(sap.ui.require.toUrl("tourd/help.json"), { component: oHelpOwner });`,
    '});',
  ]
    .map((l) => indent + l)
    .join('\n')

/** Component.js with the lines that start the help layer in init(); null when they are there already. */
export function patchComponent(text) {
  if (text.includes(MARK)) return { text: null }
  const ast = parseJs(text)
  if (!ast) return { error: 'Component.js could not be read (is it TypeScript?)' }
  const target = findExtendTarget(ast)
  if (!target)
    return { error: 'no Component (UIComponent.extend or a class) was found in Component.js' }
  const unit = indentUnit(text)

  const init = target.items.find((m) => m.key && (m.key.name === 'init' || m.key.value === 'init'))
  if (init) {
    const fn = init.value
    if (!fn || !/Function/.test(fn.type) || fn.body?.type !== 'BlockStatement')
      return { error: 'init in Component.js is not a plain function' }
    const body = fn.body
    const indent = body.body.length
      ? lineIndent(text, body.body[0].start)
      : lineIndent(text, init.start) + unit
    const close = body.end - 1
    const before = text.slice(0, close).replace(/\s*$/, '')
    return {
      text: `${before}\n${startLines(indent, unit)}\n${lineIndent(text, init.start)}${text.slice(close)}`,
    }
  }

  // no init yet: add one that calls the parent's init first, as every UI5 Component must
  const indent = memberIndent(text, target)
  const inner = indent + unit
  const isClass = target.kind === 'class'
  const parent = text.slice(target.base.start, target.base.end)
  const method = [
    indent + (isClass ? 'init() {' : 'init: function () {'),
    inner +
      (isClass ? 'super.init(...arguments);' : `${parent}.prototype.init.apply(this, arguments);`),
    startLines(inner, unit),
    indent + '}',
  ].join('\n')
  return { text: addMember(text, target, method) }
}

/** {i18n>key} references in the texts of the topics. */
export function helpI18nKeys(help) {
  const keys = new Set()
  for (const t of help.topics ?? [])
    for (const text of [t.title, t.summary, t.text, t.note])
      for (const m of String(text ?? '').matchAll(I18N_REF)) keys.add(m[1])
  return [...keys]
}

/** true / false when the inventory knows the view of the target (and so can tell), null when it cannot. */
function controlKnown(inventory, target) {
  if (!inventory || !target?.viewName || !target.controlId) return null
  if (!inventory.views?.some((v) => v.viewName === target.viewName)) return null
  return !!inventory.controls?.some(
    (c) => c.viewName === target.viewName && c.localId === target.controlId,
  )
}

/**
 * @param {{help: object, inventory: object|null, files: {path: string, content: string}[],
 *          playerSource: string, helpSource: string}} args
 * @returns {{ok: boolean, blocking: object[], notes: object[], edits: {path, action, before, after, what}[]}}
 */
export function planHelpApply({ help, inventory, files, playerSource, helpSource }) {
  const notes = []
  const edits = []
  const byPath = new Map(files.map((f) => [f.path, f]))

  const checked = validateHelp(help)
  const blocking = []
  if (!checked.ok)
    blocking.push({
      code: 'help.invalid',
      message: `The help is not valid: ${checked.issues[0].path} ${checked.issues[0].message}`,
    })
  else if (!checked.help.topics.length)
    blocking.push({
      code: 'help.empty',
      message: 'The help has no topics yet: write at least one in the browser extension first.',
    })
  const manifestFile = pickManifest(files.filter((f) => classifySource(f.path) === 'manifest'))
  if (!manifestFile)
    blocking.push({
      code: 'apply.manifest',
      message: 'The project has no manifest.json: upload the whole app first.',
    })
  if (blocking.length) return { ok: false, blocking, notes, edits }
  const doc = checked.help
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

  // 1. the layer, the player it finds controls with, and the help
  put(
    `${root}tourd/TourPlayer.js`,
    playerSource,
    'The player: the help layer finds controls with it',
  )
  put(
    `${root}tourd/HelpLayer.js`,
    helpSource,
    'The help layer (a normal UI5 module): panel, ? badges, popovers',
  )
  const was = byPath.get(`${root}tourd/help.json`)
  if (was) {
    try {
      const old = JSON.parse(was.content)
      if (old.id && old.id !== doc.id)
        notes.push({
          code: 'apply.replaces',
          message: `tourd/help.json held other help ("${old.title}"); it is replaced by this one.`,
        })
    } catch {
      /* not help: replaced all the same */
    }
  }
  put(
    `${root}tourd/help.json`,
    JSON.stringify(doc, null, 2) + '\n',
    'The help: topics, texts, the control of each',
  )
  put(
    `${root}tourd/help.schema.json`,
    JSON.stringify(toHelpJsonSchema(), null, 2) + '\n',
    'JSON schema of help.json, for editors and CI',
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

  // 3. start the layer when the app starts
  const component = byPath.get(`${root}Component.js`)
  const manual = `Add this to the init of your Component: sap.ui.require(["tourd/HelpLayer"], function (HelpLayer) { HelpLayer.start(sap.ui.require.toUrl("tourd/help.json"), { component: oComponent }); });`
  if (!component)
    notes.push({
      code: 'apply.component',
      message: `${root}Component.js is not in the project, so nothing starts the help. ${manual}`,
    })
  else {
    const patched = patchComponent(component.content)
    if (patched.error)
      notes.push({
        code: 'apply.component',
        message: `Component.js was not changed: ${patched.error}. ${manual}`,
      })
    else if (patched.text !== null)
      put(component.path, patched.text, 'Starts the help layer in the init of the Component')
  }

  // 4. texts the help refers to
  const keys = helpI18nKeys(doc)
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
        put(bundle.path, patched.text, 'The texts the help uses (empty: fill them in)')
    } else if (missing.length)
      notes.push({
        code: 'apply.i18n',
        message: `The help uses texts your app does not have: ${missing.join(', ')}.`,
      })
  }

  // 5. what could not be checked or may not be found
  for (const t of doc.topics) {
    if (controlKnown(inventory, t.target) === false)
      notes.push({
        code: 'help.unknownControl',
        message: `Topic "${t.title}": the view ${t.target.viewName} has no control "${t.target.controlId}" in its XML. It may be created at run time; check it in the app.`,
      })
    else if (t.target.controlId && /^__/.test(t.target.controlId))
      notes.push({
        code: 'help.unstableId',
        message: `Topic "${t.title}": "${t.target.controlId}" is a generated id and may change; the text of the control is used as a fallback.`,
      })
  }

  return { ok: true, blocking: [], notes, edits }
}
