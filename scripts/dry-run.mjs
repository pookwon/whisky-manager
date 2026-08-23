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
 *   node scripts/dry-run.mjs [며칠 전]     # 인자를 주지 않으면 오늘
 */
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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

const PORT = 39217
const PAIR_TIMEOUT_MS = 900_000
const REPLY_TIMEOUT_MS = 60_000
const SOURCE = { cafeId: '10000000', boardId: '5' }
const DAY_MS = 86_400_000

/**
 * Which day to rehearse, counting back from today in KST. Rehearsing an earlier
 * day is how an operator checks the rule against a board that has already been
 * worked, rather than against whatever has been posted since midnight.
 */
const daysBack = Number(process.argv[2] ?? 0)
if (!Number.isInteger(daysBack) || daysBack < 0) {
  console.error(`며칠 전인지는 0 이상의 정수여야 합니다: ${process.argv[2]}`)
  process.exit(1)
}
const dayStart = kstDayStartMs(Date.now()) - daysBack * DAY_MS
const dayEnd = dayStart + DAY_MS

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

// Read from the app's settings before the bridge opens, so a misconfiguration
// stops the run instead of surfacing fifteen minutes into a pairing wait.
let operatorAccounts = []
let token = null
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
  // The app's own pairing token, not a separate one. A rehearsal with its own
  // token forces the operator to re-pair the extension to run it and again to
  // go back to the app, and a half-finished swap looks exactly like a bug.
  token = settingsRepo.get('pairingToken') ?? null

  if (operatorAccounts.length === 0) {
    console.error(
      '운영진 계정이 설정되지 않았습니다.\n' +
      '앱의 설정에서 운영진 계정을 먼저 설정하세요.',
    )
    process.exit(1)
  }

  if (token === null) {
    console.error('앱의 페어링 토큰이 없습니다. 앱을 한 번 실행해서 토큰을 만드세요.')
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

  const collected = await ask({
    type: 'COLLECT',
    automationId: 'welcome-comment',
    source: SOURCE,
    sincePostedAt: dayStart,
  })

  // Collection takes a floor and no ceiling, so rehearsing an earlier day drags
  // in everything since. Trimming to the day reproduces what a session running
  // that day actually had in hand — which matters for the earliest-post-per-
  // author rule, decided over exactly this set.
  const candidates = (collected.candidates ?? []).filter((c) => c.postedAt < dayEnd)
  console.log(`\n수집 ${candidates.length}건 (오래된 순)`)
  for (const c of candidates) {
    const when = new Date(c.postedAt).toLocaleString('ko-KR')
    console.log(`  ${c.postId}  ${when}  ${c.authorNickname}  ${JSON.stringify(c.bodyText).slice(0, 44)}`)
  }

  // Determine which posts are first by author
  const firstPosts = firstPostIdByAuthor(candidates)

  const dayLabel = new Date(dayStart).toLocaleDateString('ko-KR')
  console.log(`\n판정 — ${dayLabel} 기준 (안내 댓글 없음 + 작성자의 최초 글):`)
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
