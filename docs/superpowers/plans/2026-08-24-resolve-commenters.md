# 댓글 작성자 확인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 댓글이 달린 가입인사 글의 작성자를 실제로 조회해, 회원끼리 인사한 글과 운영진이 답한 글을 구분해 판정한다.

**Architecture:** 목록은 댓글 **수**만 준다는 사실을 프로토콜에 드러낸다. 작성자는 앱이 글 단위로 조회해 얻고, 그 결과를 하루 단위 저장소에 모아 미리보기와 세션이 나눠 쓴다.

**Tech Stack:** TypeScript(ESM), Electron 메인/렌더러, Chrome MV3 확장, vitest.

## Global Constraints

- 설계는 [댓글 작성자를 확인해 판정한다](../specs/2026-08-24-resolve-commenters-design.md)를 따른다. 문서와 코드가 어긋나면 문서를 고치는 것도 작업에 포함된다.
- 코드와 주석은 **영어**. 사용자 대면 문구는 `src/renderer/locales/ko.ts`에만 둔다.
- **시각 표시는 언제나 KST** (`CLAUDE.md`). 이 프로젝트는 한국어 전용이며 다국어는 요구사항이 아니다.
- 주석은 **왜**를 적고 **무엇을**은 적지 않는다. TODO 주석·죽은 코드·자리표시자 금지.
- `exactOptionalPropertyTypes: true`. 없을 수 있는 값은 조건부 스프레드(`src/extension/background.ts`의 `withReferer` 참고).
- 조회 간격은 **1000~1500ms 무작위**. 테스트는 실제로 기다리지 않는다 — 간격은 주입 가능한 의존이어야 한다.
- 각 작업이 끝난 시점에 `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:all`이 모두 통과해야 한다. 테스트 전체 수를 보고한다.
- 커밋 메시지에 AI 귀속(`Co-Authored-By` 등)을 넣지 않는다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/shared/automations/welcome-comment/parse.ts` | 목록에서 댓글 **수**를 읽는다 |
| `src/shared/protocol.ts` | `RawCandidate`가 수를 싣는다. 버전 6 |
| `src/shared/schedule.ts` | 조회 간격 |
| `src/desktop/commentAuthors.ts` | 신설. 조회와 하루치 결과 저장 |
| `src/desktop/orchestrator.ts` | 처리 직전 조회해 판정 |
| `src/desktop/preview.ts` | 좁혀가는 집계 |
| `src/desktop/bootstrap.ts`, `ipc.ts`, `rendererApi.ts`, `main.ts` | 배선 |
| `src/renderer/views/Dashboard.tsx` | 좁혀가는 표시 |

---

## Task 1: 목록은 댓글 수를 준다

목록이 작성자를 주지 않는다는 사실을 타입에 드러낸다. 지금은 `existingCommentAuthors: CommentAuthor[] | null`이 **"아무도 없음"·"있는데 누구인지 모름"·"못 읽음"** 세 가지를 두 값에 욱여넣고 있다.

**Files:**
- Modify: `src/shared/automations/welcome-comment/parse.ts`, `src/shared/protocol.ts`, `src/extension/cafeClient.ts`
- Test: `tests/shared/automations/welcome-comment/parse.test.ts`, `tests/shared/protocol.test.ts`

**Interfaces:**
- Produces: `RawCandidate.commentCount: number | null` (`null` = 목록을 읽지 못함). `existingCommentAuthors`는 `RawCandidate`에서 사라진다.

- [ ] **Step 1: 파서 테스트를 먼저 쓴다**

`tests/shared/automations/welcome-comment/parse.test.ts`에 더한다. 픽스처(`tests/fixtures/memo-list.html`)는 댓글 0인 글만 담고 있으므로, 수가 있는 경우는 마크업을 직접 만들어 덮는다.

- 목록의 `댓글 0`은 `commentCount: 0`이다
- 목록의 `댓글 3`은 `commentCount: 3`이다
- `_totalCnt`가 없거나 숫자를 못 읽으면 `commentCount: null`이다

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/shared/automations/welcome-comment/parse.test.ts`
Expected: FAIL — `commentCount`가 없다.

- [ ] **Step 3: 파서를 고친다**

`commentAuthors`를 지우고 다음으로 바꾼다.

```ts
const COMMENT_COUNT = /(\d+)/

/**
 * How many comments the list says a post has. The list never names who wrote
 * them — the comment block it renders is empty until the page asks for it — so
 * a count above zero means "somebody, unknown" and has to be resolved against
 * the post itself. `null` is the count being unreadable, which is the list
 * changing shape under us rather than anything about the post.
 */
function commentCount(replyBox: HTMLElement): number | null {
  const label = replyBox.querySelector('._totalCnt')?.text ?? ''
  const match = COMMENT_COUNT.exec(label)
  return match === null ? null : Number(match[1])
}
```

