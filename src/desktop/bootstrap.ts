import { randomUUID } from 'node:crypto'
import { WELCOME_AUTOMATION_ID, assertRuntimesRegistered } from '../shared/automations/catalog.js'
import { PROFILES } from '../shared/profiles.js'
import type { Profile } from '../shared/types.js'
import { createAutomationSettingsRepo, type AutomationSettingsRepo } from './db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from './db/client.js'
import { createSqliteDedupeStore, type DedupeStore } from './db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from './db/executionsRepo.js'
import { createMembersRepo, type MembersRepo } from './db/membersRepo.js'
import { createSettingsRepo, type SettingsRepo } from './db/settingsRepo.js'
import { createTemplatesRepo, type TemplatesRepo } from './db/templatesRepo.js'
import { createWatermarksRepo, type WatermarksRepo } from './db/watermarksRepo.js'
import { systemClock, systemRandom } from './runtime.js'
import type { SessionOutcome } from './orchestrator.js'
import { createSessionRunner, parseWindowDays, SETTING_KEYS, parseOperatorAccounts, DEFAULT_CAFE_ID, DEFAULT_BOARD_ID } from './session.js'
import { createSessionLoop } from './sessionLoop.js'
import { generateToken } from './ws/pairing.js'
import { createBridgeServer, type BridgeServer } from './ws/server.js'
import { previewToday, type StartupPreview } from './preview.js'

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
  readonly watermarks: WatermarksRepo
  readonly dedupe: DedupeStore
  readonly members: MembersRepo
}

export interface AutomationControl {
  /** Clears the kill switch and resumes the schedule. */
  start(): void
  /** Pauses the schedule. The kill switch is left as it was. */
  stop(): void
  /** Stops now and refuses every session until started again. */
  kill(): void
  isRunning(): boolean
  runOnce(): Promise<void>
}

export interface AppContext {
  readonly db: AppDatabase
  readonly settings: SettingsRepo
  readonly repos: AppRepos
  readonly bridge: BridgeServer
  readonly automation: AutomationControl
  /** Result of the most recent session, for the tray and the dashboard. */
  lastOutcome(): SessionOutcome | null
  /**
   * Count of greeting targets available at startup, once the bridge connects.
   * Null while not yet counted; a READY or UNAVAILABLE result once obtained.
   */
  getStartupPreview(): StartupPreview | null
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
    watermarks: createWatermarksRepo(db),
    dedupe: createSqliteDedupeStore(db, () => randomUUID()),
    members: createMembersRepo(db),
  }

  let killed = false
  let lastOutcome: SessionOutcome | null = null
  let startupPreview: StartupPreview | null = null
  let previewMonitorHandle: NodeJS.Timeout | null = null

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
  })

  const loop = createSessionLoop({
    limits: PROFILES[options.profile],
    clock: systemClock,
    random: systemRandom,
    runSession,
    onOutcome: (outcome) => {
      lastOutcome = outcome
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
    runOnce: () => loop.runOnce(),
  }

  // Monitor bridge connection and run preview once when it connects.
  // The preview is run exactly once per app session to avoid repeated cafe hits.
  const startPreviewMonitor = (): void => {
    previewMonitorHandle = setInterval(() => {
      if (bridge.isConnected() && startupPreview === null) {
        // Clear the monitor first to ensure we never run again
        if (previewMonitorHandle !== null) {
          clearInterval(previewMonitorHandle)
          previewMonitorHandle = null
        }

        const windowDays = parseWindowDays(settings.get(SETTING_KEYS.newMemberWindowDays))
        const operatorAccounts = parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts))
        const automationSetting = repos.automationSettings.get(WELCOME_AUTOMATION_ID)
        const boardId = automationSetting?.boardId ?? DEFAULT_BOARD_ID

        // Run the preview asynchronously; don't block the monitor loop
        void previewToday({
          transport: bridge,
          repo: repos.members,
          cafeId: settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID,
          boardId,
          automationId: WELCOME_AUTOMATION_ID,
          windowDays,
          nowMs: systemClock.now(),
          newRequestId: () => randomUUID(),
          operatorAccounts,
        }).then((result) => {
          startupPreview = result
        }).catch((error) => {
          console.error('[startup-preview] failed:', error)
          startupPreview = { kind: 'UNAVAILABLE', reason: 'READ_FAILED' }
        })
      }
    }, 100)
  }

  // Start monitoring after bridge is initialized
  startPreviewMonitor()

  return {
    db,
    settings,
    repos,
    bridge,
    automation,
    lastOutcome: () => lastOutcome,
    getStartupPreview: () => startupPreview,
    async shutdown() {
      if (previewMonitorHandle !== null) {
        clearInterval(previewMonitorHandle)
      }
      loop.stop()
      await bridge.close()
    },
  }
}
