import { useQuery } from '@tanstack/react-query'
import { Icon, MessageStrip } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/document.js'
import '@ui5/webcomponents-icons/dist/record.js'
import '@ui5/webcomponents-icons/dist/learning-assistant.js'
import '@ui5/webcomponents-icons/dist/lab.js'
import { api } from '../api'
import type { Project } from '../types'

type Tab = 'sources' | 'recordings' | 'tours' | 'tests'

/** Where the project stands, at a glance, and what to do next. Each tile opens its tab. */
export default function ProjectOverview({ project, onOpen }: { project: Project; onOpen: (tab: Tab) => void }) {
  const files = useQuery({ queryKey: ['file-count', project.ID, project.modifiedAt], queryFn: () => api.countFiles(project.ID) })
  const changes = useQuery({ queryKey: ['changes', project.ID], queryFn: () => api.changes(project.ID) })
  const recordings = useQuery({ queryKey: ['recordings', project.ID], queryFn: () => api.recordings(project.ID) })
  const tours = useQuery({ queryKey: ['tours', project.ID], queryFn: () => api.tours(project.ID) })
  const plans = useQuery({ queryKey: ['test-plans', project.ID], queryFn: () => api.testPlans(project.ID) })

  const n = { files: files.data, changes: changes.data?.length, recordings: recordings.data?.length, tours: tours.data?.length, plans: plans.data?.length }
  const loaded = Object.values(n).every((v) => v !== undefined)

  let next: { text: string; tab: Tab } | null = null
  if (loaded) {
    if (!n.files) next = { text: 'Start by uploading your app: a folder, a zip or single files.', tab: 'sources' }
    else if (!n.recordings) next = { text: 'Record a flow in your app with the browser extension, or import a recording, to turn it into a tour and tests.', tab: 'recordings' }
    else if (!n.tours && !n.plans) next = { text: 'You have a recording: generate a tour from it, or turn it into wdi5 tests.', tab: 'tours' }
    else if (n.changes) next = { text: `${n.changes} file(s) of the project changed: review them in the workspace and download them.`, tab: 'sources' }
  }

  const ICON: Record<Tab, string> = { sources: 'document', recordings: 'record', tours: 'learning-assistant', tests: 'lab' }
  const tile = (tab: Tab, label: string, value: number | undefined, extra: string) => (
    <button className="tile" onClick={() => onOpen(tab)} data-testid={`tile-${tab}`} aria-label={`${label}: ${value ?? '…'}. ${extra}`}>
      <span className="tile-icon" aria-hidden="true">
        <Icon name={ICON[tab]} />
      </span>
      <span className="tile-body">
        <span className="tile-label">{label}</span>
        <span className="tile-n">{value ?? '…'}</span>
        <span className="tile-extra">{extra}</span>
      </span>
    </button>
  )
  return (
    <div data-testid="project-overview">
      <div className="overview">
        {tile('sources', 'Files', n.files, n.changes ? `${n.changes} changed` : n.files ? 'as uploaded' : 'upload your app')}
        {tile('recordings', 'Recordings', n.recordings, 'record or import a flow')}
        {tile('tours', 'Tours', n.tours, 'guided tours for your users')}
        {tile('tests', 'Tests', n.plans, 'wdi5 end-to-end tests')}
      </div>
      {next && (
        <MessageStrip design="Information" hideCloseButton className="next-step" data-testid="next-step">
          {next.text}{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), onOpen(next.tab))}>
            Open
          </a>
        </MessageStrip>
      )}
    </div>
  )
}
