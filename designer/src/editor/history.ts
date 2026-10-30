// Undo/redo for any immutable value. Rapid edits with the same key (typing in one field) are merged into
// a single undo step, so Ctrl+Z reverts a whole word or sentence instead of one character.

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  lastKey: string | null
  lastAt: number
}

const LIMIT = 100
const COALESCE_MS = 1000

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], lastKey: null, lastAt: 0 })

export function push<T>(h: History<T>, next: T, options: { key?: string; now?: number } = {}): History<T> {
  if (next === h.present) return h
  const now = options.now ?? Date.now()
  const key = options.key ?? null
  const merge = key !== null && key === h.lastKey && now - h.lastAt < COALESCE_MS && h.past.length > 0
  return {
    past: merge ? h.past : [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: now,
  }
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: null, lastAt: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: null, lastAt: 0 }
}

export const canUndo = (h: History<unknown>) => h.past.length > 0
export const canRedo = (h: History<unknown>) => h.future.length > 0
