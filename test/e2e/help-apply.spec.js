import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { loadSources } from '../helpers/sources.js'
import { planHelpApply } from '../../srv/lib/export/help-apply.js'
import { buildInventory } from '../../srv/lib/context/inventory.js'

// Help placed into the code of an app (Phase 11): the files the planner writes, in a copy of the demo app, are all an
// end user needs - no extension, no TourD. The help layer starts from the Component, shows the help panel and its "?"
// badges and popovers, and docks the panel next to the app.

const SOURCES = loadSources('samples/demo-app', 'samples/demo-app').map((f) =>
  // the demo app as it was before anyone added help: its tour stays, the help layer is not there
  f.path.endsWith('/manifest.json')
    ? { ...f, content: JSON.stringify(JSON.parse(f.content), null, '\t') }
    : f,
)

const help = {
  schemaVersion: 1,
  id: 'h-demo',
  title: 'Orders help',
  options: { panelTitle: 'Help Topics', showBadges: true },
  topics: [
    {
      id: 't-create',
      title: 'Create Order',
      summary: 'Create a new order.',
      text: 'Press **Create** to open the order form.',
      note: 'You need the Sales role.',
      links: [{ label: 'Orders guide', url: 'https://example.com/orders' }],
      target: { viewName: 'demo.orders.view.Main', controlId: 'createBtn', fallbacks: [] },
    },
    {
      id: 't-search',
      title: 'Search orders',
      summary: 'Find an order by customer.',
      text: 'Type a customer name and press Enter.',
      note: '',
      links: [],
      target: { viewName: 'demo.orders.view.Main', controlId: 'searchField', fallbacks: [] },
    },
    {
      id: 't-elsewhere',
      title: 'Order details',
      summary: 'Only on the detail page.',
      text: 'The customer is entered here.',
      note: '',
      links: [],
      target: { viewName: 'demo.orders.view.Detail', controlId: 'customerInput', fallbacks: [] },
    },
  ],
}

