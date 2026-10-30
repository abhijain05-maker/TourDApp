import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/folder-blank.js'
import '@ui5/webcomponents-icons/dist/open-folder.js'
import '@ui5/webcomponents-icons/dist/document.js'
import '@ui5/webcomponents-icons/dist/document-text.js'
import '@ui5/webcomponents-icons/dist/source-code.js'
import '@ui5/webcomponents-icons/dist/picture.js'
import '@ui5/webcomponents-icons/dist/navigation-right-arrow.js'
import '@ui5/webcomponents-icons/dist/edit.js'
import '@ui5/webcomponents-icons/dist/delete.js'
import '@ui5/webcomponents-icons/dist/undo.js'
import '@ui5/webcomponents-icons/dist/add.js'
import type { SourceRow } from '../types'
import { buildTree, defaultExpanded, filterFiles, allFolders, visibleRows, type Row } from './tree'
import { extensionOf } from '../../../shared/workspace-rules.mjs'

const STATUS_LABEL: Record<string, string> = { added: 'new', modified: 'changed', deleted: 'removed' }
const STATUS_LETTER: Record<string, string> = { added: 'A', modified: 'M', deleted: 'D' }

function iconFor(file: SourceRow) {
  const ext = extensionOf(file.path)
  if (file.binary || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext)) return 'picture'
  if (['js', 'ts', 'mjs', 'cjs'].includes(ext) || file.kind === 'controller') return 'source-code'
  if (file.kind === 'view' || file.kind === 'fragment') return 'document'
  return 'document-text'
}

export interface FileTreeProps {
  files: SourceRow[]
  activeId: string | null
  onOpen: (file: SourceRow) => void
  onRename: (file: SourceRow) => void
  onRemove: (file: SourceRow) => void
  onRevert: (file: SourceRow) => void
  onNewIn: (folder: string) => void
}

export default function FileTree(props: FileTreeProps) {
  const { files } = props
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterFiles(files, query), [files, query])
  const tree = useMemo(() => buildTree<SourceRow>(shown), [shown])
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(buildTree(files), files.length))
  const [focus, setFocus] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  // opening a file (also from the palette or a new file) reveals it: its folders open
  const [revealed, setRevealed] = useState<string | null>(null)
  if (props.activeId !== revealed) {
    setRevealed(props.activeId)
    const path = files.find((f) => f.ID === props.activeId)?.path
    if (path) {
      const parts = path.split('/').slice(0, -1)
      const missing = parts.map((_, i) => parts.slice(0, i + 1).join('/')).filter((p) => !expanded.has(p))
      if (missing.length) setExpanded(new Set([...expanded, ...missing]))
    }
  }

  // a search shows every match, however deep; a new project (different files) opens the way it should
  const seen = useRef(files.length)
  useEffect(() => {
    if (seen.current === 0 && files.length > 0) setExpanded(defaultExpanded(buildTree(files), files.length))
    seen.current = files.length
  }, [files])
  const open = query.trim() ? new Set(allFolders(tree)) : expanded
  const rows = useMemo(() => visibleRows<SourceRow>(tree, open), [tree, open])

  const toggle = (path: string) =>
    setExpanded((set) => {
      const next = new Set(set)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const activate = (row: Row<SourceRow>) => {
    if (row.node.type === 'dir') toggle(row.node.path)
    else if (row.node.file) props.onOpen(row.node.file)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const row = rows[focus]
    if (!row) return
    const move = (i: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, i))
      setFocus(next)
      list.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[next]?.focus()
    }
    if (e.key === 'ArrowDown') (e.preventDefault(), move(focus + 1))
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(focus - 1))
    else if (e.key === 'Home') (e.preventDefault(), move(0))
    else if (e.key === 'End') (e.preventDefault(), move(rows.length - 1))
    else if (e.key === 'ArrowRight' && row.node.type === 'dir') {
      e.preventDefault()
      if (!row.expanded) toggle(row.node.path)
      else move(focus + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (row.node.type === 'dir' && row.expanded) toggle(row.node.path)
      else {
        const parent = rows.findIndex((r) => r.node.type === 'dir' && row.node.path.startsWith(r.node.path + '/') && r.depth === row.depth - 1)
        if (parent >= 0) move(parent)
      }
    } else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), activate(row))
  }

  return (
    <div className="tree-wrap" data-testid="file-tree">
      <div className="tree-tools">
        <input
          className="tree-filter"
          placeholder="Filter files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter files"
          data-testid="tree-filter"
        />
        <button className="icon-btn" title="Collapse all" aria-label="Collapse all folders" onClick={() => setExpanded(new Set())}>
          <Icon name="open-folder" />
        </button>
      </div>
      {rows.length === 0 && <p className="muted tree-empty">{files.length ? `No file matches "${query}".` : 'No files yet.'}</p>}
      <ul ref={list} className="tree" role="tree" aria-label="Project files" onKeyDown={onKeyDown}>
        {rows.map((row, i) => {
          const { node, depth } = row
          const file = node.file
          const status = file?.status
          const isActive = !!file && file.ID === props.activeId
          return (
            <li
              key={node.path + node.type}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={node.type === 'dir' ? row.expanded : undefined}
              aria-selected={isActive}
              tabIndex={i === focus ? 0 : -1}
              className={`tree-item${isActive ? ' active' : ''}${node.changed ? ' changed' : ''}`}
              data-testid={node.type === 'dir' ? 'folder-row' : 'source-row'}
              data-path={node.path}
              onFocus={() => setFocus(i)}
              onClick={() => activate(row)}
            >
              <div className="tree-row" style={{ paddingLeft: `${depth * 14 + 6}px` }}>
                <span className={`tree-chevron${node.type === 'dir' ? '' : ' none'}${row.expanded ? ' open' : ''}`} aria-hidden="true">
                  <Icon name="navigation-right-arrow" />
                </span>
                <Icon name={node.type === 'dir' ? (row.expanded ? 'open-folder' : 'folder-blank') : iconFor(file!)} className="tree-icon" />
                <span className="tree-name" title={node.path}>
                  {node.name}
                </span>
                {status && status !== 'unchanged' && (
                  <span className={`badge ${status}`} title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]}>
                    {STATUS_LETTER[status]}
                  </span>
                )}
                {node.type === 'dir' && node.changed && <span className="dot" title="Contains changes" />}
                <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                  {node.type === 'dir' && (
                    <button className="icon-btn" aria-label={`New file in ${node.path}`} title="New file here" onClick={() => props.onNewIn(node.path)}>
                      <Icon name="add" />
                    </button>
                  )}
                  {file && (
                    <>
                      <button className="icon-btn" aria-label="Rename file" title="Rename" onClick={() => props.onRename(file)}>
                        <Icon name="edit" />
                      </button>
                      {status && status !== 'unchanged' && (
                        <button className="icon-btn" aria-label="Put back what was uploaded" title="Put back what was uploaded" onClick={() => props.onRevert(file)}>
                          <Icon name="undo" />
                        </button>
                      )}
                      <button className="icon-btn" aria-label="Remove file" title="Remove" onClick={() => props.onRemove(file)}>
                        <Icon name="delete" />
                      </button>
                    </>
                  )}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
