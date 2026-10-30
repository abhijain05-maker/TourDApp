import { test, expect } from '@playwright/test'

const DEMO = 'http://localhost:8081/index.html'
const VERSIONS = ['1.120', '1.148', 'latest']

// Exact element ids (a suffix match would also hit layout wrappers like ...Grid-wrapperfor-...--customerInput).
const ctl = (view, id) => `[id="container-demo---${view}--${id}"]`

const bubble = (page) => page.locator('.tourd-bubble')
const title = (page) => page.locator('.tourd-title')
const nextBtn = (page) => page.locator('.tourd-btn--primary')
const backBtn = (page) => page.locator('.tourd-btn:not(.tourd-btn--primary)')

async function openDemo(page, ui5) {
  await page.goto(`${DEMO}?ui5=${ui5}`)
  await page.locator(ctl('main', 'startTourBtn')).waitFor()
  await page.evaluate(() => {
    window.__ev = []
    for (const t of ['started', 'stepChanged', 'completed', 'skipped', 'stopped', 'error']) {
      window.addEventListener('tourd:' + t, (e) =>
        window.__ev.push({ type: t, index: e.detail.index, code: e.detail.code }),
      )
    }
  })
}

const eventTypes = async (page) => (await page.evaluate(() => window.__ev)).map((e) => e.type)

// Spotlight sits SPOT_PAD (4px) around the target; measured as the largest deviation from that padding
// on any side, in (sub)pixels. The player tracks the target to a quarter pixel, so half a pixel is generous.
async function expectSpotOn(page, selector) {
  await expect
    .poll(() =>
      page.evaluate((sel) => {
        const t = document.querySelector(sel).getBoundingClientRect()
        const s = document.querySelector('.tourd-spot').getBoundingClientRect()
        const gaps = [t.left - s.left, t.top - s.top, s.right - t.right, s.bottom - t.bottom]
        return Math.max(...gaps.map((g) => Math.abs(g - 4)))
      }, selector),
    )
    .toBeLessThanOrEqual(0.5)
}

// The bubble must be fully on screen and must not cover the highlighted control.
async function expectBubbleClear(page, selector) {
  const r = await page.evaluate((sel) => {
    const b = document.querySelector('.tourd-bubble').getBoundingClientRect()
    const t = document.querySelector(sel).getBoundingClientRect()
    const overlap = !(
      b.right <= t.left ||
      b.left >= t.right ||
      b.bottom <= t.top ||
      b.top >= t.bottom
    )
    const inView = b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight
    return { overlap, inView }
  }, selector)
  expect(r).toEqual({ overlap: false, inView: true })
}

