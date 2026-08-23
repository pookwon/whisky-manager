/**
 * Read-only rehearsal against the live cafe.
 *
 * Runs the calls a session makes before it writes anything — login, collect,
 * comment check — then prints the verdict each candidate would get using the
 * exact same guards the production code uses: operatorAlreadyCommentedGuard
 * and firstPostOnlyGuard.
 *
 * It never sends EXECUTE, so no comment is ever posted.
 *
 * Run `pnpm build` first.
 *
 *   node scripts/dry-run.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { createBridgeServer } from '../dist/desktop/ws/server.js'
import { kstDayStartMs } from '../dist/shared/kst.js'
import { openDatabase } from '../dist/desktop/db/client.js'
import { createSettingsRepo } from '../dist/desktop/db/settingsRepo.js'
import { parseOperatorAccounts } from '../dist/desktop/session.js'
import { evaluateGuards, operatorAlreadyCommentedGuard } from '../dist/shared/guards.js'
import { firstPostOnlyGuard } from '../dist/shared/automations/welcome-comment/firstPost.js'
import { firstPostIdByAuthor } from '../dist/desktop/orchestrator.js'

const TOKEN_FILE = '.wm-probe-token'
const PORT = 39217
const PAIR_TIMEOUT_MS = 900_000
const REPLY_TIMEOUT_MS = 60_000
const SOURCE = { cafeId: '10000000', boardId: '5' }

/**
 * Resolve the database path where the Electron app stores settings.
 * On different platforms, Electron stores userData in different locations.
 */
function getUserDataPath() {
  const home = homedir()
  switch (platform()) {
    case 'darwin': // macOS
      return join(home, 'Library', 'Application Support', 'whisky-manager')
    case 'linux':
      return join(home, '.config', 'whisky-manager')
    case 'win32': // Windows
      const appData = process.env.APPDATA
      if (appData) return join(appData, 'whisky-manager')
      return join(home, 'AppData', 'Roaming', 'whisky-manager')
    default:
      throw new Error(`Unsupported platform: ${platform()}`)
  }
}

const token = existsSync(TOKEN_FILE)
  ? readFileSync(TOKEN_FILE, 'utf8').trim()
  : (() => {
      const fresh = randomBytes(24).toString('base64url')
      writeFileSync(TOKEN_FILE, `${fresh}\n`)
      return fresh
    })()

// Load operator accounts from the app's settings database BEFORE bridge
let operatorAccounts = []
try {
  const userDataPath = getUserDataPath()
  const dbPath = join(userDataPath, 'whisky-manager.db')

  if (!existsSync(dbPath)) {
    console.error(
      `앱 데이터베이스를 찾을 수 없습니다: ${dbPath}\n` +
      `앱을 먼저 실행해서 설정을 저장하세요.`,
    )
    process.exit(1)
  }

  // No migrations folder: opening with one would run pending migrations against
  // the operator's live database, which a read-only rehearsal must never do.
  const db = openDatabase(dbPath)
  const settingsRepo = createSettingsRepo(db)
  // The app's own reader, so the rehearsal cannot disagree with it about who
  // counts as an operator.
  operatorAccounts = parseOperatorAccounts(settingsRepo.get('operatorAccounts'))

  if (operatorAccounts.length === 0) {
    console.error(
      '운영진 계정이 설정되지 않았습니다.\n' +
      '앱의 설정에서 운영진 계정을 먼저 설정하세요.',
    )
    process.exit(1)
  }

  console.log(`운영진 계정: ${operatorAccounts.join(', ')}`)
} catch (error) {
  console.error('설정 로드 실패:', error.message)
  process.exit(1)
}

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

  // Check login
  const login = await ask({ type: 'CHECK_LOGIN', source: SOURCE })
  console.log('로그인:', login.loggedIn ? `${login.account} 로 로그인됨` : '미로그인')
  if (!login.loggedIn) throw new Error('로그인되지 않아 중단합니다')

  // Collect candidates
  const collected = await ask({
    type: 'COLLECT',
    automationId: 'welcome-comment',
    source: SOURCE,
    // Reach back to the start of today
    sincePostedAt: kstDayStartMs(Date.now()),
  })
  const candidates = collected.candidates ?? []
  console.log(`\n수집 ${candidates.length}건 (오래된 순)`)
  for (const c of candidates) {
    const when = new Date(c.postedAt).toLocaleString('ko-KR')
    console.log(`  ${c.postId}  ${when}  ${c.authorNickname}  ${JSON.stringify(c.bodyText).slice(0, 44)}`)
  }

  // Determine which posts are first by author
  const firstPosts = firstPostIdByAuthor(candidates)

  console.log(`\n판정 (규칙: 안내 댓글 없음 + 작성자의 최초 글):`)
  for (const c of candidates) {
    const isFirstPost = firstPosts.get(c.authorId) === c.postId

    const evaluation = evaluateGuards(
      [operatorAlreadyCommentedGuard, firstPostOnlyGuard],
      c,
      {
        nowMs: Date.now(),
        operatorAccounts,
        existingCommentAuthors: c.existingCommentAuthors,
        isFirstPostByAuthor: isFirstPost,
      },
    )

    if (evaluation.skip) {
      console.log(`  ${c.postId}  ${c.authorNickname}  →  스킵: ${evaluation.skip}`)
    } else if (evaluation.flags.length > 0) {
      console.log(`  ${c.postId}  ${c.authorNickname}  →  위험 신호: ${evaluation.flags.join(', ')}`)
    } else {
      console.log(`  ${c.postId}  ${c.authorNickname}  →  환영 대상`)
    }
  }

  // Check comments on sample post
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
