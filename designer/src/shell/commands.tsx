// What the command palette (Ctrl+K) offers. Screens register their own commands while they are shown.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface Command {
  id: string
  title: string
  /** shown right of the title, e.g. the folder of a file */
  hint?: string
  group: string
  run: () => void
  /** more words that find the command */
  keywords?: string
}

interface Registry {
  register: (owner: string, commands: Command[]) => () => void
  commands: Command[]
}

const Ctx = createContext<Registry>({ register: () => () => {}, commands: [] })

export function CommandsProvider({ children }: { children: ReactNode }) {
  const [byOwner, setByOwner] = useState<Record<string, Command[]>>({})
  const register = useCallback((owner: string, commands: Command[]) => {
    setByOwner((all) => ({ ...all, [owner]: commands }))
    return () =>
      setByOwner((all) => {
        const { [owner]: _gone, ...rest } = all
        void _gone
        return rest
      })
  }, [])
  const value = useMemo(() => ({ register, commands: Object.values(byOwner).flat() }), [register, byOwner])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Offers commands while the calling component is mounted. `commands` should be memoised. */
export function useRegisterCommands(owner: string, commands: Command[]) {
  const { register } = useContext(Ctx)
  useEffect(() => register(owner, commands), [register, owner, commands])
}

export const useCommands = () => useContext(Ctx).commands

/** Every word must appear in the title, the hint, the group or the keywords; earlier hits first. */
export function searchCommands(commands: Command[], query: string, limit = 50): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return commands.slice(0, limit)
  const scored: { c: Command; score: number }[] = []
  for (const c of commands) {
    const title = c.title.toLowerCase()
    const hay = `${title} ${c.hint ?? ''} ${c.group} ${c.keywords ?? ''}`.toLowerCase()
    if (!words.every((w) => hay.includes(w))) continue
    const first = title.indexOf(words[0])
    scored.push({ c, score: first >= 0 ? first : 1000 + hay.indexOf(words[0]) })
  }
  return scored.sort((a, b) => a.score - b.score || a.c.title.length - b.c.title.length).slice(0, limit).map((s) => s.c)
}
