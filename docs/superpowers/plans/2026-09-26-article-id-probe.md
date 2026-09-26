# Article Id Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read, one by one, the 9,660 article ids still missing between the stored posts of the search backfill's window, store the live posts of collected boards, and record why every other id has no post — so the backfill ends exactly instead of by estimate.

**Architecture:** A new collection job `articleProbe` beside `boardSearch`, with its own table `article_probe` (one row per id, filled once from the id holes of the finished search job's window with a window-function query). The extension answers one id per request (`COLLECT_ARTICLE` → `ARTICLE_COLLECTED`), a pure verdict turns each answer into an outcome, and a runner walks the waiting ids in ascending order under the shared lock, read gate, pacing and page budget; each block is one `runs` row of the new feed kind `article_probe`. A card on the collection screen shows and drives it.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Electron main + React renderer, Chrome MV3 extension, PostgreSQL via drizzle-orm / drizzle-kit, vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-article-id-probe-design.md` — read it before any task. Section numbers below (§n) refer to it. The feature this one mirrors file by file is `docs/superpowers/plans/2026-09-25-board-search-backfill.md`; when a step says "as the board search file does", open that file and match it.

## Global Constraints

- Times are shown and computed in KST only. The only offset is `KST_OFFSET_MS` in `src/shared/kst.ts`; day boundaries come from `kstDayKeyRange` / `kstDayRange`; never `toLocaleString` with a zone, never `getHours()` (project `CLAUDE.md`).
- Korean only (no i18n), but every user-facing string lives in `src/shared/text.ts`; strings that take values are functions (project `CLAUDE.md`).
- Code and comments in English; comment density and voice match the surrounding file (the board search files are the model).
- No TODO comments, no placeholders, no `test.skip`/`.only`.
- New behaviour goes in new files; existing files change only where the plan says.
- Commit messages: `<type>: <description>`, no AI attribution, no `Co-Authored-By` (user `CLAUDE.md` overrides the harness default).
- Never `git checkout <file>` / `git restore` / `git reset` / `git stash` to undo; reverse edits by hand. Never switch branches.
- `PROTOCOL_VERSION` 12 → 13: the app and the extension must be repackaged together and the extension reloaded (memory `repackage-after-protocol-bump`).
- The production app is running on this machine. Never start Electron; verify UI with the renderer preview (memory `renderer-preview-without-electron`).
- Never write to the `whisky_manager_collection` database; read-only `select`s are allowed. Migrations are generated only with `pnpm db:collection:generate` and applied by the operator by hand with the app quit (memory `collection-migration-before-app`).
- The endpoint (spec §5, captured 2026-09-26): `GET https://article.cafe.naver.com/gw/v4/cafes/14538121/articles/{id}?fromList=true&menuId=0&tc=cafe_article_list&useCafeId=true`, header `x-cafe-product: pc`. 200 → `result.article`; 404 → `result.errorCode "4003"` (deleted); 401 → `result.errorCode "0004"` (unreadable — a per-board restriction of this read, not a login failure: post 937311 on board 207 is stored by the list walk yet answers 0004 here, 2026-09-26). Anything else ends the block and judges no id (§3 "모르는 답").
- Live facts confirmed 2026-09-26: `result.cafeId` and `article.menu.id` are numbers (5 posts); a post without a prefix (928665, board 137) has neither a `head` nor a `headId` key.
- Notices are never stored: the list walks never store one, so a notice stored here would be the only one. A live post with `isNotice: true` is answered with the outcome `notice` (its board recorded) and no `posts` write.
- The id window is the search job's `board_search_state` `from_day`/`to_day`; the stored posts that bound it are those posted in `[from_day 00:00 KST, to_day 00:00 KST)` — the range `boardSearchCoverageQuery` calls the gap. On 2026-09-26 that is 20250101 / 20250829 and yields 9,660 ids (checked read-only; 153 ms). Candidate ids are generated with `lead()` over `post_id::bigint`, never with a per-id `NOT EXISTS` over `generate_series` (that took over five minutes).
- "Collected boards" are the `boards` rows with `collect_enabled = true` (38 of 38 today) — the same set `listCollectableBoards` returns.
- Runs of `article_probe` stay off the article collection's recent log exactly as `board_search` runs do; the card shows the feed's own last run instead (Task 1 settles the spec line).
- No version bump in this plan: the release is done separately.

## Verification commands

- Unit tests: `pnpm test` (all) or `pnpm vitest run <path>` (one file).
- Types: `pnpm typecheck` (includes `tests/`). Lint: `pnpm lint`.
- DB integration (opt-in): `COLLECTION_TEST_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection_test pnpm test:collection:integration`. The database must exist and be empty; if it does not exist, ask the operator before creating it.

## File map

| File | Status | Responsibility |
|---|---|---|
| `docs/superpowers/specs/2026-09-25-board-search-backfill-design.md` | modify | §1 and §4 corrected to morpheme matching |
| `docs/superpowers/specs/2026-09-26-article-id-probe-design.md` | modify | §3 run rows: off the recent log, on the card (the `notice` outcome, the 0004 note and the card's window wording were settled in the spec with this plan) |
| `src/shared/cafeArticleList.ts` | modify | Export `optionalNullableString`, `epochMilliseconds`; `replyCount: number \| null` |
| `src/shared/cafeArticleEndpoint.ts` | create | Article read URL, id rule, headers, referer |
| `src/shared/cafeArticleRead.ts` | create | Article response → `CollectedPostMetadata` and its notice flag; the cafe's refusal code |
| `tests/fixtures/cafe-article-read-*.json` | create | 200 / 404 / 401 bodies reduced from the capture |
| `src/shared/protocol.ts` | modify | `COLLECT_ARTICLE`, `ARTICLE_COLLECTED`, `TIMEOUTS.articleMs`, version 13 |
| `src/extension/articleReader.ts` | create | Reads exactly one article |
| `src/extension/dispatch.ts`, `src/extension/background.ts` | modify | Route the new request |
| `src/extension/refererRule.ts` | modify | Rule 5: the article read by id, matched by a `regexFilter` the comment read does not match |
| `src/desktop/articleFetcher.ts` | create | Desktop side of the request |
| `src/desktop/naverReadGate.ts` | modify | Queue article reads with the page reads |
| `src/desktop/collection-db/articleProbeSchema.ts` | create | `article_probe` table and its outcome enum (`stored`, `deleted`, `unreadable`, `other_board`, `notice`) |
| `src/desktop/collection-db/schema.ts` | modify | Enum value `article_probe` |
| `drizzle.collection.config.ts` | modify | Schema list gets the probe schema |
| `drizzle-collection/0009_*.sql` | generate | Migration |
| `src/desktop/articleProbeVerdict.ts` | create | One answer → one outcome, or a block-ending error |
| `src/desktop/collection-db/articleProbeRepository.ts` | create | Job rows, runs, verdict writes, last run |
| `src/desktop/collection-db/statusQuery.ts` | modify | Keep probe runs off the recent log |
| `src/desktop/articleProbeRunner.ts` | create | Walks a block of waiting ids |
| `src/desktop/articleProbePlan.ts` | create | The window a job takes from the search job |
| `src/desktop/articleProbeJob.ts` | create | `CollectionJob` for the loop |
| `src/desktop/articleProbeView.ts` | create | What the card shows |
| `src/desktop/collectionJob.ts` | modify | Name union gets `'articleProbe'` |
| `src/desktop/collectionContext.ts`, `src/desktop/bootstrap.ts`, `src/desktop/main.ts` | modify | Build, loop, stop, renderer deps |
| `src/desktop/ipc.ts`, `src/desktop/rendererApi.ts` | modify | Channels and methods |
| `src/shared/text.ts` | modify | `articleProbe` section |
| `src/renderer/views/collection/articleProbeLines.ts` | create | Pure wording helpers for the card |
| `src/renderer/views/collection/ArticleProbeCard.tsx` | create | The card |
| `src/renderer/store.ts`, `src/renderer/views/CollectionStatus.tsx` | modify | Poll and mount |

Task order keeps `pnpm test && pnpm typecheck && pnpm lint` green after every task: the contract and transport come first (unused until the runner), the schema before the repository, the verdict and repository before the runner, the wiring after the runner, the screen last. `pnpm typecheck` covers `tests/`, so a task that adds a required field to a shared type also updates the test fakes that build it (called out where it happens).

---

### Task 1: Correct the search spec's matching model (sonnet)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-board-search-backfill-design.md` (§1 table row `글렌` ~line 37, the sentence after the table ~line 43, §4 item 4 ~line 119)
- Modify: `docs/superpowers/specs/2026-09-26-article-id-probe-design.md` (§3 "실행 행", ~line 84)

**Interfaces:**
- Consumes: nothing. Produces: nothing code relies on.

- [ ] **Step 1: Correct the §1 row**

Replace the line

```
| `글렌` | `글렌알라키`까지 잡는다 |
```

with

```
| `글렌` | ~~`글렌알라키`까지 잡는다~~ — 틀렸다(2026-09-26 정정). 검색은 형태소 낱말 일치다: `홈플`은 `월드컵 홈플러스`를 못 찾고 `홈플러스`로는 찾는다. 설계 `2026-09-26-article-id-probe-design.md` §1 |
```

- [ ] **Step 2: Correct the conclusion under the table**

Replace the paragraph that starts `즉 **어절이 검색어로 시작하면 걸린다.**` with

```
즉 **검색어가 제목을 형태소로 쪼갠 낱말 하나와 같으면 걸린다**(2026-09-26 정정; 처음에는 "어절이 검색어로 시작하면 걸린다"로 적었으나 틀렸다). 검색어 하나로는 게시판 전체를 덮지 못하지만, 이미 가진 제목에서 많이 쓰인 어절을 골라 합집합을 쌓으면 대부분을 덮는다. 사전이 덮지 못한 나머지는 id로 하나씩 읽어 거둔다(설계 `2026-09-26-article-id-probe-design.md`).
```

- [ ] **Step 3: Correct §4 item 4**

Replace

```
4. **매칭 모델**: 제목의 어느 어절이 후보로 **시작**하면 그 글은 걸린다(§1 실측).
```

with

```
4. **매칭 모델**: 제목의 어느 어절이 후보로 **시작**하면 그 글은 걸린다고 셈한다. **이 모델은 틀렸다**(2026-09-26 정정): 검색은 형태소 낱말 일치라서 `홈플`은 `홈플러스`를, `구매`는 `구매기`를 찾지 못한다. 짧은 낱말이 긴 꼴을 덮는다고 센 탓에 `홈플러스`, `구매기` 같은 낱말은 몫이 없어 검색어가 되지 못했다. 사전은 고치지 않는다 — 남은 글은 id로 하나씩 읽어 거둔다(설계 `2026-09-26-article-id-probe-design.md`).
```

- [ ] **Step 4: Settle the run rows' place in the probe spec**

In `2026-09-26-article-id-probe-design.md` §3 "실행 행", replace the sentence `최근 기록에 그대로 나온다.` with

```
최근 기록(수집 현황의 실행 목록)에는 내지 않는다 — 검색어 보충의 실행처럼 목록 걷기의 기간이 아니라서, 나오면 전체 카페 실행처럼 읽히고 목록 걷기의 블록을 밀어낸다. 카드가 이 feed의 마지막 실행과 그 사유를 보여 준다(§6).
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-25-board-search-backfill-design.md docs/superpowers/specs/2026-09-26-article-id-probe-design.md
git commit -m "docs: correct the search matching model to morpheme tokens"
```

---

### Task 2: The article read contract (sonnet)

**Files:**
- Modify: `src/shared/cafeArticleList.ts` (`CollectedPostMetadata.replyCount` ~line 23; `optionalNullableString` ~line 118; `epochMilliseconds` ~line 140)
- Create: `src/shared/cafeArticleEndpoint.ts`
- Create: `src/shared/cafeArticleRead.ts`
- Create: `tests/fixtures/cafe-article-read-728686.json`, `tests/fixtures/cafe-article-read-deleted.json`, `tests/fixtures/cafe-article-read-login.json`
- Test: `tests/shared/cafeArticleEndpoint.test.ts`, `tests/shared/cafeArticleRead.test.ts`

**Interfaces:**
- Consumes: `record`, `fail`, `nullableString`, `safeInteger`, `JsonRecord`, `CollectedPostMetadata` from `src/shared/cafeArticleList.ts`; `CAFE_ARTICLE_LIST` from `src/shared/cafeArticleFixture.ts`.
- Produces:
  - `CAFE_ARTICLE_READ: { readonly headers: { readonly 'x-cafe-product': 'pc' } }`
  - `isArticleId(value: string): boolean`
  - `cafeArticleReadUrl(postId: string): string`
  - `cafeArticleReadReferer(postId: string): string`
  - `interface ParsedCafeArticle { readonly post: CollectedPostMetadata; readonly isNotice: boolean }`
  - `type CafeArticleRead = ({ readonly kind: 'article' } & ParsedCafeArticle) | { readonly kind: 'absent'; readonly status: number; readonly code: string }`
  - `parseCafeArticle(postId: string, value: unknown): ParsedCafeArticle`
  - `parseCafeArticleText(postId: string, text: string): ParsedCafeArticle` (throws `CafeArticleListParseError`; `INVALID_JSON` for non-JSON)
  - `cafeRefusalCode(text: string): string | null`
  - `CollectedPostMetadata.replyCount: number | null`; exported `optionalNullableString`, `epochMilliseconds`.

- [ ] **Step 1: Confirm nothing reads `replyCount`**

Run: `grep -rn "replyCount" src`
Expected: only the interface and the two parsers (`cafeArticleList.ts`, `cafeBoardSearchList.ts`). `posts` has no reply column (spec §5). If anything else reads it, stop and report.

- [ ] **Step 2: Widen `replyCount` and export the two readers**

In `src/shared/cafeArticleList.ts` replace the `replyCount` member with:

```ts
  /** Null when the feed does not report it: the article read has none. Nothing stores it. */
  readonly replyCount: number | null
```

and add `export` in front of `function optionalNullableString(` and `function epochMilliseconds(`. No other change.

- [ ] **Step 3: Write the fixtures**

`tests/fixtures/cafe-article-read-728686.json` (reduced from the 2026-09-26 capture of post 728686; the writer is anonymised like the other fixtures). JSON carries no comments, so the facts behind it live here and in the test: `cafeId` and `menu.id` are numbers on every live read (5 posts, 2026-09-26), and a post without a prefix (928665) has no `head` and no `headId` key at all:

```json
{
  "result": {
    "cafeId": 14538121,
    "articleId": 728686,
    "menuId": 0,
    "article": {
      "id": 728686,
      "refArticleId": 728686,
      "menu": { "id": 137, "name": "국내구입기 & 정보", "menuType": "B", "boardType": "L" },
      "subject": "월드컵 홈플러스",
      "headId": 390,
      "head": "대형마트",
      "writer": { "memberKey": "key-writer", "nick": "글쓴이", "memberLevel": 120 },
      "writeDate": 1749029333663,
      "readCount": 890,
      "commentCount": 1,
      "isNotice": false,
      "isReadable": true,
      "isBlind": false,
      "isOpen": true
    },
    "comments": { "items": [] }
  }
}
```

`tests/fixtures/cafe-article-read-deleted.json`:

```json
{
  "result": {
    "errorCode": "4003",
    "reason": "삭제되었거나 존재하지 않는 게시글입니다.",
    "message": "삭제되었거나 존재하지 않는 게시글입니다.",
    "more": { "cafeId": 14538121 }
  }
}
```

`tests/fixtures/cafe-article-read-login.json` — despite its `reason`, 0004 is a per-board restriction of this read, not a login failure: post 937311 on board 207 is stored by the list walk under the same session and still answers 0004 here (2026-09-26):

```json
{
  "result": {
    "errorCode": "0004",
    "reason": "로그인하지 않았습니다.",
    "message": "로그인하지 않았습니다."
  }
}
```

- [ ] **Step 4: Write the failing endpoint test**

`tests/shared/cafeArticleEndpoint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CAFE_ARTICLE_READ, cafeArticleReadReferer, cafeArticleReadUrl, isArticleId } from '../../src/shared/cafeArticleEndpoint.js'

describe('cafe article read endpoint', () => {
  it('asks for one article the way the cafe\'s article page does', () => {
    expect(cafeArticleReadUrl('728686')).toBe(
      'https://article.cafe.naver.com/gw/v4/cafes/14538121/articles/728686?fromList=true&menuId=0&tc=cafe_article_list&useCafeId=true',
    )
    expect(CAFE_ARTICLE_READ.headers).toEqual({ 'x-cafe-product': 'pc' })
    expect(cafeArticleReadReferer('728686')).toBe('https://cafe.naver.com/ca-fe/cafes/14538121/articles/728686')
  })

  it.each(['0', '0728686', '72a', '', ' 1', '9007199254740993'])('refuses %j as an id', (value) => {
    expect(isArticleId(value)).toBe(false)
    expect(() => cafeArticleReadUrl(value)).toThrow()
    expect(() => cafeArticleReadReferer(value)).toThrow()
  })

  it('accepts a decimal id within the safe range', () => {
    expect(isArticleId('1')).toBe(true)
    expect(isArticleId('753801')).toBe(true)
  })
})
```

- [ ] **Step 5: Write the failing parser test**

`tests/shared/cafeArticleRead.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CafeArticleListParseError } from '../../src/shared/cafeArticleList.js'
import { cafeRefusalCode, parseCafeArticle, parseCafeArticleText } from '../../src/shared/cafeArticleRead.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
const live = fixture('cafe-article-read-728686.json')
const withArticle = (change: (article: Record<string, unknown>) => void): unknown => {
  const value = JSON.parse(live) as { result: { article: Record<string, unknown> } }
  change(value.result.article)
  return value
}
const codeOf = (run: () => unknown): string | null => {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof CafeArticleListParseError ? error.code : 'OTHER'
  }
}

describe('parseCafeArticle', () => {
  it('reads a live article into the row every walk writes, and says it is no notice', () => {
    expect(parseCafeArticleText('728686', live)).toEqual({ isNotice: false, post: {
      cafeId: '14538121',
      postId: '728686',
      boardId: '137',
      boardName: '국내구입기 & 정보',
      title: '월드컵 홈플러스',
      prefix: '대형마트',
      authorId: 'key-writer',
      authorNickname: '글쓴이',
      postedAt: 1749029333663,
      viewCount: 890,
      commentCount: 1,
      replyCount: null,
      isNotice: false,
    } })
  })

  it('reads a post without a prefix whether headId is left out (928665, live) or 0', () => {
    expect(parseCafeArticle('728686', withArticle((a) => { delete a.head; delete a.headId })).post.prefix).toBeNull()
    expect(parseCafeArticle('728686', withArticle((a) => { delete a.head; a.headId = 0 })).post.prefix).toBeNull()
  })

  it('carries the notice flag beside the post, which itself stays the list\'s shape', () => {
    const notice = parseCafeArticle('728686', withArticle((a) => { a.isNotice = true }))
    expect(notice.isNotice).toBe(true)
    expect(notice.post.isNotice).toBe(false)
  })

  it('refuses an answer about another article than the one asked for', () => {
    expect(codeOf(() => parseCafeArticleText('728687', live))).toBe('INVALID_ARTICLE')
  })

  it.each([
    ['a headed article without its head', (a: Record<string, unknown>) => { delete a.head }],
    ['no writer', (a: Record<string, unknown>) => { delete a.writer }],
    ['no board', (a: Record<string, unknown>) => { delete a.menu }],
    ['a board without a name', (a: Record<string, unknown>) => { a.menu = { id: 137, name: null } }],
    ['a time in seconds', (a: Record<string, unknown>) => { a.writeDate = 1749029333 }],
    ['a negative view count', (a: Record<string, unknown>) => { a.readCount = -1 }],
    ['no notice flag', (a: Record<string, unknown>) => { delete a.isNotice }],
    ['a notice flag that is not a boolean', (a: Record<string, unknown>) => { a.isNotice = 'N' }],
  ])('fails loudly on %s', (_label, change) => {
    expect(codeOf(() => parseCafeArticle('728686', withArticle(change)))).toBe('INVALID_ARTICLE')
  })

  it('fails loudly on an envelope without an article, and on a page that is not JSON', () => {
    expect(codeOf(() => parseCafeArticleText('728686', '{"result":{}}'))).toBe('INVALID_ARTICLE')
    expect(codeOf(() => parseCafeArticleText('728686', '{}'))).toBe('INVALID_ENVELOPE')
    expect(codeOf(() => parseCafeArticleText('728686', '<html>'))).toBe('INVALID_JSON')
  })
})

describe('cafeRefusalCode', () => {
  it('reads the cafe\'s own reason for having no post to give', () => {
    expect(cafeRefusalCode(fixture('cafe-article-read-deleted.json'))).toBe('4003')
    expect(cafeRefusalCode(fixture('cafe-article-read-login.json'))).toBe('0004')
  })

  it.each(['<html>', '', '{}', '{"result":{}}', '{"result":{"errorCode":""}}', '{"result":{"errorCode":4003}}'])('names none in %j', (text) => {
    expect(cafeRefusalCode(text)).toBeNull()
  })
})
```

- [ ] **Step 6: Run both tests to verify they fail**

Run: `pnpm vitest run tests/shared/cafeArticleEndpoint.test.ts tests/shared/cafeArticleRead.test.ts`
Expected: FAIL — cannot resolve `cafeArticleEndpoint.js` / `cafeArticleRead.js`.

- [ ] **Step 7: Write `src/shared/cafeArticleEndpoint.ts`**

```ts
import { CAFE_ARTICLE_LIST } from './cafeArticleFixture.js'

/**
 * One article read by id — the call the cafe's own article page makes
 * (captured 2026-09-26). It answers one id exactly: the post when it lives, the
 * cafe's own error code when it does not. Reading it does not move the view
 * count (753801 read three times stayed at 669). Everything but the id is fixed
 * here, so the extension can never be asked to read anything else through it.
 */
export const CAFE_ARTICLE_READ = {
  headers: { 'x-cafe-product': 'pc' },
} as const

const ARTICLE_ORIGIN = 'https://article.cafe.naver.com'
const ARTICLE_PATH = `/gw/v4/cafes/${CAFE_ARTICLE_LIST.cafeId}/articles/`
const ARTICLE_ID = /^[1-9]\d*$/

/** Decimal, no leading zero, within Number's safe range: the walk orders ids as numbers. */
export function isArticleId(value: string): boolean {
  return ARTICLE_ID.test(value) && Number.isSafeInteger(Number(value))
}

function assertArticleId(postId: string): void {
  if (!isArticleId(postId)) throw new Error(`not an article id: ${postId}`)
}

export function cafeArticleReadUrl(postId: string): string {
  assertArticleId(postId)
  const url = new URL(`${ARTICLE_ORIGIN}${ARTICLE_PATH}${postId}`)
  url.searchParams.set('fromList', 'true')
  url.searchParams.set('menuId', CAFE_ARTICLE_LIST.menuId)
  url.searchParams.set('tc', 'cafe_article_list')
  url.searchParams.set('useCafeId', 'true')
  return url.toString()
}

/**
 * The page the request should appear to come from: the article's own screen.
 * The host allows only `https://cafe.naver.com` as an origin, which the
 * extension derives from this.
 */
export function cafeArticleReadReferer(postId: string): string {
  assertArticleId(postId)
  return `https://cafe.naver.com/ca-fe/cafes/${CAFE_ARTICLE_LIST.cafeId}/articles/${postId}`
}
```

- [ ] **Step 8: Write `src/shared/cafeArticleRead.ts`**

```ts
import {
  epochMilliseconds,
  fail,
  nullableString,
  optionalNullableString,
  record,
  safeInteger,
  type CollectedPostMetadata,
  type JsonRecord,
} from './cafeArticleList.js'

/**
 * Pure contract for one article read by id (captured 2026-09-26). Its `article`
 * is the object the comment read carries too: the board is `menu`, the prefix
 * `head`, the time `writeDate` in epoch ms, and the subject plain text — no
 * search highlight. A malformed answer fails loudly: judging it would close an
 * id that was never really read.
 */

/**
 * The post, and whether the cafe calls it a notice. The flag sits beside the
 * post rather than in it: `CollectedPostMetadata` is the list's row, where a
 * notice never appears, and the desktop decides what a notice read by id means.
 */
export interface ParsedCafeArticle {
  readonly post: CollectedPostMetadata
  readonly isNotice: boolean
}

export type CafeArticleRead =
  | ({ readonly kind: 'article' } & ParsedCafeArticle)
  /** The cafe answered and said why there is no post: its own code, with the HTTP status it came with. */
  | { readonly kind: 'absent'; readonly status: number; readonly code: string }

const PATH = 'result.article'

/**
 * A post without a prefix leaves `head` out, and `headId` out (seen live, 928665)
 * or 0 (the list's other spelling). A non-zero `headId` without its name is neither, and is
 * refused so a renamed field cannot pass as a post that never had a prefix.
 */
function prefixOfArticle(article: JsonRecord): string | null {
  const head = optionalNullableString(article, 'head', PATH, 'INVALID_ARTICLE')
  if (head !== undefined && head !== null && head !== '') return head
  const headId = article.headId
  if (headId === undefined || headId === null || headId === 0) return null
  return fail('INVALID_ARTICLE', `${PATH}.head is missing for a headed article`)
}

export function parseCafeArticle(postId: string, value: unknown): ParsedCafeArticle {
  const response = record(value, 'response', 'INVALID_ENVELOPE')
  const result = record(response.result, 'response.result', 'INVALID_ENVELOPE')
  const article = record(result.article, PATH, 'INVALID_ARTICLE')
  const menu = record(article.menu, `${PATH}.menu`, 'INVALID_ARTICLE')
  const writer = record(article.writer, `${PATH}.writer`, 'INVALID_ARTICLE')
  const id = String(safeInteger(article, 'id', PATH, 1, 'INVALID_ARTICLE'))
  if (id !== postId) fail('INVALID_ARTICLE', `${PATH}.id ${id} is not the article asked for`)
  const boardName = nullableString(menu, 'name', `${PATH}.menu`, 'INVALID_ARTICLE')
  if (boardName === null) fail('INVALID_ARTICLE', `${PATH}.menu.name must not be null`)
  const isNotice = article.isNotice
  if (typeof isNotice !== 'boolean') fail('INVALID_ARTICLE', `${PATH}.isNotice must be a boolean`)
  const post: CollectedPostMetadata = {
    cafeId: String(safeInteger(result, 'cafeId', 'result', 1, 'INVALID_ENVELOPE')),
    postId: id,
    boardId: String(safeInteger(menu, 'id', `${PATH}.menu`, 1, 'INVALID_ARTICLE')),
    boardName,
    title: nullableString(article, 'subject', PATH, 'INVALID_ARTICLE'),
    prefix: prefixOfArticle(article),
    authorId: nullableString(writer, 'memberKey', `${PATH}.writer`, 'INVALID_ARTICLE'),
    authorNickname: nullableString(writer, 'nick', `${PATH}.writer`, 'INVALID_ARTICLE'),
    postedAt: epochMilliseconds(article, 'writeDate', PATH),
    viewCount: safeInteger(article, 'readCount', PATH, 0, 'INVALID_ARTICLE'),
    commentCount: safeInteger(article, 'commentCount', PATH, 0, 'INVALID_ARTICLE'),
    replyCount: null,
    // The list's row never holds a notice; whether this one is rides beside it.
    isNotice: false,
  }
  return { post, isNotice }
}

export function parseCafeArticleText(postId: string, text: string): ParsedCafeArticle {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'article response is not valid JSON')
  }
  return parseCafeArticle(postId, value)
}

