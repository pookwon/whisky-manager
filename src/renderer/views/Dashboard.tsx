import { useTranslation } from 'react-i18next'
import { findAutomation } from '../../shared/automations/catalog.js'
import { api } from '../api.js'
import { outcomeSummary } from '../format.js'
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

export function Dashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const dashboard = useApp((s) => s.dashboard)
  const setRoute = useApp((s) => s.setRoute)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  if (dashboard === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const summary = outcomeSummary(dashboard.lastOutcome)
  const running = dashboard.loopRunning

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{t('dashboard.heading')}</h1>
      </header>

      {/* The banner comes first because "why is it quiet?" is the question an
          operator opens this window to answer. */}
      <section className="panel overflow-hidden">
        <div className="flex">
          <div className={`w-1 shrink-0 bar-${summary.tone}`} />
          <div className="flex flex-1 items-center justify-between gap-6 px-5 py-4">
            <div>
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {t('outcome.heading')}
              </div>
              <div className={`mt-1 text-lg font-semibold tone-${summary.tone}`}>
                {t(summary.key, { count: summary.count ?? 0 })}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void act(() => api.runOnce())}
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
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('dashboard.automations')}
        </h2>
        {dashboard.automations.map((automation) => {
          const descriptor = findAutomation(automation.id)
          const rowSummary = outcomeSummary(automation.lastOutcome)
          return (
            <button
              key={automation.id}
              type="button"
              className="panel flex items-center justify-between gap-4 px-4 py-3 text-left"
              onClick={() => setRoute({ kind: 'automation', id: automation.id, panel: 'settings' })}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full bar-${rowSummary.tone}`} />
                  <span className="text-sm font-semibold">
                    {descriptor === undefined ? automation.id : t(descriptor.labelKey)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {t(rowSummary.key, { count: rowSummary.count ?? 0 })}
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