`parseMemoList`가 `existingCommentAuthors` 대신 `commentCount: commentCount(node)`를 싣는다.

- [ ] **Step 4: 프로토콜을 맞춘다**

`src/shared/protocol.ts`의 `RawCandidate`에서 `existingCommentAuthors`를 지우고 아래를 넣는다.

```ts
  /**
   * How many comments the board list reports. `null` means the list could not
   * be read. The list never names the commenters, so anything above zero has
   * to be resolved against the post before it can be judged.
   */
  readonly commentCount: number | null
```

`PROTOCOL_VERSION`을 **6**으로 올린다. 확장을 다시 로드해야 앱과 붙는다.

`CommentAuthor` import가 `RawCandidate`에서만 쓰였다면 정리한다 — `COMMENTS` 메시지가 여전히 쓰므로 확인 후 판단한다.

- [ ] **Step 5: 통과와 전체를 확인하고 커밋한다**

이 시점에 `src/desktop/orchestrator.ts`와 `src/desktop/preview.ts`가 없어진 필드를 참조해 타입 오류가 난다. **Task 2가 그 자리를 채우므로, 이 작업은 오케스트레이터와 미리보기가 `commentCount`를 읽어 지금과 같은 판정을 내도록 최소한으로만 손본다.**

- `commentCount === 0` → `existingCommentAuthors: []` 로 판정에 넘긴다
- 그 밖(양수 또는 `null`) → `existingCommentAuthors: null`

즉 동작은 그대로 두고 값의 출처만 바꾼다. 이렇게 해야 이 작업 하나로 전체가 초록이 된다.

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build:all`

```bash
git add -A
git commit -m "refactor: carry the comment count the list actually gives"
```

---

## Task 2: 작성자를 조회하고 하루치를 기억한다

조회와 그 결과 보관을 한 곳에 모은다. 세션과 미리보기가 같은 것을 쓰고, 같은 글을 두 번 조회하지 않게 하기 위해서다.

**Files:**
- Create: `src/desktop/commentAuthors.ts`, `tests/desktop/commentAuthors.test.ts`
- Modify: `src/shared/schedule.ts`
- Test: `tests/shared/schedule.test.ts`

**Interfaces:**
- Produces:
  - `nextCommentLookupDelayMs(random: Random): number`
  - `CommentAuthorLookup` — `resolve(postId: string, commentCount: number | null): Promise<CommentAuthor[] | null>`
  - `createCommentAuthorLookup(deps: CommentAuthorLookupDeps): CommentAuthorLookup`
  - `CommentAuthorLookupDeps` — `{ transport, cafeId, boardId, automationId, newRequestId, random, sleep }`

- [ ] **Step 1: 간격 테스트를 먼저 쓴다**

`tests/shared/schedule.test.ts`에 더한다. `nextPageFetchDelayMs` 테스트와 같은 방식으로 경계를 못박는다.

- 가장 낮은 난수는 정확히 1000ms
- 가장 높은 난수는 1500ms를 넘지 않는다

- [ ] **Step 2: 실패를 확인하고 구현한다**

`src/shared/schedule.ts`에 `nextPageFetchDelayMs` 바로 아래로 더한다.

```ts
/**
 * Delay before asking a post who commented on it. Shorter than the page gap
 * because these are single reads rather than a walk, and drawn at random for
 * the same reason everything else here is: a fixed beat is what gets noticed.
 */
const COMMENT_LOOKUP_MIN_MS = 1_000
const COMMENT_LOOKUP_MAX_MS = 1_500

export function nextCommentLookupDelayMs(random: Random): number {
  return random.intInclusive(COMMENT_LOOKUP_MIN_MS, COMMENT_LOOKUP_MAX_MS)
}
```

- [ ] **Step 3: 조회기 테스트를 먼저 쓴다**

`tests/desktop/commentAuthors.test.ts`. 가짜 transport로 `CHECK_COMMENTS` 응답을 돌려주고 요청을 기록한다.

- `commentCount === 0`이면 조회하지 않고 빈 배열을 돌려준다 (요청이 나가지 않았음을 확인)
- `commentCount === null`이면 조회하지 않고 `null`을 돌려준다
- `commentCount > 0`이면 조회해서 작성자를 돌려준다
- **같은 글을 두 번 물으면 조회는 한 번만 나간다**
- 조회 실패(`COMMENTS`의 `authors`가 `null`, 또는 예외)는 `null`이고, **기억하지 않는다** — 다음 물음에서 다시 조회한다
- 조회 전에 주입된 `sleep`이 1000~1500 범위 값으로 호출된다
- 첫 조회 앞에도 간격을 둔다

- [ ] **Step 4: 실패를 확인하고 구현한다**

`src/desktop/commentAuthors.ts`:

```ts
import { nextCommentLookupDelayMs } from '../shared/schedule.js'
import type { Random } from '../shared/ports.js'
import { TIMEOUTS } from '../shared/protocol.js'
import type { CommentAuthor } from '../shared/types.js'
import type { ExtensionTransport } from './ws/server.js'

