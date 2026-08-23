# 신입회원 판별 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가입인사 자동 댓글이 신입에게만, 한 번만 나가게 한다.

**Architecture:** 카페 관리 API에서 최근 가입자를 받아 로컬 표에 쌓고, 가입인사 글의 작성자를 그 표에서 찾아 신입 여부를 판정한다. 자동 생성 글은 본문 문구만으로 신입이 확정되어 조회가 필요 없다. 조회에 실패한 세션에서는 판정할 수 없는 후보를 보류하고 워터마크를 전진시키지 않는다.

**Tech Stack:** TypeScript, Electron, better-sqlite3 + Drizzle, Vitest, Chrome MV3 확장.

**설계 문서:** [2026-08-23-new-member-identification-design.md](../specs/2026-08-23-new-member-identification-design.md)

## Global Constraints

- 사용자와의 대화는 한국어, **코드와 주석은 영어**
- 커밋 메시지에 AI 서명·공동저자·이모지를 넣지 않는다
- 파일 하나에 책임 하나. 200~400줄이 보통, 800줄이 상한
- 변경 없는 리팩터와 기능 변경을 같은 커밋에 섞지 않는다
- TDD: 실패하는 테스트 → 최소 구현 → 통과 → 커밋
- 명령은 저장소 루트에서 `pnpm`으로 실행한다
- 가입일 문자열 형식은 `2026.08.23.` (KST 날짜, 시각 없음)
- 신입 판정 창 `N`의 기본값은 **7일**(`가입 후 N일 이내의 글`이면 신입), 표 정리 기준은 **N+1일**
- 멤버 목록 요청은 `perPage=100`, 안전 상한 **20페이지**

## File Structure

| 파일 | 책임 |
|---|---|
| `src/shared/kst.ts` | KST 날짜 환산. 오프셋 상수의 유일한 자리 |
| `src/shared/members.ts` | 멤버 목록 URL 조립과 응답 파싱 |
| `src/desktop/db/membersRepo.ts` | 가입자 표 읽기·쓰기·정리 |
| `src/desktop/membership.ts` | 표 갱신과 작성자 판정 리졸버 |
| `src/shared/automations/welcome-comment/newMember.ts` | 자동 생성 글 판별, `newMemberGuard` |
| `src/shared/guards.ts` | `GuardContext` 확장 (수정) |
| `src/shared/types.ts` | `AuthorMembership`, `SkipReason` 추가 (수정) |
| `src/shared/protocol.ts` | `FETCH_MEMBERS`/`MEMBERS` 추가 (수정) |
| `src/extension/cafeClient.ts` | `fetchMembers` 추가 (수정) |
| `src/extension/background.ts` | 새 메시지 분기 (수정) |
| `src/desktop/db/dedupeStore.ts` | 작성자 중복 확인 (수정) |
| `src/desktop/db/schema.ts` | `members` 표, 작성자 조회 인덱스 (수정) |
| `src/desktop/orchestrator.ts` | 보류 처리 (수정) |
| `src/desktop/session.ts` | 배선 (수정) |

`newMemberGuard`가 `guards.ts`가 아니라 가입인사 자동화 폴더에 있는 것은 의도적이다. 자동 생성 문구는 이 자동화만의 지식이고, `guards.ts`는 자동화에 중립인 채로 남아야 한다.

---

### Task 1: KST 날짜 유틸

`joinDate`는 날짜만 있고 `postedAt`은 UTC epoch ms다. 둘을 비교하려면 같은 달력 일수로 바꿔야 한다. KST 오프셋 상수는 이미 `parse.ts`에 있는데, 두 번째 사용처가 생기므로 한 곳으로 옮긴다.

**Files:**
- Create: `src/shared/kst.ts`
- Modify: `src/shared/automations/welcome-comment/parse.ts`
- Test: `tests/shared/kst.test.ts`

**Interfaces:**
- Produces: `KST_OFFSET_MS: number`, `kstDayOf(epochMs: number): number`, `joinDateToKstDay(joinDate: string): number | null`, `kstDayToJoinDate(day: number): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/kst.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { joinDateToKstDay, kstDayOf, kstDayToJoinDate } from '../../src/shared/kst.js'

describe('kstDayOf', () => {
  it('counts the KST calendar day, not the UTC one', () => {
    // 2026-08-23 00:30 KST and 2026-08-23 23:00 KST are the same KST day,
    // but they fall on different UTC days.
    const justAfterKstMidnight = Date.UTC(2026, 7, 22, 15, 30)
    const lateSameKstDay = Date.UTC(2026, 7, 23, 14, 0)
    expect(kstDayOf(justAfterKstMidnight)).toBe(kstDayOf(lateSameKstDay))
  })

  it('agrees with the join date the cafe sends for that day', () => {
    expect(kstDayOf(Date.UTC(2026, 7, 22, 15, 30))).toBe(joinDateToKstDay('2026.08.23.'))
  })
})

describe('joinDateToKstDay', () => {
  it('counts one day between consecutive dates', () => {
    const earlier = joinDateToKstDay('2026.08.22.')
    const later = joinDateToKstDay('2026.08.23.')
    expect(later).not.toBeNull()
    expect(earlier).not.toBeNull()
    expect((later as number) - (earlier as number)).toBe(1)
  })

  it('rejects anything that is not the cafe shape', () => {
    expect(joinDateToKstDay('2026-08-23')).toBeNull()
    expect(joinDateToKstDay('2026.8.23.')).toBeNull()
    expect(joinDateToKstDay('')).toBeNull()
  })
})

describe('kstDayToJoinDate', () => {
  it('round-trips a join date string', () => {
    const day = joinDateToKstDay('2026.08.23.')
    expect(day).not.toBeNull()
    expect(kstDayToJoinDate(day as number)).toBe('2026.08.23.')
  })

  it('pads single digit months and days', () => {
    const day = joinDateToKstDay('2026.01.05.')
    expect(kstDayToJoinDate(day as number)).toBe('2026.01.05.')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/kst.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/shared/kst.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/shared/kst.ts`:

```ts
/**
 * Naver renders cafe timestamps in the cafe's own timezone, and the member list
 * gives join dates with no time at all. Both live here so the offset is written
 * once, and so a date-only value is never compared as though it carried a clock.
 */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const MS_PER_DAY = 86_400_000
const JOIN_DATE = /^(\d{4})\.(\d{2})\.(\d{2})\.$/

/** Days since the epoch, counted on the KST calendar. */
export function kstDayOf(epochMs: number): number {
  return Math.floor((epochMs + KST_OFFSET_MS) / MS_PER_DAY)
}

/** `null` when the string is not the `2026.08.23.` shape the cafe sends. */
export function joinDateToKstDay(joinDate: string): number | null {
  const match = JOIN_DATE.exec(joinDate)
  if (match === null) return null
  const [, year, month, day] = match
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / MS_PER_DAY)
}

/**
 * Inverse of `joinDateToKstDay`. Pruning compares join dates as strings, which
 * only works because the format is zero-padded and therefore sorts by date.
 */
export function kstDayToJoinDate(day: number): string {
  const date = new Date(day * MS_PER_DAY)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}.`
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/shared/kst.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: `parse.ts`가 공용 상수를 쓰게 한다**

`src/shared/automations/welcome-comment/parse.ts`에서 지역 상수 선언을 지우고 import 한다. 지울 것:

```ts
/** Naver renders the cafe's own timezone; this cafe is Korean. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
```

파일 상단 import에 추가한다:

```ts
import { KST_OFFSET_MS } from '../../kst.js'
```

`postedAt`의 본문은 그대로 둔다. 동작이 바뀌면 안 된다.

- [ ] **Step 6: 회귀가 없음을 확인한다**

Run: `pnpm vitest run tests/shared/automations/welcome-comment/parse.test.ts && pnpm typecheck`
Expected: PASS — 기존 파서 테스트 전부 통과, 타입 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/shared/kst.ts tests/shared/kst.test.ts src/shared/automations/welcome-comment/parse.ts
git commit -m "refactor: move the KST offset to a shared date module"
```

---

### Task 2: 멤버 목록 URL과 파서

**Files:**
- Create: `src/shared/members.ts`
- Test: `tests/shared/members.test.ts`
- 이미 있음: `tests/fixtures/member-list.json` (실캡처 마스킹본, 3건)

**Interfaces:**
- Consumes: 없음
- Produces: `RawMember { memberKey: string; joinDate: string }`, `memberListUrl(cafeId: string, page: number, perPage: number): string`, `parseMemberList(body: string): RawMember[] | null`, `MEMBER_PAGE_SIZE: number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/members.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MEMBER_PAGE_SIZE, memberListUrl, parseMemberList } from '../../src/shared/members.js'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/member-list.json', import.meta.url)), 'utf8')

