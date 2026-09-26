import { kstDayKey, kstDayKeyRange, MS_PER_DAY } from '../../../shared/kst.js'
import { TEXT } from '../../../shared/text.js'
import type { ArticleProbeBlockFailure, ArticleProbeProgress } from '../../../desktop/articleProbeRunner.js'
import type { ArticleProbeWindow } from '../../../desktop/articleProbePlan.js'
import type { ArticleProbeJob, ArticleProbeLastRun } from '../../../desktop/collection-db/articleProbeRepository.js'
import type { ArticleProbeCreateView } from '../../../desktop/ipc.js'
import { formatKstDateTime } from '../../format.js'
import { dayKeyLabel } from './boardSearchLines.js'

/** What a create press answered: how many ids went in, or why none did. */
export interface ArticleProbeCreateOutcome {
  readonly kind: 'created' | 'refusal'
  readonly text: string
}

export function articleProbeSummaryLine(job: ArticleProbeJob): string {
  return TEXT.articleProbe.summary(job.probed, job.total, job.stored, job.deleted, job.unreadable, job.otherBoard + job.notice)
}

export function articleProbeProgressLine(progress: ArticleProbeProgress | null): string | null {
  return progress === null ? null : TEXT.articleProbe.progress(progress.requested, progress.maxPages)
}

/**
 * The gap's days as the operator counts them. `toDay` is the search job's own
 * inclusive end, where the list walk stopped; the ids come from posts before it
 * began, so the gap's last day is the one before.
 */
export function articleProbeWindowLine(window: { readonly fromDay: string; readonly toDay: string }): string {
  const lastDay = kstDayKey(kstDayKeyRange(window.toDay).startMs - MS_PER_DAY)
  return TEXT.articleProbe.window(dayKeyLabel(window.fromDay), dayKeyLabel(lastDay))
}

/** Resume once any id is answered; until then the job has not started. */
export function articleProbeStartLabel(job: ArticleProbeJob): string {
  return job.probed > 0 ? TEXT.articleProbe.resume : TEXT.articleProbe.start
}

/**
 * The block that left no run row is newer than every run, so it is the one to
 * name; otherwise the newest run, when it failed. A spent budget or a stop is
 * not a failure and says nothing.
 */
export function articleProbeFailureLine(blockFailure: ArticleProbeBlockFailure | null, lastRun: ArticleProbeLastRun | null): string | null {
  if (blockFailure !== null) return TEXT.articleProbe.blockFailed(formatKstDateTime(blockFailure.atMs), blockFailure.stopReason)
  if (lastRun === null || lastRun.status !== 'failed') return null
  return TEXT.articleProbe.runFailed(formatKstDateTime(lastRun.startedAtMs), lastRun.stopReason ?? lastRun.status)
}

/** Why the create button is idle while there is no job; null when a job can be made, or one exists. */
export function articleProbeCreateRefusal(window: ArticleProbeWindow | null): string | null {
  return window?.kind === 'refused' ? TEXT.articleProbe.refused[window.reason] : null
}

export function articleProbeCreateOutcome(outcome: ArticleProbeCreateView): ArticleProbeCreateOutcome {
  return outcome.kind === 'ready'
    ? { kind: 'created', text: TEXT.articleProbe.created(outcome.idCount) }
    : { kind: 'refusal', text: TEXT.articleProbe.refused[outcome.reason] }
}
