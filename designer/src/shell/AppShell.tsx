import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/home.js'
import '@ui5/webcomponents-icons/dist/puzzle.js'
import '@ui5/webcomponents-icons/dist/search.js'
import '@ui5/webcomponents-icons/dist/light-mode.js'
import '@ui5/webcomponents-icons/dist/dark-mode.js'
import '@ui5/webcomponents-icons/dist/folder-blank.js'
import '@ui5/webcomponents-icons/dist/menu2.js'
import { api } from '../api'
import ExtensionDialog from '../components/ExtensionDialog'
import CommandPalette from './CommandPalette'
import { CommandsProvider, useRegisterCommands, type Command } from './commands'
import { useTheme } from './theme'

const COLLAPSED = 'tourd.nav.collapsed'
// narrow windows start with the slim navigation, unless the user chose
const read = () => {
  try {
    const saved = localStorage.getItem(COLLAPSED)
    if (saved !== null) return saved === '1'
  } catch {
    /* no stored choice */
  }
  return typeof innerWidth === 'number' && innerWidth < 1180
}

function Shell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { choice, resolved, setChoice } = useTheme()
  const [collapsed, setCollapsed] = useState(read)
  const [palette, setPalette] = useState(false)
  const [extension, setExtension] = useState(false)
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED, collapsed ? '1' : '0')
    } catch {
      /* a remembered choice is only a convenience */
    }
  }, [collapsed])

  // Ctrl+K / Cmd+K from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const nextTheme = choice === 'auto' ? 'light' : choice === 'light' ? 'dark' : 'auto'
  const cycleTheme = () => setChoice(nextTheme)

  const commands = useMemo<Command[]>(
    () => [
      { id: 'go-projects', group: 'Go to', title: 'All projects', run: () => navigate('/'), keywords: 'home start' },
      { id: 'new-project', group: 'Actions', title: 'New project', run: () => navigate('/?new=1'), keywords: 'create add' },
      { id: 'extension', group: 'Actions', title: 'Browser extension: pair and install', run: () => setExtension(true), keywords: 'recorder token chrome edge' },
      { id: 'theme', group: 'Actions', title: `Appearance: switch to ${nextTheme}`, hint: `now ${choice}`, run: cycleTheme, keywords: 'dark light mode theme' },
      ...(projects.data ?? []).slice(0, 30).map((p) => ({
        id: `project-${p.ID}`,
        group: 'Projects',
        title: p.name,
        hint: p.appId ?? undefined,
        run: () => navigate(`/projects/${p.ID}`),
        keywords: 'open project',
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects.data, choice],
  )
  useRegisterCommands('shell', commands)

  const projectMatch = /^\/projects\/([^/?]+)/.exec(location.pathname)
  const recent = (projects.data ?? []).slice(0, 8)

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`} data-testid="shell">
      <aside className="side" aria-label="Navigation">
        <button className="side-brand" onClick={() => navigate('/')} title="All projects">
          <span className="logo" aria-hidden="true">Q</span>
          <span className="side-label">
            <b>QuickDev</b>
            <small>Help and Tests for UI5</small>
          </span>
        </button>

        <nav className="side-nav">
          <NavLink to="/" end className="side-link" data-testid="nav-projects">
            <Icon name="home" />
            <span className="side-label">Projects</span>
          </NavLink>
          {recent.length > 0 && <div className="side-heading side-label">Recent</div>}
          {recent.map((p) => (
            <NavLink
              key={p.ID}
              to={`/projects/${p.ID}`}
              className={`side-link sub${projectMatch?.[1] === p.ID ? ' active' : ''}`}
              title={p.name}
              data-testid="nav-project"
            >
              <Icon name="folder-blank" />
              <span className="side-label">{p.name}</span>
            </NavLink>
          ))}
        </nav>

        <div className="side-foot">
          <button className="side-link" onClick={() => setExtension(true)} data-testid="open-extension" title="Browser extension">
            <Icon name="puzzle" />
            <span className="side-label">Browser extension</span>
          </button>
          <button className="side-link" onClick={cycleTheme} title={`Appearance: ${choice}. Click for ${nextTheme}.`} data-testid="theme-toggle">
            <Icon name={resolved === 'dark' ? 'dark-mode' : 'light-mode'} />
            <span className="side-label">Appearance: {choice}</span>
          </button>
          <button className="side-link" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} data-testid="nav-collapse">
            <Icon name="menu2" />
            <span className="side-label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar" data-testid="shellbar">
          <button className="palette-trigger" onClick={() => setPalette(true)} data-testid="palette-open">
            <Icon name="search" />
            <span>Jump to a project, a file or an action</span>
            <span className="kbd-hint"><kbd>Ctrl</kbd> <kbd>K</kbd></span>
          </button>
        </header>
        <div className="main-scroll">{children}</div>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <ExtensionDialog open={extension} onClose={() => setExtension(false)} />
    </div>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <CommandsProvider>
      <Shell>{children}</Shell>
    </CommandsProvider>
  )
}
