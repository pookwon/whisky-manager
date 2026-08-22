/**
 * Diagnostic probe. Boots the same bridge the app uses, waits for the extension
 * to pair, then fetches one cafe URL through the browser's logged-in session and
 * writes the decoded body to a file.
 *
 * The cafe's endpoints are private and undocumented, so the parsers in phase 3
 * are built against real captures rather than guesses. Run `pnpm build` first.
 *
 *   node scripts/probe.mjs <url> [outfile]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { createBridgeServer } from '../dist/desktop/ws/server.js'

const TOKEN_FILE = '.wm-probe-token'
const PORT = 39217
const PAIR_TIMEOUT_MS = 180_000
const PROBE_TIMEOUT_MS = 30_000

const [url, outFile = 'tests/fixtures/probe.txt'] = process.argv.slice(2)
if (url === undefined) {
  console.error('usage: node scripts/probe.mjs <url> [outfile]')
  process.exit(1)
}

const token = existsSync(TOKEN_FILE)
  ? readFileSync(TOKEN_FILE, 'utf8').trim()
  : (() => {
      const fresh = randomBytes(24).toString('base64url')
      writeFileSync(TOKEN_FILE, `${fresh}\n`)
      return fresh
    })()

const bridge = await createBridgeServer({ token, boundExtensionId: null, port: PORT })

console.log(`\n  페어링 토큰:  ${token}\n`)
console.log(`  확장 옵션 페이지에 위 토큰을 붙여넣으세요. (브릿지 포트 ${bridge.port})`)
console.log('  연결을 기다리는 중...\n')

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

console.log('연결됨. 요청을 보냅니다:', url)

try {
  const reply = await bridge.request({ type: 'PROBE', requestId: randomUUID(), url }, PROBE_TIMEOUT_MS)
  if (reply.type !== 'PROBE_RESULT') {
    console.error('예상치 못한 응답:', reply)
  } else if (reply.error !== null) {
    console.error(`실패: ${reply.error}`)
  } else {
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, reply.text)
    console.log(`\n  status       ${reply.status}`)
    console.log(`  content-type ${reply.contentType}`)
    console.log(`  ${reply.text.length}자 → ${outFile}\n`)
  }
} finally {
  await bridge.close()
}
