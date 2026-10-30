import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BusyIndicator, Button, Dialog, Icon, Input, Label, MessageStrip, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/add.js'
import '@ui5/webcomponents-icons/dist/download.js'
import '@ui5/webcomponents-icons/dist/decline.js'
import '@ui5/webcomponents-icons/dist/save.js'
import '@ui5/webcomponents-icons/dist/compare.js'
import '@ui5/webcomponents-icons/dist/accept.js'
import '@ui5/webcomponents-icons/dist/navigation-down-arrow.js'
import '@ui5/webcomponents-icons/dist/navigation-right-arrow.js'
import '@ui5/webcomponents-icons/dist/full-screen.js'
import '@ui5/webcomponents-icons/dist/exit-full-screen.js'
import { api, ApiError } from '../api'
import type { FileInfo, Project, SourceRow } from '../types'
import { ConfirmDialog, ErrorStrip } from '../components/common'
import { useRegisterCommands, type Command } from '../shell/commands'
import FileTree from './FileTree'
import ShadowEditor from './ShadowEditor'
import DiffView from './DiffView'
import { languageFor, languageName } from './language'
import { fileName, folderOf } from './tree'
import { extensionOf } from '../../../shared/workspace-rules.mjs'

interface Tab {
  key: string
  type: 'file' | 'diff'
  id: string
  path: string
}

const STATUS_TEXT: Record<string, string> = { added: 'New', modified: 'Changed', deleted: 'Removed', unchanged: 'As uploaded' }
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg'])
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', svg: 'image/svg+xml' }
/** Kinds the parsers read: after saving one of them the controls of the app are new. */
const PARSED = new Set(['view', 'fragment', 'controller', 'manifest', 'i18n'])

const WIDTH_KEY = 'tourd.ws.tree'
const readWidth = () => {
  try {
    return Math.min(520, Math.max(180, Number(localStorage.getItem(WIDTH_KEY)) || 300))
  } catch {
    return 300
  }
}

