import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from '../shell/theme'

const look = EditorView.theme({
  '&': {
    fontSize: '13px',
    backgroundColor: 'var(--sapList_Background, #fff)',
    color: 'var(--sapTextColor, #1d2d3e)',
  },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  '.cm-gutters': {
    backgroundColor: 'var(--sapShell_Background, #f5f6f7)',
    color: 'var(--sapContent_LabelColor, #556b82)',
    border: 'none',
  },
})

/** The uploaded copy of a file next to its working copy, with the differences marked. Read only. */
export default function DiffView(props: { before: string; after: string; language: Extension[]; beforeLabel?: string; afterLabel?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()

  useEffect(() => {
    if (!host.current) return
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' })
    const mount = document.createElement('div')
    mount.style.height = '100%'
    root.replaceChildren(mount)
    const extensions = [
      ...props.language,
      look,
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      ...(resolved === 'dark' ? [oneDark] : []),
    ]
    const view = new MergeView({
      a: { doc: props.before, extensions },
      b: { doc: props.after, extensions },
      parent: mount,
      root,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    })
    return () => view.destroy()
  }, [props.before, props.after, props.language, resolved])

  return (
    <div className="diff-wrap" data-testid="diff-view">
      <div className="diff-heads">
        <span>{props.beforeLabel ?? 'Uploaded'}</span>
        <span>{props.afterLabel ?? 'Now'}</span>
      </div>
      <div ref={host} className="code-host" />
    </div>
  )
}
