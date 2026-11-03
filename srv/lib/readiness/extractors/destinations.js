// Destinations: where the project defines them (mta.yaml, approuter) and where it uses them (xs-app.json, code).
// Where a destination points to cannot be read from the project when it lives in BTP, so a person fills that in.
import { asArray, isCode, isObject, isPlaceholder, lineOf, matches } from '../util.js'
import { mtaDocs, xsAppRoutes } from './parsed.js'

export const DESTINATION_FIELDS = [
  {
    id: 'target',
    label: 'Should point to',
    hint: 'System, client and host this destination must reach in this landscape',
  },
]

export const destinationVerify = (name) => [
  `BTP cockpit > Connectivity > Destinations: "${name}" exists (subaccount level, or in the destination service instance the app is bound to).`,
  'Press "Check Connection". For an on-premise system the Cloud Connector must be connected and expose the virtual host.',
  'URL, sap-client and authentication point to the system of THIS landscape (development, test or production), not the one the app was built against.',
]

export function addDestination(ctx, name, source, extra = {}) {
  return ctx.add({
    category: 'destinations',
    kind: 'destination',
    name,
    title: name,
    severity: 'high',
    source,
    fields: DESTINATION_FIELDS,
    verify: destinationVerify(name),
    ...extra,
  })
}

const PASSWORD_KEYS = [
  'Password',
  'password',
  'clientSecret',
  'ClientSecret',
  'tokenServicePassword',
]

export default {
  id: 'destinations',
  phase: 'extract',
  run(ctx) {
    // defined in mta.yaml: the destination service (init_data) and the approuter module
    for (const { file, doc } of mtaDocs(ctx)) {
      for (const r of asArray(doc.resources)) {
        const init = r?.parameters?.config?.init_data
        for (const level of ['instance', 'subaccount']) {
          for (const d of asArray(init?.[level]?.destinations)) {
            const name = d?.Name ?? d?.name
            if (!name) continue
            const line = lineOf(
              file.content,
              new RegExp(`Name:\\s*['"]?${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
            )
            const url = d.URL ?? d.url
            const key = addDestination(
              ctx,
              name,
              { path: file.path, line },
              {
                summary: [url, d.Authentication, d.ProxyType].filter(Boolean).join(' · '),
                attrs: {
                  url,
                  authentication: d.Authentication,
                  proxyType: d.ProxyType,
                  destinationType: d.Type,
                  sapClient: d['sap-client'] ?? d.sapClient,
                  definedIn: 'project',
                },
              },
            )
            if (url && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url))
              ctx.signal(
                key,
                'warning',
                'localhost',
                `The URL ${url} points to the local machine. It cannot work after a deployment.`,
              )
            for (const k of PASSWORD_KEYS)
              if (d[k] && !isPlaceholder(d[k]))
                ctx.signal(
                  key,
                  'warning',
                  'secret-in-repo',
                  `${k} is written into ${file.path}. Keep secrets out of the repository (create the destination in BTP, or use a placeholder).`,
                )
          }
        }
      }
      for (const m of asArray(doc.modules)) {
        let list = m?.properties?.destinations ?? m?.parameters?.env?.destinations
        if (typeof list === 'string') {
          try {
            list = JSON.parse(list)
          } catch {
            list = []
          }
        }
        for (const d of asArray(list)) {
          if (!isObject(d) || !d.name) continue
          addDestination(
            ctx,
            d.name,
            { path: file.path, line: lineOf(file.content, d.name) },
            {
              summary: d.url ? String(d.url) : undefined,
              attrs: { url: d.url, forwardAuthToken: d.forwardAuthToken, definedIn: 'project' },
            },
          )
        }
      }
    }

    // used by the approuter routes
    for (const r of xsAppRoutes(ctx)) {
      if (!r.regex)
        ctx.warn(
          'bad-route',
          `A route in ${r.file.path} has a source that is not a valid expression: ${r.source}`,
          r.file.path,
        )
      if (!r.destination) continue
      const line = lineOf(r.file.content, r.source)
      const key = addDestination(
        ctx,
        r.destination,
        { path: r.file.path, line },
        { attrs: { routedFrom: r.source } },
      )
      if (r.authenticationType === 'none')
        ctx.signal(
          key,
          'info',
          'public-route',
          `The route ${r.source} has no login (authenticationType none): anyone can call the destination through the approuter.`,
        )
    }

    // used by code
    const patterns = [
      /destinationName\s*[:=]\s*['"`]([\w.\-]+)['"`]/g,
      /getDestination\(\s*['"`]([\w.\-]+)['"`]/g,
    ]
    for (const file of ctx.find(isCode)) {
      if (/(^|\/)webapp\//.test(file.path)) continue
      for (const re of patterns)
        for (const { m, line } of matches(file.content, re))
          addDestination(ctx, m[1], { path: file.path, line })
    }
  },
}
