// Chrome DevTools Recorder export (JSON) -> normalised recording.
// The format is the "UserFlow" schema of @puppeteer/replay: { title, steps: [{ type, selectors, ... }] }.
import { normalizeHash } from '../parsers/manifest.js'

export const FORMAT = 'devtools-recorder'

const STEP_TYPES = new Set([
  'setViewport',
  'navigate',
  'click',
  'doubleClick',
  'hover',
  'change',
  'keyDown',
  'keyUp',
  'scroll',
  'waitForElement',
  'waitForExpression',
  'emulateNetworkConditions',
  'close',
  'customStep',
])

function toObject(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw.replace(/^﻿/, ''))
  } catch {
    return null
  }
}

/** URL -> router hash ("#/order/new" -> "order/new"; Fiori launchpad "#Shell-home&/order/new" -> "order/new"). */
export function routerHashOf(url) {
  let hash
  try {
    hash = new URL(url).hash.replace(/^#/, '')
  } catch {
    hash = String(url).includes('#') ? String(url).slice(String(url).indexOf('#') + 1) : ''
  }
  const inner = hash.indexOf('&/')
  return normalizeHash(inner >= 0 ? hash.slice(inner + 2) : hash)
}

export function detect(raw) {
  const flow = toObject(raw)
  return (
    !!flow &&
    Array.isArray(flow.steps) &&
    flow.steps.length > 0 &&
    flow.steps.every((s) => s && typeof s.type === 'string') &&
    flow.steps.some((s) => STEP_TYPES.has(s.type))
  )
}

const flatten = (selectors = []) =>
  selectors.flatMap((s) => (Array.isArray(s) ? s : [s])).filter((s) => typeof s === 'string')

function domOf(step) {
  const selectors = flatten(step.selectors)
  const aria = selectors.find((s) => s.startsWith('aria/'))
  const text = selectors.find((s) => s.startsWith('text/'))
  return {
    selectors,
    ariaLabel: aria ? aria.slice(5).replace(/\[role="[^"]*"\]$/, '') : null,
    text: text ? text.slice(5) : null,
  }
}

export function parse(raw) {
  const flow = toObject(raw)
  if (!detect(flow))
    throw new Error(
      'Not a Chrome DevTools Recorder export (expected { "steps": [ { "type": ... } ] })',
    )
  const steps = []
  let skipped = 0
  let startUrl = null

  flow.steps.forEach((s, index) => {
    const base = { index, source: FORMAT }
    switch (s.type) {
      case 'navigate':
        if (startUrl === null) startUrl = s.url
        steps.push({ ...base, action: 'navigate', url: s.url, hash: routerHashOf(s.url) })
        break
      case 'click':
      case 'doubleClick': {
        const nav = (s.assertedEvents ?? []).find((e) => e.type === 'navigation' && e.url)
        steps.push({
          ...base,
          action: 'click',
          dom: domOf(s),
          ...(nav ? { navigatesTo: routerHashOf(nav.url) } : {}),
        })
        break
      }
      case 'change':
        steps.push({ ...base, action: 'input', value: String(s.value ?? ''), dom: domOf(s) })
        break
      case 'keyDown':
        if (s.key === 'Enter' || s.key === 'Escape')
          steps.push({ ...base, action: 'key', value: s.key })
        else skipped++
        break
      default:
        skipped++ // viewport, hover, scroll, waits, keyUp, ... carry no tour-relevant intent
    }
  })

  return { format: FORMAT, title: flow.title ?? null, startUrl, steps, skipped }
}
