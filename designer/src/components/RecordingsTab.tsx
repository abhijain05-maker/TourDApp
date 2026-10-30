import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bar,
  BusyIndicator,
  Button,
  Dialog,
  Input,
  Label,
  MessageStrip,
  Option,
  Select,
  Table,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
  TextArea,
  Title,
} from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/upload.js'
import '@ui5/webcomponents-icons/dist/delete.js'
import '@ui5/webcomponents-icons/dist/detail-view.js'
import { api } from '../api'
import type { Project, RecordingResult, RecordingRow, RecordingSummary } from '../types'
import { ErrorStrip, Tag } from './common'
import { formatDate } from '../format'

const FORMATS = [
  { value: '', label: 'Detect automatically' },
  { value: 'tourd-recorder', label: 'TourD recorder (JSON)' },
  { value: 'devtools-recorder', label: 'Chrome DevTools Recorder (JSON)' },
  { value: 'ui5-test-recorder', label: 'UI5 Test Recorder (OPA5 / wdi5 snippets)' },
  { value: 'plain-text', label: 'Plain text (one step per line)' },
]
const FORMAT_LABEL: Record<string, string> = {
  'tourd-recorder': 'TourD recorder',
  'devtools-recorder': 'DevTools Recorder',
  'ui5-test-recorder': 'UI5 Test Recorder',
  'plain-text': 'Plain text',
}

const shortName = (name?: string | null) => (name ?? '').split('.').slice(-1)[0]

interface MappedStep {
  index: number
  action: string
  value?: string
  text?: string
  hash?: string
  navigatesTo?: string
  submit?: boolean
  choice?: string
  toggled?: boolean
  redacted?: boolean
  dom?: { ariaLabel?: string | null }
  ui5: {
    viewName: string | null
    localId: string | null
    display: string | null
    via: string
    confidence: number
    controllerName?: string
    handler?: string
  } | null
}

const summaryOf = (r: RecordingRow): RecordingSummary | null => {
  try {
    return r.summary ? (JSON.parse(r.summary) as RecordingSummary) : null
  } catch {
    return null
  }
}

export default function RecordingsTab({ project }: { project: Project }) {
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [format, setFormat] = useState('')
  const [raw, setRaw] = useState('')
  const [last, setLast] = useState<RecordingResult | null>(null)
  const [details, setDetails] = useState<RecordingRow | null>(null)
  const empty = project.parseStatus === 'empty'

  const recordings = useQuery({ queryKey: ['recordings', project.ID], queryFn: () => api.recordings(project.ID) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['recordings', project.ID] })

  const importRec = useMutation({
    mutationFn: () => api.importRecording(project.ID, name.trim(), raw, format),
    onSuccess: (r) => {
      setLast(r)
      setRaw('')
      setName('')
      return refresh()
    },
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteRecording(id), onSuccess: refresh })

  return (
    <div className="stack" data-testid="recordings-tab">
      <div>
        <Title level="H4">Record a flow</Title>
        <Text className="muted">
          Record what a user does in your running app with the Chrome DevTools <b>Recorder</b> panel (export as JSON), or paste snippets from the UI5 Test Recorder,
          or just describe the steps in plain text.
        </Text>
      </div>

      {empty && (
        <MessageStrip design="Information" hideCloseButton data-testid="need-sources">
          Add your app's files first (Files tab): recordings are matched against the controls found there.
        </MessageStrip>
      )}

      <div className="card stack">
        <div className="row">
          <div style={{ flex: 1, minWidth: '14rem' }}>
            <Label for="rec-name">Name</Label>
            <Input id="rec-name" style={{ width: '100%' }} value={name} placeholder="optional" onInput={(e) => setName(e.target.value)} data-testid="rec-name" />
          </div>
          <div style={{ flex: 1, minWidth: '14rem' }}>
            <Label for="rec-format">Format</Label>
            <Select id="rec-format" style={{ width: '100%' }} onChange={(e) => setFormat(e.detail.selectedOption.value ?? '')} data-testid="rec-format">
              {FORMATS.map((f) => (
                <Option key={f.value} value={f.value} selected={f.value === format}>
                  {f.label}
                </Option>
              ))}
            </Select>
          </div>
          <Button icon="upload" onClick={() => fileInput.current?.click()} style={{ alignSelf: 'flex-end' }} data-testid="rec-load">
            Load from file
          </Button>
          <input
            ref={fileInput}
            type="file"
            className="hidden-input"
            data-testid="rec-file"
            accept=".json,.js,.txt,text/plain,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) {
                setRaw(await f.text())
                if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
              }
              e.target.value = ''
            }}
          />
        </div>
        <div>
          <Label for="rec-raw">Recording</Label>
          <TextArea id="rec-raw" rows={10} style={{ width: '100%' }} value={raw} placeholder="Paste the recording here" onInput={(e) => setRaw(e.target.value)} data-testid="rec-raw" />
        </div>
        <div className="row">
          <Button design="Emphasized" disabled={empty || !raw.trim() || importRec.isPending} onClick={() => importRec.mutate()} data-testid="rec-import">
            Import recording
          </Button>
          {importRec.isPending && <BusyIndicator active size="S" />}
        </div>
        <ErrorStrip error={importRec.error} />
        {last && (
          <MessageStrip design={last.unmapped ? 'Critical' : 'Positive'} hideCloseButton data-testid="rec-result">
            Imported a {FORMAT_LABEL[last.format] ?? last.format} recording: {last.steps} step(s), {last.mapped} of {last.actionable} matched to a control
            {last.unmapped ? `, ${last.unmapped} could not be found in your files` : ''}.
          </MessageStrip>
        )}
      </div>

      <ErrorStrip error={recordings.error ?? remove.error} />
      <div className="card" style={{ padding: 0 }}>
        <Table
          data-testid="recordings-table"
          noData={<Text className="muted" style={{ padding: '1rem' }}>No recordings yet.</Text>}
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Format</TableHeaderCell>
              <TableHeaderCell>Matched</TableHeaderCell>
              <TableHeaderCell>Imported</TableHeaderCell>
              <TableHeaderCell width="7rem" />
            </TableHeaderRow>
          }
        >
          {(recordings.data ?? []).map((r) => {
            const s = summaryOf(r)
            return (
              <TableRow key={r.ID} rowKey={r.ID} data-testid="recording-row">
                <TableCell>{r.name}</TableCell>
                <TableCell>
                  <Tag colorScheme="8">{FORMAT_LABEL[r.format] ?? r.format}</Tag>
                </TableCell>
                <TableCell>
                  {s ? (
                    <Tag colorScheme={s.unmapped ? '2' : '6'}>
                      {s.mapped} of {s.actionable}
                    </Tag>
                  ) : (
                    '–'
                  )}
                </TableCell>
                <TableCell>{formatDate(r.createdAt)}</TableCell>
                <TableCell>
                  <Button icon="detail-view" design="Transparent" tooltip="Show how the steps were matched" onClick={() => setDetails(r)} data-testid="rec-details" />
                  <Button icon="delete" design="Transparent" tooltip="Delete recording" disabled={remove.isPending} onClick={() => remove.mutate(r.ID)} />
                </TableCell>
              </TableRow>
            )
          })}
        </Table>
      </div>

      <DetailsDialog recording={details} onClose={() => setDetails(null)} />
    </div>
  )
}

