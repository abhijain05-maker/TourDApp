import cds from '@sap/cds'
import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll } from 'vitest'
import { demoSources } from '../helpers/sources.js'
import { extensionMayCall, isExtensionOrigin } from '../../srv/security.js'
import { hashToken, newToken } from '../../srv/lib/service/tokens.js'

const { GET, POST, axios } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const recording = readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')

const as = (origin, token, method, url, data) =>
  axios.request({
    method,
    url,
    data,
    validateStatus: () => true,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(token ? { 'X-TourD-Token': token } : {}),
    },
  })

describe('extension rules (pure)', () => {
  it('recognises the origin of an extension and nothing that looks like it', () => {
    expect(isExtensionOrigin(EXT)).toBe(true)
    expect(isExtensionOrigin('moz-extension://3f2a-77')).toBe(true)
    expect(isExtensionOrigin('http://chrome-extension://x')).toBe(false)
    expect(isExtensionOrigin('https://evil.example')).toBe(false)
    expect(isExtensionOrigin('null')).toBe(false)
    expect(isExtensionOrigin(undefined)).toBe(false)
  })

  it('lets a paired extension only read projects and tours, send a recording, and fetch a tour to play', () => {
    const id = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
    for (const [m, p] of [
      ['GET', `${BASE}/Projects`],
      ['GET', `${BASE}/Tours`],
      ['GET', `${BASE}/providers()`],
      ['POST', `${BASE}/importRecording`],
      ['POST', `${BASE}/previewRecording`],
      ['GET', '/live/player.js'],
      ['GET', `/live/${id}/tour.json`],
    ])
      expect(extensionMayCall(m, p), `${m} ${p}`).toBe(true)
    for (const [m, p] of [
      ['DELETE', `${BASE}/Projects(${id})`],
      ['GET', `${BASE}/Projects(${id})`],
      ['POST', `${BASE}/Projects`],
      ['POST', `${BASE}/createExtensionToken`],
      ['POST', `${BASE}/importSources`],
      ['POST', `${BASE}/generateTour`],
      ['GET', `${BASE}/Sources`],
      ['GET', `${BASE}/ExtensionTokens`],
      ['GET', `${BASE}/getInventory(projectID=${id})`],
      ['GET', `/export/${id}.zip`],
      ['GET', `/preview/${id}/sandbox.html`],
      ['GET', '/live/../odata/v4/tour/Sources'],
      ['GET', '/live/x/tour.json'],
      ['POST', '/live/player.js'],
    ])
      expect(extensionMayCall(m, p), `${m} ${p}`).toBe(false)
  })

  it('tokens are long, recognisable by their start, and stored as a hash', () => {
    const a = newToken()
    const b = newToken()
    expect(a.token).toMatch(/^tourd_[A-Za-z0-9_-]{32,}$/)
    expect(a.token).not.toBe(b.token)
    expect(a.prefix).toBe(a.token.slice(0, 10))
    expect(a.tokenHash).toBe(hashToken(a.token))
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.tokenHash).not.toContain(a.token)
  })
})

