import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bar, BusyIndicator, Button, Dialog, Icon, Input, Label, MessageStrip, Option, Select, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/accept.js'
import '@ui5/webcomponents-icons/dist/error.js'
import '@ui5/webcomponents-icons/dist/circle-task.js'
import { api } from '../api'
import type { Job, Project, ProviderInfo, RecordingRow } from '../types'
import { ErrorStrip, PURPOSE_LABEL, purposeOf, recordingsFor } from './common'

const STAGES: [string, string][] = [
  ['context', 'Reading your files and the recording'],
  ['generate', 'Generating the tour'],
  ['repair', 'Fixing problems the checks found'],
  ['validate', 'Checking the result'],
  ['save', 'Saving the tour'],
]
const LAST_PROVIDER = 'tourd.lastProvider'

const remembered = () => {
  try {
    return localStorage.getItem(LAST_PROVIDER)
  } catch {
    return null
  }
}

interface Report {
  steps?: number
  repairs?: number
  unresolved?: number
  usage?: { inputTokens?: number; outputTokens?: number }
  lint?: { errors: number; warnings: number }
}

export function JobProgress({ jobID, onDone }: { jobID: string; onDone: (tourID: string) => void }) {
  const job = useQuery({
    queryKey: ['job', jobID],
    queryFn: () => api.job(jobID),
    refetchInterval: (q) => (q.state.data && ['done', 'failed'].includes(q.state.data.status) ? false : 500),
  })
  const j: Job | undefined = job.data
  const report: Report | null = j?.report ? JSON.parse(j.report) : null

  useEffect(() => {
    if (j?.status === 'done' && j.tour_ID) onDone(j.tour_ID)
  }, [j?.status, j?.tour_ID, onDone])

  const current = j?.status === 'done' ? STAGES.length : Math.max(0, STAGES.findIndex(([id]) => id === j?.stage))
  const showRepair = (report?.repairs ?? 0) > 0 || j?.stage === 'repair'
  return (
    <div className="stack" style={{ minWidth: '24rem' }} data-testid="job-progress">
      <ErrorStrip error={job.error} />
      <ul className="steps">
        {STAGES.filter(([id]) => id !== 'repair' || showRepair).map(([id, label]) => {
          const i = STAGES.findIndex(([s]) => s === id)
          const failed = j?.status === 'failed' && i === current
          const done = i < current
          return (
            <li key={id} data-stage={id} data-state={failed ? 'failed' : done ? 'done' : i === current ? 'active' : 'pending'}>
              {failed ? <Icon name="error" design="Negative" /> : done ? <Icon name="accept" design="Positive" /> : i === current ? <BusyIndicator active size="S" /> : <Icon name="circle-task" />}
              <Text>{label}</Text>
            </li>
          )
        })}
      </ul>
      {j?.status === 'failed' && (
        <MessageStrip design="Negative" hideCloseButton data-testid="job-error">
          {j.error ?? 'The generation failed.'}
        </MessageStrip>
      )}
      {j?.status === 'done' && report && (
        <MessageStrip design={report.unresolved || report.lint?.errors ? 'Critical' : 'Positive'} hideCloseButton data-testid="job-done">
          Created a tour with {report.steps} step(s)
          {report.repairs ? `, after ${report.repairs} automatic correction round(s)` : ''}
          {report.unresolved ? `. ${report.unresolved} step(s) could not be attached to a control and are marked for review` : ''}.
        </MessageStrip>
      )}
    </div>
  )
}

