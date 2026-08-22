import { create } from 'zustand'
import type { AwaitingItem, DashboardSnapshot, SettingsView } from '../desktop/ipc.js'
import type { Template } from '../shared/types.js'
import { api } from './api.js'

export type ViewName = 'dashboard' | 'approvals' | 'templates' | 'settings'

interface AppState {
  view: ViewName
  dashboard: DashboardSnapshot | null
  awaiting: AwaitingItem[]
  templates: Template[]
  settings: SettingsView | null
  busy: boolean
  setView: (view: ViewName) => void
  refresh: () => Promise<void>
  act: (run: () => Promise<unknown>) => Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  view: 'dashboard',
  dashboard: null,
  awaiting: [],
  templates: [],
  settings: null,
  busy: false,

  setView: (view) => set({ view }),

  refresh: async () => {
    const [dashboard, awaiting, templates, settings] = await Promise.all([
      api.getDashboard(),
      api.listAwaiting(),
      api.listTemplates(),
      api.getSettings(),
    ])
    set({ dashboard, awaiting, templates, settings })
  },

  /** Every mutation refreshes, so the screen never shows stale counts. */
  act: async (run) => {
    set({ busy: true })
    try {
      await run()
      await get().refresh()
    } finally {
      set({ busy: false })
    }
  },
}))