describe('pairing an extension', () => {
  let token
  let tokenID
  let projectID

  beforeAll(async () => {
    const { data } = await POST(`${BASE}/createExtensionToken`, { name: 'Test laptop' })
    ;({ token, ID: tokenID } = data)
    projectID = (await POST(`${BASE}/Projects`, { name: 'Paired' })).data.ID
    await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
  })

  it('shows the token once, and the list never shows it or its hash', async () => {
    expect(token).toMatch(/^tourd_/)
    const list = (await GET(`${BASE}/ExtensionTokens`)).data.value
    const mine = list.find((t) => t.ID === tokenID)
    expect(mine).toMatchObject({ name: 'Test laptop', revoked: false, prefix: token.slice(0, 10) })
    expect(JSON.stringify(list)).not.toContain(token)
    expect(JSON.stringify(list)).not.toContain(hashToken(token))
    expect(Object.keys(mine)).not.toContain('tokenHash')
  })

  it('keeps only the hash in the database', async () => {
    const rows = await cds.run(SELECT.from('tourd.ExtensionTokens').where({ ID: tokenID }))
    expect(rows[0].tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(rows)).not.toContain(token)
  })

  it('needs a name', async () => {
    const r = await POST(`${BASE}/createExtensionToken`, { name: '  ' }).catch((e) => e.response)
    expect(r.status).toBe(400)
  })

  it('turns away an extension without a token, or with one that is not valid', async () => {
    for (const t of [undefined, 'tourd_nope', 'not-even-a-token', 'x'.repeat(500)]) {
      const r = await as(EXT, t, 'get', `${BASE}/Projects`)
      expect(r.status, String(t)).toBe(403)
      expect(r.data).toContain('not paired')
    }
  })

  it('lets a paired extension do what it needs', async () => {
    const projects = await as(EXT, token, 'get', `${BASE}/Projects?$select=ID,name`)
    expect(projects.status).toBe(200)
    expect(projects.data.value.some((p) => p.ID === projectID)).toBe(true)

    expect((await as(EXT, token, 'get', `${BASE}/Tours`)).status).toBe(200)
    expect((await as(EXT, token, 'get', `${BASE}/providers()`)).status).toBe(200)
    expect((await as(EXT, token, 'get', '/live/player.js')).status).toBe(200)

    const sent = await as(EXT, token, 'post', `${BASE}/importRecording`, {
      projectID,
      name: 'From the extension',
      raw: recording,
    })
    expect(sent.status).toBe(200)
    expect(sent.data).toMatchObject({ format: 'tourd-recorder', actionable: 5, mapped: 5 })

    // what a recording would become, without saving it
    const preview = await as(EXT, token, 'post', `${BASE}/previewRecording`, {
      projectID,
      raw: recording,
      kind: 'test',
    })
    expect(preview.status).toBe(200)
    expect(JSON.parse(preview.data.definition).steps.length).toBeGreaterThan(3)
  })

  it('does not let it do anything else, even with a valid token', async () => {
    for (const [m, p, d] of [
      ['delete', `${BASE}/Projects(${projectID})`],
      ['post', `${BASE}/Projects`, { name: 'x' }],
      ['post', `${BASE}/createExtensionToken`, { name: 'another' }],
      ['get', `${BASE}/Sources`],
      ['get', `${BASE}/ExtensionTokens`],
      ['get', `${BASE}/getInventory(projectID=${projectID})`],
    ]) {
      const r = await as(EXT, token, m, p, d)
      expect(r.status, `${m} ${p}`).toBe(403)
      expect(r.data).toContain('may only')
    }
    expect((await GET(`${BASE}/Projects(${projectID})`)).status).toBe(200) // still there
  })

  it('checks the token even when the browser sends no Origin (some requests of an extension have none)', async () => {
    for (const bad of ['tourd_wrong', 'nonsense']) {
      const r = await as(undefined, bad, 'get', `${BASE}/Projects`)
      expect(r.status, bad).toBe(403)
      expect(r.data).toContain('not paired')
    }
    expect((await as(undefined, token, 'get', `${BASE}/Projects`)).status).toBe(200)
    // and a token is only good for what the extension needs, wherever the request comes from
    const wide = await as(undefined, token, 'delete', `${BASE}/Projects(${projectID})`)
    expect(wide.status).toBe(403)
    expect(wide.data).toContain('may only')
  })

  it('does not let a token open the door for other origins', async () => {
    const r = await as('https://evil.example', token, 'post', `${BASE}/importRecording`, {
      projectID,
      raw: recording,
    })
    expect(r.status).toBe(403)
    expect(r.data).toContain('designer itself')
    const nul = await as('null', token, 'get', `${BASE}/Projects`)
    expect(nul.status).toBe(200) // reading from the sandbox frame stays as before: nothing changes
  })

  it('the designer itself and scripts without an Origin are not affected by tokens', async () => {
    expect((await as(undefined, undefined, 'get', `${BASE}/Projects`)).status).toBe(200)
    const own = await as(axios.defaults.baseURL, undefined, 'post', `${BASE}/Projects`, {
      name: 'Own',
    })
    expect(own.status).toBe(201)
  })

  it('remembers when it was last used', async () => {
    const row = (await GET(`${BASE}/ExtensionTokens`)).data.value.find((t) => t.ID === tokenID)
    expect(new Date(row.lastUsedAt).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('stops working when it is revoked', async () => {
    const { data } = await POST(`${BASE}/createExtensionToken`, { name: 'To revoke' })
    expect((await as(EXT, data.token, 'get', `${BASE}/Projects`)).status).toBe(200)
    expect((await POST(`${BASE}/revokeExtensionToken`, { ID: data.ID })).data.value).toBe(true)
    const after = await as(EXT, data.token, 'get', `${BASE}/Projects`)
    expect(after.status).toBe(403)
    expect(after.data).toContain('revoked')
    const missing = await POST(`${BASE}/revokeExtensionToken`, {
      ID: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
    }).catch((e) => e.response)
    expect(missing.status).toBe(404)
  })
})
