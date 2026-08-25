import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, Tray, app, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { PROFILES } from '../shared/profiles.js'
import { TEXT } from '../shared/text.js'
import { WELCOME_AUTOMATION_ID, createAppContext, type AppContext } from './bootstrap.js'
import { openChrome, systemChromeHost } from './chromeLauncher.js'
import { stageExtension } from './extensionBundle.js'
import { runExtensionSetup, type ExtensionSetupResult } from './extensionSetup.js'
import { IPC_CHANNELS, type RendererApi } from './ipc.js'
import { readLocalConfig } from './localConfig.js'
import { createRendererApi } from './rendererApi.js'
import { systemClock } from './runtime.js'

const BRIDGE_PORT = 39_217

/**
 * Where the extension is unpacked to, beside the database rather than inside
 * the app bundle. Chrome cannot read an unpacked extension out of `app.asar`,
 * and it identifies one by its path — so this has to be a real directory, and
 * the same real directory on every run.
 */
const STAGED_EXTENSION_DIRNAME = 'chrome-extension'

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
      { label: TEXT.tray.quit, role: 'quit' },
    ]),
  )
}

/**
 * The first-run guide's one press, wired to the shell it needs. The steps
 * themselves live in `extensionSetup`; what is here is only which Electron and
 * OS facility each of them is.
 */
function openExtensionSetup(): ExtensionSetupResult {
  return runExtensionSetup({
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
  })
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

void app.whenReady().then(async () => {
  // Only the installed build registers itself to start with the machine. A dev
  // run must not leave a login item pointing at a temporary electron binary.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
  }

  const profile = app.isPackaged ? 'production' : 'debug'
  context = await createAppContext({
    databasePath: join(app.getPath('userData'), 'whisky-manager.db'),
    migrationsFolder: join(app.getAppPath(), 'drizzle'),
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
  })

  const appContext = context
  registerIpc(
    createRendererApi({
      repos: appContext.repos,
      settings: appContext.settings,
      bridge: appContext.bridge,
      automation: appContext.automation,
      // Only one automation has a runtime, so its outcome is the only one there
      // is to report. When a second runtime appears this becomes a lookup.
      lastOutcome: (automationId) =>
        automationId === WELCOME_AUTOMATION_ID ? appContext.lastOutcome() : null,
      lastOutcomeAt: () => appContext.lastOutcomeAt(),
      getStartupPreview: () => appContext.getStartupPreview(),
      getDayPreview: () => appContext.getDayPreview(),
      lastBridgeConnectedAt: () => appContext.lastBridgeConnectedAt(),
      nextSessionAt: () => appContext.automation.nextRunAt(),
      sessionProgress: () => appContext.sessionProgress(),
      lastWarm: () => appContext.lastWarm(),
      previewDay: (dayStartMs) => appContext.previewDay(dayStartMs),
      openExtensionSetup,
      copyToClipboard: (text) => clipboard.writeText(text),
      clock: systemClock,
      limits: PROFILES[profile],
      newId: () => crypto.randomUUID(),
    }),
  )

  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip(TEXT.app.title)
  refreshTray(context)
  showWindow()
}).catch(reportFatalStartupError)

// Tray-resident: closing the window must not quit the app.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  void context?.shutdown()
})
