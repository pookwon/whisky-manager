# Attendance Award Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read every `[댓글 개근]` / `[게시글 개근]` / `[방문 개근]` post of the Member of the Month board (menu 207), store each post as a round and each named nickname as an award in the collection database, and give the operator a screen that starts the run and shows what was stored and what was refused.

**Architecture:** Two pure parsers in `src/shared` judge a title (kind and period) and a body (nicknames). The extension gains one reader that returns an article's `contentHtml` over a new request/reply pair; it judges nothing. A desktop service walks the board's list with the existing board page fetcher, reads the bodies of attendance posts not yet recorded, and writes one post per transaction through a new repository. A read-only query feeds a new screen under the members section.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Electron main + React renderer + MV3 extension, PostgreSQL via drizzle-orm / drizzle-kit, vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-attendance-award-collection-design.md` — read it before any task. `§n` below refers to it.

## Global Constraints

- Times are computed in KST only, through `src/shared/kst.ts` (`kstCalendarOf`, `KST_OFFSET_MS`); never `getHours()` / `toLocaleString` with a zone (project `CLAUDE.md`).
- Korean only, but every user-facing string lives in `src/shared/text.ts`; strings that take values are functions.
- Code and comments in English; comment density and voice match the surrounding file.
- No TODO comments, no placeholders, no `test.skip` / `.only`.
- Commit messages `<type>: <description>`, **no AI attribution, no `Co-Authored-By`** (user `CLAUDE.md` overrides the harness).
- Never `git checkout <file>` / `git restore` / `git reset` / `git stash`. Never switch branches.
- Never start Electron and never write to the production collection database. Migrations are generated with `pnpm db:collection:generate`; the operator applies them by hand with `pnpm db:collection:migrate` while the app is quit.
- Integration tests run only against the dedicated test database: `COLLECTION_TEST_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection_test pnpm test:collection:integration`.
- Checks per task: `pnpm typecheck`, `pnpm test`, `npx eslint src tests scripts`.
- Domain words: `attendance` (개근), `round` (one post = one period), `award` (one nickname in one round). Kinds are `'comment' | 'post' | 'visit'`.
- Days are `YYYY-MM-DD` strings in KST everywhere in this feature (parser output, repository, IPC).
- The board is menu `'207'`; the closing phrase is exactly `님이 당첨 되셨습니다`; the nickname separator is exactly `님, ` (§3, §5).
- Error replies from the extension never carry article content, only a code and a parser rule (§5).
- Fixtures hold invented nicknames only. No real nickname from the cafe goes into the repository.
- Nothing computes or stores streaks or totals (§2).

## Review Focus

1. **Running twice.** A second run after a complete one reads no article body and leaves every row count unchanged. → Task 5 (repository) and Task 6 (service).
2. **The list wraps.** The cafe answers a page past the end with an earlier page or an empty one; the walk must end either way rather than loop to the horizon. → Task 6.
3. **A post vanishes between list and read.** A deleted or unreadable attendance post is stored as refused and the run goes on to the next post. → Task 6.
4. **The extension drops mid-run.** The run ends as failed, the collection lock is released, and posts already stored stay stored. → Task 6.
5. **Text the parser was not shown.** A nickname with an HTML entity (`A&amp;B`), a nickname ending in `님`, and an attendance title whose period wording changed must not produce a wrong row: the first two parse exactly, the last is refused. → Tasks 1 and 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/attendanceTitle.ts` (new) | Title → kind and period, or "not an attendance post" |
| `src/shared/attendanceWinners.ts` (new) | `contentHtml` → nicknames, or a refusal rule |
| `src/shared/cafeArticleBody.ts` (new) | Article-read response → id, subject, write time, `contentHtml` |
| `src/shared/protocol.ts` (modify) | `COLLECT_ARTICLE_BODY` / `ARTICLE_BODY_COLLECTED`, guards, version 15 |
| `src/extension/articleBodyReader.ts` (new) | One authenticated read of one article body |
| `src/extension/dispatch.ts`, `src/extension/background.ts` (modify) | Route the new request to the new reader |
| `src/desktop/naverReadGate.ts` (modify) | Serialize the new read with the others |
| `src/desktop/articleBodyFetcher.ts` (new) | Desktop side of the new request |
| `src/desktop/collection-db/attendanceSchema.ts` (new) | `attendance_posts`, `attendance_awards`, two enums |
| `src/desktop/collection-db/attendanceRepository.ts` (new) | Writes: recorded and refused posts |
| `src/desktop/collection-db/attendanceStatusQuery.ts` (new) | Reads for the screen |
| `src/desktop/attendanceCollection.ts` (new) | The run: walk the list, read bodies, store |
| `src/desktop/collectionContext.ts`, `bootstrap.ts`, `ipc.ts`, `rendererApi.ts` (modify) | Wiring |
| `src/renderer/views/members/AttendanceRecords.tsx` (new) | The screen |
| `src/renderer/routes.ts`, `App.tsx`, `store.ts`, `src/shared/text.ts` (modify) | Route, nav entry, strings |

---

### Task 1: Title parser

**Files:**
- Create: `src/shared/attendanceTitle.ts`
- Test: `tests/shared/attendanceTitle.test.ts`

**Interfaces:**
- Produces:

