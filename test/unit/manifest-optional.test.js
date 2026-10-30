import { describe, it, expect } from 'vitest'
import { matchRoute } from '../../srv/lib/parsers/manifest.js'

// UI5 (crossroads) lets an optional segment take its slash with it: "list/:filter:" opens "list" as well as "list/open"
describe('matchRoute: optional segments', () => {
  const routes = [
    { name: 'list', pattern: 'list/:filter:', params: ['filter'] },
    { name: 'item', pattern: 'item/{id}/:tab:', params: ['id', 'tab'] },
    { name: 'search', pattern: 'search/:?query:', params: [] },
  ]

  it('matches with and without the optional part', () => {
    expect(matchRoute(routes, 'list')).toMatchObject({ route: { name: 'list' }, args: {} })
    expect(matchRoute(routes, 'list/')).toMatchObject({ route: { name: 'list' } })
    expect(matchRoute(routes, 'list/open')).toMatchObject({
      route: { name: 'list' },
      args: { filter: 'open' },
    })
    expect(matchRoute(routes, 'item/7')).toMatchObject({
      route: { name: 'item' },
      args: { id: '7' },
    })
    expect(matchRoute(routes, 'item/7/notes')).toMatchObject({ args: { id: '7', tab: 'notes' } })
    expect(matchRoute(routes, 'search')).toMatchObject({ route: { name: 'search' } })
  })

  it('still rejects what is not the route', () => {
    expect(matchRoute(routes, 'lists')).toBeNull()
    expect(matchRoute(routes, 'item')).toBeNull()
    expect(matchRoute(routes, 'list/a/b')).toBeNull()
  })
})
