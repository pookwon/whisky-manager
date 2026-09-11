# 말머리 안내 댓글 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카페 전체의 오늘 글 가운데 말머리 없이 올라온 글에 약 2시간마다 고정 안내 댓글을 다는 두 번째 자동화를, 가입인사 자동화와 같은 판단 계층 위에 얹는다.

**Architecture:** 오케스트레이터(`runSession`)는 그대로 두고 수집·가드·정산 키를 자동화별로 주입받게 리팩터링한다. 새 모듈 `src/shared/automations/prefix-reminder/`가 전체글 목록에서 오늘 글을 읽어 말머리·제외 게시판·운영자 글을 claim 앞에서 걸러 후보만 넘긴다. 확장은 `automationId`로 메모 게시판 클라이언트와 일반 글 클라이언트를 고른다. 세션 한 줄 로그가 두 자동화 모두를 적는다.

**Tech Stack:** TypeScript (ESM, `.js` import suffix), Electron main + React renderer, Chrome MV3 extension, better-sqlite3 + drizzle-orm, vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-prefix-reminder-design.md`

## Global Constraints

- 코드·주석·커밋 메시지는 영어. 사용자에게 보이는 문구는 한국어이며 `src/shared/text.ts`에만 둔다(CLAUDE.md).
- 시각 표시는 KST. `KST_OFFSET_MS`(`src/shared/kst.ts`)만 쓴다. `toLocaleString`, `getUTCHours` 직접 사용 금지.
- `switch`/`else if`로 자동화를 분기하지 않는다. 자동화별 동작은 주입 또는 `Record<id, …>`로.
- 새 파일은 새 책임. 800줄 초과 파일 금지. 200~400줄이 보통.
- 커밋마다 `pnpm typecheck && pnpm lint && pnpm test` 통과. 커밋 메시지는 `<type>: <description>` 형식, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `git checkout <file>`/`git restore`/`git reset`로 되돌리지 않는다. 되돌릴 일은 Edit로 반대 편집.
- 프로토콜 메시지 모양이 바뀌면 `PROTOCOL_VERSION`(`src/shared/protocol.ts`)을 올린다. 이 계획은 10 → 11.
- `RawCandidate`/`Candidate`/`SessionDeps` 등 공유 타입을 바꾼 뒤에는 `pnpm typecheck`가 가리키는 모든 호출처(테스트 포함)를 같은 커밋에서 고친다.
- 테스트는 vitest. 실행: `pnpm vitest run <path> -t "<name>"` 또는 전체 `pnpm test`. SQLite를 쓰는 테스트는 `openDatabase(join(mkdtempSync(...), 'test.db'), { migrationsFolder: MIGRATIONS })` 패턴(`tests/desktop/orchestrator.test.ts` 상단 참고).

---

## 파일 지도

| 파일 | 책임 | 작업 |
|---|---|---|
| `docs/superpowers/specs/<날짜>-cafe-article-comment-contract.md` (신규) | 일반 글 댓글 읽기·쓰기 계약 | 1 |
| `tests/fixtures/article-comments-{some,none,deleted}.json` (신규) | 캡처한 댓글 응답 | 1 |
| `src/shared/protocol.ts` | `RawCandidate.boardId/prefix`, 버전 11 | 2 |
| `src/shared/types.ts` | `Candidate.prefix` | 2 |
| `src/shared/automations/welcome-comment/parse.ts` | `boardId` 채움 | 2 |
| `src/shared/screening.ts` | `toCandidate`가 후보의 `boardId`/`prefix` 사용 | 2 |
| `src/desktop/orchestrator.ts` | `SessionDeps.collectDay` 주입, `boardId` 제거 | 3 |
| `src/desktop/collection.ts` | `createWelcomeDayCollector` (기존 `collectDay`를 팩토리로) | 3 |
| `src/desktop/session.ts` | `guards`, `collectDay`, `settledDayKey` 옵션 | 3 |
| `src/desktop/preview.ts` | `collectDay` 주입 | 3 |
| `src/desktop/automationRuntime.ts` (신규) | 러너+루프+상태 한 벌 | 4 |
| `src/desktop/bootstrap.ts` | 카탈로그마다 런타임, 자동화별 조회 | 4 |
| `src/desktop/main.ts`, `src/desktop/rendererApi.ts`, `src/desktop/ipc.ts` | 자동화별 `lastOutcome`/`nextRunAt`/`progress`/`runOnce` | 4 |
| `src/shared/automations/prefix-reminder/articleCafe.ts` (신규) | 일반 글 댓글 URL·요청·파서 (순수) | 5 |
| `src/extension/articleClient.ts` (신규) | 일반 글 댓글 읽기·쓰기 클라이언트 | 5 |
| `src/extension/background.ts` | `automationId` 라우팅 | 5 |
| `src/shared/automations/prefix-reminder/{options,eligibility,guards,render,limits}.ts` (신규) | 모듈 | 6 |
| `src/desktop/prefixReminderCollection.ts` (신규) | 오늘 전체글 수집기 | 6 |
| `src/shared/automations/catalog.ts`, `src/shared/text.ts` | 항목·문구 | 6 |
| `src/desktop/sessionLog.ts` (신규), `src/desktop/refusalLog.ts` | 세션 한 줄 로그 | 7 |
| `drizzle/0008_*.sql`, `src/desktop/db/schema.ts`, `automationSettingsRepo.ts` | `options_json` | 8 |
| `src/renderer/views/AutomationSettings.tsx`, `views/settings/*.tsx` (신규) | 공통부 + 자동화별 섹션 | 9 |
| `src/renderer/views/Dashboard.tsx`, `views/dashboard/CommentJob.tsx` | 자동화별 카드 | 9 |
| `src/shared/configBundle.ts`, `src/desktop/configTransfer.ts` | `options` 이관 | 10 |

---

### Task 1: Phase 0 — 일반 글 댓글 계약 캡처

**Files:**
- Create: `docs/superpowers/specs/<오늘 날짜>-cafe-article-comment-contract.md`
- Create: `tests/fixtures/article-comments-some.json`, `tests/fixtures/article-comments-none.json`, `tests/fixtures/article-comments-deleted.json`

**Interfaces:**
- Produces: 계약 문서가 Task 5의 `articleCafe.ts`에 들어갈 상수를 확정한다 — 읽기 URL 형식, 응답에서 댓글 배열·작성자 닉네임·memberKey·삭제 표시가 있는 경로, 쓰기 URL·메서드·본문 형식·필수 헤더(referer 등)·성공 응답 모양.

이 작업은 운영자와 함께 한다. 운영자가 실행하고, 결과를 이 저장소에 넣는다.

- [ ] **Step 1: 읽기 응답 캡처 — 댓글 있는 글**

운영자에게 안내: Chrome에서 카페의 아무 일반 게시판 글(댓글이 2개 이상 달린 것) 하나를 연다. DevTools → Network → `apis.naver.com` 필터. 페이지를 새로고침하고 댓글 목록을 내려받는 요청의 URL을 복사한다(경로에 `comments`가 들어간 GET). 그 URL과 글 id를 받아 둔다.

```bash
pnpm probe "<복사한 댓글 목록 URL>" tests/fixtures/article-comments-some.json
```

`scripts/probe.mjs`는 브릿지를 띄우고 확장이 페어링되기를 기다린 뒤 브라우저 세션으로 GET 한 번을 보내 본문을 파일에 쓴다. 실행 전 `pnpm build`가 필요하다(`pnpm probe`가 포함). 확장 옵션 페이지에 화면에 찍힌 토큰을 넣어야 페어링된다.

- [ ] **Step 2: 읽기 응답 캡처 — 댓글 없는 글, 삭제된 댓글 포함 글**

같은 방법으로 두 번 더. 댓글이 없는 글 → `article-comments-none.json`. 운영자가 댓글 하나를 달고 지운 글 → `article-comments-deleted.json` (삭제 댓글이 응답에 어떻게 남는지 보기 위함. 응답에서 아예 사라지면 그 사실을 문서에 적는다).

- [ ] **Step 3: 쓰기 요청 캡처**

운영자에게 안내: DevTools Network를 연 채 그 글에 짧은 댓글 하나("테스트")를 단다. 방금 생긴 POST 요청을 우클릭 → Copy → Copy as cURL. 그 텍스트를 받는다. **쿠키·토큰 값은 문서에 옮기지 않는다** — 필드 이름과 형식만. 그 댓글은 운영자가 지운다.

- [ ] **Step 4: 개인정보 제거**

세 픽스처에서 닉네임·memberKey·댓글 본문을 가짜 값으로 바꾼다(구조는 그대로). 예: 닉네임 `회원A`, memberKey `key-a`. 어떤 값을 어떤 값으로 바꿨는지는 문서에 적지 않는다.

- [ ] **Step 5: 계약 문서 작성**

`docs/superpowers/specs/2026-08-30-cafe-article-list-contract.md`의 형식을 따른다. 반드시 들어갈 것:

```markdown
# 네이버 카페 일반 글 댓글 계약 조사

- 조사일: <날짜> (KST)
- 대상: 카페 `14538121`, 일반 게시판 글
- 상태: 읽기 픽스처 3종 완료, 쓰기 요청 형식 확인

## 1. 읽기
GET <URL 형식, 카페 id·글 id·페이지 자리를 <cafeId>/<articleId>/<page>로>
- 응답 최상위: `result.comments.items[]` (실제 경로로)
- 작성자 닉네임: `<경로>` / memberKey: `<경로>` / 삭제 표시: `<경로>` 또는 "삭제 댓글은 응답에 없음"
- 성공 판정: `<필드>` 값
- 페이지 크기·정렬: <관찰값>

## 2. 쓰기
<METHOD> <URL>
- Content-Type: <값>
- 본문 필드 (form 또는 JSON): 이름 목록과 각 값의 의미. 우리가 채울 값: cafeId, articleId, content. 나머지는 캡처된 그대로 보낼 고정값.
- 필수 헤더: referer <값 형식>, 그 외 (있으면) 이름만
- CSRF/토큰: 없음 / 있음(어디서 얻는지)
- 문자 인코딩: UTF-8 / MS949
- 성공 응답: <모양>. 실패 응답 예: <모양>

## 3. 메모 게시판과 다른 점
<표>
```

- [ ] **Step 6: 커밋**

```bash
git add docs/superpowers/specs/*-cafe-article-comment-contract.md tests/fixtures/article-comments-*.json
git commit -m "docs: capture the article comment contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `RawCandidate`에 `boardId`와 `prefix` — 프로토콜 11

**Files:**
- Modify: `src/shared/protocol.ts:7` (`PROTOCOL_VERSION`), `:50-63` (`RawCandidate`)
- Modify: `src/shared/types.ts:46-61` (`Candidate`)
- Modify: `src/shared/automations/welcome-comment/parse.ts:60-98`
- Modify: `src/shared/screening.ts:82-94`
- Modify: `src/extension/cafeClient.ts` (`collect`가 `parseMemoList(html, source.boardId)`)
- Test: `tests/shared/automations/welcome-comment/parse.test.ts` (기존 파일; 없으면 `tests/shared/automations/` 아래 parse 테스트를 찾아 그 파일), `tests/shared/screening.test.ts` (신규)

**Interfaces:**
- Produces:
  ```ts
  // src/shared/protocol.ts
  export const PROTOCOL_VERSION = 11
  export interface RawCandidate {
    readonly boardId: string          // NEW: the board the post is on
    readonly postId: string
    readonly title: string | null
    readonly bodyText: string | null
    readonly authorNickname: string | null
    readonly authorId: string | null
    readonly postedAt: number
    readonly commentCount: number | null
    readonly prefix: string | null    // NEW: 말머리, null when the post has none
  }
  // src/shared/types.ts — Candidate gains `readonly prefix: string | null`
  // parse.ts
  export function parseMemoList(html: string, boardId: string): RawCandidate[]
  ```

- [ ] **Step 1: 파서 테스트에 `boardId`/`prefix` 기대값 추가**

기존 parse 테스트에서 `parseMemoList(html)` 호출을 찾아 `parseMemoList(html, '5')`로 바꾸고, 첫 후보에 대해 다음을 추가한다:

```ts
it('stamps every candidate with the board it was read from and no prefix', () => {
  const candidates = parseMemoList(listHtml, '5')
  expect(candidates.length).toBeGreaterThan(0)
  for (const candidate of candidates) {
    expect(candidate.boardId).toBe('5')
    expect(candidate.prefix).toBeNull()
  }
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/shared/automations -t "stamps every candidate"`
Expected: FAIL — `boardId` undefined / 인자 수 타입 오류.

- [ ] **Step 3: 타입과 파서 수정**

`protocol.ts`: `PROTOCOL_VERSION = 11`; `RawCandidate`에 위 두 필드 추가(주석 포함).
`types.ts`: `Candidate`에 `readonly prefix: string | null` 추가, 주석: `/** 말머리 the board list showed for the post; null when it carries none. */`.
`parse.ts`: 시그니처 `parseMemoList(html: string, boardId: string)`, push하는 객체에 `boardId, prefix: null` 추가.
`screening.ts` `toCandidate`: `boardId: raw.boardId, prefix: raw.prefix` (`ctx.source.boardId` 대신).
`cafeClient.ts` `collect`: `parseMemoList(response.text, source.boardId)`.

- [ ] **Step 4: 타입체크로 나머지 호출처 찾기**

Run: `pnpm typecheck`
Expected: `RawCandidate` 리터럴을 만드는 테스트들이 실패한다 — `tests/desktop/orchestrator.test.ts`, `session.test.ts`, `preview.test.ts`, `commentAuthors.test.ts`, `collection.test.ts`, `tests/extension/cafeClient.test.ts` 등. 각 리터럴에 `boardId: '5'`(그 테스트의 BOARD 상수), `prefix: null`을 넣는다. `tests/shared/protocol.test.ts`가 버전을 단언하면 11로.

- [ ] **Step 5: 전체 통과 확인**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add -A src tests
git commit -m "refactor: carry each candidate's board and prefix on the wire

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 세션이 수집기·가드·정산 키를 주입받는다

**Files:**
- Modify: `src/desktop/orchestrator.ts:19-71` (`SessionDeps`), `:364-391` (`workDay`), `:210-225` (`checkLogin`)
- Modify: `src/desktop/collection.ts`
- Modify: `src/desktop/session.ts`
- Modify: `src/desktop/preview.ts:24-58`, `:85-100`
- Modify: `src/desktop/bootstrap.ts` (호출처만; 구조는 Task 4)
- Test: `tests/desktop/orchestrator.test.ts`, `tests/desktop/session.test.ts`, `tests/desktop/preview.test.ts`, `tests/desktop/collection.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/desktop/collection.ts
  export type DayCollector = (
    dayStartMs: number,
    onProgress?: (pagesRead: number, collected: number) => void,
  ) => Promise<RawCandidate[] | null>

  export interface WelcomeDayCollectorDeps {
    readonly transport: ExtensionTransport
    readonly automationId: string
    readonly source: SourceRef
    readonly newRequestId: () => string
  }
  /** The memo board's own day, through COLLECT. Trims to the KST day. */
  export function createWelcomeDayCollector(deps: WelcomeDayCollectorDeps): DayCollector

  // src/desktop/orchestrator.ts — SessionDeps
  //   REMOVE: boardId
  //   ADD:    readonly collectDay: DayCollector
  //   `cafeId` stays (login check, claim rows).
  //   checkLogin needs a board to read: ADD readonly loginSource: SourceRef

  // src/desktop/session.ts
  export interface SessionRunnerOptions {
    // existing fields, plus:
    readonly guards: readonly Guard[]
    /** Builds the day collector once the cafe and operator accounts are known. */
    readonly collector: (context: CollectorContext) => DayCollector
    /** Settings key holding midnight KST of the last settled day. */
    readonly settledDayKey: string
    /** Board the login check reads. Null falls back to the automation's own boardId setting. */
    readonly loginBoardId: () => string | null
    /** Refuses with NOT_CONFIGURED when false. Welcome needs a board; a cafe-wide automation does not. */
    readonly requiresBoard: boolean
  }
  export interface CollectorContext {
    readonly cafeId: string
    readonly boardId: string | null
    readonly operatorAccounts: readonly string[]
  }
  export const SETTING_KEYS = { …, lastSettledDay: 'lastSettledDayStartMs' } // unchanged
  export function settledDayKeyFor(automationId: string): string
  //   returns SETTING_KEYS.lastSettledDay for WELCOME_AUTOMATION_ID (keeps the stored value),
  //   `${SETTING_KEYS.lastSettledDay}:${automationId}` otherwise.

  // src/desktop/preview.ts — PreviewDeps: REMOVE boardId; ADD readonly collectDay: DayCollector
  ```

- [ ] **Step 1: `collection.test.ts`를 팩토리 형태로**

기존 `collectDay({...})` 호출을 `createWelcomeDayCollector({transport, automationId, source, newRequestId})(dayStartMs, onProgress)`로 바꾼다. 동작 단언은 그대로.

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/desktop/collection.test.ts`
Expected: FAIL — `createWelcomeDayCollector` is not exported.

