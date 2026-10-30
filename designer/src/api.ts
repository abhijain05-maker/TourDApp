import type {
  ImportResult,
  Inventory,
  Job,
  LintResult,
  ExportCheck,
  ApplyPlan,
  DryRun,
  TestPlanRow,
  FileDetail,
  HelpSetRow,
  FileInfo,
  ExtensionTokenRow,
  PreviewInfo,
  ProviderInfo,
  Project,
  RecordingResult,
  RecordingRow,
  SourceRow,
  TourRow,
  TourVersionRow,
} from './types'
import type { UploadFile } from './intake'

const BASE = '/odata/v4/tour'

/** An error with the message the server sent (already meant for end users). */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('The TourD server is not reachable. Is it running?', 0)
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      message = (await res.json())?.error?.message ?? message
    } catch {
      /* keep the status text */
    }
    throw new ApiError(message, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/** Plain JSON from a route outside the OData service (/preview, ...); errors carry the server's explanation. */
async function getJson<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(path)
  } catch {
    throw new ApiError('The TourD server is not reachable. Is it running?', 0)
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      message = (await res.json())?.error ?? message
    } catch {
      /* keep the status text */
    }
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as T
}

const list = async <T>(path: string) => (await call<{ value: T[] }>('GET', path)).value
const text = async (path: string) => (await call<{ value: string }>('GET', path)).value

