/**
 * Read-only rehearsal against the live cafe.
 *
 * Runs the calls a session makes before it writes anything — login, collect,
 * member list, comment check — then prints the verdict each candidate would
 * get. It never sends EXECUTE, so no comment is ever posted. The members table
 * is held in memory, so the app's database is not touched either.
 *
 * Run `pnpm build` first.
 *
 *   node scripts/dry-run.mjs [sincePostId]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { createBridgeServer } from '../dist/desktop/ws/server.js'
import { kstDayStartMs } from '../dist/shared/kst.js'
import { createMembershipResolver } from '../dist/desktop/membership.js'
import { newMemberGuard } from '../dist/shared/automations/welcome-comment/newMember.js'

const TOKEN_FILE = '.wm-probe-token'
const PORT = 39217
const PAIR_TIMEOUT_MS = 900_000
const REPLY_TIMEOUT_MS = 60_000
const SOURCE = { cafeId: '10000000', boardId: '5' }

const sincePostId = process.argv[2] ?? null
const WINDOW_DAYS = 3

/**
 * Stands in for the sqlite members table. A rehearsal must not write to the
 * app's database, and starting empty also mirrors what a fresh install sees.
 */
function memoryMembersRepo() {
  const rows = new Map()
  return {
    joinDateOf: (_cafeId, memberKey) => rows.get(memberKey) ?? null,
    upsertMany: (_cafeId, batch) => {
      for (const member of batch) rows.set(member.memberKey, member.joinDate)
    },
    isEmpty: () => rows.size === 0,
    prune: (_cafeId, oldest) => {
      for (const [key, joinDate] of rows) if (joinDate < oldest) rows.delete(key)
    },
    size: () => rows.size,
  }
}

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
    // Mirrors a session with no watermark: reach back to the start of today.
    sincePostedAt: sincePostId === null ? kstDayStartMs(Date.now()) : null,
  })
  const candidates = collected.candidates ?? []
  console.log(`\n수집 ${candidates.length}건 (오래된 순, sincePostId=${sincePostId ?? '없음'})`)
  for (const c of candidates) {
    const when = new Date(c.postedAt).toLocaleString('ko-KR')
    console.log(`  ${c.postId}  ${when}  ${c.authorNickname}  ${JSON.stringify(c.bodyText).slice(0, 44)}`)
  }

  const repo = memoryMembersRepo()
  const resolve = await createMembershipResolver({
    transport: bridge,
    repo,
    cafeId: SOURCE.cafeId,
    windowDays: WINDOW_DAYS,
    nowMs: Date.now(),
    newRequestId: () => randomUUID(),
  })
  console.log(`\n가입자 표: ${repo.size()}명 적재 (판정 창 ${WINDOW_DAYS}일을 덮을 때까지)`)

  console.log(`\n판정 (창 ${WINDOW_DAYS}일):`)
  for (const c of candidates) {
    const membership = resolve(c)
    if (membership === 'DEFER') {
      console.log(`  ${c.postId}  보류 — 멤버 목록을 읽지 못해 이번 세션에서는 판정 불가`)
      continue
    }
    const outcome = newMemberGuard(
      { automationId: 'welcome-comment', ...SOURCE, ...c },
      {
        nowMs: Date.now(),
        operatorAccounts: [],
        existingCommentAuthors: [],
        authorMembership: membership,
        newMemberWindowDays: WINDOW_DAYS,
      },
    )
    const verdict = outcome === null ? '환영 대상' : `${outcome.kind} ${outcome.reason ?? outcome.flag}`
    const known = membership.kind === 'JOINED' ? `가입 ${membership.joinDate}` : '표에 없음'
    console.log(`  ${c.postId}  ${c.authorNickname}  ${known}  →  ${verdict}`)
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
