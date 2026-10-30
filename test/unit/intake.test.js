import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  chunkFiles,
  isIncluded,
  kindOf,
  looksBinary,
  MAX_BINARY_BYTES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  normalizePath,
  readFiles,
  readZip,
  toBase64,
} from '../../designer/src/intake.ts'
import { loadSources } from '../helpers/sources.js'

// A File as the folder picker delivers it: name plus webkitRelativePath.
const file = (path, content = 'x') => {
  const f = new File([content], path.split('/').pop())
  Object.defineProperty(f, 'webkitRelativePath', { value: path })
  return f
}
const zip = (entries) =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]),
    ),
  )
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255])

describe('kindOf / isIncluded', () => {
  it('classifies the files the server understands (same rules as the inventory builder)', () => {
    expect(kindOf('webapp/manifest.json')).toBe('manifest')
    expect(kindOf('manifest.json')).toBe('manifest')
    expect(kindOf('webapp/view/Main.view.xml')).toBe('view')
    expect(kindOf('webapp/fragment/A.fragment.xml')).toBe('fragment')
    expect(kindOf('webapp/controller/Main.controller.ts')).toBe('controller')
    expect(kindOf('webapp/i18n/i18n_de.properties')).toBe('i18n')
    expect(kindOf('webapp/Component.js')).toBeNull()
    expect(kindOf('package.json')).toBeNull()
  })

  it('leaves out dependencies, build output, version control, secrets and clutter - and nothing else', () => {
    for (const p of [
      'node_modules/x/manifest.json',
      'dist/manifest.json',
      'a/.git/b.view.xml',
      '__MACOSX/webapp/x.view.xml',
      '.env',
      'app/.env.local',
      'certs/server.pem',
      'default-env.json',
      '.npmrc',
      'webapp/.DS_Store',
    ]) {
      expect(isIncluded(p), p).toBe(false)
    }
    for (const p of [
      'webapp/view/Main.view.xml',
      'webapp/Component.js',
      'package.json',
      'webapp/css/style.css',
      'webapp/img/logo.png',
      'README.md',
      '.gitignore',
      'ui5.yaml',
    ]) {
      expect(isIncluded(p), p).toBe(true)
    }
  })

  it('normalises windows and relative paths', () => {
    expect(normalizePath(String.raw`.\webapp\view\A.view.xml`)).toBe('webapp/view/A.view.xml')
    expect(normalizePath('/webapp/x')).toBe('webapp/x')
  })

  it('tells binary from text by extension, and by NUL bytes', () => {
    expect(looksBinary('a/logo.png', new Uint8Array([65]))).toBe(true)
    expect(looksBinary('a/x.txt', new Uint8Array([65, 0, 66]))).toBe(true)
    expect(looksBinary('a/x.txt', strToU8('plain text'))).toBe(false)
    expect(toBase64(PNG)).toBe(Buffer.from(PNG).toString('base64'))
    expect(toBase64(new Uint8Array(100_000))).toBe(Buffer.alloc(100_000).toString('base64')) // long input in pieces
  })
})

describe('readFiles (folder / file picker)', () => {
  it('reads the whole project, text as text and pictures as base64, and counts what is left out', async () => {
    const r = await readFiles([
      file('app/webapp/manifest.json', '{}'),
      file('app/webapp/view/Main.view.xml', '<v/>'),
      file('app/webapp/Component.js', 'x'),
      file('app/node_modules/lib/x.view.xml'),
      file('app/.env', 'KEY=1'),
      file('app/webapp/img/logo.png', new Uint8Array([1, 2, 3])),
    ])
    expect(r.files.map((f) => f.path)).toEqual([
      'app/webapp/manifest.json',
      'app/webapp/view/Main.view.xml',
      'app/webapp/Component.js',
      'app/webapp/img/logo.png',
    ])
    expect(r.files[1].content).toBe('<v/>')
    expect(r.files[3]).toEqual({ path: 'app/webapp/img/logo.png', content: 'AQID', binary: true })
    expect(r.ignored).toBe(2)
    expect(r.skipped).toEqual([])
  })

  it('works with plain file picks that have no relative path', async () => {
    const f = new File(['<v/>'], 'Main.view.xml')
    expect((await readFiles([f])).files.map((x) => x.path)).toEqual(['Main.view.xml'])
  })

  it('skips files over the size limits and says why', async () => {
    const big = file('w/big.view.xml', 'x'.repeat(MAX_FILE_BYTES + 1))
    const bigPicture = file('w/big.png', new Uint8Array(MAX_BINARY_BYTES + 1))
    const r = await readFiles([big, bigPicture, file('w/ok.view.xml')])
    expect(r.files.map((f) => f.path)).toEqual(['w/ok.view.xml'])
    expect(r.skipped).toEqual([
      { path: 'w/big.view.xml', reason: expect.stringContaining('larger than 1 MB') },
      { path: 'w/big.png', reason: expect.stringContaining('larger than 2 MB') },
    ])
  })

  it('stops at the total limit', async () => {
    const part = 'x'.repeat(MAX_FILE_BYTES - 10)
    const many = Array.from({ length: 30 }, (_, i) => file(`w/V${i}.view.xml`, part))
    const r = await readFiles(many)
    expect(r.files.length).toBeLessThanOrEqual(MAX_TOTAL_BYTES / (MAX_FILE_BYTES - 10))
    expect(r.skipped.length).toBeGreaterThan(0)
    expect(r.skipped[0].reason).toContain('limit')
  })

  it('keeps several manifest.json files (the server picks the one closest to the root)', async () => {
    const r = await readFiles([
      file('app/webapp/manifest.json', '{}'),
      file('app/webapp/test/mock/manifest.json', '{}'),
    ])
    expect(r.files).toHaveLength(2)
    expect(r.skipped).toEqual([])
  })
})

