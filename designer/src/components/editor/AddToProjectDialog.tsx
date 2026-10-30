import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BusyIndicator, Button, Dialog, MessageStrip, Text } from '@ui5/webcomponents-react'
import { api } from '../../api'
import { languageFor } from '../../workspace/language'
import { ErrorStrip } from '../common'

const DiffView = lazy(() => import('../../workspace/DiffView'))

/**
 * Adds the tour to the project's own files: the player and the tour in `tourd/`, the manifest entry, a start
 * button in the start page's view and its handler in the controller. Shows every file as a diff first and writes
 * only the ones that stay ticked; the result is an ordinary change of the workspace that can be edited further.
 */
export default function AddToProjectDialog(props: Props) {
  // mounted only while open, so every opening starts from the saved tour and nothing of the last time is left
  return props.open ? <Body {...props} /> : null
}

interface Props {
  open: boolean
  /** what is added: a tour, the wdi5 tests of a test plan, or the help of a help set (`tourID` is then its ID) */
  kind?: 'tour' | 'tests' | 'help'
  tourID: string
  projectID: string
  flush: () => Promise<boolean>
  onClose: () => void
}

function Body(props: Props) {
  const { tourID } = props
  const tests = props.kind === 'tests'
  const help = props.kind === 'help'
  const noun = tests ? 'tests' : help ? 'help' : 'tour'
  const qc = useQueryClient()
  const [ready, setReady] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState<string | null>(null)
  const [accept, setAccept] = useState(false)

  // the plan is made from the saved tour: save the working copy first
  useEffect(() => {
    let cancelled = false
    props.flush().then(() => !cancelled && setReady(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plan = useQuery({
    queryKey: ['apply-plan', props.kind ?? 'tour', tourID, ready],
    queryFn: () => (tests ? api.previewTestApply(tourID) : help ? api.previewHelpApply(tourID) : api.previewTourApply(tourID)),
    enabled: ready,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })
  const edits = plan.data?.edits ?? []
  const current = edits.find((e) => e.path === shown) ?? edits[0]
  const chosen = edits.filter((e) => !skipped.has(e.path))
  const language = useMemo(() => languageFor(current?.path ?? ''), [current?.path])

  const apply = useMutation({
    mutationFn: () => {
      const paths = chosen.map((e) => e.path)
      return tests ? api.applyTestToProject(tourID, paths, accept) : help ? api.applyHelpToProject(tourID, paths, accept) : api.applyTourToProject(tourID, paths, accept)
    },
    onSuccess: () =>
      Promise.all(['sources', 'changes', 'inventory', 'project', 'projects', 'file'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })

  const toggle = (path: string) =>
    setSkipped((set) => {
      const next = new Set(set)
      if (!next.delete(path)) next.add(path)
      return next
    })

  return (
    <Dialog
      open
      headerText={`Add the ${noun} to the project`}
      onClose={props.onClose}
      data-testid="apply-dialog"
      footer={
        <Bar
          endContent={
            <>
              {!apply.data && (
                <Button
                  design="Emphasized"
                  disabled={!plan.data?.ok || chosen.length === 0 || apply.isPending}
                  onClick={() => apply.mutate()}
                  data-testid="apply-confirm"
                >
                  {chosen.length ? `Add ${chosen.length} file${chosen.length === 1 ? '' : 's'}` : 'Add'}
                </Button>
              )}
              <Button design="Transparent" onClick={props.onClose} data-testid="apply-close">
                {apply.data ? 'Close' : 'Cancel'}
              </Button>
            </>
          }
        />
      }
    >
      <div className="stack apply" style={{ width: 'min(64rem, 92vw)' }}>
        {(!ready || plan.isLoading || apply.isPending) && <BusyIndicator active data-testid="apply-loading" />}
        <ErrorStrip error={plan.error ?? apply.error} />

        {apply.data && (
          <MessageStrip design="Positive" hideCloseButton data-testid="apply-done">
            {apply.data.applied
              ? `${apply.data.applied} file(s) were added to the project${accept ? ' and made part of it' : ''}. `
              : `Nothing had to change: the project already has the ${noun}. `}
            <Link to={`/projects/${props.projectID}`} onClick={props.onClose} data-testid="apply-open-workspace">
              Open the workspace
            </Link>{' '}
            to review them, change them further or download them.
          </MessageStrip>
        )}

        {plan.data && !plan.data.ok && (
          <>
            <MessageStrip design="Negative" hideCloseButton data-testid="apply-blocked">
              {`The ${noun} cannot be added yet:`}
            </MessageStrip>
            {plan.data.blocking.map((b, i) => (
              <MessageStrip key={i} design="Negative" hideCloseButton>
                {b.message}
              </MessageStrip>
            ))}
          </>
        )}
        {plan.data?.notes.map((n, i) => (
          <MessageStrip key={i} design="Critical" hideCloseButton data-testid="apply-note">
            {n.message}
          </MessageStrip>
        ))}

        {plan.data?.ok && edits.length === 0 && !apply.data && (
          <MessageStrip design="Information" hideCloseButton data-testid="apply-nothing">
            {tests ? 'The project already has these tests: nothing to add.' : `The project already has this ${noun}: nothing to add.`}
          </MessageStrip>
        )}

        {plan.data?.ok && edits.length > 0 && (
          <div className="apply-body">
            <ul className="apply-files" aria-label="Files to change">
              {edits.map((e) => (
                <li key={e.path} className={e.path === current?.path ? 'active' : ''} data-testid="apply-file">
                  <input
                    type="checkbox"
                    checked={!skipped.has(e.path)}
                    disabled={!!apply.data}
                    onChange={() => toggle(e.path)}
                    aria-label={`Include ${e.path}`}
                  />
                  <button className="apply-pick" onClick={() => setShown(e.path)}>
                    <span className={`badge ${e.action === 'add' ? 'added' : 'modified'}`}>{e.action === 'add' ? 'A' : 'M'}</span>
                    <span className="apply-path">
                      <span className="mono">{e.path}</span>
                      <small>{e.what}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="apply-diff">
              {current && (
                <Suspense fallback={<BusyIndicator active />}>
                  <DiffView before={current.before ?? ''} after={current.after} language={language} beforeLabel={current.action === 'add' ? 'Not there yet' : 'Now'} afterLabel={`With the ${noun}`} />
                </Suspense>
              )}
            </div>
          </div>
        )}
        {plan.data?.ok && edits.length > 0 && !apply.data && (
          <>
            <Text className="muted">Untick a file to leave it out. Nothing is written until you press the button.</Text>
            <label className="row" data-testid="apply-accept-row">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} data-testid="apply-accept" />
              <span>Also make the added files part of the project, so they do not show up as changes (you can still download them by choosing the whole project).</span>
            </label>
          </>
        )}
      </div>
    </Dialog>
  )
}
