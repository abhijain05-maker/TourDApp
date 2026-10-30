import { lazy, Suspense } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BusyIndicator, Tab, TabContainer } from '@ui5/webcomponents-react'
import { api } from '../api'
import { ErrorStrip } from '../components/common'
import { formatDate } from '../format'
import PageHeader, { Chip } from '../components/PageHeader'
// the editor and its languages are only needed once the files are opened
const WorkspaceTab = lazy(() => import('../components/WorkspaceTab'))
import RecordingsTab from '../components/RecordingsTab'
import ToursTab from '../components/ToursTab'
import ProjectOverview from '../components/ProjectOverview'
import TestsTab from '../components/TestsTab'
import HelpTab from '../components/HelpTab'

const TABS = ['sources', 'recordings', 'tours', 'tests', 'help'] as const
type TabId = (typeof TABS)[number]

export default function ProjectPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) })
  const tab: TabId = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as TabId) : 'sources'
  const select = (t: TabId) => setParams({ tab: t }, { replace: true })

  if (project.isLoading) return <BusyIndicator active style={{ margin: '2rem' }} />
  if (project.error || !project.data) {
    return (
      <div className="page">
        <ErrorStrip error={project.error ?? new Error('Project not found')} />
        <Link to="/">Back to all projects</Link>
      </div>
    )
  }
  const p = project.data

  return (
    <div className="page" data-testid="project-page">
      <PageHeader
        crumbs={[{ label: 'Projects', to: '/' }, { label: p.name }]}
        title={p.name}
        titleTestId="project-title"
        chips={
          <>
            {p.appId && <Chip tone="info">{p.appId}</Chip>}
            <Chip>UI5 {p.ui5Version}</Chip>
          </>
        }
        description={p.description}
        meta={
          <>
            <span>Created {formatDate(p.createdAt)}</span>
            <span>Updated {formatDate(p.modifiedAt)}</span>
          </>
        }
      />

      <ProjectOverview project={p} onOpen={select} />

      <div className="card tabs-card">
        <TabContainer onTabSelect={(e) => select(e.detail.tab.dataset.tab as TabId)} data-testid="project-tabs">
          <Tab text="Workspace" data-tab="sources" selected={tab === 'sources'} data-testid="tab-sources">
            <div className="tab-pane">{tab === 'sources' && (
                <Suspense fallback={<BusyIndicator active style={{ margin: '2rem' }} />}>
                  <WorkspaceTab project={p} />
                </Suspense>
              )}</div>
          </Tab>
          <Tab text="Recordings" data-tab="recordings" selected={tab === 'recordings'} data-testid="tab-recordings">
            <div className="tab-pane">{tab === 'recordings' && <RecordingsTab project={p} />}</div>
          </Tab>
          <Tab text="Tours" data-tab="tours" selected={tab === 'tours'} data-testid="tab-tours">
            <div className="tab-pane">{tab === 'tours' && <ToursTab project={p} onNeedRecording={() => select('recordings')} />}</div>
          </Tab>
          <Tab text="Tests" data-tab="tests" selected={tab === 'tests'} data-testid="tab-tests">
            <div className="tab-pane">{tab === 'tests' && <TestsTab project={p} onNeedRecording={() => select('recordings')} />}</div>
          </Tab>
          <Tab text="Help" data-tab="help" selected={tab === 'help'} data-testid="tab-help">
            <div className="tab-pane">{tab === 'help' && <HelpTab project={p} />}</div>
          </Tab>
        </TabContainer>
      </div>
    </div>
  )
}
