import { AUTOMATIONS, WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'
import { parseConfigBundle, serializeConfigBundle } from '../shared/configBundle.js'
import type { Clock } from '../shared/ports.js'
import type { ApprovalPolicy, Limits } from '../shared/types.js'
import { kstDayRange } from '../shared/kst.js'
import { isWithinActiveHours } from '../shared/schedule.js'
import { approve as approveExecution, reject as rejectExecution } from './approvals.js'
import type { AppRepos, AutomationControl } from './bootstrap.js'
import { getCafeImage as fetchCafeImage } from './cafeImage.js'
import type { CollectionFeed } from './collection-db/repository.js'
import type { OptionalCollectionContext } from './collectionContext.js'
import type { CollectionLoop } from './collectionLoop.js'
import type { CollectionRunner } from './collectionRunner.js'
import { readCollectionSchedule, writeCollectionSchedule } from './collectionSettings.js'
import { CAFE_ARTICLE_LIST } from '../shared/cafeArticleFixture.js'
import {
  checkCollectionRange,
  collectionRangeOfDays,
  pagesPerWorkBlock,
  type CollectionRange,
} from '../shared/collectionSchedule.js'
import { applyBundle, buildBundle, type ConfigTransferDeps } from './configTransfer.js'
import type { SettingsRepo } from './db/settingsRepo.js'
import type { SessionOutcome } from './orchestrator.js'
import {
  SETTING_KEYS,
  parseOperatorAccounts,
} from './session.js'
import type { ExtensionTransport } from './ws/server.js'
import type { MemberCollectionRunner } from './memberCollectionRunner.js'
import type {
  AutomationSettingsView,
  AutomationStatus,
  MemberCollectionStatusView,
  SetCollectionForcedResult,
  BridgeStatus,
  CollectionRunRequest,
  CollectionScheduleView,
  CollectionStatusView,
  StartCollectionResult,
  CommonSettingsView,
  DashboardSnapshot,
  ExportConfigResult,
  ImportConfigResult,
  RendererApi,
} from './ipc.js'

/**
 * The one feed Phase 1 collects: the whole-cafe article list. Taken from the
 * endpoint contract rather than restated, so a screen can never read a feed the
 * extension is not allowed to fetch.
 */
const ALL_ARTICLES_FEED: CollectionFeed = {
  feedKind: 'all_articles',
  menuId: CAFE_ARTICLE_LIST.menuId,
}

const PAIRING_TOKEN_KEY = 'pairingToken'
/**
 * Written once, by the bridge, on an extension's first accepted handshake.
 * Its presence is the record that this install has been paired at all.
 */
const BOUND_EXTENSION_ID_KEY = 'boundExtensionId'

/**
 * What an exported settings file is called before the operator renames it.
 * Names the app rather than the cafe: the file is handed around, and a cafe
 * id in the filename is one more place it has to be kept right.
 */
const EXPORT_FILENAME = 'whisky-manager-settings.json'

/**
 * Picking and touching files, which belongs to the shell. Injected for the
 * same reason the extension setup is: this module stays free of Electron and
 * of `node:fs`, and every branch below is reachable from a test.
 */
export interface ConfigFilePorts {
  /** Absolute path to write to, or null when the operator closed the dialog. */
  chooseSavePath(defaultName: string): Promise<string | null>
  /** Absolute path to read, or null when the operator closed the dialog. */
  chooseOpenPath(): Promise<string | null>
  writeText(path: string, text: string): void
  readText(path: string): string
}

export interface RendererApiDeps {
  readonly repos: AppRepos
  readonly settings: SettingsRepo
  readonly bridge: ExtensionTransport
  readonly automation: AutomationControl
  /**
   * Collection storage as bootstrap found it. Read through a getter so a
   * context that comes back after a retry is picked up without rebuilding this
   * api.
   */
  readonly collection: () => OptionalCollectionContext
  /** Starts and stops one collection walk. */
  readonly collectionRunner: CollectionRunner
  /** Starts and stops the member collection walk. */
  readonly memberCollectionRunner: MemberCollectionRunner
  /** Re-laid whenever the schedule is saved. */
  readonly collectionLoop: CollectionLoop
  /** The most recent session result for one automation, or null if it never ran. */
  readonly lastOutcome: (automationId: string) => SessionOutcome | null
  /** Epoch timestamp when the last outcome arrived, or null if no session has run. */
  readonly lastOutcomeAt: () => number | null
  /** Greeting target count available at startup, or null if not yet counted. */
  readonly getStartupPreview: () => import('./preview.js').StartupPreview | null
  /** Current narrowing preview for a day under preview, or null if none. */
  readonly getDayPreview: () => import('./preview.js').StartupPreview | null
  /** Epoch timestamp when the bridge was last seen up, or null if it never was. */
  readonly lastBridgeConnectedAt: () => number | null
  /** When the next session is scheduled to run, or null if the loop is not running. */
  readonly nextSessionAt: () => number | null
  /** What the session in flight is doing, or null when none is running. */
  readonly sessionProgress: () => import('./orchestrator.js').SessionProgress | null
  /** The last read taken to keep the browser's naver login in use, or null. */
  readonly lastWarm: () => import('./sessionWarmer.js').WarmCheck | null
  /** Counts what a run on that day would answer. Reaches the cafe. */
  readonly previewDay: (dayStartMs: number) => Promise<import('./preview.js').StartupPreview>
  /**
   * Opens the extension folder, the clipboard and Chrome for the first-run
   * guide. Injected because every part of it belongs to the shell, which this
   * module is deliberately free of.
   */
  readonly openExtensionSetup: () => import('./extensionSetup.js').ExtensionSetupResult
  /** Opens the recovery aids after atomically making room for a replacement id. */
  readonly recoverExtensionSetup: () => import('./extensionSetup.js').ExtensionRecoveryResult
  /** Writes to the system clipboard, which is the shell's to own. */
  readonly copyToClipboard: (text: string) => void
  /** Choosing and touching settings files, which is also the shell's. */
  readonly configFile: ConfigFilePorts
  /** Runs a set of writes as one unit, so an import cannot half-apply. */
  readonly transaction: (run: () => void) => void
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
  const startedAt = deps.clock.now()

  const setting = (automationId: string) => repos.automationSettings.get(automationId)

  const scheduleView = (): CollectionScheduleView => ({
    schedule: readCollectionSchedule(settings),
    nextRunAtMs: deps.collectionLoop.nextRunAt(),
    running: deps.collectionRunner.isRunning(),
  })

  const transfer: ConfigTransferDeps = {
    settings,
    templates: repos.templates,
    automationSettings: repos.automationSettings,
    transaction: deps.transaction,
    now: () => deps.clock.now(),
    newId: deps.newId,
  }

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
      // A previously paired extension gets one reconnect cycle after app
      // startup before a destructive recovery action is offered.
      if (
        settings.get(BOUND_EXTENSION_ID_KEY) !== undefined &&
        deps.clock.now() - startedAt < 90 * 1000
      ) {
        return 'RECONNECTING'
      }
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
    getCollectionSchedule(): Promise<CollectionScheduleView> {
      return Promise.resolve(scheduleView())
    },

    setCollectionSchedule(schedule): Promise<CollectionScheduleView> {
      writeCollectionSchedule(settings, schedule)
      // Re-laid straight away: a schedule the operator just saved that does not
      // take effect until the next restart is a schedule they cannot trust.
      deps.collectionLoop.refresh()
      return Promise.resolve(scheduleView())
    },

    async startCollection(request?: CollectionRunRequest): Promise<StartCollectionResult> {
      const collection = deps.collection()
      const stored = collection.kind === 'ready' ? await collection.status.read(ALL_ARTICLES_FEED) : null
      const inProgress = stored?.job ?? null

      const startFor = (range: CollectionRange, resumeFromCheckpoint: boolean): StartCollectionResult => {
        const schedule = readCollectionSchedule(settings)
        const started = deps.collectionRunner.start({
          range,
          kind: 'backfill',
          maxPages: pagesPerWorkBlock(schedule.workBlockMinutes),
          feeds: [ALL_ARTICLES_FEED],
          resumeFromCheckpoint,
        })
        return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
      }

      // No period named means "carry on", which is the same thing a scheduled
      // block does: the stored job says which period, and its cursor says where.
      // This is deliberately not a default window — the feature moves a piece of
      // the past, so there is no window to assume when nothing has been asked for.
      if (request === undefined) {
        if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
        if (inProgress === null) return { kind: 'refused', reason: 'NO_JOB' }
        if (inProgress.complete) return { kind: 'refused', reason: 'JOB_FINISHED' }
        return startFor({ startMs: inProgress.targetStartMs, endMs: inProgress.targetEndMs }, true)
      }

      const range = collectionRangeOfDays(request.firstDayMs, request.lastDayMs)
      const problem = checkCollectionRange(range, deps.clock.now())
      if (problem !== null) return { kind: 'rejected', problem }

      const samePeriod =
        inProgress !== null &&
        inProgress.targetStartMs === range.startMs &&
        inProgress.targetEndMs === range.endMs

      // An unfinished job is not discarded on a press. The screen is handed
      // what would be lost and asks; only the answer starts the replacement.
      if (inProgress !== null && !samePeriod && !inProgress.complete && request.replace !== true) {
        return { kind: 'needs_replace', job: inProgress }
      }
      // Replacing what a run is still writing would race its cursor, and a walk
      // ends at its own page boundary rather than mid-page.
      if (inProgress !== null && !samePeriod && deps.collectionRunner.isRunning()) {
        return { kind: 'refused', reason: 'STOP_RUNNING_FIRST' }
      }

      // The same unfinished period carries on from its cursor. A new one — or
      // the same one asked for again after it finished, which is a request to
      // read it over — starts afresh, resetting the cursor without touching
      // the posts already collected.
      return startFor(range, samePeriod && !inProgress.complete)
    },

    async setCollectionForced(forced: boolean): Promise<SetCollectionForcedResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }

      const stored = await collection.status.read(ALL_ARTICLES_FEED)
      // The force rides on the job, so there has to be one — and a period
      // already walked to its end has nothing left to stay up for.
      if (stored.job === null) return { kind: 'refused', reason: 'NO_JOB' }
      if (stored.job.complete) return { kind: 'refused', reason: 'JOB_FINISHED' }

      await collection.repository.setForced(
        forced ? new Date(deps.clock.now()) : null,
      )
      // The beat already laid was placed under the old rule; re-laying is what
      // turns "tomorrow at nine" into "after this rest" while the night is
      // still young.
      deps.collectionLoop.refresh()
      return { kind: 'set', forced }
    },

    stopCollection(): Promise<void> {
      deps.collectionRunner.stop()
      return Promise.resolve()
    },

    async getCollectionStatus(): Promise<CollectionStatusView> {
      const collection = deps.collection()
      if (collection.kind === 'disabled') return { kind: 'disabled' }
      if (collection.kind === 'unavailable') return { kind: 'unavailable', code: collection.code }
      return { kind: 'ready', status: await collection.status.read(ALL_ARTICLES_FEED) }
    },

    async getMemberCollectionStatus(): Promise<MemberCollectionStatusView> {
      const collection = deps.collection()
      if (collection.kind === 'disabled') return { kind: 'disabled' }
      if (collection.kind === 'unavailable') return { kind: 'unavailable', code: collection.code }
      return { kind: 'ready', status: await collection.memberStatus.read() }
    },

    async startMemberCollection(): Promise<StartCollectionResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const state = await collection.memberRepository.readMemberFeedState()
      if (state?.complete === true) return { kind: 'refused', reason: 'JOB_FINISHED' }
      const schedule = readCollectionSchedule(settings)
      const maxPages = pagesPerWorkBlock(schedule.workBlockMinutes)
      // First start walks from page 1; an existing unfinished row resumes.
      const started = deps.memberCollectionRunner.start({
        mode: state === null ? 'backfill' : 'incremental',
        maxPages,
        resumeFromCheckpoint: state !== null,
      })
      return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
    },

    stopMemberCollection(): Promise<void> {
      deps.memberCollectionRunner.stop()
      return Promise.resolve()
    },

    async setMemberCollectionForced(forced: boolean): Promise<SetCollectionForcedResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const state = await collection.memberRepository.readMemberFeedState()
      if (state === null) return { kind: 'refused', reason: 'NO_JOB' }
      if (state.complete) return { kind: 'refused', reason: 'JOB_FINISHED' }
      await collection.memberRepository.setForced(forced ? new Date(deps.clock.now()) : null)
      deps.collectionLoop.refresh()
      return { kind: 'set', forced }
    },

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
        dayPreview: deps.getDayPreview(),
        lastOutcomeAt: deps.lastOutcomeAt(),
        nextSessionAt: deps.nextSessionAt(),
        sessionProgress: deps.sessionProgress(),
        lastWarm: deps.lastWarm(),
        bridgeStatus: calculateBridgeStatus(),
        extensionEverPaired: settings.get(BOUND_EXTENSION_ID_KEY) !== undefined,
        withinActiveHours: isWithinActiveHours(now, deps.limits, deps.clock),
        activeHourStart: deps.limits.activeHourStart,
        activeHourEnd: deps.limits.activeHourEnd,
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
        // Blank means unset, which is what the settings screen must show: an
        // empty box the operator fills, not someone else's cafe already in it.
        cafeId: settings.get(SETTING_KEYS.cafeId) ?? '',
        cafeUrlName: settings.get(SETTING_KEYS.cafeUrlName) ?? '',
        operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
      })
    },

    getAutomationSettings(automationId): Promise<AutomationSettingsView> {
      const current = setting(automationId)
      return Promise.resolve({
        policy: current?.policy ?? 'AUTO',
        enabled: current?.enabled ?? false,
        boardId: current?.boardId ?? '',
      })
    },

    getCafeImage() {
      return fetchCafeImage(
        { transport: deps.bridge, settings, clock: deps.clock, newId: deps.newId },
        settings.get(SETTING_KEYS.cafeUrlName) ?? '',
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

    openExtensionSetup() {
      // Synchronous work behind an async surface: copying a handful of small
      // files and starting a process is over before the next frame, and an
      // await here would only make the caller look like it could be cancelled.
      return Promise.resolve(deps.openExtensionSetup())
    },

    recoverExtensionSetup() {
      return Promise.resolve(deps.recoverExtensionSetup())
    },

    copyToClipboard(text) {
      deps.copyToClipboard(text)
      return Promise.resolve()
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

    async exportConfig(): Promise<ExportConfigResult> {
      const path = await deps.configFile.chooseSavePath(EXPORT_FILENAME)
      // Closing the dialog is an answer, not a failure. Reporting it as one
      // would put an error on screen for someone who changed their mind.
      if (path === null) return { kind: 'CANCELLED' }
      deps.configFile.writeText(path, serializeConfigBundle(buildBundle(transfer)))
      return { kind: 'SAVED', path }
    },

    async importConfig(): Promise<ImportConfigResult> {
      const path = await deps.configFile.chooseOpenPath()
      if (path === null) return { kind: 'CANCELLED' }
      // A read that fails — a file removed between picking and opening, a
      // permission the operator does not have — throws, and the renderer's
      // error banner is the right place for it. A file that reads but is not
      // ours is not an error at all: it has a reason worth naming.
      const parsed = parseConfigBundle(deps.configFile.readText(path))
      if (!parsed.ok) return { kind: 'REJECTED', problem: parsed.problem }
      return { kind: 'IMPORTED', ...applyBundle(transfer, parsed.bundle) }
    },
  }
}
