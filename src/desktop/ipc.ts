import type { SessionOutcome } from './orchestrator.js'
import type { ApprovalPolicy, RiskFlag, Template } from '../shared/types.js'

export const IPC_CHANNELS = {
  getDashboard: 'wm:getDashboard',
  listAwaiting: 'wm:listAwaiting',
  approve: 'wm:approve',
  reject: 'wm:reject',
  listTemplates: 'wm:listTemplates',
  addTemplate: 'wm:addTemplate',
  removeTemplate: 'wm:removeTemplate',
  getSettings: 'wm:getSettings',
  setPolicy: 'wm:setPolicy',
  setEnabled: 'wm:setEnabled',
  setOperatorAccounts: 'wm:setOperatorAccounts',
  setCafe: 'wm:setCafe',
  getPairingToken: 'wm:getPairingToken',
  startAutomation: 'wm:startAutomation',
  stopAutomation: 'wm:stopAutomation',
  killSwitch: 'wm:killSwitch',
  runOnce: 'wm:runOnce',
} as const

export interface DashboardSnapshot {
  readonly bridgeConnected: boolean
  readonly loopRunning: boolean
  readonly awaitingApproval: number
  readonly executedToday: number
  readonly succeededToday: number
  readonly failedToday: number
  /**
   * Why the last session did or did not run. The operator needs to see
   * DISABLED / NO_TEMPLATE / KILLED / NOT_LOGGED_IN rather than just silence.
   */
  readonly lastOutcome: SessionOutcome | null
}

export interface AwaitingItem {
  readonly id: string
  readonly postId: string
  readonly author: string | null
  readonly title: string | null
  readonly renderedText: string | null
  readonly riskFlags: RiskFlag[]
  readonly detectedAt: number
}

export interface SettingsView {
  readonly policy: ApprovalPolicy
  readonly enabled: boolean
  readonly cafeId: string
  readonly boardId: string
  /** Vanity url segment, e.g. `examplecafe`; what a person opens the cafe by. */
  readonly cafeUrlName: string
  readonly operatorAccounts: string[]
}

export interface RendererApi {
  getDashboard(): Promise<DashboardSnapshot>
  listAwaiting(): Promise<AwaitingItem[]>
  approve(id: string): Promise<void>
  reject(id: string): Promise<void>
  listTemplates(): Promise<Template[]>
  addTemplate(body: string): Promise<void>
  removeTemplate(id: string): Promise<void>
  getSettings(): Promise<SettingsView>
  setPolicy(policy: ApprovalPolicy): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  setOperatorAccounts(accounts: string[]): Promise<void>
  setCafe(cafeId: string, boardId: string, cafeUrlName: string): Promise<void>
  getPairingToken(): Promise<string>
  startAutomation(): Promise<void>
  stopAutomation(): Promise<void>
  killSwitch(): Promise<void>
  runOnce(): Promise<void>
}
