import { Breadcrumbs } from '../components/PageHeader'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BusyIndicator, Button, Dialog, Input, Label, MessageStrip, Tab, TabContainer, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/undo.js'
import '@ui5/webcomponents-icons/dist/redo.js'
import '@ui5/webcomponents-icons/dist/history.js'
import '@ui5/webcomponents-icons/dist/save.js'
import '@ui5/webcomponents-icons/dist/download.js'
import '@ui5/webcomponents-icons/dist/add-folder.js'
import { api } from '../api'
import type { Inventory, InventoryControl, LintIssue, PickResult, TourRow } from '../types'
import { addStep, deleteStep, duplicateStep, moveStep, setTarget, updateStep } from '../editor/model'
import { useTourEditor, type SaveState } from '../editor/useTourEditor'
import { describeIssue } from '../editor/describeIssue'
import { lintTour } from '../../../srv/lib/validate/lint.js'
import { ErrorStrip, GeneratorTag, Tag } from '../components/common'
import StepList, { type StepIssues } from '../components/editor/StepList'
import StepForm from '../components/editor/StepForm'
import BubblePreview from '../components/editor/BubblePreview'
import SandboxPreview from '../components/editor/SandboxPreview'
// CodeMirror is only needed on the JSON tab: load it on demand
const JsonPanel = lazy(() => import('../components/editor/JsonPanel'))
// the live panel carries the player source: load it on demand as well
const LivePanel = lazy(() => import('../components/editor/LivePanel'))
import HistoryDialog from '../components/editor/HistoryDialog'
import AiDialog from '../components/editor/AiDialog'
import ExportDialog from '../components/editor/ExportDialog'
import AddToProjectDialog from '../components/editor/AddToProjectDialog'

const STATE_TEXT: Record<SaveState, string> = {
  saved: 'All changes saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  invalid: 'Not saved: fix the problems first',
  conflict: 'Changed elsewhere',
  error: 'Could not save',
}
const STATE_COLOR: Record<SaveState, '8' | '6' | '2' | '1'> = { saved: '6', saving: '8', unsaved: '2', invalid: '1', conflict: '1', error: '1' }

export default function TourPage() {
  const { id = '' } = useParams()
  const tour = useQuery({ queryKey: ['tour', id], queryFn: () => api.tour(id), staleTime: Infinity, gcTime: 0 })

  if (tour.isLoading) return <BusyIndicator active style={{ margin: '2rem' }} />
  if (tour.error || !tour.data) {
    return (
      <div className="page">
        <ErrorStrip error={tour.error ?? new Error('Tour not found')} />
        <Link to="/">Back to all projects</Link>
      </div>
    )
  }
  return <TourEditor key={tour.data.ID} tour={tour.data} />
}

