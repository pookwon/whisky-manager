import { randomUUID } from 'node:crypto'
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
import { createSessionLoop, type SessionLoop } from './sessionLoop.js'
import { generateToken } from './ws/pairing.js'
import { createBridgeServer, type BridgeServer } from './ws/server.js'

export const WELCOME_AUTOMATION_ID = 'welcome-comment'

export interface AppContextOptions {
  readonly databasePath: string
  readonly migrationsFolder: string
  readonly profile: Profile
  readonly bridgePort: number
}

export interface AppRepos {
  readonly executions: ExecutionsRepo
  readonly templates: TemplatesRepo
  readonly automationSettings: AutomationSettingsRepo
  readonly watermarks: WatermarksRepo
  readonly dedupe: DedupeStore
}

export interface AppContext {
  readonly db: AppDatabase
  readonly settings: SettingsRepo
  readonly repos: AppRepos
  readonly bridge: BridgeServer
  readonly loop: SessionLoop
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

  const loop = createSessionLoop({
    limits: PROFILES[options.profile],
    clock: systemClock,
    random: systemRandom,
    // Plan C2 replaces this with the assembled session once settings and
    // templates feed into it. The loop's shape is fixed here.
    runSession: () => Promise.reject(new Error('session wiring lands in plan C2')),
    onOutcome: () => {},
    onError: (error) => console.error('[session]', error),
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
  })

  return {
    db,
    settings,
    repos,
    bridge,
    loop,
    async shutdown() {
      loop.stop()
      await bridge.close()
    },
  }
}
