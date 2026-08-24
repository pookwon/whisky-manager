import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AutomationSettingsView,
  CommonSettingsView,
  DashboardSnapshot,
} from '../../src/desktop/ipc.js'

const wm = {
  getDashboard: vi.fn(),
  listAwaiting: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  listTemplates: vi.fn(),
  addTemplate: vi.fn(),
  removeTemplate: vi.fn(),
  getCommonSettings: vi.fn(),
  getAutomationSettings: vi.fn(),
  getCafeImage: vi.fn(),
  setPolicy: vi.fn(),
  setEnabled: vi.fn(),
  setBoardId: vi.fn(),
  setOperatorAccounts: vi.fn(),
  setCafe: vi.fn(),
  getPairingToken: vi.fn(),
  startAutomation: vi.fn(),
  stopAutomation: vi.fn(),
  killSwitch: vi.fn(),
  runOnce: vi.fn(),
}

// The store reads window.wm at module load, so the stub must exist first.
vi.stubGlobal('window', { wm })
const { useApp } = await import('../../src/renderer/store.js')
const { DEFAULT_ROUTE } = await import('../../src/renderer/routes.js')

const snapshot: DashboardSnapshot = {
  loopRunning: false,
  awaitingApproval: 0,
  executedToday: 0,
  succeededToday: 0,
  failedToday: 0,
  lastOutcome: null,
  automations: [],
  startupPreview: null,
  dayPreview: null,
  lastOutcomeAt: null,
  nextSessionAt: null,
  sessionProgress: null,
  withinActiveHours: true,
  averageActionGapMs: 16_500,
  bridgeStatus: 'OFFLINE',
}

const commonSettings: CommonSettingsView = {
  cafeId: '10000000',
  cafeUrlName: 'examplecafe',
  operatorAccounts: [],
}

const automationSettings: AutomationSettingsView = {
  policy: 'AUTO',
  enabled: false,
  boardId: '5',
}

beforeEach(() => {
  vi.clearAllMocks()
  wm.getDashboard.mockResolvedValue(snapshot)
  wm.listAwaiting.mockResolvedValue([])
  wm.listTemplates.mockResolvedValue([])
  wm.getCommonSettings.mockResolvedValue(commonSettings)
  wm.getAutomationSettings.mockResolvedValue(automationSettings)
  useApp.setState({ route: DEFAULT_ROUTE, dashboard: null, error: null, busy: false })
})

describe('useApp.act', () => {
  it('refreshes and reports success', async () => {
    const ok = await useApp.getState().act(() => Promise.resolve())

    expect(ok).toBe(true)
    expect(useApp.getState().error).toBeNull()
    expect(useApp.getState().dashboard).toEqual(snapshot)
    expect(useApp.getState().busy).toBe(false)
  })

  it('records the failure instead of throwing, and skips the refresh', async () => {
    const ok = await useApp.getState().act(() => Promise.reject(new Error('approve rejected')))

    expect(ok).toBe(false)
    expect(useApp.getState().error).toBe('approve rejected')
    expect(useApp.getState().dashboard).toBeNull()
    expect(useApp.getState().busy).toBe(false)
  })

  it('clears the previous error when the next action starts', async () => {
    await useApp.getState().act(() => Promise.reject(new Error('boom')))
    await useApp.getState().act(() => Promise.resolve())

    expect(useApp.getState().error).toBeNull()
  })
})

describe('useApp.refresh', () => {
  it("fetches only the route's own automation", async () => {
    useApp.setState({ route: { kind: 'automation', id: 'welcome-comment', panel: 'approvals' } })

    await useApp.getState().refresh()

    expect(wm.listAwaiting.mock.calls).toEqual([['welcome-comment']])
    expect(wm.listTemplates.mock.calls).toEqual([['welcome-comment']])
    expect(wm.getAutomationSettings.mock.calls).toEqual([['welcome-comment']])
  })

  it('leaves automation data alone on the dashboard route', async () => {
    useApp.setState({ route: { kind: 'dashboard' } })

    await useApp.getState().refresh()

    expect(wm.listAwaiting).not.toHaveBeenCalled()
    expect(wm.listTemplates).not.toHaveBeenCalled()
    expect(wm.getAutomationSettings).not.toHaveBeenCalled()
  })

  it('fetches common settings on the common settings route', async () => {
    useApp.setState({ route: { kind: 'commonSettings' } })

    await useApp.getState().refresh()

    expect(wm.getCommonSettings).toHaveBeenCalledTimes(1)
    expect(useApp.getState().commonSettings).toEqual(commonSettings)
  })

  it('polls the dashboard on every route, so the approval badge stays live', async () => {
    useApp.setState({ route: { kind: 'automation', id: 'welcome-comment', panel: 'templates' } })

    await useApp.getState().refresh()

    expect(wm.getDashboard).toHaveBeenCalledTimes(1)
  })
})

describe('useApp.setRoute', () => {
  it('fetches the new route immediately rather than waiting for the poll', async () => {
    useApp.getState().setRoute({ kind: 'automation', id: 'welcome-comment', panel: 'approvals' })

    // setRoute starts the refresh without awaiting it; give it a turn to land.
    await vi.waitFor(() => expect(wm.listAwaiting).toHaveBeenCalledTimes(1))
    expect(useApp.getState().route).toEqual({
      kind: 'automation',
      id: 'welcome-comment',
      panel: 'approvals',
    })
  })
})
