// The project files that several extractors read, parsed once per scan.
import { asArray, basename, dirname, isObject } from '../util.js'

/** "a/b" + "../c" -> "a/c"; "./x" -> "x". Paths of the project have forward slashes and no leading slash. */
export function resolvePath(dir, rel) {
  const out = dir ? dir.split('/') : []
  for (const seg of String(rel).replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** Every mta.yaml: [{file, doc}] */
export const mtaDocs = (ctx) =>
  ctx.once('mta', () =>
    ctx
      .find((p) => /(^|\/)mta\.ya?ml$/.test(p))
      .map((file) => ({ file, doc: ctx.yaml(file) }))
      .filter((d) => isObject(d.doc)),
  )

/** Every mta extension descriptor (values per environment): [{file, doc}] */
export const mtaExtensions = (ctx) =>
  ctx.once('mtaext', () =>
    ctx
      .find((p) => /\.mtaext$/.test(p))
      .map((file) => ({ file, doc: ctx.yaml(file) }))
      .filter((d) => isObject(d.doc)),
  )

/** The CAP configuration of the project: package.json "cds" and .cdsrc.json, with the profile blocks ("[production]"). */
export const cdsConfigs = (ctx) =>
  ctx.once('cds', () => {
    const out = []
    for (const file of ctx.find((p) => /(^|\/)(package\.json|\.cdsrc\.json)$/.test(p))) {
      const json = ctx.json(file)
      const root = basename(file.path) === 'package.json' ? json?.cds : json
      if (!isObject(root)) continue
      const base = dirname(file.path)
      out.push({ file, base, profile: '', config: root })
      for (const [k, v] of Object.entries(root)) {
        const m = /^\[(.+)\]$/.exec(k)
        if (m && isObject(v)) out.push({ file, base, profile: m[1], config: v })
      }
    }
    return out
  })

/** The routes of every xs-app.json: [{file, source, regex, destination, service, target, scope, authenticationType}] */
export const xsAppRoutes = (ctx) =>
  ctx.once('xsapp', () => {
    const routes = []
    for (const file of ctx.find((p) => /(^|\/)xs-app\.json$/.test(p))) {
      const json = ctx.json(file)
      for (const r of asArray(json?.routes)) {
        if (!isObject(r) || typeof r.source !== 'string') continue
        let regex
        try {
          regex = new RegExp(r.source)
        } catch {
          /* a route the approuter would refuse; reported by the destination extractor */
        }
        routes.push({ file, regex, ...r })
      }
    }
    return routes
  })

/** The first route whose source matches a path. */
export const routeFor = (ctx, path) => xsAppRoutes(ctx).find((r) => r.regex?.test(path))

/** The manifest.json files that belong to a UI5 app (they have sap.app.id). */
export const appManifests = (ctx) =>
  ctx.once('manifests', () =>
    ctx
      .find((p) => /(^|\/)manifest\.json$/.test(p))
      .map((file) => ({ file, doc: ctx.json(file) }))
      .filter((d) => isObject(d.doc) && isObject(d.doc['sap.app']) && d.doc['sap.app'].id),
  )

/** The xs-security.json files: [{file, doc}] */
export const xsSecurityDocs = (ctx) =>
  ctx.once('xssec', () =>
    ctx
      .find((p) => /(^|\/)xs-security\.json$/.test(p))
      .map((file) => ({ file, doc: ctx.json(file) }))
      .filter((d) => isObject(d.doc)),
  )
