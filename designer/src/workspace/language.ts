import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { properties } from '@codemirror/legacy-modes/mode/properties'

/** Highlighting for a file, chosen by its name. Unknown kinds are plain text. */
export function languageFor(path: string): Extension[] {
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

/** Short, human name of the language (shown in the status line). */
export function languageName(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return (
    {
      js: 'JavaScript',
      mjs: 'JavaScript',
      cjs: 'JavaScript',
      ts: 'TypeScript',
      json: 'JSON',
      xml: 'XML',
      html: 'HTML',
      css: 'CSS',
      md: 'Markdown',
      yaml: 'YAML',
      yml: 'YAML',
      properties: 'Properties',
      svg: 'SVG',
    }[ext] ?? 'Plain text'
  )
}
