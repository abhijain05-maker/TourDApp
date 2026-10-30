import { useMemo, useState } from 'react'
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
  TextArea,
  Title,
} from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/delete.js'
import '@ui5/webcomponents-icons/dist/ai.js'
import '@ui5/webcomponents-icons/dist/edit.js'
import { api } from '../api'
import type { HelpDocument, HelpSetRow, HelpTopic, Project } from '../types'
import { ConfirmDialog, ErrorStrip, Tag } from './common'
import AddToProjectDialog from './editor/AddToProjectDialog'
import Markdown from './Markdown'
import { formatDate } from '../format'

const docOf = (row: HelpSetRow | undefined): HelpDocument | null => {
  try {
    return row ? (JSON.parse(row.definition) as HelpDocument) : null
  } catch {
    return null
  }
}

const parseLinks = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => {
      const at = line.lastIndexOf('|')
      const url = (at >= 0 ? line.slice(at + 1) : line).trim()
      return /^https?:\/\/\S+$/i.test(url) ? { label: ((at >= 0 ? line.slice(0, at) : '').trim() || url).slice(0, 200), url } : null
    })
    .filter((l): l is { label: string; url: string } => !!l)
    .slice(0, 10)
const formatLinks = (links: HelpTopic['links']) => links.map((l) => `${l.label} | ${l.url}`).join('\n')

const where = (t: HelpTopic) => [t.target.viewName?.split('.').pop(), t.target.controlId ?? t.target.fallbacks[0]?.value].filter(Boolean).join(' · ')

/**
 * The help of a project: the topics written in the browser extension (one per control of the app). Here they are
 * reviewed, their texts improved, and the whole help is added to the project's own files.
 */
