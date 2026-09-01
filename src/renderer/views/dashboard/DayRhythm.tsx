import { TEXT } from '../../../shared/text.js'
import { formatKstTime } from '../../format.js'
import {
  hourMarks,
  rhythmBand,
  rhythmPercent,
  rhythmSpan,
  runsOnDay,
  windowBand,
  type ActiveWindow,
  type RhythmBand,
  type RunBlock,
} from './rhythm.js'

/**
 * The day as a band, one lane per job.
 *
 * This is the answer to "왜 조용한가" that needs no sentence: the blocks that
 * ran are filled, and the rests are the gaps between them. Between blocks the
 * cursor stands in a gap, which is a picture of a schedule working rather than
 * of a tool that has stopped.
 */

const LANE_HEIGHT = '26px'
const LABEL_WIDTH = '84px'

interface DayRhythmProps {
  readonly nowMs: number
  readonly commentWindow: ActiveWindow
  readonly lastSessionAt: number | null
  readonly nextSessionAt: number | null
  /** Null where no schedule has been read, so no window can be drawn. */
  readonly collectionWindow: ActiveWindow | null
  /** Finished runs only; the one in flight arrives as `runningStartedAtMs`. */
  readonly finishedRuns: readonly RunBlock[]
  readonly runningStartedAtMs: number | null
  readonly nextRunAtMs: number | null
  /** How long a block is allowed to last, for drawing one that has not ended. */
  readonly workBlockMs: number | null
}

function bandStyle(band: RhythmBand): React.CSSProperties {
  return { position: 'absolute', top: 0, bottom: 0, left: `${band.leftPercent}%`, width: `${band.widthPercent}%` }
}

/** A moment rather than a stretch: a session start has no drawable length. */
function Tick({ leftPercent, color }: { leftPercent: number; color: string }): React.JSX.Element {
  return (
    <div
      style={{ position: 'absolute', top: 0, bottom: 0, left: `${leftPercent}%`, width: '2px', background: color }}
    />
  )
}

function Lane({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ position: 'relative', height: LANE_HEIGHT }}>{children}</div>
}

/** The stretch a job is allowed to run in, under everything else on its lane. */
function WindowTrack({ band }: { band: RhythmBand | null }): React.JSX.Element {
  const style: React.CSSProperties =
    band === null
      ? { position: 'absolute', inset: 0 }
      : bandStyle(band)
  return <div style={{ ...style, background: 'var(--surface-sunken)', borderRadius: '4px' }} />
}

