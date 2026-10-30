import { Breadcrumbs } from '../components/PageHeader'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BusyIndicator, Button, CheckBox, Input, Label, MessageStrip, Option, Select, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/save.js'
import '@ui5/webcomponents-icons/dist/add-folder.js'
import '@ui5/webcomponents-icons/dist/refresh.js'
import '@ui5/webcomponents-icons/dist/delete.js'
import '@ui5/webcomponents-icons/dist/navigation-up-arrow.js'
import '@ui5/webcomponents-icons/dist/navigation-down-arrow.js'
import '@ui5/webcomponents-icons/dist/add.js'
import { api, ApiError } from '../api'
import '@ui5/webcomponents-icons/dist/locate-me.js'
import '@ui5/webcomponents-icons/dist/list.js'
import '@ui5/webcomponents-icons/dist/settings.js'
import { CollapsibleCard, ConfirmDialog, ErrorStrip, Tag } from '../components/common'
import { AUTH_LABEL } from '../wdi5'
import AddToProjectDialog from '../components/editor/AddToProjectDialog'
import GeneratedFiles from '../components/GeneratedFiles'
import type { Wdi5Locator, Wdi5Plan, Wdi5Settings, Wdi5Step } from '../../../shared/wdi5-plan.mjs'
import type { DryRun, TestPlanRow } from '../types'

const KIND_LABEL: Record<Wdi5Step['kind'], string> = {
  open: 'Open',
  press: 'Press',
  enterText: 'Type',
  search: 'Search',
  select: 'Choose',
  assert: 'Check',
}
const ASSERT_LABEL = {
  url: 'The address contains',
  value: 'The value is',
  selectedKey: 'The selected key is',
  visible: 'Is visible',
  text: 'The text is',
}
const DRY_LABEL: Record<string, string> = { found: 'found in the app', missing: 'not in the app', ambiguous: 'several match', unchecked: 'checked when it runs' }
const DRY_DESIGN: Record<string, 'Positive' | 'Negative' | 'Critical' | 'Information'> = { found: 'Positive', missing: 'Negative', ambiguous: 'Critical', unchecked: 'Information' }
const STRATEGY_LABEL: Record<string, string> = {
  id: 'by its id',
  ui5: "UI5's own selector (as its Test Recorder writes it)",
  i18n: 'by its i18n text',
  text: 'by its text',
  label: 'by its label',
  binding: 'by its binding path',
}

const parse = (definition: string): Wdi5Plan => JSON.parse(definition)

interface Existing {
  config: string
  framework: string
  esm: boolean
  specFile: string
  journeyFile: string
  configReaches: boolean
  helpers: number
  reuse: { steps: { stepID: string; name: string; file: string }[]; setup: { role: string; name: string; file: string }[] }
}

export default function TestPlanPage() {
  const { id = '' } = useParams()
  const row = useQuery({ queryKey: ['test-plan', id], queryFn: () => api.testPlan(id), staleTime: Infinity, gcTime: 0 })
  if (row.isLoading) return <BusyIndicator active style={{ margin: '2rem' }} />
  if (row.error || !row.data) {
    return (
      <div className="page">
        <ErrorStrip error={row.error ?? new Error('Test plan not found')} />
        <Link to="/">Back to all projects</Link>
      </div>
    )
  }
  return <PlanEditor id={id} row={row.data} />
}

