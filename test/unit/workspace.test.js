import cds from '@sap/cds'
import { describe, it, expect, beforeEach } from 'vitest'
import { strFromU8, strToU8, unzipSync } from 'fflate'
import { demoSources } from '../helpers/sources.js'
import { backfillWorkspace } from '../../srv/lib/service/workspace.js'
import { sha256 } from '../../srv/lib/service/sources.js'

const { GET, POST, DELETE, axios } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'

const fails = (p) =>
  p.then(
    (r) => ({ status: r.status, message: 'unexpected success' }),
    (e) => ({
      status: e.response?.status ?? e.code,
      message: e.response?.data?.error?.message ?? e.message,
    }),
  )
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254])

/** A fresh project that has the demo app (plus a picture), and helpers to work on it. */
async function setup(extra = []) {
  const projectID = (await POST(`${BASE}/Projects`, { name: `Workspace ${Math.random()}` })).data.ID
  const files = [
    ...demoSources(),
    { path: 'webapp/img/logo.png', content: PNG.toString('base64'), binary: true },
    ...extra,
  ]
  const { data } = await POST(`${BASE}/importSources`, { projectID, files, replace: true })
  const list = async () =>
    (
      await GET(
        `${BASE}/Sources?$filter=project_ID eq ${projectID} and deleted eq false&$orderby=path`,
      )
    ).data.value
  const file = async (path) => (await list()).find((f) => f.path === path)
  const detail = async (path) =>
    (await GET(`${BASE}/getFile(fileID=${(await file(path)).ID})`)).data
  const save = (ID, content, expectedHash) =>
    POST(`${BASE}/saveFile`, { fileID: ID, content, expectedHash })
  const inventory = async () =>
    JSON.parse((await GET(`${BASE}/getInventory(projectID=${projectID})`)).data.value)
  const bytes = async (url) =>
    new Uint8Array(
      (await axios.get(url, { responseType: 'arraybuffer', validateStatus: () => true })).data,
    )
  return { projectID, imported: data, list, file, detail, save, inventory, bytes }
}

const MAIN = 'webapp/view/Main.view.xml'

describe('importing a project', () => {
  it('keeps every file, text and binary, as a clean starting point', async () => {
    const { imported, list, detail } = await setup()
    expect(imported).toMatchObject({ imported: 16, ignored: [], skipped: [], complete: true })
    const files = await list()
    expect(files).toHaveLength(16)
    expect(files.every((f) => f.status === 'unchanged' && !f.edited)).toBe(true)
    const logo = files.find((f) => f.path === 'webapp/img/logo.png')
    expect(logo).toMatchObject({ binary: true, size: PNG.length, kind: 'other' })
    expect((await detail('webapp/img/logo.png')).content).toBe(PNG.toString('base64'))
    // the list never carries the content
    expect(files[0]).not.toHaveProperty('content')
    expect(files[0]).not.toHaveProperty('base')
  })

  it('leaves out folders that are not part of a project and files that may hold secrets, and says why', async () => {
    const { imported, file } = await setup([
      { path: 'node_modules/ui5/index.js', content: '//' },
      { path: '.git/config', content: '[core]' },
      { path: '.env', content: 'GEMINI_API_KEY=abc' },
      { path: 'default-env.json', content: '{}' },
      { path: 'certs/server.pem', content: '-----BEGIN' },
      { path: 'webapp/.DS_Store', content: 'x' },
    ])
    expect(imported.ignored.sort()).toEqual(
      [
        '.env',
        '.git/config',
        'certs/server.pem',
        'default-env.json',
        'node_modules/ui5/index.js',
        'webapp/.DS_Store',
      ].sort(),
    )
    expect(imported.skipped.every((s) => s.expected && s.reason)).toBe(true)
    expect(imported.complete).toBe(true) // leaving these out does not make the project incomplete
    expect(await file('.env')).toBeUndefined()
  })

  it('says when something had to be left out that belongs to the project', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1)
    const { imported } = await setup([{ path: 'webapp/data/big.json', content: big }])
    expect(imported.complete).toBe(false)
    expect(imported.skipped).toEqual([
      expect.objectContaining({
        path: 'webapp/data/big.json',
        expected: false,
        reason: expect.stringContaining('too large'),
      }),
    ])
  })

  it('refuses a file of the UI5 app that is too large instead of quietly leaving it out', async () => {
    const projectID = (await POST(`${BASE}/Projects`, { name: 'Big view' })).data.ID
    const r = await fails(
      POST(`${BASE}/importSources`, {
        projectID,
        files: [{ path: 'webapp/big.view.xml', content: 'x'.repeat(1024 * 1024 + 1) }],
      }),
    )
    expect(r).toMatchObject({ status: 400, message: expect.stringContaining('too large') })
  })

  it('a project of pictures and notes alone is not an app', async () => {
    const projectID = (await POST(`${BASE}/Projects`, { name: 'No app' })).data.ID
    const r = await fails(
      POST(`${BASE}/importSources`, { projectID, files: [{ path: 'README.md', content: '# hi' }] }),
    )
    expect(r).toMatchObject({ status: 400, message: expect.stringContaining('None of the files') })
  })

  it('binary content must be base64', async () => {
    const { projectID } = await setup()
    const r = await POST(`${BASE}/importSources`, {
      projectID,
      files: [{ path: 'webapp/img/bad.png', content: 'not base64 !!', binary: true }],
    })
    expect(r.data.skipped.find((s) => s.path === 'webapp/img/bad.png')).toMatchObject({
      expected: false,
    })
  })
})

