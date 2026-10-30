import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { expect } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { loadSources } from './sources.js'

// A copy of the demo app that has no tour yet, to which an export bundle is applied exactly as its
// README says, and a tiny static server for it (UI5 itself comes from the CDN).

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.properties': 'text/plain',
}

/** A copy of the demo app as it was before anyone added a tour to it. */
function plainApp() {
  const dir = mkdtempSync(join(tmpdir(), 'tourd-app-'))
  cpSync('samples/demo-app/webapp', join(dir, 'webapp'), {
    recursive: true,
    filter: (src) => !/webapp[\\/]tourd/.test(src),
  })
  const at = (p) => join(dir, 'webapp', p)
  const edit = (p, fn) => writeFileSync(at(p), fn(readFileSync(at(p), 'utf8')))
  edit('manifest.json', (t) => {
    const m = JSON.parse(t)
    delete m['sap.ui5'].resourceRoots
    return JSON.stringify(m, null, 2)
  })
  edit('view/Main.view.xml', (t) => t.replace(/^\s*<Button id="startTourBtn".*\n/m, ''))
  edit('controller/Main.controller.js', (t) =>
    t.replace(/,\s*\/\/ Same shape[\s\S]*$/, '\n\t\t});\n\t}\n);\n'),
  )
  expect(readFileSync(at('view/Main.view.xml'), 'utf8')).not.toContain('startTourBtn')
  expect(readFileSync(at('controller/Main.controller.js'), 'utf8')).not.toContain('onStartTour')
  return { dir, at, edit }
}

/** Does what the README says, with the files of the zip. */
function applyBundle(app, files, { autoStart = false, skipManifest = false } = {}) {
  const text = (name) => strFromU8(files[name])
  // 1. copy tourd/
  mkdirSync(join(app.dir, 'webapp', 'tourd'), { recursive: true })
  for (const name of ['TourPlayer.js', 'tour.json', 'tour.schema.json'])
    writeFileSync(join(app.dir, 'webapp', 'tourd', name), files[`tourd/${name}`])
  // 2. resourceRoots into the manifest
  const add = JSON.parse(text('snippets/manifest.resourceRoots.json'))
  if (!skipManifest)
    app.edit('manifest.json', (t) => {
      const m = JSON.parse(t)
      m['sap.ui5'].resourceRoots = {
        ...m['sap.ui5'].resourceRoots,
        ...add['sap.ui5'].resourceRoots,
      }
      return JSON.stringify(m, null, 2)
    })
  // 3. the button into the page's header, 4. the handler into the controller
  app.edit('view/Main.view.xml', (t) =>
    t.replace('<headerContent>', `<headerContent>\n${text('snippets/Start.view.xml')}`),
  )
  app.edit('controller/Main.controller.js', (t) => {
    let out = t.replace(
      /(\t+)onSearch:/,
      (m, tabs) => `${text('snippets/Start.controller.js').trimEnd()},\n\n${tabs}onSearch:`,
    )
    if (autoStart)
      out = out.replace(
        /(\t+)onSearch:/,
        (m, tabs) => `${text('snippets/AutoStart.controller.js').trimEnd()},\n\n${tabs}onSearch:`,
      )
    return out
  })
}

function serve(root) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(
      /^[\\/]+/,
      '',
    )
    try {
      const body = readFileSync(join(root, path === '' ? 'index.html' : path))
      res
        .writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' })
        .end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }),
    ),
  )
}

export const bundleOf = async (request, tourID) => {
  const r = await request.get(`/export/${tourID}.zip`)
  expect(r.ok(), await r.text()).toBe(true)
  return unzipSync(new Uint8Array(await r.body()))
}

export async function withApp(files, options, fn) {
  const app = plainApp()
  applyBundle(app, files, options)
  const server = await serve(join(app.dir, 'webapp'))
  try {
    await fn(server.url)
  } finally {
    server.close()
    rmSync(app.dir, { recursive: true, force: true })
  }
}

/** The files of the plain app as a project would hold them: [{ path: 'webapp/...', content }]. */
export function plainSources() {
  const app = plainApp()
  try {
    return loadSources(app.dir, app.dir)
  } finally {
    rmSync(app.dir, { recursive: true, force: true })
  }
}

/** The plain app with the files of a "changes" zip unzipped over it (as its CHANGES.md says), served. */
export async function withChanges(files, fn) {
  const app = plainApp()
  for (const [name, data] of Object.entries(files)) {
    if (name === 'CHANGES.md' || name.endsWith('/')) continue
    mkdirSync(dirname(join(app.dir, name)), { recursive: true })
    writeFileSync(join(app.dir, name), data)
  }
  const server = await serve(join(app.dir, 'webapp'))
  try {
    await fn(server.url)
  } finally {
    server.close()
    rmSync(app.dir, { recursive: true, force: true })
  }
}