export default function GenerateDialog(props: {
  open: boolean
  project: Project
  recordings: RecordingRow[]
  onClose: () => void
  onDone: (tourID: string) => void
}) {
  const { open, project, recordings, onClose, onDone } = props
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers, enabled: open })
  const [recordingID, setRecordingID] = useState('')
  const [showAll, setShowAll] = useState(false)
  // tours are made from recordings made for tours (or for both): the others only when asked for
  const { shown, hidden, noneFit } = recordingsFor(recordings, 'tour', showAll)
  const [provider, setProvider] = useState<string>(() => remembered() ?? 'rules')
  const [model, setModel] = useState('')
  const [title, setTitle] = useState('')
  const [jobID, setJobID] = useState<string | null>(null)

  const start = useMutation({
    mutationFn: () => api.generateTour({ projectID: project.ID, recordingID: shown.some((r) => r.ID === recordingID) ? recordingID : shown[0].ID, provider, model: model.trim(), title: title.trim() }),
    onSuccess: (job) => {
      try {
        localStorage.setItem(LAST_PROVIDER, provider)
      } catch {
        /* remembering the choice is a convenience only */
      }
      setJobID(job.ID)
    },
  })

  const infos: ProviderInfo[] = providers.data ?? []
  const info = infos.find((p) => p.id === provider)
  const usable = !!info?.configured
  const isAi = provider !== 'rules'
  const close = () => {
    setJobID(null)
    start.reset()
    onClose()
  }

  return (
    <Dialog
      open={open}
      headerText="Generate a tour"
      onClose={close}
      data-testid="generate-dialog"
      footer={
        <Bar
          endContent={
            <>
              {!jobID && (
                <Button design="Emphasized" disabled={!usable || !shown.length || start.isPending} onClick={() => start.mutate()} data-testid="generate-start">
                  Generate
                </Button>
              )}
              <Button design="Transparent" onClick={close} data-testid="generate-close">
                {jobID ? 'Close' : 'Cancel'}
              </Button>
            </>
          }
        />
      }
    >
      {jobID ? (
        <JobProgress jobID={jobID} onDone={onDone} />
      ) : (
        <div className="stack" style={{ width: 'min(34rem, 85vw)' }}>
          <ErrorStrip error={start.error ?? providers.error} />
          <div>
            <Label required for="gen-recording">
              Recording
            </Label>
            <Select id="gen-recording" style={{ width: '100%' }} onChange={(e) => setRecordingID(e.detail.selectedOption.value ?? '')} data-testid="gen-recording">
              {shown.map((r, i) => (
                <Option key={r.ID} value={r.ID} selected={shown.some((x) => x.ID === recordingID) ? r.ID === recordingID : i === 0}>
                  {showAll || noneFit ? `${r.name} (${PURPOSE_LABEL[purposeOf(r)].toLowerCase()})` : r.name}
                </Option>
              ))}
            </Select>
            {noneFit && (
              <Text className="muted" data-testid="gen-none-fit" style={{ display: 'block' }}>
                None of the recordings was made for tours; all are shown.
              </Text>
            )}
            {hidden > 0 && (
              <a href="#" data-testid="gen-show-all" onClick={(e) => (e.preventDefault(), setShowAll(true))}>
                Show all recordings ({hidden} more, made for tests)
              </a>
            )}
          </div>
          <div>
            <Label required for="gen-provider">
              Created by
            </Label>
            <Select id="gen-provider" style={{ width: '100%' }} onChange={(e) => setProvider(e.detail.selectedOption.value ?? 'rules')} data-testid="gen-provider">
              {infos.map((p) => (
                <Option key={p.id} value={p.id} selected={p.id === provider}>
                  {p.label}
                  {p.configured ? '' : ' (not configured on the server)'}
                </Option>
              ))}
            </Select>
          </div>
          {isAi && (
            <>
              <div>
                <Label for="gen-model">Model</Label>
                <Input id="gen-model" style={{ width: '100%' }} value={model} placeholder={info?.model ? `default: ${info.model}` : 'model name'} onInput={(e) => setModel(e.target.value)} data-testid="gen-model" />
              </div>
              <MessageStrip design="Information" hideCloseButton data-testid="privacy-notice">
                The control list, the recording steps and your source files are sent to {info?.label ?? 'the provider'}. Typed values from the recording are not sent.{' '}
                {info?.redaction === false ? 'Redaction is switched off on this server: comments and secret-looking values are NOT removed from the files.' : 'Comments and secret-looking values are removed from the files first.'}
              </MessageStrip>
            </>
          )}
          <div>
            <Label for="gen-title">Tour title</Label>
            <Input id="gen-title" style={{ width: '100%' }} value={title} placeholder="optional" onInput={(e) => setTitle(e.target.value)} data-testid="gen-title" />
          </div>
        </div>
      )}
    </Dialog>
  )
}
