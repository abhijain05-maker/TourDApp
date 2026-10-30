import { useState } from 'react'
import { Button, CheckBox, Input, Label, MessageStrip, Option, Panel, Select, SuggestionItem, Text, TextArea, Title } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/ai.js'
import '@ui5/webcomponents-icons/dist/target-group.js'
import '@ui5/webcomponents-icons/dist/delete.js'
import '@ui5/webcomponents-icons/dist/add.js'
import type { Inventory, InventoryControl, LintIssue, TourStep } from '../../types'
import { normalizeHash, matchRoute } from '../../../../srv/lib/parsers/manifest.js'
import { targetFor } from '../../../../srv/lib/llm/draft.js'
import type { Target } from '../../editor/model'
import '@ui5/webcomponents-icons/dist/edit.js'
import '@ui5/webcomponents-icons/dist/internet-browser.js'
import { CardHead, Tag } from '../common'
import PlacementPicker from './PlacementPicker'
import TargetPicker from './TargetPicker'

const short = (viewName?: string | null) => (viewName ?? '').split('.').slice(-1)[0]
const TITLE_HINT = 60

function findControl(inv: Inventory | undefined, t: Target | undefined): InventoryControl | undefined {
  if (!inv || !t) return undefined
  if (t.controlId) {
    return inv.controls.find((c) => (c.localId === t.controlId && (!t.viewName || c.viewName === t.viewName)) || (c as { globalId?: string }).globalId === t.controlId)
  }
  const wanted = t.fallbacks.find((f) => f.by === 'text')?.value.trim().toLowerCase()
  return wanted ? inv.controls.find((c) => (!t.viewName || c.viewName === t.viewName) && c.display?.trim().toLowerCase() === wanted) : undefined
}

