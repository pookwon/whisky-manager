import { TEXT } from '../../../shared/text.js'
import type { CollectionRunSummary } from '../../../desktop/collection-db/statusQuery.js'
import { collectionRangeLabel, relativeTime } from '../../format.js'

/** How many finished runs this screen lists before it stops being readable. */
const RECENT_RUN_ROWS = 8

const RUN_TONE: Record<CollectionRunSummary['status'], string> = {
  running: 'accent',
  succeeded: 'ok',
  partial: 'warn',
  failed: 'alarm',
  interrupted: 'idle',
}

/**
 * A finished run in one line: what it was asked for, what it stored, and — when
 * it did not finish cleanly — the reason, which is the whole point of keeping
 * failures on the list rather than hiding them.
 */
function RunRow({ run, nowMs }: { run: CollectionRunSummary; nowMs: number }): React.JSX.Element {
  const tone = RUN_TONE[run.status]
  const detail = [TEXT.collection.pagesRead(run.collectionPages), TEXT.collection.newPosts(run.insertedPostCount)]
  if (run.stopReason !== null) detail.push(run.stopReason)
  return (
    <div className="panel flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full bar-${tone}`} />
          <span className="text-sm font-semibold">
            {collectionRangeLabel(run)} · {TEXT.collection.runStatus[run.status]}
          </span>
        </div>
        <div className="mt-0.5 text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
          {detail.join(' · ')}
        </div>
      </div>
      <span className={`shrink-0 text-xs tone-${tone === 'accent' ? 'accent' : 'idle'}`}>
        {run.status === 'running' ? TEXT.collection.running : relativeTime(run.finishedAtMs ?? run.startedAtMs, nowMs)}
      </span>
    </div>
  )
}

export function RecentRuns({ runs }: { runs: readonly CollectionRunSummary[] }): React.JSX.Element {
  const nowMs = Date.now()
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
        {TEXT.collection.recent}
      </h2>
      {/* The query keeps a day's worth so the dashboard can draw it; this
          list is read, not scanned, and a screenful is what it wants. */}
      {runs.slice(0, RECENT_RUN_ROWS).map((run) => (
        <RunRow key={run.id} run={run} nowMs={nowMs} />
      ))}
    </section>
  )
}
