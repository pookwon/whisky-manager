import { TEXT } from '../../../shared/text.js'
import type { StartupPreview } from '../../../desktop/preview.js'
import { relativeTime } from '../../format.js'
import { CommentIcon } from './DayRhythm.js'
import type { JobState } from './quiet.js'

/**
 * The comment job, whole: what it is, why it is quiet, what it did today, and
 * the presses that change it.
 *
 * Everything about greetings lives inside this panel and nothing else does,
 * which is the point — the screen used to mix a session's result, a collection's
 * progress and a day picker into one column, and an operator had to know the
 * tool to tell which belonged to what.
 */

interface CommentJobProps {
  readonly state: JobState
  readonly executedToday: number
  readonly succeededToday: number
  readonly failedToday: number
  readonly awaitingApproval: number
  readonly lastOutcomeText: string
  readonly lastOutcomeAt: number | null
  readonly startupPreview: StartupPreview | null
  readonly nowMs: number
  readonly loopRunning: boolean
  readonly sessionInFlight: boolean
  readonly busy: boolean
  readonly day: string
  readonly maxDay: string
  readonly onDayChange: (value: string) => void
  readonly onRunOnce: () => void
  readonly onRunDay: () => void
  readonly onToggleLoop: () => void
  readonly onKill: () => void
}

function StatCell({ label, value, tone }: { label: string; value: number; tone: string | undefined }): React.JSX.Element {
  return (
    <div>
      <div
        className="text-[0.6875rem] font-medium uppercase tracking-wider"
        style={{ color: 'var(--ink-muted)' }}
      >
        {label}
      </div>
      <div className={`mt-1 text-3xl font-bold tabular-nums leading-none ${tone ?? ''}`}>{value}</div>
    </div>
  )
}

/**
 * How many greetings are waiting to be answered, once the bridge has counted
 * them. Said here rather than in a banner of its own because it is a fact about
 * this job and nothing else, and a banner above the fold pushed the two jobs
 * apart every time the app started.
 */
function previewLine(preview: StartupPreview | null): string | null {
  if (preview === null) return null
  return preview.kind === 'READY'
    ? `${TEXT.startup.heading} · ${TEXT.startup.count(preview.count)}`
    : `${TEXT.startup.heading} · ${TEXT.startup.unavailable[preview.reason]}`
}

export function CommentJob(props: CommentJobProps): React.JSX.Element {
  const preview = props.sessionInFlight ? null : previewLine(props.startupPreview)
  const lastSession =
    props.lastOutcomeAt === null
      ? props.lastOutcomeText
      : `${TEXT.time.lastSession(relativeTime(props.lastOutcomeAt, props.nowMs))} · ${props.lastOutcomeText}`

  return (
    <section className="panel overflow-hidden" style={{ flex: 'none' }}>
      <div className="flex">
        <div className={`w-1 shrink-0 bar-${props.state.tone}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-5 py-3">

          <div className="flex items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-2">
              <CommentIcon />
              <span className="text-sm font-bold">{TEXT.dashboard.job.comment}</span>
              <span className={`text-xs tone-${props.state.tone}`}>{props.state.status}</span>
              <span className="truncate text-xs" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.dashboard.job.commentHint}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn"
                disabled={props.busy || props.sessionInFlight}
                onClick={props.onRunOnce}
              >
                {TEXT.status.runOnce}
              </button>
              <button
                type="button"
                className={props.loopRunning ? 'btn' : 'btn btn-primary'}
                disabled={props.busy}
                onClick={props.onToggleLoop}
              >
                {props.loopRunning ? TEXT.status.stop : TEXT.status.start}
              </button>
              <button type="button" className="btn btn-danger" disabled={props.busy} onClick={props.onKill}>
                {TEXT.status.kill}
              </button>
            </div>
          </div>

          <div className={`text-[0.8125rem] leading-5 tabular-nums ${props.state.tone === 'ok' ? '' : `tone-${props.state.tone}`}`}>
            {props.state.why}
          </div>
          <div className="text-xs leading-[1.125rem] tabular-nums" style={{ color: 'var(--ink-muted)' }}>
            {lastSession}
          </div>
          {preview !== null && (
            <div className="text-xs leading-[1.125rem] tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {preview}
            </div>
          )}

          <div className="h-px" style={{ background: 'var(--line)' }} />

          <div className="flex items-end gap-5">
            <div className="grid min-w-0 flex-1 grid-cols-4 gap-2">
              <StatCell label={TEXT.stats.executedToday} value={props.executedToday} tone={undefined} />
              <StatCell label={TEXT.stats.succeededToday} value={props.succeededToday} tone="tone-ok" />
              <StatCell
                label={TEXT.stats.failedToday}
                value={props.failedToday}
                tone={props.failedToday > 0 ? 'tone-alarm' : undefined}
              />
              <StatCell
                label={TEXT.stats.awaiting}
                value={props.awaitingApproval}
                tone={props.awaitingApproval > 0 ? 'tone-warn' : undefined}
              />
            </div>
            <div className="flex shrink-0 items-end gap-2">
              <div style={{ width: '150px' }}>
                <label
                  className="block text-[0.6875rem] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--ink-muted)' }}
                  htmlFor="run-day"
                >
                  {TEXT.run.dayLabel}
                </label>
                <input
                  id="run-day"
                  type="date"
                  className="field mt-1"
                  value={props.day}
                  max={props.maxDay}
                  onChange={(event) => props.onDayChange(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn"
                disabled={props.busy || props.sessionInFlight}
                onClick={props.onRunDay}
              >
                {TEXT.run.dayRun}
              </button>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
