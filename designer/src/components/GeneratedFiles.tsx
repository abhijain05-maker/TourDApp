import { lazy, Suspense, useMemo, useState } from 'react'
import { BusyIndicator, Icon, MessageStrip, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/source-code.js'
import '@ui5/webcomponents-icons/dist/accept.js'
import '@ui5/webcomponents-icons/dist/command-line-interfaces.js'
import '@ui5/webcomponents-icons/dist/document-text.js'
import { CollapsibleCard } from './common'
import type { ApplyEdit } from '../types'
import type { Wdi5Settings } from '../../../shared/wdi5-plan.mjs'
import { languageFor } from '../workspace/language'

const ShadowEditor = lazy(() => import('../workspace/ShadowEditor'))

/** What will be written, as code, and how to run it. Read only: the files are changed after they are added. */
export default function GeneratedFiles(props: { edits: ApplyEdit[]; settings: Wdi5Settings; existing: boolean; blocked?: string | null }) {
  const [shown, setShown] = useState<string | null>(null)
  const current = props.edits.find((e) => e.path === shown) ?? props.edits.find((e) => /\.test\.js$|\.spec\.js$/.test(e.path)) ?? props.edits[0]
  const language = useMemo(() => languageFor(current?.path ?? ''), [current?.path])
  const withEnv = props.settings.auth !== 'none'
  return (
    <CollapsibleCard
      defaultOpen
      icon="source-code"
      title="The generated files"
      subtitle="What will be written into your project, as code. Read only: the files change after you add them."
      style={{ marginTop: '1rem' }}
      testid="plan-files"
    >
      {props.blocked && (
        <MessageStrip design="Critical" hideCloseButton>
          {props.blocked}
        </MessageStrip>
      )}
      {current && (
        <div className="files-preview">
          <div role="group" aria-label="Files" className="files-tabs">
            {props.edits.map((e) => (
              <button key={e.path} className={e.path === current.path ? 'active' : ''} aria-current={e.path === current.path ? 'true' : undefined} onClick={() => setShown(e.path)} title={e.what} data-testid="file-tab">
                <Icon name="document-text" aria-hidden="true" />
                <span className="file-name">{e.path.split('/').pop()}</span>
                <small className={e.action === 'add' ? 'file-new' : 'file-changed'}>{e.action === 'add' ? 'new' : 'changed'}</small>
              </button>
            ))}
          </div>
          <div className="files-code">
            <div className="files-code-head">
              <span className="mono">{current.path}</span>
              <span className="muted">{current.what}</span>
            </div>
            <div style={{ height: '22rem' }}>
              <Suspense fallback={<BusyIndicator active style={{ margin: '1rem' }} />}>
                <ShadowEditor path={current.path} value={current.after} readOnly language={language} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
      {!current && !props.blocked && (
        <div className="files-empty">
          <span className="changes-empty-icon" aria-hidden="true">
            <Icon name="accept" />
          </span>
          <span>
            <b>Everything is in the project already</b>
            <span className="muted">No file has to be added or changed.</span>
          </span>
        </div>
      )}

      <div data-testid="run-box">
        <div className="run-head">
          <Icon name="command-line-interfaces" aria-hidden="true" />
          <b>How to run it</b>
        </div>
        <ol className="run-steps">
          <li>
            Start your app so that it answers at <code className="mono">{props.settings.baseUrl}</code>
            {props.existing ? '' : ' (or put BASE_URL in .env)'}.
          </li>
          <li>
            <code className="mono">npm install</code>
          </li>
          <li>
            <code className="mono">npx wdio run wdio.conf.js</code> {props.existing ? '(or the script your project has for it)' : 'or `npm run wdi5:headless`'}
          </li>
          {withEnv && (
            <li>
              Set <code className="mono">wdi5_username</code> and <code className="mono">wdi5_password</code> in the environment or in <code className="mono">.env</code>.
            </li>
          )}
        </ol>
        <Text className="muted">
          QuickDev does not run the tests: your machine or your pipeline does. To see them run in the app you have open, use <b>Replay</b> in the browser extension.
        </Text>
      </div>
    </CollapsibleCard>
  )
}
