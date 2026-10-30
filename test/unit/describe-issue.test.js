import { describe, it, expect } from 'vitest'
import { describeIssue } from '../../designer/src/editor/describeIssue.ts'

const doc = {
  steps: [
    { id: 'intro', title: 'Welcome' },
    { id: 's2', title: '' },
  ],
}
const issue = (path) => ({ path, code: 'x', severity: 'error', message: 'Too small' })

describe('describeIssue', () => {
  it('turns step paths into readable locations and links the step', () => {
    expect(describeIssue(issue('steps[0].title'), doc)).toMatchObject({
      stepId: 'intro',
      message: 'Step 1 ("Welcome") → title: Too small',
    })
    expect(describeIssue(issue('steps[1].target.controlId'), doc)).toMatchObject({
      stepId: 's2',
      message: 'Step 2 → target.controlId: Too small',
    })
    expect(describeIssue(issue('steps[1]'), doc).message).toBe('Step 2: Too small')
  })

  it('keeps other paths and path-less messages', () => {
    expect(describeIssue(issue('title'), doc).message).toBe('title: Too small')
    expect(describeIssue(issue(''), doc).message).toBe('Too small')
    expect(describeIssue(issue('steps[9].title'), doc).message).toBe('Step 10 → title: Too small') // a step that no longer exists
  })
})
