// OData and other services: the external services of cds.requires (S/4HANA APIs, custom services), the data sources of
// the UI apps, and direct calls in code. Version (V2 / V4), service name and the destination in front are the facts a
// person needs when "the service is not active" or "the destination points to the wrong system".
import { asArray, dirname, isCode, isObject, lineOf, matches } from '../util.js'
import { activationSteps, serviceNameOf, systemType, versionOfPath } from '../knowledge/s4.js'
import { addDestination } from './destinations.js'
import { appManifests, cdsConfigs, resolvePath, routeFor, xsAppRoutes } from './parsed.js'

const CORE = new Set([
  'db',
  'auth',
  'messaging',
  'multitenancy',
  'extensibility',
  'toggles',
  'audit-log',
  'ord',
  'queue',
  'outbox',
  'telemetry',
  'html5-repo',
  'attachments',
  'destinations',
  'connectivity',
])

const versionOfKind = (kind) =>
  /v2/i.test(kind) ? 'v2' : /v4/i.test(kind) || kind === 'odata' ? 'v4' : undefined
const label = (v) => (v ? v.toUpperCase() : '')
const MODEL_EXT = ['.edmx', '.xml', '.csn', '.cds', '.json']

function describe(ctx, { name, path, version, type, destination, detail }) {
  const serviceName = serviceNameOf(path) || name
  const kindText =
    type === 'standard' ? 'Standard S/4HANA API' : type === 'custom' ? 'Custom service' : 'Service'
  return {
    category: 'apis',
    kind: version ? `odata-${version}` : 'service',
    name,
    title: name,
    summary: [
      kindText,
      version && `OData ${label(version)}`,
      destination && `via ${destination}`,
      detail,
    ]
      .filter(Boolean)
      .join(' · '),
    severity: 'high',
    attrs: {
      odataVersion: version && label(version),
      servicePath: path,
      serviceName,
      systemType: type,
      destination,
    },
    verify: activationSteps({ name: serviceName, path, version, type }),
  }
}

