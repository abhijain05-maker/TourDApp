import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, MessageStrip, Text, TextArea, Title } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/copy.js'
import playerSource from '../../../../player/TourPlayer.js?raw'
import { buildInlineSnippet, buildLoaderSnippet, toBookmarklet } from '../../../../shared/live-snippet.mjs'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import type { TourDocument } from '../../types'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyButton(props: { text: string; disabled?: boolean; label: string; testid: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <>
      <Button
        icon="copy"
        design="Emphasized"
        disabled={props.disabled}
        onClick={async () => {
          setState((await copyText(props.text)) ? 'copied' : 'failed')
          setTimeout(() => setState('idle'), 3000)
        }}
        data-testid={props.testid}
      >
        {props.label}
      </Button>
      {state === 'copied' && <Text data-testid={`${props.testid}-done`}>Copied</Text>}
      {state === 'failed' && <Text>Your browser did not allow copying. Select the text below and copy it.</Text>}
    </>
  )
}

/** Ways to see the tour in the real, running app instead of the sandbox. */
export default function LivePanel(props: { tourID: string; doc: TourDocument; valid: boolean; saved: boolean }) {
  const { doc, valid } = props
  const inline = useMemo(() => (valid ? buildInlineSnippet({ playerSource, tour: doc }) : ''), [doc, valid])
  // behind a login the snippet cannot log in: it carries a link token that is good for some hours
  const token = useQuery({ queryKey: ['capability', 'live', props.tourID], queryFn: () => api.capability('live', props.tourID), staleTime: 60 * 60 * 1000 })
  const loader = useMemo(() => buildLoaderSnippet({ origin: window.location.origin, tourId: props.tourID, token: token.data ?? '' }), [props.tourID, token.data])
  const link = useRef<HTMLAnchorElement>(null)

  // React refuses javascript: URLs as an attribute, and a bookmarklet is exactly that
  useEffect(() => {
    if (link.current) link.current.setAttribute('href', inline ? toBookmarklet(inline) : '#')
  }, [inline])

  const kb = Math.round(inline.length / 1024)
  return (
    <div className="tab-content stack" data-testid="live-panel">
      <Text>Play this tour inside your own app while it is running, with its real data and controllers. Nothing in the app is changed or saved.</Text>
      {!valid && (
        <MessageStrip design="Critical" hideCloseButton data-testid="live-invalid">
          The tour has problems (see Checks). Fix them to get the snippet.
        </MessageStrip>
      )}

      <section className="live-step">
        <Title level="H5">1. Paste it into the console</Title>
        <ol>
          <li>Open your app in Chrome or Edge.</li>
          <li>Press F12 and open the Console tab.</li>
          <li>Paste the snippet and press Enter.</li>
        </ol>
        <div className="row">
          <CopyButton text={inline} disabled={!valid} label="Copy snippet" testid="live-copy" />
        </div>
        <TextArea value={inline} readonly rows={5} style={{ width: '100%' }} accessibleName="Snippet" data-testid="live-snippet" />
        <Text className="muted">
          About {kb} kB. It contains the player and this tour (including unsaved changes) and needs no connection to TourD.
        </Text>
      </section>

      <section className="live-step">
        <Title level="H5">2. Or keep it as a bookmark</Title>
        <Text>
          Drag this link to your bookmarks bar, open your app and click the bookmark.{' '}
          <a ref={link} href="#" onClick={(e) => e.preventDefault()} data-testid="live-bookmarklet">
            TourD: {doc.title}
          </a>
        </Text>
        <Text className="muted">The bookmark holds this version of the tour; make a new one after you change it.</Text>
      </section>

      <section className="live-step">
        <Title level="H5">3. Or load the saved tour from TourD</Title>
        <div className="row">
          <CopyButton text={loader} label="Copy loader snippet" testid="live-copy-loader" />
        </div>
        <TextArea value={loader} readonly rows={4} style={{ width: '100%' }} accessibleName="Loader snippet" data-testid="live-loader" />
        <Text className="muted">
          A short snippet that fetches the player and the <b>saved</b> tour from {window.location.origin}
          {props.saved ? '' : ' (you have unsaved changes; they are not included)'}. Your app must be allowed to load scripts from there:
          a strict Content-Security-Policy, an https page talking to an http server, or Chrome&apos;s local-network permission prompt can block it.
          If it does, use option 1.
        </Text>
      </section>
    </div>
  )
}
