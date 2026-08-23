import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AUTOMATIONS } from '../shared/automations/catalog.js'
import { routeKey, type Route } from './routes.js'
import { useApp } from './store.js'
import { Approvals } from './views/Approvals.js'
import { AutomationSettings } from './views/AutomationSettings.js'
import { CommonSettings } from './views/CommonSettings.js'
import { Dashboard } from './views/Dashboard.js'
import { Templates } from './views/Templates.js'

const REFRESH_MS = 5_000

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const route = useApp((s) => s.route)
  const setRoute = useApp((s) => s.setRoute)
  const refresh = useApp((s) => s.refresh)
  const loadCafeImage = useApp((s) => s.loadCafeImage)
  const dashboard = useApp((s) => s.dashboard)
  const cafeImage = useApp((s) => s.cafeImage)
  const error = useApp((s) => s.error)

  useEffect(() => {
    // A failed background poll is logged, not surfaced: the next tick retries
    // in five seconds and a persistent banner would just be noise.
    const tick = (): void => {
      refresh().catch(console.error)
    }
    tick()
    const timer = setInterval(tick, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    // Once per session: the backend already caches the probe for a day.
    loadCafeImage().catch(console.error)
  }, [loadCafeImage])

  /** Read from the dashboard, which every route polls, so the badge stays live. */
  const awaitingFor = (automationId: string): number =>
    dashboard?.automations.find((a) => a.id === automationId)?.awaitingApproval ?? 0

  return (
    <div className="flex h-full">
      <nav
        className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3"
        style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}
      >
        <div
          className="mb-4 flex items-center gap-2.5 border-b px-3 pb-4 pt-2"
          style={{ borderColor: 'var(--line)' }}
        >
          {cafeImage !== null && (
            <img
              src={cafeImage}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover"
              style={{ border: '1px solid var(--line)' }}
            />
          )}
          <div>
            <div className="text-[0.9375rem] font-bold tracking-tight">{t('app.title')}</div>
            <div
              className="mt-1 flex items-center gap-1.5 text-[0.6875rem]"
              style={{ color: 'var(--ink-muted)' }}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${dashboard?.bridgeConnected === true ? 'bar-ok' : 'bar-alarm'}`}
              />
              {t(dashboard?.bridgeConnected === true ? 'status.connected' : 'status.disconnected')}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="nav-item"
          aria-current={route.kind === 'dashboard' ? 'page' : undefined}
          onClick={() => setRoute({ kind: 'dashboard' })}
        >
          <span>{t('nav.dashboard')}</span>
        </button>

        {AUTOMATIONS.map((automation) => (
          <section key={automation.id} className="mt-5" aria-label={t(automation.labelKey)}>
            <h2 className="nav-section">{t(automation.labelKey)}</h2>
            <div className="nav-children">
              {automation.panels.map((panel) => {
                const target: Route = { kind: 'automation', id: automation.id, panel }
                const awaiting = awaitingFor(automation.id)
                return (
                  <button
                    key={routeKey(target)}
                    type="button"
                    className="nav-item nav-item-sub"
                    aria-current={routeKey(route) === routeKey(target) ? 'page' : undefined}
                    onClick={() => setRoute(target)}
                  >
                    <span>{t(`nav.${panel}`)}</span>
                    {panel === 'approvals' && awaiting > 0 && (
                      <span className="chip">{awaiting}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        <section className="mt-5" aria-label={t('nav.common')}>
          <h2 className="nav-group-label">{t('nav.common')}</h2>
          <button
            type="button"
            className="nav-item"
            aria-current={route.kind === 'commonSettings' ? 'page' : undefined}
            onClick={() => setRoute({ kind: 'commonSettings' })}
          >
            <span>{t('nav.commonSettings')}</span>
          </button>
        </section>
      </nav>

      <main className="flex-1 overflow-y-auto p-7">
        {error !== null && (
          <div role="alert" className="panel mb-5 px-4 py-3 text-sm tone-alarm">
            {t('app.actionFailed', { message: error })}
          </div>
        )}
        {route.kind === 'dashboard' && <Dashboard />}
        {route.kind === 'commonSettings' && <CommonSettings />}
        {route.kind === 'automation' && route.panel === 'approvals' && (
          <Approvals automationId={route.id} />
        )}
        {route.kind === 'automation' && route.panel === 'templates' && (
          <Templates automationId={route.id} />
        )}
        {route.kind === 'automation' && route.panel === 'settings' && (
          <AutomationSettings automationId={route.id} />
        )}
      </main>
    </div>
  )
}
