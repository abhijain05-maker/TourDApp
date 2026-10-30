// A small in-memory rate limiter (fixed window per key). Enough to keep one stray extension or script from hammering
// a single instance; it is per process, so it is not a substitute for a gateway in front of several instances.
export function createLimiter({ windowMs = 60_000, max = 120, now = () => Date.now() } = {}) {
  const hits = new Map()
  return {
    /** @returns {{ok: boolean, retryAfter: number}} retryAfter in seconds */
    take(key) {
      const t = now()
      let e = hits.get(key)
      if (!e || t >= e.reset) {
        e = { count: 0, reset: t + windowMs }
        hits.set(key, e)
        // forget keys that are long over, so the map cannot grow without end
        if (hits.size > 5000) for (const [k, v] of hits) if (t >= v.reset) hits.delete(k)
      }
      e.count++
      return { ok: e.count <= max, retryAfter: Math.max(1, Math.ceil((e.reset - t) / 1000)) }
    },
  }
}