describe('memberListUrl', () => {
  it('sorts by join date, newest first', () => {
    const url = memberListUrl('10000000', 1, MEMBER_PAGE_SIZE)
    expect(url).toContain('search.clubid=10000000')
    expect(url).toContain('search.sortType=0')
    expect(url).toContain('search.sortOrder=0')
    expect(url).toContain('search.page=1')
    expect(url).toContain(`search.perPage=${MEMBER_PAGE_SIZE}`)
  })
})

describe('parseMemberList', () => {
  it('reads the fields the join check needs from a real capture', () => {
    expect(parseMemberList(fixture)).toEqual([
      { memberKey: 'FIXTUREMEMBER01xxxxxxxxxxxxxxxxxxxxxxxxxxxx', joinDate: '2026.08.23.' },
      { memberKey: 'FIXTUREMEMBER02xxxxxxxxxxxxxxxxxxxxxxxxxxxx', joinDate: '2026.08.23.' },
      { memberKey: 'FIXTUREMEMBER03xxxxxxxxxxxxxxxxxxxxxxxxxxxx', joinDate: '2026.08.22.' },
    ])
  })

  // This endpoint answers with a real boolean. The memo comment API answers
  // with the string "true", so the two parsers must not share a check.
  it('rejects an unsuccessful response', () => {
    expect(parseMemberList(JSON.stringify({ isSuccess: false, result: { members: [] } }))).toBeNull()
    expect(parseMemberList(JSON.stringify({ isSuccess: 'true', result: { members: [] } }))).toBeNull()
  })

  it('returns null when the body is not the shape we expect', () => {
    expect(parseMemberList('not json')).toBeNull()
    expect(parseMemberList(JSON.stringify({ isSuccess: true }))).toBeNull()
    expect(parseMemberList(JSON.stringify({ isSuccess: true, result: { members: 'no' } }))).toBeNull()
  })

  it('drops records whose join date is not the shape the cafe sends', () => {
    const body = JSON.stringify({
      isSuccess: true,
      result: {
        members: [
          { memberKey: 'a', joinDate: '2026.08.23.' },
          { memberKey: 'b', joinDate: '2026-08-23' },
          { memberKey: '', joinDate: '2026.08.23.' },
        ],
      },
    })
    expect(parseMemberList(body)).toEqual([{ memberKey: 'a', joinDate: '2026.08.23.' }])
  })

  it('distinguishes an empty page from a failed read', () => {
    expect(parseMemberList(JSON.stringify({ isSuccess: true, result: { members: [] } }))).toEqual([])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/members.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/shared/members.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/shared/members.ts`:

```ts
import { joinDateToKstDay } from './kst.js'

/**
 * The cafe's member management list, which is the only place that reports when
 * somebody joined. Endpoint and parameters were read out of the management
 * page's own script and called against a logged-in session — see the design
 * spec, section 3.3. Nothing here fetches; the extension supplies the session.
 */
const ORIGIN = 'https://cafe.naver.com'

/** One page covers roughly a day of joins at this cafe's rate. */
export const MEMBER_PAGE_SIZE = 100

export interface RawMember {
  readonly memberKey: string
  readonly joinDate: string
}

export function memberListUrl(cafeId: string, page: number, perPage: number): string {
  return (
    `${ORIGIN}/ManageMemberListViewAjax.nhn?search.clubid=${cafeId}` +
    `&search.searchType=0&search.memberLevel=0` +
    `&search.perPage=${perPage}&search.page=${page}` +
    // sortType 0 with sortOrder 0 is join date, newest first.
    `&search.sortType=0&search.sortOrder=0` +
    `&search.paginationCached=false&search.totalCountCached=0`
  )
}

interface RawRecord {
  readonly memberKey?: unknown
  readonly joinDate?: unknown
}

/**
 * `null` means the list could not be read, which is not the same as the cafe
 * having no members on this page. An empty array is an answer; a failed read is
 * not, and the caller must not treat one as the other.
 */
export function parseMemberList(body: string): RawMember[] | null {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null

  const envelope = payload as { isSuccess?: unknown; result?: { members?: unknown } }
  // A real boolean here, unlike the memo comment endpoint's string "true".
  if (envelope.isSuccess !== true) return null

  const list = envelope.result?.members
  if (!Array.isArray(list)) return null

  const members: RawMember[] = []
  for (const record of list as RawRecord[]) {
    const { memberKey, joinDate } = record
    if (typeof memberKey !== 'string' || memberKey === '') continue
    if (typeof joinDate !== 'string' || joinDateToKstDay(joinDate) === null) continue
    members.push({ memberKey, joinDate })
  }
  return members
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/shared/members.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: 커밋**

```bash
git add src/shared/members.ts tests/shared/members.test.ts tests/fixtures/member-list.json
git commit -m "feat: read join dates from the cafe member list"
```

---

### Task 3: 가입자 표

**Files:**
- Modify: `src/desktop/db/schema.ts`
- Create: `src/desktop/db/membersRepo.ts`
- Create: `drizzle/<생성된 이름>.sql` (`pnpm db:generate`가 만든다)
- Test: `tests/desktop/db/membersRepo.test.ts`

**Interfaces:**
- Consumes: `RawMember` (Task 2), `kstDayOf`/`kstDayToJoinDate` (Task 1)
- Produces: `MembersRepo { joinDateOf(cafeId, memberKey): string | null; upsertMany(cafeId, members): void; isEmpty(cafeId): boolean; prune(cafeId, oldestJoinDate): void }`, `createMembersRepo(db: AppDatabase): MembersRepo`

- [ ] **Step 1: 스키마에 표를 추가한다**

`src/desktop/db/schema.ts` 끝에 추가한다:

```ts
/**
 * Members this tool has watched join. Only what the new-member check needs is
 * kept: the key that joins to a post's author, and the day they joined. The
 * table starts empty and is only ever filled forward, so a member missing from
 * it means they joined before the tool started looking.
 */
export const members = sqliteTable(
  'members',
  {
    cafeId: text('cafe_id').notNull(),
    memberKey: text('member_key').notNull(),
    /** `2026.08.23.` — zero padded, so string order is date order. */
    joinDate: text('join_date').notNull(),
  },
  (table) => [uniqueIndex('members_cafe_member_unique').on(table.cafeId, table.memberKey)],
)
```

- [ ] **Step 2: 마이그레이션을 생성한다**

Run: `pnpm db:generate && ls drizzle`
Expected: `drizzle/`에 새 `.sql` 파일이 하나 생긴다. 열어서 `CREATE TABLE `members`` 와 유니크 인덱스가 들어 있는지 확인한다. 기존 표를 건드리는 문장이 있으면 안 된다.

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`tests/desktop/db/membersRepo.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { createMembersRepo, type MembersRepo } from '../../../src/desktop/db/membersRepo.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))
const CAFE = '10000000'

let dir: string
let db: AppDatabase
let repo: MembersRepo

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-members-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createMembersRepo(db)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createMembersRepo', () => {
  it('reports an empty table so the first run can stop after one page', () => {
    expect(repo.isEmpty(CAFE)).toBe(true)
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    expect(repo.isEmpty(CAFE)).toBe(false)
  })

  it('returns the join date it stored, and null for a member it never saw', () => {
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    expect(repo.joinDateOf(CAFE, 'm1')).toBe('2026.08.23.')
    expect(repo.joinDateOf(CAFE, 'm2')).toBeNull()
  })

  it('keeps cafes apart', () => {
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    expect(repo.joinDateOf('99999', 'm1')).toBeNull()
    expect(repo.isEmpty('99999')).toBe(true)
  })

  it('upserts the same member twice without failing', () => {
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    expect(repo.joinDateOf(CAFE, 'm1')).toBe('2026.08.23.')
  })

  it('accepts an empty batch', () => {
    expect(() => repo.upsertMany(CAFE, [])).not.toThrow()
    expect(repo.isEmpty(CAFE)).toBe(true)
  })

  it('prunes members who joined before the cutoff and keeps the cutoff itself', () => {
    repo.upsertMany(CAFE, [
      { memberKey: 'old', joinDate: '2026.08.10.' },
      { memberKey: 'edge', joinDate: '2026.08.15.' },
      { memberKey: 'fresh', joinDate: '2026.08.23.' },
    ])
    repo.prune(CAFE, '2026.08.15.')
    expect(repo.joinDateOf(CAFE, 'old')).toBeNull()
    expect(repo.joinDateOf(CAFE, 'edge')).toBe('2026.08.15.')
    expect(repo.joinDateOf(CAFE, 'fresh')).toBe('2026.08.23.')
  })
})
```

- [ ] **Step 4: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/db/membersRepo.test.ts`
Expected: FAIL — `Failed to resolve import ".../membersRepo.js"`

- [ ] **Step 5: 최소 구현을 쓴다**

`src/desktop/db/membersRepo.ts`:

```ts
import { and, eq, lt, sql } from 'drizzle-orm'
import type { RawMember } from '../../shared/members.js'
import type { AppDatabase } from './client.js'
import { members } from './schema.js'

export interface MembersRepo {
  joinDateOf(cafeId: string, memberKey: string): string | null
  upsertMany(cafeId: string, batch: readonly RawMember[]): void
  /** True before the first successful refresh, which is what starts the window. */
  isEmpty(cafeId: string): boolean
  /** Removes members who joined strictly before `oldestJoinDate`. */
  prune(cafeId: string, oldestJoinDate: string): void
}

export function createMembersRepo(db: AppDatabase): MembersRepo {
  return {
    joinDateOf(cafeId, memberKey) {
      const row = db
        .select()
        .from(members)
        .where(and(eq(members.cafeId, cafeId), eq(members.memberKey, memberKey)))
        .get()
      return row?.joinDate ?? null
    },

    upsertMany(cafeId, batch) {
      if (batch.length === 0) return
      db.transaction((tx) => {
        for (const member of batch) {
          tx.insert(members)
            .values({ cafeId, memberKey: member.memberKey, joinDate: member.joinDate })
            .onConflictDoUpdate({
              target: [members.cafeId, members.memberKey],
              set: { joinDate: member.joinDate },
            })
            .run()
        }
      })
    },

    isEmpty(cafeId) {
      const row = db
        .select({ count: sql<number>`count(*)` })
        .from(members)
        .where(eq(members.cafeId, cafeId))
        .get()
      return (row?.count ?? 0) === 0
    },

    // String comparison is date comparison here: the cafe zero-pads every field.
    prune(cafeId, oldestJoinDate) {
      db.delete(members)
        .where(and(eq(members.cafeId, cafeId), lt(members.joinDate, oldestJoinDate)))
        .run()
    },
  }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run tests/desktop/db/membersRepo.test.ts && pnpm typecheck`
Expected: PASS — 6 tests, 타입 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/desktop/db/schema.ts src/desktop/db/membersRepo.ts tests/desktop/db/membersRepo.test.ts drizzle
git commit -m "feat: store the members this tool watched join"
```

---

### Task 4: `FETCH_MEMBERS` 프로토콜과 확장 구현

앱은 카페에 직접 요청하지 않는다. 세션 쿠키가 브라우저 밖으로 나가지 않아야 하므로 조회도 확장이 대신한다. `PROBE`는 진단용이라 재사용하지 않는다.

**메시지가 늘어나므로 `PROTOCOL_VERSION`을 2로 올린다.** 새 앱이 옛 확장에게 모르는 메시지를 보내면 아무 답도 못 받고 타임아웃까지 기다리게 된다. 버전을 올리면 페어링 단계에서 `PROTOCOL_MISMATCH`로 즉시 걸러진다. 운영자는 확장을 새로 설치해야 한다.

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/extension/cafeClient.ts`
- Modify: `src/extension/background.ts`
- Test: `tests/shared/protocol.test.ts`, `tests/extension/cafeClient.test.ts`

**Interfaces:**
- Consumes: `RawMember`, `memberListUrl`, `parseMemberList` (Task 2)
- Produces: `AppMessage`에 `{ type: 'FETCH_MEMBERS'; requestId: string; cafeId: string; page: number; perPage: number }`, `ExtensionMessage`에 `{ type: 'MEMBERS'; requestId: string; members: RawMember[] | null }`, `CafeClient.fetchMembers(cafeId: string, page: number, perPage: number): Promise<RawMember[] | null>`, `TIMEOUTS.fetchMembersMs`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/protocol.test.ts` 끝에 추가한다:

```ts
describe('member fetch messages', () => {
  it('recognises the app request and the extension answer', () => {
    expect(isAppMessage({ type: 'FETCH_MEMBERS', requestId: 'r1', cafeId: '1', page: 1, perPage: 100 })).toBe(true)
    expect(isExtensionMessage({ type: 'MEMBERS', requestId: 'r1', members: [] })).toBe(true)
  })

  it('does not accept the pair in the wrong direction', () => {
    expect(isExtensionMessage({ type: 'FETCH_MEMBERS', requestId: 'r1' })).toBe(false)
    expect(isAppMessage({ type: 'MEMBERS', requestId: 'r1' })).toBe(false)
  })
})
```

`tests/shared/protocol.test.ts` 상단 import에 `isExtensionMessage`가 없으면 추가한다.

`tests/extension/cafeClient.test.ts` 끝에 추가한다:

```ts
const membersRoute = (page: number, body: string): Route => ({
  match: (r) => r.url.includes('ManageMemberListViewAjax.nhn') && r.url.includes(`search.page=${page}`),
  reply: { status: 200, contentType: 'application/json', text: body },
})

const membersBody = (...records: { memberKey: string; joinDate: string }[]): string =>
  JSON.stringify({ isSuccess: true, result: { members: records } })

describe('fetchMembers', () => {
  it('asks for the requested page and returns what it parsed', async () => {
    const { client, seen } = harness([
      membersRoute(2, membersBody({ memberKey: 'm1', joinDate: '2026.08.23.' })),
    ])
    await expect(client.fetchMembers('10000000', 2, 100)).resolves.toEqual([
      { memberKey: 'm1', joinDate: '2026.08.23.' },
    ])
    expect(seen[0]?.url).toContain('search.clubid=10000000')
    expect(seen[0]?.url).toContain('search.perPage=100')
  })

  it('returns null when the cafe answers with an error status', async () => {
    const { client } = harness([], { status: 500, contentType: null, text: '' })
    await expect(client.fetchMembers('10000000', 1, 100)).resolves.toBeNull()
  })

  it('returns null when staff access is gone and the body is not the list', async () => {
    const { client } = harness([], ok('<html>login</html>'))
    await expect(client.fetchMembers('10000000', 1, 100)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/protocol.test.ts tests/extension/cafeClient.test.ts`
Expected: FAIL — `isAppMessage(...)` 가 `false`, `client.fetchMembers is not a function`

- [ ] **Step 3: 프로토콜을 넓힌다**

`src/shared/protocol.ts`:

```ts
export const PROTOCOL_VERSION = 2
```

`TIMEOUTS`에 추가한다:

```ts
  fetchMembersMs: 15_000,
```

`AppMessage` 유니온에 추가한다:

```ts
  /** Cafe-wide, not board-scoped: a member belongs to the cafe, not a board. */
  | { type: 'FETCH_MEMBERS'; requestId: string; cafeId: string; page: number; perPage: number }
```

`ExtensionMessage` 유니온에 추가한다:

```ts
  /** `null` means the list could not be read, as with `COMMENTS`. */
  | { type: 'MEMBERS'; requestId: string; members: RawMember[] | null }
```

파일 상단에 import를 추가한다:

```ts
import type { RawMember } from './members.js'
```

두 상수 집합에 각각 추가한다:

```ts
const APP_MESSAGE_TYPES = new Set<string>([
  'HELLO_ACK',
  'CHECK_LOGIN',
  'COLLECT',
  'CHECK_COMMENTS',
  'EXECUTE',
  'FETCH_MEMBERS',
  'PROBE',
  'ABORT',
])
const EXTENSION_MESSAGE_TYPES = new Set<string>([
  'HELLO',
  'LOGIN_STATE',
  'COLLECTED',
  'COMMENTS',
  'EXECUTED',
  'MEMBERS',
  'PROBE_RESULT',
  'ERROR',
])
```

- [ ] **Step 4: 확장 클라이언트에 조회를 붙인다**

`src/extension/cafeClient.ts` 상단 import에 추가한다:

```ts
import { memberListUrl, parseMemberList, type RawMember } from '../shared/members.js'
```

`CafeClient` 인터페이스에 추가한다:

```ts
  fetchMembers(cafeId: string, page: number, perPage: number): Promise<RawMember[] | null>
```

`createCafeClient`의 반환 객체에 추가한다:

```ts
    async fetchMembers(cafeId, page, perPage) {
      // Staff-only. Losing staff rights looks like a redirect to a page that is
      // not the list, which the parser reports as a failed read rather than as
      // an empty cafe.
      const response = await deps.http({ url: memberListUrl(cafeId, page, perPage) })
      return response.status === 200 ? parseMemberList(response.text) : null
    },
```

- [ ] **Step 5: 백그라운드 분기를 더한다**

`src/extension/background.ts`의 `dispatch` switch에서 `case 'PROBE':` 앞에 추가한다:

```ts
    case 'FETCH_MEMBERS': {
      const members = await cafe.fetchMembers(message.cafeId, message.page, message.perPage)
      reply({ type: 'MEMBERS', requestId: message.requestId, members })
      return
    }
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run tests/shared/protocol.test.ts tests/extension/cafeClient.test.ts && pnpm typecheck`
Expected: PASS — 새 테스트 5개 포함 전부 통과

- [ ] **Step 7: 확장 매니페스트 테스트가 여전히 통과하는지 본다**

Run: `pnpm vitest run tests/extension/manifest.test.ts`
Expected: PASS — `cookies` 권한이 없다는 감시가 그대로 통과해야 한다. 이번 변경은 권한을 늘리지 않는다.

- [ ] **Step 8: 커밋**

```bash
git add src/shared/protocol.ts src/extension/cafeClient.ts src/extension/background.ts tests/shared/protocol.test.ts tests/extension/cafeClient.test.ts
git commit -m "feat: fetch the member list through the extension session"
```

---

### Task 5: 신입 판정 guard

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/guards.ts`
- Create: `src/shared/automations/welcome-comment/newMember.ts`
- Test: `tests/shared/automations/welcome-comment/newMember.test.ts`, `tests/shared/guards.test.ts`

**Interfaces:**
- Consumes: `kstDayOf`, `joinDateToKstDay` (Task 1), `Guard`/`GuardContext` (기존)
- Produces: `AuthorMembership = { kind: 'JOINED'; joinDate: string } | { kind: 'NOT_TRACKED' }`, `isAutoGeneratedGreeting(post): boolean`, `newMemberGuard: Guard`, `SkipReason`에 `'NOT_NEW_MEMBER'`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/automations/welcome-comment/newMember.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  isAutoGeneratedGreeting,
  newMemberGuard,
} from '../../../../src/shared/automations/welcome-comment/newMember.js'
import type { GuardContext } from '../../../../src/shared/guards.js'
import type { AuthorMembership, Candidate } from '../../../../src/shared/types.js'

/** 2026-08-23 12:00 KST. */
const POSTED_AT = Date.UTC(2026, 7, 23, 3, 0)

const autoGreeting = (nickname: string): string =>
  `${nickname}님이 우리 카페에 가입하였습니다.\n댓글로 ${nickname}님을 환영해주세요.`

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    automationId: 'welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    postId: '1001',
    title: null,
    bodyText: '안녕하세요 잘부탁드립니다',
    authorNickname: '가입자하나',
    authorId: 'member-1',
    postedAt: POSTED_AT,
    ...overrides,
  }
}

function ctx(membership: AuthorMembership, windowDays = 7): GuardContext {
  return {
    nowMs: POSTED_AT,
    operatorAccounts: [],
    existingCommentAuthors: [],
    authorMembership: membership,
    newMemberWindowDays: windowDays,
  }
}

describe('isAutoGeneratedGreeting', () => {
  it('matches the wording naver writes under the joining member', () => {
    expect(isAutoGeneratedGreeting({ bodyText: autoGreeting('가입자하나'), authorNickname: '가입자하나' })).toBe(true)
  })

  // The nickname in the body must be the author's, so copying the wording
  // under a different name does not pass as an auto-generated post.
  it('rejects the wording written under someone else name', () => {
    expect(isAutoGeneratedGreeting({ bodyText: autoGreeting('가입자하나'), authorNickname: '가입자둘' })).toBe(false)
  })

  it('rejects a greeting the member wrote themselves', () => {
    expect(isAutoGeneratedGreeting({ bodyText: '안녕하세요 잘부탁드립니다', authorNickname: '가입자하나' })).toBe(false)
  })

  it('rejects a post with nothing to compare', () => {
    expect(isAutoGeneratedGreeting({ bodyText: null, authorNickname: '가입자하나' })).toBe(false)
    expect(isAutoGeneratedGreeting({ bodyText: autoGreeting('x'), authorNickname: null })).toBe(false)
  })
})

describe('newMemberGuard', () => {
  it('passes an auto-generated post without consulting the table', () => {
    const post = candidate({ bodyText: autoGreeting('가입자하나') })
    expect(newMemberGuard(post, ctx({ kind: 'NOT_TRACKED' }))).toBeNull()
  })

  it('passes a member who joined inside the window', () => {
    expect(newMemberGuard(candidate(), ctx({ kind: 'JOINED', joinDate: '2026.08.23.' }))).toBeNull()
  })

  it('passes a member who joined exactly N days ago', () => {
    expect(newMemberGuard(candidate(), ctx({ kind: 'JOINED', joinDate: '2026.08.16.' }))).toBeNull()
  })

  it('skips a member who joined one day beyond the window', () => {
    expect(newMemberGuard(candidate(), ctx({ kind: 'JOINED', joinDate: '2026.08.15.' }))).toEqual({
      kind: 'SKIP',
      reason: 'NOT_NEW_MEMBER',
    })
  })

  it('skips a self-written greeting from someone the table never saw', () => {
    expect(newMemberGuard(candidate(), ctx({ kind: 'NOT_TRACKED' }))).toEqual({
      kind: 'SKIP',
      reason: 'NOT_NEW_MEMBER',
    })
  })

  it('raises a risk flag when a stored join date is not the shape we store', () => {
    expect(newMemberGuard(candidate(), ctx({ kind: 'JOINED', joinDate: 'garbage' }))).toEqual({
      kind: 'RISK',
      flag: 'STRUCTURE_CHANGED',
    })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/automations/welcome-comment/newMember.test.ts`
Expected: FAIL — `Failed to resolve import ".../newMember.js"`

- [ ] **Step 3: 타입을 넓힌다**

`src/shared/types.ts`의 `SkipReason`을 바꾼다:

```ts
export type SkipReason =
  | 'ALREADY_COMMENTED'
  | 'RISK_FLAGGED'
  | 'REJECTED_BY_OPERATOR'
  | 'NOT_NEW_MEMBER'
```

같은 파일 끝에 추가한다:

```ts
/**
 * What the members table knows about a post's author. `NOT_TRACKED` is an
 * answer, not a gap: the table is only ever filled forward, so a member missing
 * from it joined before the tool started looking. A lookup that could not be
 * performed never reaches a guard — the orchestrator holds that post instead.
 */
export type AuthorMembership = { kind: 'JOINED'; joinDate: string } | { kind: 'NOT_TRACKED' }
```

- [ ] **Step 4: `GuardContext`를 넓힌다**

`src/shared/guards.ts`의 import에 `AuthorMembership`을 더하고 `GuardContext`에 두 줄을 추가한다:

```ts
export interface GuardContext {
  readonly nowMs: number
  /** Every account the cafe staff use, not just the executing one. */
  readonly operatorAccounts: readonly string[]
  /** Authors of comments already on the post. `null` means the check failed. */
  readonly existingCommentAuthors: readonly CommentAuthor[] | null
  /** What the members table knows about this post's author. */
  readonly authorMembership: AuthorMembership
  /** How many days after joining a greeting still counts as a new member's. */
  readonly newMemberWindowDays: number
}
```

- [ ] **Step 5: 판정을 구현한다**

`src/shared/automations/welcome-comment/newMember.ts`:

```ts
import type { Guard, GuardOutcome } from '../../guards.js'
import { joinDateToKstDay, kstDayOf } from '../../kst.js'

/**
 * Naver writes this under the joining member's own name the moment they are
 * admitted, so its presence is proof of a new member and needs no lookup. The
 * cafe manager cannot change the wording — the only welcome text the admin
 * screens expose is the one shown on the join confirmation page, not this.
 */
function autoGreetingText(nickname: string): string {
  return `${nickname}님이 우리 카페에 가입하였습니다.\n댓글로 ${nickname}님을 환영해주세요.`
}

/**
 * Compared as whole strings rather than matched by pattern. A nickname may hold
 * regex metacharacters, and requiring the body's nickname to be the author's
 * own means the wording cannot be borrowed under another name.
 *
 * The comparison is against the normalised body: the page stores spaces as
 * `&nbsp;` and breaks as `<br>`, and `parseMemoList` has already turned those
 * into ordinary spaces and newlines.
 */
export function isAutoGeneratedGreeting(post: {
  readonly bodyText: string | null
  readonly authorNickname: string | null
}): boolean {
  if (post.bodyText === null || post.authorNickname === null) return false
  return post.bodyText === autoGreetingText(post.authorNickname)
}

/**
 * Greets only members who joined recently. Join dates carry no time, so the
 * window is counted in whole KST calendar days and never in hours.
 */
export const newMemberGuard: Guard = (candidate, ctx): GuardOutcome => {
  if (isAutoGeneratedGreeting(candidate)) return null
  if (ctx.authorMembership.kind === 'NOT_TRACKED') {
    return { kind: 'SKIP', reason: 'NOT_NEW_MEMBER' }
  }
  const joinDay = joinDateToKstDay(ctx.authorMembership.joinDate)
  // The parser only stores dates it could read, so this means the stored shape
  // changed under us rather than that the member is old.
  if (joinDay === null) return { kind: 'RISK', flag: 'STRUCTURE_CHANGED' }

  const postDay = kstDayOf(candidate.postedAt)
  return postDay - joinDay <= ctx.newMemberWindowDays
    ? null
    : { kind: 'SKIP', reason: 'NOT_NEW_MEMBER' }
}
```

- [ ] **Step 6: 기존 guard 테스트의 컨텍스트를 채운다**

`tests/shared/guards.test.ts`의 `ctx()` 기본값에 새 필드 두 개를 더한다. 기존 검증은 그대로 둔다.

```ts
function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    nowMs: 1_700_000_100_000,
    operatorAccounts: ['cafe-ops'],
    existingCommentAuthors: [],
    authorMembership: { kind: 'JOINED', joinDate: '2026.08.23.' },
    newMemberWindowDays: 7,
    ...overrides,
  }
}
```

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm vitest run tests/shared && pnpm typecheck`
Expected: PASS — 새 테스트 10개 포함, 기존 guard 테스트 전부 통과

- [ ] **Step 8: 커밋**

```bash
git add src/shared/types.ts src/shared/guards.ts src/shared/automations/welcome-comment/newMember.ts tests/shared/automations/welcome-comment/newMember.test.ts tests/shared/guards.test.ts
git commit -m "feat: judge whether a greeting belongs to a new member"
```

---

### Task 6: 작성자 기준 중복 환영 방지

한 회원이 자동 생성 글과 직접 쓴 인사글을 둘 다 가지면 글 ID가 달라 둘 다 선점되고 댓글이 두 번 나간다. 작성자 확인을 `claim` 안에 넣어 막는다.

**유니크 인덱스를 쓰지 않는다.** 기존 행에 같은 작성자가 둘 이상 있으면 인덱스 생성이 실패하고, 통과시키려면 이미 댓글이 나간 `SUCCESS` 이력을 지워야 한다. 규칙 하나와 실행 이력을 맞바꾸지 않는다.

**Files:**
- Modify: `src/desktop/db/schema.ts`
- Modify: `src/desktop/db/dedupeStore.ts`
- Create: `drizzle/<생성된 이름>.sql`
- Test: `tests/desktop/db/dedupeStore.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `claim`의 동작 변경. 시그니처는 그대로 `claim(input: ClaimInput): Promise<string | null>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/desktop/db/dedupeStore.test.ts`에 추가한다:

```ts
it('claims only the first post from an author, whichever post it is', async () => {
  const store = createSqliteDedupeStore(db, () => randomUUID())
  const first = await store.claim({ ...input, postId: '1001', authorId: 'member-1' })
  const second = await store.claim({ ...input, postId: '1002', authorId: 'member-1' })
  expect(first).not.toBeNull()
  expect(second).toBeNull()
})

it('still claims a different author on the same board', async () => {
  const store = createSqliteDedupeStore(db, () => randomUUID())
  await store.claim({ ...input, postId: '1001', authorId: 'member-1' })
  await expect(store.claim({ ...input, postId: '1002', authorId: 'member-2' })).resolves.not.toBeNull()
})

// Posts whose author link could not be read must not collide with each other.
it('claims posts with no author id independently', async () => {
  const store = createSqliteDedupeStore(db, () => randomUUID())
  await store.claim({ ...input, postId: '1001', authorId: null })
  await expect(store.claim({ ...input, postId: '1002', authorId: null })).resolves.not.toBeNull()
})

it('keeps authors of different cafes apart', async () => {
  const store = createSqliteDedupeStore(db, () => randomUUID())
  await store.claim({ ...input, postId: '1001', authorId: 'member-1' })
  await expect(
    store.claim({ ...input, cafeId: '99999', postId: '1001', authorId: 'member-1' }),
  ).resolves.not.toBeNull()
})
```

파일 상단 import에 `randomUUID`가 없으면 `import { randomUUID } from 'node:crypto'`를 추가한다. 기존 테스트가 이미 스토어를 만드는 방식이 있으면 그것을 따른다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/db/dedupeStore.test.ts`
Expected: FAIL — 두 번째 `claim`이 `null`이 아니라 새 id를 돌려준다

- [ ] **Step 3: 조회용 인덱스를 더한다**

`src/desktop/db/schema.ts`의 `executions` 정의에서 인덱스 배열에 추가한다. `index`를 `drizzle-orm/sqlite-core` import 목록에 더한다.

```ts
  (table) => [
    // cafe_id belongs in the key: post ids are numbered per cafe, so without it
    // cafe A's post 1001 and cafe B's post 1001 collide.
    uniqueIndex('executions_cafe_automation_post_unique').on(
      table.cafeId,
      table.automationId,
      table.targetPostId,
    ),
    // Not unique on purpose. `claim` enforces one greeting per author; making
    // the database enforce it would mean deleting rows that already carry a
    // posted comment before the index could be created.
    index('executions_cafe_automation_author').on(
      table.cafeId,
      table.automationId,
      table.targetAuthorId,
    ),
  ],
```

- [ ] **Step 4: 마이그레이션을 생성한다**

Run: `pnpm db:generate && ls drizzle`
Expected: 새 `.sql` 파일에 `CREATE INDEX` 하나만 있다. `DROP` 이나 `DELETE` 문장이 있으면 안 된다 — 있으면 멈추고 보고한다.

- [ ] **Step 5: `claim`을 트랜잭션으로 바꾼다**

`src/desktop/db/dedupeStore.ts`의 import에 `and`, `eq`를 더하고, `claim` 본문을 바꾼다:

```ts
    async claim(input: ClaimInput): Promise<string | null> {
      const id = newId()
      try {
        // One transaction so the author check and the insert cannot interleave.
        // The post id index still guards against the same post twice.
        const claimed = db.transaction((tx) => {
          if (input.authorId !== null) {
            const existing = tx
              .select({ id: executions.id })
              .from(executions)
              .where(
                and(
                  eq(executions.cafeId, input.cafeId),
                  eq(executions.automationId, input.automationId),
                  eq(executions.targetAuthorId, input.authorId),
                ),
              )
              .get()
            // Already greeted this member on another post of theirs.
            if (existing !== undefined) return null
          }
          tx.insert(executions)
            .values({
              id,
              automationId: input.automationId,
              cafeId: input.cafeId,
              boardId: input.boardId,
              targetPostId: input.postId,
              targetTitle: input.title,
              targetAuthor: input.authorNickname,
              targetAuthorId: input.authorId,
              targetPostedAt: input.postedAt,
              actorAccount: null,
              // Parked until the policy engine decides; the orchestrator moves it
              // to QUEUED or SKIPPED in the same session.
              status: 'AWAITING_APPROVAL',
              strategy: null,
              riskFlags: '[]',
              reason: null,
              templateId: null,
              renderedText: null,
              attempts: 0,
              detectedAt: input.detectedAt,
              executedAt: null,
              resolvedAt: null,
              deletedAt: null,
            })
            .run()
          return id
        })
        return claimed
      } catch (error) {
        if (isUniqueViolation(error)) return null
        throw error
      }
    },
```

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run tests/desktop/db && pnpm typecheck`
Expected: PASS — 새 테스트 4개 포함, 기존 dedupe 테스트 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add src/desktop/db/schema.ts src/desktop/db/dedupeStore.ts tests/desktop/db/dedupeStore.test.ts drizzle
git commit -m "fix: greet a member once even when they have two greeting posts"
```

---

### Task 7: 멤버십 리졸버

표를 갱신하고 후보의 작성자를 판정한다. 갱신에 실패하면 판정할 수 없는 후보를 `'DEFER'`로 표시해 오케스트레이터가 보류하게 한다.

갱신 규칙 셋이 여기에 모여 있다.

- **표가 비어 있으면 1페이지만 읽고 멈춘다.** 도구가 보기 시작하기 전에 가입한 사람은 소급해서 받지 않는다. 글 워터마크가 설치 이전 글을 보지 않는 것과 같은 원칙이고, `cafeClient.collect`가 첫 수집에서 한 페이지만 읽는 것과 같은 관용구다.
- **아는 `memberKey`가 한 명이라도 보이면 멈춘다.** 세션 주기가 45~75분이라 평소에는 1페이지에서 끝난다. 저장하기 *전에* 확인해야 한다 — 저장한 뒤에는 전부 아는 사람이 된다.
- **20페이지가 상한이다.** 오래 쉰 뒤의 복귀가 카페 전체를 걷지 않게 한다.

정리는 갱신에 성공했을 때만 한다. 실패한 세션에서 지우면 표가 얇아진 채로 다음 판정에 들어간다.

**Files:**
- Create: `src/desktop/membership.ts`
- Test: `tests/desktop/membership.test.ts`

**Interfaces:**
- Consumes: `MembersRepo` (Task 3), `MEMBER_PAGE_SIZE`/`RawMember` (Task 2), `kstDayOf`/`kstDayToJoinDate` (Task 1), `isAutoGeneratedGreeting` (Task 5), `ExtensionTransport` (기존)
- Produces: `MembershipResolver = (raw: RawCandidate) => AuthorMembership | 'DEFER'`, `createMembershipResolver(deps: MembershipDeps): Promise<MembershipResolver>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/desktop/membership.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createMembershipResolver } from '../../src/desktop/membership.js'
import type { MembersRepo } from '../../src/desktop/db/membersRepo.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import type { RawMember } from '../../src/shared/members.js'

const CAFE = '10000000'
/** 2026-08-23 12:00 KST. */
const NOW = Date.UTC(2026, 7, 23, 3, 0)

const autoGreeting = (nickname: string): string =>
  `${nickname}님이 우리 카페에 가입하였습니다.\n댓글로 ${nickname}님을 환영해주세요.`

function raw(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    postId: '1001',
    title: null,
    bodyText: '안녕하세요 잘부탁드립니다',
    authorNickname: '가입자하나',
    authorId: 'member-1',
    postedAt: NOW,
    existingCommentAuthors: [],
    ...overrides,
  }
}

/** An in-memory stand-in with the same contract as the sqlite repo. */
function fakeRepo(seed: Record<string, string> = {}): MembersRepo & { rows: Map<string, string> } {
  const rows = new Map(Object.entries(seed))
  return {
    rows,
    joinDateOf: (_cafeId, memberKey) => rows.get(memberKey) ?? null,
    upsertMany: (_cafeId, batch) => {
      for (const m of batch) rows.set(m.memberKey, m.joinDate)
    },
    isEmpty: () => rows.size === 0,
    prune: (_cafeId, oldest) => {
      for (const [key, date] of rows) if (date < oldest) rows.delete(key)
    },
  }
}

function transportReturning(pages: (RawMember[] | null)[]) {
  const asked: AppMessage[] = []
  return {
    asked,
    isConnected: () => true,
    request: (message: AppMessage): Promise<ExtensionMessage> => {
      asked.push(message)
      const page = message.type === 'FETCH_MEMBERS' ? message.page : 1
      const members = pages[page - 1] ?? []
      return Promise.resolve({ type: 'MEMBERS', requestId: 'r', members } as ExtensionMessage)
    },
  }
}

const deps = (over: Partial<Parameters<typeof createMembershipResolver>[0]>) => ({
  cafeId: CAFE,
  windowDays: 7,
  nowMs: NOW,
  newRequestId: () => 'r',
  repo: fakeRepo(),
  transport: transportReturning([[]]),
  ...over,
})

describe('createMembershipResolver', () => {
  it('reads only one page on the very first run', async () => {
    const transport = transportReturning([
      [{ memberKey: 'member-1', joinDate: '2026.08.23.' }],
      [{ memberKey: 'member-9', joinDate: '2026.08.22.' }],
    ])
    await createMembershipResolver(deps({ transport, repo: fakeRepo() }))
    expect(transport.asked).toHaveLength(1)
  })

  it('stops once a page holds a member it already knows', async () => {
    const transport = transportReturning([
      [{ memberKey: 'known', joinDate: '2026.08.23.' }],
      [{ memberKey: 'member-9', joinDate: '2026.08.22.' }],
    ])
    await createMembershipResolver(deps({ transport, repo: fakeRepo({ known: '2026.08.23.' }) }))
    expect(transport.asked).toHaveLength(1)
  })

  it('keeps paging while every member on the page is new', async () => {
    const transport = transportReturning([
      [{ memberKey: 'a', joinDate: '2026.08.23.' }],
      [{ memberKey: 'known', joinDate: '2026.08.22.' }],
    ])
    await createMembershipResolver(deps({ transport, repo: fakeRepo({ known: '2026.08.22.' }) }))
    expect(transport.asked).toHaveLength(2)
  })

  it('reports the join date it stored', async () => {
    const repo = fakeRepo({ 'member-1': '2026.08.20.' })
    const resolve = await createMembershipResolver(deps({ repo }))
    expect(resolve(raw())).toEqual({ kind: 'JOINED', joinDate: '2026.08.20.' })
  })

  it('calls a member the table never saw not tracked', async () => {
    const resolve = await createMembershipResolver(deps({ repo: fakeRepo({ other: '2026.08.23.' }) }))
    expect(resolve(raw())).toEqual({ kind: 'NOT_TRACKED' })
  })

  it('defers a self-written greeting when the refresh failed', async () => {
    const transport = {
      isConnected: () => true,
      request: () => Promise.resolve({ type: 'MEMBERS', requestId: 'r', members: null } as ExtensionMessage),
    }
    const resolve = await createMembershipResolver(deps({ transport, repo: fakeRepo({ x: '2026.08.23.' }) }))
    expect(resolve(raw())).toBe('DEFER')
  })

  it('never defers an auto-generated post, because it needs no lookup', async () => {
    const transport = {
      isConnected: () => true,
      request: () => Promise.resolve({ type: 'MEMBERS', requestId: 'r', members: null } as ExtensionMessage),
    }
    const resolve = await createMembershipResolver(deps({ transport, repo: fakeRepo({ x: '2026.08.23.' }) }))
    expect(resolve(raw({ bodyText: autoGreeting('가입자하나') }))).toEqual({ kind: 'NOT_TRACKED' })
  })

  it('prunes members older than the window plus a day', async () => {
    const repo = fakeRepo({ stale: '2026.08.14.', edge: '2026.08.15.', fresh: '2026.08.23.' })
    await createMembershipResolver(deps({ repo }))
    expect(repo.rows.has('stale')).toBe(false)
    expect(repo.rows.has('edge')).toBe(true)
    expect(repo.rows.has('fresh')).toBe(true)
  })

  it('does not prune when the refresh failed', async () => {
    const transport = {
      isConnected: () => true,
      request: () => Promise.resolve({ type: 'MEMBERS', requestId: 'r', members: null } as ExtensionMessage),
    }
    const repo = fakeRepo({ stale: '2026.08.01.' })
    await createMembershipResolver(deps({ transport, repo }))
    expect(repo.rows.has('stale')).toBe(true)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/membership.test.ts`
Expected: FAIL — `Failed to resolve import ".../membership.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/desktop/membership.ts`:

```ts
import { isAutoGeneratedGreeting } from '../shared/automations/welcome-comment/newMember.js'
import { kstDayOf, kstDayToJoinDate } from '../shared/kst.js'
import { MEMBER_PAGE_SIZE } from '../shared/members.js'
import { TIMEOUTS, type RawCandidate } from '../shared/protocol.js'
import type { AuthorMembership } from '../shared/types.js'
import type { MembersRepo } from './db/membersRepo.js'
import type { ExtensionTransport } from './ws/server.js'

/**
 * A long outage is the only thing that walks past a page or two. The cafe has
 * hundreds of thousands of members, so the walk needs a floor.
 */
const MAX_PAGES = 20

export interface MembershipDeps {
  readonly transport: ExtensionTransport
  readonly repo: MembersRepo
  readonly cafeId: string
  readonly windowDays: number
  readonly nowMs: number
  readonly newRequestId: () => string
}

/**
 * `'DEFER'` means the answer is unknown this session, not that the author is
 * old. The orchestrator holds such a post and leaves the watermark where it is.
 */
export type MembershipResolver = (raw: RawCandidate) => AuthorMembership | 'DEFER'

async function fetchPage(deps: MembershipDeps, page: number) {
  try {
    const reply = await deps.transport.request(
      {
        type: 'FETCH_MEMBERS',
        requestId: deps.newRequestId(),
        cafeId: deps.cafeId,
        page,
        perPage: MEMBER_PAGE_SIZE,
      },
      TIMEOUTS.fetchMembersMs,
    )
    return reply.type === 'MEMBERS' ? reply.members : null
  } catch {
    return null
  }
}

/**
 * Fills the table forward from the newest joins. The first run takes one page
 * and stops: the tool does not reach back for people who joined before it
 * started looking, exactly as the post watermark does not reach back for older
 * posts. Later runs stop as soon as a page holds somebody already stored.
 */
async function refresh(deps: MembershipDeps): Promise<boolean> {
  const firstRun = deps.repo.isEmpty(deps.cafeId)

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const members = await fetchPage(deps, page)
    if (members === null) return false
    if (members.length === 0) return true

    // Checked before storing, or every member would look already known.
    const reachedKnown = members.some(
      (member) => deps.repo.joinDateOf(deps.cafeId, member.memberKey) !== null,
    )
    deps.repo.upsertMany(deps.cafeId, members)

    if (firstRun || reachedKnown) return true
  }
  return true
}

export async function createMembershipResolver(deps: MembershipDeps): Promise<MembershipResolver> {
  const fresh = await refresh(deps)

  if (fresh) {
    // One day beyond the window: the backlog brake lets yesterday's posts
    // through, and judging one needs the people who joined a day earlier still.
    deps.repo.prune(deps.cafeId, kstDayToJoinDate(kstDayOf(deps.nowMs) - (deps.windowDays + 1)))
  }

  return (raw) => {
    if (raw.authorId !== null) {
      const joinDate = deps.repo.joinDateOf(deps.cafeId, raw.authorId)
      if (joinDate !== null) return { kind: 'JOINED', joinDate }
    }
    // The wording alone proves a new member, so a failed refresh cannot hold
    // these back.
    if (isAutoGeneratedGreeting(raw)) return { kind: 'NOT_TRACKED' }
    return fresh ? { kind: 'NOT_TRACKED' } : 'DEFER'
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/desktop/membership.test.ts && pnpm typecheck`
Expected: PASS — 9 tests

- [ ] **Step 5: 커밋**

```bash
git add src/desktop/membership.ts tests/desktop/membership.test.ts
git commit -m "feat: resolve whether a greeting author joined recently"
```

---

### Task 8: 오케스트레이터·세션 통합

**Files:**
- Modify: `src/desktop/orchestrator.ts`
- Modify: `src/desktop/session.ts`
- Modify: `src/desktop/bootstrap.ts`
- Test: `tests/desktop/orchestrator.test.ts`, `tests/desktop/session.test.ts`

**Interfaces:**
- Consumes: `MembershipResolver` (Task 7), `newMemberGuard` (Task 5), `createMembersRepo` (Task 3)
- Produces: `SessionDeps`에 `resolveMembership: MembershipResolver`, `newMemberWindowDays: number`. `AppRepos`에 `members: MembersRepo`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/desktop/orchestrator.test.ts`에 추가한다. 이 파일의 기존 헬퍼를 그대로 쓴다 — 후보는 `fakeTransport({ candidates })`로 넣고, `deps()`가 나머지를 채운다.

```ts
it('holds the watermark when a candidate could not be judged', async () => {
  const transport = fakeTransport({ candidates: [candidate('1001'), candidate('1002')] })
  const outcome = await runSession(
    deps({
      transport,
      resolveMembership: (raw) => (raw.postId === '1002' ? 'DEFER' : { kind: 'NOT_TRACKED' }),
    }),
  )
  // Nothing advances while a post is still owed a decision, so the next session
  // collects the same range again and claim keeps that idempotent.
  expect(outcome).toMatchObject({ opened: true, lastProcessedPostId: null })
})

it('advances the watermark when every candidate was judged', async () => {
  const transport = fakeTransport({ candidates: [candidate('1001'), candidate('1002')] })
  const outcome = await runSession(
    deps({ transport, resolveMembership: () => ({ kind: 'NOT_TRACKED' }) }),
  )
  expect(outcome).toMatchObject({ opened: true, lastProcessedPostId: '1002' })
})

it('does nothing at all with a deferred post', async () => {
  const transport = fakeTransport({ candidates: [candidate('1001')] })
  const outcome = await runSession(deps({ transport, resolveMembership: () => 'DEFER' }))
  expect(outcome).toMatchObject({
    opened: true,
    executed: 0,
    skipped: 0,
    awaitingApproval: 0,
    lastProcessedPostId: null,
  })
})
```

`deps()` 기본값에 두 줄을 더한다. 기본 판정을 `NOT_TRACKED`로 두어도 이 파일의 다른 테스트는 영향을 받지 않는다 — `deps()`의 `guards`가 `[operatorAlreadyCommentedGuard]`뿐이라 `newMemberGuard`가 돌지 않는다.

```ts
    resolveMembership: () => ({ kind: 'NOT_TRACKED' }),
    newMemberWindowDays: 7,
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/orchestrator.test.ts`
Expected: FAIL — `resolveMembership` 이 `SessionDeps`에 없다는 타입 에러, 또는 워터마크가 `'1002'`로 전진

- [ ] **Step 3: `SessionDeps`를 넓힌다**

`src/desktop/orchestrator.ts`의 `SessionDeps`에 추가한다. import에 `MembershipResolver`를 더한다.

```ts
  /** Decides whether a post's author is a member this tool watched join. */
  readonly resolveMembership: MembershipResolver
  readonly newMemberWindowDays: number
```

- [ ] **Step 4: 보류를 구현한다**

`lastProcessedPostId` 선언 옆에 추가한다:

```ts
  /**
   * Set when a post could not be judged this session. The watermark is a single
   * high-water mark, so advancing past a held post would lose it: the whole
   * session's advance is withheld instead.
   */
  let deferred = false
```

`summary()`의 마지막 줄을 바꾼다:

```ts
    lastProcessedPostId: deferred ? null : lastProcessedPostId,
```

수집 루프 맨 앞을 바꾼다. `lastProcessedPostId` 전진보다 **먼저** 판정한다:

```ts
  for (const raw of raws) {
    const membership = deps.resolveMembership(raw)
    if (membership === 'DEFER') {
      deferred = true
      continue
    }

    const now = deps.clock.now()

    // Advance per post handled, not once after collection: if the app dies
    // mid-session, a collection-time advance would skip everything in between.
    lastProcessedPostId = laterPostId(lastProcessedPostId, raw.postId)
```

`evaluateGuards` 호출에 두 필드를 더한다:

```ts
    const guardEvaluation = evaluateGuards(deps.guards, candidate, {
      nowMs: now,
      operatorAccounts: deps.operatorAccounts,
      existingCommentAuthors: raw.existingCommentAuthors,
      authorMembership: membership,
      newMemberWindowDays: deps.newMemberWindowDays,
    })
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm vitest run tests/desktop/orchestrator.test.ts`
Expected: PASS — 새 테스트 3개 포함 전부 통과

- [ ] **Step 6: 저장소를 배선한다**

`src/desktop/bootstrap.ts`의 `AppRepos`에 `members: MembersRepo`를 더하고, 다른 저장소를 만드는 자리 옆에서 `createMembersRepo(db)`로 채운다.

- [ ] **Step 7: 세션을 배선한다**

`src/desktop/session.ts`:

```ts
export const SETTING_KEYS = {
  cafeId: 'cafeId',
  cafeUrlName: 'cafeUrlName',
  operatorAccounts: 'operatorAccounts',
  newMemberWindowDays: 'newMemberWindowDays',
} as const

/** How long after joining a greeting still counts as a new member's. */
export const DEFAULT_NEW_MEMBER_WINDOW_DAYS = 7
```

설정값을 읽는 헬퍼를 더한다. 잘못된 값은 조용히 기본값으로 돌아간다:

```ts
export function parseWindowDays(raw: string | undefined): number {
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_NEW_MEMBER_WINDOW_DAYS
}
```

`run()` 안에서 `runSession` 호출 전에 리졸버를 만든다:

```ts
    const windowDays = parseWindowDays(settings.get(SETTING_KEYS.newMemberWindowDays))
    const resolveMembership = await createMembershipResolver({
      transport: options.transport,
      repo: repos.members,
      cafeId: cafe,
      windowDays,
      nowMs: options.clock.now(),
      newRequestId: options.newId,
    })
```

`runSession(...)` 인자에 더한다:

```ts
      resolveMembership,
      newMemberWindowDays: windowDays,
```

guard 목록에 `newMemberGuard`를 더한다. import를 추가한다:

```ts
import { newMemberGuard } from '../shared/automations/welcome-comment/newMember.js'
```

`guards`를 넘기는 자리에서 `[operatorAlreadyCommentedGuard, newMemberGuard]`가 되게 한다.

- [ ] **Step 8: 전체 테스트와 타입, 빌드를 확인한다**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS — 전부 통과.

`tests/desktop/session.test.ts`는 두 가지 이유로 손봐야 한다. 첫째, 트랜스포트 스텁이 `FETCH_MEMBERS`에 답하지 않으면 리졸버가 실패로 보고 후보를 보류한다 — `{ type: 'MEMBERS', requestId, members: [] }`를 돌려주게 한다. 둘째, **세션이 조립하는 guard 목록에는 이제 `newMemberGuard`가 들어 있다.** 실행을 기대하는 테스트의 후보는 그 guard를 통과해야 하므로, 본문을 자동 생성 문구로 바꾼다:

```ts
bodyText: `${nickname}님이 우리 카페에 가입하였습니다.\n댓글로 ${nickname}님을 환영해주세요.`
```

실제 게시판에서도 이쪽이 대다수다(설계 문서 §3.4의 실측에서 5/5).

- [ ] **Step 9: 커밋**

```bash
git add src/desktop/orchestrator.ts src/desktop/session.ts src/desktop/bootstrap.ts tests/desktop
git commit -m "feat: greet only members this tool watched join"
```

---

## 마무리 확인

- [ ] `pnpm test` 전부 통과
- [ ] `pnpm typecheck` 에러 없음
- [ ] `pnpm lint` 경고 없음
- [ ] 새로 만든 마이그레이션 두 개에 `DROP`·`DELETE` 문장이 없다
- [ ] `tests/fixtures/member-list.json`에 실제 회원 정보가 없다
- [ ] `PROTOCOL_VERSION`이 2다. **운영자는 확장을 다시 설치해야 한다** — 릴리스 노트에 적는다

---

### Task 9: 환영 문구 입력을 여러 줄로

문구 입력이 `<input>`이라 줄바꿈을 넣을 수 없다. 네이버가 쓰는 자동 생성 인사도 두 줄이고, 환영 댓글도 두 줄 이상이 자연스럽다.

**Enter의 의미가 바뀐다.** 지금은 Enter가 등록인데, 여러 줄 입력에서는 Enter가 줄바꿈이어야 한다. 등록은 버튼과 `⌘/Ctrl+Enter`로 옮긴다.

**Files:**
- Create: `src/renderer/views/templateInput.ts`
- Modify: `src/renderer/views/Templates.tsx`
- Modify: `src/renderer/locales/ko.ts`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer/templateInput.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `isSubmitKey(event: SubmitKeyEvent): boolean`

이 저장소에는 컴포넌트를 렌더링하는 테스트 하네스가 없다(`tests/renderer`는 전부 순수 모듈 테스트다). 테스트 라이브러리를 새로 들이지 않고, **판단이 있는 부분만 순수 함수로 빼서** 테스트한다. 나머지는 마크업 교체라 눈으로 확인한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/renderer/templateInput.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isSubmitKey } from '../../src/renderer/views/templateInput.js'

const key = (over: Partial<Parameters<typeof isSubmitKey>[0]> = {}) => ({
  key: 'Enter',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
})

describe('isSubmitKey', () => {
  it('submits on Cmd+Enter and Ctrl+Enter', () => {
    expect(isSubmitKey(key({ metaKey: true }))).toBe(true)
    expect(isSubmitKey(key({ ctrlKey: true }))).toBe(true)
  })

  // Plain Enter has to reach the textarea, or a multi-line greeting cannot be
  // typed at all.
  it('leaves a plain Enter to the textarea', () => {
    expect(isSubmitKey(key())).toBe(false)
    expect(isSubmitKey(key({ shiftKey: true }))).toBe(false)
  })

  it('ignores other keys even with a modifier', () => {
    expect(isSubmitKey(key({ key: 'a', metaKey: true }))).toBe(false)
    expect(isSubmitKey(key({ key: 'Escape', ctrlKey: true }))).toBe(false)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/renderer/templateInput.test.ts`
Expected: FAIL — `Failed to resolve import ".../templateInput.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/renderer/views/templateInput.ts`:

```ts
/**
 * Only the parts of a keyboard event this decision needs, so the rule can be
 * tested without a DOM.
 */
export interface SubmitKeyEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

/**
 * A greeting may span lines, so a plain Enter belongs to the textarea and
 * submitting moves to the modifier — the convention every chat box uses.
 */
export function isSubmitKey(event: SubmitKeyEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey)
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/renderer/templateInput.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: 입력을 `textarea`로 바꾼다**

`src/renderer/views/Templates.tsx`의 import에 더한다:

```ts
import { isSubmitKey } from './templateInput.js'
```

`<input …/>` 블록을 통째로 바꾼다:

```tsx
        <textarea
          className="field field-multiline"
          value={draft}
          rows={3}
          placeholder={t('templates.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e)) {
              e.preventDefault()
              submit()
            }
          }}
        />
```

감싼 `div`의 정렬을 바꾼다. 버튼이 여러 줄 입력의 세로 가운데에 붙으면 어색하므로 위에 맞춘다:

```tsx
      <div className="flex items-start gap-2">
```

등록된 문구도 줄바꿈이 보여야 한다. 목록 항목의 `span`을 바꾼다:

```tsx
              <span className="text-sm whitespace-pre-wrap">{template.body}</span>
```

- [ ] **Step 6: 안내 문구를 더한다**

`src/renderer/locales/ko.ts`의 `templates`에 한 줄 더한다:

```ts
      hint: '여러 개를 등록하면 매번 무작위로 하나를 고릅니다. {닉네임}을 쓸 수 있습니다.',
      submitHint: '줄바꿈은 Enter, 등록은 ⌘/Ctrl+Enter 또는 추가 버튼입니다.',
```

`Templates.tsx`의 헤더 `<p>` 바로 뒤에 한 줄을 더한다:

```tsx
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('templates.submitHint')}
        </p>
```

- [ ] **Step 7: 스타일을 더한다**

`src/renderer/styles.css`의 `.field:focus` 규칙 뒤에 더한다. `.field`가 이미 여백·테두리·색을 주므로 여러 줄에 필요한 것만 얹는다:

```css
.field-multiline {
  resize: vertical;
  min-height: 4.5rem;
  font-family: inherit;
  line-height: 1.5;
}
```

- [ ] **Step 8: 전체 테스트와 타입, 빌드를 확인한다**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:renderer`
Expected: PASS — 전부 통과

- [ ] **Step 9: 눈으로 확인한다**

Run: `pnpm start`

확인할 것:
1. 문구 화면에서 Enter를 치면 **줄이 바뀐다**
2. `⌘Enter`(mac) 또는 `Ctrl+Enter`로 등록된다
3. 등록된 여러 줄 문구가 목록에서 **줄바꿈을 유지한 채** 보인다
4. 입력창을 세로로 늘릴 수 있다
5. 밝은 테마와 어두운 테마 모두에서 어색하지 않다

- [ ] **Step 10: 커밋**

```bash
git add src/renderer/views/templateInput.ts src/renderer/views/Templates.tsx src/renderer/locales/ko.ts src/renderer/styles.css tests/renderer/templateInput.test.ts
git commit -m "feat: let a welcome greeting span multiple lines"
```