function TourEditor({ tour }: { tour: TourRow }) {
  const ed = useTourEditor(tour)
  const { doc, selected } = ed
  const [rightTab, setRightTab] = useState<'preview' | 'sandbox' | 'live' | 'json' | 'checks'>('preview')
  // the sandbox keeps running in the background once opened (starting it takes a few seconds)
  const [sandboxOpened, setSandboxOpened] = useState(false)
  const [history, setHistory] = useState(false)
  const [asking, setAsking] = useState(false)
  const [naming, setNaming] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')

  // without an inventory (no files imported) the editor still works, just without target checks
  const inventoryQ = useQuery({ queryKey: ['inventory', tour.project_ID], queryFn: () => api.inventory(tour.project_ID), retry: false })
  const inventory: Inventory | undefined = inventoryQ.data

  // live checks on the working copy
  const issues: LintIssue[] = useMemo(() => {
    if (!ed.validation.ok) return (ed.validation.issues as LintIssue[]).map((i) => describeIssue(i, doc))
    return lintTour(doc, inventory ?? { controls: [], routes: [], views: [] }).issues as LintIssue[]
  }, [doc, inventory, ed.validation])
  const byStep = useMemo(() => {
    const map = new Map<string, StepIssues>()
    for (const i of issues) {
      if (!i.stepId || i.severity === 'info') continue
      const entry = map.get(i.stepId) ?? { errors: 0, warnings: 0 }
      if (i.severity === 'error') entry.errors++
      else entry.warnings++
      map.set(i.stepId, entry)
    }
    return map
  }, [issues])

  const index = Math.max(0, doc.steps.findIndex((s) => s.id === ed.selectedId))
  const control: InventoryControl | undefined = useMemo(() => {
    const t = selected?.target
    if (!t || !inventory) return undefined
    return inventory.controls.find((c) => c.localId === t.controlId && (!t.viewName || c.viewName === t.viewName))
  }, [selected, inventory])

  // Ctrl+Z / Ctrl+Y outside text fields, and a warning before leaving with unsaved work
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable], ui5-input, ui5-textarea, .cm-editor')) return
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        ed.undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        ed.redo()
      }
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (['unsaved', 'saving', 'invalid'].includes(ed.state)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onUnload)
    }
  })

  const onPick = (p: PickResult) => {
    if (!selected) return
    const fallbacks = p.text ? [{ by: 'text', value: p.text }] : []
    if (!p.controlId && !fallbacks.length) return
    ed.commit(setTarget(doc, selected.id, { ...(p.viewName ? { viewName: p.viewName } : {}), ...(p.controlId ? { controlId: p.controlId } : {}), fallbacks }))
  }

  const stepIssues = issues.filter((i) => i.stepId === selected?.id)
  const shownIssues = issues.filter((i) => i.severity !== 'info')

  return (
    <div className="page editor-page" data-testid="tour-page">
      <Breadcrumbs items={[{ label: 'Projects', to: '/' }, { label: 'Tours', to: `/projects/${tour.project_ID}?tab=tours` }, { label: doc.title }]} />

      <div className="editor-bar">
        <div className="editor-bar-left">
          <Input
            value={doc.title}
            style={{ fontWeight: 'bold' }}
            accessibleName="Tour title"
            onInput={(e) => ed.commit({ ...doc, title: e.target.value }, 'tour-title')}
            data-testid="tour-title-input"
          />
          <Tag colorScheme="8" data-testid="tour-version">
            v{ed.version}
          </Tag>
          <GeneratorTag generator={tour.generator} />
          <Tag colorScheme={STATE_COLOR[ed.state]} data-testid="save-state">
            {STATE_TEXT[ed.state]}
          </Tag>
        </div>
        <div className="editor-bar-actions">
          <Button icon="undo" design="Transparent" tooltip="Undo (Ctrl+Z)" disabled={!ed.canUndo} onClick={ed.undo} data-testid="undo" />
          <Button icon="redo" design="Transparent" tooltip="Redo (Ctrl+Y)" disabled={!ed.canRedo} onClick={ed.redo} data-testid="redo" />
          <Button icon="history" design="Transparent" onClick={() => setHistory(true)} data-testid="open-history">
            History
          </Button>
          <Button icon="save" onClick={() => setNaming(true)} disabled={!ed.validation.ok} data-testid="save-version">
            Save version…
          </Button>
          <Button icon="add-folder" onClick={() => setAdding(true)} data-testid="open-apply">
            Add to project
          </Button>
          <Button icon="download" design="Emphasized" onClick={() => setExporting(true)} data-testid="open-export">
            Export
          </Button>
        </div>
      </div>

      {ed.state === 'conflict' && (
        <MessageStrip design="Negative" hideCloseButton data-testid="conflict" style={{ marginBottom: '0.75rem' }}>
          {ed.error}{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              window.location.reload()
            }}
          >
            Reload
          </a>
        </MessageStrip>
      )}
      {ed.state === 'error' && <ErrorStrip error={new Error(ed.error ?? 'Could not save')} />}
      {inventoryQ.error && (
        <MessageStrip design="Information" hideCloseButton style={{ marginBottom: '0.75rem' }}>
          The project has no files yet, so controls cannot be checked or picked from a list.
        </MessageStrip>
      )}

      <div className={`editor-grid${rightTab === 'sandbox' || rightTab === 'live' ? ' wide' : ''}`}>
        <section className="card">
          <StepList
            doc={doc}
            selectedId={ed.selectedId}
            issues={byStep}
            onSelect={ed.setSelectedId}
            onMove={(from, to) => ed.commit(moveStep(doc, from, to))}
            onAdd={() => {
              const r = addStep(doc, ed.selectedId)
              ed.commit(r.doc)
              ed.setSelectedId(r.id)
            }}
            onDuplicate={(sid) => {
              const r = duplicateStep(doc, sid)
              ed.commit(r.doc)
              ed.setSelectedId(r.id)
            }}
            onDelete={(sid) => {
              const r = deleteStep(doc, sid)
              ed.commit(r.doc)
              ed.setSelectedId(r.selectId)
            }}
          />
        </section>

        <section className="card">
          {selected && (
            <StepForm
              key={selected.id}
              step={selected}
              index={index}
              inventory={inventory}
              issues={stepIssues}
              onChange={(patch, key) => ed.commit(updateStep(doc, selected.id, patch), key)}
              onSetTarget={(t) => ed.commit(setTarget(doc, selected.id, t))}
              onAskAi={() => setAsking(true)}
            />
          )}
        </section>

        <section className="card" style={{ padding: 0 }}>
          <TabContainer
            onTabSelect={(e) => {
              const tab = e.detail.tab.dataset.tab as typeof rightTab
              if (tab === 'sandbox') setSandboxOpened(true)
              setRightTab(tab)
            }}
          >
            <Tab text="Preview" data-tab="preview" selected={rightTab === 'preview'}>
              <div className="tab-content">{rightTab === 'preview' && selected && <BubblePreview doc={doc} step={selected} index={index} control={control} />}</div>
            </Tab>
            <Tab text="Sandbox" data-tab="sandbox" selected={rightTab === 'sandbox'}>
              {sandboxOpened && (
                <SandboxPreview projectID={tour.project_ID} doc={doc} valid={ed.validation.ok} selectedId={ed.selectedId} onSelectStep={ed.setSelectedId} onPick={onPick} />
              )}
            </Tab>
            <Tab text="Live" data-tab="live" selected={rightTab === 'live'}>
              {rightTab === 'live' && (
                <Suspense fallback={<BusyIndicator active style={{ margin: '1rem' }} />}>
                  <LivePanel tourID={tour.ID} doc={doc} valid={ed.validation.ok} saved={ed.state === 'saved'} />
                </Suspense>
              )}
            </Tab>
            <Tab text="JSON" data-tab="json" selected={rightTab === 'json'}>
              {rightTab === 'json' && (
                <Suspense fallback={<BusyIndicator active style={{ margin: '1rem' }} />}>
                  <JsonPanel doc={doc} onCommit={(d) => ed.commit(d, 'json')} />
                </Suspense>
              )}
            </Tab>
            <Tab text={`Checks (${shownIssues.length})`} data-tab="checks" selected={rightTab === 'checks'}>
              <div className="stack tab-content" data-testid="checks-panel">
                {shownIssues.length === 0 && (
                  <MessageStrip design="Positive" hideCloseButton data-testid="checks-ok">
                    All checks passed.
                  </MessageStrip>
                )}
                {shownIssues.map((i, n) => (
                  <MessageStrip key={n} design={i.severity === 'error' ? 'Negative' : 'Critical'} hideCloseButton data-testid="check-issue" onClick={() => i.stepId && ed.setSelectedId(i.stepId)}>
                    {i.message}
                  </MessageStrip>
                ))}
                <Text className="muted">Click a problem to jump to its step.</Text>
              </div>
            </Tab>
          </TabContainer>
        </section>
      </div>

      <AddToProjectDialog open={adding} tourID={tour.ID} projectID={tour.project_ID} flush={ed.flush} onClose={() => setAdding(false)} />

      <ExportDialog open={exporting} tourID={tour.ID} doc={doc} valid={ed.validation.ok} flush={ed.flush} onClose={() => setExporting(false)} onJump={ed.setSelectedId} />

      <HistoryDialog
        open={history}
        tourID={tour.ID}
        currentVersion={ed.version}
        flush={ed.flush}
        onClose={() => setHistory(false)}
        onRestored={(row) => {
          ed.adopt(row)
          setHistory(false)
        }}
      />

      {selected && (
        <AiDialog
          open={asking}
          tourID={tour.ID}
          step={selected}
          flush={ed.flush}
          onClose={() => setAsking(false)}
          onDone={(row) => {
            ed.adopt(row)
            setAsking(false)
          }}
        />
      )}

      <Dialog
        open={naming}
        headerText="Save a named version"
        onClose={() => setNaming(false)}
        data-testid="version-dialog"
        footer={
          <Bar
            endContent={
              <>
                <Button
                  design="Emphasized"
                  disabled={!note.trim()}
                  onClick={async () => {
                    if (await ed.saveVersion(note.trim())) {
                      setNaming(false)
                      setNote('')
                    }
                  }}
                  data-testid="version-save"
                >
                  Save
                </Button>
                <Button design="Transparent" onClick={() => setNaming(false)}>
                  Cancel
                </Button>
              </>
            }
          />
        }
      >
        <div style={{ width: 'min(28rem, 85vw)' }}>
          <Label required for="version-note">
            What is this version?
          </Label>
          <Input id="version-note" style={{ width: '100%' }} value={note} placeholder="e.g. Reviewed with Anna" onInput={(e) => setNote(e.target.value)} data-testid="version-note" />
        </div>
      </Dialog>
    </div>
  )
}
