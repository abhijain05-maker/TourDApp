import { describe, it, expect } from 'vitest'
import { check, mint } from '../../srv/lib/capability.js'
import { createLimiter } from '../../srv/lib/rate-limit.js'
import { roleNeeded } from '../../srv/lib/service/authz.js'

describe('capability tokens', () => {
  it('are good for their scope until they expire, and for nothing else', () => {
    const now = 1_000_000_000_000
    const t = mint('preview:p1', { now, ttl: 60_000 })
    expect(check('preview:p1', t, { now })).toBe(true)
    expect(check('preview:p1', t, { now: now + 59_000 })).toBe(true)
    expect(check('preview:p1', t, { now: now + 61_000 })).toBe(false)
    expect(check('preview:p2', t, { now })).toBe(false)
    expect(check('live:p1', t, { now })).toBe(false)
  })

  it('cannot be forged or changed', () => {
    const now = Date.now()
    const t = mint('live:x', { now })
    const [expiry, sig] = t.split('.')
    expect(check('live:x', `${expiry}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, { now })).toBe(false)
    expect(check('live:x', `${(parseInt(expiry, 36) + 1000).toString(36)}.${sig}`, { now })).toBe(false) // a longer life
    expect(check('live:x', mint('live:x', { now, secret: 'another secret' }), { now })).toBe(false)
    for (const bad of [undefined, null, '', 'x', '.', 'a.b.c', 'zzz.', `${'x'.repeat(200)}.y`, 12, {}]) expect(check('live:x', bad, { now })).toBe(false)
  })
})

describe('rate limiter', () => {
  it('lets a number of requests through per window and key, then says how long to wait', () => {
    let t = 0
    const l = createLimiter({ windowMs: 10_000, max: 3, now: () => t })
    expect([1, 2, 3].map(() => l.take('a').ok)).toEqual([true, true, true])
    const blocked = l.take('a')
    expect(blocked).toEqual({ ok: false, retryAfter: 10 })
    expect(l.take('b').ok).toBe(true) // another key
    t = 4_000
    expect(l.take('a')).toEqual({ ok: false, retryAfter: 6 })
    t = 10_000 // a new window
    expect(l.take('a').ok).toBe(true)
  })

  it('forgets old keys', () => {
    let t = 0
    const l = createLimiter({ windowMs: 1000, max: 1, now: () => t })
    for (let i = 0; i < 6000; i++) l.take(`k${i}`)
    t = 5000
    expect(l.take('fresh').ok).toBe(true)
  })
})

describe('roleNeeded', () => {
  it('reading needs a viewer, changing an editor, sending a recording an extension', () => {
    expect(roleNeeded('GET', 'READ')).toBe('Viewer')
    expect(roleNeeded('get', 'getFile')).toBe('Viewer')
    expect(roleNeeded('POST', 'saveFile')).toBe('Editor')
    expect(roleNeeded('DELETE', 'DELETE')).toBe('Editor')
    expect(roleNeeded('POST', 'importRecording')).toBe('Extension')
  })
})
