# 안내 댓글 없는 오늘 글 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가입인사 댓글 대상을 "오늘 올라온 글 중 운영진 안내 댓글이 없는 글, 작성자별 최초 글 하나"로 바꾸고, 가입일 판별 계통과 워터마크를 걷어낸다.

**Architecture:** 판정 근거를 전부 게시판 목록 HTML로 옮긴다. 최초 글 여부는 수집 결과에서 오케스트레이터가 계산해 가드 문맥으로 넘기고, 가드는 판정만 한다. 실행 기록은 관문이 아니라 기록이 되며, `claim`이 끝나지 않은 행을 되살린다.

**Tech Stack:** TypeScript(ESM), Electron 메인/렌더러, Chrome MV3 확장, Drizzle + better-sqlite3, vitest.

## Global Constraints

- 설계는 [안내 댓글 없는 오늘 글 설계](../specs/2026-08-23-uncommented-greetings-design.md)를 따른다. 문서와 코드가 어긋나면 문서를 고치는 것도 작업에 포함된다.
- 코드와 주석은 영어, 사용자 대면 문구는 전부 i18n(`src/renderer/locales/ko.ts`).
- 색은 3개 제한, 상태색(ok/warn/alarm)은 문서화된 예외. 라이트/다크 둘 다 동작해야 한다.
- 불변성 기본. TODO 주석·죽은 코드·자리표시자 금지.
- TypeScript는 `exactOptionalPropertyTypes: true`.
- 마이그레이션 작업은 `pnpm db:generate` 후 **`git status`로 `drizzle/meta/_journal.json`과 새 스냅샷이 스테이징되었는지 반드시 확인**한다. 빠뜨리면 새로 설치한 앱에만 조용히 깨진다.
- 각 작업이 끝난 시점에 `pnpm typecheck`, `pnpm lint`, `pnpm test`가 모두 통과해야 한다. 테스트는 전체 수를 보고한다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/shared/automations/welcome-comment/firstPost.ts` | 신설. 작성자별 최초 글 가드 |
| `src/shared/automations/welcome-comment/newMember.ts` | 삭제 |
| `src/shared/guards.ts` | 가드 문맥에서 회원 정보를 빼고 최초 글 여부를 넣는다 |
| `src/shared/types.ts` | `AUTHOR_UNKNOWN` 위험 신호, `NOT_FIRST_POST` 건너뜀 사유, `AuthorMembership` 삭제 |
| `src/shared/postId.ts` | `laterPostId` → `comparePostId`. 최초 글 동률을 가른다 |
| `src/desktop/orchestrator.ts` | 최초 글 계산, 보류·워터마크 경로 삭제 |
| `src/desktop/db/dedupeStore.ts` | 작성자 중복 거부 삭제, 끝나지 않은 행 재개 |
| `src/desktop/membership.ts`, `src/shared/members.ts`, `src/desktop/db/membersRepo.ts` | 삭제 |
| `src/desktop/db/watermarksRepo.ts` | 삭제 |
| `src/shared/protocol.ts` | `FETCH_MEMBERS`/`MEMBERS` 삭제, `COLLECT`의 `sincePostId` 삭제, 버전 4 |

---

## Task 1: 최초 글 판정으로 교체

가입일 판별을 걷어내고 작성자별 최초 글 판정을 넣는다. 이 작업이 끝나면 `membership.ts`와 회원 조회 코드는 아무도 부르지 않는 상태가 되지만 아직 지우지 않는다 — 삭제는 Task 3이다.

**Files:**
- Create: `src/shared/automations/welcome-comment/firstPost.ts`
- Create: `tests/shared/automations/welcome-comment/firstPost.test.ts`
- Delete: `src/shared/automations/welcome-comment/newMember.ts`, `tests/shared/automations/welcome-comment/newMember.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/guards.ts`, `src/shared/postId.ts`, `src/desktop/orchestrator.ts`, `src/desktop/session.ts`, `src/desktop/preview.ts`, `src/renderer/locales/ko.ts`
- Test: `tests/shared/guards.test.ts`, `tests/desktop/orchestrator.test.ts`, `tests/desktop/session.test.ts`, `tests/desktop/preview.test.ts`, `tests/shared/postId.test.ts`

**Interfaces:**
- Produces: `firstPostOnlyGuard: Guard`; `GuardContext.isFirstPostByAuthor: boolean`; `comparePostId(a: string, b: string): number`; 위험 신호 `'AUTHOR_UNKNOWN'`; 건너뜀 사유 `'NOT_FIRST_POST'`.
- Consumes: 기존 `Guard`, `GuardOutcome`, `RawCandidate`.

- [ ] **Step 1: 최초 글 가드 테스트를 먼저 쓴다**

`tests/shared/automations/welcome-comment/firstPost.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { firstPostOnlyGuard } from '../../../../src/shared/automations/welcome-comment/firstPost.js'
import type { Candidate } from '../../../../src/shared/types.js'

