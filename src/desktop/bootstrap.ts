import { randomUUID } from 'node:crypto'
import { WELCOME_AUTOMATION_ID, assertRuntimesRegistered } from '../shared/automations/catalog.js'
import { WELCOME_GUARDS } from '../shared/automations/welcome-comment/guards.js'
import {
  renderAnyWelcomeComment,
  renderWelcomeComment,
} from '../shared/automations/welcome-comment/render.js'
import { PROFILES } from '../shared/profiles.js'
import { TIMEOUTS } from '../shared/protocol.js'
import type { RenderOutcome } from '../shared/templates.js'
import type { Candidate, Profile } from '../shared/types.js'
import { createAutomationSettingsRepo, type AutomationSettingsRepo } from './db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from './db/client.js'
import { createSqliteDedupeStore, type DedupeStore } from './db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from './db/executionsRepo.js'
import { createSettingsRepo, type SettingsRepo } from './db/settingsRepo.js'
import { createTemplatesRepo, type TemplatesRepo } from './db/templatesRepo.js'
import { systemClock, systemRandom } from './runtime.js'
import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import type { SessionRequest } from './session.js'
import { createSessionRunner, SETTING_KEYS, parseOperatorAccounts, isConfigured } from './session.js'
import { createSessionLoop } from './sessionLoop.js'
import { createSessionWarmer, type WarmCheck } from './sessionWarmer.js'
import type { LocalConfig } from './localConfig.js'
import { generateToken } from './ws/pairing.js'
import { createBridgeServer, type BridgeServer } from './ws/server.js'
import { previewDay, type StartupPreview } from './preview.js'
import { createCommentAuthorLookup, type CommentAuthorLookup } from './commentAuthors.js'
import { createCollectGate } from './collectGate.js'
import { createNaverReadGate } from './naverReadGate.js'
import { createCollectionLoop, type CollectionLoop } from './collectionLoop.js'
import { createCollectionRunner, ALL_ARTICLES_FEED, type CollectionRunner } from './collectionRunner.js'
import { readCollectionSchedule } from './collectionSettings.js'
import { appendRefusal } from './refusalLog.js'
import {
  openOptionalCollectionContext,
  type CollectionUnavailableCode,
  type OptionalCollectionContext,
} from './collectionContext.js'

