import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { CollectionStatusView } from '../../../desktop/ipc.js'
import {
  collectionCoveragePercent,
  formatKstDate,
  formatKstDateTime,
  relativeTime,
} from '../../format.js'
import { CollectIcon } from './DayRhythm.js'
import { Details } from './Details.js'
import { periodDays, remainingFromMs, remainingToMs, type PeriodDay } from './periodDays.js'
import type { JobState } from './quiet.js'

/**
 * The collection job, whole.
 *
 * A run ending is not the job ending, so the panel is built around the job:
 * how far into its period the walk has come, as one bar that stays above the
 * fold, and when the next block picks it up. The period drawn day by day, the
 * cursor and the boards wait below the fold; what the last run stored is the
 * least useful number on the panel — it says what one block did, not whether
 * the month is nearly done — so it rides the fold's summary line.
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
    <div className="flex gap-0.5">
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

/** How much of the period is stored, as the one figure that stays in view. */
function CoverageBar({ percent, rangeLabel }: { percent: number; rangeLabel: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
      <div
        className="flex-1 overflow-hidden"
        style={{ height: '6px', borderRadius: '999px', background: 'var(--surface-sunken)' }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="bar-accent h-full" style={{ width: `${percent}%`, borderRadius: '999px' }} />
      </div>
      <span className="shrink-0 font-semibold tabular-nums tone-accent">
        {TEXT.dashboard.period.coverage(percent)}
      </span>
      <span className="shrink-0 tabular-nums">{rangeLabel}</span>
    </div>
  )
}

export function CollectionJob(props: CollectionJobProps): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const status = props.collection.kind === 'ready' ? props.collection.status : null
  const job = status?.job ?? null
  const running = status?.running ?? null
  const walking = props.collection.kind === 'ready' && props.collection.walking
  const active = walking || running !== null
  const stopping = props.collection.kind === 'ready' && props.collection.stopping
  const lastFinished = status?.recentRuns.find((run) => run.status !== 'running') ?? null

  const days = job === null ? [] : periodDays(job)
  const coverage = job === null ? null : collectionCoveragePercent(job)
  const stored =
    running !== null
      ? TEXT.dashboard.collectionStored(running.collectionPages, running.insertedPostCount)
      : lastFinished === null
        ? TEXT.dashboard.collectionNever
        : `${TEXT.collection.lastRun} · ${relativeTime(lastFinished.finishedAtMs ?? lastFinished.startedAtMs, props.nowMs)} · ${TEXT.dashboard.collectionStored(lastFinished.collectionPages, lastFinished.insertedPostCount)}`

  return (
    <section className="panel overflow-hidden" style={{ flex: 'none' }}>
      <div className="flex">
        <div className={`w-1 shrink-0 bar-${props.state.tone}${props.state.tone === 'accent' ? ' rail-live' : ''}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-5 py-3">

          <div className="flex items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-2">
              <CollectIcon />
              <span className="text-sm font-bold">{TEXT.dashboard.job.collection}</span>
              <span className={`text-xs tone-${props.state.tone}`}>{props.state.status}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn"
                disabled={props.busy || active || status === null}
                onClick={props.onCollectNow}
              >
                {active ? TEXT.collection.collectNowPending : TEXT.collection.collectNow}
              </button>
              {props.onStartSchedule === null ? (
                <button
                  type="button"
                  className="btn"
                  disabled={props.busy || !active || stopping}
                  onClick={props.onStop}
                >
                  {stopping ? TEXT.collection.stopping : TEXT.collection.stop}
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
          {props.refusal !== null && (
            <div className="text-[0.8125rem] leading-5 tone-warn">{props.refusal}</div>
          )}
          {job !== null && coverage !== null && (
            // The end is the midnight after the last day, so naming it
            // directly would announce a day outside the period.
            <CoverageBar
              percent={coverage}
              rangeLabel={`${formatKstDate(job.targetStartMs)} — ${formatKstDate(job.targetEndMs - 1)}`}
            />
          )}

          <div className="h-px" style={{ background: 'var(--line)' }} />

          {job !== null && days.length > 0 ? (
            <Details
              summary={`${TEXT.dashboard.details.period} · ${stored}`}
              open={detailsOpen}
              onToggle={() => setDetailsOpen((open) => !open)}
            >
              <PeriodDays days={days} />
              <div>
                <div className="text-[0.8125rem] leading-5 tabular-nums">
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
                {job.boards.length > 0 && (
                  <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {(() => {
                      const done = job.boards.filter((b) => b.state === 'complete' || b.state === 'horizon').length
                      const walkingBoard = job.boards.find((b) => b.state === 'walking')
                      return (
                        <>
                          {TEXT.collection.boards.summary(done, job.boards.length)}
                          {walkingBoard !== undefined && ` · ${TEXT.collection.boards.walking(walkingBoard.name)}`}
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
            </Details>
          ) : (
            <div className="text-xs leading-[1.125rem] tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {stored}
            </div>
          )}

        </div>
      </div>
    </section>
  )
}
