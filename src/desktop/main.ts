import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import { createAppContext, type AppContext } from './bootstrap.js'

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
      webPreferences: {
        preload: fileURLToPath(new URL('preload.js', import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    window.on('closed', () => {
      window = null
    })
    // The renderer bundle lands in plan C2; an empty window is expected until then.
    void window.loadFile(join(app.getAppPath(), 'dist/renderer/index.html')).catch(() => {})
  }
  window.show()
}

function refreshTray(ctx: AppContext): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: '창 열기', click: showWindow },
      { type: 'separator' },
      {
        label: ctx.loop.isRunning() ? '자동화 중지' : '자동화 시작',
        click: () => {
          if (ctx.loop.isRunning()) ctx.loop.stop()
          else ctx.loop.start()
          refreshTray(ctx)
        },
      },
      {
        label: '전면 정지 (킬 스위치)',
        click: () => {
          ctx.loop.stop()
          refreshTray(ctx)
        },
      },
      { type: 'separator' },
      { label: '종료', role: 'quit' },
    ]),
  )
}

void app.whenReady().then(async () => {
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })

  context = await createAppContext({
    databasePath: join(app.getPath('userData'), 'whisky-manager.db'),
    migrationsFolder: join(app.getAppPath(), 'drizzle'),
    profile: app.isPackaged ? 'production' : 'debug',
    bridgePort: BRIDGE_PORT,
  })

  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('Whisky Manager')
  refreshTray(context)
})

// Tray-resident: closing the window must not quit the app.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  void context?.shutdown()
})
