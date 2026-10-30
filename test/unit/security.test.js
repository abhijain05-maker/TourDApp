import cds from '@sap/cds'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { demoSources } from '../helpers/sources.js'
import { registerProvider } from '../../srv/lib/llm/provider.js'
import { scrub, secretValues } from '../../srv/lib/llm/secrets.js'
import { allowedHosts, hostnameOf, refusal } from '../../srv/security.js'
import { friendlyGeminiError } from '../../srv/lib/llm/gemini.js'
import { friendlySapError } from '../../srv/lib/llm/sap-ai-core.js'

const { GET, POST, axios } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const raw = (method, path, config = {}) =>
  axios.request({ method, url: path, validateStatus: () => true, ...config })

/** A request with a Host header of our choice (an HTTP client library would insist on the real one). */
const withHost = (host, path) =>
  new Promise((resolve, reject) => {
    const { port } = new URL(axios.defaults.baseURL)
    http
      .get({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode, data: body }))
      })
      .on('error', reject)
  })

const GEMINI = 'AIzaSyD-test-key-0123456789abcdefghijkl'
const SERVICE_KEY = {
  clientid: 'sb-clone-abc',
  clientsecret: 'p4ssw0rd-very-secret-value$xyz',
  url: 'https://auth.example.com',
  serviceurls: { AI_API_URL: 'https://api.ai.example.com' },
}

describe('host and origin guard (pure)', () => {
  const req = (host, method = 'GET', origin) => ({ headers: { host, origin }, method })

  it('reads the host name out of a Host header', () => {
    expect(hostnameOf('localhost:4044')).toBe('localhost')
    expect(hostnameOf('LOCALHOST')).toBe('localhost')
    expect(hostnameOf('[::1]:4044')).toBe('::1')
    expect(hostnameOf('127.0.0.1:80')).toBe('127.0.0.1')
    expect(hostnameOf(undefined)).toBe('')
  })

  it('answers for loopback names only, unless told otherwise', () => {
    for (const h of ['localhost:4044', '127.0.0.1:4044', '[::1]:4044'])
      expect(refusal(req(h), {}), h).toBeNull()
    expect(refusal(req('evil.example'), {})).toMatch(/TOURD_ALLOWED_HOSTS=evil.example/)
    expect(refusal(req('tourd.corp:8080'), { TOURD_ALLOWED_HOSTS: 'tourd.corp, other' })).toBeNull()
    expect(refusal(req('anything.at.all'), { TOURD_ALLOWED_HOSTS: '*' })).toBeNull()
    expect(allowedHosts({ TOURD_ALLOWED_HOSTS: '*' }).all).toBe(true)
  })

  it('lets reads through from anywhere but changes only from TourD itself', () => {
    const host = 'localhost:4044'
    expect(refusal(req(host, 'GET', 'http://evil.example'), {})).toBeNull()
    expect(refusal(req(host, 'POST'), {})).toBeNull() // no Origin: a script, curl
    expect(refusal(req(host, 'POST', `http://${host}`), {})).toBeNull()
    expect(refusal(req(host, 'POST', 'http://evil.example'), {})).toMatch(/designer itself/)
    expect(refusal(req(host, 'DELETE', 'http://localhost:5173'), {})).toMatch(/designer itself/) // other port = other site
    expect(refusal(req(host, 'PATCH', 'null'), {})).toMatch(/designer itself/) // the sandbox frame
    expect(refusal(req(host, 'POST', 'not a url'), {})).toMatch(/designer itself/)
  })
})

describe('host and origin guard (over HTTP)', () => {
  it('turns away a Host it does not know, even for reads', async () => {
    const r = await withHost('evil.example', `${BASE}/providers()`)
    expect(r.status).toBe(403)
    expect(r.data).toContain('TOURD_ALLOWED_HOSTS')
    expect((await withHost('localhost', `${BASE}/providers()`)).status).toBe(200)
    expect((await raw('get', `${BASE}/providers()`)).status).toBe(200)
  })

  it('refuses a change that comes from another site or from the sandbox frame', async () => {
    const before = (await GET(`${BASE}/Projects`)).data.value.length
    for (const origin of ['http://evil.example', 'null']) {
      const r = await raw('post', `${BASE}/Projects`, {
        data: { name: 'X' },
        headers: { Origin: origin },
      })
      expect(r.status, origin).toBe(403)
    }
    expect((await GET(`${BASE}/Projects`)).data.value.length).toBe(before)

    const ok = await raw('post', `${BASE}/Projects`, {
      data: { name: 'From the designer' },
      headers: { Origin: axios.defaults.baseURL },
    })
    expect(ok.status).toBe(201)
  })

  it('sets headers that stop sniffing, referrers and framing by other sites', async () => {
    const r = await raw('get', `${BASE}/providers()`)
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    expect(r.headers['content-security-policy']).toBe("frame-ancestors 'self'")
    expect(r.headers['x-powered-by']).toBeUndefined()
  })
})