describe('readZip', () => {
  it('extracts the wanted entries with decoded text, and leaves out the unwanted ones', () => {
    const r = readZip(
      zip({
        'webapp/manifest.json': '{"a":1}',
        'webapp/view/Ä.view.xml': '<v>é</v>',
        'webapp/Component.js': 'x',
        'dist/manifest.json': 'x',
        '.env': 'SECRET=1',
        'webapp/img/logo.png': PNG,
      }),
    )
    expect(r.files.map((f) => f.path).sort()).toEqual([
      'webapp/Component.js',
      'webapp/img/logo.png',
      'webapp/manifest.json',
      'webapp/view/Ä.view.xml',
    ])
    expect(r.files.find((f) => f.path.endsWith('.view.xml')).content).toBe('<v>é</v>')
    expect(r.files.find((f) => f.path.endsWith('.png'))).toMatchObject({
      binary: true,
      content: toBase64(PNG),
    })
    expect(r.ignored).toBe(2)
  })

  it('refuses unsafe paths instead of extracting them', () => {
    const r = readZip(
      zip({ '../evil/manifest.json': '{}', 'a/../../b.view.xml': '<v/>', 'ok/A.view.xml': '<v/>' }),
    )
    expect(r.files.map((f) => f.path)).toEqual(['ok/A.view.xml'])
    expect(r.skipped.map((s) => s.reason)).toEqual(['unsafe path', 'unsafe path'])
  })

  it('does not inflate oversized entries (zip bomb) and respects the total limit', () => {
    const bomb = zip({ 'w/bomb.view.xml': 'a'.repeat(MAX_FILE_BYTES * 3), 'w/ok.view.xml': '<v/>' })
    expect(bomb.length).toBeLessThan(10_000) // compresses to almost nothing
    const r = readZip(bomb)
    expect(r.files.map((f) => f.path)).toEqual(['w/ok.view.xml'])
    expect(r.skipped[0]).toMatchObject({ path: 'w/bomb.view.xml' })
  })

  it('rejects things that are not zips', () => {
    expect(() => readZip(strToU8('definitely not a zip file'))).toThrow(/not a readable zip/)
  })

  it('reads a zipped copy of the demo app like the folder', () => {
    const sources = loadSources('samples/demo-app', 'samples/demo-app')
    const archive = zip(Object.fromEntries(sources.map((s) => [s.path, s.content])))
    const r = readZip(archive)
    expect(r.files).toHaveLength(sources.length)
    expect(r.files.map((f) => f.path)).toContain('webapp/view/Main.view.xml')
    expect(r.files.map((f) => f.path)).toContain('package.json')
  })
})

describe('chunkFiles', () => {
  it('splits by byte size and keeps order', () => {
    const files = ['a', 'b', 'c', 'd'].map((p) => ({ path: p, content: 'x'.repeat(40) }))
    expect(chunkFiles(files, 100).map((c) => c.map((f) => f.path))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(chunkFiles(files, 1000)).toHaveLength(1)
    expect(chunkFiles([], 100)).toEqual([])
  })

  it('counts bytes, not characters, and base64 by its length', () => {
    const files = [
      { path: 'a', content: 'é'.repeat(30) },
      { path: 'b', content: 'é'.repeat(30) },
    ]
    expect(chunkFiles(files, 100)).toHaveLength(2) // 60 bytes each
    const pictures = [
      { path: 'a.png', content: 'A'.repeat(60), binary: true },
      { path: 'b.png', content: 'A'.repeat(60), binary: true },
    ]
    expect(chunkFiles(pictures, 100)).toHaveLength(2)
  })
})
