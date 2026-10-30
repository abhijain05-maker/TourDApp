import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseRecording } from '../../srv/lib/recordings/index.js'
import { mapRecording } from '../../srv/lib/recordings/map.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { buildPlan } from '../../srv/lib/wdi5/plan.js'
import {
  literal,
  patchPackageJson,
  renderConfig,
  renderJourney,
  renderProject,
  renderSpec,
} from '../../srv/lib/wdi5/render.js'
import { demoSources } from '../helpers/sources.js'

const inventory = buildInventory(demoSources())
const plan = (settings = {}, edit = (p) => p) =>
  edit(
    buildPlan({
      mapped: mapRecording(
        parseRecording(
          readFileSync('test/fixtures/recordings/demo-create-order.tourd.json', 'utf8'),
        ),
        inventory,
      ),
      inventory,
      name: 'Create an order',
      settings,
    }),
  )
const parses = (code) => expect(() => new vm.Script(code)).not.toThrow()

describe('literal', () => {
  it('writes JavaScript, not JSON', () => {
    expect(literal({ id: 'a', viewName: 'v.W' })).toBe('{ id: "a", viewName: "v.W" }')
    expect(literal({ 'a-b': [1, 'x'], c: null })).toBe('{ "a-b": [1, "x"], c: null }')
    expect(literal({})).toBe('{}')
    expect(literal({ text: 'He said "hi"\n' })).toBe('{ text: "He said \\"hi\\"\\n" }')
  })
})

describe('the generated project', () => {
  const { files, pkg } = renderProject({ plan: plan(), root: 'app/' })
  const byName = Object.fromEntries(files.map((f) => [f.path.replace('app/', ''), f.content]))

  it('has the files of a wdi5 project, in the layout the README names', () => {
    expect(Object.keys(byName).sort()).toEqual([
      '.env.example',
      'test/e2e/README.md',
      'test/e2e/helpers/ui5.js',
      'test/e2e/journeys/create-an-order.journey.js',
      'test/e2e/specs/create-an-order.test.js',
      'wdio.conf.js',
    ])
    expect(pkg.path).toBe('app/package.json')
    expect(byName['test/e2e/README.md']).toContain('journeys/create-an-order.journey.js')
  })

  it('is JavaScript that parses', () => {
    for (const [name, code] of Object.entries(byName)) if (name.endsWith('.js')) parses(code)
  })

  it('points the config at the specs, with WebdriverIO 9 pinned', () => {
    expect(byName['wdio.conf.js']).toContain('specs: ["./test/e2e/specs/**/*.test.js"]')
    expect(byName['wdio.conf.js']).toContain('services: ["ui5"]')
    expect(byName['wdio.conf.js']).toContain('mochaOpts')
    expect(JSON.parse(pkg.text).devDependencies).toMatchObject({
      webdriverio: '^9',
      'wdio-ui5-service': '^3',
      '@wdio/mocha-framework': '^9',
    })
    expect(JSON.parse(pkg.text).devDependencies['@wdio/jasmine-framework']).toBeUndefined()
  })

  it('the journey does what the recording did, through wdi5', async () => {
    const calls = []
    const browser = {
      asControl: (locator) => ({
        press: async () => calls.push(['press', locator.selector.id]),
        enterText: async (t) => calls.push(['enterText', locator.selector.id, t]),
        open: async () => calls.push(['open', locator.selector.id]),
      }),
      keys: async (k) => calls.push(['keys', k]),
    }
    const module = { exports: {} }
    const require = (name) => {
      if (name === '../helpers/ui5') {
        const h = { exports: {} }
        vm.runInNewContext(byName['test/e2e/helpers/ui5.js'], { module: h, browser })
        return h.exports
      }
      throw new Error(`unexpected require ${name}`)
    }
    vm.runInNewContext(byName['test/e2e/journeys/create-an-order.journey.js'], {
      module,
      require,
      browser,
    })
    const j = module.exports
    await j.searchForAcme()
    await j.pressCreate()
    await j.enterAcmeCorpInCustomer()
    await j.chooseShippedInStatus()
    await j.pressSave()
    expect(calls).toEqual([
      ['enterText', 'searchField', 'Acme'],
      ['keys', 'Enter'],
      ['press', 'createBtn'],
      ['enterText', 'customerInput', 'Acme Corp'],
      ['open', 'statusSelect'],
      ['press', undefined], // the item of the select: found by its text, below the select
      ['press', 'saveBtn'],
    ])
  })

  it('the spec calls the steps and checks what the recording showed', () => {
    const spec = byName['test/e2e/specs/create-an-order.test.js']
    expect(spec).toContain('before(async () => {')
    expect(spec).toContain('await journey.pressCreate()')
    expect(spec).toContain(
      'await expect(browser).toHaveUrl(expect.stringContaining("#/order/new"))',
    )
    expect(spec).toContain(
      'expect(await browser.asControl(locators.customerInput).getValue()).toBe("Acme Corp")',
    )
    expect(spec).toContain(
      'expect(await browser.asControl(locators.statusSelect).getSelectedKey()).toBe("Shipped")',
    )
    expect(spec).toContain(
      'await expect(browser).toHaveUrl(expect.stringMatching(/^[^#]*#?\\/?$/))',
    )
  })
})

