/**
 * Runs one real session through the whole app — settings, templates, dedupe,
 * guards, policy, database, watermark — not just the bridge.
 *
 * The automation's policy decides whether anything is written. Run it with the
 * policy on MANUAL to exercise every stage while the cafe stays untouched: each
 * candidate lands in the approval queue instead of being posted.
 *
 *   node scripts/session-once.mjs
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createAppContext, WELCOME_AUTOMATION_ID } from '../dist/desktop/bootstrap.js'

const USER_DATA = join(homedir(), 'Library/Application Support/whisky-manager')
const DB_PATH = join(USER_DATA, 'whisky-manager.db')

const before = new Database(DB_PATH, { readonly: true })
const policy = before.prepare('SELECT policy, enabled FROM automation_settings WHERE automation_id = ?').get(WELCOME_AUTOMATION_ID)
const templates = before.prepare('SELECT id, body FROM templates WHERE automation_id = ? AND enabled = 1').all(WELCOME_AUTOMATION_ID)
before.close()

console.log(`\n  정책: ${policy?.policy}   활성: ${policy?.enabled ? '켜짐' : '꺼짐'}`)
console.log(`  문구: ${templates.map((t) => JSON.stringify(t.body)).join(', ') || '없음'}\n`)

if (policy?.policy !== 'MANUAL') {
  console.error('안전을 위해 정책이 MANUAL 일 때만 실행합니다. 지금은', policy?.policy)
  process.exit(1)
}

const context = await createAppContext({
  databasePath: DB_PATH,
  migrationsFolder: 'drizzle',
  profile: 'debug',
  bridgePort: 39217,
})

console.log('확장 연결을 기다리는 중...')
const connected = await new Promise((resolve) => {
  const deadline = Date.now() + 900_000
  const poll = setInterval(() => {
    if (context.bridge.isConnected()) {
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
  await context.shutdown()
  process.exit(1)
}

console.log('연결됨. 세션을 한 번 실행합니다...\n')
await context.automation.runOnce()
console.log('세션 결과:', context.lastOutcome())

const rows = context.db.$client
  .prepare(
    `SELECT target_post_id, status, reason, risk_flags, rendered_text, target_author
     FROM executions WHERE automation_id = ? ORDER BY target_post_id`,
  )
  .all(WELCOME_AUTOMATION_ID)

console.log(`\n기록된 처리 ${rows.length}건`)
for (const row of rows) {
  console.log(
    `  ${row.target_post_id}  ${row.status.padEnd(18)} ${row.target_author ?? '-'}  ` +
      `${JSON.stringify(row.rendered_text)}  ${row.reason ?? ''} ${row.risk_flags}`,
  )
}

const watermark = context.db.$client
  .prepare('SELECT last_seen_post_id FROM watermarks WHERE automation_id = ?')
  .get(WELCOME_AUTOMATION_ID)
console.log('\n워터마크:', watermark?.last_seen_post_id ?? '없음')

await context.shutdown()
console.log('\n카페에는 아무것도 쓰지 않았습니다 (정책 MANUAL).\n')
