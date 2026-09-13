import { useRef, useState } from 'react'
import { WELCOME_AUTOMATION_ID } from '../../shared/automations/catalog.js'
import { TEXT } from '../../shared/text.js'
import { api } from '../api.js'
import type { StartupPreview } from '../../desktop/preview.js'
import type { StartCollectionResult } from '../../desktop/ipc.js'
import {
  activeWindowLabel,
  estimatedMinutes,
  disabledAutomationNames,
  getBridgeStatusText,
  getBridgeStatusTone,
} from '../format.js'
import { useApp } from '../store.js'
import { CollectionJob } from './dashboard/CollectionJob.js'
import { CommentJob } from './dashboard/CommentJob.js'
import { commentCards, type CommentCard } from './dashboard/commentCards.js'
import { DayRhythm } from './dashboard/DayRhythm.js'
import { collectionJobState } from './dashboard/quiet.js'

/** A run described to the operator and waiting on their answer. */
interface PendingRun {
  readonly dayStartMs: number | null
  readonly reason: 'OUTSIDE_HOURS' | 'CHOSEN_DAY'
  readonly preview: StartupPreview | null
}

/** `YYYY-MM-DD` in KST, which is what the date input speaks. */
function kstDateValue(epochMs: number): string {
  return new Date(epochMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Midnight KST of a `YYYY-MM-DD` the operator picked. */
function kstMidnightOf(value: string): number {
  return Date.parse(`${value}T00:00:00+09:00`)
}

/** Why a press to collect did nothing, in the words of the thing to fix. */
function collectionRefusalText(result: StartCollectionResult): string | null {
  if (result.kind === 'refused') return TEXT.collection.refused[result.reason]
  if (result.kind === 'rejected') return TEXT.collection.rejected[result.problem]
  return null
}

/**
 * The dashboard, organised by job.
 *
 * Two kinds of thing run here and they are not alike: comments go out in
 * sessions through the day, one card per automation, while the collection
 * walks a fixed past period across many runs and many days. The screen is laid
 * out to say which is which before it says anything else — each job owns one
 * panel and nothing outside it, and the day band that shows both at once
 * waits folded below them.
 */
export function Dashboard(): React.JSX.Element {
  const dashboard = useApp((s) => s.dashboard)
  const collection = useApp((s) => s.collection)
  const schedule = useApp((s) => s.collectionSchedule)
  const setRoute = useApp((s) => s.setRoute)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  const [day, setDay] = useState(() => kstDateValue(Date.now()))
  const [pending, setPending] = useState<PendingRun | null>(null)
  /** What the last press to collect answered, until the next one. */
  const [collectionRefusal, setCollectionRefusal] = useState<string | null>(null)
  /**
   * Which confirmation the counts coming back belong to. Counting reaches the
   * cafe and takes seconds, so a panel opened, dismissed and opened again on a
   * different day can have two answers in the air; without this the first to
   * arrive fills in whichever panel is showing, and the operator approves a
   * run against a number that was never about it.
   */
  const openedRuns = useRef(0)

  if (dashboard === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const nowMs = Date.now()

  /**
   * Shows the run before it happens, then counts what it would answer. The
   * panel opens on the first line rather than after the count, because
   * counting reaches the cafe and takes seconds an operator should not spend
   * wondering whether their click registered.
   */
  const openConfirmation = async (run: Omit<PendingRun, 'preview'>): Promise<void> => {
    const opened = (openedRuns.current += 1)
    setPending({ ...run, preview: null })
    const preview = await api
      .previewDay(run.dayStartMs ?? kstMidnightOf(kstDateValue(Date.now())))
      .catch(() => ({ kind: 'UNAVAILABLE', reason: 'READ_FAILED' }) as StartupPreview)
    if (openedRuns.current !== opened) return
    setPending((current) => (current === null ? null : { ...current, preview }))
  }

  /**
   * The three numbers the operator is weighing, each on its own line. Run
   * together they read as one figure, and the one that matters — how many
   * comments actually go out — is the smallest of them.
   */
  const breakdown = (preview: Extract<StartupPreview, { kind: 'READY' }>): React.JSX.Element => (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt style={{ color: 'var(--ink-muted)' }}>{TEXT.run.target}</dt>
      <dd className="font-semibold tabular-nums">
        {preview.pending > 0
          ? TEXT.run.countWithPending(preview.count, preview.pending)
          : TEXT.run.countUnit(preview.count)}
      </dd>
      <dt style={{ color: 'var(--ink-muted)' }}>{TEXT.run.alreadyHandled}</dt>
      <dd className="tabular-nums" style={{ color: 'var(--ink-muted)' }}>
        {TEXT.run.countUnit(preview.alreadyHandled)}
      </dd>
      <dt style={{ color: 'var(--ink-muted)' }}>{TEXT.run.estimate}</dt>
      <dd className="tabular-nums">
        {TEXT.run.minutesUnit(estimatedMinutes(preview.count, dashboard.averageActionGapMs))}
      </dd>
    </dl>
  )

  /**
   * Outside the window the welcome card asks before it runs, because only it
   * can say beforehand what a forced run would answer — the count is of
   * greetings. Every other card runs straight away and, outside the window,
   * reports the refusal like any session would.
   */
  const runOnce = (card: CommentCard): void => {
    if (card.showDayControls && !dashboard.withinActiveHours) {
      void openConfirmation({ dayStartMs: null, reason: 'OUTSIDE_HOURS' })
      return
    }
    void act(() => api.runOnce(card.automationId))
  }

  const collectionState =
    collection === null
      ? null
      : collectionJobState({ nowMs, collection, schedule, bridgeStatus: dashboard.bridgeStatus })

  const ready = collection?.kind === 'ready' ? collection.status : null
  const collectionWindow =
    schedule === null
      ? null
      : {
          startHour: schedule.schedule.activeWindowStartHourKst,
          endHour: schedule.schedule.activeWindowEndHourKst,
        }

  /**
   * Not hidden while the loop runs: a running loop with a switched-off
   * automation is exactly the state that reads as broken, because every session
   * it opens refuses and nothing on this screen says why until the operator has
   * pressed something and waited.
   */
  const disabledNames = disabledAutomationNames(dashboard.automations)

  const collectNow = (): void => {
    setCollectionRefusal(null)
    void act(async () => {
      const result = await api.startCollection()
      setCollectionRefusal(collectionRefusalText(result))
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The extension is what both jobs stand on and neither of them owns,
          so it rides the heading rather than taking a panel that would have
          to belong to one of the two. */}
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-bold tracking-tight">{TEXT.dashboard.heading}</h1>
        <div className={`text-xs font-medium tone-${getBridgeStatusTone(dashboard.bridgeStatus)}`}>
          {getBridgeStatusText(dashboard.bridgeStatus)}
        </div>
      </div>

      {disabledNames.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="flex">
            <div className="w-1 shrink-0 bar-warn" />
            <div className="flex-1 px-5 py-3.5">
              <div className="text-sm font-semibold tone-warn">
                {TEXT.dashboard.disabled(disabledNames.join(', '))}
              </div>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.dashboard.disabledHow}
              </p>
            </div>
          </div>
        </section>
      )}

      {commentCards(dashboard).map((card) => (
        <CommentJob
          key={card.automationId}
          title={card.title}
          showDayControls={card.showDayControls}
          state={card.state}
          executedToday={card.executedToday}
          succeededToday={card.succeededToday}
          failedToday={card.failedToday}
          awaitingApproval={card.awaitingApproval}
          executedByHour={card.executedByHour}
          lastOutcomeText={card.lastOutcomeText}
          lastOutcomeAt={card.lastOutcomeAt}
          startupPreview={dashboard.startupPreview}
          nowMs={nowMs}
          loopRunning={dashboard.loopRunning}
          sessionInFlight={card.sessionInFlight}
          busy={busy}
          day={day}
          maxDay={kstDateValue(nowMs)}
          onDayChange={setDay}
          onRunOnce={() => runOnce(card)}
          onRunDay={() => void openConfirmation({ dayStartMs: kstMidnightOf(day), reason: 'CHOSEN_DAY' })}
          // Start, stop and kill move every automation's loop together — the
          // tray has one of each too. One automation alone is paused with its
          // own switch in settings.
          onToggleLoop={() =>
            void act(() => (dashboard.loopRunning ? api.stopAutomation() : api.startAutomation()))
          }
          onKill={() => void act(() => api.killSwitch())}
        />
      ))}

      {collection !== null && collectionState !== null && (
        <CollectionJob
          state={collectionState}
          collection={collection}
          refusal={collectionRefusal}
          nowMs={nowMs}
          busy={busy}
          onCollectNow={collectNow}
          onStop={() => void act(() => api.stopCollection())}
          onStartSchedule={
            // Offered only when the schedule being off is what the panel is
            // complaining about. With no job, or one already walked to its end,
            // turning the schedule on changes nothing — the beat would find
            // nothing to continue — and the press that helps is the one into
            // the collection screen, which is the button beside this.
            schedule === null ||
            schedule.schedule.enabled ||
            collection.kind !== 'ready' ||
            collection.status.job === null ||
            collection.status.job.complete
              ? null
              : () => void act(() => api.setCollectionSchedule({ ...schedule.schedule, enabled: true }))
          }
          onOpenStatus={() => setRoute({ kind: 'collection', panel: 'status' })}
        />
      )}

      <DayRhythm
        nowMs={nowMs}
        commentWindow={{ startHour: dashboard.activeHourStart, endHour: dashboard.activeHourEnd }}
        lastSessionAt={dashboard.lastOutcomeAt}
        nextSessionAt={dashboard.nextSessionAt}
        collectionWindow={collectionWindow}
        finishedRuns={ready?.recentRuns.filter((run) => run.status !== 'running') ?? []}
        runningStartedAtMs={ready?.running?.startedAtMs ?? null}
        nextRunAtMs={schedule?.nextRunAtMs ?? null}
        workBlockMs={schedule === null ? null : schedule.schedule.workBlockMinutes * 60_000}
      />

      {pending !== null && (
        <section className="panel overflow-hidden">
          <div className="flex">
            <div className="w-1 shrink-0 bar-warn" />
            <div className="flex-1 px-5 py-4">
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {TEXT.run.confirmHeading}
              </div>
              <p className="mt-1 text-sm font-semibold tone-warn">
                {pending.reason === 'OUTSIDE_HOURS'
                  ? TEXT.run.outsideHours(
                      activeWindowLabel(dashboard.activeHourStart, dashboard.activeHourEnd),
                    )
                  : TEXT.run.chosenDay(day)}
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.run.bypasses}
              </p>
              {pending.preview === null && (
                <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  {TEXT.run.counting}
                </p>
              )}
              {pending.preview?.kind === 'UNAVAILABLE' && (
                <p className="mt-2 text-sm tone-warn">{TEXT.run.countFailed}</p>
              )}
              {pending.preview?.kind === 'READY' && breakdown(pending.preview)}

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  // Held until this panel's own count arrives, so nobody
                  // approves a run without the number it was supposed to show
                  // them. A count that failed says so and lets them through
                  // anyway; a count still running has an answer coming.
                  disabled={busy || pending.preview === null}
                  onClick={() => {
                    const request = pending.dayStartMs === null
                      ? { force: true }
                      : { force: true, dayStartMs: pending.dayStartMs }
                    setPending(null)
                    void act(() => api.runOnce(WELCOME_AUTOMATION_ID, request))
                  }}
                >
                  {TEXT.run.confirm}
                </button>
                <button type="button" className="btn" onClick={() => setPending(null)}>
                  {TEXT.run.cancel}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