- [ ] **Step 3: `collection.ts` 팩토리화**

```ts
export function createWelcomeDayCollector(deps: WelcomeDayCollectorDeps): DayCollector {
  return async (dayStartMs, onProgress) => {
    const day = kstDayRange(dayStartMs)
    try {
      const reply = await deps.transport.request(
        { type: 'COLLECT', requestId: deps.newRequestId(), automationId: deps.automationId, source: deps.source, sincePostedAt: day.startMs },
        TIMEOUTS.collectMs,
        (interim) => { if (interim.type === 'COLLECT_PROGRESS') onProgress?.(interim.pagesRead, interim.collected) },
      )
      if (reply.type !== 'COLLECTED') return null
      return reply.candidates.filter((raw) => raw.postedAt < day.endMs)
    } catch {
      return null
    }
  }
}
```

기존 `collectDay` export는 지운다(호출처는 이 작업에서 모두 옮긴다).

- [ ] **Step 4: `orchestrator.test.ts`의 `deps()`를 새 모양으로**

`boardId: '5'` 제거, 추가:

```ts
loginSource: { cafeId: '10000000', boardId: '5' },
collectDay: (dayStartMs) => Promise.resolve(candidatesForDay(dayStartMs)),
```

`fakeTransport`의 `COLLECT` 분기는 남겨도 되지만 이제 오케스트레이터가 부르지 않는다. `options.candidates`를 쓰던 테스트는 `collectDay: () => Promise.resolve(candidates)`로, `COLLECT_FAILED`를 시험하던 테스트는 `collectDay: () => Promise.resolve(null)`로 바꾼다. 어제/오늘을 나누어 주던 테스트는 `collectDay: (day) => Promise.resolve(day === YESTERDAY ? yesterdays : todays)`.

- [ ] **Step 5: 실패 확인**

Run: `pnpm vitest run tests/desktop/orchestrator.test.ts`
Expected: FAIL — 타입 불일치.

- [ ] **Step 6: `orchestrator.ts` 수정**

`SessionDeps`: `boardId` 삭제, `loginSource: SourceRef`, `collectDay: DayCollector` 추가.
`checkLogin`: `source: deps.loginSource`.
`workDay`:

```ts
deps.onProgress?.({ phase: 'COLLECTING' })
const raws = await deps.collectDay(dayStartMs, (pagesRead, collected) =>
  deps.onProgress?.({ phase: 'COLLECTING', pagesRead, collected }),
)
if (raws === null) return 'COLLECT_FAILED'

const screening: ScreeningContext = {
  automationId: deps.automationId,
  source: { cafeId: deps.cafeId, boardId: deps.loginSource.boardId }, // kept for ScreeningContext; toCandidate no longer reads boardId from it
  ...
}
```

`ScreeningContext.source`는 Task 2에서 `toCandidate`가 더 이상 읽지 않으므로, 여기서 `source` 필드를 `ScreeningContext`에서 지우고 `cafeId: string`로 바꾼다(`screening.ts`와 `preview.ts` 동시 수정). claim과 runJob은 `raw.boardId`/`candidate.boardId`를 쓴다:

```ts
const executionId = await deps.dedupe.claim({ automationId: deps.automationId, cafeId: deps.cafeId, boardId: raw.boardId, postId: raw.postId, ... })
```

`import { collectDay } from './collection.js'` 제거, `import type { DayCollector } from './collection.js'` 추가.

- [ ] **Step 7: `session.ts` 수정**

`SessionRunnerOptions`에 인터페이스 블록의 다섯 필드 추가. `WELCOME_GUARDS` import 제거. `run` 안:

```ts
const cafe = settings.get(SETTING_KEYS.cafeId)
const board = options.loginBoardId() ?? setting?.boardId ?? null
if (!isConfigured(cafe) || (options.requiresBoard && !isConfigured(board))) {
  return { opened: false, reason: 'NOT_CONFIGURED' }
}
const operatorAccounts = parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts))
const collectDay = options.collector({ cafeId: cafe.trim(), boardId: board?.trim() ?? null, operatorAccounts })
```

`runSession`에 `loginSource: { cafeId: cafe.trim(), boardId: (board ?? '').trim() }`, `collectDay`, `guards: options.guards`. `lastSettledDay`/`onDaySettled`는 `settings.get(options.settledDayKey)` / `settings.set(options.settledDayKey, …)`.