/**
 * The cafe's own code in a refusal (`4003` deleted, `0004` not readable on this
 * board — answered for posts the list walk stores, so not a login failure), or
 * null when the body names none — an HTML error page, an empty body. What a
 * code means is the desktop's judgement, not the transport's.
 */
export function cafeRefusalCode(text: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const result = (value as { result?: unknown }).result
  if (typeof result !== 'object' || result === null) return null
  const code = (result as { errorCode?: unknown }).errorCode
  return typeof code === 'string' && code !== '' ? code : null
}
```

- [ ] **Step 9: Run the tests, types and lint**

Run: `pnpm vitest run tests/shared && pnpm typecheck && pnpm lint`
Expected: PASS. (`replyCount: 0` in older test literals still type-checks against `number | null`.)

- [ ] **Step 10: Commit**

```bash
git add src/shared/cafeArticleList.ts src/shared/cafeArticleEndpoint.ts src/shared/cafeArticleRead.ts tests/fixtures/cafe-article-read-728686.json tests/fixtures/cafe-article-read-deleted.json tests/fixtures/cafe-article-read-login.json tests/shared/cafeArticleEndpoint.test.ts tests/shared/cafeArticleRead.test.ts
git commit -m "feat: parse one article read by id"
```

---

### Task 3: The protocol message (sonnet)

**Files:**
- Modify: `src/shared/protocol.ts` (version ~line 8, `TIMEOUTS` ~line 16, new interface after `CollectBoardSearchPageRequest` ~line 58, `AppMessage` ~line 110, `ExtensionMessage` ~line 135, the type sets ~lines 170-195, `isAppMessage`/`isExtensionMessage` ~lines 205-218, new guards at the end)
- Test: `tests/shared/protocol.test.ts` (the `bumps the protocol` case at ~line 230 moves to the new describe)

**Interfaces:**
- Consumes: `isArticleId`, `CafeArticleRead` (Task 2); `CAFE_ARTICLE_LIST`.
- Produces:
  - `PROTOCOL_VERSION = 13`, `TIMEOUTS.articleMs = 20_000`
  - `interface CollectArticleRequest { readonly type: 'COLLECT_ARTICLE'; readonly requestId: string; readonly cafeId: typeof CAFE_ARTICLE_LIST.cafeId; readonly postId: string }`
  - `AppMessage` member `CollectArticleRequest`; `ExtensionMessage` member `{ type: 'ARTICLE_COLLECTED'; requestId: string; result: CafeArticleRead }`
  - `isCollectArticleRequest(value: unknown): value is CollectArticleRequest`

- [ ] **Step 1: Write the failing tests**

In `tests/shared/protocol.test.ts` delete this case from the `COLLECT_BOARD_SEARCH_PAGE` describe:

```ts
  it('bumps the protocol, since an older extension cannot answer it', () => {
    expect(PROTOCOL_VERSION).toBe(12)
  })