for (const ui5 of VERSIONS) {
  test(`plays the whole tour on UI5 ${ui5}`, async ({ page }) => {
    await openDemo(page, ui5)
    await page.locator(ctl('main', 'startTourBtn')).click()

    // 1 - centered intro; title comes from {i18n>appTitle}, text is rendered Markdown
    await expect(bubble(page)).toBeVisible()
    await expect(title(page)).toHaveText('Demo Orders')
    await expect(bubble(page)).toHaveAttribute('data-side', 'center')
    await expect(page.locator('.tourd-progress')).toHaveText('Step 1 of 7')
    await expect(page.locator('.tourd-body strong').first()).toHaveText('find')
    await expect(backBtn(page)).toBeDisabled()
    await expect(nextBtn(page)).toHaveText('Next')

    // 2 - search field highlighted
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Find orders')
    await expectSpotOn(page, ctl('main', 'searchField'))
    await expectBubbleClear(page, ctl('main', 'searchField'))
    await expect(backBtn(page)).toBeEnabled()

    // 3 - table, 4 - create button (bubble below it)
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Your orders')
    await expectSpotOn(page, ctl('main', 'ordersTable'))
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Create an order')
    await expectSpotOn(page, ctl('main', 'createBtn'))
    await expect(bubble(page)).toHaveAttribute('data-side', 'bottom')

    // 5 - the step navigates to the detail view first
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Who is the customer?')
    await expect(page).toHaveURL(/#\/order\/new$/)
    await expectSpotOn(page, ctl('detail', 'customerInput'))
    await expectBubbleClear(page, ctl('detail', 'customerInput'))
    await expect(page.locator('.tourd-body li')).toHaveCount(2)

    // Back returns to the list route and the previous target
    await backBtn(page).click()
    await expect(title(page)).toHaveText('Create an order')
    await expect(page).not.toHaveURL(/order\/new/)
    await expectSpotOn(page, ctl('main', 'createBtn'))

    // forward again, through to the last step
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Who is the customer?')
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Set the status')
    await expectSpotOn(page, ctl('detail', 'statusSelect'))
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Save it')
    await expectSpotOn(page, ctl('detail', 'saveBtn'))
    await expect(nextBtn(page)).toHaveText('Done')

    // Done closes everything
    await nextBtn(page).click()
    await expect(bubble(page)).toHaveCount(0)
    await expect(page.locator('.tourd-spot, .tourd-shield')).toHaveCount(0)
    const types = await eventTypes(page)
    expect(types[0]).toBe('started')
    expect(types.filter((t) => t === 'stepChanged').length).toBeGreaterThanOrEqual(8)
    expect(types.at(-1)).toBe('completed')
    expect(types).not.toContain('error')
  })
}

// ---------------------------------------------------------------- edge cases (UI5 1.120)

// Starts a tour object through the real module, the same way an app would.
function startTour(page, tour, opts = {}) {
  return page.evaluate(
    ([t, o]) =>
      new Promise((resolve, reject) =>
        sap.ui.require(
          ['tourd/TourPlayer'],
          (P) => P.start(t, o).then(() => resolve(), reject),
          reject,
        ),
      ),
    [tour, opts],
  )
}

const mainTarget = (controlId) => ({ viewName: 'demo.orders.view.Main', controlId })

test.describe('edge cases', () => {
  test('Escape closes the tour and reports "skipped"', async ({ page }) => {
    await openDemo(page, '1.120')
    await page.locator(ctl('main', 'startTourBtn')).click()
    await expect(bubble(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(bubble(page)).toHaveCount(0)
    expect(await eventTypes(page)).toContain('skipped')
  })

  test('the close button skips; arrow keys navigate', async ({ page }) => {
    await openDemo(page, '1.120')
    await page.locator(ctl('main', 'startTourBtn')).click()
    await expect(title(page)).toHaveText('Demo Orders')
    await page.keyboard.press('ArrowRight')
    await expect(title(page)).toHaveText('Find orders')
    await page.keyboard.press('ArrowLeft')
    await expect(title(page)).toHaveText('Demo Orders')
    await page.locator('.tourd-close').click()
    await expect(bubble(page)).toHaveCount(0)
    expect(await eventTypes(page)).toContain('skipped')
  })

  test('the app stays usable while the tour runs, unless the tour says otherwise', async ({ page }) => {
    await openDemo(page, '1.120')
    await page.locator(ctl('main', 'startTourBtn')).click()
    await nextBtn(page).click() // search field step; the Create button is outside the bubble
    await expect(title(page)).toHaveText('Find orders')
    await expect(page.locator('.tourd-shield')).toHaveCount(0)
    await page.locator(ctl('main', 'createBtn')).click()
    await expect(page).toHaveURL(/order\/new/)
  })

  test('with interactive off, the shield swallows clicks so the app underneath is not triggered', async ({ page }) => {
    await openDemo(page, '1.120')
    await startTour(
      page,
      {
        steps: [
          { id: 'a', title: 'First', text: 'x', target: mainTarget('startTourBtn') },
          { id: 'b', title: 'Find orders', text: 'x', target: mainTarget('searchField') },
        ],
        options: { interactive: false },
      },
      {},
    )
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Find orders')
    const box = await page.locator(ctl('main', 'createBtn')).boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page).not.toHaveURL(/order\/new/)
    await expect(title(page)).toHaveText('Find orders')
  })

  test('moving to the next step does not take the person back to the start page', async ({ page }) => {
    await openDemo(page, '1.120')
    await startTour(
      page,
      {
        steps: [
          { id: 'a', title: 'First', text: 'x', target: mainTarget('startTourBtn') },
          { id: 'b', title: 'Second', text: 'x' },
        ],
      },
      {},
    )
    await page.evaluate(() => (location.hash = '#/order/new')) // the person goes on to another screen by themselves
    await expect(page).toHaveURL(/order\/new/)
    await nextBtn(page).click()
    await expect(title(page)).toHaveText('Second')
    await expect(page).toHaveURL(/order\/new/)
  })

  test('pressing the highlighted control goes on to the next step by itself', async ({ page }) => {
    await openDemo(page, '1.120')
    await startTour(
      page,
      {
        steps: [
          { id: 'a', title: 'Press create', text: 'x', target: mainTarget('createBtn') },
          { id: 'b', title: 'Pressed', text: 'x' },
        ],
      },
      {},
    )
    await expect(title(page)).toHaveText('Press create')
    await page.locator(ctl('main', 'createBtn')).click()
    await expect(title(page)).toHaveText('Pressed', { timeout: 5000 })
  })

  test('a control that appears later is found while the person uses the app', async ({ page }) => {
    await openDemo(page, '1.120')
    await startTour(
      page,
      {
        steps: [{ id: 'a', title: 'Later', text: 'x', target: { viewName: 'demo.orders.view.Main', controlId: 'createBtn' } }],
        options: { waitTimeoutMs: 0 },
      },
      {},
    )
    await expect(title(page)).toHaveText('Later')
    await expect(page.locator('.tourd-spot')).toBeVisible({ timeout: 5000 })
  })

  test('a missing target falls back to a centered step and reports an error', async ({ page }) => {
    await openDemo(page, '1.120')
    await startTour(
      page,
      {
        steps: [{ id: 'g', title: 'Ghost', text: 'x', target: mainTarget('doesNotExist') }],
        options: { waitTimeoutMs: 300 },
      },
      { debug: true },
    )
    await expect(title(page)).toHaveText('Ghost')
    await expect(bubble(page)).toHaveAttribute('data-side', 'center')
    await expect(page.locator('.tourd-warn')).toBeVisible()
    await expect(page.locator('.tourd-spot')).toBeHidden()
    const ev = await page.evaluate(() => window.__ev)
    expect(ev.find((e) => e.type === 'error')?.code).toBe('TARGET_NOT_FOUND')
  })

  test('missingTarget "skip" jumps to the next resolvable step', async ({ page }) => {
    await openDemo(page, '1.120')
    await startTour(
      page,
      {
        steps: [
          { id: 'g', title: 'Ghost', target: mainTarget('doesNotExist') },
          { id: 'ok', title: 'Real one', target: mainTarget('createBtn') },
        ],
        options: { waitTimeoutMs: 300 },
      },
      { missingTarget: 'skip' },
    )
    await expect(title(page)).toHaveText('Real one')
    await expectSpotOn(page, ctl('main', 'createBtn'))
  })

  test('waits for a target that renders late', async ({ page }) => {
    await openDemo(page, '1.120')
    // Hide the button, start the tour, and show it again after 600ms.
    await page.evaluate(() => {
      const b = document.querySelector('[id="container-demo---main--createBtn"]')
      b.style.display = 'none'
      setTimeout(() => (b.style.display = ''), 600)
    })
    await startTour(page, {
      steps: [{ id: 'late', title: 'Late', target: mainTarget('createBtn') }],
    })
    await expect(title(page)).toHaveText('Late')
    await expectSpotOn(page, ctl('main', 'createBtn'))
  })

  test('every placement in the schema is a real sap.m.PlacementType', async ({ page }) => {
    const { PLACEMENTS } = await import('../../shared/tour-schema.mjs')
    await openDemo(page, '1.120')
    const keys = await page.evaluate(() => Object.keys(sap.m.PlacementType))
    for (const p of PLACEMENTS) expect(keys, p).toContain(p)
  })

  test('Markdown is sanitised: scripts and event handlers never reach the DOM', async ({
    page,
  }) => {
    await openDemo(page, '1.120')
    await startTour(page, {
      steps: [
        {
          id: 'x',
          title: 'Safe',
          text: '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script> [ok](https://example.com) [bad](javascript:alert(1))',
        },
      ],
    })
    await expect(title(page)).toHaveText('Safe')
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined()
    await expect(page.locator('.tourd-body script')).toHaveCount(0)
    await expect(page.locator('.tourd-body a[href^="https://example.com"]')).toHaveCount(1)
    await expect(page.locator('.tourd-body a[href^="javascript"]')).toHaveCount(0)
  })

  test('is accessible: dialog semantics, focus moves in and returns on close', async ({ page }) => {
    await openDemo(page, '1.120')
    const startBtn = page.locator(ctl('main', 'startTourBtn'))
    await startBtn.focus()
    await startBtn.click()
    await expect(bubble(page)).toBeVisible()

    await expect(bubble(page)).toHaveAttribute('role', 'dialog')
    await expect(bubble(page)).toHaveAttribute('aria-modal', 'false') // the app stays in use
    const labelledBy = await bubble(page).getAttribute('aria-labelledby')
    await expect(page.locator(`[id="${labelledBy}"]`)).toHaveText('Demo Orders')
    await expect(page.locator('.tourd-close')).toHaveAttribute('aria-label', 'Close tour')
    const inside = () =>
      page.evaluate(() => document.querySelector('.tourd-bubble').contains(document.activeElement))
    expect(await inside()).toBe(true)

    // focus returns to the element that started the tour
    await page.keyboard.press('Escape')
    await expect(bubble(page)).toHaveCount(0)
    await expect(startBtn).toBeFocused()
  })

  test('a modal tour (interactive off) traps focus', async ({ page }) => {
    await openDemo(page, '1.120')
    await startTour(
      page,
      { steps: [{ id: 'a', title: 'Modal', text: 'x', target: mainTarget('startTourBtn') }], options: { interactive: false } },
      {},
    )
    await expect(bubble(page)).toHaveAttribute('aria-modal', 'true')
    const inside = () =>
      page.evaluate(() => document.querySelector('.tourd-bubble').contains(document.activeElement))
    expect(await inside()).toBe(true)
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      expect(await inside()).toBe(true)
    }
  })

  test('reports which UI5 version "latest" resolved to', async ({ page }) => {
    await openDemo(page, 'latest')
    const v = await page.evaluate(() => sap.ui.version)
    console.log('UI5 latest =', v)
    expect(v).toMatch(/^1\.\d+\./)
  })
})
