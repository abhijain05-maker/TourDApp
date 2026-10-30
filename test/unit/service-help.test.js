import cds from '@sap/cds'
import { describe, it, expect, beforeAll } from 'vitest'
import { demoSources } from '../helpers/sources.js'
import { validateHelp } from '../../shared/help-schema.mjs'

const { GET, POST, axios } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const fails = (p) =>
  p.then(
    (r) => ({ status: r.status, message: 'unexpected success' }),
    (e) => ({ status: e.response?.status, message: e.response?.data?.error?.message ?? e.message }),
  )
const as = (token, method, url, data) =>
  axios.request({
    method,
    url,
    data,
    validateStatus: () => true,
    headers: { Origin: EXT, 'X-TourD-Token': token },
  })

const topic = (over = {}) => ({
  title: 'Create Space',
  summary: 'Create a space in your organization.',
  text: 'To create a space you need the **Org Manager** role.',
  note: 'Machine translated.',
  links: [{ label: 'Docs', url: 'https://help.sap.com/docs' }],
  target: { viewName: 'my.app.view.Main', controlId: 'createBtn' },
  ...over,
})
const save = (projectID, t, helpID) =>
  POST(`${BASE}/saveHelpTopic`, {
    projectID,
    ...(helpID ? { helpID } : {}),
    topic: JSON.stringify(t),
  })
const definition = (row) => JSON.parse(row.definition)

describe('help sets', () => {
  let projectID

  beforeAll(async () => {
    projectID = (await POST(`${BASE}/Projects`, { name: `Help ${Math.random()}` })).data.ID
  })

  it('makes the help set on the first topic and gives the topic an id', async () => {
    const row = (await save(projectID, topic())).data
    expect(row.version).toBe(2)
    const doc = definition(row)
    expect(validateHelp(doc).ok).toBe(true)
    expect(doc.topics).toHaveLength(1)
    expect(doc.topics[0].id).toMatch(/^t-/)
  })

  it('adds further topics to the same set and replaces a topic with the same id', async () => {
    const first = (await GET(`${BASE}/HelpSets?$filter=project_ID eq ${projectID}`)).data.value[0]
    const id = definition(first).topics[0].id
    const second = (
      await save(projectID, topic({ title: 'Deploy', target: { controlId: 'deployBtn' } }))
    ).data
    expect(second.ID).toBe(first.ID)
    expect(definition(second).topics.map((t) => t.title)).toEqual(['Create Space', 'Deploy'])
    const renamed = (await save(projectID, topic({ id, title: 'Create a space' }), first.ID)).data
    expect(definition(renamed).topics.map((t) => t.title)).toEqual(['Create a space', 'Deploy'])
  })

  it('refuses a topic that is not valid, and says why', async () => {
    const r = await fails(save(projectID, topic({ target: {} })))
    expect(r.status).toBe(400)
    expect(r.message).toMatch(/controlId|fallback/)
    expect(
      (await fails(save(projectID, topic({ links: [{ label: 'x', url: 'javascript:1' }] }))))
        .status,
    ).toBe(400)
    expect(
      (await fails(POST(`${BASE}/saveHelpTopic`, { projectID, topic: 'not json' }))).status,
    ).toBe(400)
    expect((await fails(POST(`${BASE}/saveHelpTopic`, { projectID, topic: '[]' }))).status).toBe(
      400,
    )
  })

  it('does not take a help set of another project, nor an unknown project', async () => {
    const other = (await POST(`${BASE}/Projects`, { name: 'Other' })).data.ID
    const mine = (await GET(`${BASE}/HelpSets?$filter=project_ID eq ${projectID}`)).data.value[0]
    expect((await fails(save(other, topic(), mine.ID))).status).toBe(404)
    expect((await fails(save('0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f', topic()))).status).toBe(404)
  })

  it('deletes a topic', async () => {
    const mine = (await GET(`${BASE}/HelpSets?$filter=project_ID eq ${projectID}`)).data.value[0]
    const [a, b] = definition(mine).topics
    const row = (await POST(`${BASE}/deleteHelpTopic`, { helpID: mine.ID, topicID: a.id })).data
    expect(definition(row).topics.map((t) => t.id)).toEqual([b.id])
    expect(
      (await fails(POST(`${BASE}/deleteHelpTopic`, { helpID: mine.ID, topicID: a.id }))).status,
    ).toBe(404)
  })

  it('saves a whole set from the designer, and notices a change made elsewhere', async () => {
    const mine = (await GET(`${BASE}/HelpSets?$filter=project_ID eq ${projectID}`)).data.value[0]
    const doc = definition(mine)
    doc.topics[0].title = 'Edited in the designer'
    const row = (
      await POST(`${BASE}/saveHelpSet`, {
        helpID: mine.ID,
        definition: JSON.stringify(doc),
        baseVersion: mine.version,
      })
    ).data
    expect(row.version).toBe(mine.version + 1)
    expect(row.generator).toBe('designer')
    const stale = await fails(
      POST(`${BASE}/saveHelpSet`, {
        helpID: mine.ID,
        definition: JSON.stringify(doc),
        baseVersion: mine.version,
      }),
    )
    expect(stale.status).toBe(409)
  })

  it('serves the help as help.json, and the help layer as a predefined module', async () => {
    const mine = (await GET(`${BASE}/HelpSets?$filter=project_ID eq ${projectID}`)).data.value[0]
    const json = await axios.get(`/live/${mine.ID}/help.json`)
    expect(json.data.topics.length).toBeGreaterThan(0)
    const js = await axios.get('/live/help.js')
    expect(js.data).toContain('sap.ui.predefine("tourd/live/HelpLayer"')
    expect(
      (
        await axios.get(`/live/${'0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'}/help.json`, {
          validateStatus: () => true,
        })
      ).status,
    ).toBe(404)
  })

  it('cannot be written through the entity itself', async () => {
    expect((await fails(POST(`${BASE}/HelpSets`, { name: 'x' }))).status).toBeGreaterThanOrEqual(
      400,
    )
  })

  it('goes with the project when it is deleted', async () => {
    const p = (await POST(`${BASE}/Projects`, { name: 'Gone' })).data.ID
    await save(p, topic())
    await axios.delete(`${BASE}/Projects(${p})`)
    const left = await cds.run(SELECT.from('tourd.HelpSets').where({ project_ID: p }))
    expect(left).toHaveLength(0)
  })
})