```

Add `isCollectArticleRequest` (and `isExtensionMessage` if not already imported) to the import from `../../src/shared/protocol.js`, and append:

```ts
describe('COLLECT_ARTICLE', () => {
  const request = { type: 'COLLECT_ARTICLE', requestId: 'article-1', cafeId: '14538121', postId: '728686' } as const

  it('accepts one article of this cafe', () => {
    expect(isCollectArticleRequest(request)).toBe(true)
    expect(isAppMessage(request)).toBe(true)
  })

  it.each([
    ['another cafe', { cafeId: '1' }],
    ['id zero', { postId: '0' }],
    ['a padded id', { postId: '0728686' }],
    ['a non-digit id', { postId: '72868a' }],
    ['a numeric id', { postId: 728686 }],
    ['no request id', { requestId: undefined }],
  ])('refuses %s', (_label, change) => {
    expect(isCollectArticleRequest({ ...request, ...change })).toBe(false)
    expect(isAppMessage({ ...request, ...change })).toBe(false)
  })

  it('accepts an answer that carries a post or the cafe\'s reason for none', () => {
    const post = { postId: '728686', boardId: '137' }
    expect(isExtensionMessage({ type: 'ARTICLE_COLLECTED', requestId: 'article-1', result: { kind: 'article', post, isNotice: false } })).toBe(true)
    expect(isExtensionMessage({ type: 'ARTICLE_COLLECTED', requestId: 'article-1', result: { kind: 'absent', status: 404, code: '4003' } })).toBe(true)
  })

  it.each([
    ['no result', { result: null }],
    ['an article without its post', { result: { kind: 'article', isNotice: false } }],
    ['an article without its notice flag', { result: { kind: 'article', post: { postId: '728686' } } }],
    ['an absence without its code', { result: { kind: 'absent', status: 404 } }],
    ['an unknown kind', { result: { kind: 'maybe' } }],
  ])('refuses an answer with %s', (_label, change) => {
    expect(isExtensionMessage({ type: 'ARTICLE_COLLECTED', requestId: 'article-1', ...change })).toBe(false)
  })

  it('bumps the protocol, since an older extension cannot answer it', () => {
    expect(PROTOCOL_VERSION).toBe(13)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/shared/protocol.test.ts`
Expected: FAIL — `isCollectArticleRequest` is not exported; the version is 12.

- [ ] **Step 3: Implement**

In `src/shared/protocol.ts`, after the board search import:

```ts
import { isArticleId } from './cafeArticleEndpoint.js'
import type { CafeArticleRead } from './cafeArticleRead.js'
```

Set `export const PROTOCOL_VERSION = 13`. In `TIMEOUTS`, after `memberPageMs: 20_000,` add `articleMs: 20_000,`.

After `CollectBoardSearchPageRequest`:

```ts
/** One article of this cafe, by id; answered with ARTICLE_COLLECTED. */
export interface CollectArticleRequest {
  readonly type: 'COLLECT_ARTICLE'
  readonly requestId: string
  readonly cafeId: typeof CAFE_ARTICLE_LIST.cafeId
  readonly postId: string
}
```

In `AppMessage`, after `| CollectBoardSearchPageRequest`:

```ts
  /** One article by id; the extension reads it and judges nothing. */
  | CollectArticleRequest
```

In `ExtensionMessage`, after the `MEMBER_PAGE_COLLECTED` member:

```ts
  | { type: 'ARTICLE_COLLECTED'; requestId: string; result: CafeArticleRead }
```

Add `'COLLECT_ARTICLE'` to `APP_MESSAGE_TYPES` after `'COLLECT_BOARD_SEARCH_PAGE'`, and `'ARTICLE_COLLECTED'` to `EXTENSION_MESSAGE_TYPES` after `'MEMBER_PAGE_COLLECTED'`.

In `isAppMessage`, after the search line: `if (type === 'COLLECT_ARTICLE') return isCollectArticleRequest(value)`.
In `isExtensionMessage`, after the member line: `if (type === 'ARTICLE_COLLECTED') return isArticleCollected(value)`.

At the end of the file:

```ts
/** Runtime guard for one article of this cafe, by an id the endpoint accepts. */
export function isCollectArticleRequest(value: unknown): value is CollectArticleRequest {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Partial<CollectArticleRequest>
  return (
    message.type === 'COLLECT_ARTICLE' &&
    typeof message.requestId === 'string' &&
    message.cafeId === CAFE_ARTICLE_LIST.cafeId &&
    typeof message.postId === 'string' &&
    isArticleId(message.postId)
  )
}

function isArticleCollected(value: unknown): value is Extract<ExtensionMessage, { type: 'ARTICLE_COLLECTED' }> {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { type?: unknown; requestId?: unknown; result?: unknown }
  if (message.type !== 'ARTICLE_COLLECTED' || typeof message.requestId !== 'string' || typeof message.result !== 'object' || message.result === null) {
    return false
  }
  const result = message.result as { kind?: unknown; post?: unknown; isNotice?: unknown; status?: unknown; code?: unknown }
  if (result.kind === 'absent') return typeof result.status === 'number' && typeof result.code === 'string'
  if (result.kind !== 'article' || typeof result.isNotice !== 'boolean' || typeof result.post !== 'object' || result.post === null) return false
  return typeof (result.post as { postId?: unknown }).postId === 'string'
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm vitest run tests/shared tests/desktop/bootstrap.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS. (The bootstrap handshake test sends `PROTOCOL_VERSION` itself and follows the bump.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.ts tests/shared/protocol.test.ts
git commit -m "feat: add the one-article read to the extension protocol"
```

---

### Task 4: The extension reads one article (sonnet)

**Files:**
- Create: `src/extension/articleReader.ts`
- Modify: `src/extension/dispatch.ts` (imports, `DispatcherDeps` ~line 30, new case after `COLLECT_BOARD_SEARCH_PAGE` ~line 130)
- Modify: `src/extension/background.ts` (import ~line 8, reader construction ~line 143, `createDispatcher` call ~line 171)
- Modify: `src/extension/refererRule.ts` (the `RefererEndpoint` type ~line 9, a new entry before rule 3 in `ENDPOINTS` ~line 45, `endpointFor` ~line 70, the rule's `priority` and `condition` in `refererRuleFor` ~line 85)
- Test: `tests/extension/articleReader.test.ts` (create), `tests/extension/dispatch.test.ts`, `tests/extension/refererRule.test.ts`

**Interfaces:**
- Consumes: `CollectArticleRequest`, `isCollectArticleRequest` (Task 3); `CAFE_ARTICLE_READ`, `cafeArticleReadUrl`, `cafeArticleReadReferer`, `parseCafeArticleText`, `cafeRefusalCode`, `CafeArticleRead` (Task 2); `Http` from `src/shared/http.ts`.
- Produces:
  - `type ArticleReadResult = { readonly ok: true; readonly result: CafeArticleRead } | { readonly ok: false; readonly code: 'ARTICLE_BAD_REQUEST' | 'ARTICLE_NETWORK_ERROR' | 'ARTICLE_HTTP_ERROR' | 'ARTICLE_INVALID_JSON' | 'ARTICLE_PARSE_ERROR' }`
  - `createArticleReader(deps: { readonly http: Http }): { read(request: CollectArticleRequest): Promise<ArticleReadResult> }`
  - `DispatcherDeps.articleReader: { read(request: CollectArticleRequest): Promise<ArticleReadResult> }`
  - The extension answers `COLLECT_ARTICLE` with `ARTICLE_COLLECTED` or `ERROR { code }` (code body-free, like every reader).
  - Referer rule 5: `regexFilter` `^https://article\.cafe\.naver\.com/gw/v4/cafes/[0-9]+/articles/[0-9]+\?`, domain `article.cafe.naver.com`, priority 2. Rule 3 keeps its `urlFilter`, id and priority.

Why a rule of its own: rule 3 (`||article.cafe.naver.com/gw/v4/`) also covers the article path, but a rule is installed for one request and removed when it ends, keyed by its id — sharing id 3 with the prefix reminder's comment read would let one request's teardown strip the other's referer. A `urlFilter` cannot tell the two apart (the article path is a prefix of the comment path, `/articles/{id}/comments/...`), so rule 5 uses a `regexFilter` that needs the query string right after the id. It is listed before rule 3, since `endpointFor` takes the first entry that covers an address, and it carries priority 2 so that while a comment read's rule 3 is installed the article read still goes out with its own article's page as referer. The comment read never matches rule 5 and behaves as before. `regexFilter` is not used elsewhere yet; `chrome.declarativeNetRequest.RuleCondition` allows it (only one of `urlFilter`/`regexFilter` per rule, ASCII only).

- [ ] **Step 1: Write the failing reader test**

`tests/extension/articleReader.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createArticleReader } from '../../src/extension/articleReader.js'
import { cafeArticleReadReferer, cafeArticleReadUrl } from '../../src/shared/cafeArticleEndpoint.js'
import type { HttpRequest } from '../../src/shared/http.js'
import type { CollectArticleRequest } from '../../src/shared/protocol.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
const request: CollectArticleRequest = { type: 'COLLECT_ARTICLE', requestId: 'article-1', cafeId: '14538121', postId: '728686' }
const answer = (status: number, text: string) => createArticleReader({ http: async () => ({ status, contentType: 'application/json', text }) })

describe('ArticleReader', () => {
  it('asks for exactly one article the way the article page does', async () => {
    const seen: HttpRequest[] = []
    const reader = createArticleReader({
      http: async (init) => {
        seen.push(init)
        return { status: 200, contentType: 'application/json', text: fixture('cafe-article-read-728686.json') }
      },
    })
    await expect(reader.read(request)).resolves.toMatchObject({ ok: true, result: { kind: 'article', isNotice: false, post: { postId: '728686', boardId: '137' } } })
    expect(seen).toEqual([{ url: cafeArticleReadUrl('728686'), headers: { 'x-cafe-product': 'pc' }, referer: cafeArticleReadReferer('728686') }])
  })

  it('passes on the cafe\'s reason for having no post, with its status', async () => {
    await expect(answer(404, fixture('cafe-article-read-deleted.json')).read(request)).resolves.toEqual({ ok: true, result: { kind: 'absent', status: 404, code: '4003' } })
    await expect(answer(401, fixture('cafe-article-read-login.json')).read(request)).resolves.toEqual({ ok: true, result: { kind: 'absent', status: 401, code: '0004' } })
  })

  it('names each way a read can fail', async () => {
    await expect(answer(500, '<html>').read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_HTTP_ERROR' })
    await expect(answer(200, '<html>').read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_INVALID_JSON' })
    await expect(answer(200, '{"result":{}}').read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_PARSE_ERROR' })
    await expect(answer(200, fixture('cafe-article-read-728686.json')).read({ ...request, postId: '728687' })).resolves.toEqual({ ok: false, code: 'ARTICLE_PARSE_ERROR' })
    const offline = createArticleReader({ http: async () => { throw new Error('offline') } })
    await expect(offline.read(request)).resolves.toEqual({ ok: false, code: 'ARTICLE_NETWORK_ERROR' })
    await expect(offline.read({ ...request, postId: '0' })).resolves.toEqual({ ok: false, code: 'ARTICLE_BAD_REQUEST' })
  })
})
```

- [ ] **Step 2: Add the dispatch and referer cases**

In `tests/extension/dispatch.test.ts`, add `CollectArticleRequest` to the protocol type import, and in `setup` add to `deps` after `boardSearchPageReader`:

```ts
    articleReader: { read: async () => ({ ok: false as const, code: 'ARTICLE_BAD_REQUEST' as const }) },
```

Then add, after the case `answers a board search page read with BOARD_PAGE_COLLECTED`:

```ts
  it('answers an article read with ARTICLE_COLLECTED, and a failed one with its bare code', async () => {
    const articleRequest: CollectArticleRequest = { type: 'COLLECT_ARTICLE', requestId: 'ra1', cafeId: '14538121', postId: '728686' }
    const absent = { kind: 'absent' as const, status: 404, code: '4003' }
    const answered = setup({ articleReader: { read: async () => ({ ok: true as const, result: absent }) } })
    await answered.run(articleRequest)
    expect(answered.replies[0]).toEqual({ type: 'ARTICLE_COLLECTED', requestId: 'ra1', result: absent })

    const failed = setup({ articleReader: { read: async () => ({ ok: false as const, code: 'ARTICLE_HTTP_ERROR' as const }) } })
    await failed.run(articleRequest)
    expect(failed.replies[0]).toEqual({ type: 'ERROR', requestId: 'ra1', code: 'ARTICLE_HTTP_ERROR', message: 'ARTICLE_HTTP_ERROR' })
  })
```

In `tests/extension/refererRule.test.ts`, import `cafeArticleReadReferer, cafeArticleReadUrl` from `../../src/shared/cafeArticleEndpoint.js`, add `const articleById = cafeArticleReadUrl('728686')` beside the other addresses, and teach `matches` the second way Chrome reads a condition — replace its body with:

```ts
  const parsed = new URL(url)
  const domains = rule.condition.requestDomains ?? []
  const onDomain = domains.some(
    (domain) => parsed.host === domain || parsed.host.endsWith(`.${domain}`),
  )
  if (rule.condition.regexFilter !== undefined) {
    if (rule.condition.urlFilter !== undefined) throw new Error('a rule takes one of urlFilter and regexFilter')
    return onDomain && new RegExp(rule.condition.regexFilter).test(url)
  }
  const filter = rule.condition.urlFilter ?? ''
  if (!filter.startsWith('||')) throw new Error(`urlFilter must be host-anchored: ${filter}`)
  return onDomain && `${parsed.host}${parsed.pathname}`.startsWith(filter.slice(2))
```

Add `articleById` to the URL lists of `covers every endpoint that needs a referer` and `gives each endpoint a rule id of its own`, and change that case's `expect(new Set(ids).size).toBe(4)` to `toBe(5)`. Then add after the board search case:

```ts
  it('gives the article read by id a rule of its own, which the comment read does not match', () => {
    const rule = refererRuleFor(articleById, cafeArticleReadReferer('728686'))
    expect(rule?.id).toBe(5)
    expect(rule?.priority).toBe(2)
    expect(rule?.condition.urlFilter).toBeUndefined()
    expect(rule !== null && matches(rule, articleById)).toBe(true)
    // The comment read's path starts with the article's: only the query right after the id tells them apart.
    expect(rule !== null && matches(rule, articleRead)).toBe(false)
    expect(rule?.action.requestHeaders).toEqual([
      { header: 'referer', operation: 'set', value: 'https://cafe.naver.com/ca-fe/cafes/14538121/articles/728686' },
      { header: 'origin', operation: 'set', value: 'https://cafe.naver.com' },
    ])
  })

  it('leaves the comment read on rule 3, as it was', () => {
    const rule = refererRuleFor(articleRead, REFERER)
    expect(rule?.id).toBe(3)
    expect(rule?.priority).toBe(1)
    expect(rule?.condition.urlFilter).toBe('||article.cafe.naver.com/gw/v4/')
    expect(rule?.condition.regexFilter).toBeUndefined()
  })
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run tests/extension`
Expected: FAIL — `articleReader.js` does not resolve, `articleReader` is not a `DispatcherDeps` field, and the article read still resolves to rule 3.

- [ ] **Step 4: Write `src/extension/articleReader.ts`**

```ts
import { CAFE_ARTICLE_READ, cafeArticleReadReferer, cafeArticleReadUrl } from '../shared/cafeArticleEndpoint.js'
import { CafeArticleListParseError } from '../shared/cafeArticleList.js'
import { cafeRefusalCode, parseCafeArticleText, type CafeArticleRead } from '../shared/cafeArticleRead.js'
import type { Http, HttpResponse } from '../shared/http.js'
import { isCollectArticleRequest, type CollectArticleRequest } from '../shared/protocol.js'

export type ArticleReadResult =
  | { readonly ok: true; readonly result: CafeArticleRead }
  | {
      readonly ok: false
      readonly code: 'ARTICLE_BAD_REQUEST' | 'ARTICLE_NETWORK_ERROR' | 'ARTICLE_HTTP_ERROR' | 'ARTICLE_INVALID_JSON' | 'ARTICLE_PARSE_ERROR'
    }

/**
 * Reads exactly one article by id. Like the page readers it has no loop,
 * cursor, sleep or storage, and it judges nothing: a refusal that names the
 * cafe's own code goes back as that code and its status, and which codes mean
 * "deleted" or "not readable" is the desktop's business.
 */
export function createArticleReader(deps: { readonly http: Http }) {
  return {
    async read(request: CollectArticleRequest): Promise<ArticleReadResult> {
      if (!isCollectArticleRequest(request)) return { ok: false, code: 'ARTICLE_BAD_REQUEST' }

      let response: HttpResponse
      try {
        response = await deps.http({
          url: cafeArticleReadUrl(request.postId),
          headers: CAFE_ARTICLE_READ.headers,
          referer: cafeArticleReadReferer(request.postId),
        })
      } catch {
        return { ok: false, code: 'ARTICLE_NETWORK_ERROR' }
      }
      if (response.status !== 200) {
        const code = cafeRefusalCode(response.text)
        return code === null ? { ok: false, code: 'ARTICLE_HTTP_ERROR' } : { ok: true, result: { kind: 'absent', status: response.status, code } }
      }

      try {
        return { ok: true, result: { kind: 'article', ...parseCafeArticleText(request.postId, response.text) } }
      } catch (error) {
        if (error instanceof CafeArticleListParseError && error.code === 'INVALID_JSON') return { ok: false, code: 'ARTICLE_INVALID_JSON' }
        return { ok: false, code: 'ARTICLE_PARSE_ERROR' }
      }
    },
  }
}
```

- [ ] **Step 5: Route it in `dispatch.ts`**

Add `CollectArticleRequest` to the protocol type import and `import type { ArticleReadResult } from './articleReader.js'`. In `DispatcherDeps` after `boardSearchPageReader`:

```ts
  readonly articleReader: { read(request: CollectArticleRequest): Promise<ArticleReadResult> }
```

After the `COLLECT_BOARD_SEARCH_PAGE` case:

```ts
      case 'COLLECT_ARTICLE': {
        const result = await deps.articleReader.read(message)
        if (!result.ok) {
          // Stable and body-free, like the pages: an article names its writer.
          reply({ type: 'ERROR', requestId: message.requestId, code: result.code, message: result.code })
          return
        }
        reply({ type: 'ARTICLE_COLLECTED', requestId: message.requestId, result: result.result })
        return
      }
```

- [ ] **Step 6: Build it in `background.ts`**

Add `import { createArticleReader } from './articleReader.js'` beside the other reader imports; after `const boardSearchPageReader = ...` add `const articleReader = createArticleReader({ http: request })`; pass `articleReader,` to `createDispatcher` after `boardSearchPageReader,`.

- [ ] **Step 7: Give the article read its own rule**

In `src/extension/refererRule.ts`, replace the `RefererEndpoint` interface with:

```ts
/**
 * How Chrome is told which addresses a rule covers — exactly one of the two.
 * `urlFilter` spelled `||host/path` is a host-anchored prefix of host plus
 * path; `regexFilter` is for an address that is a prefix of another endpoint's
 * and can only be told apart by what follows it.
 */
type RefererMatch = { readonly urlFilter: string } | { readonly regexFilter: string }

type RefererEndpoint = RefererMatch & {
  /**
   * The rule's own id. One id per endpoint, because the rule is installed for
   * one request and removed when it ends: with a single shared id, a second
   * request's teardown strips the first request's rule, and that request then
   * goes out with no referer — answered 200, writing nothing.
   */
  readonly ruleId: number
  /** The host the endpoint lives on. Chrome reads it as the host or a sub-domain of it. */
  readonly requestDomain: string
  /** Above 1 for an endpoint whose addresses another rule's filter also covers; that one must win. */
  readonly priority?: number
}
```

In `ENDPOINTS`, insert before the rule 3 entry:

```ts
  // An article read by id. Rule 3's path covers it too, but that rule belongs to
  // the comment read, and sharing its id would let one request's teardown strip
  // the other's referer. The comment path goes on after the id
  // (`/articles/{id}/comments/...`), so only the query right after the id tells
  // them apart. Listed first, and above rule 3 in priority, so the article read
  // is always this rule's.
  {
    ruleId: 5,
    regexFilter: '^https://article\\.cafe\\.naver\\.com/gw/v4/cafes/[0-9]+/articles/[0-9]+\\?',
    requestDomain: 'article.cafe.naver.com',
    priority: 2,
  },
```

Replace `endpointFor` with:

```ts
/** Whether an endpoint covers an address, read the way Chrome reads the condition we hand it. */
function covers(endpoint: RefererEndpoint, parsed: URL): boolean {
  if ('regexFilter' in endpoint) return new RegExp(endpoint.regexFilter).test(parsed.href)
  return `${parsed.host}${parsed.pathname}`.startsWith(endpoint.urlFilter.slice(2))
}

/** Which endpoint an address belongs to: the first that covers it. */
function endpointFor(url: string): RefererEndpoint | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return ENDPOINTS.find((endpoint) => covers(endpoint, parsed)) ?? null
}
```

In `refererRuleFor`, change `priority: 1,` to `priority: endpoint.priority ?? 1,`, and in `condition` replace `urlFilter: endpoint.urlFilter,` with:

```ts
      ...('regexFilter' in endpoint ? { regexFilter: endpoint.regexFilter } : { urlFilter: endpoint.urlFilter }),
```

Rules 1–4 keep their `urlFilter`, ids and priority 1 exactly; `REFERER_RULE_IDS` picks up 5 by itself.

- [ ] **Step 8: Run tests, types, lint**

Run: `pnpm vitest run tests/extension && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/extension/articleReader.ts src/extension/dispatch.ts src/extension/background.ts src/extension/refererRule.ts tests/extension/articleReader.test.ts tests/extension/dispatch.test.ts tests/extension/refererRule.test.ts
git commit -m "feat: let the extension read one article by id"
```

---

### Task 5: Desktop fetcher and the read gate (sonnet)

**Files:**
- Create: `src/desktop/articleFetcher.ts`
- Modify: `src/desktop/naverReadGate.ts` (`PageRead` and `isPageRead` ~lines 6-10, the doc comment ~line 20)
- Test: `tests/desktop/articleFetcher.test.ts` (create), `tests/desktop/naverReadGate.test.ts`

**Interfaces:**
- Consumes: `CollectArticleRequest`, `TIMEOUTS.articleMs` (Task 3); `CafeArticleRead` (Task 2); `CollectionPageError`; `ExtensionTransport` from `./ws/server.js`.
- Produces:
  - `interface ArticleFetcher { read(postId: string): Promise<CafeArticleRead> }`
  - `createArticleFetcher(transport: ExtensionTransport, newRequestId: () => string): ArticleFetcher` — throws `CollectionPageError(code, 'id <postId>')` on an `ERROR` reply and `CollectionPageError('ARTICLE_UNEXPECTED_REPLY', 'id <postId>')` on any other reply.
  - The read gate serializes `COLLECT_ARTICLE` with the list and search page reads.

- [ ] **Step 1: Write the failing fetcher test**

`tests/desktop/articleFetcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createArticleFetcher } from '../../src/desktop/articleFetcher.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'

function transportAnswering(reply: (message: AppMessage) => ExtensionMessage, sent: AppMessage[]): ExtensionTransport {
  return {
    isConnected: () => true,
    request: async (message: AppMessage) => {
      sent.push(message)
      return reply(message)
    },
  } as unknown as ExtensionTransport
}

const absent = { kind: 'absent' as const, status: 404, code: '4003' }

describe('createArticleFetcher', () => {
  it('sends one article request and returns what the cafe said', async () => {
    const sent: AppMessage[] = []
    const fetcher = createArticleFetcher(transportAnswering((m) => ({ type: 'ARTICLE_COLLECTED', requestId: (m as { requestId: string }).requestId, result: absent }), sent), () => 'req-1')
    await expect(fetcher.read('728686')).resolves.toEqual(absent)
    expect(sent).toEqual([{ type: 'COLLECT_ARTICLE', requestId: 'req-1', cafeId: '14538121', postId: '728686' }])
  })

  it('turns an extension error into a page error with its code and the id', async () => {
    const fetcher = createArticleFetcher(transportAnswering(() => ({ type: 'ERROR', requestId: 'req-1', code: 'ARTICLE_HTTP_ERROR', message: 'ARTICLE_HTTP_ERROR' }), []), () => 'req-1')
    await expect(fetcher.read('728686')).rejects.toEqual(new CollectionPageError('ARTICLE_HTTP_ERROR', 'id 728686'))
  })

  it('refuses a reply meant for another request kind', async () => {
    const fetcher = createArticleFetcher(transportAnswering(() => ({ type: 'COMMENTS', requestId: 'req-1', authors: null }), []), () => 'req-1')
    await expect(fetcher.read('728686')).rejects.toEqual(new CollectionPageError('ARTICLE_UNEXPECTED_REPLY', 'id 728686'))
  })
})
```

In `tests/desktop/naverReadGate.test.ts` add, after the search case:

```ts
  it('queues a COLLECT_ARTICLE behind an in-flight COLLECT, just like the page reads', async () => {
    const { transport, sent } = deferredTransport()
    const gate = createNaverReadGate(createCollectGate(transport))

    const activeCollect = gate.request(collect('collect-1'), TIMEOUT_MS)
    await settleMicrotasks()
    const article = gate.request({ type: 'COLLECT_ARTICLE', requestId: 'article-1', cafeId: '14538121', postId: '728686' }, TIMEOUT_MS)
    await settleMicrotasks()
    expect(sent).toHaveLength(1)

    sent[0]!.settle({ type: 'COLLECTED', requestId: 'collect-1', candidates: [] })
    await activeCollect
    await settleMicrotasks()
    expect(sent).toHaveLength(2)
    expect(sent[1]!.message.type).toBe('COLLECT_ARTICLE')

    sent[1]!.settle({ type: 'ARTICLE_COLLECTED', requestId: 'article-1', result: { kind: 'absent', status: 404, code: '4003' } })
    await article
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/desktop/articleFetcher.test.ts tests/desktop/naverReadGate.test.ts`
Expected: FAIL — `articleFetcher.js` does not resolve; the gate passes the article read straight through, so `sent` has 2 entries too early.

- [ ] **Step 3: Write `src/desktop/articleFetcher.ts`**

```ts
import { CAFE_ARTICLE_LIST } from '../shared/cafeArticleFixture.js'
import type { CafeArticleRead } from '../shared/cafeArticleRead.js'
import { TIMEOUTS, type CollectArticleRequest } from '../shared/protocol.js'
import { CollectionPageError } from './collectionPageError.js'
import type { ExtensionTransport } from './ws/server.js'

export interface ArticleFetcher {
  read(postId: string): Promise<CafeArticleRead>
}

/** The id rides in the error's detail, so a failed run's stop reason says which id it stopped at. */
export function createArticleFetcher(transport: ExtensionTransport, newRequestId: () => string): ArticleFetcher {
  return {
    async read(postId) {
      const message: CollectArticleRequest = { type: 'COLLECT_ARTICLE', requestId: newRequestId(), cafeId: CAFE_ARTICLE_LIST.cafeId, postId }
      const reply = await transport.request(message, TIMEOUTS.articleMs)
      if (reply.type === 'ARTICLE_COLLECTED') return reply.result
      if (reply.type === 'ERROR') throw new CollectionPageError(reply.code, `id ${postId}`)
      throw new CollectionPageError('ARTICLE_UNEXPECTED_REPLY', `id ${postId}`)
    },
  }
}
```

- [ ] **Step 4: Queue it in `naverReadGate.ts`**

```ts
type PageRead = Extract<AppMessage, { type: 'COLLECT_BOARD_PAGE' | 'COLLECT_BOARD_SEARCH_PAGE' | 'COLLECT_ARTICLE' }>

function isPageRead(message: AppMessage): message is PageRead {
  return message.type === 'COLLECT_BOARD_PAGE' || message.type === 'COLLECT_BOARD_SEARCH_PAGE' || message.type === 'COLLECT_ARTICLE'
}
```

and in the doc comment of `createNaverReadGate` replace `list and search pages alike` with `list pages, search pages and article reads alike`.

- [ ] **Step 5: Run tests, types, lint**

Run: `pnpm vitest run tests/desktop/articleFetcher.test.ts tests/desktop/naverReadGate.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/desktop/articleFetcher.ts src/desktop/naverReadGate.ts tests/desktop/articleFetcher.test.ts tests/desktop/naverReadGate.test.ts
git commit -m "feat: read one article from the desktop through the read gate"
```

---

### Task 6: Schema and migration (sonnet)

**Files:**
- Create: `src/desktop/collection-db/articleProbeSchema.ts`
- Modify: `src/desktop/collection-db/schema.ts` (`collectionFeedKind` ~line 34)
- Modify: `drizzle.collection.config.ts` (the `schema` array)
- Generate: `drizzle-collection/0009_*.sql`, `drizzle-collection/meta/0009_snapshot.json`, `drizzle-collection/meta/_journal.json`
- Test: `tests/desktop/collection-db/schema.test.ts`, `tests/desktop/collection-db/integration.test.ts` (`COLLECTION_TABLES`, `COLLECTION_TYPES` ~lines 35-36)

**Interfaces:**
- Consumes: `collectionRuns` from `./schema.js`.
- Produces:
  - `articleProbeOutcome = pgEnum('article_probe_outcome', ['stored', 'deleted', 'unreadable', 'other_board', 'notice'])`
  - `articleProbe` table `article_probe`: `postId` (`post_id` bigint, mode number, PK), `windowFromDay` (`window_from_day` text not null), `windowToDay` (`window_to_day` text not null), `outcome` (nullable enum), `boardId` (`board_id` text), `errorCode` (`error_code` text), `probedAt` (`probed_at` timestamptz(3)), `runId` (`run_id` uuid → `runs.id`)
  - `collection_feed_kind` gains `'article_probe'`.

- [ ] **Step 1: Write the failing migration test**

In `tests/desktop/collection-db/schema.test.ts` append:

```ts
describe('article probe migration', () => {
  const sqlText = migrationNumbered('0009')

  it('adds one row per id to read, answered once', () => {
    expect(sqlText).toContain('CREATE TABLE "article_probe"')
    expect(sqlText).toContain('"post_id" bigint PRIMARY KEY NOT NULL')
    expect(sqlText).toContain(`CREATE TYPE "public"."article_probe_outcome" AS ENUM('stored', 'deleted', 'unreadable', 'other_board', 'notice')`)
    expect(sqlText).toContain('REFERENCES "public"."runs"')
    expect(sqlText).toContain('CONSTRAINT "article_probe_answered" CHECK')
  })

  it('lets a run be a probe block', () => {
    expect(sqlText).toContain("ADD VALUE 'article_probe'")
  })

  it('only adds: an operator migrates a live database by hand', () => {
    expect(sqlText).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER COLUMN/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/desktop/collection-db/schema.test.ts`
Expected: FAIL — no `0009_` file.

- [ ] **Step 3: Write `src/desktop/collection-db/articleProbeSchema.ts`**

```ts
import { sql } from 'drizzle-orm'
import { bigint, check, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { collectionRuns } from './schema.js'

const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * What reading an id answered. `stored`: a live post of a collected board, now
 * in `posts`. `other_board`: a live post of a board this app does not collect.
 * `deleted`: the cafe's 4003. `unreadable`: a refusal code the capture knows —
 * 0004, a per-board restriction of this read (937311 on board 207 answers it
 * while the list walk stores that post). `notice`: a live notice, never stored,
 * since the list walks never store one and it would be the only notice in `posts`.
 */
export const articleProbeOutcome = pgEnum('article_probe_outcome', ['stored', 'deleted', 'unreadable', 'other_board', 'notice'])

/**
 * The ids the search could not reach, one row each. Made once from the id holes
 * of the search job's window; an id answered once is never read again, since a
 * deleted post does not come back and a stored one is kept current by the walks
 * that re-read it. The id is numeric here, unlike `posts.post_id`: the walk goes
 * in id order, and as text 99999 would sort after 100000.
 */
export const articleProbe = pgTable(
  'article_probe',
  {
    postId: bigint('post_id', { mode: 'number' }).primaryKey(),
    /** KST `yyyymmdd`: the search job's window the id was drawn from; `to` is the search's own, inclusive. */
    windowFromDay: text('window_from_day').notNull(),
    windowToDay: text('window_to_day').notNull(),
    /** Null until the id is answered. */
    outcome: articleProbeOutcome('outcome'),
    /** The board the answer named; for `stored`, `other_board` and `notice` only. No reference: another board may be unknown to `boards`. */
    boardId: text('board_id'),
    /** The cafe's code for an `unreadable` id. */
    errorCode: text('error_code'),
    probedAt: observedTimestamp('probed_at'),
    runId: uuid('run_id').references(() => collectionRuns.id),
  },
  (table) => [
    check('article_probe_id', sql`${table.postId} >= 1`),
    check('article_probe_window', sql`${table.windowFromDay} <= ${table.windowToDay}`),
    check('article_probe_answered', sql`(${table.outcome} is null) = (${table.probedAt} is null) and (${table.outcome} is null) = (${table.runId} is null)`),
    check('article_probe_board', sql`case when ${table.outcome} in ('stored', 'other_board', 'notice') then ${table.boardId} is not null else ${table.boardId} is null end`),
    check('article_probe_error_code', sql`case when ${table.outcome} = 'unreadable' then ${table.errorCode} is not null else ${table.errorCode} is null end`),
  ],
)
```

- [ ] **Step 4: Add the feed kind and the schema file**

In `src/desktop/collection-db/schema.ts`:

```ts
export const collectionFeedKind = pgEnum('collection_feed_kind', ['all_articles', 'notices', 'recommended', 'board', 'board_search', 'article_probe'])
```

In `drizzle.collection.config.ts`:

```ts
  // The board search and article probe tables import from schema.ts, so they are listed here rather than re-exported there.
  schema: ['./src/desktop/collection-db/schema.ts', './src/desktop/collection-db/boardSearchSchema.ts', './src/desktop/collection-db/articleProbeSchema.ts'],
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:collection:generate`
Expected: one new `drizzle-collection/0009_<name>.sql`, `meta/0009_snapshot.json`, and a journal entry with `"idx": 9`. Read the SQL: it must contain `ALTER TYPE "public"."collection_feed_kind" ADD VALUE 'article_probe';`, `CREATE TYPE "public"."article_probe_outcome"`, `CREATE TABLE "article_probe"` with the five checks, and the `run_id` foreign key — and nothing that touches an existing column. Never hand-edit it; if it is wrong, fix the schema, delete the three generated changes by hand, and generate again.

- [ ] **Step 6: Teach the integration test the new objects**

In `tests/desktop/collection-db/integration.test.ts`:

```ts
const COLLECTION_TABLES = ['article_probe', 'board_search_state', 'member_resync_state', 'members', 'member_runs', 'member_feed_state', 'posts', 'boards', 'feed_state', 'runs']
const COLLECTION_TYPES = ['article_probe_outcome', 'collection_feed_kind', 'collection_run_kind', 'collection_run_status', 'member_run_kind']
```

- [ ] **Step 7: Run tests, types, lint, and the integration suite if its database is there**

Run: `pnpm vitest run tests/desktop/collection-db && pnpm typecheck && pnpm lint`
Expected: PASS. Then, if the test database exists, the integration command from the header: the migrations apply cleanly on an empty database.

- [ ] **Step 8: Commit**

```bash
git add src/desktop/collection-db/articleProbeSchema.ts src/desktop/collection-db/schema.ts drizzle.collection.config.ts drizzle-collection tests/desktop/collection-db/schema.test.ts tests/desktop/collection-db/integration.test.ts
git commit -m "feat: add the article probe table and feed kind"
```

---

### Task 7: The verdict for one answer (sonnet)

**Files:**
- Create: `src/desktop/articleProbeVerdict.ts`
- Test: `tests/desktop/articleProbeVerdict.test.ts`

**Interfaces:**
- Consumes: `CafeArticleRead` (Task 2); `CollectedPostMetadata`; `CollectionPageError`.
- Produces:
  - ```ts
    type ArticleProbeVerdict =
      | { readonly outcome: 'stored'; readonly boardId: string; readonly post: CollectedPostMetadata | null }
      | { readonly outcome: 'other_board'; readonly boardId: string }
      | { readonly outcome: 'notice'; readonly boardId: string }
      | { readonly outcome: 'deleted' }
      | { readonly outcome: 'unreadable'; readonly errorCode: string }
    ```
    (`post: null` means the id was already in `posts` when its turn came; nothing is written.)
  - `judgeArticleRead(postId: string, read: CafeArticleRead, collectedBoardIds: ReadonlySet<string>): ArticleProbeVerdict` — throws `CollectionPageError('ARTICLE_PROBE_UNKNOWN_ANSWER', 'id <postId> <status> <code>')` for any refusal not in the known table.

- [ ] **Step 1: Write the failing test**

`tests/desktop/articleProbeVerdict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { judgeArticleRead } from '../../src/desktop/articleProbeVerdict.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'

const COLLECTED = new Set(['137', '36'])
const post = (boardId: string): CollectedPostMetadata => ({
  cafeId: '14538121', postId: '728686', boardId, boardName: '게시판', title: '월드컵 홈플러스', prefix: null, authorId: 'key-writer', authorNickname: '글쓴이',
  postedAt: 1749029333663, viewCount: 890, commentCount: 1, replyCount: null, isNotice: false,
})

describe('judgeArticleRead', () => {
  it('stores a live post of a collected board', () => {
    expect(judgeArticleRead('728686', { kind: 'article', post: post('137'), isNotice: false }, COLLECTED)).toEqual({ outcome: 'stored', boardId: '137', post: post('137') })
  })

  it('records the board of a live post it does not collect, and stores nothing', () => {
    expect(judgeArticleRead('728686', { kind: 'article', post: post('188'), isNotice: false }, COLLECTED)).toEqual({ outcome: 'other_board', boardId: '188' })
  })

  it('records a live notice with its board and stores nothing, on any board', () => {
    expect(judgeArticleRead('728686', { kind: 'article', post: post('137'), isNotice: true }, COLLECTED)).toEqual({ outcome: 'notice', boardId: '137' })
    expect(judgeArticleRead('728686', { kind: 'article', post: post('188'), isNotice: true }, COLLECTED)).toEqual({ outcome: 'notice', boardId: '188' })
  })

  it('reads the cafe\'s two known refusals', () => {
    expect(judgeArticleRead('728686', { kind: 'absent', status: 404, code: '4003' }, COLLECTED)).toEqual({ outcome: 'deleted' })
    expect(judgeArticleRead('728686', { kind: 'absent', status: 401, code: '0004' }, COLLECTED)).toEqual({ outcome: 'unreadable', errorCode: '0004' })
  })

  it.each([
    ['an unknown code', 403, '0005'],
    ['a known code with another status', 200, '4003'],
    ['the deleted code at the login status', 401, '4003'],
  ])('does not guess at %s', (_label, status, code) => {
    expect(() => judgeArticleRead('728686', { kind: 'absent', status, code }, COLLECTED)).toThrow(
      new CollectionPageError('ARTICLE_PROBE_UNKNOWN_ANSWER', `id 728686 ${status} ${code}`),
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/desktop/articleProbeVerdict.test.ts`
Expected: FAIL — module does not resolve.

- [ ] **Step 3: Write `src/desktop/articleProbeVerdict.ts`**

```ts
import type { CollectedPostMetadata } from '../shared/cafeArticleList.js'
import type { CafeArticleRead } from '../shared/cafeArticleRead.js'
import { CollectionPageError } from './collectionPageError.js'

/** What one id turned out to be. `post` null: the id was already stored when its turn came, and nothing is written. */
export type ArticleProbeVerdict =
  | { readonly outcome: 'stored'; readonly boardId: string; readonly post: CollectedPostMetadata | null }
  | { readonly outcome: 'other_board'; readonly boardId: string }
  /** A live notice: recorded with its board, never stored — the list walks store no notice. */
  | { readonly outcome: 'notice'; readonly boardId: string }
  | { readonly outcome: 'deleted' }
  | { readonly outcome: 'unreadable'; readonly errorCode: string }

/**
 * The refusals the capture (2026-09-26) settled, each with the status it came
 * with. Nothing else is guessed at: a changed contract read as "unreadable"
 * would close thousands of ids in silence, so an answer outside this table
 * ends the block and names itself in the run's stop reason.
 */
const KNOWN_REFUSALS: ReadonlyArray<{ readonly status: number; readonly code: string; readonly outcome: 'deleted' | 'unreadable' }> = [
  { status: 404, code: '4003', outcome: 'deleted' },
  // Answered to a signed-in account too: a board above its level.
  { status: 401, code: '0004', outcome: 'unreadable' },
]

export function judgeArticleRead(postId: string, read: CafeArticleRead, collectedBoardIds: ReadonlySet<string>): ArticleProbeVerdict {
  if (read.kind === 'article') {
    const { post } = read
    // Before the board: a notice is not stored whichever board it is on.
    if (read.isNotice) return { outcome: 'notice', boardId: post.boardId }
    return collectedBoardIds.has(post.boardId) ? { outcome: 'stored', boardId: post.boardId, post } : { outcome: 'other_board', boardId: post.boardId }
  }
  const known = KNOWN_REFUSALS.find((refusal) => refusal.status === read.status && refusal.code === read.code)
  if (known === undefined) throw new CollectionPageError('ARTICLE_PROBE_UNKNOWN_ANSWER', `id ${postId} ${read.status} ${read.code}`)
  return known.outcome === 'deleted' ? { outcome: 'deleted' } : { outcome: 'unreadable', errorCode: read.code }
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm vitest run tests/desktop/articleProbeVerdict.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/articleProbeVerdict.ts tests/desktop/articleProbeVerdict.test.ts
git commit -m "feat: judge what one article read answered"
```

---

### Task 8: Article probe repository (opus)

**Files:**
- Create: `src/desktop/collection-db/articleProbeRepository.ts`
- Modify: `src/desktop/collection-db/statusQuery.ts` (import ~line 1, the `.where(ne(...'board_search'))` ~line 177 and its comment)
- Test: `tests/desktop/collection-db/integration.test.ts` (three new cases at the end of the `integration(...)` describe)

**Interfaces:**
- Consumes: `articleProbe`, `articleProbeOutcome` (Task 6); `ArticleProbeVerdict` (Task 7); `writePostRows` from `./postPageWrite.js`; `CollectionRepository.recordPageRequest`; `boards`, `collectionRuns`, `posts` from `./schema.js`; `kstDayKeyRange`; `CAFE_ARTICLE_LIST`.
- Produces (`src/desktop/collection-db/articleProbeRepository.ts`):
  ```ts
  export interface ArticleProbeJob {
    readonly fromDay: string        // KST yyyymmdd, the search job's from_day
    readonly toDay: string          // KST yyyymmdd, the search job's to_day; ids come from posts before its 00:00
    readonly total: number
    readonly probed: number
    readonly stored: number
    readonly deleted: number
    readonly unreadable: number
    readonly otherBoard: number
    readonly notice: number
  }
  export interface ArticleProbeLastRun { readonly status: RunStatus; readonly stopReason: string | null; readonly startedAtMs: number }
  export interface CreateArticleProbeJobInput { readonly fromDay: string; readonly toDay: string }
  export interface ArticleProbeRunInput { readonly id: string; readonly fromDay: string; readonly toDay: string; readonly startedAt: Date }
  export interface RecordArticleVerdictInput { readonly runId: string; readonly postId: string; readonly observedAt: Date; readonly verdict: ArticleProbeVerdict; readonly requested: boolean }
  export interface ArticleProbeRepository {
    readJob(): Promise<ArticleProbeJob | null>
    createJob(input: CreateArticleProbeJobInput): Promise<number>
    listCollectedBoardIds(): Promise<readonly string[]>
    nextWaitingId(): Promise<string | null>
    storedBoardOf(postId: string): Promise<string | null>
    startRun(input: ArticleProbeRunInput): Promise<void>
    recordPageRequest(runId: string): Promise<void>
    recordVerdict(input: RecordArticleVerdictInput): Promise<void>
    finishRun(runId: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
    reconcileOrphanedRuns(finishedAt: Date): Promise<number>
    readLastRun(): Promise<ArticleProbeLastRun | null>
  }
  export function createArticleProbeRepository(db: CollectionDatabase, collection: CollectionRepository): ArticleProbeRepository
  ```
  `RunStatus` is `(typeof collectionRuns.$inferSelect)['status']`, as in `boardSearchLastRunQuery.ts`.
- A probe run row: `feed_kind 'article_probe'`, `menu_id '0'`, `run_kind 'backfill'`, `target_start_ms` = `from_day` 00:00 KST, `target_end_ms` = `to_day` 00:00 KST; `request_pages` = requests, `collection_pages` = ids answered by a request, `inserted/updated/observed_post_count` from the stored posts, `last_committed_post_id` = the last id answered by a request.

- [ ] **Step 1: Write the failing integration cases**

Add `import { createArticleProbeRepository } from '../../../src/desktop/collection-db/articleProbeRepository.js'` to `tests/desktop/collection-db/integration.test.ts` and append at the end of the `integration(...)` describe (after the narrowing case — every earlier case has finished its runs, and these posts sit in 2019, outside every earlier window):

```ts
  /** A board and posts of their own: ids 5000001, 5000003 and 5000009 in March 2019 KST, 5000010 in April. */
  async function seedProbeWindow(): Promise<void> {
    const at = new Date('2026-09-26T00:00:00.000Z')
    await pool.query(`insert into boards (board_id, name, first_seen_at, last_seen_at) values ('probe-1', '확인 게시판', $1, $1), ('probe-off', '안 모으는 게시판', $1, $1) on conflict do nothing`, [at])
    await pool.query(`update boards set collect_enabled = false where board_id = 'probe-off'`)
    for (const [id, postedAt] of [['5000001', '2019-03-02T12:00:00+09:00'], ['5000003', '2019-03-10T12:00:00+09:00'], ['5000009', '2019-03-31T23:59:00+09:00'], ['5000010', '2019-04-01T00:00:00+09:00']] as const) {
      await pool.query(
        `insert into posts (post_id, board_id, posted_at, snapshot_at, first_seen_at) values ($1, 'probe-1', $2, $3, $3)`,
        [id, new Date(postedAt), at],
      )
    }
  }

  const probedPost = (postId: string) => ({
    cafeId: '14538121', postId, boardId: 'probe-1', boardName: '확인 게시판', title: '월드컵 홈플러스', prefix: null,
    authorId: 'key-writer', authorNickname: '글쓴이', postedAt: Date.UTC(2019, 2, 10, 3), viewCount: 890, commentCount: 1,
    replyCount: null, isNotice: false as const,
  })

  it('makes the probe job once, from the id holes between the window\'s first and last stored post', async () => {
    await seedProbeWindow()
    const probe = createArticleProbeRepository(connection.db, createCollectionRepository(connection.db))
    expect(await probe.readJob()).toBeNull()

    // [2019-03-01, 2019-04-01) KST holds 5000001..5000009: the holes are 2, 4, 5, 6, 7, 8. 5000010 is after the window.
    expect(await probe.createJob({ fromDay: '20190301', toDay: '20190401' })).toBe(6)
    expect(await probe.readJob()).toEqual({ fromDay: '20190301', toDay: '20190401', total: 6, probed: 0, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 })
    expect(await probe.nextWaitingId()).toBe('5000002')
    // Answered ids are never read again, so a second job is refused rather than made over them.
    await expect(probe.createJob({ fromDay: '20190301', toDay: '20190401' })).rejects.toThrow()
    expect(await probe.listCollectedBoardIds()).toContain('probe-1')
    expect(await probe.listCollectedBoardIds()).not.toContain('probe-off')
  })

  it('records each verdict once, in id order, writing a stored post with it and counting only requested ids', async () => {
    const probe = createArticleProbeRepository(connection.db, createCollectionRepository(connection.db))
    const at = new Date('2026-09-26T08:00:00.000Z')
    const runId = randomUUID()
    await probe.startRun({ id: runId, fromDay: '20190301', toDay: '20190401', startedAt: at })

    await probe.recordPageRequest(runId)
    await probe.recordVerdict({ runId, postId: '5000002', observedAt: at, requested: true, verdict: { outcome: 'stored', boardId: 'probe-1', post: probedPost('5000002') } })
    expect(await probe.nextWaitingId()).toBe('5000004')

    // Another walk stored 5000004 meanwhile: it is closed as stored without a request.
    await pool.query(`insert into posts (post_id, board_id, posted_at, snapshot_at, first_seen_at) values ('5000004', 'probe-1', $1, $1, $1)`, [new Date('2019-03-11T00:00:00+09:00')])
    expect(await probe.storedBoardOf('5000004')).toBe('probe-1')
    expect(await probe.storedBoardOf('5000005')).toBeNull()
    await probe.recordVerdict({ runId, postId: '5000004', observedAt: at, requested: false, verdict: { outcome: 'stored', boardId: 'probe-1', post: null } })

    for (const [postId, verdict] of [
      ['5000005', { outcome: 'deleted' }],
      ['5000006', { outcome: 'unreadable', errorCode: '0004' }],
      ['5000007', { outcome: 'other_board', boardId: '999' }],
      ['5000008', { outcome: 'notice', boardId: 'probe-1' }],
    ] as const) {
      await probe.recordPageRequest(runId)
      await probe.recordVerdict({ runId, postId, observedAt: at, requested: true, verdict })
    }
    expect(await probe.nextWaitingId()).toBeNull()
    await expect(probe.recordVerdict({ runId, postId: '5000005', observedAt: at, requested: true, verdict: { outcome: 'deleted' } })).rejects.toThrow('not waiting')
    await probe.finishRun(runId, 'succeeded', null, at)

    expect(await probe.readJob()).toEqual({ fromDay: '20190301', toDay: '20190401', total: 6, probed: 6, stored: 2, deleted: 1, unreadable: 1, otherBoard: 1, notice: 1 })
    const rows = await pool.query<{ post_id: string; outcome: string; board_id: string | null; error_code: string | null; run_id: string }>(
      'select post_id::text, outcome, board_id, error_code, run_id from article_probe order by post_id',
    )
    expect(rows.rows.map((row) => [row.post_id, row.outcome, row.board_id, row.error_code, row.run_id === runId])).toEqual([
      ['5000002', 'stored', 'probe-1', null, true],
      ['5000004', 'stored', 'probe-1', null, true],
      ['5000005', 'deleted', null, null, true],
      ['5000006', 'unreadable', null, '0004', true],
      ['5000007', 'other_board', '999', null, true],
      ['5000008', 'notice', 'probe-1', null, true],
    ])
    // A notice is recorded, never stored.
    expect((await pool.query(`select 1 from posts where post_id = '5000008'`)).rows).toEqual([])
    const stored = await pool.query<{ title: string; last_run_id: string }>(`select title, last_run_id from posts where post_id = '5000002'`)
    expect(stored.rows[0]).toEqual({ title: '월드컵 홈플러스', last_run_id: runId })
    const run = await pool.query(
      'select feed_kind, menu_id, status, request_pages, collection_pages, inserted_post_count, observed_post_count, last_committed_post_id, target_start_ms::text, target_end_ms::text from runs where id = $1', [runId],
    )
    expect(run.rows[0]).toEqual({
      feed_kind: 'article_probe', menu_id: '0', status: 'succeeded', request_pages: 5, collection_pages: 5, inserted_post_count: 1, observed_post_count: 1,
      last_committed_post_id: '5000008', target_start_ms: String(Date.UTC(2019, 1, 28, 15)), target_end_ms: String(Date.UTC(2019, 2, 31, 15)),
    })
  })

  it('keeps probe runs off the article collection status, and sweeps only its own orphans', async () => {
    const probe = createArticleProbeRepository(connection.db, createCollectionRepository(connection.db))
    const status = createCollectionStatusQuery(connection.db)
    const orphan = randomUUID()
    await probe.startRun({ id: orphan, fromDay: '20190301', toDay: '20190401', startedAt: new Date('2026-09-27T00:00:00.000Z') })
    const listRun = randomUUID()
    await pool.query(
      `insert into runs (id, feed_kind, menu_id, run_kind, target_start_ms, target_end_ms, status, started_at)
       values ($1, 'board', 'probe-sweep-test', 'backfill', 0, 1, 'running', $2)`,
      [listRun, new Date('2026-09-27T00:00:00.000Z')],
    )

    const read = await status.read()
    // Newer than every other run here, so it would head the list if it were read.
    expect(read.recentRuns.map((run) => run.id)).not.toContain(orphan)
    expect(read.recentRuns[0]?.id).toBe(listRun)

    expect(await probe.reconcileOrphanedRuns(new Date('2026-09-27T00:10:00.000Z'))).toBe(1)
    const rows = await pool.query<{ id: string; status: string }>('select id, status from runs where id = any($1::uuid[])', [[orphan, listRun]])
    expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.status]))).toEqual({ [orphan]: 'interrupted', [listRun]: 'running' })
    expect(await probe.readLastRun()).toEqual({ status: 'interrupted', stopReason: 'ORPHANED_RUNNING_RUN', startedAtMs: Date.parse('2026-09-27T00:00:00.000Z') })
    await pool.query("update runs set status = 'interrupted', finished_at = $2 where id = $1", [listRun, new Date('2026-09-27T00:10:00.000Z')])
  })
```

- [ ] **Step 2: Run to verify they fail**

Run the integration command from the header.
Expected: FAIL — `articleProbeRepository.js` does not resolve. (Without the test database the file is skipped; `pnpm typecheck` then fails on the missing module, which is the red step.)

- [ ] **Step 3: Write `src/desktop/collection-db/articleProbeRepository.ts`**

```ts
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { CAFE_ARTICLE_LIST } from '../../shared/cafeArticleFixture.js'
import { kstDayKeyRange } from '../../shared/kst.js'
import type { ArticleProbeVerdict } from '../articleProbeVerdict.js'
import { articleProbe } from './articleProbeSchema.js'
import type { CollectionDatabase } from './client.js'
import { writePostRows } from './postPageWrite.js'
import type { CollectionRepository } from './repository.js'
import { boards, collectionRuns, posts } from './schema.js'

type RunStatus = (typeof collectionRuns.$inferSelect)['status']

/** The job in hand: its window and how its ids were answered. */
export interface ArticleProbeJob {
  /** KST `yyyymmdd`: the search job's window, as it was when the job was made. */
  readonly fromDay: string
  /** KST `yyyymmdd`, the search's own inclusive end; the ids come from posts before this day's 00:00. */
  readonly toDay: string
  readonly total: number
  readonly probed: number
  readonly stored: number
  readonly deleted: number
  readonly unreadable: number
  readonly otherBoard: number
  readonly notice: number
}

export interface ArticleProbeLastRun {
  readonly status: RunStatus
  readonly stopReason: string | null
  readonly startedAtMs: number
}

export interface CreateArticleProbeJobInput {
  readonly fromDay: string
  readonly toDay: string
}

export interface ArticleProbeRunInput {
  readonly id: string
  readonly fromDay: string
  readonly toDay: string
  readonly startedAt: Date
}

export interface RecordArticleVerdictInput {
  readonly runId: string
  readonly postId: string
  readonly observedAt: Date
  readonly verdict: ArticleProbeVerdict
  /** Whether a request answered it. An id found already stored costs none and is not counted as read. */
  readonly requested: boolean
}

export interface ArticleProbeRepository {
  readJob(): Promise<ArticleProbeJob | null>
  /**
   * Puts every id missing between the first and last post stored in the window
   * into the job, and says how many. Refused while a job exists: its answered
   * ids must not be read again.
   */
  createJob(input: CreateArticleProbeJobInput): Promise<number>
  /** The boards whose live posts are stored; the rest are recorded as another board's. */
  listCollectedBoardIds(): Promise<readonly string[]>
  /** The smallest id not yet answered; null when every id is. */
  nextWaitingId(): Promise<string | null>
  /** The board of the stored post with this id; null when none is stored. */
  storedBoardOf(postId: string): Promise<string | null>
  startRun(input: ArticleProbeRunInput): Promise<void>
  recordPageRequest(runId: string): Promise<void>
  /** Answers one waiting id, and writes its post with it when it is one to store. */
  recordVerdict(input: RecordArticleVerdictInput): Promise<void>
  finishRun(runId: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  /**
   * Marks probe runs left `running` as interrupted, as the startup sweep does
   * for every feed. Only for a caller holding the collection lock: then no
   * probe run is being written, and a running one is one nothing will close.
   */
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
  /** The newest probe run: probe runs stay off the recent log, so the card reads it here. */
  readLastRun(): Promise<ArticleProbeLastRun | null>
}

const NOTHING_WRITTEN = { insertedPostCount: 0, updatedPostCount: 0 } as const

function boardOf(verdict: ArticleProbeVerdict): string | null {
  return verdict.outcome === 'stored' || verdict.outcome === 'other_board' || verdict.outcome === 'notice' ? verdict.boardId : null
}

export function createArticleProbeRepository(db: CollectionDatabase, collection: CollectionRepository): ArticleProbeRepository {
  return {
    async readJob() {
      const rows = await db
        .select({
          fromDay: articleProbe.windowFromDay,
          toDay: articleProbe.windowToDay,
          total: sql<string>`count(*)`,
          probed: sql<string>`count(${articleProbe.outcome})`,
          stored: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'stored')`,
          deleted: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'deleted')`,
          unreadable: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'unreadable')`,
          otherBoard: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'other_board')`,
          notice: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'notice')`,
        })
        .from(articleProbe)
        .groupBy(articleProbe.windowFromDay, articleProbe.windowToDay)
      const row = rows[0]
      if (row === undefined) return null
      return {
        fromDay: row.fromDay,
        toDay: row.toDay,
        total: Number(row.total),
        probed: Number(row.probed),
        stored: Number(row.stored),
        deleted: Number(row.deleted),
        unreadable: Number(row.unreadable),
        otherBoard: Number(row.otherBoard),
        notice: Number(row.notice),
      }
    },

    async createJob(input) {
      const startAt = new Date(kstDayKeyRange(input.fromDay).startMs)
      const endAt = new Date(kstDayKeyRange(input.toDay).startMs)
      return await db.transaction(async (tx) => {
        const existing = await tx.select({ postId: articleProbe.postId }).from(articleProbe).limit(1)
        if (existing.length > 0) throw new Error('an article probe job exists; its answered ids are never read again')
        // Each stored post and the next one up bound a hole; the holes of the
        // stretch between the window's first and last stored post are the job.
        // Walking the stored ids once with lead() takes a fraction of a second
        // where asking about every id of the span one by one took minutes.
        const inserted = await tx.execute(sql`
          insert into ${articleProbe} (post_id, window_from_day, window_to_day)
          select missing.id, ${input.fromDay}, ${input.toDay}
          from (
            select ${posts.postId}::bigint as id, lead(${posts.postId}::bigint) over (order by ${posts.postId}::bigint) as next_id
            from ${posts}
            where ${posts.postId}::bigint between
              (select min(${posts.postId}::bigint) from ${posts} where ${posts.postedAt} >= ${startAt} and ${posts.postedAt} < ${endAt})
              and (select max(${posts.postId}::bigint) from ${posts} where ${posts.postedAt} >= ${startAt} and ${posts.postedAt} < ${endAt})
          ) as stored
          cross join lateral generate_series(stored.id + 1, stored.next_id - 1) as missing(id)
          where stored.next_id > stored.id + 1`)
        return inserted.rowCount ?? 0
      })
    },

    async listCollectedBoardIds() {
      const rows = await db.select({ boardId: boards.boardId }).from(boards).where(eq(boards.collectEnabled, true))
      return rows.map((row) => row.boardId)
    },

    async nextWaitingId() {
      const rows = await db.select({ postId: articleProbe.postId }).from(articleProbe).where(isNull(articleProbe.outcome)).orderBy(asc(articleProbe.postId)).limit(1)
      const row = rows[0]
      return row === undefined ? null : String(row.postId)
    },

    async storedBoardOf(postId) {
      const rows = await db.select({ boardId: posts.boardId }).from(posts).where(eq(posts.postId, postId)).limit(1)
      return rows[0]?.boardId ?? null
    },

    async startRun(input) {
      await db.insert(collectionRuns).values({
        id: input.id,
        feedKind: 'article_probe',
        menuId: CAFE_ARTICLE_LIST.menuId,
        runKind: 'backfill',
        targetStartMs: kstDayKeyRange(input.fromDay).startMs,
        targetEndMs: kstDayKeyRange(input.toDay).startMs,
        status: 'running',
        startedAt: input.startedAt,
      })
    },

    recordPageRequest(runId) {
      return collection.recordPageRequest(runId, 'collection')
    },

    async recordVerdict(input) {
      const { verdict } = input
      await db.transaction(async (tx) => {
        const written = verdict.outcome === 'stored' && verdict.post !== null
          ? await writePostRows(tx, [verdict.post], input.observedAt, input.runId)
          : NOTHING_WRITTEN
        const answered = await tx
          .update(articleProbe)
          .set({
            outcome: verdict.outcome,
            boardId: boardOf(verdict),
            errorCode: verdict.outcome === 'unreadable' ? verdict.errorCode : null,
            probedAt: input.observedAt,
            runId: input.runId,
          })
          .where(and(eq(articleProbe.postId, Number(input.postId)), isNull(articleProbe.outcome)))
          .returning({ postId: articleProbe.postId })
        if (answered.length !== 1) throw new Error('article probe id is not waiting for an answer')
        if (!input.requested) return
        const run = await tx
          .update(collectionRuns)
          .set({
            collectionPages: sql`${collectionRuns.collectionPages} + 1`,
            observedPostCount: sql`${collectionRuns.observedPostCount} + ${written.insertedPostCount + written.updatedPostCount}`,
            insertedPostCount: sql`${collectionRuns.insertedPostCount} + ${written.insertedPostCount}`,
            updatedPostCount: sql`${collectionRuns.updatedPostCount} + ${written.updatedPostCount}`,
            lastCommittedPostId: input.postId,
          })
          .where(eq(collectionRuns.id, input.runId))
          .returning({ id: collectionRuns.id })
        if (run.length !== 1) throw new Error('article probe run does not exist')
      })
    },

    async finishRun(runId, status, stopReason, finishedAt) {
      const updated = await db
        .update(collectionRuns)
        .set({ status, stopReason, finishedAt })
        .where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, 'running')))
        .returning({ id: collectionRuns.id })
      if (updated.length !== 1) throw new Error('article probe run is not running')
    },

    async reconcileOrphanedRuns(finishedAt) {
      const repaired = await db
        .update(collectionRuns)
        .set({ status: 'interrupted', stopReason: 'ORPHANED_RUNNING_RUN', finishedAt })
        .where(and(eq(collectionRuns.feedKind, 'article_probe'), eq(collectionRuns.status, 'running')))
        .returning({ id: collectionRuns.id })
      return repaired.length
    },

    async readLastRun() {
      const rows = await db
        .select({ status: collectionRuns.status, stopReason: collectionRuns.stopReason, startedAt: collectionRuns.startedAt })
        .from(collectionRuns)
        .where(eq(collectionRuns.feedKind, 'article_probe'))
        .orderBy(desc(collectionRuns.startedAt))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : { status: row.status, stopReason: row.stopReason, startedAtMs: row.startedAt.getTime() }
    },
  }
}
```

- [ ] **Step 4: Keep probe runs off the recent log**

In `src/desktop/collection-db/statusQuery.ts` replace `ne` with `notInArray` in the drizzle import (if `ne` is used nowhere else — let `pnpm lint` decide), and replace

```ts
          // A search run walks one query, not a period of the list: shown here it
          // would read as a whole-cafe run and push the list walk's blocks off.
          .where(ne(collectionRuns.feedKind, 'board_search'))