export default function Workspace({ project }: { project: Project }) {
  const qc = useQueryClient()
  const files = useQuery({ queryKey: ['sources', project.ID], queryFn: () => api.sources(project.ID) })
  const changes = useQuery({ queryKey: ['changes', project.ID], queryFn: () => api.changes(project.ID) })

  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [conflict, setConflict] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<SourceRow | null>(null)
  const [creating, setCreating] = useState<string | null>(null)
  const [removing, setRemoving] = useState<SourceRow | null>(null)
  const [reverting, setReverting] = useState<{ ID: string; path: string } | null>(null)
  // 'all' = every change, else one file
  const [accepting, setAccepting] = useState<'all' | { ID: string; path: string } | null>(null)
  const [closing, setClosing] = useState<Tab | null>(null)
  const [width, setWidth] = useState(readWidth)
  // the workspace covers the whole window; Esc leaves it
  const [full, setFull] = useState(false)

  useEffect(() => {
    if (!full) return
    document.body.classList.add('ws-full')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('ui5-dialog[open]')) setFull(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('ws-full')
      window.removeEventListener('keydown', onKey)
    }
  }, [full])

  const list = useMemo(() => files.data ?? [], [files.data])
  const byId = useMemo(() => new Map(list.map((f) => [f.ID, f])), [list])
  const tab = tabs.find((t) => t.key === active) ?? null

  const refresh = useCallback(
    (kind?: string) =>
      Promise.all(
        [
          ['sources', project.ID],
          ['changes', project.ID],
          ['project', project.ID],
          ['projects'],
          ...(kind && PARSED.has(kind) ? [['inventory']] : []),
          ['file'],
        ].map((queryKey) => qc.invalidateQueries({ queryKey })),
      ),
    [qc, project.ID],
  )

  // tabs of files that are gone (removed, renamed) close by themselves
  useEffect(() => {
    if (!files.data) return
    setTabs((all) => {
      const keep = all.filter((t) => byId.has(t.id) || t.type === 'diff')
      if (keep.length === all.length) return all
      if (active && !keep.some((t) => t.key === active)) setActive(keep.at(-1)?.key ?? null)
      return keep
    })
  }, [files.data, byId, active])

  const open = useCallback((file: { ID: string; path: string }, type: Tab['type'] = 'file') => {
    const key = `${type}:${file.ID}`
    setTabs((all) => (all.some((t) => t.key === key) ? all : [...all, { key, type, id: file.ID, path: file.path }]))
    setActive(key)
  }, [])

  const dirty = (id: string) => id in drafts

  const close = useCallback(
    (t: Tab, force = false) => {
      if (!force && t.type === 'file' && dirty(t.id)) return setClosing(t)
      setTabs((all) => {
        const next = all.filter((x) => x.key !== t.key)
        if (active === t.key) setActive(next[Math.max(0, all.findIndex((x) => x.key === t.key) - 1)]?.key ?? next[0]?.key ?? null)
        return next
      })
      if (t.type === 'file')
        setDrafts((d) => {
          const { [t.id]: _gone, ...rest } = d
          void _gone
          return rest
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, drafts],
  )

  // ---- the open file ---------------------------------------------------------------------------------------------

  const detail = useQuery({
    queryKey: ['file', tab?.id],
    queryFn: () => api.file(tab!.id),
    enabled: !!tab,
  })

  const save = useMutation({
    mutationFn: async ({ id, text, force }: { id: string; text: string; force?: boolean }) =>
      api.saveFile(id, text, force ? null : detail.data?.hash),
    onSuccess: async (info: FileInfo, { id }) => {
      setConflict(null)
      setDrafts((d) => {
        const { [id]: _gone, ...rest } = d
        void _gone
        return rest
      })
      await refresh(info.kind)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message)
    },
  })

  const draft = tab ? drafts[tab.id] : undefined
  const text = detail.data ? (draft ?? detail.data.content) : ''
  const saveNow = () => {
    if (tab && tab.type === 'file' && draft !== undefined && !save.isPending) save.mutate({ id: tab.id, text: draft })
  }

  // ---- file operations ---------------------------------------------------------------------------------------------

  const create = useMutation({
    mutationFn: (path: string) => api.createFile(project.ID, path.trim(), ''),
    onSuccess: async (info) => {
      setCreating(null)
      await refresh(info.kind)
      open({ ID: info.ID, path: info.path })
    },
  })
  const rename = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) => api.renameFile(id, path.trim()),
    onSuccess: async (info, { id }) => {
      setRenaming(null)
      setTabs((all) => all.filter((t) => t.id !== id))
      await refresh(info.kind)
      open({ ID: info.ID, path: info.path })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFile(id),
    onSuccess: async (info) => {
      setRemoving(null)
      await refresh(info.kind)
    },
  })
  const revert = useMutation({
    mutationFn: (id: string) => api.revertFile(id),
    onSuccess: async (info, id) => {
      setReverting(null)
      setDrafts((d) => {
        const { [id]: _gone, ...rest } = d
        void _gone
        return rest
      })
      await refresh(info.kind)
    },
  })
  const accept = useMutation({
    mutationFn: (only: string[]) => api.acceptChanges(project.ID, only),
    onSuccess: async (_n, only) => {
      setAccepting(null)
      if (only.length === 0) setDrafts({})
      else
        setDrafts((d) => {
          const rest = { ...d }
          for (const id of only) delete rest[id]
          return rest
        })
      await refresh('manifest')
    },
  })
  const failure = create.error ?? rename.error ?? remove.error ?? revert.error ?? accept.error ?? files.error ?? (save.error instanceof ApiError && save.error.status === 409 ? null : save.error)

  // ---- palette, warnings, splitter -----------------------------------------------------------------------------------

  const commands = useMemo<Command[]>(
    () => [
      ...list.slice(0, 400).map((f) => ({
        id: `file-${f.ID}`,
        group: 'Files',
        title: fileName(f.path),
        hint: folderOf(f.path),
        run: () => open(f),
        keywords: f.path,
      })),
      { id: 'ws-new', group: 'Actions', title: 'New file', run: () => setCreating(''), keywords: 'add create' },
      { id: 'ws-full', group: 'Actions', title: full ? 'Leave full screen' : 'Workspace full screen', run: () => setFull((f) => !f), keywords: 'maximize expand editor' },
      ...(dirty(tab?.id ?? '') ? [{ id: 'ws-save', group: 'Actions', title: 'Save file', run: saveNow }] : []),
      ...(tab ? [{ id: 'ws-close', group: 'Actions', title: 'Close this tab', run: () => close(tab) }] : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, tab, drafts, full],
  )
  useRegisterCommands('workspace', commands)

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(drafts).length) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [drafts])

  const startDrag = (e: React.PointerEvent) => {
    const startX = e.clientX
    const startWidth = width
    const move = (ev: PointerEvent) => setWidth(Math.min(520, Math.max(180, startWidth + ev.clientX - startX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try {
        localStorage.setItem(WIDTH_KEY, String(width))
      } catch {
        /* a remembered width is only a convenience */
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const changed = changes.data ?? []
  const entry = tab ? byId.get(tab.id) : undefined

  return (
    <div className={`ws${full ? ' full' : ''}`} style={{ gridTemplateColumns: `${width}px 6px minmax(0, 1fr)` }} data-testid="workspace">
      <div className="ws-side">
        <div className="ws-side-head">
          <b>Files</b>
          <span className="count">{list.length}</span>
          <span className="grow" />
          <Button icon="add" design="Transparent" tooltip="New file" accessibleName="New file" onClick={() => setCreating('')} data-testid="new-file" />
          <Button
            icon={full ? 'exit-full-screen' : 'full-screen'}
            design={full ? 'Emphasized' : 'Transparent'}
            tooltip={full ? 'Leave full screen (Esc)' : 'Full screen'}
            accessibleName={full ? 'Leave full screen' : 'Full screen'}
            onClick={() => setFull((f) => !f)}
            data-testid="ws-fullscreen"
          />
        </div>
        {files.isLoading && <BusyIndicator active size="S" />}
        <FileTree
          files={list}
          activeId={tab?.type === 'file' ? tab.id : null}
          onOpen={(f) => open(f)}
          onRename={setRenaming}
          onRemove={setRemoving}
          onRevert={(f) => setReverting({ ID: f.ID, path: f.path })}
          onNewIn={(folder) => setCreating(folder ? `${folder}/` : '')}
        />
        <ChangesPanel
          project={project}
          changes={changed}
          onOpen={(c) => open(c, 'diff')}
          onRevert={(c) => setReverting({ ID: c.ID, path: c.path })}
          onAccept={(f) => setAccepting(f ? { ID: f.ID, path: f.path } : 'all')}
        />
      </div>

      <div className="splitter" role="separator" aria-orientation="vertical" aria-label="Resize the file list" aria-valuemin={180} aria-valuemax={520} aria-valuenow={width} tabIndex={0} onPointerDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setWidth((w) => Math.max(180, w - 24))
          if (e.key === 'ArrowRight') setWidth((w) => Math.min(520, w + 24))
        }}
      />

      <div className="ws-main">
        <ErrorStrip error={failure} />
        {tabs.length === 0 ? (
          <div className="ws-empty" data-testid="ws-empty">
            <Icon name="document" style={{ width: '2.5rem', height: '2.5rem' }} />
            <p>{list.length ? 'Open a file from the list, or press Ctrl+K to find one.' : 'Upload your app to see its files here.'}</p>
          </div>
        ) : (
          <>
            <div className="tabs" role="group" aria-label="Open files">
              {tabs.map((t) => (
                <div key={t.key} className={`tab-chip${t.key === active ? ' active' : ''}`}>
                  <button
                    aria-current={t.key === active ? 'true' : undefined}
                    className="tab-main"
                    onClick={() => setActive(t.key)}
                    title={t.path}
                    data-testid="editor-tab"
                  >
                    {t.type === 'diff' && <Icon name="compare" />}
                    <span>{fileName(t.path)}</span>
                    {t.type === 'file' && dirty(t.id) && <span className="dirty" aria-label="unsaved changes" title="Unsaved changes" />}
                  </button>
                  <button className="tab-close" aria-label={`Close ${fileName(t.path)}`} onClick={() => close(t)}>
                    <Icon name="decline" />
                  </button>
                </div>
              ))}
            </div>

            {tab && (
              <>
                <div className="file-head">
                  <span className="mono file-path" data-testid="file-path">{tab.path}</span>
                  {detail.data && <span className={`badge ${detail.data.status}`} data-testid="file-status">{STATUS_TEXT[detail.data.status] ?? detail.data.status}</span>}
                  <span className="grow" />
                  <span className="muted">{languageName(tab.path)}</span>
                  {tab.type === 'file' && detail.data && !detail.data.binary && (
                    <>
                      {entry && entry.status && entry.status !== 'unchanged' && (
                        <Button icon="compare" design="Transparent" onClick={() => open({ ID: tab.id, path: tab.path }, 'diff')} data-testid="show-diff">
                          Compare
                        </Button>
                      )}
                      <Button icon="save" design="Emphasized" disabled={draft === undefined || save.isPending} onClick={saveNow} data-testid="save-file">
                        Save
                      </Button>
                    </>
                  )}
                </div>

                {conflict && (
                  <MessageStrip design="Negative" hideCloseButton data-testid="file-conflict">
                    {conflict}{' '}
                    <a
                      href="#"
                      onClick={async (e) => {
                        e.preventDefault()
                        setConflict(null)
                        setDrafts((d) => {
                          const { [tab.id]: _gone, ...rest } = d
                          void _gone
                          return rest
                        })
                        await refresh()
                      }}
                    >
                      Discard my changes and reload
                    </a>{' '}
                    ·{' '}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        if (draft !== undefined) save.mutate({ id: tab.id, text: draft, force: true })
                      }}
                    >
                      Save mine anyway
                    </a>
                  </MessageStrip>
                )}

                <div className="ws-body">
                  {detail.isLoading && <BusyIndicator active style={{ margin: '2rem' }} />}
                  <ErrorStrip error={detail.error} />
                  {detail.data && tab.type === 'file' && <FileBody path={tab.path} detail={detail.data} text={text} onChange={(v) => setDrafts((d) => (v === detail.data!.content ? omit(d, tab.id) : { ...d, [tab.id]: v }))} onSave={saveNow} />}
                  {detail.data && tab.type === 'diff' && (
                    <DiffView
                      before={detail.data.base ?? ''}
                      after={detail.data.status === 'deleted' ? '' : detail.data.content}
                      language={languageFor(tab.path)}
                      beforeLabel="As uploaded"
                      afterLabel={detail.data.status === 'deleted' ? 'Removed' : 'Now'}
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <NameDialog
        title="New file"
        label="Path of the new file, from the project's root"
        confirm="Create"
        open={creating !== null}
        initial={creating ?? ''}
        busy={create.isPending}
        error={create.error}
        onClose={() => (setCreating(null), create.reset())}
        onConfirm={(path) => create.mutate(path)}
        testid="new-file-dialog"
      />
      <NameDialog
        title="Rename file"
        label="New path"
        confirm="Rename"
        open={!!renaming}
        initial={renaming?.path ?? ''}
        busy={rename.isPending}
        error={rename.error}
        onClose={() => (setRenaming(null), rename.reset())}
        onConfirm={(path) => renaming && rename.mutate({ id: renaming.ID, path })}
        testid="rename-dialog"
      />
      <ConfirmDialog
        open={!!removing}
        title="Remove file"
        confirmText="Remove"
        busy={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.ID)}
      >
        {removing && `Remove ${removing.path} from the project? You can put it back from the list of changes.`}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!reverting}
        title="Put back what was uploaded"
        confirmText="Put back"
        busy={revert.isPending}
        onCancel={() => setReverting(null)}
        onConfirm={() => reverting && revert.mutate(reverting.ID)}
      >
        {reverting && `Throw away the changes to ${reverting.path} and use the uploaded version again? A file that was added here is removed.`}
      </ConfirmDialog>
      <ConfirmDialog
        open={accepting !== null}
        title={accepting === 'all' || accepting === null ? 'Make the changes part of the project' : 'Make this file part of the project'}
        confirmText={accepting === 'all' || accepting === null ? 'Accept all changes' : 'Accept the file'}
        busy={accept.isPending}
        onCancel={() => setAccepting(null)}
        onConfirm={() => accept.mutate(accepting && accepting !== 'all' ? [accepting.ID] : [])}
      >
        {accepting === 'all'
          ? `The ${changed.length} changed file(s) become the project as it is now: the list of changes is cleared, removed files are gone for good, and "put back" returns to this state, not to the first upload. Download the changes first if you still need them as a zip or patch.`
          : accepting && `${accepting.path} becomes part of the project as it is now: it leaves the list of changes and "put back" returns to this state, not to the first upload. A removed file is gone for good.`}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!closing}
        title="Unsaved changes"
        confirmText="Close without saving"
        onCancel={() => setClosing(null)}
        onConfirm={() => {
          if (closing) close(closing, true)
          setClosing(null)
        }}
      >
        {closing && `${fileName(closing.path)} has changes that are not saved.`}
      </ConfirmDialog>
    </div>
  )
}

const omit = (d: Record<string, string>, id: string) => {
  const { [id]: _gone, ...rest } = d
  void _gone
  return rest
}

function FileBody(props: { path: string; detail: NonNullable<ReturnType<typeof api.file> extends Promise<infer T> ? T : never>; text: string; onChange: (v: string) => void; onSave: () => void }) {
  const { detail } = props
  const ext = extensionOf(props.path)
  const language = useMemo(() => languageFor(props.path), [props.path])
  if (detail.status === 'deleted')
    return (
      <div className="ws-empty">
        <p>This file was removed. Put it back from the list of changes.</p>
      </div>
    )
  if (detail.binary)
    return (
      <div className="binary" data-testid="binary-preview">
        {IMAGE.has(ext) ? (
          <img src={`data:${MIME[ext] ?? 'image/png'};base64,${detail.content}`} alt={props.path} />
        ) : (
          <p className="muted">A binary file; it cannot be shown or edited here.</p>
        )}
      </div>
    )
  return <ShadowEditor path={props.path} value={props.text} language={language} onChange={props.onChange} onSave={props.onSave} />
}

/** Everything that differs from what was uploaded, with the way to take it along. */
function ChangesPanel(props: { project: Project; changes: FileInfo[]; onOpen: (f: FileInfo) => void; onRevert: (f: FileInfo) => void; onAccept: (f?: FileInfo) => void }) {
  const { changes, project } = props
  const [openList, setOpenList] = useState(true)
  const base = `/export/project/${project.ID}`
  const none = changes.length === 0
  return (
    <section className="changes" data-testid="changes-panel">
      <button className="changes-head" onClick={() => setOpenList((o) => !o)} aria-expanded={openList}>
        <b>Changes</b>
        <span className={`count${none ? '' : ' on'}`} data-testid="changes-count">{changes.length}</span>
        <Icon name={openList ? 'navigation-down-arrow' : 'navigation-right-arrow'} className="changes-chevron" />
      </button>
      {openList && (
        <>
          {none && (
            <div className="changes-empty">
              <span className="changes-empty-icon" aria-hidden="true"><Icon name="accept" /></span>
              <span>
                <b>Up to date</b>
                <span className="muted">Nothing changed since the upload.</span>
              </span>
            </div>
          )}
          <ul className="changes-list">
            {changes.map((c) => (
              <li key={c.ID} className="change" data-testid="change-row">
                <button className="change-main" onClick={() => props.onOpen(c)} title={c.path}>
                  <span className={`badge ${c.status}`}>{c.status === 'added' ? 'A' : c.status === 'deleted' ? 'D' : 'M'}</span>
                  <span className="tree-name">{c.path}</span>
                </button>
                <button className="icon-btn" aria-label={`Accept ${c.path}`} title="Make this file part of the project (it leaves the list of changes)" onClick={() => props.onAccept(c)} data-testid="accept-file">
                  <Icon name="accept" />
                </button>
                <button className="icon-btn" aria-label={`Put back ${c.path}`} title="Put back what was uploaded" onClick={() => props.onRevert(c)}>
                  <Icon name="undo" />
                </button>
              </li>
            ))}
          </ul>
          <div className="changes-foot">
            <div className="changes-downloads" role="group" aria-label="Download">
              <a className="act-btn" href={`${base}/changes.zip`} download aria-disabled={none} data-testid="download-changes">
                <Icon name="download" /> Changes (.zip)
              </a>
              <a className="act-btn" href={`${base}/changes.patch`} download aria-disabled={none} data-testid="download-patch">
                <Icon name="download" /> Patch
              </a>
              <a className="act-btn" href={`${base}/full.zip`} download data-testid="download-full">
                <Icon name="download" /> Whole project
              </a>
            </div>
            <Button design="Emphasized" icon="accept" disabled={none} onClick={() => props.onAccept()} tooltip="Make the changes part of the project (the list of changes is cleared)" data-testid="accept-changes">
              Accept all changes
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function NameDialog(props: {
  title: string
  label: string
  confirm: string
  open: boolean
  initial: string
  busy: boolean
  error: unknown
  onClose: () => void
  onConfirm: (value: string) => void
  testid: string
}) {
  const [value, setValue] = useState(props.initial)
  useEffect(() => {
    if (props.open) setValue(props.initial)
  }, [props.open, props.initial])
  return (
    <Dialog
      open={props.open}
      headerText={props.title}
      onClose={props.onClose}
      data-testid={props.testid}
      footer={
        <Bar
          endContent={
            <>
              <Button design="Emphasized" disabled={!value.trim() || props.busy} onClick={() => props.onConfirm(value)} data-testid="name-confirm">
                {props.confirm}
              </Button>
              <Button design="Transparent" onClick={props.onClose}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <div className="stack" style={{ width: 'min(34rem, 85vw)' }}>
        <ErrorStrip error={props.error} />
        <div>
          <Label for="name-input" required>
            {props.label}
          </Label>
          <Input
            id="name-input"
            style={{ width: '100%' }}
            value={value}
            onInput={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim() && !props.busy) props.onConfirm(value)
            }}
            data-testid="name-input"
          />
        </div>
        <Text className="muted">Folders in the path are created as needed.</Text>
      </div>
    </Dialog>
  )
}
