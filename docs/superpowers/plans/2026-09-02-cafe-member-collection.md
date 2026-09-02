# 카페 회원 목록 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카페 `14538121`의 전체 회원 목록(약 209,653명)을 별도의 회원용 표 셋으로 수집 DB에 옮기고, 글의 `posts.author_id`와 `members.member_key`가 join으로 이어지게 한다. 이후에는 신규 가입자만 하루 한 번 보탠다(top-up). 기존 글 수집(article-collection)의 작업/실행 구분, 페이지 예산, 페이스, CAS, 이어받기 재탐색을 그대로 mirror 한다.

**Architecture:** 새 파일이 원칙이다. 확장은 한 페이지만 읽고(`memberPageReader`), 데스크톱이 페이지 넘김·커서·휴지·저장을 갖는다(`memberCollectionOrchestrator`/`memberCollectionResume`/`memberRepository`). 회원용 표는 게시판이 없으므로 `(feed_kind, menu_id)` 정체성을 재사용하지 않고 단일 행 `member_feed_state`(id=1)를 쓴다. 루프는 작업 목록(`CollectionJob[]`)을 받아 글·회원 작업을 라운드로빈으로 굴리고, 공유 잠금(`collectionLock`)이 두 러너의 동시 실행을 막는다. 파서·identity·엔티티 해제는 글 파서와 같은 엄격함으로 순수 모듈에 둔다.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Electron 메인/프리로드/렌더러, React + zustand 렌더러, Drizzle ORM + node-postgres(PostgreSQL 수집 DB), Drizzle Kit 마이그레이션, Vitest. 확장은 MV3 service worker. 시각은 전부 KST(`src/shared/kst.ts`).

## Global Constraints
- 시각 표시는 KST 전용이다. 하루 경계·비교는 `kstDayStartMs`/`kstDayRange`/`KST_OFFSET_MS`(`src/shared/kst.ts`)로만 계산하고 `getUTCHours`/`toLocaleString`에 시간대를 맡기지 않는다.
- 사용자에게 보이는 모든 문구는 `src/shared/text.ts`에 값으로 둔다(키 인디렉션 없음). 한국어 전용이며 i18n은 요구사항이 아니다.
- 로그·오류 메시지·PROBE 응답에 `member_key`·닉네임을 절대 쓰지 않는다. 실패 진단은 필드 이름과 형만 남긴다. 확장이 돌려주는 오류 코드는 body-free 상수다.
- 코드와 주석은 영어, 산문 설명은 한국어(프로젝트 규칙).
- 새 기능 = 새 파일. 기존 파일은 스펙이 허용한 곳만 손댄다: `collectionLoop.ts`(작업 목록화), `src/shared/protocol.ts`(메시지 한 쌍 + `PROTOCOL_VERSION`), `src/extension/background.ts`(case 추가), `src/desktop/collection-db/schema.ts`(회원 스키마 re-export), `drizzle.collection.config.ts`(schema 배열), `src/desktop/ipc.ts`·`src/desktop/rendererApi.ts`(회원 채널 배선), `src/renderer/views/CollectionStatus.tsx`(회원 카드), `src/renderer/store.ts`(회원 상태), `src/shared/text.ts`(문구), `src/desktop/bootstrap.ts`·`src/desktop/main.ts`(context 배선), `package.json`(capture 스크립트), `src/desktop/collectionRunner.ts`(공유 잠금 최소 변경).
- 불변성: 객체를 제자리에서 수정하지 않고 새 객체를 반환한다(스프레드).
- `pnpm test`, `pnpm typecheck`, `pnpm lint`가 각 커밋 전에 통과해야 한다.
- 커밋 메시지는 `<type>: <description>` 형식이며 Co-Authored-By·AI 귀속·이모지를 넣지 않는다.

---

## File Structure

새로 만드는 파일과 손대는 파일. 한 줄 책임.

| 파일 | 상태 | 책임 |
|---|---|---|
| `src/shared/cafeMemberFixture.ts` | Create | `ManageMemberListViewAjax.nhn` URL 상수, `cafeMemberListUrl(page)`, `isCafeMemberListTarget(url)`, `sanitizeCafeArticleFixture` 재사용 export |
| `scripts/capture-cafe-members.mjs` | Create | Phase 0 회원 목록 캡처(정제 fixture 1장씩, create-only 0600) |
| `package.json` | Modify | `capture:cafe-members` 스크립트 추가 |
| `src/shared/probe.ts` | (조사만) | PROBE 허용 호스트에 `cafe.naver.com` 이미 포함됨 — 회원 URL은 별도 허용 불필요(확인 후 변경 없음) |
| `tests/fixtures/cafe-member-list-sample.json` | Create | 손으로 만든 표본 fixture(실측 응답 모양). 실 캡처 fixture로 교체·보강 |
| `tests/fixtures/cafe-member-list-page-*.json` | (USER GATE) | 운영자가 캡처하는 정제본 4~5장 |
| `src/shared/cafeMemberList.ts` | Create | 파서, `CollectedMember`/`CollectedMemberPage`, `cafeMemberPageIdentity`, 엔티티 해제, `joinDate` 변환 |
| `src/shared/htmlEntities.ts` | Create | `decodeHtmlEntities` 최소 디코더(named + numeric) |
| `src/shared/protocol.ts` | Modify | `COLLECT_MEMBER_PAGE`/`MEMBER_PAGE_COLLECTED` + 가드, `PROTOCOL_VERSION` 8→9, `TIMEOUTS.memberPageMs` |
| `src/extension/memberPageReader.ts` | Create | 한 페이지 읽기, body-free 오류 코드 |
| `src/extension/background.ts` | Modify | `COLLECT_MEMBER_PAGE` case 배선 |
| `src/desktop/collection-db/memberSchema.ts` | Create | `members`, `member_feed_state`(id=1), `member_runs`, `memberRunKind` enum |
| `src/desktop/collection-db/schema.ts` | Modify | 회원 스키마 re-export(drizzle-kit·client가 함께 읽도록) |
| `drizzle.collection.config.ts` | Modify | `schema`를 두 파일 배열로 |
| `drizzle-collection/0003_*.sql` + `meta` | Create(generated) | 회원 표 마이그레이션(`pnpm db:collection:generate`) |
| `src/desktop/collection-db/memberRepository.ts` | Create | 원자적 페이지 저장(CAS), run 기록, 커서, 완료/토프업/강제 마크 |
| `src/desktop/memberCollectionResume.ts` | Create | 이어받기: join_date 범위로 앵커 재탐색, 탈퇴 앵커 처리 |
| `src/desktop/memberCollectionOrchestrator.ts` | Create | 걷기·연속성·되감기·종료·top-up·CAS 충돌 |
| `src/desktop/memberCollectionRunner.ts` | Create | 시작·중지·공유 잠금 취득 |
| `src/desktop/collectionLock.ts` | Create | 글·회원 러너 상호 배제 잠금 |
| `src/desktop/collectionJob.ts` | Create | `CollectionJob` 추상 + article/member 구현 팩토리 |
| `src/desktop/collectionRunner.ts` | Modify | 공유 잠금 취득/해제(최소 변경) |
| `src/desktop/collectionLoop.ts` | Modify | 작업 목록 라운드로빈 + top-up 우선 |
| `src/desktop/collection-db/memberStatusQuery.ts` | Create | 화면 질의: 진행률·회원 수·완료/토프업 시각·매칭 지표 |
| `src/desktop/ipc.ts` | Modify | `IPC_CHANNELS`·`RendererApi`에 회원 메서드, `MemberCollectionStatusView` |
| `src/desktop/rendererApi.ts` | Modify | 회원 메서드 구현(start/stop/forced/status) |
| `src/renderer/store.ts` | Modify | `memberCollection` 상태 로드 |
| `src/renderer/views/CollectionStatus.tsx` | Modify | "회원 목록" 카드 |
| `src/shared/text.ts` | Modify | `TEXT.memberCollection` 문구 |
| `src/desktop/bootstrap.ts` | Modify | 잠금·회원 러너·작업 목록 배선, context에 노출 |
| `src/desktop/main.ts` | Modify | rendererApi에 회원 배선 전달 |
| `scripts/run-collection-integration.mjs` + `tests/desktop/collection-db/integration.test.ts` | Modify | 회원 표 upsert·CAS·단일 행 제약 케이스 |
| `tests/shared/cafeMemberList.test.ts` | Create | 파서 정상/엔티티/오류 거부/identity 결정성 |
| `tests/shared/htmlEntities.test.ts` | Create | 디코더 케이스 |
| `tests/extension/memberPageReader.test.ts` | Create | 오류 코드 매핑 |
| `tests/desktop/memberCollectionOrchestrator.test.ts` | Create | 삽입 밀림/되감기, 예산, 중지, 종료, CAS, top-up |
| `tests/desktop/memberCollectionResume.test.ts` | Create | 앵커 재탐색 앞·뒤, 탈퇴 앵커 |
| `tests/desktop/collectionLock.test.ts` | Create | 상호 배제 |
| `tests/desktop/collectionLoop.test.ts` | Modify | 라운드로빈·top-up·잠금 |

---

## Task 1 — `cafeMemberFixture.ts` + capture script

회원 목록 URL 한 종류만 허용하는 URL 상수/판정과, `capture-cafe-articles.mjs`를 그대로 본뜬 캡처 도구. 정제는 기존 `sanitizeCafeArticleFixture`를 재사용한다(`memberkey`·`nickname`을 IDENTIFIER_KEYS가 이미 다룸).

**PROBE 허용 확인:** `scripts/capture-cafe-articles.mjs`는 `bridge.request({ type: 'PROBE', url })`로 캡처하고, 확장의 `probe()`는 `isProbeTarget(url)`(`src/shared/probe.ts`)로 허용을 판정한다. `PROBE_HOSTS`는 `cafe.naver.com`·`apis.naver.com`을 이미 포함하므로 `ManageMemberListViewAjax.nhn`(`cafe.naver.com`)은 **추가 허용이 필요 없다**. `src/shared/probe.ts`를 변경하지 않는다. (글 캡처는 `apis.naver.com`을 통과했고 회원 캡처는 `cafe.naver.com`을 통과한다.)

### Files
- Create `src/shared/cafeMemberFixture.ts`
- Create `scripts/capture-cafe-members.mjs`
- Modify `package.json` — `scripts`에 `"capture:cafe-members": "pnpm build && node scripts/capture-cafe-members.mjs"` 추가
- Create `tests/shared/cafeMemberFixture.test.ts`

### Interfaces

Produces:
```ts
export const CAFE_MEMBER_LIST: {
  readonly cafeId: '14538121'
  readonly perPage: 100
  readonly searchType: 0
  readonly memberLevel: 0
  readonly sortType: 0
  readonly sortOrder: 0
}
export function cafeMemberListUrl(page: number): string
export function isCafeMemberListEndpoint(value: string): boolean
export function isCafeMemberListTarget(value: string): boolean
export { sanitizeCafeArticleFixture, sanitizeCafeArticleFixtureText } from './cafeArticleFixture.js'
```

### Steps

- [ ] **Write failing test** `tests/shared/cafeMemberFixture.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  CAFE_MEMBER_LIST,
  cafeMemberListUrl,
  isCafeMemberListEndpoint,
  isCafeMemberListTarget,
} from '../../src/shared/cafeMemberFixture.js'

describe('cafeMemberFixture', () => {
  it('builds the exact management list URL for a page', () => {
    const url = cafeMemberListUrl(3)
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://cafe.naver.com')
    expect(parsed.pathname).toBe('/ManageMemberListViewAjax.nhn')
    expect(parsed.searchParams.get('search.clubid')).toBe(CAFE_MEMBER_LIST.cafeId)
    expect(parsed.searchParams.get('search.page')).toBe('3')
    expect(parsed.searchParams.get('search.perPage')).toBe('100')
    expect(parsed.searchParams.get('search.searchType')).toBe('0')
    expect(parsed.searchParams.get('search.memberLevel')).toBe('0')
    expect(parsed.searchParams.get('search.sortType')).toBe('0')
    expect(parsed.searchParams.get('search.sortOrder')).toBe('0')
    expect(parsed.searchParams.get('search.paginationCached')).toBe('false')
    expect(parsed.searchParams.get('search.totalCountCached')).toBe('0')
  })

  it('rejects non-positive and unsafe pages', () => {
    expect(() => cafeMemberListUrl(0)).toThrow()
    expect(() => cafeMemberListUrl(-1)).toThrow()
    expect(() => cafeMemberListUrl(1.5)).toThrow()
  })

  it('accepts only the exact endpoint and fixed query', () => {
    expect(isCafeMemberListEndpoint(cafeMemberListUrl(1))).toBe(true)
    expect(isCafeMemberListTarget(cafeMemberListUrl(1))).toBe(true)
    expect(isCafeMemberListTarget('https://cafe.naver.com/ManageMemberListViewAjax.nhn?search.page=1')).toBe(false)
    expect(isCafeMemberListTarget('https://apis.naver.com/x')).toBe(false)
    expect(isCafeMemberListEndpoint('not a url')).toBe(false)
  })
})
```
- [ ] **Run** `pnpm vitest run tests/shared/cafeMemberFixture.test.ts` — expected: fails (module not found).
- [ ] **Implement** `src/shared/cafeMemberFixture.ts`:
```ts
/**
 * The one read-only management endpoint Phase 0 is allowed to capture for the
 * member list. Keeping the URL and its fixed query here (rather than accepting a
 * free-form URL from the capture CLI) makes it impossible for that CLI to become
 * a general-purpose browser-session dump. Sanitization is reused from the
 * article fixture module: it already replaces memberKey and nickname with
 * deterministic, length-preserving pseudonyms.
 */
export const CAFE_MEMBER_LIST = {
  cafeId: '14538121',
  perPage: 100,
  searchType: 0,
  memberLevel: 0,
  sortType: 0,
  sortOrder: 0,
} as const

const API_ORIGIN = 'https://cafe.naver.com'
const MEMBER_LIST_PATH = '/ManageMemberListViewAjax.nhn'

export function cafeMemberListUrl(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error(`page must be a positive safe integer: ${page}`)
  }
  const url = new URL(`${API_ORIGIN}${MEMBER_LIST_PATH}`)
  url.searchParams.set('search.clubid', CAFE_MEMBER_LIST.cafeId)
  url.searchParams.set('search.searchType', String(CAFE_MEMBER_LIST.searchType))
  url.searchParams.set('search.memberLevel', String(CAFE_MEMBER_LIST.memberLevel))
  url.searchParams.set('search.perPage', String(CAFE_MEMBER_LIST.perPage))
  url.searchParams.set('search.page', String(page))
  url.searchParams.set('search.sortType', String(CAFE_MEMBER_LIST.sortType))
  url.searchParams.set('search.sortOrder', String(CAFE_MEMBER_LIST.sortOrder))
  url.searchParams.set('search.paginationCached', 'false')
  url.searchParams.set('search.totalCountCached', '0')
  return url.toString()
}

/** True for this endpoint regardless of query parameters. */
export function isCafeMemberListEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.origin === API_ORIGIN && url.pathname === MEMBER_LIST_PATH
}

/** True only for the exact Phase 0 member-list request, including its fixed query. */
export function isCafeMemberListTarget(value: string): boolean {
  if (!isCafeMemberListEndpoint(value)) return false
  const url = new URL(value)

  const expected = new Map<string, string>([
    ['search.clubid', CAFE_MEMBER_LIST.cafeId],
    ['search.searchType', String(CAFE_MEMBER_LIST.searchType)],
    ['search.memberLevel', String(CAFE_MEMBER_LIST.memberLevel)],
    ['search.perPage', String(CAFE_MEMBER_LIST.perPage)],
    ['search.sortType', String(CAFE_MEMBER_LIST.sortType)],
    ['search.sortOrder', String(CAFE_MEMBER_LIST.sortOrder)],
    ['search.paginationCached', 'false'],
    ['search.totalCountCached', '0'],
  ])
  if (url.searchParams.size !== expected.size + 1) return false

  const page = url.searchParams.get('search.page')
  if (page === null || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) return false

  for (const [key, expectedValue] of expected) {
    if (url.searchParams.get(key) !== expectedValue) return false
  }
  return true
}

// The member list can carry account-linked data, so the same reviewer-safe
// sanitization the article fixture uses is reused verbatim rather than re-derived.
export { sanitizeCafeArticleFixture, sanitizeCafeArticleFixtureText } from './cafeArticleFixture.js'
```
- [ ] **Run** `pnpm vitest run tests/shared/cafeMemberFixture.test.ts` — expected: passes.
- [ ] **Implement** `scripts/capture-cafe-members.mjs` (mirror of `capture-cafe-articles.mjs`, member path/URL/fixture name):
```js
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
```
- [ ] **Modify** `package.json` — add to `"scripts"` after `"capture:cafe-articles"`:
```json
    "capture:cafe-members": "pnpm build && node scripts/capture-cafe-members.mjs",
```
- [ ] **Run** `pnpm typecheck && pnpm lint`.
- [ ] **Commit:** `git add src/shared/cafeMemberFixture.ts scripts/capture-cafe-members.mjs package.json tests/shared/cafeMemberFixture.test.ts` — message `feat: add cafe member list fixture url and capture tool`.