describe('settings', () => {
  it('Jasmine: its own framework, options and hooks', () => {
    const p = plan({ framework: 'jasmine' })
    const config = renderConfig({ settings: p.settings, specGlob: './test/e2e/specs/**/*.test.js' })
    expect(config).toContain('framework: "jasmine"')
    expect(config).toContain('jasmineOpts')
    expect(config).not.toContain('mochaOpts')
    expect(renderSpec(p, 'x.journey')).toContain('beforeAll(async () => {')
    const { pkg } = renderProject({ plan: p, root: '' })
    expect(JSON.parse(pkg.text).devDependencies['@wdio/jasmine-framework']).toBe('^9')
    expect(JSON.parse(pkg.text).devDependencies['@wdio/mocha-framework']).toBeUndefined()
  })

  it('login: none, basic, BTP, custom - credentials only from the environment', () => {
    const cfg = (auth, authSelectors) =>
      renderConfig({ settings: plan({ auth, authSelectors }).settings, specGlob: 'x' })
    expect(cfg('none')).not.toContain('wdi5:authentication')
    expect(cfg('basic')).toContain('provider: "BasicAuth"')
    expect(cfg('btp')).toContain('provider: "BTP"')
    const custom = cfg('custom', { username: '#u', password: '#p', submit: '#go' })
    expect(custom).toContain('provider: "custom"')
    expect(custom).toContain('usernameSelector: "#u"')
    for (const a of ['none', 'basic', 'btp', 'custom']) {
      parses(cfg(a, { username: '#u', password: '#p', submit: '#go' }))
      expect(cfg(a)).not.toMatch(/password\s*:\s*"[^#]/i)
    }
    expect(
      renderProject({ plan: plan({ auth: 'basic' }), root: '' }).files.find(
        (f) => f.path === '.env.example',
      ).content,
    ).toContain('wdi5_username=')
  })

  it('a step that is switched off becomes a skipped test with its reason', () => {
    const p = plan({}, (x) => {
      const s = x.steps.find((st) => st.title === 'Press Save')
      s.enabled = false
      s.note = 'left out on purpose'
      return x
    })
    const spec = renderSpec(p, 'x.journey')
    expect(spec).toContain('// left out on purpose\n    xit("Press Save"')
    expect(renderJourney(p)).not.toContain('pressSave')
    parses(spec)
  })

  it('quotes in titles and values do not break the code', () => {
    const p = plan({}, (x) => {
      x.steps.find((s) => s.kind === 'enterText').value = 'say "hi" \\ \n there'
      x.steps.find((s) => s.kind === 'enterText').title = 'Enter "x" in `Customer` ${nope}'
      x.steps.find((s) => s.kind === 'press').title = 'Press */ process.exit(1) /*\nprocess.exit(2)'
      x.name = 'It\'s "quoted" */\nprocess.exit(3)'
      return x
    })
    parses(renderJourney(p))
    parses(renderSpec(p, 'x.journey'))
    // nothing of a title can reach the code outside of a string or a comment
    const code = renderJourney(p) + renderSpec(p, 'x.journey')
    expect(code.split('\n').filter((l) => /^\s*process\.exit/.test(l))).toEqual([])
  })

  it('a start page other than the default is opened with wdi5.goTo', () => {
    const p = plan({}, (x) => {
      x.steps[0].hash = '/orders'
      return x
    })
    const journey = renderJourney(p)
    expect(journey).toContain('const { wdi5 } = require("wdio-ui5-service")')
    expect(journey).toContain('await wdi5.goTo("#/orders")')
    parses(journey)
  })
})

describe('patchPackageJson', () => {
  it('adds scripts and dev dependencies and never changes what is there', () => {
    const text = JSON.stringify(
      {
        name: 'app',
        scripts: { start: 'ui5 serve', wdi5: 'my own' },
        devDependencies: { webdriverio: '^8.0.0', zod: '1' },
      },
      null,
      '\t',
    )
    const out = JSON.parse(patchPackageJson(text, { framework: 'mocha' }).text)
    expect(out.scripts).toEqual({
      start: 'ui5 serve',
      wdi5: 'my own',
      'wdi5:headless': 'wdio run wdio.conf.js --headless',
    })
    expect(out.devDependencies.webdriverio).toBe('^8.0.0')
    expect(out.devDependencies['wdio-ui5-service']).toBe('^3')
    expect(patchPackageJson(text, { framework: 'mocha' }).text).toMatch(/^\{\n\t"name"/) // the file's own indentation
  })

  it('is a no-op when everything is there, creates the file when there is none, and reports a broken one', () => {
    const first = patchPackageJson(null, { appId: 'demo.orders', framework: 'mocha' }).text
    expect(JSON.parse(first)).toMatchObject({ name: 'demo-orders', private: true })
    expect(patchPackageJson(first, { framework: 'mocha' }).text).toBeNull()
    expect(patchPackageJson('{ nope', { framework: 'mocha' }).error).toMatch(/not valid JSON/)
  })
})
