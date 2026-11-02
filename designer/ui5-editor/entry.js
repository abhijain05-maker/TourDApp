// CodeMirror 6 for the SAPUI5 designer (app/designer-ui5). Built into one ES module (npm run build:ui5-editor) that the UI5
// controls tourd.designer.control.CodeEditor / DiffEditor load on demand. No framework here: plain functions around EditorView.
// The look is the same as in the React designer (src/workspace/ShadowEditor.tsx): the colours come from the UI5 theme variables.
import { basicSetup } from 'codemirror'
import { EditorView, ViewPlugin, keymap } from '@codemirror/view'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { linter, lintGutter } from '@codemirror/lint'
import { MergeView } from '@codemirror/merge'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { diagnose } from '../src/editor/diagnose'

/** Highlighting for a file, chosen by its name. Unknown kinds are plain text. */
export function languageFor(path) {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'json':
    case 'jsonc':
      return [json()]
    case 'xml':
    case 'svg':
      return [xml()]
    case 'html':
    case 'htm':
      return [html()]
    case 'css':
      return [css()]
    case 'md':
      return [markdown()]
    case 'yaml':
    case 'yml':
      return [yaml()]
    case 'properties':
      return [StreamLanguage.define(properties)]
    default:
      return []
  }
}

const NAMES = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', json: 'JSON', xml: 'XML', html: 'HTML',
  css: 'CSS', md: 'Markdown', yaml: 'YAML', yml: 'YAML', properties: 'Properties', svg: 'SVG',
}

/** Short, human name of the language (shown in a status line). */
export const languageName = (path) => NAMES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'Plain text'

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

/** The lines of the tour JSON that break the tour schema (the same check the React designer shows). */
export const tourLinter = () => linter((view) => diagnose(view.state.doc.toString()), { delay: 150 })

/** A shadow root inside `host`: the UI5 page manages document.adoptedStyleSheets, which would drop CodeMirror's stylesheet. */
export function shadowOf(host) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  let mount = root.querySelector('.tourd-cm-mount')
  if (!mount) {
    mount = document.createElement('div')
    mount.className = 'tourd-cm-mount'
    mount.style.height = '100%'
    root.append(mount)
  }
  return { root, mount }
}

/**
 * An editor in `host`. options: { doc, path, readOnly, dark, tour, onChange(text), onSave() }
 * Returns { getValue, setValue, setPath, setReadOnly, setDark, focus, destroy }.
 */
export function createEditor(host, options) {
  const { root, mount } = shadowOf(host)
  const lang = new Compartment()
  const theme = new Compartment()
  const edit = new Compartment()
  let path = options.path ?? ''
  let silent = false
  let onChange = options.onChange
  let onSave = options.onSave

  const view = new EditorView({
    root,
    parent: mount,
    state: EditorState.create({
      doc: options.doc ?? '',
      extensions: [
        basicSetup,
        lang.of(languageFor(path)),
        edit.of([EditorState.readOnly.of(!!options.readOnly), EditorView.editable.of(!options.readOnly)]),
        look,
        EditorView.lineWrapping,
        focusableScroller,
        options.tour ? [tourLinter(), lintGutter()] : [],
        EditorView.contentAttributes.of({ 'aria-multiline': 'true' }),
        // Ctrl+S saves the file, not the page
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSave?.()
                return true
              },
            },
          ]),
        ),
        theme.of(options.dark ? oneDark : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !silent) onChange?.(u.state.doc.toString())
        }),
      ],
    }),
  })

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text) {
      if (text === view.state.doc.toString()) return
      silent = true
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
      silent = false
    },
    setPath(next) {
      path = next
      view.dispatch({ effects: lang.reconfigure(languageFor(path)) })
    },
    setReadOnly(readOnly) {
      view.dispatch({ effects: edit.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) })
    },
    setDark(dark) {
      view.dispatch({ effects: theme.reconfigure(dark ? oneDark : []) })
    },
    setHandlers(handlers) {
      onChange = handlers.onChange
      onSave = handlers.onSave
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}

/** The uploaded copy of a file next to its working copy, differences marked. Read only. Returns { destroy }. */
export function createDiff(host, { before, after, path, dark }) {
  const { root, mount } = shadowOf(host)
  const extensions = [
    ...languageFor(path ?? ''),
    look,
    EditorView.lineWrapping,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    ...(dark ? [oneDark] : []),
  ]
  const view = new MergeView({
    a: { doc: before, extensions },
    b: { doc: after, extensions },
    parent: mount,
    root,
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
  })
  return { destroy: () => view.destroy() }
}

// what the Workspace tab needs besides the editor: reading a folder / zip / files for the upload (same rules as the React designer)
export { readFiles, readZip, chunkFiles } from '../src/intake'
export { extensionOf } from '../../shared/workspace-rules.mjs'
