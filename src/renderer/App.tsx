import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp, type ViewName } from './store.js'
import { Approvals } from './views/Approvals.js'
import { Dashboard } from './views/Dashboard.js'
import { Settings } from './views/Settings.js'
import { Templates } from './views/Templates.js'

const REFRESH_MS = 5_000
const VIEWS: ViewName[] = ['dashboard', 'approvals', 'templates', 'settings']

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const refresh = useApp((s) => s.refresh)
  const awaiting = useApp((s) => s.awaiting)
  const dashboard = useApp((s) => s.dashboard)

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <div className="flex h-full">
      <nav
        className="flex w-56 shrink-0 flex-col gap-1 border-r p-3"
        style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}
      >
        <div className="mb-4 px-3 pt-2">
          <div className="text-[0.9375rem] font-bold tracking-tight">{t('app.title')}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[0.6875rem]" style={{ color: 'var(--ink-muted)' }}>
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${dashboard?.bridgeConnected === true ? 'bar-ok' : 'bar-alarm'}`}
            />
            {t(dashboard?.bridgeConnected === true ? 'status.connected' : 'status.disconnected')}
          </div>
        </div>

        {VIEWS.map((name) => (
          <button
            key={name}
            type="button"
            className="nav-item"
            aria-current={view === name ? 'page' : undefined}
            onClick={() => setView(name)}
          >
            <span>{t(`nav.${name}`)}</span>
            {name === 'approvals' && awaiting.length > 0 && <span className="chip">{awaiting.length}</span>}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto p-7">
        {view === 'dashboard' && <Dashboard />}
        {view === 'approvals' && <Approvals />}
        {view === 'templates' && <Templates />}
        {view === 'settings' && <Settings />}
      </main>
    </div>
  )
}
