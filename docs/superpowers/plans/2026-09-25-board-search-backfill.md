# Board Search Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the ~34,000 posts of board 137 (국내구입기) that fall behind the cafe's 1000-page list horizon, by walking the cafe's title search with ~300 queries picked from the titles already stored.

**Architecture:** A new collection job `boardSearch` beside `articles`, `members` and `memberResync`, with its own table `board_search_state` (one row per query). A pure dictionary picks the queries greedily. The extension reads one search page per request (`COLLECT_BOARD_SEARCH_PAGE`), the desktop runner walks the queries in a block with the shared page budget, and every page goes through the same `posts` upsert as the list walk.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Electron main + React renderer, Chrome MV3 extension, PostgreSQL via drizzle-orm / drizzle-kit, vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-board-search-backfill-design.md` — read it before any task. Section numbers below (§n) refer to it.

## Global Constraints

- Times are shown and computed in KST only. The only offset is `KST_OFFSET_MS` in `src/shared/kst.ts`; never `toLocaleString` with a zone, never `getHours()` (project `CLAUDE.md`).
- Korean only, but every user-facing string lives in `src/shared/text.ts`; strings that take values are functions (project `CLAUDE.md`).
- Code and comments in English; comment density and voice match the surrounding file.
- No TODO comments, no placeholders, no `test.skip`/`.only`.
- New behaviour goes in new files; existing files change only where the plan says.
- Commit messages: `<type>: <description>`, no AI attribution, no `Co-Authored-By` (user `CLAUDE.md` overrides the harness default).
- Never `git checkout <file>` / `git restore` / `git reset` to undo; reverse edits by hand.
- `PROTOCOL_VERSION` 11 → 12 means the app and the extension must be repackaged together (memory `repackage-after-protocol-bump`).
- The production app is running on this machine. Never start a second instance; verify UI with the renderer preview (memory `renderer-preview-without-electron`).
- The collection DB is migrated by hand with the app quit (memory `collection-migration-before-app`). Do not run the migration against `whisky_manager_collection` during implementation.
- Constants: `BOARD_SEARCH_QUERY_LIMIT = 300`, `BOARD_SEARCH_MIN_GAIN = 5`, `BOARD_SEARCH_CANDIDATE_LIMIT = 4000`, `perPage = 50`, `searchBy = '1'`, `views = 'MEMBER_LEVEL,COUNT,SALE_INFO,CAFE_MENU'`, header `x-cafe-product: pc`, host `https://apis.cafe.naver.com`.

## Verification commands

- Unit tests: `pnpm test` (all) or `pnpm vitest run <path>` (one file).
- Types: `pnpm typecheck`. Lint: `pnpm lint`.
- DB integration (opt-in): `COLLECTION_TEST_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection_test pnpm test:collection:integration`. The database must exist and be empty; if it does not exist, ask the operator before creating it.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/desktop/collection-db/postPageWrite.ts` | create | The one `boards` + `posts` upsert both walks share |
| `src/desktop/collection-db/repository.ts` | modify | Use `writePostRows` instead of its inline upsert |
| `src/shared/kst.ts` | modify | `kstDayKey`, `isKstDayKey`, `kstDayKeyRange`, `kstLocalDateTimeToEpochMs` |
| `src/shared/boardSearchDictionary.ts` | create | Pure greedy query picker |
| `src/shared/cafeArticleList.ts` | modify | Export the small readers, `parsePageInfo`, new `collectedArticlePage` |
| `src/shared/cafeBoardSearchList.ts` | create | Search response → `CollectedArticlePage` |
| `src/shared/cafeBoardSearchEndpoint.ts` | create | Search URL, query rule, headers, referer |
| `src/shared/protocol.ts` | modify | `COLLECT_BOARD_SEARCH_PAGE`, version 12 |
| `src/extension/manifest.json` | modify | Host permission `apis.cafe.naver.com` |
| `src/extension/refererRule.ts` | modify | Rule 4 for the search path |
| `src/extension/boardSearchPageReader.ts` | create | Reads exactly one search page |
| `src/extension/dispatch.ts`, `src/extension/background.ts` | modify | Route the new request |
| `src/desktop/naverReadGate.ts` | modify | Queue search pages like board pages |
| `src/desktop/boardSearchPageFetcher.ts` | create | Desktop side of the request |
| `src/desktop/collection-db/boardSearchSchema.ts` | create | `board_search_state` table |
| `src/desktop/collection-db/schema.ts` | modify | Enum value `board_search`, `runs.search_query`, re-export |
| `drizzle-collection/0007_*.sql` | generate | Migration |
| `src/desktop/collection-db/boardSearchRepository.ts` | create | Job rows, runs, page writes |
| `src/desktop/boardSearchPageCheck.ts` | create | Board/window guard for one page |
| `src/desktop/boardSearchRunner.ts` | create | Walks a block of queries |
| `src/desktop/boardSearchPlan.ts` | create | Titles → dictionary → job input |
| `src/desktop/boardSearchJob.ts` | create | `CollectionJob` for the loop |
| `src/desktop/collectionJob.ts` | modify | Name union gets `'boardSearch'` |
| `src/desktop/collection-db/boardSearchCoverageQuery.ts` | create | Missing-id residual estimate |
| `src/desktop/collectionContext.ts` | modify | Build the two new DB objects |
| `src/desktop/bootstrap.ts`, `src/desktop/main.ts` | modify | Runner, job, stop on quit, renderer deps |
| `src/desktop/boardSearchView.ts` | create | What the card shows |
| `src/desktop/ipc.ts`, `src/desktop/rendererApi.ts` | modify | Channels and methods |
| `src/shared/text.ts` | modify | `boardSearch` section |
| `src/renderer/views/collection/BoardSearchCard.tsx` | create | The card |
| `src/renderer/views/collection/boardSearchLines.ts` | create | Pure wording helpers for the card |
| `src/renderer/store.ts`, `src/renderer/views/CollectionStatus.tsx` | modify | Poll and mount |

---

### Task 1: Share the post upsert (refactor, zero behaviour change)

**Files:**
- Create: `src/desktop/collection-db/postPageWrite.ts`
- Modify: `src/desktop/collection-db/repository.ts` (the `boardRows` helper at ~lines 170-185 and the `boards`/`posts` inserts inside `persistPage`, ~lines 360-420)
- Test: existing `tests/desktop/collection-db/*.test.ts`, `tests/desktop/collectionOrchestrator.test.ts`

**Interfaces:**
- Produces: `writePostRows(tx: CollectionTransaction, items: readonly CollectedPostMetadata[], observedAt: Date, runId: string): Promise<{ insertedPostCount: number; updatedPostCount: number }>` and re-export of `CollectionTransaction` from `./memberPageWrite.js`.

- [ ] **Step 1: Run the current tests to record the baseline**

Run: `pnpm vitest run tests/desktop/collection-db tests/desktop/collectionOrchestrator.test.ts tests/desktop/collectionRunner.test.ts`
Expected: PASS (integration file skipped without `COLLECTION_TEST_DATABASE_URL`).

- [ ] **Step 2: Create `postPageWrite.ts`**

```ts
import { inArray, sql } from 'drizzle-orm'
import type { CollectedPostMetadata } from '../../shared/cafeArticleList.js'
import type { CollectionTransaction } from './memberPageWrite.js'
import { boards, posts } from './schema.js'

export type { CollectionTransaction } from './memberPageWrite.js'

export interface WrittenPostRows {
  readonly insertedPostCount: number
  readonly updatedPostCount: number
}

/**
 * Only items that name their board can teach the boards table anything. A
 * board's own list never names it, and that board is already known: the job
 * was made from the boards table in the first place.
 */
function boardRows(items: readonly CollectedPostMetadata[], observedAt: Date) {
  const rows = new Map<string, { boardId: string; name: string; firstSeenAt: Date; lastSeenAt: Date }>()
  for (const item of items) {
    if (item.boardName === null) continue
    rows.set(item.boardId, {
      boardId: item.boardId,
      name: item.boardName,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
    })
  }
  return [...rows.values()]
}

/**
 * Writes one page's posts, whichever walk read them. A post is the cafe's, not
 * the feed's: the list walk and the search walk reading the same post both
 * land on its one row, and a re-read updates it in place.
 */
export async function writePostRows(
  tx: CollectionTransaction,
  items: readonly CollectedPostMetadata[],
  observedAt: Date,
  runId: string,
): Promise<WrittenPostRows> {
  const existingRows = await tx
    .select({ postId: posts.postId })
    .from(posts)
    .where(inArray(posts.postId, items.map((item) => item.postId)))
  const existingPostIds = new Set(existingRows.map((row) => row.postId))
  const insertedPostCount = items.filter((item) => !existingPostIds.has(item.postId)).length

  const namedBoards = boardRows(items, observedAt)
  if (namedBoards.length > 0) {
    await tx
      .insert(boards)
      .values(namedBoards)
      .onConflictDoUpdate({
        target: boards.boardId,
        set: { name: sql`excluded.name`, lastSeenAt: observedAt },
      })
  }

  // The post and its reading are one row, so a re-read updates in
  // place: the counters move, and `firstSeenAt` stays what it was.
  await tx
    .insert(posts)
    .values(
      items.map((item) => ({
        postId: item.postId,
        boardId: item.boardId,
        title: item.title,
        prefix: item.prefix,
        authorNickname: item.authorNickname,
        authorId: item.authorId,
        postedAt: new Date(item.postedAt),
        viewCount: item.viewCount,
        commentCount: item.commentCount,
        snapshotAt: observedAt,
        firstSeenAt: observedAt,
        lastRunId: runId,
      })),
    )
    .onConflictDoUpdate({
      target: posts.postId,
      set: {
        boardId: sql`excluded.board_id`,
        title: sql`excluded.title`,
        prefix: sql`excluded.prefix`,
        authorNickname: sql`excluded.author_nickname`,
        authorId: sql`excluded.author_id`,
        postedAt: sql`excluded.posted_at`,
        viewCount: sql`excluded.view_count`,
        commentCount: sql`excluded.comment_count`,
        snapshotAt: observedAt,
        lastRunId: runId,
      },
    })

  return { insertedPostCount, updatedPostCount: items.length - insertedPostCount }
}
```

- [ ] **Step 3: Use it from `repository.ts`**

Delete the `boardRows` function from `repository.ts`. Inside `persistPage`'s transaction, replace everything from `const existingRows = await tx` through the end of the `.onConflictDoUpdate({ target: posts.postId, ... })` call with:

```ts
          const { insertedPostCount, updatedPostCount } = await writePostRows(tx, items, input.observedAt, input.runId)
