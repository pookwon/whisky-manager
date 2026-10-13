import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, Tray, app, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { PROFILES } from '../shared/profiles.js'
import { TEXT } from '../shared/text.js'
import { createAppContext, type AppContext } from './bootstrap.js'
import { openChrome, systemChromeHost } from './chromeLauncher.js'
import { stageExtension } from './extensionBundle.js'
import {
  createStagedVersionFile,
  restageExtensionIfOutdated,
  shouldReloadExtension,
} from './extensionRestage.js'
import { fetchLatestRelease, githubHttp } from './githubHttp.js'
import { createUpdateRuntime, type UpdateRuntime } from './updateRuntime.js'
import {
  runExtensionRecovery,
  runExtensionSetup,
  type ExtensionSetupPorts,
  type ExtensionSetupResult,
} from './extensionSetup.js'
import { IPC_CHANNELS, type RendererApi } from './ipc.js'
import { readTailLines } from './logTail.js'
import { readLocalConfig } from './localConfig.js'
import { ensureCollectionDatabaseConfig } from './collectionDatabaseConfig.js'
import { createRendererApi } from './rendererApi.js'
import { systemClock } from './runtime.js'
import type { CollectionUnavailableCode } from './collectionContext.js'

const BRIDGE_PORT = 39_217

/**
 * Where the extension is unpacked to, beside the database rather than inside
 * the app bundle. Chrome cannot read an unpacked extension out of `app.asar`,
 * and it identifies one by its path — so this has to be a real directory, and
 * the same real directory on every run.
 */
const STAGED_EXTENSION_DIRNAME = 'chrome-extension'

/** Which app version last wrote the staged extension; survives the app being replaced. */
const STAGED_VERSION_FILENAME = 'staged-app-version'

/** How long an update waits for work to stop and storage to close before it goes ahead. */
const SHUTDOWN_BEFORE_UPDATE_MS = 15_000

/**
 * The installed build's only way to be told where the collection database is.
 * It sits beside the SQLite database rather than inside the bundle: an update
 * replaces the bundle, and the operator would have to enter it again.
 */
const COLLECTION_CONFIG_FILENAME = 'collection-db.json'
/** A few hundred session lines; the log screen shows at most 200 entries. */
const SESSION_LOG_TAIL_BYTES = 64 * 1024

function collectionConfigPath(): string {
  return join(app.getPath('userData'), COLLECTION_CONFIG_FILENAME)
}

/**
 * Where the data lives is fixed, not derived. Electron takes this directory
 * from the app's name, which is a display choice — the bundle was renamed once
 * already, and had this been left alone that rename would have stranded every
 * template, token and execution record in a directory nobody would think to
 * look in. The development run and the installed build also have to meet in
 * the same database, and this is what makes them.
 */
app.setPath('userData', join(app.getPath('appData'), 'whisky-manager'))

let context: AppContext | null = null
let tray: Tray | null = null
let window: BrowserWindow | null = null
let updates: UpdateRuntime | null = null

/** Set when this launch rewrote the staged extension; spent on the first reload it asks for. */
let extensionReloadArmed = false

/**
 * A second copy would fight the first for the bridge port, and the loser's
 * fatal-error dialog is the last thing an operator mid-update should see.
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function showWindow(): void {
  if (window === null) {
    window = new BrowserWindow({
      width: 1_100,
      height: 760,
      show: false,
      backgroundColor: '#141210',
      webPreferences: {
        preload: fileURLToPath(new URL('preload.js', import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    window.on('closed', () => {
      window = null
    })
    void window.loadFile(join(app.getAppPath(), 'dist/renderer/index.html'))
  }
  window.show()
  window.focus()
}

/** The tray's one line about an update, or none while there is nothing to say. */
function updateTrayItems(): Electron.MenuItemConstructorOptions[] {
  const coordinator = updates?.coordinator
  if (coordinator === undefined) return []
  const state = coordinator.state()
  if (state.kind === 'ready') {
    return [
      { type: 'separator' },
      { label: TEXT.tray.updateReady(state.version), click: () => void coordinator.apply() },
    ]
  }
  if (state.kind === 'waitingIdle') {
    return [{ type: 'separator' }, { label: TEXT.tray.updateWaiting, enabled: false }]
  }
  return []
}

function refreshTray(ctx: AppContext): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: TEXT.tray.openWindow, click: showWindow },
      { type: 'separator' },
      {
        label: ctx.automation.isRunning() ? TEXT.tray.stopAutomation : TEXT.tray.startAutomation,
        click: () => {
          if (ctx.automation.isRunning()) ctx.automation.stop()
          else ctx.automation.start()
          refreshTray(ctx)
        },
      },
      {
        label: TEXT.tray.kill,
        click: () => {
          ctx.automation.kill()
          refreshTray(ctx)
        },
      },
      { type: 'separator' },
      {
        label: TEXT.tray.openCollectionConfig,
        click: () => {
          const path = collectionConfigPath()
          // Written empty when absent so the operator opens the shape to fill
          // in rather than a missing-file error from the editor.
          ensureCollectionDatabaseConfig(path)
          void shell.openPath(path)
        },
      },
      ...updateTrayItems(),
      { type: 'separator' },
      { label: TEXT.tray.quit, role: 'quit' },
    ]),
  )
}

