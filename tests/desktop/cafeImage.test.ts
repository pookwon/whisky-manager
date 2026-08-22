import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getCafeImage } from '../../src/desktop/cafeImage.js'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSettingsRepo, type SettingsRepo } from '../../src/desktop/db/settingsRepo.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'
import { FakeClock } from '../fakes.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000
const CAFE_URL_NAME = 'examplecafe'

let dir: string
let db: AppDatabase
let settings: SettingsRepo

function transport(reply: (message: AppMessage) => ExtensionMessage, connected = true) {
  let calls = 0
  return {
    calls: () => calls,
    isConnected: () => connected,
    request(message: AppMessage): Promise<ExtensionMessage> {
      calls += 1
      return Promise.resolve(reply(message))
    },
  }
}

function probeResult(requestId: string, text: string, error: string | null = null): ExtensionMessage {
  return { type: 'PROBE_RESULT', requestId, status: error === null ? 200 : 0, contentType: 'text/html', text, error }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-cafe-image-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  settings = createSettingsRepo(db)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('getCafeImage', () => {
  it('probes the cafe page and caches the extracted image url', async () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/cafe.jpg">'
    const fake = transport((m) => probeResult((m as { requestId: string }).requestId, html))
    const clock = new FakeClock(MON_10_00)

    const result = await getCafeImage(
      { transport: fake, settings, clock, newId: () => 'req-1' },
      CAFE_URL_NAME,
    )

    expect(result).toBe('https://cdn.example.com/cafe.jpg')
    expect(fake.calls()).toBe(1)
  })

  it('does not re-probe within the daily cache window', async () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/cafe.jpg">'
    const fake = transport((m) => probeResult((m as { requestId: string }).requestId, html))
    const clock = new FakeClock(MON_10_00)
    const deps = { transport: fake, settings, clock, newId: () => 'req-1' }

    await getCafeImage(deps, CAFE_URL_NAME)
    clock.set(MON_10_00 + DAY_MS - 1)
    const second = await getCafeImage(deps, CAFE_URL_NAME)

    expect(second).toBe('https://cdn.example.com/cafe.jpg')
    expect(fake.calls()).toBe(1)
  })

  it('probes again once the cache expires', async () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/cafe.jpg">'
    const fake = transport((m) => probeResult((m as { requestId: string }).requestId, html))
    const clock = new FakeClock(MON_10_00)
    const deps = { transport: fake, settings, clock, newId: () => 'req-1' }

    await getCafeImage(deps, CAFE_URL_NAME)
    clock.set(MON_10_00 + DAY_MS + 1)
    await getCafeImage(deps, CAFE_URL_NAME)

    expect(fake.calls()).toBe(2)
  })

  it('returns the stale cache and skips the probe when the bridge is disconnected', async () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/cafe.jpg">'
    const fake = transport((m) => probeResult((m as { requestId: string }).requestId, html))
    const clock = new FakeClock(MON_10_00)
    await getCafeImage({ transport: fake, settings, clock, newId: () => 'req-1' }, CAFE_URL_NAME)

    clock.set(MON_10_00 + DAY_MS + 1)
    const disconnected = transport(() => probeResult('unused', html), false)
    const result = await getCafeImage({ transport: disconnected, settings, clock, newId: () => 'req-2' }, CAFE_URL_NAME)

    expect(result).toBe('https://cdn.example.com/cafe.jpg')
    expect(disconnected.calls()).toBe(0)
  })

  it('falls back to the cache when the probe errors, and does not hot-loop retries', async () => {
    const html = '<meta property="og:image" content="https://cdn.example.com/cafe.jpg">'
    const clock = new FakeClock(MON_10_00)
    const ok = transport((m) => probeResult((m as { requestId: string }).requestId, html))
    await getCafeImage({ transport: ok, settings, clock, newId: () => 'req-1' }, CAFE_URL_NAME)

    clock.set(MON_10_00 + DAY_MS + 1)
    const failing = transport((m) => probeResult((m as { requestId: string }).requestId, '', 'TIMEOUT'))
    const first = await getCafeImage({ transport: failing, settings, clock, newId: () => 'req-2' }, CAFE_URL_NAME)
    const second = await getCafeImage({ transport: failing, settings, clock, newId: () => 'req-3' }, CAFE_URL_NAME)

    expect(first).toBe('https://cdn.example.com/cafe.jpg')
    expect(second).toBe('https://cdn.example.com/cafe.jpg')
    expect(failing.calls()).toBe(1)
  })

  it('returns null when there is no cache and the page has no og:image', async () => {
    const fake = transport((m) => probeResult((m as { requestId: string }).requestId, '<html></html>'))
    const clock = new FakeClock(MON_10_00)

    const result = await getCafeImage({ transport: fake, settings, clock, newId: () => 'req-1' }, CAFE_URL_NAME)

    expect(result).toBeNull()
  })
})
