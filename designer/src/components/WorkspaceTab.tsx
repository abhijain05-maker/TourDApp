import { useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BusyIndicator, Button, MessageStrip, Text, Title } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/upload-to-cloud.js'
import '@ui5/webcomponents-icons/dist/open-folder.js'
import '@ui5/webcomponents-icons/dist/folder.js'
import '@ui5/webcomponents-icons/dist/document.js'
import '@ui5/webcomponents-icons/dist/paste.js'
import { api } from '../api'
import { chunkFiles, readFiles, readZip, type IntakeResult } from '../intake'
import type { ImportResult, Project, SkippedFile } from '../types'
import { ErrorStrip, Tag } from './common'
import PasteDialog from './PasteDialog'
import Workspace from '../workspace/Workspace'

interface Outcome {
  result: ImportResult
  intake: IntakeResult
}

/**
 * The project's files: upload them (folder, zip, files, pasted), see what the app consists of, read and edit every
 * file, and take the result along.
 */
export default function WorkspaceTab({ project }: { project: Project }) {
  const qc = useQueryClient()
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const [pasting, setPasting] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [intakeError, setIntakeError] = useState<string | null>(null)

  const inventory = useQuery({
    queryKey: ['inventory', project.ID, project.modifiedAt],
    queryFn: () => api.inventory(project.ID),
    enabled: project.parseStatus !== 'empty',
  })

  const refresh = () =>
    Promise.all(['sources', 'changes', 'inventory', 'project', 'projects', 'file'].map((k) => qc.invalidateQueries({ queryKey: [k] })))

  const upload = useMutation({
    mutationFn: async ({ intake, replace }: { intake: IntakeResult; replace: boolean }): Promise<Outcome> => {
      if (!intake.files.length) throw new Error('No files were found in what you selected.')
      if (!intake.files.some((f) => /\.(view|fragment)\.xml$|\.controller\.(js|ts)$|(^|\/)manifest\.json$|(^|\/)i18n[^/]*\.properties$/i.test(f.path)))
        throw new Error('No views, fragments, controllers, manifest.json or i18n files were found in what you selected.')
      let result: ImportResult | undefined
      let imported = 0
      for (const [i, chunk] of chunkFiles(intake.files).entries()) {
        result = await api.importSources(project.ID, chunk, replace && i === 0)
        imported += result.imported
      }
      return { result: { ...result!, imported }, intake }
    },
    onSuccess: (o) => {
      setOutcome(o)
      return refresh()
    },
  })

  /** Folder and zip are a full snapshot of the app (replace); loose files are added or updated. */
  const pick = (read: (input: HTMLInputElement) => Promise<IntakeResult>, replace: boolean) => async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    setIntakeError(null)
    setOutcome(null)
    try {
      upload.mutate({ intake: await read(input), replace })
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : String(err))
    } finally {
      input.value = '' // allow choosing the same thing again
    }
  }

  const unstable = inventory.data?.controls.filter((c) => !c.hasStableId) ?? []
  const busy = upload.isPending
  const left: SkippedFile[] = (outcome?.result.skipped ?? []).filter((s) => !s.expected)

  return (
    <div className="stack" data-testid="sources-tab">
      <div className="row spread">
        <div>
          <Title level="H4">Your project</Title>
          {!inventory.data && <Text className="muted">Upload the app, then read and change any of its files. A folder or zip replaces the project's files; single files are added or updated.</Text>}
        </div>
        <div className="row">
          <Button icon="open-folder" design="Emphasized" disabled={busy} onClick={() => folderInput.current?.click()} data-testid="pick-folder">
            Choose folder
          </Button>
          <Button icon="folder" disabled={busy} onClick={() => zipInput.current?.click()} data-testid="pick-zip">
            Upload zip
          </Button>
          <Button icon="document" disabled={busy} onClick={() => filesInput.current?.click()} data-testid="pick-files">
            Add files
          </Button>
          <Button icon="paste" disabled={busy} onClick={() => setPasting(true)} data-testid="paste-file">
            Paste a file
          </Button>
        </div>
      </div>

      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden-input"
        data-testid="input-folder"
        {...({ webkitdirectory: '' } as object)}
        onChange={pick(async (i) => readFiles(i.files ?? []), true)}
      />
      <input ref={filesInput} type="file" multiple className="hidden-input" data-testid="input-files" onChange={pick(async (i) => readFiles(i.files ?? []), false)} />
      <input
        ref={zipInput}
        type="file"
        className="hidden-input"
        data-testid="input-zip"
        accept=".zip,application/zip"
        onChange={pick(async (i) => readZip(new Uint8Array(await i.files![0].arrayBuffer())), true)}
      />

      {busy && <BusyIndicator active size="S" text="Importing…" />}
      {intakeError && <ErrorStrip error={new Error(intakeError)} />}
      <ErrorStrip error={upload.error} />

      {outcome && (
        <MessageStrip design="Positive" hideCloseButton data-testid="import-result">
          Imported {outcome.result.imported} file(s){outcome.result.appId ? ` of ${outcome.result.appId}` : ''}: {outcome.result.views} view(s), {outcome.result.controls} control(s).
          {outcome.intake.ignored > 0 && ` ${outcome.intake.ignored} file(s) were left out on purpose (dependencies, build output, files that may hold secrets).`}
        </MessageStrip>
      )}
      {[...(outcome?.intake.skipped ?? []), ...left].map((s) => (
        <MessageStrip key={s.path + s.reason} design="Critical" hideCloseButton>
          Skipped {s.path}: {s.reason}. The project cannot be downloaded as a whole without it.
        </MessageStrip>
      ))}

      {inventory.data && (
        <div className="card" data-testid="inventory-summary">
          <div className="row">
            <Tag colorScheme="6">{inventory.data.views.length} views</Tag>
            <Tag colorScheme="6">{inventory.data.controls.length} controls</Tag>
            {unstable.length > 0 && (
              <Tag colorScheme="2" title={unstable.map((c) => `${c.type} ${c.display ?? ''}`).join('\n')} data-testid="unstable-tag">
                {unstable.length} without a stable id
              </Tag>
            )}
          </div>
          {unstable.length > 0 && (
            <div className="muted" style={{ marginTop: '0.5rem', fontWeight: 'normal' }}>
              Controls without an id (or inside a list template) can only be found by their text. Give the ones you want to point at an <code>id</code> in the view.
            </div>
          )}
          {inventory.data.warnings.map((w) => (
            <MessageStrip key={w.code + w.message} design="Critical" hideCloseButton style={{ marginTop: '0.5rem' }}>
              {w.message}
            </MessageStrip>
          ))}
        </div>
      )}

      <Workspace project={project} />

      <PasteDialog
        open={pasting}
        onClose={() => setPasting(false)}
        onAdd={(path, content) => {
          setPasting(false)
          setOutcome(null)
          upload.mutate({ intake: { files: [{ path, content }], skipped: [], ignored: 0 }, replace: false })
        }}
      />
    </div>
  )
}