`createCommentAuthorLookup`의 `boardId`: 후보마다 게시판이 다를 수 있으므로 `CommentAuthorLookupDeps`에서 `boardId`를 빼고 `resolve(postId, commentCount, boardId)`로 바꾼다 — `commentAuthors.ts`와 그 테스트, 오케스트레이터 호출(`resolve(raw.postId, raw.commentCount, raw.boardId)`), `preview.ts`도 같이. `bootstrap.ts`의 `commentLookupFor(source)`는 캐시 키를 `cafeId`로만 잡는다.

`settledDayKeyFor` 추가:

```ts
export function settledDayKeyFor(automationId: string): string {
  // The first automation wrote its day under the bare key; keeping that spelling keeps the value.
  return automationId === WELCOME_AUTOMATION_ID ? SETTING_KEYS.lastSettledDay : `${SETTING_KEYS.lastSettledDay}:${automationId}`
}
```

- [ ] **Step 8: `preview.ts` 수정**

`PreviewDeps`: `boardId` 삭제, `collectDay: DayCollector` 추가. 본문의 `collectDay({...})` 호출을 `deps.collectDay(dayStartMs)`로. `lookup.resolve(raw.postId, raw.commentCount, raw.boardId)`.

- [ ] **Step 9: `session.test.ts`, `preview.test.ts` 수정**

`createSessionRunner({...})`에 추가:

```ts
guards: WELCOME_GUARDS,
collector: (ctx) => createWelcomeDayCollector({ transport, automationId: WELCOME_AUTOMATION_ID, source: { cafeId: ctx.cafeId, boardId: ctx.boardId ?? '' }, newRequestId: () => `req-${++counter}` }),
settledDayKey: SETTING_KEYS.lastSettledDay,
loginBoardId: () => null,
requiresBoard: true,
```

`previewDay({...})`에서 `boardId` 제거, `collectDay: createWelcomeDayCollector({...})` 추가. `bootstrap.ts`의 두 `previewDay` 호출과 `createSessionRunner` 호출도 같은 식으로 (Task 4가 다시 정리하지만 지금 컴파일은 되어야 한다).

- [ ] **Step 10: 전체 통과**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. 오케스트레이터·세션 테스트의 시나리오와 단언은 바뀌지 않았다 — 이것이 "동작 변화 없음"의 증거다.

- [ ] **Step 11: 커밋**

```bash
git add -A src tests
git commit -m "refactor: let a session be handed its collector, guards and settled-day key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 자동화 런타임 한 벌, 카탈로그마다 하나

**Files:**
- Create: `src/desktop/automationRuntime.ts`
- Modify: `src/desktop/bootstrap.ts:60-140` (인터페이스), `:250-420` (조립), `:520-590` (반환)
- Modify: `src/desktop/main.ts:240-275`
- Modify: `src/desktop/rendererApi.ts:80-110`, `:340-390`, `:538-548`
- Modify: `src/desktop/ipc.ts:60-100`, `:240-250`, `:343`
- Test: `tests/desktop/automationRuntime.test.ts` (신규), `tests/desktop/bootstrap.test.ts`, `tests/desktop/rendererApi.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/desktop/automationRuntime.ts
  export interface AutomationRuntimeDeps {
    readonly automationId: string
    readonly limits: Limits                         // profile + automation defaults, before DB overrides
    readonly clock: Clock
    readonly random: Random
    readonly runSession: (request?: SessionRequest) => Promise<SessionOutcome>
    readonly onOutcome: (outcome: SessionOutcome, wake: WakeRecord | null) => void
    readonly onHalt: (reason: 'NOT_LOGGED_IN' | 'LOGIN_CHECK_FAILED') => void
    readonly onError: (error: unknown) => void
    readonly setTimer: (fn: () => void, ms: number) => TimerHandle
    readonly clearTimer: (handle: TimerHandle) => void
  }
  export interface AutomationRuntime {
    readonly automationId: string
    start(): void; stop(): void
    isRunning(): boolean
    nextRunAt(): number | null
    runOnce(request?: SessionRequest): Promise<void>
    lastOutcome(): SessionOutcome | null
    lastOutcomeAt(): number | null
    sessionProgress(): SessionProgress | null
    /** Called by the session runner's onProgress. */
    reportProgress(progress: SessionProgress | null): void
  }
  export function createAutomationRuntime(deps: AutomationRuntimeDeps): AutomationRuntime

  // bootstrap.ts — AutomationControl
  export interface AutomationControl {
    start(): void; stop(): void; kill(): void        // all runtimes together
    isRunning(): boolean                              // any runtime running
    runOnce(automationId: string, request?: SessionRequest): Promise<void>
    nextRunAt(automationId: string): number | null
  }
  // AppContext: lastOutcome(automationId), lastOutcomeAt(automationId), sessionProgress(automationId)
  // AppContext.isAnySessionInFlight(): boolean   — for the collection runners' isSessionBusy

  // ipc.ts
  export interface AutomationStatus {
    readonly id: string; readonly enabled: boolean
    readonly awaitingApproval: number; readonly executedToday: number
    readonly lastOutcome: SessionOutcome | null
    readonly lastOutcomeAt: number | null          // NEW
    readonly nextSessionAt: number | null          // NEW
    readonly sessionProgress: SessionProgress | null // NEW
  }
  // DashboardSnapshot keeps lastOutcome/lastOutcomeAt/sessionProgress as the welcome automation's
  // (the banner and DayRhythm read them); nextSessionAt becomes the earliest across automations.
  // RendererApi.runOnce(automationId: string, request?: { force?: boolean; dayStartMs?: number })
  // RendererApiDeps: lastOutcome/lastOutcomeAt/nextSessionAt/sessionProgress all take automationId.
  ```

- [ ] **Step 1: 런타임 테스트**

`tests/desktop/automationRuntime.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createAutomationRuntime } from '../../src/desktop/automationRuntime.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

function runtime(outcome = { opened: true, executed: 1, skipped: 0, awaitingApproval: 0, failed: 0 } as const) {
  const outcomes: unknown[] = []
  const rt = createAutomationRuntime({
    automationId: 'x',
    limits: PROFILES.debug,
    clock: new FakeClock(MON_10_00),
    random: new SequenceRandom([0]),
    runSession: () => Promise.resolve(outcome),
    onOutcome: (o) => outcomes.push(o),
    onHalt: () => {},
    onError: () => {},
    setTimer: () => 1,
    clearTimer: () => {},
  })
  return { rt, outcomes }
}