```

Add the import `import { writePostRows } from './postPageWrite.js'`, and remove `boards` and `inArray` from the imports if nothing else in the file still uses them (`listFeedStates` and `replaceJob` use `boards`; keep it if so — let `pnpm lint` decide).

- [ ] **Step 4: Run the baseline tests again, plus types and lint**

Run: `pnpm vitest run tests/desktop/collection-db tests/desktop/collectionOrchestrator.test.ts tests/desktop/collectionRunner.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, no errors. If the integration DB is available, also run the integration command; the first test ("persists a page atomically…") must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/collection-db/postPageWrite.ts src/desktop/collection-db/repository.ts
git commit -m "refactor: share the post upsert between collection walks"
```

---

### Task 2: KST day keys and wall-clock times

**Files:**
- Modify: `src/shared/kst.ts` (append)
- Test: `tests/shared/kst.test.ts` (append)

**Interfaces:**
- Produces:
  - `kstDayKey(epochMs: number): string` — `yyyymmdd` of the KST day.
  - `isKstDayKey(value: string): boolean`
  - `kstDayKeyRange(key: string): KstDay` — throws on a bad key.
  - `kstLocalDateTimeToEpochMs(value: string): number | null` — `"2025-01-31T23:59:26.667"` read as KST.

- [ ] **Step 1: Write the failing tests** (append to `tests/shared/kst.test.ts`; add the four names to its import from `../../src/shared/kst.js`)

```ts
describe('KST day keys', () => {
  it('names the KST day of an instant, not the UTC one', () => {
    // 2025-01-31 15:30 UTC is 2025-02-01 00:30 KST.
    expect(kstDayKey(Date.UTC(2025, 0, 31, 15, 30))).toBe('20250201')
    expect(kstDayKey(Date.UTC(2025, 0, 31, 14, 59, 59, 999))).toBe('20250131')
  })

  it('accepts only real calendar days', () => {
    expect(isKstDayKey('20250228')).toBe(true)
    expect(isKstDayKey('20250229')).toBe(false)
    expect(isKstDayKey('2025-01-01')).toBe(false)
    expect(isKstDayKey('2025011')).toBe(false)
  })

  it('turns a key back into the KST day it names', () => {
    const day = kstDayKeyRange('20250101')
    expect(day.startMs).toBe(Date.UTC(2024, 11, 31, 15))
    expect(day.endMs - day.startMs).toBe(86_400_000)
    expect(kstDayKey(day.startMs)).toBe('20250101')
    expect(() => kstDayKeyRange('20251301')).toThrow()
  })

  it('reads an offset-less wall-clock time as KST', () => {
    // Stored post 661354 was written 2025-01-16 12:13:05.183 KST; the search
    // API spells it this way.
    expect(kstLocalDateTimeToEpochMs('2025-01-16T12:13:05.183')).toBe(Date.UTC(2025, 0, 16, 3, 13, 5, 183))
    expect(kstLocalDateTimeToEpochMs('2025-01-16T12:13:05')).toBe(Date.UTC(2025, 0, 16, 3, 13, 5))
    expect(kstLocalDateTimeToEpochMs('2025-01-16T12:13:05.1')).toBe(Date.UTC(2025, 0, 16, 3, 13, 5, 100))
  })

  it('refuses a time it cannot read rather than guessing', () => {
    expect(kstLocalDateTimeToEpochMs('2025-01-16 12:13:05')).toBeNull()
    expect(kstLocalDateTimeToEpochMs('2025-01-16T12:13:05+09:00')).toBeNull()
    expect(kstLocalDateTimeToEpochMs('2025-02-30T00:00:00')).toBeNull()
    expect(kstLocalDateTimeToEpochMs('2025-01-16T24:00:00')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/shared/kst.test.ts`
Expected: FAIL — the four functions are not exported.

- [ ] **Step 3: Implement** (append to `src/shared/kst.ts`)

```ts
const DAY_KEY = /^(\d{4})(\d{2})(\d{2})$/
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/

function two(value: number): string {
  return String(value).padStart(2, '0')
}

/** The UTC instant of a KST wall-clock reading, or null when no such reading exists. */
function kstWallClockMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number | null {
  if (hour > 23 || minute > 59 || second > 59) return null
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms)
  const check = new Date(asUtc)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return asUtc - KST_OFFSET_MS
}

/** The KST calendar day of an instant as `yyyymmdd`, the spelling the cafe's search takes. */
export function kstDayKey(epochMs: number): string {
  const shifted = new Date(kstDayStartMs(epochMs) + KST_OFFSET_MS)
  return `${shifted.getUTCFullYear()}${two(shifted.getUTCMonth() + 1)}${two(shifted.getUTCDate())}`
}

export function isKstDayKey(value: string): boolean {
  const match = DAY_KEY.exec(value)
  return match !== null && kstWallClockMs(Number(match[1]), Number(match[2]), Number(match[3])) !== null
}

/** The KST day a `yyyymmdd` key names, as a half-open range. */
export function kstDayKeyRange(key: string): KstDay {
  const match = DAY_KEY.exec(key)
  const startMs = match === null ? null : kstWallClockMs(Number(match[1]), Number(match[2]), Number(match[3]))
  if (startMs === null) throw new Error(`not a KST day key: ${key}`)
  return { startMs, endMs: startMs + MS_PER_DAY }
}

/**
 * An offset-less wall-clock time such as `2025-01-31T23:59:26.667`, read as
 * KST. The cafe's search spells post times this way; handing the string to
 * `Date.parse` would read it in the machine's own zone.
 */
export function kstLocalDateTimeToEpochMs(value: string): number | null {
  const match = LOCAL_DATE_TIME.exec(value)
  if (match === null) return null
  const fraction = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'))
  return kstWallClockMs(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]), fraction)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/shared/kst.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/kst.ts tests/shared/kst.test.ts
git commit -m "feat: spell KST days and read offset-less KST times"
```

---

### Task 3: The query dictionary

**Files:**
- Create: `src/shared/boardSearchDictionary.ts`
- Test: `tests/shared/boardSearchDictionary.test.ts`

**Interfaces:**
- Produces:
  - `export interface BoardSearchQuery { readonly query: string; readonly expectedGain: number }`
  - `export const BOARD_SEARCH_QUERY_LIMIT = 300`, `BOARD_SEARCH_MIN_GAIN = 5`, `BOARD_SEARCH_CANDIDATE_LIMIT = 4000`
  - `export function titleWords(title: string): readonly string[]`
  - `export function buildBoardSearchDictionary(titles: readonly string[], options?: { readonly limit?: number; readonly minGain?: number; readonly candidateLimit?: number }): readonly BoardSearchQuery[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { buildBoardSearchDictionary, titleWords } from '../../src/shared/boardSearchDictionary.js'

describe('titleWords', () => {
  it('splits on anything that is not a Hangul syllable, Latin letter or digit, lower-cased', () => {
    expect(titleWords('GS25 발베니12년 [득템]!! ㅎㅎ 🥃')).toEqual(['gs25', '발베니12년', '득템'])
  })

  it('keeps nothing from a title with no words', () => {
    expect(titleWords('!!! ㅋㅋ')).toEqual([])
  })
})

describe('buildBoardSearchDictionary', () => {
  it('picks the word that covers the most uncovered titles first, counting a title once', () => {
    const titles = ['이마트 구매', '이마트 구매했습니다', '이마트 글렌', '글렌알라키 구입', '구입 완료']
    expect(buildBoardSearchDictionary(titles, { minGain: 1 })).toEqual([
      { query: '이마트', expectedGain: 3 },
      { query: '구입', expectedGain: 2 },
    ])
  })

  it('counts a title as caught when one of its words starts with the query', () => {
    // '글렌' catches '글렌알라키' (measured against the cafe on 2026-09-25).
    const titles = ['글렌 12년', '글렌알라키 15', '글렌드로낙']
    expect(buildBoardSearchDictionary(titles, { minGain: 1 })).toEqual([{ query: '글렌', expectedGain: 3 }])
  })

  it('never offers a fragment that was not a whole word somewhere', () => {
    // '이마' is a prefix of every title but was never written on its own.
    const titles = ['이마트', '이마트24', '이마트몰']
    const picked = buildBoardSearchDictionary(titles, { minGain: 1 }).map((entry) => entry.query)
    expect(picked).not.toContain('이마')
    expect(picked[0]).toBe('이마트')
  })

  it('drops one-letter words, which the search does not match', () => {
    expect(buildBoardSearchDictionary(['a b c', 'a d'], { minGain: 1 })).toEqual([])
  })

  it('stops at the limit and below the minimum gain', () => {
    const titles = ['가가 나나', '가가 다다', '라라', '라라', '마마']
    expect(buildBoardSearchDictionary(titles, { limit: 1, minGain: 1 })).toEqual([{ query: '가가', expectedGain: 2 }])
    expect(buildBoardSearchDictionary(titles, { minGain: 2 })).toEqual([
      { query: '가가', expectedGain: 2 },
      { query: '라라', expectedGain: 2 },
    ])
  })

  it('counts only titles no earlier pick caught', () => {
    // '나나' was used only by a title '가가' already caught, so it adds 0.
    const titles = ['가가 나나', '가가', '다다']
    expect(buildBoardSearchDictionary(titles, { minGain: 1 })).toEqual([
      { query: '가가', expectedGain: 2 },
      { query: '다다', expectedGain: 1 },
    ])
  })

  it('breaks an equal gain by how many titles use the word, then by code-unit order', () => {
    // Both add 2: '가가' by catching '가가나' too (used once itself), '라라' by
    // being written twice. The word more titles use goes first.
    expect(buildBoardSearchDictionary(['가가', '가가나', '라라', '라라'], { minGain: 1 })).toEqual([
      { query: '라라', expectedGain: 2 },
      { query: '가가', expectedGain: 2 },
    ])
    // Equal gain, equal use: code-unit order decides.
    expect(buildBoardSearchDictionary(['다다', '나나'], { minGain: 1 })).toEqual([
      { query: '나나', expectedGain: 1 },
      { query: '다다', expectedGain: 1 },
    ])
  })

  it('gives the same answer for the same titles in any order', () => {
    const titles = ['이마트 구매', '트레이더스 구매', '코스트코', '이마트 조니', '조니워커']
    const once = buildBoardSearchDictionary(titles, { minGain: 1 })
    expect(buildBoardSearchDictionary([...titles].reverse(), { minGain: 1 })).toEqual(once)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/shared/boardSearchDictionary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Picks the title searches that recover a board's posts past the list horizon.
 *
 * The board's own list stops at page 1000, but its title search does not, and
 * it catches a title when one of its words starts with the query — '구매'
 * finds '구매했습니다', '글렌' finds '글렌알라키' (measured 2026-09-25). No one
 * query covers a board, so this builds a union: the stored titles stand in for
 * the missing ones, and each pick is the word that catches the most titles the
 * earlier picks did not. Latin and digit words match less predictably ('gs'
 * does not find 'gs25'); the order stays a good one, and each query's real
 * yield is read off the search's own total.
 */

export interface BoardSearchQuery {
  readonly query: string
  /** Stored titles this query catches that no earlier query did. */
  readonly expectedGain: number
}

export const BOARD_SEARCH_QUERY_LIMIT = 300
export const BOARD_SEARCH_MIN_GAIN = 5
export const BOARD_SEARCH_CANDIDATE_LIMIT = 4000

const MIN_WORD_LENGTH = 2
const WORD_SEPARATOR = /[^0-9a-z가-힣]+/u

export function titleWords(title: string): readonly string[] {
  return title.toLowerCase().split(WORD_SEPARATOR).filter((word) => word.length > 0)
}

interface Candidate {
  readonly word: string
  /** Titles with a word starting with this one, as indexes into the title list. */
  readonly caught: readonly number[]
  /** Titles that use this word itself, for breaking ties. */
  readonly uses: number
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function candidatesOf(words: readonly (readonly string[])[], candidateLimit: number): readonly Candidate[] {
  const uses = new Map<string, number>()
  for (const titleWordList of words) {
    for (const word of new Set(titleWordList)) {
      if (word.length >= MIN_WORD_LENGTH) uses.set(word, (uses.get(word) ?? 0) + 1)
    }
  }
  const kept = [...uses.entries()]
    .sort((a, b) => b[1] - a[1] || compareCodeUnits(a[0], b[0]))
    .slice(0, candidateLimit)
  const caught = new Map<string, number[]>(kept.map(([word]) => [word, []]))
  words.forEach((titleWordList, index) => {
    const seen = new Set<string>()
    for (const word of titleWordList) {
      for (let length = MIN_WORD_LENGTH; length <= word.length; length += 1) {
        const prefix = word.slice(0, length)
        if (seen.has(prefix)) continue
        const list = caught.get(prefix)
        if (list === undefined) continue
        list.push(index)
        seen.add(prefix)
      }
    }
  })
  return kept.map(([word, count]) => ({ word, caught: caught.get(word) ?? [], uses: count }))
}

export function buildBoardSearchDictionary(
  titles: readonly string[],
  options: { readonly limit?: number; readonly minGain?: number; readonly candidateLimit?: number } = {},
): readonly BoardSearchQuery[] {
  const limit = options.limit ?? BOARD_SEARCH_QUERY_LIMIT
  const minGain = options.minGain ?? BOARD_SEARCH_MIN_GAIN
  const candidates = candidatesOf(titles.map(titleWords), options.candidateLimit ?? BOARD_SEARCH_CANDIDATE_LIMIT)
  const covered = new Set<number>()
  const picked: BoardSearchQuery[] = []
  const used = new Set<string>()
  while (picked.length < limit) {
    let best: Candidate | null = null
    let bestGain = 0
    for (const candidate of candidates) {
      if (used.has(candidate.word)) continue
      const gain = candidate.caught.reduce((count, index) => (covered.has(index) ? count : count + 1), 0)
      const better =
        gain > bestGain ||
        (gain === bestGain && best !== null && (candidate.uses > best.uses || (candidate.uses === best.uses && compareCodeUnits(candidate.word, best.word) < 0)))
      if (better) {
        best = candidate
        bestGain = gain
      }
    }
    if (best === null || bestGain < minGain) break
    used.add(best.word)
    for (const index of best.caught) covered.add(index)
    picked.push({ query: best.word, expectedGain: bestGain })
  }
  return picked
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/shared/boardSearchDictionary.test.ts`
Expected: PASS. If the tie-break test fails, re-read the rule in spec §4 item 7 and fix the implementation, not the test.

- [ ] **Step 5: Check it against the real board once (read-only)**

Run:
```bash
psql -X -A -t -h 127.0.0.1 -U lp2k -d whisky_manager_collection -c "select coalesce(title,'') from posts where board_id='137'" > "$TMPDIR/t137.txt"
pnpm build && node -e "
const { buildBoardSearchDictionary } = await import('./dist/shared/boardSearchDictionary.js');
const titles = require('node:fs').readFileSync(process.env.TMPDIR + '/t137.txt', 'utf8').split('\n');
const d = buildBoardSearchDictionary(titles);
console.log(d.length, d.slice(0, 12).map((q) => q.query).join(','));
" --input-type=module
rm "$TMPDIR/t137.txt"
```
Expected: `300` and a head close to `글렌,구매,구입,이마트,gs,트레이더스,위스키,12,조니,홈플,와인,코스트코` (spec §4). A wildly different head means the tokenizer disagrees with the spec's analysis; stop and compare.

- [ ] **Step 6: Commit**

```bash
git add src/shared/boardSearchDictionary.ts tests/shared/boardSearchDictionary.test.ts
git commit -m "feat: pick title searches that cover a board's stored posts"
```

---

### Task 4: Parse the search response

**Files:**
- Modify: `src/shared/cafeArticleList.ts` — export `fail`, `record`, `nullableString`, `safeInteger`, `prefixOf`, `parsePageInfo`; add `collectedArticlePage`
- Create: `src/shared/cafeBoardSearchList.ts`
- Create: `tests/fixtures/cafe-board-search-sample.json` (synthetic; every value invented)
- Test: `tests/shared/cafeBoardSearchList.test.ts`; existing `tests/shared/cafeArticleList.test.ts` must stay green

**Interfaces:**
- Consumes: `kstLocalDateTimeToEpochMs` (Task 2).
- Produces: `parseCafeBoardSearchList(value: unknown): CollectedArticlePage`, `parseCafeBoardSearchListText(text: string): CollectedArticlePage`, and from `cafeArticleList.ts`: `collectedArticlePage(items: readonly CollectedPostMetadata[], rawPageInfo: unknown): CollectedArticlePage`.

- [ ] **Step 1: Write the synthetic fixture** `tests/fixtures/cafe-board-search-sample.json`

The shape is the one captured on 2026-09-25 (spec §5); the values are made up.

```json
{
  "result": {
    "articleList": [
      {
        "type": "ARTICLE",
        "item": {
          "cafeId": 14538121, "menuId": 137, "articleId": 667901, "headId": 131, "headName": "정보",
          "subject": "글렌알라키 12 이마트 구매", "summary": "", "thumbnailImageUrl": null,
          "likeItCount": 0, "readCount": 120, "commentCount": 4,
          "addDate": "2025-01-31T23:59:26.667", "currentSecTime": "25.01.31.",
          "attachFile": false, "attachPoll": false, "attachImage": true, "attachMovie": false,
          "attachCalendar": false, "attachMap": false, "attachLink": false, "newArticle": false,
          "boardType": "L", "menuType": "B", "generalArticle": true, "bookArticle": false,
          "staffArticle": false, "replyArticle": false, "marketArticle": false, "cafeMenuReadLevel": 0,
          "refArticleCount": 0, "refArticleId": 0, "delParent": false, "containsSearchedReply": false,
          "art": "", "likeCount": 0, "representImageType": "", "imageAttachCount": 1,
          "writerInfo": { "nickname": "테스트회원가", "memberKey": "member-key-a", "staff": false, "manager": false, "secedeMember": false }
        }
      },
      {
        "type": "ARTICLE",
        "item": {
          "cafeId": 14538121, "menuId": 137, "articleId": 667850, "headId": 0,
          "subject": "글렌 두 병", "summary": "", "thumbnailImageUrl": null,
          "likeItCount": 0, "readCount": 33, "commentCount": 0,
          "addDate": "2025-01-31T08:01:00", "currentSecTime": "25.01.31.",
          "attachFile": false, "attachPoll": false, "attachImage": false, "attachMovie": false,
          "attachCalendar": false, "attachMap": false, "attachLink": false, "newArticle": false,
          "boardType": "L", "menuType": "B", "generalArticle": true, "bookArticle": false,
          "staffArticle": false, "replyArticle": true, "marketArticle": false, "cafeMenuReadLevel": 0,
          "refArticleCount": 2, "refArticleId": 0, "delParent": false, "containsSearchedReply": false,
          "art": "", "likeCount": 0, "representImageType": "", "imageAttachCount": 0,
          "writerInfo": { "nickname": "테스트회원나", "memberKey": "member-key-b", "staff": false, "manager": false, "secedeMember": false }
        }
      }
    ],
    "pageInfo": { "totalArticleCount": 578, "lastNavigationPageNumber": 10, "visibleNextButton": true },
    "showSuicideSaver": false
  }
}
```

- [ ] **Step 2: Write the failing tests** `tests/shared/cafeBoardSearchList.test.ts`

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CafeArticleListParseError } from '../../src/shared/cafeArticleList.js'
import { parseCafeBoardSearchList, parseCafeBoardSearchListText } from '../../src/shared/cafeBoardSearchList.js'

const sample = readFileSync(fileURLToPath(new URL('../fixtures/cafe-board-search-sample.json', import.meta.url)), 'utf8')
const parsed = (): { result: { articleList: { item: Record<string, unknown> }[]; pageInfo: Record<string, unknown> } } =>
  JSON.parse(sample) as never

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof CafeArticleListParseError ? error.code : 'NOT_A_PARSE_ERROR'
  }
}

describe('parseCafeBoardSearchList', () => {
  it('maps a search item onto the same metadata the list walk stores', () => {
    const page = parseCafeBoardSearchListText(sample)
    expect(page.items[0]).toEqual({
      cafeId: '14538121',
      postId: '667901',
      boardId: '137',
      boardName: null,
      title: '글렌알라키 12 이마트 구매',
      prefix: '정보',
      authorId: 'member-key-a',
      authorNickname: '테스트회원가',
      postedAt: Date.UTC(2025, 0, 31, 14, 59, 26, 667),
      viewCount: 120,
      commentCount: 4,
      replyCount: 0,
      isNotice: false,
    })
    expect(page.items[1]).toMatchObject({ postId: '667850', prefix: null, replyCount: 2 })
  })

  it('reads the total the search reports', () => {
    expect(parseCafeBoardSearchListText(sample).pageInfo).toEqual({
      totalArticleCount: 578,
      lastNavigationPageNumber: 10,
      visibleNextButton: true,
    })
  })

  it('gives an empty past-the-end page a valid identity', () => {
    const value = parsed()
    value.result.articleList = []
    const page = parseCafeBoardSearchList(value)
    expect(page.items).toEqual([])
    expect(page.pageIdentity).toMatch(/^fnv1a64:/)
  })

  it('refuses a post time it cannot read as KST', () => {
    const value = parsed()
    value.result.articleList[0]!.item.addDate = '2025-01-31T23:59:26+09:00'
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_ARTICLE')
  })

  it('refuses an item missing a field the post row needs', () => {
    const value = parsed()
    delete value.result.articleList[0]!.item.refArticleCount
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_ARTICLE')
  })

  it('refuses a missing page info and a non-JSON body', () => {
    const value = parsed()
    delete (value.result as Record<string, unknown>).pageInfo
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_PAGE_INFO')
    expect(codeOf(() => parseCafeBoardSearchListText('<html>login</html>'))).toBe('INVALID_JSON')
  })

  it('refuses the same post twice on one page', () => {
    const value = parsed()
    value.result.articleList[1]!.item.articleId = 667901
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('DUPLICATE_POST_ID')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run tests/shared/cafeBoardSearchList.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Export the readers and add `collectedArticlePage` in `cafeArticleList.ts`**

Change `function fail`, `function record`, `function nullableString`, `function safeInteger`, `function prefixOf`, `function parsePageInfo` to `export function …` (bodies unchanged). Then replace the body of `parseCafeArticleList` so the page assembly is shared:

```ts
/** A parsed page from its items: no post twice, its page info read, its identity stamped. */
export function collectedArticlePage(items: readonly CollectedPostMetadata[], rawPageInfo: unknown): CollectedArticlePage {
  const postIds = new Set<string>()
  for (const item of items) {
    if (postIds.has(item.postId)) fail('DUPLICATE_POST_ID', `result.articleList has duplicate articleId ${item.postId}`)
    postIds.add(item.postId)
  }
  return { items, pageInfo: parsePageInfo(rawPageInfo), pageIdentity: cafeArticlePageIdentity(items.map((item) => item.postId)) }
}

/** Parses a decoded JSON value from the exact list endpoint. */
export function parseCafeArticleList(value: unknown): CollectedArticlePage {
  const response = record(value, 'response', 'INVALID_ENVELOPE')
  const result = record(response.result, 'response.result', 'INVALID_ENVELOPE')
  if (!Array.isArray(result.articleList)) fail('INVALID_ENVELOPE', 'result.articleList must be an array')
  return collectedArticlePage(result.articleList.map((entry, index) => parseArticle(entry, index)), result.pageInfo)
}
```

Run: `pnpm vitest run tests/shared/cafeArticleList.test.ts` — Expected: PASS (behaviour unchanged).

- [ ] **Step 5: Create `cafeBoardSearchList.ts`**

```ts
import {
  collectedArticlePage,
  fail,
  nullableString,
  prefixOf,
  record,
  safeInteger,
  type CollectedArticlePage,
  type CollectedPostMetadata,
} from './cafeArticleList.js'
import { kstLocalDateTimeToEpochMs } from './kst.js'

/**
 * Pure contract for the board title search captured on 2026-09-25
 * (`apis.cafe.naver.com/search/v2/.../search/articles`). The envelope and page
 * info are the list's; three item fields are spelled differently — `addDate`
 * is an offset-less KST time, the nickname is `nickname`, and replies are
 * `refArticleCount`. A malformed response fails loudly for the same reason the
 * list parser does: an empty-looking page would read as the end of a query.
 */

function postedAtOf(item: Record<string, unknown>, path: string): number {
  const addDate = nullableString(item, 'addDate', path, 'INVALID_ARTICLE')
  const postedAt = addDate === null ? null : kstLocalDateTimeToEpochMs(addDate)
  if (postedAt === null) fail('INVALID_ARTICLE', `${path}.addDate is not a KST wall-clock time`)
  return postedAt
}

function parseSearchArticle(entry: unknown, index: number): CollectedPostMetadata {
  const path = `result.articleList[${index}]`
  const rawEntry = record(entry, path, 'INVALID_ARTICLE')
  if (rawEntry.type !== 'ARTICLE') fail('UNEXPECTED_LIST_ENTRY_TYPE', `${path}.type must be ARTICLE`)
  const itemPath = `${path}.item`
  const item = record(rawEntry.item, itemPath, 'INVALID_ARTICLE')
  const writerInfo = record(item.writerInfo, `${itemPath}.writerInfo`, 'INVALID_ARTICLE')
  return {
    cafeId: String(safeInteger(item, 'cafeId', itemPath, 1, 'INVALID_ARTICLE')),
    postId: String(safeInteger(item, 'articleId', itemPath, 1, 'INVALID_ARTICLE')),
    boardId: String(safeInteger(item, 'menuId', itemPath, 0, 'INVALID_ARTICLE')),
    // The search is scoped to one board and names none; the board is known.
    boardName: null,
    title: nullableString(item, 'subject', itemPath, 'INVALID_ARTICLE'),
    prefix: prefixOf(item, itemPath),
    authorId: nullableString(writerInfo, 'memberKey', `${itemPath}.writerInfo`, 'INVALID_ARTICLE'),
    authorNickname: nullableString(writerInfo, 'nickname', `${itemPath}.writerInfo`, 'INVALID_ARTICLE'),
    postedAt: postedAtOf(item, itemPath),
    viewCount: safeInteger(item, 'readCount', itemPath, 0, 'INVALID_ARTICLE'),
    commentCount: safeInteger(item, 'commentCount', itemPath, 0, 'INVALID_ARTICLE'),
    replyCount: safeInteger(item, 'refArticleCount', itemPath, 0, 'INVALID_ARTICLE'),
    isNotice: false,
  }
}

export function parseCafeBoardSearchList(value: unknown): CollectedArticlePage {
  const response = record(value, 'response', 'INVALID_ENVELOPE')
  const result = record(response.result, 'response.result', 'INVALID_ENVELOPE')
  if (!Array.isArray(result.articleList)) fail('INVALID_ENVELOPE', 'result.articleList must be an array')
  return collectedArticlePage(result.articleList.map((entry, index) => parseSearchArticle(entry, index)), result.pageInfo)
}

export function parseCafeBoardSearchListText(text: string): CollectedArticlePage {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'board-search response is not valid JSON')
  }
  return parseCafeBoardSearchList(value)
}
```

`record` is typed as returning `JsonRecord` (a `Record<string, unknown>`); if TypeScript complains that `JsonRecord` is not exported, export the `JsonRecord` type alias too and use it for `item` in `postedAtOf`.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run tests/shared/cafeBoardSearchList.test.ts tests/shared/cafeArticleList.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/cafeArticleList.ts src/shared/cafeBoardSearchList.ts tests/shared/cafeBoardSearchList.test.ts tests/fixtures/cafe-board-search-sample.json
git commit -m "feat: parse the board title search into collected posts"
```

---

### Task 5: Search endpoint and protocol message

**Files:**
- Create: `src/shared/cafeBoardSearchEndpoint.ts`
- Modify: `src/shared/protocol.ts` (version, request type, `AppMessage` union, `APP_MESSAGE_TYPES`, `isAppMessage`, new guard)
- Test: `tests/shared/cafeBoardSearchEndpoint.test.ts`; append to `tests/shared/protocol.test.ts`

**Interfaces:**
- Consumes: `isKstDayKey` (Task 2), `isMenuId`, `CAFE_ARTICLE_LIST` from `cafeArticleFixture.ts`.
- Produces:
  - `CAFE_BOARD_SEARCH` constants (`perPage: 50`, `searchBy: '1'`, `views`, `headers: { 'x-cafe-product': 'pc' }`).
  - `interface BoardSearchPage { menuId; query; fromDay; toDay; page }`
  - `isBoardSearchQuery(value: string): boolean`, `cafeBoardSearchUrl(page: BoardSearchPage): string`, `cafeBoardSearchReferer(menuId: string): string`, `isCafeBoardSearchEndpoint(url: string): boolean`
  - `CollectBoardSearchPageRequest` and `isCollectBoardSearchPageRequest(value: unknown)`; the reply is the existing `BOARD_PAGE_COLLECTED`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/cafeBoardSearchEndpoint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  cafeBoardSearchReferer,
  cafeBoardSearchUrl,
  isBoardSearchQuery,
  isCafeBoardSearchEndpoint,
} from '../../src/shared/cafeBoardSearchEndpoint.js'

describe('cafeBoardSearchUrl', () => {
  it('builds the request the search screen makes', () => {
    const url = new URL(cafeBoardSearchUrl({ menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 2 }))
    expect(url.origin + url.pathname).toBe('https://apis.cafe.naver.com/search/v2/cafes/14538121/search/articles')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: '글렌',
      perPage: '50',
      page: '2',
      menuId: '137',
      searchBy: '1',
      'writeTime.min': '20250101',
      'writeTime.max': '20250131',
      views: 'MEMBER_LEVEL,COUNT,SALE_INFO,CAFE_MENU',
    })
  })

  it('refuses what the protocol would refuse', () => {
    const ok = { menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 1 }
    expect(() => cafeBoardSearchUrl({ ...ok, menuId: '0' })).toThrow()
    expect(() => cafeBoardSearchUrl({ ...ok, query: '글' })).toThrow()
    expect(() => cafeBoardSearchUrl({ ...ok, fromDay: '20250201' })).toThrow()
    expect(() => cafeBoardSearchUrl({ ...ok, page: 0 })).toThrow()
  })

  it('points the referer at the board being searched', () => {
    expect(cafeBoardSearchReferer('137')).toBe('https://cafe.naver.com/f-e/cafes/14538121/menus/137')
  })

  it('recognises only this cafe search path', () => {
    expect(isCafeBoardSearchEndpoint(cafeBoardSearchUrl({ menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 1 }))).toBe(true)
    expect(isCafeBoardSearchEndpoint('https://apis.cafe.naver.com/search/v2/cafes/1/search/articles')).toBe(false)
    expect(isCafeBoardSearchEndpoint('https://apis.naver.com/search/v2/cafes/14538121/search/articles')).toBe(false)
  })
})

describe('isBoardSearchQuery', () => {
  it('takes 2 to 40 characters with no surrounding space or control character', () => {
    expect(isBoardSearchQuery('gs')).toBe(true)
    expect(isBoardSearchQuery('글렌알라키')).toBe(true)
    expect(isBoardSearchQuery('글')).toBe(false)
    expect(isBoardSearchQuery(' 글렌')).toBe(false)
    expect(isBoardSearchQuery('글\n렌')).toBe(false)
    expect(isBoardSearchQuery('가'.repeat(41))).toBe(false)
  })
})
```

Append to `tests/shared/protocol.test.ts` (add `isCollectBoardSearchPageRequest`, `isAppMessage`, `PROTOCOL_VERSION` to its imports if not already there):

```ts
describe('COLLECT_BOARD_SEARCH_PAGE', () => {
  const request = {
    type: 'COLLECT_BOARD_SEARCH_PAGE',
    requestId: 'search-1',
    cafeId: '14538121',
    menuId: '137',
    query: '글렌',
    fromDay: '20250101',
    toDay: '20250828',
    page: 1,
    pageSize: 50,
  } as const

  it('accepts one board, one query, one window, one page', () => {
    expect(isCollectBoardSearchPageRequest(request)).toBe(true)
    expect(isAppMessage(request)).toBe(true)
  })

  it.each([
    ['the whole cafe', { menuId: '0' }],
    ['a non-digit board', { menuId: '13a' }],
    ['a one-letter query', { query: '글' }],
    ['a padded query', { query: '글렌 ' }],
    ['a bad day', { fromDay: '20250230' }],
    ['a window that ends before it starts', { fromDay: '20250901' }],
    ['page zero', { page: 0 }],
    ['another page size', { pageSize: 20 }],
    ['another cafe', { cafeId: '1' }],
  ])('refuses %s', (_label, change) => {
    expect(isCollectBoardSearchPageRequest({ ...request, ...change })).toBe(false)
  })

  it('bumps the protocol, since an older extension cannot answer it', () => {
    expect(PROTOCOL_VERSION).toBe(12)
  })
})
```

If `protocol.test.ts` already asserts `PROTOCOL_VERSION` is 11, change that expectation to 12 in the same step.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/shared/cafeBoardSearchEndpoint.test.ts tests/shared/protocol.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `cafeBoardSearchEndpoint.ts`**

```ts
import { CAFE_ARTICLE_LIST, isMenuId } from './cafeArticleFixture.js'
import { isKstDayKey } from './kst.js'

/**
 * The board title search the cafe's own search screen calls (captured
 * 2026-09-25). A different host from the list: `apis.cafe.naver.com`. Without
 * `x-cafe-product: pc` it answers 400 with an empty body. Everything but the
 * board, query, window and page is fixed here, so the extension can never be
 * asked to read anything else through it.
 */
export const CAFE_BOARD_SEARCH = {
  perPage: 50,
  searchBy: '1',
  views: 'MEMBER_LEVEL,COUNT,SALE_INFO,CAFE_MENU',
  headers: { 'x-cafe-product': 'pc' },
} as const

const API_ORIGIN = 'https://apis.cafe.naver.com'
const SEARCH_PATH = `/search/v2/cafes/${CAFE_ARTICLE_LIST.cafeId}/search/articles`
const QUERY_MIN_LENGTH = 2
const QUERY_MAX_LENGTH = 40
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u

export interface BoardSearchPage {
  /** Digits, never '0': a search is scoped to one board. */
  readonly menuId: string
  readonly query: string
  /** KST `yyyymmdd`, inclusive. */
  readonly fromDay: string
  /** KST `yyyymmdd`, inclusive, not before `fromDay`. */
  readonly toDay: string
  readonly page: number
}

export function isBoardSearchQuery(value: string): boolean {
  return (
    value === value.trim() &&
    [...value].length >= QUERY_MIN_LENGTH &&
    [...value].length <= QUERY_MAX_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  )
}

export function isBoardSearchPage(value: BoardSearchPage): boolean {
  return (
    isMenuId(value.menuId) &&
    value.menuId !== CAFE_ARTICLE_LIST.menuId &&
    isBoardSearchQuery(value.query) &&
    isKstDayKey(value.fromDay) &&
    isKstDayKey(value.toDay) &&
    value.fromDay <= value.toDay &&
    Number.isSafeInteger(value.page) &&
    value.page >= 1
  )
}

export function cafeBoardSearchUrl(value: BoardSearchPage): string {
  if (!isBoardSearchPage(value)) throw new Error('not a board search page this endpoint may read')
  const url = new URL(`${API_ORIGIN}${SEARCH_PATH}`)
  url.searchParams.set('query', value.query)
  url.searchParams.set('perPage', String(CAFE_BOARD_SEARCH.perPage))
  url.searchParams.set('page', String(value.page))
  url.searchParams.set('menuId', value.menuId)
  url.searchParams.set('searchBy', CAFE_BOARD_SEARCH.searchBy)
  url.searchParams.set('writeTime.min', value.fromDay)
  url.searchParams.set('writeTime.max', value.toDay)
  url.searchParams.set('views', CAFE_BOARD_SEARCH.views)
  return url.toString()
}

/** The page the request should appear to come from: the board's own screen. */
export function cafeBoardSearchReferer(menuId: string): string {
  if (!isMenuId(menuId)) throw new Error(`menuId must be digits: ${menuId}`)
  return `https://cafe.naver.com/f-e/cafes/${CAFE_ARTICLE_LIST.cafeId}/menus/${menuId}`
}

export function isCafeBoardSearchEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.origin === API_ORIGIN && url.pathname === SEARCH_PATH
}
```

`URLSearchParams` encodes `,` in `views` as `%2C`; the captured request did the same, and the test compares decoded values.

- [ ] **Step 4: Add the protocol message in `protocol.ts`**

1. `export const PROTOCOL_VERSION = 12`
2. After `CollectBoardPageRequest`, add:

```ts
/** One page of one board's title search, over one KST window. */
export interface CollectBoardSearchPageRequest {
  readonly type: 'COLLECT_BOARD_SEARCH_PAGE'
  readonly requestId: string
  readonly cafeId: typeof CAFE_ARTICLE_LIST.cafeId
  readonly menuId: string
  readonly query: string
  readonly fromDay: string
  readonly toDay: string
  readonly page: number
  readonly pageSize: typeof CAFE_BOARD_SEARCH.perPage
}
```

3. In the `AppMessage` union, after `| CollectBoardPageRequest`, add `| CollectBoardSearchPageRequest` with the comment `/** One board's title search page; answered with BOARD_PAGE_COLLECTED. */`.
4. Add `'COLLECT_BOARD_SEARCH_PAGE'` to `APP_MESSAGE_TYPES` after `'COLLECT_BOARD_PAGE'`.
5. In `isAppMessage`, after the `COLLECT_BOARD_PAGE` line: `if (type === 'COLLECT_BOARD_SEARCH_PAGE') return isCollectBoardSearchPageRequest(value)`.
6. After `isCollectBoardPageRequest`, add:

```ts
/** Runtime guard for one cafe, one board, one query and window, one page. */
export function isCollectBoardSearchPageRequest(value: unknown): value is CollectBoardSearchPageRequest {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Partial<CollectBoardSearchPageRequest>
  return (
    message.type === 'COLLECT_BOARD_SEARCH_PAGE' &&
    typeof message.requestId === 'string' &&
    message.cafeId === CAFE_ARTICLE_LIST.cafeId &&
    message.pageSize === CAFE_BOARD_SEARCH.perPage &&
    typeof message.menuId === 'string' &&
    typeof message.query === 'string' &&
    typeof message.fromDay === 'string' &&
    typeof message.toDay === 'string' &&
    typeof message.page === 'number' &&
    isBoardSearchPage({ menuId: message.menuId, query: message.query, fromDay: message.fromDay, toDay: message.toDay, page: message.page })
  )
}
```

7. Import `CAFE_BOARD_SEARCH` and `isBoardSearchPage` from `./cafeBoardSearchEndpoint.js`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run tests/shared && pnpm typecheck`
Expected: PASS. `typecheck` will now flag `src/extension/dispatch.ts` if its `switch` over `AppMessage` is exhaustive; that is fixed in Task 6 — if it fails only there, continue to Task 6 before committing both, otherwise commit now.

- [ ] **Step 6: Commit**

```bash
git add src/shared/cafeBoardSearchEndpoint.ts src/shared/protocol.ts tests/shared/cafeBoardSearchEndpoint.test.ts tests/shared/protocol.test.ts
git commit -m "feat: add the board search page request to the protocol"
```

---

### Task 6: The extension reads one search page

**Files:**
- Create: `src/extension/boardSearchPageReader.ts`
- Modify: `src/extension/manifest.json`, `src/extension/refererRule.ts`, `src/extension/dispatch.ts`, `src/extension/background.ts`
- Test: `tests/extension/boardSearchPageReader.test.ts`; update `tests/extension/manifest.test.ts`, `tests/extension/refererRule.test.ts`, `tests/extension/dispatch.test.ts`

**Interfaces:**
- Consumes: Task 4 parser, Task 5 endpoint and request type.
- Produces: `createBoardSearchPageReader(deps: { http: Http }): { read(request: CollectBoardSearchPageRequest): Promise<BoardSearchPageReadResult> }` where `BoardSearchPageReadResult` is `{ ok: true; page: number; result: CollectedArticlePage } | { ok: false; code: 'BOARD_SEARCH_BAD_REQUEST' | 'BOARD_SEARCH_NETWORK_ERROR' | 'BOARD_SEARCH_HTTP_ERROR' | 'BOARD_SEARCH_INVALID_JSON' | 'BOARD_SEARCH_PARSE_ERROR' }`.

- [ ] **Step 1: Write the failing reader test** `tests/extension/boardSearchPageReader.test.ts`

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createBoardSearchPageReader } from '../../src/extension/boardSearchPageReader.js'
import { cafeBoardSearchReferer, cafeBoardSearchUrl } from '../../src/shared/cafeBoardSearchEndpoint.js'
import type { HttpRequest } from '../../src/shared/http.js'
import type { CollectBoardSearchPageRequest } from '../../src/shared/protocol.js'

const sample = readFileSync(fileURLToPath(new URL('../fixtures/cafe-board-search-sample.json', import.meta.url)), 'utf8')

const request: CollectBoardSearchPageRequest = {
  type: 'COLLECT_BOARD_SEARCH_PAGE',
  requestId: 'search-1',
  cafeId: '14538121',
  menuId: '137',
  query: '글렌',
  fromDay: '20250101',
  toDay: '20250131',
  page: 3,
  pageSize: 50,
}

describe('BoardSearchPageReader', () => {
  it('asks for exactly one page the way the search screen does', async () => {
    const seen: HttpRequest[] = []
    const reader = createBoardSearchPageReader({
      http: async (init) => {
        seen.push(init)
        return { status: 200, contentType: 'application/json', text: sample }
      },
    })
    await expect(reader.read(request)).resolves.toMatchObject({ ok: true, page: 3, result: { items: [{ postId: '667901' }, { postId: '667850' }] } })
    expect(seen).toEqual([
      {
        url: cafeBoardSearchUrl({ menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 3 }),
        headers: { 'x-cafe-product': 'pc' },
        referer: cafeBoardSearchReferer('137'),
      },
    ])
  })

  it('names each way a read can fail', async () => {
    const answer = (status: number, text: string) => createBoardSearchPageReader({ http: async () => ({ status, contentType: null, text }) })
    await expect(answer(400, '').read(request)).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_HTTP_ERROR' })
    await expect(answer(200, '<html>').read(request)).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_INVALID_JSON' })
    await expect(answer(200, '{"result":{}}').read(request)).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_PARSE_ERROR' })
    const offline = createBoardSearchPageReader({ http: async () => { throw new Error('offline') } })
    await expect(offline.read(request)).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_NETWORK_ERROR' })
    await expect(offline.read({ ...request, menuId: '0' })).resolves.toEqual({ ok: false, code: 'BOARD_SEARCH_BAD_REQUEST' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/extension/boardSearchPageReader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reader**

```ts
import { CafeArticleListParseError, type CollectedArticlePage } from '../shared/cafeArticleList.js'
import { parseCafeBoardSearchListText } from '../shared/cafeBoardSearchList.js'
import { CAFE_BOARD_SEARCH, cafeBoardSearchReferer, cafeBoardSearchUrl } from '../shared/cafeBoardSearchEndpoint.js'
import type { Http, HttpResponse } from '../shared/http.js'
import { isCollectBoardSearchPageRequest, type CollectBoardSearchPageRequest } from '../shared/protocol.js'

export type BoardSearchPageReadResult =
  | { readonly ok: true; readonly page: number; readonly result: CollectedArticlePage }
  | {
      readonly ok: false
      readonly code: 'BOARD_SEARCH_BAD_REQUEST' | 'BOARD_SEARCH_NETWORK_ERROR' | 'BOARD_SEARCH_HTTP_ERROR' | 'BOARD_SEARCH_INVALID_JSON' | 'BOARD_SEARCH_PARSE_ERROR'
    }

/**
 * Reads exactly one page of one board's title search. Like the list reader it
 * has no loop, cursor, sleep or storage: which query and page come next is the
 * desktop's business.
 */
export function createBoardSearchPageReader(deps: { readonly http: Http }) {
  return {
    async read(request: CollectBoardSearchPageRequest): Promise<BoardSearchPageReadResult> {
      if (!isCollectBoardSearchPageRequest(request)) return { ok: false, code: 'BOARD_SEARCH_BAD_REQUEST' }

      let response: HttpResponse
      try {
        response = await deps.http({
          url: cafeBoardSearchUrl(request),
          headers: CAFE_BOARD_SEARCH.headers,
          referer: cafeBoardSearchReferer(request.menuId),
        })
      } catch {
        return { ok: false, code: 'BOARD_SEARCH_NETWORK_ERROR' }
      }
      if (response.status !== 200) return { ok: false, code: 'BOARD_SEARCH_HTTP_ERROR' }

      try {
        return { ok: true, page: request.page, result: parseCafeBoardSearchListText(response.text) }
      } catch (error) {
        if (error instanceof CafeArticleListParseError && error.code === 'INVALID_JSON') return { ok: false, code: 'BOARD_SEARCH_INVALID_JSON' }
        return { ok: false, code: 'BOARD_SEARCH_PARSE_ERROR' }
      }
    },
  }
}
```

If `HttpRequest.headers` is typed `Readonly<Record<string, string>>` and `CAFE_BOARD_SEARCH.headers` is a readonly literal, it assigns as is; the test compares with `toEqual`, so the `as const` object is fine.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/extension/boardSearchPageReader.test.ts`
Expected: PASS.

- [ ] **Step 5: Manifest and referer rule**

`src/extension/manifest.json` `host_permissions` becomes:

```json
  "host_permissions": [
    "https://cafe.naver.com/*",
    "https://article.cafe.naver.com/*",
    "https://apis.naver.com/*",
    "https://apis.cafe.naver.com/*"
  ],
```

In `tests/extension/manifest.test.ts`, the `toEqual([...])` list gets the fourth entry, and the comment above it gains one line: `// \`apis.cafe.naver.com\` serves the board title search, which the list horizon sends us to.`

In `src/extension/refererRule.ts`, append to `ENDPOINTS`:

```ts
  // The board title search. The search screen sends it from the board's own
  // page, and the worker's request is made to look the same.
  {
    ruleId: 4,
    urlFilter: '||apis.cafe.naver.com/search/v2/cafes/14538121/search/articles',
    requestDomain: 'apis.cafe.naver.com',
  },
```

Open `tests/extension/refererRule.test.ts`, find the test that pins `REFERER_RULE_IDS` or the endpoint list, and add rule 4 there; add one case asserting `refererRuleFor(cafeBoardSearchUrl({...}), cafeBoardSearchReferer('137'))` returns a rule with `id: 4` and the `origin` header `https://cafe.naver.com`, and that `refererRuleFor(cafeArticleListUrl(1, '137'), 'https://cafe.naver.com/')` is still `null`.

- [ ] **Step 6: Dispatch and background**

`src/extension/dispatch.ts`: import `type BoardSearchPageReadResult` from `./boardSearchPageReader.js` and `type CollectBoardSearchPageRequest` from the protocol; add to the deps interface after `boardPageReader`:

```ts
  readonly boardSearchPageReader: { read(request: CollectBoardSearchPageRequest): Promise<BoardSearchPageReadResult> }
```

and after the `COLLECT_BOARD_PAGE` case:

```ts
      case 'COLLECT_BOARD_SEARCH_PAGE': {
        const result = await deps.boardSearchPageReader.read(message)
        if (!result.ok) {
          // Stable and body-free, like the list: a search response names members.
          reply({ type: 'ERROR', requestId: message.requestId, code: result.code, message: result.code })
          return
        }
        reply({ type: 'BOARD_PAGE_COLLECTED', requestId: message.requestId, page: result.page, result: result.result })
        return
      }
```

`src/extension/background.ts`: after `const boardPageReader = …` add `const boardSearchPageReader = createBoardSearchPageReader({ http: request })`, import it, and pass `boardSearchPageReader` wherever `boardPageReader` is passed into the dispatcher's deps.

In `tests/extension/dispatch.test.ts`, every place that builds dispatch deps needs `boardSearchPageReader`; add a stub `{ read: async () => ({ ok: false, code: 'BOARD_SEARCH_BAD_REQUEST' }) }` to the shared deps helper, and add one test: a `COLLECT_BOARD_SEARCH_PAGE` message whose reader returns `{ ok: true, page: 1, result }` is answered with `BOARD_PAGE_COLLECTED` carrying that result.

- [ ] **Step 7: Run the extension tests, types, lint, extension build**

Run: `pnpm vitest run tests/extension && pnpm typecheck && pnpm lint && pnpm build:extension`
Expected: PASS; the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/extension tests/extension
git commit -m "feat: let the extension read one board search page"
```

---

### Task 7: Desktop fetcher and the read gate

**Files:**
- Create: `src/desktop/boardSearchPageFetcher.ts`
- Modify: `src/desktop/naverReadGate.ts`
- Test: `tests/desktop/boardSearchPageFetcher.test.ts`; append to `tests/desktop/naverReadGate.test.ts` (create it if it does not exist)

**Interfaces:**
- Consumes: `CollectionPageError` from `./collectionOrchestrator.js`, `TIMEOUTS.boardPageMs`, `CAFE_BOARD_SEARCH`.
- Produces: `interface BoardSearchPageFetcher { read(page: BoardSearchPage): Promise<CollectedArticlePage> }` and `createBoardSearchPageFetcher(transport: ExtensionTransport, newRequestId: () => string): BoardSearchPageFetcher`.

- [ ] **Step 1: Write the failing tests**

`tests/desktop/boardSearchPageFetcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createBoardSearchPageFetcher } from '../../src/desktop/boardSearchPageFetcher.js'
import { CollectionPageError } from '../../src/desktop/collectionOrchestrator.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'

const page = { menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250828', page: 4 }
const empty = { items: [], pageInfo: { totalArticleCount: 0, lastNavigationPageNumber: 1, visibleNextButton: false }, pageIdentity: 'fnv1a64:0' }

function transportAnswering(reply: (message: AppMessage) => ExtensionMessage, sent: AppMessage[]): ExtensionTransport {
  return {
    isConnected: () => true,
    request: async (message: AppMessage) => {
      sent.push(message)
      return reply(message)
    },
  } as unknown as ExtensionTransport
}

describe('createBoardSearchPageFetcher', () => {
  it('sends one search page request and returns its page', async () => {
    const sent: AppMessage[] = []
    const fetcher = createBoardSearchPageFetcher(
      transportAnswering((m) => ({ type: 'BOARD_PAGE_COLLECTED', requestId: (m as { requestId: string }).requestId, page: 4, result: empty }), sent),
      () => 'req-1',
    )
    await expect(fetcher.read(page)).resolves.toEqual(empty)
    expect(sent).toEqual([{ type: 'COLLECT_BOARD_SEARCH_PAGE', requestId: 'req-1', cafeId: '14538121', pageSize: 50, ...page }])
  })

  it('turns an extension error into a page error with its code', async () => {
    const fetcher = createBoardSearchPageFetcher(
      transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'BOARD_SEARCH_HTTP_ERROR', message: 'BOARD_SEARCH_HTTP_ERROR' }), []),
      () => 'req-1',
    )
    await expect(fetcher.read(page)).rejects.toEqual(new CollectionPageError('BOARD_SEARCH_HTTP_ERROR'))
  })
})
```

For the gate, read `tests/desktop/naverReadGate.test.ts` if it exists and copy its setup; the new case is: with a `COLLECT` in flight, a `COLLECT_BOARD_SEARCH_PAGE` request is not passed to the inner transport until the `COLLECT` settles — the same assertion the file makes for `COLLECT_BOARD_PAGE`, with the message swapped. If no such test file exists, create it with that one case plus the same case for `COLLECT_BOARD_PAGE`, using a hand-rolled inner transport whose `request` returns a promise you resolve manually.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/desktop/boardSearchPageFetcher.test.ts tests/desktop/naverReadGate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the fetcher**

```ts
import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import { CAFE_ARTICLE_LIST } from '../shared/cafeArticleFixture.js'
import { CAFE_BOARD_SEARCH, type BoardSearchPage } from '../shared/cafeBoardSearchEndpoint.js'
import { TIMEOUTS, type AppMessage } from '../shared/protocol.js'
import { CollectionPageError } from './collectionOrchestrator.js'
import type { ExtensionTransport } from './ws/server.js'

export interface BoardSearchPageFetcher {
  read(page: BoardSearchPage): Promise<CollectedArticlePage>
}

export function createBoardSearchPageFetcher(transport: ExtensionTransport, newRequestId: () => string): BoardSearchPageFetcher {
  return {
    async read(page) {
      const message: Extract<AppMessage, { type: 'COLLECT_BOARD_SEARCH_PAGE' }> = {
        type: 'COLLECT_BOARD_SEARCH_PAGE',
        requestId: newRequestId(),
        cafeId: CAFE_ARTICLE_LIST.cafeId,
        pageSize: CAFE_BOARD_SEARCH.perPage,
        ...page,
      }
      const reply = await transport.request(message, TIMEOUTS.boardPageMs)
      if (reply.type === 'BOARD_PAGE_COLLECTED') return reply.result
      if (reply.type === 'ERROR') throw new CollectionPageError(reply.code)
      throw new CollectionPageError('BOARD_SEARCH_UNEXPECTED_REPLY')
    },
  }
}
```

Check that `TIMEOUTS` is exported from `protocol.ts` (it is used by `collectionOrchestrator.ts`; import it from the same place that file does).

- [ ] **Step 4: Queue search pages in the read gate**

In `src/desktop/naverReadGate.ts`:

```ts
type PageRead = Extract<AppMessage, { type: 'COLLECT_BOARD_PAGE' | 'COLLECT_BOARD_SEARCH_PAGE' }>

function isPageRead(message: AppMessage): message is PageRead {
  return message.type === 'COLLECT_BOARD_PAGE' || message.type === 'COLLECT_BOARD_SEARCH_PAGE'
}
```

Change `QueuedBoardPage.message` to `PageRead`, and replace `if (message.type === 'COLLECT_BOARD_PAGE') {` with `if (isPageRead(message)) {`. Extend the doc comment's first sentence: "Serializes all Naver reads — list and search pages alike — without changing …".

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run tests/desktop/boardSearchPageFetcher.test.ts tests/desktop/naverReadGate.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/desktop/boardSearchPageFetcher.ts src/desktop/naverReadGate.ts tests/desktop/boardSearchPageFetcher.test.ts tests/desktop/naverReadGate.test.ts
git commit -m "feat: request board search pages through the read gate"
```

---

### Task 8: Schema and migration

**Files:**
- Create: `src/desktop/collection-db/boardSearchSchema.ts`
- Modify: `src/desktop/collection-db/schema.ts` (enum, `runs.search_query`, re-export)
- Generate: `drizzle-collection/0007_*.sql`, `drizzle-collection/meta/0007_snapshot.json`, `drizzle-collection/meta/_journal.json`
- Modify: `tests/desktop/collection-db/integration.test.ts` (`COLLECTION_TABLES`)
- Test: append to `tests/desktop/collection-db/schema.test.ts`

**Interfaces:**
- Produces: drizzle table `boardSearchState` with columns `boardId, query, fromDay, toDay, queueOrder, expectedGain, lastCommittedPage, insertedCount, totalCount, lastRunId, completedAt, updatedAt`; `collectionRuns.searchQuery`.

- [ ] **Step 1: Write the failing schema test** (append to `schema.test.ts`)

```ts
describe('board search migration', () => {
  const latest = readdirSync(migrationsDirectory).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort().at(-1) ?? 'missing.sql'
  const sqlText = readFileSync(`${migrationsDirectory}/${latest}`, 'utf8')

  it('adds the search state table keyed by board and query', () => {
    expect(sqlText).toContain('CREATE TABLE "board_search_state"')
    expect(sqlText).toContain('"board_search_state_pkey" PRIMARY KEY("board_id","query")')
    expect(sqlText).toContain('REFERENCES "public"."boards"')
    expect(sqlText).toContain('REFERENCES "public"."runs"')
  })

  it('lets a run name the search it walked', () => {
    expect(sqlText).toContain("ADD VALUE 'board_search'")
    expect(sqlText).toContain('ADD COLUMN "search_query" text')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/desktop/collection-db/schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the table** `src/desktop/collection-db/boardSearchSchema.ts`

```ts
import { sql } from 'drizzle-orm'
import { check, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { boards, collectionRuns } from './schema.js'

const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * Where the search backfill stands, one row per query. Every row of a job has
 * the same board and window; making a new job replaces them all. The cursor is
 * a page number: the window ends in the past, so no new post can push the
 * results along underneath it.
 */
export const boardSearchState = pgTable(
  'board_search_state',
  {
    boardId: text('board_id').notNull().references(() => boards.boardId),
    query: text('query').notNull(),
    /** KST `yyyymmdd`, inclusive. */
    fromDay: text('from_day').notNull(),
    /** KST `yyyymmdd`, inclusive. */
    toDay: text('to_day').notNull(),
    /** Fixed when the job is made, so "how far along" means the same thing every day. */
    queueOrder: integer('queue_order').notNull(),
    /** Stored titles the dictionary expected this query to add. */
    expectedGain: integer('expected_gain').notNull(),
    lastCommittedPage: integer('last_committed_page'),
    insertedCount: integer('inserted_count').notNull().default(0),
    /** The search's own `totalArticleCount`, written with the first page. */
    totalCount: integer('total_count'),
    lastRunId: uuid('last_run_id').references(() => collectionRuns.id),
    completedAt: observedTimestamp('completed_at'),
    updatedAt: observedTimestamp('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.query], name: 'board_search_state_pkey' }),
    check('board_search_state_window', sql`${table.fromDay} <= ${table.toDay}`),
    check('board_search_state_queue_order', sql`${table.queueOrder} >= 1`),
    check('board_search_state_counts', sql`${table.expectedGain} >= 0 and ${table.insertedCount} >= 0 and (${table.totalCount} is null or ${table.totalCount} >= 0)`),
    check('board_search_state_page', sql`${table.lastCommittedPage} is null or ${table.lastCommittedPage} >= 1`),
  ],
)
```

- [ ] **Step 4: Extend `schema.ts`**

1. `collectionFeedKind`: `pgEnum('collection_feed_kind', ['all_articles', 'notices', 'recommended', 'board', 'board_search'])`
2. In `collectionRuns`, after `menuId`: 
```ts
    /** The title search a `board_search` run walked; null for every list walk. */
    searchQuery: text('search_query'),
```
3. Do **not** re-export `boardSearchSchema.ts` from `schema.ts`: it imports `boards` and `collectionRuns` from there, and a re-export would make the two files load each other. Instead, in `drizzle.collection.config.ts`, point Drizzle Kit at both files:

```ts
  schema: ['./src/desktop/collection-db/schema.ts', './src/desktop/collection-db/boardSearchSchema.ts'],
```

with a one-line comment above it: `// The board search table imports from schema.ts, so it is listed here rather than re-exported there.`

- [ ] **Step 5: Generate the migration and read it**

Run: `pnpm db:collection:generate`
Then read the new `drizzle-collection/0007_*.sql`. It must contain, and only contain: `ALTER TYPE "public"."collection_feed_kind" ADD VALUE 'board_search';`, `CREATE TABLE "board_search_state" (…)` with the PK and four checks, `ALTER TABLE "runs" ADD COLUMN "search_query" text;`, and the two foreign keys. Anything else (a dropped or altered existing column) means the schema edit was wrong — fix the schema and regenerate; never hand-edit the SQL.

`ALTER TYPE … ADD VALUE` cannot run inside a transaction block on PostgreSQL < 12; the local server is newer (check `psql -c 'show server_version'`), and drizzle's migrator runs it fine there.

- [ ] **Step 6: Clean-up list in the integration test**

In `tests/desktop/collection-db/integration.test.ts`, `COLLECTION_TABLES` becomes `['board_search_state', 'member_resync_state', 'members', 'member_runs', 'member_feed_state', 'posts', 'boards', 'feed_state', 'runs']`.

- [ ] **Step 7: Run to verify pass**

Run: `pnpm vitest run tests/desktop/collection-db && pnpm typecheck`
Expected: PASS. If the integration DB is available, run the integration command too: the existing tests must pass on the new migration.

- [ ] **Step 8: Commit**

```bash
git add src/desktop/collection-db/boardSearchSchema.ts src/desktop/collection-db/schema.ts drizzle-collection tests/desktop/collection-db/schema.test.ts tests/desktop/collection-db/integration.test.ts drizzle.collection.config.ts
git commit -m "feat: add the board search state table and run query column"
```

---

### Task 9: Board search repository

**Files:**
- Create: `src/desktop/collection-db/boardSearchRepository.ts`
- Test: append a block to `tests/desktop/collection-db/integration.test.ts`

**Interfaces:**
- Consumes: `writePostRows` (Task 1), `boardSearchState` (Task 8), `kstDayKeyRange` (Task 2), `CollectionRepository.recordPageRequest`.
- Produces:

```ts
export interface BoardSearchQueryState {
  readonly boardId: string
  readonly query: string
  readonly fromDay: string
  readonly toDay: string
  readonly queueOrder: number
  readonly expectedGain: number
  readonly lastCommittedPage: number | null
  readonly insertedCount: number
  readonly totalCount: number | null
  readonly complete: boolean
  readonly lastRunId: string | null
}

export interface ReplaceBoardSearchJobInput {
  readonly boardId: string
  readonly fromDay: string
  readonly toDay: string
  readonly queries: readonly BoardSearchQuery[]
  readonly at: Date
}

export interface BoardSearchRunInput {
  readonly id: string
  readonly boardId: string
  readonly query: string
  readonly fromDay: string
  readonly toDay: string
  readonly startedAt: Date
}

export interface PersistBoardSearchPageInput {
  readonly runId: string
  readonly boardId: string
  readonly query: string
  readonly page: number
  readonly observedAt: Date
  readonly result: CollectedArticlePage
}

export interface CollectableBoard { readonly boardId: string; readonly name: string }

export interface BoardSearchRepository {
  listQueries(): Promise<readonly BoardSearchQueryState[]>
  listCollectableBoards(): Promise<readonly CollectableBoard[]>
  readBoardTitles(boardId: string): Promise<readonly string[]>
  oldestPostedAtMs(boardId: string): Promise<number | null>
  replaceJob(input: ReplaceBoardSearchJobInput): Promise<void>
  startRun(input: BoardSearchRunInput): Promise<void>
  recordPageRequest(runId: string): Promise<void>
  persistPage(input: PersistBoardSearchPageInput): Promise<{ readonly insertedPostCount: number; readonly updatedPostCount: number }>
  finishRun(runId: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
}

export function createBoardSearchRepository(db: CollectionDatabase, collection: CollectionRepository): BoardSearchRepository
```

- [ ] **Step 1: Write the failing integration test** (inside the `integration(...)` block, after the last `it`)

```ts
  it('keeps a search job query by query, writing pages and completion atomically', async () => {
    const collection = createCollectionRepository(connection.db)
    const search = createBoardSearchRepository(connection.db, collection)
    const at = new Date('2026-09-25T00:00:00.000Z')
    // The search names no board, so the board row must exist before its posts.
    await pool.query(`insert into boards (board_id, name, first_seen_at, last_seen_at) values ('137', '국내구입기 & 정보', $1, $1) on conflict do nothing`, [at])

    await search.replaceJob({
      boardId: '137', fromDay: '20250101', toDay: '20250829', at,
      queries: [{ query: '글렌', expectedGain: 10 }, { query: '구매', expectedGain: 5 }],
    })
    expect((await search.listQueries()).map((q) => [q.queueOrder, q.query, q.complete])).toEqual([[1, '글렌', false], [2, '구매', false]])

    const runId = randomUUID()
    await search.startRun({ id: runId, boardId: '137', query: '글렌', fromDay: '20250101', toDay: '20250829', startedAt: at })
    await expect(search.replaceJob({ boardId: '137', fromDay: '20250101', toDay: '20250829', at, queries: [] })).rejects.toThrow()

    const searchPage = parseCafeBoardSearchListText(
      readFileSync(fileURLToPath(new URL('../../fixtures/cafe-board-search-sample.json', import.meta.url)), 'utf8'),
    )
    const written = await search.persistPage({ runId, boardId: '137', query: '글렌', page: 1, observedAt: at, result: searchPage })
    expect(written).toEqual({ insertedPostCount: 2, updatedPostCount: 0 })
    const again = await search.persistPage({ runId, boardId: '137', query: '글렌', page: 1, observedAt: at, result: searchPage })
    expect(again).toEqual({ insertedPostCount: 0, updatedPostCount: 2 })

    await search.finishRun(runId, 'succeeded', null, at)
    const [glen, buy] = await search.listQueries()
    expect(glen).toMatchObject({ lastCommittedPage: 1, insertedCount: 2, totalCount: 578, complete: true, lastRunId: runId })
    expect(buy).toMatchObject({ lastCommittedPage: null, insertedCount: 0, totalCount: null, complete: false })

    const run = await pool.query<{ feed_kind: string; menu_id: string; search_query: string; collection_pages: number; inserted_post_count: number }>(
      'select feed_kind, menu_id, search_query, collection_pages, inserted_post_count from runs where id = $1', [runId],
    )
    expect(run.rows[0]).toEqual({ feed_kind: 'board_search', menu_id: '137', search_query: '글렌', collection_pages: 2, inserted_post_count: 2 })

    await search.replaceJob({ boardId: '137', fromDay: '20250101', toDay: '20250829', at, queries: [{ query: '이마트', expectedGain: 3 }] })
    expect((await search.listQueries()).map((q) => q.query)).toEqual(['이마트'])
    expect(await search.readBoardTitles('137')).toEqual(expect.arrayContaining(['글렌알라키 12 이마트 구매', '글렌 두 병']))
    expect(await search.oldestPostedAtMs('137')).toBe(Date.UTC(2025, 0, 30, 23, 1))
  })
```

Add the imports `createBoardSearchRepository` and `parseCafeBoardSearchListText` at the top of the file. Check the `boards` columns in `schema.ts` (~line 76) before relying on the raw insert: every `notNull()` column without a default must be in it.

- [ ] **Step 2: Run to verify failure**

Run the integration command. Expected: FAIL — module not found. If no test database is available, run `pnpm typecheck` instead and expect it to fail on the missing module; note in the task report that the integration run is pending on the operator's test database.

- [ ] **Step 3: Implement**

```ts
import { and, asc, eq, min, sql } from 'drizzle-orm'
import type { BoardSearchQuery } from '../../shared/boardSearchDictionary.js'
import type { CollectedArticlePage } from '../../shared/cafeArticleList.js'
import { kstDayKeyRange } from '../../shared/kst.js'
import type { CollectionDatabase } from './client.js'
import { writePostRows } from './postPageWrite.js'
import type { CollectionRepository } from './repository.js'
import { boards, collectionRuns, posts } from './schema.js'
import { boardSearchState } from './boardSearchSchema.js'

// (the interfaces listed under "Produces" above go here, exported)

type StateRow = typeof boardSearchState.$inferSelect

function toQueryState(row: StateRow): BoardSearchQueryState {
  return {
    boardId: row.boardId,
    query: row.query,
    fromDay: row.fromDay,
    toDay: row.toDay,
    queueOrder: row.queueOrder,
    expectedGain: row.expectedGain,
    lastCommittedPage: row.lastCommittedPage,
    insertedCount: row.insertedCount,
    totalCount: row.totalCount,
    complete: row.completedAt !== null,
    lastRunId: row.lastRunId,
  }
}

function sameQuery(boardId: string, query: string) {
  return and(eq(boardSearchState.boardId, boardId), eq(boardSearchState.query, query))
}

export function createBoardSearchRepository(db: CollectionDatabase, collection: CollectionRepository): BoardSearchRepository {
  return {
    async listQueries() {
      const rows = await db.select().from(boardSearchState).orderBy(asc(boardSearchState.queueOrder))
      return rows.map(toQueryState)
    },

    async listCollectableBoards() {
      return await db
        .select({ boardId: boards.boardId, name: boards.name })
        .from(boards)
        .where(eq(boards.collectEnabled, true))
        .orderBy(asc(boards.name))
    },

    async readBoardTitles(boardId) {
      const rows = await db.select({ title: posts.title }).from(posts).where(eq(posts.boardId, boardId))
      return rows.flatMap((row) => (row.title === null ? [] : [row.title]))
    },

    async oldestPostedAtMs(boardId) {
      const rows = await db.select({ oldest: min(posts.postedAt) }).from(posts).where(eq(posts.boardId, boardId))
      return rows[0]?.oldest?.getTime() ?? null
    },

    async replaceJob(input) {
      await db.transaction(async (tx) => {
        const running = await tx
          .select({ id: collectionRuns.id })
          .from(collectionRuns)
          .where(and(eq(collectionRuns.feedKind, 'board_search'), eq(collectionRuns.status, 'running')))
          .limit(1)
        if (running.length > 0) throw new Error('cannot replace the search job while a run is writing its cursor')
        await tx.delete(boardSearchState)
        if (input.queries.length === 0) return
        await tx.insert(boardSearchState).values(
          input.queries.map((entry, index) => ({
            boardId: input.boardId,
            query: entry.query,
            fromDay: input.fromDay,
            toDay: input.toDay,
            queueOrder: index + 1,
            expectedGain: entry.expectedGain,
            updatedAt: input.at,
          })),
        )
      })
    },

    async startRun(input) {
      await db.insert(collectionRuns).values({
        id: input.id,
        feedKind: 'board_search',
        menuId: input.boardId,
        searchQuery: input.query,
        runKind: 'backfill',
        targetStartMs: kstDayKeyRange(input.fromDay).startMs,
        targetEndMs: kstDayKeyRange(input.toDay).endMs,
        status: 'running',
        startedAt: input.startedAt,
      })
    },

    recordPageRequest(runId) {
      return collection.recordPageRequest(runId, 'collection')
    },

    async persistPage(input) {
      const items = input.result.items
      const anchor = items.at(-1)
      if (anchor === undefined) throw new Error('an empty search page ends the query; it is not persisted')
      return await db.transaction(async (tx) => {
        const written = await writePostRows(tx, items, input.observedAt, input.runId)
        const run = await tx
          .update(collectionRuns)
          .set({
            collectionPages: sql`${collectionRuns.collectionPages} + 1`,
            observedPostCount: sql`${collectionRuns.observedPostCount} + ${items.length}`,
            insertedPostCount: sql`${collectionRuns.insertedPostCount} + ${written.insertedPostCount}`,
            updatedPostCount: sql`${collectionRuns.updatedPostCount} + ${written.updatedPostCount}`,
            lastCommittedPostId: anchor.postId,
            lastCommittedPage: input.page,
          })
          .where(eq(collectionRuns.id, input.runId))
          .returning({ id: collectionRuns.id })
        if (run.length !== 1) throw new Error('board search run does not exist')
        const state = await tx
          .update(boardSearchState)
          .set({
            lastCommittedPage: input.page,
            insertedCount: sql`${boardSearchState.insertedCount} + ${written.insertedPostCount}`,
            totalCount: sql`coalesce(${boardSearchState.totalCount}, ${input.result.pageInfo.totalArticleCount})`,
            lastRunId: input.runId,
            updatedAt: input.observedAt,
          })
          .where(sameQuery(input.boardId, input.query))
          .returning({ query: boardSearchState.query })
        if (state.length !== 1) throw new Error('board search query does not exist')
        return written
      })
    },

    async finishRun(runId, status, stopReason, finishedAt) {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(collectionRuns)
          .set({ status, stopReason, finishedAt })
          .where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, 'running')))
          .returning({ boardId: collectionRuns.menuId, query: collectionRuns.searchQuery })
        const run = updated[0]
        if (run === undefined) throw new Error('board search run is not running')
        // Only reaching the empty page past the end finishes a query.
        if (status !== 'succeeded' || run.query === null) return
        await tx.update(boardSearchState).set({ completedAt: finishedAt, updatedAt: finishedAt }).where(sameQuery(run.boardId, run.query))
      })
    },
  }
}
```

`totalArticleCount` is `number | null` in `CafeArticlePageInfo`; `coalesce(total_count, null)` leaves a null, which is right for a search that did not report one.

- [ ] **Step 4: Run to verify pass**

Run the integration command (or `pnpm typecheck` if no test DB; see Step 2).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/collection-db/boardSearchRepository.ts tests/desktop/collection-db/integration.test.ts
git commit -m "feat: store the board search job, its runs and its pages"
```

---

### Task 10: Page guard and the runner

**Files:**
- Create: `src/desktop/boardSearchPageCheck.ts`, `src/desktop/boardSearchRunner.ts`
- Test: `tests/desktop/boardSearchPageCheck.test.ts`, `tests/desktop/boardSearchRunner.test.ts`

**Interfaces:**
- Consumes: Task 7 fetcher, Task 9 repository, `pauseUnlessStopped`, `collectionDelayMs`, `CollectionPageError`, `describeFailure`, `CollectionLock`, `CollectionStartResult`.
- Produces:
  - `assertBoardSearchPage(result: CollectedArticlePage, expected: { boardId: string; fromDay: string; toDay: string }): void` — throws `CollectionPageError('BOARD_SEARCH_WRONG_BOARD' | 'BOARD_SEARCH_OUT_OF_WINDOW' | 'BOARD_PAGE_DUPLICATE_POST')`.
  - `createBoardSearchRunner(deps: BoardSearchRunnerDeps): BoardSearchRunner` with `start(request: { maxPages: number }): CollectionStartResult`, `stop(): void`, `isRunning(): boolean`.
  - `BoardSearchRunnerDeps` = `{ repository: () => BoardSearchRepository | null; fetcher: BoardSearchPageFetcher; isConnected: () => boolean; clock: CollectionClock; random: Random; pacing: () => CollectionPacing; sleep: (ms: number) => Promise<void>; isSessionBusy: () => boolean; lock: CollectionLock; newId: () => string; onError?: (error: unknown) => void }`.

- [ ] **Step 1: Write the failing guard test**

```ts
import { describe, expect, it } from 'vitest'
import { assertBoardSearchPage } from '../../src/desktop/boardSearchPageCheck.js'
import { CollectionPageError } from '../../src/desktop/collectionOrchestrator.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'

const post = (postId: string, boardId: string, postedAt: number): CollectedPostMetadata => ({
  cafeId: '14538121', postId, boardId, boardName: null, title: 't', prefix: null, authorId: null, authorNickname: null,
  postedAt, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false,
})
const pageOf = (items: CollectedPostMetadata[]): CollectedArticlePage => ({
  items, pageInfo: { totalArticleCount: items.length, lastNavigationPageNumber: 1, visibleNextButton: false }, pageIdentity: 'x',
})
const window = { boardId: '137', fromDay: '20250101', toDay: '20250131' }
const code = (run: () => void) => { try { run(); return null } catch (e) { return (e as CollectionPageError).code } }

describe('assertBoardSearchPage', () => {
  it('accepts posts of the board inside the KST window, both ends included', () => {
    const firstInstant = Date.UTC(2024, 11, 31, 15) // 2025-01-01 00:00 KST
    const lastInstant = Date.UTC(2025, 0, 31, 14, 59, 59, 999) // 2025-01-31 23:59:59.999 KST
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '137', firstInstant), post('2', '137', lastInstant)]), window))).toBeNull()
  })

  it('refuses a post from another board', () => {
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '188', Date.UTC(2025, 0, 10))]), window))).toBe('BOARD_SEARCH_WRONG_BOARD')
  })

  it('refuses a post outside the window', () => {
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '137', Date.UTC(2025, 0, 31, 15))]), window))).toBe('BOARD_SEARCH_OUT_OF_WINDOW')
    expect(code(() => assertBoardSearchPage(pageOf([post('1', '137', Date.UTC(2024, 11, 31, 14, 59))]), window))).toBe('BOARD_SEARCH_OUT_OF_WINDOW')
  })
})
```

- [ ] **Step 2: Write the failing runner test** `tests/desktop/boardSearchRunner.test.ts`

The fake repository records calls; the fake fetcher answers from a map of `query → pages`. Pacing is zero-delay.

```ts
import { describe, expect, it } from 'vitest'
import { createBoardSearchRunner } from '../../src/desktop/boardSearchRunner.js'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'
import { CollectionPageError } from '../../src/desktop/collectionOrchestrator.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchPageFetcher } from '../../src/desktop/boardSearchPageFetcher.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'
import type { CollectionPacing } from '../../src/shared/collectionPacing.js'

