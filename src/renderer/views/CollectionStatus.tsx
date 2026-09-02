import { useState } from 'react'
import { TEXT } from '../../shared/text.js'
import type { CollectionRunSummary } from '../../desktop/collection-db/statusQuery.js'
import type {
  CollectionRunRequest,
  CollectionStatusView,
  MemberCollectionStatusView,
  StartCollectionResult,
} from '../../desktop/ipc.js'
import { api } from '../api.js'
import { progressLine, stopReasonLine } from './memberCollectionCard.js'
import {
  collectionCoveragePercent,
  collectionRangeLabel,
  formatKstDate,
  formatKstDateTime,
  formatKstTime,
  relativeTime,
} from '../format.js'
import { useApp } from '../store.js'

/** `YYYY-MM-DD` in KST, which is what the date input speaks. */
function kstDateValue(epochMs: number): string {
  return new Date(epochMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Midnight KST of a date the operator picked. */
function kstMidnightOf(value: string): number {
  return Date.parse(`${value}T00:00:00+09:00`)
}

/** Why a press did nothing, in the words of the thing the operator can fix. */
function refusalText(result: StartCollectionResult): string | null {
  if (result.kind === 'refused') return TEXT.collection.refused[result.reason]
  if (result.kind === 'rejected') return TEXT.collection.rejected[result.problem]
  return null
}

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

/** Storage is optional; both ways it can be absent get their own explanation. */
function Unavailable({ view }: { view: CollectionStatusView }): React.JSX.Element {
  const disabled = view.kind === 'disabled'
  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${disabled ? 'bar-idle' : 'bar-warn'}`} />
        <div className="flex-1 px-5 py-4">
          <div
            className="text-[0.6875rem] font-medium uppercase tracking-wider"
            style={{ color: 'var(--ink-muted)' }}
          >
            {disabled ? TEXT.collection.disabledHeading : TEXT.collection.unavailableHeading}
          </div>
          <p className={`mt-1 text-sm ${disabled ? '' : 'tone-warn'}`}>
            {disabled
              ? TEXT.collection.disabledHow
              : view.kind === 'unavailable'
                ? TEXT.collection.unavailable[view.code]
                : ''}
          </p>
        </div>
      </div>
    </section>
  )
}

/** Why a member collection press did nothing. */
function memberRefusalText(result: StartCollectionResult): string | null {
  if (result.kind === 'refused') return TEXT.memberCollection.refused[result.reason] ?? null
  return null
}

function MemberCollectionCard({
  memberCollection,
  busy,
  act,
}: {
  memberCollection: MemberCollectionStatusView | null
  busy: boolean
  act: (run: () => Promise<unknown>) => Promise<boolean>
}): React.JSX.Element | null {
  const [refusal, setRefusal] = useState<string | null>(null)

  if (memberCollection === null || memberCollection.kind !== 'ready') return null

  const { status } = memberCollection
  const { running, complete, forced, memberCount, completedAtMs, toppedUpAtMs, authorCount, matchedAuthorCount, lastRunStatus } = status

  const stopLine = stopReasonLine(status)

  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${running ? 'bar-accent' : 'bar-idle'}`} />
        <div className="flex flex-1 items-center justify-between gap-6 px-5 py-4">
          <div className="flex-1 min-w-0">
            <div
              className="text-[0.6875rem] font-medium uppercase tracking-wider"
              style={{ color: 'var(--ink-muted)' }}
            >
              {TEXT.memberCollection.heading}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {running ? (
                <span className="tone-accent">{TEXT.memberCollection.running}</span>
              ) : memberCount === 0 ? (
                <span style={{ color: 'var(--ink-muted)' }}>{TEXT.memberCollection.never}</span>
              ) : (
                <span>{TEXT.memberCollection.idle}</span>
              )}
            </div>
            <div className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.memberCollection.memberCount(memberCount)}
              {' · '}
              {progressLine(status)}
            </div>
            <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {completedAtMs !== null
                ? TEXT.memberCollection.completedAt(formatKstDateTime(completedAtMs))
                : TEXT.memberCollection.incomplete}
              {' · '}
              {toppedUpAtMs !== null
                ? TEXT.memberCollection.toppedUpAt(formatKstDateTime(toppedUpAtMs))
                : TEXT.memberCollection.toppedUpNever}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.memberCollection.match(matchedAuthorCount, authorCount)}
            </div>
            {stopLine !== null && (
              <div className={`mt-1 text-sm ${lastRunStatus === 'failed' ? 'tone-alarm' : 'tone-warn'}`}>{stopLine}</div>
            )}
            {forced && (
              <div className="mt-1 text-sm tone-warn">{TEXT.memberCollection.forcedOn}</div>
            )}
            {refusal !== null && <div className="mt-1 text-sm tone-warn">{refusal}</div>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!complete && (
              <button
                type="button"
                className="btn"
                disabled={busy || running}
                onClick={() => {
                  setRefusal(null)
                  void act(async () => {
                    const result = await api.startMemberCollection()
                    setRefusal(memberRefusalText(result))
                  })
                }}
              >
                {memberCount === 0 ? TEXT.memberCollection.start : TEXT.memberCollection.resume}
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={busy || !running}
              onClick={() => void act(() => api.stopMemberCollection())}
            >
              {TEXT.memberCollection.stop}
            </button>
            {!complete && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setRefusal(null)
                  void act(async () => {
                    const result = await api.setMemberCollectionForced(!forced)
                    if (result.kind === 'refused') setRefusal(TEXT.memberCollection.refused[result.reason] ?? null)
                  })
                }}
              >
                {forced ? TEXT.memberCollection.forceRelease : TEXT.memberCollection.force}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export function CollectionStatus(): React.JSX.Element {
  const collection = useApp((s) => s.collection)
  const memberCollection = useApp((s) => s.memberCollection)
  const schedule = useApp((s) => s.collectionSchedule)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  const [firstDay, setFirstDay] = useState(() => kstDateValue(Date.now() - 3 * 86_400_000))
  const [lastDay, setLastDay] = useState(() => kstDateValue(Date.now()))
  /** What the last press answered, until the next one. */
  const [refusal, setRefusal] = useState<string | null>(null)
  /**
   * The period that was asked for while another job was still unfinished, held
   * until the operator answers. Only the request is kept: the job it would
   * replace is read live below, so a scheduled block that advances the cursor
   * while the panel is open cannot leave a stale number in front of the answer.
   */
  const [replacing, setReplacing] = useState<CollectionRunRequest | null>(null)

  const press = (request?: CollectionRunRequest): void => {
    setRefusal(null)
    setReplacing(null)
    void act(async () => {
      const result = await api.startCollection(request)
      if (result.kind === 'needs_replace' && request !== undefined) {
        setReplacing(request)
        return
      }
      setRefusal(refusalText(result))
    })
  }

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
        <Unavailable view={collection} />
      </div>
    )
  }

  const { job, totals, running, recentRuns } = collection.status
  const nowMs = Date.now()
  const coverage = running === null ? null : collectionCoveragePercent(running)
  const lastFinished = recentRuns.find((run) => run.status !== 'running') ?? null

  return (
    <div className="flex flex-col gap-6">
      {heading}

      {/* The same banner the dashboard uses for "what is happening now", so a
          collection in flight is read the same way a session in flight is. */}
      <section className="panel overflow-hidden">
        <div className="flex">
          <div className={`w-1 shrink-0 ${running === null ? 'bar-idle' : 'bar-accent'}`} />
          <div className="flex flex-1 items-center justify-between gap-6 px-5 py-4">
            <div className="flex-1">
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {running === null ? TEXT.collection.lastRun : TEXT.collection.running}
              </div>
              {running === null ? (
                <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--ink-muted)' }}>
                  {lastFinished === null
                    ? TEXT.collection.never
                    : `${collectionRangeLabel(lastFinished)} · ${relativeTime(lastFinished.finishedAtMs ?? lastFinished.startedAtMs, nowMs)}`}
                </div>
              ) : (
                <>
                  <div className="mt-1 text-lg font-semibold tone-accent">
                    {collectionRangeLabel(running)} · {TEXT.collection.pagesRead(running.collectionPages)}
                  </div>
                  {coverage !== null && (
                    <div className="mt-2 flex items-center gap-3">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full"
                        style={{ background: 'var(--surface-sunken)' }}
                      >
                        <div className="h-full bar-accent" style={{ width: `${coverage}%` }} />
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                        {TEXT.collection.coverage(coverage)}
                      </span>
                    </div>
                  )}
                  <div className="mt-2 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                    {TEXT.collection.newPosts(running.insertedPostCount)}
                    {' · '}
                    {TEXT.collection.elapsed(relativeTime(running.startedAtMs, nowMs))}
                  </div>
                </>
              )}
              {schedule !== null && running === null && (
                <div className="mt-2 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {schedule.nextRunAtMs === null
                    ? TEXT.collection.nextRunNone
                    : TEXT.collection.nextRunAt(formatKstTime(schedule.nextRunAtMs))}
                </div>
              )}
              {job?.forced === true && (
                <div className="mt-2 text-sm tone-warn">{TEXT.collection.forcedOn}</div>
              )}
              {refusal !== null && <div className="mt-2 text-sm tone-warn">{refusal}</div>}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy || running !== null}
                onClick={() => press()}
              >
                {TEXT.collection.collectNow}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || running === null}
                onClick={() => void act(() => api.stopCollection())}
              >
                {TEXT.collection.stop}
              </button>
              {/* Only the hours give way, and only for the job in hand — which
                  is why this sits with the job's own controls rather than in
                  the schedule settings. */}
              {job !== null && !job.complete && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setRefusal(null)
                    void act(async () => {
                      const result = await api.setCollectionForced(!job.forced)
                      if (result.kind === 'refused') setRefusal(TEXT.collection.refused[result.reason])
                    })
                  }}
                >
                  {job.forced ? TEXT.collection.forceRelease : TEXT.collection.force}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {replacing !== null && job !== null && (
        <section className="panel overflow-hidden">
          <div className="flex">
            <div className="w-1 shrink-0 bar-warn" />
            <div className="flex-1 px-5 py-4">
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {TEXT.collection.replace.heading}
              </div>
              <p className="mt-1 text-sm font-semibold tone-warn">
                {/* The end is the midnight after the last day, so naming it
                    directly would announce a day that is not in the period. */}
                {TEXT.collection.replace.period(
                  formatKstDate(job.targetStartMs),
                  formatKstDate(job.targetEndMs - 1),
                )}
              </p>
              {/* Said as how far it walked rather than as pages: the operator is
                  deciding whether to throw this position away. */}
              <p className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                {(() => {
                  const percent = collectionCoveragePercent(job)
                  return percent === null || job.cursorPostedAtMs === null
                    ? TEXT.collection.replace.progressUnknown
                    : `${TEXT.collection.replace.progress(percent)} · ${TEXT.collection.replace.walkedTo(
                        formatKstDateTime(job.cursorPostedAtMs),
                      )}`
                })()}
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.collection.replace.cost}
              </p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => press({ ...replacing, replace: true })}
                >
                  {TEXT.collection.replace.confirm}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setReplacing(null)}>
                  {TEXT.collection.replace.cancel}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* A window the operator names, as opposed to the schedule's own. Whole
          days, because that is the unit they think in; already-stored posts
          gain one more observation rather than a duplicate row. */}
      <section className="panel flex flex-wrap items-end gap-3 px-5 py-4">
        <div>
          <label
            className="block text-[0.6875rem] font-medium uppercase tracking-wider"
            style={{ color: 'var(--ink-muted)' }}
            htmlFor="collect-from"
          >
            {TEXT.collection.periodFrom}
          </label>
          <input
            id="collect-from"
            type="date"
            className="field mt-1"
            value={firstDay}
            max={kstDateValue(Date.now())}
            onChange={(event) => setFirstDay(event.target.value)}
          />
        </div>
        <div>
          <label
            className="block text-[0.6875rem] font-medium uppercase tracking-wider"
            style={{ color: 'var(--ink-muted)' }}
            htmlFor="collect-to"
          >
            {TEXT.collection.periodTo}
          </label>
          <input
            id="collect-to"
            type="date"
            className="field mt-1"
            value={lastDay}
            max={kstDateValue(Date.now())}
            onChange={(event) => setLastDay(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy || running !== null}
          onClick={() =>
            press({ firstDayMs: kstMidnightOf(firstDay), lastDayMs: kstMidnightOf(lastDay) })
          }
        >
          {TEXT.collection.periodRun}
        </button>
        <p className="w-full text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collection.periodHint}
        </p>
      </section>

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

      <MemberCollectionCard memberCollection={memberCollection} busy={busy} act={act} />
    </div>
  )
}
