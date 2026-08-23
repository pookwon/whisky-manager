/**
 * Posts exactly one comment, through the same path a session uses.
 *
 * It picks the oldest greeting no operator has answered yet — the same choice
 * the automation would make — and stops after a single execute. Anything
 * unexpected aborts before writing. Run `pnpm build` first.
 *
 *   node scripts/execute-once.mjs "가입을 환영합니다."
 */
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createBridgeServer } from '../dist/desktop/ws/server.js'
import { containsOperator } from '../dist/shared/guards.js'
import { kstDayStartMs } from '../dist/shared/kst.js'

const TOKEN_FILE = '.wm-probe-token'
const PORT = 39217
const PAIR_TIMEOUT_MS = 900_000
const REPLY_TIMEOUT_MS = 60_000
const DB_PATH = join(homedir(), 'Library/Application Support/whisky-manager/whisky-manager.db')

const content = process.argv[2]
if (content === undefined || content.trim() === '') {
  console.error('usage: node scripts/execute-once.mjs "<댓글 내용>"')
  process.exit(1)
}

const db = new Database(DB_PATH, { readonly: true })
const setting = (key) => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value
const source = { cafeId: setting('cafeId'), boardId: setting('boardId') }
const operatorAccounts = JSON.parse(setting('operatorAccounts') ?? '[]')
db.close()

console.log(`\n  대상 게시판: 카페 ${source.cafeId} / 게시판 ${source.boardId}`)
console.log(`  운영진 계정: ${operatorAccounts.length}개 등록됨`)
console.log(`  보낼 문구:   ${JSON.stringify(content)}\n`)

if (!existsSync(TOKEN_FILE)) {
  console.error('페어링 토큰이 없습니다. 먼저 dry-run 이나 probe 를 한 번 실행하세요.')
  process.exit(1)
}

const bridge = await createBridgeServer({
  token: readFileSync(TOKEN_FILE, 'utf8').trim(),
  boundExtensionId: null,
  port: PORT,
})
console.log('확장 연결을 기다리는 중...')

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
const automationId = 'welcome-comment'

try {
  const login = await ask({ type: 'CHECK_LOGIN', source })
  if (!login.loggedIn) throw new Error('로그인되어 있지 않습니다')
  console.log(`로그인: ${login.account}\n`)

  const { candidates = [] } = await ask({
    type: 'COLLECT',
    automationId,
    source,
    // Today only. Without a floor the walk runs back through the board's whole
    // history, and this script writes to the oldest unanswered post it finds.
    sincePostedAt: kstDayStartMs(Date.now()),
  })
  if (candidates.length === 0) throw new Error('수집된 글이 없습니다')

  let target = null
  for (const candidate of candidates) {
    const { authors } = await ask({
      type: 'CHECK_COMMENTS',
      automationId,
      action: { ...source, postId: candidate.postId },
    })
    if (authors === null) {
      console.log(`  ${candidate.postId} 댓글 확인 실패 — 건너뜀`)
      continue
    }
    if (containsOperator(authors, operatorAccounts)) {
      console.log(`  ${candidate.postId} 이미 운영진이 인사함 — 건너뜀`)
      continue
    }
    target = candidate
    break
  }

  if (target === null) throw new Error('아직 인사하지 않은 글을 찾지 못했습니다')

  console.log(`\n대상: ${target.postId}번  작성자 ${target.authorNickname}`)
  console.log(`보낼 내용: ${JSON.stringify(content)}\n실행합니다...\n`)

  const result = await ask({
    type: 'EXECUTE',
    automationId,
    action: { ...source, postId: target.postId, body: content },
  })

  console.log('결과:', result.ok ? '성공' : `실패 (${result.error})`)
  console.log('실행 후 댓글:', result.commentAuthors)
  if (result.diagnostic) console.log('\n서버 응답:', result.diagnostic)
  console.log('\n1건만 실행하고 종료합니다.\n')
} catch (error) {
  console.error('중단:', error.message)
} finally {
  await bridge.close()
}
