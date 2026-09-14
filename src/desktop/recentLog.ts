import { TEXT } from '../shared/text.js'
import type { CollectionRunSummary } from './collection-db/statusQuery.js'
import type { DiagnosticEntry } from './diagnosticsLog.js'
import { parseStamp } from './refusalLog.js'

/**
 * The log screen's one timeline, merged from the three places the app writes
 * things down: the session log file, the collection database's runs, and the
 * main process's own complaints. Each becomes one line with an instant, so
 * the screen can lay them together and an operator reads the night in order.
 */

export type LogSource = 'session' | 'refusal' | 'collection' | 'diagnostic'

export interface LogEntry {
  readonly atMs: number
  readonly source: LogSource
  readonly text: string
}

/** `stamp KST  rest` — the stamp and the unit go, the rest is the line. */
const SESSION_HEAD = /^\S+ \S+ KST\s+/

/**
 * A refused session's line, as `formatSessionLine` writes it: automation and
 * mode, then `refused` in the field where an opened session says `opened`.
 * Fields are two spaces apart, which is what keeps a nickname or a reason
 * that merely contains the word from matching.
 */
const REFUSED_FIELD = /^\S+  \S+  refused /

function fromSessionLine(line: string): LogEntry | null {
  const atMs = parseStamp(line)
  if (atMs === null) return null
  const text = line.replace(SESSION_HEAD, '')
  return { atMs, source: REFUSED_FIELD.test(text) ? 'refusal' : 'session', text }
}

function fromCollectionRun(run: CollectionRunSummary): LogEntry {
  return {
    // Placed at its start: a block is remembered as the one that began at
    // half past, and its end is in the text where it stopped early.
    atMs: run.startedAtMs,
    source: 'collection',
    text: TEXT.log.collectionRun(run.status, run.collectionPages, run.insertedPostCount, run.boardName, run.stopReason),
  }
}

function fromDiagnostic(entry: DiagnosticEntry): LogEntry {
  return { atMs: entry.atMs, source: 'diagnostic', text: `[${entry.tag}] ${entry.text}` }
}

export function mergeRecentLog(input: {
  readonly sessionLines: readonly string[]
  readonly diagnostics: readonly DiagnosticEntry[]
  readonly collectionRuns: readonly CollectionRunSummary[]
  readonly limit: number
}): readonly LogEntry[] {
  const entries = [
    ...input.sessionLines.flatMap((line) => {
      const entry = fromSessionLine(line)
      return entry === null ? [] : [entry]
    }),
    ...input.diagnostics.map(fromDiagnostic),
    ...input.collectionRuns.map(fromCollectionRun),
  ]
  return [...entries].sort((a, b) => b.atMs - a.atMs).slice(0, input.limit)
}
