// manifest.json: app id, UI5 version, i18n, routing (routes, targets, full view names).

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v])

function targetNames(route) {
  return asArray(route.target)
    .map((t) => (typeof t === 'string' ? t : t?.name))
    .filter(Boolean)
}

function patternParams(pattern) {
  const names = []
  for (const m of String(pattern ?? '').matchAll(/\{([^}]+)\}|:([^:]+):/g)) {
    const raw = m[1] ?? m[2]
    if (raw.startsWith('?')) continue // query parameters are not part of the path
    names.push(raw.replace(/[*?]$/, ''))
  }
  return names
}

/** Normalises a manifest.json (string or object). */
export function parseManifest(input) {
  const m = typeof input === 'string' ? JSON.parse(input) : input
  const app = m['sap.app'] ?? {}
  const ui5 = m['sap.ui5'] ?? {}
  const routing = ui5.routing ?? {}
  const config = routing.config ?? {}

  const models = Object.entries(ui5.models ?? {}).map(([name, cfg]) => ({
    name,
    type: cfg.type ?? null,
    bundleName: cfg.settings?.bundleName ?? null,
    dataSource: cfg.dataSource ?? null,
  }))

  const targets = {}
  for (const [name, t] of Object.entries(routing.targets ?? {})) {
    const viewName = t.viewName ?? t.name ?? null
    const viewPath = t.viewPath ?? t.path ?? config.viewPath ?? config.path ?? null
    targets[name] = {
      name,
      viewName: viewName && viewPath ? `${viewPath}.${viewName}` : viewName,
      viewId: t.viewId ?? t.id ?? null,
      viewLevel: t.viewLevel ?? null,
    }
  }

  const routes = asArray(routing.routes).map((r) => {
    const names = targetNames(r)
    return {
      name: r.name,
      pattern: r.pattern ?? '',
      params: patternParams(r.pattern),
      targets: names,
      viewNames: names.map((n) => targets[n]?.viewName).filter(Boolean),
    }
  })

  const rootView =
    typeof ui5.rootView === 'string'
      ? { viewName: ui5.rootView, id: null }
      : ui5.rootView
        ? { viewName: ui5.rootView.viewName ?? null, id: ui5.rootView.id ?? null }
        : null

  return {
    appId: app.id ?? null,
    minUI5Version: ui5.dependencies?.minUI5Version ?? null,
    libs: Object.keys(ui5.dependencies?.libs ?? {}),
    i18nPath: typeof app.i18n === 'string' ? app.i18n : (app.i18n?.bundleUrl ?? null),
    models,
    rootView,
    routes,
    targets,
    resourceRoots: ui5.resourceRoots ?? {},
  }
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function patternToRegex(pattern) {
  const parts = pattern.split(/(\{[^}]+\}|\/?:[^:]+:)/).map((seg) => {
    if (/^\{[^}]+\}$/.test(seg)) {
      const inner = seg.slice(1, -1)
      if (inner.startsWith('?')) return '' // query parameters are matched separately
      return inner.endsWith('*') ? '(.+)' : '([^/]+)'
    }
    if (/^\/?:[^:]+:$/.test(seg)) {
      const slash = seg.startsWith('/')
      if (seg.slice(slash ? 1 : 0).startsWith(':?')) return ''
      // "list/:filter:" also matches "list": an optional segment takes its slash with it
      return slash ? '(?:/([^/]*))?' : '([^/]*)'
    }
    return escapeRegex(seg)
  })
  return new RegExp(`^${parts.join('')}/?$`)
}

const normalizeHash = (h) =>
  String(h ?? '')
    .replace(/^#/, '')
    .replace(/^\//, '')
    .replace(/\?.*$/, '')

/** Finds the route matching a router hash such as "order/42"; returns { route, args } or null. */
export function matchRoute(routes, hash) {
  const h = normalizeHash(hash)
  for (const route of routes) {
    const m = patternToRegex(route.pattern).exec(h)
    if (m) {
      const args = {}
      route.params.forEach((n, i) => {
        if (m[i + 1] !== undefined && m[i + 1] !== '') args[n] = m[i + 1]
      })
      return { route, args }
    }
  }
  return null
}

export { normalizeHash }