describe('editing', () => {
  let ws
  beforeEach(async () => {
    ws = await setup()
  })

  it('saving makes the file "modified", and the uploaded copy stays available for the diff', async () => {
    const before = await ws.detail(MAIN)
    const edited = before.content.replace('{i18n>create}', 'Neu anlegen')
    const saved = (await ws.save(before.ID, edited, before.hash)).data
    expect(saved).toMatchObject({ status: 'modified', edited: true, path: MAIN })
    expect(saved.hash).toBe(sha256(edited))

    const after = await ws.detail(MAIN)
    expect(after.content).toBe(edited)
    expect(after.base).toBe(before.content)
    expect(after.status).toBe('modified')
    expect((await ws.file(MAIN)).status).toBe('modified')
  })

  it('changing a view changes the inventory; changing another file does not need to', async () => {
    const view = await ws.detail(MAIN)
    await ws.save(view.ID, view.content.replace('id="createBtn"', 'id="addBtn"'), view.hash)
    const inv = await ws.inventory()
    expect(inv.controls.some((c) => c.localId === 'addBtn')).toBe(true)
    expect(inv.controls.some((c) => c.localId === 'createBtn')).toBe(false)

    const pkg = await ws.detail('package.json')
    const r = await ws.save(pkg.ID, pkg.content + '\n', pkg.hash)
    expect(r.data.status).toBe('modified')
  })

  it('does not overwrite a file that changed in the meantime', async () => {
    const f = await ws.detail(MAIN)
    await ws.save(f.ID, f.content + '<!-- one -->', f.hash)
    const stale = await fails(ws.save(f.ID, f.content + '<!-- two -->', f.hash))
    expect(stale).toMatchObject({
      status: 409,
      message: expect.stringContaining('changed elsewhere'),
    })
    expect((await ws.detail(MAIN)).content).toContain('one')
  })

  it('saving the same content again changes nothing', async () => {
    const f = await ws.detail(MAIN)
    const r = (await ws.save(f.ID, f.content, f.hash)).data
    expect(r).toMatchObject({ status: 'unchanged', edited: false })
  })

  it('changing a file back to what was uploaded makes it unchanged again', async () => {
    const f = await ws.detail(MAIN)
    await ws.save(f.ID, f.content + 'x', f.hash)
    const back = (await ws.save(f.ID, f.content)).data
    expect(back).toMatchObject({ status: 'unchanged', edited: false })
  })

  it('a binary file can be replaced with other base64, text is refused', async () => {
    const logo = await ws.file('webapp/img/logo.png')
    const next = Buffer.from([1, 2, 3, 4]).toString('base64')
    expect((await ws.save(logo.ID, next)).data).toMatchObject({
      status: 'modified',
      size: 4,
      binary: true,
    })
    expect(await fails(ws.save(logo.ID, '%%% not base64'))).toMatchObject({ status: 400 })
  })

  it('refuses text with a NUL character and files over the size limit', async () => {
    const f = await ws.file(MAIN)
    expect(await fails(ws.save(f.ID, 'a\u0000b'))).toMatchObject({ status: 400 })
    expect(await fails(ws.save(f.ID, 'x'.repeat(1024 * 1024 + 1)))).toMatchObject({
      status: 400,
      message: expect.stringContaining('too large'),
    })
  })

  it('unknown files are 404', async () => {
    const zero = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
    expect(await fails(GET(`${BASE}/getFile(fileID=${zero})`))).toMatchObject({ status: 404 })
    expect(await fails(ws.save(zero, 'x'))).toMatchObject({ status: 404 })
  })
})

