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
  getPairingToken: 'wm:getPairingToken',
  killSwitch: 'wm:killSwitch',
} as const

export interface DashboardSnapshot {
  readonly bridgeConnected: boolean
  readonly loopRunning: boolean
  readonly awaitingApproval: number
  readonly executedToday: number
  readonly failedToday: number
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

export interface AutomationView {
  readonly policy: ApprovalPolicy
  readonly enabled: boolean
}

/** Implemented on both sides in plan C2: main handlers and renderer client. */
export interface RendererApi {
  getDashboard(): Promise<DashboardSnapshot>
  listAwaiting(): Promise<AwaitingItem[]>
  approve(id: string): Promise<void>
  reject(id: string): Promise<void>
  listTemplates(): Promise<Template[]>
  addTemplate(body: string): Promise<void>
  removeTemplate(id: string): Promise<void>
  getSettings(): Promise<AutomationView>
  setPolicy(policy: ApprovalPolicy): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  getPairingToken(): Promise<string>
  killSwitch(): Promise<void>
}