export interface CommentAuthorLookupDeps {
  readonly transport: ExtensionTransport
  readonly cafeId: string
  readonly boardId: string
  readonly automationId: string
  readonly newRequestId: () => string
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
}

export interface CommentAuthorLookup {
  /**
   * Who commented on a post, or `null` when that cannot be established.
   *
   * A count of zero is the board stating nobody has, which needs no request.
   * A null count is the list itself being unreadable, which a request would
   * not fix. Everything else is asked once and remembered, so a preview and
   * the run it precedes do not each pay for the same post.
   */
  resolve(postId: string, commentCount: number | null): Promise<CommentAuthor[] | null>
}

export function createCommentAuthorLookup(deps: CommentAuthorLookupDeps): CommentAuthorLookup {
  const known = new Map<string, CommentAuthor[]>()

  return {
    async resolve(postId, commentCount) {
      if (commentCount === null) return null
      if (commentCount === 0) return []

      const remembered = known.get(postId)
      if (remembered !== undefined) return remembered

      await deps.sleep(nextCommentLookupDelayMs(deps.random))

      try {
        const reply = await deps.transport.request(
          {
            type: 'CHECK_COMMENTS',
            requestId: deps.newRequestId(),
            automationId: deps.automationId,
            action: { cafeId: deps.cafeId, boardId: deps.boardId, postId },
          },
          TIMEOUTS.commentCheckMs,
        )
        if (reply.type !== 'COMMENTS' || reply.authors === null) return null
        // Only a real answer is worth keeping. A failure remembered would
        // freeze a post out for as long as the app stays open.
        known.set(postId, reply.authors)
        return reply.authors
      } catch {
        return null
      }
    },
  }
}
```

- [ ] **Step 5: 통과를 확인하고 커밋한다**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build:all`

```bash
git add -A
git commit -m "feat: ask a post who commented on it, once"
```

---

## Task 3: 세션이 처리 직전에 조회한다

**Files:**
- Modify: `src/desktop/orchestrator.ts`, `src/desktop/session.ts`
- Test: `tests/desktop/orchestrator.test.ts`, `tests/desktop/session.test.ts`

**Interfaces:**
- Consumes: `CommentAuthorLookup`
- Produces: `SessionDeps.commentAuthors: CommentAuthorLookup`

- [ ] **Step 1: 테스트를 먼저 쓴다**

`tests/desktop/orchestrator.test.ts`에 더한다. 가짜 조회기를 주입해 호출된 글 번호를 기록한다.

- 댓글이 있는 글은 조회 결과로 판정된다 — 운영진이 있으면 건너뛰고, 회원만 있으면 대상이 된다
- **댓글이 0인 글은 조회하지 않는다** (조회기가 호출되지 않았음을 확인)
- 목록을 읽지 못한 글(`commentCount: null`)은 조회하지 않고 `COMMENT_CHECK_FAILED` 위험 신호가 붙는다
- 조회가 `null`을 돌려주면 `COMMENT_CHECK_FAILED` 위험 신호가 붙는다
- **세션 상한에 걸려 처리하지 않을 글은 조회하지도 않는다** — 상한 뒤의 글에 대해 조회기가 호출되지 않는다

마지막이 이 작업의 핵심이다. 미리 몰아서 조회하면 상한 뒤의 글에 쓴 조회가 통째로 버려진다.

- [ ] **Step 2: 실패를 확인하고 구현한다**

`SessionDeps`에 더한다.

```ts
  /** Resolves who commented on a post. Consulted only for posts about to be judged. */
  readonly commentAuthors: CommentAuthorLookup
```

후보 순회에서 `claim` 다음, 가드 평가 앞에 놓는다. `claim`이 이미 끝난 글을 걸러내므로, 그 뒤에 두면 우리가 답한 글에는 조회가 나가지 않는다.

```ts
    const existingCommentAuthors = await deps.commentAuthors.resolve(raw.postId, raw.commentCount)
```

가드 문맥의 `existingCommentAuthors`가 이 값을 쓴다.

