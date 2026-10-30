import cds from '@sap/cds'
import { describe, it, expect } from 'vitest'
import { buildInventory } from '../../srv/lib/context/inventory.js'
import { buildPreviewApp } from '../../srv/lib/preview/model.js'
import { demoSources } from '../helpers/sources.js'

const { POST } = cds.test(import.meta.dirname + '/../..')
const BASE = '/odata/v4/tour'

// A file that cannot be read must not take the rest of the app down with it.
const broken = (pattern, content) =>
  demoSources().map((s) => (pattern.test(s.path) ? { ...s, content } : s))

describe('partial parses', () => {
  it('a view that is not XML is reported and skipped, the others are still inventoried', () => {
    const inv = buildInventory(broken(/Main\.view\.xml$/, '<mvc:View><Page'))
    expect(inv.views.map((v) => v.viewName)).toEqual([
      'demo.orders.view.App',
      'demo.orders.view.Detail',
    ])
    expect(inv.controls.some((c) => c.viewName === 'demo.orders.view.Detail')).toBe(true)
    const w = inv.warnings.find((x) => x.code === 'view.parse')
    expect(w.message).toContain('webapp/view/Main.view.xml is not valid XML and was skipped')
    expect(w.message).not.toContain('\n')
  })

  it('a fragment that is not XML is reported and skipped', () => {
    const inv = buildInventory(broken(/ConfirmDialog\.fragment\.xml$/, 'nope'))
    expect(inv.fragments).toEqual([])
    expect(inv.warnings.map((w) => w.code)).toContain('fragment.parse')
  })

  it('a controller with a syntax error is reported, its views still work', () => {
    const inv = buildInventory(broken(/Main\.controller\.js$/, 'function ('))
    expect(inv.warnings.map((w) => w.code)).toContain('controller.parse')
    expect(inv.views).toHaveLength(3)
  })

  it('the sandbox copy is still built; the frame will show what UI5 says about the broken view', () => {
    const app = buildPreviewApp(broken(/Main\.view\.xml$/, '<mvc:View><Page'))
    expect(app.files.get('view/Main.view.xml').body).toBe('<mvc:View><Page')
    expect(app.files.has('Component.js')).toBe(true)
  })

  it('importing such an app works and says what was left out', async () => {
    const projectID = (await POST(`${BASE}/Projects`, { name: 'Partial' })).data.ID
    const { data } = await POST(`${BASE}/importSources`, {
      projectID,
      files: broken(/Main\.view\.xml$/, '<mvc:View><Page'),
      replace: true,
    })
    expect(data.warnings.map((w) => w.message).join(' ')).toContain(
      'Main.view.xml is not valid XML',
    )
    expect(data.views).toBe(2)
  })
})
