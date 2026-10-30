import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bar,
  BusyIndicator,
  Button,
  Dialog,
  IllustratedMessage,
  Input,
  Label,
  Table,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  Text,
  Title,
} from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/add.js'
import '@ui5/webcomponents-icons/dist/delete.js'
import '@ui5/webcomponents-fiori/dist/illustrations/NoData.js'
import { api } from '../api'
import type { Project } from '../types'
import { ConfirmDialog, ErrorStrip, Tag } from '../components/common'
import { formatDate } from '../format'

const STATUS: Record<Project['parseStatus'], { text: string; color: '8' | '6' | '2' }> = {
  empty: { text: 'No sources yet', color: '8' },
  ok: { text: 'Ready', color: '6' },
  warnings: { text: 'Ready, with warnings', color: '2' },
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const [params, setParams] = useSearchParams()
  // the command palette opens this page with ?new=1
  const [manual, setManual] = useState(false)
  const creating = manual || params.get('new') === '1'
  const setCreating = (open: boolean) => {
    setManual(open)
    if (!open && params.has('new')) setParams({}, { replace: true })
  }
  const [toDelete, setToDelete] = useState<Project | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      setToDelete(null)
      return qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  return (
    <div className="page" data-testid="projects-page">
      <div className="row spread" style={{ margin: '1rem 0' }}>
        <Title level="H2">Projects</Title>
        <Button design="Emphasized" icon="add" onClick={() => setCreating(true)} data-testid="new-project">
          New project
        </Button>
      </div>

      <ErrorStrip error={projects.error ?? remove.error} />
      {projects.isLoading && <BusyIndicator active />}

      {projects.data && (
        <div className="card" style={{ padding: 0 }}>
          <Table
            data-testid="projects-table"
            onRowClick={(e) => navigate(`/projects/${e.detail.row.rowKey}`)}
            noData={
              <IllustratedMessage name="NoData" titleText="No projects yet" subtitleText="Create a project, then upload your UI5 app." />
            }
            headerRow={
              <TableHeaderRow sticky>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>App</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell width="4rem" />
              </TableHeaderRow>
            }
          >
            {projects.data.map((p) => (
              <TableRow key={p.ID} rowKey={p.ID} interactive data-testid="project-row">
                <TableCell>
                  <div>
                    <Text style={{ fontWeight: 'bold' }}>{p.name}</Text>
                    {p.description && <div className="muted">{p.description}</div>}
                  </div>
                </TableCell>
                <TableCell>{p.appId ?? '–'}</TableCell>
                <TableCell>
                  <Tag colorScheme={STATUS[p.parseStatus].color}>{STATUS[p.parseStatus].text}</Tag>
                </TableCell>
                <TableCell>{formatDate(p.createdAt)}</TableCell>
                <TableCell>
                  <Button
                    icon="delete"
                    design="Transparent"
                    tooltip="Delete project"
                    data-testid="delete-project"
                    onClick={(e) => {
                      e.stopPropagation()
                      setToDelete(p)
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </Table>
        </div>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/projects/${id}`)} />

      <ConfirmDialog
        open={!!toDelete}
        title="Delete project"
        confirmText="Delete"
        busy={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.ID)}
      >
        {toDelete && `Delete "${toDelete.name}" with all its files, recordings and tours? This cannot be undone.`}
      </ConfirmDialog>
    </div>
  )
}

function NewProjectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useMutation({
    mutationFn: () => api.createProject(name.trim(), description.trim()),
    onSuccess: async (project) => {
      await qc.invalidateQueries({ queryKey: ['projects'] })
      setName('')
      setDescription('')
      onClose()
      onCreated(project.ID)
    },
  })
  return (
    <Dialog
      open={open}
      headerText="New project"
      onClose={onClose}
      data-testid="new-project-dialog"
      footer={
        <Bar
          endContent={
            <>
              <Button design="Emphasized" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()} data-testid="create-project">
                Create
              </Button>
              <Button design="Transparent" onClick={onClose}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <div className="stack" style={{ minWidth: '22rem' }}>
        <ErrorStrip error={create.error} />
        <div>
          <Label required for="project-name">
            Name
          </Label>
          <Input id="project-name" style={{ width: '100%' }} value={name} onInput={(e) => setName(e.target.value)} data-testid="project-name" />
        </div>
        <div>
          <Label for="project-description">Description</Label>
          <Input id="project-description" style={{ width: '100%' }} value={description} onInput={(e) => setDescription(e.target.value)} />
        </div>
      </div>
    </Dialog>
  )
}