export default function HelpTab({ project }: { project: Project }) {
  const qc = useQueryClient()
  const sets = useQuery({ queryKey: ['help-sets', project.ID], queryFn: () => api.helpSets(project.ID) })
  const row = sets.data?.[0]
  const doc = useMemo(() => docOf(row), [row])
  const [editing, setEditing] = useState<HelpTopic | null>(null)
  const [toDelete, setToDelete] = useState<HelpTopic | null>(null)
  const [adding, setAdding] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['help-sets', project.ID] })
  const remove = useMutation({
    mutationFn: (topic: HelpTopic) => api.deleteHelpTopic(row!.ID, topic.id),
    onSuccess: () => {
      setToDelete(null)
      return refresh()
    },
  })
  const topics = doc?.topics ?? []

  return (
    <div className="stack" data-testid="help-tab">
      <div className="row spread">
        <div>
          <Title level="H4">Help</Title>
          <Text className="muted">
            Context help for the screens of the app: topics bound to controls, shown in a help panel with ? badges. Write them in the browser extension (“Write help for this app”), then add the help to your project here.
          </Text>
        </div>
        <Button design="Emphasized" disabled={!row || topics.length === 0} onClick={() => setAdding(true)} data-testid="add-help-to-project">
          Add the help to the project
        </Button>
      </div>

      {!sets.isLoading && topics.length === 0 && (
        <MessageStrip design="Information" hideCloseButton data-testid="help-empty">
          There is no help yet. Open your running app, open the TourD extension, choose this project under “Write help for this app”, point at a control and write what it is for.
        </MessageStrip>
      )}
      <ErrorStrip error={sets.error ?? remove.error} />

      {row && (
        <Text className="muted" data-testid="help-version">
          Version {row.version} · changed {formatDate(row.modifiedAt)}
        </Text>
      )}

      <div className="card" style={{ padding: 0 }}>
        <Table
          data-testid="help-table"
          onRowClick={(e) => setEditing(topics.find((t) => t.id === e.detail.row.rowKey) ?? null)}
          noData={<Text className="muted" style={{ padding: '1rem' }}>No topics yet.</Text>}
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell>Topic</TableHeaderCell>
              <TableHeaderCell>Control</TableHeaderCell>
              <TableHeaderCell>Screen</TableHeaderCell>
              <TableHeaderCell width="8rem" />
            </TableHeaderRow>
          }
        >
          {topics.map((t) => (
            <TableRow key={t.id} rowKey={t.id} interactive data-testid="help-topic-row">
              <TableCell>
                <b>{t.title}</b>
                {t.summary && <div className="muted">{t.summary}</div>}
              </TableCell>
              <TableCell>
                <span className="mono">{where(t)}</span>
                {t.meta?.controlType && <div className="muted">{t.meta.controlType.split('.').pop()}</div>}
              </TableCell>
              <TableCell>{t.meta?.screen ? <Tag colorScheme="6">{t.meta.screen}</Tag> : <span className="muted">–</span>}</TableCell>
              <TableCell>
                <Button icon="edit" design="Transparent" tooltip="Edit this topic" data-testid="edit-help-topic" onClick={(e) => (e.stopPropagation(), setEditing(t))} />
                <Button
                  icon="delete"
                  design="Transparent"
                  tooltip="Delete this topic"
                  data-testid="delete-help-topic"
                  onClick={(e) => {
                    e.stopPropagation()
                    setToDelete(t)
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
        </Table>
      </div>

      {editing && row && doc && (
        <EditDialog
          project={project}
          row={row}
          doc={doc}
          topic={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
      {row && <AddToProjectDialog open={adding} kind="help" tourID={row.ID} projectID={project.ID} flush={async () => true} onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!toDelete} title="Delete this topic" confirmText="Delete" busy={remove.isPending} onCancel={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete)}>
        {toDelete && `Delete "${toDelete.title}"? Help already added to the project's files stays there until you add the help again.`}
      </ConfirmDialog>
    </div>
  )
}

function EditDialog(props: { project: Project; row: HelpSetRow; doc: HelpDocument; topic: HelpTopic; onClose: () => void; onSaved: () => void }) {
  const t = props.topic
  const [title, setTitle] = useState(t.title)
  const [summary, setSummary] = useState(t.summary)
  const [text, setText] = useState(t.text)
  const [note, setNote] = useState(t.note)
  const [links, setLinks] = useState(formatLinks(t.links))
  const [instruction, setInstruction] = useState('')
  const [provider, setProvider] = useState('')
  const [before, setBefore] = useState<{ title: string; summary: string; text: string; note: string } | null>(null)
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers })
  const ai = (providers.data ?? []).filter((p) => p.configured && p.id !== 'rules')
  const chosen = provider || ai[0]?.id || ''

  const save = useMutation({
    mutationFn: () => {
      const next: HelpDocument = {
        ...props.doc,
        topics: props.doc.topics.map((x) => (x.id === t.id ? { ...x, title: title.trim(), summary: summary.trim(), text: text.trim(), note: note.trim(), links: parseLinks(links) } : x)),
      }
      return api.saveHelpSet(props.row.ID, JSON.stringify(next), props.row.version)
    },
    onSuccess: props.onSaved,
  })
  const improve = useMutation({
    mutationFn: () =>
      api.improveHelpTopic({
        projectID: props.project.ID,
        topic: { title, summary, text, note },
        control: { controlType: t.meta?.controlType, text: t.target.fallbacks.find((f) => f.by === 'text')?.value, viewName: t.target.viewName, localId: t.target.controlId },
        screen: t.meta?.screen,
        instruction: instruction.trim(),
        provider: chosen,
      }),
    onSuccess: (out) => {
      setBefore({ title, summary, text, note })
      setTitle(out.title)
      setSummary(out.summary)
      setText(out.text)
      setNote(out.note)
    },
  })

  return (
    <Dialog
      open
      headerText="Edit the help topic"
      onClose={props.onClose}
      data-testid="help-edit-dialog"
      footer={
        <Bar
          endContent={
            <>
              <Button design="Emphasized" disabled={!title.trim() || save.isPending} onClick={() => save.mutate()} data-testid="help-edit-save">
                Save
              </Button>
              <Button design="Transparent" onClick={props.onClose}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <div className="stack" style={{ width: 'min(42rem, 90vw)' }}>
        <ErrorStrip error={save.error ?? improve.error} />
        <Text className="muted">
          Belongs to <span className="mono">{where(t)}</span>. To point it at another control, use the browser extension.
        </Text>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          <Input style={{ flex: 1, minWidth: '14rem' }} value={instruction} placeholder="Tell the AI what you want (optional): shorter, in German..." accessibleName="Instruction for the AI" onInput={(e) => setInstruction(e.target.value)} data-testid="help-instruction" />
          <Select accessibleName="AI provider" onChange={(e) => setProvider(e.detail.selectedOption.value ?? '')} data-testid="help-provider">
            {ai.map((p) => (
              <Option key={p.id} value={p.id} selected={p.id === chosen}>
                {p.label}
              </Option>
            ))}
          </Select>
          <Button icon="ai" disabled={!chosen || improve.isPending} onClick={() => improve.mutate()} data-testid="help-improve">
            {improve.isPending ? 'Writing...' : 'Improve with AI'}
          </Button>
          {before && (
            <Button
              design="Transparent"
              onClick={() => {
                setTitle(before.title)
                setSummary(before.summary)
                setText(before.text)
                setNote(before.note)
                setBefore(null)
              }}
              data-testid="help-undo"
            >
              Undo
            </Button>
          )}
        </div>
        {!chosen && !providers.isLoading && <Text className="muted">No AI provider is configured on the server (see the README), so the text cannot be improved here.</Text>}
        <div>
          <Label showColon>Title</Label>
          <Input style={{ width: '100%' }} value={title} accessibleName="Title" onInput={(e) => setTitle(e.target.value)} data-testid="help-edit-title" />
        </div>
        <div>
          <Label showColon>Short description</Label>
          <Input style={{ width: '100%' }} value={summary} accessibleName="Short description" onInput={(e) => setSummary(e.target.value)} />
        </div>
        <div>
          <Label showColon>Text</Label>
          <TextArea style={{ width: '100%' }} rows={5} value={text} accessibleName="Text" onInput={(e) => setText(e.target.value)} data-testid="help-edit-text" />
        </div>
        <div>
          <Label showColon>Note</Label>
          <TextArea style={{ width: '100%' }} rows={2} value={note} accessibleName="Note" onInput={(e) => setNote(e.target.value)} />
        </div>
        <div>
          <Label showColon>Related links (one per line: Label | https://...)</Label>
          <TextArea style={{ width: '100%' }} rows={2} value={links} accessibleName="Related links" onInput={(e) => setLinks(e.target.value)} />
        </div>
        <div className="card" style={{ padding: '0.75rem' }} data-testid="help-edit-preview">
          <b>{title || 'Title'}</b>
          <Markdown text={text} />
          {note && (
            <div style={{ borderLeft: '0.375rem solid var(--sapHighlightColor)', background: 'var(--sapShell_Background)', padding: '0.5rem 0.75rem' }}>
              <b>Note</b>
              <Markdown text={note} />
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
