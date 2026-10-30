import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bar, BusyIndicator, Button, Dialog, Table, TableCell, TableHeaderCell, TableHeaderRow, TableRow, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/undo.js'
import { api } from '../../api'
import type { TourRow } from '../../types'
import { formatDate } from '../../format'
import { ErrorStrip, Tag } from '../common'

/** Every saved version of the tour; restoring one adds it as a new version, so nothing is ever lost. */
export default function HistoryDialog(props: {
  open: boolean
  tourID: string
  currentVersion: number
  flush: () => Promise<boolean>
  onClose: () => void
  onRestored: (row: TourRow) => void
}) {
  const versions = useQuery({ queryKey: ['versions', props.tourID], queryFn: () => api.versions(props.tourID), enabled: props.open })
  const [busyVersion, setBusyVersion] = useState<number | null>(null)
  const restore = useMutation({
    mutationFn: async (version: number) => {
      setBusyVersion(version)
      await props.flush() // never restore over unsaved work
      return api.restoreVersion(props.tourID, version)
    },
    onSuccess: (row) => props.onRestored(row),
    onSettled: () => setBusyVersion(null),
  })

  return (
    <Dialog
      open={props.open}
      headerText="Version history"
      onClose={props.onClose}
      data-testid="history-dialog"
      footer={<Bar endContent={<Button onClick={props.onClose}>Close</Button>} />}
    >
      <div className="stack" style={{ width: 'min(44rem, 85vw)' }}>
        <ErrorStrip error={versions.error ?? restore.error} />
        {versions.isLoading && <BusyIndicator active />}
        <Table
          headerRow={
            <TableHeaderRow>
              <TableHeaderCell width="5rem">Version</TableHeaderCell>
              <TableHeaderCell>What happened</TableHeaderCell>
              <TableHeaderCell width="11rem">When</TableHeaderCell>
              <TableHeaderCell width="8rem" />
            </TableHeaderRow>
          }
        >
          {(versions.data ?? []).map((v) => (
            <TableRow key={v.ID} data-testid="version-row">
              <TableCell>
                v{v.version} {v.version === props.currentVersion && <Tag colorScheme="8">current</Tag>}
              </TableCell>
              <TableCell>
                <Text>{v.note ?? 'Edited'}</Text>
              </TableCell>
              <TableCell>{formatDate(v.createdAt)}</TableCell>
              <TableCell>
                {v.version !== props.currentVersion && (
                  <Button icon="undo" design="Transparent" disabled={restore.isPending} onClick={() => restore.mutate(v.version)} data-testid="version-restore">
                    {busyVersion === v.version ? 'Restoring…' : 'Restore'}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </Table>
      </div>
    </Dialog>
  )
}
