// Authorization: what xs-security.json defines (scopes, role templates, role collections), where the code asks for a
// role (@requires, @restrict, user.is, route scopes) and how login is set up. A role that is asked for but not defined
// is a finding by itself: it is the "403 for everybody" or "scope not found" that costs hours.
import { asArray, isCode, isObject, lineOf, matches, roleName } from '../util.js'
import { cdsConfigs, xsAppRoutes, xsSecurityDocs } from './parsed.js'

const PSEUDO = new Set([
  'any',
  'authenticated-user',
  'system-user',
  'internal-user',
  'identified-user',
  'privileged',
  'anonymous',
  'user',
])
const quoted = (text) => [...String(text).matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])

export default {
  id: 'auth',
  phase: 'extract',
  run(ctx) {
    const docs = xsSecurityDocs(ctx)
    ctx.shared.hasXsSecurity = docs.length > 0

    for (const { file, doc } of docs) {
      const at = (needle) => ({ path: file.path, line: lineOf(file.content, needle) })
      if (doc.xsappname)
        ctx.add({
          category: 'auth',
          kind: 'application',
          name: doc.xsappname,
          title: doc.xsappname,
          summary: [
            'XSUAA application name',
            doc['tenant-mode'] && `tenant mode ${doc['tenant-mode']}`,
          ]
            .filter(Boolean)
            .join(' · '),
          severity: 'normal',
          source: at('xsappname'),
          attrs: { tenantMode: doc['tenant-mode'] },
          verify: [
            'The XSUAA instance was created or updated from this file (cf service <name> shows the same xsappname).',
          ],
        })
      for (const s of asArray(doc.scopes)) {
        if (!s?.name) continue
        ctx.add({
          category: 'auth',
          kind: 'scope',
          name: roleName(s.name),
          title: roleName(s.name),
          summary: s.description ?? 'Scope',
          severity: 'high',
          source: at(s.name),
          attrs: {
            scope: s.name,
            grantedApps: asArray(s['grant-as-authority-to-apps']).join(', ') || undefined,
          },
          verify: [
            'The scope exists in the XSUAA instance (BTP cockpit > the instance > Application Roles / Scopes).',
          ],
        })
      }
      for (const t of asArray(doc['role-templates'])) {
        if (!t?.name) continue
        const key = ctx.add({
          category: 'auth',
          kind: 'role-template',
          name: t.name,
          title: t.name,
          summary: t.description ?? 'Role template',
          severity: 'normal',
          source: at(`"${t.name}"`),
          attrs: { scopes: asArray(t['scope-references']).map(roleName).join(', ') || undefined },
          verify: [
            'The template exists in the XSUAA instance. After a change to the file the instance must be updated.',
          ],
        })
        for (const s of asArray(t['scope-references'])) ctx.relate(key, `auth:scope:${roleName(s)}`)
      }
      for (const rc of asArray(doc['role-collections'])) {
        if (!rc?.name) continue
        const key = ctx.add({
          category: 'auth',
          kind: 'role-collection',
          name: rc.name,
          title: rc.name,
          summary: rc.description ?? 'Role collection',
          severity: 'high',
          source: at(`"${rc.name}"`),
          fields: [
            {
              id: 'assignedTo',
              label: 'Assigned to',
              hint: 'Users or groups that have this role collection (include the person who tests)',
            },
          ],
          verify: [
            'BTP cockpit > Security > Role Collections: it exists (it is only created when the XSUAA instance was created or updated with this file).',
            'It is assigned to the users who must use the app (Users > Role Collections), and to nobody else.',
          ],
        })
        for (const t of asArray(rc['role-template-references']))
          ctx.relate(key, `auth:role-template:${roleName(t)}`)
      }
      for (const f of asArray(doc['foreign-scope-references'])) {
        ctx.add({
          category: 'auth',
          kind: 'foreign-scope',
          name: roleName(f),
          title: String(f),
          summary: 'Scope of another application this app calls',
          severity: 'high',
          source: at(f),
          verify: [
            'The other application is deployed in this subaccount and grants this scope to this app (grant-as-authority-to-apps in its xs-security.json).',
          ],
        })
      }
      const oauth = doc['oauth2-configuration']
      if (isObject(oauth)) {
        const uris = asArray(oauth['redirect-uris'])
        const key = ctx.add({
          category: 'auth',
          kind: 'oauth2',
          name: 'oauth2-configuration',
          title: 'OAuth 2 configuration',
          summary: uris.length ? `${uris.length} redirect URI(s)` : 'No redirect URIs',
          severity: 'low',
          source: at('oauth2-configuration'),
          attrs: {
            redirectUris: uris.join(', ') || undefined,
            tokenValidity: oauth['token-validity'],
          },
          verify: [
            'The redirect URIs contain the address users really open (approuter or Work Zone URL of this landscape).',
          ],
        })
        if (uris.some((u) => /localhost/.test(u)))
          ctx.signal(
            key,
            'info',
            'localhost-redirect',
            'A redirect URI points to localhost. Fine for development; remove it for production.',
          )
      }
    }

    // where the code asks for a role
    const used = new Map() // role -> [{path, line}]
    const use = (role, path, line) => {
      if (!role || PSEUDO.has(role)) return
      const r = roleName(role)
      if (!used.has(r)) used.set(r, [])
      used.get(r).push({ path, line })
    }
    const cdsFiles = ctx.find((p) => /\.cds$/.test(p))
    for (const file of cdsFiles) {
      for (const { m, line } of matches(
        file.content,
        /@\(?\s*requires\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g,
      ))
        quoted(m[1]).forEach((r) => use(r, file.path, line))
      for (const { m, line } of matches(file.content, /\bto\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g))
        quoted(m[1]).forEach((r) => use(r, file.path, line))
    }
    for (const file of ctx.find(isCode)) {
      if (/(^|\/)webapp\//.test(file.path)) continue
      for (const { m, line } of matches(file.content, /\buser\.is\(\s*['"`]([^'"`]+)['"`]/g))
        use(m[1], file.path, line)
    }
    for (const r of xsAppRoutes(ctx)) {
      const scopes =
        typeof r.scope === 'string'
          ? [r.scope]
          : Array.isArray(r.scope)
            ? r.scope
            : isObject(r.scope)
              ? Object.values(r.scope).flat()
              : []
      for (const s of scopes) use(s, r.file.path, lineOf(r.file.content, r.source))
    }
    for (const [role, places] of used) {
      const key = ctx.add({
        category: 'auth',
        kind: 'scope',
        name: role,
        title: role,
        summary: 'Role the project asks for',
        severity: 'high',
        source: places[0],
        verify: ['A role collection that contains this role is assigned to the user who tests.'],
      })
      places
        .slice(1)
        .forEach((p) => ctx.add({ category: 'auth', kind: 'scope', name: role, source: p }))
      ctx.get(key).attrs.usedInProject = true
    }

    // how users log in, per profile
    for (const { file, profile, config } of cdsConfigs(ctx)) {
      const auth = config.requires?.auth
      const kind = typeof auth === 'string' ? auth : auth?.kind
      if (!kind) continue
      const key = ctx.add({
        category: 'auth',
        kind: 'login',
        name: profile || 'default',
        title: `Login (${profile || 'default'} profile)`,
        summary: `Strategy ${kind}`,
        severity: 'high',
        source: { path: file.path, line: lineOf(file.content, '"auth"') },
        attrs: { strategy: kind, profile: profile || 'default' },
        verify:
          kind === 'ias'
            ? [
                'The app is registered in the Identity Authentication tenant and the tenant is trusted in this subaccount.',
              ]
            : kind === 'xsuaa'
              ? ['An XSUAA instance is bound to the app (see the BTP services).']
              : [],
      })
      if (['mocked', 'dummy', 'basic'].includes(kind) && profile === 'production')
        ctx.signal(
          key,
          'error',
          'weak-auth',
          `The production profile uses "${kind}" login. Anyone can use the app.`,
        )
    }
  },
}
