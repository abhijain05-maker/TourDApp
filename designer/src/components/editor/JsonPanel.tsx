import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { linter, lintGutter } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import type { TourDocument } from '../../types'
import { validateTour } from '../../../../shared/tour-schema.mjs'
import { diagnose } from '../../editor/diagnose'

const pretty = (doc: TourDocument) => JSON.stringify(doc, null, 2)

const jsonLinter = linter((view) => diagnose(view.state.doc.toString()), { delay: 150 })

// The UI5 components manage document.adoptedStyleSheets themselves, which drops CodeMirror's stylesheet
// there; inside its own shadow root the editor keeps its styles (and does not inherit the tab's bold font).
const look = EditorView.theme({
  '&': { fontSize: '13px', fontWeight: 'normal', backgroundColor: '#fff' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-gutters': { backgroundColor: '#f5f6f7' },
})

/**
 * The tour as JSON: edits that form a valid tour are applied immediately, everything else stays in the
 * editor with its errors marked. Form edits flow back into the text.
 */
export default function JsonPanel({ doc, onCommit }: { doc: TourDocument; onCommit: (doc: TourDocument) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [shadow, setShadow] = useState<ShadowRoot | null>(null)
  const [text, setText] = useState(() => pretty(doc))
  const fromEditor = useRef(false)
  const extensions = useMemo(() => [json(), jsonLinter, lintGutter(), EditorView.lineWrapping, look], [])

  useEffect(() => {
    if (host.current) setShadow(host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' }))
  }, [])

  useEffect(() => {
    if (fromEditor.current) {
      fromEditor.current = false
      return
    }
    setText(pretty(doc))
  }, [doc])

  return (
    <div ref={host} data-testid="json-panel" style={{ minHeight: '30rem' }}>
      {shadow &&
        createPortal(
          <CodeMirror
            root={shadow}
            value={text}
            height="30rem"
            extensions={extensions}
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
            onChange={(value) => {
              setText(value)
              let parsed: unknown
              try {
                parsed = JSON.parse(value)
              } catch {
                return // syntax errors are shown by the linter; the working copy stays as it was
              }
              const result = validateTour(parsed)
              if (result.ok && JSON.stringify(result.tour) !== JSON.stringify(doc)) {
                fromEditor.current = true
                onCommit(result.tour)
              }
            }}
          />,
          shadow,
        )}
    </div>
  )
}
