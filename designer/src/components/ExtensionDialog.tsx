import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, Button, Dialog, Input, Label, MessageStrip, Table, TableCell, TableHeaderCell, TableHeaderRow, TableRow, Text, Title } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/copy.js'
import '@ui5/webcomponents-icons/dist/delete.js'
import { api } from '../api'
import { formatDate } from '../format'
import { ErrorStrip, Tag } from './common'

/** Pairs a browser extension with TourD: shows how to install it, creates its token, lists and revokes tokens. */
export default function ExtensionDialog(props: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const tokens = useQuery({ queryKey: ['extension-tokens'], queryFn: api.extensionTokens, enabled: props.open })
  const [name, setName] = useState('')
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const [snippet, setSnippet] = useState<'idle' | 'done' | 'failed'>('idle')

  const create = useMutation({
    mutationFn: () => api.createExtensionToken(name.trim()),
    onSuccess: async (row) => {
      setCreated({ name: row.name, token: row.token })
      setCopied('idle')
      setName('')
      await qc.invalidateQueries({ queryKey: ['extension-tokens'] })
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeExtensionToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['extension-tokens'] }),
  })

  const close = () => {
    setCreated(null) // the token is not shown again once the dialog is closed
    props.onClose()
  }

  return (
    <Dialog
      open={props.open}
      headerText="Browser extension"
      onClose={close}
      data-testid="extension-dialog"
      footer={<Bar endContent={<Button onClick={close}>Close</Button>} />}
    >
      <div className="stack" style={{ width: 'min(46rem, 88vw)' }}>
        <Text>
          The TourD Recorder extension records what you do in your UI5 app, exactly as UI5 sees it, and sends it here. It needs to be paired once:
        </Text>
        <ol className="steps-list">
          <li>
            In Chrome or Edge open <b>chrome://extensions</b> (or <b>edge://extensions</b>), switch on <b>Developer mode</b>, choose <b>Load unpacked</b> and select the <b>extension</b> folder of TourD (run <code>npm run build:extension</code> first).
          </li>
          <li>Create a token for this browser below and copy it.</li>
          <li>Click the extension, open its settings (the gear), enter this address and paste the token.</li>
        </ol>

        <ErrorStrip error={create.error ?? revoke.error ?? tokens.error} />

        <div>
          <Label for="token-name">Name of this browser or computer</Label>
          <div className="row">
            <Input id="token-name" style={{ flex: 1 }} value={name} placeholder="e.g. My laptop" onInput={(e) => setName(e.target.value)} data-testid="token-name" />
            <Button design="Emphasized" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()} data-testid="token-create">
              Create token
            </Button>
          </div>
        </div>

        {created && (
          <MessageStrip design="Positive" hideCloseButton data-testid="token-created">
            <div className="stack">
              <span>
                Token for <b>{created.name}</b>. Copy it now: it is not shown again.
              </span>
              <code className="mono" data-testid="token-value" style={{ wordBreak: 'break-all' }}>
                {created.token}
              </code>
              <div className="row">
                <Button
                  icon="copy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(created.token)
                      setCopied('done')
                    } catch {
                      setCopied('failed')
                    }
                  }}
                  data-testid="token-copy"
                >
                  Copy
                </Button>
                {copied === 'done' && <Text>Copied</Text>}
                {copied === 'failed' && <Text>Your browser did not allow copying; select the text above.</Text>}
              </div>
            </div>
          </MessageStrip>
        )}

        <Title level="H6">Paired browsers</Title>
        {tokens.data && tokens.data.length === 0 && <Text className="muted">None yet.</Text>}
        {tokens.data && tokens.data.length > 0 && (
          <Table
            headerRow={
              <TableHeaderRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell width="8rem">Token</TableHeaderCell>
                <TableHeaderCell width="11rem">Created</TableHeaderCell>
                <TableHeaderCell width="11rem">Last used</TableHeaderCell>
                <TableHeaderCell width="7rem" />
              </TableHeaderRow>
            }
          >
            {tokens.data.map((t) => (
              <TableRow key={t.ID} data-testid="token-row">
                <TableCell>
                  {t.name} {t.revoked && <Tag colorScheme="2">revoked</Tag>}
                </TableCell>
                <TableCell>
                  <span className="mono muted">{t.prefix}…</span>
                </TableCell>
                <TableCell>{formatDate(t.createdAt)}</TableCell>
                <TableCell>{t.lastUsedAt ? formatDate(t.lastUsedAt) : 'never'}</TableCell>
                <TableCell>
                  {!t.revoked && (
                    <Button design="Transparent" icon="delete" onClick={() => revoke.mutate(t.ID)} data-testid="token-revoke">
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}

        <Title level="H6">No extension?</Title>
        <Text>
          Copy the recorder as a console snippet, paste it into the console (F12) of your running app, use the app, then run <code>__tourdRecorder.stop(); __tourdRecorder.download()</code> and import the file under Recordings.
        </Text>
        <div className="row">
          <Button
            icon="copy"
            onClick={async () => {
              try {
                const [{ default: recorderSource }, { buildRecorderSnippet }] = await Promise.all([
                  import('../../../recorder/recorder.js?raw'),
                  import('../../../shared/live-snippet.mjs'),
                ])
                await navigator.clipboard.writeText(buildRecorderSnippet({ recorderSource }))
                setSnippet('done')
              } catch {
                setSnippet('failed')
              }
            }}
            data-testid="snippet-copy"
          >
            Copy console snippet
          </Button>
          {snippet === 'done' && <Text data-testid="snippet-copied">Copied</Text>}
          {snippet === 'failed' && <Text>Your browser did not allow copying.</Text>}
        </div>
      </div>
    </Dialog>
  )
}
