/**
 * Read-only rehearsal against the live cafe.
 *
 * Runs the three calls a session makes before it writes anything — login,
 * collect, comment check — and prints what came back. It never sends EXECUTE,
 * so no comment is ever posted. Run `pnpm build` first.
 *
 *   node scripts/dry-run.mjs [sincePostId]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { createBridgeServer } from '../dist/desktop/ws/server.js'

const TOKEN_FILE = '.wm-probe-token'
const PORT = 39217
const PAIR_TIMEOUT_MS = 900_000
const REPLY_TIMEOUT_MS = 60_000
const SOURCE = { cafeId: '10000000', boardId: '5' }

const sincePostId = process.argv[2] ?? null

const token = existsSync(TOKEN_FILE)
  ? readFileSync(TOKEN_FILE, 'utf8').trim()
  : (() => {
      const fresh = randomBytes(24).toString('base64url')
      writeFileSync(TOKEN_FILE, `${fresh}\n`)
      return fresh
    })()

const bridge = await createBridgeServer({ token, boundExtensionId: null, port: PORT })
console.log(`\n  페어링 토큰: ${token}\n  확장 연결을 기다리는 중...\n`)

const connected = await new Promise((resolve) => {
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

if (!connected) {
  console.error('확장이 연결되지 않았습니다.')
  await bridge.close()
  process.exit(1)
}

const ask = (message) => bridge.request({ ...message, requestId: randomUUID() }, REPLY_TIMEOUT_MS)

try {
  const login = await ask({ type: 'CHECK_LOGIN', source: SOURCE })
  console.log('로그인:', login.loggedIn ? `${login.account} 로 로그인됨` : '미로그인')
  if (!login.loggedIn) throw new Error('로그인되지 않아 중단합니다')

  const collected = await ask({
    type: 'COLLECT',
    automationId: 'welcome-comment',
    source: SOURCE,
    sincePostId,
  })
  const candidates = collected.candidates ?? []
  console.log(`\n수집 ${candidates.length}건 (오래된 순, sincePostId=${sincePostId ?? '없음'})`)
  for (const c of candidates) {
    const when = new Date(c.postedAt).toLocaleString('ko-KR')
    console.log(`  ${c.postId}  ${when}  ${c.authorNickname}  ${JSON.stringify(c.bodyText).slice(0, 44)}`)
  }

  const sample = candidates.at(-1)
  if (sample !== undefined) {
    const seen = await ask({
      type: 'CHECK_COMMENTS',
      automationId: 'welcome-comment',
      action: { ...SOURCE, postId: sample.postId },
    })
    console.log(`\n${sample.postId}번 글의 기존 댓글:`, seen.authors)
  }

  console.log('\n실행(EXECUTE)은 보내지 않았습니다. 댓글이 달리지 않았습니다.\n')
} catch (error) {
  console.error('실패:', error.message)
} finally {
  await bridge.close()
}