export default function StepForm(props: {
  step: TourStep
  index: number
  inventory: Inventory | undefined
  issues: LintIssue[]
  onChange: (patch: Partial<TourStep>, key?: string) => void
  onSetTarget: (target: Target | undefined) => void
  onAskAi: () => void
}) {
  const { step, inventory } = props
  const [picking, setPicking] = useState(false)
  const target = step.target
  const control = findControl(inventory, target)
  const hash = step.before[0]?.hash ?? ''
  const opensPage = step.before.length > 0
  const route = inventory && opensPage ? matchRoute(inventory.routes, normalizeHash(hash)) : null
  const key = (field: string) => `${field}:${step.id}`

  const setTarget = (patch: Partial<Target>) => props.onSetTarget({ fallbacks: [], ...target, ...patch })

  return (
    <div className="stack" data-testid="step-form">
      <div className="form-head">
        <span className="step-badge" aria-hidden="true">
          {props.index + 1}
        </span>
        <div className="form-head-text">
          <Title level="H4">Step {props.index + 1}</Title>
          <span className="card-head-sub">What your users read, and which control it points at.</span>
        </div>
        <Button icon="ai" design="Default" onClick={props.onAskAi} data-testid="ask-ai">
          Ask AI
        </Button>
      </div>

      {props.issues.map((i, n) => (
        <MessageStrip key={n} design={i.severity === 'error' ? 'Negative' : i.severity === 'warning' ? 'Critical' : 'Information'} hideCloseButton data-testid="step-issue">
          {i.message}
        </MessageStrip>
      ))}
      {step.meta?.unresolved && (
        <MessageStrip design="Negative" hideCloseButton data-testid="step-unresolved">
          This step needs review: {step.meta.note ?? 'its control could not be verified'}. Choose the right control below.
        </MessageStrip>
      )}

      <div className="form-sec stack">
        <CardHead compact icon="edit" title="Message" />
        <div>
        <Label required for="step-title">
          Title <span className="muted">({step.title.length}/{TITLE_HINT})</span>
        </Label>
        <Input id="step-title" style={{ width: '100%' }} value={step.title} valueState={step.title.length > TITLE_HINT ? 'Critical' : 'None'} onInput={(e) => props.onChange({ title: e.target.value }, key('title'))} data-testid="step-title" />
        </div>
        <div>
        <Label for="step-text">Text (**bold**, *italic*, `code`, - lists)</Label>
        <TextArea id="step-text" rows={4} style={{ width: '100%' }} value={step.text} onInput={(e) => props.onChange({ text: e.target.value }, key('text'))} data-testid="step-text" />
        </div>
      </div>

      <div className="form-sec stack" data-testid="target-section">
        <CardHead compact icon="target-group" title="Control" />
        {!target && <Text className="muted">This step has no control: it appears in the middle of the screen (good for an introduction or a conclusion).</Text>}
        {target && (
          <div className="target-summary">
            <div className="target-line">
              <b data-testid="target-name">{control?.display ?? target.controlId ?? target.fallbacks[0]?.value}</b>
              {control && <span className="type-pill">{control.type.split('.').slice(-1)[0]}</span>}
            </div>
            <span className="muted mono target-path">{short(target.viewName)}{target.viewName ? ' / ' : ''}{target.controlId ?? '(by text)'}</span>
            <div className="target-tags">
              {inventory && (control ? <Tag design="Positive">found in your files</Tag> : <Tag design="Negative" data-testid="target-missing">not in your files</Tag>)}
              {control && !control.hasStableId && <Tag design="Critical">no stable id</Tag>}
            </div>
          </div>
        )}
        <div className="row">
          <Button icon="target-group" design="Default" onClick={() => setPicking(true)} data-testid="choose-control">
            {target ? 'Choose another control…' : 'Choose a control…'}
          </Button>
          {target && (
            <Button icon="delete" design="Transparent" onClick={() => props.onSetTarget(undefined)} data-testid="remove-target">
              No control (centered)
            </Button>
          )}
        </div>

        {target && (
          <Panel headerText="Ids and fallbacks" collapsed data-testid="target-advanced">
            <div className="stack">
              <div>
                <Label for="t-view">View (full name)</Label>
                <Input id="t-view" style={{ width: '100%' }} value={target.viewName ?? ''} onInput={(e) => setTarget({ viewName: e.target.value.trim() || undefined })} data-testid="target-view" />
              </div>
              <div>
                <Label for="t-id">Control id</Label>
                <Input
                  id="t-id"
                  style={{ width: '100%' }}
                  value={target.controlId ?? ''}
                  valueState={inventory && target.controlId && !control ? 'Negative' : 'None'}
                  onInput={(e) => setTarget({ controlId: e.target.value.trim() || undefined })}
                  data-testid="target-id"
                />
              </div>
              <div>
                <Label>Fallbacks (tried in order when the id is not found)</Label>
                {target.fallbacks.map((f, i) => (
                  <div className="row" key={i} style={{ marginBottom: '0.25rem' }} data-testid="fallback-row">
                    <Select style={{ width: '7rem' }} onChange={(e) => setTarget({ fallbacks: target.fallbacks.map((x, j) => (j === i ? { ...x, by: e.detail.selectedOption.value ?? 'text' } : x)) })}>
                      {['text', 'id', 'css'].map((by) => (
                        <Option key={by} value={by} selected={f.by === by}>
                          {by}
                        </Option>
                      ))}
                    </Select>
                    <Input style={{ flex: 1 }} value={f.value} onInput={(e) => setTarget({ fallbacks: target.fallbacks.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                    <Button icon="delete" design="Transparent" tooltip="Remove fallback" onClick={() => setTarget({ fallbacks: target.fallbacks.filter((_, j) => j !== i) })} />
                  </div>
                ))}
                <Button icon="add" design="Transparent" onClick={() => setTarget({ fallbacks: [...target.fallbacks, { by: 'text', value: control?.display ?? '' }] })} data-testid="fallback-add">
                  Add fallback
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </div>

      {target && <PlacementPicker value={step.placement} onChange={(placement) => props.onChange({ placement }, key('placement'))} />}

      <div className="form-sec stack" data-testid="navigation-section">
        <CardHead compact icon="internet-browser" title="Page" />
        <CheckBox
          text="Open another page before showing this step"
          checked={opensPage}
          data-testid="navigate-toggle"
          onChange={(e) => props.onChange({ before: e.target.checked ? [{ type: 'navigate', hash: '' }] : [] })}
        />
        {opensPage && (
          <div>
            <Label for="step-hash">Page (route hash; empty = the start page)</Label>
            <Input
              id="step-hash"
              style={{ width: '100%' }}
              value={hash}
              showSuggestions
              valueState={inventory && inventory.routes.length && !route ? 'Critical' : 'None'}
              valueStateMessage={<span>No route of the app matches this hash.</span>}
              onInput={(e) => props.onChange({ before: [{ type: 'navigate', hash: e.target.value }] }, key('hash'))}
              data-testid="step-hash"
            >
              {(inventory?.routes ?? []).map((r) => (
                <SuggestionItem key={r.name} text={r.pattern} additionalText={r.viewNames.map(short).join(" + ")} />
              ))}
            </Input>
            {route && <Text className="muted">Shows {route.route.viewNames.map(short).join(' + ')}.</Text>}
          </div>
        )}
      </div>

      {step.meta && (
        <Text className="muted" data-testid="step-meta">
          Source: {step.meta.source ?? 'unknown'}
          {step.meta.confidence !== undefined ? ` · confidence ${Math.round(step.meta.confidence * 100)}%` : ''}
        </Text>
      )}

      <TargetPicker
        open={picking}
        inventory={inventory}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setPicking(false)
          props.onSetTarget(targetFor(c))
        }}
      />
    </div>
  )
}