describe('adding, renaming, removing and putting back', () => {
  let ws
  beforeEach(async () => {
    ws = await setup()
  })

  it('adds a file, which is "added" and can be edited like any other', async () => {
    const r = (
      await POST(`${BASE}/createFile`, {
        projectID: ws.projectID,
        path: 'webapp/view/Help.view.xml',
        content: '<mvc:View xmlns:mvc="sap.ui.core.mvc"/>',
      })
    ).data
    expect(r).toMatchObject({ status: 'added', kind: 'view', edited: true })
    expect((await ws.inventory()).views.map((v) => v.viewName)).toContain('demo.orders.view.Help')
    expect(
      await fails(
        POST(`${BASE}/createFile`, {
          projectID: ws.projectID,
          path: 'webapp/view/Help.view.xml',
          content: '',
        }),
      ),
    ).toMatchObject({ status: 409 })
  })

  it('does not add a path that is unsafe or that must not be in a project', async () => {
    for (const path of [
      '../x.js',
      'a/../../b.js',
      '.env',
      'node_modules/x/index.js',
      'keys/id_rsa',
    ]) {
      expect(
        await fails(POST(`${BASE}/createFile`, { projectID: ws.projectID, path, content: 'x' })),
        path,
      ).toMatchObject({ status: 400 })
    }
  })

  it('removing an uploaded file marks it removed (it can come back); the inventory forgets it', async () => {
    const detail = await ws.file('webapp/view/Detail.view.xml')
    const r = (await POST(`${BASE}/deleteFile`, { fileID: detail.ID })).data
    expect(r.status).toBe('deleted')
    expect(await ws.file('webapp/view/Detail.view.xml')).toBeUndefined() // not in the normal list
    expect((await ws.inventory()).views.map((v) => v.viewName)).not.toContain(
      'demo.orders.view.Detail',
    )
    expect(await fails(ws.save(detail.ID, 'x'))).toMatchObject({ status: 409 })

    const back = (await POST(`${BASE}/revertFile`, { fileID: detail.ID })).data
    expect(back.status).toBe('unchanged')
    expect((await ws.inventory()).views.map((v) => v.viewName)).toContain('demo.orders.view.Detail')
  })

  it('removing a file that exists only here just removes it', async () => {
    const added = (
      await POST(`${BASE}/createFile`, { projectID: ws.projectID, path: 'notes.md', content: 'x' })
    ).data
    expect((await POST(`${BASE}/deleteFile`, { fileID: added.ID })).data.status).toBe('removed')
    expect(await ws.file('notes.md')).toBeUndefined()
    expect((await GET(`${BASE}/getChanges(projectID=${ws.projectID})`)).data.value).toEqual([])
  })

  it('plain OData DELETE of a source works the same way', async () => {
    const detail = await ws.file('webapp/view/Detail.view.xml')
    await DELETE(`${BASE}/Sources(${detail.ID})`)
    expect((await ws.inventory()).views.map((v) => v.viewName)).not.toContain(
      'demo.orders.view.Detail',
    )
    expect((await GET(`${BASE}/getChanges(projectID=${ws.projectID})`)).data.value).toMatchObject([
      { path: 'webapp/view/Detail.view.xml', status: 'deleted' },
    ])
  })

  it('putting a changed file back restores what was uploaded', async () => {
    const f = await ws.detail(MAIN)
    await ws.save(f.ID, 'broken', f.hash)
    const r = (await POST(`${BASE}/revertFile`, { fileID: f.ID })).data
    expect(r).toMatchObject({ status: 'unchanged', edited: false })
    expect((await ws.detail(MAIN)).content).toBe(f.content)
    expect((await ws.inventory()).controls.some((c) => c.localId === 'createBtn')).toBe(true)
  })

  it('renaming is "the old file is gone, a new one is there"', async () => {
    const detail = await ws.file('webapp/view/Detail.view.xml')
    const r = (
      await POST(`${BASE}/renameFile`, { fileID: detail.ID, path: 'webapp/view/Order.view.xml' })
    ).data
    expect(r).toMatchObject({ path: 'webapp/view/Order.view.xml', status: 'added' })
    const changes = (await GET(`${BASE}/getChanges(projectID=${ws.projectID})`)).data.value
    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['webapp/view/Detail.view.xml', 'deleted'],
      ['webapp/view/Order.view.xml', 'added'],
    ])
    expect((await ws.detail('webapp/view/Order.view.xml')).content).toContain('detailPage')
    expect(
      await fails(POST(`${BASE}/renameFile`, { fileID: r.ID, path: 'webapp/view/Main.view.xml' })),
    ).toMatchObject({ status: 409 })
  })

  it('a removed uploaded file can be added again under the same name', async () => {
    const detail = await ws.detail('webapp/view/Detail.view.xml')
    await POST(`${BASE}/deleteFile`, { fileID: detail.ID })
    const again = (
      await POST(`${BASE}/createFile`, {
        projectID: ws.projectID,
        path: 'webapp/view/Detail.view.xml',
        content: detail.content + '<!-- again -->',
      })
    ).data
    expect(again.status).toBe('modified') // compared with what was uploaded
    expect((await ws.detail('webapp/view/Detail.view.xml')).base).toBe(detail.content)
  })

  it('lists the changes, and only those', async () => {
    const f = await ws.detail(MAIN)
    await ws.save(f.ID, f.content + ' ', f.hash)
    await POST(`${BASE}/createFile`, { projectID: ws.projectID, path: 'extra.txt', content: 'x' })
    await POST(`${BASE}/deleteFile`, {
      fileID: (await ws.file('webapp/i18n/i18n_en.properties')).ID,
    })
    const changes = (await GET(`${BASE}/getChanges(projectID=${ws.projectID})`)).data.value
    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['extra.txt', 'added'],
      ['webapp/i18n/i18n_en.properties', 'deleted'],
      [MAIN, 'modified'],
    ])
  })
})

