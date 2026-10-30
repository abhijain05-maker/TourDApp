import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { buildPlan } from '../../srv/lib/wdi5/plan.js'
import { planTestApply } from '../../srv/lib/wdi5/apply.js'
import { demoSources } from '../helpers/sources.js'

// Opt-in (npm run test:wdi5): generates the tests from the recorded demo flow, installs the real wdi5 / WebdriverIO
// packages, and runs them in Chrome against the demo app. Needs network (npm, the UI5 CDN, a matching Chrome) and
// takes a few minutes the first time; the installed packages are kept in a temp folder between runs.

const TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.properties': 'text/plain',
}
const APP = 'samples/demo-app/webapp'
const inventory = buildInventory(demoSources())
const mapped = mapRecording(
  parseRecording(readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8')),
  inventory,
)
/** Not spawnSync: the demo app is served by this very process. */
const run = (cmd, args, options) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { ...options, shell: process.platform === 'win32' })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

let server
let baseUrl
beforeAll(async () => {
  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(
      /^[\\/]+/,
      '',
    )
    let body
    try {
      body = readFileSync(join(APP, path || 'index.html'))
    } catch {
      return res.writeHead(404).end('not found')
    }
    res
      .writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' })
      .end(body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${server.address().port}/index.html`
})
afterAll(() => server?.close())

for (const [framework, auth] of [
  ['mocha', 'none'],
  ['jasmine', 'basic'],
]) {
  describe(`generated ${framework} tests (login: ${auth})`, () => {
    it('install, run in Chrome against the demo app, and pass', async () => {
      const dir = join(tmpdir(), `tourd-wdi5-${framework}`)
      const plan = buildPlan({
        mapped,
        inventory,
        name: 'Create an order',
        settings: { framework, auth, baseUrl },
      })
      const files = demoSources().map((f) => ({ path: f.path, content: f.content }))
      const result = await planTestApply({ plan, files })
      expect(result.ok).toBe(true)
      // only what TourD would add or change; the app itself is served from samples/
      rmSync(join(dir, 'test'), { recursive: true, force: true })
      for (const e of result.edits) {
        if (e.path.startsWith('webapp/')) continue
        mkdirSync(dirname(join(dir, e.path)), { recursive: true })
        writeFileSync(join(dir, e.path), e.after)
      }
      const install = await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir })
      expect(install.status, install.stderr).toBe(0)
      const wdio = await run(npx, ['wdio', 'run', 'wdio.conf.js', '--headless'], {
        cwd: dir,
        env: {
          ...process.env,
          BASE_URL: baseUrl,
          BROWSER_VERSION: process.env.BROWSER_VERSION ?? 'stable',
          wdi5_username: 'u',
          wdi5_password: 'p',
        },
      })
      const out = `${wdio.stdout}\n${wdio.stderr}`
      expect(wdio.status, out.slice(-3000)).toBe(0)
      expect(out).toMatch(/\b5 passing\b/)
      // the demo package.json has no name clash: its own scripts were kept
      expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.wdi5).toBe(
        'wdio run wdio.conf.js',
      )
    })
  })
}

describe('generated tests added to a project that has wdi5 already', () => {
  it("calls the project's own page object and login, and runs next to its own spec", async () => {
    const dir = join(tmpdir(), 'tourd-wdi5-existing')
    const fixture = 'test/fixtures/wdi5-projects/cjs-pages'
    const walk = (d) =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      )
    const files = [
      ...demoSources().filter((f) => f.path !== 'package.json'),
      ...walk(fixture).map((p) => ({
        path: p
          .slice(fixture.length + 1)
          .split(/[\\/]/)
          .join('/'),
        content: readFileSync(p, 'utf8'),
      })),
    ]
    const plan = buildPlan({ mapped, inventory, name: 'Create an order', settings: { baseUrl } })
    const result = await planTestApply({ plan, files })
    expect(result.ok).toBe(true)
    expect(result.existing.reuse.steps.length).toBeGreaterThan(0)

    rmSync(join(dir, 'e2e'), { recursive: true, force: true })
    for (const f of files.filter((x) => !x.path.startsWith('webapp/'))) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true })
      writeFileSync(join(dir, f.path), f.content)
    }
    for (const e of result.edits) {
      mkdirSync(dirname(join(dir, e.path)), { recursive: true })
      writeFileSync(join(dir, e.path), e.after)
    }
    const install = await run(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir })
    expect(install.status, install.stderr).toBe(0)
    const wdio = await run(npx, ['wdio', 'run', 'wdio.conf.js', '--headless'], {
      cwd: dir,
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        BROWSER_VERSION: process.env.BROWSER_VERSION ?? 'stable',
      },
    })
    const out = `${wdio.stdout}\n${wdio.stderr}`
    expect(wdio.status, out.slice(-3000)).toBe(0)
    expect(out).toMatch(/Spec Files:\s+2 passed, 2 total/)
  })
})
