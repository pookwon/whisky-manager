import { useEffect, useState } from 'react'
import { AUTOMATIONS } from '../shared/automations/catalog.js'
import { TEXT } from '../shared/text.js'
import {
  getBridgeStatusText,
  getBridgeStatusTone,
  shouldOfferExtensionRecovery,
} from './format.js'
import { routeKey, type Route } from './routes.js'
import { useApp } from './store.js'
import { Approvals } from './views/Approvals.js'
import { AutomationSettings } from './views/AutomationSettings.js'
import { CommonSettings } from './views/CommonSettings.js'
import { Dashboard } from './views/Dashboard.js'
import { ExtensionSetupDialog } from './views/ExtensionSetupDialog.js'
import { Templates } from './views/Templates.js'

const REFRESH_MS = 5_000

export function App(): React.JSX.Element {
  const route = useApp((s) => s.route)
  const setRoute = useApp((s) => s.setRoute)
  const refresh = useApp((s) => s.refresh)
  const loadCafeImage = useApp((s) => s.loadCafeImage)
  const dashboard = useApp((s) => s.dashboard)
  const cafeImage = useApp((s) => s.cafeImage)
  const error = useApp((s) => s.error)
  const [setupMode, setSetupMode] = useState<'connect' | 'recover' | null>(null)

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

  /**
   * Before the first poll answers there is nothing to report, and OFFLINE is the
   * honest reading: no extension has been seen yet.
   */
  const bridgeStatus = dashboard?.bridgeStatus ?? 'OFFLINE'

  /**
   * No extension has ever paired on this machine. Read as `=== false` rather
   * than negated so the state before the first poll — dashboard still null —
   * counts as "not known yet" instead of "not set up".
   */
  const needsSetup = dashboard?.extensionEverPaired === false
  const needsRecovery = shouldOfferExtensionRecovery(
    bridgeStatus,
    dashboard?.extensionEverPaired,
  )

  /** Read from the dashboard, which every route polls, so the badge stays live. */
  const awaitingFor = (automationId: string): number =>
    dashboard?.automations.find((a) => a.id === automationId)?.awaitingApproval ?? 0

  return (
    <div className="flex h-full">
      <nav
        className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3"
        style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}
      >
        <div className="mb-4 border-b px-3 pb-4 pt-2" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2.5">
            {cafeImage !== null && (
              <img
                src={cafeImage}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover"
                style={{ border: '1px solid var(--line)' }}
              />
            )}
            <div>
              <div className="text-[0.9375rem] font-bold tracking-tight">{TEXT.app.title}</div>
              <div
                className="mt-1 flex items-center gap-1.5 text-[0.6875rem]"
                style={{ color: 'var(--ink-muted)' }}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full bar-${getBridgeStatusTone(bridgeStatus)}`} />
                {getBridgeStatusText(bridgeStatus)}
              </div>
            </div>
          </div>

          {/* Only on an install that has never paired, and only once the first
              poll has answered — offered before then it would flash on every
              start, including for an operator who set this up months ago. */}
          {needsSetup && (
            <>
              <p className="mt-3 text-[0.6875rem] leading-snug" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.extensionSetup.connectHint}
              </p>
              <button
                type="button"
                className="btn btn-primary mt-2 w-full"
                onClick={() => setSetupMode('connect')}
              >
                {TEXT.extensionSetup.connect}
              </button>
            </>
          )}

          {needsRecovery && (
            <>
              <p className="mt-3 text-[0.6875rem] leading-snug" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.extensionSetup.recoverHint}
              </p>
              <button
                type="button"
                className="btn mt-2 w-full"
                onClick={() => setSetupMode('recover')}
              >
                {TEXT.extensionSetup.recover}
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          className="nav-item"
          aria-current={route.kind === 'dashboard' ? 'page' : undefined}
          onClick={() => setRoute({ kind: 'dashboard' })}
        >
          <span>{TEXT.nav.dashboard}</span>
        </button>

        {AUTOMATIONS.map((automation) => (
          <section
            key={automation.id}
            className="mt-5"
            aria-label={TEXT.automation[automation.labelKey]}
          >
            <h2 className="nav-section">{TEXT.automation[automation.labelKey]}</h2>
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
                    <span>{TEXT.nav[panel]}</span>
                    {panel === 'approvals' && awaiting > 0 && (
                      <span className="chip">{awaiting}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        <section className="mt-5" aria-label={TEXT.nav.common}>
          <h2 className="nav-group-label">{TEXT.nav.common}</h2>
          <button
            type="button"
            className="nav-item"
            aria-current={route.kind === 'commonSettings' ? 'page' : undefined}
            onClick={() => setRoute({ kind: 'commonSettings' })}
          >
            <span>{TEXT.nav.commonSettings}</span>
          </button>
        </section>
      </nav>

      <main className="flex-1 overflow-y-auto p-7">
        {error !== null && (
          <div role="alert" className="panel mb-5 px-4 py-3 text-sm tone-alarm">
            {TEXT.app.actionFailed(error)}
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

      {setupMode !== null && (
        <ExtensionSetupDialog mode={setupMode} onClose={() => setSetupMode(null)} />
      )}
    </div>
  )
}