```ts
export type AttendanceKind = 'comment' | 'post' | 'visit'
export interface AttendancePeriod { readonly startDay: string; readonly endDay: string } // YYYY-MM-DD, KST
export type AttendanceTitle =
  | { readonly kind: 'other' }
  | { readonly kind: 'attendance'; readonly attendanceKind: AttendanceKind; readonly period: AttendancePeriod | null }
export function parseAttendanceTitle(title: string | null, postedAtMs: number): AttendanceTitle
```

- [ ] **Step 1: Write the failing tests**

```ts
const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 22, 2) // 07:02 KST the next day

it('reads the kind and the period, taking the year from the post', () => {
  expect(parseAttendanceTitle('[댓글 개근] 11월 1일~11월 10일 카페 댓글 개근상을 잡아라!', at(2026, 11, 10)))
    .toEqual({ kind: 'attendance', attendanceKind: 'comment', period: { startDay: '2026-11-01', endDay: '2026-11-10' } })
  expect(parseAttendanceTitle('[방문 개근] 3월 1일~3월 11일 카페 방문 개근상을 잡아라!', at(2021, 3, 11)))
    .toEqual({ kind: 'attendance', attendanceKind: 'visit', period: { startDay: '2021-03-01', endDay: '2021-03-11' } })
  expect(parseAttendanceTitle('[게시글 개근] 10월 16일~10월 26일 카페 게시글 개근상을 잡아라!', at(2021, 10, 26)))
    .toEqual({ kind: 'attendance', attendanceKind: 'post', period: { startDay: '2021-10-16', endDay: '2021-10-26' } })
})

it('puts a round that ends on the last day of the year in that year', () => {
  expect(parseAttendanceTitle('[댓글 개근] 12월 21일~12월 31일 카페', at(2024, 12, 31)))
    .toMatchObject({ period: { startDay: '2024-12-21', endDay: '2024-12-31' } })
})

it('starts a round that crosses the year in the year before', () => {
  expect(parseAttendanceTitle('[게시글 개근] 12월 22일~1월 1일 카페', at(2024, 1, 1)))
    .toMatchObject({ period: { startDay: '2023-12-22', endDay: '2024-01-01' } })
})

it('calls every other post of the board other', () => {
  for (const title of ['[월간MoM]10월 Member of the Month 발표 - 30명', '[이주의 인기멤버]이주의 인기멤버 11.02-11.08', '[방문 히트] 1000000번째 방문', '개근상 안내', null]) {
    expect(parseAttendanceTitle(title, at(2026, 11, 10))).toEqual({ kind: 'other' })
  }
})

it('keeps an attendance post whose period it cannot read, without a period', () => {
  const unreadable = { kind: 'attendance', attendanceKind: 'comment', period: null }
  expect(parseAttendanceTitle('[댓글 개근] 이번 회차 안내', at(2026, 11, 10))).toEqual(unreadable)
  expect(parseAttendanceTitle('[댓글 개근] 2월 21일~2월 30일 카페', at(2026, 3, 1))).toEqual(unreadable)
  // Ended more than seven days before the post: the year would be a guess.
  expect(parseAttendanceTitle('[댓글 개근] 3월 1일~3월 11일 카페', at(2021, 3, 25))).toEqual(unreadable)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/shared/attendanceTitle.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `parseAttendanceTitle`**

The bracket decides the kind and must open the title: `[댓글 개근]` → `comment`, `[게시글 개근]` → `post`, `[방문 개근]` → `visit` (whitespace inside the bracket is tolerated). The period is the first `M월 D일~M월 D일` after it. Year rule (§5): with `D` the KST calendar day of `postedAtMs`, the end day takes the latest year whose `M월 D일` is a real date on or before `D`; the start day takes the same year, or the year before when its month/day falls after the end's. Period is `null` when either date is not a real calendar date or the end day is more than 7 days before `D`. Name the 7 as a constant.

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run tests/shared/attendanceTitle.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: read an attendance post's kind and period from its title"`

---

### Task 2: Winners parser

**Files:**
- Create: `src/shared/attendanceWinners.ts`
- Create: `tests/fixtures/attendance-body.html`
- Test: `tests/shared/attendanceWinners.test.ts`

**Interfaces:**
- Consumes: `decodeHtmlEntities` from `src/shared/htmlEntities.ts`.
- Produces:

```ts
export type AttendanceWinnersRule = 'NO_CLOSING_PHRASE' | 'NO_WINNERS' | 'EMPTY_NICKNAME'
export type AttendanceWinners =
  | { readonly ok: true; readonly nicknames: readonly string[] }
  | { readonly ok: false; readonly rule: AttendanceWinnersRule }
export function parseAttendanceWinners(contentHtml: string): AttendanceWinners
```

- [ ] **Step 1: Write the fixture**

`tests/fixtures/attendance-body.html` — the real `contentHtml` shape (captured 2026-11-16, post 963460) with invented nicknames:

```html
<center> <p align="center"> <br /> <p align="center"> <br /> <p> <p> <br /> [[[CONTENT-ELEMENT-0]]] <b><span>[게시글 개근] </span> 11월 1일~11월 10일 카페 게시글 개근상을 잡아라!</b> <br /> <br /> <p> <br /> </p> <br /> <br /> 매니저 가상매니저 : 매일 게시글을 작성하면 개근상을 받을 수 있어요! <br /> <br /> </p> <br /> </p> <br /> </p> <br /> <br /> <p> 가상하나님, 두 번째 회원님, 선생님님, A&amp;B님, tester01님이 당첨 되셨습니다. 축하드려요! <br /> </p> <br /> <br /> </p> </center>
```