describe('files from before the workspace existed', () => {
  it('get their hashes and count as unchanged', async () => {
    const { projectID } = await setup()
    // a row as an older TourD left it: no hash, no base, no size
    const ID = cds.utils.uuid()
    await cds.run(
      INSERT.into('tourd.Sources').entries({
        ID,
        project_ID: projectID,
        path: 'webapp/legacy.js',
        kind: 'other',
        content: 'old',
      }),
    )
    const stale = (
      await GET(`${BASE}/Sources?$filter=project_ID eq ${projectID} and path eq 'webapp/legacy.js'`)
    ).data.value[0]
    expect(stale.hash).toBeNull()

    expect(await backfillWorkspace()).toBeGreaterThanOrEqual(1)
    const fixed = (await GET(`${BASE}/Sources(${ID})`)).data
    expect(fixed).toMatchObject({ status: 'unchanged', hash: sha256('old'), size: 3 })
    expect((await GET(`${BASE}/getFile(fileID=${ID})`)).data.content).toBe('old')
  })
})

describe('handing the project over', () => {
  const unzip = (u8) => Object.fromEntries(Object.entries(unzipSync(u8)).map(([k, v]) => [k, v]))

  /** The project as the user has it on disk before: everything that was uploaded. */
  const originalFolder = () => {
    const folder = new Map(demoSources().map((f) => [f.path, strToU8(f.content)]))
    folder.set('webapp/img/logo.png', new Uint8Array(PNG))
    return folder
  }

  async function edited() {
    const ws = await setup()
    const view = await ws.detail(MAIN)
    await ws.save(view.ID, view.content.replace('{i18n>create}', 'Neu anlegen'), view.hash)
    await POST(`${BASE}/createFile`, {
      projectID: ws.projectID,
      path: 'webapp/tourd/hello.txt',
      content: 'hello',
    })
    await POST(`${BASE}/deleteFile`, {
      fileID: (await ws.file('webapp/i18n/i18n_en.properties')).ID,
    })
    const logo = await ws.file('webapp/img/logo.png')
    await ws.save(logo.ID, Buffer.from([9, 9, 9]).toString('base64'))
    return ws
  }

  it('the changes, unzipped over the original folder, give exactly the project as edited', async () => {
    const ws = await edited()
    const changes = unzip(await ws.bytes(`/export/project/${ws.projectID}/changes.zip`))
    expect(Object.keys(changes).sort()).toEqual(
      ['CHANGES.md', 'webapp/img/logo.png', 'webapp/tourd/hello.txt', MAIN].sort(),
    )
    expect(strFromU8(changes['CHANGES.md'])).toContain('## Remove (1)')
    expect(strFromU8(changes['CHANGES.md'])).toContain('`webapp/i18n/i18n_en.properties`')

    // the user's steps: unzip over the folder, delete what is listed under "Remove"
    const folder = originalFolder()
    for (const [path, content] of Object.entries(changes))
      if (path !== 'CHANGES.md') folder.set(path, content)
    folder.delete('webapp/i18n/i18n_en.properties')

    const full = unzip(await ws.bytes(`/export/project/${ws.projectID}/full.zip`))
    expect(Object.keys(full).sort()).toEqual([...folder.keys()].sort())
    for (const [path, content] of folder)
      expect(Buffer.from(full[path]).equals(Buffer.from(content)), path).toBe(true)
    expect(strFromU8(full[MAIN])).toContain('Neu anlegen')
    expect([...full['webapp/img/logo.png']]).toEqual([9, 9, 9]) // binary files arrive as bytes
  })

  it('the same state gives the same bytes', async () => {
    const ws = await edited()
    const a = await ws.bytes(`/export/project/${ws.projectID}/changes.zip`)
    const b = await ws.bytes(`/export/project/${ws.projectID}/changes.zip`)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('there is a patch, git style, for text files; binary files are only mentioned', async () => {
    const ws = await edited()
    const patch = strFromU8(await ws.bytes(`/export/project/${ws.projectID}/changes.patch`))
    expect(patch).toContain(`diff --git a/${MAIN} b/${MAIN}`)
    expect(patch).toContain(`--- a/${MAIN}`)
    expect(patch).toContain('+++ b/webapp/tourd/hello.txt')
    expect(patch).toContain('--- /dev/null')
    expect(patch).toContain('new file mode 100644')
    expect(patch).toContain('deleted file mode 100644')
    expect(patch).toContain('+++ /dev/null')
    expect(patch).toMatch(/^-.*\{i18n>create\}/m)
    expect(patch).toMatch(/^\+.*Neu anlegen/m)
    expect(patch).toContain('Binary files a/webapp/img/logo.png and b/webapp/img/logo.png differ')
  })

  it('has nothing to hand over before anything changed, and not the whole project if parts were left out', async () => {
    const clean = await setup()
    const none = await axios.get(`/export/project/${clean.projectID}/changes.zip`, {
      validateStatus: () => true,
    })
    expect(none.status).toBe(409)
    expect(none.data.error).toContain('no changes')
    expect(
      (
        await axios.get(`/export/project/${clean.projectID}/full.zip`, {
          validateStatus: () => true,
        })
      ).status,
    ).toBe(200)

    const partial = await setup([
      { path: 'webapp/data/big.json', content: 'x'.repeat(1024 * 1024 + 1) },
    ])
    const full = await axios.get(`/export/project/${partial.projectID}/full.zip`, {
      validateStatus: () => true,
    })
    expect(full.status).toBe(409)
    expect(full.data.missing[0].path).toBe('webapp/data/big.json')
  })

  it('answers 404 for unknown projects and 405 for writes', async () => {
    const zero = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
    expect(
      (await axios.get(`/export/project/${zero}/full.zip`, { validateStatus: () => true })).status,
    ).toBe(404)
    expect(
      (await axios.post(`/export/project/${zero}/full.zip`, {}, { validateStatus: () => true }))
        .status,
    ).toBe(405)
  })
})

describe('accepting one file', () => {
  it('only that file becomes part of the project; the others stay changes', async () => {
    const { projectID, file, detail, save } = await setup()
    const view = await detail(MAIN)
    await save(view.ID, `${view.content}
<!-- a -->
`, view.hash)
    const manifest = await detail('webapp/manifest.json')
    await save(manifest.ID, `${manifest.content}
`, manifest.hash)
    const gone = await file('webapp/i18n/i18n.properties')
    await POST(`${BASE}/deleteFile`, { fileID: gone.ID })
    const changed = () => GET(`${BASE}/getChanges(projectID=${projectID})`).then((r) => r.data.value.map((c) => c.path).sort())
    expect(await changed()).toHaveLength(3)

    expect((await POST(`${BASE}/acceptChanges`, { projectID, fileIDs: [view.ID] })).data.value).toBe(1)
    const left = await changed()
    expect(left).not.toContain(MAIN)
    expect(left).toHaveLength(2)
    // an id of a file that did not change accepts nothing
    expect((await POST(`${BASE}/acceptChanges`, { projectID, fileIDs: [view.ID] })).data.value).toBe(0)
  })
})

describe('accepting the changes', () => {
  it('makes the changed files the project: nothing is left to hand over, "put back" returns to this state', async () => {
    const { projectID, list, file, detail, save } = await setup()
    const view = await detail(MAIN)
    await save(view.ID, `${view.content}\n<!-- changed -->\n`, view.hash)
    const made = (
      await POST(`${BASE}/createFile`, { projectID, path: 'webapp/test/new.js', content: 'x', binary: false })
    ).data
    const gone = await file('webapp/i18n/i18n.properties')
    await POST(`${BASE}/deleteFile`, { fileID: gone.ID })
    expect((await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value).toHaveLength(3)

    const { data } = await POST(`${BASE}/acceptChanges`, { projectID })
    expect(data.value).toBe(3)
    expect((await GET(`${BASE}/getChanges(projectID=${projectID})`)).data.value).toEqual([])
    expect((await list()).every((f) => f.status === 'unchanged' && !f.edited)).toBe(true)
    // the removed file is gone for good, the added one is part of the project
    expect(await file('webapp/i18n/i18n.properties')).toBeUndefined()
    expect((await detail('webapp/test/new.js')).content).toBe('x')
    expect(made.ID).toBe((await file('webapp/test/new.js')).ID)

    // the accepted text is the new "as uploaded": changing it again and putting it back returns to it
    const again = await detail(MAIN)
    expect(again.content).toContain('<!-- changed -->')
    await save(again.ID, `${again.content}more`, again.hash)
    await POST(`${BASE}/revertFile`, { fileID: again.ID })
    expect((await detail(MAIN)).content).toContain('<!-- changed -->')
    expect((await detail(MAIN)).content).not.toContain('more')

    // nothing to accept the second time
    expect((await POST(`${BASE}/acceptChanges`, { projectID })).data.value).toBe(0)
    expect((await fails(POST(`${BASE}/acceptChanges`, { projectID: cds.utils.uuid() }))).status).toBe(404)
  })
})