const NOW = Date.UTC(2026, 7, 24, 10, 0, 0)

function candidate(authorId: string | null): Candidate {
  return {
    automationId: 'welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    postId: '1001',
    title: '가입인사',
    bodyText: '반갑습니다',
    authorNickname: '왕밤이',
    authorId,
    postedAt: NOW - 60_000,
  }
}

function context(isFirstPostByAuthor: boolean) {
  return {
    nowMs: NOW,
    operatorAccounts: ['cafe-ops'],
    existingCommentAuthors: [],
    isFirstPostByAuthor,
  }
}

describe('firstPostOnlyGuard', () => {
  it('passes the author\'s earliest greeting', () => {
    expect(firstPostOnlyGuard(candidate('m1'), context(true))).toBeNull()
  })

  it('skips a later greeting by someone already covered', () => {
    expect(firstPostOnlyGuard(candidate('m1'), context(false))).toEqual({
      kind: 'SKIP',
      reason: 'NOT_FIRST_POST',
    })
  })

  it('hands a post with no readable author to the policy', () => {
    // Without an author the one-greeting-per-person promise cannot be kept,
    // and that is a judgement for the operator's policy, not for the guard.
    expect(firstPostOnlyGuard(candidate(null), context(true))).toEqual({
      kind: 'RISK',
      flag: 'AUTHOR_UNKNOWN',
    })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/shared/automations/welcome-comment/firstPost.test.ts`
Expected: FAIL — `firstPost.js`가 없다.

- [ ] **Step 3: 타입에 위험 신호와 사유를 더한다**

`src/shared/types.ts`에서 `RiskFlag`에 `| 'AUTHOR_UNKNOWN'`을 더하고, `SkipReason`의 `'NOT_NEW_MEMBER'`를 `'NOT_FIRST_POST'`로 바꾼다. `AuthorMembership` 타입과 그 정의는 삭제한다.

- [ ] **Step 4: 가드 문맥을 바꾼다**

`src/shared/guards.ts`의 `GuardContext`에서 `authorMembership`과 `newMemberWindowDays`를 지우고 다음을 넣는다.

```ts
  /**
   * Whether this is the earliest post its author made in this collection.
   * Computed by the caller, which is the only place that sees the whole set.
   */
  readonly isFirstPostByAuthor: boolean
```

`import type`에서 `AuthorMembership`을 뺀다.

- [ ] **Step 5: 가드를 쓴다**

`src/shared/automations/welcome-comment/firstPost.ts`:

```ts
import type { Guard, GuardOutcome } from '../../guards.js'

/**
 * One greeting per person. When someone posts more than once in a day only
 * their earliest post is answered; the rest are already covered by it.
 *
 * A post whose author could not be read cannot be grouped at all. Treating
 * such posts as one person would drop unrelated people at once, and treating
 * each as its own person would greet someone twice — so the post is flagged
 * and the approval policy decides.
 */
export const firstPostOnlyGuard: Guard = (candidate, ctx): GuardOutcome => {
  if (candidate.authorId === null) return { kind: 'RISK', flag: 'AUTHOR_UNKNOWN' }
  return ctx.isFirstPostByAuthor ? null : { kind: 'SKIP', reason: 'NOT_FIRST_POST' }
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npx vitest run tests/shared/automations/welcome-comment/firstPost.test.ts`
Expected: PASS (3건)

- [ ] **Step 7: 동률을 가를 비교자를 만든다**

`src/shared/postId.ts`의 `laterPostId`를 지우고 아래로 바꾼다. 워터마크가 사라지면서 유일한 사용처가 없어지지만, BigInt 처리는 최초 글 동률을 가르는 데 그대로 필요하다.

```ts
const NUMERIC = /^\d+$/

/**
 * Naver post ids are ascending decimal integers, but they outgrow Number's safe
 * range, so comparison goes through BigInt. Non-numeric ids fall back to
 * lexicographic order rather than throwing — a mis-ordered id is a bug we want
 * visible in tests, not a crash in production.
 */
export function comparePostId(a: string, b: string): number {
  if (NUMERIC.test(a) && NUMERIC.test(b)) {
    const left = BigInt(a)
    const right = BigInt(b)
    return left === right ? 0 : left < right ? -1 : 1
  }
  return a === b ? 0 : a < b ? -1 : 1
}
```

`tests/shared/postId.test.ts`를 `comparePostId`에 맞춰 다시 쓴다. 최소한 다음을 덮는다: 자릿수가 다른 숫자 id, `Number.MAX_SAFE_INTEGER`를 넘는 id, 같은 id, 숫자가 아닌 id.

- [ ] **Step 8: 오케스트레이터가 최초 글을 계산하게 한다**

`src/desktop/orchestrator.ts`에 아래를 더한다.

```ts
/**
 * The earliest post each author made in this collection, by post id.
 *
 * Computed rather than read off the incoming order. Collection does sort oldest
 * first, but that exists so a session stopped by its cap leaves the newest
 * behind — a separate promise that must not quietly become this rule's
 * foundation. Posts with no readable author are left out: they cannot be
 * grouped, and `firstPostOnlyGuard` hands them to the policy instead.
 */
function firstPostIdByAuthor(raws: readonly RawCandidate[]): ReadonlyMap<string, string> {
  const earliest = new Map<string, RawCandidate>()
  for (const raw of raws) {
    if (raw.authorId === null) continue
    const held = earliest.get(raw.authorId)
    if (held === undefined || isEarlier(raw, held)) earliest.set(raw.authorId, raw)
  }
  return new Map([...earliest].map(([authorId, raw]) => [authorId, raw.postId]))
}

/** Ties break on post id so the choice never depends on collection order. */
function isEarlier(a: RawCandidate, b: RawCandidate): boolean {
  return a.postedAt === b.postedAt ? comparePostId(a.postId, b.postId) < 0 : a.postedAt < b.postedAt
}
```

수집 직후 `const firstPosts = firstPostIdByAuthor(raws)`를 두고, 가드 문맥에 넘긴다.

```ts
      isFirstPostByAuthor: raw.authorId !== null && firstPosts.get(raw.authorId) === raw.postId,
```

`SessionDeps`에서 `resolveMembership`과 `newMemberWindowDays`를 지운다. 후보 순회 첫머리의 `deps.resolveMembership(raw)` 호출과 `DEFER` 분기, `deferred` 플래그, 그리고 `summary()`의 `deferred ? null : lastProcessedPostId` 삼항을 지운다(워터마크 자체는 Task 4에서 없앤다. 지금은 `lastProcessedPostId`를 그대로 둔다). 가드 문맥의 `authorMembership`, `newMemberWindowDays`도 지운다.

- [ ] **Step 9: 세션 조립과 미리보기를 맞춘다**

`src/desktop/session.ts`: `createMembershipResolver` 호출과 `resolveMembership`·`newMemberWindowDays` 전달을 지우고, 가드 목록을 `[operatorAlreadyCommentedGuard, firstPostOnlyGuard]`로 바꾼다. `windowDays`를 읽던 줄과 `SETTING_KEYS.newMemberWindowDays`, `parseWindowDays`, `DEFAULT_NEW_MEMBER_WINDOW_DAYS`를 지운다. `options.onProgress?.({ phase: 'PREPARING' })`는 이제 회원 조회가 없으므로 함께 지운다.

`src/desktop/preview.ts`: 같은 가드 목록을 쓰고, 회원 저장소·창 일수 의존을 지운다. 최초 글 계산은 오케스트레이터와 같은 함수를 써야 하므로 `firstPostIdByAuthor`를 `orchestrator.ts`에서 내보내 재사용한다.

- [ ] **Step 10: 로케일에 위험 신호 이름을 넣는다**

`src/renderer/locales/ko.ts`의 `risk` 아래에 `AUTHOR_UNKNOWN: '작성자 미상'`을 더한다. `progress.PREPARING` 항목은 Step 9에서 그 단계를 없앴으므로 함께 지운다. `SessionProgress`의 `PREPARING` 갈래와 `progressSummary`의 처리도 지운다.

- [ ] **Step 11: 기존 테스트를 새 규칙에 맞춘다**

`tests/shared/guards.test.ts`, `tests/desktop/orchestrator.test.ts`, `tests/desktop/session.test.ts`, `tests/desktop/preview.test.ts`에서 `authorMembership`·`newMemberWindowDays`·`resolveMembership`을 걷어내고 `isFirstPostByAuthor`를 쓴다. `newMember.test.ts`는 파일째 지운다.

오케스트레이터에 다음 테스트를 더한다.

- 같은 작성자의 두 글 중 이른 글만 대상이 되고 늦은 글은 `NOT_FIRST_POST`로 건너뛴다
- 수집이 최신 순으로 들어와도 같은 글이 대상이 된다
- 작성자가 없는 글에 `AUTHOR_UNKNOWN`이 붙는다
- 작성자가 없는 글이 다른 작성자의 최초 글 판정에 영향을 주지 않는다

- [ ] **Step 12: 전체를 확인한다**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 전부 통과. 테스트 총 건수를 보고한다.

- [ ] **Step 13: 커밋**

```bash
git add -A
git commit -m "feat: greet each author's earliest greeting of the day"
```

---

## Task 2: 실행 기록을 관문에서 기록으로

`claim`에서 작성자 중복 거부를 없애고, 끝나지 않은 행을 되살린다.

**Files:**
- Modify: `src/desktop/db/dedupeStore.ts`, `src/desktop/db/schema.ts`
- Create: `drizzle/` 마이그레이션 (생성물)
- Test: `tests/desktop/db/dedupeStore.test.ts` (없으면 신설), `tests/desktop/orchestrator.test.ts`

**Interfaces:**
- Produces: `claim`이 기존 행을 만나면 되살린 행의 id를 돌려준다. `SUCCESS`·`FAILED`·진행 중 상태에서는 `null`.

- [ ] **Step 1: 재개 규칙 테스트를 먼저 쓴다**

`tests/desktop/db/dedupeStore.test.ts`에 다음을 덮는 테스트를 쓴다. 각 상태로 행을 만들어 두고 같은 글을 다시 `claim`한다.

- `SKIPPED` 행은 되살아나 같은 id를 돌려준다. 상태는 새 행과 같은 대기 상태, 사유·위험 신호·해소 시각이 비고 시도 횟수는 0이다
- `EXPIRED`, `CANCELLED`도 같다
- `SUCCESS`는 `null`을 돌려주고 행이 그대로다 (성공 통계가 유지되어야 한다)
- `FAILED`도 `null`을 돌려주고 행이 그대로다
- `QUEUED`, `RETRY_WAIT`, `AWAITING_APPROVAL`은 `null`을 돌려주고 행이 그대로다
- 같은 작성자의 **다른** 글은 거부되지 않는다

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/desktop/db/dedupeStore.test.ts`
Expected: FAIL

- [ ] **Step 3: `claim`을 고친다**

작성자 조회 블록을 지우고, 삽입 전에 같은 글의 행을 찾는다. 찾은 행의 상태로 갈린다.

```ts
/** Rows the tool is done with. A finished post is not re-judged. */
const TERMINAL: readonly ExecutionStatus[] = ['SUCCESS', 'FAILED']
```

되살릴 때는 `applyPatch`가 아니라 같은 트랜잭션 안에서 갱신한다. 행 하나가 두 세션에 걸쳐 되살아나는 경쟁을 트랜잭션이 막는다. 주석에 왜 `SUCCESS`와 `FAILED`가 종단인지 적는다 — 설계 §4를 옮겨 적지 말고 한 줄로 요약한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/desktop/db/dedupeStore.test.ts`
Expected: PASS

- [ ] **Step 5: 작성자 인덱스를 지운다**

`src/desktop/db/schema.ts`에서 `executions_cafe_automation_author` 인덱스와 그 주석을 지운다.

Run: `pnpm db:generate`

**그 다음 `git status`로 `drizzle/meta/_journal.json`이 수정되고 새 스냅샷 파일이 생겼는지 확인한다.** 둘 다 커밋에 들어가야 한다.

- [ ] **Step 6: 전체를 확인하고 커밋한다**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add -A
git status --short
git commit -m "feat: re-judge a greeting the tool did not finish"
```

---

## Task 3: 회원 조회 계통 삭제

**Files:**
- Delete: `src/desktop/membership.ts`, `src/shared/members.ts`, `src/desktop/db/membersRepo.ts`, `tests/desktop/membership.test.ts`, `tests/shared/members.test.ts`, `tests/desktop/db/membersRepo.test.ts`, `tests/fixtures/member-list.json`
- Modify: `src/shared/protocol.ts`, `src/extension/cafeClient.ts`, `src/extension/background.ts`, `src/desktop/bootstrap.ts`, `src/desktop/db/schema.ts`, `scripts/dry-run.mjs`
- Test: `tests/shared/protocol.test.ts`, `tests/extension/cafeClient.test.ts`, `tests/desktop/bootstrap.test.ts`, `tests/desktop/rendererApi.test.ts`

- [ ] **Step 1: 프로토콜에서 메시지를 뺀다**

`src/shared/protocol.ts`에서 `FETCH_MEMBERS`, `MEMBERS`, `TIMEOUTS.fetchMembersMs`, `RawMember` import를 지우고 `APP_MESSAGE_TYPES`·`EXTENSION_MESSAGE_TYPES` 두 집합에서도 뺀다. `PROTOCOL_VERSION`을 **4**로 올린다.

두 집합과 유니온이 어긋나면 런타임에만 드러난다. `tests/shared/protocol.test.ts`가 이미 이를 검증하는지 확인하고, 하지 않으면 검증을 더한다.

- [ ] **Step 2: 확장에서 뺀다**

`src/extension/cafeClient.ts`의 `fetchMembers`와 `CafeClient`의 선언, `src/extension/background.ts`의 `FETCH_MEMBERS` 갈래를 지운다.

- [ ] **Step 3: 표와 저장소를 지운다**

`src/desktop/db/schema.ts`에서 `members` 표를 지우고, `membersRepo.ts`·`membership.ts`·`shared/members.ts`와 각 테스트를 지운다. `bootstrap.ts`의 `AppRepos.members`와 생성, `AppContextOptions`/`AppContext`에서 회원과 관련된 것을 지운다.

Run: `pnpm db:generate` — **`git status`로 저널과 스냅샷을 확인한다.**

- [ ] **Step 4: 스크립트를 맞춘다**

`scripts/dry-run.mjs`에서 회원 조회·판정 부분을 지우고, 새 규칙(오늘 글·안내 댓글 없음·작성자별 최초)이 그대로 드러나게 고친다. 이 스크립트는 글을 쓰지 않는다는 성질을 유지한다.

- [ ] **Step 5: 전체를 확인하고 커밋한다**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build:all`

```bash
git add -A
git status --short
git commit -m "refactor: drop the member list the greeting rule no longer consults"
```

---

## Task 4: 워터마크 삭제

**Files:**
- Delete: `src/desktop/db/watermarksRepo.ts`, `src/shared/postId.ts`의 잔여물이 있으면 정리
- Modify: `src/shared/protocol.ts`, `src/extension/cafeClient.ts`, `src/desktop/orchestrator.ts`, `src/desktop/session.ts`, `src/desktop/bootstrap.ts`, `src/desktop/db/schema.ts`, `scripts/session-once.mjs`, `scripts/dry-run.mjs`
- Test: `tests/extension/cafeClient.test.ts`, `tests/desktop/orchestrator.test.ts`, `tests/desktop/session.test.ts`, `tests/desktop/db/repos.test.ts`

- [ ] **Step 1: 수집이 늘 오늘을 바닥으로 삼게 한다**

`src/shared/protocol.ts`의 `COLLECT`에서 `sincePostId`를 지운다. `sincePostedAt: number | null`은 `number`로 좁힌다 — 바닥 없는 수집은 더 이상 존재하지 않는다.

`src/extension/cafeClient.ts`의 `collect`를 `collect(source, sincePostedAt: number)`로 바꾸고 `stopAtFirstPageOnly`·`useTimeFloor`·`isNewerThan` 분기를 지운다. 남는 종료 조건은 세 가지다: 바닥보다 오래된 글을 만남, 빈 페이지, 새로 담은 글이 없는 페이지.

- [ ] **Step 2: 오케스트레이터에서 뺀다**

`SessionDeps.watermark`, `lastProcessedPostId` 누적과 `SessionOutcome.lastProcessedPostId`, `laterPostId` import를 지운다. `sincePostedAt`은 늘 `kstDayStartMs(openedAt)`이다.

`SessionOutcome`이 좁아지므로 이를 읽는 곳(`session.ts`의 워터마크 저장, 렌더러의 `outcomeSummary`)을 함께 맞춘다.

- [ ] **Step 3: 표와 저장소를 지운다**

`schema.ts`의 `watermarks`, `watermarksRepo.ts`, `bootstrap.ts`의 배선, `session.ts`의 `repos.watermarks.get/set`을 지운다.

Run: `pnpm db:generate` — **저널과 스냅샷 확인.**

- [ ] **Step 4: 스크립트를 맞춘다**

`scripts/session-once.mjs`와 `scripts/dry-run.mjs`에서 워터마크를 걷어낸다.

- [ ] **Step 5: 전체를 확인하고 커밋한다**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build:all`

```bash
git add -A
git status --short
git commit -m "refactor: scan all of today rather than picking up from a mark"
```

---

## Task 5: 문서와 종단 확인

- [ ] **Step 1: 낡은 설계 문서에 대체 표시를 단다**

`docs/superpowers/specs/2026-08-23-new-member-identification-design.md` 머리에 이 설계로 대체되었다는 한 줄을 단다. 내용은 지우지 않는다 — 왜 그렇게 했다가 왜 되돌렸는지가 기록으로 남아야 한다.

- [ ] **Step 2: 남은 참조를 찾는다**

Run: `grep -rn "newMember\|membership\|watermark\|NOT_NEW_MEMBER\|FETCH_MEMBERS" src tests scripts docs --include=*.ts --include=*.tsx --include=*.mjs`

문서의 역사적 서술을 빼고 코드에 남은 것이 있으면 지운다.

- [ ] **Step 3: 쓰지 않는 스모크 테스트**

Run: `pnpm dry-run`

오늘 글 수, 대상 수, 건너뛴 수와 사유가 새 규칙대로 나오는지 본다. 글은 쓰지 않는다.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "docs: record that the join-date rule was replaced"
```
