// Light and dark appearance. "auto" follows the operating system. The choice is remembered per browser; the UI5
// components switch their theme, and everything of our own is drawn with their colour variables, so it follows.
import { useSyncExternalStore } from 'react'
import { setTheme } from '@ui5/webcomponents-base/dist/config/Theme.js'

export type ThemeChoice = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'tourd.theme'
const EVENT = 'tourd:theme'

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

const prefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export const resolve = (choice: ThemeChoice): ResolvedTheme => (choice === 'auto' ? (prefersDark() ? 'dark' : 'light') : choice)

let choice: ThemeChoice = read()

function apply() {
  const resolved = resolve(choice)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  void setTheme(resolved === 'dark' ? 'sap_horizon_dark' : 'sap_horizon')
  window.dispatchEvent(new Event(EVENT))
}

/** Call once at start. */
export function initTheme() {
  apply()
  if (typeof matchMedia === 'function')
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (choice === 'auto') apply()
    })
}

export function setThemeChoice(next: ThemeChoice) {
  choice = next
  try {
    if (next === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    /* a remembered choice is only a convenience */
  }
  apply()
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}

/** The theme in use right now, and the way to change the choice. */
export function useTheme() {
  // the snapshot is the choice itself: "auto" to "light" on a light system changes nothing visible, but the label must follow
  const current = useSyncExternalStore(subscribe, () => choice, () => 'auto' as ThemeChoice)
  const resolved = useSyncExternalStore(subscribe, () => resolve(choice), () => 'light' as ResolvedTheme)
  return { choice: current, resolved, setChoice: setThemeChoice }
}
