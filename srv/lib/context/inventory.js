// Builds the control inventory: the deterministic, JSON-serialisable description of an app that
// both the rule-based generator and the LLM prompt are grounded in. Targets must come from here.
import { parseXmlView } from '../parsers/xml-view.js'
import { parseController } from '../parsers/controller.js'
import { parseManifest } from '../parsers/manifest.js'
import { parseProperties, createTextResolver } from '../parsers/i18n.js'

/** Types worth keeping in the inventory even when they have no id (a text fallback can still find them). */
const INTERACTIVE = new Set([
  'sap.m.Button',
  'sap.m.ToggleButton',
  'sap.m.MenuButton',
  'sap.m.Link',
  'sap.m.SearchField',
  'sap.m.Input',
  'sap.m.Select',
  'sap.m.ComboBox',
  'sap.m.CheckBox',
  'sap.m.RadioButton',
  'sap.m.Switch',
  'sap.m.DatePicker',
  'sap.m.IconTabFilter',
  'sap.m.StandardListItem',
  'sap.m.ObjectListItem',
  'sap.m.SegmentedButtonItem',
])

const norm = (p) => p.replace(/\\/g, '/')
const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/') + 1))

/** Several manifest.json files (app, test mocks, build output): the one closest to the root is the app's. */
export function pickManifest(manifests) {
  return [...manifests].sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || (a.path < b.path ? -1 : 1),
  )[0]
}

export function classifySource(path) {
  const p = norm(path).toLowerCase()
  if (p.endsWith('/manifest.json') || p === 'manifest.json') return 'manifest'
  if (p.endsWith('.view.xml')) return 'view'
  if (p.endsWith('.fragment.xml')) return 'fragment'
  if (/\.controller\.(js|ts)$/.test(p)) return 'controller'
  if (/(^|\/)i18n[^/]*\.properties$/.test(p)) return 'i18n'
  return 'other'
}

