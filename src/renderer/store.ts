import { create } from 'zustand'
import type {
  AutomationSettingsView,
  AwaitingItem,
  CommonSettingsView,
  DashboardSnapshot,
} from '../desktop/ipc.js'
import type { Template } from '../shared/types.js'
import { WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'
import { api } from './api.js'

export type ViewName = 'dashboard' | 'approvals' | 'templates' | 'settings'

/**
 * The settings screen still reads one flat object. Recomposing the two halves
 * here keeps that screen untouched while the API underneath is already split;
 * the navigation rework replaces this with the two halves held separately.
 */
type SettingsView = CommonSettingsView & AutomationSettingsView

interface AppState {
  view: ViewName
  dashboard: DashboardSnapshot | null
  awaiting: AwaitingItem[]
  templates: Template[]
  settings: SettingsView | null
  cafeImage: string | null
  busy: boolean
  /** Message of the last failed action, until the next action starts. */
  error: string | null
  setView: (view: ViewName) => void
  refresh: () => Promise<void>
  /** Fetched once, not on the poll loop: the backend caches it for a day, but there is no reason to ask more than once per session. */
  loadCafeImage: () => Promise<void>
  act: (run: () => Promise<unknown>) => Promise<boolean>
}

export const useApp = create<AppState>((set, get) => ({
  view: 'dashboard',
  dashboard: null,
  awaiting: [],
  templates: [],
  settings: null,
  cafeImage: null,
  busy: false,
  error: null,

  setView: (view) => set({ view }),

  refresh: async () => {
    const [dashboard, awaiting, templates, common, automation] = await Promise.all([
      api.getDashboard(),
      api.listAwaiting(WELCOME_AUTOMATION_ID),
      api.listTemplates(WELCOME_AUTOMATION_ID),
      api.getCommonSettings(),
      api.getAutomationSettings(WELCOME_AUTOMATION_ID),
    ])
    set({ dashboard, awaiting, templates, settings: { ...common, ...automation } })
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