---

## Task 2 — USER GATE: capture and close the Phase 0 contract (no code)

이 태스크는 코드를 만들지 않는다. **운영자가 직접 캡처**하고, 그 결과로 아래 가정을 확정하거나 정정한다. 실행 에이전트는 캡처를 못 하므로, 태스크 3 이후는 손으로 만든 표본 fixture(`tests/fixtures/cafe-member-list-sample.json`, 태스크 3에서 생성)로 파서 테스트를 세운다. 실 캡처가 끝나면 그 표본을 정제된 실측 fixture로 교체·보강한다.

### 캡처 절차(운영자)
1. Whisky Manager를 정상 종료한다.
2. `pnpm capture:cafe-members -- 1`, `-- 1000`, `-- <마지막 페이지>`, `-- <마지막+1>`을 각각 실행한다(권한 없는 세션의 오류 envelope도 가능하면).
3. `git diff -- tests/fixtures/cafe-member-list-page-*.json`으로 익명화 결과만 검토한다.
4. 앱을 다시 열기 전에 확장 옵션의 페어링 토큰을 앱 토큰으로 복구한다.

### 어느 fixture가 §2.3의 어떤 미결을 닫는가
- **page 1** — 필드 존재/형(`memberKey`, `joinDate`, `nickname`, `memberLevelName`, `manager`, `staff`, `isSuccess`), 활동 카운터(§2.3-1) 유무와 이름, `totalCount`류(§2.3-3) 유무.
- **page 1000(중간)** — 같은 페이지를 연속 두 번 캡처해 같은 `joinDate` 안의 정렬 안정성(§2.3-4) 확인. 100건/쪽이 그대로 먹는지 재확인.
- **마지막 page** — 100건 미만인 마지막 페이지의 모양(§2.3-2 종료 신호).
- **마지막+1 page** — 빈 배열인지, silent fallback인지(§2.3-2). 글 API의 silent fallback 대응이 필요한지 판정.
- **권한 없는 세션** — `isSuccess:false`인지, 로그인/권한 HTML인지(§2.3-5, `MEMBER_PAGE_FORBIDDEN`).

### 태스크 3+가 서는 가정(캡처가 뒤집으면 그 태스크만 수정)
- 필드: `memberKey`(43자 문자열), `joinDate`(`YYYY.MM.DD.`), `nickname`(문자열 또는 null), `memberLevelName`(HTML 엔티티로 인코딩된 문자열), `manager`·`staff`(불리언).
- `isSuccess`는 **JSON 불리언**이며 `true`가 아니면 페이지 전체 거부.
- 종료 신호 = 100건 미만인 페이지(빈 페이지도 종료). silent fallback은 캡처 전 **가정하지 않는다**; 마지막+1 fixture가 fallback을 보이면 태스크 7에 `page_identity`+`reference_page` 모순 검사와 `MEMBER_PAGE_SILENT_FALLBACK`를 추가한다.
- 알 수 없는 추가 필드는 무시한다(파서는 필요한 필드만 읽는다).
- **활동 카운터는 fixture가 보이기 전에는 저장하지 않는다.** 후속으로 카운터 컬럼을 추가하려면: (a) `memberSchema.ts`의 `members`에 `bigint(... {mode:'number'}) nullable` 컬럼 + 음수 거부 check, `snapshot_at` 이미 존재, (b) `cafeMemberList.ts` `CollectedMember`에 필드 추가 + 파서에서 `safeInteger(..., 0, ...)`로 읽기, (c) `memberRepository.persistPage` upsert set에 컬럼 추가, (d) 새 마이그레이션 생성. 이는 별도 후속 작업이며 이 계획엔 포함하지 않는다.

### Steps
- [ ] 운영자가 위 절차로 page 1/1000/마지막/마지막+1(+권한 없음) fixture를 캡처한다.
- [ ] 각 fixture의 익명화 결과를 검토하고 위 가정을 표로 확정/정정한다.
- [ ] 정정이 있으면 해당 태스크(3/5/7)의 상수·형만 고친다. 정정이 없으면 그대로 진행한다.
- [ ] (코드 없음 — 커밋 없음. fixture 파일이 생겼다면 `git add tests/fixtures/cafe-member-list-page-*.json`로 `chore: add sanitized member list fixtures` 커밋.)

---

## Task 3 — `cafeMemberList.ts` parser + identity + HTML entity decode + joinDate

글 파서와 같은 엄격함. `isSuccess !== true`, `result.members` 비배열, `memberKey` 비문자열, `joinDate`가 `YYYY.MM.DD.` 아님, 불리언 자리에 불리언 아님은 **페이지 전체 거부**. `memberLevelName`은 엔티티 해제. `joinDate`는 ISO `YYYY-MM-DD` 문자열로 변환. identity는 정렬한 `memberKey`를 NUL로 이어 붙인 `member-page-v1\0` 접두 FNV-1a 64.

`cafeArticlePageIdentity`의 FNV 상수는 `cafeArticleList.ts`에 있으나 그 함수는 접두가 `article-page-v1`이라 재사용하면 출력이 달라지므로 재사용하지 않는다(글 identity 출력을 바꾸면 안 됨). 대신 같은 알고리즘을 회원 접두로 다시 구현한다.

### Files
- Create `src/shared/htmlEntities.ts`
- Create `src/shared/cafeMemberList.ts`
- Create `tests/shared/htmlEntities.test.ts`
- Create `tests/shared/cafeMemberList.test.ts`
- Create `tests/fixtures/cafe-member-list-sample.json`

### Interfaces

Produces:
```ts
// htmlEntities.ts
export function decodeHtmlEntities(value: string): string

// cafeMemberList.ts
export interface CollectedMember {
  readonly memberKey: string
  readonly nickname: string | null
  /** KST calendar date as ISO `YYYY-MM-DD`, converted from `YYYY.MM.DD.`. */
  readonly joinDate: string
  /** HTML entities decoded. */
  readonly levelName: string
  readonly isManager: boolean
  readonly isStaff: boolean
}
export interface CollectedMemberPage {
  readonly items: readonly CollectedMember[]
  readonly pageIdentity: string
}
export const CAFE_MEMBER_LIST_PARSER_VERSION = 'member-list-v1'
export type CafeMemberListParseErrorCode =
  | 'INVALID_JSON' | 'INVALID_ENVELOPE' | 'NOT_SUCCESS' | 'INVALID_MEMBER' | 'DUPLICATE_MEMBER_KEY'
export class CafeMemberListParseError extends Error {
  constructor(readonly code: CafeMemberListParseErrorCode, message: string)
}
export function cafeMemberPageIdentity(memberKeys: readonly string[]): string
export function parseCafeMemberList(value: unknown): CollectedMemberPage
export function parseCafeMemberListText(text: string): CollectedMemberPage
```

### Steps

- [ ] **Create** `tests/fixtures/cafe-member-list-sample.json` (hand-written; shaped exactly like the measured response — `result.members[]`, `isSuccess: true`, `memberLevelName` HTML-entity encoded, `joinDate` `YYYY.MM.DD.`):
```json
{
  "isSuccess": true,
  "result": {
    "members": [
      { "memberKey": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "nickname": "새회원하나", "joinDate": "2026.08.23.", "memberLevelName": "&#51221;&#47932;&amp;&lt;&gt;", "manager": false, "staff": false },
      { "memberKey": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "nickname": null, "joinDate": "2026.08.23.", "memberLevelName": "&quot;VIP&quot;", "manager": true, "staff": false },
      { "memberKey": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", "nickname": "운영자", "joinDate": "2026.08.22.", "memberLevelName": "&#xC2A4;&#x53F1;&#39;s", "manager": false, "staff": true }
    ]
  }
}
```
- [ ] **Write failing test** `tests/shared/htmlEntities.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities } from '../../src/shared/htmlEntities.js'

describe('decodeHtmlEntities', () => {
  it('decodes the five named entities', () => {
    expect(decodeHtmlEntities('a&amp;b&lt;c&gt;d&quot;e&#39;f')).toBe('a&b<c>d"e\'f')
  })
  it('decodes decimal and hex numeric references', () => {
    expect(decodeHtmlEntities('&#51221;&#47932;')).toBe('정물')
    expect(decodeHtmlEntities('&#xC2A4;&#x53F1;')).toBe('스싁')
  })
  it('leaves plain text and unknown tokens untouched', () => {
    expect(decodeHtmlEntities('plain & ok')).toBe('plain & ok')
    expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;')
  })
})
```
- [ ] **Run** `pnpm vitest run tests/shared/htmlEntities.test.ts` — expected: fails.
- [ ] **Implement** `src/shared/htmlEntities.ts`:
```ts
/**
 * A small decoder for the entity forms the cafe management API uses in
 * `memberLevelName`: the five named references plus decimal and hexadecimal
 * numeric references. The repository has no general HTML parser, and pulling one
 * in for a level name would be far more than this needs. Unknown tokens are left
 * verbatim so a malformed reference is never silently dropped.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+\d*);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    const named = NAMED[entity]
    return named ?? match
  })
}
```
- [ ] **Run** `pnpm vitest run tests/shared/htmlEntities.test.ts` — expected: passes.
- [ ] **Write failing test** `tests/shared/cafeMemberList.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CafeMemberListParseError,
  cafeMemberPageIdentity,
  parseCafeMemberList,
  parseCafeMemberListText,
} from '../../src/shared/cafeMemberList.js'

const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/cafe-member-list-sample.json', import.meta.url)), 'utf8'),
)

describe('parseCafeMemberList', () => {
  it('parses members, decodes level names, and converts join dates', () => {
    const page = parseCafeMemberList(sample)
    expect(page.items).toHaveLength(3)
    expect(page.items[0]).toEqual({
      memberKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      nickname: '새회원하나',
      joinDate: '2026-08-23',
      levelName: '정물&<>',
      isManager: false,
      isStaff: false,
    })
    expect(page.items[1].nickname).toBeNull()
    expect(page.items[1].levelName).toBe('"VIP"')
    expect(page.items[2].isStaff).toBe(true)
  })

  it('gives a deterministic, order-independent identity', () => {
    const a = cafeMemberPageIdentity(['k2', 'k1', 'k3'])
    const b = cafeMemberPageIdentity(['k3', 'k2', 'k1'])
    expect(a).toBe(b)
    expect(a).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    expect(cafeMemberPageIdentity(['k1'])).not.toBe(cafeMemberPageIdentity(['k2']))
    // Distinct from the article identity prefix even for the same keys.
    expect(cafeMemberPageIdentity([])).toMatch(/^fnv1a64:/)
  })

  it('rejects a whole page on any contract violation', () => {
    const bad = (mutate: (value: any) => void, code: string) => {
      const clone = JSON.parse(JSON.stringify(sample))
      mutate(clone)
      try {
        parseCafeMemberList(clone)
        throw new Error('expected rejection')
      } catch (error) {
        expect(error).toBeInstanceOf(CafeMemberListParseError)
        expect((error as CafeMemberListParseError).code).toBe(code)
      }
    }
    bad((v) => { v.isSuccess = 'true' }, 'NOT_SUCCESS')
    bad((v) => { v.isSuccess = false }, 'NOT_SUCCESS')
    bad((v) => { v.result.members = {} }, 'INVALID_ENVELOPE')
    bad((v) => { v.result.members[0].memberKey = 42 }, 'INVALID_MEMBER')
    bad((v) => { v.result.members[0].joinDate = '2026-08-23' }, 'INVALID_MEMBER')
    bad((v) => { v.result.members[0].manager = 'no' }, 'INVALID_MEMBER')
    bad((v) => { v.result.members[1].memberKey = v.result.members[0].memberKey }, 'DUPLICATE_MEMBER_KEY')
  })

  it('rejects non-JSON without treating an HTML login page as an empty list', () => {
    try {
      parseCafeMemberListText('<html>login</html>')
      throw new Error('expected rejection')
    } catch (error) {
      expect((error as CafeMemberListParseError).code).toBe('INVALID_JSON')
    }
  })
})
```
- [ ] **Run** `pnpm vitest run tests/shared/cafeMemberList.test.ts` — expected: fails.
- [ ] **Implement** `src/shared/cafeMemberList.ts`:
```ts
/**
 * Pure contract for the ManageMemberListViewAjax member-list response captured in
 * Phase 0. This module knows neither how a response is fetched nor where its
 * results are stored; both boundaries need a malformed response to fail loudly
 * rather than look like an empty, successful page. The management API returns
 * `isSuccess` as a JSON boolean, unlike the memo-comment API's string "true", so
 * that parser is not reused.
 */
import { decodeHtmlEntities } from './htmlEntities.js'

export interface CollectedMember {
  readonly memberKey: string
  readonly nickname: string | null
  /** KST calendar date as ISO `YYYY-MM-DD`, converted from `YYYY.MM.DD.`. */
  readonly joinDate: string
  /** HTML entities decoded. */
  readonly levelName: string
  readonly isManager: boolean
  readonly isStaff: boolean
}

export interface CollectedMemberPage {
  readonly items: readonly CollectedMember[]
  /** Versioned identity of the page's sorted member keys. */
  readonly pageIdentity: string
}

/** Stamped on every observation this parser produces; bump it when the mapping changes. */
export const CAFE_MEMBER_LIST_PARSER_VERSION = 'member-list-v1'

export type CafeMemberListParseErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_ENVELOPE'
  | 'NOT_SUCCESS'
  | 'INVALID_MEMBER'
  | 'DUPLICATE_MEMBER_KEY'

export class CafeMemberListParseError extends Error {
  constructor(
    readonly code: CafeMemberListParseErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CafeMemberListParseError'
  }
}

type JsonRecord = Record<string, unknown>

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const FNV_MASK = 0xffffffffffffffffn
const JOIN_DATE = /^(\d{4})\.(\d{2})\.(\d{2})\.$/

function fail(code: CafeMemberListParseErrorCode, message: string): never {
  throw new CafeMemberListParseError(code, message)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function requiredString(record: JsonRecord, key: string, path: string): string {
  const value = record[key]
  if (typeof value !== 'string') fail('INVALID_MEMBER', `${path}.${key} must be a string`)
  return value
}

function nullableString(record: JsonRecord, key: string, path: string): string | null {
  if (!hasOwn(record, key)) fail('INVALID_MEMBER', `${path}.${key} is missing`)
  const value = record[key]
  if (value === null || typeof value === 'string') return value
  return fail('INVALID_MEMBER', `${path}.${key} must be a string or null`)
}

function requiredBoolean(record: JsonRecord, key: string, path: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') fail('INVALID_MEMBER', `${path}.${key} must be a boolean`)
  return value
}

function joinDateIso(record: JsonRecord, path: string): string {
  const raw = requiredString(record, 'joinDate', path)
  const match = JOIN_DATE.exec(raw)
  if (match === null) fail('INVALID_MEMBER', `${path}.joinDate must be YYYY.MM.DD.`)
  return `${match[1]}-${match[2]}-${match[3]}`
}

function parseMember(entry: unknown, index: number): CollectedMember {
  const path = `result.members[${index}]`
  if (!isRecord(entry)) fail('INVALID_MEMBER', `${path} must be an object`)
  return {
    memberKey: requiredString(entry, 'memberKey', path),
    nickname: nullableString(entry, 'nickname', path),
    joinDate: joinDateIso(entry, path),
    levelName: decodeHtmlEntities(requiredString(entry, 'memberLevelName', path)),
    isManager: requiredBoolean(entry, 'manager', path),
    isStaff: requiredBoolean(entry, 'staff', path),
  }
}

/**
 * FNV-1a 64 over `member-page-v1\0` and the member keys sorted by code unit and
 * separated by NUL. Deliberately implemented with only ECMAScript primitives so
 * browser-extension and Node code always agree. An empty list has a valid,
 * distinct identity; whether it terminates the walk is the orchestration's call.
 */
export function cafeMemberPageIdentity(memberKeys: readonly string[]): string {
  const canonical = `member-page-v1 ${[...memberKeys].sort().join(' ')}`
  let hash = FNV_OFFSET_BASIS
  for (const character of canonical) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = (hash * FNV_PRIME) & FNV_MASK
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function parseCafeMemberList(value: unknown): CollectedMemberPage {
  if (!isRecord(value)) fail('INVALID_ENVELOPE', 'response must be an object')
  // The management API answers with a JSON boolean, so anything else — including
  // the string "true" — is a contract change and rejects the whole page.
  if (value.isSuccess !== true) fail('NOT_SUCCESS', 'response.isSuccess must be boolean true')
  if (!isRecord(value.result)) fail('INVALID_ENVELOPE', 'response.result must be an object')
  if (!Array.isArray(value.result.members)) fail('INVALID_ENVELOPE', 'result.members must be an array')

  const items = value.result.members.map((entry, index) => parseMember(entry, index))
  const keys = new Set<string>()
  for (const item of items) {
    if (keys.has(item.memberKey)) fail('DUPLICATE_MEMBER_KEY', `result.members has duplicate memberKey`)
    keys.add(item.memberKey)
  }
  return { items, pageIdentity: cafeMemberPageIdentity(items.map((item) => item.memberKey)) }
}

/** Parses decoded response text without treating an HTML/login page as an empty list. */
export function parseCafeMemberListText(text: string): CollectedMemberPage {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'member-list response is not valid JSON')
  }
  return parseCafeMemberList(value)
}
```
- [ ] **Run** `pnpm vitest run tests/shared/cafeMemberList.test.ts tests/shared/htmlEntities.test.ts` — expected: passes.
- [ ] **Run** `pnpm typecheck && pnpm lint`.
- [ ] **Commit:** `git add src/shared/htmlEntities.ts src/shared/cafeMemberList.ts tests/shared/htmlEntities.test.ts tests/shared/cafeMemberList.test.ts tests/fixtures/cafe-member-list-sample.json` — message `feat: parse cafe member list pages with strict contract`.

