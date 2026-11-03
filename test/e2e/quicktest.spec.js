// QuickTest (app/quicktest): the main flows in a real browser. The UI5 runtime comes from the CDN, so this needs internet.
// Without a configured AI the "AI" buttons use the rules, so no model is called.
import { test, expect } from '@playwright/test'

const Q = '/odata/v4/qtest'
const T = '/odata/v4/tour'

let projectId
let projectName

async function api(request, base, path, body) {
  const res = await request.post(`${base}${path}`, { data: body, headers: { origin: base } })
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy()
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL })
  projectName = `QT e2e ${Date.now()}`
  projectId = (await api(request, baseURL, `${T}/Projects`, { name: projectName })).ID
  // one requirement with one linked test case, so every test starts from something
  const req = JSON.parse((await api(request, baseURL, `${Q}/saveRequirement`, { projectID: projectId, data: JSON.stringify({ title: 'Seeded requirement', acceptance: 'It works\nIt is fast' }) })).value)
  await api(request, baseURL, `${Q}/saveCase`, { projectID: projectId, data: JSON.stringify({ title: 'Seeded test case', steps: [{ action: 'Open the application' }, { action: 'Click the "Create" button', expected: 'The form opens' }], requirementIDs: [req.ID] }) })
  await request.dispose()
})

test.afterAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL })
  await request.delete(`${baseURL}${T}/Projects(${projectId})`, { headers: { origin: baseURL } })
  await request.dispose()
})

const open = async (page, hash = '') => {
  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))
  await page.goto(`/quicktest/index.html#/${hash}`)
  await expect(page.locator('.sapMPage').first()).toBeVisible({ timeout: 60_000 })
  return problems
}

test('the project list shows the project and opens it', async ({ page }) => {
  const problems = await open(page)
  await page.getByText(projectName).first().click()
  await expect(page.locator('[id$="--projectName"]')).toHaveText(projectName)
  await expect(page.getByText('Requirement coverage')).toBeVisible()
  expect(problems).toEqual([])
})

test('requirements and test cases by hand, linked, in the matrix', async ({ page }) => {
  const problems = await open(page, `p/${projectId}?tab=requirements`)
  await page.locator('[id$="--reqNew"]').click()
  await page.locator('[id$="--reqTitle"] input').fill('A buyer can create an order')
  await page.locator('[id$="--reqAcceptance"] textarea').fill('The form opens\nA message is shown')
  await page.locator('[id$="--reqSave"]').click()
  await expect(page.locator('[id$="--reqTitle"] input')).toHaveValue('A buyer can create an order')
  await expect(page.locator('.qtBanner .qtCode:visible').first()).toHaveText('REQ-002')

  // a test case with steps, linked to the requirement on the Requirements section
  await page.goto(`/quicktest/index.html#/p/${projectId}/case/new`)
  await page.locator('[id$="--caseTitle"] input').fill('Create an order with valid data')
  await page.locator('#qtTeststeps, [id$="--stepList"] textarea').first().fill('Open the application')
  await page.locator('[id$="--stepAdd"]').click()
  await page.locator('[id$="--stepList"] textarea').nth(3).fill('Click the "Create" button')
  await page.locator('[id$="--caseTabs"]').getByText('Requirements').click()
  await page.locator('[id$="--caseReqs-arrow"]').click()
  await page.getByRole('option', { name: /REQ-002/ }).click()
  await page.keyboard.press('Escape')
  await page.locator('[id$="--caseSave"]').click()
  await expect(page.locator('.qtBanner .qtCode:visible').first()).toHaveText('TC-002')

  await page.goto(`/quicktest/index.html#/p/${projectId}?tab=matrix`)
  await expect(page.locator('td.qtMatrixCell.qtLinked')).toHaveCount(2)
  // unlink and link again with a click (the second requirement, the second test case)
  const cell = page.locator('td.qtMatrixCell[data-r]').nth(3)
  await cell.click()
  await expect(page.locator('td.qtMatrixCell.qtLinked')).toHaveCount(1)
  await cell.click()
  await expect(page.locator('td.qtMatrixCell.qtLinked')).toHaveCount(2)
  expect(problems).toEqual([])
})

