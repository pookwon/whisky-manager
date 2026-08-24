import { randomUUID } from 'node:crypto'
import { WELCOME_AUTOMATION_ID, assertRuntimesRegistered } from '../shared/automations/catalog.js'
import { PROFILES } from '../shared/profiles.js'
import type { Profile } from '../shared/types.js'
import { createAutomationSettingsRepo, type AutomationSettingsRepo } from './db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from './db/client.js'
import { createSqliteDedupeStore, type DedupeStore } from './db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from './db/executionsRepo.js'
import { createSettingsRepo, type SettingsRepo } from './db/settingsRepo.js'
import { createTemplatesRepo, type TemplatesRepo } from './db/templatesRepo.js'
import { systemClock, systemRandom } from './runtime.js'
import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import type { SessionRequest } from './session.js'
import { createSessionRunner, SETTING_KEYS, parseOperatorAccounts, DEFAULT_CAFE_ID, DEFAULT_BOARD_ID } from './session.js'
import { createSessionLoop } from './sessionLoop.js'
import { generateToken } from './ws/pairing.js'
import { createBridgeServer, type BridgeServer } from './ws/server.js'
import { previewDay, type StartupPreview } from './preview.js'

// Re-exported so the many main-process callers keep their existing import.
export { WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'

export interface AppContextOptions {
  readonly databasePath: string
  readonly migrationsFolder: string
  readonly profile: Profile
  readonly bridgePort: number
  /** Fired when the loop stops itself; the shell should show the new state. */
  readonly onHalt?: (reason: 'NOT_LOGGED_IN' | 'LOGIN_CHECK_FAILED') => void
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
  readonly automation: AutomationControl
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
  previewDay(dayStartMs: number): Promise<StartupPreview>
  /** Epoch timestamp when the bridge last connected, or null if never. */
  lastBridgeConnectedAt(): number | null
  shutdown(): Promise<void>
}

export async function createAppContext(options: AppContextOptions): Promise<AppContext> {
  const db = openDatabase(options.databasePath, { migrationsFolder: options.migrationsFolder })
  const settings = createSettingsRepo(db)

  let token = settings.get('pairingToken')
  if (token === undefined) {
    token = generateToken()
    settings.set('pairingToken', token)
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
      boardId: null,
    })
  }

  const bridge = await createBridgeServer({
    token,
    boundExtensionId: settings.get('boundExtensionId') ?? null,
    port: options.bridgePort,
    onBind: (extensionId) => settings.set('boundExtensionId', extensionId),
  })

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

  // The one runtime this build ships. Adding a catalogue entry without adding
  // it here fails the boot, which is the point: the seam where a second
  // automation's runtime gets wired is visible in the code rather than left to
  // a developer's memory.
  assertRuntimesRegistered([WELCOME_AUTOMATION_ID])

  const runSession = createSessionRunner({
    automationId: WELCOME_AUTOMATION_ID,
    profile: options.profile,
    clock: systemClock,
    random: systemRandom,
    transport: bridge,
    repos,
    settings,
    isKilled: () => killed,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newId: () => randomUUID(),
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

  const loop = createSessionLoop({
    limits: PROFILES[options.profile],
    clock: systemClock,
    random: systemRandom,
    runSession: runSessionReportingProgress,
    onOutcome: (outcome) => {
      lastOutcome = outcome
      lastOutcomeAt = systemClock.now()
    },
    onError: (error) => console.error('[session]', error),
    onHalt: (reason) => {
      console.warn('[session] halted:', reason)
      options.onHalt?.(reason)
    },
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
  })

  const automation: AutomationControl = {
    start() {
      killed = false
      loop.start()
    },
    stop() {
      loop.stop()
    },
    kill() {
      killed = true
      loop.stop()
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
        const boardId = automationSetting?.boardId ?? DEFAULT_BOARD_ID

        // Run the preview asynchronously; don't block the monitor loop
        void previewDay({
          transport: bridge,
          cafeId: settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID,
          boardId,
          automationId: WELCOME_AUTOMATION_ID,
          nowMs: systemClock.now(),
          newRequestId: () => randomUUID(),
          operatorAccounts,
          policy: automationSetting?.policy ?? 'AUTO',
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

  // Monitor bridge connection state to track when it connects.
  // This is called synchronously when the extension connects, and we record
  // the timestamp so we can calculate how long it has been disconnected.
  let monitorConnectionHandle: NodeJS.Timeout | null = null
  const startBridgeMonitor = (): void => {
    monitorConnectionHandle = setInterval(() => {
      if (bridge.isConnected() && lastBridgeConnectedAt === null) {
        lastBridgeConnectedAt = systemClock.now()
      }
    }, 1000)
  }
  startBridgeMonitor()

  return {
    db,
    settings,
    repos,
    bridge,
    automation,
    lastOutcome: () => lastOutcome,
    lastOutcomeAt: () => lastOutcomeAt,
    sessionProgress: () => sessionProgress,
    getStartupPreview: () => startupPreview,
    previewDay: (dayStartMs) =>
      previewDay({
        transport: bridge,
        cafeId: settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID,
        boardId: repos.automationSettings.get(WELCOME_AUTOMATION_ID)?.boardId ?? DEFAULT_BOARD_ID,
        automationId: WELCOME_AUTOMATION_ID,
        nowMs: systemClock.now(),
        newRequestId: () => randomUUID(),
        operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
        policy: repos.automationSettings.get(WELCOME_AUTOMATION_ID)?.policy ?? 'AUTO',
        dayStartMs,
      }),
    lastBridgeConnectedAt: () => lastBridgeConnectedAt,
    async shutdown() {
      if (previewMonitorHandle !== null) {
        clearInterval(previewMonitorHandle)
      }
      if (monitorConnectionHandle !== null) {
        clearInterval(monitorConnectionHandle)
      }
      loop.stop()
      await bridge.close()
    },
  }
}
