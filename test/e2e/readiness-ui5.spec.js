// The Readiness feature of the SAPUI5 designer: scan a project, check things off, scan again, add a check by hand.
// Each test makes its own project through the API and removes it afterwards.
import { test, expect } from '@playwright/test'
import { readinessProject } from '../helpers/readiness-project.js'

const BASE = '/odata/v4/tour'
const APP = '/designer-ui5/index.html'

test.use({ viewport: { width: 1500, height: 1000 } })

const id = (page, suffix) => page.locator(`[id$="${suffix}"]`)
const row = (page, text) => id(page, 'rItems').locator('li.tourdRRow', { hasText: text }).first()

async function seed(request, name, { files = true } = {}) {
  const project = await (await request.post(`${BASE}/Projects`, { data: { name } })).json()
  if (files)
    await request.post(`${BASE}/importSources`, {
      data: { projectID: project.ID, files: readinessProject(), replace: true },
    })
  return project
}
const remove = (request, project) => request.delete(`${BASE}/Projects(${project.ID})`)

test.describe('designer-ui5: readiness', () => {
  test('asks for an upload when the project has no files, and offers the scan when it has', async ({
    page,
    request,
  }) => {
    const empty = await seed(request, `Readiness empty ${Date.now()}`, { files: false })
    const full = await seed(request, `Readiness files ${Date.now()}`)
    try {
      await page.goto(`${APP}#/projects/${empty.ID}?tab=readiness`)
      await expect(id(page, 'rNoFiles')).toBeVisible({ timeout: 60_000 })
      await expect(id(page, 'rScan')).toBeDisabled()

      await page.goto(`${APP}#/projects/${full.ID}?tab=readiness`)
      await expect(id(page, 'rNotScanned')).toBeVisible({ timeout: 30_000 })
      await expect(id(page, 'featureSwitch').locator('.sapMSegBBtnSel')).toContainText('Readiness')
      await expect(id(page, 'tabRecordings')).toBeHidden()
    } finally {
      await remove(request, empty)
      await remove(request, full)
    }
  })

  test('scans, shows the findings, takes answers and keeps them when scanned again', async ({
    page,
    request,
  }) => {
    const project = await seed(request, `Readiness scan ${Date.now()}`)
    try {
      await page.goto(`${APP}#/projects/${project.ID}?tab=readiness`)
      await id(page, 'rNotScanned').getByRole('button', { name: 'Scan the project' }).click()
      await expect(id(page, 'rHero')).toBeVisible()
      await expect(id(page, 'rHeroTitle')).toContainText('0 of')
      await expect(id(page, 'tileAttention')).toContainText('2')

      // the Authorization card opens that area; search narrows it to the role that is asked for but not defined
      await id(page, 'rCategories').locator('li', { hasText: 'Authorization' }).click()
      await expect(id(page, 'rItems').locator('li.tourdRRow')).toHaveCount(11)
      await id(page, 'rSearch').locator('input').fill('Auditor')
      await expect(id(page, 'rItems').locator('li.tourdRRow')).toHaveCount(1)
      await row(page, 'Auditor').click()
      await expect(id(page, 'rDetail')).toContainText('xs-security.json defines no scope')

      // answer a check, write a note and a value, follow a link to a connected check
      await id(page, 'rSearch').locator('input').fill('')
      await id(page, 'rSearch').locator('input').press('Enter')
      await row(page, 'Leave Admin').click()
      await id(page, 'rDetail').getByText('Working', { exact: true }).click()
      await expect(id(page, 'rCheckedAt')).toContainText('Answered')
      await id(page, 'rDetail')
        .locator('input[placeholder*="Users or groups"]')
        .fill('kiran@example.com')
      await id(page, 'rOwner').locator('input').fill('Kiran')
      await id(page, 'rNote').locator('textarea').fill('Assigned in the cockpit')
      await id(page, 'rNote').locator('textarea').blur()
      await id(page, 'rDetail').getByRole('link', { name: 'Admin', exact: true }).click()
      await expect(id(page, 'rDetailTitle')).toHaveText('Admin')

      // a quick answer on a row
      await row(page, 'Unused').getByRole('button', { name: 'Mark as not working' }).click()
      await expect(row(page, 'Unused')).toHaveAttribute('data-status', 'broken')

      // scan again: the list is the same and the answers are still there
      await id(page, 'tabReadiness').click()
      await id(page, 'rScan').click()
      await expect(id(page, 'rHeroTitle')).toContainText('1 of', { timeout: 15_000 })
      await expect(id(page, 'rStatBroken')).toContainText('1')
      await id(page, 'tabChecklist').click()
      await row(page, 'Leave Admin').click()
      await expect(id(page, 'rCheckedAt')).toContainText('Answered')
      await expect(
        id(page, 'rDetail').locator('input[placeholder*="Users or groups"]'),
      ).toHaveValue('kiran@example.com')
      await expect(id(page, 'rOwner').locator('input')).toHaveValue('Kiran')
      await expect(id(page, 'rNote').locator('textarea')).toHaveValue('Assigned in the cockpit')

      // the source link opens the file in the Workspace
      await id(page, 'rDetail').locator('a.tourdMono').first().click()
      await expect(page.locator('.cm-content').first()).toContainText('xsappname', {
        timeout: 15_000,
      })
    } finally {
      await remove(request, project)
    }
  })

  test('says when the files changed, and lists a check added by hand', async ({
    page,
    request,
  }) => {
    const project = await seed(request, `Readiness manual ${Date.now()}`)
    try {
      await request.post(`${BASE}/scanReadiness`, { data: { projectID: project.ID } })
      await page.goto(`${APP}#/projects/${project.ID}?tab=checklist`)
      await expect(id(page, 'rItems').locator('li.tourdRRow').first()).toBeVisible({
        timeout: 60_000,
      })

      await id(page, 'rAdd').click()
      await id(page, 'rAddName').locator('input').fill('Cloud Connector shows the S/4 virtual host')
      await id(page, 'rAddConfirm').click()
      await expect(id(page, 'rDetailTitle')).toContainText('Cloud Connector')
      await expect(id(page, 'rRemove')).toBeVisible()
      await id(page, 'rRemove').click()
      await page.locator('.sapMDialog').getByRole('button', { name: 'Delete' }).click()
      await expect(row(page, 'Cloud Connector')).toHaveCount(0)

      // the project changes after the scan: the page says so
      const files = await (
        await request.get(
          `${BASE}/Sources?$filter=project_ID eq ${project.ID} and path eq 'mta.yaml'`,
        )
      ).json()
      const file = await (await request.get(`${BASE}/getFile(fileID=${files.value[0].ID})`)).json()
      await request.post(`${BASE}/saveFile`, {
        data: { fileID: file.ID, content: file.content + '\n# changed\n', expectedHash: file.hash },
      })
      await page.reload()
      await expect(id(page, 'rChecklistOutdated')).toBeVisible({ timeout: 30_000 })
    } finally {
      await remove(request, project)
    }
  })

  test('the guided experience is still there next to it', async ({ page, request }) => {
    const project = await seed(request, `Readiness guided ${Date.now()}`)
    try {
      await page.goto(`${APP}#/projects/${project.ID}?tab=readiness`)
      await expect(id(page, 'tileVerified')).toBeVisible({ timeout: 60_000 })
      await id(page, 'featureSwitch').getByText('Guided experience').click()
      await expect(id(page, 'tileRecordings')).toBeVisible()
      await expect(id(page, 'tileVerified')).toBeHidden()
      await expect(id(page, 'tabRecordings')).toBeVisible()
    } finally {
      await remove(request, project)
    }
  })
})