- [ ] **Step 2: Write the failing tests**

```ts
it('reads the nicknames in the order the post names them', () => {
  expect(parseAttendanceWinners(fixture('attendance-body.html')))
    .toEqual({ ok: true, nicknames: ['가상하나', '두 번째 회원', '선생님', 'A&B', 'tester01'] })
})

it('reads a single winner', () => {
  expect(parseAttendanceWinners('<p> 혼자님이 당첨 되셨습니다. 축하드려요! </p>')).toEqual({ ok: true, nicknames: ['혼자'] })
})

it('reads thousands of winners', () => {
  const names = Array.from({ length: 8000 }, (_, i) => `회원${i}`)
  const html = `<p> ${names.map((n) => `${n}님`).join(', ')}이 당첨 되셨습니다. 축하드려요! </p>`
  expect(parseAttendanceWinners(html)).toEqual({ ok: true, nicknames: names })
})

it('refuses a body it cannot be sure of', () => {
  expect(parseAttendanceWinners('<p> 이번 회차는 당첨자가 없습니다. </p>')).toEqual({ ok: false, rule: 'NO_CLOSING_PHRASE' })
  expect(parseAttendanceWinners('<p> 님이 당첨 되셨습니다. </p>')).toEqual({ ok: false, rule: 'NO_WINNERS' })
  expect(parseAttendanceWinners('<p> 가상하나님, 님, 가상둘님이 당첨 되셨습니다. </p>')).toEqual({ ok: false, rule: 'EMPTY_NICKNAME' })
  expect(parseAttendanceWinners('')).toEqual({ ok: false, rule: 'NO_CLOSING_PHRASE' })
})
```

- [ ] **Step 3: Run to verify it fails** — `pnpm vitest run tests/shared/attendanceWinners.test.ts` → FAIL, module not found.

- [ ] **Step 4: Implement `parseAttendanceWinners`**