/** The server's copy is the starting point; from then on this component owns the working copy. */
function PlanEditor({ id, row: first }: { id: string; row: TestPlanRow }) {
  const qc = useQueryClient()
  const [plan, setPlan] = useState<Wdi5Plan>(() => parse(first.definition))
  const [version, setVersion] = useState(first.version)
  const [saved, setSaved] = useState(() => JSON.stringify(parse(first.definition)))
  const [adding, setAdding] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const row = { data: first, error: null as unknown }

  const dirty = JSON.stringify(plan) !== saved
  const take = (r: { definition: string; version: number }) => {
    const next = parse(r.definition)
    setPlan(next)
    setVersion(r.version)
    setSaved(JSON.stringify(next))
    void qc.invalidateQueries({ queryKey: ['test-plans'] })
  }
  const save = useMutation({
    mutationFn: () => api.saveTestPlan(id, JSON.stringify(plan), version),
    onSuccess: take,
  })
  const rebuild = useMutation({
    mutationFn: () => api.rebuildTestPlan(id),
    onSuccess: (r) => {
      setRebuilding(false)
      take(r)
    },
  })
  const conflict = save.error instanceof ApiError && save.error.status === 409

  // Ctrl+S saves the plan, not the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty && !save.isPending) save.mutate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const update = (fn: (p: Wdi5Plan) => void) =>
    setPlan((cur) => {
      const next = structuredClone(cur)
      fn(next)
      return next
    })
  const setStep = (index: number, patch: Partial<Wdi5Step>) => update((p) => void Object.assign(p.steps[index], patch, { edited: true }))
  const setSettings = (patch: Partial<Wdi5Settings>) => update((p) => void Object.assign(p.settings, patch))
  const move = (i: number, by: number) =>
    update((p) => {
      const j = i + by
      if (j < 1 || j >= p.steps.length) return // the first step opens the app
      ;[p.steps[i], p.steps[j]] = [p.steps[j], p.steps[i]]
    })
  const remove = (i: number) => update((p) => void p.steps.splice(i, 1))
  const addCheck = (i: number) =>
    update((p) => {
      const after = p.steps[i]
      const key = after.locator
      p.steps.splice(i + 1, 0, {
        id: `s${Date.now().toString(36)}`,
        kind: 'assert',
        title: key ? `Check ${p.locators[key]?.display ?? key}` : 'Check the address',
        enabled: true,
        locator: key,
        assertion: key ? { type: 'visible' } : { type: 'url', expected: '' },
        edited: true,
      })
    })
  // what the project already has (wdi5 config, helpers, page objects): shown next to the steps that would use it
  const preview = useQuery({ queryKey: ['test-preview', id, version], queryFn: () => api.previewTestApply(id), retry: false })
  const dry = useQuery({ queryKey: ['test-dry', id, version], queryFn: () => api.dryRunTestPlan(id), retry: false })
  const existing: Existing | null = preview.data?.existing ? JSON.parse(preview.data.existing) : null
  const reuseOf = (stepID: string) => existing?.reuse.steps.find((r) => r.stepID === stepID)
  const locatorNames = Object.keys(plan.locators)
  const steps = plan.steps
  const enabled = steps.filter((s) => s.enabled && !['open', 'assert'].includes(s.kind)).length

  return (
    <div className="page" data-testid="test-plan-page">
      <Breadcrumbs items={[{ label: 'Projects', to: '/' }, { label: 'Tests', to: `/projects/${row.data.project_ID}?tab=tests` }, { label: plan.name }]} />

      <div className="editor-bar">
        <div className="editor-bar-left">
          <Input
            value={plan.name}
            accessibleName="Name of the tests"
            style={{ fontWeight: 'bold' }}
            onInput={(e) => update((p) => void (p.name = e.target.value))}
            data-testid="plan-name"
          />
          <Tag colorScheme="8" data-testid="plan-version">v{version}</Tag>
          <Tag colorScheme={dirty ? '2' : '8'} data-testid="plan-state">{save.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</Tag>
        </div>
        <div className="editor-bar-actions">
          <Button icon="refresh" design="Transparent" onClick={() => setRebuilding(true)} data-testid="plan-rebuild">
            Start over from the recording
          </Button>
          <Button icon="save" disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="plan-save">
            Save
          </Button>
          <Button icon="add-folder" design="Emphasized" disabled={dirty || enabled === 0} tooltip={dirty ? 'Save the plan first' : undefined} onClick={() => setAdding(true)} data-testid="plan-apply">
            Add to project
          </Button>
        </div>
      </div>

      <ErrorStrip error={row.error ?? (conflict ? null : save.error) ?? rebuild.error} />
      {conflict && (
        <MessageStrip design="Negative" hideCloseButton data-testid="plan-conflict" style={{ marginBottom: '0.75rem' }}>
          These tests were changed somewhere else (another tab).{' '}
          <a href="#" onClick={async (e) => (e.preventDefault(), take(await api.testPlan(id)), save.reset())}>
            Discard my changes and reload
          </a>
        </MessageStrip>
      )}

      {existing && (
        <MessageStrip design="Information" hideCloseButton data-testid="plan-existing" style={{ marginBottom: '1rem' }}>
          This project already has wdi5 ({existing.config}, {existing.framework === 'jasmine' ? 'Jasmine' : 'Mocha'}, {existing.esm ? 'ES modules' : 'CommonJS'}). The test goes to <code>{existing.specFile}</code> and the journey to{' '}
          <code>{existing.journeyFile}</code>, written like your own code.{' '}
          {existing.reuse.steps.length + existing.reuse.setup.length > 0
            ? `It calls ${existing.reuse.steps.length + existing.reuse.setup.length} helper(s) you already have.`
            : existing.helpers
              ? 'None of your helpers does what these steps do.'
              : 'It has no helpers to reuse.'}
          {!existing.configReaches && ' Your config does not reach the new spec: the change to it is shown when you add the files.'}
        </MessageStrip>
      )}

      <CollapsibleCard
        icon="settings"
        title="Settings of the generated project"
        subtitle="Where your app runs and how the tests are written."
        summary={`${plan.settings.framework === 'jasmine' ? 'Jasmine' : 'Mocha'} · ${AUTH_LABEL[plan.settings.auth] ?? plan.settings.auth} · ${plan.settings.baseUrl}`}
        style={{ marginTop: '1rem' }}
        testid="plan-settings"
      >
        <div className="settings-grid">
          <div>
            <Label showColon>Address of the app</Label>
            <Input style={{ width: '100%' }} value={plan.settings.baseUrl} accessibleName="Address of the app" onInput={(e) => setSettings({ baseUrl: e.target.value })} data-testid="plan-baseurl" />
          </div>
          <div>
            <Label showColon>Test framework</Label>
            <Select style={{ width: '100%' }} accessibleName="Test framework" onChange={(e) => setSettings({ framework: e.detail.selectedOption.value as Wdi5Settings['framework'] })} data-testid="plan-framework">
              <Option value="mocha" selected={plan.settings.framework === 'mocha'}>Mocha</Option>
              <Option value="jasmine" selected={plan.settings.framework === 'jasmine'}>Jasmine</Option>
            </Select>
          </div>
          <div>
            <Label showColon>Login of the app</Label>
            <Select style={{ width: '100%' }} accessibleName="Login of the app" onChange={(e) => setSettings({ auth: e.detail.selectedOption.value as Wdi5Settings['auth'] })} data-testid="plan-auth">
              {Object.entries(AUTH_LABEL).map(([value, label]) => (
                <Option key={value} value={value} selected={plan.settings.auth === value}>
                  {label}
                </Option>
              ))}
            </Select>
          </div>
          <div>
            <Label showColon>Folder of the tests</Label>
            <Input style={{ width: '100%' }} value={plan.settings.testDir} accessibleName="Folder of the tests" onInput={(e) => setSettings({ testDir: e.target.value })} data-testid="plan-testdir" />
          </div>
        </div>
        {plan.settings.auth !== 'none' && (
          <Text className="muted">The user name and password are never stored here: put them in a .env file (wdi5_username, wdi5_password).</Text>
        )}
        {plan.settings.auth === 'custom' && (
          <div className="settings-grid">
            {(['username', 'password', 'submit'] as const).map((k) => (
              <div key={k}>
                <Label showColon>CSS selector of the {k === 'submit' ? 'login button' : `${k} field`}</Label>
                <Input
                  style={{ width: '100%' }}
                  value={plan.settings.authSelectors?.[k] ?? ''}
                  accessibleName={`Selector of the ${k}`}
                  onInput={(e) =>
                    setSettings({ authSelectors: { username: "input[id='username']", password: "input[id='password']", submit: "button[type='submit']", ...plan.settings.authSelectors, [k]: e.target.value } })
                  }
                />
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {dry.data && !dirty && (
        <MessageStrip design={dry.data.summary.missing ? 'Negative' : dry.data.summary.ambiguous ? 'Critical' : 'Positive'} hideCloseButton data-testid="dry-summary" style={{ marginTop: '1rem' }}>
          Checked against the files of the app: {dry.data.summary.found} control(s) found
          {dry.data.summary.missing ? `, ${dry.data.summary.missing} not in the app` : ''}
          {dry.data.summary.ambiguous ? `, ${dry.data.summary.ambiguous} matched by several` : ''}
          {dry.data.summary.unchecked ? `, ${dry.data.summary.unchecked} only known when it runs` : ''}.
        </MessageStrip>
      )}

      <CollapsibleCard
        icon="list"
        title="Steps"
        subtitle={`${enabled} step(s) on. Checks marked "added by TourD" are guesses from the recording: keep what is useful.`}
        summary={`${enabled} of ${steps.length} step(s) will run. Open to change, reorder or switch them off.`}
        style={{ marginTop: '1rem' }}
        testid="plan-steps"
      >
        <div className="table-scroll">
          <table className="plan-table">
            <colgroup>
              <col className="c-on" />
              <col className="c-what" />
              <col className="c-step" />
              <col className="c-control" />
              <col className="c-value" />
              <col className="c-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">On</th>
                <th scope="col">What</th>
                <th scope="col">Step</th>
                <th scope="col">Control</th>
                <th scope="col">Value</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={s.id} className={`${s.enabled ? '' : 'off'}${s.kind === 'assert' ? ' check' : ''}`} data-testid="plan-step" data-kind={s.kind}>
                  <td>
                    <CheckBox checked={s.enabled} accessibleName={`Include step ${i + 1}`} disabled={s.kind === 'open'} onChange={(e) => setStep(i, { enabled: e.target.checked })} />
                  </td>
                  <td>
                    <Tag colorScheme={s.kind === 'assert' ? '8' : '6'}>{KIND_LABEL[s.kind]}</Tag>
                  </td>
                  <td>
                    <Input style={{ width: '100%' }} value={s.title} accessibleName={`Title of step ${i + 1}`} onInput={(e) => setStep(i, { title: e.target.value })} data-testid="step-title" />
                    <div className="step-meta">
                      {s.heuristic && !s.edited && <Tag colorScheme="2">added by TourD</Tag>}
                      {s.edited && <Tag colorScheme="7">changed</Tag>}
                      {s.note && <span className="muted">{s.note}</span>}
                      {reuseOf(s.id) && !s.noReuse && !dirty && (
                        <>
                          <Tag colorScheme="8" data-testid="step-reuse" title={reuseOf(s.id)!.file}>
                            uses {reuseOf(s.id)!.name}() of your project
                          </Tag>
                          <a href="#" onClick={(e) => (e.preventDefault(), setStep(i, { noReuse: true }))}>
                            Do not use it
                          </a>
                        </>
                      )}
                      {s.noReuse && (
                        <>
                          <span className="muted">writes its own code</span>
                          <a href="#" onClick={(e) => (e.preventDefault(), setStep(i, { noReuse: false }))}>
                            Use the project's helper
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    {s.kind !== 'open' && !(s.assertion?.type === 'url') && (
                      <Select
                        style={{ width: '100%' }}
                        accessibleName={`Control of step ${i + 1}`}
                        onChange={(e) => setStep(i, { locator: e.detail.selectedOption.value || null })}
                        data-testid="step-control"
                      >
                        <Option value="" selected={!s.locator}>
                          (none)
                        </Option>
                        {locatorNames.map((k) => (
                          <Option key={k} value={k} selected={s.locator === k}>
                            {k}
                          </Option>
                        ))}
                      </Select>
                    )}
                    {dry.data && !dirty && dry.data.steps[s.id] && (
                      <div className="step-meta" data-testid="step-found">
                        <Tag design={DRY_DESIGN[dry.data.steps[s.id]]} title={dry.data.locators[s.locator ?? '']?.note}>
                          {DRY_LABEL[dry.data.steps[s.id]]}
                        </Tag>
                      </div>
                    )}
                  </td>
                  <td>
                    {(s.kind === 'enterText' || s.kind === 'search') && (
                      <Input style={{ width: '100%' }} value={s.value ?? ''} accessibleName={`Text of step ${i + 1}`} onInput={(e) => setStep(i, { value: e.target.value })} data-testid="step-value" />
                    )}
                    {s.kind === 'select' && (
                      <Input style={{ width: '100%' }} value={s.choice ?? ''} accessibleName={`Item of step ${i + 1}`} onInput={(e) => setStep(i, { choice: e.target.value })} data-testid="step-value" />
                    )}
                    {s.kind === 'assert' && s.assertion && (
                      <div className="assert-edit">
                        <Select
                          accessibleName={`Kind of check ${i + 1}`}
                          onChange={(e) => setStep(i, { assertion: { ...s.assertion!, type: e.detail.selectedOption.value as NonNullable<Wdi5Step['assertion']>['type'] } })}
                        >
                          {Object.entries(ASSERT_LABEL).map(([value, label]) => (
                            <Option key={value} value={value} selected={s.assertion!.type === value}>
                              {label}
                            </Option>
                          ))}
                        </Select>
                        {s.assertion.type !== 'visible' && (
                          <Input value={s.assertion.expected ?? ''} accessibleName={`Expected value of check ${i + 1}`} onInput={(e) => setStep(i, { assertion: { ...s.assertion!, expected: e.target.value } })} data-testid="step-expected" />
                        )}
                      </div>
                    )}
                    {s.kind === 'open' && <span className="muted">{s.hash ? `starts at #${s.hash}` : 'wdi5 opens the app'}</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 0, flexWrap: 'nowrap' }}>
                      <Button icon="navigation-up-arrow" design="Transparent" tooltip="Move up" accessibleName={`Move step ${i + 1} up`} disabled={i < 2} onClick={() => move(i, -1)} />
                      <Button icon="navigation-down-arrow" design="Transparent" tooltip="Move down" accessibleName={`Move step ${i + 1} down`} disabled={i === 0 || i === steps.length - 1} onClick={() => move(i, 1)} />
                      {s.kind !== 'assert' && s.kind !== 'open' && (
                        <Button icon="add" design="Transparent" tooltip="Add a check after this step" accessibleName={`Add a check after step ${i + 1}`} onClick={() => addCheck(i)} data-testid="add-check" />
                      )}
                      {s.kind !== 'open' && <Button icon="delete" design="Transparent" tooltip="Remove step" accessibleName={`Remove step ${i + 1}`} onClick={() => remove(i)} data-testid="remove-step" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        icon="locate-me"
        title="How each control is found"
        subtitle="An id is the sturdiest way. Controls without an id are found by their text, which breaks when the text changes."
        summary={`${locatorNames.length} control(s)${dry.data && !dirty ? `: ${dry.data.summary.found} found in the app${dry.data.summary.missing ? `, ${dry.data.summary.missing} not in the app` : ''}` : ''}`}
        style={{ marginTop: '1rem' }}
        testid="plan-locators"
      >
        <div className="locator-list">
          {locatorNames.map((k) => (
            <LocatorRow key={k} name={k} locator={plan.locators[k]} dry={dirty ? undefined : dry.data?.locators[k]} onChange={(next) => update((p) => void (p.locators[k] = next))} />
          ))}
        </div>
        {locatorNames.length === 0 && <Text className="muted">No control yet.</Text>}
      </CollapsibleCard>

      {!dirty && preview.data && (
        <GeneratedFiles edits={preview.data.edits} settings={plan.settings} existing={!!existing} blocked={preview.data.ok ? null : preview.data.blocking[0]?.message} />
      )}

      <AddToProjectDialog open={adding} kind="tests" tourID={id} projectID={row.data.project_ID} flush={async () => true} onClose={() => setAdding(false)} />
      <ConfirmDialog open={rebuilding} title="Start over" confirmText="Start over" busy={rebuild.isPending} onCancel={() => setRebuilding(false)} onConfirm={() => rebuild.mutate()}>
        Build the steps again from the recording? Your changes to the steps are lost; the settings stay.
      </ConfirmDialog>
    </div>
  )
}

function LocatorRow({ name, locator, dry, onChange }: { name: string; locator: Wdi5Locator; dry?: DryRun['locators'][string]; onChange: (l: Wdi5Locator) => void }) {
  const code = useMemo(() => JSON.stringify({ selector: locator.selector }), [locator.selector])
  const choose = (strategy: string) => {
    if (strategy === locator.strategy) return
    const all = [{ strategy: locator.strategy, selector: locator.selector }, ...locator.alternatives]
    const chosen = all.find((a) => a.strategy === strategy)
    if (chosen) onChange({ ...locator, strategy: chosen.strategy, selector: chosen.selector, alternatives: all.filter((a) => a !== chosen) })
  }
  const options = [locator.strategy, ...locator.alternatives.map((a) => a.strategy)]
  return (
    <div className="locator-row" data-testid="plan-locator">
      <div className="locator-id">
        <b className="mono">{name}</b>
        <span className="muted">{locator.display ?? locator.controlType}</span>
      </div>
      <Select accessibleName={`How ${name} is found`} onChange={(e) => choose(e.detail.selectedOption.value ?? '')}>
        {options.map((s) => (
          <Option key={s} value={s} selected={s === locator.strategy}>
            {STRATEGY_LABEL[s] ?? s}
          </Option>
        ))}
      </Select>
      <code className="mono locator-code" title={code}>{code}</code>
      {dry && (
        <span className="locator-dry" data-testid="locator-dry">
          <Tag design={DRY_DESIGN[dry.status]}>{DRY_LABEL[dry.status]}</Tag>
        </span>
      )}
      {dry?.note && <span className="muted locator-note">{dry.note}</span>}
      {locator.note && locator.strategy !== 'id' && !dry?.note && <span className="muted locator-note">{locator.note}</span>}
    </div>
  )
}