describe('createAutomationRuntime', () => {
  it('remembers the last outcome and when it arrived', async () => {
    const { rt, outcomes } = runtime()
    expect(rt.lastOutcome()).toBeNull()
    await rt.runOnce()
    expect(rt.lastOutcome()).toEqual({ opened: true, executed: 1, skipped: 0, awaitingApproval: 0, failed: 0 })
    expect(rt.lastOutcomeAt()).toBe(MON_10_00)
    expect(outcomes).toHaveLength(1)
  })

  it('clears progress once the session ends, even one that threw', async () => {
    const rt = createAutomationRuntime({
      automationId: 'x', limits: PROFILES.debug, clock: new FakeClock(MON_10_00), random: new SequenceRandom([0]),
      runSession: () => { rt.reportProgress({ phase: 'COLLECTING' }); return Promise.reject(new Error('boom')) },
      onOutcome: () => {}, onHalt: () => {}, onError: () => {}, setTimer: () => 1, clearTimer: () => {},
    })
    await rt.runOnce()
    expect(rt.sessionProgress()).toBeNull()
  })

  it('reports the next scheduled run only while running', () => {
    const { rt } = runtime()
    expect(rt.nextRunAt()).toBeNull()
    rt.start()
    expect(rt.nextRunAt()).not.toBeNull()
    rt.stop()
    expect(rt.nextRunAt()).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run tests/desktop/automationRuntime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: `automationRuntime.ts` 구현**

```ts
import type { Clock, Random } from '../shared/ports.js'
import type { Limits } from '../shared/types.js'
import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import type { SessionRequest } from './session.js'
import { createSessionLoop, type TimerHandle, type WakeRecord } from './sessionLoop.js'

/**
 * One automation's loop and the state its screens read. Bootstrap makes one
 * per catalogue entry; nothing here knows which automation it is running.
 */
export function createAutomationRuntime(deps: AutomationRuntimeDeps): AutomationRuntime {
  let lastOutcome: SessionOutcome | null = null
  let lastOutcomeAt: number | null = null
  let progress: SessionProgress | null = null

  const loop = createSessionLoop({
    limits: deps.limits,
    clock: deps.clock,
    random: deps.random,
    runSession: async (request) => {
      // Progress means something only while a session is in flight; a session
      // that died must not leave the dashboard claiming it is still working.
      try {
        return await deps.runSession(request)
      } finally {
        progress = null
      }
    },
    onOutcome: (outcome, wake) => {
      lastOutcome = outcome
      lastOutcomeAt = deps.clock.now()
      deps.onOutcome(outcome, wake)
    },
    onError: deps.onError,
    onHalt: deps.onHalt,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
  })

  return {
    automationId: deps.automationId,
    start: () => loop.start(),
    stop: () => loop.stop(),
    isRunning: () => loop.isRunning(),
    nextRunAt: () => loop.nextRunAt(),
    runOnce: (request) => loop.runOnce(request),
    lastOutcome: () => lastOutcome,
    lastOutcomeAt: () => lastOutcomeAt,
    sessionProgress: () => progress,
    reportProgress: (next) => { progress = next },
  }
}
```

(`AutomationRuntimeDeps`, `AutomationRuntime` 인터페이스는 위 블록 그대로 파일 상단에.)

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run tests/desktop/automationRuntime.test.ts`
Expected: PASS.

- [ ] **Step 5: `bootstrap.ts` 재조립**

- `createSessionRunner` + `createSessionLoop` + `lastOutcome/lastOutcomeAt/sessionProgress/runSessionReportingProgress` 블록을 지우고, 아래 함수를 만들어 카탈로그마다 호출한다:

```ts
interface RuntimeSpec {
  readonly automationId: string
  readonly limits: Limits
  readonly guards: readonly Guard[]
  readonly collector: (ctx: CollectorContext) => DayCollector
  readonly renderBody: (candidate: Candidate) => RenderOutcome
  readonly hasBody: () => boolean
  readonly loginBoardId: () => string | null
  readonly requiresBoard: boolean
}

const runtimes = new Map<string, AutomationRuntime>()
const buildRuntime = (spec: RuntimeSpec): AutomationRuntime => {
  const runtime: AutomationRuntime = createAutomationRuntime({
    automationId: spec.automationId,
    limits: spec.limits,
    clock: systemClock,
    random: systemRandom,
    runSession: createSessionRunner({
      automationId: spec.automationId,
      profile: options.profile,
      clock: systemClock, random: systemRandom, transport, repos, settings,
      isKilled: () => killed,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      newId: () => randomUUID(),
      renderBody: spec.renderBody,
      hasBody: spec.hasBody,
      guards: spec.guards,
      collector: spec.collector,
      settledDayKey: settledDayKeyFor(spec.automationId),
      loginBoardId: spec.loginBoardId,
      requiresBoard: spec.requiresBoard,
      onProgress: (progress) => runtime.reportProgress(progress),
    }),
    onOutcome: (outcome, wake) => { /* Task 7 writes the session log here */ },
    onError: (error) => console.error(`[session:${spec.automationId}]`, error),
    onHalt: (reason) => {
      console.warn(`[session:${spec.automationId}] halted:`, reason)
      // Login is cafe-wide: one runtime finding it gone means every runtime's next session would too.
      for (const other of runtimes.values()) other.stop()
      warmer.stop()
      options.onHalt?.(reason)
    },
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
  })
  runtimes.set(spec.automationId, runtime)
  return runtime
}
```

`session.ts`의 `hasTemplate` 판정이 지금 `repos.templates.listEnabled(automationId).length > 0`로 박혀 있으므로, `SessionRunnerOptions`에 `hasBody: () => boolean`을 추가하고 `runSession`의 `hasTemplate: options.hasBody`로 넘긴다(Task 3의 테스트 두 곳에 `hasBody: () => repos.templates.listEnabled(WELCOME_AUTOMATION_ID).length > 0` 추가).

가입인사 spec:

```ts
buildRuntime({
  automationId: WELCOME_AUTOMATION_ID,
  limits: PROFILES[options.profile],
  guards: WELCOME_GUARDS,
  collector: (ctx) => createWelcomeDayCollector({ transport, automationId: WELCOME_AUTOMATION_ID, source: { cafeId: ctx.cafeId, boardId: ctx.boardId ?? '' }, newRequestId: () => randomUUID() }),
  renderBody: renderWelcomeBody,
  hasBody: () => enabledTemplates().length > 0,
  loginBoardId: () => null,
  requiresBoard: true,
})
```

- `assertRuntimesRegistered([...runtimes.keys()])`를 조립 뒤에.
- `automation` 제어: `start/stop/kill`은 `for (const r of runtimes.values())`; `isRunning: () => [...runtimes.values()].some((r) => r.isRunning())`; `runOnce: (id, req) => runtimes.get(id)?.runOnce(req) ?? Promise.reject(new Error(\`no runtime: ${id}\`))`; `nextRunAt: (id) => runtimes.get(id)?.nextRunAt() ?? null`.
- `AppContext`: `lastOutcome: (id) => runtimes.get(id)?.lastOutcome() ?? null`, 같은 식으로 `lastOutcomeAt`, `sessionProgress`; `isAnySessionInFlight: () => [...runtimes.values()].some((r) => r.sessionProgress() !== null)`. 수집 러너들의 `isSessionBusy`는 이 함수로.
- `shutdown`: 모든 런타임 `stop()`.
- `previewDay`/시작 미리보기: `boardId` 제거, `collectDay: createWelcomeDayCollector({...source})` 전달.

- [ ] **Step 6: `main.ts`, `rendererApi.ts`, `ipc.ts`**

`main.ts`:
```ts
lastOutcome: (automationId) => appContext.lastOutcome(automationId),
lastOutcomeAt: (automationId) => appContext.lastOutcomeAt(automationId),
nextSessionAt: (automationId) => appContext.automation.nextRunAt(automationId),
sessionProgress: (automationId) => appContext.sessionProgress(automationId),
```
트레이 메뉴의 실행 항목이 `runOnce()`를 부르면 `runOnce(WELCOME_AUTOMATION_ID)`로.

`rendererApi.ts` `getDashboard`:
```ts
const automations: AutomationStatus[] = AUTOMATIONS.map((automation) => ({
  id: automation.id,
  enabled: setting(automation.id)?.enabled ?? false,
  awaitingApproval: repos.executions.countByStatus(automation.id, 'AWAITING_APPROVAL'),
  executedToday: repos.executions.countExecutedForDay(automation.id, dayStart, dayEnd),
  lastOutcome: deps.lastOutcome(automation.id),
  lastOutcomeAt: deps.lastOutcomeAt(automation.id),
  nextSessionAt: deps.nextSessionAt(automation.id),
  sessionProgress: deps.sessionProgress(automation.id),
}))
const welcome = automations.find((a) => a.id === WELCOME_AUTOMATION_ID)
const nextTimes = automations.map((a) => a.nextSessionAt).filter((t): t is number => t !== null)
// ...
lastOutcome: welcome?.lastOutcome ?? null,
lastOutcomeAt: welcome?.lastOutcomeAt ?? null,
sessionProgress: welcome?.sessionProgress ?? null,
nextSessionAt: nextTimes.length === 0 ? null : Math.min(...nextTimes),
```
`runOnce(automationId, request = {})` → `deps.automation.runOnce(automationId, {...})`.

`ipc.ts`: `AutomationStatus` 세 필드, `RendererApi.runOnce(automationId, request?)`. preload(`src/desktop/preload.ts`)가 채널을 인자 그대로 넘기는지 확인 — `runOnce: (automationId, request) => invoke(IPC_CHANNELS.runOnce, automationId, request)` 형태로 맞춘다.

- [ ] **Step 7: 테스트 갱신**

`tests/desktop/bootstrap.test.ts`: `ctx.automation.runOnce()` → `ctx.automation.runOnce(WELCOME_AUTOMATION_ID)`, `ctx.lastOutcome()` → `ctx.lastOutcome(WELCOME_AUTOMATION_ID)`, `sessionProgress()`도 같이. 새 테스트:

```ts
it('boots a runtime for every catalogued automation', async () => {
  for (const automation of AUTOMATIONS) {
    await ctx.automation.runOnce(automation.id)
    expect(ctx.lastOutcome(automation.id)).not.toBeNull()
  }
})
```
(이 시점에는 카탈로그가 하나이므로 통과하고, Task 6에서 둘이 되어도 통과해야 한다.)

`tests/desktop/rendererApi.test.ts`: deps의 네 함수를 `(automationId) => …` 형태로; `getDashboard` 기대 객체의 `automations[0]`에 `lastOutcomeAt`, `nextSessionAt`, `sessionProgress` 추가; `runOnce` 테스트가 `automation.runOnce`에 넘어온 `automationId`를 단언.

- [ ] **Step 8: 전체 통과**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add -A src tests
git commit -m "refactor: build one automation runtime per catalogue entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 일반 글 댓글 클라이언트와 확장 라우팅

**Files:**
- Create: `src/shared/automations/prefix-reminder/articleCafe.ts`
- Create: `src/extension/articleClient.ts`
- Modify: `src/extension/background.ts:137-145` (클라이언트 생성), `:236-262` (dispatch)
- Modify: `src/extension/manifest.json` (쓰기 엔드포인트 host가 `https://apis.naver.com/*`·`https://cafe.naver.com/*` 밖이면 추가; 계약 문서 확인)
- Test: `tests/shared/automations/prefix-reminder/articleCafe.test.ts`, `tests/extension/articleClient.test.ts`, `tests/extension/background.test.ts`(신규 — dispatch만 떼어 시험)

**Interfaces:**
- Consumes: Task 1의 계약 문서.
- Produces:
  ```ts
  // articleCafe.ts — every constant comes from the contract doc
  export function articleCommentListUrl(source: SourceRef, postId: string, page: number): string
  export function parseArticleCommentAuthors(body: string): CommentAuthor[] | null
  export function articleCommentWriteRequest(source: SourceRef, postId: string, content: string): HttpRequest
  export interface HttpRequest { url; method?; body?; contentType?; referer? }  // re-export type from extension/cafeClient is not allowed (shared must not import extension) → move HttpRequest/HttpResponse/Http types to src/shared/http.ts and re-export from cafeClient.ts

  // articleClient.ts
  export interface ArticleClient {
    checkComments(source: SourceRef, postId: string): Promise<CommentAuthor[] | null>
    execute(source: SourceRef, postId: string, content: string, login: LoginState): Promise<ExecuteResult>
  }
  export function createArticleClient(deps: { http: Http; beforeCommentPost?: (source, postId) => Promise<void> }): ArticleClient

  // background.ts
  const commentClients: Record<string, { checkComments; execute }> keyed by automation id
  ```

- [ ] **Step 1: `HttpRequest` 타입을 shared로**

`src/shared/http.ts` 신규: `cafeClient.ts`의 `HttpRequest`, `HttpResponse`, `Http` 정의를 옮기고, `cafeClient.ts`는 `export type { HttpRequest, HttpResponse, Http } from '../shared/http.js'`로 재수출한다. `pnpm typecheck` 통과 확인.

- [ ] **Step 2: `articleCafe` 테스트 — 픽스처 파서**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { articleCommentListUrl, articleCommentWriteRequest, parseArticleCommentAuthors } from '../../../../src/shared/automations/prefix-reminder/articleCafe.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/article-comments-${name}.json`, import.meta.url)), 'utf8')
const source = { cafeId: '14538121', boardId: '137' }

describe('parseArticleCommentAuthors', () => {
  it('lists nickname and member key of every live comment', () => {
    expect(parseArticleCommentAuthors(fixture('some'))).toEqual([
      { nickname: '회원A', memberKey: 'key-a' },   // values as sanitised in Task 1
      { nickname: '회원B', memberKey: 'key-b' },
    ])
  })
  it('returns an empty list for a post nobody commented on', () => {
    expect(parseArticleCommentAuthors(fixture('none'))).toEqual([])
  })
  it('leaves deleted comments out', () => {
    expect(parseArticleCommentAuthors(fixture('deleted'))).toEqual([{ nickname: '회원A', memberKey: 'key-a' }])
  })
  it('returns null for anything that is not the comment response', () => {
    expect(parseArticleCommentAuthors('<html>login</html>')).toBeNull()
    expect(parseArticleCommentAuthors('{}')).toBeNull()
  })
})

describe('urls and requests', () => {
  it('builds the list url the contract names', () => {
    expect(articleCommentListUrl(source, '998877', 1)).toBe('<계약 문서의 URL에 값을 넣은 문자열>')
  })
  it('builds the write request field for field', () => {
    const request = articleCommentWriteRequest(source, '998877', '말머리를 골라 주세요')
    expect(request.method).toBe('POST')
    expect(request.url).toBe('<계약 문서의 쓰기 URL>')
    expect(request.contentType).toBe('<계약 문서의 Content-Type>')
    expect(request.referer).toBe('<계약 문서의 referer 형식에 값을 넣은 문자열>')
    // Body assertion depends on the contract: form → decode with the same helper the memo board uses and compare fields; JSON → JSON.parse and compare object.
  })
})
```

`<…>` 자리는 계약 문서의 값으로 채운다. 계약 문서가 없으면 이 작업을 시작하지 않는다.

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run tests/shared/automations/prefix-reminder/articleCafe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: `articleCafe.ts` 구현**

`welcome-comment/cafe.ts`와 같은 구조. 파서는 `JSON.parse` → 계약 문서의 경로로 배열을 찾고 → 삭제 표시가 있는 항목을 거르고 → `{ nickname, memberKey }`로. 성공 판정 필드가 있으면 그것을 먼저 본다. 경로가 없거나 배열이 아니면 `null`. 쓰기 본문은 계약이 form이면 `encodeFormBody`(MS949) 또는 `new URLSearchParams`(UTF-8) — 계약 문서의 인코딩 항목이 정한다; JSON이면 `JSON.stringify`.

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run tests/shared/automations/prefix-reminder/articleCafe.test.ts`
Expected: PASS.

- [ ] **Step 6: `articleClient` 테스트**

`tests/extension/articleClient.test.ts`, `cafeClient.test.ts`의 harness 방식:

```ts
describe('createArticleClient', () => {
  it('reads who commented', async () => {
    const { client } = harness([{ match: (r) => r.url.includes('/comments'), reply: ok(fixture('some')) }])
    expect(await client.checkComments(source, '998877')).toEqual([{ nickname: '회원A', memberKey: 'key-a' }, { nickname: '회원B', memberKey: 'key-b' }])
  })
  it('refuses to write when not logged in', async () => {
    const { client, seen } = harness([])
    const result = await client.execute(source, '998877', '문구', { loggedIn: false, account: null, memberKey: null })
    expect(result.error).toBe('NOT_LOGGED_IN')
    expect(seen).toHaveLength(0)
  })
  it('counts a write as landed only when the comment reads back under our key', async () => {
    const { client } = harness([
      { match: (r) => r.method === 'POST', reply: ok('<계약의 성공 응답>') },
      { match: (r) => r.url.includes('/comments'), reply: ok(fixture('some-with-ours')) }, // build in-test: fixture('some') with one author's memberKey replaced by 'key-ops'
    ])
    const result = await client.execute(source, '998877', '문구', { loggedIn: true, account: 'ops', memberKey: 'key-ops' })
    expect(result.ok).toBe(true)
  })
  it('reports a write that did not show up', async () => {
    const { client } = harness([
      { match: (r) => r.method === 'POST', reply: ok('<계약의 성공 응답>') },
      { match: (r) => r.url.includes('/comments'), reply: ok(fixture('some')) },
    ])
    const result = await client.execute(source, '998877', '문구', { loggedIn: true, account: 'ops', memberKey: 'key-ops' })
    expect(result).toMatchObject({ ok: false, error: 'COMMENT_NOT_VISIBLE' })
  })
})
```

- [ ] **Step 7: `articleClient.ts` 구현**

`cafeClient.ts`의 `execute`와 같은 흐름이되 로그인 상태를 인자로 받는다(로그인 확인은 메모 게시판 클라이언트가 이미 한다):

```ts
export function createArticleClient(deps: ArticleClientDeps): ArticleClient {
  async function checkComments(source: SourceRef, postId: string): Promise<CommentAuthor[] | null> {
    const response = await deps.http({ url: articleCommentListUrl(source, postId, 1) })
    return response.status === 200 ? parseArticleCommentAuthors(response.text) : null
  }
  return {
    checkComments,
    async execute(source, postId, content, login) {
      if (!login.loggedIn || login.memberKey === null) return { ok: false, commentAuthors: null, error: 'NOT_LOGGED_IN', diagnostic: null }
      await deps.beforeCommentPost?.(source, postId)
      const posted = await deps.http(articleCommentWriteRequest(source, postId, content))
      if (posted.status !== 200) return { ok: false, commentAuthors: null, error: `POST_FAILED_${posted.status}`, diagnostic: diagnose(posted.text) }
      const authors = await checkComments(source, postId)
      if (authors === null) return { ok: false, commentAuthors: null, error: 'COMMENT_CHECK_FAILED', diagnostic: diagnose(posted.text) }
      const landed = authors.some((author) => author.memberKey === login.memberKey)
      return { ok: landed, commentAuthors: authors, error: landed ? null : 'COMMENT_NOT_VISIBLE', diagnostic: landed ? null : diagnose(posted.text) }
    },
  }
}
```

`diagnose`와 `ExecuteResult`는 `cafeClient.ts`에서 export해 재사용한다(`diagnose`를 export로 바꾼다). `cafeClient`에 `currentLogin(): LoginState | null`을 추가해 마지막 `checkLogin` 결과를 내준다(`session` 변수 반환).

- [ ] **Step 8: `background.ts` 라우팅**

```ts
const articleCafe = createArticleClient({ http: request, beforeCommentPost: async () => runLcsDo() })

/** Which client answers for which automation. Unknown ids are refused, never guessed. */
const commentClients: Record<string, { checkComments: (source: SourceRef, postId: string) => Promise<CommentAuthor[] | null>; execute: (source: SourceRef, postId: string, content: string) => Promise<ExecuteResult> }> = {
  [WELCOME_AUTOMATION_ID]: { checkComments: cafe.checkComments, execute: cafe.execute },
  [PREFIX_REMINDER_AUTOMATION_ID]: {
    checkComments: articleCafe.checkComments,
    execute: async (source, postId, content) => articleCafe.execute(source, postId, content, cafe.currentLogin() ?? (await cafe.checkLogin(loginSource)))),
  },
}
```

`loginSource`가 필요하다: 확장은 로그인 확인용 게시판을 모르므로 `EXECUTE`/`CHECK_COMMENTS` 메시지의 `action.cafeId`와 마지막 `CHECK_LOGIN`이 받은 `source`를 기억한다(`let lastLoginSource: SourceRef | null`, `CHECK_LOGIN` 처리 때 갱신). 없으면 `ERROR: LOGIN_UNKNOWN`.

`CHECK_COMMENTS`/`EXECUTE` case:

```ts
case 'CHECK_COMMENTS': {
  const client = commentClients[message.automationId]
  if (client === undefined) { reply({ type: 'ERROR', requestId: message.requestId, code: 'UNKNOWN_AUTOMATION', message: message.automationId }); return }
  const authors = await client.checkComments({ cafeId: message.action.cafeId, boardId: message.action.boardId }, message.action.postId)
  reply({ type: 'COMMENTS', requestId: message.requestId, authors })
  return
}
```
`EXECUTE`도 같은 식. `PREFIX_REMINDER_AUTOMATION_ID`는 Task 6이 카탈로그에 넣지만, 이 작업에서 `catalog.ts`에 상수만 먼저 추가한다: `export const PREFIX_REMINDER_AUTOMATION_ID = 'prefix-reminder'` (AUTOMATIONS 배열에는 아직 넣지 않는다 — 넣으면 `assertRuntimesRegistered`가 부트를 깨뜨린다).

`dispatch`를 시험할 수 있게 `background.ts`의 `dispatch`와 `commentClients`를 `src/extension/dispatch.ts`로 떼어 `createDispatcher({ cafe, articleCafe, boardPageReader, memberPageReader, probe })`로 만든다. `background.ts`는 조립만. 테스트:

```ts
it('routes CHECK_COMMENTS by automation id and refuses unknown ones', async () => {
  const replies: ExtensionMessage[] = []
  const dispatch = createDispatcher({ cafe: fakeCafe, articleCafe: fakeArticle, ... })
  await dispatch({ type: 'CHECK_COMMENTS', requestId: 'r1', automationId: 'prefix-reminder', action: { cafeId: '1', boardId: '2', postId: '3' } }, (m) => replies.push(m))
  expect(fakeArticle.checkedPosts).toEqual(['3'])
  await dispatch({ type: 'CHECK_COMMENTS', requestId: 'r2', automationId: 'nope', action: { cafeId: '1', boardId: '2', postId: '3' } }, (m) => replies.push(m))
  expect(replies[1]).toMatchObject({ type: 'ERROR', code: 'UNKNOWN_AUTOMATION' })
})
```

- [ ] **Step 9: 전체 통과**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build:extension`
Expected: PASS. 확장 빌드가 되는지도 본다.

- [ ] **Step 10: 커밋**

```bash
git add -A src tests
git commit -m "feat: comment on ordinary articles through a client picked by automation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `prefix-reminder` 모듈, 수집기, 런타임 등록

**Files:**
- Create: `src/shared/automations/prefix-reminder/options.ts`, `eligibility.ts`, `guards.ts`, `render.ts`, `limits.ts`
- Create: `src/desktop/prefixReminderCollection.ts`
- Modify: `src/shared/automations/catalog.ts`, `src/shared/text.ts:47-49`
- Modify: `src/desktop/bootstrap.ts` (두 번째 `buildRuntime`)
- Test: `tests/shared/automations/prefix-reminder/{options,eligibility,render}.test.ts`, `tests/desktop/prefixReminderCollection.test.ts`, `tests/desktop/bootstrap.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // options.ts
  export interface PrefixReminderOptions { readonly commentText: string; readonly excludedBoardIds: readonly string[] }
  export const DEFAULT_PREFIX_REMINDER_OPTIONS: PrefixReminderOptions = { commentText: '', excludedBoardIds: [] }
  export function parsePrefixReminderOptions(json: string): PrefixReminderOptions   // broken → defaults; non-digit ids dropped
  export function serializePrefixReminderOptions(options: PrefixReminderOptions): string

  // eligibility.ts
  export type Ineligibility = 'HAS_PREFIX' | 'EXCLUDED_BOARD' | 'AUTHOR_IS_OPERATOR'
  export interface EligibilityRules { readonly excludedBoardIds: ReadonlySet<string>; readonly operatorAccounts: readonly string[] }
  export function classifyPost(post: CollectedPostMetadata, rules: EligibilityRules): 'ELIGIBLE' | Ineligibility
  export interface EligibilityTally { readonly read: number; readonly eligible: number; readonly droppedBy: Readonly<Record<Ineligibility, number>> }
  export function emptyTally(): EligibilityTally
  export function tallyOne(tally: EligibilityTally, verdict: 'ELIGIBLE' | Ineligibility): EligibilityTally  // returns a new tally

  // guards.ts
  export const PREFIX_REMINDER_GUARDS: readonly Guard[]

  // render.ts
  export function renderPrefixReminder(commentText: string): RenderOutcome  // '' → { ok: false, missing: ['comment'] }

  // limits.ts
  export const PREFIX_REMINDER_LIMITS: Record<Profile, Partial<Limits>>  // production 1.5h~2.5h; debug {} (same as welcome)

  // prefixReminderCollection.ts
  export interface TodayArticleCollectorDeps {
    readonly fetcher: BoardPageFetcher                   // createBoardPageFetcher(transport, newRequestId, '0')
    readonly rules: EligibilityRules
    readonly random: Random
    readonly sleep: (ms: number) => Promise<void>
    readonly onTally?: (dayStartMs: number, tally: EligibilityTally) => void
  }
  export function createTodayArticleCollector(deps: TodayArticleCollectorDeps): DayCollector
  export function toRawCandidate(post: CollectedPostMetadata): RawCandidate

  // catalog.ts
  export const PREFIX_REMINDER_AUTOMATION_ID = 'prefix-reminder'  // added in Task 5
  AUTOMATIONS gains { id: PREFIX_REMINDER_AUTOMATION_ID, labelKey: 'prefixReminder', panels: ['approvals', 'settings'] }
  // text.ts: automation.prefixReminder: '말머리 안내'
  ```

- [ ] **Step 1: `options` 테스트**

```ts
describe('parsePrefixReminderOptions', () => {
  it('reads what was stored', () => {
    expect(parsePrefixReminderOptions('{"commentText":"말머리를 골라 주세요","excludedBoardIds":["147","1"]}'))
      .toEqual({ commentText: '말머리를 골라 주세요', excludedBoardIds: ['147', '1'] })
  })
  it('falls back to defaults on broken json', () => {
    expect(parsePrefixReminderOptions('{nope')).toEqual(DEFAULT_PREFIX_REMINDER_OPTIONS)
    expect(parsePrefixReminderOptions('')).toEqual(DEFAULT_PREFIX_REMINDER_OPTIONS)
  })
  it('keeps only digit board ids, trimmed and deduplicated', () => {
    expect(parsePrefixReminderOptions('{"excludedBoardIds":[" 147 ","abc","147",12]}').excludedBoardIds).toEqual(['147'])
  })
  it('round-trips through serialize', () => {
    const options = { commentText: 'x', excludedBoardIds: ['1', '2'] }
    expect(parsePrefixReminderOptions(serializePrefixReminderOptions(options))).toEqual(options)
  })
})
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과**

Run: `pnpm vitest run tests/shared/automations/prefix-reminder/options.test.ts` (FAIL → 구현 → PASS). 구현은 `JSON.parse` try/catch, `typeof commentText === 'string' ? trim : ''`, ids는 `/^\d+$/` 필터 + `Set`.

- [ ] **Step 3: `eligibility` 테스트**

```ts
const post = (over: Partial<CollectedPostMetadata>): CollectedPostMetadata => ({
  cafeId: '14538121', postId: '1', boardId: '137', boardName: '국내구입기', title: 't', prefix: null,
  authorId: 'key-x', authorNickname: 'x', postedAt: 1_800_000_000_000, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false, ...over,
})
const rules = { excludedBoardIds: new Set(['147', '1']), operatorAccounts: ['cafe-ops', 'key-ops'] }

describe('classifyPost', () => {
  it('passes a post with no prefix on an ordinary board by an ordinary member', () => expect(classifyPost(post({}), rules)).toBe('ELIGIBLE'))
  it('drops a post that carries a prefix', () => expect(classifyPost(post({ prefix: '질문' }), rules)).toBe('HAS_PREFIX'))
  it('drops a post on an excluded board', () => expect(classifyPost(post({ boardId: '147' }), rules)).toBe('EXCLUDED_BOARD'))
  it('drops an operator post, by member key or by nickname', () => {
    expect(classifyPost(post({ authorId: 'key-ops' }), rules)).toBe('AUTHOR_IS_OPERATOR')
    expect(classifyPost(post({ authorNickname: 'cafe-ops' }), rules)).toBe('AUTHOR_IS_OPERATOR')
  })
  it('names the first reason when several apply: board, then operator, then prefix', () => {
    expect(classifyPost(post({ boardId: '147', prefix: '질문', authorId: 'key-ops' }), rules)).toBe('EXCLUDED_BOARD')
  })
})

describe('tally', () => {
  it('counts without mutating', () => {
    const a = emptyTally()
    const b = tallyOne(tallyOne(a, 'ELIGIBLE'), 'HAS_PREFIX')
    expect(a.read).toBe(0)
    expect(b).toEqual({ read: 2, eligible: 1, droppedBy: { HAS_PREFIX: 1, EXCLUDED_BOARD: 0, AUTHOR_IS_OPERATOR: 0 } })
  })
})
```

- [ ] **Step 4: 실패 확인 → 구현 → 통과**

순서는 테스트가 정한 대로 board → operator → prefix. 운영자 판정은 `authorId`와 `authorNickname` 둘 다 `operatorAccounts`에 대조(둘 다 `null`일 수 있음).

- [ ] **Step 5: `render`, `guards`, `limits`**

`render.ts`:
```ts
export function renderPrefixReminder(commentText: string): RenderOutcome {
  const body = commentText.trim()
  return body === '' ? { ok: false, missing: ['comment'] } : { ok: true, templateId: null, body }
}
```
테스트 두 개(빈 문구 → `ok: false`, 문구 → `body` 그대로). `guards.ts`는 `[operatorAlreadyCommentedGuard]` 한 줄 + 주석(왜 하나뿐인지: 수집기가 나머지를 거른다). `limits.ts`:
```ts
const HOUR = 3_600_000
export const PREFIX_REMINDER_LIMITS: Record<Profile, Partial<Limits>> = {
  // Two hours give or take half: the board fills through the day and a reminder hours late still reaches a post that is still on the first page.
  production: { sessionIntervalMinMs: 1.5 * HOUR, sessionIntervalMaxMs: 2.5 * HOUR },
  debug: {},
}
```

- [ ] **Step 6: 수집기 테스트**

`tests/desktop/prefixReminderCollection.test.ts`. `BoardPageFetcher`를 가짜로:

```ts
const DAY = kstDayStartMs(Date.UTC(2026, 8, 11, 3, 0, 0))  // 2026-09-11 KST
const page = (items: CollectedPostMetadata[]): CollectedArticlePage => ({ items, pageInfo: { lastNavigationPageNumber: 10, visibleNextButton: true, totalArticleCount: null }, pageIdentity: cafeArticlePageIdentity(items.map((i) => i.postId)) })
const at = (hourKst: number) => DAY + hourKst * 3_600_000

function collector(pages: Record<number, CollectedArticlePage | Error>, rules = { excludedBoardIds: new Set<string>(), operatorAccounts: [] }) {
  const tallies: EligibilityTally[] = []
  const read: number[] = []
  const collect = createTodayArticleCollector({
    fetcher: { read: (n) => { read.push(n); const p = pages[n]; if (p === undefined) return Promise.resolve(page([])); return p instanceof Error ? Promise.reject(p) : Promise.resolve(p) } },
    rules, random: new SequenceRandom([0]), sleep: () => Promise.resolve(),
    onTally: (_day, t) => tallies.push(t),
  })
  return { collect, tallies, read }
}

describe('createTodayArticleCollector', () => {
  it('walks pages until one reaches into yesterday and keeps only today', async () => {
    const { collect, read } = collector({
      1: page([post({ postId: '3', postedAt: at(14) }), post({ postId: '2', postedAt: at(9) })]),
      2: page([post({ postId: '1', postedAt: at(-1) })]),   // yesterday 23:00 KST
    })
    const raws = await collect(DAY)
    expect(raws?.map((r) => r.postId)).toEqual(['2', '3'])   // oldest first
    expect(read).toEqual([1, 2])
  })
  it('stops on an empty page and on a page identical to the last', async () => { /* pages 1 and 2 with same identity → read [1,2], no page 3 */ })
  it('returns null when a page cannot be read', async () => {
    const { collect } = collector({ 1: new Error('BOARD_PAGE_HTTP_ERROR') })
    expect(await collect(DAY)).toBeNull()
  })
  it('hands over only eligible posts and reports what it dropped', async () => {
    const { collect, tallies } = collector(
      { 1: page([post({ postId: '4', postedAt: at(12), prefix: '질문' }), post({ postId: '3', postedAt: at(11), boardId: '147' }), post({ postId: '2', postedAt: at(10), authorId: 'key-ops' }), post({ postId: '1', postedAt: at(-2) })]) },
      { excludedBoardIds: new Set(['147']), operatorAccounts: ['key-ops'] },
    )
    const raws = await collect(DAY)
    expect(raws).toEqual([])
    expect(tallies).toEqual([{ read: 3, eligible: 0, droppedBy: { HAS_PREFIX: 1, EXCLUDED_BOARD: 1, AUTHOR_IS_OPERATOR: 1 } }])
  })
  it('maps list metadata onto a candidate', () => {
    expect(toRawCandidate(post({ postId: '9', boardId: '137', prefix: null, commentCount: 2, title: 'T', authorId: 'k', authorNickname: 'n', postedAt: at(1) })))
      .toEqual({ boardId: '137', postId: '9', title: 'T', bodyText: null, authorNickname: 'n', authorId: 'k', postedAt: at(1), commentCount: 2, prefix: null })
  })
})
```

- [ ] **Step 7: 실패 확인 → 구현 → 통과**

```ts
const PAGES_WARNING_THRESHOLD = 20

export function createTodayArticleCollector(deps: TodayArticleCollectorDeps): DayCollector {
  return async (dayStartMs, onProgress) => {
    const day = kstDayRange(dayStartMs)
    const eligible = new Map<string, RawCandidate>()
    let tally = emptyTally()
    let lastIdentity: string | null = null

    for (let pageNumber = 1; ; pageNumber += 1) {
      if (pageNumber > PAGES_WARNING_THRESHOLD) console.warn(`[prefix-reminder] day walk exceeded ${PAGES_WARNING_THRESHOLD} pages`)
      let page: CollectedArticlePage
      try { page = await deps.fetcher.read(pageNumber) } catch { return null }
      if (page.items.length === 0 || page.pageIdentity === lastIdentity) break
      lastIdentity = page.pageIdentity

      let reachedYesterday = false
      for (const item of page.items) {
        if (item.postedAt < day.startMs) { reachedYesterday = true; continue }
        if (item.postedAt >= day.endMs) continue
        const verdict = classifyPost(item, deps.rules)
        tally = tallyOne(tally, verdict)
        if (verdict === 'ELIGIBLE') eligible.set(item.postId, toRawCandidate(item))
      }
      onProgress?.(pageNumber, eligible.size)
      if (reachedYesterday) break
      await deps.sleep(nextPageFetchDelayMs(deps.random))
    }

    deps.onTally?.(dayStartMs, tally)
    return [...eligible.values()].sort((a, b) => comparePostId(a.postId, b.postId))
  }
}
```

- [ ] **Step 8: 카탈로그·문구·런타임 등록**

`catalog.ts`의 `AUTOMATIONS`에 항목 추가. `text.ts` `automation.prefixReminder: '말머리 안내'`. `bootstrap.ts`에 두 번째 `buildRuntime`:

```ts
const prefixOptions = () => parsePrefixReminderOptions(repos.automationSettings.get(PREFIX_REMINDER_AUTOMATION_ID)?.optionsJson ?? '{}')
buildRuntime({
  automationId: PREFIX_REMINDER_AUTOMATION_ID,
  limits: { ...PROFILES[options.profile], ...PREFIX_REMINDER_LIMITS[options.profile] },
  guards: PREFIX_REMINDER_GUARDS,
  collector: (ctx) => createTodayArticleCollector({
    fetcher: createBoardPageFetcher(transport, () => randomUUID(), CAFE_ARTICLE_LIST.menuId),
    rules: { excludedBoardIds: new Set(prefixOptions().excludedBoardIds), operatorAccounts: ctx.operatorAccounts },
    random: systemRandom,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onTally: (day, tally) => { /* Task 7 keeps this for the session line */ },
  }),
  renderBody: () => renderPrefixReminder(prefixOptions().commentText),
  hasBody: () => renderPrefixReminder(prefixOptions().commentText).ok,
  loginBoardId: () => repos.automationSettings.get(WELCOME_AUTOMATION_ID)?.boardId ?? null,  // login is cafe-wide; read it where the first automation does
  requiresBoard: false,
})
```

`optionsJson`은 Task 8의 열이다. 이 작업에서는 `AutomationSetting`에 `optionsJson: string`이 아직 없으므로, **Task 8을 먼저 하거나** 이 스텝에서 임시로 `'{}'`를 읽지 말고 Task 8을 이 작업 앞에 두어라. → **실행 순서: Task 8을 Task 6보다 먼저 한다.** (아래 Task 8은 스키마만 다루므로 독립적이다.)

또한 기본 설정 seed: `automationSettings.get(PREFIX_REMINDER_AUTOMATION_ID) === undefined`이면 `{ automationId, policy: 'AUTO', limits: {}, enabled: false, boardId: null, optionsJson: '{}' }` upsert. 꺼진 채 시작한다.

`assertRuntimesRegistered`가 두 id를 본다. `tests/desktop/bootstrap.test.ts`의 "boots a runtime for every catalogued automation"이 둘 다 `NOT_CONFIGURED`/`DISABLED`/`NO_TEMPLATE` 중 하나로 답하는지 확인 — 새 자동화는 문구가 비어 `NO_TEMPLATE`.

- [ ] **Step 9: 전체 통과**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: 커밋**

```bash
git add -A src tests
git commit -m "feat: remind authors who posted without a prefix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 세션 한 줄 로그

**Files:**
- Create: `src/desktop/sessionLog.ts`
- Modify: `src/desktop/refusalLog.ts` (`formatRefusal`만 남기고 `appendRefusal` 제거)
- Modify: `src/desktop/bootstrap.ts` (`refusalLogPath` → `sessionLogPath`; 런타임 `onOutcome`/`onTally`/`onProgress`에서 기록), `src/desktop/main.ts:234`
- Test: `tests/desktop/sessionLog.test.ts` (신규), `tests/desktop/refusalLog.test.ts` (append 테스트 제거)

**Interfaces:**
- Produces:
  ```ts
  // sessionLog.ts
  export interface DayReadSummary { readonly dayStartMs: number; readonly pages: number; readonly tally: EligibilityTally | null; readonly read: number }
  export interface SessionRecord {
    readonly automationId: string
    readonly mode: RunMode
    readonly outcome: SessionOutcome
    readonly openedAt: number; readonly endedAt: number
    readonly days: readonly DayReadSummary[]
    readonly wake: WakeRecord | null
  }
  export function formatSessionLine(record: SessionRecord): string   // ends with '\n'
  export function appendSessionLine(path: string, record: SessionRecord): void  // swallows write errors
  ```

- [ ] **Step 1: 테스트**

```ts
const T0 = Date.UTC(2026, 8, 11, 5, 3, 12, 418)  // 14:03:12.418 KST
const opened = { opened: true, executed: 9, skipped: 2, awaitingApproval: 0, failed: 0 } as const

it('writes an opened session on one line', () => {
  expect(formatSessionLine({
    automationId: 'prefix-reminder', mode: 'SCHEDULED', outcome: opened, openedAt: T0 - 372_000, endedAt: T0, wake: null,
    days: [{ dayStartMs: kstDayStartMs(T0), pages: 7, read: 312, tally: { read: 312, eligible: 11, droppedBy: { HAS_PREFIX: 289, EXCLUDED_BOARD: 10, AUTHOR_IS_OPERATOR: 2 } } }],
  })).toBe('2026-09-11 14:03:12.418 KST  prefix-reminder  SCHEDULED  opened  day=09-11 pages=7 read=312 eligible=11 dropped[HAS_PREFIX=289 EXCLUDED_BOARD=10 AUTHOR_IS_OPERATOR=2]  executed=9 skipped=2 awaiting=0 failed=0  took=6m12s\n')
})
it('omits the eligibility part for a collector that does not screen', () => {
  const line = formatSessionLine({ automationId: 'welcome-comment', mode: 'SCHEDULED', outcome: { ...opened, executed: 3, skipped: 11 }, openedAt: T0 - 160_000, endedAt: T0, wake: null, days: [{ dayStartMs: kstDayStartMs(T0), pages: 1, read: 14, tally: null }] })
  expect(line).toBe('2026-09-11 14:03:12.418 KST  welcome-comment  SCHEDULED  opened  day=09-11 pages=1 read=14  executed=3 skipped=11 awaiting=0 failed=0  took=2m40s\n')
})
it('writes two day summaries when a session settled yesterday first', () => { /* days: [yesterday, today] → 'day=09-10 … / day=09-11 …' */ })
it('writes a refusal with the automation in front', () => {
  expect(formatSessionLine({ automationId: 'prefix-reminder', mode: 'SCHEDULED', outcome: { opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' }, openedAt: T0, endedAt: T0, days: [], wake: { scheduledFor: T0 - 8002, wokeAt: T0 } }))
    .toBe('2026-09-11 14:03:12.418 KST  prefix-reminder  SCHEDULED  refused OUTSIDE_ACTIVE_HOURS  scheduled 2026-09-11 14:03:04.416 KST  woke 8002ms late\n')
})
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과**

`stamp`는 `refusalLog.ts`의 것을 export해 재사용. `took`은 `m`/`s`로(`6m12s`, 60초 미만이면 `40s`). `refused` 줄의 뒷부분은 `formatRefusal`의 필드 배열을 재사용하도록 `formatRefusalFields(session): string[]`를 `refusalLog.ts`에서 export하고 앞에 자동화·모드를 붙인다.

- [ ] **Step 3: 런타임에서 모으기**

`bootstrap.ts` `buildRuntime`에 세션 기록용 상태:

```ts
let openedAt = 0
let days: DayReadSummary[] = []
let currentMode: RunMode = 'MANUAL'
```

- `onProgress`가 `{ phase: 'COLLECTING', pagesRead, collected }`를 받을 때 현재 날의 `pages`·`read`를 갱신(`read`는 collected — 가입인사는 후보 수가 곧 읽은 수; 새 자동화는 `onTally`가 `read`를 덮어쓴다). 새 날의 시작은 `phase: 'COLLECTING'`에 `pagesRead`가 없는 첫 보고. `dayStartMs`는 오케스트레이터가 알려줘야 하므로 `SessionProgress`의 COLLECTING에 `readonly dayStartMs: number`를 추가한다(`workDay`에서 채움; 렌더러는 무시).
- `onTally(day, tally)`는 해당 날의 `tally`와 `read`를 채운다.
- `runSession` 래퍼에서 `openedAt = systemClock.now(); days = []; currentMode = request?.mode ?? 'MANUAL'`.
- `onOutcome(outcome, wake)`: `appendSessionLine(options.sessionLogPath, { automationId, mode: currentMode, outcome, openedAt, endedAt: systemClock.now(), days, wake })` (경로가 있을 때만).

`AppContextOptions.refusalLogPath` → `sessionLogPath`. `main.ts`: `sessionLogPath: join(app.getPath('userData'), 'sessions.log')`.

- [ ] **Step 4: 부트스트랩 테스트**

`tests/desktop/bootstrap.test.ts`에 `sessionLogPath`를 임시 파일로 주고, `runOnce` 뒤 파일에 자동화 id와 `refused`가 들어 있는지 단언:

```ts
it('writes every session, opened or refused, to the session log', async () => {
  await ctx.automation.runOnce(WELCOME_AUTOMATION_ID)
  const log = readFileSync(join(dir, 'sessions.log'), 'utf8')
  expect(log).toContain('welcome-comment  MANUAL  refused')
})
```

- [ ] **Step 5: 전체 통과, 커밋**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add -A src tests
git commit -m "feat: write one line per session, opened or refused, for every automation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `options_json` 열과 설정 API  *(Task 6보다 먼저 실행)*

**Files:**
- Modify: `src/desktop/db/schema.ts:56-64`
- Create: `drizzle/0008_<name>.sql` (`pnpm db:generate`가 만든다) + `drizzle/meta/*`
- Modify: `src/desktop/db/automationSettingsRepo.ts`
- Modify: `src/desktop/rendererApi.ts` (`upsert`, `getAutomationSettings`, 신규 `setAutomationOptions`), `src/desktop/ipc.ts` (채널·타입), `src/desktop/preload.ts`
- Test: `tests/desktop/db/automationSettingsRepo.test.ts`, `tests/desktop/rendererApi.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // AutomationSetting gains: readonly optionsJson: string   ('{}' by default)
  // ipc.ts
  export interface AutomationSettingsView { policy; enabled; boardId; readonly options: Record<string, unknown> }
  // RendererApi.setAutomationOptions(automationId: string, options: Record<string, unknown>): Promise<void>
  //   stores JSON.stringify(options); the module that reads it validates on the way out (Task 6 parse*).
  // IPC_CHANNELS.setAutomationOptions = 'wm:setAutomationOptions'
  ```

- [ ] **Step 1: 리포 테스트**

```ts
it('stores and returns options json, defaulting to an empty object', () => {
  repo.upsert({ automationId: 'a', policy: 'AUTO', limits: {}, enabled: false, boardId: null, optionsJson: '{"commentText":"x"}' })
  expect(repo.get('a')?.optionsJson).toBe('{"commentText":"x"}')
})
it('reads rows written before the column existed as {}', () => {
  db.run(sql`INSERT INTO automation_settings (automation_id, policy) VALUES ('old', 'AUTO')`)
  expect(repo.get('old')?.optionsJson).toBe('{}')
})
```

- [ ] **Step 2: 스키마·마이그레이션**

`schema.ts`: `optionsJson: text('options_json').notNull().default('{}')`. 실행: `pnpm db:generate` → `drizzle/0008_*.sql`이 `ALTER TABLE automation_settings ADD options_json text DEFAULT '{}' NOT NULL;`를 담는지 확인. 리포의 `get`/`upsert`에 `optionsJson` 추가.

- [ ] **Step 3: 통과 확인**

Run: `pnpm vitest run tests/desktop/db/automationSettingsRepo.test.ts`
Expected: PASS. 기존 `upsert` 호출처(`bootstrap.ts` seed, `rendererApi.ts` upsert, `configTransfer.ts`, 테스트들)에 `optionsJson: current?.optionsJson ?? '{}'`를 넣는다 — `pnpm typecheck`가 가리킨다.

- [ ] **Step 4: 렌더러 API**

`rendererApi.test.ts`:
```ts
it('stores automation options as json and hands them back parsed', async () => {
  await api.setAutomationOptions('welcome-comment', { commentText: '안내', excludedBoardIds: ['1'] })
  expect((await api.getAutomationSettings('welcome-comment')).options).toEqual({ commentText: '안내', excludedBoardIds: ['1'] })
})
```
구현: `upsert(automationId, { optionsJson: JSON.stringify(options) })`; `getAutomationSettings`는 `JSON.parse` try/catch → 객체가 아니면 `{}`. `ipc.ts`에 채널·메서드, `preload.ts`에 브릿지, `main.ts`의 `registerIpc`가 채널 목록을 자동으로 돌지 않으면 핸들러 추가.

- [ ] **Step 5: 전체 통과, 커밋**

```bash
git add -A src tests drizzle
git commit -m "feat: give each automation a place for its own options

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 설정 패널 분리와 자동화별 대시보드 카드

**Files:**
- Modify: `src/renderer/views/AutomationSettings.tsx`
- Create: `src/renderer/views/settings/WelcomeBoardSection.tsx`, `src/renderer/views/settings/PrefixReminderSection.tsx`, `src/renderer/views/settings/sections.ts`
- Modify: `src/shared/automations/catalog.ts` (`settingsSection` 키), `src/shared/text.ts` (문구)
- Modify: `src/renderer/views/Dashboard.tsx`, `src/renderer/views/dashboard/CommentJob.tsx`, `src/renderer/format.ts`(`disabledAutomationNames`가 이미 카탈로그 라벨을 쓰는지 확인)
- Test: `tests/renderer/settingsSections.test.ts`(신규), `tests/renderer/dashboardCards.test.ts`(신규, 순수 함수만)

**Interfaces:**
- Produces:
  ```ts
  // catalog.ts
  export type SettingsSectionKey = 'welcomeBoard' | 'prefixReminder'
  AutomationDescriptor gains readonly settingsSection: SettingsSectionKey
  // sections.ts
  export const SETTINGS_SECTIONS: Record<SettingsSectionKey, (props: SectionProps) => React.JSX.Element>
  export interface SectionProps { readonly automationId: string; readonly settings: AutomationSettingsView }
  // text.ts additions
  settings.prefix: { commentText: '안내 댓글 문구', commentTextHint: '말머리 없는 글에 그대로 달립니다. 변수는 없습니다.', excludedBoards: '제외 게시판 id', excludedBoardsHint: '한 줄에 하나. 게시판 주소 menus/ 뒤의 숫자입니다.', invalidBoardId: (value: string) => `게시판 id는 숫자여야 합니다: ${value}` }
  // Dashboard: one CommentJob per dashboard.automations entry; welcome's card keeps the day picker and startup preview, the other card has runOnce + toggle + kill only.
  // CommentJobProps gains readonly title: string and readonly showDayControls: boolean
  ```

- [ ] **Step 1: 섹션 선택 테스트 (순수)**

```ts
it('every catalogued automation names a settings section that exists', () => {
  for (const automation of AUTOMATIONS) expect(SETTINGS_SECTIONS[automation.settingsSection]).toBeTypeOf('function')
})
it('parses an excluded-board textarea into ids and names the first bad line', () => {
  expect(parseExcludedBoardLines('147\n 1 \n\n165')).toEqual({ ok: true, ids: ['147', '1', '165'] })
  expect(parseExcludedBoardLines('147\nabc')).toEqual({ ok: false, invalid: 'abc' })
})
```
`parseExcludedBoardLines`는 `src/renderer/views/settings/excludedBoards.ts`에 둔다(순수).

- [ ] **Step 2: 구현**

- `AutomationSettings.tsx`: 켜기/끄기와 정책 섹션은 그대로 두고, 마지막 게시판 섹션을 `const Section = SETTINGS_SECTIONS[findAutomation(automationId)!.settingsSection]; <Section automationId={automationId} settings={settings} />`로 바꾼다.
- `WelcomeBoardSection.tsx`: 지금의 게시판 id 입력 그대로 옮긴다.
- `PrefixReminderSection.tsx`: `settings.options`를 `parsePrefixReminderOptions(JSON.stringify(settings.options))`로 읽어 초기값. textarea 둘(문구, 제외 id 줄 목록), 저장 버튼 하나 → `parseExcludedBoardLines` 실패면 `TEXT.settings.prefix.invalidBoardId(value)`를 빨간 문구로, 성공이면 `api.setAutomationOptions(automationId, { commentText, excludedBoardIds })`.
- `Dashboard.tsx`: `dashboard.automations.map((automation) => <CommentJob key={automation.id} title={TEXT.automation[findAutomation(automation.id)!.labelKey]} showDayControls={automation.id === WELCOME_AUTOMATION_ID} … />)`. 각 카드의 `state`는 `commentJobState({ …, automationEnabled: automation.enabled, nextSessionAt: automation.nextSessionAt, progress: automation.sessionProgress === null ? null : progressSummary(automation.sessionProgress) })`; `lastOutcomeText`는 `automation.lastOutcome`으로; `executedToday` 등은 자동화별 값(`AutomationStatus.executedToday`, `awaitingApproval`; `succeededToday`/`failedToday`는 `DashboardSnapshot`에 자동화별이 없으므로 `AutomationStatus`에 두 필드를 추가하고 `rendererApi.getDashboard`에서 `countByStatusForDay(automation.id, …)`로 채운다).
- `onRunOnce`: `api.runOnce(automation.id)`.
- `CommentJob.tsx`: 제목 표시, `showDayControls === false`면 날짜 입력·`onRunDay`·미리보기 줄을 그리지 않는다.

- [ ] **Step 3: 눈으로 확인**

Run: `pnpm start` (Electron). 사이드바에 `말머리 안내`가 보이고, 설정 패널에 문구·제외 목록 입력이 있고, 대시보드에 카드가 둘인지. 저장 후 새로고침에도 값이 남는지. 스크린샷을 남긴다.

- [ ] **Step 4: 전체 통과, 커밋**

```bash
git add -A src tests
git commit -m "feat: show and configure each automation on its own

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 설정 이관 번들에 옵션 포함

**Files:**
- Modify: `src/shared/configBundle.ts` (`CONFIG_BUNDLE_VERSION = 2`, `BundleAutomation.options`)
- Modify: `src/desktop/configTransfer.ts` (`buildBundle`, import 적용)
- Test: `tests/shared/configBundle.test.ts`, `tests/desktop/configTransfer.test.ts`

- [ ] **Step 1: 테스트**

```ts
it('carries each automation\'s options and reads a missing one as empty', () => {
  const parsed = parseConfigBundle(JSON.stringify({ version: 2, exportedAt: 1, common: { cafeId: '1', cafeUrlName: 'x', operatorAccounts: [] },
    automations: [{ id: 'a', policy: 'AUTO', boardId: '', enabled: false, templates: [], options: { commentText: 'hi' } }, { id: 'b', policy: 'AUTO', boardId: '', enabled: false, templates: [] }] }))
  expect(parsed.ok && parsed.bundle.automations.map((a) => a.options)).toEqual([{ commentText: 'hi' }, {}])
})
it('refuses a version-1 file', () => {
  expect(parseConfigBundle(JSON.stringify({ version: 1, common: { cafeId: '1' }, automations: [] }))).toEqual({ ok: false, problem: 'UNSUPPORTED_VERSION' })
})
```
`configTransfer.test.ts`: import 뒤 `automationSettings.get(id)?.optionsJson`이 `JSON.stringify(options)`와 같은지; export가 `optionsJson`을 파싱해 `options`에 넣는지.

- [ ] **Step 2: 구현, 통과, 커밋**

`parseAutomations`: `options: asRecord(record.options) ?? {}`. `buildBundle`: `options: parseJsonRecord(setting?.optionsJson ?? '{}')`. import: `optionsJson: JSON.stringify(automation.options)`.

```bash
git add -A src tests
git commit -m "feat: carry automation options through config export and import

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 릴리스 준비

**Files:**
- Modify: `package.json` (`version`), `src/extension/manifest.json` (`version`)
- Modify: `docs/superpowers/specs/2026-09-11-prefix-reminder-design.md` 상태 줄 → `구현됨 (<날짜>, <버전>)`

- [ ] **Step 1: 실제 카페에서 dry run**

`debug` 프로필로 앱을 띄우고(기존 방식: `pnpm start`에 프로필 환경변수 — `src/desktop/main.ts`에서 프로필을 읽는 방법을 확인해 그대로), 새 자동화 설정에 문구와 제외 목록(147, 179, 1, 165, 87, 207)을 넣고, 승인 정책을 `MANUAL`로 두고, `지금 실행`. 승인 큐에 오늘의 말머리 없는 글이 뜨는지, `sessions.log`에 `eligible`/`dropped` 수가 맞는지 목록 페이지와 대조. 승인 하나를 눌러 실제 댓글이 달리고 `SUCCESS`가 되는지. 그 댓글은 운영자가 확인 후 유지.

- [ ] **Step 2: 버전·문서**

`package.json`과 `manifest.json`의 버전을 같은 값으로 올린다(마이너: 1.6.0). 스펙 상태 줄 갱신. 프로토콜이 11이므로 확장을 재패키징해 배포해야 한다 — `pnpm package:extension`. 메모리 `repackage-after-protocol-bump` 참고.

- [ ] **Step 3: 커밋**

```bash
git add package.json src/extension/manifest.json docs
git commit -m "chore: release 1.6.0 with the prefix reminder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 실행 순서

1 → 2 → 3 → 4 → 5 → **8** → 6 → 7 → 9 → 10 → 11

Task 8이 Task 6 앞에 오는 이유: Task 6의 런타임이 `optionsJson`을 읽는다.
