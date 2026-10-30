import { describe, expect, it } from 'vitest'
import {
  allFolders,
  buildTree,
  defaultExpanded,
  fileName,
  filterFiles,
  folderOf,
  visibleRows,
} from '../../designer/src/workspace/tree.ts'

const f = (path, status = 'unchanged') => ({ ID: path, path, status })
const files = [
  f('app/webapp/view/Main.view.xml'),
  f('app/webapp/Component.js', 'modified'),
  f('app/webapp/controller/Main.controller.js'),
  f('app/package.json'),
  f('app/webapp/view/Detail.view.xml', 'added'),
  f('app/webapp/view/10.view.xml'),
  f('app/webapp/view/2.view.xml'),
]

describe('workspace tree', () => {
  const tree = buildTree(files)

  it('puts folders before files and sorts numbers naturally', () => {
    const webapp = tree[0].children.find((n) => n.name === 'webapp')
    expect(webapp.children.map((n) => n.name)).toEqual(['controller', 'view', 'Component.js'])
    const view = webapp.children.find((n) => n.name === 'view')
    expect(view.children.map((n) => n.name)).toEqual([
      '2.view.xml',
      '10.view.xml',
      'Detail.view.xml',
      'Main.view.xml',
    ])
  })

  it('marks every folder above a changed file', () => {
    expect(tree[0].changed).toBe(true)
    const webapp = tree[0].children.find((n) => n.name === 'webapp')
    expect(webapp.children.find((n) => n.name === 'controller').changed).toBe(false)
    expect(webapp.children.find((n) => n.name === 'view').changed).toBe(true)
  })

  it('shows the children of open folders only', () => {
    expect(visibleRows(tree, new Set()).map((r) => r.node.path)).toEqual(['app'])
    const rows = visibleRows(tree, new Set(['app']))
    expect(rows.map((r) => r.node.name)).toEqual(['app', 'webapp', 'package.json'])
    expect(rows[1]).toMatchObject({ depth: 1, expanded: false })
  })

  it('opens small projects fully and big ones only at the top', () => {
    expect(defaultExpanded(tree, files.length).size).toBe(allFolders(tree).length)
    expect([...defaultExpanded(tree, 500)]).toEqual(['app'])
  })

  it('filters by every word, in any order and case', () => {
    expect(filterFiles(files, 'VIEW main').map((x) => x.path)).toEqual([
      'app/webapp/view/Main.view.xml',
    ])
    expect(filterFiles(files, '  ')).toBe(files)
    expect(filterFiles(files, 'nothing-like-this')).toEqual([])
  })

  it('splits a path into name and folder', () => {
    expect(fileName('a/b/c.js')).toBe('c.js')
    expect(fileName('c.js')).toBe('c.js')
    expect(folderOf('a/b/c.js')).toBe('a/b')
    expect(folderOf('c.js')).toBe('')
  })
})