let dir
let server
let url

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tourd-help-app-'))
  cpSync('samples/demo-app/webapp', join(dir, 'webapp'), { recursive: true })
  // what TourD would hand over: the plan of the files, applied to the app
  const plan = planHelpApply({
    help,
    inventory: buildInventory(SOURCES),
    files: SOURCES,
    playerSource: readFileSync('player/TourPlayer.js', 'utf8'),
    helpSource: readFileSync('player/HelpLayer.js', 'utf8'),
  })
  expect(plan.ok, JSON.stringify(plan.blocking)).toBe(true)
  for (const e of plan.edits.filter((x) => x.action !== 'unchanged')) {
    mkdirSync(dirname(join(dir, e.path)), { recursive: true })
    writeFileSync(join(dir, e.path), e.after)
  }
  const types = {
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.html': 'text/html',
    '.xml': 'application/xml',
    '.properties': 'text/plain',
  }
  server = createServer((req, res) => {
    try {
      const file = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
      if (!file.startsWith(dir)) throw new Error('outside')
      res.setHeader('content-type', types[extname(file)] ?? 'text/plain')
      res.end(readFileSync(file))
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${server.address().port}/webapp/index.html?ui5=1.120`
})

test.afterAll(async () => {
  server?.close()
  rmSync(dir, { recursive: true, force: true })
})

test('the app starts the help layer by itself; panel, badges and popovers work for an end user', async ({
  page,
}) => {
  await page.goto(url)
  await expect(page.locator('[data-sap-ui$="--createBtn"]')).toBeVisible({ timeout: 45_000 })

  // the help button is there; the panel is closed and the app has its full width
  const toggle = page.locator('.tourd-help-toggle')
  await expect(toggle).toBeVisible({ timeout: 20_000 })
  // the ? sits at the top of the app, like the help icon in a shell bar
  expect((await toggle.boundingBox()).y).toBeLessThan(40)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.tourd-help-panel')).toBeHidden()
  const widthBefore = await page.evaluate(() => document.body.getBoundingClientRect().width)

  // open it: the topics of this screen (not the one of the detail page), the app moves over
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // it never lies over something the user can click in the app (it steps aside for the app's own buttons)
  // (the app is laid out again after the panel docks; the ? settles within a moment)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const t = document.querySelector('.tourd-help-toggle').getBoundingClientRect()
        return [...document.querySelectorAll('button, [role=button], a, input')]
          .filter((e) => !e.closest('[data-tourd-ui]'))
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .filter(
            (r) => r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top,
          ).length
      }),
    )
    .toBe(0)
  await expect(toggle).toBeVisible() // it stays, beside the panel, so help can be switched off again
  expect((await toggle.boundingBox()).x + 32).toBeLessThanOrEqual(
    (await page.locator('.tourd-help-panel').boundingBox()).x,
  )
  const panel = page.locator('.tourd-help-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Help Topics')
  await expect(panel).toContainText('About This Screen')
  const items = panel.locator('.tourd-help-item')
  await expect(items).toHaveCount(2)
  await expect(items.first()).toContainText('Search orders') // in reading order: the search field is left of Create
  await expect(page.locator('.tourd-help-badge')).toHaveCount(2)
  const widthDocked = await page.evaluate(() => document.body.getBoundingClientRect().width)
  expect(widthDocked).toBeLessThan(widthBefore - 250)
  const createBox = await page.locator('[data-sap-ui$="--createBtn"]').boundingBox()
  const panelBox = await panel.boundingBox()
  expect(createBox.x + createBox.width).toBeLessThanOrEqual(panelBox.x) // nothing of the app is covered

  // pointing at a topic outlines its control and draws the line to its badge
  await items.nth(1).hover()
  await expect(page.locator('.tourd-help-spot')).toBeVisible()
  await expect(page.locator('.tourd-help-line line')).toHaveCount(1)

  // search finds a topic of another screen too, without a badge
  await panel.locator('.tourd-help-search').fill('customer')
  await expect(panel).toContainText('Elsewhere in the app')
  await expect(panel.locator('.tourd-help-item', { hasText: 'Order details' })).toBeVisible()
  await panel.locator('.tourd-help-search').fill('')

  // the popover: text, note, related links; Escape closes it
  await page.locator('.tourd-help-badge[data-topic="t-create"]').click()
  const pop = page.locator('.tourd-help-pop')
  await expect(pop).toBeVisible()
  await expect(pop).toContainText('Create Order')
  await expect(pop.locator('strong')).toHaveText('Create')
  await expect(pop.locator('.tourd-help-note')).toContainText('You need the Sales role.')
  await expect(pop.locator('a[href="https://example.com/orders"]')).toHaveText('Orders guide')
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await expect(panel).toBeVisible()

  // the app still works with the panel open, and the help follows the screen
  await page.locator('[data-sap-ui$="--createBtn"]').click()
  await expect(page.locator('[data-sap-ui$="--customerInput"]')).toBeVisible()
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('Order details')

  // closing gives the app its width back
  await panel.locator('.tourd-help-head .tourd-help-x').click()
  await expect(panel).toBeHidden()
  expect(await page.evaluate(() => document.body.getBoundingClientRect().width)).toBeCloseTo(
    widthBefore,
    0,
  )

  // the same ? switches the help on and off
  await toggle.click()
  await expect(panel).toBeVisible()
  await toggle.click()
  await expect(panel).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  // an app whose header is crowded can have the button in the bottom corner instead
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        sap.ui.require(['tourd/HelpLayer'], async (HelpLayer) => {
          const raw = await (await fetch('tourd/help.json')).json()
          await HelpLayer.start({ ...raw, options: { ...raw.options, buttonPosition: 'bottom' } })
          resolve()
        }),
      ),
  )
  await expect(toggle).toBeVisible()
  expect((await toggle.boundingBox()).y).toBeGreaterThan(600)
})
