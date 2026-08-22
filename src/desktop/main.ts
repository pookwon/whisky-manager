import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage } from 'electron'
import { PROFILES } from '../shared/profiles.js'
import { WELCOME_AUTOMATION_ID, createAppContext, type AppContext } from './bootstrap.js'
import { IPC_CHANNELS, type RendererApi } from './ipc.js'
import { createRendererApi } from './rendererApi.js'
import { systemClock } from './runtime.js'

const BRIDGE_PORT = 39_217

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
      { label: '창 열기', click: showWindow },
      { type: 'separator' },
      {
        label: ctx.automation.isRunning() ? '자동화 중지' : '자동화 시작',
        click: () => {
          if (ctx.automation.isRunning()) ctx.automation.stop()
          else ctx.automation.start()
          refreshTray(ctx)
        },
      },
      {
        label: '전면 정지 (킬 스위치)',
        click: () => {
          ctx.automation.kill()
          refreshTray(ctx)
        },
      },
      { type: 'separator' },
      { label: '종료', role: 'quit' },
    ]),
  )
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
    // The tray label reads isRunning(); a self-halt must repaint it, or the
    // menu keeps claiming the automation is running after a logout.
    onHalt: () => {
      if (context !== null) refreshTray(context)
    },
  })

  registerIpc(
    createRendererApi({
      automationId: WELCOME_AUTOMATION_ID,
      repos: context.repos,
      settings: context.settings,
      bridge: context.bridge,
      automation: context.automation,
      lastOutcome: context.lastOutcome,
      clock: systemClock,
      limits: PROFILES[profile],
      newId: () => crypto.randomUUID(),
    }),
  )

  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('Whisky Manager')
  refreshTray(context)
  showWindow()
})

// Tray-resident: closing the window must not quit the app.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  void context?.shutdown()
})
