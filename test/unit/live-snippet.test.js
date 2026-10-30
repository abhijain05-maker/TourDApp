import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  buildInlineSnippet,
  buildLoaderSnippet,
  buildRecorderSnippet,
  jsonForScript,
  playerAsPredefine,
  toBookmarklet,
} from '../../shared/live-snippet.mjs'

const playerSource = readFileSync('player/TourPlayer.js', 'utf8')
const tour = {
  schemaVersion: 1,
  id: 't',
  title: 'A </script> tour   with separators',
  steps: [{ id: 's1', title: 'One' }],
}

/** Runs a snippet in a fake page that records what the UI5 loader is asked to do. */
function run(code, { sap = true, fetchJson } = {}) {
  const calls = { predefine: [], require: [], alerts: [], scripts: [] }
  const win = {}
  if (sap)
    win.sap = {
      ui: {
        predefine: (...args) => calls.predefine.push(args),
        require: (deps, cb) => calls.require.push({ deps, cb }),
      },
    }
  const context = vm.createContext({
    window: win,
    ...(sap ? { sap: win.sap } : {}),
    alert: (m) => calls.alerts.push(m),
    document: {
      head: { appendChild: (s) => calls.scripts.push(s) },
      createElement: () => ({}),
    },
    fetch: (url) => {
      calls.fetched = (calls.fetched ?? []).concat(url)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(fetchJson) })
    },
  })
  new vm.Script(code).runInContext(context)
  return calls
}

describe('playerAsPredefine', () => {
  it('registers the player under an explicit name and nothing else changes', () => {
    const out = playerAsPredefine(playerSource)
    expect(out).toMatch(/sap\.ui\.predefine\("tourd\/live\/TourPlayer",\s+\[/)
    expect(out).not.toMatch(/sap\.ui\.define\(/)
    expect(out.length).toBeGreaterThan(playerSource.length)
    expect(() => new vm.Script(out)).not.toThrow()
  })

  it('refuses a source that is not an AMD module', () => {
    expect(() => playerAsPredefine('console.log(1)')).toThrow(/sap\.ui\.define/)
  })
})

describe('jsonForScript', () => {
  it('survives </script> and line separators and round-trips', () => {
    const text = jsonForScript(tour)
    expect(text).not.toContain('</script>')
    expect(text).not.toContain(String.fromCharCode(0x2028))
    expect(JSON.parse(text).steps).toEqual(tour.steps)
    expect(JSON.parse(text).title).toContain('</script>')
  })
})

describe('inline snippet', () => {
  const code = buildInlineSnippet({ playerSource, tour })

  it('is valid JavaScript', () => {
    expect(() => new vm.Script(code)).not.toThrow()
  })

  it('registers the player, then starts the tour it carries', () => {
    const calls = run(code)
    expect(calls.predefine).toHaveLength(1)
    expect(calls.predefine[0][0]).toBe('tourd/live/TourPlayer')
    expect(calls.require[0].deps).toEqual(['tourd/live/TourPlayer'])
    const started = []
    calls.require[0].cb({ start: (t, o) => started.push([t, o]) })
    expect(started).toHaveLength(1)
    expect(started[0][0]).toEqual(tour)
    expect(started[0][1]).toEqual({ debug: true })
    expect(calls.fetched).toBeUndefined() // nothing is loaded: works in an app that may not reach TourD
  })

  it('tells the user when the page is not a UI5 app instead of throwing', () => {
    const calls = run(code, { sap: false })
    expect(calls.alerts.join()).toMatch(/UI5/)
    expect(calls.predefine).toEqual([])
  })
})

describe('loader snippet', () => {
  const code = buildLoaderSnippet({ origin: 'http://localhost:4044', tourId: 'abc' })

  it('is valid JavaScript, small, and loads player and tour from the given server', async () => {
    expect(() => new vm.Script(code)).not.toThrow()
    expect(code.length).toBeLessThan(2000)
    const calls = run(code, { fetchJson: tour })
    expect(calls.scripts).toHaveLength(1)
    expect(calls.scripts[0].src).toBe('http://localhost:4044/live/player.js')
    calls.scripts[0].onload()
    expect(calls.require[0].deps).toEqual(['tourd/live/TourPlayer'])
    const started = []
    calls.require[0].cb({ start: (t) => started.push(t) })
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.fetched).toEqual(['http://localhost:4044/live/abc/tour.json'])
    expect(started).toEqual([tour])
  })

  it('does not use eval', () => {
    expect(code).not.toMatch(/\beval\b|new Function/)
  })
})

describe('bookmarklet', () => {
  it('is a javascript: URL that decodes back to the snippet', () => {
    const snippet = buildLoaderSnippet({ origin: 'http://localhost:4044', tourId: 'abc' })
    const url = toBookmarklet(snippet)
    expect(url.startsWith('javascript:')).toBe(true)
    expect(decodeURIComponent(url.slice('javascript:'.length))).toBe(snippet)
    expect(url).not.toMatch(/\s/)
  })
})

describe('recorder snippet', () => {
  const recorderSource = readFileSync('recorder/recorder.js', 'utf8')
  const code = buildRecorderSnippet({ recorderSource })

  it('is valid JavaScript that installs the recorder and starts it without the extension bridge', () => {
    expect(() => new vm.Script(code)).not.toThrow()
    const started = []
    const logs = []
    const win = {
      location: { origin: 'http://app', pathname: '/index.html', hash: '' },
      document: { title: 'App', body: {} },
      addEventListener() {},
      removeEventListener() {},
      postMessage() {},
      sap: {
        ui: {
          version: '1.120.0',
          require: (name) =>
            name === 'sap/ui/core/Control'
              ? class {
                  fireEvent() {}
                }
              : undefined,
        },
      },
    }
    win.window = win
    win.console = { log: (m) => logs.push(m) }
    vm.createContext(win)
    vm.runInContext(code, win)
    expect(win.__tourdRecorder.isRecording()).toBe(true)
    expect(logs.join()).toContain('__tourdRecorder.download()')
    void started
  })

  it('carries the recorder unchanged', () => {
    expect(code).toContain(recorderSource.trim().slice(0, 200))
  })
})