test('the AI dialogs draft by rules and nothing is saved before the review', async ({ page, request, baseURL }) => {
  const problems = await open(page, `p/${projectId}?tab=requirements`)
  await page.locator('[id$="--reqAi"]').click()
  await page.locator('[id$="aiReqText"] textarea').fill('As a buyer, I want to filter orders by status, so that I find the open ones.\n\nThe app must show an error when the customer is missing.')
  await page.locator('[id$="aiReqDraft"]').click()
  await expect(page.getByText('Review')).toBeVisible()
  const before = await (await request.get(`${baseURL}${Q}/listRequirements(projectID=${projectId})`)).json()
  const count = JSON.parse(before.value).length
  await page.locator('[id$="aiReqSave"]').click()
  await expect.poll(async () => JSON.parse((await (await request.get(`${baseURL}${Q}/listRequirements(projectID=${projectId})`)).json()).value).length).toBe(count + 2)
  await page.locator('[id$="--reqAiCases"]').click()
  await expect(page.locator('[id$="aiCasesDraft"]')).toBeEnabled()
  await page.locator('[id$="aiCasesDraft"]').click()
  await expect(page.locator('[id$="aiCasesList"] .qtReviewItem').first()).toBeVisible()
  await page.locator('[id$="aiCasesSave"]').click()
  await page.goto(`/quicktest/index.html#/p/${projectId}?tab=cases`)
  await expect(page.locator('[id$="--caseTable"] tbody tr').nth(2)).toBeVisible()
  expect(problems).toEqual([])
})

test('a run: start it, give verdicts, close it, download the report', async ({ page }) => {
  const problems = await open(page, `p/${projectId}?tab=runs`)
  await page.locator('[id$="--runNew"]').click()
  await page.locator('[id$="--runName"] input').fill('Smoke run')
  await page.locator('[id$="--runCreate"]').click()
  await expect(page.locator('[id$="--runTitle"]')).toHaveText('Smoke run')
  await expect(page.locator('[id$="--runItems"] li').first()).toBeVisible()
  await page.locator('[id$="--verdictPass"]').click()
  await expect(page.getByText('1 of ').first()).toBeVisible()
  await page.locator('[id$="--verdictFail"]').click()
  await page.locator('[id$="--runClose"]').click()
  await expect(page.getByText('The run is closed').first()).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.locator('[id$="--runExport"]').click()
    await page.getByRole('menuitem', { name: /Excel/ }).click()
  })()])
  expect(download.suggestedFilename()).toMatch(/report\.xlsx$/)
  expect(problems).toEqual([])
})

test('upload: preview what would change, then apply', async ({ page }) => {
  const problems = await open(page, `p/${projectId}`)
  await page.locator('[id$="--importButton"]').click()
  const csv = 'ID,Title,Priority,Type\nREQ-040,Imported requirement,high,security\n'
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[id$="importPick"]').click()])
  await chooser.setFiles({ name: 'req.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByText('What would happen')).toBeVisible()
  await expect(page.getByText('Requirements: 1 new')).toBeVisible()
  await page.locator('[id$="importApply"]').click()
  await expect(page.getByText('Requirements: 1 new').first()).toBeVisible()
  await page.locator('[id$="importClose"]').click()
  await page.goto(`/quicktest/index.html#/p/${projectId}?tab=requirements`)
  await expect(page.locator('.qtCode:visible', { hasText: 'REQ-040' })).toBeVisible()
  expect(problems).toEqual([])
})

test('downloads of the test book work and the template is offered', async ({ page }) => {
  await open(page, `p/${projectId}`)
  for (const [item, name] of [[/Excel\)/, /testbook\.xlsx$/], [/JSON/, /testbook\.json$/]]) {
    const [download] = await Promise.all([page.waitForEvent('download'), (async () => {
      await page.locator('[id$="--exportButton"]').click()
      await page.getByRole('menuitem', { name: item }).first().click()
    })()])
    expect(download.suggestedFilename()).toMatch(name)
  }
})

test('the recorder dialog explains pairing; Ctrl+K finds a project', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: /Recorder/ }).first().click()
  await expect(page.getByText('Pair it with a token')).toBeVisible()
  await page.locator('[id$="extensionClose"]').click()
  await page.keyboard.press('Control+k')
  await page.locator('[id$="paletteInput"] input').fill('qt e2e')
  await expect(page.getByText(projectName).first()).toBeVisible()
})
