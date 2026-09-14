/**
 * What the main process complained about, kept for the log screen.
 *
 * Everything here used to go to the console and nowhere else, which a packaged
 * app has no window on. The ring holds the last few hundred so an operator can
 * see this morning's collection error without a terminal; the console still
 * gets every line, since a developer's run reads it there.
 */

export type DiagnosticLevel = 'error' | 'warn'

export interface DiagnosticEntry {
  readonly atMs: number
  readonly level: DiagnosticLevel
  /** The subsystem that spoke, as the console prefix has always named it. */
  readonly tag: string
  readonly text: string
}

export interface DiagnosticsLog {
  error(tag: string, detail: unknown): void
  warn(tag: string, detail: unknown): void
  /** Oldest first, as a copy. */
  recent(): readonly DiagnosticEntry[]
}

interface ConsoleSink {
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
}

/** One line, whatever came in: an Error by name and message, an object as json. */
function describe(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`
  if (typeof detail === 'string') return detail
  if (detail !== null && typeof detail === 'object') return JSON.stringify(detail)
  return String(detail)
}

export function createDiagnosticsLog(deps: {
  readonly capacity: number
  readonly now: () => number
  readonly sink?: ConsoleSink
}): DiagnosticsLog {
  const sink = deps.sink ?? console
  let entries: readonly DiagnosticEntry[] = []

  const record = (level: DiagnosticLevel, tag: string, detail: unknown): void => {
    sink[level](`[${tag}]`, detail)
    const entry: DiagnosticEntry = { atMs: deps.now(), level, tag, text: describe(detail) }
    entries = [...entries, entry].slice(-deps.capacity)
  }

  return {
    error: (tag, detail) => record('error', tag, detail),
    warn: (tag, detail) => record('warn', tag, detail),
    recent: () => [...entries],
  }
}