// Re-exported so the many main-process callers keep their existing import.
export { WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'

export interface AppContextOptions {
  readonly databasePath: string
  readonly migrationsFolder: string
  /** Packaged Drizzle migrations for the optional PostgreSQL collection DB. */
  readonly collectionMigrationsFolder?: string
  /**
   * Where refused sessions are written down. Omitted means they are not: a
   * dev run or a test has the outcome in front of it already.
   */
  readonly refusalLogPath?: string
  readonly profile: Profile
  readonly bridgePort: number
  /** Fired when the loop stops itself; the shell should show the new state. */
  readonly onHalt?: (reason: 'NOT_LOGGED_IN' | 'LOGIN_CHECK_FAILED') => void
  /** Safe status code only; DATABASE_URL and driver errors never cross this callback. */
  readonly onCollectionUnavailable?: (code: CollectionUnavailableCode) => void
  /**
   * A developer's own cafe, read from a file the repository does not carry.
   * Seeds an unset database and nothing else: values already entered are the
   * operator's and are never overwritten. Packaged builds pass nothing.
   */
  readonly localConfig?: LocalConfig | null
}

export interface AppRepos {
  readonly executions: ExecutionsRepo
  readonly templates: TemplatesRepo
  readonly automationSettings: AutomationSettingsRepo
  readonly dedupe: DedupeStore
}

export interface AutomationControl {
  /** Clears the kill switch and resumes the schedule. */
  start(): void
  /** Pauses the schedule. The kill switch is left as it was. */
  stop(): void
  /** Stops now and refuses every session until started again. */
  kill(): void
  isRunning(): boolean
  runOnce(request?: SessionRequest): Promise<void>
  /** Returns the epoch timestamp of the next scheduled session, or null if not running. */
  nextRunAt(): number | null
}

export interface AppContext {
  readonly db: AppDatabase
  readonly settings: SettingsRepo
  readonly repos: AppRepos
  readonly bridge: BridgeServer
  /** Optional PostgreSQL collection context; legacy automation remains usable without it. */
  readonly collection: OptionalCollectionContext
  /** Starts and stops one collection walk; the loop decides when scheduled ones happen. */
  readonly collectionRunner: CollectionRunner
  /** Re-read after the schedule is saved, so a change takes effect without a restart. */
  readonly collectionLoop: CollectionLoop
  readonly automation: AutomationControl
  /** Rotates the pairing token and clears both persistent and live extension trust. */
  resetExtensionPairing(): string
  /** Result of the most recent session, for the tray and the dashboard. */
  lastOutcome(): SessionOutcome | null
  /** Epoch timestamp when the last outcome arrived, or null if no session has run. */
  lastOutcomeAt(): number | null
  /** What the running session is doing, or null when none is in flight. */
  sessionProgress(): SessionProgress | null
  /**
   * Count of greeting targets available at startup, once the bridge connects.
   * Null while not yet counted; a READY or UNAVAILABLE result once obtained.
   */
  getStartupPreview(): StartupPreview | null
  /** Counts what a run on that day would answer, without answering any. */
  previewDay(dayStartMs?: number): Promise<StartupPreview>
  /** Current narrowing preview for the day under preview, or null if none. */
  getDayPreview(): StartupPreview | null
  /** Epoch timestamp when the bridge was last seen up, or null if it never was. */
  lastBridgeConnectedAt(): number | null
  /**
   * The last read taken purely to keep the browser's naver login in use. Null
   * until one lands, which is also what a stopped automation keeps showing.
   */
  lastWarm(): WarmCheck | null
  shutdown(): Promise<void>
}

export async function createAppContext(options: AppContextOptions): Promise<AppContext> {
  const db = openDatabase(options.databasePath, { migrationsFolder: options.migrationsFolder })
  const settings = createSettingsRepo(db)
  const collection = await openOptionalCollectionContext(process.env, options.collectionMigrationsFolder)
  if (collection.kind === 'unavailable') options.onCollectionUnavailable?.(collection.code)

  let token = settings.get('pairingToken')
  if (token === undefined) {
    token = generateToken()
    settings.set('pairingToken', token)
  }

  const local = options.localConfig ?? null
  if (local !== null) {
    if (local.cafeId !== undefined && settings.get(SETTING_KEYS.cafeId) === undefined) {
      settings.set(SETTING_KEYS.cafeId, local.cafeId)
    }
    if (local.cafeUrlName !== undefined && settings.get(SETTING_KEYS.cafeUrlName) === undefined) {
      settings.set(SETTING_KEYS.cafeUrlName, local.cafeUrlName)
    }
  }

  const automationSettings = createAutomationSettingsRepo(db)
  if (automationSettings.get(WELCOME_AUTOMATION_ID) === undefined) {
    // Disabled by default. An install that starts posting before anyone has
    // reviewed the settings is the accident this design exists to prevent.
    automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: false,
      boardId: local?.boardId ?? null,
    })
  }

  const bridge = await createBridgeServer({
    token,
    boundExtensionId: settings.get('boundExtensionId') ?? null,
    port: options.bridgePort,
    onBind: (extensionId) => settings.set('boundExtensionId', extensionId),
  })

  /**
   * Everything that reads the board goes through the gate rather than the
   * bridge, so the banner, the confirmation panel and the session cannot walk
   * it at the same time. The bridge itself stays for what is not a read of the
   * board: pairing state and shutdown.
   */
  const transport = createNaverReadGate(createCollectGate(bridge))

  const repos: AppRepos = {
    executions: createExecutionsRepo(db),
    templates: createTemplatesRepo(db),
    automationSettings,
    dedupe: createSqliteDedupeStore(db, () => randomUUID()),
  }

  let killed = false
  let lastOutcome: SessionOutcome | null = null
  let lastOutcomeAt: number | null = null
  let sessionProgress: SessionProgress | null = null
  let startupPreview: StartupPreview | null = null
  let previewMonitorHandle: NodeJS.Timeout | null = null
  let lastBridgeConnectedAt: number | null = null

  /**
   * Read on every use rather than captured at boot: the operator can enter the
   * cafe long after the app started, and a value frozen at startup would keep
   * the tool pointed at nothing until the next restart.
   */
  const configuredSource = (): { cafeId: string; boardId: string } | null => {
    const cafeId = settings.get(SETTING_KEYS.cafeId)
    const boardId = repos.automationSettings.get(WELCOME_AUTOMATION_ID)?.boardId
    if (!isConfigured(cafeId) || !isConfigured(boardId)) return null
    return { cafeId: cafeId.trim(), boardId: boardId.trim() }
  }

  // For narrowing the day preview as lookups land
  let dayPreview: StartupPreview | null = null
  let dayPreviewId = 0
  /**
   * One lookup per cafe-and-board, so the startup count and a later day preview
   * share what they learned instead of each paying for the same posts. Repointing
   * the tool builds a new one: answers gathered from another board are not
   * answers about this one.
   */
  let lookupInUse: { readonly key: string; readonly lookup: CommentAuthorLookup } | null = null
  const commentLookupFor = (source: { cafeId: string; boardId: string }): CommentAuthorLookup => {
    const key = `${source.cafeId}/${source.boardId}`
    if (lookupInUse?.key !== key) {
      lookupInUse = {
        key,
        lookup: createCommentAuthorLookup({
          transport,
          cafeId: source.cafeId,
          boardId: source.boardId,
          automationId: WELCOME_AUTOMATION_ID,
          newRequestId: () => randomUUID(),
          random: systemRandom,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        }),
      }
    }
    return lookupInUse.lookup
  }

  // The one runtime this build ships. Adding a catalogue entry without adding
  // it here fails the boot, which is the point: the seam where a second
  // automation's runtime gets wired is visible in the code rather than left to
  // a developer's memory.
  assertRuntimesRegistered([WELCOME_AUTOMATION_ID])

  const enabledTemplates = () => repos.templates.listEnabled(WELCOME_AUTOMATION_ID)

  /**
   * The comment a run will leave, drawn fresh each time so a template
   * registered mid-run takes effect on the next post.
   */
  const renderWelcomeBody = (candidate: Candidate): RenderOutcome =>
    renderWelcomeComment(enabledTemplates(), systemRandom, candidate)

  /**
   * What the count screens against instead. The two differ on purpose and only
   * here: a run commits to one drawn template, while a count must not depend on
   * a draw it cannot repeat. Every other step of the judgement is the same
   * `screenCandidate` for both.
   */
  const couldRenderWelcomeBody = (candidate: Candidate): RenderOutcome =>
    renderAnyWelcomeComment(enabledTemplates(), candidate)

  const runSession = createSessionRunner({
    automationId: WELCOME_AUTOMATION_ID,
    profile: options.profile,
    clock: systemClock,
    random: systemRandom,
    transport,
    repos,
    settings,
    isKilled: () => killed,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newId: () => randomUUID(),
    renderBody: renderWelcomeBody,
    onProgress: (progress) => {
      sessionProgress = progress
    },
  })

  /**
   * Progress only means anything while a session is in flight. Clearing it here
   * rather than in the loop's outcome handler covers the throwing run too — a
   * session that died would otherwise leave the dashboard claiming it is still
   * working on someone.
   */
  const runSessionReportingProgress = async (request?: SessionRequest): Promise<SessionOutcome> => {
    try {
      return await runSession(request)
    } finally {
      sessionProgress = null
    }
  }

  /**
   * The browser holds the login, so the automation is only ever as alive as the
   * naver session in it. The schedule stops reaching naver at midnight and the
   * first session of the day is hours later; this is what covers that gap.
   */
  const warmer = createSessionWarmer({
    clock: systemClock,
    random: systemRandom,
    warm: async () => {
      // A closed browser cannot be warmed, and saying so every hour would bury
      // the log in a fact the operator already knows.
      if (!bridge.isConnected()) return null
      // Nothing to keep warm until someone has said which cafe this is.
      const source = configuredSource()
      if (source === null) return null
      const reply = await transport.request(
        { type: 'CHECK_LOGIN', requestId: randomUUID(), source },
        TIMEOUTS.loginCheckMs,
      )
      // Any other reply did not answer the question this was sent to ask, and
      // reporting it as a sighting would date-stamp something never seen.
      return reply.type === 'LOGIN_STATE' ? { loggedIn: reply.loggedIn } : null
    },
    onError: (error) => console.warn('[warm]', error),
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
  })

  const loop = createSessionLoop({
    limits: PROFILES[options.profile],
    clock: systemClock,
    random: systemRandom,
    runSession: runSessionReportingProgress,
    onOutcome: (outcome, wake) => {
      lastOutcome = outcome
      lastOutcomeAt = systemClock.now()
      // A refusal is the one outcome that leaves nothing behind: no executions
      // to read afterwards, and the outcome itself only lives until a restart.
      if (!outcome.opened && options.refusalLogPath !== undefined) {
        appendRefusal(options.refusalLogPath, {
          reason: outcome.reason,
          judgedAt: lastOutcomeAt,
          wake,
        })
      }
    },
    onError: (error) => console.error('[session]', error),
    onHalt: (reason) => {
      console.warn('[session] halted:', reason)
      // The loop stopped itself, so its traffic stops with it. Warming a
      // session the operator has to restore by hand buys nothing.
      warmer.stop()
      options.onHalt?.(reason)
    },
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
  })

  /**
   * The collection walks the board through the same gate the greeting session
   * uses, and yields to it: a session in flight has a person waiting on it,
   * where a backfill has hours to spare.
   */
  const collectionRunner = createCollectionRunner({
    repository: () => (collection.kind === 'ready' ? collection.repository : null),
    transport,
    clock: systemClock,
    random: systemRandom,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isSessionBusy: () => sessionProgress !== null,
    newId: () => randomUUID(),
    onError: (error) => console.error('[collection]', error),
  })

  const collectionLoop = createCollectionLoop({
    schedule: () => readCollectionSchedule(settings),
    runner: collectionRunner,
    repository: () => (collection.kind === 'ready' ? collection.repository : null),
    feed: ALL_ARTICLES_FEED,
    clock: systemClock,
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
    onStarted: (result, scheduledFor) => {
      if (result.kind === 'refused') {
        console.warn('[collection] scheduled run refused:', result.reason, scheduledFor)
      }
    },
  })
  collectionLoop.refresh()

  const automation: AutomationControl = {
    start() {
      killed = false
      loop.start()
      warmer.start()
    },
    stop() {
      loop.stop()
      warmer.stop()
    },
    kill() {
      killed = true
      loop.stop()
      warmer.stop()
    },
    isRunning: () => loop.isRunning(),
    nextRunAt: () => loop.nextRunAt(),
    runOnce: (request) => loop.runOnce(request),
  }

  /**
   * Polls rather than listening because `onBind` fires only on an extension's
   * first ever pairing — after a restart the extension is already bound and no
   * event arrives. A second is soon enough for a banner, and the MV3 service
   * worker cycles often enough that a live extension is seen almost at once.
   */
  const PREVIEW_POLL_MS = 1_000

  const startPreviewMonitor = (): void => {
    previewMonitorHandle = setInterval(() => {
      if (bridge.isConnected() && startupPreview === null) {
        // Clear the monitor first to ensure we never run again
        if (previewMonitorHandle !== null) {
          clearInterval(previewMonitorHandle)
          previewMonitorHandle = null
        }

        const operatorAccounts = parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts))
        const automationSetting = repos.automationSettings.get(WELCOME_AUTOMATION_ID)
        const source = configuredSource()

        // Counting needs a board to count on. Saying so beats a banner that
        // reports a read failure the operator cannot act on.
        if (source === null) {
          startupPreview = { kind: 'UNAVAILABLE', reason: 'NOT_CONFIGURED' }
          return
        }

        // Run the preview asynchronously; don't block the monitor loop
        const startupId = ++dayPreviewId
        void previewDay({
          transport,
          cafeId: source.cafeId,
          boardId: source.boardId,
          automationId: WELCOME_AUTOMATION_ID,
          nowMs: systemClock.now(),
          newRequestId: () => randomUUID(),
          operatorAccounts,
          policy: automationSetting?.policy ?? 'AUTO',
          guards: WELCOME_GUARDS,
          renderBody: couldRenderWelcomeBody,
          // main's per-source lookup, not the single shared one this branch
          // was written against: the screening still takes resolved authors as
          // facts, so which lookup resolved them is the caller's business.
          lookup: commentLookupFor(source),
          onNarrow: (progress) => {
            // Only update dayPreview if this is still the current preview
            if (dayPreviewId === startupId) {
              dayPreview = progress
            }
          },
        }).then((result) => {
          startupPreview = result
        }).catch((error) => {
          console.error('[startup-preview] failed:', error)
          startupPreview = { kind: 'UNAVAILABLE', reason: 'READ_FAILED' }
        })
      }
    }, PREVIEW_POLL_MS)
  }

  // Start monitoring after bridge is initialized
  startPreviewMonitor()

  /**
   * Marks the bridge every second it is up, so a later teardown can be measured
   * from the last sighting. Recording only the first pairing would freeze the
   * mark at app start: an hour later every ordinary service worker cycle reads
   * as an hour of silence, and a live extension is reported as offline.
   */
  const BRIDGE_SAMPLE_MS = 1_000

  let monitorConnectionHandle: NodeJS.Timeout | null = null
  const startBridgeMonitor = (): void => {
    monitorConnectionHandle = setInterval(() => {
      if (bridge.isConnected()) lastBridgeConnectedAt = systemClock.now()
    }, BRIDGE_SAMPLE_MS)
  }
  startBridgeMonitor()

  return {
    db,
    settings,
    repos,
    bridge,
    collection,
    collectionRunner,
    collectionLoop,
    automation,
    resetExtensionPairing() {
      const nextToken = generateToken()
      db.transaction(() => {
        settings.set('pairingToken', nextToken)
        settings.remove('boundExtensionId')
      })
      bridge.resetPairing(nextToken)
      return nextToken
    },
    lastOutcome: () => lastOutcome,
    lastOutcomeAt: () => lastOutcomeAt,
    sessionProgress: () => sessionProgress,
    getStartupPreview: () => startupPreview,
    previewDay: (dayStartMs?) => {
      const source = configuredSource()
      if (source === null) {
        return Promise.resolve<StartupPreview>({ kind: 'UNAVAILABLE', reason: 'NOT_CONFIGURED' })
      }
      const id = ++dayPreviewId
      return previewDay({
        transport,
        cafeId: source.cafeId,
        boardId: source.boardId,
        automationId: WELCOME_AUTOMATION_ID,
        nowMs: systemClock.now(),
        newRequestId: () => randomUUID(),
        operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
        policy: repos.automationSettings.get(WELCOME_AUTOMATION_ID)?.policy ?? 'AUTO',
        guards: WELCOME_GUARDS,
        renderBody: couldRenderWelcomeBody,
        ...(dayStartMs !== undefined ? { dayStartMs } : {}),
        lookup: commentLookupFor(source),
        onNarrow: (progress) => {
          if (dayPreviewId === id) {
            dayPreview = progress
          }
        },
      })
    },
    getDayPreview: () => dayPreview,
    lastBridgeConnectedAt: () => lastBridgeConnectedAt,
    lastWarm: () => warmer.lastCheck(),
    async shutdown() {
      if (previewMonitorHandle !== null) {
        clearInterval(previewMonitorHandle)
      }
      if (monitorConnectionHandle !== null) {
        clearInterval(monitorConnectionHandle)
      }
      loop.stop()
      collectionLoop.stop()
      // A walk in flight is asked to end at its page boundary; the page it is
      // on is either committed whole or dropped whole, never half.
      collectionRunner.stop()
      warmer.stop()
      await bridge.close()
      await collection.close()
    },
  }
}