describe('credentials stay on the server', () => {
  const saved = { ...process.env }
  beforeAll(() => {
    process.env.GEMINI_API_KEY = GEMINI
    process.env.AICORE_SERVICE_KEY = JSON.stringify(SERVICE_KEY)
  })
  afterAll(() => {
    for (const k of ['GEMINI_API_KEY', 'AICORE_SERVICE_KEY'])
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
  })

  it('scrub masks the values of the secret variables, also inside a JSON service key', () => {
    const values = secretValues()
    expect(values).toContain(GEMINI)
    expect(values).toContain(SERVICE_KEY.clientsecret)
    const text = `failed with ${GEMINI} and ${SERVICE_KEY.clientsecret}; client ${SERVICE_KEY.clientid}`
    const out = scrub(text)
    expect(out).not.toContain(GEMINI)
    expect(out).not.toContain(SERVICE_KEY.clientsecret)
    expect(out).toContain('***')
    expect(out).toContain('failed with')
  })

  it('scrub also catches credentials by their shape', () => {
    const text = [
      'x-goog AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      '{"clientsecret": "hunter2-hunter2"}',
      'key sk-abcdefghijklmnopqrstuvwxyz012345',
    ].join('\n')
    const out = scrub(text, {})
    for (const leaked of ['AIzaSy', 'abcdefghijklmnopqrstuvwxyz0123456789', 'hunter2', 'sk-abcdef'])
      expect(out).not.toContain(leaked)
  })

  it('scrub leaves ordinary text and short or unrelated variables alone', () => {
    expect(scrub('Step "Press Create" is missing a control', {})).toBe(
      'Step "Press Create" is missing a control',
    )
    expect(scrub('budget 12000', { TOURD_TOKEN_BUDGET: '12000' })).toBe('budget 12000')
    expect(scrub(undefined, {})).toBe('')
  })

  it('the provider error mappers never repeat a credential', () => {
    const leaky = new Error(
      `Invalid JSON in AICORE_SERVICE_KEY near "${SERVICE_KEY.clientsecret}" (${GEMINI})`,
    )
    for (const map of [friendlyGeminiError, friendlySapError]) {
      const mapped = map(leaky)
      expect(mapped.message).not.toContain(SERVICE_KEY.clientsecret)
      expect(mapped.message).not.toContain(GEMINI)
    }
  })

  it('a failed generation job does not store the credential from the provider error', async () => {
    registerProvider({
      id: 'leaky-ai',
      label: 'Leaky AI',
      isConfigured: () => true,
      defaultModel: () => 'leaky-1',
      complete: async () => {
        throw new Error('nope')
      },
      generate: async () => {
        throw new Error(
          `upstream said: key ${GEMINI} / secret ${SERVICE_KEY.clientsecret} is invalid`,
        )
      },
    })
    const projectID = (await POST(`${BASE}/Projects`, { name: 'Leaky' })).data.ID
    await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
    const recording = readFileSync(
      'test/fixtures/recordings/demo-create-order.devtools.json',
      'utf8',
    )
    const recordingID = (await POST(`${BASE}/importRecording`, { projectID, raw: recording })).data
      .ID
    const queued = (
      await POST(`${BASE}/generateTour`, { projectID, recordingID, provider: 'leaky-ai' })
    ).data
    let job
    for (let i = 0; i < 100; i++) {
      job = (await GET(`${BASE}/GenerationJobs(${queued.ID})`)).data
      if (['done', 'failed'].includes(job.status)) break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(job.status).toBe('failed')
    expect(job.error).toContain('upstream said')
    expect(job.error).not.toContain(GEMINI)
    expect(job.error).not.toContain(SERVICE_KEY.clientsecret)
  })

  it('nothing the API returns contains a credential (not even for a configured provider)', async () => {
    const bodies = [
      (await GET(`${BASE}/providers()`)).data,
      (await GET(`${BASE}/$metadata`, { headers: { Accept: 'application/xml' } })).data,
      (await GET(`${BASE}/Projects`)).data,
      (await GET(`${BASE}/GenerationJobs`)).data,
    ].map((b) => (typeof b === 'string' ? b : JSON.stringify(b)))
    for (const body of bodies) {
      expect(body).not.toContain(GEMINI)
      expect(body).not.toContain(SERVICE_KEY.clientsecret)
    }
    const providers = (await GET(`${BASE}/providers()`)).data.value
    expect(providers.find((p) => p.id === 'gemini').configured).toBe(true)
  })
})

describe('privacy switches', () => {
  afterAll(() => {
    delete process.env.TOURD_REDACT
    delete process.env.TOURD_DISABLE_AI
  })

  it('tells the designer whether source files are redacted before they leave', async () => {
    delete process.env.TOURD_REDACT
    expect((await GET(`${BASE}/providers()`)).data.value.every((p) => p.redaction === true)).toBe(
      true,
    )
    process.env.TOURD_REDACT = '0'
    expect((await GET(`${BASE}/providers()`)).data.value.every((p) => p.redaction === false)).toBe(
      true,
    )
  })

  it('"no AI" mode switches the real providers off even when they have credentials', async () => {
    process.env.GEMINI_API_KEY = GEMINI
    process.env.TOURD_DISABLE_AI = '0'
    const on = (await GET(`${BASE}/providers()`)).data.value
    expect(on.find((p) => p.id === 'gemini').configured).toBe(true)

    process.env.TOURD_DISABLE_AI = '1'
    const off = (await GET(`${BASE}/providers()`)).data.value
    expect(off.find((p) => p.id === 'gemini').configured).toBe(false)
    expect(off.find((p) => p.id === 'sap-ai-core').configured).toBe(false)
    expect(off.find((p) => p.id === 'rules').configured).toBe(true)
    delete process.env.GEMINI_API_KEY
  })
})
