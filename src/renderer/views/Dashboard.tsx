import { useTranslation } from 'react-i18next'
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
    </div>
  )
}
