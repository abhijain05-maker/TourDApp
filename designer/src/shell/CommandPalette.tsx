import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@ui5/webcomponents-react'
import { searchCommands, useCommands, type Command } from './commands'

/** Jump to anything: projects, files, actions. Opens with Ctrl+K (or Cmd+K). */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} className="palette" accessibleName="Command palette" data-testid="palette">
      {open && <Body onClose={onClose} />}
    </Dialog>
  )
}

/** Mounted while the palette is open, so every opening starts with an empty search. */
function Body({ onClose }: { onClose: () => void }) {
  const commands = useCommands()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => searchCommands(commands, query), [commands, query])
  const index = Math.min(picked, Math.max(0, matches.length - 1))

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, matches])

  const run = (c: Command | undefined) => {
    if (!c) return
    onClose()
    // after the dialog is gone, so a command that opens another dialog is not closed with it
    setTimeout(c.run, 0)
  }

  const firstOfGroup = (i: number) => i === 0 || matches[i - 1].group !== matches[i].group
  return (
    <div className="palette-body">
      <input
        ref={input}
        className="palette-input"
        placeholder="Jump to a project, a file or an action..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setPicked(0)
        }}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={matches[index] ? `palette-${index}` : undefined}
        aria-label="Search commands"
        data-testid="palette-input"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setPicked(Math.min(index + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setPicked(Math.max(index - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            run(matches[index])
          }
        }}
      />
      <ul id="palette-list" ref={list} className="palette-list" role="listbox" aria-label="Results">
        {matches.length === 0 && <li className="palette-empty">Nothing matches &ldquo;{query}&rdquo;.</li>}
        {matches.map((c, i) => {
          const header = firstOfGroup(i) ? (
            <li key={`g-${c.group}-${i}`} className="palette-group" role="presentation">
              {c.group}
            </li>
          ) : null
          return [
            header,
            <li
              key={c.id}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === index}
              className={`palette-item${i === index ? ' selected' : ''}`}
              data-testid="palette-item"
              onMouseMove={() => setPicked(i)}
              onClick={() => run(c)}
            >
              <span className="palette-title">{c.title}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
            </li>,
          ]
        })}
      </ul>
      <div className="palette-foot">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> to move
        </span>
        <span>
          <kbd>Enter</kbd> to open
        </span>
        <span>
          <kbd>Esc</kbd> to close
        </span>
      </div>
    </div>
  )
}
