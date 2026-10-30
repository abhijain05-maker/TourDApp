import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView, ViewPlugin, keymap } from '@codemirror/view'
import { Prec, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from '../shell/theme'

/**
 * The look of the editor follows the colours of the page (UI5 theme variables reach into the shadow root), so light
 * and dark need no second stylesheet; only the colours of the syntax come from a theme.
 */
const look = EditorView.theme({
  '&': {
    fontSize: '13px',
    fontWeight: 'normal',
    height: '100%',
    backgroundColor: 'var(--sapList_Background, #fff)',
    color: 'var(--sapTextColor, #1d2d3e)',
  },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-gutters': {
    backgroundColor: 'var(--sapShell_Background, #f5f6f7)',
    color: 'var(--sapContent_LabelColor, #556b82)',
    border: 'none',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--sapList_Hover_Background, rgba(10,110,209,.06))' },
  '.cm-cursor': { borderLeftColor: 'var(--sapTextColor, #1d2d3e)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--sapList_SelectionBackgroundColor, #cfe6ff) !important',
  },
})

/** A scrolling area must be reachable with the keyboard, also when the file is too short to need it. */
const focusableScroller = ViewPlugin.define((view) => {
  view.scrollDOM.tabIndex = 0
  return {}
})

export interface EditorProps {
  path: string
  value: string
  readOnly?: boolean
  language: Extension[]
  onChange?: (value: string) => void
  onSave?: () => void
}

/**
 * CodeMirror inside its own shadow root: the UI5 components manage document.adoptedStyleSheets themselves, which
 * would drop CodeMirror's stylesheet; in a shadow root it keeps it (and does not inherit the tab's bold font).
 */
export default function ShadowEditor({ path, value, readOnly, language, onChange, onSave }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const [shadow, setShadow] = useState<ShadowRoot | null>(null)
  const { resolved } = useTheme()
  const save = useRef(onSave)
  save.current = onSave

  useEffect(() => {
    if (host.current) setShadow(host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' }))
  }, [])

  const extensions = useMemo<Extension[]>(
    () => [
      ...language,
      look,
      EditorView.lineWrapping,
      focusableScroller,
      EditorView.contentAttributes.of({ 'aria-label': `Code of ${path}`, 'aria-multiline': 'true' }),
      // Ctrl+S saves the file, not the page
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              save.current?.()
              return true
            },
          },
        ]),
      ),
      ...(resolved === 'dark' ? [oneDark] : []),
    ],
    [language, resolved, path],
  )

  return (
    <div ref={host} className="code-host" data-testid="code-editor" data-path={path}>
      {shadow &&
        createPortal(
          <CodeMirror
            key={path}
            root={shadow}
            value={value}
            height="100%"
            style={{ height: '100%' }}
            readOnly={readOnly}
            editable={!readOnly}
            extensions={extensions}
            theme="none"
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, searchKeymap: true }}
            onChange={(v) => onChange?.(v)}
          />,
          shadow,
        )}
    </div>
  )
}
