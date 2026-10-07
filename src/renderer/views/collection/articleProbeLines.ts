import { kstDayKey, kstDayKeyRange, MS_PER_DAY } from '../../../shared/kst.js'
import { TEXT } from '../../../shared/text.js'
import type { ArticleProbeBlockFailure, ArticleProbeProgress } from '../../../desktop/articleProbeRunner.js'
import type { ArticleProbeJob, ArticleProbeLastRun } from '../../../desktop/collection-db/articleProbeRepository.js'
import { formatKstDateTime } from '../../format.js'
import { dayKeyLabel } from './boardSearchLines.js'

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

export function articleProbeHeadlineLine(job: ArticleProbeJob): string {
  return TEXT.articleProbe.headline(job.probed, job.total, job.stored)
}

/** Another board's posts and notices fold into one count: neither is stored. */
export function articleProbeBreakdownLine(job: ArticleProbeJob): string {
  return TEXT.articleProbe.breakdown(job.deleted, job.unreadable, job.otherBoard + job.notice)
}
