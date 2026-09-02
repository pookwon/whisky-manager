import type { CollectionJob, CollectionStatus } from './collection-db/statusQuery.js'
import type { MemberCollectionStatus } from './collection-db/memberStatusQuery.js'
import type { CollectionUnavailableCode } from './collectionContext.js'
import type { CollectionStartRefusal } from './collectionRunner.js'
import type {
  CollectionRangeProblem,
  CollectionSchedule,
} from '../shared/collectionSchedule.js'
import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import type { BundleProblem } from '../shared/configBundle.js'
import type { ImportSummary } from './configTransfer.js'
import type { ApprovalPolicy, RiskFlag, Template } from '../shared/types.js'
import type { ExtensionRecoveryResult, ExtensionSetupResult } from './extensionSetup.js'
import type { StartupPreview } from './preview.js'
import type { WarmCheck } from './sessionWarmer.js'

/** Socket is connected, reconnection is in progress, or truly offline. */
export type BridgeStatus = 'CONNECTED' | 'RECONNECTING' | 'OFFLINE'

export const IPC_CHANNELS = {
  getDashboard: 'wm:getDashboard',
  getCollectionStatus: 'wm:getCollectionStatus',
  getCollectionSchedule: 'wm:getCollectionSchedule',
  setCollectionSchedule: 'wm:setCollectionSchedule',
  startCollection: 'wm:startCollection',
  stopCollection: 'wm:stopCollection',
  setCollectionForced: 'wm:setCollectionForced',
  getMemberCollectionStatus: 'wm:getMemberCollectionStatus',
  startMemberCollection: 'wm:startMemberCollection',
  stopMemberCollection: 'wm:stopMemberCollection',
  setMemberCollectionForced: 'wm:setMemberCollectionForced',
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
  recoverExtensionSetup: 'wm:recoverExtensionSetup',
  copyToClipboard: 'wm:copyToClipboard',
  startAutomation: 'wm:startAutomation',
  stopAutomation: 'wm:stopAutomation',
  killSwitch: 'wm:killSwitch',
  runOnce: 'wm:runOnce',
  previewDay: 'wm:previewDay',
  exportConfig: 'wm:exportConfig',
  importConfig: 'wm:importConfig',
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
   * The operating window itself, in KST hours — start inclusive, end exclusive.
   *
   * `withinActiveHours` answers "now", which is enough for a button but not for
   * a screen that draws the day: a band has to start and end somewhere. Sent
   * rather than restated in the renderer for the same reason as the boolean —
   * the hours live in the profile, and a second copy is a second thing to
   * disagree with it.
   */
  readonly activeHourStart: number
  readonly activeHourEnd: number
  /**
   * Midway between the shortest and longest gap the tool leaves between
   * comments. The screen estimates how long a run will take from it rather
   * than carrying its own copy of numbers the profile owns.
   */
  readonly averageActionGapMs: number
}

/**
 * Member collection storage is optional and follows the same three-state shape
 * as the article collection: disabled, unavailable, or ready with status.
 */
export type MemberCollectionStatusView =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly code: CollectionUnavailableCode }
  | { readonly kind: 'ready'; readonly status: MemberCollectionStatus }

/**
 * Collection storage is optional, so its screen has three answers rather than
 * one: no database configured, one configured but not usable, or the numbers.
 * The screen must be able to say which — an empty screen and an unreachable
 * database look identical otherwise.
 */
export type CollectionStatusView =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly code: CollectionUnavailableCode }
  | { readonly kind: 'ready'; readonly status: CollectionStatus }

/**
 * The schedule as the screen edits it, with the two things only the app knows:
 * when the next read is due, and whether one is under way right now.
 */
export interface CollectionScheduleView {
  readonly schedule: CollectionSchedule
  readonly nextRunAtMs: number | null
  readonly running: boolean
}

/** A window the operator picked, in whole KST days. */
export interface CollectionRunRequest {
  readonly firstDayMs: number
  readonly lastDayMs: number
  /**
   * Carries the operator's answer to being shown what the job in progress
   * would lose. Without it a different period is reported back rather than
   * started, so a running job is never discarded by a stray press.
   */
  readonly replace?: boolean
}