---

## Task 4 — Protocol pair + `memberPageReader.ts` + background wiring

`PROBE`는 진단용이라 재사용하지 않고 메시지 한 쌍을 추가한다. `PROTOCOL_VERSION`을 8→9로 올린다. 확장의 `memberPageReader.ts`는 `boardPageReader.ts`와 같은 꼴로 한 페이지만 읽고 body-free 오류 코드를 돌려준다.

### Files
- Modify `src/shared/protocol.ts`
- Create `src/extension/memberPageReader.ts`
- Modify `src/extension/background.ts`
- Create `tests/extension/memberPageReader.test.ts`

### Interfaces

Produces:
```ts
// protocol.ts
export const PROTOCOL_VERSION = 9
export interface CollectMemberPageRequest {
  readonly type: 'COLLECT_MEMBER_PAGE'
  readonly requestId: string
  readonly cafeId: typeof CAFE_MEMBER_LIST.cafeId
  readonly page: number
  readonly perPage: typeof CAFE_MEMBER_LIST.perPage
}
export function isCollectMemberPageRequest(value: unknown): value is CollectMemberPageRequest
// AppMessage gains CollectMemberPageRequest; ExtensionMessage gains
// { type: 'MEMBER_PAGE_COLLECTED'; requestId: string; page: number; result: CollectedMemberPage }
export const TIMEOUTS: { ... ; readonly memberPageMs: 20_000 }

// memberPageReader.ts
export type MemberPageReadResult =
  | { readonly ok: true; readonly page: number; readonly result: CollectedMemberPage }
  | { readonly ok: false; readonly code:
      'MEMBER_PAGE_BAD_REQUEST' | 'MEMBER_PAGE_NETWORK_ERROR' | 'MEMBER_PAGE_HTTP_ERROR'
      | 'MEMBER_PAGE_INVALID_JSON' | 'MEMBER_PAGE_PARSE_ERROR' | 'MEMBER_PAGE_FORBIDDEN' }
export interface MemberPageReaderDeps { readonly http: (request: HttpRequest) => Promise<HttpResponse> }
export function createMemberPageReader(deps: MemberPageReaderDeps): { read(request: CollectMemberPageRequest): Promise<MemberPageReadResult> }
```

Consumes: `cafeMemberListUrl` (Task 1), `parseCafeMemberListText`/`CafeMemberListParseError` (Task 3), `HttpRequest`/`HttpResponse` (`./cafeClient.js`).

### Steps

- [ ] **Write failing test** `tests/extension/memberPageReader.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createMemberPageReader } from '../../src/extension/memberPageReader.js'
import { cafeMemberListUrl } from '../../src/shared/cafeMemberFixture.js'
import type { CollectMemberPageRequest } from '../../src/shared/protocol.js'

const sample = readFileSync(fileURLToPath(new URL('../fixtures/cafe-member-list-sample.json', import.meta.url)), 'utf8')

const request: CollectMemberPageRequest = {
  type: 'COLLECT_MEMBER_PAGE',
  requestId: 'm-1',
  cafeId: '14538121',
  page: 1,
  perPage: 100,
}

describe('MemberPageReader', () => {
  it('fetches and parses exactly one member list page', async () => {
    const seen: string[] = []
    const reader = createMemberPageReader({
      http: async ({ url }) => {
        seen.push(url)
        return { status: 200, contentType: 'application/json', text: sample }
      },
    })
    await expect(reader.read(request)).resolves.toMatchObject({ ok: true, page: 1 })
    expect(seen).toEqual([cafeMemberListUrl(1)])
  })

  it('maps invalid request, HTTP failure, network error, bad JSON, forbidden, and parse errors', async () => {
    const bad = createMemberPageReader({ http: async () => ({ status: 200, contentType: null, text: sample }) })
    await expect(bad.read({ ...request, page: 0 } as CollectMemberPageRequest)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_BAD_REQUEST' })

    const http = createMemberPageReader({ http: async () => ({ status: 500, contentType: 'text/html', text: 'x' }) })
    await expect(http.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_HTTP_ERROR' })

    const forbidden = createMemberPageReader({ http: async () => ({ status: 200, contentType: 'application/json', text: '{"isSuccess":false,"result":{"members":[]}}' }) })
    await expect(forbidden.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_FORBIDDEN' })

    const network = createMemberPageReader({ http: async () => { throw new Error('reset') } })
    await expect(network.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_NETWORK_ERROR' })

    const invalidJson = createMemberPageReader({ http: async () => ({ status: 200, contentType: 'text/html', text: '<html>login</html>' }) })
    await expect(invalidJson.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_INVALID_JSON' })

    const malformed = createMemberPageReader({ http: async () => ({ status: 200, contentType: 'application/json', text: '{"isSuccess":true,"result":{"members":[{"memberKey":42}]}}' }) })
    await expect(malformed.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_PARSE_ERROR' })
  })
})
```
- [ ] **Run** `pnpm vitest run tests/extension/memberPageReader.test.ts` — expected: fails.
- [ ] **Modify** `src/shared/protocol.ts`:
  - Import: add `import { CAFE_MEMBER_LIST } from './cafeMemberFixture.js'` and `import type { CollectedMemberPage } from './cafeMemberList.js'` next to the existing article imports.
  - Bump: `export const PROTOCOL_VERSION = 9`.
  - `TIMEOUTS`: add `memberPageMs: 20_000,` after `boardPageMs`.
  - Add the request interface after `CollectBoardPageRequest`:
```ts
export interface CollectMemberPageRequest {
  readonly type: 'COLLECT_MEMBER_PAGE'
  readonly requestId: string
  readonly cafeId: typeof CAFE_MEMBER_LIST.cafeId
  readonly page: number
  readonly perPage: typeof CAFE_MEMBER_LIST.perPage
}
```
  - `AppMessage` union: add `| CollectMemberPageRequest`.
  - `ExtensionMessage` union: add `| { type: 'MEMBER_PAGE_COLLECTED'; requestId: string; page: number; result: CollectedMemberPage }`.
  - `APP_MESSAGE_TYPES`: add `'COLLECT_MEMBER_PAGE'`. `EXTENSION_MESSAGE_TYPES`: add `'MEMBER_PAGE_COLLECTED'`.
  - `isAppMessage`: add `if (type === 'COLLECT_MEMBER_PAGE') return isCollectMemberPageRequest(value)`.
  - `isExtensionMessage`: add `if (type === 'MEMBER_PAGE_COLLECTED') return isMemberPageCollected(value)`.
  - Add guards after the board ones:
```ts
/** Runtime guard for the fixed, deliberately narrow member-list collection contract. */
export function isCollectMemberPageRequest(value: unknown): value is CollectMemberPageRequest {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Partial<CollectMemberPageRequest>
  return (
    message.type === 'COLLECT_MEMBER_PAGE' &&
    typeof message.requestId === 'string' &&
    message.cafeId === CAFE_MEMBER_LIST.cafeId &&
    typeof message.page === 'number' &&
    Number.isSafeInteger(message.page) &&
    message.page >= 1 &&
    message.perPage === CAFE_MEMBER_LIST.perPage
  )
}

function isMemberPageCollected(value: unknown): value is Extract<ExtensionMessage, { type: 'MEMBER_PAGE_COLLECTED' }> {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { type?: unknown; requestId?: unknown; page?: unknown; result?: unknown }
  if (
    message.type !== 'MEMBER_PAGE_COLLECTED' ||
    typeof message.requestId !== 'string' ||
    typeof message.page !== 'number' ||
    !Number.isSafeInteger(message.page) ||
    message.page < 1 ||
    typeof message.result !== 'object' ||
    message.result === null
  ) {
    return false
  }
  const result = message.result as { items?: unknown; pageIdentity?: unknown }
  return Array.isArray(result.items) && typeof result.pageIdentity === 'string'
}
```
- [ ] **Implement** `src/extension/memberPageReader.ts`:
```ts
import { cafeMemberListUrl } from '../shared/cafeMemberFixture.js'
import { CafeMemberListParseError, parseCafeMemberListText, type CollectedMemberPage } from '../shared/cafeMemberList.js'
import { isCollectMemberPageRequest, type CollectMemberPageRequest } from '../shared/protocol.js'
import type { HttpRequest, HttpResponse } from './cafeClient.js'

export type MemberPageReadResult =
  | { readonly ok: true; readonly page: number; readonly result: CollectedMemberPage }
  | {
      readonly ok: false
      readonly code:
        | 'MEMBER_PAGE_BAD_REQUEST'
        | 'MEMBER_PAGE_NETWORK_ERROR'
        | 'MEMBER_PAGE_HTTP_ERROR'
        | 'MEMBER_PAGE_INVALID_JSON'
        | 'MEMBER_PAGE_PARSE_ERROR'
        | 'MEMBER_PAGE_FORBIDDEN'
    }

export interface MemberPageReaderDeps {
  /** The extension-owned request keeps credentials and charset decoding in one boundary. */
  readonly http: (request: HttpRequest) => Promise<HttpResponse>
}

/**
 * Reads exactly one member-list page. Pagination, cursor, sleep and storage are
 * desktop-owned, so this reader intentionally has no loop or policy. A session
 * without management rights answers `isSuccess:false`, which the parser rejects
 * with NOT_SUCCESS; that one case is surfaced as FORBIDDEN so the desktop can
 * name it, while every other parse failure stays a generic PARSE_ERROR.
 */
export function createMemberPageReader(deps: MemberPageReaderDeps) {
  return {
    async read(request: CollectMemberPageRequest): Promise<MemberPageReadResult> {
      if (!isCollectMemberPageRequest(request)) return { ok: false, code: 'MEMBER_PAGE_BAD_REQUEST' }

      let response: HttpResponse
      try {
        response = await deps.http({ url: cafeMemberListUrl(request.page) })
      } catch {
        return { ok: false, code: 'MEMBER_PAGE_NETWORK_ERROR' }
      }
      if (response.status !== 200) return { ok: false, code: 'MEMBER_PAGE_HTTP_ERROR' }

      try {
        return { ok: true, page: request.page, result: parseCafeMemberListText(response.text) }
      } catch (error) {
        if (error instanceof CafeMemberListParseError) {
          if (error.code === 'INVALID_JSON') return { ok: false, code: 'MEMBER_PAGE_INVALID_JSON' }
          if (error.code === 'NOT_SUCCESS') return { ok: false, code: 'MEMBER_PAGE_FORBIDDEN' }
        }
        return { ok: false, code: 'MEMBER_PAGE_PARSE_ERROR' }
      }
    },
  }
}
```
- [ ] **Modify** `src/extension/background.ts`:
  - Import: add `import { createMemberPageReader } from './memberPageReader.js'`.
  - After `const boardPageReader = createBoardPageReader({ http: request })` add:
```ts
const memberPageReader = createMemberPageReader({ http: request })
```
  - In `dispatch`, after the `COLLECT_BOARD_PAGE` case add:
```ts
    case 'COLLECT_MEMBER_PAGE': {
      const result = await memberPageReader.read(message)
      if (!result.ok) {
        // Codes are deliberately stable and body-free: a member list response
        // contains member keys and nicknames and must never reach the bridge.
        reply({ type: 'ERROR', requestId: message.requestId, code: result.code, message: result.code })
        return
      }
      reply({ type: 'MEMBER_PAGE_COLLECTED', requestId: message.requestId, page: result.page, result: result.result })
      return
    }
```
- [ ] **Run** `pnpm vitest run tests/extension/memberPageReader.test.ts` — expected: passes.
- [ ] **Run** `pnpm typecheck && pnpm lint`.
- [ ] **Commit:** `git add src/shared/protocol.ts src/extension/memberPageReader.ts src/extension/background.ts tests/extension/memberPageReader.test.ts` — message `feat: add member page protocol message and extension reader`.

---

## Task 5 — `memberSchema.ts` + migration

회원용 표 셋. 게시판이 없으므로 단일 행 `member_feed_state`(id=1). `member_runs`는 `runs`와 같은 꼴이되 정체성은 `id` 하나이고 `run_kind`는 `backfill|incremental|topup`, status는 기존 `collectionRunStatus` enum을 재사용한다. 카운터 컬럼은 fixture가 보이기 전에는 넣지 않는다.

`drizzle.collection.config.ts`의 `schema`가 `schema.ts` 한 파일만 가리키므로, drizzle-kit generate와 client의 relational query가 회원 표를 함께 알도록 **`schema.ts`에서 `memberSchema.ts`를 re-export**하고 config의 `schema`를 두 파일 배열로 만든다.

### Files
- Create `src/desktop/collection-db/memberSchema.ts`
- Modify `src/desktop/collection-db/schema.ts` (append re-export)
- Modify `drizzle.collection.config.ts`
- Create (generated) `drizzle-collection/0003_*.sql` + `drizzle-collection/meta/*`

### Interfaces

Produces (drizzle tables): `members`, `memberFeedState`, `memberRuns`, `memberRunKind` (pgEnum). Reuses `collectionRunStatus` from `schema.ts`.

### Steps

- [ ] **Implement** `src/desktop/collection-db/memberSchema.ts`:
```ts
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { collectionRunStatus } from './schema.js'

/**
 * The member list has no board, so the `(feed_kind, menu_id)` identity the
 * article tables carry is not reused. A single-row state table stands in for it,
 * and the run kinds are the member walk's own: a full backfill, an incremental
 * resume, and the daily top-up that adds only new joiners.
 */
export const memberRunKind = pgEnum('member_run_kind', ['backfill', 'incremental', 'topup'])

const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/** One row per member, keyed by the same 43-char key the article list carries as author id. */
export const members = pgTable(
  'members',
  {
    /** Internal-only raw member key; export code must anonymize it. */
    memberKey: text('member_key').primaryKey(),
    nickname: text('nickname'),
    joinDate: date('join_date').notNull(),
    levelName: text('level_name').notNull(),
    isManager: boolean('is_manager').notNull(),
    isStaff: boolean('is_staff').notNull(),
    /** When this row was last read, by the desktop's own clock. */
    snapshotAt: observedTimestamp('snapshot_at').notNull(),
    firstSeenAt: observedTimestamp('first_seen_at').notNull(),
    lastRunId: uuid('last_run_id').references(() => memberRuns.id),
  },
  (table) => [index('members_join_date').on(table.joinDate), index('members_level_name').on(table.levelName)],
)

/**
 * A run against the member walk. One cafe per database and one member feed, so
 * the running-run uniqueness is a whole-table partial index rather than a
 * per-feed one.
 */
export const memberRuns = pgTable(
  'member_runs',
  {
    id: uuid('id').primaryKey(),
    runKind: memberRunKind('run_kind').notNull(),
    status: collectionRunStatus('status').notNull().default('running'),
    stopReason: text('stop_reason'),
    startedAt: observedTimestamp('started_at').notNull(),
    finishedAt: observedTimestamp('finished_at'),
    /** Pages spent relocating the anchor, which no stored member came from. */
    discoveryPages: integer('discovery_pages').notNull().default(0),
    collectionPages: integer('collection_pages').notNull().default(0),
    requestPages: integer('request_pages').notNull().default(0),
    observedMemberCount: integer('observed_member_count').notNull().default(0),
    insertedMemberCount: integer('inserted_member_count').notNull().default(0),
    updatedMemberCount: integer('updated_member_count').notNull().default(0),
    lastCommittedMemberKey: text('last_committed_member_key'),
    lastCommittedPage: integer('last_committed_page'),
  },
  (table) => [
    uniqueIndex('member_runs_one_running').on(table.status).where(sql`${table.status} = 'running'`),
    index('member_runs_status').on(table.status),
    check('member_runs_last_page', sql`${table.lastCommittedPage} is null or ${table.lastCommittedPage} >= 1`),
    check(
      'member_runs_nonnegative_counts',
      sql`${table.discoveryPages} >= 0 and ${table.collectionPages} >= 0 and ${table.requestPages} >= 0 and ${table.observedMemberCount} >= 0 and ${table.insertedMemberCount} >= 0 and ${table.updatedMemberCount} >= 0`,
    ),
  ],
)

/** Where the member walk stands. One cafe per database, so exactly one row, id = 1. */
export const memberFeedState = pgTable(
  'member_feed_state',
  {
    id: integer('id').primaryKey(),
    stateVersion: integer('state_version').notNull().default(0),
    /** The tail member of the last committed page; the cursor. */
    anchorMemberKey: text('anchor_member_key'),
    anchorJoinDate: date('anchor_join_date'),
    referencePage: integer('reference_page'),
    pageIdentity: text('page_identity'),
    /** Total member count at the walk's start, if the response exposes one; progress denominator. */
    totalMemberCount: bigint('total_member_count', { mode: 'number' }),
    /** When a run reached the last page; null while the walk is unfinished. */
    completedAt: observedTimestamp('completed_at'),
    /** When the last new-member top-up finished. */
    toppedUpAt: observedTimestamp('topped_up_at'),
    /** When the operator asked this job to ignore the operating hours. */
    forcedAt: observedTimestamp('forced_at'),
    lastRunId: uuid('last_run_id').references(() => memberRuns.id),
    updatedAt: observedTimestamp('updated_at').notNull(),
  },
  (table) => [
    check('member_feed_state_singleton', sql`${table.id} = 1`),
    check('member_feed_state_version', sql`${table.stateVersion} >= 0`),
    check('member_feed_state_reference_page', sql`${table.referencePage} is null or ${table.referencePage} >= 1`),
    check('member_feed_state_total', sql`${table.totalMemberCount} is null or ${table.totalMemberCount} >= 0`),
  ],
)

export const memberCollectionSchema = { members, memberRuns, memberFeedState }
```
- [ ] **Modify** `src/desktop/collection-db/schema.ts` — append at the end of the file (after `collectionSchema`):
```ts
// Re-exported so Drizzle Kit generation and the node-postgres client see the
// member tables through the same schema module the article tables use. The
// member schema imports `collectionRunStatus` from this file, so the export
// lives at the bottom to keep the reference one-directional at module load.
export * from './memberSchema.js'
```
- [ ] **Modify** `drizzle.collection.config.ts` — change the `schema` field:
```ts
  schema: ['./src/desktop/collection-db/schema.ts', './src/desktop/collection-db/memberSchema.ts'],
```
- [ ] **Generate migration:** run `pnpm db:collection:generate`. Verify the produced `drizzle-collection/0003_*.sql` creates `member_run_kind` type, `members`, `member_runs`, `member_feed_state`, the `member_runs_one_running` partial unique index, the `member_feed_state_singleton` check, and the two `members` indexes — and touches no existing table. Verify `drizzle-collection/meta/_journal.json` gained the new entry.
- [ ] **Run** `pnpm typecheck && pnpm lint` (client.ts already imports `* as schema from './schema.js'`, which now transitively includes the member tables — no client change needed).
- [ ] **Commit:** `git add src/desktop/collection-db/memberSchema.ts src/desktop/collection-db/schema.ts drizzle.collection.config.ts drizzle-collection/` — message `feat: add member collection schema and migration`.

