import { create } from 'zustand'
import type {
  AutomationSettingsView,
  AwaitingItem,
  CommonSettingsView,
  DashboardSnapshot,
} from '../desktop/ipc.js'
import type { Template } from '../shared/types.js'
import { api } from './api.js'
import { DEFAULT_ROUTE, automationOf, type Route } from './routes.js'

interface AppState {
  route: Route
  dashboard: DashboardSnapshot | null
  /** Data for the automation the current route points at, not every automation. */
  awaiting: AwaitingItem[]
  templates: Template[]
  automationSettings: AutomationSettingsView | null
  commonSettings: CommonSettingsView | null
  cafeImage: string | null
  busy: boolean
  /** Message of the last failed action, until the next action starts. */
  error: string | null
  setRoute: (route: Route) => void
  refresh: () => Promise<void>
  /** Fetched once, not on the poll loop: the backend caches it for a day, but there is no reason to ask more than once per session. */
  loadCafeImage: () => Promise<void>
  act: (run: () => Promise<unknown>) => Promise<boolean>
}

export const useApp = create<AppState>((set, get) => ({
  route: DEFAULT_ROUTE,
  dashboard: null,
  awaiting: [],
  templates: [],
  automationSettings: null,
  commonSettings: null,
  cafeImage: null,
  busy: false,
  error: null,

  setRoute: (route) => {
    set({ route })
    // Fetch straight away rather than waiting out the poll interval, so the
    // screen is never blank for five seconds after a click.
    void get().refresh()
  },

  /**
   * Only the route's own automation is fetched. Polling every automation would
   * multiply cafe traffic by the number of features for screens nobody is
   * looking at.
   *
   * By the same rule `commonSettings` is refetched only on the routes that
   * display it, so it can sit stale in the store while an automation screen is
   * open. That is invisible to the operator — every route into CommonSettings
   * goes through setRoute, which refreshes first.
   */
  refresh: async () => {
    const { route } = get()
    const automationId = automationOf(route)

    if (automationId === null) {
      const [dashboard, commonSettings] = await Promise.all([
        api.getDashboard(),
        api.getCommonSettings(),
      ])
      set({ dashboard, commonSettings })
      return
    }

    const [dashboard, awaiting, templates, automationSettings] = await Promise.all([
      api.getDashboard(),
      api.listAwaiting(automationId),
      api.listTemplates(automationId),
      api.getAutomationSettings(automationId),
    ])
    set({ dashboard, awaiting, templates, automationSettings })
  },

  loadCafeImage: async () => {
    const cafeImage = await api.getCafeImage()
    set({ cafeImage })
  },

  /**
   * Every mutation refreshes, so the screen never shows stale counts. A
   * failure is recorded rather than rethrown — a silent broken button is the
   * one thing the operator must never get.
   */
  act: async (run) => {
    set({ busy: true, error: null })
    try {
      await run()
      await get().refresh()
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      set({ busy: false })
    }
  },
}))