The list is one text run with no tags inside it, so no DOM is needed (this replaces the spec's `node-html-parser` suggestion; §8 leaves the method to the builder):

1. Split `contentHtml` on tags (`/<[^>]*>/`).
2. Take the last piece that contains `님이 당첨 되셨습니다`; none → `NO_CLOSING_PHRASE`.
3. Cut that piece at the phrase, keeping what is before it, and collapse runs of whitespace to one space.
4. Split on `님, `. Trim each piece and decode entities with `decodeHtmlEntities` after splitting.
5. No text before the phrase → `NO_WINNERS`; any empty piece → `EMPTY_NICKNAME`.

The closing phrase and the separator are named constants.

- [ ] **Step 5: Run to verify it passes** — same command → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat: read the nicknames an attendance post names"`

---

### Task 3: Article body contract

**Files:**
- Create: `src/shared/cafeArticleBody.ts`
- Create: `tests/fixtures/cafe-article-body-attendance.json`
- Test: `tests/shared/cafeArticleBody.test.ts`

**Interfaces:**
- Consumes: `record`, `safeInteger`, `nullableString`, `epochMilliseconds`, `fail`, `CafeArticleListParseError` from `src/shared/cafeArticleList.ts`; `cafeRefusalCode` from `src/shared/cafeArticleRead.ts`.
- Produces:

```ts
export interface CafeArticleBody {
  readonly postId: string
  readonly title: string | null
  readonly postedAt: number // epoch ms
  readonly contentHtml: string
}
export type CafeArticleBodyRead =
  | ({ readonly kind: 'article' } & CafeArticleBody)
  | { readonly kind: 'absent'; readonly status: number; readonly code: string }
export function parseCafeArticleBody(postId: string, value: unknown): CafeArticleBody
export function parseCafeArticleBodyText(postId: string, text: string): CafeArticleBody
```

- [ ] **Step 1: Write the fixture**

`tests/fixtures/cafe-article-body-attendance.json`: `{ "result": { "cafeId": 14538121, "articleId": 963460, "article": { "id": 963460, "subject": "[게시글 개근] 11월 1일~11월 10일 카페 게시글 개근상을 잡아라!", "writeDate": 1794348202440, "contentHtml": <the Task 2 fixture as a JSON string> } } }`. Only the keys the parser reads; no writer, no member key.

- [ ] **Step 2: Write the failing tests**

```ts
it('reads the id, subject, time and body of the article asked for', () => {
  const body = parseCafeArticleBodyText('963460', fixture('cafe-article-body-attendance.json'))
  expect(body).toMatchObject({ postId: '963460', title: '[게시글 개근] 11월 1일~11월 10일 카페 게시글 개근상을 잡아라!', postedAt: 1794348202440 })
  expect(parseAttendanceWinners(body.contentHtml)).toMatchObject({ ok: true })
})

it('refuses an answer that is not the article asked for, or has no body', () => {
  expect(() => parseCafeArticleBodyText('963461', fixture('cafe-article-body-attendance.json'))).toThrowError(/is not the article asked for/)
  const noBody = JSON.parse(fixture('cafe-article-body-attendance.json')); delete noBody.result.article.contentHtml
  expect(() => parseCafeArticleBody('963460', noBody)).toThrowError(expect.objectContaining({ code: 'INVALID_ARTICLE' }))
  expect(() => parseCafeArticleBodyText('963460', '<html>')).toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }))
})
```

- [ ] **Step 3: Run to verify it fails**, **Step 4: implement** following `parseCafeArticle` in `src/shared/cafeArticleRead.ts` (same envelope checks and error codes; `contentHtml` must be a string), **Step 5: run to verify it passes.**

- [ ] **Step 6: Commit** — `git commit -m "feat: read an article's body from the article read"`

---

### Task 4: Body read over the wire

**Files:**
- Modify: `src/shared/protocol.ts`
- Create: `src/extension/articleBodyReader.ts`
- Modify: `src/extension/dispatch.ts`, `src/extension/background.ts`
- Modify: `src/desktop/naverReadGate.ts`
- Create: `src/desktop/articleBodyFetcher.ts`
- Test: `tests/shared/protocol.test.ts`, `tests/extension/articleBodyReader.test.ts`, `tests/extension/dispatch.test.ts`, `tests/desktop/naverReadGate.test.ts` (extend the existing file if present, otherwise the test file that covers the gate today), `tests/desktop/articleBodyFetcher.test.ts`

**Interfaces:**
- Consumes: Task 3's `CafeArticleBodyRead`, `parseCafeArticleBodyText`; `cafeArticleReadUrl`, `cafeArticleReadReferer`, `CAFE_ARTICLE_READ`, `isArticleId`.
- Produces:

```ts
// protocol.ts
export const PROTOCOL_VERSION = 15
export interface CollectArticleBodyRequest {
  readonly type: 'COLLECT_ARTICLE_BODY'; readonly requestId: string
  readonly cafeId: typeof CAFE_ARTICLE_LIST.cafeId; readonly postId: string
}
export function isCollectArticleBodyRequest(value: unknown): value is CollectArticleBodyRequest
// ExtensionMessage gains: { type: 'ARTICLE_BODY_COLLECTED'; requestId: string; result: CafeArticleBodyRead }
// TIMEOUTS gains: articleBodyMs: 20_000

// extension/articleBodyReader.ts
export type ArticleBodyReadResult =
  | { readonly ok: true; readonly result: CafeArticleBodyRead }
  | { readonly ok: false; readonly code: 'ARTICLE_BODY_BAD_REQUEST' | 'ARTICLE_BODY_NETWORK_ERROR' | 'ARTICLE_BODY_HTTP_ERROR' | 'ARTICLE_BODY_INVALID_JSON' | 'ARTICLE_BODY_PARSE_ERROR'; readonly detail?: string }
export function createArticleBodyReader(deps: { readonly http: Http }): { read(request: CollectArticleBodyRequest): Promise<ArticleBodyReadResult> }

// desktop/articleBodyFetcher.ts
export interface ArticleBodyFetcher { read(postId: string): Promise<CafeArticleBodyRead> }
export function createArticleBodyFetcher(transport: ExtensionTransport, newRequestId: () => string): ArticleBodyFetcher
```

- [ ] **Step 1: Write the failing tests**

- `protocol.test.ts`: `isAppMessage` accepts `{ type: 'COLLECT_ARTICLE_BODY', requestId: 'r', cafeId: '14538121', postId: '963460' }` and rejects `postId: '0'` and a foreign `cafeId`; the extension-message guard accepts `ARTICLE_BODY_COLLECTED` with a `kind: 'article'` result (string `postId`, string `contentHtml`, number `postedAt`) and with `kind: 'absent'`, and rejects one whose `contentHtml` is missing; `PROTOCOL_VERSION` is `15`.
- `articleBodyReader.test.ts`, mirroring `tests/extension/articleReader.test.ts`: the request made is exactly `{ url: cafeArticleReadUrl('963460'), headers: { 'x-cafe-product': 'pc' }, referer: cafeArticleReadReferer('963460') }`; a 404 with the deleted fixture (`cafe-article-read-deleted.json`) → `{ ok: true, result: { kind: 'absent', status: 404, code: '4003' } }`; 500 `<html>` → `ARTICLE_BODY_HTTP_ERROR`; 200 `<html>` → `ARTICLE_BODY_INVALID_JSON`; a body-less article → `ARTICLE_BODY_PARSE_ERROR` with `detail` naming the rule and **not containing any text of the article**; a thrown `http` → `ARTICLE_BODY_NETWORK_ERROR`; `postId: '0'` → `ARTICLE_BODY_BAD_REQUEST`.
- `dispatch.test.ts`: `COLLECT_ARTICLE_BODY` replies `ARTICLE_BODY_COLLECTED` on success and `ERROR` with `code` and `message: detail ?? code` on failure.
- Gate test: a `COLLECT_ARTICLE_BODY` sent while a `COLLECT_BOARD_PAGE` is in flight does not reach the inner transport until the page read settles.
- `articleBodyFetcher.test.ts`: returns `reply.result` for `ARTICLE_BODY_COLLECTED`; throws `CollectionPageError` carrying the reply's code for `ERROR`; throws `CollectionPageError('ARTICLE_BODY_UNEXPECTED_REPLY', …)` for anything else.

- [ ] **Step 2: Run to verify they fail** — `pnpm test` → the new cases FAIL.

- [ ] **Step 3: Implement**

Follow the `COLLECT_ARTICLE` path file by file: `CollectArticleRequest` / `isCollectArticleRequest` / `isArticleCollected` / the two type-name sets in `protocol.ts`; `articleReader.ts`; the `COLLECT_ARTICLE` case in `dispatch.ts` (add `articleBodyReader` to `DispatcherDeps`); the reader's construction in `background.ts`; `isPageRead` in `naverReadGate.ts`; `articleFetcher.ts`. The existing `COLLECT_ARTICLE` path is not changed.

- [ ] **Step 4: Run to verify they pass** — `pnpm typecheck && pnpm test` → PASS (including `tests/extension/manifest*.test.ts`).

- [ ] **Step 5: Commit** — `git commit -m "feat: let the extension read one article's body"`

---

### Task 5: Storage

**Files:**
- Create: `src/desktop/collection-db/attendanceSchema.ts`, `attendanceRepository.ts`, `attendanceStatusQuery.ts`
- Modify: `src/desktop/collection-db/schema.ts` (re-export), `src/desktop/collectionContext.ts`
- Create: `drizzle-collection/0011_*.sql` (generated)
- Test: `tests/desktop/collection-db/schema.test.ts`, `tests/desktop/collection-db/integration.test.ts`

**Interfaces:**
- Consumes: `AttendanceKind`, `AttendancePeriod` (Task 1); `CollectionDatabase`.
- Produces:

```ts
// attendanceSchema.ts
export const attendanceKind = pgEnum('attendance_kind', ['comment', 'post', 'visit'])
export const attendancePostStatus = pgEnum('attendance_post_status', ['recorded', 'refused'])
export const attendancePosts // 'attendance_posts'
export const attendanceAwards // 'attendance_awards'

// attendanceRepository.ts
export interface AttendancePostRecord {
  readonly postId: string
  readonly kind: AttendanceKind
  readonly period: AttendancePeriod | null
  readonly title: string
  readonly postedAt: Date
}
export interface AttendanceRepository {
  recordedPostIds(): Promise<ReadonlySet<string>>
  saveRecorded(post: AttendancePostRecord & { readonly period: AttendancePeriod }, nicknames: readonly string[], readAt: Date): Promise<void>
  saveRefused(post: AttendancePostRecord, rule: string, readAt: Date): Promise<void>
}
export function createAttendanceRepository(db: CollectionDatabase): AttendanceRepository

// attendanceStatusQuery.ts
export interface AttendanceKindStatus {
  readonly kind: AttendanceKind
  readonly roundCount: number
  readonly awardCount: number
  readonly earliest: AttendancePeriod | null
  readonly latest: AttendancePeriod | null
}
export interface AttendanceRefusedPost { readonly postId: string; readonly title: string; readonly rule: string }
export interface AttendanceStatus {
  readonly kinds: readonly AttendanceKindStatus[] // always three, in the order comment, post, visit
  readonly refused: readonly AttendanceRefusedPost[] // newest post first
  readonly lastReadAtMs: number | null
}
export interface AttendanceStatusQuery { read(): Promise<AttendanceStatus> }
export function createAttendanceStatusQuery(db: CollectionDatabase): AttendanceStatusQuery
```

`OptionalCollectionContext`'s `ready` variant gains `readonly attendanceRepository: AttendanceRepository` and `readonly attendanceStatus: AttendanceStatusQuery`.

- [ ] **Step 1: Define the tables**

`attendance_posts`: `post_id text` primary key; `kind attendance_kind not null`; `period_start date`, `period_end date` (both nullable, drizzle `date(..., { mode: 'string' })`); `title text not null`; `posted_at`, `read_at` with the file-local `observedTimestamp` helper, not null; `status attendance_post_status not null`; `refusal_rule text`; `winner_count integer`. Checks: recorded ⇔ (`refusal_rule is null` and `winner_count is not null` and both period days not null); `period_start <= period_end`. Index on `(kind, period_start)`.

`attendance_awards`: `post_id text not null` references `attendance_posts.post_id` on delete cascade; `position integer not null` (from 1); `nickname text not null`. Primary key `(post_id, position)`; index on `nickname`.

Re-export the file from `schema.ts` beside the member schemas (it imports nothing from `schema.ts`).

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:collection:generate` — Expected: one new file `drizzle-collection/0011_*.sql` creating two enums and two tables and nothing else, with LF line endings, and `meta/_journal.json` updated. Do not run `db:collection:migrate`.

- [ ] **Step 3: Write the failing integration tests**

Add to `integration.test.ts` (also add the two tables and two enum types to `COLLECTION_TABLES` / `COLLECTION_TYPES` so teardown drops them):

```ts
const round = { postId: '963460', kind: 'post' as const, period: { startDay: '2026-11-01', endDay: '2026-11-10' }, title: '[게시글 개근] …', postedAt: new Date('2026-11-10T22:03:22.440Z') }

it('stores a round and its awards in order', async () => {
  await repo.saveRecorded(round, ['가상하나', '두 번째 회원', '선생님'], readAt)
  // attendance_awards for 963460: positions 1,2,3 with those nicknames; attendance_posts: status recorded, winner_count 3
  expect(await repo.recordedPostIds()).toEqual(new Set(['963460']))
})

it('replaces rather than adds when the same post is saved again', async () => {
  await repo.saveRecorded(round, ['가상하나', '두 번째 회원', '선생님'], readAt)
  await repo.saveRecorded(round, ['가상하나', '선생님'], readAt)
  // exactly 2 award rows for 963460, winner_count 2
})

it('keeps no award for a refused post, and does not call it recorded', async () => {
  await repo.saveRecorded(round, ['가상하나'], readAt)
  await repo.saveRefused({ ...round, period: null }, 'PERIOD_UNREADABLE', readAt)
  // 0 award rows, status refused, refusal_rule PERIOD_UNREADABLE, winner_count null
  expect(await repo.recordedPostIds()).toEqual(new Set())
})

it('stores eight thousand awards for one round', async () => {
  const names = Array.from({ length: 8000 }, (_, i) => `회원${i}`)
  await repo.saveRecorded({ ...round, postId: '963459', kind: 'visit' }, names, readAt)
  // count(*) = 8000, position 8000 is 회원7999
})

it('reports each kind, the refused posts and the last read', async () => {
  // after: one recorded comment round (2 awards, 2026-11-01~10), one recorded visit round (3 awards, 2021-03-01~11),
  // a second visit round (1 award, 2026-11-01~10), one refused post
  expect(await status.read()).toEqual({
    kinds: [
      { kind: 'comment', roundCount: 1, awardCount: 2, earliest: { startDay: '2026-11-01', endDay: '2026-11-10' }, latest: { startDay: '2026-11-01', endDay: '2026-11-10' } },
      { kind: 'post', roundCount: 0, awardCount: 0, earliest: null, latest: null },
      { kind: 'visit', roundCount: 2, awardCount: 4, earliest: { startDay: '2021-03-01', endDay: '2021-03-11' }, latest: { startDay: '2026-11-01', endDay: '2026-11-10' } },
    ],
    refused: [{ postId: '412345', title: '[댓글 개근] 이번 회차 안내', rule: 'PERIOD_UNREADABLE' }],
    lastReadAtMs: readAt.getTime(),
  })
})
```

Add to `schema.test.ts` whatever that file asserts for a new table today (table and enum names present).

- [ ] **Step 4: Run to verify they fail** — the integration command from Global Constraints → the new cases FAIL.

- [ ] **Step 5: Implement the repository and the query**

Each save is one `db.transaction`: upsert the post row on `post_id`, delete that post's awards, insert the new ones in chunks of 1,000 (a named constant; one insert of 8,000 rows × 3 parameters stays under PostgreSQL's 65,535-parameter limit, the chunk keeps statements small). Follow `memberRepository.ts` for shape and `memberStatusQuery.ts` for the read side. Wire both into `collectionContext.ts`'s `ready` branch.

- [ ] **Step 6: Run to verify they pass** — integration command and `pnpm typecheck && pnpm test` → PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat: store attendance rounds and awards"`

---

### Task 6: The collection run

**Files:**
- Create: `src/desktop/attendanceCollection.ts`
- Test: `tests/desktop/attendanceCollection.test.ts`

**Interfaces:**
- Consumes: `parseAttendanceTitle` (Task 1), `parseAttendanceWinners` (Task 2), `ArticleBodyFetcher` (Task 4), `AttendanceRepository` (Task 5), `BoardPageFetcher` and `FEED_HORIZON_PAGE` from `collectionOrchestrator.ts`, `CollectionLock`, `collectionDelayMs` / `CollectionPacing`, `Random`, `CollectionPageError`.
- Produces:

```ts
export const ATTENDANCE_BOARD_MENU_ID = '207'

export type AttendanceRunState = 'idle' | 'listing' | 'reading' | 'done' | 'stopped' | 'failed'
export interface AttendanceProgress {
  readonly state: AttendanceRunState
  readonly listPage: number        // last list page read
  readonly postsTotal: number      // attendance posts this run has to read
  readonly postsRead: number       // of those, stored so far (recorded or refused)
  readonly failureCode: string | null
}
export type AttendanceStartResult = 'STARTED' | 'ALREADY_RUNNING' | 'EXTENSION_OFFLINE' | 'DATABASE_DISABLED' | 'COLLECTION_BUSY'

export interface AttendanceCollectionDeps {
  readonly repository: () => AttendanceRepository | null
  readonly listFetcher: BoardPageFetcher            // already bound to ATTENDANCE_BOARD_MENU_ID
  readonly bodyFetcher: ArticleBodyFetcher
  readonly isConnected: () => boolean
  readonly lock: CollectionLock
  readonly pacing: () => CollectionPacing
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly onError: (error: unknown) => void
}
export interface AttendanceCollection {
  start(): AttendanceStartResult
  stop(): void
  progress(): AttendanceProgress
  /** Settles when the run in flight ends; resolves at once when none is. For tests and shutdown. */
  settled(): Promise<void>
}
export function createAttendanceCollection(deps: AttendanceCollectionDeps): AttendanceCollection
```

Behaviour the tests pin (§5):

- `start()` checks, in order: a run in flight → `ALREADY_RUNNING`; repository `null` → `DATABASE_DISABLED`; not connected → `EXTENSION_OFFLINE`; lock not acquired → `COLLECTION_BUSY`; otherwise acquires the lock, starts the run without awaiting it, returns `STARTED`.
- **Listing.** Read pages 1, 2, … The walk ends when a page has no items, when every id on a page was already seen in this walk, or at `FEED_HORIZON_PAGE`. Every item goes through `parseAttendanceTitle(item.title, item.postedAt)`; `other` is dropped.
- **Reading.** Attendance posts whose id is not in `recordedPostIds()` are read newest first. For each: period `null` → `saveRefused(…, 'PERIOD_UNREADABLE')` without reading the body; body read `absent` → `saveRefused(…, 'ARTICLE_ABSENT')`; winners refused → `saveRefused(…, rule)`; otherwise `saveRecorded`. The title and time stored are the list's.
- **Pacing.** Every request after the first waits `collectionDelayMs(ordinal, deps.pacing(), deps.random)` first; list and body reads share one ordinal.
- **Stop.** `stop()` is honoured between requests; the run ends `stopped` and what was stored stays.
- **Failure.** A thrown fetch or save ends the run `failed` with `failureCode` (the `CollectionPageError` code, else `'ATTENDANCE_UNEXPECTED_ERROR'`), reports through `onError`, and keeps what was stored.
- The lock is released on every ending.

- [ ] **Step 1: Write the failing tests**

With fakes for both fetchers and an in-memory `AttendanceRepository`, `sleep` resolving at once:

```ts
it('stores every attendance post of the board and nothing else', async () => {
  // list: page 1 = [963461 댓글, 963460 게시글, 962584 인기멤버], page 2 = [148887 방문 (2021)], page 3 = []
  // → bodies read: 963461, 963460, 148887; saved recorded ×3; progress { state: 'done', listPage: 3, postsTotal: 3, postsRead: 3, failureCode: null }
})
it('reads no body on a second run', async () => { /* run twice; bodyFetcher called 3 times in total; repository rows unchanged */ })
it('reads a refused post again on the next run', async () => { /* first body lacks the phrase → refused NO_CLOSING_PHRASE; second run reads it again */ })
it('ends the walk when the list starts repeating', async () => { /* page 3 returns page 1's ids → 3 list reads, state done */ })
it('refuses an unreadable period without reading the body', async () => { /* '[댓글 개근] 이번 회차 안내' → saveRefused PERIOD_UNREADABLE, bodyFetcher not called for it */ })
it('refuses a post that is gone and goes on', async () => { /* absent 4003 for the first → ARTICLE_ABSENT, the second still recorded */ })
it('fails, keeps what it stored and frees the lock when the extension drops', async () => {
  // bodyFetcher throws CollectionPageError('EXTENSION_OFFLINE') on the 2nd read
  // → progress.state 'failed', failureCode 'EXTENSION_OFFLINE', 1 post stored, lock.isHeld() false, onError called once
})
it('stops between requests', async () => { /* stop() during the 1st body read → state 'stopped', 1 post stored, lock free */ })
it('says why it did not start', () => { /* ALREADY_RUNNING, DATABASE_DISABLED, EXTENSION_OFFLINE, COLLECTION_BUSY — and the lock is untouched in the last three */ })
it('waits the paced gap before every request but the first', async () => { /* sleep called (requests − 1) times with collectionDelayMs values */ })
```

- [ ] **Step 2: Run to verify they fail** — `pnpm vitest run tests/desktop/attendanceCollection.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement `createAttendanceCollection`** as specified above.

- [ ] **Step 4: Run to verify they pass** — same command → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: collect the attendance posts of the member board"`

---

### Task 7: IPC and wiring

**Files:**
- Modify: `src/desktop/ipc.ts`, `src/desktop/rendererApi.ts`, `src/desktop/bootstrap.ts`, `src/desktop/main.ts` (only if `rendererApi` deps are assembled there)
- Test: `tests/desktop/rendererApi.test.ts` (or the file that covers `createRendererApi` today)

**Interfaces:**
- Consumes: `AttendanceCollection`, `AttendanceProgress`, `AttendanceStartResult` (Task 6); `AttendanceStatus`, `AttendanceStatusQuery` (Task 5); `createBoardPageFetcher`, `createArticleBodyFetcher`.
- Produces:

```ts
// ipc.ts
export interface AttendanceView {
  readonly progress: AttendanceProgress
  /** Null when the collection database is not configured. */
  readonly status: AttendanceStatus | null
}
// IPC_CHANNELS gains: startAttendanceCollection: 'wm:startAttendanceCollection',
//                     stopAttendanceCollection: 'wm:stopAttendanceCollection',
//                     getAttendanceView: 'wm:getAttendanceView'
// RendererApi gains:
startAttendanceCollection(): Promise<AttendanceStartResult>
stopAttendanceCollection(): Promise<void>
getAttendanceView(): Promise<AttendanceView>
```

- [ ] **Step 1: Write the failing tests** — `getAttendanceView()` returns the collection's progress and the query's status, and `status: null` when the context is disabled; `startAttendanceCollection()` returns what `start()` returns; `stopAttendanceCollection()` calls `stop()`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** In `bootstrap.ts`, build the collection next to `articleProbeRunner` with the shared `transport` (already behind the read gate), the shared `collectionLock`, `readCollectionPacing(settings)`, `systemRandom`, and `createBoardPageFetcher(transport, () => randomUUID(), ATTENDANCE_BOARD_MENU_ID)`; report errors with `diagnostics.error('attendance', …)` passing only an error code or class name, never a message that could quote a row. Stop the run where the other runners are stopped at shutdown.

- [ ] **Step 4: Run to verify they pass** — `pnpm typecheck && pnpm test`.

- [ ] **Step 5: Commit** — `git commit -m "feat: expose the attendance collection to the renderer"`

---

### Task 8: The screen

**Files:**
- Modify: `src/shared/text.ts`, `src/renderer/routes.ts`, `src/renderer/App.tsx`, `src/renderer/store.ts`
- Create: `src/renderer/views/members/AttendanceRecords.tsx`
- Test: `tests/renderer/routes.test.ts`, `tests/renderer/attendanceRecords.test.ts`

**Interfaces:**
- Consumes: `AttendanceView` and the three `RendererApi` methods (Task 7).
- Produces: `Route` variant `{ readonly kind: 'attendance' }`; `TEXT.nav.attendance`; `TEXT.attendance`.

Strings (exact):

```ts
nav: { attendance: '개근 기록' }
attendance: {
  pageHeading: '개근 기록',
  why: 'Member of the Month 게시판의 댓글·게시글·방문 개근 글에서 닉네임과 기간을 읽어 저장합니다. 글과 회원에게는 어떤 조치도 하지 않습니다.',
  start: '수집 시작',
  stop: '중지',
  lastRead: (when: string) => `마지막 수집 ${when} (KST)`,
  neverRead: '아직 수집한 적이 없습니다.',
  kind: { comment: '댓글', post: '게시글', visit: '방문' },
  columns: { kind: '종류', rounds: '회차', awards: '달성 건수', earliest: '가장 이른 기간', latest: '가장 최근 기간' },
  period: (startDay: string, endDay: string) => `${startDay} ~ ${endDay}`,
  noPeriod: '-',
  listing: (page: number) => `목록 ${page}쪽을 읽는 중`,
  reading: (read: number, total: number) => `글 ${read} / ${total}`,
  done: (total: number) => `수집을 마쳤습니다. 새로 읽은 글 ${total}건.`,
  stopped: '수집을 중지했습니다. 다시 시작하면 남은 글부터 읽습니다.',
  failed: (code: string) => `수집이 멈췄습니다 (${code}). 다시 시작하면 남은 글부터 읽습니다.`,
  notStarted: {
    ALREADY_RUNNING: '이미 수집 중입니다.',
    EXTENSION_OFFLINE: '확장 프로그램이 연결되어 있지 않습니다.',
    DATABASE_DISABLED: '수집 DB가 설정되어 있지 않습니다.',
    COLLECTION_BUSY: '다른 수집이 진행 중입니다. 끝난 뒤 다시 시작해 주세요.',
  },
  refusedHeading: (count: number) => `읽지 못한 글 ${count}건`,
  refusedRule: {
    PERIOD_UNREADABLE: '기간을 읽지 못함',
    ARTICLE_ABSENT: '글이 삭제되었거나 읽을 수 없음',
    NO_CLOSING_PHRASE: '끝맺는 문구가 없음',
    NO_WINNERS: '닉네임이 없음',
    EMPTY_NICKNAME: '빈 닉네임이 있음',
  },
  unknownRule: (rule: string) => rule,
}
```

- [ ] **Step 1: Write the failing tests**

- `routes.test.ts`: `routeKey({ kind: 'attendance' })` is `'attendance'`, plus whatever invariant that file asserts for every route.
- `attendanceRecords.test.ts`, in the style of the existing renderer view tests: given a view with the Task 5 status example, the table shows three rows in the order 댓글, 게시글, 방문 with `1 / 2`, `0 / 0 / - / -`, `2 / 4`, and the refused list shows `412345`, its title and `기간을 읽지 못함`; `state: 'reading', postsRead: 12, postsTotal: 600` shows `글 12 / 600` and a 중지 button instead of 수집 시작; `status: null` shows `수집 DB가 설정되어 있지 않습니다.` and a disabled start button; a start that returns `COLLECTION_BUSY` shows its sentence.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

Layout per the spec's sketch (§5 화면). Nav: a third button in the members section of `App.tsx`, after `aiJoinCheck`, built the same way. The screen refreshes its view the way `MemberCollectionCard` gets fresh data today, and at least every 2 seconds while `state` is `listing` or `reading`. `lastReadAtMs` is formatted with the KST formatter the other member screens use. Numbers use the thousands separator the member screens use.

- [ ] **Step 4: Run to verify they pass** — `pnpm typecheck && pnpm test && npx eslint src tests scripts`.

- [ ] **Step 5: Commit** — `git commit -m "feat: show attendance records under the members section"`

---

### Task 9: Whole-branch check

- [ ] **Step 1:** `pnpm typecheck && pnpm test && npx eslint src tests scripts && pnpm build:all` → all pass, no warnings.
- [ ] **Step 2:** The integration command from Global Constraints → PASS.
- [ ] **Step 3:** `grep -rn "TODO\|test.skip\|\.only(" src tests` shows nothing new from this branch.
- [ ] **Step 4:** Hand the operator the run notes: quit the app, `pnpm db:collection:migrate`, start the app (the extension restages to protocol 15), open 회원 → 개근 기록, 수집 시작. The first run makes about 24 list reads and 600 article reads at the collection pacing — roughly two hours at the default pacing — and holds the collection lock for that time, so other collection walks wait. Check the result against §3's table: 963461 → 81, 963460 → 16, 148887 → 1,262, 190879 → 7, 348253 → 25, 640215 → 4,993.