export default {
  id: 'apis',
  phase: 'extract',
  run(ctx) {
    const required = new Map() // requires name -> item key

    // cds.requires: the external services of the CAP project
    for (const { file, base, profile, config } of cdsConfigs(ctx)) {
      const requires = config.requires
      if (!isObject(requires)) continue
      for (const [name, cfg] of Object.entries(requires)) {
        if (CORE.has(name) || name.startsWith('cds.') || !isObject(cfg)) continue
        const credentials = isObject(cfg.credentials) ? cfg.credentials : {}
        const kind = String(cfg.kind ?? '')
        const isApi =
          /^(odata|rest|hcql|app-service)/.test(kind) ||
          cfg.model ||
          credentials.destination ||
          credentials.path
        if (!isApi) continue
        const path = credentials.path
        const version = versionOfKind(kind) ?? versionOfPath(path)
        const type = systemType(serviceNameOf(path) || name, path)
        const destination =
          typeof credentials.destination === 'string' ? credentials.destination : undefined
        const line = lineOf(
          file.content,
          new RegExp(`["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*:`),
        )
        const key = ctx.add({
          ...describe(ctx, {
            name,
            path,
            version,
            type,
            destination,
            detail: profile && `profile ${profile}`,
          }),
          source: { path: file.path, line },
        })
        required.set(name, key)
        if (destination)
          ctx.relate(key, addDestination(ctx, destination, { path: file.path, line }))
        if (credentials.url && !destination) {
          const local = /localhost|127\.0\.0\.1/i.test(credentials.url)
          if (!local || profile === 'production')
            ctx.signal(
              key,
              'warning',
              'fixed-url',
              `Uses the fixed URL ${credentials.url} instead of a destination, so it does not follow the landscape (development, test, production).`,
            )
        }
        if (cfg.model) {
          const root = resolvePath(base, cfg.model)
          const found = MODEL_EXT.map((e) => ctx.file(root + e)).find(Boolean)
          if (!found) {
            ctx.signal(
              key,
              'warning',
              'model-missing',
              `The model ${cfg.model} is not in the project. Import it again (cds import) so builds and local runs can use the service.`,
            )
          } else if (found.path.endsWith('.edmx') || found.path.endsWith('.xml')) {
            const edmxVersion = /<edmx:Edmx[^>]*\bVersion="([\d.]+)"/.exec(found.content)?.[1]
            const real = edmxVersion === '4.0' ? 'v4' : edmxVersion === '1.0' ? 'v2' : undefined
            const sets = [...found.content.matchAll(/<EntitySet\b/g)].length
            ctx.add({
              category: 'apis',
              kind: describe(ctx, { name, path, version, type, destination }).kind,
              name,
              attrs: { model: found.path, entitySets: sets || undefined },
              source: { path: found.path },
            })
            if (real && version && real !== version)
              ctx.signal(
                key,
                'error',
                'odata-version-mismatch',
                `cds.requires says OData ${label(version)}, but the imported metadata ${found.path} is OData ${label(real)}. Calls will fail until both agree.`,
              )
          }
        }
      }
    }

    // code that connects to a service by name
    for (const file of ctx.find(isCode)) {
      if (/(^|\/)webapp\//.test(file.path)) continue
      for (const { m, line } of matches(
        file.content,
        /cds\.connect\.to\(\s*['"`]([\w.\-]+)['"`]/g,
      )) {
        const name = m[1]
        if (CORE.has(name) || name.includes('.')) continue
        if (required.has(name))
          ctx.add({
            ...describe(ctx, { name }),
            kind: ctx.get(required.get(name)).kind,
            source: { path: file.path, line },
          })
        else {
          const key = ctx.add({
            category: 'apis',
            kind: 'service',
            name,
            title: name,
            summary: 'Connected to in code',
            severity: 'high',
            source: { path: file.path, line },
            verify: [
              `Find out which system "${name}" is and add it to cds.requires (or the code fails with "service not found").`,
            ],
          })
          ctx.signal(
            key,
            'warning',
            'not-configured',
            `The code connects to "${name}", but cds.requires has no entry with that name.`,
          )
        }
      }
    }

    // direct calls to a service path
    const direct = /['"`](\/sap\/opu\/odata4?\/[\w./;=\-]+)/g
    for (const file of ctx.find(isCode)) {
      for (const { m, line } of matches(file.content, direct)) {
        const root = '/' + m[1].split('/').filter(Boolean).slice(0, 5).join('/')
        const version = versionOfPath(root)
        const type = systemType(serviceNameOf(root), root)
        ctx.add({
          ...describe(ctx, { name: root, path: root, version, type, detail: 'called from code' }),
          kind: 'direct-call',
          source: { path: file.path, line },
        })
      }
    }

    // the OData data sources of the UI apps, and the route that carries them
    for (const { file, doc } of appManifests(ctx)) {
      const appId = doc['sap.app'].id
      for (const [dsName, ds] of Object.entries(doc['sap.app'].dataSources ?? {})) {
        if (!isObject(ds) || (ds.type && ds.type !== 'OData') || typeof ds.uri !== 'string')
          continue
        const v = String(ds.settings?.odataVersion ?? '2.0').startsWith('4') ? 'v4' : 'v2'
        const key = ctx.add({
          category: 'apis',
          kind: 'datasource',
          name: `${appId}/${dsName}`,
          title: dsName,
          summary: `Data source of ${appId} · OData ${label(v)} · ${ds.uri}`,
          severity: 'normal',
          source: { path: file.path, line: lineOf(file.content, `"${dsName}"`) },
          attrs: { odataVersion: label(v), uri: ds.uri, app: appId },
          verify: [
            `Open the app and check in the browser network tab that ${ds.uri} answers 200 (the first request of the app).`,
          ],
        })
        if (ds.uri.startsWith('/')) {
          const route = routeFor(ctx, ds.uri)
          if (route?.destination)
            ctx.relate(key, addDestination(ctx, route.destination, { path: route.file.path }))
          else if (!route && xsAppRoutes(ctx).length)
            ctx.signal(
              key,
              'warning',
              'no-route',
              `No route in xs-app.json matches ${ds.uri}, so the approuter will answer 404 for this data source.`,
            )
        }
      }
    }
  },
}
