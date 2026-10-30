// Schema problems come with a technical path ("steps[2].title"); in the editor they read "Step 3 -> title: ...".
import type { LintIssue, TourDocument } from '../types'

export function describeIssue(issue: LintIssue, doc: Pick<TourDocument, 'steps'>): LintIssue {
  const m = /^steps\[(\d+)\](?:\.(.+))?$/.exec(issue.path)
  if (!m) return { ...issue, message: issue.path ? `${issue.path}: ${issue.message}` : issue.message }
  const index = Number(m[1])
  const step = doc.steps?.[index]
  const where = `Step ${index + 1}${step?.title ? ` ("${step.title}")` : ''}`
  return { ...issue, stepId: step?.id ?? issue.stepId, message: `${where}${m[2] ? ` → ${m[2]}` : ''}: ${issue.message}` }
}
