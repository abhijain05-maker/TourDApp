import { describe, it, expect } from 'vitest'
import { selectorCandidates } from '../../srv/lib/wdi5/plan.js'
import { checkSelector } from '../../srv/lib/wdi5/dryrun.js'
import { validateRecording } from '../../shared/recording-schema.mjs'
import { STRATEGIES } from '../../shared/wdi5-plan.mjs'

// UI5 builds the selector of a control itself (RecordReplay.findControlSelectorByDOMElement); the recorder stores it.
const row = {
  controlType: 'sap.m.ColumnListItem',
  viewName: 'sap.fe.templates.ListReport.ListReport',
  viewId: 'sap.fe.cap.travel::TravelList',
  bindingPath: { path: "/Travel(TravelUUID='7675',IsActiveEntity=true)", propertyPath: 'TravelUUID' },
}

describe('the selector UI5 gave for a control', () => {
  it('is a strategy of its own', () => {
    expect(STRATEGIES).toContain('ui5')
  })

  it('is the first choice for a control without an id of its own', () => {
    const c = selectorCandidates({
      ui5: { type: 'sap.m.ColumnListItem', viewName: row.viewName, localId: undefined, hasStableId: false },
      recorded: { controlType: 'sap.m.ColumnListItem', viewName: row.viewName, stableId: false, selector: row },
    })
    expect(c[0]).toEqual({ strategy: 'ui5', selector: row })
  })

  it('comes after the id when the control has a stable one, and is not repeated when it says the same', () => {
    const recorded = {
      controlType: 'sap.m.Button',
      viewName: 'v.Main',
      controlId: 'saveBtn',
      stableId: true,
      selector: { controlType: 'sap.m.Button', properties: { text: 'Save' } },
    }
    const c = selectorCandidates({ ui5: { type: 'sap.m.Button', viewName: 'v.Main', localId: 'saveBtn', hasStableId: true }, recorded })
    expect(c[0].strategy).toBe('id')
    expect(c.map((x) => x.strategy)).toContain('ui5')
    const same = selectorCandidates({
      ui5: { type: 'sap.m.Button', viewName: 'v.Main', localId: 'saveBtn', hasStableId: true },
      recorded: { ...recorded, selector: { id: 'saveBtn', viewName: 'v.Main' } },
    })
    expect(same.filter((x) => JSON.stringify(x.selector) === JSON.stringify({ id: 'saveBtn', viewName: 'v.Main' }))).toHaveLength(1)
  })

  it('keeps only what wdi5 understands', () => {
    const c = selectorCandidates({
      ui5: { type: 'sap.m.Button', viewName: 'v.Main', localId: undefined, hasStableId: false },
      recorded: { controlType: 'sap.m.Button', viewName: 'v.Main', stableId: false, selector: { controlType: 'sap.m.Button', __private: 1, properties: { text: 'Go' } } },
    })
    expect(c[0].selector).toEqual({ controlType: 'sap.m.Button', properties: { text: 'Go' } })
  })

  it('is not marked missing by the dry run when only the running app can tell', () => {
    const inventory = { controls: [], views: [], i18nKeys: [] }
    expect(checkSelector({ controlType: 'sap.m.Input', properties: { enabled: true, placeholder: 'x' } }, inventory).status).toBe('unchecked')
    expect(checkSelector({ controlType: 'sap.m.Button', ancestor: { id: 'dlg' } }, inventory).status).toBe('unchecked')
    expect(checkSelector(row, inventory).status).toBe('unchecked')
  })

  it('travels in a recording', () => {
    const rec = {
      format: 'tourd-recording',
      version: 1,
      recordedAt: '2026-10-28T10:00:00.000Z',
      recorder: 'test',
      app: { url: 'http://x/index.html', startHash: '', title: '', ui5Version: '1.139.0', appId: 'a', locale: 'en' },
      steps: [
        {
          index: 0,
          t: 1,
          type: 'press',
          event: 'press',
          control: { id: 'c', localId: null, viewName: 'v', controllerName: null, controlType: 'sap.m.Button', stableId: false, selector: row },
        },
      ],
    }
    expect(validateRecording(rec).ok).toBe(true)
  })
})

describe('a Fiori elements recording, tidied for tests', () => {
  const step = (index, action, type, id, extra = {}) => ({
    index,
    action,
    ui5: { type, localId: id, viewName: 'sap.fe.templates.ObjectPage.ObjectPage', via: 'recorder-live' },
    recorded: { controlType: type, controlId: id },
    ...extra,
  })
  const F = 'fe::FormContainer::DateData::FormElement::DataField::BeginDate::Field'

  it('keeps the step that does the thing and drops what the same action reported besides', async () => {
    const { tidySteps } = await import('../../srv/lib/wdi5/plan.js')
    const steps = [
      step(0, 'click', 'sap.ui.core.Icon', `${F}-edit-icon`),
      step(1, 'click', 'sap.fe.core.controls.HideFormGroupAutomatically', undefined),
      step(2, 'input', 'sap.m.DatePicker', `${F}-edit`, { value: 'Dec 11, 2026' }),
      step(3, 'input', 'sap.fe.macros.Field', F, { value: 'Dec 11, 2026' }),
      step(4, 'input', 'sap.fe.macros.controls.FilterBar', 'fe::FilterBar::Travel', { value: '', submit: true }),
      step(5, 'click', 'sap.m.Button', 'fe::FooterBar::StandardAction::Save'),
    ]
    expect(tidySteps(steps).map((s) => s.index)).toEqual([2, 5])
  })

  it('does not drop two different fields that happen to hold the same text', async () => {
    const { tidySteps } = await import('../../srv/lib/wdi5/plan.js')
    const steps = [
      step(0, 'input', 'sap.m.DatePicker', `${F}-edit`, { value: 'Dec 11, 2026' }),
      step(1, 'input', 'sap.m.DatePicker', 'fe::FormContainer::DateData::FormElement::DataField::EndDate::Field-edit', { value: 'Dec 11, 2026' }),
    ]
    expect(tidySteps(steps)).toHaveLength(2)
  })
})
