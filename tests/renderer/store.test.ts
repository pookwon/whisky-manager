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
  setBoardId: vi.fn(),
  setPolicy: vi.fn(),
  setEnabled: vi.fn(),
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

const snapshot: DashboardSnapshot = {
  bridgeConnected: false,
  loopRunning: false,
  awaitingApproval: 0,
  executedToday: 0,
  succeededToday: 0,
  failedToday: 0,
  lastOutcome: null,
  automations: [],
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

describe('useApp.act', () => {
  beforeEach(() => {
    wm.getDashboard.mockResolvedValue(snapshot)
    wm.listAwaiting.mockResolvedValue([])
    wm.listTemplates.mockResolvedValue([])
    wm.getCommonSettings.mockResolvedValue(commonSettings)
    wm.getAutomationSettings.mockResolvedValue(automationSettings)
    useApp.setState({ dashboard: null, error: null, busy: false })
  })

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
