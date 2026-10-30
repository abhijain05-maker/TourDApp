// State of the tour editor: the working copy with undo/redo, the selected step, live validation and a
// debounced autosave that never overwrites a newer version saved elsewhere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api'
import type { TourDocument, TourRow } from '../types'
import { validateTour } from '../../../shared/tour-schema.mjs'
import { canRedo, canUndo, createHistory, push, redo, undo, type History } from './history'

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'invalid' | 'conflict' | 'error'

const AUTOSAVE_DELAY_MS = 1200

export function useTourEditor(tour: TourRow) {
  const qc = useQueryClient()
  const initial = useMemo(() => JSON.parse(tour.definition) as TourDocument, [tour.definition])
  const [history, setHistory] = useState<History<TourDocument>>(() => createHistory(initial))
  const [selectedId, setSelectedId] = useState<string>(initial.steps[0]?.id ?? '')
  const [state, setState] = useState<SaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(tour.version)
  const saved = useRef({ json: tour.definition, version: tour.version })
  const latest = useRef(history.present)
  latest.current = history.present

  const doc = history.present
  const validation = useMemo(() => validateTour(doc), [doc])
  const selected = doc.steps.find((s) => s.id === selectedId) ?? doc.steps[0]

  // keep the selection valid after undo, restore or deletion
  useEffect(() => {
    if (doc.steps.length && !doc.steps.some((s) => s.id === selectedId)) setSelectedId(doc.steps[0].id)
  }, [doc, selectedId])

  const commit = useCallback((next: TourDocument, key?: string) => setHistory((h) => push(h, next, { key })), [])

  const afterSave = useCallback(
    (row: TourRow, sentJson: string) => {
      saved.current = { json: sentJson, version: row.version }
      setVersion(row.version)
      setError(null)
      setState(JSON.stringify(latest.current) === sentJson ? 'saved' : 'unsaved')
      void qc.invalidateQueries({ queryKey: ['tours', tour.project_ID] })
      void qc.invalidateQueries({ queryKey: ['versions', tour.ID] })
      void qc.invalidateQueries({ queryKey: ['lint', tour.ID] })
    },
    [qc, tour.ID, tour.project_ID],
  )

  // One save at a time: a second request built on the same base version would be rejected as "changed elsewhere"
  // (the first one is still on its way), and the user would see a conflict with their own work.
  const inflight = useRef<Promise<boolean> | null>(null)
  const settled = useCallback(async () => {
    while (inflight.current) await inflight.current
  }, [])

  const save = useCallback(
    async (options: { note?: string; autosave: boolean }) => {
      await settled()
      const json = JSON.stringify(latest.current)
      if (options.autosave && json === saved.current.json) return true // the save we waited for already stored it
      setState('saving')
      const run = (async () => {
        try {
          const row = await api.saveTour({ tourID: tour.ID, definition: json, note: options.note, autosave: options.autosave, baseVersion: saved.current.version })
          afterSave(row, json)
          return true
        } catch (e) {
          const conflict = e instanceof ApiError && e.status === 409
          setState(conflict ? 'conflict' : 'error')
          setError(e instanceof Error ? e.message : String(e))
          return false
        }
      })()
      inflight.current = run
      try {
        return await run
      } finally {
        if (inflight.current === run) inflight.current = null
      }
    },
    [afterSave, settled, tour.ID],
  )

  // debounced autosave
  useEffect(() => {
    const json = JSON.stringify(doc)
    if (json === saved.current.json) {
      setState((s) => (s === 'conflict' || s === 'error' ? s : 'saved'))
      return
    }
    if (!validation.ok) {
      setState('invalid')
      return
    }
    setState((s) => (s === 'conflict' ? s : 'unsaved'))
    if (state === 'conflict') return
    const timer = setTimeout(() => void save({ autosave: true }), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `state` is read, not a trigger
  }, [doc, validation.ok, save])

  /** Saves now (used before actions that work on the stored tour, like asking the AI). */
  const flush = useCallback(async () => {
    await settled() // a save that is already on its way counts
    if (JSON.stringify(latest.current) === saved.current.json) return true
    if (!validateTour(latest.current).ok) return false
    return save({ autosave: true })
  }, [save, settled])

  /** Takes over a tour the server changed (AI edit, restored version); the edit stays undoable. */
  const adopt = useCallback(
    (row: TourRow) => {
      saved.current = { json: row.definition, version: row.version }
      setVersion(row.version)
      setHistory((h) => push(h, JSON.parse(row.definition) as TourDocument))
      setState('saved')
      setError(null)
      void qc.invalidateQueries({ queryKey: ['tours', tour.project_ID] })
      void qc.invalidateQueries({ queryKey: ['versions', tour.ID] })
      void qc.invalidateQueries({ queryKey: ['lint', tour.ID] })
    },
    [qc, tour.ID, tour.project_ID],
  )

  return {
    doc,
    commit,
    selected,
    selectedId: selected?.id ?? '',
    setSelectedId,
    validation,
    state,
    error,
    version,
    undo: () => setHistory(undo),
    redo: () => setHistory(redo),
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    flush,
    adopt,
    saveVersion: (note: string) => save({ note, autosave: false }),
  }
}
