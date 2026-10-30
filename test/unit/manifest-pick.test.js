import { describe, it, expect } from 'vitest'
import { buildInventory, pickManifest } from '../../srv/lib/context/inventory.js'
import { buildPreviewApp } from '../../srv/lib/preview/model.js'
import { demoSources } from '../helpers/sources.js'

// A project may hold several manifest.json files (test mocks, build output): the app's is the one closest to the root.
const withMock = () => [
  ...demoSources(),
  {
    path: 'webapp/test/mock/manifest.json',
    content: JSON.stringify({ 'sap.app': { id: 'mock.app' } }),
  },
]

describe('which manifest.json is the app', () => {
  it('is the one closest to the root, whatever the order of the files', () => {
    const paths = ['a/b/c/manifest.json', 'a/manifest.json', 'a/z/manifest.json'].map((path) => ({
      path,
    }))
    expect(pickManifest(paths).path).toBe('a/manifest.json')
    expect(pickManifest([...paths].reverse()).path).toBe('a/manifest.json')
    expect(pickManifest([])).toBeUndefined()
  })

  it('decides the app id of the inventory and of the sandbox copy', () => {
    for (const sources of [withMock(), withMock().reverse()]) {
      expect(buildInventory(sources).appId).toBe('demo.orders')
      expect(buildPreviewApp(sources).appId).toBe('demo.orders')
    }
  })
})
