import { describe, it, expect } from 'vitest'
import { scan, stampOf, levelOf, EXTRACTORS, meta } from '../../srv/lib/readiness/index.js'
import { createContext } from '../../srv/lib/readiness/context.js'
import { parseJson } from '../../srv/lib/readiness/util.js'
import { readinessProject } from '../helpers/readiness-project.js'

const run = (files = readinessProject()) => scan(files)
const find = (r, key) => r.items.find((i) => i.key === key)
const codes = (item) => item.signals.map((s) => s.code)

describe('readiness scan of a CAP project', () => {
  const r = run()

  it('lists every group of dependencies', () => {
    const categories = new Set(r.items.map((i) => i.category))
    for (const c of ['destinations', 'apis', 'auth', 'workzone', 'bpa', 'btp', 'config'])
      expect(categories.has(c)).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('merges one destination named in several files into one item that knows every place', () => {
    const d = find(r, 'destinations:destination:S4_DEV')
    expect([...new Set(d.sources.map((s) => s.path))].sort()).toEqual([
      'app/router/xs-app.json',
      'mta.yaml',
      'package.json',
    ])
    expect(d.attrs).toMatchObject({
      url: 'https://s4dev.example.com',
      authentication: 'BasicAuthentication',
      definedIn: 'project',
    })
    expect(d.fields.map((f) => f.id)).toContain('target')
  })

  it('shows the links in both directions: the API uses the destination, the destination is used by the API', () => {
    const api = find(r, 'apis:odata-v2:API_BUSINESS_PARTNER')
    expect(api.links).toContainEqual({ key: 'destinations:destination:S4_DEV', rel: 'uses' })
    expect(find(r, 'destinations:destination:S4_DEV').links).toContainEqual({
      key: api.key,
      rel: 'usedBy',
    })
  })

  it('finds an OData version that disagrees with the imported metadata', () => {
    expect(codes(find(r, 'apis:odata-v4:ZLEAVE_SRV'))).toContain('odata-version-mismatch')
    expect(codes(find(r, 'apis:odata-v2:API_BUSINESS_PARTNER'))).not.toContain(
      'odata-version-mismatch',
    )
  })

  it('tells a standard S/4HANA API from a custom service and gives the activation steps', () => {
    const api = find(r, 'apis:odata-v2:API_BUSINESS_PARTNER')
    expect(api.attrs).toMatchObject({
      odataVersion: 'V2',
      systemType: 'standard',
      serviceName: 'API_BUSINESS_PARTNER',
    })
    expect(api.verify.join('\n')).toMatch(/IWFND\/MAINT_SERVICE/)
    expect(api.verify.join('\n')).toMatch(/SAP_COM_0008/)
    const custom = find(r, 'apis:odata-v4:ZLEAVE_SRV')
    expect(custom.attrs.systemType).toBe('custom')
    expect(custom.verify.join('\n')).toMatch(/IWFND\/V4_ADMIN/)
    expect(custom.verify.join('\n')).toMatch(/custom service/)
  })

  it('warns about a fixed URL and a service the code uses but cds.requires does not know', () => {
    expect(codes(find(r, 'apis:odata-v2:PRICES'))).toContain('fixed-url')
    expect(codes(find(r, 'apis:service:MISSING_SVC'))).toContain('not-configured')
  })

  it('finds direct calls to a service path', () => {
    const call = find(r, 'apis:direct-call:/sap/opu/odata/sap/API_PRODUCT_SRV')
    expect(call.sources[0]).toMatchObject({ path: 'srv/handler.js' })
    expect(call.attrs.systemType).toBe('standard')
  })

  it('finds a UI data source without a route in xs-app.json, and follows the one that has one', () => {
    expect(codes(find(r, 'apis:datasource:acme.leave/lostService'))).toContain('no-route')
    const ok = find(r, 'apis:datasource:acme.leave/mainService')
    expect(ok.signals).toEqual([])
    expect(ok.links).toContainEqual({ key: 'destinations:destination:srv-api', rel: 'uses' })
  })

  it('flags a secret in mta.yaml, a localhost destination and a public route', () => {
    expect(codes(find(r, 'destinations:destination:S4_DEV'))).toEqual(
      expect.arrayContaining(['secret-in-repo', 'public-route']),
    )
    expect(codes(find(r, 'destinations:destination:BPA_RUNTIME'))).toContain('localhost')
  })

  it('finds a role the code asks for that xs-security.json does not define', () => {
    const auditor = find(r, 'auth:scope:Auditor')
    expect(auditor.signals.find((s) => s.code === 'undefined-scope').level).toBe('error')
    expect(find(r, 'auth:scope:Admin').signals).toEqual([])
    expect(find(r, 'auth:scope:Viewer').sources.map((s) => s.path)).toEqual(
      expect.arrayContaining(['xs-security.json', 'srv/service.cds', 'app/router/xs-app.json']),
    )
  })

  it('does not treat pseudo roles as roles, and notes a scope nobody asks for', () => {
    expect(r.items.find((i) => i.name === 'authenticated-user')).toBeUndefined()
    expect(codes(find(r, 'auth:scope:Unused'))).toContain('unused-scope')
  })

  it('builds role template and role collection links', () => {
    const rc = find(r, 'auth:role-collection:Leave Admin')
    expect(rc.links).toContainEqual({ key: 'auth:role-template:Admin', rel: 'uses' })
    expect(rc.fields.map((f) => f.id)).toContain('assignedTo')
  })

  it('reads Work Zone intents and warns when sap.cloud.service is missing', () => {
    const inbound = find(r, 'workzone:inbound:Leave-manage (acme.leave)')
    expect(inbound.title).toBe('#Leave-manage')
    expect(codes(find(r, 'workzone:app:acme.leave'))).toContain('no-cloud-service')
    expect(find(r, 'workzone:site:work-zone-site').verify.length).toBeGreaterThan(2)
  })

  it('finds the process, the workflow API and a service the deployment does not create', () => {
    expect(find(r, 'bpa:process:eu10.acme.leave.process')).toBeTruthy()
    expect(find(r, 'bpa:api:workflow-api').links).toContainEqual({
      key: 'bpa:process:eu10.acme.leave.process',
      rel: 'uses',
    })
    expect(codes(find(r, 'bpa:service-instance:leave-bpa'))).toContain('existing-service')
  })

  it('lists environment variables, with and without default, and what mta.yaml sets', () => {
    expect(find(r, 'config:env:BPA_PROCESS_ID').attrs.setIn).toBe('mta.yaml')
    expect(find(r, 'config:env:MODE').severity).toBe('low')
    expect(codes(find(r, 'config:env:LEAVE_API_KEY'))).toContain('not-in-mta')
    expect(r.items.find((i) => i.name === 'NODE_ENV')).toBeUndefined()
  })

  it('sorts the high priority items of a category first', () => {
    const apis = r.items.filter((i) => i.category === 'apis')
    const rank = { high: 0, normal: 1, low: 2 }
    expect(apis.map((i) => rank[i.severity])).toEqual([...apis.map((i) => rank[i.severity])].sort())
  })

  it('names the worst finding of an item', () => {
    expect(levelOf(find(r, 'apis:odata-v4:ZLEAVE_SRV').signals)).toBe('error')
    expect(levelOf(find(r, 'auth:scope:Admin').signals)).toBe('')
    expect(levelOf([{ level: 'info' }, { level: 'warning' }])).toBe('warning')
  })
})

describe('readiness scan: robustness', () => {
  it('reads a project with nothing to find', () => {
    const r = run([
      { path: 'README.md', content: '# hi' },
      { path: 'src/a.js', content: 'const a = 1' },
    ])
    expect(r.items).toEqual([])
  })

  it('skips a file it cannot parse, says so, and still reads the others', () => {
    const files = [
      ...readinessProject().filter((f) => f.path !== 'xs-security.json'),
      { path: 'xs-security.json', content: '{ not json' },
    ]
    const r = run(files)
    expect(r.warnings.map((w) => w.code)).toContain('unreadable-file')
    expect(find(r, 'destinations:destination:S4_DEV')).toBeTruthy()
  })

  it('accepts comments and trailing commas in JSON', () => {
    expect(parseJson('{ // c\n "a": [1,2,], /* x */ "b": "//not a comment", }')).toEqual({
      a: [1, 2],
      b: '//not a comment',
    })
  })

  it('does not let one broken extractor hide the others', () => {
    const broken = {
      id: 'broken',
      phase: 'extract',
      run: () => {
        throw new Error('boom')
      },
    }
    const r = scan(readinessProject(), { extractors: [broken, ...EXTRACTORS] })
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'extractor-failed' }))
    expect(r.items.length).toBeGreaterThan(10)
  })

  it('takes a new extractor without any other change (the extension point)', () => {
    const extra = {
      id: 'readme',
      phase: 'extract',
      run: (ctx) => {
        for (const f of ctx.find(/^package\.json$/))
          ctx.add({
            category: 'other',
            kind: 'doc',
            name: f.path,
            source: { path: f.path },
            signals: [{ level: 'info', code: 'x', message: 'y' }],
          })
      },
    }
    const r = scan(readinessProject(), { extractors: [...EXTRACTORS, extra] })
    expect(levelOf(find(r, 'other:doc:package.json').signals)).toBe('info')
  })

  it('refuses a category that does not exist', () => {
    const ctx = createContext([])
    expect(() => ctx.add({ category: 'nope', kind: 'x', name: 'y' })).toThrow(
      /Unknown readiness category/,
    )
  })

  it('has a fingerprint that follows the files', () => {
    const a = [{ path: 'mta.yaml', content: 'a', hash: '1' }]
    expect(stampOf(a)).toBe(stampOf([...a]))
    expect(stampOf(a)).not.toBe(stampOf([{ path: 'mta.yaml', content: 'a', hash: '2' }]))
    expect(stampOf(a)).toBe(stampOf([...a, { path: 'logo.png', content: 'x', hash: '9' }]))
  })

  it('describes categories and answers for the designer', () => {
    const m = meta()
    expect(m.categories.map((c) => c.id)).toContain('destinations')
    expect(m.statuses.map((s) => s.id)).toEqual(['open', 'working', 'broken', 'na'])
  })
})