export function DayRhythm(props: DayRhythmProps): React.JSX.Element {
  const windows = props.collectionWindow === null
    ? [props.commentWindow]
    : [props.commentWindow, props.collectionWindow]
  const span = rhythmSpan(props.nowMs, windows)

  const ran = runsOnDay(props.finishedRuns, span)
    .map((run) => ({ run, band: rhythmBand(run.startedAtMs, run.finishedAtMs ?? props.nowMs, span) }))
    .filter((drawn): drawn is { run: RunBlock; band: RhythmBand } => drawn.band !== null)

  // A block that has not ended is drawn to where it is allowed to reach, with
  // only the part already spent filled in. It may still stop early on its page
  // budget, which is why the outline is dashed rather than solid.
  const blockMs = props.workBlockMs
  const running =
    props.runningStartedAtMs === null || blockMs === null
      ? null
      : {
          planned: rhythmBand(props.runningStartedAtMs, props.runningStartedAtMs + blockMs, span),
          spent: rhythmBand(props.runningStartedAtMs, props.nowMs, span),
        }
  const nextBlock =
    props.nextRunAtMs === null || blockMs === null || props.runningStartedAtMs !== null
      ? null
      : rhythmBand(props.nextRunAtMs, props.nextRunAtMs + blockMs, span)

  const plannedStyle: React.CSSProperties = {
    border: '1px dashed var(--accent)',
    background: 'var(--accent-soft)',
    borderRadius: '3px',
  }

  const legendBlock =
    props.runningStartedAtMs !== null
      ? TEXT.dashboard.rhythm.legendRunning
      : props.nextRunAtMs === null
        ? TEXT.dashboard.rhythm.legendNoBlock
        : TEXT.dashboard.rhythm.legendNext(formatKstTime(props.nextRunAtMs))

  return (
    <section className="panel" style={{ flex: 'none', padding: '0.75rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.dashboard.rhythm.heading}
        </span>
        <span className="text-[0.8125rem] font-semibold tabular-nums tone-accent">
          {TEXT.dashboard.rhythm.now(formatKstTime(props.nowMs))}
        </span>
      </div>

      <div style={{ marginTop: '0.875rem', display: 'flex', gap: '0.75rem' }}>
        <div style={{ width: LABEL_WIDTH, flex: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ height: LANE_HEIGHT }}>
            <CommentIcon />
            {TEXT.dashboard.rhythm.commentLane}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ height: LANE_HEIGHT }}>
            <CollectIcon />
            {TEXT.dashboard.rhythm.collectionLane}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          {/* Drawn over both lanes and past their edges, so it reads as one
              moment cutting through the day rather than two separate marks. */}
          <div
            style={{
              position: 'absolute',
              top: '-5px',
              bottom: '-5px',
              left: `${rhythmPercent(props.nowMs, span)}%`,
              width: '2px',
              background: 'var(--accent)',
              zIndex: 2,
            }}
          />

          {/* 댓글: the snapshot carries the operating window and the last and
              next session — not when each session of the day ran. */}
          <Lane>
            <WindowTrack band={windowBand(props.commentWindow, span)} />
            {props.lastSessionAt !== null && (
              <Tick leftPercent={rhythmPercent(props.lastSessionAt, span)} color="var(--ink-muted)" />
            )}
            {props.nextSessionAt !== null && (
              <Tick leftPercent={rhythmPercent(props.nextSessionAt, span)} color="var(--ok)" />
            )}
          </Lane>

          {/* 수집: every block that ran today, taken from the runs themselves. */}
          <Lane>
            <WindowTrack band={props.collectionWindow === null ? null : windowBand(props.collectionWindow, span)} />
            {ran.map(({ run, band }) => (
              <div
                key={run.startedAtMs}
                className="bar-ok"
                style={{ ...bandStyle(band), borderRadius: '3px' }}
              />
            ))}
            {running?.planned != null && <div style={{ ...bandStyle(running.planned), ...plannedStyle }} />}
            {running?.spent != null && (
              <div className="bar-accent" style={{ ...bandStyle(running.spent), borderRadius: '3px 0 0 3px' }} />
            )}
            {nextBlock !== null && <div style={{ ...bandStyle(nextBlock), ...plannedStyle }} />}
          </Lane>
        </div>
      </div>

      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.75rem' }}>
        <div style={{ width: LABEL_WIDTH, flex: 'none' }} />
        <div
          className="text-[0.6875rem] tabular-nums"
          style={{ flex: 1, minWidth: 0, position: 'relative', height: '16px', color: 'var(--ink-muted)' }}
        >
          {hourMarks(span).map((mark) => (
            <span
              key={mark.hour}
              style={{
                position: 'absolute',
                left: `${mark.leftPercent}%`,
                transform:
                  mark.leftPercent === 0
                    ? 'none'
                    : mark.leftPercent === 100
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
              }}
            >
              {String(mark.hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>

      <div
        className="text-[0.6875rem]"
        style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.875rem', color: 'var(--ink-muted)' }}
      >
        <Legend swatch={{ background: 'var(--surface-sunken)' }} label={TEXT.dashboard.rhythm.legendWindow} />
        <Legend swatchClass="bar-ok" label={TEXT.dashboard.rhythm.legendRan} />
        <Legend swatch={plannedStyle} label={legendBlock} />
        <Legend swatchClass="bar-accent" narrow label={TEXT.dashboard.rhythm.legendNow} />
        <span>{TEXT.dashboard.rhythm.legendRest}</span>
      </div>
    </section>
  )
}

function Legend({
  swatch,
  swatchClass,
  narrow,
  label,
}: {
  swatch?: React.CSSProperties
  swatchClass?: string
  narrow?: boolean
  label: string
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={swatchClass}
        style={{ width: narrow === true ? '2px' : '14px', height: narrow === true ? '10px' : '8px', borderRadius: '2px', ...swatch }}
      />
      {label}
    </span>
  )
}

/**
 * The window has no icon set of its own; these two exist only to tell the lanes
 * and the panels apart at a glance, and are drawn rather than imported so they
 * take the ink colour like everything else.
 */
export function CommentIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 2.5h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7.5L4.5 14v-2.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z" />
    </svg>
  )
}

export function CollectIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="8" cy="4" rx="5.5" ry="2.25" />
      <path d="M2.5 4v8c0 1.24 2.46 2.25 5.5 2.25s5.5-1.01 5.5-2.25V4" />
      <path d="M2.5 8c0 1.24 2.46 2.25 5.5 2.25s5.5-1.01 5.5-2.25" />
    </svg>
  )
}