**상한 확인이 조회보다 앞이어야 한다.** 지금 상한은 `runJob` 안의 `checkGates`가 본다. 조회를 그 앞에 두면 상한 뒤의 글도 조회된다. `checkGates`를 후보 순회 안에서 조회 전에 한 번 더 부르거나, 상한에 걸리면 순회를 끊는다 — 둘 중 하나를 고르고 **왜 그렇게 했는지 주석에 남긴다.**

- [ ] **Step 3: 세션 조립을 맞춘다**

`src/desktop/session.ts`가 `createCommentAuthorLookup`으로 조회기를 만들어 넘긴다. `random`과 `sleep`은 이미 `SessionRunnerOptions`에 있다.

- [ ] **Step 4: 통과를 확인하고 커밋한다**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build:all`

```bash
git add -A
git commit -m "feat: judge a greeting by who actually commented on it"
```

---

## Task 4: 확인 패널이 좁혀간다

**Files:**
- Modify: `src/desktop/preview.ts`, `src/desktop/bootstrap.ts`, `src/desktop/ipc.ts`, `src/desktop/rendererApi.ts`, `src/desktop/main.ts`, `src/renderer/views/Dashboard.tsx`, `src/renderer/locales/ko.ts`
- Test: `tests/desktop/preview.test.ts`, `tests/desktop/rendererApi.test.ts`, `tests/renderer/progressWording.test.ts`

**Interfaces:**
- Produces: `StartupPreview`의 `READY`가 `pending: number`를 더 싣는다 — 아직 조회하지 않아 판정되지 않은 글 수.

- [ ] **Step 1: 테스트를 먼저 쓴다**

`tests/desktop/preview.test.ts`:

- 조회 전에는 댓글 0인 글이 `count`에, 댓글 있는 글이 `pending`에 들어간다
- 조회가 끝나면 `pending`이 0이고, 결과가 `count`와 `alreadyHandled`로 갈라진다
- 미리보기가 쓴 조회기를 세션이 그대로 받으면 **같은 글을 다시 조회하지 않는다**

세 번째는 조회기 하나를 두 번 쓰는 것으로 검증한다 — 조회기가 이미 기억을 갖고 있으므로 요청이 나가지 않는다.

- [ ] **Step 2: 실패를 확인하고 구현한다**

`previewDay`가 `CommentAuthorLookup`을 받아 쓴다. 진행 상태를 앱이 들고 있어야 렌더러가 폴링으로 읽을 수 있으므로, `bootstrap`에 하루치 미리보기 상태를 두고 `previewDay`가 진행하면서 갱신한다.

`DashboardSnapshot`에 실어 렌더러가 지금 쓰는 5초 폴링으로 읽는다. **새로운 밀어내기 통로를 만들지 않는다.**

- [ ] **Step 3: 화면**

패널이 세 줄에 더해 조회 진행을 보여준다. 문구는 로케일에 둔다.

```
댓글을 달 대상      3건 (확인 중 12건)
이미 댓글이 달린 글  1건
예상 소요           2분
```

`확인 중`이 0이면 그 괄호는 나오지 않는다. 승인 잠금은 **첫 숫자가 나오면 풀린다** — 좁혀지는 도중에도 승인할 수 있어야 한다는 것이 이 작업의 요구다.

- [ ] **Step 4: 문구를 실제로 그려본다**

`tests/renderer/progressWording.test.ts`가 하는 방식대로 새 문구를 i18next로 그려 중괄호가 남지 않는지 확인한다.

- [ ] **Step 5: 통과를 확인하고 커밋한다**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build:all`

```bash
git add -A
git commit -m "feat: narrow the count while it is being established"
```

---

## Task 5: 종단 확인

- [ ] **Step 1: 남은 참조를 찾는다**

Run: `grep -rn "existingCommentAuthors" src tests scripts`

`GuardContext`와 `CommentAuthor`는 남는다. `RawCandidate`에는 없어야 한다.

- [ ] **Step 2: 리허설 스크립트를 맞춘다**

`scripts/dry-run.mjs`가 `existingCommentAuthors`로 판정하고 있다. 조회기를 써서 세션과 같은 답을 내게 한다. **글은 쓰지 않는다**는 성질과 **마이그레이션 폴더 없이 DB를 연다**는 성질을 유지한다.

- [ ] **Step 3: 확장을 다시 로드하고 리허설을 돌린다**

프로토콜이 6이므로 확장 재로드가 필요하다.

Run: `pnpm build && node scripts/dry-run.mjs`

오늘 대상이 조회를 거쳐 나오는지, 회원만 답한 글이 대상에 들어오는지 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "docs: record that commenters are resolved per post"
```
