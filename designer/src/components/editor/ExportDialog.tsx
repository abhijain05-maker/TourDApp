import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BusyIndicator, Button, Dialog, MessageStrip, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/download.js'
import '@ui5/webcomponents-icons/dist/copy.js'
import { api } from '../../api'
import type { TourDocument } from '../../types'
import { ErrorStrip } from '../common'

function download(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Hands over the bundle (player + tour + the few lines that connect them to the app). The server decides
 * whether the saved tour is fit to ship; a tour with problems can still be downloaded, on purpose.
 */
export default function ExportDialog(props: {
  open: boolean
  tourID: string
  doc: TourDocument
  valid: boolean
  flush: () => Promise<boolean>
  onClose: () => void
  onJump: (stepId: string) => void
}) {
  const { open, tourID } = props
  const [ready, setReady] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')

  // the check looks at the saved tour: save the working copy first
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setCopied('idle')
    if (open) props.flush().then(() => !cancelled && setReady(true))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const check = useQuery({ queryKey: ['export-check', tourID, ready], queryFn: () => api.exportCheck(tourID), enabled: open && ready, retry: false, staleTime: 0, gcTime: 0 })
  const data = check.data

  return (
    <Dialog
      open={open}
      headerText="Export the tour"
      onClose={props.onClose}
      data-testid="export-dialog"
      footer={
        <Bar
          endContent={
            <>
              <Button
                icon="download"
                design="Emphasized"
                disabled={!data?.ok}
                onClick={() => download(`/export/${tourID}.zip`)}
                data-testid="export-download"
              >
                Download bundle
              </Button>
              {data && !data.ok && (
                <Button design="Negative" onClick={() => download(`/export/${tourID}.zip?force=1`)} data-testid="export-force">
                  Download anyway
                </Button>
              )}
              <Button
                icon="copy"
                design="Transparent"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(props.doc, null, 2))
                    setCopied('done')
                  } catch {
                    setCopied('failed')
                  }
                }}
                data-testid="export-copy-json"
              >
                Copy tour.json
              </Button>
              <Button design="Transparent" onClick={props.onClose}>
                Close
              </Button>
            </>
          }
        />
      }
    >
      <div className="stack" style={{ width: 'min(40rem, 85vw)' }}>
        {(!ready || check.isLoading) && <BusyIndicator active data-testid="export-loading" />}
        <ErrorStrip error={check.error} />
        {!props.valid && (
          <MessageStrip design="Critical" hideCloseButton data-testid="export-unsaved">
            The tour you are editing has problems and could not be saved, so this is about the last saved version.
          </MessageStrip>
        )}
        {data?.ok && (
          <MessageStrip design="Positive" hideCloseButton data-testid="export-ready">
            Ready to export (version {data.version} of this tour).
          </MessageStrip>
        )}
        {data && !data.ok && (
          <>
            <MessageStrip design="Negative" hideCloseButton data-testid="export-blocked">
              {data.blocking.length} problem(s) must be fixed before this tour goes into an app. Click one to jump to its step.
            </MessageStrip>
            {data.blocking.map((p, i) => (
              <MessageStrip
                key={i}
                design="Negative"
                hideCloseButton
                data-testid="export-blocking"
                onClick={() => {
                  if (p.stepId) {
                    props.onJump(p.stepId)
                    props.onClose()
                  }
                }}
              >
                {p.message}
              </MessageStrip>
            ))}
          </>
        )}
        {data?.warnings.map((w, i) => (
          <MessageStrip key={i} design="Critical" hideCloseButton data-testid="export-warning">
            {w.message}
          </MessageStrip>
        ))}
        {data && (
          <>
            <Text>
              The zip <b>{data.filename}</b> contains the player, <code>tour.json</code>, the snippets that connect them to your app and a README with the steps.
            </Text>
            <Text className="muted" data-testid="export-files">
              {data.files.join(' · ')}
            </Text>
          </>
        )}
        {copied === 'done' && <Text data-testid="export-copied">tour.json copied.</Text>}
        {copied === 'failed' && <Text>Your browser did not allow copying. Use the JSON tab instead.</Text>}
      </div>
    </Dialog>
  )
}