/**
 * What a press to collect ended as. A refusal is an ordinary answer with a
 * reason the screen can name, not an exception.
 */
export type StartCollectionResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'refused'; readonly reason: CollectionStartRefusal }
  | { readonly kind: 'rejected'; readonly problem: CollectionRangeProblem }
  /** A different period was asked for while this job is unfinished. */
  | { readonly kind: 'needs_replace'; readonly job: CollectionJob }

/**
 * Whether the job now runs around the clock. A refusal is an ordinary answer:
 * there has to be a job to hold the force, and a finished one has nothing left
 * to stay up for.
 */
export type SetCollectionForcedResult =
  | { readonly kind: 'set'; readonly forced: boolean }
  | {
      readonly kind: 'refused'
      readonly reason: Extract<CollectionStartRefusal, 'NO_STORAGE' | 'NO_JOB' | 'JOB_FINISHED'>
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

/**
 * How an export ended. `CANCELLED` is the operator closing the save dialog,
 * which is an ordinary answer rather than a failure — the screen must not
 * report an error for it.
 */
export type ExportConfigResult =
  | { readonly kind: 'SAVED'; readonly path: string }
  | { readonly kind: 'CANCELLED' }

/**
 * How an import ended. A rejected file is not an exception: the operator picked
 * the wrong one, and the reason is something the screen can name for them.
 */
export type ImportConfigResult =
  | ({ readonly kind: 'IMPORTED' } & ImportSummary)
  | { readonly kind: 'CANCELLED' }
  | { readonly kind: 'REJECTED'; readonly problem: BundleProblem }

export interface RendererApi {
  getDashboard(): Promise<DashboardSnapshot>
  /** Reads the collection database; answers `disabled` when there is none. */
  getCollectionStatus(): Promise<CollectionStatusView>
  /** Reads the member collection status; answers `disabled` when there is no database. */
  getMemberCollectionStatus(): Promise<MemberCollectionStatusView>
  /** Starts a member collection walk. Mode is picked by whether a walk already exists. */
  startMemberCollection(): Promise<StartCollectionResult>
  /** Asks a member walk in flight to end at its next page boundary. */
  stopMemberCollection(): Promise<void>
  /**
   * Lets the member walk keep going outside the operating hours, or puts it
   * back inside them. Releases itself when the walk completes.
   */
  setMemberCollectionForced(forced: boolean): Promise<SetCollectionForcedResult>
  getCollectionSchedule(): Promise<CollectionScheduleView>
  /** Saves the schedule and re-lays the next beat; returns what was stored. */
  setCollectionSchedule(schedule: CollectionSchedule): Promise<CollectionScheduleView>
  /**
   * Starts one collection now. Omit the request for the configured window
   * ending now; pass two days to collect exactly that period. Resolves once it
   * has started, not once it has finished — a walk takes many minutes, and
   * progress is read from the collection screen.
   */
  startCollection(request?: CollectionRunRequest): Promise<StartCollectionResult>
  /** Asks a walk in flight to end at its next page boundary. */
  stopCollection(): Promise<void>
  /**
   * Lets the job in hand keep to its rhythm outside the operating hours, or
   * puts it back inside them. It releases itself: the period finishing clears
   * the force with it, so nobody has to remember to switch it off.
   */
  setCollectionForced(forced: boolean): Promise<SetCollectionForcedResult>
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
   * Stages the extension, forgets the missing extension's trusted id, then
   * opens the same setup aids so the replacement can bind immediately.
   */
  recoverExtensionSetup(): Promise<ExtensionRecoveryResult>
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
  /**
   * Writes the current configuration to a file the operator picks. Carries the
   * cafe, the operator accounts, each automation's policy and board, and every
   * template — and none of the pairing token, the bound extension, the run
   * history or the pacing limits.
   */
  exportConfig(): Promise<ExportConfigResult>
  /**
   * Replaces the current configuration with a file's. Destructive by design:
   * the templates and settings that were here are gone afterwards, so the
   * renderer asks before calling this. The automation always lands switched off.
   */
  importConfig(): Promise<ImportConfigResult>
}