function DetailsDialog({ recording, onClose }: { recording: RecordingRow | null; onClose: () => void }) {
  const mapped = useQuery({
    queryKey: ['recording', recording?.ID],
    queryFn: () => api.mappedRecording(recording!.ID) as Promise<{ steps: MappedStep[] }>,
    enabled: !!recording,
  })
  const steps = (mapped.data?.steps ?? []).filter((s) => s.action !== 'key')
  return (
    <Dialog
      open={!!recording}
      headerText={recording ? `Steps of "${recording.name}"` : ''}
      onClose={onClose}
      data-testid="rec-details-dialog"
      footer={<Bar endContent={<Button onClick={onClose}>Close</Button>} />}
    >
      <div style={{ width: 'min(56rem, 85vw)' }}>
        <ErrorStrip error={mapped.error} />
        {mapped.isLoading && <BusyIndicator active />}
        <Table
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell width="3.5rem">#</TableHeaderCell>
              <TableHeaderCell width="7rem">Action</TableHeaderCell>
              <TableHeaderCell>Control</TableHeaderCell>
              <TableHeaderCell width="12rem">Matched by</TableHeaderCell>
              <TableHeaderCell>Notes</TableHeaderCell>
            </TableHeaderRow>
          }
        >
          {steps.map((s) => (
            <TableRow key={s.index} data-testid="rec-step">
              <TableCell>{s.index}</TableCell>
              <TableCell>{s.action}</TableCell>
              <TableCell>
                {s.ui5 ? (
                  <span>
                    <b>{s.ui5.display ?? s.ui5.localId}</b> <span className="muted mono">{s.ui5.localId ?? 'no id'}</span>
                    {(s.ui5.viewName || s.ui5.controllerName) && (
                      <div className="muted mono" data-testid="rec-step-where">
                        {[shortName(s.ui5.viewName), s.ui5.controllerName ? shortName(s.ui5.controllerName) : '', s.ui5.handler ? `${s.ui5.handler}()` : ''].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </span>
                ) : s.action === 'navigate' || s.action === 'note' ? (
                  <span className="muted">{s.text ?? s.hash ?? ''}</span>
                ) : (
                  <Tag colorScheme="2">not found in your files</Tag>
                )}
              </TableCell>
              <TableCell>{s.ui5 ? `${s.ui5.via} (${Math.round(s.ui5.confidence * 100)}%)` : ''}</TableCell>
              <TableCell className="muted">
                {[s.submit ? 'then Enter' : '', s.navigatesTo !== undefined ? (s.navigatesTo === '' ? 'opens the start page' : `opens "${s.navigatesTo}"`) : '', s.choice ? `chooses "${s.choice}"` : '', s.toggled !== undefined ? (s.toggled ? 'switched on' : 'switched off') : '', s.redacted ? 'value left out (secret)' : s.value !== undefined ? 'with a value' : '']
                  .filter(Boolean)
                  .join(', ')}
              </TableCell>
            </TableRow>
          ))}
        </Table>
      </div>
    </Dialog>
  )
}
