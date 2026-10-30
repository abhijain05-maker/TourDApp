import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bar,
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
  Title,
} from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/delete.js'
import '@ui5/webcomponents-icons/dist/add.js'
import { api } from '../api'
import type { Project, RecordingRow, TestPlanRow } from '../types'
import { ConfirmDialog, ErrorStrip, PURPOSE_LABEL, Tag, purposeOf, recordingsFor } from './common'
import { formatDate } from '../format'
import { DEFAULT_SETTINGS, type Wdi5Settings } from '../../../shared/wdi5-plan.mjs'
import { AUTH_LABEL, FRAMEWORK_LABEL } from '../wdi5'

const settingsOf = (row: TestPlanRow): Wdi5Settings => {
  try {
    return JSON.parse(row.definition).settings
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** The project's wdi5 test plans: one per recording you want to turn into tests. */
export default function TestsTab({ project, onNeedRecording }: { project: Project; onNeedRecording: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<TestPlanRow | null>(null)
  const plans = useQuery({ queryKey: ['test-plans', project.ID], queryFn: () => api.testPlans(project.ID) })
  const recordings = useQuery({ queryKey: ['recordings', project.ID], queryFn: () => api.recordings(project.ID) })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTestPlan(id),
    onSuccess: () => {
      setToDelete(null)
      return qc.invalidateQueries({ queryKey: ['test-plans', project.ID] })
    },
  })
  const noRecording = (recordings.data ?? []).length === 0
  return (
    <div className="stack" data-testid="tests-tab">
      <div className="row spread">
        <div>
          <Title level="H4">Tests</Title>
          <Text className="muted">Turn a recording into wdi5 tests: review them as a table, then add the files to your project.</Text>
        </div>
        <Button design="Emphasized" icon="add" disabled={noRecording} onClick={() => setCreating(true)} data-testid="new-test-plan">
          New tests from a recording
        </Button>
      </div>
      {noRecording && !recordings.isLoading && (
        <MessageStrip design="Information" hideCloseButton data-testid="need-recording">
          You need a recording first. <a href="#" onClick={(e) => (e.preventDefault(), onNeedRecording())}>Import one</a>.
        </MessageStrip>
      )}
      <ErrorStrip error={plans.error ?? remove.error} />
      <div className="card" style={{ padding: 0 }}>
        <Table
          data-testid="tests-table"
          onRowClick={(e) => navigate(`/tests/${e.detail.row.rowKey}`)}
          noData={<Text className="muted" style={{ padding: '1rem' }}>No tests yet.</Text>}
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Steps</TableHeaderCell>
              <TableHeaderCell>Framework</TableHeaderCell>
              <TableHeaderCell>Login</TableHeaderCell>
              <TableHeaderCell>Changed</TableHeaderCell>
              <TableHeaderCell width="4rem" />
            </TableHeaderRow>
          }
        >
          {(plans.data ?? []).map((t) => {
            const s = settingsOf(t)
            let steps = 0
            try {
              steps = JSON.parse(t.definition).steps.filter((x: { kind: string }) => !['open', 'assert'].includes(x.kind)).length
            } catch {
              /* shown as 0 */
            }
            return (
              <TableRow key={t.ID} rowKey={t.ID} interactive data-testid="test-row">
                <TableCell>
                  <b>{t.name}</b>
                </TableCell>
                <TableCell>{steps}</TableCell>
                <TableCell>
                  <Tag colorScheme="6">{FRAMEWORK_LABEL[s.framework] ?? s.framework}</Tag>
                </TableCell>
                <TableCell>{AUTH_LABEL[s.auth] ?? s.auth}</TableCell>
                <TableCell>{formatDate(t.modifiedAt)}</TableCell>
                <TableCell>
                  <Button
                    icon="delete"
                    design="Transparent"
                    tooltip="Delete these tests"
                    data-testid="delete-test-plan"
                    onClick={(e) => {
                      e.stopPropagation()
                      setToDelete(t)
                    }}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </Table>
      </div>
      {creating && (
        <NewTestDialog
          project={project}
          recordings={recordings.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            void qc.invalidateQueries({ queryKey: ['test-plans', project.ID] })
            navigate(`/tests/${id}`)
          }}
        />
      )}
      <ConfirmDialog open={!!toDelete} title="Delete these tests" confirmText="Delete" busy={remove.isPending} onCancel={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.ID)}>
        {toDelete && `Delete "${toDelete.name}"? Files already added to the project stay there.`}
      </ConfirmDialog>
    </div>
  )
}

function NewTestDialog(props: { project: Project; recordings: RecordingRow[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false)
  // tests are made from recordings made for tests (or for both): the others only when asked for
  const { shown, hidden, noneFit } = recordingsFor(props.recordings, 'test', showAll)
  const [chosen, setRecordingID] = useState('')
  const recordingID = shown.some((r) => r.ID === chosen) ? chosen : (shown[0]?.ID ?? '')
  const [name, setName] = useState('')
  const [framework, setFramework] = useState<Wdi5Settings['framework']>('mocha')
  const [auth, setAuth] = useState<Wdi5Settings['auth']>('none')
  const create = useMutation({
    mutationFn: () => api.createTestPlan({ projectID: props.project.ID, recordingID, name: name.trim(), settings: { framework, auth } }),
    onSuccess: (row) => props.onCreated(row.ID),
  })
  return (
    <Dialog
      open
      headerText="New tests from a recording"
      onClose={props.onClose}
      data-testid="new-test-dialog"
      footer={
        <Bar
          endContent={
            <>
              <Button design="Emphasized" disabled={!recordingID || create.isPending} onClick={() => create.mutate()} data-testid="create-test-plan">
                Create
              </Button>
              <Button design="Transparent" onClick={props.onClose}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <div className="stack" style={{ width: 'min(30rem, 85vw)' }}>
        <ErrorStrip error={create.error} />
        <div>
          <Label showColon>Recording</Label>
          <Select style={{ width: '100%' }} accessibleName="Recording" data-testid="test-recording" onChange={(e) => setRecordingID(e.detail.selectedOption.value ?? "")}>
            {shown.map((r) => (
              <Option key={r.ID} value={r.ID} selected={r.ID === recordingID}>
                {showAll || noneFit ? `${r.name} (${PURPOSE_LABEL[purposeOf(r)].toLowerCase()})` : r.name}
              </Option>
            ))}
          </Select>
          {noneFit && (
            <Text className="muted" data-testid="test-none-fit" style={{ display: 'block' }}>
              None of the recordings was made for tests; all are shown.
            </Text>
          )}
          {hidden > 0 && (
            <a href="#" data-testid="test-show-all" onClick={(e) => (e.preventDefault(), setShowAll(true))}>
              Show all recordings ({hidden} more, made for tours)
            </a>
          )}
        </div>
        <div>
          <Label showColon>Name</Label>
          <Input style={{ width: '100%' }} value={name} placeholder="Defaults to the name of the recording" accessibleName="Name" onInput={(e) => setName(e.target.value)} data-testid="test-name" />
        </div>
        <div>
          <Label showColon>Test framework</Label>
          <Select style={{ width: '100%' }} accessibleName="Test framework" data-testid="test-framework" onChange={(e) => setFramework(e.detail.selectedOption.value as Wdi5Settings['framework'])}>
            <Option value="mocha" selected={framework === 'mocha'}>Mocha (default of wdi5)</Option>
            <Option value="jasmine" selected={framework === 'jasmine'}>Jasmine</Option>
          </Select>
        </div>
        <div>
          <Label showColon>Login of the app</Label>
          <Select style={{ width: '100%' }} accessibleName="Login of the app" data-testid="test-auth" onChange={(e) => setAuth(e.detail.selectedOption.value as Wdi5Settings['auth'])}>
            {Object.entries(AUTH_LABEL).map(([value, label]) => (
              <Option key={value} value={value} selected={auth === value}>
                {label}
              </Option>
            ))}
          </Select>
        </div>
        <Text className="muted">You can change all of this later in the plan.</Text>
      </div>
    </Dialog>
  )
}