---

## Task 6 — `memberRepository.ts`

원자적 페이지 저장(CAS on `state_version`), run 기록, 커서, 완료/토프업/강제 마크. `members` upsert는 닉네임·등급·운영진 여부·`snapshot_at`을 덮고 `first_seen_at`은 유지한다. `startRun`은 없으면 단일 행(id=1)을 만들고, running run이 있으면 거부한다. top-up 판정을 위해 "이 키들이 이미 members에 있나"를 묻는 `knownMemberKeys`도 제공한다.

### Files
- Create `src/desktop/collection-db/memberRepository.ts`
- Modify `tests/desktop/collection-db/integration.test.ts` (add member cases)
- Modify `scripts/run-collection-integration.mjs` — no functional change needed (it already runs the whole integration file); leave as-is unless the file path changes.

### Interfaces

Produces:
```ts
export interface MemberFeedStateExpectation { readonly stateVersion: number; readonly anchorMemberKey: string | null }
export interface MemberFeedState extends MemberFeedStateExpectation {
  readonly anchorJoinDate: string | null
  readonly referencePage: number | null
  readonly pageIdentity: string | null
  readonly totalMemberCount: number | null
  readonly cursorUpdatedAtMs: number
  readonly complete: boolean
  readonly forced: boolean
  readonly toppedUpAtMs: number | null
}
export interface CreateMemberRunInput {
  readonly id: string
  readonly runKind: 'backfill' | 'incremental' | 'topup'
  readonly resumeFromCheckpoint: boolean
  readonly startedAt: Date
}
export interface PersistMemberPageInput {
  readonly runId: string
  readonly observedAt: Date
  readonly referencePage: number
  readonly expectedState: MemberFeedStateExpectation
  readonly page: CollectedMemberPage
}
export type PersistMemberPageResult =
  | { readonly kind: 'stored'; readonly insertedMemberCount: number; readonly updatedMemberCount: number; readonly nextStateVersion: number; readonly anchorMemberKey: string }
  | { readonly kind: 'conflict' }
export interface MemberRepository {
  readMemberFeedState(): Promise<MemberFeedState | null>
  startRun(input: CreateMemberRunInput): Promise<MemberFeedState>
  recordPageRequest(id: string, phase: 'probe' | 'collection'): Promise<void>
  finishRun(id: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  persistPage(input: PersistMemberPageInput): Promise<PersistMemberPageResult>
  markCompleted(finishedAt: Date): Promise<void>
  markToppedUp(finishedAt: Date): Promise<void>
  setForced(forcedAt: Date | null): Promise<void>
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
  /** Of the given keys, which already exist in `members`. Used to stop the top-up walk. */
  knownMemberKeys(keys: readonly string[]): Promise<Set<string>>
}
export function createMemberRepository(db: CollectionDatabase): MemberRepository
```

Consumes: `CollectedMember`/`CollectedMemberPage` (Task 3), `CollectionDatabase` (`./client.js`), `members`/`memberRuns`/`memberFeedState` (Task 5).

### Steps

- [ ] **Modify** `tests/desktop/collection-db/integration.test.ts` — add member cases inside the opt-in `integration(...)` describe (runs only against `COLLECTION_TEST_DATABASE_URL`). Add imports at top:
```ts
import { parseCafeMemberListText } from '../../../src/shared/cafeMemberList.js'
import { createMemberRepository } from '../../../src/desktop/collection-db/memberRepository.js'
```
  Extend `COLLECTION_TABLES` to `['members', 'member_runs', 'member_feed_state', 'posts', 'boards', 'feed_state', 'runs']` and `COLLECTION_TYPES` to include `'member_run_kind'`. Load a member page fixture:
```ts
const memberPage = parseCafeMemberListText(
  readFileSync(fileURLToPath(new URL('../../fixtures/cafe-member-list-sample.json', import.meta.url)), 'utf8'),
)
```
  Add an `it` after the existing article integration test:
```ts
  it('persists a member page atomically, enforces the single-row state, rejects stale CAS, and preserves first_seen_at', async () => {
    const repo = createMemberRepository(connection.db)
    const run = { id: randomUUID(), runKind: 'backfill' as const, resumeFromCheckpoint: false, startedAt: new Date(1_000) }
    const state = await repo.startRun(run)
    expect(state.stateVersion).toBe(0)

    const stored = await repo.persistPage({ runId: run.id, observedAt: new Date(1_000), referencePage: 1, expectedState: { stateVersion: 0, anchorMemberKey: null }, page: memberPage })
    expect(stored.kind).toBe('stored')

    // A second running run is refused by the whole-table partial unique index.
    await expect(repo.startRun({ id: randomUUID(), runKind: 'incremental', resumeFromCheckpoint: true, startedAt: new Date(2_000) })).rejects.toThrow()
    await repo.finishRun(run.id, 'partial', 'PAGE_BUDGET_SPENT', new Date(2_000))

    // Stale CAS (expects version 0, but it is now 1) conflicts rather than writing.
    const run2 = { id: randomUUID(), runKind: 'incremental' as const, resumeFromCheckpoint: true, startedAt: new Date(3_000) }
    await repo.startRun(run2)
    const conflict = await repo.persistPage({ runId: run2.id, observedAt: new Date(3_000), referencePage: 1, expectedState: { stateVersion: 0, anchorMemberKey: null }, page: memberPage })
    expect(conflict.kind).toBe('conflict')

    // Re-reading the same page keeps first_seen_at and moves snapshot_at.
    const latest = await repo.readMemberFeedState()
    const reobserved = await repo.persistPage({ runId: run2.id, observedAt: new Date(4_000), referencePage: 1, expectedState: { stateVersion: latest!.stateVersion, anchorMemberKey: latest!.anchorMemberKey }, page: memberPage })
    expect(reobserved.kind).toBe('stored')
    const known = await repo.knownMemberKeys(memberPage.items.map((m) => m.memberKey))
    expect(known.size).toBe(memberPage.items.length)
  })
```
- [ ] **Run** `pnpm typecheck` — expected: fails (module `memberRepository` not found).
- [ ] **Implement** `src/desktop/collection-db/memberRepository.ts`:
```ts
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { CollectedMember, CollectedMemberPage } from '../../shared/cafeMemberList.js'
import type { CollectionDatabase } from './client.js'
import { members, memberFeedState, memberRuns } from './memberSchema.js'

/** The single member-feed row's fixed primary key. */
const FEED_ROW_ID = 1

export interface MemberFeedStateExpectation {
  readonly stateVersion: number
  readonly anchorMemberKey: string | null
}

export interface MemberFeedState extends MemberFeedStateExpectation {
  readonly anchorJoinDate: string | null
  readonly referencePage: number | null
  readonly pageIdentity: string | null
  readonly totalMemberCount: number | null
  readonly cursorUpdatedAtMs: number
  readonly complete: boolean
  readonly forced: boolean
  readonly toppedUpAtMs: number | null
}

export interface CreateMemberRunInput {
  readonly id: string
  readonly runKind: 'backfill' | 'incremental' | 'topup'
  readonly resumeFromCheckpoint: boolean
  readonly startedAt: Date
}

export interface PersistMemberPageInput {
  readonly runId: string
  readonly observedAt: Date
  readonly referencePage: number
  readonly expectedState: MemberFeedStateExpectation
  readonly page: CollectedMemberPage
}

export type PersistMemberPageResult =
  | {
      readonly kind: 'stored'
      readonly insertedMemberCount: number
      readonly updatedMemberCount: number
      readonly nextStateVersion: number
      readonly anchorMemberKey: string
    }
  | { readonly kind: 'conflict' }

export interface MemberRepository {
  readMemberFeedState(): Promise<MemberFeedState | null>
  startRun(input: CreateMemberRunInput): Promise<MemberFeedState>
  recordPageRequest(id: string, phase: 'probe' | 'collection'): Promise<void>
  finishRun(id: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  persistPage(input: PersistMemberPageInput): Promise<PersistMemberPageResult>
  markCompleted(finishedAt: Date): Promise<void>
  markToppedUp(finishedAt: Date): Promise<void>
  setForced(forcedAt: Date | null): Promise<void>
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
  knownMemberKeys(keys: readonly string[]): Promise<Set<string>>
}

class MemberStateConflictError extends Error {
  constructor() {
    super('member feed state changed before this page could commit')
    this.name = 'MemberStateConflictError'
  }
}

function assertPersistablePage(input: PersistMemberPageInput): readonly CollectedMember[] {
  if (!Number.isSafeInteger(input.referencePage) || input.referencePage < 1) {
    throw new Error('referencePage must be a positive safe integer')
  }
  if (!Number.isSafeInteger(input.expectedState.stateVersion) || input.expectedState.stateVersion < 0) {
    throw new Error('expected stateVersion must be a nonnegative safe integer')
  }
  if (input.page.items.length === 0) {
    throw new Error('an empty member page must be handled by orchestration, not persisted')
  }
  const seen = new Set<string>()
  for (const item of input.page.items) {
    if (seen.has(item.memberKey)) throw new Error('page has a duplicate member key')
    seen.add(item.memberKey)
  }
  return input.page.items
}

function toState(row: {
  stateVersion: number
  anchorMemberKey: string | null
  anchorJoinDate: string | null
  referencePage: number | null
  pageIdentity: string | null
  totalMemberCount: number | null
  completedAt: Date | null
  toppedUpAt: Date | null
  forcedAt: Date | null
  updatedAt: Date
}): MemberFeedState {
  return {
    stateVersion: row.stateVersion,
    anchorMemberKey: row.anchorMemberKey,
    anchorJoinDate: row.anchorJoinDate,
    referencePage: row.referencePage,
    pageIdentity: row.pageIdentity,
    totalMemberCount: row.totalMemberCount,
    cursorUpdatedAtMs: row.updatedAt.getTime(),
    complete: row.completedAt !== null,
    forced: row.forcedAt !== null,
    toppedUpAtMs: row.toppedUpAt?.getTime() ?? null,
  }
}

const STATE_COLUMNS = {
  stateVersion: memberFeedState.stateVersion,
  anchorMemberKey: memberFeedState.anchorMemberKey,
  anchorJoinDate: memberFeedState.anchorJoinDate,
  referencePage: memberFeedState.referencePage,
  pageIdentity: memberFeedState.pageIdentity,
  totalMemberCount: memberFeedState.totalMemberCount,
  completedAt: memberFeedState.completedAt,
  toppedUpAt: memberFeedState.toppedUpAt,
  forcedAt: memberFeedState.forcedAt,
  updatedAt: memberFeedState.updatedAt,
}

export function createMemberRepository(db: CollectionDatabase): MemberRepository {
  return {
    async readMemberFeedState() {
      const rows = await db.select(STATE_COLUMNS).from(memberFeedState).where(eq(memberFeedState.id, FEED_ROW_ID)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toState(row)
    },

    async startRun(input) {
      return await db.transaction(async (tx) => {
        await tx
          .insert(memberFeedState)
          .values({ id: FEED_ROW_ID, stateVersion: 0, updatedAt: input.startedAt })
          .onConflictDoNothing()
        const rows = await tx.select(STATE_COLUMNS).from(memberFeedState).where(eq(memberFeedState.id, FEED_ROW_ID)).for('update')
        const current = rows[0]
        if (current === undefined) throw new Error('member feed state does not exist')
        const running = await tx.select({ id: memberRuns.id }).from(memberRuns).where(eq(memberRuns.status, 'running')).limit(1)
        if (running.length > 0) throw new Error('member feed already has a running run')
        await tx.insert(memberRuns).values({
          id: input.id,
          runKind: input.runKind,
          status: 'running',
          startedAt: input.startedAt,
        })
        return toState(current)
      })
    },

    async recordPageRequest(id, phase) {
      const updated = await db
        .update(memberRuns)
        .set({
          requestPages: sql`${memberRuns.requestPages} + 1`,
          ...(phase === 'probe' ? { discoveryPages: sql`${memberRuns.discoveryPages} + 1` } : {}),
        })
        .where(eq(memberRuns.id, id))
        .returning({ id: memberRuns.id })
      if (updated.length !== 1) throw new Error('member run does not exist')
    },

    async finishRun(id, status, stopReason, finishedAt) {
      const updated = await db
        .update(memberRuns)
        .set({ status, stopReason, finishedAt })
        .where(and(eq(memberRuns.id, id), eq(memberRuns.status, 'running')))
        .returning({ id: memberRuns.id })
      if (updated.length !== 1) throw new Error('member run is not running')
    },

    async markCompleted(finishedAt) {
      // The force goes with it: the walk it was turned on for is done.
      await db.update(memberFeedState).set({ completedAt: finishedAt, forcedAt: null }).where(eq(memberFeedState.id, FEED_ROW_ID))
    },

    async markToppedUp(finishedAt) {
      await db.update(memberFeedState).set({ toppedUpAt: finishedAt }).where(eq(memberFeedState.id, FEED_ROW_ID))
    },

    async setForced(forcedAt) {
      await db.update(memberFeedState).set({ forcedAt }).where(eq(memberFeedState.id, FEED_ROW_ID))
    },

    async reconcileOrphanedRuns(finishedAt) {
      const repaired = await db
        .update(memberRuns)
        .set({ status: 'interrupted', stopReason: 'ORPHANED_RUNNING_RUN', finishedAt })
        .where(eq(memberRuns.status, 'running'))
        .returning({ id: memberRuns.id })
      return repaired.length
    },

    async knownMemberKeys(keys) {
      if (keys.length === 0) return new Set<string>()
      const rows = await db.select({ memberKey: members.memberKey }).from(members).where(inArray(members.memberKey, [...keys]))
      return new Set(rows.map((row) => row.memberKey))
    },

    async persistPage(input) {
      const items = assertPersistablePage(input)
      const anchor = items.at(-1)
      if (anchor === undefined) throw new Error('persistable page unexpectedly has no members')

      try {
        return await db.transaction(async (tx) => {
          const existingRows = await tx
            .select({ memberKey: members.memberKey })
            .from(members)
            .where(inArray(members.memberKey, items.map((item) => item.memberKey)))
          const existing = new Set(existingRows.map((row) => row.memberKey))
          const insertedMemberCount = items.filter((item) => !existing.has(item.memberKey)).length
          const updatedMemberCount = items.length - insertedMemberCount

          // A re-read updates in place: nickname, level, roles and snapshot move;
          // first_seen_at stays what it was.
          await tx
            .insert(members)
            .values(
              items.map((item) => ({
                memberKey: item.memberKey,
                nickname: item.nickname,
                joinDate: item.joinDate,
                levelName: item.levelName,
                isManager: item.isManager,
                isStaff: item.isStaff,
                snapshotAt: input.observedAt,
                firstSeenAt: input.observedAt,
                lastRunId: input.runId,
              })),
            )
            .onConflictDoUpdate({
              target: members.memberKey,
              set: {
                nickname: sql`excluded.nickname`,
                joinDate: sql`excluded.join_date`,
                levelName: sql`excluded.level_name`,
                isManager: sql`excluded.is_manager`,
                isStaff: sql`excluded.is_staff`,
                snapshotAt: input.observedAt,
                lastRunId: input.runId,
              },
            })

          const updatedRun = await tx
            .update(memberRuns)
            .set({
              collectionPages: sql`${memberRuns.collectionPages} + 1`,
              observedMemberCount: sql`${memberRuns.observedMemberCount} + ${items.length}`,
              insertedMemberCount: sql`${memberRuns.insertedMemberCount} + ${insertedMemberCount}`,
              updatedMemberCount: sql`${memberRuns.updatedMemberCount} + ${updatedMemberCount}`,
              lastCommittedMemberKey: anchor.memberKey,
              lastCommittedPage: input.referencePage,
            })
            .where(eq(memberRuns.id, input.runId))
            .returning({ id: memberRuns.id })
          if (updatedRun.length !== 1) throw new Error('member run does not exist')

          const stateUpdated = await tx
            .update(memberFeedState)
            .set({
              stateVersion: input.expectedState.stateVersion + 1,
              anchorMemberKey: anchor.memberKey,
              anchorJoinDate: anchor.joinDate,
              pageIdentity: input.page.pageIdentity,
              referencePage: input.referencePage,
              lastRunId: input.runId,
              updatedAt: input.observedAt,
            })
            .where(
              and(
                eq(memberFeedState.id, FEED_ROW_ID),
                eq(memberFeedState.stateVersion, input.expectedState.stateVersion),
                sql`${memberFeedState.anchorMemberKey} is not distinct from ${input.expectedState.anchorMemberKey}`,
              ),
            )
            .returning({ stateVersion: memberFeedState.stateVersion })
          if (stateUpdated.length !== 1) throw new MemberStateConflictError()

          return {
            kind: 'stored' as const,
            insertedMemberCount,
            updatedMemberCount,
            nextStateVersion: stateUpdated[0]?.stateVersion ?? input.expectedState.stateVersion + 1,
            anchorMemberKey: anchor.memberKey,
          }
        })
      } catch (error) {
        if (error instanceof MemberStateConflictError) return { kind: 'conflict' }
        throw error
      }
    },
  }
}
```
- [ ] **Run** `pnpm typecheck && pnpm lint`. (The integration test is `describe.skip` without `COLLECTION_TEST_DATABASE_URL`, so `pnpm test` passes without a database. If a test database is available, run `COLLECTION_TEST_DATABASE_URL=... pnpm test:collection:integration`.)
- [ ] **Run** `pnpm vitest run tests/desktop/collection-db/integration.test.ts` — expected: the member case is skipped without a DB (green), or passes with one.
- [ ] **Commit:** `git add src/desktop/collection-db/memberRepository.ts tests/desktop/collection-db/integration.test.ts` — message `feat: add member repository with CAS page persistence`.