describe('a paired extension and help', () => {
  let token
  let projectID

  beforeAll(async () => {
    token = (await POST(`${BASE}/createExtensionToken`, { name: 'Help author' })).data.token
    projectID = (await POST(`${BASE}/Projects`, { name: 'Ext help' })).data.ID
    await POST(`${BASE}/importSources`, { projectID, files: demoSources(), replace: true })
  })

  it('may add, read and remove topics and fetch the help layer', async () => {
    const saved = await as(token, 'post', `${BASE}/saveHelpTopic`, {
      projectID,
      topic: JSON.stringify(topic()),
    })
    expect(saved.status).toBe(200)
    const list = await as(token, 'get', `${BASE}/HelpSets?$filter=project_ID eq ${projectID}`)
    expect(list.status).toBe(200)
    expect(list.data.value).toHaveLength(1)
    expect((await as(token, 'get', '/live/help.js')).status).toBe(200)
    expect((await as(token, 'get', `/live/${saved.data.ID}/help.json`)).status).toBe(200)
    const id = definition(saved.data).topics[0].id
    const removed = await as(token, 'post', `${BASE}/deleteHelpTopic`, {
      helpID: saved.data.ID,
      topicID: id,
    })
    expect(removed.status).toBe(200)
  })

  it('may still not save a whole set or touch anything else', async () => {
    const mine = (await GET(`${BASE}/Projects(${projectID})`)).data
    expect(mine.ID).toBe(projectID)
    for (const [m, p, d] of [
      ['post', `${BASE}/saveHelpSet`, { helpID: projectID, definition: '{}' }],
      ['delete', `${BASE}/HelpSets(${projectID})`],
      ['post', `${BASE}/applyTourToProject`, {}],
    ]) {
      const r = await as(token, m, p, d)
      expect(r.status, `${m} ${p}`).toBe(403)
    }
  })
})
