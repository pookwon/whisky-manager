import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import type { ApprovalPolicy, RiskFlag, Template } from '../shared/types.js'
import type { ExtensionSetupResult } from './extensionSetup.js'
import type { StartupPreview } from './preview.js'
import type { WarmCheck } from './sessionWarmer.js'

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
  openExtensionSetup: 'wm:openExtensionSetup',
  copyToClipboard: 'wm:copyToClipboard',
  startAutomation: 'wm:startAutomation',
  stopAutomation: 'wm:stopAutomation',
  killSwitch: 'wm:killSwitch',
  runOnce: 'wm:runOnce',
  previewDay: 'wm:previewDay',
} as const

export interface DashboardSnapshot {
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
   * Current narrowing preview for a day the operator is reviewing before running it.
   * Null when no day is under preview; updates 5 times a second via polling.
   */
  readonly dayPreview: StartupPreview | null
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
   * The last time the tool touched naver purely to keep the browser's login in
   * use, and what it found. Null before the first one lands. Without this the
   * warming has no surface at all: it succeeds silently, and an operator
   * looking for it finds nothing.
   */
  readonly lastWarm: WarmCheck | null
  /**
   * Socket is connected, waiting for reconnection, or truly offline.
   * Distinguishes normal brief disconnections from real failures.
   */
  readonly bridgeStatus: BridgeStatus
  /**
   * Whether an extension has ever completed the handshake on this machine.
   * Unlike `bridgeStatus` this never goes back to false, which is what makes it
   * the right question for "has this install been set up yet?" — a closed
   * browser must not put the first-run guide back in front of the operator.
   */
  readonly extensionEverPaired: boolean
  /**
   * Whether the operating window is open right now. The app decides it so the
   * renderer never works out the hours a second time and disagrees.
   */
  readonly withinActiveHours: boolean
  /**
   * Midway between the shortest and longest gap the tool leaves between
   * comments. The screen estimates how long a run will take from it rather
   * than carrying its own copy of numbers the profile owns.
   */
  readonly averageActionGapMs: number
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
  /** Vanity url segment — the part after `cafe.naver.com/`; how a person reaches it. */
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
  /**
   * Opens everything the operator needs to install the extension: the folder
   * holding it, the extensions address on the clipboard, and Chrome. Rejects
   * when the extension is missing from this build; a missing Chrome is
   * reported in the result rather than thrown, because the rest still helps.
   */
  openExtensionSetup(): Promise<ExtensionSetupResult>
  /**
   * Puts text on the system clipboard. The renderer is served from `file://`,
   * where the browser clipboard API is not something to rely on, and the token
   * has to reach Chrome's options page by some route the operator trusts.
   */
  copyToClipboard(text: string): Promise<void>
  startAutomation(): Promise<void>
  stopAutomation(): Promise<void>
  killSwitch(): Promise<void>
  /**
   * Starts a session now. Resolves once it has started, not once it has
   * finished — a day's greetings take the better part of an hour, and a
   * renderer waiting that out would hold its own controls shut.
   *
   * `force` carries the operator's answer to being told what it overrides.
   * `dayStartMs` picks the day to work; omitted means today.
   */
  runOnce(request?: { force?: boolean; dayStartMs?: number }): Promise<void>
  /**
   * How many greetings a run would answer, without answering any. Reaches the
   * cafe, so it belongs behind a deliberate press rather than the poll loop.
   */
  previewDay(dayStartMs: number): Promise<StartupPreview>
}