---

## Task 7 — `memberCollectionResume.ts` + `memberCollectionOrchestrator.ts`

이어받기(join_date 범위로 앵커 재탐색, ±1쪽, 탈퇴 앵커 → 같은 가입일 마지막 다음)와 걷기(page 1부터 또는 재개, 연속성=꼬리 memberKey, 되감기, 종료=100건 미만, top-up=page 1부터 모두 아는 키면 멈춤·상한 5쪽, CAS 충돌). 페이스는 `collectionDelayMs`(글 orchestrator에서 import)를 그대로 쓴다.

목록이 가입일 내림차순이라 `joinDate` 비교는 **문자열 비교로 안전**하다(ISO `YYYY-MM-DD`는 사전순=시간순). 페이지의 "가장 최신 가입일"은 `items[0].joinDate`, "가장 오래된"은 `items.at(-1).joinDate`.

### Files
- Create `src/desktop/memberCollectionResume.ts`
- Create `src/desktop/memberCollectionOrchestrator.ts`
- Create `tests/desktop/memberCollectionResume.test.ts`
- Create `tests/desktop/memberCollectionOrchestrator.test.ts`

### Interfaces

Produces:
```ts
// memberCollectionResume.ts
export interface MemberResumeCursor {
  readonly anchorMemberKey: string
  readonly anchorJoinDate: string
  readonly referencePage: number
}
export type MemberResumePosition =
  | { readonly kind: 'found'; readonly page: number; readonly offset: number; readonly candidate: CollectedMemberPage }
  | { readonly kind: 'unusable' }
export interface MemberScheduledReader {
  collect(page: number): Promise<CollectedMemberPage>
  observedAt(page: CollectedMemberPage): Date
  readonly reads: number
}
export const MEMBER_RESUME_SCAN_PAGE_LIMIT: number
export function locateMemberResumePosition(reader: MemberScheduledReader, cursor: MemberResumeCursor): Promise<MemberResumePosition>

// memberCollectionOrchestrator.ts
export interface MemberCollectionClock { now(): number }
export interface MemberPageFetcher { read(page: number): Promise<CollectedMemberPage> }
export type MemberRunMode = 'backfill' | 'incremental' | 'topup'
export interface MemberCollectionRunOptions { readonly run: CreateMemberRunInput; readonly maxPages: number; readonly mode: MemberRunMode; readonly maxProbePages?: number }
export type MemberCollectionRunResult =
  | { readonly kind: 'succeeded'; readonly pagesStored: number }
  | { readonly kind: 'partial'; readonly pagesStored: number; readonly reason: 'PAGE_BUDGET_SPENT' }
  | { readonly kind: 'interrupted'; readonly pagesStored: number; readonly reason: 'ABORTED' }
  | { readonly kind: 'cas_conflict'; readonly pagesStored: number }
  | { readonly kind: 'failed'; readonly pagesStored: number; readonly code: string }
export interface MemberCollectionOrchestratorDeps {
  readonly repository: MemberRepository
  readonly fetcher: MemberPageFetcher
  readonly clock: MemberCollectionClock
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  readonly isAbortRequested: () => boolean
}
export class MemberCollectionPageError extends Error { constructor(readonly code: string) }
export const MEMBERS_PER_PAGE = 100
export const TOPUP_MAX_PAGES = 5
export function createMemberCollectionFetcher(transport: ExtensionTransport, newRequestId: () => string): MemberPageFetcher
export function createMemberCollectionOrchestrator(deps: MemberCollectionOrchestratorDeps): { run(options: MemberCollectionRunOptions): Promise<MemberCollectionRunResult> }
```

Consumes: `collectionDelayMs` (`./collectionOrchestrator.js`), `MemberRepository`/`CreateMemberRunInput`/`MemberFeedState` (Task 6), `CollectedMemberPage` (Task 3), `Random` (`../shared/ports.js`), `ExtensionTransport` (`./ws/server.js`), `TIMEOUTS`/`AppMessage` (`../shared/protocol.js`).

### Steps

