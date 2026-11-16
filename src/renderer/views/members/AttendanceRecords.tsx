import { useCallback, useEffect, useState } from 'react'
import type { AttendanceView } from '../../../desktop/ipc.js'
import { TEXT } from '../../../shared/text.js'
import { api } from '../../api.js'
import { formatKstDateTime } from '../../format.js'
import { startPolling } from '../../poll.js'
import {
  databaseNotice,
  kindRows,
  progressSentence,
  refusedLines,
  showStopButton,
  startRefusalSentence,
} from '../attendanceRecords.js'

const COPY = TEXT.attendance
const POLL_MS = 2_000

/** Reads the attendance board and shows, per kind, how many rounds and awards are stored. */
export function AttendanceRecords(): React.JSX.Element {
  const [view, setView] = useState<AttendanceView | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setView(await api.getAttendanceView())
  }, [])

  // The first read fills the screen; the background poll below takes over while a
  // walk is under way.
  useEffect(() => {
    void load().catch(console.error)
  }, [load])

  const walking = view !== null && showStopButton(view.progress)

  // Only a running walk needs the screen to keep refreshing, and only then; a
  // finished screen sits still rather than reading the database every two seconds.
  useEffect(() => {
    if (!walking) return
    return startPolling(() => load().catch(console.error), POLL_MS)
  }, [walking, load])

  const act = async (run: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await run()
    } finally {
      setBusy(false)
      await load().catch(console.error)
    }
  }

  const start = (): void => {
    setRefusal(null)
    void act(async () => {
      setRefusal(startRefusalSentence(await api.startAttendanceCollection()))
    })
  }

  const stop = (): void => {
    void act(() => api.stopAttendanceCollection())
  }

  const status = view?.status ?? null
  const dbNotice = databaseNotice(view)
  const progressLine = view === null ? null : progressSentence(view.progress)
  const rows = status === null ? [] : kindRows(status.kinds)
  const refused = status === null ? [] : refusedLines(status.refused)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-6">
        <h1 className="text-lg font-bold tracking-tight">{COPY.pageHeading}</h1>
        {walking ? (
          <button type="button" className="btn shrink-0" disabled={busy} onClick={stop}>
            {COPY.stop}
          </button>
        ) : (
          <button type="button" className="btn shrink-0" disabled={busy || status === null} onClick={start}>
            {COPY.start}
          </button>
        )}
      </header>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            {COPY.why}
          </p>

          {status !== null && (
            <div className="text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {status.lastReadAtMs === null ? COPY.neverRead : COPY.lastRead(formatKstDateTime(status.lastReadAtMs))}
            </div>
          )}

          {dbNotice !== null && <div className="tone-warn text-sm">{dbNotice}</div>}

          {status !== null && (
            <div className="overflow-auto">
              <table className="w-full text-left text-sm tabular-nums">
                <thead>
                  <tr style={{ color: 'var(--ink-muted)' }}>
                    <th className="pb-1 pr-4 font-medium whitespace-nowrap">{COPY.columns.kind}</th>
                    <th className="pb-1 pr-4 font-medium whitespace-nowrap">{COPY.columns.rounds}</th>
                    <th className="pb-1 pr-4 font-medium whitespace-nowrap">{COPY.columns.awards}</th>
                    <th className="pb-1 pr-4 font-medium whitespace-nowrap">{COPY.columns.earliest}</th>
                    <th className="pb-1 pr-4 font-medium whitespace-nowrap">{COPY.columns.latest}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.kind}>
                      <td className="pr-4 whitespace-nowrap">{row.kind}</td>
                      <td className="pr-4 whitespace-nowrap">{row.rounds}</td>
                      <td className="pr-4 whitespace-nowrap">{row.awards}</td>
                      <td className="pr-4 whitespace-nowrap">{row.earliest}</td>
                      <td className="pr-4 whitespace-nowrap">{row.latest}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {progressLine !== null && (
            <div className={`text-sm ${view?.progress.state === 'failed' ? 'tone-alarm' : ''}`}>{progressLine}</div>
          )}

          {refusal !== null && <div className="tone-warn text-sm">{refusal}</div>}

          {refused.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">{COPY.refusedHeading(refused.length)}</div>
              <ul className="flex flex-col gap-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                {refused.map((post) => (
                  <li key={post.postId} className="flex gap-3">
                    <span className="shrink-0">{post.postId}</span>
                    <span className="min-w-0 flex-1 truncate">{post.title}</span>
                    <span className="shrink-0">{post.rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
