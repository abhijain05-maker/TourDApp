// The file list of a project as a tree: folders first, then files, both alphabetical.
import type { FileStatus } from '../types'

export interface FileLike {
  ID: string
  path: string
  status?: FileStatus
}

export interface TreeNode<F extends FileLike = FileLike> {
  name: string
  path: string
  type: 'dir' | 'file'
  children: TreeNode<F>[]
  file?: F
  /** a folder: does something below it differ from the upload? */
  changed: boolean
}

const compare = (a: TreeNode, b: TreeNode) =>
  a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

export function buildTree<F extends FileLike>(files: F[]): TreeNode<F>[] {
  const root: TreeNode<F> = { name: '', path: '', type: 'dir', children: [], changed: false }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const last = i === parts.length - 1
      let next = node.children.find((c) => c.name === name && c.type === (last ? 'file' : 'dir'))
      if (!next) {
        next = { name, path, type: last ? 'file' : 'dir', children: [], changed: false }
        if (last) next.file = file
        node.children.push(next)
      }
      node = next
    })
  }
  const finish = (n: TreeNode<F>): boolean => {
    n.children.sort(compare as (a: TreeNode<F>, b: TreeNode<F>) => number)
    let changed = n.type === 'file' && !!n.file?.status && n.file.status !== 'unchanged'
    for (const c of n.children) changed = finish(c) || changed
    n.changed = changed
    return changed
  }
  finish(root)
  return root.children
}

export interface Row<F extends FileLike = FileLike> {
  node: TreeNode<F>
  depth: number
  expanded: boolean
}

/** The rows that are visible: a folder's children only while it is open. */
export function visibleRows<F extends FileLike>(nodes: TreeNode<F>[], expanded: ReadonlySet<string>, depth = 0): Row<F>[] {
  const rows: Row<F>[] = []
  for (const node of nodes) {
    const open = node.type === 'dir' && expanded.has(node.path)
    rows.push({ node, depth, expanded: open })
    if (open) rows.push(...visibleRows(node.children, expanded, depth + 1))
  }
  return rows
}

/** Every folder path of the tree. */
export function allFolders(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.type === 'dir' ? [n.path, ...allFolders(n.children)] : []))
}

/** Small projects open fully; big ones only show their top folders. */
export function defaultExpanded(nodes: TreeNode[], fileCount: number): Set<string> {
  if (fileCount <= 80) return new Set(allFolders(nodes))
  return new Set(nodes.filter((n) => n.type === 'dir').map((n) => n.path))
}

/** Files whose path contains every word of the query (any order, any case). */
export function filterFiles<F extends FileLike>(files: F[], query: string): F[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return files
  return files.filter((f) => words.every((w) => f.path.toLowerCase().includes(w)))
}

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
