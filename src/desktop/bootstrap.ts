import { randomUUID } from 'node:crypto'
import { assertRuntimesRegistered } from '../shared/automations/catalog.js'
import { PROFILES } from '../shared/profiles.js'
import type { Profile } from '../shared/types.js'
import { createAutomationSettingsRepo, type AutomationSettingsRepo } from './db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from './db/client.js'
import { createSqliteDedupeStore, type DedupeStore } from './db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from './db/executionsRepo.js'
import { createSettingsRepo, type SettingsRepo } from './db/settingsRepo.js'
import { createTemplatesRepo, type TemplatesRepo } from './db/templatesRepo.js'
import { createWatermarksRepo, type WatermarksRepo } from './db/watermarksRepo.js'
import { systemClock, systemRandom } from './runtime.js'
import type { SessionOutcome } from './orchestrator.js'
import { createSessionRunner } from './session.js'
import { createSessionLoop } from './sessionLoop.js'
import { generateToken } from './ws/pairing.js'
import { createBridgeServer, type BridgeServer } from './ws/server.js'

export const WELCOME_AUTOMATION_ID = 'welcome-comment'

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
  }

  let killed = false
  let lastOutcome: SessionOutcome | null = null

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

  return {
    db,
    settings,
    repos,
    bridge,
    automation,
    lastOutcome: () => lastOutcome,
    async shutdown() {
      loop.stop()
      await bridge.close()
    },
  }
}