const NO_WAIT: CollectionPacing = { pageDelaySeconds: { min: 0, max: 0 }, shortBreakSeconds: { min: 0, max: 0 }, longBreakSeconds: { min: 0, max: 0 } } as unknown as CollectionPacing

const postAt = (id: number): CollectedPostMetadata => ({
  cafeId: '14538121', postId: String(id), boardId: '137', boardName: null, title: 't', prefix: null, authorId: null, authorNickname: null,
  postedAt: Date.UTC(2025, 0, 10), viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false,
})
const page = (ids: number[], total: number): CollectedArticlePage => ({
  items: ids.map(postAt), pageInfo: { totalArticleCount: total, lastNavigationPageNumber: 1, visibleNextButton: false }, pageIdentity: ids.join(','),
})
const EMPTY = page([], 0)

function query(q: string, order: number, lastCommittedPage: number | null = null, complete = false): BoardSearchQueryState {
  return { boardId: '137', query: q, fromDay: '20250101', toDay: '20250829', queueOrder: order, expectedGain: 1, lastCommittedPage, insertedCount: 0, totalCount: null, complete, lastRunId: null }
}

function harness(
  queries: BoardSearchQueryState[],
  pages: Record<string, CollectedArticlePage[]>,
  fail: Record<string, string> = {},
  onRead: (query: string, page: number) => void = () => undefined,
) {
  const events: string[] = []
  const repository: BoardSearchRepository = {
    listQueries: async () => queries,
    listCollectableBoards: async () => [],
    readBoardTitles: async () => [],
    oldestPostedAtMs: async () => null,
    replaceJob: async () => undefined,
    startRun: async (input) => { events.push(`start ${input.query}`) },
    recordPageRequest: async () => undefined,
    persistPage: async (input) => { events.push(`store ${input.query} p${input.page}`); return { insertedPostCount: input.result.items.length, updatedPostCount: 0 } },
    finishRun: async (_id, status, reason) => { events.push(`finish ${status}${reason === null ? '' : ' ' + reason}`) },
  }
  const fetcher: BoardSearchPageFetcher = {
    read: async ({ query: q, page: p }) => {
      events.push(`read ${q} p${p}`)
      onRead(q, p)
      if (fail[q] !== undefined) throw new CollectionPageError(fail[q])
      return pages[q]?.[p - 1] ?? EMPTY
    },
  }
  let id = 0
  const runner = createBoardSearchRunner({
    repository: () => repository, fetcher, isConnected: () => true, clock: { now: () => 0 }, random: { next: () => 0 } as never,
    pacing: () => NO_WAIT, sleep: async () => undefined, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => `run-${++id}`,
  })
  const settle = async () => { while (runner.isRunning()) await new Promise((resolve) => setTimeout(resolve, 0)) }
  return { runner, events, settle }
}

