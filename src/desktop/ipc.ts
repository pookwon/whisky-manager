import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import type { ApprovalPolicy, RiskFlag, Template } from '../shared/types.js'
import type { StartupPreview } from './preview.js'

/** Socket is connected, reconnection is in progress, or truly offline. */
export type BridgeStatus = 'CONNECTED' | 'RECONNECTING' | 'OFFLINE'

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
  /**
   * Count of greeting targets available at startup, once the bridge connects.
   * Null means not yet counted; a READY state with count is advisory before the
   * operator triggers the automation; UNAVAILABLE explains why the count could
   * not be taken. Never re-counts during the app session to avoid repeated hits.
   */
  readonly startupPreview: StartupPreview | null
  /**
   * When the last session outcome arrived. Null if no session has ever run.
   * Allows the renderer to show this as a past event rather than present state.
   */
  readonly lastOutcomeAt: number | null
  /**
   * When the next session is scheduled to run. Null if the loop is not running.
   */
  readonly nextSessionAt: number | null
  /**
   * What the session in flight is doing, or null when none is running. This is
   * present state, unlike `lastOutcome`, and takes the banner over while it lasts.
   */
  readonly sessionProgress: SessionProgress | null
  /**
   * Socket is connected, waiting for reconnection, or truly offline.
   * Distinguishes normal brief disconnections from real failures.
   */
  readonly bridgeStatus: BridgeStatus
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
  /** Starts a session now. Resolves once it has started, not once it has finished. */
  runOnce(): Promise<void>
}
