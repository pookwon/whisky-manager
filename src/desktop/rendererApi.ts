import { AUTOMATIONS, WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'
import { parseConfigBundle, parseJsonRecord, serializeConfigBundle } from '../shared/configBundle.js'
import type { Clock } from '../shared/ports.js'
import type { ApprovalPolicy, Limits } from '../shared/types.js'
import { countByKstHour, kstDayRange } from '../shared/kst.js'
import type { DiagnosticEntry } from './diagnosticsLog.js'
import { mergeRecentLog, type LogEntry } from './recentLog.js'
import { isWithinActiveHours } from '../shared/schedule.js'
import { approve as approveExecution, reject as rejectExecution } from './approvals.js'
import type { AppRepos, AutomationControl } from './bootstrap.js'
import { getCafeImage as fetchCafeImage } from './cafeImage.js'
import type { CollectionFeed } from './collection-db/repository.js'
import type { OptionalCollectionContext } from './collectionContext.js'
import type { CollectionLoop } from './collectionLoop.js'
import type { CollectionRunner } from './collectionRunner.js'
import { readCollectionSchedule, writeCollectionSchedule } from './collectionSettings.js'
import { readCollectionPacing, writeCollectionPacing } from './collectionPacingSettings.js'
import { readMemberResyncInterval, writeMemberResyncInterval } from './memberResyncSettings.js'
import { readMemberResyncView } from './memberResyncView.js'
import { readBoardSearchView } from './boardSearchView.js'
import { planBoardSearchJob } from './boardSearchPlan.js'
import type { BoardSearchRunner } from './boardSearchRunner.js'
import type { MemberResyncIntervalDays } from '../shared/memberResync.js'
import { pagesPerWorkBlock } from '../shared/collectionPacing.js'
import { describeJob } from './collectionScope.js'
import {
  checkCollectionRange,
  collectionRangeOfDays,
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
  BoardSearchPlanView,
  BoardSearchStatusView,
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
  /** The same walk bound to the re-walk's own cursor. */
  readonly memberResyncRunner: MemberCollectionRunner
  /** Starts and stops a block of the board search backfill. */
  readonly boardSearchRunner: BoardSearchRunner
  /** Re-laid whenever the schedule is saved. */
  readonly collectionLoop: CollectionLoop
  /** The most recent session result for one automation, or null if it never ran. */
  readonly lastOutcome: (automationId: string) => SessionOutcome | null
  /** Epoch timestamp when that automation's last outcome arrived, or null if it never ran. */
  readonly lastOutcomeAt: (automationId: string) => number | null
  /** Greeting target count available at startup, or null if not yet counted. */
  readonly getStartupPreview: () => import('./preview.js').StartupPreview | null
  /** Current narrowing preview for a day under preview, or null if none. */
  readonly getDayPreview: () => import('./preview.js').StartupPreview | null
  /** Epoch timestamp when the bridge was last seen up, or null if it never was. */
  readonly lastBridgeConnectedAt: () => number | null
  /** When that automation's next session is scheduled to run, or null if it is not running. */
  readonly nextSessionAt: (automationId: string) => number | null
  /** What that automation's session in flight is doing, or null when none is running. */
  readonly sessionProgress: (automationId: string) => import('./orchestrator.js').SessionProgress | null
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
  /** The recent end of the session log file, oldest first. */
  readonly sessionLogTail: () => readonly string[]
  /** What the main process complained about lately, oldest first. */
  readonly diagnostics: () => readonly DiagnosticEntry[]
}

/**
 * Everything the renderer can do, with no Electron dependency. `main.ts` only
 * forwards IPC channels here, which keeps this whole surface unit-testable.
 */
/** What the log screen shows at most; the files keep everything. */
const RECENT_LOG_LIMIT = 200

export function createRendererApi(deps: RendererApiDeps): RendererApi {
  const { repos, settings } = deps
  const startedAt = deps.clock.now()

  const setting = (automationId: string) => repos.automationSettings.get(automationId)

  const scheduleView = (): CollectionScheduleView => ({
    schedule: readCollectionSchedule(settings),
    pacing: readCollectionPacing(settings),
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
    patch: Partial<{ policy: ApprovalPolicy; enabled: boolean; boardId: string; optionsJson: string }>,
  ): void => {
    const current = setting(automationId)
    repos.automationSettings.upsert({
      automationId,
      policy: patch.policy ?? current?.policy ?? 'AUTO',
      limits: current?.limits ?? {},
      enabled: patch.enabled ?? current?.enabled ?? false,
      boardId: patch.boardId ?? current?.boardId ?? null,
      optionsJson: patch.optionsJson ?? current?.optionsJson ?? '{}',
    })
  }

  return {
    async getRecentLog(): Promise<readonly LogEntry[]> {
      const collection = deps.collection()
      const collectionRuns = collection.kind === 'ready' ? (await collection.status.read()).recentRuns : []
      return mergeRecentLog({
        sessionLines: deps.sessionLogTail(),
        diagnostics: deps.diagnostics(),
        collectionRuns,
        limit: RECENT_LOG_LIMIT,
      })
    },

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

    setCollectionPacing(pacing): Promise<CollectionScheduleView> {
      // A block reads it as it starts, so there is no beat to re-lay.
      writeCollectionPacing(settings, pacing)
      return Promise.resolve(scheduleView())
    },

    async startCollection(request?: CollectionRunRequest): Promise<StartCollectionResult> {
      const collection = deps.collection()
      const stored = collection.kind === 'ready' ? await collection.status.read() : null
      const inProgress = stored?.job ?? null

      const startFor = (range: CollectionRange, feeds: readonly CollectionFeed[], resumeFromCheckpoint: boolean): StartCollectionResult => {
        const schedule = readCollectionSchedule(settings)
        const started = deps.collectionRunner.start({
          range, kind: 'backfill', maxPages: pagesPerWorkBlock(schedule.workBlockMinutes, readCollectionPacing(settings)), feeds, resumeFromCheckpoint,
        })
        return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
      }

      if (request === undefined) {
        if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
        if (inProgress === null) return { kind: 'refused', reason: 'NO_JOB' }
        if (inProgress.complete) return { kind: 'refused', reason: 'JOB_FINISHED' }
        const rows = describeJob(await collection.repository.listFeedStates())
        if (rows === null) return { kind: 'refused', reason: 'NO_JOB' }
        return startFor({ startMs: rows.targetStartMs, endMs: rows.targetEndMs }, rows.remaining.map((row) => row.feed), true)
      }

      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const range = collectionRangeOfDays(request.firstDayMs, request.lastDayMs)
      const problem = checkCollectionRange(range, deps.clock.now())
      if (problem !== null) return { kind: 'rejected', problem }
      const scope = request.scope ?? 'board'

      const sameJob =
        inProgress !== null && inProgress.scope === scope &&
        inProgress.targetStartMs === range.startMs && inProgress.targetEndMs === range.endMs

      if (inProgress !== null && !sameJob && !inProgress.complete && request.replace !== true) {
        return { kind: 'needs_replace', job: inProgress }
      }
      if (inProgress !== null && !sameJob && deps.collectionRunner.isRunning()) {
        return { kind: 'refused', reason: 'STOP_RUNNING_FIRST' }
      }

      // The same unfinished job carries on from its cursors. Anything else —
      // a new period, a new scope, or the same one asked for again after it
      // finished — is made afresh, without touching the posts already held.
      if (sameJob && !inProgress.complete) {
        const rows = describeJob(await collection.repository.listFeedStates())
        if (rows === null) return { kind: 'refused', reason: 'NO_JOB' }
        return startFor(range, rows.remaining.map((row) => row.feed), true)
      }
      const made = describeJob(await collection.repository.replaceJob({ scope, targetStartMs: range.startMs, targetEndMs: range.endMs, at: new Date(deps.clock.now()) }))
      if (made === null) return { kind: 'refused', reason: 'NO_JOB' }
      return startFor(range, made.feeds.map((row) => row.feed), false)
    },

    async setCollectionForced(forced: boolean): Promise<SetCollectionForcedResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }

      const stored = await collection.status.read()
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
      return { kind: 'ready', status: await collection.status.read() }
    },

    async getMemberCollectionStatus(): Promise<MemberCollectionStatusView> {
      const collection = deps.collection()
      if (collection.kind === 'disabled') return { kind: 'disabled' }
      if (collection.kind === 'unavailable') return { kind: 'unavailable', code: collection.code }
      const [status, resync] = await Promise.all([
        collection.memberStatus.read(),
        readMemberResyncView({
          feed: collection.memberRepository,
          resync: collection.memberResyncRepository,
          intervalDays: readMemberResyncInterval(settings),
          running: deps.memberResyncRunner.isRunning(),
          scheduleEnabled: readCollectionSchedule(settings).enabled,
        }),
      ])
      return { kind: 'ready', status, resync }
    },

    async startMemberCollection(): Promise<StartCollectionResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const state = await collection.memberRepository.readMemberFeedState()
      if (state?.complete === true) return { kind: 'refused', reason: 'JOB_FINISHED' }
      const schedule = readCollectionSchedule(settings)
      const maxPages = pagesPerWorkBlock(schedule.workBlockMinutes, readCollectionPacing(settings))
      // First start walks from page 1; an existing unfinished row resumes.
      const started = deps.memberCollectionRunner.start({
        mode: state === null ? 'backfill' : 'incremental',
        maxPages,
        resumeFromCheckpoint: state !== null,
      })
      return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
    },

    stopMemberCollection(): Promise<void> {
      // One button for either walk over the member list: at most one is in flight.
      deps.memberCollectionRunner.stop()
      deps.memberResyncRunner.stop()
      return Promise.resolve()
    },

    async startMemberResync(): Promise<StartCollectionResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const feed = await collection.memberRepository.readMemberFeedState()
      // Nothing to walk again until the first walk has been through the list.
      if (feed?.complete !== true) return { kind: 'refused', reason: 'NO_JOB' }
      const resync = await collection.memberResyncRepository.readResyncState()
      const schedule = readCollectionSchedule(settings)
      const started = deps.memberResyncRunner.start({
        mode: 'resync',
        maxPages: pagesPerWorkBlock(schedule.workBlockMinutes, readCollectionPacing(settings)),
        resumeFromCheckpoint: resync?.inProgress === true,
      })
      return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
    },

    setMemberResyncInterval(days): Promise<MemberResyncIntervalDays> {
      // The loop asks the job whether it is due on every beat; nothing to re-lay.
      return Promise.resolve(writeMemberResyncInterval(settings, days))
    },

    async getBoardSearchStatus(): Promise<BoardSearchStatusView> {
      const collection = deps.collection()
      if (collection.kind === 'disabled') return { kind: 'disabled' }
      if (collection.kind === 'unavailable') return { kind: 'unavailable', code: collection.code }
      return {
        kind: 'ready',
        view: await readBoardSearchView({
          repository: collection.boardSearchRepository,
          coverage: collection.boardSearchCoverage,
          lastRuns: collection.boardSearchLastRuns,
          running: deps.boardSearchRunner.isRunning(),
          blockFailure: deps.boardSearchRunner.blockFailure(),
        }),
      }
    },

    async previewBoardSearchJob(request): Promise<BoardSearchPlanView> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const plan = await planBoardSearchJob(collection.boardSearchRepository, request)
      return plan.kind === 'ready' ? { kind: 'ready', toDay: plan.toDay, queryCount: plan.queries.length } : plan
    },

    async createBoardSearchJob(request): Promise<BoardSearchPlanView> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      if (deps.boardSearchRunner.isRunning()) return { kind: 'refused', reason: 'STOP_RUNNING_FIRST' }
      const plan = await planBoardSearchJob(collection.boardSearchRepository, request)
      if (plan.kind !== 'ready') return plan
      await collection.boardSearchRepository.replaceJob({ ...plan, at: new Date(deps.clock.now()) })
      return { kind: 'ready', toDay: plan.toDay, queryCount: plan.queries.length }
    },

    async startBoardSearch(): Promise<StartCollectionResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const queries = await collection.boardSearchRepository.listQueries()
      if (queries.length === 0) return { kind: 'refused', reason: 'NO_JOB' }
      if (queries.every((query) => query.complete)) return { kind: 'refused', reason: 'JOB_FINISHED' }
      const schedule = readCollectionSchedule(settings)
      const started = deps.boardSearchRunner.start({ maxPages: pagesPerWorkBlock(schedule.workBlockMinutes, readCollectionPacing(settings)) })
      return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
    },

    stopBoardSearch(): Promise<void> {
      deps.boardSearchRunner.stop()
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
        succeededToday: repos.executions.countByStatusForDay(automation.id, 'SUCCESS', dayStart, dayEnd),
        failedToday: repos.executions.countByStatusForDay(automation.id, 'FAILED', dayStart, dayEnd),
        lastOutcome: deps.lastOutcome(automation.id),
        lastOutcomeAt: deps.lastOutcomeAt(automation.id),
        nextSessionAt: deps.nextSessionAt(automation.id),
        sessionProgress: deps.sessionProgress(automation.id),
        executedByHourToday: countByKstHour(repos.executions.listExecutedAtBetween(automation.id, dayStart, dayEnd)),
      }))

      // The banner and the DayRhythm speak for the welcome automation; the top
      // level keeps its values so those screens read one automation without
      // knowing there could be more. The next session, though, is whichever
      // automation runs soonest — the earliest across them all.
      const welcome = automations.find((automation) => automation.id === WELCOME_AUTOMATION_ID)
      const nextTimes = automations
        .map((automation) => automation.nextSessionAt)
        .filter((time): time is number => time !== null)

      const sum = (pick: (automation: AutomationStatus) => number): number =>
        automations.reduce((total, automation) => total + pick(automation), 0)

      return Promise.resolve({
        loopRunning: deps.automation.isRunning(),
        awaitingApproval: sum((automation) => automation.awaitingApproval),
        executedToday: sum((automation) => automation.executedToday),
        succeededToday: sum((automation) => automation.succeededToday),
        failedToday: sum((automation) => automation.failedToday),
        // Named rather than positional: the banner answers "why is it quiet?",
        // and reordering the catalogue must not silently turn that into null.
        lastOutcome: welcome?.lastOutcome ?? null,
        automations,
        startupPreview: deps.getStartupPreview(),
        dayPreview: deps.getDayPreview(),
        lastOutcomeAt: welcome?.lastOutcomeAt ?? null,
        nextSessionAt: nextTimes.length === 0 ? null : Math.min(...nextTimes),
        sessionProgress: welcome?.sessionProgress ?? null,
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
      return Promise.resolve(approveExecution(repos.executions, id, deps.limits))
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
      const options = parseJsonRecord(current?.optionsJson ?? '{}')
      return Promise.resolve({
        policy: current?.policy ?? 'AUTO',
        enabled: current?.enabled ?? false,
        boardId: current?.boardId ?? '',
        options,
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

    setAutomationOptions(automationId, options) {
      upsert(automationId, { optionsJson: JSON.stringify(options) })
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

    runOnce(automationId, request = {}) {
      // Resolves once the session has started rather than when it ends. A full
      // day's greetings take the better part of an hour, and a renderer waiting
      // that out would hold its controls — the stop switches included — shut
      // for the whole run. Failures inside the session are the loop's to report.
      const mode = request.force === true ? 'FORCED' : 'MANUAL'
      void deps.automation
        .runOnce(automationId, { mode, ...(request.dayStartMs === undefined ? {} : { dayStartMs: request.dayStartMs }) })
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
