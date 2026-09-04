import { TEXT } from '../../../shared/text.js'
import type { CollectionStatusView } from '../../../desktop/ipc.js'
import {
  collectionCoveragePercent,
  formatKstDate,
  formatKstDateTime,
  relativeTime,
} from '../../format.js'
import { CollectIcon } from './DayRhythm.js'
import { periodDays, remainingFromMs, remainingToMs, type PeriodDay } from './periodDays.js'
import type { JobState } from './quiet.js'

/**
 * The collection job, whole.
 *
 * A run ending is not the job ending, so the panel is built around the job:
 * the period it was given, how far into it the walk has come, and when the next
 * block picks it up. What the last run stored is one muted line, because it is
 * the least useful number on the panel — it says what one block did, not
 * whether the month is nearly done.
 */

interface CollectionJobProps {
  readonly state: JobState
  readonly collection: CollectionStatusView
  /** What the last press answered, when it answered with a reason. */
  readonly refusal: string | null
  readonly nowMs: number
  readonly busy: boolean
  readonly onCollectNow: () => void
  readonly onStop: () => void
  /**
   * Null while the schedule is already on. When it is off there is nothing to
   * stop, so that button's place is given to the press that fixes what the
   * panel is complaining about — the panel says the schedule is off, and the
   * switch for it otherwise lives two screens away.
   */
  readonly onStartSchedule: (() => void) | null
  readonly onOpenStatus: () => void
}

const CELL_BACKGROUND: Record<PeriodDay['state'], string> = {
  stored: '',
  walking: '',
  remaining: 'var(--surface-sunken)',
}

/**
 * One cell per day of the period, oldest on the left.
 *
 * The walk runs newest to oldest, so the filled end is the right one and what
 * remains is the old end — the opposite of how a progress bar usually reads,
 * and why the two ends are labelled rather than left to be inferred.
 */
function PeriodDays({ days }: { days: readonly PeriodDay[] }): React.JSX.Element {
  return (
    <div className="mt-2 flex gap-0.5">
      {days.map((day) => (
        <div
          key={day.startMs}
          className={day.state === 'remaining' ? '' : 'bar-accent'}
          style={{
            flex: 1,
            height: '20px',
            borderRadius: '2px',
            background: CELL_BACKGROUND[day.state],
            // The day the cursor stands in is half done, and drawing it solid
            // would claim a day that is still being read.
            opacity: day.state === 'walking' ? 0.45 : 1,
          }}
        />
      ))}
    </div>
  )
}

export function CollectionJob(props: CollectionJobProps): React.JSX.Element {
  const status = props.collection.kind === 'ready' ? props.collection.status : null
  const job = status?.job ?? null
  const running = status?.running ?? null
  const lastFinished = status?.recentRuns.find((run) => run.status !== 'running') ?? null

  const days = job === null ? [] : periodDays(job)
  const coverage = job === null ? null : collectionCoveragePercent(job)
  const detail =
    running !== null
      ? TEXT.dashboard.collectionStored(running.collectionPages, running.insertedPostCount)
      : lastFinished === null
        ? TEXT.dashboard.collectionNever
        : `${TEXT.collection.lastRun} · ${relativeTime(lastFinished.finishedAtMs ?? lastFinished.startedAtMs, props.nowMs)} · ${TEXT.dashboard.collectionStored(lastFinished.collectionPages, lastFinished.insertedPostCount)}`

  return (
    <section className="panel overflow-hidden" style={{ flex: 'none' }}>
      <div className="flex">
        <div className={`w-1 shrink-0 bar-${props.state.tone}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-5 py-3">

          <div className="flex items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-2">
              <CollectIcon />
              <span className="text-sm font-bold">{TEXT.dashboard.job.collection}</span>
              <span className={`text-xs tone-${props.state.tone}`}>{props.state.status}</span>
              <span className="truncate text-xs" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.dashboard.job.collectionHint}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn"
                disabled={props.busy || running !== null || status === null}
                onClick={props.onCollectNow}
              >
                {TEXT.collection.collectNow}
              </button>
              {props.onStartSchedule === null ? (
                <button
                  type="button"
                  className="btn"
                  disabled={props.busy || running === null}
                  onClick={props.onStop}
                >
                  {TEXT.collection.stop}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={props.busy}
                  onClick={props.onStartSchedule}
                >
                  {TEXT.collection.startSchedule}
                </button>
              )}
              <button type="button" className="btn" onClick={props.onOpenStatus}>
                {TEXT.nav.collectionStatus}
              </button>
            </div>
          </div>

          <div className={`text-[0.8125rem] leading-5 tabular-nums ${props.state.tone === 'ok' ? '' : `tone-${props.state.tone}`}`}>
            {props.state.why}
          </div>
          <div className="text-xs leading-[1.125rem] tabular-nums" style={{ color: 'var(--ink-muted)' }}>
            {detail}
          </div>
          {props.refusal !== null && (
            <div className="text-[0.8125rem] leading-5 tone-warn">{props.refusal}</div>
          )}

          {job !== null && days.length > 0 && (
            <>
              <div className="h-px" style={{ background: 'var(--line)' }} />
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="text-[0.6875rem] font-medium uppercase tracking-wider"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {TEXT.dashboard.period.heading}
                  </span>
                  {/* The end is the midnight after the last day, so naming it
                      directly would announce a day outside the period. */}
                  <span className="text-[0.9375rem] font-semibold tabular-nums">
                    {formatKstDate(job.targetStartMs)} — {formatKstDate(job.targetEndMs - 1)}
                  </span>
                  {coverage !== null && (
                    <span className="text-[0.8125rem] font-semibold tabular-nums tone-accent">
                      {TEXT.dashboard.period.coverage(coverage)}
                    </span>
                  )}
                </div>

                <PeriodDays days={days} />

                <div className="mt-2 text-[0.8125rem] leading-5 tabular-nums">
                  {job.cursorPostedAtMs === null
                    ? TEXT.dashboard.period.walkedNone
                    : TEXT.dashboard.period.walked(
                        formatKstDateTime(job.cursorPostedAtMs),
                        formatKstDate(remainingFromMs(job)),
                        formatKstDate(remainingToMs(job)),
                      )}
                </div>
                <div className="text-xs leading-[1.125rem]" style={{ color: 'var(--ink-muted)' }}>
                  {TEXT.dashboard.period.direction}
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </section>
  )
}
