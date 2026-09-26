import { useEffect, useState } from 'react'
import type { LogEntry, LogSource } from '../../desktop/ipc.js'
import { TEXT } from '../../shared/text.js'
import { api } from '../api.js'
import { formatKstDateTime } from '../format.js'
import { startPolling } from '../poll.js'

/**
 * What the app did and complained about lately, on one timeline.
 *
 * A debugging aid, not a dashboard: it says what happened and when, in the
 * words the log files already use, and lets the operator hide the sources
 * they are not chasing. It reads on its own clock rather than through the
 * store, because no other screen wants the log and every screen refreshes
 * the store.
 */

const REFRESH_MS = 5_000
const SOURCES: readonly LogSource[] = ['session', 'refusal', 'collection', 'diagnostic']

const SOURCE_TONE: Record<LogSource, string> = {
  session: 'tone-ok',
  refusal: 'tone-warn',
  collection: 'tone-accent',
  diagnostic: 'tone-alarm',
}

function SourceFilter(props: {
  readonly source: LogSource
  readonly on: boolean
  readonly onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`chip ${props.on ? SOURCE_TONE[props.source] : ''}`}
      aria-pressed={props.on}
      style={{ cursor: 'pointer', opacity: props.on ? 1 : 0.5 }}
      onClick={props.onToggle}
    >
      {TEXT.log.source[props.source]}
    </button>
  )
}

export function RecentLog(): React.JSX.Element {
  const [entries, setEntries] = useState<readonly LogEntry[] | null>(null)
  const [readFailed, setReadFailed] = useState(false)
  const [hidden, setHidden] = useState<ReadonlySet<LogSource>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    const read = (): Promise<void> =>
      api
        .getRecentLog()
        .then((next) => {
          if (cancelled) return
          setEntries(next)
          setReadFailed(false)
        })
        .catch(() => {
          // Said on the screen, since the screen is the one asking; the next
          // tick tries again on its own.
          if (!cancelled) setReadFailed(true)
        })
    const stopPolling = startPolling(read, REFRESH_MS)
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [])

  const toggle = (source: LogSource): void =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })

  const shown = entries?.filter((entry) => !hidden.has(entry.source)) ?? null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">{TEXT.log.heading}</h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.log.hint}
          </p>
        </div>
        <div role="group" aria-label={TEXT.log.filter} className="flex items-center gap-2">
          {SOURCES.map((source) => (
            <SourceFilter key={source} source={source} on={!hidden.has(source)} onToggle={() => toggle(source)} />
          ))}
        </div>
      </div>

      {readFailed && (
        <div role="alert" className="text-xs tone-warn">
          {TEXT.log.readFailed}
        </div>
      )}

      <section className="panel overflow-hidden">
        {shown === null ? (
          <div className="px-5 py-4 text-sm" style={{ color: 'var(--ink-muted)' }}>…</div>
        ) : shown.length === 0 ? (
          <div className="px-5 py-4 text-sm" style={{ color: 'var(--ink-muted)' }}>{TEXT.log.empty}</div>
        ) : (
          <ol className="m-0 list-none p-0">
            {shown.map((entry, index) => (
              <li
                // Two entries can share a millisecond; the text tells them apart
                // without rotating every key on each poll.
                key={`${entry.atMs}:${entry.source}:${entry.text}`}
                className="grid items-baseline gap-3 px-5 py-2 text-[0.8125rem] leading-5"
                style={{
                  gridTemplateColumns: '7.5rem 3.5rem minmax(0, 1fr)',
                  borderTop: index === 0 ? undefined : '1px solid var(--line)',
                }}
              >
                <span className="tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {formatKstDateTime(entry.atMs)}
                </span>
                <span className={`text-xs font-semibold ${SOURCE_TONE[entry.source]}`}>
                  {TEXT.log.source[entry.source]}
                </span>
                <span className="min-w-0 break-words font-mono text-xs leading-5">{entry.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
