import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { StartupPreview } from '../../../desktop/preview.js'
import { kstHourOf } from '../../../shared/kst.js'
import { relativeTime } from '../../format.js'
import { CommentIcon } from './DayRhythm.js'
import { Details } from './Details.js'
import { HourBars } from './HourBars.js'
import type { JobState } from './quiet.js'

/**
 * One automation's comment job, whole: what it is, why it is quiet, and the
 * presses that change it. What it did today waits below the fold.
 *
 * Everything about that automation lives inside this panel and nothing else
 * does, which is the point — the screen used to mix a session's result, a
 * collection's progress and a day picker into one column, and an operator had
 * to know the tool to tell which belonged to what.
 */

interface CommentJobProps {
  readonly title: string
  /**
   * The day picker and the startup preview. Off, the card keeps only the
   * presses every automation has — run now, start or stop, kill — because a
   * preview that counts nothing and a day that re-reads nothing would each be
   * a control that looks like it works.
   */
  readonly showDayControls: boolean
  readonly state: JobState
  readonly executedToday: number
  readonly succeededToday: number
  readonly failedToday: number
  readonly awaitingApproval: number
  readonly executedByHour: readonly number[]
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const preview =
    !props.showDayControls || props.sessionInFlight ? null : previewLine(props.startupPreview)
  const lastSession =
    props.lastOutcomeAt === null
      ? props.lastOutcomeText
      : `${TEXT.time.lastSession(relativeTime(props.lastOutcomeAt, props.nowMs))} · ${props.lastOutcomeText}`
  const summary = `${TEXT.dashboard.details.today} · ${TEXT.dashboard.details.todaySummary(
    props.executedToday,
    props.succeededToday,
    props.failedToday,
    props.awaitingApproval,
  )}`

  return (
    <section className="panel overflow-hidden" style={{ flex: 'none' }}>
      <div className="flex">
        <div className={`w-1 shrink-0 bar-${props.state.tone}${props.state.tone === 'accent' ? ' rail-live' : ''}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-5 py-3">

          <div className="flex items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-2">
              <CommentIcon />
              <span className="text-sm font-bold">{props.title}</span>
              <span className={`text-xs tone-${props.state.tone}`}>{props.state.status}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="btn"
                disabled={props.busy || props.sessionInFlight}
                onClick={props.onRunOnce}
              >
                {props.sessionInFlight ? TEXT.status.runOncePending : TEXT.status.runOnce}
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

          <div className="h-px" style={{ background: 'var(--line)' }} />

          <Details
            summary={summary}
            open={detailsOpen}
            onToggle={() => setDetailsOpen((open) => !open)}
            aside={<HourBars counts={props.executedByHour} currentHour={kstHourOf(props.nowMs)} />}
          >
            <div className="grid grid-cols-4 gap-2">
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
            {preview !== null && (
              <div className="text-xs leading-[1.125rem] tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                {preview}
              </div>
            )}
            {props.showDayControls && (
              <div className="flex items-end gap-2">
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
            )}
          </Details>

        </div>
      </div>
    </section>
  )
}