```

with

```ts
          // A search run walks one query and a probe run a list of ids, not a
          // period of the list: shown here either would read as a whole-cafe
          // run and push the list walk's blocks off. Their cards show them.
          .where(notInArray(collectionRuns.feedKind, ['board_search', 'article_probe']))
```

- [ ] **Step 5: Run the integration suite, unit tests, types, lint**

Run: the integration command, then `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS, including the existing `keeps board search runs off the article collection status`.

- [ ] **Step 6: Check the job query against the real data, read-only**

Run (read-only; the window is the search job's):

```bash
psql "postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection" -At -c "\timing on" -c "
select count(*) from (
  select post_id::bigint as id, lead(post_id::bigint) over (order by post_id::bigint) as next_id
  from posts
  where post_id::bigint between
    (select min(post_id::bigint) from posts where posted_at >= timestamptz '2025-01-01 00:00+09' and posted_at < timestamptz '2025-08-29 00:00+09')
    and (select max(post_id::bigint) from posts where posted_at >= timestamptz '2025-01-01 00:00+09' and posted_at < timestamptz '2025-08-29 00:00+09')
) as stored
cross join lateral generate_series(stored.id + 1, stored.next_id - 1) as missing(id)
where stored.next_id > stored.id + 1"
```

Expected: about 9,660 (fewer if walks stored more since 2026-09-26) in well under a second. This is a `select`; never run the `insert` against this database.

- [ ] **Step 7: Commit**

```bash
git add src/desktop/collection-db/articleProbeRepository.ts src/desktop/collection-db/statusQuery.ts tests/desktop/collection-db/integration.test.ts
git commit -m "feat: keep the article probe job and its runs in the collection DB"
```

---

### Task 9: The runner (opus)

**Files:**
- Create: `src/desktop/articleProbeRunner.ts`
- Test: `tests/desktop/articleProbeRunner.test.ts`

**Interfaces:**
- Consumes: `ArticleProbeRepository`, `ArticleProbeJob` (Task 8); `ArticleFetcher` (Task 5); `judgeArticleRead` (Task 7); `CollectionLock`; `CollectionClock` from `./collectionOrchestrator.js`; `Random` from `../shared/ports.js`; `CollectionPacing`, `collectionDelayMs`; `pauseUnlessStopped`; `CollectionPageError`; `CollectionStartResult`; `failedRunStopReason`, `FailedRunStopReason`.
- Produces:
  ```ts
  export interface ArticleProbeRunnerDeps {
    readonly repository: () => ArticleProbeRepository | null
    readonly fetcher: ArticleFetcher
    readonly isConnected: () => boolean
    readonly clock: CollectionClock
    readonly random: Random
    readonly pacing: () => CollectionPacing
    readonly sleep: (ms: number) => Promise<void>
    readonly isSessionBusy: () => boolean
    readonly lock: CollectionLock
    readonly newId: () => string
    readonly onError?: (error: unknown) => void
  }
  export interface ArticleProbeProgress { readonly requested: number; readonly maxPages: number }
  export interface ArticleProbeBlockFailure extends FailedRunStopReason { readonly atMs: number }
  export interface ArticleProbeRunner {
    start(request: { readonly maxPages: number }): CollectionStartResult
    stop(): void
    isRunning(): boolean
    progress(): ArticleProbeProgress | null
    blockFailure(): ArticleProbeBlockFailure | null
  }
  export function createArticleProbeRunner(deps: ArticleProbeRunnerDeps): ArticleProbeRunner
  ```

The block (spec §3): sweep this feed's orphaned runs; read the job (none, or none waiting → no run); start one run; then, per waiting id in ascending order: an id already in `posts` is closed as `stored` with no request and no budget; otherwise wait its turn (session yield, pacing, stop), count the request, read, judge, record. The budget counts requests. Every failure ends the block with the id unjudged — there is no per-id failure to move past, since an id's failure would meet the next id the same way. A stop is `interrupted ABORTED`, a spent budget `partial PAGE_BUDGET_SPENT`, the last id answered `succeeded`.

- [ ] **Step 1: Write the failing test**

`tests/desktop/articleProbeRunner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createArticleProbeRunner } from '../../src/desktop/articleProbeRunner.js'
import type { ArticleFetcher } from '../../src/desktop/articleFetcher.js'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { ArticleProbeRepository } from '../../src/desktop/collection-db/articleProbeRepository.js'
import type { CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'
import type { CafeArticleRead } from '../../src/shared/cafeArticleRead.js'
import type { CollectionPacing } from '../../src/shared/collectionPacing.js'

const NO_WAIT: CollectionPacing = {
  perPage: { minSeconds: 0, maxSeconds: 0 },
  everyTwentyPages: { minSeconds: 0, maxSeconds: 0 },
  everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
}

const live = (postId: string, boardId: string, isNotice = false): CafeArticleRead => ({
  kind: 'article',
  isNotice,
  post: {
    cafeId: '14538121', postId, boardId, boardName: '게시판', title: 't', prefix: null, authorId: null, authorNickname: null,
    postedAt: Date.UTC(2025, 5, 4), viewCount: 0, commentCount: 0, replyCount: null, isNotice: false,
  } satisfies CollectedPostMetadata,
})
const DELETED: CafeArticleRead = { kind: 'absent', status: 404, code: '4003' }
const LOGIN: CafeArticleRead = { kind: 'absent', status: 401, code: '0004' }

function harness(
  ids: string[],
  answers: Record<string, CafeArticleRead | string>,
  setup: {
    readonly storage?: boolean
    readonly connected?: boolean
    /** Ids another walk stored before their turn, with their board. */
    readonly storedBefore?: Record<string, string>
    readonly noJob?: boolean
    readonly startRejects?: boolean
    readonly sweepRejects?: boolean
    readonly failedFinishRejects?: boolean
    readonly onRead?: (postId: string) => void
  } = {},
) {
  const events: string[] = []
  const errors: string[] = []
  const sweeps: number[] = []
  const waiting = [...ids]
  const repository: ArticleProbeRepository = {
    readJob: async () => (setup.noJob === true ? null : { fromDay: '20250101', toDay: '20250829', total: ids.length, probed: ids.length - waiting.length, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 }),
    createJob: async () => 0,
    listCollectedBoardIds: async () => ['137'],
    nextWaitingId: async () => waiting[0] ?? null,
    storedBoardOf: async (postId) => setup.storedBefore?.[postId] ?? null,
    reconcileOrphanedRuns: async () => {
      if (setup.sweepRejects === true) throw new Error('database went away')
      sweeps.push(events.length)
      return 0
    },
    startRun: async (input) => {
      if (setup.startRejects === true) throw new Error('duplicate key value violates unique constraint "runs_one_running_feed"')
      events.push(`start ${input.fromDay}-${input.toDay}`)
    },
    recordPageRequest: async () => undefined,
    recordVerdict: async (input) => {
      waiting.splice(waiting.indexOf(input.postId), 1)
      events.push(`${input.postId} ${input.verdict.outcome}${input.requested ? '' : ' (no request)'}`)
    },
    finishRun: async (_id, status, reason) => {
      events.push(`finish ${status}${reason === null ? '' : ' ' + reason}`)
      if (status === 'failed' && setup.failedFinishRejects === true) throw new Error('database went away')
    },
    readLastRun: async () => null,
  }
  const fetcher: ArticleFetcher = {
    read: async (postId) => {
      events.push(`read ${postId}`)
      setup.onRead?.(postId)
      const answer = answers[postId]
      if (typeof answer === 'string') throw new CollectionPageError(answer, `id ${postId}`)
      if (answer === undefined) throw new Error(`no answer for ${postId}`)
      return answer
    },
  }
  let id = 0
  const runner = createArticleProbeRunner({
    repository: () => (setup.storage === false ? null : repository), fetcher, isConnected: () => setup.connected !== false, clock: { now: () => 0 }, random: { intInclusive: (min: number) => min },
    pacing: () => NO_WAIT, sleep: async () => undefined, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => `run-${++id}`,
    onError: (error) => { errors.push(error instanceof Error ? error.message : String(error)) },
  })
  const settle = async () => { while (runner.isRunning()) await new Promise((resolve) => setTimeout(resolve, 0)) }
  return { runner, events, errors, sweeps, settle }
}

describe('articleProbeRunner', () => {
  it('reads each waiting id in order and records what the cafe said', async () => {
    const h = harness(['2', '3', '4', '5', '6'], { 2: live('2', '137'), 3: DELETED, 4: LOGIN, 5: live('5', '188'), 6: live('6', '137', true) })
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'started' })
    await h.settle()
    expect(h.events).toEqual([
      'start 20250101-20250829',
      'read 2', '2 stored', 'read 3', '3 deleted', 'read 4', '4 unreadable', 'read 5', '5 other_board', 'read 6', '6 notice',
      'finish succeeded',
    ])
  })

  it('closes an id another walk stored meanwhile without a request, and without spending the budget', async () => {
    const h = harness(['2', '3'], { 3: DELETED }, { storedBefore: { 2: '137' } })
    h.runner.start({ maxPages: 1 })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', '2 stored (no request)', 'read 3', '3 deleted', 'finish succeeded'])
  })

  it('stops where the budget runs out and leaves the rest waiting', async () => {
    const h = harness(['2', '3', '4'], { 2: DELETED, 3: DELETED, 4: DELETED })
    h.runner.start({ maxPages: 2 })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', 'read 2', '2 deleted', 'read 3', '3 deleted', 'finish partial PAGE_BUDGET_SPENT'])
  })

  it('ends the block at an answer it does not know, leaving that id waiting', async () => {
    const h = harness(['2', '3'], { 2: { kind: 'absent', status: 500, code: '9999' }, 3: DELETED })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', 'read 2', 'finish failed ARTICLE_PROBE_UNKNOWN_ANSWER: id 2 500 9999'])
  })

  it('ends the block at a read the extension could not make, leaving that id waiting', async () => {
    const h = harness(['2', '3'], { 2: 'ARTICLE_HTTP_ERROR', 3: DELETED })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', 'read 2', 'finish failed ARTICLE_HTTP_ERROR: id 2'])
    expect(h.runner.blockFailure()).toBeNull()
  })

  it('ends the block at a stop, keeping the id read before it', async () => {
    let stop = (): void => undefined
    const h = harness(['2', '3'], { 2: DELETED, 3: DELETED }, { onRead: (postId) => { if (postId === '2') stop() } })
    stop = () => h.runner.stop()
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', 'read 2', '2 deleted', 'finish interrupted ABORTED'])
  })

  it('starts no run without a job, or with every id answered', async () => {
    const none = harness([], {}, { noJob: true })
    none.runner.start({ maxPages: 10 })
    await none.settle()
    expect(none.events).toEqual([])
    const done = harness([], {})
    done.runner.start({ maxPages: 10 })
    await done.settle()
    expect(done.events).toEqual([])
  })

  it('refuses a second start, a start without storage and a start with the extension away', async () => {
    const h = harness(['2'], { 2: DELETED })
    h.runner.start({ maxPages: 10 })
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })
    await h.settle()
    expect(harness(['2'], {}, { storage: false }).runner.start({ maxPages: 10 })).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
    expect(harness(['2'], {}, { connected: false }).runner.start({ maxPages: 10 })).toEqual({ kind: 'refused', reason: 'BRIDGE_OFFLINE' })
  })

  it('closes probe runs left running before it starts its own, once per block', async () => {
    const h = harness(['2'], { 2: DELETED })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.sweeps).toEqual([0])
    expect(h.events[0]).toBe('start 20250101-20250829')
  })

  it('shows the requests this block has made of its budget, and nothing between blocks', async () => {
    const seen: string[] = []
    let look = (): void => undefined
    const h = harness(['2', '3'], { 2: DELETED, 3: DELETED }, { onRead: () => look() })
    look = () => {
      const progress = h.runner.progress()
      seen.push(progress === null ? 'none' : `${progress.requested}/${progress.maxPages}`)
    }
    expect(h.runner.progress()).toBeNull()
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(seen).toEqual(['1/10', '2/10'])
    expect(h.runner.progress()).toBeNull()
  })

  describe('a block that fails with no run row to say why', () => {
    it('keeps the failure when its run cannot be started', async () => {
      const h = harness(['2'], { 2: DELETED }, { startRejects: true })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.events).toEqual([])
      expect(h.runner.blockFailure()).toEqual({
        code: 'COLLECTION_FAILURE',
        stopReason: 'COLLECTION_FAILURE: Error: duplicate key value violates unique constraint "runs_one_running_feed"',
        atMs: 0,
      })
    })

    it('keeps the failure, and still reports it, when the walk itself throws', async () => {
      const h = harness(['2'], {}, { sweepRejects: true })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.runner.blockFailure()).toEqual({ code: 'COLLECTION_FAILURE', stopReason: 'COLLECTION_FAILURE: Error: database went away', atMs: 0 })
      expect(h.errors).toEqual(['database went away'])
    })

    it('forgets it when the next block starts', async () => {
      const h = harness(['2'], {}, { startRejects: true })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.runner.blockFailure()).not.toBeNull()
      h.runner.start({ maxPages: 10 })
      expect(h.runner.blockFailure()).toBeNull()
      await h.settle()
    })
  })

  it('reports a failed run it could not close, and frees the lock after', async () => {
    const h = harness(['2'], { 2: 'ARTICLE_HTTP_ERROR' }, { failedFinishRejects: true })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.errors).toEqual(['database went away'])
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'started' })
    await h.settle()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/desktop/articleProbeRunner.test.ts`
Expected: FAIL — module does not resolve.

- [ ] **Step 3: Write `src/desktop/articleProbeRunner.ts`**

```ts
import type { CollectionPacing } from '../shared/collectionPacing.js'
import { collectionDelayMs } from '../shared/collectionPacing.js'
import type { Random } from '../shared/ports.js'
import type { ArticleFetcher } from './articleFetcher.js'
import { judgeArticleRead } from './articleProbeVerdict.js'
import type { ArticleProbeJob, ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import type { CollectionLock } from './collectionLock.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import { CollectionPageError } from './collectionPageError.js'
import { pauseUnlessStopped } from './collectionPause.js'
import type { CollectionStartResult } from './collectionRunner.js'
import { failedRunStopReason, type FailedRunStopReason } from './failedRunStopReason.js'

export interface ArticleProbeRunnerDeps {
  readonly repository: () => ArticleProbeRepository | null
  readonly fetcher: ArticleFetcher
  readonly isConnected: () => boolean
  readonly clock: CollectionClock
  readonly random: Random
  /** Read once per block, like the other walks': the budget came from the same pacing. */
  readonly pacing: () => CollectionPacing
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  /** The same lock every walk takes: one browser session, one walk. */
  readonly lock: CollectionLock
  readonly newId: () => string
  readonly onError?: (error: unknown) => void
}

/** Where a block in flight stands. */
export interface ArticleProbeProgress {
  /** Article requests this block has made. */
  readonly requested: number
  readonly maxPages: number
}

/** Why a block ended with no run row to say it: its run could not be started, or the walk itself threw. */
export interface ArticleProbeBlockFailure extends FailedRunStopReason {
  readonly atMs: number
}

export interface ArticleProbeRunner {
  start(request: { readonly maxPages: number }): CollectionStartResult
  stop(): void
  isRunning(): boolean
  /** Null between blocks, and while a block has not started its run. */
  progress(): ArticleProbeProgress | null
  /** The last block's failure that no run row records; null again once a block starts. */
  blockFailure(): ArticleProbeBlockFailure | null
}

export function createArticleProbeRunner(deps: ArticleProbeRunnerDeps): ArticleProbeRunner {
  let inFlight: Promise<void> | null = null
  let abortRequested = false
  let lastBlockFailure: ArticleProbeBlockFailure | null = null
  let blockProgress: ArticleProbeProgress | null = null

  const keepBlockFailure = (failure: FailedRunStopReason): void => {
    lastBlockFailure = { ...failure, atMs: deps.clock.now() }
  }
  const now = () => new Date(deps.clock.now())

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
   * The waiting ids in ascending order, from the smallest unanswered one: that
   * is the whole cursor. An id another walk stored since the job was made is
   * closed as stored without a request. Any failure ends the block and leaves
   * its id waiting: whatever refused one read would refuse the next.
   */
  async function walkIds(repository: ArticleProbeRepository, runId: string, maxPages: number, pacing: CollectionPacing): Promise<void> {
    const collectedBoardIds = new Set(await repository.listCollectedBoardIds())
    let requested = 0
    for (;;) {
      if (abortRequested) throw new CollectionPageError('ABORTED')
      const postId = await repository.nextWaitingId()
      if (postId === null) {
        await repository.finishRun(runId, 'succeeded', null, now())
        return
      }
      const storedOn = await repository.storedBoardOf(postId)
      if (storedOn !== null) {
        await repository.recordVerdict({ runId, postId, observedAt: now(), requested: false, verdict: { outcome: 'stored', boardId: storedOn, post: null } })
        continue
      }
      if (requested >= maxPages) {
        await repository.finishRun(runId, 'partial', 'PAGE_BUDGET_SPENT', now())
        return
      }
      await waitForTurn(requested + 1, pacing)
      await repository.recordPageRequest(runId)
      requested += 1
      blockProgress = { requested, maxPages }
      const observedAt = now()
      const verdict = judgeArticleRead(postId, await deps.fetcher.read(postId), collectedBoardIds)
      await repository.recordVerdict({ runId, postId, observedAt, requested: true, verdict })
    }
  }

  /** One block is one run. It first closes a probe run an earlier block could not: the lock is held, so none is being written. */
  async function walk(repository: ArticleProbeRepository, maxPages: number): Promise<void> {
    await repository.reconcileOrphanedRuns(now())
    const job: ArticleProbeJob | null = await repository.readJob()
    if (job === null || job.probed === job.total || abortRequested) return
    const pacing = deps.pacing()
    const runId = deps.newId()
    try {
      await repository.startRun({ id: runId, fromDay: job.fromDay, toDay: job.toDay, startedAt: now() })
    } catch (error) {
      // No row to finish, and none to say why.
      keepBlockFailure(failedRunStopReason(error))
      return
    }
    blockProgress = { requested: 0, maxPages }
    try {
      await walkIds(repository, runId, maxPages, pacing)
    } catch (error) {
      // A run this write cannot close stays `running` until the next block's
      // sweep; the failure is reported, since nothing else would say why.
      const close = (status: 'failed' | 'interrupted', stopReason: string) =>
        repository.finishRun(runId, status, stopReason, now()).catch((closeError: unknown) => { deps.onError?.(closeError) })
      if (error instanceof CollectionPageError && error.code === 'ABORTED') {
        await close('interrupted', 'ABORTED')
        return
      }
      await close('failed', failedRunStopReason(error).stopReason)
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
      lastBlockFailure = null
      inFlight = walk(repository, request.maxPages)
        .catch((error: unknown) => {
          deps.onError?.(error)
          keepBlockFailure(failedRunStopReason(error))
        })
        .finally(() => {
          inFlight = null
          blockProgress = null
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
    progress() {
      return blockProgress
    },
    blockFailure() {
      return lastBlockFailure
    },
  }
}
```

- [ ] **Step 4: Run tests, types, lint**

Run: `pnpm vitest run tests/desktop/articleProbeRunner.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS. If the stop case shows an extra `read 3`: the stop must be seen at the loop's top before the next `nextWaitingId`, which the `abortRequested` check there provides — do not move it.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/articleProbeRunner.ts tests/desktop/articleProbeRunner.test.ts
git commit -m "feat: walk the waiting article ids one block at a time"
```

---

### Task 10: Planning a job, the loop job, the view, and wiring (sonnet)

**Files:**
- Create: `src/desktop/articleProbePlan.ts`, `src/desktop/articleProbeJob.ts`, `src/desktop/articleProbeView.ts`
- Modify: `src/desktop/collectionJob.ts` (the `name` union ~line 20)
- Modify: `src/desktop/collectionContext.ts` (import, the `ready` variant ~line 36, the returned object ~line 140)
- Modify: `src/desktop/bootstrap.ts` (imports ~line 58, `AppContext` ~line 148, runner after `boardSearchRunner` ~line 597, the loop's `jobs` ~line 620, the returned object ~line 750, shutdown ~line 815)
- Modify: `tests/desktop/rendererApi.test.ts` (the ready context fake ~line 237 — type requirement only)
- Test: `tests/desktop/articleProbePlan.test.ts`, `tests/desktop/articleProbeJob.test.ts`, `tests/desktop/articleProbeView.test.ts` (create)

**Interfaces:**
- Consumes: `ArticleProbeRepository`, `ArticleProbeJob`, `ArticleProbeLastRun`, `createArticleProbeRepository` (Task 8); `ArticleProbeRunner`, `ArticleProbeProgress`, `ArticleProbeBlockFailure`, `createArticleProbeRunner` (Task 9); `createArticleFetcher` (Task 5); `BoardSearchQueryState`, `BoardSearchRepository`; `CollectionJob`.
- Produces:
  - `type ArticleProbeWindow = { readonly kind: 'ready'; readonly fromDay: string; readonly toDay: string } | { readonly kind: 'refused'; readonly reason: 'NO_SEARCH_JOB' | 'SEARCH_NOT_FINISHED' }`
  - `articleProbeWindow(queries: readonly BoardSearchQueryState[]): ArticleProbeWindow`
  - `createArticleProbeJob(deps: { readonly repository: () => ArticleProbeRepository | null; readonly runner: ArticleProbeRunner }): CollectionJob` with `name: 'articleProbe'`
  - ```ts
    interface ArticleProbeView {
      readonly running: boolean
      readonly progress: ArticleProbeProgress | null
      readonly blockFailure: ArticleProbeBlockFailure | null
      readonly lastRun: ArticleProbeLastRun | null
      readonly job: ArticleProbeJob | null
      /** While there is no job: the window one would take, or why none can be made. Null once a job exists. */
      readonly window: ArticleProbeWindow | null
    }
    readArticleProbeView(inputs: { readonly repository: ArticleProbeRepository; readonly search: BoardSearchRepository; readonly running: boolean; readonly progress: ArticleProbeProgress | null; readonly blockFailure: ArticleProbeBlockFailure | null }): Promise<ArticleProbeView>
    ```
  - `OptionalCollectionContext` ready variant: `readonly articleProbeRepository: ArticleProbeRepository`
  - `AppContext.articleProbeRunner: ArticleProbeRunner`

- [ ] **Step 1: Write the failing tests**

`tests/desktop/articleProbePlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { articleProbeWindow } from '../../src/desktop/articleProbePlan.js'
import type { BoardSearchQueryState } from '../../src/desktop/collection-db/boardSearchRepository.js'

const row = (complete: boolean): BoardSearchQueryState => ({
  boardId: '137', query: 'q', fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: 1, expectedGain: 1, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, lastRunId: null,
})

describe('articleProbeWindow', () => {
  it('takes the search job\'s window once every query of it has finished', () => {
    expect(articleProbeWindow([row(true), row(true)])).toEqual({ kind: 'ready', fromDay: '20250101', toDay: '20250829' })
  })

  it('refuses before there is a search job, and while one is unfinished', () => {
    expect(articleProbeWindow([])).toEqual({ kind: 'refused', reason: 'NO_SEARCH_JOB' })
    expect(articleProbeWindow([row(true), row(false)])).toEqual({ kind: 'refused', reason: 'SEARCH_NOT_FINISHED' })
  })
})
```

`tests/desktop/articleProbeJob.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createArticleProbeJob } from '../../src/desktop/articleProbeJob.js'
import type { ArticleProbeRunner } from '../../src/desktop/articleProbeRunner.js'
import type { ArticleProbeJob, ArticleProbeRepository } from '../../src/desktop/collection-db/articleProbeRepository.js'

const summary = (probed: number, total: number): ArticleProbeJob => ({ fromDay: '20250101', toDay: '20250829', total, probed, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 })

function job(state: ArticleProbeJob | null, storage = true) {
  const runner = { start: vi.fn(() => ({ kind: 'started' as const })), stop: vi.fn(), isRunning: () => false, progress: () => null, blockFailure: () => null } satisfies ArticleProbeRunner
  const repository = storage ? ({ readJob: async () => state } as unknown as ArticleProbeRepository) : null
  return { job: createArticleProbeJob({ repository: () => repository, runner }), runner }
}

describe('articleProbe job', () => {
  it('has work while any id waits', async () => {
    await expect(job(summary(3, 10)).job.readProgress()).resolves.toEqual({ exists: true, complete: false, forced: false })
  })

  it('is done when every id is answered', async () => {
    await expect(job(summary(10, 10)).job.readProgress()).resolves.toEqual({ exists: true, complete: true, forced: false })
  })

  it('does not exist without a job or storage', async () => {
    await expect(job(null).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
    await expect(job(summary(0, 1), false).job.readProgress()).resolves.toEqual({ exists: false, complete: false, forced: false })
  })

  it('starts a block with the budget it is given', () => {
    const { job: j, runner } = job(summary(0, 1))
    expect(j.name).toBe('articleProbe')
    expect(j.start(120)).toEqual({ kind: 'started' })
    expect(runner.start).toHaveBeenCalledWith({ maxPages: 120 })
  })
})
```

`tests/desktop/articleProbeView.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readArticleProbeView } from '../../src/desktop/articleProbeView.js'
import type { ArticleProbeJob, ArticleProbeLastRun, ArticleProbeRepository } from '../../src/desktop/collection-db/articleProbeRepository.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'

const job: ArticleProbeJob = { fromDay: '20250101', toDay: '20250829', total: 9660, probed: 3120, stored: 684, deleted: 2391, unreadable: 45, otherBoard: 0, notice: 0 }
const lastRun: ArticleProbeLastRun = { status: 'failed', stopReason: 'ARTICLE_HTTP_ERROR: id 700001', startedAtMs: 1_790_000_000_000 }
const finished: BoardSearchQueryState = {
  boardId: '137', query: 'q', fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: 1, expectedGain: 1, lastCommittedPage: 3, insertedCount: 0, totalCount: null, complete: true, lastRunId: null,
}

function inputs(state: ArticleProbeJob | null) {
  const searched: string[] = []
  const repository = { readJob: async () => state, readLastRun: async () => lastRun } as unknown as ArticleProbeRepository
  const search = { listQueries: async () => { searched.push('listQueries'); return [finished] } } as unknown as BoardSearchRepository
  return { repository, search, running: false, progress: null, blockFailure: null, searched }
}

describe('readArticleProbeView', () => {
  it('carries the job and its last run, and asks nothing of the search job once there is one', async () => {
    const i = inputs(job)
    await expect(readArticleProbeView(i)).resolves.toEqual({ running: false, progress: null, blockFailure: null, lastRun, job, window: null })
    expect(i.searched).toEqual([])
  })

  it('says which window a job would take while there is none', async () => {
    await expect(readArticleProbeView(inputs(null))).resolves.toMatchObject({ job: null, window: { kind: 'ready', fromDay: '20250101', toDay: '20250829' } })
  })

  it('carries the block in flight\'s progress', async () => {
    const progress = { requested: 40, maxPages: 60 }
    await expect(readArticleProbeView({ ...inputs(job), running: true, progress })).resolves.toMatchObject({ running: true, progress })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/desktop/articleProbePlan.test.ts tests/desktop/articleProbeJob.test.ts tests/desktop/articleProbeView.test.ts`
Expected: FAIL — modules do not resolve.

- [ ] **Step 3: Write `src/desktop/articleProbePlan.ts`**

```ts
import type { BoardSearchQueryState } from './collection-db/boardSearchRepository.js'

export type ArticleProbeWindow =
  | { readonly kind: 'ready'; readonly fromDay: string; readonly toDay: string }
  | { readonly kind: 'refused'; readonly reason: 'NO_SEARCH_JOB' | 'SEARCH_NOT_FINISHED' }

/**
 * The window a probe job takes: the search job's, and only once every query of
 * it has finished. The ids to read are what the search left, so they are known
 * only when the search is done leaving them.
 */
export function articleProbeWindow(queries: readonly BoardSearchQueryState[]): ArticleProbeWindow {
  const first = queries[0]
  if (first === undefined) return { kind: 'refused', reason: 'NO_SEARCH_JOB' }
  if (!queries.every((query) => query.complete)) return { kind: 'refused', reason: 'SEARCH_NOT_FINISHED' }
  return { kind: 'ready', fromDay: first.fromDay, toDay: first.toDay }
}
```

- [ ] **Step 4: Write `src/desktop/articleProbeJob.ts`**

```ts
import type { ArticleProbeRunner } from './articleProbeRunner.js'
import type { ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import type { CollectionJob } from './collectionJob.js'

/**
 * Reading the gap's ids one by one, as one more job the loop takes turns with.
 * Like the search backfill it never runs around the clock: the posts are
 * months old, and a day's wait costs nothing.
 */
export function createArticleProbeJob(deps: { readonly repository: () => ArticleProbeRepository | null; readonly runner: ArticleProbeRunner }): CollectionJob {
  return {
    name: 'articleProbe',
    async readProgress() {
      const repository = deps.repository()
      const job = repository === null ? null : await repository.readJob()
      if (job === null) return { exists: false, complete: false, forced: false }
      return { exists: true, complete: job.probed === job.total, forced: false }
    },
    start(maxPages) {
      return deps.runner.start({ maxPages })
    },
  }
}
```

In `src/desktop/collectionJob.ts`:

```ts
  readonly name: 'articles' | 'members' | 'memberResync' | 'boardSearch' | 'articleProbe'
```

- [ ] **Step 5: Write `src/desktop/articleProbeView.ts`**

```ts
import { articleProbeWindow, type ArticleProbeWindow } from './articleProbePlan.js'
import type { ArticleProbeBlockFailure, ArticleProbeProgress } from './articleProbeRunner.js'
import type { ArticleProbeJob, ArticleProbeLastRun, ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import type { BoardSearchRepository } from './collection-db/boardSearchRepository.js'

/** What the article probe card shows. */
export interface ArticleProbeView {
  readonly running: boolean
  /** The block in flight's progress; null when none runs. */
  readonly progress: ArticleProbeProgress | null
  /** Why the last block ended with no run row saying it; null once a block starts again. */
  readonly blockFailure: ArticleProbeBlockFailure | null
  /** The feed's newest run, since probe runs stay off the recent log. */
  readonly lastRun: ArticleProbeLastRun | null
  readonly job: ArticleProbeJob | null
  /** While there is no job: the window one would take, or why none can be made. Null once a job exists. */
  readonly window: ArticleProbeWindow | null
}

export async function readArticleProbeView(inputs: {
  readonly repository: ArticleProbeRepository
  readonly search: BoardSearchRepository
  readonly running: boolean
  readonly progress: ArticleProbeProgress | null
  readonly blockFailure: ArticleProbeBlockFailure | null
}): Promise<ArticleProbeView> {
  const [job, lastRun] = await Promise.all([inputs.repository.readJob(), inputs.repository.readLastRun()])
  const window = job === null ? articleProbeWindow(await inputs.search.listQueries()) : null
  return { running: inputs.running, progress: inputs.progress, blockFailure: inputs.blockFailure, lastRun, job, window }
}
```

- [ ] **Step 6: Build the repository with the context**

In `src/desktop/collectionContext.ts` import `createArticleProbeRepository, type ArticleProbeRepository` from `./collection-db/articleProbeRepository.js`; in the `ready` variant after `boardSearchLastRuns`:

```ts
      /** The gap's ids, read one by one once the search backfill is done. */
      readonly articleProbeRepository: ArticleProbeRepository
```

and in the returned object after `boardSearchLastRuns: ...`:

```ts
      articleProbeRepository: createArticleProbeRepository(connection.db, repository),
```

In `tests/desktop/rendererApi.test.ts`, import `type { ArticleProbeRepository }` from `../../src/desktop/collection-db/articleProbeRepository.js` and add to the ready context fake after `boardSearchLastRuns`:

```ts
            articleProbeRepository: {} as unknown as ArticleProbeRepository,
```

(Task 11 fills it in.)

- [ ] **Step 7: Build the runner and the job in `bootstrap.ts`**

Imports beside the board search ones:

```ts
import { createArticleProbeRunner, type ArticleProbeRunner } from './articleProbeRunner.js'
import { createArticleFetcher } from './articleFetcher.js'
import { createArticleProbeJob } from './articleProbeJob.js'
```

In `AppContext` after `boardSearchRunner`:

```ts
  /** The gap's ids read one by one after the search backfill, one block at a time. */
  readonly articleProbeRunner: ArticleProbeRunner
```

After the `boardSearchRunner` construction:

```ts
  // Reading ids one by one takes the same lock and read gate: one browser
  // session, one walk at a time.
  const articleProbeRunner = createArticleProbeRunner({
    repository: () => (collection.kind === 'ready' ? collection.articleProbeRepository : null),
    fetcher: createArticleFetcher(transport, () => randomUUID()),
    isConnected: () => transport.isConnected(),
    clock: systemClock,
    random: systemRandom,
    pacing: () => readCollectionPacing(settings),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isSessionBusy: isAnySessionInFlight,
    lock: collectionLock,
    newId: () => randomUUID(),
    onError: (error) => diagnostics.error('article-probe', error),
  })
```

In the loop's `jobs` after `createBoardSearchJob({...}),`:

```ts
      createArticleProbeJob({
        repository: () => (collection.kind === 'ready' ? collection.articleProbeRepository : null),
        runner: articleProbeRunner,
      }),
```

Add `articleProbeRunner,` to the returned object after `boardSearchRunner,`, and `articleProbeRunner.stop()` after `boardSearchRunner.stop()` in the shutdown.

- [ ] **Step 8: Run tests, types, lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/desktop/articleProbePlan.ts src/desktop/articleProbeJob.ts src/desktop/articleProbeView.ts src/desktop/collectionJob.ts src/desktop/collectionContext.ts src/desktop/bootstrap.ts tests/desktop/articleProbePlan.test.ts tests/desktop/articleProbeJob.test.ts tests/desktop/articleProbeView.test.ts tests/desktop/rendererApi.test.ts
git commit -m "feat: take turns reading the gap's ids in the collection loop"
```

---

### Task 11: Renderer API (sonnet)

**Files:**
- Modify: `src/desktop/ipc.ts` (import and re-export ~lines 5 and 29, `IPC_CHANNELS` after `stopBoardSearch` ~line 54, types after `BoardSearchPlanView` ~line 186, `RendererApi` after `stopBoardSearch` ~line 350)
- Modify: `src/desktop/rendererApi.ts` (imports ~line 22, deps after `boardSearchRunner` ~line 105, methods after `stopBoardSearch` ~line 456)
- Modify: `src/desktop/main.ts` (the `createRendererApi` deps ~line 266)
- Test: `tests/desktop/rendererApi.test.ts`

**Interfaces:**
- Consumes: `ArticleProbeView`, `readArticleProbeView` (Task 10); `articleProbeWindow` (Task 10); `ArticleProbeRunner` (Task 9).
- Produces (`src/desktop/ipc.ts`):
  - channels `getArticleProbeStatus: 'wm:getArticleProbeStatus'`, `createArticleProbeJob: 'wm:createArticleProbeJob'`, `startArticleProbe: 'wm:startArticleProbe'`, `stopArticleProbe: 'wm:stopArticleProbe'`
  - `type ArticleProbeStatusView = { readonly kind: 'disabled' } | { readonly kind: 'unavailable'; readonly code: CollectionUnavailableCode } | { readonly kind: 'ready'; readonly view: ArticleProbeView }`
  - `type ArticleProbeCreateRefusal = 'NO_STORAGE' | 'NO_SEARCH_JOB' | 'SEARCH_NOT_FINISHED' | 'JOB_EXISTS' | 'STOP_RUNNING_FIRST'`
  - `type ArticleProbeCreateView = { readonly kind: 'ready'; readonly idCount: number } | { readonly kind: 'refused'; readonly reason: ArticleProbeCreateRefusal }`
  - `RendererApi.getArticleProbeStatus(): Promise<ArticleProbeStatusView>`, `createArticleProbeJob(): Promise<ArticleProbeCreateView>`, `startArticleProbe(): Promise<StartCollectionResult>`, `stopArticleProbe(): Promise<void>`
  - `export type { ArticleProbeView } from './articleProbeView.js'`
  - `RendererApiDeps.articleProbeRunner: ArticleProbeRunner`

- [ ] **Step 1: Extend the test fake and write the failing tests**

In `tests/desktop/rendererApi.test.ts`:

Imports: `type { ArticleProbeJob }` (add to the Task 10 import from `articleProbeRepository.js`) and `type { BoardSearchQueryState }` from `../../src/desktop/collection-db/boardSearchRepository.js` (extend the existing import).

In `CollectionOverrides` after `boardSearchBusy`:

```ts
  /** The probe job readJob() returns; null or absent when none has been made. */
  readonly articleProbeJob?: ArticleProbeJob | null
  /** Whether a probe block is in flight. */
  readonly articleProbeBusy?: boolean
  /** The search job's rows, which a probe job takes its window from. */
  readonly searchQueries?: readonly BoardSearchQueryState[]
```

In `build`, beside `boardSearchReplaceJob`:

```ts
  /** Stands in for the probe job write, and says how many ids it put in. */
  const articleProbeCreateJob = vi.fn(async () => 9660)
  const articleProbeStart = vi.fn(() => ({ kind: 'started' as const }))
```

Replace the ready fake's `boardSearchRepository` and `articleProbeRepository` lines with:

```ts
            // Only the write and the queue are stubbed: any other touch fails the test.
            boardSearchRepository: { replaceJob: boardSearchReplaceJob, listQueries: async () => collection.searchQueries ?? [] } as unknown as BoardSearchRepository,
            articleProbeRepository: {
              readJob: async () => collection.articleProbeJob ?? null,
              readLastRun: async () => null,
              createJob: articleProbeCreateJob,
            } as unknown as ArticleProbeRepository,
```

After the `boardSearchRunner` line:

```ts
    articleProbeRunner: { start: articleProbeStart, stop: vi.fn(), isRunning: () => collection.articleProbeBusy ?? false, progress: () => null, blockFailure: () => null },
```

and add `articleProbeCreateJob, articleProbeStart` to the object `build` returns. Then append:

```ts
const finishedSearch: BoardSearchQueryState = {
  boardId: '137', query: '글렌', fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: 1, expectedGain: 1, lastCommittedPage: 3, insertedCount: 0, totalCount: null, complete: true, lastRunId: null,
}
const probeJob = (probed: number): ArticleProbeJob => ({ fromDay: '20250101', toDay: '20250829', total: 9660, probed, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 })

describe('getArticleProbeStatus', () => {
  it('reports disabled when there is no collection database', async () => {
    const { api } = build()
    expect(await api.getArticleProbeStatus()).toEqual({ kind: 'disabled' })
  })

  it('says which window a job would take while there is none', async () => {
    const { api } = build(MON_10_00, {}, { job: null, searchQueries: [finishedSearch] })
    expect(await api.getArticleProbeStatus()).toMatchObject({ kind: 'ready', view: { job: null, window: { kind: 'ready', fromDay: '20250101', toDay: '20250829' } } })
  })
})

describe('createArticleProbeJob', () => {
  it('makes the job over the finished search job\'s window', async () => {
    const { api, articleProbeCreateJob } = build(MON_10_00, {}, { job: null, searchQueries: [finishedSearch] })
    expect(await api.createArticleProbeJob()).toEqual({ kind: 'ready', idCount: 9660 })
    expect(articleProbeCreateJob).toHaveBeenCalledWith({ fromDay: '20250101', toDay: '20250829' })
  })

  it.each([
    ['a block is running', { articleProbeBusy: true, searchQueries: [finishedSearch] }, 'STOP_RUNNING_FIRST'],
    ['a job exists', { articleProbeJob: probeJob(0), searchQueries: [finishedSearch] }, 'JOB_EXISTS'],
    ['there is no search job', { searchQueries: [] }, 'NO_SEARCH_JOB'],
    ['the search job is unfinished', { searchQueries: [{ ...finishedSearch, complete: false }] }, 'SEARCH_NOT_FINISHED'],
  ] as const)('refuses while %s and writes nothing', async (_label, overrides, reason) => {
    const { api, articleProbeCreateJob } = build(MON_10_00, {}, { job: null, ...overrides })
    expect(await api.createArticleProbeJob()).toEqual({ kind: 'refused', reason })
    expect(articleProbeCreateJob).not.toHaveBeenCalled()
  })

  it('refuses without storage', async () => {
    const { api } = build()
    expect(await api.createArticleProbeJob()).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
  })
})

describe('startArticleProbe', () => {
  it('starts a block with the work block\'s budget', async () => {
    const { api, articleProbeStart } = build(MON_10_00, {}, { job: null, articleProbeJob: probeJob(3120) })
    expect(await api.startArticleProbe()).toEqual({ kind: 'started' })
    expect(articleProbeStart).toHaveBeenCalledWith({ maxPages: expect.any(Number) })
  })

  it('refuses without a job, and with every id answered', async () => {
    expect(await build(MON_10_00, {}, { job: null }).api.startArticleProbe()).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    expect(await build(MON_10_00, {}, { job: null, articleProbeJob: probeJob(9660) }).api.startArticleProbe()).toEqual({ kind: 'refused', reason: 'JOB_FINISHED' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/desktop/rendererApi.test.ts`
Expected: FAIL — `getArticleProbeStatus` is not a function (and `articleProbeRunner` is not a known dep).

- [ ] **Step 3: Declare the surface in `ipc.ts`**

Beside the board search import and re-export:

```ts
import type { ArticleProbeView } from './articleProbeView.js'
export type { ArticleProbeView } from './articleProbeView.js'
```

In `IPC_CHANNELS` after `stopBoardSearch`:

```ts
  getArticleProbeStatus: 'wm:getArticleProbeStatus',
  createArticleProbeJob: 'wm:createArticleProbeJob',
  startArticleProbe: 'wm:startArticleProbe',
  stopArticleProbe: 'wm:stopArticleProbe',
```

After `BoardSearchPlanView`:

```ts
/** The article probe follows the same three-state shape as the other collection screens. */
export type ArticleProbeStatusView =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'unavailable'; readonly code: CollectionUnavailableCode }
  | { readonly kind: 'ready'; readonly view: ArticleProbeView }

/** Why a probe job could not be made. */
export type ArticleProbeCreateRefusal = 'NO_STORAGE' | 'NO_SEARCH_JOB' | 'SEARCH_NOT_FINISHED' | 'JOB_EXISTS' | 'STOP_RUNNING_FIRST'

/** How many ids a new probe job holds, or why none was made. */
export type ArticleProbeCreateView =
  | { readonly kind: 'ready'; readonly idCount: number }
  | { readonly kind: 'refused'; readonly reason: ArticleProbeCreateRefusal }
```

In `RendererApi` after `stopBoardSearch`:

```ts
  /** Where reading the gap's ids stands; `disabled` without a collection database. */
  getArticleProbeStatus(): Promise<ArticleProbeStatusView>
  /** Makes the probe job from the finished search job's window; refused while one exists. */
  createArticleProbeJob(): Promise<ArticleProbeCreateView>
  /** Starts a block of id reads now. */
  startArticleProbe(): Promise<StartCollectionResult>
  /** Asks a probe block in flight to end before its next id. */
  stopArticleProbe(): Promise<void>
```

- [ ] **Step 4: Implement in `rendererApi.ts`**

Imports beside the board search ones:

```ts
import { readArticleProbeView } from './articleProbeView.js'
import { articleProbeWindow } from './articleProbePlan.js'
import type { ArticleProbeRunner } from './articleProbeRunner.js'
```

and `ArticleProbeCreateView, ArticleProbeStatusView` in the type import from `./ipc.js`. In the deps interface after `boardSearchRunner`:

```ts
  readonly articleProbeRunner: ArticleProbeRunner
```

After `stopBoardSearch`:

```ts
    async getArticleProbeStatus(): Promise<ArticleProbeStatusView> {
      const collection = deps.collection()
      if (collection.kind === 'disabled') return { kind: 'disabled' }
      if (collection.kind === 'unavailable') return { kind: 'unavailable', code: collection.code }
      return {
        kind: 'ready',
        view: await readArticleProbeView({
          repository: collection.articleProbeRepository,
          search: collection.boardSearchRepository,
          running: deps.articleProbeRunner.isRunning(),
          progress: deps.articleProbeRunner.progress(),
          blockFailure: deps.articleProbeRunner.blockFailure(),
        }),
      }
    },

    async createArticleProbeJob(): Promise<ArticleProbeCreateView> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      if (deps.articleProbeRunner.isRunning()) return { kind: 'refused', reason: 'STOP_RUNNING_FIRST' }
      if ((await collection.articleProbeRepository.readJob()) !== null) return { kind: 'refused', reason: 'JOB_EXISTS' }
      const window = articleProbeWindow(await collection.boardSearchRepository.listQueries())
      if (window.kind !== 'ready') return window
      const idCount = await collection.articleProbeRepository.createJob({ fromDay: window.fromDay, toDay: window.toDay })
      return { kind: 'ready', idCount }
    },

    async startArticleProbe(): Promise<StartCollectionResult> {
      const collection = deps.collection()
      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const job = await collection.articleProbeRepository.readJob()
      if (job === null) return { kind: 'refused', reason: 'NO_JOB' }
      if (job.probed === job.total) return { kind: 'refused', reason: 'JOB_FINISHED' }
      const schedule = readCollectionSchedule(settings)
      const started = deps.articleProbeRunner.start({ maxPages: pagesPerWorkBlock(schedule.workBlockMinutes, readCollectionPacing(settings)) })
      return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
    },

    stopArticleProbe(): Promise<void> {
      deps.articleProbeRunner.stop()
      return Promise.resolve()
    },
```

In `src/desktop/main.ts`, after `boardSearchRunner: appContext.boardSearchRunner,`:

```ts
      articleProbeRunner: appContext.articleProbeRunner,
```

- [ ] **Step 5: Run tests, types, lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. (The preload maps every `IPC_CHANNELS` entry, so the four methods reach the renderer with no preload change.)

- [ ] **Step 6: Commit**

```bash
git add src/desktop/ipc.ts src/desktop/rendererApi.ts src/desktop/main.ts tests/desktop/rendererApi.test.ts
git commit -m "feat: expose the article probe to the renderer"
```

---

### Task 12: Words and the card (sonnet)

**Files:**
- Modify: `src/shared/text.ts` (new `articleProbe` section after `boardSearch`, ~line 759)
- Create: `src/renderer/views/collection/articleProbeLines.ts`
- Create: `src/renderer/views/collection/ArticleProbeCard.tsx`
- Modify: `src/renderer/store.ts` (state, initial value, both `Promise.all` reads and `set`s)
- Modify: `src/renderer/views/CollectionStatus.tsx` (import ~line 10, selector ~line 105, mount after `BoardSearchCard` ~line 260)
- Test: `tests/renderer/articleProbeLines.test.ts` (create), `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: `ArticleProbeStatusView`, `ArticleProbeCreateView`, `ArticleProbeView`, `StartCollectionResult` (Task 11); `ArticleProbeJob`, `ArticleProbeLastRun` (Task 8); `ArticleProbeProgress`, `ArticleProbeBlockFailure` (Task 9); `ArticleProbeWindow` (Task 10); `dayKeyLabel` from `./boardSearchLines.js`; `formatKstDateTime` from `../../format.js`; `kstDayKey`, `kstDayKeyRange`, `MS_PER_DAY` from `src/shared/kst.ts`.
- Produces:
  - `TEXT.articleProbe` (below)
  - `articleProbeSummaryLine(job: ArticleProbeJob): string`
  - `articleProbeProgressLine(progress: ArticleProbeProgress | null): string | null`
  - `articleProbeWindowLine(window: { readonly fromDay: string; readonly toDay: string }): string`
  - `articleProbeStartLabel(job: ArticleProbeJob): string`
  - `articleProbeFailureLine(blockFailure: ArticleProbeBlockFailure | null, lastRun: ArticleProbeLastRun | null): string | null`
  - `articleProbeCreateRefusal(window: ArticleProbeWindow | null): string | null`
  - `articleProbeCreateOutcome(outcome: ArticleProbeCreateView): { readonly kind: 'created' | 'refusal'; readonly text: string }`
  - store state `articleProbe: ArticleProbeStatusView | null`

- [ ] **Step 1: Add the words**

In `src/shared/text.ts`, after the `boardSearch` section:

```ts
  articleProbe: {
    heading: '빈 id 확인',
    why: '검색어로도 닿지 않은 글을 id로 하나씩 읽어 거둡니다. 검색어 보충 기간에 저장된 글 사이의 빈 id를 모두 읽고, 살아 있는 글은 저장하고 나머지는 왜 없는지 적습니다. 읽어도 조회수는 오르지 않습니다.',
    none: '빈 id 확인 작업이 없습니다',
    running: '확인 중',
    idle: '대기',
    finished: '확인 완료',
    create: '빈 id 목록 만들기',
    start: '지금 확인',
    resume: '이어서 확인',
    stop: '멈추기',
    /** The gap's first and last day, both `YYYY-MM-DD` KST. */
    window: (firstDay: string, lastDay: string) => `${firstDay} ~ ${lastDay} 사이의 빈 id`,
    /** `other`: live posts not stored — on a board this app does not collect, or notices. */
    summary: (probed: number, total: number, stored: number, deleted: number, unreadable: number, other: number) =>
      `확인 ${probed.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')} · 저장 ${stored.toLocaleString('ko-KR')} · 삭제 ${deleted.toLocaleString('ko-KR')} · 읽기 불가 ${unreadable.toLocaleString('ko-KR')}${other === 0 ? '' : ` · 기타(다른 게시판·공지) ${other.toLocaleString('ko-KR')}`}`,
    /** A running block: ids it has asked for of its budget. */
    progress: (requested: number, max: number) => `이번 블록 ${requested.toLocaleString('ko-KR')} / ${max.toLocaleString('ko-KR')}건`,
    created: (count: number) => `빈 id ${count.toLocaleString('ko-KR')}개를 목록에 넣었습니다`,
    /** The newest block's run failed; `at` is `MM-DD HH:MM` KST. */
    runFailed: (at: string, stopReason: string) => `${at} 블록이 멈췄습니다 · ${stopReason}`,
    /** A block that ended before any run row could say why; `at` is `MM-DD HH:MM` KST. */
    blockFailed: (at: string, stopReason: string) => `${at} 블록이 실행을 남기지 못하고 끝났습니다 · ${stopReason}`,
    refused: {
      NO_STORAGE: '수집 DB에 연결되어 있지 않습니다.',
      NO_SEARCH_JOB: '검색어 보충 작업이 없습니다. 빈 id는 그 기간에서 뽑습니다.',
      SEARCH_NOT_FINISHED: '검색어 보충이 끝난 뒤에 만들 수 있습니다.',
      JOB_EXISTS: '빈 id 확인 작업이 이미 있습니다. 한 번 답을 얻은 id는 다시 읽지 않습니다.',
      STOP_RUNNING_FIRST: '확인이 도는 중입니다. 먼저 멈추세요.',
    },
    /** The member walk's words, except where "the job" means the probe job. */
    startRefused: {
      ...MEMBER_START_REFUSED,
      NO_JOB: '빈 id 목록을 먼저 만드세요.',
      JOB_FINISHED: '빈 id를 모두 확인했습니다.',
    },
  },
```

- [ ] **Step 2: Write the failing wording test**

`tests/renderer/articleProbeLines.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  articleProbeCreateOutcome,
  articleProbeCreateRefusal,
  articleProbeFailureLine,
  articleProbeProgressLine,
  articleProbeStartLabel,
  articleProbeSummaryLine,
  articleProbeWindowLine,
} from '../../src/renderer/views/collection/articleProbeLines.js'
import type { ArticleProbeJob } from '../../src/desktop/collection-db/articleProbeRepository.js'
import { TEXT } from '../../src/shared/text.js'

const job = (probed: number, otherBoard = 0, notice = 0): ArticleProbeJob => ({ fromDay: '20250101', toDay: '20250829', total: 9660, probed, stored: 684, deleted: 2391, unreadable: 45, otherBoard, notice })
// 2026-09-26 17:47 KST.
const AT = Date.UTC(2026, 8, 26, 8, 47)

describe('article probe wording', () => {
  it('sums the job the way the spec spells it', () => {
    expect(articleProbeSummaryLine(job(3120))).toBe('확인 3,120 / 9,660 · 저장 684 · 삭제 2,391 · 읽기 불가 45')
    // Another board's posts and notices fold into one count: neither is stored.
    expect(articleProbeSummaryLine(job(3120, 7, 2))).toBe('확인 3,120 / 9,660 · 저장 684 · 삭제 2,391 · 읽기 불가 45 · 기타(다른 게시판·공지) 9')
  })

  it('shows a running block\'s ids of its budget', () => {
    expect(articleProbeProgressLine({ requested: 40, maxPages: 60 })).toBe('이번 블록 40 / 60건')
    expect(articleProbeProgressLine(null)).toBeNull()
  })

  it('spells the window as the gap\'s days, ending the day before the search job\'s last day', () => {
    expect(articleProbeWindowLine({ fromDay: '20250101', toDay: '20250829' })).toBe('2025-01-01 ~ 2025-08-28 사이의 빈 id')
    // Across a month end, on the KST calendar.
    expect(articleProbeWindowLine({ fromDay: '20250101', toDay: '20250301' })).toBe('2025-01-01 ~ 2025-02-28 사이의 빈 id')
  })

  it('offers to resume once any id is answered', () => {
    expect(articleProbeStartLabel(job(0))).toBe(TEXT.articleProbe.start)
    expect(articleProbeStartLabel(job(1))).toBe(TEXT.articleProbe.resume)
  })

  it('warns of the block that left no run first, then of a failed last run, and of nothing else', () => {
    const failed = { status: 'failed' as const, stopReason: 'ARTICLE_PROBE_UNKNOWN_ANSWER: id 700001 500 9999', startedAtMs: AT }
    expect(articleProbeFailureLine({ code: 'COLLECTION_FAILURE', stopReason: 'COLLECTION_FAILURE: x', atMs: AT }, failed)).toBe('09-26 17:47 블록이 실행을 남기지 못하고 끝났습니다 · COLLECTION_FAILURE: x')
    expect(articleProbeFailureLine(null, failed)).toBe('09-26 17:47 블록이 멈췄습니다 · ARTICLE_PROBE_UNKNOWN_ANSWER: id 700001 500 9999')
    expect(articleProbeFailureLine(null, { status: 'partial', stopReason: 'PAGE_BUDGET_SPENT', startedAtMs: AT })).toBeNull()
    expect(articleProbeFailureLine(null, null)).toBeNull()
  })

  it('says why no job can be made yet, and nothing once one can', () => {
    expect(articleProbeCreateRefusal({ kind: 'refused', reason: 'SEARCH_NOT_FINISHED' })).toBe(TEXT.articleProbe.refused.SEARCH_NOT_FINISHED)
    expect(articleProbeCreateRefusal({ kind: 'ready', fromDay: '20250101', toDay: '20250829' })).toBeNull()
    expect(articleProbeCreateRefusal(null)).toBeNull()
  })

  it('reads a create press back', () => {
    expect(articleProbeCreateOutcome({ kind: 'ready', idCount: 9660 })).toEqual({ kind: 'created', text: '빈 id 9,660개를 목록에 넣었습니다' })
    expect(articleProbeCreateOutcome({ kind: 'refused', reason: 'JOB_EXISTS' })).toEqual({ kind: 'refusal', text: TEXT.articleProbe.refused.JOB_EXISTS })
  })
})
```

In `tests/renderer/store.test.ts` add `getArticleProbeStatus: vi.fn(),` to `wm` after `getBoardSearchStatus`, `wm.getArticleProbeStatus.mockResolvedValue({ kind: 'disabled' })` in `beforeEach` after the board search line, and:

```ts
describe('useApp.refresh article probe', () => {
  it('loads the article probe status into the store', async () => {
    useApp.setState({ route: DEFAULT_ROUTE })

    await useApp.getState().refresh()

    expect(wm.getArticleProbeStatus).toHaveBeenCalledTimes(1)
    expect(useApp.getState().articleProbe).toEqual({ kind: 'disabled' })
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run tests/renderer/articleProbeLines.test.ts tests/renderer/store.test.ts`
Expected: FAIL — `articleProbeLines.js` does not resolve; the store has no `articleProbe`.

- [ ] **Step 4: Write `src/renderer/views/collection/articleProbeLines.ts`**

```ts
import { kstDayKey, kstDayKeyRange, MS_PER_DAY } from '../../../shared/kst.js'
import { TEXT } from '../../../shared/text.js'
import type { ArticleProbeBlockFailure, ArticleProbeProgress } from '../../../desktop/articleProbeRunner.js'
import type { ArticleProbeWindow } from '../../../desktop/articleProbePlan.js'
import type { ArticleProbeJob, ArticleProbeLastRun } from '../../../desktop/collection-db/articleProbeRepository.js'
import type { ArticleProbeCreateView } from '../../../desktop/ipc.js'
import { formatKstDateTime } from '../../format.js'
import { dayKeyLabel } from './boardSearchLines.js'

/** What a create press answered: how many ids went in, or why none did. */
export interface ArticleProbeCreateOutcome {
  readonly kind: 'created' | 'refusal'
  readonly text: string
}

export function articleProbeSummaryLine(job: ArticleProbeJob): string {
  return TEXT.articleProbe.summary(job.probed, job.total, job.stored, job.deleted, job.unreadable, job.otherBoard + job.notice)
}

export function articleProbeProgressLine(progress: ArticleProbeProgress | null): string | null {
  return progress === null ? null : TEXT.articleProbe.progress(progress.requested, progress.maxPages)
}

/**
 * The gap's days as the operator counts them. `toDay` is the search job's own
 * inclusive end, where the list walk stopped; the ids come from posts before it
 * began, so the gap's last day is the one before.
 */
export function articleProbeWindowLine(window: { readonly fromDay: string; readonly toDay: string }): string {
  const lastDay = kstDayKey(kstDayKeyRange(window.toDay).startMs - MS_PER_DAY)
  return TEXT.articleProbe.window(dayKeyLabel(window.fromDay), dayKeyLabel(lastDay))
}

/** Resume once any id is answered; until then the job has not started. */
export function articleProbeStartLabel(job: ArticleProbeJob): string {
  return job.probed > 0 ? TEXT.articleProbe.resume : TEXT.articleProbe.start
}

/**
 * The block that left no run row is newer than every run, so it is the one to
 * name; otherwise the newest run, when it failed. A spent budget or a stop is
 * not a failure and says nothing.
 */
export function articleProbeFailureLine(blockFailure: ArticleProbeBlockFailure | null, lastRun: ArticleProbeLastRun | null): string | null {
  if (blockFailure !== null) return TEXT.articleProbe.blockFailed(formatKstDateTime(blockFailure.atMs), blockFailure.stopReason)
  if (lastRun === null || lastRun.status !== 'failed') return null
  return TEXT.articleProbe.runFailed(formatKstDateTime(lastRun.startedAtMs), lastRun.stopReason ?? lastRun.status)
}

/** Why the create button is idle while there is no job; null when a job can be made, or one exists. */
export function articleProbeCreateRefusal(window: ArticleProbeWindow | null): string | null {
  return window?.kind === 'refused' ? TEXT.articleProbe.refused[window.reason] : null
}

export function articleProbeCreateOutcome(outcome: ArticleProbeCreateView): ArticleProbeCreateOutcome {
  return outcome.kind === 'ready'
    ? { kind: 'created', text: TEXT.articleProbe.created(outcome.idCount) }
    : { kind: 'refusal', text: TEXT.articleProbe.refused[outcome.reason] }
}
```

- [ ] **Step 5: Write `src/renderer/views/collection/ArticleProbeCard.tsx`**

Same frame, classes and tones as `BoardSearchCard.tsx` (open it beside this one):

```tsx
import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { ArticleProbeStatusView, StartCollectionResult } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import {
  articleProbeCreateOutcome,
  articleProbeCreateRefusal,
  articleProbeFailureLine,
  articleProbeProgressLine,
  articleProbeStartLabel,
  articleProbeSummaryLine,
  articleProbeWindowLine,
} from './articleProbeLines.js'

type ReadyView = Extract<ArticleProbeStatusView, { readonly kind: 'ready' }>['view']

interface ArticleProbeCardProps {
  readonly view: ReadyView
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
}

function startRefusal(result: StartCollectionResult): string | null {
  return result.kind === 'refused' ? TEXT.articleProbe.startRefused[result.reason] : null
}

/**
 * Reading the gap's ids one by one: make the job once the search backfill is
 * done, see where it stands, start or stop a block. It takes turns with the
 * other walks on the schedule; the buttons are for not waiting.
 */
export function ArticleProbeCard({ view, busy, act }: ArticleProbeCardProps): React.JSX.Element {
  /** What the last create press said, until the next press. */
  const [created, setCreated] = useState<string | null>(null)
  /** Why the last press did nothing, until the next press. */
  const [refusal, setRefusal] = useState<string | null>(null)
  const { job, running, window } = view
  const finished = job !== null && job.probed === job.total
  const progressLine = running ? articleProbeProgressLine(view.progress) : null
  const failureLine = articleProbeFailureLine(view.blockFailure, view.lastRun)
  const createRefusal = articleProbeCreateRefusal(window)
  const windowLine = job !== null ? articleProbeWindowLine(job) : window?.kind === 'ready' ? articleProbeWindowLine(window) : null

  const clear = (): void => {
    setCreated(null)
    setRefusal(null)
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${running ? 'bar-accent' : 'bar-idle'}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.articleProbe.heading}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {job === null ? (
                  <span>{TEXT.articleProbe.none}</span>
                ) : running ? (
                  <span className="tone-accent">{TEXT.articleProbe.running}</span>
                ) : (
                  <span>{finished ? TEXT.articleProbe.finished : TEXT.articleProbe.idle}</span>
                )}
              </div>
              {windowLine !== null && (
                <div className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  {windowLine}
                </div>
              )}
              {job !== null && (
                <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {articleProbeSummaryLine(job)}
                </div>
              )}
              {progressLine !== null && <div className="mt-0.5 text-sm tabular-nums tone-accent">{progressLine}</div>}
              {created !== null && (
                <div className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {created}
                </div>
              )}
              {failureLine !== null && <div className="mt-1 text-sm tone-warn">{failureLine}</div>}
              {createRefusal !== null && <div className="mt-1 text-sm tone-warn">{createRefusal}</div>}
              {refusal !== null && <div className="mt-1 text-sm tone-warn">{refusal}</div>}
            </div>
            {job === null ? (
              <button
                type="button"
                className="btn shrink-0"
                disabled={busy || window?.kind !== 'ready'}
                onClick={() => {
                  clear()
                  void act(async () => {
                    const outcome = articleProbeCreateOutcome(await api.createArticleProbeJob())
                    if (outcome.kind === 'created') setCreated(outcome.text)
                    else setRefusal(outcome.text)
                  })
                }}
              >
                {TEXT.articleProbe.create}
              </button>
            ) : (
              !finished &&
              (running ? (
                <button
                  type="button"
                  className="btn shrink-0"
                  disabled={busy}
                  onClick={() => {
                    clear()
                    void act(() => api.stopArticleProbe())
                  }}
                >
                  {TEXT.articleProbe.stop}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn shrink-0"
                  disabled={busy}
                  onClick={() => {
                    clear()
                    void act(async () => setRefusal(startRefusal(await api.startArticleProbe())))
                  }}
                >
                  {articleProbeStartLabel(job)}
                </button>
              ))
            )}
          </div>

          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.articleProbe.why}
          </p>
        </div>
      </div>
    </section>
  )
}
```

The start button cannot be pressed twice: `act` sets `busy` while the press is answered and refreshes right after, the store keeps the newer answer over a late poll (1.9.8), and the runner refuses a second start with `ALREADY_RUNNING`.

- [ ] **Step 6: Poll and mount it**

In `src/renderer/store.ts`: import `ArticleProbeStatusView` beside `BoardSearchStatusView`; in `AppState` after `boardSearch`:

```ts
  /** Null until the first answer; the view itself carries "no storage". */
  articleProbe: ArticleProbeStatusView | null
```

initial value `articleProbe: null,` after `boardSearch: null,`; in both branches of `refresh`, add `api.getArticleProbeStatus(),` right after `api.getBoardSearchStatus(),`, add `articleProbe` right after `boardSearch` in the destructuring, and `articleProbe` after `boardSearch` in the `set({...})`.

In `src/renderer/views/CollectionStatus.tsx`: `import { ArticleProbeCard } from './collection/ArticleProbeCard.js'`, `const articleProbe = useApp((s) => s.articleProbe)` after the `boardSearch` selector, and after the `BoardSearchCard` line:

```tsx
      {articleProbe?.kind === 'ready' && <ArticleProbeCard view={articleProbe.view} busy={busy} act={act} />}
```

- [ ] **Step 7: Run all checks**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:all`
Expected: PASS; build succeeds. (`mainProcessBoundary.test.ts` holds that the card and lines import only types from `src/desktop`.)

- [ ] **Step 8: Look at it without a second app instance**

Follow memory `renderer-preview-without-electron`: `pnpm build:renderer`, copy `dist/renderer` to the scratchpad, inject a `window.wm` shim, serve with `python3 -m http.server`, open the collection screen in the browser pane. Have `getArticleProbeStatus` answer, in turn:
1. `{ kind: 'ready', view: { running: false, progress: null, blockFailure: null, lastRun: null, job: null, window: { kind: 'refused', reason: 'SEARCH_NOT_FINISHED' } } }` — create button idle, the reason in the warn tone;
2. the same with `window: { kind: 'ready', fromDay: '20250101', toDay: '20250829' }` — `2025-01-01 ~ 2025-08-28 사이의 빈 id` and an enabled create button;
3. `job: { fromDay: '20250101', toDay: '20250829', total: 9660, probed: 3120, stored: 684, deleted: 2391, unreadable: 45, otherBoard: 0, notice: 0 }, window: null, running: true, progress: { requested: 40, maxPages: 60 }` — "확인 중", the summary, `이번 블록 40 / 60건`, a stop button;
4. the same job, `running: false`, `lastRun: { status: 'failed', stopReason: 'ARTICLE_PROBE_UNKNOWN_ANSWER: id 700001 500 9999', startedAtMs: 1790412420000 }` — "이어서 확인" and the warning.
Check light and dark, 375 px and desktop width. Fix what looks wrong before committing.

- [ ] **Step 9: Commit**

```bash
git add src/shared/text.ts src/renderer/views/collection/articleProbeLines.ts src/renderer/views/collection/ArticleProbeCard.tsx src/renderer/store.ts src/renderer/views/CollectionStatus.tsx tests/renderer/articleProbeLines.test.ts tests/renderer/store.test.ts
git commit -m "feat: show and drive the article probe on the collection screen"
```

---

### Task 13: Whole-branch verification and hand-off (sonnet)

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:all`, then the integration command if the test database is there.
Expected: all PASS. Record the counts in the task report.

- [ ] **Step 2: Scan for leftovers**

Run: `git diff main --stat` and `git diff main | grep -nE "^\+.*(TODO|FIXME|\.only\(|\.skip\(|console\.log)"`
Expected: no matches.

- [ ] **Step 3: Spec coverage walk**

Go through spec §2–§10 and name, for each requirement, the commit that implements it (§4 protocol → Task 3; §3 table, job, order, verdicts, run rows → Tasks 6–9; §6 card → Task 12; §7 migration → Task 6; §9 tests → each task; §10 → Task 1). Anything without one is a gap: add a task, do not paper over it.

- [ ] **Step 4: Report to the operator — do not deploy**

Deployment is the operator's call. Report the §7 steps they will run: package app and extension together (protocol 13), quit the app, apply migration 0009 by hand, install the new app, reload the extension, press "빈 id 목록 만들기" on the collection screen (about 9,660 ids expected), and watch the first block: an `ARTICLE_PROBE_UNKNOWN_ANSWER` or `ARTICLE_HTTP_ERROR` stop reason there means the worker's read is not answered like the page's and needs a look before anything else.