/**
 * The first-run guide's one press, wired to the shell it needs. The steps
 * themselves live in `extensionSetup`; what is here is only which Electron and
 * OS facility each of them is.
 */
function extensionSetupPorts(): ExtensionSetupPorts {
  return {
    stage: () =>
      stageExtension(
        join(app.getAppPath(), 'dist/extension'),
        join(app.getPath('userData'), STAGED_EXTENSION_DIRNAME),
      ),
    // The manifest rather than the folder: this opens the folder with that file
    // picked out inside it, which is exactly the "manifest.json이 바로 보이는
    // 폴더" the operator is told to hand to Chrome.
    reveal: (directory) => shell.showItemInFolder(join(directory, 'manifest.json')),
    copyText: (text) => clipboard.writeText(text),
    openChrome: () => openChrome(systemChromeHost),
  }
}

function openExtensionSetup(): ExtensionSetupResult {
  return runExtensionSetup(extensionSetupPorts())
}

/**
 * The settings file, in the shell's terms.
 *
 * Both dialogs are parented to the window, which makes them modal to it — a
 * sheet on macOS, an owned dialog elsewhere. Unparented, a picker can end up
 * behind the window with the app looking frozen and no way to see why. The
 * unparented fallback is for the type rather than for a real case: the press
 * that gets here came from a button inside the window.
 */
const FILE_FILTERS = [{ name: TEXT.configTransfer.fileKind, extensions: ['json'] }]

const configFile = {
  async chooseSavePath(defaultName: string): Promise<string | null> {
    const options = {
      title: TEXT.configTransfer.saveTitle,
      defaultPath: defaultName,
      filters: FILE_FILTERS,
    }
    const result = await (window === null
      ? dialog.showSaveDialog(options)
      : dialog.showSaveDialog(window, options))
    return result.canceled || result.filePath === '' ? null : result.filePath
  },
  async chooseOpenPath(): Promise<string | null> {
    const options = {
      title: TEXT.configTransfer.openTitle,
      properties: ['openFile' as const],
      filters: FILE_FILTERS,
    }
    const result = await (window === null
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(window, options))
    return result.canceled ? null : (result.filePaths[0] ?? null)
  },
  writeText: (path: string, text: string): void => writeFileSync(path, text, 'utf8'),
  readText: (path: string): string => readFileSync(path, 'utf8'),
}

/**
 * The renderer talks to one plain object; this only forwards channels. Keeping
 * the logic out of here is what makes the whole surface unit-testable.
 */
function registerIpc(api: RendererApi): void {
  for (const [name, channel] of Object.entries(IPC_CHANNELS)) {
    const method = api[name as keyof RendererApi] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(channel, (_event, ...args: unknown[]) => method(...args))
  }
}

/**
 * A throw while the app is coming up otherwise reaches nobody. There is no
 * window to show it in yet, so the process aborts and leaves a crash report
 * naming Electron rather than the failure — which is unreadable to the
 * operator and near-useless to whoever is asked to fix it. Writing it down and
 * saying so out loud is the difference between a fault that can be read and
 * one that can only be guessed at.
 */
function reportFatalStartupError(error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error('[startup] failed:', detail)
  try {
    writeFileSync(join(app.getPath('userData'), 'startup-error.log'), `${detail}\n`)
  } catch {
    // The log is a convenience. Failing to write it must not replace the
    // original fault with a second one.
  }
  dialog.showErrorBox('시작하지 못했습니다', detail)
  app.quit()
}

function reportCollectionUnavailable(code: CollectionUnavailableCode): void {
  // The code is deliberately safe to expose. Driver messages may contain a
  // hostname or user name and never reach logs or the renderer.
  console.error('[collection] unavailable:', code)
  try {
    writeFileSync(join(app.getPath('userData'), 'collection-status.log'), `${code}\n`)
  } catch {
    // Collection remains unavailable; failure to write its diagnostic must not
    // take down the existing SQLite-backed greeting automation.
  }
}