export const api = {
  providers: () => list<ProviderInfo>('/providers()'),
  exportCheck: (tourID: string) => getJson<ExportCheck>(`/export/${tourID}/check.json`),
  previewInfo: (projectID: string, controllers: 'stub' | 'real') =>
    getJson<PreviewInfo>(`/preview/${projectID}/info.json?controllers=${controllers}`),

  projects: () => list<Project>('/Projects?$orderby=createdAt desc'),
  project: (id: string) => call<Project>('GET', `/Projects(${id})`),
  createProject: (name: string, description: string) => call<Project>('POST', '/Projects', { name, description }),
  deleteProject: (id: string) => call<void>('DELETE', `/Projects(${id})`),

  countFiles: async (projectID: string) =>
    (await call<{ '@odata.count': number }>('GET', `/Sources?$filter=project_ID eq ${projectID} and deleted eq false&$select=ID&$top=1&$count=true`))['@odata.count'] ?? 0,
  sources: (projectID: string) => list<SourceRow>(`/Sources?$filter=project_ID eq ${projectID} and deleted eq false&$orderby=path`),
  deleteSource: (id: string) => call<void>('DELETE', `/Sources(${id})`),
  importSources: (projectID: string, files: UploadFile[], replace: boolean) =>
    call<ImportResult>('POST', '/importSources', { projectID, files, replace }),
  inventory: async (projectID: string) => JSON.parse(await text(`/getInventory(projectID=${projectID})`)) as Inventory,
  sourceContent: (id: string) => text(`/getSourceContent(sourceID=${id})`),

  // the workspace: read, edit, add, rename, remove and put back files
  file: (id: string) => call<FileDetail>('GET', `/getFile(fileID=${id})`),
  saveFile: (fileID: string, content: string, expectedHash?: string | null) =>
    call<FileInfo>('POST', '/saveFile', { fileID, content, expectedHash }),
  createFile: (projectID: string, path: string, content = '', binary = false) =>
    call<FileInfo>('POST', '/createFile', { projectID, path, content, binary }),
  renameFile: (fileID: string, path: string) => call<FileInfo>('POST', '/renameFile', { fileID, path }),
  deleteFile: (fileID: string) => call<FileInfo>('POST', '/deleteFile', { fileID }),
  revertFile: (fileID: string) => call<FileInfo>('POST', '/revertFile', { fileID }),
  acceptChanges: async (projectID: string, fileIDs: string[] = []) => (await call<{ value: number }>('POST', '/acceptChanges', { projectID, fileIDs })).value,
  testPlans: (projectID: string) => list<TestPlanRow>(`/TestPlans?$filter=project_ID eq ${projectID}&$orderby=modifiedAt desc`),
  testPlan: (id: string) => call<TestPlanRow>('GET', `/TestPlans(${id})`),
  deleteTestPlan: (id: string) => call<void>('DELETE', `/TestPlans(${id})`),
  createTestPlan: (args: { projectID: string; recordingID: string; name: string; settings: object }) =>
    call<TestPlanRow>('POST', '/createTestPlan', { ...args, settings: JSON.stringify(args.settings) }),
  saveTestPlan: (planID: string, definition: string, baseVersion: number) =>
    call<TestPlanRow>('POST', '/saveTestPlan', { planID, definition, baseVersion }),
  rebuildTestPlan: (planID: string) => call<TestPlanRow>('POST', '/rebuildTestPlan', { planID }),
  capability: (scope: 'live' | 'preview', id: string) => text(`/capability(scope='${scope}',id=${id})`),
  dryRunTestPlan: async (planID: string) => JSON.parse(await text(`/dryRunTestPlan(planID=${planID})`)) as DryRun,
  previewTestApply: (planID: string) => call<ApplyPlan>('POST', '/previewTestApply', { planID }),
  applyTestToProject: (planID: string, paths: string[], accept = false) =>
    call<{ applied: number; paths: string[] }>('POST', '/applyTestToProject', { planID, paths, accept }),
  helpSets: (projectID: string) => list<HelpSetRow>(`/HelpSets?$filter=project_ID eq ${projectID}&$orderby=modifiedAt desc`),
  saveHelpSet: (helpID: string, definition: string, baseVersion: number) =>
    call<HelpSetRow>('POST', '/saveHelpSet', { helpID, definition, baseVersion }),
  deleteHelpTopic: (helpID: string, topicID: string) => call<HelpSetRow>('POST', '/deleteHelpTopic', { helpID, topicID }),
  improveHelpTopic: async (args: { projectID: string; topic: object; control?: object; screen?: string; instruction?: string; provider?: string }) =>
    JSON.parse(
      (
        await call<{ value: string }>('POST', '/improveHelpTopic', {
          ...args,
          topic: JSON.stringify(args.topic),
          control: args.control ? JSON.stringify(args.control) : undefined,
        })
      ).value,
    ) as { title: string; summary: string; text: string; note: string; generator: string },
  previewHelpApply: (helpID: string) => call<ApplyPlan>('POST', '/previewHelpApply', { helpID }),
  applyHelpToProject: (helpID: string, paths: string[], accept = false) =>
    call<{ applied: number; paths: string[] }>('POST', '/applyHelpToProject', { helpID, paths, accept }),
  previewTourApply: (tourID: string) => call<ApplyPlan>('POST', '/previewTourApply', { tourID }),
  applyTourToProject: (tourID: string, paths: string[], accept = false) =>
    call<{ applied: number; paths: string[] }>('POST', '/applyTourToProject', { tourID, paths, accept }),
  changes: (projectID: string) => list<FileInfo>(`/getChanges(projectID=${projectID})`),

  recordings: (projectID: string) => list<RecordingRow>(`/Recordings?$filter=project_ID eq ${projectID}&$orderby=createdAt desc`),
  importRecording: (projectID: string, name: string, raw: string, format: string, purpose: string) =>
    call<RecordingResult>('POST', '/importRecording', { projectID, name, raw, format: format || null, purpose }),
  setRecordingPurpose: (recordingID: string, purpose: string) =>
    call<RecordingRow>('POST', '/setRecordingPurpose', { recordingID, purpose }),
  mappedRecording: async (id: string) => JSON.parse(await text(`/getRecording(recordingID=${id})`)),
  deleteRecording: (id: string) => call<void>('DELETE', `/Recordings(${id})`),

  tours: (projectID: string) => list<TourRow>(`/Tours?$filter=project_ID eq ${projectID}&$orderby=modifiedAt desc`),
  tour: (id: string) => call<TourRow>('GET', `/Tours(${id})`),
  deleteTour: (id: string) => call<void>('DELETE', `/Tours(${id})`),
  lintTour: (id: string) => call<LintResult>('GET', `/lintTour(tourID=${id})`),
  generateTour: (args: { projectID: string; recordingID: string; provider: string; model: string; title: string }) =>
    call<Job>('POST', '/generateTour', args),
  job: (id: string) => call<Job>('GET', `/GenerationJobs(${id})`),

  extensionTokens: () => list<ExtensionTokenRow>('/ExtensionTokens?$orderby=createdAt desc'),
  createExtensionToken: (name: string) => call<{ ID: string; name: string; token: string }>('POST', '/createExtensionToken', { name }),
  revokeExtensionToken: (ID: string) => call<{ value: boolean }>('POST', '/revokeExtensionToken', { ID }),

  versions: (tourID: string) => list<TourVersionRow>(`/TourVersions?$filter=tour_ID eq ${tourID}&$orderby=version desc`),
  saveTour: (args: { tourID: string; definition: string; note?: string; autosave?: boolean; baseVersion?: number }) =>
    call<TourRow>('POST', '/saveTour', args),
  restoreVersion: (tourID: string, version: number) => call<TourRow>('POST', '/restoreVersion', { tourID, version }),
  refineStep: (args: { tourID: string; stepID: string; instruction: string; provider: string; model: string }) =>
    call<TourRow>('POST', '/refineStep', args),
}
