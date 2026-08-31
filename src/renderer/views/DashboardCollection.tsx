import { TEXT } from '../../shared/text.js'
import type { CollectionStatusView } from '../../desktop/ipc.js'
import { collectionCoveragePercent, collectionRangeLabel, relativeTime } from '../format.js'

interface CollectionProps {
  readonly collection: CollectionStatusView | null
  readonly nowMs: number
  readonly onOpen: () => void
}

/**
 * The strip exists only while a collection is reading, in the same accent the
 * window uses everywhere for "the app is doing something right now". It names
 * the feature, so it is never read as the greeting session above it.
 */
export function CollectionStrip({ collection, nowMs, onOpen }: CollectionProps): React.JSX.Element | null {
  if (collection?.kind !== 'ready' || collection.status.running === null) return null
  const running = collection.status.running
  const coverage = collectionCoveragePercent(running)

  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className="w-1 shrink-0 bar-accent" />
        <div className="flex flex-1 items-center justify-between gap-6 px-5 py-3.5">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bar-accent" />
              <span className="text-sm font-semibold tone-accent">
                {TEXT.nav.collection} · {collectionRangeLabel(running)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              {coverage !== null && (
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full"
                  style={{ background: 'var(--surface-sunken)' }}
                >
                  <div className="h-full bar-accent" style={{ width: `${coverage}%` }} />
                </div>
              )}
              <span className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.dashboard.collectionRunning(running.collectionPages, running.insertedPostCount)}
                {' · '}
                {TEXT.collection.elapsed(relativeTime(running.startedAtMs, nowMs))}
              </span>
            </div>
          </div>
          <button type="button" className="btn shrink-0" onClick={onOpen}>
            {TEXT.nav.collectionStatus}
          </button>
        </div>
      </div>
    </section>
  )
}

/**
 * The collection's line in 기능별 상태. It stays after the strip is gone, which
 * is what keeps "무엇이 마지막으로 돌았나" answerable on this screen — and it is
 * absent entirely where no collection storage is configured, rather than
 * reporting a feature the operator does not have.
 */
export function CollectionRow({ collection, nowMs, onOpen }: CollectionProps): React.JSX.Element | null {
  if (collection?.kind !== 'ready') return null
  const { running, recentRuns } = collection.status
  const lastFinished = recentRuns.find((run) => run.status !== 'running') ?? null

  const detail =
    running !== null
      ? TEXT.dashboard.collectionRunning(running.collectionPages, running.insertedPostCount)
      : lastFinished === null
        ? TEXT.dashboard.collectionNever
        : TEXT.dashboard.collectionIdle(
            relativeTime(lastFinished.finishedAtMs ?? lastFinished.startedAtMs, nowMs),
          )

  return (
    <button
      type="button"
      className="panel flex items-center justify-between gap-4 px-4 py-3 text-left"
      onClick={onOpen}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full bar-${running === null ? 'idle' : 'accent'}`} />
          <span className="text-sm font-semibold">{TEXT.nav.collection}</span>
        </div>
        <div className="mt-0.5 text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
          {detail}
        </div>
      </div>
      <span className={`shrink-0 text-xs ${running === null ? 'tone-idle' : 'tone-accent'}`}>
        {running === null ? TEXT.status.stopped : TEXT.collection.running}
      </span>
    </button>
  )
}