/** "webapp/view/sub/Main.view.xml" + root "webapp/" + appId "my.app" -> "my.app.view.sub.Main" */
function moduleName(path, rootDir, appId, extPattern) {
  let rel = norm(path)
  if (rootDir && rel.startsWith(rootDir)) rel = rel.slice(rootDir.length)
  else if (rel.includes('webapp/')) rel = rel.slice(rel.lastIndexOf('webapp/') + 'webapp/'.length)
  const dotted = rel.replace(extPattern, '').replace(/\//g, '.')
  return appId ? `${appId}.${dotted}` : dotted
}

function pickI18n(sources, manifest) {
  const bundles = sources.filter((s) => classifySource(s.path) === 'i18n')
  const preferred =
    bundles.find((s) => /(^|\/)i18n\.properties$/i.test(norm(s.path))) ||
    bundles.find((s) => /_en\.properties$/i.test(s.path)) ||
    bundles[0]
  return preferred ? parseProperties(preferred.content) : {}
}

function describeControl(c, host, labelFor, resolve) {
  const text = resolve(c.props.text)
  const title = resolve(c.props.title)
  const tooltip = resolve(c.props.tooltip)
  const placeholder = resolve(c.props.placeholder)
  const label =
    c.localId && labelFor[c.localId] !== undefined
      ? resolve(labelFor[c.localId])
      : resolve(c.props.label)
  return {
    viewName: host.viewName,
    localId: c.localId,
    type: c.type,
    label,
    text,
    title,
    tooltip,
    placeholder,
    display: label ?? text ?? title ?? tooltip ?? placeholder ?? null,
    handlers: c.handlers,
    path: c.path,
    aggregation: c.aggregation,
    template: c.template,
    hasStableId: !!c.localId && !c.template,
    scope: host.scope,
    ...(host.fragmentName ? { fragmentName: host.fragmentName } : {}),
    ...(host.idPrefix ? { idPrefix: host.idPrefix } : {}),
    ...(!host.viewName && c.localId
      ? { globalId: host.idPrefix ? `${host.idPrefix}--${c.localId}` : c.localId }
      : {}),
  }
}

function keep(control) {
  if (control.localId) return true
  return !control.template && INTERACTIVE.has(control.type) && control.display !== null
}

/**
 * @param {Array<{path: string, content: string}>} sources
 * @param {{namespace?: string}} [options]
 */
export function buildInventory(sources, options = {}) {
  const warnings = []
  const kinds = new Map(sources.map((s) => [s.path, classifySource(s.path)]))
  const of = (kind) => sources.filter((s) => kinds.get(s.path) === kind)

  const manifestSrc = pickManifest(of('manifest'))
  let manifest = null
  if (manifestSrc) {
    try {
      manifest = parseManifest(manifestSrc.content)
    } catch (e) {
      warnings.push({
        code: 'manifest.invalid',
        message: `manifest.json is not valid JSON: ${e.message}`,
      })
    }
  } else {
    warnings.push({
      code: 'manifest.missing',
      message: 'No manifest.json was provided; view names and routes are guessed',
    })
  }
  const rootDir = manifestSrc ? dirOf(norm(manifestSrc.path)) : ''

  // controllers first: they also tell us the app namespace when the manifest is missing
  const controllers = of('controller').map((s) => ({ path: s.path, ...parseController(s.content) }))
  let appId = manifest?.appId ?? options.namespace ?? null
  if (!appId) {
    const guess = controllers.map((c) => c.controllerName).find(Boolean)
    appId = guess ? guess.replace(/\.controller\..*$/, '') : null
    if (!appId)
      warnings.push({ code: 'namespace.unknown', message: 'Could not determine the app namespace' })
  }
  for (const c of controllers) {
    c.controllerName ??= moduleName(c.path, rootDir, appId, /\.controller\.(js|ts)$/i)
    if (c.parseError)
      warnings.push({ code: 'controller.parse', message: `${c.path}: ${c.parseError}` })
  }
  const controllerByName = new Map(controllers.map((c) => [c.controllerName, c]))

  const texts = pickI18n(sources, manifest)
  const resolve = createTextResolver(texts)

  // a file that is not well-formed XML is reported and left out; the rest of the app is still usable
  const parseAll = (kind, nameKey, ext) =>
    of(kind).flatMap((s) => {
      try {
        return [
          {
            path: s.path,
            [nameKey]: moduleName(s.path, rootDir, appId, ext),
            parsed: parseXmlView(s.content),
          },
        ]
      } catch (e) {
        warnings.push({
          code: kind + '.parse',
          message: `${s.path} is not valid XML and was skipped: ${String(e.message).split('\n')[0].slice(0, 160)}`,
        })
        return []
      }
    })
  const views = parseAll('view', 'viewName', /\.view\.xml$/i)
  const fragments = parseAll('fragment', 'fragmentName', /\.fragment\.xml$/i)

  // which views host which fragment, and how its ids are prefixed
  const hosts = new Map(fragments.map((f) => [f.fragmentName, []]))
  const addHost = (name, viewName, idMode, idPrefix = null) => {
    if (!hosts.has(name)) {
      warnings.push({
        code: 'fragment.missing',
        message: `Fragment ${name} (used by ${viewName}) was not provided`,
      })
      return
    }
    hosts.get(name).push({ viewName, idMode, idPrefix })
  }
  for (const v of views) {
    for (const ref of v.parsed.fragmentRefs) addHost(ref.name, v.viewName, 'view')
    const ctrl = controllerByName.get(v.parsed.controllerName)
    if (v.parsed.controllerName && !ctrl) {
      warnings.push({
        code: 'controller.missing',
        message: `Controller ${v.parsed.controllerName} of ${v.viewName} was not provided`,
      })
    }
    for (const f of ctrl?.fragments ?? []) addHost(f.name, v.viewName, f.idMode, f.idPrefix)
  }

  const controls = []
  for (const v of views) {
    const host = { viewName: v.viewName, scope: 'view' }
    for (const c of v.parsed.controls)
      controls.push(describeControl(c, host, v.parsed.labelFor, resolve))
  }
  for (const f of fragments) {
    const hs = hosts.get(f.fragmentName)
    if (!hs.length) {
      warnings.push({
        code: 'fragment.orphan',
        message: `Fragment ${f.fragmentName} is not loaded by any provided view/controller`,
      })
      hs.push({ viewName: null, idMode: 'none', idPrefix: null })
    }
    const seen = new Set()
    for (const h of hs) {
      const key = `${h.viewName}|${h.idMode}|${h.idPrefix}`
      if (seen.has(key)) continue
      seen.add(key)
      const host = {
        viewName: h.idMode === 'view' || h.idMode === 'unknown' ? h.viewName : null,
        scope: 'fragment',
        fragmentName: f.fragmentName,
        idPrefix: h.idMode === 'custom' ? h.idPrefix : null,
      }
      for (const c of f.parsed.controls)
        controls.push(describeControl(c, host, f.parsed.labelFor, resolve))
    }
  }

  // duplicate ids inside one view are a real problem at runtime
  const dup = new Map()
  for (const c of controls) {
    if (!c.localId || c.scope === 'fragment') continue
    const k = `${c.viewName}::${c.localId}`
    dup.set(k, (dup.get(k) ?? 0) + 1)
  }
  for (const [k, n] of dup)
    if (n > 1)
      warnings.push({
        code: 'id.duplicate',
        message: `Duplicate control id ${k.replace('::', ' / ')} (${n}x)`,
      })

  const targetsByView = new Map()
  for (const t of Object.values(manifest?.targets ?? {}))
    if (t.viewName) targetsByView.set(t.viewName, t)

  return {
    appId,
    minUI5Version: manifest?.minUI5Version ?? null,
    rootViewName: manifest?.rootView?.viewName ?? null,
    i18nKeys: Object.keys(texts),
    i18nModel:
      manifest?.models.find((m) => m.type === 'sap.ui.model.resource.ResourceModel')?.name ??
      'i18n',
    views: views.map((v) => ({
      viewName: v.viewName,
      path: v.path,
      controllerName: v.parsed.controllerName,
      viewId: targetsByView.get(v.viewName)?.viewId ?? null,
      routes: (manifest?.routes ?? [])
        .filter((r) => r.viewNames.includes(v.viewName))
        .map((r) => r.name),
      nestedViews: v.parsed.viewRefs.map((r) => r.name),
    })),
    fragments: fragments.map((f) => ({
      fragmentName: f.fragmentName,
      path: f.path,
      hosts: hosts.get(f.fragmentName),
    })),
    routes: manifest?.routes ?? [],
    controllers: controllers.map((c) => ({
      controllerName: c.controllerName,
      path: c.path,
      methods: c.methods.map(({ name, async, params }) => ({ name, async, params })),
      navigations: c.navigations,
      fragments: c.fragments,
    })),
    controls: controls.filter(keep),
    warnings,
  }
}

/** Fast lookups over a (stored) inventory. */
export function indexInventory(inventory) {
  const byLocalId = new Map()
  const byViewId = new Map()
  for (const c of inventory.controls) {
    if (!c.localId) continue
    if (!byLocalId.has(c.localId)) byLocalId.set(c.localId, [])
    byLocalId.get(c.localId).push(c)
  }
  for (const v of inventory.views) if (v.viewId) byViewId.set(v.viewId, v.viewName)
  return { byLocalId, byViewId }
}
