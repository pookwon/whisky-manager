import type { Clock } from '../shared/ports.js'
import type { ApprovalPolicy, Limits } from '../shared/types.js'
import { dailyWindowStart } from '../shared/limits.js'
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
import type { DashboardSnapshot, RendererApi, SettingsView } from './ipc.js'

const PAIRING_TOKEN_KEY = 'pairingToken'

export interface RendererApiDeps {
  readonly automationId: string
  readonly repos: AppRepos
  readonly settings: SettingsRepo
  readonly bridge: ExtensionTransport
  readonly automation: AutomationControl
  readonly lastOutcome: () => SessionOutcome | null
  readonly clock: Clock
  readonly limits: Limits
  readonly newId: () => string
}

/**
 * Everything the renderer can do, with no Electron dependency. `main.ts` only
 * forwards IPC channels here, which keeps this whole surface unit-testable.
 */
export function createRendererApi(deps: RendererApiDeps): RendererApi {
  const { automationId, repos, settings } = deps

  const setting = () => repos.automationSettings.get(automationId)

  const upsert = (patch: Partial<{ policy: ApprovalPolicy; enabled: boolean }>): void => {
    const current = setting()
    repos.automationSettings.upsert({
      automationId,
      policy: patch.policy ?? current?.policy ?? 'AUTO',
      limits: current?.limits ?? {},
      enabled: patch.enabled ?? current?.enabled ?? false,
    })
  }

  return {
    getDashboard(): Promise<DashboardSnapshot> {
      const now = deps.clock.now()
      const since = dailyWindowStart(now, deps.limits, deps.clock)
      return Promise.resolve({
        bridgeConnected: deps.bridge.isConnected(),
        loopRunning: deps.automation.isRunning(),
        awaitingApproval: repos.executions.countByStatus(automationId, 'AWAITING_APPROVAL'),
        executedToday: repos.executions.countExecutedSince(automationId, since),
        succeededToday: repos.executions.countByStatusSince(automationId, 'SUCCESS', since),
        failedToday: repos.executions.countByStatusSince(automationId, 'FAILED', since),
        lastOutcome: deps.lastOutcome(),
      })
    },

    listAwaiting() {
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

    listTemplates() {
      return Promise.resolve(repos.templates.listEnabled(automationId))
    },

    addTemplate(body) {
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

    getSettings(): Promise<SettingsView> {
      const current = setting()
      return Promise.resolve({
        policy: current?.policy ?? 'AUTO',
        enabled: current?.enabled ?? false,
        cafeId: settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID,
        boardId: settings.get(SETTING_KEYS.boardId) ?? DEFAULT_BOARD_ID,
        cafeUrlName: settings.get(SETTING_KEYS.cafeUrlName) ?? DEFAULT_CAFE_URL_NAME,
        operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
      })
    },

    getCafeImage() {
      return fetchCafeImage(
        { transport: deps.bridge, settings, clock: deps.clock, newId: deps.newId },
        settings.get(SETTING_KEYS.cafeUrlName) ?? DEFAULT_CAFE_URL_NAME,
      )
    },

    setPolicy(policy) {
      upsert({ policy })
      return Promise.resolve()
    },

    setEnabled(enabled) {
      upsert({ enabled })
      return Promise.resolve()
    },

    setOperatorAccounts(accounts) {
      const cleaned = accounts.map((a) => a.trim()).filter((a) => a !== '')
      settings.set(SETTING_KEYS.operatorAccounts, JSON.stringify(cleaned))
      return Promise.resolve()
    },

    setCafe(cafeId, boardId, cafeUrlName) {
      settings.set(SETTING_KEYS.cafeId, cafeId.trim())
      settings.set(SETTING_KEYS.boardId, boardId.trim())
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

    runOnce() {
      return deps.automation.runOnce()
    },
  }
}
