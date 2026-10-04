import { TEXT } from '../../shared/text.js'
import type { CollectionRunSummary } from '../../desktop/collection-db/statusQuery.js'
import { ArticleProbeCard } from './collection/ArticleProbeCard.js'
import { BoardSearchStep } from './collection/BoardSearchStep.js'
import { CollectionUnavailable } from './collection/CollectionUnavailable.js'
import { IdGapPanel } from './collection/IdGapPanel.js'
import { ListWalkStep } from './collection/ListWalkStep.js'
import { runningStep } from './collection/stepFacts.js'
import { listStepState, searchStepState } from './collection/stepStates.js'
import { collectionRangeLabel, formatKstDateTime, relativeTime } from '../format.js'
import { useApp } from '../store.js'

/** Same shape the dashboard's numbers wear, so the two screens read alike. */
function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="panel px-4 py-3.5">
      <div
        className="text-[0.6875rem] font-medium uppercase tracking-wider"
        style={{ color: 'var(--ink-muted)' }}
      >
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums leading-none">{value.toLocaleString()}</div>
    </div>
  )
}

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
  const detail = [
    TEXT.collection.pagesRead(run.collectionPages),
    TEXT.collection.newPosts(run.insertedPostCount),
  ]
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
        {run.status === 'running'
          ? TEXT.collection.running
          : relativeTime(run.finishedAtMs ?? run.startedAtMs, nowMs)}
      </span>
    </div>
  )
}

export function CollectionStatus(): React.JSX.Element {
  const collection = useApp((s) => s.collection)
  const boardSearch = useApp((s) => s.boardSearch)
  const articleProbe = useApp((s) => s.articleProbe)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  if (collection === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const heading = (
    <header>
      <h1 className="text-lg font-bold tracking-tight">{TEXT.collection.heading}</h1>
    </header>
  )

  if (collection.kind !== 'ready') {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <CollectionUnavailable view={collection} />
      </div>
    )
  }

  const { totals, recentRuns, idGaps } = collection.status
  const nowMs = Date.now()
  const inputs = {
    status: collection.status,
    search: boardSearch?.kind === 'ready' ? boardSearch.view : null,
    probe: articleProbe?.kind === 'ready' ? articleProbe.view : null,
  }
  const running = runningStep(inputs)

  return (
    <div className="flex flex-col gap-6">
      {heading}
      <ListWalkStep
        status={collection.status}
        state={listStepState(inputs)}
        otherRunning={running !== null && running !== 'list'}
        busy={busy}
        act={act}
        periodRequest={null}
      />
      {inputs.search !== null && (
        <BoardSearchStep
          view={inputs.search}
          state={searchStepState(inputs)}
          otherRunning={running !== null && running !== 'search'}
          busy={busy}
          act={act}
          request={null}
        />
      )}
      {articleProbe?.kind === 'ready' && <ArticleProbeCard view={articleProbe.view} busy={busy} act={act} />}

      <section className="grid grid-cols-2 gap-3">
        <Stat label={TEXT.collection.totals.posts} value={totals.posts} />
        <Stat label={TEXT.collection.totals.boards} value={totals.boards} />
      </section>

      {/* Said in dates rather than page numbers: a page number points at
          different posts an hour later, so it cannot describe what is stored. */}
      <section className="panel px-5 py-4">
        <div
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.collection.span}
        </div>
        <div className="mt-1.5 text-sm font-semibold tabular-nums">
          {totals.oldestPostedAtMs === null || totals.newestPostedAtMs === null
            ? TEXT.collection.spanEmpty
            : TEXT.collection.spanRange(
                formatKstDateTime(totals.oldestPostedAtMs),
                formatKstDateTime(totals.newestPostedAtMs),
              )}
        </div>
      </section>

      {totals.posts > 0 && <IdGapPanel report={idGaps} />}

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.collection.recent}
        </h2>
        {/* The query keeps a day's worth so the dashboard can draw it; this
            list is read, not scanned, and a screenful is what it wants. */}
        {recentRuns.slice(0, RECENT_RUN_ROWS).map((run) => (
          <RunRow key={run.id} run={run} nowMs={nowMs} />
        ))}
      </section>

    </div>
  )
}