describe('boardSearchRunner', () => {
  it('walks each query to its empty page and moves on within the budget', async () => {
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1, 2], 3), page([3], 3)], 구매: [page([4], 1)] })
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'started' })
    await h.settle()
    expect(h.events).toEqual([
      'start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'read 글렌 p2', 'store 글렌 p2', 'read 글렌 p3', 'finish succeeded',
      'start 구매', 'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded',
    ])
  })

  it('stops where the budget runs out and leaves the rest for the next block', async () => {
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1], 9), page([2], 9), page([3], 9)] })
    h.runner.start({ maxPages: 2 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'read 글렌 p2', 'store 글렌 p2', 'finish partial PAGE_BUDGET_SPENT'])
  })

  it('re-reads the last stored page when a query resumes', async () => {
    const h = harness([query('글렌', 1, 2)], { 글렌: [page([1], 3), page([2], 3), page([3], 3)] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events.slice(0, 4)).toEqual(['start 글렌', 'read 글렌 p2', 'store 글렌 p2', 'read 글렌 p3'])
  })

  it('skips finished queries, and moves on after a failure', async () => {
    const h = harness([query('끝남', 1, 5, true), query('글렌', 2), query('구매', 3)], { 구매: [page([4], 1)] }, { 글렌: 'BOARD_SEARCH_HTTP_ERROR' })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual([
      'start 글렌', 'read 글렌 p1', 'finish failed BOARD_SEARCH_HTTP_ERROR',
      'start 구매', 'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded',
    ])
  })

  it('does not store a page that breaks the board or window guard', async () => {
    const stray = { ...page([9], 1), items: [{ ...postAt(9), boardId: '188' }] }
    const h = harness([query('글렌', 1)], { 글렌: [stray] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'finish failed BOARD_SEARCH_WRONG_BOARD'])
  })

  it('ends the block at a stop and does not go on to the next query', async () => {
    // The stop is pressed while page 1 is being read: that page is kept, and
    // the wait before page 2 is where it lands.
    let stop = () => undefined as void
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1], 9), page([2], 9)] }, {}, (q, p) => { if (q === '글렌' && p === 1) stop() })
    stop = () => h.runner.stop()
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'finish interrupted ABORTED'])
  })

  it('does not begin a query once a stop has been asked for', async () => {
    const h = harness([query('글렌', 1)], { 글렌: [page([1], 9)] })
    h.runner.start({ maxPages: 10 })
    h.runner.stop()
    await h.settle()
    expect(h.events).toEqual([])
  })

  it('refuses a second start and a start with the extension away', async () => {
    const h = harness([query('글렌', 1)], {})
    h.runner.start({ maxPages: 10 })
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })
    await h.settle()
  })
})
```

Before writing `NO_WAIT`, open `src/shared/collectionPacing.ts` and build the object with its real field names so every delay is 0 (drop the `as unknown as` cast once the shape matches). Likewise check `Random`'s method name in `src/shared/ports.ts` and use it in the harness.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run tests/desktop/boardSearchPageCheck.test.ts tests/desktop/boardSearchRunner.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the guard** `src/desktop/boardSearchPageCheck.ts`

```ts
import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import { kstDayKeyRange } from '../shared/kst.js'
import { CollectionPageError } from './collectionOrchestrator.js'

