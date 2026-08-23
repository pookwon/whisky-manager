import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findAutomation } from '../../shared/automations/catalog.js'
import { api } from '../api.js'
import type { StartupPreview } from '../../desktop/preview.js'
import {
  estimatedMinutes,
  outcomeSummary,
  progressSummary,
  relativeTime,
  isRefusalStale,
  formatNextSessionTime,
  getBridgeStatusKey,
} from '../format.js'
import { useApp } from '../store.js'

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: string | undefined
}): React.JSX.Element {
  return (
    <div className="panel px-4 py-3.5">
      <div className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className={`mt-1 text-3xl font-bold tabular-nums leading-none ${tone ?? ''}`}>{value}</div>
    </div>
  )
}

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

export function Dashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const dashboard = useApp((s) => s.dashboard)
  const setRoute = useApp((s) => s.setRoute)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  const [day, setDay] = useState(() => kstDateValue(Date.now()))
  const [pending, setPending] = useState<PendingRun | null>(null)

  if (dashboard === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const running = dashboard.loopRunning
  const preview = dashboard.startupPreview
  /**
   * Shows the run before it happens, then counts what it would answer. The
   * panel opens on the first line rather than after the count, because
   * counting reaches the cafe and takes seconds an operator should not spend
   * wondering whether their click registered.
   */
  const openConfirmation = async (run: Omit<PendingRun, 'preview'>): Promise<void> => {
    setPending({ ...run, preview: null })
    const preview = await api
      .previewDay(run.dayStartMs ?? kstMidnightOf(kstDateValue(Date.now())))
      .catch(() => ({ kind: 'UNAVAILABLE', reason: 'READ_FAILED' }) as StartupPreview)
    setPending((current) => (current === null ? null : { ...current, preview }))
  }

  /** What the count says, in the operator's terms. */
  const describe = (preview: StartupPreview | null): string => {
    if (preview === null) return t('run.counting')
    if (preview.kind === 'UNAVAILABLE') return t('run.countFailed')
    return `${t('run.target', { count: preview.count })} · ${t('run.estimate', {
      minutes: estimatedMinutes(preview.count, dashboard.averageActionGapMs),
    })}`
  }

  /** Non-null exactly while a session is in flight. */
  const progress =
    dashboard.sessionProgress === null ? null : progressSummary(dashboard.sessionProgress)

  // Determine the main outcome display
  const summary = outcomeSummary(dashboard.lastOutcome)
  let outcomeTone = summary.tone
  let outcomeKey = summary.key

  // Check if a refusal is stale (e.g., DISABLED when now enabled)
  // Get the first automation to check if it's enabled (or could check any automation)
  const firstAutomation = dashboard.automations[0]
  const automationIsEnabled = firstAutomation?.enabled ?? true
  if (isRefusalStale(dashboard.lastOutcome, automationIsEnabled)) {
    outcomeKey = 'outcome.neverWithCurrentConfig'
    outcomeTone = 'idle'
  }

  // Show startup preview banner only when it's READY and loop is not running
  const showStartupBanner = preview?.kind === 'READY' && !running

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{t('dashboard.heading')}</h1>
      </header>

      {/* Startup preview banner: shows today's greeting target count when the
          app starts and the bridge connects. Helps the operator decide whether
          to trigger the automation. Hidden once the loop is running. */}
      {showStartupBanner && (
        <section className="panel overflow-hidden">
          <div className="flex">
            <div className="w-1 shrink-0 bar-accent" />
            <div className="flex flex-1 items-center gap-6 px-5 py-4">
              <div>
                <div
                  className="text-[0.6875rem] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {t('startup.heading')}
                </div>
                <div className="mt-1 text-lg font-semibold tone-accent">
                  {t('startup.count', { count: preview.count })}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Preview unavailable banner: shown when the startup count could not be
          determined. Visibly different from the ready state to avoid confusion. */}
      {preview?.kind === 'UNAVAILABLE' && !running && (
        <section className="panel overflow-hidden">
          <div className="flex">
            <div className="w-1 shrink-0 bar-warn" />
            <div className="flex flex-1 items-center gap-6 px-5 py-4">
              <div>
                <div
                  className="text-[0.6875rem] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {t('startup.heading')}
                </div>
                <div className="mt-1 text-lg font-semibold tone-warn">
                  {t(`startup.unavailable.${preview.reason}`)}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* The banner comes first because "why is it quiet?" is the question an
          operator opens this window to answer. While a session is in flight the
          answer is "it isn't", so present progress takes the slot over from the
          last session's result — a run can take the better part of an hour. */}
      <section className="panel overflow-hidden">
        <div className="flex">
          <div className={`w-1 shrink-0 ${progress === null ? `bar-${outcomeTone}` : 'bar-accent'}`} />
          <div className="flex flex-1 items-center justify-between gap-6 px-5 py-4">
            <div className="flex-1">
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {t(progress === null ? 'outcome.heading' : 'progress.heading')}
              </div>
              {progress === null ? (
                <div className={`mt-1 text-lg font-semibold tone-${outcomeTone}`}>
                  {dashboard.lastOutcomeAt !== null ? (
                    <>
                      {t('time.lastSession', {
                        elapsed: t(relativeTime(dashboard.lastOutcomeAt, Date.now()).key, {
                          count: relativeTime(dashboard.lastOutcomeAt, Date.now()).count,
                        }),
                      })}
                      <span style={{ color: 'var(--ink-muted)' }} className="text-sm">
                        {' · '}
                        {t(outcomeKey, { count: summary.count ?? 0 })}
                      </span>
                    </>
                  ) : (
                    t(outcomeKey, { count: summary.count ?? 0 })
                  )}
                </div>
              ) : (
                <div className="mt-1 text-lg font-semibold tone-accent">
                  {t(progress.key, progress.values)}
                </div>
              )}

              {running && dashboard.nextSessionAt !== null && (
                <div className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  {t('time.nextSession', { time: formatNextSessionTime(dashboard.nextSessionAt) || '—' })}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy || progress !== null}
                onClick={() => {
                  if (dashboard.withinActiveHours) {
                    void act(() => api.runOnce())
                    return
                  }
                  void openConfirmation({ dayStartMs: null, reason: 'OUTSIDE_HOURS' })
                }}
              >
                {t('status.runOnce')}
              </button>
              <button
                type="button"
                className={running ? 'btn' : 'btn btn-primary'}
                disabled={busy}
                onClick={() => void act(() => (running ? api.stopAutomation() : api.startAutomation()))}
              >
                {t(running ? 'status.stop' : 'status.start')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void act(() => api.killSwitch())}
              >
                {t('status.kill')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {pending !== null && (
        <section className="panel overflow-hidden">
          <div className="flex">
            <div className="w-1 shrink-0 bar-warn" />
            <div className="flex-1 px-5 py-4">
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {t('run.confirmHeading')}
              </div>
              <p className="mt-1 text-sm font-semibold tone-warn">
                {pending.reason === 'OUTSIDE_HOURS'
                  ? t('run.outsideHours')
                  : t('run.chosenDay', { date: day })}
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                {t('run.bypasses')}
              </p>
              <p className="mt-2 text-sm">{describe(pending.preview)}</p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  // Held until the count arrives, so nobody approves a run
                  // without the number it was supposed to show them. A count
                  // that failed says so and lets them through anyway; a count
                  // still running has an answer coming.
                  disabled={busy || pending.preview === null}
                  onClick={() => {
                    const request = pending.dayStartMs === null
                      ? { force: true }
                      : { force: true, dayStartMs: pending.dayStartMs }
                    setPending(null)
                    void act(() => api.runOnce(request))
                  }}
                >
                  {t('run.confirm')}
                </button>
                <button type="button" className="btn" onClick={() => setPending(null)}>
                  {t('run.cancel')}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="panel flex flex-wrap items-end gap-3 px-5 py-4">
        <div>
          <label
            className="block text-[0.6875rem] font-medium uppercase tracking-wider"
            style={{ color: 'var(--ink-muted)' }}
            htmlFor="run-day"
          >
            {t('run.dayLabel')}
          </label>
          <input
            id="run-day"
            type="date"
            className="field mt-1"
            value={day}
            max={kstDateValue(Date.now())}
            onChange={(event) => setDay(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy || progress !== null}
          onClick={() =>
            void openConfirmation({ dayStartMs: kstMidnightOf(day), reason: 'CHOSEN_DAY' })
          }
        >
          {t('run.dayRun')}
        </button>
      </section>

      <section className="grid grid-cols-4 gap-3">
        <Stat label={t('stats.executedToday')} value={dashboard.executedToday} tone={undefined} />
        <Stat label={t('stats.succeededToday')} value={dashboard.succeededToday} tone="tone-ok" />
        <Stat
          label={t('stats.failedToday')}
          value={dashboard.failedToday}
          tone={dashboard.failedToday > 0 ? 'tone-alarm' : undefined}
        />
        <Stat
          label={t('stats.awaiting')}
          value={dashboard.awaitingApproval}
          tone={dashboard.awaitingApproval > 0 ? 'tone-warn' : undefined}
        />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2
            className="text-[0.6875rem] font-medium uppercase tracking-wider"
            style={{ color: 'var(--ink-muted)' }}
          >
            {t('dashboard.automations')}
          </h2>
          <span className={`text-xs font-medium tone-${dashboard.bridgeStatus === 'CONNECTED' ? 'ok' : dashboard.bridgeStatus === 'RECONNECTING' ? 'warn' : 'idle'}`}>
            {t(getBridgeStatusKey(dashboard.bridgeStatus))}
          </span>
        </div>
        {dashboard.automations.map((automation) => {
          const descriptor = findAutomation(automation.id)
          const rowSummary = outcomeSummary(automation.lastOutcome)
          let rowTone = rowSummary.tone
          let rowKey = rowSummary.key

          // Check if this automation's last refusal is stale
          if (isRefusalStale(automation.lastOutcome, automation.enabled)) {
            rowKey = 'outcome.neverWithCurrentConfig'
            rowTone = 'idle'
          }

          return (
            <button
              key={automation.id}
              type="button"
              className="panel flex items-center justify-between gap-4 px-4 py-3 text-left"
              onClick={() => setRoute({ kind: 'automation', id: automation.id, panel: 'settings' })}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full bar-${rowTone}`} />
                  <span className="text-sm font-semibold">
                    {descriptor === undefined ? automation.id : t(descriptor.labelKey)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {t(rowKey, { count: rowSummary.count ?? 0 })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {automation.awaitingApproval > 0 && (
                  <span className="chip tone-warn">
                    {t('dashboard.awaitingShort', { count: automation.awaitingApproval })}
                  </span>
                )}
                <span className={automation.enabled ? 'tone-ok' : 'tone-idle'}>
                  {t(automation.enabled ? 'status.running' : 'status.stopped')}
                </span>
              </div>
            </button>
          )
        })}
      </section>
    </div>
  )
}
