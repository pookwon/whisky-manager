import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WELCOME_AUTOMATION_ID, createAppContext, type AppContext } from '../../src/desktop/bootstrap.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))

let dir: string
let ctx: AppContext

function options(path: string) {
  return { databasePath: path, migrationsFolder: MIGRATIONS, profile: 'debug' as const, bridgePort: 0 }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wm-boot-'))
  ctx = await createAppContext(options(join(dir, 'app.db')))
})

afterEach(async () => {
  await ctx.shutdown()
  rmSync(dir, { recursive: true, force: true })
})

describe('createAppContext', () => {
  it('generates a pairing token on first run and reuses it afterwards', async () => {
    const first = ctx.settings.get('pairingToken')
    expect(first).toBeDefined()
    expect(first?.length).toBeGreaterThanOrEqual(32)

    await ctx.shutdown()
    const again = await createAppContext(options(join(dir, 'app.db')))
    expect(again.settings.get('pairingToken')).toBe(first)
    await again.shutdown()
  })

  it('seeds the welcome automation disabled so nothing posts before review', () => {
    expect(ctx.repos.automationSettings.get(WELCOME_AUTOMATION_ID)).toMatchObject({
      policy: 'AUTO',
      enabled: false,
    })
  })

  it('does not start the loop on its own', () => {
    expect(ctx.loop.isRunning()).toBe(false)
  })

  it('listens on a bridge port', () => {
    expect(ctx.bridge.port).toBeGreaterThan(0)
  })

  it('exposes repositories wired to the same database', async () => {
    const id = await ctx.repos.dedupe.claim({
      automationId: WELCOME_AUTOMATION_ID,
      cafeId: '10000000',
      boardId: '5',
      postId: '1001',
      title: null,
      authorNickname: 'nick',
      authorId: 'm1',
      postedAt: 1,
      detectedAt: 1,
    })
    expect(id).not.toBeNull()
    expect(ctx.repos.executions.getById(id!)?.targetPostId).toBe('1001')
  })
})
