import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BusyIndicator, Button, CheckBox, MessageStrip, Option, Select, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/refresh.js'
import '@ui5/webcomponents-icons/dist/cursor-arrow.js'
import '@ui5/webcomponents-icons/dist/restart.js'
import { api } from '../../api'
import { hashFor } from '../../editor/routeHash'
import type { PickResult, TourDocument } from '../../types'

const UI5_VERSIONS = [
  { value: '1.120', text: 'UI5 1.120' },
  { value: '1.148', text: 'UI5 1.148' },
  { value: 'latest', text: 'UI5 latest' },
]
const VERSION_KEY = 'tourd.sandbox.ui5'

const storedVersion = () => {
  try {
    const v = localStorage.getItem(VERSION_KEY)
    return UI5_VERSIONS.some((o) => o.value === v) ? (v as string) : '1.120'
  } catch {
    return '1.120'
  }
}

type Status = 'loading' | 'ready' | 'failed'

/**
 * The tour playing in a sandboxed copy of the app (an iframe without same-origin access, see
 * sandbox/sandbox.js for the messages). The step selected in the editor and the step shown in the
 * frame stay in step in both directions; changes of the tour restart it at the selected step.
 */
export default function SandboxPreview(props: {
  projectID: string
  doc: TourDocument
  valid: boolean
  selectedId: string
  onSelectStep: (id: string) => void
  onPick: (pick: PickResult) => void
}) {
  const { projectID, doc, valid, selectedId } = props
  const frame = useRef<HTMLIFrameElement>(null)
  const [ui5, setUi5] = useState(storedVersion)
  const [real, setReal] = useState(false)
  const [reload, setReload] = useState(0)
  const [status, setStatus] = useState<Status>('loading')
  const [version, setVersion] = useState<string | null>(null)
  const [messages, setMessages] = useState<string[]>([])
  const [ended, setEnded] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickNote, setPickNote] = useState<string | null>(null)
  const [page, setPage] = useState('')

  const index = Math.max(0, doc.steps.findIndex((s) => s.id === selectedId))
  const shown = useRef(-1) // the step the frame reports as visible
  const latest = useRef({ doc, index, valid, onSelectStep: props.onSelectStep, onPick: props.onPick })
  latest.current = { doc, index, valid, onSelectStep: props.onSelectStep, onPick: props.onPick }

  const info = useQuery({
    queryKey: ['preview-info', projectID, real, reload],
    queryFn: () => api.previewInfo(projectID, real ? 'real' : 'stub'),
    retry: false,
    staleTime: 0,
  })

  const post = useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ tourd: 'designer', ...message }, '*')
  }, [])

  const play = useCallback(() => {
    const { doc: d, index: i, valid: ok } = latest.current
    if (!ok) return
    setEnded(false)
    shown.current = -1
    post({ type: 'loadTour', tour: d, index: i })
  }, [post])

  // messages from the frame
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data
      if (e.source !== frame.current?.contentWindow || !m || m.tourd !== 'sandbox') return
      if (m.type === 'ready') {
        setStatus('ready')
        setVersion(String(m.version ?? ''))
        play()
      } else if (m.type === 'stepChanged') {
        shown.current = m.index
        const step = latest.current.doc.steps[m.index]
        if (step && m.index !== latest.current.index) latest.current.onSelectStep(step.id)
      } else if (m.type === 'tourEnded') {
        setEnded(true)
      } else if (m.type === 'pickResult') {
        setPicking(false)
        setPickNote(
          m.controlId
            ? m.viaParent
              ? `You clicked inside a ${String(m.clicked).split('.').pop()}; the ${String(m.controlType).split('.').pop()} "${m.controlId}" around it is now this step's target.`
              : `"${m.controlId}" is now this step's target.`
            : 'That part of the app has no fixed id, so the step finds it by its text.',
        )
        latest.current.onPick(m as PickResult)
      } else if (m.type === 'pickCancelled') {
        setPicking(false)
      } else if (m.type === 'error') {
        if (m.message) setMessages((old) => [...old.filter((x) => x !== m.message), String(m.message)].slice(-3))
        setStatus((s) => (s === 'loading' ? 'failed' : s))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [play])

  // the tour changed in the editor: restart it where the user is working (not on every keystroke)
  const tourKey = useMemo(() => JSON.stringify(doc), [doc])
  const sent = useRef('')
  useEffect(() => {
    if (status !== 'ready' || !valid || sent.current === tourKey) return
    const t = setTimeout(() => {
      if (sent.current === tourKey) return
      sent.current = tourKey
      play()
    }, 500)
    return () => clearTimeout(t)
  }, [tourKey, status, valid, play])
  useEffect(() => {
    if (status === 'ready') sent.current = tourKey // the first load already carried this version
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // another step selected in the editor
  useEffect(() => {
    if (status === 'ready' && valid && !ended && index !== shown.current && sent.current === tourKey) post({ type: 'goToStep', index })
  }, [index, status, valid, ended, tourKey, post])

  useEffect(() => {
    post({ type: 'pick', on: picking })
  }, [picking, post])

  const src = useMemo(() => {
    const q = new URLSearchParams({ ui5, parentOrigin: window.location.origin })
    if (real) q.set('controllers', 'real')
    return `/preview/${projectID}/sandbox.html?${q}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectID, ui5, real, reload])

  useEffect(() => {
    setStatus('loading')
    setEnded(false)
    setPicking(false)
    setMessages([])
    setVersion(null)
    shown.current = -1
    sent.current = ''
  }, [src, reload])

  if (info.error)
    return (
      <div className="tab-content stack" data-testid="sandbox-unavailable">
        <MessageStrip design="Critical" hideCloseButton>
          {info.error instanceof Error ? info.error.message : 'The sandbox is not available.'}
        </MessageStrip>
        <Text className="muted">The sandbox runs a copy of your app made from the files of this project, so it needs at least the manifest.json, the views and the i18n files.</Text>
      </div>
    )

  const routes = info.data?.routes ?? []
  return (
    <div className="sandbox tab-content stack" data-testid="sandbox">
      <div className="sandbox-bar">
        <Select
          accessibleName="UI5 version"
          style={{ width: '9rem' }}
          onChange={(e) => {
            const v = e.detail.selectedOption.value ?? '1.120'
            try {
              localStorage.setItem(VERSION_KEY, v)
            } catch {
              /* a remembered choice is only a convenience */
            }
            setUi5(v)
          }}
          data-testid="sandbox-ui5"
        >
          {UI5_VERSIONS.map((o) => (
            <Option key={o.value} value={o.value} selected={o.value === ui5}>
              {o.text}
            </Option>
          ))}
        </Select>
        {routes.length > 0 && (
          <Select
            accessibleName="Go to page"
            style={{ width: '11rem' }}
            onChange={(e) => {
              const hash = e.detail.selectedOption.dataset.hash
              if (hash !== undefined) post({ type: 'navigate', hash })
              setPage(e.detail.selectedOption.value ?? '')
            }}
            data-testid="sandbox-page"
          >
            <Option value="" selected={page === ''}>
              Go to page…
            </Option>
            {routes.map((r) => (
              <Option key={r.name} value={r.name} data-hash={hashFor(r.pattern)} selected={page === r.name}>
                {r.name}
              </Option>
            ))}
          </Select>
        )}
        <Button
          icon="cursor-arrow"
          design={picking ? 'Emphasized' : 'Default'}
          disabled={status !== 'ready'}
          onClick={() => {
            setPickNote(null)
            setPicking((p) => !p)
          }}
          tooltip="Click a control in the app to make it this step's target"
          data-testid="sandbox-pick"
        >
          {picking ? 'Cancel picking' : 'Pick control'}
        </Button>
        <Button icon="restart" design="Transparent" disabled={status !== 'ready' || !valid} onClick={play} tooltip="Play the tour again from the selected step" data-testid="sandbox-restart">
          Replay
        </Button>
        <Button
          icon="refresh"
          design="Transparent"
          onClick={() => setReload((n) => n + 1)}
          tooltip="Reload the app in the sandbox"
          accessibleName="Reload the sandbox"
          data-testid="sandbox-reload"
        />
      </div>

      {!valid && (
        <MessageStrip design="Critical" hideCloseButton data-testid="sandbox-invalid">
          The tour has problems (see Checks), so it is not played. The app is still shown.
        </MessageStrip>
      )}
      {picking && (
        <MessageStrip design="Information" hideCloseButton data-testid="sandbox-picking">
          Click a control in the app. Esc cancels.
        </MessageStrip>
      )}
      {pickNote && !picking && (
        <MessageStrip design="Positive" onClose={() => setPickNote(null)} data-testid="sandbox-picked">
          {pickNote}
        </MessageStrip>
      )}
      {ended && valid && (
        <MessageStrip design="Information" hideCloseButton data-testid="sandbox-ended">
          The tour has ended. Press Replay to see it again.
        </MessageStrip>
      )}
      {messages.map((m) => (
        <MessageStrip key={m} design="Critical" hideCloseButton data-testid="sandbox-message">
          {m}
        </MessageStrip>
      ))}

      <div className="sandbox-frame">
        {status === 'loading' && <BusyIndicator active className="sandbox-busy" size="L" data-testid="sandbox-loading" />}
        <iframe
          key={`${src}#${reload}`}
          ref={frame}
          src={src}
          title="Sandbox preview of the app"
          sandbox="allow-scripts"
          data-testid="sandbox-frame"
        />
      </div>

      <div className="sandbox-foot">
        <Text className="muted">
          {version ? `UI5 ${version} · ` : ''}
          Sample data; buttons do not change anything.
        </Text>
        <CheckBox
          text="Run the app's own controllers"
          checked={real}
          onChange={(e) => setReal(e.target.checked ?? false)}
          data-testid="sandbox-real"
        />
      </div>
      {real && (
        <MessageStrip design="Critical" hideCloseButton data-testid="sandbox-real-warning">
          The uploaded controller code runs inside the sandbox (it cannot reach QuickDev or your data here, but it may fail without its backend).
        </MessageStrip>
      )}
      {info.data && info.data.notes.length > 0 && (
        <Text className="muted" data-testid="sandbox-notes">
          {info.data.notes.join(' ')}
        </Text>
      )}
    </div>
  )
}
