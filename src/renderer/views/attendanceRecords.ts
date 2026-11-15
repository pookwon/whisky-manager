/**
 * Pure display-logic functions for the attendance records screen.
 * Extracted so tests can import and verify them without mounting the component.
 */
import { TEXT } from '../../shared/text.js'
import type { AttendanceProgress, AttendanceStartResult, AttendanceView } from '../../desktop/ipc.js'
import type { AttendanceKindStatus, AttendanceRefusedPost } from '../../desktop/collection-db/attendanceStatusQuery.js'

const COPY = TEXT.attendance

/** One row of the per-kind table, every cell already a string the table prints. */
export interface AttendanceKindRow {
  readonly kind: string
  readonly rounds: string
  readonly awards: string
  readonly earliest: string
  readonly latest: string
}

/** A refused post with its rule already translated to the words shown on screen. */
export interface AttendanceRefusedLine {
  readonly postId: string
  readonly title: string
  readonly rule: string
}

/** A period as the table shows it, or the dash for a kind no round has reached. */
function periodCell(period: { readonly startDay: string; readonly endDay: string } | null): string {
  return period === null ? COPY.noPeriod : COPY.period(period.startDay, period.endDay)
}

function count(value: number): string {
  return value.toLocaleString('ko-KR')
}

/** The three kind rows, in the order the status reports them (comment, post, visit). */
export function kindRows(kinds: readonly AttendanceKindStatus[]): AttendanceKindRow[] {
  return kinds.map((kind) => ({
    kind: COPY.kind[kind.kind],
    rounds: count(kind.roundCount),
    awards: count(kind.awardCount),
    earliest: periodCell(kind.earliest),
    latest: periodCell(kind.latest),
  }))
}

/** A refusal rule in the operator's words; one the catalogue does not name is shown as itself. */
export function refusedRuleText(rule: string): string {
  return rule in COPY.refusedRule
    ? COPY.refusedRule[rule as keyof typeof COPY.refusedRule]
    : COPY.unknownRule(rule)
}

export function refusedLines(refused: readonly AttendanceRefusedPost[]): AttendanceRefusedLine[] {
  return refused.map((post) => ({ postId: post.postId, title: post.title, rule: refusedRuleText(post.rule) }))
}

/** The stop button stands in for the start button while a walk is reading the board. */
export function showStopButton(progress: AttendanceProgress): boolean {
  return progress.state === 'listing' || progress.state === 'reading'
}

/** What the walk is doing, in words, or null when nothing has run yet. */
export function progressSentence(progress: AttendanceProgress): string | null {
  switch (progress.state) {
    case 'idle':
      return null
    case 'listing':
      return COPY.listing(progress.listPage)
    case 'reading':
      return COPY.reading(progress.postsRead, progress.postsTotal)
    case 'done':
      return COPY.done(progress.postsRead)
    case 'stopped':
      return COPY.stopped
    case 'failed':
      return COPY.failed(progress.failureCode ?? '')
  }
}

/**
 * The line that replaces the numbers when there is no collection database to read.
 * Null until the first view has loaded: a pending first load has no status to
 * read yet, and must not be mistaken for a database that is not configured.
 */
export function databaseNotice(view: AttendanceView | null): string | null {
  if (view === null) return null
  return view.status === null ? COPY.notStarted.DATABASE_DISABLED : null
}

/** Why a start press did nothing, or null when the walk started. */
export function startRefusalSentence(result: AttendanceStartResult): string | null {
  return result === 'STARTED' ? null : COPY.notStarted[result]
}
