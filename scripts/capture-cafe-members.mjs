/**
 * Captures one Phase 0 member-list response through the extension's logged-in
 * session. The raw body exists only in memory: this script parses, sanitizes,
 * and writes the resulting fixture atomically with create-only permissions.
 *
 * Run `pnpm capture:cafe-members -- <page>` after quitting Whisky Manager,
 * because the app owns the same localhost bridge port while it is running.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBridgeServer } from '../dist/desktop/ws/server.js'
import {
  cafeMemberListUrl,
  isCafeMemberListTarget,
  sanitizeCafeArticleFixtureText,
} from '../dist/shared/cafeMemberFixture.js'

const PORT = 39217
const PAIR_TIMEOUT_MS = 900_000
const PROBE_TIMEOUT_MS = 30_000
const TOKEN_FILE = '.wm-probe-token'
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURES_DIRECTORY = resolve(REPOSITORY_ROOT, 'tests/fixtures')

function pageFromArgs(args) {
  const normalized = args[0] === '--' ? args.slice(1) : args
  if (normalized.length !== 1 || !/^[1-9]\d*$/.test(normalized[0] ?? '')) {
    throw new Error('usage: pnpm capture:cafe-members -- <positive-page-number>')
  }
  const page = Number(normalized[0])
  if (!Number.isSafeInteger(page)) throw new Error('page must be a positive safe integer')
  return page
}

function token() {
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim()
  const fresh = randomBytes(24).toString('base64url')
  writeFileSync(TOKEN_FILE, `${fresh}\n`, { mode: 0o600 })
  return fresh
}

async function waitForExtension(bridge) {
  return new Promise((resolve) => {
    const deadline = Date.now() + PAIR_TIMEOUT_MS
    const poll = setInterval(() => {
      if (bridge.isConnected()) {
        clearInterval(poll)
        resolve(true)
      } else if (Date.now() > deadline) {
        clearInterval(poll)
        resolve(false)
      }
    }, 250)
  })
}

async function main() {
  const page = pageFromArgs(process.argv.slice(2))
  const url = cafeMemberListUrl(page)
  if (!isCafeMemberListTarget(url)) throw new Error('internal error: unsafe member-list target')

  const output = resolve(FIXTURES_DIRECTORY, `cafe-member-list-page-${page}.json`)
  if (dirname(output) !== FIXTURES_DIRECTORY) throw new Error('internal error: fixture path escaped tests/fixtures')
  if (existsSync(output)) throw new Error(`refusing to overwrite existing fixture: ${output}`)

  let bridge
  try {
    bridge = await createBridgeServer({ token: token(), boundExtensionId: null, port: PORT })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
      throw new Error('bridge port 39217 is in use; quit Whisky Manager normally before capturing')
    }
    throw error
  }

  try {
    console.log(`확장 옵션에 이 페어링 토큰을 붙여넣으세요: ${token()}`)
    console.log('로그인된 확장 연결을 기다리는 중...')
    if (!(await waitForExtension(bridge))) throw new Error('extension did not connect before the pairing timeout')

    const reply = await bridge.request(
      { type: 'PROBE', requestId: randomUUID(), url },
      PROBE_TIMEOUT_MS,
    )
    if (reply.type !== 'PROBE_RESULT' || reply.error !== null || reply.status < 200 || reply.status >= 300) {
      throw new Error('member-list request failed; no fixture was written')
    }

    // Do not log or persist reply.text. This is the only point at which the raw
    // response is handled, and the serializer removes sensitive values first.
    const fixture = sanitizeCafeArticleFixtureText(reply.text)
    mkdirSync(FIXTURES_DIRECTORY, { recursive: true })
    writeFileSync(output, fixture, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    console.log(`익명화 fixture 저장 완료: ${output}`)
  } finally {
    await bridge.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'capture failed')
  process.exitCode = 1
})
