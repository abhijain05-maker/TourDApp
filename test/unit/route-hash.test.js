import { describe, it, expect } from 'vitest'
import { hashFor } from '../../designer/src/editor/routeHash.ts'
import { matchRoute } from '../../srv/lib/parsers/manifest.js'

describe('hashFor (the hash that opens a route)', () => {
  it('fills required parameters and drops optional parts and queries', () => {
    expect(hashFor('')).toBe('')
    expect(hashFor('order/{orderId}')).toBe('order/1')
    expect(hashFor('order/{orderId}/item/{itemId}')).toBe('order/1/item/1')
    expect(hashFor('list/:filter:')).toBe('list')
    expect(hashFor('list/{?query}')).toBe('list')
    expect(hashFor('list/:?query:')).toBe('list')
    expect(hashFor('files/{path*}')).toBe('files/1')
  })

  it('always gives a hash the same route matches', () => {
    const routes = [
      { name: 'main', pattern: '', params: [] },
      { name: 'detail', pattern: 'order/{orderId}', params: ['orderId'] },
      { name: 'list', pattern: 'list/:filter:', params: ['filter'] },
    ]
    for (const r of routes) expect(matchRoute(routes, hashFor(r.pattern))?.route.name).toBe(r.name)
  })
})
