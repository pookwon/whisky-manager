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
  getCommonSettings: 'wm:getCommonSettings',
  getAutomationSettings: 'wm:getAutomationSettings',
  getCafeImage: 'wm:getCafeImage',
  setPolicy: 'wm:setPolicy',
  setEnabled: 'wm:setEnabled',
  setBoardId: 'wm:setBoardId',
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
  /** One row per catalogued automation, so "why is it quiet?" is answerable per feature. */
  readonly automations: readonly AutomationStatus[]
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

/** Settings that belong to the app, not to any one automation. */
export interface CommonSettingsView {
  readonly cafeId: string
  /** Vanity url segment, e.g. `examplecafe`; what a person opens the cafe by. */
  readonly cafeUrlName: string
  readonly operatorAccounts: string[]
}

export interface AutomationSettingsView {
  readonly policy: ApprovalPolicy
  readonly enabled: boolean
  readonly boardId: string
}

export interface AutomationStatus {
  readonly id: string
  readonly enabled: boolean
  readonly awaitingApproval: number
  readonly executedToday: number
  readonly lastOutcome: SessionOutcome | null
}

export interface RendererApi {
  getDashboard(): Promise<DashboardSnapshot>
  listAwaiting(automationId: string): Promise<AwaitingItem[]>
  approve(id: string): Promise<void>
  reject(id: string): Promise<void>
  listTemplates(automationId: string): Promise<Template[]>
  addTemplate(automationId: string, body: string): Promise<void>
  removeTemplate(id: string): Promise<void>
  getCommonSettings(): Promise<CommonSettingsView>
  getAutomationSettings(automationId: string): Promise<AutomationSettingsView>
  /** Cached; only probes the cafe again after the daily TTL expires. */
  getCafeImage(): Promise<string | null>
  setPolicy(automationId: string, policy: ApprovalPolicy): Promise<void>
  setEnabled(automationId: string, enabled: boolean): Promise<void>
  setBoardId(automationId: string, boardId: string): Promise<void>
  setOperatorAccounts(accounts: string[]): Promise<void>
  setCafe(cafeId: string, cafeUrlName: string): Promise<void>
  getPairingToken(): Promise<string>
  startAutomation(): Promise<void>
  stopAutomation(): Promise<void>
  killSwitch(): Promise<void>
  runOnce(): Promise<void>
}
