import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, MessageStrip, Table, TableCell, TableHeaderCell, TableHeaderRow, TableRow, Text, Title } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/ai.js'
import '@ui5/webcomponents-icons/dist/delete.js'
import { api } from '../api'
import type { Project, TourRow } from '../types'
import { ConfirmDialog, ErrorStrip, GeneratorTag, Tag } from './common'
import { formatDate } from '../format'
import GenerateDialog from './GenerateDialog'

export default function ToursTab({ project, onNeedRecording }: { project: Project; onNeedRecording: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [toDelete, setToDelete] = useState<TourRow | null>(null)

  const tours = useQuery({ queryKey: ['tours', project.ID], queryFn: () => api.tours(project.ID) })
  const recordings = useQuery({ queryKey: ['recordings', project.ID], queryFn: () => api.recordings(project.ID) })
  const lints = useQueries({
    queries: (tours.data ?? []).map((t) => ({ queryKey: ['lint', t.ID, t.version], queryFn: () => api.lintTour(t.ID) })),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTour(id),
    onSuccess: () => {
      setToDelete(null)
      return qc.invalidateQueries({ queryKey: ['tours', project.ID] })
    },
  })

  const noRecording = (recordings.data ?? []).length === 0
  return (
    <div className="stack" data-testid="tours-tab">
      <div className="row spread">
        <div>
          <Title level="H4">Tours</Title>
          <Text className="muted">Generate a tour from a recording, then refine it in the editor.</Text>
        </div>
        <Button design="Emphasized" icon="ai" disabled={noRecording} onClick={() => setGenerating(true)} data-testid="generate-tour">
          Generate tour
        </Button>
      </div>

      {noRecording && !recordings.isLoading && (
        <MessageStrip design="Information" hideCloseButton data-testid="need-recording">
          You need a recording first. <a href="#" onClick={(e) => (e.preventDefault(), onNeedRecording())}>Import one</a>.
        </MessageStrip>
      )}
      <ErrorStrip error={tours.error ?? remove.error} />

      <div className="card" style={{ padding: 0 }}>
        <Table
          data-testid="tours-table"
          onRowClick={(e) => navigate(`/tours/${e.detail.row.rowKey}`)}
          noData={<Text className="muted" style={{ padding: '1rem' }}>No tours yet.</Text>}
          headerRow={
            <TableHeaderRow sticky>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell width="6rem">Version</TableHeaderCell>
              <TableHeaderCell>Created by</TableHeaderCell>
              <TableHeaderCell>Checks</TableHeaderCell>
              <TableHeaderCell>Changed</TableHeaderCell>
              <TableHeaderCell width="4rem" />
            </TableHeaderRow>
          }
        >
          {(tours.data ?? []).map((t, i) => {
            const lint = lints[i]?.data
            return (
              <TableRow key={t.ID} rowKey={t.ID} interactive data-testid="tour-row">
                <TableCell>
                  <b>{t.name}</b>
                </TableCell>
                <TableCell>v{t.version}</TableCell>
                <TableCell>
                  <div className="row" style={{ gap: '0.4rem' }}>
                    <GeneratorTag generator={t.generator} />
                    {t.model && <span className="muted">{t.model}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  {!lint ? (
                    '…'
                  ) : lint.errors + lint.warnings === 0 ? (
                    <Tag colorScheme="8">no problems</Tag>
                  ) : (
                    <div className="row" style={{ gap: '0.4rem' }}>
                      {lint.errors > 0 && <Tag colorScheme="1">{lint.errors} error(s)</Tag>}
                      {lint.warnings > 0 && <Tag colorScheme="2">{lint.warnings} warning(s)</Tag>}
                    </div>
                  )}
                </TableCell>
                <TableCell>{formatDate(t.modifiedAt)}</TableCell>
                <TableCell>
                  <Button
                    icon="delete"
                    design="Transparent"
                    tooltip="Delete tour"
                    data-testid="delete-tour"
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

      <GenerateDialog
        open={generating}
        project={project}
        recordings={recordings.data ?? []}
        onClose={() => {
          setGenerating(false)
          void qc.invalidateQueries({ queryKey: ['tours', project.ID] })
        }}
        onDone={(tourID) => {
          setGenerating(false)
          void qc.invalidateQueries({ queryKey: ['tours', project.ID] })
          navigate(`/tours/${tourID}`)
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Delete tour"
        confirmText="Delete"
        busy={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.ID)}
      >
        {toDelete && `Delete "${toDelete.name}" with its version history?`}
      </ConfirmDialog>
    </div>
  )
}
