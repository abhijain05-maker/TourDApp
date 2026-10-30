import type { Diagnostic } from '@codemirror/lint'
import { findNodeAtLocation, parse, parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser'
import { validateTour } from '../../../shared/tour-schema.mjs'

/** "steps[2].target.controlId" -> ["steps", 2, "target", "controlId"] */
const segments = (path: string): (string | number)[] =>
  path
    .split(/[.[\]]+/)
    .filter(Boolean)
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s))

/** Pins JSON syntax errors and schema violations to the exact text they belong to. */
export function diagnose(text: string): Diagnostic[] {
  const errors: ParseError[] = []
  const tree = parseTree(text, errors)
  if (errors.length) {
    return errors.map((e) => ({
      from: Math.min(e.offset, text.length),
      to: Math.min(text.length, e.offset + Math.max(e.length, 1)),
      severity: 'error',
      message: printParseErrorCode(e.error),
    }))
  }
  const result = validateTour(parse(text))
  if (result.ok) return []
  return result.issues.map((issue) => {
    let path = segments(issue.path)
    let node: Node | undefined
    // a missing property has no node of its own: highlight the closest parent that exists
    while (tree && path.length && !(node = findNodeAtLocation(tree, path))) path = path.slice(0, -1)
    node ??= tree
    const from = node?.offset ?? 0
    return { from, to: Math.max(from + 1, from + (node?.length ?? 1)), severity: 'error', message: `${issue.path || 'tour'}: ${issue.message}` }
  })
}