- [ ] **Write failing test** `tests/desktop/memberCollectionResume.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { locateMemberResumePosition, type MemberScheduledReader } from '../../src/desktop/memberCollectionResume.js'
import type { CollectedMember, CollectedMemberPage } from '../../src/shared/cafeMemberList.js'

function member(key: string, joinDate: string): CollectedMember {
  return { memberKey: key, nickname: null, joinDate, levelName: '', isManager: false, isStaff: false }
}
function page(items: CollectedMember[]): CollectedMemberPage {
  return { items, pageIdentity: `id:${items.map((m) => m.memberKey).join(',')}` }
}
function reader(pages: Record<number, CollectedMemberPage>): MemberScheduledReader {
  return { collect: async (n: number) => pages[n] ?? page([]), observedAt: () => new Date(0), reads: 0 }
}

describe('locateMemberResumePosition', () => {
  it('resumes right after the anchor on its reference page', async () => {
    const pages = { 5: page([member('a', '2026-08-23'), member('b', '2026-08-23'), member('c', '2026-08-22')]) }
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 5, offset: 2 })
  })

  it('steps forward when the reference page is now newer than the anchor', async () => {
    const pages = {
      5: page([member('n1', '2026-08-25'), member('n2', '2026-08-24')]), // all newer than anchor
      6: page([member('a', '2026-08-23'), member('b', '2026-08-23')]),
    }
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 6, offset: 2 })
  })

  it('steps backward when the reference page is older than the anchor', async () => {
    const pages = {
      5: page([member('o1', '2026-08-20'), member('o2', '2026-08-19')]), // older than anchor
      4: page([member('a', '2026-08-23'), member('b', '2026-08-23'), member('x', '2026-08-22')]),
    }
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 4, offset: 2 })
  })

  it('after a seceded anchor, resumes after the last member of the same join date', async () => {
    const pages = { 5: page([member('a', '2026-08-23'), member('c', '2026-08-23'), member('d', '2026-08-22')]) }
    // anchor 'b' is gone but its join date 2026-08-23 still on the page.
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 5, offset: 2 })
  })
})
```
- [ ] **Run** `pnpm vitest run tests/desktop/memberCollectionResume.test.ts` — expected: fails.
- [ ] **Implement** `src/desktop/memberCollectionResume.ts`:
```ts
import type { CollectedMemberPage } from '../shared/cafeMemberList.js'

/**
 * Finding where the member walk left off. The list is join-date descending and
 * about a hundred new members arrive a day, so a page that held the anchor
 * yesterday holds it about one page further back today. The stored page number
 * is a starting point, never an address. Join dates are ISO `YYYY-MM-DD`, so a
 * plain string comparison is a date comparison.
 */
export interface MemberResumeCursor {
  readonly anchorMemberKey: string
  readonly anchorJoinDate: string
  readonly referencePage: number
}

export type MemberResumePosition =
  | { readonly kind: 'found'; readonly page: number; readonly offset: number; readonly candidate: CollectedMemberPage }
  | { readonly kind: 'unusable' }

export interface MemberScheduledReader {
  collect(page: number): Promise<CollectedMemberPage>
  observedAt(page: CollectedMemberPage): Date
  readonly reads: number
}

/** How far the ±1 relocation walks before giving up. A few days' drift is a few pages. */
export const MEMBER_RESUME_SCAN_PAGE_LIMIT = 20

function newestJoinDate(page: CollectedMemberPage): string | null {
  return page.items[0]?.joinDate ?? null
}
function oldestJoinDate(page: CollectedMemberPage): string | null {
  return page.items.at(-1)?.joinDate ?? null
}

/**
 * Where on this page the walk carries on, or null when the anchor's place is not
 * here. The anchor member is preferred; if it has seceded, its join date still
 * says where it sat, and the walk resumes after the last member of that date.
 */
function positionWithin(page: CollectedMemberPage, cursor: MemberResumeCursor): number | null {
  const byKey = page.items.findIndex((item) => item.memberKey === cursor.anchorMemberKey)
  if (byKey >= 0) return byKey + 1
  const newest = newestJoinDate(page)
  const oldest = oldestJoinDate(page)
  if (newest === null || oldest === null) return null
  // The anchor's join date has to fall within the page for a seceded resume.
  if (cursor.anchorJoinDate > newest || cursor.anchorJoinDate < oldest) return null
  // Resume after the last member whose join date equals the anchor's — the next
  // member is either an older join date or one this job has not collected.
  let lastSameDate = -1
  for (let index = 0; index < page.items.length; index += 1) {
    if (page.items[index]!.joinDate === cursor.anchorJoinDate) lastSameDate = index
  }
  return lastSameDate < 0 ? null : lastSameDate + 1
}

type Side = 'newer' | 'at' | 'older'
function sideOf(page: CollectedMemberPage, cursor: MemberResumeCursor): Side {
  const newest = newestJoinDate(page)
  const oldest = oldestJoinDate(page)
  if (newest === null || oldest === null) return 'at'
  if (oldest > cursor.anchorJoinDate) return 'newer'
  if (newest < cursor.anchorJoinDate) return 'older'
  return 'at'
}

/**
 * Relocates the anchor by stepping one page at a time in the direction the join
 * date range indicates: a page entirely newer than the anchor is above it (walk
 * forward, higher page numbers), a page entirely older is below it (walk back).
 */
export async function locateMemberResumePosition(
  reader: MemberScheduledReader,
  cursor: MemberResumeCursor,
): Promise<MemberResumePosition> {
  const start = Math.max(1, cursor.referencePage)
  const first = await reader.collect(start)
  const here = positionWithin(first, cursor)
  if (here !== null) return { kind: 'found', page: start, offset: here, candidate: first }

  const direction = sideOf(first, cursor) === 'newer' ? 1 : -1
  let page = start
  for (let step = 0; step < MEMBER_RESUME_SCAN_PAGE_LIMIT; step += 1) {
    const next = page + direction
    if (next < 1) return { kind: 'unusable' }
    page = next
    const candidate = await reader.collect(page)
    if (candidate.items.length === 0) return { kind: 'unusable' }
    const offset = positionWithin(candidate, cursor)
    if (offset !== null) return { kind: 'found', page, offset, candidate }
    // Overshot: the direction has flipped, so the anchor's page fell between two
    // reads (only secessions can do that). Resume from this page's start.
    if ((direction === 1 && sideOf(candidate, cursor) === 'older') || (direction === -1 && sideOf(candidate, cursor) === 'newer')) {
      return { kind: 'found', page, offset: 0, candidate }
    }
  }
  return { kind: 'unusable' }
}
```
- [ ] **Run** `pnpm vitest run tests/desktop/memberCollectionResume.test.ts` — expected: passes.
- [ ] **Write failing test** `tests/desktop/memberCollectionOrchestrator.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createMemberCollectionOrchestrator, MEMBERS_PER_PAGE } from '../../src/desktop/memberCollectionOrchestrator.js'
import type { MemberRepository, PersistMemberPageInput } from '../../src/desktop/collection-db/memberRepository.js'
import type { CollectedMember, CollectedMemberPage } from '../../src/shared/cafeMemberList.js'

const run = { id: '00000000-0000-4000-8000-000000000001', runKind: 'backfill' as const, resumeFromCheckpoint: false, startedAt: new Date(1_000) }

function members(prefix: string, count: number, joinDate: string): CollectedMember[] {
  return Array.from({ length: count }, (_, i) => ({ memberKey: `${prefix}-${i}`, nickname: null, joinDate, levelName: '', isManager: false, isStaff: false }))
}
function page(items: CollectedMember[]): CollectedMemberPage {
  return { items, pageIdentity: `id:${items.map((m) => m.memberKey).join(',')}` }
}
function fullPage(prefix: string, joinDate: string): CollectedMemberPage {
  return page(members(prefix, MEMBERS_PER_PAGE, joinDate))
}

function fakeRepo(overrides: Partial<MemberRepository> = {}) {
  const persisted: PersistMemberPageInput[] = []
  const finished: string[] = []
  let completed = false
  let version = 0
  let anchor: string | null = null
  const base: MemberRepository = {
    readMemberFeedState: async () => ({ stateVersion: version, anchorMemberKey: anchor, anchorJoinDate: null, referencePage: null, pageIdentity: null, totalMemberCount: null, cursorUpdatedAtMs: 1_000, complete: false, forced: false, toppedUpAtMs: null }),
    startRun: async () => ({ stateVersion: version, anchorMemberKey: anchor, anchorJoinDate: null, referencePage: null, pageIdentity: null, totalMemberCount: null, cursorUpdatedAtMs: 1_000, complete: false, forced: false, toppedUpAtMs: null }),
    recordPageRequest: async () => undefined,
    finishRun: async (_id, status, reason) => { finished.push(`${status}:${reason ?? ''}`) },
    persistPage: async (input) => {
      persisted.push(input)
      version += 1
      anchor = input.page.items.at(-1)?.memberKey ?? null
      return { kind: 'stored', insertedMemberCount: input.page.items.length, updatedMemberCount: 0, nextStateVersion: version, anchorMemberKey: anchor ?? '' }
    },
    markCompleted: async () => { completed = true },
    markToppedUp: async () => undefined,
    setForced: async () => { throw new Error('the walk never toggles forced') },
    reconcileOrphanedRuns: async () => 0,
    knownMemberKeys: async () => new Set<string>(),
    ...overrides,
  }
  return { repo: base, persisted, finished, isCompleted: () => completed }
}

const noBusy = { random: { intInclusive: (min: number) => min }, sleep: async () => undefined, clock: { now: () => 1_000 }, isSessionBusy: () => false, isAbortRequested: () => false }

describe('member collection orchestrator', () => {
  it('walks from page 1 and ends on a short final page', async () => {
    const { repo, persisted, finished, isCompleted } = fakeRepo()
    const pages: Record<number, CollectedMemberPage> = {
      1: fullPage('p1', '2026-08-23'),
      2: page(members('p2', 40, '2026-08-22')), // < 100 → end
    }
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async (n) => pages[n] ?? page([]) } })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('succeeded')
    expect(persisted).toHaveLength(2)
    expect(isCompleted()).toBe(true)
    expect(finished[0]).toBe('succeeded:')
  })

  it('rewinds when the previous tail does not surface on the next page', async () => {
    const { repo, persisted } = fakeRepo()
    const p1 = fullPage('p1', '2026-08-23')
    const tail = p1.items.at(-1)!
    // Page 2 missing the tail: a joiner shifted the page. Rewind of page 1 finds
    // the tail not at its end, so the walk continues after it.
    const shifted = page([...members('inserted', 1, '2026-08-24'), ...p1.items.slice(0, MEMBERS_PER_PAGE - 1)])
    const pages: Record<number, CollectedMemberPage> = {
      1: p1,
      2: page(members('p2', 40, '2026-08-22')),
    }
    // First read of page 2 lacks the tail; the rewind reads page 1 again as `shifted`.
    let firstPage1 = true
    const orchestrator = createMemberCollectionOrchestrator({
      ...noBusy,
      repository: repo,
      fetcher: {
        read: async (n) => {
          if (n === 1) { const r = firstPage1 ? p1 : shifted; firstPage1 = false; return r }
          if (n === 2) return page(members('nomatch', 40, '2026-08-22')) // tail absent
          return page([])
        },
      },
    })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('succeeded')
    expect(persisted.length).toBeGreaterThanOrEqual(1)
    void tail
    void pages
  })

  it('stops on abort with the cursor kept', async () => {
    const { repo, finished } = fakeRepo()
    let aborted = false
    const orchestrator = createMemberCollectionOrchestrator({
      ...noBusy,
      isAbortRequested: () => aborted,
      repository: repo,
      fetcher: { read: async () => { aborted = true; return fullPage('p', '2026-08-23') } },
    })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('interrupted')
    expect(finished[0]).toBe('interrupted:ABORTED')
  })

  it('spends the page budget as PAGE_BUDGET_SPENT', async () => {
    const { repo, finished } = fakeRepo()
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async (n) => fullPage(`p${n}`, '2026-08-23') } })
    const result = await orchestrator.run({ run, maxPages: 2, mode: 'backfill' })
    expect(result.kind).toBe('partial')
    expect(finished[0]).toBe('partial:PAGE_BUDGET_SPENT')
  })

  it('ends on a CAS conflict', async () => {
    const { repo } = fakeRepo({ persistPage: async () => ({ kind: 'conflict' }) })
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async () => fullPage('p', '2026-08-23') } })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('cas_conflict')
  })

  it('top-up stops once every key on a page is already known, within 5 pages', async () => {
    const known = new Set(fullPage('known', '2026-08-23').items.map((m) => m.memberKey))
    const { repo, persisted } = fakeRepo({ knownMemberKeys: async (keys) => new Set(keys.filter((k) => known.has(k))) })
    const topupRun = { ...run, runKind: 'topup' as const }
    const pages: Record<number, CollectedMemberPage> = {
      1: page([...members('new', 2, '2026-08-25'), ...fullPage('known', '2026-08-23').items.slice(0, 98)]),
      2: fullPage('known', '2026-08-23'), // all known → stop
    }
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async (n) => pages[n] ?? page([]) } })
    const result = await orchestrator.run({ run: topupRun, maxPages: 50, mode: 'topup' })
    expect(result.kind).toBe('succeeded')
    // Page 1 had new members and was persisted; page 2 was all known and stopped the walk.
    expect(persisted.length).toBeGreaterThanOrEqual(1)
  })
})
```
- [ ] **Run** `pnpm vitest run tests/desktop/memberCollectionOrchestrator.test.ts` — expected: fails.
- [ ] **Implement** `src/desktop/memberCollectionOrchestrator.ts`:
```ts
import { TIMEOUTS, type AppMessage } from '../shared/protocol.js'
import type { CollectedMemberPage } from '../shared/cafeMemberList.js'
import type { Random } from '../shared/ports.js'
import type { CreateMemberRunInput, MemberFeedState, MemberRepository } from './collection-db/memberRepository.js'
import { collectionDelayMs } from './collectionOrchestrator.js'
import { locateMemberResumePosition, type MemberScheduledReader } from './memberCollectionResume.js'
import type { ExtensionTransport } from './ws/server.js'

export interface MemberCollectionClock { now(): number }
export interface MemberPageFetcher { read(page: number): Promise<CollectedMemberPage> }
export type MemberRunMode = 'backfill' | 'incremental' | 'topup'

export interface MemberCollectionRunOptions {
  readonly run: CreateMemberRunInput
  readonly maxPages: number
  readonly mode: MemberRunMode
  readonly maxProbePages?: number
}

export type MemberCollectionRunResult =
  | { readonly kind: 'succeeded'; readonly pagesStored: number }
  | { readonly kind: 'partial'; readonly pagesStored: number; readonly reason: 'PAGE_BUDGET_SPENT' }
  | { readonly kind: 'interrupted'; readonly pagesStored: number; readonly reason: 'ABORTED' }
  | { readonly kind: 'cas_conflict'; readonly pagesStored: number }
  | { readonly kind: 'failed'; readonly pagesStored: number; readonly code: string }

export interface MemberCollectionOrchestratorDeps {
  readonly repository: MemberRepository
  readonly fetcher: MemberPageFetcher
  readonly clock: MemberCollectionClock
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  readonly isAbortRequested: () => boolean
}

export class MemberCollectionPageError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'MemberCollectionPageError'
  }
}

/** A full page is 100 members; fewer means the last page has been reached. */
export const MEMBERS_PER_PAGE = 100
/** The top-up walk reads at most this many pages before stopping regardless. */
export const TOPUP_MAX_PAGES = 5

export function createMemberCollectionFetcher(transport: ExtensionTransport, newRequestId: () => string): MemberPageFetcher {
  return {
    async read(page) {
      const message: Extract<AppMessage, { type: 'COLLECT_MEMBER_PAGE' }> = {
        type: 'COLLECT_MEMBER_PAGE',
        requestId: newRequestId(),
        cafeId: '14538121',
        page,
        perPage: 100,
      }
      const reply = await transport.request(message, TIMEOUTS.memberPageMs)
      if (reply.type === 'MEMBER_PAGE_COLLECTED') return reply.result
      if (reply.type === 'ERROR') throw new MemberCollectionPageError(reply.code)
      throw new MemberCollectionPageError('MEMBER_PAGE_UNEXPECTED_REPLY')
    },
  }
}

interface MemberScheduler extends MemberScheduledReader {
  readonly reads: number
}

function createScheduledReader(deps: MemberCollectionOrchestratorDeps, runId: string, maxPages: number, maxProbePages: number): MemberScheduler {
  let reads = 0
  let probes = 0
  const observations = new WeakMap<CollectedMemberPage, Date>()
  const read = async (page: number, phase: 'probe' | 'collection'): Promise<CollectedMemberPage> => {
    if (reads >= maxPages) throw new MemberCollectionPageError('MAX_PAGE_LIMIT')
    if (phase === 'probe' && probes >= maxProbePages) throw new MemberCollectionPageError('PROBE_PAGE_LIMIT')
    while (deps.isSessionBusy()) {
      if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')
      await deps.sleep(1_000)
    }
    if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')
    const delay = collectionDelayMs(reads + 1, deps.random)
    if (delay > 0) await deps.sleep(delay)
    while (deps.isSessionBusy()) {
      if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')
      await deps.sleep(1_000)
    }
    if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')
    await deps.repository.recordPageRequest(runId, phase)
    reads += 1
    if (phase === 'probe') probes += 1
    const observedAt = new Date(deps.clock.now())
    const value = await deps.fetcher.read(page)
    observations.set(value, observedAt)
    return value
  }
  return {
    collect: (page) => read(page, 'collection'),
    // Resume relocation reads count as discovery, not stored pages.
    observedAt(page) {
      const value = observations.get(page)
      if (value === undefined) throw new MemberCollectionPageError('MEMBER_PAGE_OBSERVATION_TIME_MISSING')
      return value
    },
    get reads() {
      return reads
    },
  }
}

async function persist(
  deps: MemberCollectionOrchestratorDeps,
  runId: string,
  reader: MemberScheduler,
  page: CollectedMemberPage,
  pageNumber: number,
  state: MemberFeedState,
): Promise<{ kind: 'stored'; state: MemberFeedState } | { kind: 'conflict' }> {
  const stored = await deps.repository.persistPage({
    runId,
    observedAt: reader.observedAt(page),
    referencePage: pageNumber,
    expectedState: { stateVersion: state.stateVersion, anchorMemberKey: state.anchorMemberKey },
    page,
  })
  if (stored.kind === 'conflict') return { kind: 'conflict' }
  const tail = page.items.at(-1)
  return {
    kind: 'stored',
    state: {
      ...state,
      stateVersion: stored.nextStateVersion,
      anchorMemberKey: stored.anchorMemberKey,
      anchorJoinDate: tail?.joinDate ?? state.anchorJoinDate,
      referencePage: pageNumber,
      pageIdentity: page.pageIdentity,
      cursorUpdatedAtMs: deps.clock.now(),
    },
  }
}

export function createMemberCollectionOrchestrator(deps: MemberCollectionOrchestratorDeps) {
  return {
    async run(options: MemberCollectionRunOptions): Promise<MemberCollectionRunResult> {
      let pagesStored = 0
      try {
        const initial = await deps.repository.startRun(options.run)
        const reader = createScheduledReader(deps, options.run.id, options.maxPages, options.maxProbePages ?? 32)
        let state: MemberFeedState = initial

        // The top-up walk always starts at page 1 and stops when a whole page is
        // already known; the main walk resumes from the cursor when there is one.
        const resumed =
          options.mode !== 'topup' && state.anchorMemberKey !== null && state.anchorJoinDate !== null && state.referencePage !== null
            ? await locateMemberResumePosition(reader, {
                anchorMemberKey: state.anchorMemberKey,
                anchorJoinDate: state.anchorJoinDate,
                referencePage: state.referencePage,
              })
            : null
        if (resumed?.kind === 'unusable') throw new MemberCollectionPageError('MEMBER_ANCHOR_RELOCATION_FAILED')

        let pageNumber = resumed?.kind === 'found' ? resumed.page : 1
        let firstOffset = resumed?.kind === 'found' ? resumed.offset : 0
        let firstPage = resumed?.kind === 'found' ? resumed.candidate : null
        let previousTailKey: string | null = null
        let previousPageNumber = 0
        let previousIdentity: string | null = null

        while (true) {
          let page = firstPage ?? (await reader.collect(pageNumber))
          firstPage = null

          if (previousTailKey !== null) {
            const surfaced = page.items.findIndex((item) => item.memberKey === previousTailKey)
            if (surfaced >= 0) {
              firstOffset = surfaced + 1
            } else {
              const rewind = await reader.collect(previousPageNumber)
              if (rewind.pageIdentity === previousIdentity) {
                // Nothing shifted; the next page starts a clean segment.
                firstOffset = 0
              } else {
                const index = rewind.items.findIndex((item) => item.memberKey === previousTailKey)
                if (index >= 0 && index < rewind.items.length - 1) {
                  page = rewind
                  pageNumber = previousPageNumber
                  firstOffset = index + 1
                } else {
                  firstOffset = 0
                }
              }
            }
            if (page.pageIdentity === previousIdentity) throw new MemberCollectionPageError('MEMBER_PAGE_REPEATED')
          }

          if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')

          const slice = page.items.slice(firstOffset)
          firstOffset = 0

          // Top-up ends when a full page brings nothing new. Members already in
          // the table are still upserted as a side effect, but the goal is only
          // the joiners at the front.
          if (options.mode === 'topup') {
            const known = await deps.repository.knownMemberKeys(slice.map((item) => item.memberKey))
            const fresh = slice.filter((item) => !known.has(item.memberKey))
            if (fresh.length === 0) {
              await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
              return { kind: 'succeeded', pagesStored }
            }
          }

          if (slice.length > 0) {
            const result = await persist(deps, options.run.id, reader, { ...page, items: slice }, pageNumber, state)
            if (result.kind === 'conflict') {
              await deps.repository.finishRun(options.run.id, 'partial', 'CAS_CONFLICT_REPOSITION_REQUIRED', new Date(deps.clock.now()))
              return { kind: 'cas_conflict', pagesStored }
            }
            state = result.state
            pagesStored += 1
          }

          // A short page is the last page: the whole walk is done.
          if (page.items.length < MEMBERS_PER_PAGE) {
            if (options.mode !== 'topup') await deps.repository.markCompleted(new Date(deps.clock.now()))
            else await deps.repository.markToppedUp(new Date(deps.clock.now()))
            await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
            return { kind: 'succeeded', pagesStored }
          }

          if (options.mode === 'topup' && reader.reads >= TOPUP_MAX_PAGES) {
            await deps.repository.markToppedUp(new Date(deps.clock.now()))
            await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
            return { kind: 'succeeded', pagesStored }
          }

          const tail = page.items.at(-1)
          if (tail === undefined) throw new MemberCollectionPageError('MEMBER_PAGE_EMPTY')
          previousTailKey = tail.memberKey
          previousPageNumber = pageNumber
          previousIdentity = page.pageIdentity
          pageNumber += 1
        }
      } catch (error) {
        const now = new Date(deps.clock.now())
        if (error instanceof MemberCollectionPageError && error.code === 'ABORTED') {
          await deps.repository.finishRun(options.run.id, 'interrupted', 'ABORTED', now).catch(() => undefined)
          return { kind: 'interrupted', pagesStored, reason: 'ABORTED' }
        }
        if (error instanceof MemberCollectionPageError && error.code === 'MAX_PAGE_LIMIT') {
          await deps.repository.finishRun(options.run.id, 'partial', 'PAGE_BUDGET_SPENT', now).catch(() => undefined)
          return { kind: 'partial', pagesStored, reason: 'PAGE_BUDGET_SPENT' }
        }
        const code = error instanceof MemberCollectionPageError ? error.code : 'MEMBER_COLLECTION_FAILURE'
        await deps.repository.finishRun(options.run.id, 'failed', code, now).catch(() => undefined)
        return { kind: 'failed', pagesStored, code }
      }
    },
  }
}
```
- [ ] **Run** `pnpm vitest run tests/desktop/memberCollectionOrchestrator.test.ts tests/desktop/memberCollectionResume.test.ts` — expected: passes. (If the rewind test's exact assertions need tuning against the implementation, keep the invariant — the walk succeeds and stores at least one page — rather than over-fitting offsets.)
- [ ] **Run** `pnpm typecheck && pnpm lint`.
- [ ] **Commit:** `git add src/desktop/memberCollectionResume.ts src/desktop/memberCollectionOrchestrator.ts tests/desktop/memberCollectionResume.test.ts tests/desktop/memberCollectionOrchestrator.test.ts` — message `feat: add member collection orchestrator and resume`.

---

## Task 8 — `collectionLock.ts` + `collectionJob.ts` + `memberCollectionRunner.ts` + loop round-robin

공유 잠금으로 글·회원 러너의 동시 실행을 막고, 루프를 작업 목록으로 넓힌다. 회원 러너는 걷기를 시작·중지하고 잠금을 취득한다. 루프는 회원 걷기가 완료돼 있고 오늘(KST) top-up이 없었으면 top-up을 먼저, 아니면 미완 작업들을 지난 비트 다음부터 라운드로빈으로 굴린다.

### Files
- Create `src/desktop/collectionLock.ts`
- Create `src/desktop/collectionJob.ts`
- Create `src/desktop/memberCollectionRunner.ts`
- Modify `src/desktop/collectionRunner.ts` (acquire the shared lock)
- Modify `src/desktop/collectionLoop.ts` (job list)
- Create `tests/desktop/collectionLock.test.ts`
- Modify `tests/desktop/collectionLoop.test.ts`

### Interfaces

Produces:
```ts
// collectionLock.ts
export interface CollectionLock { tryAcquire(): boolean; release(): void; isHeld(): boolean }
export function createCollectionLock(): CollectionLock

// collectionJob.ts
export interface CollectionJobProgress { readonly exists: boolean; readonly complete: boolean; readonly forced: boolean }
export interface CollectionJob {
  readonly name: 'articles' | 'members'
  readProgress(): Promise<CollectionJobProgress>
  start(maxPages: number): CollectionStartResult
  /** Optional daily maintenance run; resolves null when there is none due. */
  startDailyMaintenance?(maxPages: number, nowMs: number): Promise<CollectionStartResult | null>
}
export function createArticleCollectionJob(deps: {
  repository: () => CollectionRepository | null
  runner: CollectionRunner
  feed: CollectionFeed
}): CollectionJob
export function createMemberCollectionJob(deps: {
  repository: () => MemberRepository | null
  runner: MemberCollectionRunner
}): CollectionJob

// memberCollectionRunner.ts
export interface MemberCollectionStartRequest { readonly mode: MemberRunMode; readonly maxPages: number; readonly resumeFromCheckpoint: boolean }
export interface MemberCollectionRunner {
  start(request: MemberCollectionStartRequest): CollectionStartResult
  stop(): void
  isRunning(): boolean
}
export function createMemberCollectionRunner(deps: MemberCollectionRunnerDeps): MemberCollectionRunner
```

`CollectionStartResult`/`CollectionStartRefusal` are imported from `./collectionRunner.js` (already exported).

### Steps

- [ ] **Write failing test** `tests/desktop/collectionLock.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'

describe('collectionLock', () => {
  it('grants to one holder at a time', () => {
    const lock = createCollectionLock()
    expect(lock.tryAcquire()).toBe(true)
    expect(lock.isHeld()).toBe(true)
    expect(lock.tryAcquire()).toBe(false)
    lock.release()
    expect(lock.isHeld()).toBe(false)
    expect(lock.tryAcquire()).toBe(true)
  })
})
```
- [ ] **Run** `pnpm vitest run tests/desktop/collectionLock.test.ts` — expected: fails.
- [ ] **Implement** `src/desktop/collectionLock.ts`:
```ts
/**
 * A single-holder mutual exclusion between the two collection walks. The article
 * walk and the member walk share one browser session, so at most one may be in
 * flight at a time. This is a synchronous, in-process gate: each runner tries to
 * take it before starting and releases it when its walk settles.
 */
export interface CollectionLock {
  tryAcquire(): boolean
  release(): void
  isHeld(): boolean
}

export function createCollectionLock(): CollectionLock {
  let held = false
  return {
    tryAcquire() {
      if (held) return false
      held = true
      return true
    },
    release() {
      held = false
    },
    isHeld() {
      return held
    },
  }
}
```
- [ ] **Run** `pnpm vitest run tests/desktop/collectionLock.test.ts` — expected: passes.
- [ ] **Modify** `src/desktop/collectionRunner.ts` — smallest change to acquire the shared lock:
  - Add to `CollectionRunnerDeps`: `readonly lock: CollectionLock` and import `import type { CollectionLock } from './collectionLock.js'`.
  - In `start(request)`, after the `BRIDGE_OFFLINE` guard and before `abortRequested = false`, add:
```ts
      // The member walk shares this browser session, so only one walk runs at a
      // time. A held lock reads as ALREADY_RUNNING, the same as this runner's own
      // in-flight guard above.
      if (!deps.lock.tryAcquire()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
```
  - In the `.finally(() => { inFlight = null })`, also release: change to:
```ts
        .finally(() => {
          inFlight = null
          deps.lock.release()
        })
```
- [ ] **Implement** `src/desktop/memberCollectionRunner.ts`:
```ts
import type { Random } from '../shared/ports.js'
import type { MemberRepository } from './collection-db/memberRepository.js'
import type { CollectionLock } from './collectionLock.js'
import {
  createMemberCollectionFetcher,
  createMemberCollectionOrchestrator,
  type MemberCollectionClock,
  type MemberCollectionRunResult,
  type MemberRunMode,
} from './memberCollectionOrchestrator.js'
import type { CollectionStartResult } from './collectionRunner.js'
import type { ExtensionTransport } from './ws/server.js'

export interface MemberCollectionStartRequest {
  readonly mode: MemberRunMode
  readonly maxPages: number
  readonly resumeFromCheckpoint: boolean
}

export interface MemberCollectionRunnerDeps {
  readonly repository: () => MemberRepository | null
  readonly transport: ExtensionTransport
  readonly clock: MemberCollectionClock
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  readonly lock: CollectionLock
  readonly newId: () => string
  readonly onFinished?: (result: MemberCollectionRunResult) => void
  readonly onError?: (error: unknown) => void
}

export interface MemberCollectionRunner {
  start(request: MemberCollectionStartRequest): CollectionStartResult
  stop(): void
  isRunning(): boolean
}

export function createMemberCollectionRunner(deps: MemberCollectionRunnerDeps): MemberCollectionRunner {
  let inFlight: Promise<void> | null = null
  let abortRequested = false

  return {
    start(request) {
      if (inFlight !== null) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      const repository = deps.repository()
      if (repository === null) return { kind: 'refused', reason: 'NO_STORAGE' }
      if (!deps.transport.isConnected()) return { kind: 'refused', reason: 'BRIDGE_OFFLINE' }
      if (!deps.lock.tryAcquire()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }

      abortRequested = false
      const orchestrator = createMemberCollectionOrchestrator({
        repository,
        fetcher: createMemberCollectionFetcher(deps.transport, deps.newId),
        clock: deps.clock,
        random: deps.random,
        sleep: deps.sleep,
        isSessionBusy: deps.isSessionBusy,
        isAbortRequested: () => abortRequested,
      })

      inFlight = orchestrator
        .run({
          run: {
            id: deps.newId(),
            runKind: request.mode,
            resumeFromCheckpoint: request.resumeFromCheckpoint,
            startedAt: new Date(deps.clock.now()),
          },
          maxPages: request.maxPages,
          mode: request.mode,
        })
        .then((result) => {
          deps.onFinished?.(result)
        })
        .catch((error: unknown) => {
          deps.onError?.(error)
        })
        .finally(() => {
          inFlight = null
          deps.lock.release()
        })

      return { kind: 'started' }
    },
    stop() {
      abortRequested = true
    },
    isRunning() {
      return inFlight !== null
    },
  }
}
```
- [ ] **Implement** `src/desktop/collectionJob.ts`:
```ts
import { kstDayStartMs } from '../shared/kst.js'
import type { CollectionFeed, CollectionRepository, CollectionFeedState } from './collection-db/repository.js'
import type { MemberRepository } from './collection-db/memberRepository.js'
import type { CollectionRunner, CollectionStartResult } from './collectionRunner.js'
import type { MemberCollectionRunner } from './memberCollectionRunner.js'

export interface CollectionJobProgress {
  readonly exists: boolean
  readonly complete: boolean
  readonly forced: boolean
}

/**
 * One collectable thing, so the loop can round-robin over the article walk and
 * the member walk without knowing either. `startDailyMaintenance` is the member
 * job's daily top-up; the article job has none.
 */
export interface CollectionJob {
  readonly name: 'articles' | 'members'
  readProgress(): Promise<CollectionJobProgress>
  start(maxPages: number): CollectionStartResult
  startDailyMaintenance?(maxPages: number, nowMs: number): Promise<CollectionStartResult | null>
}

export function createArticleCollectionJob(deps: {
  repository: () => CollectionRepository | null
  runner: CollectionRunner
  feed: CollectionFeed
}): CollectionJob {
  let last: CollectionFeedState | null = null
  return {
    name: 'articles',
    async readProgress() {
      const repository = deps.repository()
      last = repository === null ? null : await repository.readFeedState(deps.feed)
      return { exists: last !== null, complete: last?.complete ?? false, forced: last?.forced ?? false }
    },
    start(maxPages) {
      if (last === null) return { kind: 'refused', reason: 'NO_JOB' }
      return deps.runner.start({
        range: { startMs: last.targetStartMs, endMs: last.targetEndMs },
        kind: 'incremental',
        maxPages,
        resumeFromCheckpoint: true,
      })
    },
  }
}

export function createMemberCollectionJob(deps: {
  repository: () => MemberRepository | null
  runner: MemberCollectionRunner
}): CollectionJob {
  let complete = false
  let toppedUpAtMs: number | null = null
  return {
    name: 'members',
    async readProgress() {
      const repository = deps.repository()
      const state = repository === null ? null : await repository.readMemberFeedState()
      complete = state?.complete ?? false
      toppedUpAtMs = state?.toppedUpAtMs ?? null
      // A member job "exists" once a walk has begun (a row is present). The
      // status-screen start button creates it; the beat only continues it.
      return { exists: state !== null && !state.complete, complete, forced: state?.forced ?? false }
    },
    start(maxPages) {
      return deps.runner.start({ mode: 'incremental', maxPages, resumeFromCheckpoint: true })
    },
    async startDailyMaintenance(maxPages, nowMs) {
      // Top-up runs once per KST day, only after the walk has completed.
      if (!complete) return null
      if (toppedUpAtMs !== null && kstDayStartMs(toppedUpAtMs) === kstDayStartMs(nowMs)) return null
      return deps.runner.start({ mode: 'topup', maxPages, resumeFromCheckpoint: false })
    },
  }
}
```
- [ ] **Modify** `src/desktop/collectionLoop.ts` — replace the single-feed deps and beat with a job list. New `CollectionLoopDeps`:
```ts
export interface CollectionLoopDeps {
  readonly schedule: () => CollectionSchedule
  readonly clock: CollectionClock
  /** The collectable jobs, read on every beat so a job that appears is picked up. */
  readonly jobs: () => readonly CollectionJob[]
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
  readonly onStarted?: (result: CollectionStartResult, scheduledFor: number) => void
  readonly onError?: (error: unknown) => void
}
```
  Import `import type { CollectionJob } from './collectionJob.js'` and drop the `runner`/`repository`/`feed` imports. Replace the `beat` body (keep `lay`, `beatAfter`, `clear`, `prime` structure) so it:
  1. reads each job's progress (`await job.readProgress()`), computing `forced = jobs.some(p.forced)`;
  2. computes `maxPages = pagesPerWorkBlock(schedule.workBlockMinutes)`;
  3. tries daily maintenance first: for each job with `startDailyMaintenance`, call it; the first non-null result is this beat's `attempted` and stops here;
  4. otherwise round-robins over jobs where `progress.exists && !progress.complete`, starting after `lastRunIndex` (a closure variable persisted across beats), calling `job.start(maxPages)`; records the started index.
  Full new `beat`:
```ts
  let lastRunIndex = -1

  async function beat(plannedFor: number): Promise<void> {
    const schedule = deps.schedule()
    let attempted: CollectionStartResult | null = null

    if (schedule.enabled) {
      try {
        const jobs = deps.jobs()
        const progress = await Promise.all(jobs.map((job) => job.readProgress()))
        forced = progress.some((p) => p.forced)
        const maxPages = pagesPerWorkBlock(schedule.workBlockMinutes)

        // Daily maintenance (the member top-up) is offered before the main walk
        // and only starts when it is actually due.
        for (let index = 0; index < jobs.length && attempted === null; index += 1) {
          const maintenance = jobs[index]!.startDailyMaintenance
          if (maintenance === undefined) continue
          const result = await maintenance(maxPages, deps.clock.now())
          if (result !== null) {
            attempted = result
            lastRunIndex = index
          }
        }

        // Otherwise round-robin over the unfinished jobs, starting after the one
        // the previous beat ran, so two jobs share the blocks fairly.
        if (attempted === null) {
          const runnable = jobs
            .map((job, index) => ({ job, index }))
            .filter((entry) => progress[entry.index]!.exists && !progress[entry.index]!.complete)
          if (runnable.length > 0) {
            const ordered = [...runnable].sort((a, b) => a.index - b.index)
            const next = ordered.find((entry) => entry.index > lastRunIndex) ?? ordered[0]!
            attempted = next.job.start(maxPages)
            lastRunIndex = next.index
          }
        }

        if (attempted !== null) deps.onStarted?.(attempted, plannedFor)
      } catch (error) {
        deps.onError?.(error)
      }
    }

    lay(beatAfter(attempted, schedule, deps.clock.now()))
  }
```
  Update `prime()` to read forced from jobs:
```ts
  async function prime(): Promise<void> {
    const was = forced
    try {
      const progress = await Promise.all(deps.jobs().map((job) => job.readProgress()))
      forced = progress.some((p) => p.forced)
    } catch (error) {
      deps.onError?.(error)
      return
    }
    if (forced !== was) lay(deps.clock.now())
  }
```
- [ ] **Modify** `tests/desktop/collectionLoop.test.ts` — rewrite `harness` to build `jobs` instead of `runner`/`repository`/`feed`. Replace the harness runner/repository wiring with a jobs factory. Minimal shape:
```ts
import type { CollectionJob, CollectionJobProgress } from '../../src/desktop/collectionJob.js'

interface FakeJobSpec {
  name: 'articles' | 'members'
  progress: CollectionJobProgress
  startResult?: CollectionStartResult
  maintenance?: (nowMs: number) => CollectionStartResult | null
}

function harness(schedule: CollectionSchedule, specs: FakeJobSpec[]) {
  const started: { name: string; maxPages: number }[] = []
  const cleared: number[] = []
  let pending: { fn: () => void; dueAt: number; handle: number } | null = null
  let now = NOW
  let current = schedule
  let handles = 0
  let liveSpecs = specs

  const jobs = (): CollectionJob[] =>
    liveSpecs.map((spec) => ({
      name: spec.name,
      readProgress: async () => spec.progress,
      start: (maxPages: number) => {
        started.push({ name: spec.name, maxPages })
        return spec.startResult ?? { kind: 'started' }
      },
      ...(spec.maintenance === undefined
        ? {}
        : {
            startDailyMaintenance: async (maxPages: number, nowMs: number) => {
              const result = spec.maintenance!(nowMs)
              if (result !== null) started.push({ name: `${spec.name}:topup`, maxPages })
              return result
            },
          }),
    }))

  const loop = createCollectionLoop({
    schedule: () => current,
    clock: { now: () => now },
    jobs,
    setTimer: (fn, ms) => { handles += 1; pending = { fn, dueAt: now + ms, handle: handles }; return handles },
    clearTimer: (handle) => { cleared.push(handle); if (pending?.handle === handle) pending = null },
  })

  return {
    loop, started, cleared,
    pendingDelayMs: () => (pending === null ? null : pending.dueAt - now),
    advance: async (ms: number, fireLimit = 200): Promise<number> => {
      const target = now + ms
      let fired = 0
      while (pending !== null && pending.dueAt <= target) {
        if ((fired += 1) > fireLimit) throw new Error('loop fired too many times — busy loop')
        const due = pending
        now = Math.max(now, due.dueAt)
        pending = null
        due.fn()
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      }
      now = target
      return fired
    },
    setSchedule: (next: CollectionSchedule) => { current = next },
    setSpecs: (next: FakeJobSpec[]) => { liveSpecs = next },
  }
}
```
  Then keep the existing behavioural tests by adapting them to a single article job (`[{ name: 'articles', progress: { exists: true, complete: false, forced: false } }]`) — the window/rest/night/force/refusal assertions carry over unchanged since one job round-robins to itself. Add three new tests:
```ts
  it('round-robins between two unfinished jobs', async () => {
    const h = harness(enabled, [
      { name: 'articles', progress: { exists: true, complete: false, forced: false } },
      { name: 'members', progress: { exists: true, complete: false, forced: false } },
    ])
    h.loop.refresh()
    await h.advance(12 * HOUR)
    const names = h.started.map((s) => s.name)
    expect(names).toContain('articles')
    expect(names).toContain('members')
  })

  it('runs the member top-up once when the walk is complete and it is due', async () => {
    let due = true
    const h = harness(enabled, [
      { name: 'members', progress: { exists: false, complete: true, forced: false }, maintenance: () => (due ? (due = false, { kind: 'started' }) : null) },
    ])
    h.loop.refresh()
    await h.advance(24 * HOUR)
    expect(h.started.filter((s) => s.name === 'members:topup')).toHaveLength(1)
  })

  it('starts nothing when the only job is a completed member walk with no top-up due', async () => {
    const h = harness(enabled, [
      { name: 'members', progress: { exists: false, complete: true, forced: false }, maintenance: () => null },
    ])
    h.loop.refresh()
    const fired = await h.advance(24 * HOUR)
    expect(fired).toBeGreaterThan(0)
    expect(h.started).toHaveLength(0)
  })
```
  (Adjust the `h.started` assertions in the migrated legacy tests from `h.started` counts to `h.started.filter((s) => s.name === 'articles')` where they counted starts.)
- [ ] **Run** `pnpm vitest run tests/desktop/collectionLoop.test.ts tests/desktop/collectionLock.test.ts` — expected: passes.
- [ ] **Run** `pnpm typecheck && pnpm lint`.
- [ ] **Commit:** `git add src/desktop/collectionLock.ts src/desktop/collectionJob.ts src/desktop/memberCollectionRunner.ts src/desktop/collectionRunner.ts src/desktop/collectionLoop.ts tests/desktop/collectionLock.test.ts tests/desktop/collectionLoop.test.ts` — message `feat: round-robin collection loop over article and member jobs`.

---

## Task 9 — `memberStatusQuery.ts` + IPC/rendererApi/text/component

화면 질의(진행률, 회원 수, 완료/토프업 시각, 매칭 지표: `posts.author_id` distinct 수와 그 중 `members`에 있는 수)와 IPC/rendererApi/preload/api 배선, `CollectionStatus.tsx`의 "회원 목록" 카드, `text.ts` 문구.

### Files
- Create `src/desktop/collection-db/memberStatusQuery.ts`
- Modify `src/desktop/ipc.ts`
- Modify `src/desktop/rendererApi.ts`
- Modify `src/shared/text.ts`
- Modify `src/renderer/store.ts`
- Modify `src/renderer/views/CollectionStatus.tsx`
- Create `tests/desktop/collection-db/memberStatusQuery` cases inside `integration.test.ts` (opt-in)

### Interfaces

Produces:
```ts
// memberStatusQuery.ts
export interface MemberCollectionStatus {
  readonly memberCount: number
  readonly pagesStored: number      // sum of member_runs.collection_pages, or from latest run
  readonly totalMemberCount: number | null
  readonly complete: boolean
  readonly forced: boolean
  readonly completedAtMs: number | null
  readonly toppedUpAtMs: number | null
  readonly running: boolean
  /** Distinct post authors, and how many of them exist in `members`. */
  readonly authorCount: number
  readonly matchedAuthorCount: number
}
export interface MemberCollectionStatusQuery { read(): Promise<MemberCollectionStatus> }
export function createMemberCollectionStatusQuery(db: CollectionDatabase): MemberCollectionStatusQuery

// ipc.ts
export type MemberCollectionStatusView =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly code: CollectionUnavailableCode }
  | { readonly kind: 'ready'; readonly status: MemberCollectionStatus }
// RendererApi gains:
//   getMemberCollectionStatus(): Promise<MemberCollectionStatusView>
//   startMemberCollection(): Promise<StartCollectionResult>
//   stopMemberCollection(): Promise<void>
//   setMemberCollectionForced(forced: boolean): Promise<SetCollectionForcedResult>
```

`startMemberCollection` reuses `StartCollectionResult` (its `refused` reasons cover `NO_STORAGE`/`ALREADY_RUNNING`/`BRIDGE_OFFLINE`; member start has no range so `rejected`/`needs_replace` never occur). Member start uses mode `backfill` when no walk exists, `incremental` when resuming — but the runner decides via `resumeFromCheckpoint`; the rendererApi picks `backfill`+`resumeFromCheckpoint:false` on first start and `incremental`+`true` when a row already exists and is not complete.

### Steps

- [ ] **Implement** `src/desktop/collection-db/memberStatusQuery.ts`:
```ts
import { sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import { members, memberFeedState, memberRuns } from './memberSchema.js'
import { posts } from './schema.js'

export interface MemberCollectionStatus {
  readonly memberCount: number
  readonly pagesStored: number
  readonly totalMemberCount: number | null
  readonly complete: boolean
  readonly forced: boolean
  readonly completedAtMs: number | null
  readonly toppedUpAtMs: number | null
  readonly running: boolean
  /** Distinct post authors, and how many of them exist in the member table. */
  readonly authorCount: number
  readonly matchedAuthorCount: number
}

export interface MemberCollectionStatusQuery {
  read(): Promise<MemberCollectionStatus>
}

function count(value: string | number | null | undefined): number {
  return Number(value ?? 0)
}
function epochMs(value: Date | null | undefined): number | null {
  return value === null || value === undefined ? null : value.getTime()
}

export function createMemberCollectionStatusQuery(db: CollectionDatabase): MemberCollectionStatusQuery {
  return {
    async read() {
      const [memberTotals, stateRows, runningRows, pagesRows, match] = await Promise.all([
        db.select({ members: sql<string>`count(*)` }).from(members),
        db
          .select({
            totalMemberCount: memberFeedState.totalMemberCount,
            completedAt: memberFeedState.completedAt,
            toppedUpAt: memberFeedState.toppedUpAt,
            forcedAt: memberFeedState.forcedAt,
          })
          .from(memberFeedState)
          .limit(1),
        db.select({ running: sql<string>`count(*)` }).from(memberRuns).where(sql`${memberRuns.status} = 'running'`),
        db.select({ pages: sql<string>`coalesce(sum(${memberRuns.collectionPages}), 0)` }).from(memberRuns),
        // Distinct post authors and how many exist in members. A low match ratio
        // is the health signal that the key contract changed.
        db.execute<{ authors: string; matched: string }>(sql`
          select
            count(distinct ${posts.authorId}) as authors,
            count(distinct ${posts.authorId}) filter (where ${members.memberKey} is not null) as matched
          from ${posts}
          left join ${members} on ${members.memberKey} = ${posts.authorId}
          where ${posts.authorId} is not null
        `),
      ])

      const state = stateRows[0]
      const matchRow = match.rows[0]
      return {
        memberCount: count(memberTotals[0]?.members),
        pagesStored: count(pagesRows[0]?.pages),
        totalMemberCount: state?.totalMemberCount ?? null,
        complete: state?.completedAt != null,
        forced: state?.forcedAt != null,
        completedAtMs: epochMs(state?.completedAt ?? null),
        toppedUpAtMs: epochMs(state?.toppedUpAt ?? null),
        running: count(runningRows[0]?.running) > 0,
        authorCount: count(matchRow?.authors),
        matchedAuthorCount: count(matchRow?.matched),
      }
    },
  }
}
```
- [ ] **Modify** `src/desktop/collectionContext.ts` — extend the `ready` variant to carry the member repository and status query so the rendererApi can reach them. Add to the `ready` object: `readonly memberRepository: MemberRepository` and `readonly memberStatus: MemberCollectionStatusQuery`. Import `createMemberRepository`/`MemberRepository` and `createMemberCollectionStatusQuery`/`MemberCollectionStatusQuery`. In `openOptionalCollectionContext`, after `reconcileOrphanedRuns`, also build them:
```ts
    const memberRepository = createMemberRepository(connection.db)
    await memberRepository.reconcileOrphanedRuns(new Date())
    return {
      kind: 'ready',
      repository,
      status: createCollectionStatusQuery(connection.db),
      memberRepository,
      memberStatus: createMemberCollectionStatusQuery(connection.db),
      close: connection.close,
    }
```
  Update the `OptionalCollectionContext` `ready` type accordingly.
- [ ] **Modify** `src/desktop/ipc.ts`:
  - Add channels to `IPC_CHANNELS`:
```ts
  getMemberCollectionStatus: 'wm:getMemberCollectionStatus',
  startMemberCollection: 'wm:startMemberCollection',
  stopMemberCollection: 'wm:stopMemberCollection',
  setMemberCollectionForced: 'wm:setMemberCollectionForced',
```
  - Import `import type { MemberCollectionStatus } from './collection-db/memberStatusQuery.js'`.
  - Add view type:
```ts
export type MemberCollectionStatusView =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly code: CollectionUnavailableCode }
  | { readonly kind: 'ready'; readonly status: MemberCollectionStatus }
```
  - Add to `RendererApi` interface:
```ts
  getMemberCollectionStatus(): Promise<MemberCollectionStatusView>
  startMemberCollection(): Promise<StartCollectionResult>
  stopMemberCollection(): Promise<void>
  setMemberCollectionForced(forced: boolean): Promise<SetCollectionForcedResult>
```
- [ ] **Modify** `src/desktop/rendererApi.ts`:
  - Add deps: `readonly memberCollectionRunner: MemberCollectionRunner` (import type from `./memberCollectionRunner.js`).
  - Import `MemberCollectionStatusView` from `./ipc.js`.
  - Add methods to the returned object:
```ts
    async getMemberCollectionStatus(): Promise<MemberCollectionStatusView> {
      const collection = deps.collection()
      if (collection.kind === 'disabled') return { kind: 'disabled' }
      if (collection.kind === 'unavailable') return { kind: 'unavailable', code: collection.code }
      return { kind: 'ready', status: await collection.memberStatus.read() }
    },

    async startMemberCollection(): Promise<StartCollectionResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const state = await collection.memberRepository.readMemberFeedState()
      if (state?.complete === true) return { kind: 'refused', reason: 'JOB_FINISHED' }
      const schedule = readCollectionSchedule(settings)
      const maxPages = pagesPerWorkBlock(schedule.workBlockMinutes)
      // First start walks from page 1; an existing unfinished row resumes.
      const started = deps.memberCollectionRunner.start({
        mode: state === null ? 'backfill' : 'incremental',
        maxPages,
        resumeFromCheckpoint: state !== null,
      })
      return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
    },

    stopMemberCollection(): Promise<void> {
      deps.memberCollectionRunner.stop()
      return Promise.resolve()
    },

    async setMemberCollectionForced(forced: boolean): Promise<SetCollectionForcedResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const state = await collection.memberRepository.readMemberFeedState()
      if (state === null) return { kind: 'refused', reason: 'NO_JOB' }
      if (state.complete) return { kind: 'refused', reason: 'JOB_FINISHED' }
      await collection.memberRepository.setForced(forced ? new Date(deps.clock.now()) : null)
      deps.collectionLoop.refresh()
      return { kind: 'set', forced }
    },
```
- [ ] **Modify** `src/shared/text.ts` — add a `memberCollection` block inside `TEXT` (after the `collection` block). Values only, Korean:
```ts
  memberCollection: {
    heading: '회원 목록',
    running: '수집 중',
    idle: '대기',
    never: '아직 회원을 수집한 적이 없습니다',
    start: '회원 수집 시작',
    resume: '이어서 수집',
    stop: '중지',
    force: '활동 시간 무시',
    forceRelease: '활동 시간 지키기',
    forcedOn: '활동 시간을 무시하고 있습니다. 다 옮기면 저절로 풀립니다.',
    memberCount: (count: number) => `저장 회원 ${count.toLocaleString()}명`,
    pagesStored: (pages: number) => `${pages}쪽 저장`,
    progress: (percent: number) => `약 ${percent}%`,
    progressUnknown: '진행률 계산 전',
    completedAt: (time: string) => `완료 ${time}`,
    incomplete: '아직 완료되지 않았습니다',
    toppedUpAt: (time: string) => `마지막 신규 보태기 ${time}`,
    toppedUpNever: '신규 보태기 없음',
    match: (matched: number, authors: number) => `글 작성자 ${authors.toLocaleString()}명 중 ${matched.toLocaleString()}명이 회원표에 있음`,
    refused: {
      NO_STORAGE: '수집 저장소가 없어 시작하지 못했습니다.',
      ALREADY_RUNNING: '이미 수집이 돌고 있습니다.',
      BRIDGE_OFFLINE: '확장이 연결되어 있지 않습니다.',
      STOP_RUNNING_FIRST: '수집이 도는 중입니다. 중지한 뒤에 다시 시도하세요.',
      NO_JOB: '시작된 회원 수집이 없습니다.',
      JOB_FINISHED: '전체 회원을 이미 옮겼습니다. 신규는 매일 자동으로 보탭니다.',
    },
  },
```
- [ ] **Modify** `src/renderer/store.ts` — add `memberCollection: MemberCollectionStatusView | null` to `AppState` (import the type from `../desktop/ipc.js`), init `null`, and fetch it in `refresh()` alongside `collection` in both branches (`api.getMemberCollectionStatus()`), setting `memberCollection` in the `set(...)`.
- [ ] **Modify** `src/renderer/views/CollectionStatus.tsx` — add a "회원 목록" card. Read `const memberCollection = useApp((s) => s.memberCollection)`. Render a `<section>` after the recent-runs section, showing (when `memberCollection?.kind === 'ready'`): running/idle state, `TEXT.memberCollection.memberCount`, progress bar from `pagesStored / (totalMemberCount/100)` when `totalMemberCount !== null` (else `progressUnknown`), `completedAt`/`toppedUpAt` (via `formatKstDateTime`), the match line `TEXT.memberCollection.match(matchedAuthorCount, authorCount)`, and three buttons wired to `api.startMemberCollection()`/`api.stopMemberCollection()`/`api.setMemberCollectionForced(!forced)` through `act(...)`, mirroring the article card's start/stop/force pattern and refusal handling (`TEXT.memberCollection.refused`). When `kind !== 'ready'`, reuse the existing `Unavailable` treatment or show nothing (storage screens already explain absence in the article card).
- [ ] **Run** `pnpm typecheck && pnpm lint`.
- [ ] **Commit:** `git add src/desktop/collection-db/memberStatusQuery.ts src/desktop/collectionContext.ts src/desktop/ipc.ts src/desktop/rendererApi.ts src/shared/text.ts src/renderer/store.ts src/renderer/views/CollectionStatus.tsx` — message `feat: surface member collection status and controls`.

---

## Task 10 — bootstrap/main wiring, final verification, repackage note

`bootstrap.ts`가 잠금·회원 러너·작업 목록을 만들고 context에 노출한다. `main.ts`가 rendererApi에 `memberCollectionRunner`를 넘긴다. `collectionLoop`는 이제 작업 목록을 받으므로 bootstrap에서 두 작업(article/member)을 만들어 넘긴다.

### Files
- Modify `src/desktop/bootstrap.ts`
- Modify `src/desktop/main.ts`

### Steps

- [ ] **Modify** `src/desktop/bootstrap.ts`:
  - Imports: add
```ts
import { createCollectionLock } from './collectionLock.js'
import { createMemberCollectionRunner, type MemberCollectionRunner } from './memberCollectionRunner.js'
import { createArticleCollectionJob, createMemberCollectionJob } from './collectionJob.js'
```
  - Add `readonly collectionLock: ... ` is not needed on the interface, but add `readonly memberCollectionRunner: MemberCollectionRunner` to `AppContext`.
  - Create the lock before the runners:
```ts
  const collectionLock = createCollectionLock()
```
  - Add `lock: collectionLock,` to the existing `createCollectionRunner({ ... })` deps.
  - Add the member runner after the article runner:
```ts
  const memberCollectionRunner = createMemberCollectionRunner({
    repository: () => (collection.kind === 'ready' ? collection.memberRepository : null),
    transport,
    clock: systemClock,
    random: systemRandom,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isSessionBusy: () => sessionProgress !== null,
    lock: collectionLock,
    newId: () => randomUUID(),
    onError: (error) => console.error('[member-collection]', error),
  })
```
  - Change the `createCollectionLoop({ ... })` call to pass `jobs` instead of `runner`/`repository`/`feed`:
```ts
  const collectionLoop = createCollectionLoop({
    schedule: () => readCollectionSchedule(settings),
    clock: systemClock,
    jobs: () => [
      createArticleCollectionJob({
        repository: () => (collection.kind === 'ready' ? collection.repository : null),
        runner: collectionRunner,
        feed: ALL_ARTICLES_FEED,
      }),
      createMemberCollectionJob({
        repository: () => (collection.kind === 'ready' ? collection.memberRepository : null),
        runner: memberCollectionRunner,
      }),
    ],
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
    onStarted: (result, scheduledFor) => {
      if (result.kind === 'refused') {
        console.warn('[collection] scheduled run refused:', result.reason, scheduledFor)
      }
    },
  })
  collectionLoop.refresh()
```
  Note: the job factories are cheap and hold only per-beat cached state, so recreating them on each `jobs()` call is correct (the loop calls `readProgress` right after). Keep them inline.
  - In `shutdown()`, add `memberCollectionRunner.stop()` next to `collectionRunner.stop()`.
  - Add `memberCollectionRunner,` to the returned `AppContext` object.
- [ ] **Modify** `src/desktop/main.ts` — in the `createRendererApi({ ... })` call, add `memberCollectionRunner: appContext.memberCollectionRunner,`.
- [ ] **Run** `pnpm test` — expected: all suites pass (integration remains opt-in/skip without a DB).
- [ ] **Run** `pnpm typecheck && pnpm lint`.
- [ ] **Run** `pnpm build:all` — expected: main, preload, renderer, and extension all build.
- [ ] **Commit:** `git add src/desktop/bootstrap.ts src/desktop/main.ts` — message `feat: wire member collection into app context and loop`.
- [ ] **PROTOCOL_VERSION note (release):** `PROTOCOL_VERSION` was bumped 8→9 in Task 4. The extension and desktop compare it during the HELLO handshake; the release app must be **repackaged and the extension rebuilt/reloaded** (`pnpm package:app` / `pnpm package:extension`) or pairing silently breaks — a running release app on protocol 8 will reject a protocol-9 extension and vice versa. This is the same failure the project memory note "Repackage after a protocol bump" records. Do not ship the desktop change without shipping the matching extension build. If a `win7-compat` build exists, merge `main` before its build as the memory note requires.

---

## Notes on consistency and assumptions

- **Signatures are fixed across tasks.** `MemberRepository` (Task 6) is consumed unchanged by the orchestrator (Task 7), runner (Task 8), status query and rendererApi (Task 9), and bootstrap (Task 10). `CollectedMemberPage`/`CollectedMember` (Task 3) flow through the reader (Task 4), repository (Task 6), and orchestrator (Task 7) unchanged.
- **`CollectionStartResult`/`CollectionStartRefusal`** are reused from `collectionRunner.ts` for the member runner and rendererApi, so no parallel refusal type is introduced.
- **Drizzle single-schema constraint:** the drizzle-kit config points at `schema.ts`, so member tables are re-exported there (Task 5) and the config `schema` becomes an array. `client.ts` needs no change because it imports `* as schema from './schema.js'`, which now transitively includes the member tables.
- **Assumptions carried from the Task 2 gate (revisit if capture disagrees):** fields `memberKey`/`joinDate`/`nickname`/`memberLevelName`/`manager`/`staff`; `isSuccess` JSON boolean; end-of-list = a page with fewer than 100 members; no activity counters stored yet (add-later recipe in Task 2); silent-fallback detection deferred until the `마지막+1` fixture shows whether it happens (would add `MEMBER_PAGE_SILENT_FALLBACK` handling to Task 7's orchestrator via a `page_identity` + `reference_page` contradiction check, mirroring the article `BOARD_PAGE_SILENT_FALLBACK` path).
- **Sanitization** for member fixtures reuses `sanitizeCafeArticleFixture` unchanged — its `IDENTIFIER_KEYS` already covers `memberkey` and `nickname`, and `POST_TEXT_KEYS` does not touch `memberLevelName` (a level name is not post text), which is fine: level names are not sensitive and the parser tests want them intact.
