import { AUTOMATIONS, WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'
import type { Clock } from '../shared/ports.js'
import type { ApprovalPolicy, Limits } from '../shared/types.js'
import { kstDayRange } from '../shared/kst.js'
import { isWithinActiveHours } from '../shared/schedule.js'
import { approve as approveExecution, reject as rejectExecution } from './approvals.js'
import type { AppRepos, AutomationControl } from './bootstrap.js'
import { getCafeImage as fetchCafeImage } from './cafeImage.js'
import type { SettingsRepo } from './db/settingsRepo.js'
import type { SessionOutcome } from './orchestrator.js'
import {
  DEFAULT_BOARD_ID,
  DEFAULT_CAFE_ID,
  DEFAULT_CAFE_URL_NAME,
  SETTING_KEYS,
  parseOperatorAccounts,
} from './session.js'
import type { ExtensionTransport } from './ws/server.js'
import type {
  AutomationSettingsView,
  AutomationStatus,
  BridgeStatus,
  CommonSettingsView,
  DashboardSnapshot,
  RendererApi,
} from './ipc.js'

const PAIRING_TOKEN_KEY = 'pairingToken'

export interface RendererApiDeps {
  readonly repos: AppRepos
  readonly settings: SettingsRepo
  readonly bridge: ExtensionTransport
  readonly automation: AutomationControl
  /** The most recent session result for one automation, or null if it never ran. */
  readonly lastOutcome: (automationId: string) => SessionOutcome | null
  /** Epoch timestamp when the last outcome arrived, or null if no session has run. */
  readonly lastOutcomeAt: () => number | null
  /** Greeting target count available at startup, or null if not yet counted. */
  readonly getStartupPreview: () => import('./preview.js').StartupPreview | null
  /** Epoch timestamp when the bridge last connected, or null if never. */
  readonly lastBridgeConnectedAt: () => number | null
  /** When the next session is scheduled to run, or null if the loop is not running. */
  readonly nextSessionAt: () => number | null
  /** What the session in flight is doing, or null when none is running. */
  readonly sessionProgress: () => import('./orchestrator.js').SessionProgress | null
  /** Counts what a run on that day would answer. Reaches the cafe. */
  readonly previewDay: (dayStartMs: number) => Promise<import('./preview.js').StartupPreview>
  readonly clock: Clock
  readonly limits: Limits
  readonly newId: () => string
}

/**
 * Everything the renderer can do, with no Electron dependency. `main.ts` only
 * forwards IPC channels here, which keeps this whole surface unit-testable.
 */
export function createRendererApi(deps: RendererApiDeps): RendererApi {
  const { repos, settings } = deps

  const setting = (automationId: string) => repos.automationSettings.get(automationId)

  /**
   * Calculates bridge status based on connection state and time since last connection.
   * CONNECTED: socket is currently connected.
   * RECONNECTING: socket is disconnected but was connected recently (within 90 seconds).
   * OFFLINE: socket is disconnected and was never connected, or was last connected
   * more than 90 seconds ago.
   *
   * The 90-second grace period is longer than the extension's 60-second reconnection
   * cycle, so normal service worker teardown and wake-up cycles are reported as
   * RECONNECTING rather than OFFLINE.
   */
  function calculateBridgeStatus(): BridgeStatus {
    if (deps.bridge.isConnected()) {
      return 'CONNECTED'
    }

    const lastConnected = deps.lastBridgeConnectedAt()
    if (lastConnected === null) {
      // Never connected
      return 'OFFLINE'
    }

    const now = deps.clock.now()
    const disconnectedFor = now - lastConnected
    const GRACE_PERIOD_MS = 90 * 1000

    if (disconnectedFor < GRACE_PERIOD_MS) {
      return 'RECONNECTING'
    }

    return 'OFFLINE'
  }

  const upsert = (
    automationId: string,
    patch: Partial<{ policy: ApprovalPolicy; enabled: boolean; boardId: string }>,
  ): void => {
    const current = setting(automationId)
    repos.automationSettings.upsert({
      automationId,
      policy: patch.policy ?? current?.policy ?? 'AUTO',
      limits: current?.limits ?? {},
      enabled: patch.enabled ?? current?.enabled ?? false,
      boardId: patch.boardId ?? current?.boardId ?? null,
    })
  }

  return {
    getDashboard(): Promise<DashboardSnapshot> {
      const now = deps.clock.now()
      // Today means the day the greetings were posted on, so a run filling in
      // an earlier day does not swell these numbers.
      const { startMs: dayStart, endMs: dayEnd } = kstDayRange(now)

      const automations: AutomationStatus[] = AUTOMATIONS.map((automation) => ({
        id: automation.id,
        enabled: setting(automation.id)?.enabled ?? false,
        awaitingApproval: repos.executions.countByStatus(automation.id, 'AWAITING_APPROVAL'),
        executedToday: repos.executions.countExecutedForDay(automation.id, dayStart, dayEnd),
        lastOutcome: deps.lastOutcome(automation.id),
      }))

      const sum = (pick: (automation: AutomationStatus) => number): number =>
        automations.reduce((total, automation) => total + pick(automation), 0)

      const sumByStatus = (status: 'SUCCESS' | 'FAILED'): number =>
        AUTOMATIONS.reduce(
          (total, automation) =>
            total + repos.executions.countByStatusForDay(automation.id, status, dayStart, dayEnd),
          0,
        )

      return Promise.resolve({
        bridgeConnected: deps.bridge.isConnected(),
        loopRunning: deps.automation.isRunning(),
        awaitingApproval: sum((automation) => automation.awaitingApproval),
        executedToday: sum((automation) => automation.executedToday),
        succeededToday: sumByStatus('SUCCESS'),
        failedToday: sumByStatus('FAILED'),
        // Named rather than positional: the banner answers "why is it quiet?",
        // and reordering the catalogue must not silently turn that into null.
        lastOutcome:
          automations.find((automation) => automation.id === WELCOME_AUTOMATION_ID)?.lastOutcome ??
          null,
        automations,
        startupPreview: deps.getStartupPreview(),
        lastOutcomeAt: deps.lastOutcomeAt(),
        nextSessionAt: deps.nextSessionAt(),
        sessionProgress: deps.sessionProgress(),
        bridgeStatus: calculateBridgeStatus(),
        withinActiveHours: isWithinActiveHours(now, deps.limits, deps.clock),
        averageActionGapMs: Math.round(
          (deps.limits.actionIntervalMinMs + deps.limits.actionIntervalMaxMs) / 2,
        ),
      })
    },

    listAwaiting(automationId) {
      return Promise.resolve(
        repos.executions.listAwaitingDetail(automationId).map((r) => ({
          id: r.id,
          postId: r.targetPostId,
          author: r.targetAuthor,
          title: r.targetTitle,
          renderedText: r.renderedText,
          riskFlags: r.riskFlags,
          detectedAt: r.detectedAt,
        })),
      )
    },

    approve(id) {
      approveExecution(repos.executions, id, deps.limits)
      return Promise.resolve()
    },

    reject(id) {
      rejectExecution(repos.executions, id, deps.clock.now())
      return Promise.resolve()
    },

    listTemplates(automationId) {
      return Promise.resolve(repos.templates.listEnabled(automationId))
    },

    addTemplate(automationId, body) {
      const trimmed = body.trim()
      if (trimmed === '') {
        // An empty template would post an empty comment.
        return Promise.reject(new Error('template body must not be blank'))
      }
      repos.templates.add({
        id: deps.newId(),
        automationId,
        body: trimmed,
        createdAt: deps.clock.now(),
      })
      return Promise.resolve()
    },

    removeTemplate(id) {
      repos.templates.remove(id)
      return Promise.resolve()
    },

    getCommonSettings(): Promise<CommonSettingsView> {
      return Promise.resolve({
        cafeId: settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID,
        cafeUrlName: settings.get(SETTING_KEYS.cafeUrlName) ?? DEFAULT_CAFE_URL_NAME,
        operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
      })
    },

    getAutomationSettings(automationId): Promise<AutomationSettingsView> {
      const current = setting(automationId)
      return Promise.resolve({
        policy: current?.policy ?? 'AUTO',
        enabled: current?.enabled ?? false,
        boardId: current?.boardId ?? DEFAULT_BOARD_ID,
      })
    },

    getCafeImage() {
      return fetchCafeImage(
        { transport: deps.bridge, settings, clock: deps.clock, newId: deps.newId },
        settings.get(SETTING_KEYS.cafeUrlName) ?? DEFAULT_CAFE_URL_NAME,
      )
    },

    setPolicy(automationId, policy) {
      upsert(automationId, { policy })
      return Promise.resolve()
    },

    setEnabled(automationId, enabled) {
      upsert(automationId, { enabled })
      return Promise.resolve()
    },

    setBoardId(automationId, boardId) {
      upsert(automationId, { boardId: boardId.trim() })
      return Promise.resolve()
    },

    setOperatorAccounts(accounts) {
      const cleaned = accounts.map((a) => a.trim()).filter((a) => a !== '')
      settings.set(SETTING_KEYS.operatorAccounts, JSON.stringify(cleaned))
      return Promise.resolve()
    },

    setCafe(cafeId, cafeUrlName) {
      settings.set(SETTING_KEYS.cafeId, cafeId.trim())
      settings.set(SETTING_KEYS.cafeUrlName, cafeUrlName.trim())
      return Promise.resolve()
    },

    getPairingToken() {
      return Promise.resolve(settings.get(PAIRING_TOKEN_KEY) ?? '')
    },

    startAutomation() {
      deps.automation.start()
      return Promise.resolve()
    },

    stopAutomation() {
      deps.automation.stop()
      return Promise.resolve()
    },

    killSwitch() {
      deps.automation.kill()
      return Promise.resolve()
    },

    previewDay(dayStartMs) {
      return deps.previewDay(dayStartMs)
    },

    runOnce(request = {}) {
      // Resolves once the session has started rather than when it ends. A full
      // day's greetings take the better part of an hour, and a renderer waiting
      // that out would hold its controls — the stop switches included — shut
      // for the whole run. Failures inside the session are the loop's to report.
      const mode = request.force === true ? 'FORCED' : 'MANUAL'
      void deps.automation
        .runOnce({ mode, ...(request.dayStartMs === undefined ? {} : { dayStartMs: request.dayStartMs }) })
        .catch((error: unknown) => {
          console.error('[session] run-once failed to start:', error)
        })
      return Promise.resolve()
    },
  }
}
