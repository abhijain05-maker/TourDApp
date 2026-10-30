import cds from '@sap/cds'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { demoSources } from '../helpers/sources.js'

// A deployment: people log in (here with mocked users instead of XSUAA) and the roles are enforced. The same code
// paths as in production (srv/auth.js, srv/lib/service/authz.js, the guards of /export, /preview and /live).
cds.env.requires.auth = {
  kind: 'mocked',
  impl: 'srv/auth.js',
  base: 'mocked',
  users: {
    ed: { password: 'x', roles: ['Editor'] },
    vi: { password: 'x', roles: ['Viewer'] },
    nobody: { password: 'x', roles: [] },
  },
}
cds.env.tourd = { enforceRoles: true }
process.env.TOURD_EXTENSION_RATE = '12' // requests per minute and extension, to see the limit

const { GET, POST, axios } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const as = (user) => ({ auth: { username: user, password: 'x' }, validateStatus: () => true, maxRedirects: 0 })
const status = async (p) => (await p).status

describe('a deployment with logins and roles', () => {
  let project
  let tour
  const setup = async () => {
    if (project) return
    project = (await POST(`${BASE}/Projects`, { name: 'Auth' }, as('ed'))).data
    await POST(`${BASE}/importSources`, { projectID: project.ID, files: demoSources(), replace: true }, as('ed'))
    tour = (await POST(`${BASE}/createTour`, { projectID: project.ID, name: 'T', definition: readFileSync('samples/demo-app/webapp/tourd/tour.json', 'utf8') }, as('ed'))).data
  }

  it('asks for a login, and answers the health check without one', async () => {
    expect(await status(GET(`${BASE}/Projects`, { validateStatus: () => true }))).toBe(401)
    const health = await GET('/health', { validateStatus: () => true })
    expect(health.status).toBe(200)
    expect(health.data).toEqual({ status: 'UP', db: 'UP' })
  })

  it('a viewer reads and cannot change; an editor can; someone without a role can do neither', async () => {
    await setup()
    expect(await status(GET(`${BASE}/Projects`, as('vi')))).toBe(200)
    expect(await status(GET(`${BASE}/getInventory(projectID=${project.ID})`, as('vi')))).toBe(200)
    expect(await status(POST(`${BASE}/Projects`, { name: 'x' }, as('vi')))).toBe(403)
    expect(await status(POST(`${BASE}/importSources`, { projectID: project.ID, files: [], replace: false }, as('vi')))).toBe(403)
    expect(await status(POST(`${BASE}/createExtensionToken`, { name: 'x' }, as('vi')))).toBe(403)
    expect(await status(POST(`${BASE}/Projects`, { name: 'by editor' }, as('ed')))).toBe(201)
    expect(await status(GET(`${BASE}/Projects`, as('nobody')))).toBe(403)
    expect(await status(POST(`${BASE}/Projects`, { name: 'x' }, as('nobody')))).toBe(403)
  })

  it('exports need a login and the viewer role', async () => {
    await setup()
    const url = `/export/${tour.ID}/check.json`
    expect(await status(GET(url, { validateStatus: () => true }))).toBe(401)
    expect(await status(GET(url, as('nobody')))).toBe(403)
    expect(await status(GET(url, as('vi')))).toBe(200)
  })

  it('the sandbox gets a link token, because its frame sends no cookies', async () => {
    await setup()
    const direct = `/preview/${project.ID}/info.json`
    expect(await status(GET(direct, { validateStatus: () => true }))).toBe(401)
    expect(await status(GET(direct, as('vi')))).toBe(200)

    const redirect = await GET(`/preview/${project.ID}/sandbox.html?ui5=1.120`, as('vi'))
    expect(redirect.status).toBe(302)
    const where = redirect.headers.location
    expect(where.startsWith(`/preview/${project.ID}/~`)).toBe(true)
    expect(where.endsWith('/sandbox.html?ui5=1.120')).toBe(true)
    // the page and its files, with no login at all
    expect(await status(GET(where, { validateStatus: () => true }))).toBe(200)
    const token = where.split('/')[3]
    expect(await status(GET(`/preview/${project.ID}/${token}/info.json`, { validateStatus: () => true }))).toBe(200)
    expect(await status(GET(`/preview/${project.ID}/${token}/app/manifest.json`, { validateStatus: () => true }))).toBe(200)
    // a token of another project, or a made-up one, is no use
    expect(await status(GET(`/preview/${project.ID}/~1.forged/info.json`, { validateStatus: () => true }))).toBe(403)
    const other = (await POST(`${BASE}/Projects`, { name: 'Other' }, as('ed'))).data
    expect(await status(GET(`/preview/${other.ID}/${token}/info.json`, { validateStatus: () => true }))).toBe(403)
  })

  it('the console snippet gets a link token for its tour', async () => {
    await setup()
    const live = `/live/${tour.ID}/tour.json`
    expect(await status(GET('/live/player.js', { validateStatus: () => true }))).toBe(200) // only code
    expect(await status(GET(live, { validateStatus: () => true }))).toBe(401)
    const token = (await GET(`${BASE}/capability(scope='live',id=${tour.ID})`, as('vi'))).data.value
    expect(await status(GET(`${live}?t=${token}`, { validateStatus: () => true }))).toBe(200)
    expect(await status(GET(`${live}?t=${token}x`, { validateStatus: () => true }))).toBe(401)
    expect(await status(GET(`/live/${project.ID}/tour.json?t=${token}`, { validateStatus: () => true }))).toBe(401) // another tour
    expect(await status(GET(`${BASE}/capability(scope='admin',id=${tour.ID})`, as('vi')))).toBe(400)
  })

  it('a paired extension is a user of its own, with the role Extension, and only for what it needs', async () => {
    await setup()
    const token = (await POST(`${BASE}/createExtensionToken`, { name: 'laptop' }, as('ed'))).data.token
    const ext = { headers: { 'X-TourD-Token': token }, validateStatus: () => true, maxRedirects: 0 }
    expect(await status(GET(`${BASE}/Projects`, ext))).toBe(200)
    expect(await status(GET(`${BASE}/TestPlans`, ext))).toBe(200)
    expect(await status(GET(`/live/${tour.ID}/tour.json`, ext))).toBe(200)
    // it can send a recording ...
    const sent = await POST(`${BASE}/importRecording`, { projectID: project.ID, raw: readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8') }, ext)
    expect(sent.status).toBe(200)
    // ... and nothing else: not the files, not changes, not exports
    expect(await status(GET(`${BASE}/getInventory(projectID=${project.ID})`, ext))).toBe(403)
    expect(await status(POST(`${BASE}/Projects`, { name: 'x' }, ext))).toBe(403)
    expect(await status(GET(`/export/${tour.ID}/check.json`, ext))).toBe(403)
    // a made-up token is no token
    expect(await status(GET(`${BASE}/Projects`, { headers: { 'X-TourD-Token': 'tourd_nope' }, validateStatus: () => true }))).toBe(403)
  })
})
describe('rate limit', () => {
  it('an extension that asks too often is told to wait; a person is not limited by it', async () => {
    const token = (await POST(`${BASE}/createExtensionToken`, { name: 'greedy' }, as('ed'))).data.token
    const ext = { headers: { 'X-TourD-Token': token }, validateStatus: () => true }
    const answers = []
    for (let i = 0; i < 14; i++) answers.push(await GET(`${BASE}/Projects?$top=1`, ext))
    expect(answers.filter((a) => a.status === 200).length).toBe(12)
    const refused = answers.find((a) => a.status === 429)
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
    expect(await status(GET(`${BASE}/Projects?$top=1`, as('vi')))).toBe(200)
  })
})
void axios