void app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return

  // Only the installed build registers itself to start with the machine. A dev
  // run must not leave a login item pointing at a temporary electron binary.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
  }

  // Only an installed build owns the staged folder. A development run shares
  // this userData directory and must not overwrite it with its own files.
  if (app.isPackaged) {
    try {
      const stagedDirectory = join(app.getPath('userData'), STAGED_EXTENSION_DIRNAME)
      extensionReloadArmed = restageExtensionIfOutdated({
        appVersion: app.getVersion(),
        stagedDirectory,
        ...createStagedVersionFile(join(app.getPath('userData'), STAGED_VERSION_FILENAME)),
        stage: () => stageExtension(join(app.getAppPath(), 'dist/extension'), stagedDirectory),
      })
    } catch (error) {
      console.error('[update] extension restage failed:', error)
    }
  }

  const profile = app.isPackaged ? 'production' : 'debug'
  const sessionLogPath = join(app.getPath('userData'), 'sessions.log')
  context = await createAppContext({
    databasePath: join(app.getPath('userData'), 'whisky-manager.db'),
    sessionLogPath,
    migrationsFolder: join(app.getAppPath(), 'drizzle'),
    collectionMigrationsFolder: join(app.getAppPath(), 'drizzle-collection'),
    collectionConfigPath: collectionConfigPath(),
    profile,
    bridgePort: BRIDGE_PORT,
    // Only an unpackaged run looks for it, and only to spare a developer
    // re-entering the same board into every fresh database.
    localConfig: app.isPackaged ? null : readLocalConfig(join(app.getAppPath(), 'config', 'local.json')),
    // The tray label reads isRunning(); a self-halt must repaint it, or the
    // menu keeps claiming the automation is running after a logout.
    onHalt: () => {
      if (context !== null) refreshTray(context)
    },
    onCollectionUnavailable: reportCollectionUnavailable,
    // A restaged extension keeps running its old files until it re-reads them.
    // It is asked once, and only while it still reports an older build.
    onExtensionConnected: () => {
      if (!extensionReloadArmed || context === null) return
      extensionReloadArmed = false
      const extensionVersion = context.bridge.extensionVersion()
      if (shouldReloadExtension({ armed: true, appVersion: app.getVersion(), extensionVersion })) {
        context.bridge.notify({ type: 'RELOAD' })
      }
    },
  })

  const appContext = context
  const updateRuntime = createUpdateRuntime({
    platform: process.platform,
    arch: process.arch,
    currentVersion: app.getVersion(),
    enabled: app.isPackaged,
    userDataDirectory: app.getPath('userData'),
    executablePath: process.execPath,
    processId: process.pid,
    fetchLatestRelease,
    http: githubHttp,
    openPath: (path) => shell.openPath(path),
    spawnDetached: (command, args) =>
      new Promise((resolve) => {
        const child = spawn(command, [...args], { detached: true, stdio: 'ignore', windowsHide: true })
        child.once('error', () => resolve(false))
        child.once('spawn', () => {
          child.unref()
          resolve(true)
        })
      }),
    isBusy: () => appContext.isBusy(),
    shutdown: () =>
      Promise.race([
        appContext.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_BEFORE_UPDATE_MS)),
      ]),
    exit: () => app.exit(0),
  })
  updates = updateRuntime
  updateRuntime.coordinator.subscribe(() => refreshTray(appContext))
  registerIpc(
    createRendererApi({
      repos: appContext.repos,
      settings: appContext.settings,
      bridge: appContext.bridge,
      automation: appContext.automation,
      collection: () => appContext.collection,
      collectionPipeline: appContext.collectionPipeline,
      memberCollectionRunner: appContext.memberCollectionRunner,
      memberResyncRunner: appContext.memberResyncRunner,
      boardSearchRunner: appContext.boardSearchRunner,
      articleProbeRunner: appContext.articleProbeRunner,
      collectionLoop: appContext.collectionLoop,
      lastOutcome: (automationId) => appContext.lastOutcome(automationId),
      lastOutcomeAt: (automationId) => appContext.lastOutcomeAt(automationId),
      getStartupPreview: () => appContext.getStartupPreview(),
      getDayPreview: () => appContext.getDayPreview(),
      lastBridgeConnectedAt: () => appContext.lastBridgeConnectedAt(),
      appVersion: app.getVersion(),
      extensionVersion: () => appContext.bridge.extensionVersion(),
      update: updateRuntime.coordinator,
      nextSessionAt: (automationId) => appContext.automation.nextRunAt(automationId),
      sessionProgress: (automationId) => appContext.sessionProgress(automationId),
      lastWarm: () => appContext.lastWarm(),
      sessionLogTail: () => readTailLines(sessionLogPath, SESSION_LOG_TAIL_BYTES),
      diagnostics: () => appContext.diagnostics.recent(),
      previewDay: (dayStartMs) => appContext.previewDay(dayStartMs),
      openExtensionSetup,
      recoverExtensionSetup: () =>
        runExtensionRecovery({
          ...extensionSetupPorts(),
          resetPairing: () => appContext.resetExtensionPairing(),
        }),
      copyToClipboard: (text) => clipboard.writeText(text),
      configFile,
      transaction: (run) => {
        appContext.db.transaction(() => {
          run()
        })
      },
      clock: systemClock,
      limits: PROFILES[profile],
      newId: () => crypto.randomUUID(),
    }),
  )

  // `@2x` sits beside it under the same name minus the suffix, which is the
  // naming convention nativeImage uses to pick the sharper asset on a
  // high-DPI display on its own.
  tray = new Tray(nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'tray-icon.png')))
  tray.setToolTip(TEXT.app.title)
  refreshTray(context)
  showWindow()
  updateRuntime.start()
}).catch(reportFatalStartupError)

// Tray-resident: closing the window must not quit the app.
app.on('window-all-closed', () => {})

// A second launch means the operator wants the window of the app already running.
app.on('second-instance', showWindow)

app.on('before-quit', () => {
  void context?.shutdown()
})