export interface BoardSearchWindow {
  readonly boardId: string
  readonly fromDay: string
  readonly toDay: string
}

/**
 * What a search page must be before any of it is stored. The search is asked
 * for one board and one window; a post from anywhere else means the filter came
 * loose, and filling the gap with it would pass a stray post off as recovered.
 */
export function assertBoardSearchPage(result: CollectedArticlePage, expected: BoardSearchWindow): void {
  const startMs = kstDayKeyRange(expected.fromDay).startMs
  const endMs = kstDayKeyRange(expected.toDay).endMs
  const ids = new Set<string>()
  for (const item of result.items) {
    if (ids.has(item.postId)) throw new CollectionPageError('BOARD_PAGE_DUPLICATE_POST', item.postId)
    ids.add(item.postId)
    if (item.boardId !== expected.boardId) throw new CollectionPageError('BOARD_SEARCH_WRONG_BOARD', `${item.postId} on ${item.boardId}`)
    if (item.postedAt < startMs || item.postedAt >= endMs) throw new CollectionPageError('BOARD_SEARCH_OUT_OF_WINDOW', item.postId)
  }
}
```

- [ ] **Step 5: Implement the runner** `src/desktop/boardSearchRunner.ts`

```ts
import type { CollectionPacing } from '../shared/collectionPacing.js'
import { collectionDelayMs } from '../shared/collectionPacing.js'
import type { Random } from '../shared/ports.js'
import type { BoardSearchQueryState, BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { BoardSearchPageFetcher } from './boardSearchPageFetcher.js'
import { assertBoardSearchPage } from './boardSearchPageCheck.js'
import { describeFailure } from './collectionFailure.js'
import type { CollectionLock } from './collectionLock.js'
import { CollectionPageError, type CollectionClock } from './collectionOrchestrator.js'
import { pauseUnlessStopped } from './collectionPause.js'
import type { CollectionStartResult } from './collectionRunner.js'

export interface BoardSearchRunnerDeps {
  readonly repository: () => BoardSearchRepository | null
  readonly fetcher: BoardSearchPageFetcher
  readonly isConnected: () => boolean
  readonly clock: CollectionClock
  readonly random: Random
  /** Read once per block, like the list walk's: the budget came from the same pacing. */
  readonly pacing: () => CollectionPacing
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  /** The same lock the list and member walks take: one browser session, one walk. */
  readonly lock: CollectionLock
  readonly newId: () => string
  readonly onError?: (error: unknown) => void
}

export interface BoardSearchRunner {
  start(request: { readonly maxPages: number }): CollectionStartResult
  stop(): void
  isRunning(): boolean
}

type QueryOutcome = { readonly requests: number; readonly interrupted: boolean }

export function createBoardSearchRunner(deps: BoardSearchRunnerDeps): BoardSearchRunner {
  let inFlight: Promise<void> | null = null
  let abortRequested = false

  async function waitForTurn(ordinal: number, pacing: CollectionPacing): Promise<void> {
    const yieldToSession = async () => {
      while (deps.isSessionBusy()) {
        if (abortRequested) throw new CollectionPageError('ABORTED')
        await deps.sleep(1_000)
      }
    }
    await yieldToSession()
    if (!(await pauseUnlessStopped(collectionDelayMs(ordinal, pacing, deps.random), deps.sleep, () => abortRequested))) {
      throw new CollectionPageError('ABORTED')
    }
    await yieldToSession()
    if (abortRequested) throw new CollectionPageError('ABORTED')
  }

  /**
   * One query, from its cursor to its empty page or the end of the budget. A
   * resumed query reads its last stored page again: a post deleted from the
   * window since then pulls the results forward, and the re-read picks up the
   * one that slid onto it.
   */
  async function walkQuery(repository: BoardSearchRepository, query: BoardSearchQueryState, budget: number, spentBefore: number, pacing: CollectionPacing): Promise<QueryOutcome> {
    const runId = deps.newId()
    await repository.startRun({ id: runId, boardId: query.boardId, query: query.query, fromDay: query.fromDay, toDay: query.toDay, startedAt: new Date(deps.clock.now()) })
    let requests = 0
    let pageNumber = query.lastCommittedPage ?? 1
    const finish = async (status: 'succeeded' | 'partial' | 'failed' | 'interrupted', reason: string | null): Promise<QueryOutcome> => {
      await repository.finishRun(runId, status, reason, new Date(deps.clock.now()))
      return { requests, interrupted: status === 'interrupted' }
    }
    try {
      for (;;) {
        if (requests >= budget) return await finish('partial', 'PAGE_BUDGET_SPENT')
        await waitForTurn(spentBefore + requests + 1, pacing)
        await repository.recordPageRequest(runId)
        requests += 1
        const observedAt = new Date(deps.clock.now())
        const result = await deps.fetcher.read({ menuId: query.boardId, query: query.query, fromDay: query.fromDay, toDay: query.toDay, page: pageNumber })
        if (result.items.length === 0) return await finish('succeeded', null)
        assertBoardSearchPage(result, query)
        await repository.persistPage({ runId, boardId: query.boardId, query: query.query, page: pageNumber, observedAt, result })
        pageNumber += 1
      }
    } catch (error) {
      if (error instanceof CollectionPageError && error.code === 'ABORTED') return await finish('interrupted', 'ABORTED')
      return await finish('failed', error instanceof CollectionPageError ? error.code : describeFailure(error))
    }
  }

  /** A block over the queue: unused budget passes on, a failure moves on, a stop does not. */
  async function walk(repository: BoardSearchRepository, maxPages: number): Promise<void> {
    const pacing = deps.pacing()
    let spent = 0
    for (const query of await repository.listQueries()) {
      if (query.complete) continue
      if (abortRequested || spent >= maxPages) break
      const outcome = await walkQuery(repository, query, maxPages - spent, spent, pacing)
      spent += outcome.requests
      if (outcome.interrupted) break
    }
  }

  return {
    start(request) {
      if (inFlight !== null) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      const repository = deps.repository()
      if (repository === null) return { kind: 'refused', reason: 'NO_STORAGE' }
      if (!deps.isConnected()) return { kind: 'refused', reason: 'BRIDGE_OFFLINE' }
      if (!deps.lock.tryAcquire()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      abortRequested = false
      inFlight = walk(repository, request.maxPages)
        .catch((error: unknown) => { deps.onError?.(error) })
        .finally(() => { inFlight = null; deps.lock.release() })
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

`describeFailure` — confirm its signature in `src/desktop/collectionFailure.ts` (`describeFailure(error: unknown): string`, line 13).

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run tests/desktop/boardSearchPageCheck.test.ts tests/desktop/boardSearchRunner.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/desktop/boardSearchPageCheck.ts src/desktop/boardSearchRunner.ts tests/desktop/boardSearchPageCheck.test.ts tests/desktop/boardSearchRunner.test.ts
git commit -m "feat: walk a block of board search queries"
```

---

### Task 11: Planning a job, the loop job, and wiring

**Files:**
- Create: `src/desktop/boardSearchPlan.ts`, `src/desktop/boardSearchJob.ts`
- Modify: `src/desktop/collectionJob.ts` (name union), `src/desktop/collectionContext.ts`, `src/desktop/bootstrap.ts`, `src/desktop/main.ts`
- Test: `tests/desktop/boardSearchPlan.test.ts`, `tests/desktop/boardSearchJob.test.ts`; `tests/desktop/collectionContext.test.ts` and `tests/desktop/bootstrap.test.ts` must stay green

**Interfaces:**
- Consumes: Tasks 3, 9, 10.
- Produces:
  - `planBoardSearchJob(repository: BoardSearchRepository, input: { boardId: string; fromDay: string }): Promise<BoardSearchPlan>` where `BoardSearchPlan = { kind: 'ready'; boardId; fromDay; toDay; queries: readonly BoardSearchQuery[] } | { kind: 'refused'; reason: 'NO_POSTS' | 'NOTHING_BEFORE' | 'NO_QUERIES' | 'BAD_DAY' }`.
  - `createBoardSearchJob(deps: { repository: () => BoardSearchRepository | null; runner: BoardSearchRunner }): CollectionJob`.
  - `OptionalCollectionContext` `ready` variant gains `boardSearchRepository: BoardSearchRepository` and `boardSearchCoverage: BoardSearchCoverageQuery` (the latter is created in Task 12; add the field there).
  - `AppContext` (bootstrap's return) gains `boardSearchRunner: BoardSearchRunner`.

- [ ] **Step 1: Write the failing tests**

`tests/desktop/boardSearchPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { planBoardSearchJob } from '../../src/desktop/boardSearchPlan.js'
import type { BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'

function repo(titles: string[], oldest: number | null): BoardSearchRepository {
  return { readBoardTitles: async () => titles, oldestPostedAtMs: async () => oldest } as unknown as BoardSearchRepository
}
// 2025-08-29 10:00 KST
const OLDEST = Date.UTC(2025, 7, 29, 1)

describe('planBoardSearchJob', () => {
  it('ends the window on the KST day of the oldest stored post and picks queries from the titles', async () => {
    const titles = Array.from({ length: 6 }, (_, i) => `글렌 ${i}`)
    await expect(planBoardSearchJob(repo(titles, OLDEST), { boardId: '137', fromDay: '20250101' })).resolves.toEqual({
      kind: 'ready', boardId: '137', fromDay: '20250101', toDay: '20250829', queries: [{ query: '글렌', expectedGain: 6 }],
    })
  })

  it('refuses a board with nothing stored, a start after the oldest post, a bad day, and titles with no usable word', async () => {
    await expect(planBoardSearchJob(repo([], null), { boardId: '137', fromDay: '20250101' })).resolves.toEqual({ kind: 'refused', reason: 'NO_POSTS' })
    await expect(planBoardSearchJob(repo(['글렌'], OLDEST), { boardId: '137', fromDay: '20250830' })).resolves.toEqual({ kind: 'refused', reason: 'NOTHING_BEFORE' })
    await expect(planBoardSearchJob(repo(['글렌'], OLDEST), { boardId: '137', fromDay: '2025-01-01' })).resolves.toEqual({ kind: 'refused', reason: 'BAD_DAY' })
    await expect(planBoardSearchJob(repo(['ㅎㅎ'], OLDEST), { boardId: '137', fromDay: '20250101' })).resolves.toEqual({ kind: 'refused', reason: 'NO_QUERIES' })
  })
})
```

`tests/desktop/boardSearchJob.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createBoardSearchJob } from '../../src/desktop/boardSearchJob.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchRunner } from '../../src/desktop/boardSearchRunner.js'

const row = (complete: boolean): BoardSearchQueryState => ({
  boardId: '137', query: 'q', fromDay: '20250101', toDay: '20250829', queueOrder: 1, expectedGain: 1, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, lastRunId: null,
})

function job(rows: BoardSearchQueryState[] | null) {
  const runner = { start: vi.fn(() => ({ kind: 'started' as const })), stop: vi.fn(), isRunning: () => false } satisfies BoardSearchRunner
  const repository = rows === null ? null : ({ listQueries: async () => rows } as unknown as BoardSearchRepository)
  return { job: createBoardSearchJob({ repository: () => repository, runner }), runner }
}

describe('boardSearch job', () => {
  it('has work while any query is unfinished', async () => {
    await expect(job([row(true), row(false)]).job.readProgress()).resolves.toEqual({ exists: true, complete: false, forced: false })
  })

  it('is done when every query is', async () => {
    await expect(job([row(true)]).job.readProgress()).resolves.toEqual({ exists: true, complete: true, forced: false })
  })

  it('does not exist without rows or storage', async () => {
    await expect(job([]).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
    await expect(job(null).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
  })

  it('starts a block with the budget it is given', () => {
    const { job: j, runner } = job([row(false)])
    expect(j.start(120)).toEqual({ kind: 'started' })
    expect(runner.start).toHaveBeenCalledWith({ maxPages: 120 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/desktop/boardSearchPlan.test.ts tests/desktop/boardSearchJob.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `src/desktop/boardSearchPlan.ts`

```ts
import { buildBoardSearchDictionary, type BoardSearchQuery } from '../shared/boardSearchDictionary.js'
import { isKstDayKey, kstDayKey } from '../shared/kst.js'
import type { BoardSearchRepository } from './collection-db/boardSearchRepository.js'

export type BoardSearchPlan =
  | { readonly kind: 'ready'; readonly boardId: string; readonly fromDay: string; readonly toDay: string; readonly queries: readonly BoardSearchQuery[] }
  | { readonly kind: 'refused'; readonly reason: 'NO_POSTS' | 'NOTHING_BEFORE' | 'NO_QUERIES' | 'BAD_DAY' }

/**
 * What a search job for this board would be. The window ends on the day of the
 * oldest stored post, read again rather than trimmed: that day is where the
 * list walk stopped, and the part of it the list did not reach is in the gap.
 */
export async function planBoardSearchJob(repository: BoardSearchRepository, input: { readonly boardId: string; readonly fromDay: string }): Promise<BoardSearchPlan> {
  if (!isKstDayKey(input.fromDay)) return { kind: 'refused', reason: 'BAD_DAY' }
  const oldest = await repository.oldestPostedAtMs(input.boardId)
  if (oldest === null) return { kind: 'refused', reason: 'NO_POSTS' }
  const toDay = kstDayKey(oldest)
  if (input.fromDay > toDay) return { kind: 'refused', reason: 'NOTHING_BEFORE' }
  const queries = buildBoardSearchDictionary(await repository.readBoardTitles(input.boardId))
  if (queries.length === 0) return { kind: 'refused', reason: 'NO_QUERIES' }
  return { kind: 'ready', boardId: input.boardId, fromDay: input.fromDay, toDay, queries }
}
```

The test's `['글렌 0'…'글렌 5']` gives `글렌` a gain of 6 ≥ `BOARD_SEARCH_MIN_GAIN`; the digits are one-letter words and are dropped.

- [ ] **Step 4: Implement** `src/desktop/boardSearchJob.ts`

```ts
import type { BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { BoardSearchRunner } from './boardSearchRunner.js'
import type { CollectionJob } from './collectionJob.js'

/**
 * The search backfill as one more job the loop takes turns with. It never runs
 * around the clock: the posts it recovers are months old, and a day's wait
 * costs nothing.
 */
export function createBoardSearchJob(deps: { readonly repository: () => BoardSearchRepository | null; readonly runner: BoardSearchRunner }): CollectionJob {
  return {
    name: 'boardSearch',
    async readProgress() {
      const repository = deps.repository()
      const rows = repository === null ? [] : await repository.listQueries()
      if (rows.length === 0) return { exists: false, complete: false, forced: false }
      return { exists: true, complete: rows.every((row) => row.complete), forced: false }
    },
    start(maxPages) {
      return deps.runner.start({ maxPages })
    },
  }
}
```

In `src/desktop/collectionJob.ts`: `readonly name: 'articles' | 'members' | 'memberResync' | 'boardSearch'`.

- [ ] **Step 5: Wire the context, bootstrap and main**

`collectionContext.ts`: import `createBoardSearchRepository` and its type; add to the `ready` variant `/** The search backfill past a board's list horizon. */ readonly boardSearchRepository: BoardSearchRepository`; in the ready return, after `memberResyncRepository`, add `boardSearchRepository: createBoardSearchRepository(connection.db, repository),`.

`bootstrap.ts`, after the member runners:

```ts
  // The search backfill takes the same lock and the same read gate as the
  // list walk: one browser session, one walk at a time.
  const boardSearchRunner = createBoardSearchRunner({
    repository: () => (collection.kind === 'ready' ? collection.boardSearchRepository : null),
    fetcher: createBoardSearchPageFetcher(transport, () => randomUUID()),
    isConnected: () => transport.isConnected(),
    clock: systemClock,
    random: systemRandom,
    pacing: () => readCollectionPacing(settings),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isSessionBusy: isAnySessionInFlight,
    lock: collectionLock,
    newId: () => randomUUID(),
    onError: (error) => diagnostics.error('board-search', error),
  })
```

Add to the loop's `jobs` array, last:

```ts
      createBoardSearchJob({
        repository: () => (collection.kind === 'ready' ? collection.boardSearchRepository : null),
        runner: boardSearchRunner,
      }),
```

Add `readonly boardSearchRunner: BoardSearchRunner` to the returned context interface (next to `memberResyncRunner`, ~line 143), return it (next to `collectionRunner` in the returned object, ~line 722), and call `boardSearchRunner.stop()` next to `collectionRunner.stop()` in the shutdown path (~line 786). Check what `diagnostics.error`'s first parameter accepts; if it is a union of channel names, add `'board-search'` there or reuse `'collection'`.

`main.ts` ~line 263: pass `boardSearchRunner: appContext.boardSearchRunner` into the renderer API deps (the field is added in Task 13; add both in Task 13 if typecheck complains here — then skip this line now).

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run tests/desktop && pnpm typecheck && pnpm lint`
Expected: PASS. Fix any fake context in `tests/desktop/collectionContext.test.ts` / `bootstrap.test.ts` that builds a `ready` context by hand by adding `boardSearchRepository`.

- [ ] **Step 7: Commit**

```bash
git add src/desktop tests/desktop
git commit -m "feat: run the board search backfill as a collection job"
```

---

### Task 12: Residual estimate from article-id gaps

**Files:**
- Create: `src/desktop/collection-db/boardSearchCoverageQuery.ts`
- Modify: `src/desktop/collectionContext.ts` (add `boardSearchCoverage`)
- Test: pure part in `tests/desktop/collection-db/boardSearchCoverage.test.ts`; SQL part appended to the integration test

**Interfaces:**
- Produces:
  - `export interface IdWindowCounts { readonly minId: number | null; readonly maxId: number | null; readonly stored: number }`
  - `export interface BoardSearchCoverage { readonly span: number; readonly missing: number; readonly baselineMissingRatio: number | null; readonly estimatedRemaining: number | null }`
  - `export function summarizeBoardSearchCoverage(gap: IdWindowCounts, baseline: IdWindowCounts): BoardSearchCoverage`
  - `export interface BoardSearchCoverageQuery { read(window: { fromDay: string; toDay: string }, fingerprint: string): Promise<BoardSearchCoverage> }`
  - `export function createBoardSearchCoverageQuery(db: CollectionDatabase): BoardSearchCoverageQuery`

- [ ] **Step 1: Write the failing pure test**

```ts
import { describe, expect, it } from 'vitest'
import { summarizeBoardSearchCoverage } from '../../../src/desktop/collection-db/boardSearchCoverageQuery.js'

describe('summarizeBoardSearchCoverage', () => {
  it('subtracts the gaps a complete stretch has anyway (deletions, uncollected boards)', () => {
    // 2026-09-25: the gap spans 111,973 ids with 70,428 stored; the complete
    // stretch after it misses 6.7%.
    const result = summarizeBoardSearchCoverage(
      { minId: 653_985, maxId: 765_957, stored: 70_428 },
      { minId: 1, maxId: 43_092, stored: 40_186 },
    )
    expect(result.span).toBe(111_973)
    expect(result.missing).toBe(41_545)
    expect(result.baselineMissingRatio).toBeCloseTo(2_906 / 43_092, 6)
    expect(result.estimatedRemaining).toBe(Math.round(41_545 - 111_973 * (2_906 / 43_092)))
  })

  it('says nothing it cannot know', () => {
    expect(summarizeBoardSearchCoverage({ minId: null, maxId: null, stored: 0 }, { minId: null, maxId: null, stored: 0 })).toEqual({
      span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null,
    })
  })

  it('never estimates a negative remainder', () => {
    const result = summarizeBoardSearchCoverage({ minId: 1, maxId: 100, stored: 99 }, { minId: 1, maxId: 100, stored: 90 })
    expect(result.estimatedRemaining).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/desktop/collection-db/boardSearchCoverage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { sql } from 'drizzle-orm'
import { kstDayKeyRange, MS_PER_DAY } from '../../shared/kst.js'
import type { CollectionDatabase } from './client.js'
import { posts } from './schema.js'

/** Days after the gap whose id holes stand for "missing anyway". */
const BASELINE_DAYS = 90

export interface IdWindowCounts {
  readonly minId: number | null
  readonly maxId: number | null
  readonly stored: number
}

export interface BoardSearchCoverage {
  /** Article ids between the first and last stored post of the gap window. */
  readonly span: number
  /** Of those, ids with no stored post, cafe-wide. */
  readonly missing: number
  /** The share of ids missing in the complete stretch after the gap; null before there is one. */
  readonly baselineMissingRatio: number | null
  /** Missing ids beyond the baseline — the posts still to recover, roughly. */
  readonly estimatedRemaining: number | null
}

function spanOf(counts: IdWindowCounts): number {
  return counts.minId === null || counts.maxId === null ? 0 : counts.maxId - counts.minId + 1
}

/**
 * Article ids rise one by one across the whole cafe, so the ids of a window
 * that hold no stored post are the posts not collected — plus deleted posts
 * and posts on boards this app never collects. The stretch right after the gap
 * is complete, and its hole rate is taken as that second part.
 */
export function summarizeBoardSearchCoverage(gap: IdWindowCounts, baseline: IdWindowCounts): BoardSearchCoverage {
  const span = spanOf(gap)
  const missing = span - gap.stored
  const baselineSpan = spanOf(baseline)
  if (span === 0 || baselineSpan === 0) return { span, missing: Math.max(0, missing), baselineMissingRatio: null, estimatedRemaining: null }
  const baselineMissingRatio = (baselineSpan - baseline.stored) / baselineSpan
  return { span, missing, baselineMissingRatio, estimatedRemaining: Math.max(0, Math.round(missing - span * baselineMissingRatio)) }
}

export interface BoardSearchCoverageQuery {
  read(window: { readonly fromDay: string; readonly toDay: string }, fingerprint: string): Promise<BoardSearchCoverage>
}

type CountsRow = { readonly min_id: string | null; readonly max_id: string | null; readonly stored: string }

export function createBoardSearchCoverageQuery(db: CollectionDatabase): BoardSearchCoverageQuery {
  let cached: { readonly key: string; readonly coverage: BoardSearchCoverage } | null = null

  async function counts(startMs: number, endMs: number): Promise<IdWindowCounts> {
    const result = await db.execute<CountsRow>(sql`
      select min(${posts.postId}::bigint)::text as min_id, max(${posts.postId}::bigint)::text as max_id, count(*)::text as stored
      from ${posts}
      where ${posts.postedAt} >= ${new Date(startMs)} and ${posts.postedAt} < ${new Date(endMs)}`)
    const row = result.rows[0]
    return {
      minId: row?.min_id == null ? null : Number(row.min_id),
      maxId: row?.max_id == null ? null : Number(row.max_id),
      stored: Number(row?.stored ?? 0),
    }
  }

  return {
    async read(window, fingerprint) {
      const key = `${window.fromDay}-${window.toDay}-${fingerprint}`
      if (cached !== null && cached.key === key) return cached.coverage
      // The gap stops before the window's last day: that day is where the list
      // walk ended, and it is partly stored already.
      const gapStart = kstDayKeyRange(window.fromDay).startMs
      const gapEnd = kstDayKeyRange(window.toDay).startMs
      const baselineStart = kstDayKeyRange(window.toDay).endMs
      const [gap, baseline] = await Promise.all([counts(gapStart, gapEnd), counts(baselineStart, baselineStart + BASELINE_DAYS * MS_PER_DAY)])
      const coverage = summarizeBoardSearchCoverage(gap, baseline)
      cached = { key, coverage }
      return coverage
    },
  }
}
```

In `collectionContext.ts`, add `readonly boardSearchCoverage: BoardSearchCoverageQuery` to the ready variant and `boardSearchCoverage: createBoardSearchCoverageQuery(connection.db),` to the ready return.

- [ ] **Step 4: Integration check** (append inside the integration block)

```ts
  it('counts id holes in the search window and in the stretch after it', async () => {
    const coverage = await createBoardSearchCoverageQuery(connection.db).read({ fromDay: '20250101', toDay: '20250201' }, 'a')
    // The search fixture's two posts (667850, 667901) are the only ones in January 2025 here.
    expect(coverage).toMatchObject({ span: 667_901 - 667_850 + 1, missing: 667_901 - 667_850 + 1 - 2 })
  })
```

This depends on the Task 9 test having inserted the fixture posts and on nothing else in the file storing posts dated January 2025 — check `cafe-article-list-page-1.json`'s dates (they are 2026) before relying on it.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run tests/desktop/collection-db && pnpm typecheck`, then the integration command if available.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/desktop/collection-db/boardSearchCoverageQuery.ts src/desktop/collectionContext.ts tests/desktop/collection-db
git commit -m "feat: estimate what the board search still has to recover"
```

---

### Task 13: Renderer API

**Files:**
- Create: `src/desktop/boardSearchView.ts`
- Modify: `src/desktop/ipc.ts` (channels, view type export, `RendererApi` methods), `src/desktop/rendererApi.ts` (deps + methods), `src/desktop/main.ts` (pass the runner)
- Test: `tests/desktop/boardSearchView.test.ts`; append to `tests/desktop/rendererApi.test.ts`

**Interfaces:**
- Consumes: Tasks 9–12.
- Produces:

```ts
// boardSearchView.ts
export interface BoardSearchJobView {
  readonly boardId: string
  readonly boardName: string | null
  readonly fromDay: string
  readonly toDay: string
  readonly queries: readonly BoardSearchQueryState[]
  readonly completedCount: number
  readonly insertedTotal: number
  /** The first unfinished query in order; null when all are done. */
  readonly current: string | null
  readonly coverage: BoardSearchCoverage
}
export interface BoardSearchView {
  readonly boards: readonly CollectableBoard[]
  readonly running: boolean
  readonly job: BoardSearchJobView | null
}
export function readBoardSearchView(inputs: { repository: BoardSearchRepository; coverage: BoardSearchCoverageQuery; running: boolean }): Promise<BoardSearchView>

// ipc.ts
export type BoardSearchStatusView =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly code: CollectionUnavailableCode }
  | { readonly kind: 'ready'; readonly view: BoardSearchView }
export type BoardSearchPlanView = { readonly kind: 'ready'; readonly toDay: string; readonly queryCount: number } | { readonly kind: 'refused'; readonly reason: BoardSearchPlanRefusal }
export type BoardSearchPlanRefusal = 'NO_STORAGE' | 'NO_POSTS' | 'NOTHING_BEFORE' | 'NO_QUERIES' | 'BAD_DAY' | 'STOP_RUNNING_FIRST'
// RendererApi gains:
getBoardSearchStatus(): Promise<BoardSearchStatusView>
previewBoardSearchJob(request: { boardId: string; fromDay: string }): Promise<BoardSearchPlanView>
createBoardSearchJob(request: { boardId: string; fromDay: string }): Promise<BoardSearchPlanView>
startBoardSearch(): Promise<StartCollectionResult>
stopBoardSearch(): Promise<void>
```

Channels: `getBoardSearchStatus: 'wm:getBoardSearchStatus'`, `previewBoardSearchJob: 'wm:previewBoardSearchJob'`, `createBoardSearchJob: 'wm:createBoardSearchJob'`, `startBoardSearch: 'wm:startBoardSearch'`, `stopBoardSearch: 'wm:stopBoardSearch'`.

- [ ] **Step 1: Write the failing view test** `tests/desktop/boardSearchView.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { readBoardSearchView } from '../../src/desktop/boardSearchView.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchCoverageQuery } from '../../src/desktop/collection-db/boardSearchCoverageQuery.js'

const row = (query: string, order: number, complete: boolean, inserted: number): BoardSearchQueryState => ({
  boardId: '137', query, fromDay: '20250101', toDay: '20250829', queueOrder: order, expectedGain: 1, lastCommittedPage: complete ? 3 : null, insertedCount: inserted, totalCount: null, complete, lastRunId: null,
})
const coverage = { span: 10, missing: 4, baselineMissingRatio: 0.1, estimatedRemaining: 3 }

function inputs(rows: BoardSearchQueryState[]) {
  const seen: string[] = []
  const repository = {
    listQueries: async () => rows,
    listCollectableBoards: async () => [{ boardId: '137', name: '국내구입기 & 정보' }],
  } as unknown as BoardSearchRepository
  const query: BoardSearchCoverageQuery = { read: async (_w, fingerprint) => { seen.push(fingerprint); return coverage } }
  return { repository, coverage: query, running: false, seen }
}

describe('readBoardSearchView', () => {
  it('sums the job up and names the query walking next', async () => {
    const i = inputs([row('글렌', 1, true, 40), row('구매', 2, false, 5), row('이마트', 3, false, 0)])
    await expect(readBoardSearchView(i)).resolves.toMatchObject({
      boards: [{ boardId: '137', name: '국내구입기 & 정보' }],
      job: { boardId: '137', boardName: '국내구입기 & 정보', fromDay: '20250101', toDay: '20250829', completedCount: 1, insertedTotal: 45, current: '구매', coverage },
    })
    // The coverage cache is keyed on what was inserted, so it re-reads only when posts arrived.
    expect(i.seen).toEqual(['45'])
  })

  it('has no job without rows', async () => {
    const i = inputs([])
    await expect(readBoardSearchView(i)).resolves.toMatchObject({ job: null })
    expect(i.seen).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/desktop/boardSearchView.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `src/desktop/boardSearchView.ts`

```ts
import type { BoardSearchCoverage, BoardSearchCoverageQuery } from './collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchQueryState, BoardSearchRepository, CollectableBoard } from './collection-db/boardSearchRepository.js'

// (BoardSearchJobView and BoardSearchView as listed under "Produces")

export async function readBoardSearchView(inputs: {
  readonly repository: BoardSearchRepository
  readonly coverage: BoardSearchCoverageQuery
  readonly running: boolean
}): Promise<BoardSearchView> {
  const [boards, queries] = await Promise.all([inputs.repository.listCollectableBoards(), inputs.repository.listQueries()])
  const first = queries[0]
  if (first === undefined) return { boards, running: inputs.running, job: null }
  const insertedTotal = queries.reduce((sum, query) => sum + query.insertedCount, 0)
  return {
    boards,
    running: inputs.running,
    job: {
      boardId: first.boardId,
      boardName: boards.find((board) => board.boardId === first.boardId)?.name ?? null,
      fromDay: first.fromDay,
      toDay: first.toDay,
      queries,
      completedCount: queries.filter((query) => query.complete).length,
      insertedTotal,
      current: queries.find((query) => !query.complete)?.query ?? null,
      coverage: await inputs.coverage.read({ fromDay: first.fromDay, toDay: first.toDay }, String(insertedTotal)),
    },
  }
}
```

- [ ] **Step 4: IPC and renderer API**

`ipc.ts`: add the five channels to `IPC_CHANNELS` (after `setMemberResyncInterval`), `export type { BoardSearchView } from './boardSearchView.js'`, the three types listed above, and the five methods on `RendererApi` with one-line doc comments in the file's style:

```ts
  /** Where the search backfill stands; `disabled` without a collection database. */
  getBoardSearchStatus(): Promise<BoardSearchStatusView>
  /** What a search job for this board and start day would be, without making it. */
  previewBoardSearchJob(request: { boardId: string; fromDay: string }): Promise<BoardSearchPlanView>
  /** Makes the search job anew, replacing any other; refused while a search block runs. */
  createBoardSearchJob(request: { boardId: string; fromDay: string }): Promise<BoardSearchPlanView>
  /** Starts a block of the search backfill now. */
  startBoardSearch(): Promise<StartCollectionResult>
  /** Asks a search block in flight to end at its next page boundary. */
  stopBoardSearch(): Promise<void>
```

`rendererApi.ts`: add `readonly boardSearchRunner: BoardSearchRunner` to `RendererApiDeps`, and the methods (pattern-match `getMemberCollectionStatus` / `startMemberResync`):

```ts
    async getBoardSearchStatus(): Promise<BoardSearchStatusView> {
      const collection = deps.collection()
      if (collection.kind === 'disabled') return { kind: 'disabled' }
      if (collection.kind === 'unavailable') return { kind: 'unavailable', code: collection.code }
      return {
        kind: 'ready',
        view: await readBoardSearchView({ repository: collection.boardSearchRepository, coverage: collection.boardSearchCoverage, running: deps.boardSearchRunner.isRunning() }),
      }
    },

    async previewBoardSearchJob(request): Promise<BoardSearchPlanView> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const plan = await planBoardSearchJob(collection.boardSearchRepository, request)
      return plan.kind === 'ready' ? { kind: 'ready', toDay: plan.toDay, queryCount: plan.queries.length } : plan
    },

    async createBoardSearchJob(request): Promise<BoardSearchPlanView> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      if (deps.boardSearchRunner.isRunning()) return { kind: 'refused', reason: 'STOP_RUNNING_FIRST' }
      const plan = await planBoardSearchJob(collection.boardSearchRepository, request)
      if (plan.kind !== 'ready') return plan
      await collection.boardSearchRepository.replaceJob({ ...plan, at: new Date() })
      return { kind: 'ready', toDay: plan.toDay, queryCount: plan.queries.length }
    },

    async startBoardSearch(): Promise<StartCollectionResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const queries = await collection.boardSearchRepository.listQueries()
      if (queries.length === 0) return { kind: 'refused', reason: 'NO_JOB' }
      if (queries.every((query) => query.complete)) return { kind: 'refused', reason: 'JOB_FINISHED' }
      const schedule = readCollectionSchedule(settings)
      const started = deps.boardSearchRunner.start({ maxPages: pagesPerWorkBlock(schedule.workBlockMinutes, readCollectionPacing(settings)) })
      return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
    },

    stopBoardSearch(): Promise<void> {
      deps.boardSearchRunner.stop()
      return Promise.resolve()
    },
```

`createBoardSearchJob` uses `new Date()` for `at`; if `rendererApi.ts` has a clock dependency (search the file for `now()`), use it instead.

`main.ts`: pass `boardSearchRunner: appContext.boardSearchRunner` into the renderer API deps.

Append to `tests/desktop/rendererApi.test.ts`, using its existing deps builder: (a) `getBoardSearchStatus` answers `disabled` when the collection is disabled; (b) `createBoardSearchJob` answers `STOP_RUNNING_FIRST` and does not call `replaceJob` while `boardSearchRunner.isRunning()` is true. Add `boardSearchRunner: { start: vi.fn(), stop: vi.fn(), isRunning: () => false }` to the shared deps builder.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run tests/desktop && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/desktop tests/desktop
git commit -m "feat: expose the board search backfill to the renderer"
```

---

### Task 14: Words and the card

**Files:**
- Modify: `src/shared/text.ts` (new `boardSearch` section after `memberResync`)
- Create: `src/renderer/views/collection/boardSearchLines.ts`, `src/renderer/views/collection/BoardSearchCard.tsx`
- Modify: `src/renderer/store.ts`, `src/renderer/views/CollectionStatus.tsx`
- Test: `tests/renderer/boardSearchLines.test.ts`

**Interfaces:**
- Consumes: Task 13 view and API, `formatKstDateTime` etc. from `src/renderer/format.ts`.
- Produces: `boardSearchSummaryLine(job: BoardSearchJobView): string`, `boardSearchCoverageLine(coverage: BoardSearchCoverage): string | null`, `boardSearchQueryState(query: BoardSearchQueryState, current: string | null, running: boolean): 'done' | 'walking' | 'waiting'`, `dayKeyLabel(key: string): string`, `dayKeyOfDateInput(value: string): string`.

- [ ] **Step 1: Write the failing wording test** `tests/renderer/boardSearchLines.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  boardSearchCoverageLine,
  boardSearchQueryState,
  boardSearchSummaryLine,
  dayKeyLabel,
  dayKeyOfDateInput,
} from '../../src/renderer/views/collection/boardSearchLines.js'
import type { BoardSearchQueryState } from '../../src/desktop/collection-db/boardSearchRepository.js'

const query = (q: string, complete: boolean): BoardSearchQueryState => ({
  boardId: '137', query: q, fromDay: '20250101', toDay: '20250829', queueOrder: 1, expectedGain: 1, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, lastRunId: null,
})

describe('board search wording', () => {
  it('spells day keys the way the screens spell dates', () => {
    expect(dayKeyLabel('20250101')).toBe('2025-01-01')
    expect(dayKeyOfDateInput('2025-01-01')).toBe('20250101')
  })

  it('sums a job in one line', () => {
    const line = boardSearchSummaryLine({
      boardId: '137', boardName: '국내구입기 & 정보', fromDay: '20250101', toDay: '20250829',
      queries: [query('글렌', true), query('구매', false)], completedCount: 1, insertedTotal: 1234, current: '구매',
      coverage: { span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null },
    })
    expect(line).toContain('1 / 2')
    expect(line).toContain('1,234')
    expect(line).toContain('구매')
  })

  it('shows the residual only when it can be estimated', () => {
    expect(boardSearchCoverageLine({ span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null })).toBeNull()
    expect(boardSearchCoverageLine({ span: 111_973, missing: 41_545, baselineMissingRatio: 0.067, estimatedRemaining: 34_043 })).toContain('34,043')
  })

  it('tells a finished, walking and waiting query apart', () => {
    expect(boardSearchQueryState(query('글렌', true), '구매', true)).toBe('done')
    expect(boardSearchQueryState(query('구매', false), '구매', true)).toBe('walking')
    expect(boardSearchQueryState(query('구매', false), '구매', false)).toBe('waiting')
    expect(boardSearchQueryState(query('이마트', false), '구매', true)).toBe('waiting')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/renderer/boardSearchLines.test.ts`
Expected: FAIL.

- [ ] **Step 3: Words** — add to `TEXT` in `src/shared/text.ts`, after `memberResync`:

```ts
  boardSearch: {
    heading: '검색어 보충 수집',
    why: '게시판 목록은 1000쪽까지만 보입니다. 그 너머의 글을 제목 검색으로 찾아 채웁니다. 검색어는 이미 모은 제목에서 많이 쓰인 단어로 고릅니다.',
    board: '게시판',
    fromDay: '시작일',
    preview: (count: number, from: string, to: string) => `검색어 ${count.toLocaleString('ko-KR')}개 · ${from} ~ ${to}`,
    previewButton: '미리 보기',
    create: '보충 작업 만들기',
    replaceConfirm: '진행 중인 보충 작업을 지우고 새로 만듭니다. 계속할까요?',
    start: '지금 보충',
    resume: '이어서 보충',
    stop: '멈추기',
    none: '보충 작업이 없습니다',
    running: '보충 중',
    idle: '대기',
    finished: '보충 완료',
    summary: (done: number, total: number, inserted: number, current: string | null) =>
      `검색어 ${done} / ${total} · 새 글 ${inserted.toLocaleString('ko-KR')}건${current === null ? '' : ` · 다음 '${current}'`}`,
    coverage: (remaining: number, ratio: number) =>
      `아직 못 거둔 글 약 ${remaining.toLocaleString('ko-KR')}건 (삭제·비수집 게시판 ${(ratio * 100).toFixed(1)}% 제외)`,
    window: (board: string, from: string, to: string) => `${board} · ${from} ~ ${to}`,
    queries: '검색어별 진행',
    columns: { order: '순서', query: '검색어', state: '상태', page: '쪽', inserted: '새 글', total: '결과 수' },
    states: { done: '완료', walking: '진행', waiting: '대기' },
    refused: {
      NO_STORAGE: '수집 DB에 연결되어 있지 않습니다.',
      NO_POSTS: '이 게시판에 저장된 글이 없어 검색어를 고를 수 없습니다.',
      NOTHING_BEFORE: '시작일이 저장된 가장 오래된 글보다 뒤입니다.',
      NO_QUERIES: '제목에서 쓸 만한 검색어를 찾지 못했습니다.',
      BAD_DAY: '날짜를 읽지 못했습니다.',
      STOP_RUNNING_FIRST: '보충이 도는 중입니다. 먼저 멈추세요.',
    },
    startRefused: {
      ...COLLECTION_START_REFUSED,
      NO_JOB: '보충 작업을 먼저 만드세요.',
      JOB_FINISHED: '이 보충 작업은 끝났습니다.',
    },
  },
```

Before writing `startRefused`, look up the object `memberResync.refused` spreads (`MEMBER_START_REFUSED`) and the article equivalent in `text.ts`; spread whichever maps every `CollectionStartRefusal` to Korean (name it as it is actually named in the file). The `toLocaleString('ko-KR')` calls format numbers, not times, so the KST rule does not apply; if `text.ts` already has a number formatter, use it instead.

- [ ] **Step 4: Wording helpers** `src/renderer/views/collection/boardSearchLines.ts`

```ts
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchQueryState } from '../../../desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchCoverage } from '../../../desktop/collection-db/boardSearchCoverageQuery.js'
import type { BoardSearchJobView } from '../../../desktop/boardSearchView.js'

/** `20250101` → `2025-01-01`, which is how the date inputs and the other cards spell a day. */
export function dayKeyLabel(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
}

/** A date input's `2025-01-01` → the search's `20250101`. The input already speaks the KST calendar. */
export function dayKeyOfDateInput(value: string): string {
  return value.replaceAll('-', '')
}

export function boardSearchSummaryLine(job: BoardSearchJobView): string {
  return TEXT.boardSearch.summary(job.completedCount, job.queries.length, job.insertedTotal, job.current)
}

export function boardSearchCoverageLine(coverage: BoardSearchCoverage): string | null {
  if (coverage.estimatedRemaining === null || coverage.baselineMissingRatio === null) return null
  return TEXT.boardSearch.coverage(coverage.estimatedRemaining, coverage.baselineMissingRatio)
}

export function boardSearchQueryState(query: BoardSearchQueryState, current: string | null, running: boolean): 'done' | 'walking' | 'waiting' {
  if (query.complete) return 'done'
  return running && query.query === current ? 'walking' : 'waiting'
}
```

Run: `pnpm vitest run tests/renderer/boardSearchLines.test.ts` — Expected: PASS.

- [ ] **Step 5: Store** — in `src/renderer/store.ts`:

1. Import `BoardSearchStatusView` from `../desktop/ipc.js`.
2. `AppState` gains `/** Null until the first answer; the view itself carries "no storage". */ boardSearch: BoardSearchStatusView | null`, initial `boardSearch: null`.
3. In both `Promise.all` lists in `refresh`, add `api.getBoardSearchStatus()` right after `api.getMemberCollectionStatus()`, destructure it as `boardSearch`, and add `boardSearch` to both `set({...})` calls.

- [ ] **Step 6: The card** `src/renderer/views/collection/BoardSearchCard.tsx`

Follow `MemberResyncCard.tsx` for structure, class names, and the `busy`/`act` contract.

```tsx
import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchPlanView, BoardSearchStatusView, StartCollectionResult } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { boardSearchCoverageLine, boardSearchQueryState, boardSearchSummaryLine, dayKeyLabel, dayKeyOfDateInput } from './boardSearchLines.js'

type ReadyView = Extract<BoardSearchStatusView, { readonly kind: 'ready' }>['view']

interface BoardSearchCardProps {
  readonly view: ReadyView
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
}

const DEFAULT_FROM = '2025-01-01'

function planLine(plan: BoardSearchPlanView, fromDay: string): string {
  return plan.kind === 'ready' ? TEXT.boardSearch.preview(plan.queryCount, dayKeyLabel(fromDay), dayKeyLabel(plan.toDay)) : TEXT.boardSearch.refused[plan.reason]
}

function startRefusal(result: StartCollectionResult): string | null {
  return result.kind === 'refused' ? TEXT.boardSearch.startRefused[result.reason] : null
}

/**
 * The search backfill: make a job for a board, see where it stands, start or
 * stop a block. It takes turns with the other walks on the schedule; the
 * buttons are for not waiting.
 */
export function BoardSearchCard({ view, busy, act }: BoardSearchCardProps): React.JSX.Element {
  const [boardId, setBoardId] = useState(view.job?.boardId ?? view.boards[0]?.boardId ?? '')
  const [fromDate, setFromDate] = useState(view.job === null ? DEFAULT_FROM : dayKeyLabel(view.job.fromDay))
  const [message, setMessage] = useState<string | null>(null)
  const { job, running } = view
  const fromDay = dayKeyOfDateInput(fromDate)
  const coverageLine = job === null ? null : boardSearchCoverageLine(job.coverage)
  const finished = job !== null && job.current === null

  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${running ? 'bar-accent' : 'bar-idle'}`} />
        <div className="flex flex-1 flex-col gap-3 px-5 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.boardSearch.heading}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {job === null ? (
                  <span>{TEXT.boardSearch.none}</span>
                ) : running ? (
                  <span className="tone-accent">{TEXT.boardSearch.running}</span>
                ) : (
                  <span>{finished ? TEXT.boardSearch.finished : TEXT.boardSearch.idle}</span>
                )}
              </div>
              {job !== null && (
                <>
                  <div className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                    {TEXT.boardSearch.window(job.boardName ?? job.boardId, dayKeyLabel(job.fromDay), dayKeyLabel(job.toDay))}
                  </div>
                  <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>{boardSearchSummaryLine(job)}</div>
                  {coverageLine !== null && <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>{coverageLine}</div>}
                </>
              )}
              {message !== null && <div className="mt-1 text-sm tone-warn">{message}</div>}
            </div>
            {job !== null && !finished && (
              running ? (
                <button type="button" className="btn shrink-0" disabled={busy} onClick={() => void act(() => api.stopBoardSearch())}>
                  {TEXT.boardSearch.stop}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn shrink-0"
                  disabled={busy}
                  onClick={() => {
                    setMessage(null)
                    void act(async () => setMessage(startRefusal(await api.startBoardSearch())))
                  }}
                >
                  {job.completedCount > 0 || job.insertedTotal > 0 ? TEXT.boardSearch.resume : TEXT.boardSearch.start}
                </button>
              )
            )}
          </div>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (job !== null && !window.confirm(TEXT.boardSearch.replaceConfirm)) return
              setMessage(null)
              void act(async () => setMessage(planLine(await api.createBoardSearchJob({ boardId, fromDay }), fromDay)))
            }}
          >
            <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.boardSearch.board}
              <select className="input" value={boardId} disabled={busy || running} onChange={(event) => setBoardId(event.target.value)}>
                {view.boards.map((board) => (
                  <option key={board.boardId} value={board.boardId}>{board.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.boardSearch.fromDay}
              <input className="input" type="date" value={fromDate} disabled={busy || running} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || boardId === ''}
              onClick={() => void act(async () => setMessage(planLine(await api.previewBoardSearchJob({ boardId, fromDay }), fromDay)))}
            >
              {TEXT.boardSearch.previewButton}
            </button>
            <button type="submit" className="btn" disabled={busy || running || boardId === ''}>
              {TEXT.boardSearch.create}
            </button>
          </form>

          {job !== null && (
            <details>
              <summary className="cursor-pointer text-sm">{TEXT.boardSearch.queries}</summary>
              <table className="mt-2 w-full text-sm tabular-nums">
                <thead>
                  <tr style={{ color: 'var(--ink-muted)' }}>
                    <th className="text-left">{TEXT.boardSearch.columns.order}</th>
                    <th className="text-left">{TEXT.boardSearch.columns.query}</th>
                    <th className="text-left">{TEXT.boardSearch.columns.state}</th>
                    <th className="text-right">{TEXT.boardSearch.columns.page}</th>
                    <th className="text-right">{TEXT.boardSearch.columns.inserted}</th>
                    <th className="text-right">{TEXT.boardSearch.columns.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {job.queries.map((query) => (
                    <tr key={query.query}>
                      <td>{query.queueOrder}</td>
                      <td>{query.query}</td>
                      <td>{TEXT.boardSearch.states[boardSearchQueryState(query, job.current, running)]}</td>
                      <td className="text-right">{query.lastCommittedPage ?? '—'}</td>
                      <td className="text-right">{query.insertedCount.toLocaleString('ko-KR')}</td>
                      <td className="text-right">{query.totalCount === null ? '—' : query.totalCount.toLocaleString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{TEXT.boardSearch.why}</p>
        </div>
      </div>
    </section>
  )
}
```

Check `input`, `btn-ghost` and `tone-warn` exist in the renderer stylesheet (`grep -rn "btn-ghost\|\.input" src/renderer`); use the classes the other forms on `CollectionStatus.tsx` use if they differ.

- [ ] **Step 7: Mount it** — in `src/renderer/views/CollectionStatus.tsx`

Import `BoardSearchCard`, read `const boardSearch = useApp((s) => s.boardSearch)` and `busy`/`act` the way the file already does, and after the line `{job !== null && job.boards.length > 0 && <BoardQueue boards={job.boards} />}` (~line 256) add:

```tsx
      {boardSearch?.kind === 'ready' && <BoardSearchCard view={boardSearch.view} busy={busy} act={act} />}
```

- [ ] **Step 8: Run all checks**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:all`
Expected: PASS; build succeeds.

- [ ] **Step 9: Look at it without a second app instance**

Follow memory `renderer-preview-without-electron`: serve `dist/renderer` and inject a fake `window.wm` whose `getBoardSearchStatus` returns a ready view with a two-query job (one done, one waiting) and a coverage of `{ span: 111973, missing: 41545, baselineMissingRatio: 0.067, estimatedRemaining: 34043 }`. Open the collection screen in the built-in browser, check the card in light and dark, at 375 px and desktop width, and that the table opens. Fix what looks wrong before committing.

- [ ] **Step 10: Commit**

```bash
git add src/shared/text.ts src/renderer tests/renderer
git commit -m "feat: show and drive the board search backfill on the collection screen"
```

---

### Task 15: Whole-branch verification and hand-off

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:all`
Then, if the test database is available, the integration command.
Expected: all PASS. Record the counts in the task report.

- [ ] **Step 2: Scan for leftovers**

Run: `git diff main --stat` and `git diff main | grep -nE "TODO|FIXME|\.only\(|\.skip\(|console\.log"`
Expected: no matches in added lines.

- [ ] **Step 3: Spec coverage walk**

Go through spec §3–§8 and name, for each requirement, the commit that implements it. Anything without one is a gap: add a task, do not paper over it.

- [ ] **Step 4: Report to the operator — do not deploy**

Deployment is the operator's call. Report the §8 steps they will run: package app and extension (protocol 12, new host permission), quit the app, migrate by hand, launch, reload the extension and approve the permission, create the 137 job from 2025-01-01, and watch the first query's run: a `BOARD_SEARCH_HTTP_ERROR` there means the worker's request is not accepted like the page's (spec §9) and needs a look before anything else.
