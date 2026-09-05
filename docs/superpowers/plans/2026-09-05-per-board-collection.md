# 게시판별 수집 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전체글 목록의 1000쪽 한계 너머를 게시판별 목록으로 걷는다. 작업 하나가 게시판 수만큼의 피드를 글 수 내림차순으로 이어 걷고, 재개 실패와 피드 한계를 완료로 오인하지 않는다.

**Architecture:** `feed_state`/`runs`는 이미 `(feed_kind, menu_id)`로 키가 잡혀 있으므로 새 `feed_kind = 'board'`를 더해 게시판마다 한 행을 둔다. 오케스트레이터는 지금처럼 피드 하나를 걷고, 러너가 대기열 순서로 피드를 이어 돌리며 블록의 페이지 예산을 나눠 쓴다. 프로토콜의 `menuId` 상수를 숫자 문자열로 연다.

**Tech Stack:** TypeScript, Electron, React, Drizzle ORM(PostgreSQL), vitest, MV3 확장.

설계: `docs/superpowers/specs/2026-09-05-per-board-collection-design.md`

## Global Constraints

- 사용자에게 보이는 문구는 `src/shared/text.ts`에만 둔다. 한국어 전용, i18n 없음.
- 시각은 KST. `src/shared/kst.ts`의 `KST_OFFSET_MS`/`kstDayRange` 외의 시간대 계산 금지.
- `PROTOCOL_VERSION`이 오르면 앱과 확장을 함께 다시 패키징한다(`pnpm package:app:mac`). 그러지 않으면 짝짓기가 조용히 죽는다.
- 커밋 메시지는 `<type>: <description>`, AI 서명 없음. 커밋마다 `pnpm typecheck && pnpm test`가 통과해야 한다.
- 통합 테스트는 `COLLECTION_TEST_DATABASE_URL`(이름이 `_test`로 끝나는 빈 DB)로 `pnpm test:collection:integration`.
- 기존 실행 중인 앱은 이 계획과 무관하게 계속 돈다. 코드 변경은 패키징 전까지 앱에 영향이 없다.

---

## 파일 구조

| 파일 | 역할 | 변경 |
|---|---|---|
| `src/shared/cafeArticleFixture.ts` | 목록 엔드포인트 URL과 판정 | `cafeArticleListUrl(page, menuId)`, 엔드포인트 판정이 메뉴를 변수로 |
| `src/shared/protocol.ts` | 앱↔확장 메시지 | `menuId: string`, 검증 `/^\d+$/`, 버전 10 |
| `src/extension/boardPageReader.ts` | 확장의 한 쪽 읽기 | 메뉴를 URL에 넣는다 |
| `src/desktop/collection-db/schema.ts` | 수집 DB 스키마 | enum `board`, `queue_order`, `horizon_reached_at` |
| `drizzle-collection/0004_*.sql` | 마이그레이션 | 생성 |
| `src/desktop/collection-db/repository.ts` | 쓰기 | `listFeedStates`, `replaceJob`, `markHorizonReached`, `setForced`가 작업 전체에 |
| `src/desktop/collectionScope.ts` | **새 파일.** 행 여럿을 작업 하나로 읽는 순수 함수 | 생성 |
| `src/desktop/collectionOrchestrator.ts` | 피드 하나 걷기 | 메뉴별 fetcher, `RESUME_POSITION_LOST`, `FEED_HORIZON`, 결과에 `requests` |
| `src/desktop/collectionRunner.ts` | 한 블록 | 피드 목록을 예산 안에서 이어 걷는다 |
| `src/desktop/collectionJob.ts` | 예약 루프가 보는 작업 | 행 여럿에서 존재·완료·강제를 모은다 |
| `src/desktop/collection-db/statusQuery.ts` | 화면이 읽는 것 | 범위, 게시판별 진행 |
| `src/desktop/rendererApi.ts` | IPC 구현 | 범위 선택, 교체가 작업 전체를 |
| `src/desktop/ipc.ts` | IPC 타입 | `CollectionRunRequest.scope` |
| `src/renderer/views/CollectionStatus.tsx` | 수집 현황 | 범위 라디오, 게시판별 표 |
| `src/renderer/views/dashboard/CollectionJob.tsx` | 대시보드 카드 | 요약 한 줄 |
| `src/shared/text.ts` | 문구 | 추가 |

---

### Task 1: 프로토콜과 확장이 메뉴를 받는다

**Files:**
- Modify: `src/shared/cafeArticleFixture.ts`
- Modify: `src/shared/protocol.ts:7` (버전), `:33-42` (요청 타입), `:200-213` (검증)
- Modify: `src/extension/boardPageReader.ts:29`
- Test: `tests/shared/cafeArticleFixture.test.ts`, `tests/shared/protocol.test.ts`, `tests/extension/boardPageReader.test.ts`

**Interfaces:**
- Produces: `cafeArticleListUrl(page: number, menuId: string): string`; `CollectBoardPageRequest.menuId: string`; `PROTOCOL_VERSION = 10`.
- 뒤 작업이 의존: Task 2의 fetcher가 `menuId`를 메시지에 넣는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/cafeArticleFixture.test.ts`의 `describe('cafeArticleListUrl')`에 추가:

```ts
  it('puts the menu into the path, so a board list is the same endpoint with a different menu', () => {
    expect(cafeArticleListUrl(12, '137')).toBe(
      'https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/137/articles?page=12&pageSize=50&sortBy=TIME&viewType=L',
    )
    expect(() => cafeArticleListUrl(1, '')).toThrow('menuId must be digits')
    expect(() => cafeArticleListUrl(1, '1a')).toThrow('menuId must be digits')
  })

  it('recognises the endpoint for any menu, but never another cafe', () => {
    expect(isCafeArticleListEndpoint('https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/137/articles?page=1')).toBe(true)
    expect(isCafeArticleListEndpoint('https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/1/menus/0/articles?page=1')).toBe(false)
    expect(isCafeArticleListTarget('https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/137/articles?page=1&pageSize=50&sortBy=TIME&viewType=L')).toBe(true)
  })
```

기존 `cafeArticleListUrl(12)` 호출은 `cafeArticleListUrl(12, '0')`로, `menus/1/... toBe(false)` 단언은 위의 새 단언으로 바꾼다(메뉴 1도 이제 대상이다).

`tests/shared/protocol.test.ts`의 COLLECT_BOARD_PAGE 검사 근처에 추가:

```ts
  it('accepts any numeric menu on a board page request and refuses anything else', () => {
    const base = { type: 'COLLECT_BOARD_PAGE' as const, requestId: 'r', cafeId: '14538121', page: 1, pageSize: 50, sortBy: 'TIME' as const, viewType: 'L' as const }
    expect(isCollectBoardPageRequest({ ...base, menuId: '137' })).toBe(true)
    expect(isCollectBoardPageRequest({ ...base, menuId: '0' })).toBe(true)
    expect(isCollectBoardPageRequest({ ...base, menuId: '' })).toBe(false)
    expect(isCollectBoardPageRequest({ ...base, menuId: '13a' })).toBe(false)
    expect(isCollectBoardPageRequest({ ...base, menuId: 137 })).toBe(false)
  })
```

`tests/extension/boardPageReader.test.ts`의 첫 테스트에서 `expect(seen).toEqual([cafeArticleListUrl(1)])`를 `cafeArticleListUrl(1, '0')`로 바꾸고, 테스트 하나 추가:

```ts
  it('reads the menu the request names', async () => {
    const seen: string[] = []
    const reader = createBoardPageReader({
      http: async ({ url }) => { seen.push(url); return { status: 200, contentType: 'application/json', text: pageOne } },
    })
    await reader.read({ ...request, menuId: '137' })
    expect(seen).toEqual([cafeArticleListUrl(1, '137')])
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/cafeArticleFixture.test.ts tests/shared/protocol.test.ts tests/extension/boardPageReader.test.ts`
Expected: 타입 오류 또는 FAIL (`cafeArticleListUrl`이 인자 하나만 받음, `menuId: '137'`이 타입에 안 맞음).

- [ ] **Step 3: 구현한다**

`src/shared/cafeArticleFixture.ts`:

```ts
export const CAFE_ARTICLE_LIST = {
  cafeId: '14538121',
  /** The whole-cafe list. A board's own list is the same endpoint with its menu. */
  menuId: '0',
  pageSize: 50,
  sortBy: 'TIME',
  viewType: 'L',
} as const

const API_ORIGIN = 'https://apis.naver.com'
const ARTICLE_LIST_PATH = new RegExp(`^/cafe-web/cafe-boardlist-api/v1/cafes/${CAFE_ARTICLE_LIST.cafeId}/menus/\\d+/articles$`)
const MENU_ID = /^\d+$/

export function isMenuId(value: string): boolean {
  return MENU_ID.test(value)
}

export function cafeArticleListUrl(page: number, menuId: string): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error(`page must be a positive safe integer: ${page}`)
  }
  if (!isMenuId(menuId)) throw new Error(`menuId must be digits: ${menuId}`)

  const url = new URL(`${API_ORIGIN}/cafe-web/cafe-boardlist-api/v1/cafes/${CAFE_ARTICLE_LIST.cafeId}/menus/${menuId}/articles`)
  url.searchParams.set('page', String(page))
  url.searchParams.set('pageSize', String(CAFE_ARTICLE_LIST.pageSize))
  url.searchParams.set('sortBy', CAFE_ARTICLE_LIST.sortBy)
  url.searchParams.set('viewType', CAFE_ARTICLE_LIST.viewType)
  return url.toString()
}

/** True for this cafe's list endpoint, whichever menu, regardless of query. */
export function isCafeArticleListEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.origin === API_ORIGIN && ARTICLE_LIST_PATH.test(url.pathname)
}
```

`isCafeArticleListTarget`은 그대로 둔다(엔드포인트 판정만 바뀌었다).

`src/shared/protocol.ts`:

```ts
export const PROTOCOL_VERSION = 10
```

```ts
export interface CollectBoardPageRequest {
  readonly type: 'COLLECT_BOARD_PAGE'
  readonly requestId: string
  readonly cafeId: typeof CAFE_ARTICLE_LIST.cafeId
  /** Digits. `'0'` is the whole cafe; anything else is one board's own list. */
  readonly menuId: string
  readonly page: number
  readonly pageSize: typeof CAFE_ARTICLE_LIST.pageSize
  readonly sortBy: typeof CAFE_ARTICLE_LIST.sortBy
  readonly viewType: typeof CAFE_ARTICLE_LIST.viewType
}
```

검증에서 `message.menuId === CAFE_ARTICLE_LIST.menuId &&`를 `typeof message.menuId === 'string' && isMenuId(message.menuId) &&`로 바꾸고 `isMenuId`를 import한다. 주석 "fixed, deliberately narrow menu=0 collection contract"는 "one cafe, one list endpoint, any of its menus"로 고친다.

`src/extension/boardPageReader.ts:29`:

```ts
        response = await deps.http({ url: cafeArticleListUrl(request.page, request.menuId) })
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm typecheck && pnpm vitest run tests/shared tests/extension tests/desktop/naverReadGate.test.ts`
Expected: PASS. (`naverReadGate.test.ts`는 `menuId: '0'` 리터럴을 쓰므로 그대로 통과한다.)

- [ ] **Step 5: 커밋**

```bash
git add src/shared/cafeArticleFixture.ts src/shared/protocol.ts src/extension/boardPageReader.ts tests/shared/cafeArticleFixture.test.ts tests/shared/protocol.test.ts tests/extension/boardPageReader.test.ts
git commit -m "feat: let a board page request name its menu"
```

---

### Task 2: 스키마와 저장소가 게시판 피드를 안다

**Files:**
- Modify: `src/desktop/collection-db/schema.ts:28` (enum), `feed_state` 테이블 정의
- Create: `drizzle-collection/0004_<name>.sql` (drizzle-kit이 생성)
- Modify: `src/desktop/collection-db/repository.ts`
- Create: `src/desktop/collectionScope.ts`
- Test: `tests/desktop/collectionScope.test.ts` (새), `tests/desktop/collection-db/integration.test.ts`

**Interfaces:**
- Produces (repository):
  ```ts
  export type CollectionFeedKind = 'all_articles' | 'board'
  export interface CollectionFeed { readonly feedKind: CollectionFeedKind; readonly menuId: string }
  export interface StoredFeedState extends CollectionFeedState {
    readonly feed: CollectionFeed
    readonly queueOrder: number | null
    readonly horizonReached: boolean
    readonly boardName: string | null
  }
  export interface ReplaceJobInput { readonly scope: CollectionFeedKind; readonly targetStartMs: number; readonly targetEndMs: number; readonly at: Date }
  listFeedStates(): Promise<readonly StoredFeedState[]>
  replaceJob(input: ReplaceJobInput): Promise<readonly StoredFeedState[]>
  markHorizonReached(feed: CollectionFeed, at: Date): Promise<void>
  setForced(forcedAt: Date | null): Promise<void>   // 인자에서 feed가 빠진다: 작업 전체
  ```
  `CollectionFeedState`에 `readonly horizonReached: boolean` 추가.
- Produces (collectionScope):
  ```ts
  export interface JobDescription {
    readonly scope: CollectionFeedKind
    readonly targetStartMs: number
    readonly targetEndMs: number
    readonly feeds: readonly StoredFeedState[]      // board면 queue_order 순
    readonly complete: boolean                       // 모두 완료 또는 한계
    readonly forced: boolean
    readonly remaining: readonly StoredFeedState[]   // 아직 걸을 것, 순서대로
  }
  export function describeJob(rows: readonly StoredFeedState[]): JobDescription | null
  ```

- [ ] **Step 1: `describeJob`의 실패하는 테스트**

`tests/desktop/collectionScope.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { describeJob } from '../../src/desktop/collectionScope.js'
import type { StoredFeedState } from '../../src/desktop/collection-db/repository.js'

function row(over: Partial<StoredFeedState> & { menuId: string; feedKind?: 'all_articles' | 'board' }): StoredFeedState {
  return {
    feed: { feedKind: over.feedKind ?? 'board', menuId: over.menuId },
    stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null,
    cursorUpdatedAtMs: 0, targetStartMs: 100, targetEndMs: 200,
    complete: false, forced: false, horizonReached: false, queueOrder: null, boardName: null,
    ...over,
  }
}

describe('describeJob', () => {
  it('is null when nothing has been asked for', () => {
    expect(describeJob([])).toBeNull()
  })

  it('reads a whole-cafe job from its single row', () => {
    const job = describeJob([row({ feedKind: 'all_articles', menuId: '0', complete: true })])
    expect(job).toMatchObject({ scope: 'all_articles', complete: true, remaining: [] })
  })

  it('orders board rows by queue and lists what is left to walk', () => {
    const job = describeJob([
      row({ menuId: '205', queueOrder: 3 }),
      row({ menuId: '137', queueOrder: 1, complete: true }),
      row({ menuId: '189', queueOrder: 2, horizonReached: true }),
    ])
    expect(job?.feeds.map((f) => f.feed.menuId)).toEqual(['137', '189', '205'])
    expect(job?.remaining.map((f) => f.feed.menuId)).toEqual(['205'])
    expect(job?.complete).toBe(false)
  })

  it('is complete when every board is done or beyond the cafe horizon, and forced when any row is', () => {
    const job = describeJob([
      row({ menuId: '137', queueOrder: 1, complete: true }),
      row({ menuId: '189', queueOrder: 2, horizonReached: true, forced: true }),
    ])
    expect(job).toMatchObject({ complete: true, forced: true })
  })

  it('prefers the board job when both kinds of row are present', () => {
    // Replacing deletes the other kind, so this is a repair path rather than
    // a state the app produces; the board rows are the newer intent.
    const job = describeJob([row({ feedKind: 'all_articles', menuId: '0' }), row({ menuId: '137', queueOrder: 1 })])
    expect(job?.scope).toBe('board')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/collectionScope.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 스키마를 바꾸고 마이그레이션을 만든다**

`src/desktop/collection-db/schema.ts`:

```ts
/**
 * `board` is one board's own list, which the cafe pages separately: every
 * board gets a thousand pages of its own where the whole-cafe list gets a
 * thousand in total. A period older than the whole-cafe list can reach is
 * walked board by board.
 */
export const collectionFeedKind = pgEnum('collection_feed_kind', ['all_articles', 'notices', 'recommended', 'board'])
```

`feedState` 테이블에 열 둘을 더한다(기존 `forcedAt` 뒤):

```ts
    /**
     * Where this feed stands in the job's queue; board feeds only. Fixed when
     * the job is made, so "how far along" means the same thing every day.
     */
    queueOrder: integer('queue_order'),
    /**
     * When the walk hit the last page the cafe will serve with the period
     * still unfinished. Not completion: there may be more below, and the cafe
     * will not show it. Cleared when the period is replaced.
     */
    horizonReachedAt: observedTimestamp('horizon_reached_at'),
```

그리고 테이블 제약 배열에 `check('feed_state_queue_order', sql\`${table.queueOrder} is null or ${table.queueOrder} >= 1\`)`를 더한다.

Run: `pnpm db:collection:generate`
Expected: `drizzle-collection/0004_<이름>.sql`이 생기고 내용이 다음과 같다(순서는 다를 수 있다):

```sql
ALTER TYPE "public"."collection_feed_kind" ADD VALUE 'board';--> statement-breakpoint
ALTER TABLE "feed_state" ADD COLUMN "queue_order" integer;--> statement-breakpoint
ALTER TABLE "feed_state" ADD COLUMN "horizon_reached_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "feed_state" ADD CONSTRAINT "feed_state_queue_order" CHECK ("feed_state"."queue_order" is null or "feed_state"."queue_order" >= 1);
```

파일을 열어 확인한다. `ADD VALUE`는 트랜잭션 안에서 같은 문장에 그 값을 쓸 수 없는데, 이 마이그레이션은 값을 쓰지 않으므로 괜찮다.

- [ ] **Step 4: 저장소를 바꾼다**

`src/desktop/collection-db/repository.ts` 상단 타입:

```ts
export type CollectionFeedKind = 'all_articles' | 'board'

/**
 * Which feed of the cafe. The cafe itself is the database, so it is not part of
 * this: one collection database holds one cafe's feeds. `all_articles` is the
 * whole cafe under menu 0; `board` is one board's own list under its menu.
 */
export interface CollectionFeed {
  readonly feedKind: CollectionFeedKind
  readonly menuId: string
}
```

`CollectionFeedState`에 추가:

```ts
  /** Whether the cafe stopped serving pages before the period was done. */
  readonly horizonReached: boolean
```

새 타입과 인터페이스 멤버:

```ts
/** A feed's state together with what identifies it, for reading the job whole. */
export interface StoredFeedState extends CollectionFeedState {
  readonly feed: CollectionFeed
  readonly queueOrder: number | null
  readonly boardName: string | null
}

export interface ReplaceJobInput {
  readonly scope: CollectionFeedKind
  readonly targetStartMs: number
  readonly targetEndMs: number
  readonly at: Date
}

export interface CollectionRepository {
  readFeedState(feed: CollectionFeed): Promise<CollectionFeedState | null>
  /** Every feed row, board rows carrying their board's name. */
  listFeedStates(): Promise<readonly StoredFeedState[]>
  /**
   * Makes the job anew: rows of the other scope go, rows of this scope are
   * reset to the period, and a board job gets one row per collectable board
   * ordered by how many of its posts are already stored, most first.
   */
  replaceJob(input: ReplaceJobInput): Promise<readonly StoredFeedState[]>
  startRun(input: CreateCollectionRunInput): Promise<CollectionFeedState>
  recordPageRequest(id: string, phase: 'probe' | 'collection'): Promise<void>
  finishRun(id: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  /** Records that the cafe would serve no more pages for this feed. */
  markHorizonReached(feed: CollectionFeed, at: Date): Promise<void>
  /** Turns the operating hours off, or back on, for the whole job as it stands. */
  setForced(forcedAt: Date | null): Promise<void>
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
  persistPage(input: PersistCollectedPageInput): Promise<PersistCollectedPageResult>
}
```

행을 상태로 바꾸는 헬퍼를 하나 두고 `readFeedState`/`startRun`의 반환 조립도 이것으로 통일한다:

```ts
type FeedStateRow = typeof feedState.$inferSelect

function toFeedState(row: FeedStateRow): CollectionFeedState {
  return {
    stateVersion: row.stateVersion,
    targetStartMs: row.targetStartMs,
    targetEndMs: row.targetEndMs,
    anchorPostId: row.anchorPostId,
    anchorPostedAtMs: row.anchorPostedAt?.getTime() ?? null,
    referencePage: row.referencePage,
    pageIdentity: row.pageIdentity,
    cursorUpdatedAtMs: row.updatedAt.getTime(),
    complete: row.completedAt !== null,
    forced: row.forcedAt !== null,
    horizonReached: row.horizonReachedAt !== null,
  }
}
```

새 메서드 구현:

```ts
    async listFeedStates() {
      const rows = await db
        .select({ state: feedState, boardName: boards.name })
        .from(feedState)
        .leftJoin(boards, and(eq(feedState.feedKind, 'board'), eq(boards.boardId, feedState.menuId)))
        .orderBy(feedState.feedKind, feedState.queueOrder, feedState.menuId)
      return rows.map(({ state, boardName }) => ({
        ...toFeedState(state),
        feed: { feedKind: state.feedKind as CollectionFeedKind, menuId: state.menuId },
        queueOrder: state.queueOrder,
        boardName,
      }))
    },

    async replaceJob(input) {
      if (!Number.isSafeInteger(input.targetStartMs) || !Number.isSafeInteger(input.targetEndMs) || input.targetStartMs >= input.targetEndMs) {
        throw new Error('collection job target range must contain a positive interval')
      }
      await db.transaction(async (tx) => {
        const running = await tx.select({ id: collectionRuns.id }).from(collectionRuns).where(eq(collectionRuns.status, 'running')).limit(1)
        if (running.length > 0) throw new Error('cannot replace the job while a run is writing its cursor')
        // One job at a time: whatever the other scope held is gone, and its
        // runs stay in `runs` as history because nothing there points here.
        await tx.delete(feedState)
        if (input.scope === 'all_articles') {
          await tx.insert(feedState).values({
            feedKind: 'all_articles', menuId: CAFE_ARTICLE_LIST.menuId,
            targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs,
            stateVersion: 0, updatedAt: input.at,
          })
          return
        }
        // Most posts first. The count is what this database already holds,
        // which is the operator's own measure of where the bulk is.
        const ordered = await tx
          .select({ boardId: boards.boardId, stored: sql<string>`count(${posts.postId})` })
          .from(boards)
          .leftJoin(posts, eq(posts.boardId, boards.boardId))
          .where(eq(boards.collectEnabled, true))
          .groupBy(boards.boardId)
          .orderBy(sql`count(${posts.postId}) desc`, boards.boardId)
        if (ordered.length === 0) throw new Error('no collectable boards are known yet')
        await tx.insert(feedState).values(
          ordered.map((board, index) => ({
            feedKind: 'board' as const, menuId: board.boardId,
            targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs,
            stateVersion: 0, queueOrder: index + 1, updatedAt: input.at,
          })),
        )
      })
      return await this.listFeedStates()
    },

    async markHorizonReached(feed, at) {
      await db
        .update(feedState)
        .set({ horizonReachedAt: at, forcedAt: null })
        .where(and(eq(feedState.feedKind, feed.feedKind), eq(feedState.menuId, feed.menuId)))
    },

    async setForced(forcedAt) {
      await db.update(feedState).set({ forcedAt })
    },
```

`CAFE_ARTICLE_LIST`는 `../../shared/cafeArticleFixture.js`에서 import한다. `this.listFeedStates()`는 객체 리터럴의 메서드라 `this`가 객체를 가리키지만, 안전하게 `createCollectionRepository` 안에서 `const repository: CollectionRepository = { ... }`로 이름을 두고 `repository.listFeedStates()`로 부른 뒤 `return repository`한다.

`startRun`의 reset 분기에 `horizonReachedAt: null`을 더한다. `startRun`은 행이 없으면 만드는 지금 동작을 유지한다(전체글 작업이 `replaceJob` 없이 시작되던 경로가 남는다). `finishRun`은 그대로다.

- [ ] **Step 5: `collectionScope.ts`를 쓴다**

```ts
import type { CollectionFeedKind, StoredFeedState } from './collection-db/repository.js'

/**
 * The job as one thing, read from however many rows hold it.
 *
 * A whole-cafe job is one row. A board job is one row per board, all sharing a
 * period, each with its own cursor. Everyone who asks "is there a job, is it
 * done, is it forced" — the scheduler, the screens, the start button — asks
 * this, so the rows can never be read two ways.
 */
export interface JobDescription {
  readonly scope: CollectionFeedKind
  readonly targetStartMs: number
  readonly targetEndMs: number
  /** In walking order. */
  readonly feeds: readonly StoredFeedState[]
  /** Nothing left that a run could advance: each feed is done or beyond reach. */
  readonly complete: boolean
  readonly forced: boolean
  /** The feeds a block would walk next, in order. */
  readonly remaining: readonly StoredFeedState[]
}

function settled(feed: StoredFeedState): boolean {
  return feed.complete || feed.horizonReached
}

export function describeJob(rows: readonly StoredFeedState[]): JobDescription | null {
  const boardRows = rows.filter((row) => row.feed.feedKind === 'board')
  const feeds =
    boardRows.length > 0
      ? [...boardRows].sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0))
      : rows.filter((row) => row.feed.feedKind === 'all_articles')
  const first = feeds[0]
  if (first === undefined) return null
  return {
    scope: first.feed.feedKind,
    targetStartMs: first.targetStartMs,
    targetEndMs: first.targetEndMs,
    feeds,
    complete: feeds.every(settled),
    forced: feeds.some((feed) => feed.forced),
    remaining: feeds.filter((feed) => !settled(feed)),
  }
}
```

- [ ] **Step 6: 통합 테스트를 더한다**

`tests/desktop/collection-db/integration.test.ts` 안, 기존 `it` 뒤에 추가한다(테스트 DB에 `boards` 행이 필요하므로 페이지를 한 번 저장한 뒤에):

```ts
  it('makes a board job with one row per board, most stored posts first, and replaces it whole', async () => {
    const repository = createCollectionRepository(connection.db)
    // Two boards from the fixture page: the one with more rows on it comes first.
    const counts = new Map<string, number>()
    for (const item of page.items) counts.set(item.boardId, (counts.get(item.boardId) ?? 0) + 1)
    const expected = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id)

    const made = await repository.replaceJob({ scope: 'board', targetStartMs: 1_000, targetEndMs: 2_000, at: new Date(5_000) })
    expect(made.map((row) => row.feed.menuId)).toEqual(expected)
    expect(made.map((row) => row.queueOrder)).toEqual(expected.map((_, index) => index + 1))
    expect(made.every((row) => row.boardName !== null)).toBe(true)
    expect(await repository.readFeedState({ feedKind: 'all_articles', menuId: '0' })).toBeNull()

    await repository.markHorizonReached(made[0]!.feed, new Date(6_000))
    expect((await repository.listFeedStates())[0]).toMatchObject({ horizonReached: true })

    await repository.setForced(new Date(7_000))
    expect((await repository.listFeedStates()).every((row) => row.forced)).toBe(true)

    const back = await repository.replaceJob({ scope: 'all_articles', targetStartMs: 1_000, targetEndMs: 2_000, at: new Date(8_000) })
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ feed: { feedKind: 'all_articles', menuId: '0' }, horizonReached: false, forced: false })
  })
```

기존 통합 테스트에서 `repository.setForced(feed, date)`를 부르는 곳이 있으면 `repository.setForced(date)`로 바꾼다. 상태 조회(`statusQuery`)를 부르는 곳은 Task 6에서 손본다.

- [ ] **Step 7: 통과를 확인한다**

Run: `pnpm typecheck && pnpm vitest run tests/desktop/collectionScope.test.ts tests/desktop/collection-db`
Expected: PASS. 이 시점에 `rendererApi.ts`, `collectionOrchestrator.test.ts`의 가짜 저장소 등에서 타입 오류가 난다 — `setForced` 시그니처와 새 멤버 때문이다. 가짜 저장소에는 `listFeedStates: async () => []`, `replaceJob: async () => []`, `markHorizonReached: async () => undefined`, 상태에 `horizonReached: false`를 더해 통과시킨다. `rendererApi.ts`의 `setForced(ALL_ARTICLES_FEED, …)`는 `setForced(…)`로 바꿔 둔다(제대로 된 처리는 Task 5).

Run: `COLLECTION_TEST_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection_test pnpm test:collection:integration`
Expected: PASS. DB가 비어 있지 않다고 거절하면 `dropdb whisky_manager_collection_test && createdb whisky_manager_collection_test` 뒤에 다시.

- [ ] **Step 8: 커밋**

```bash
git add src/desktop/collection-db/schema.ts drizzle-collection src/desktop/collection-db/repository.ts src/desktop/collectionScope.ts tests/desktop/collectionScope.test.ts tests/desktop/collection-db tests/desktop/collectionOrchestrator.test.ts src/desktop/rendererApi.ts
git commit -m "feat: hold a job as one row per board, queued by stored post count"
```

---

### Task 3: 오케스트레이터가 메뉴를 걷고, 잃은 자리와 한계를 완료로 적지 않는다

**Files:**
- Modify: `src/desktop/collectionOrchestrator.ts:36-44` (fetcher), `:11-16` (결과), `:195-230` (재개·fallback)
- Test: `tests/desktop/collectionOrchestrator.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function createBoardPageFetcher(transport: ExtensionTransport, newRequestId: () => string, menuId: string): BoardPageFetcher
  // 모든 CollectionRunResult 변형에 추가:
  readonly requests: number   // 이 실행이 카페에 보낸 요청 수(탐색 포함)
  // 새 partial 사유
  | { readonly kind: 'partial'; readonly pagesStored: number; readonly requests: number; readonly reason: 'PAGE_BUDGET_SPENT' | 'FEED_HORIZON' }
  ```
- 새 실패 코드 `RESUME_POSITION_LOST`. 1000쪽은 상수 `FEED_HORIZON_PAGE = 1000`.

- [ ] **Step 1: 실패하는 테스트**

`tests/desktop/collectionOrchestrator.test.ts`에 추가. 가짜 저장소 `repositoryWithCheckpoint`에 `horizon: CollectionFeed[]` 배열과 `markHorizonReached: async (feed) => { horizon.push(feed) }`를 더해 반환한다.

```ts
  it('ends the run, not the job, when the cursor cannot be found again', async () => {
    // Page 1000 was the last the cafe served; overnight the anchor drifted
    // past it, and page 1001 answers with page 1. Walking the period again
    // from its top is what this used to do — 650 pages of posts already held.
    const { repo, finished, persisted } = repositoryWithCheckpoint({ anchorPostId: 'anchor', anchorPostedAtMs: 250, referencePage: 1000, stateVersion: 3 })
    const pages: Record<number, ReturnType<typeof page>> = {
      1: page([post('n1', 289), post('n2', 288)], 10),
      1000: page([post('p1', 260), post('p2', 255)], 1000),
    }
    const orchestrator = createCollectionOrchestrator({ ...deps(repo), fetcher: { read: async (n) => pages[n] ?? pages[1]! } })
    const result = await orchestrator.run({ feed, run: { ...run, resumeFromCheckpoint: true }, maxPages: 30 })
    expect(result).toMatchObject({ kind: 'failed', code: 'RESUME_POSITION_LOST' })
    expect(finished).toEqual(['failed:RESUME_POSITION_LOST'])
    expect(persisted).toHaveLength(0)
  })

  it('marks the cafe horizon when the feed runs out on page 1000 with the period unfinished', async () => {
    const { repo, finished, horizon } = repositoryWithCheckpoint({ anchorPostId: 'a', anchorPostedAtMs: 280, referencePage: 999, stateVersion: 1 })
    const pages: Record<number, ReturnType<typeof page>> = {
      999: page([post('a', 280), post('b', 270)], 1000),
      1000: page([post('c', 260), post('d', 250)], 1000),
    }
    const orchestrator = createCollectionOrchestrator({ ...deps(repo), fetcher: { read: async (n) => pages[n] ?? page([post('fresh', 289)], 10) } })
    const result = await orchestrator.run({ feed, run: { ...run, resumeFromCheckpoint: true }, maxPages: 30 })
    expect(result).toMatchObject({ kind: 'partial', reason: 'FEED_HORIZON' })
    expect(finished).toEqual(['partial:FEED_HORIZON'])
    expect(horizon).toEqual([feed])
  })

  it('still finishes when the feed ends before page 1000', async () => {
    const { repo, finished, horizon } = repositoryWithCheckpoint({ anchorPostId: 'a', anchorPostedAtMs: 280, referencePage: 2, stateVersion: 1 })
    const pages: Record<number, ReturnType<typeof page>> = {
      2: page([post('a', 280), post('b', 270)], 3),
      3: page([post('c', 260), post('d', 250)], 3),
    }
    const orchestrator = createCollectionOrchestrator({ ...deps(repo), fetcher: { read: async (n) => pages[n] ?? page([post('fresh', 289)], 10) } })
    const result = await orchestrator.run({ feed, run: { ...run, resumeFromCheckpoint: true }, maxPages: 30 })
    expect(result).toMatchObject({ kind: 'succeeded' })
    expect(finished).toEqual(['succeeded:'])
    expect(horizon).toEqual([])
  })

  it('reports how many requests it made so a block can share its budget', async () => {
    const { repo } = repository()
    const pages = { 1: page([post('1', 289), post('2', 280)], 2), 2: page([post('3', 199)], 2) }
    const orchestrator = createCollectionOrchestrator({ ...deps(repo), fetcher: fetcher(pages) })
    const result = await orchestrator.run({ feed, run, maxPages: 30 })
    expect(result.requests).toBe(2)
  })

  it('sends the feed\'s menu with every page request', async () => {
    const sent: string[] = []
    const transport = { request: async (message: { menuId: string }) => { sent.push(message.menuId); return { type: 'ERROR', code: 'BOARD_PAGE_HTTP_ERROR' } } } as never
    await expect(createBoardPageFetcher(transport, () => 'r', '137').read(1)).rejects.toMatchObject({ code: 'BOARD_PAGE_HTTP_ERROR' })
    expect(sent).toEqual(['137'])
  })
```

`deps(repo)`는 파일에 이미 쓰이는 공통 의존성 헬퍼다. 없다면 이렇게 둔다:

```ts
function deps(repo: CollectionRepository) {
  return { repository: repo, clock: { now: () => 1_000 }, random: { intInclusive: () => 0 }, sleep: async () => undefined, isSessionBusy: () => false, isAbortRequested: () => false }
}
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/collectionOrchestrator.test.ts`
Expected: FAIL — 첫 테스트는 `succeeded`(기간 처음부터 다시 걸음), 둘째는 `succeeded`, `requests`는 undefined, fetcher는 인자 셋을 안 받음.

- [ ] **Step 3: 구현한다**

fetcher:

```ts
export function createBoardPageFetcher(transport: ExtensionTransport, newRequestId: () => string, menuId: string): BoardPageFetcher {
  return { async read(page) {
    const message: Extract<AppMessage, { type: 'COLLECT_BOARD_PAGE' }> = { type: 'COLLECT_BOARD_PAGE', requestId: newRequestId(), cafeId: CAFE_ARTICLE_LIST.cafeId, menuId, page, pageSize: CAFE_ARTICLE_LIST.pageSize, sortBy: CAFE_ARTICLE_LIST.sortBy, viewType: CAFE_ARTICLE_LIST.viewType }
    ...
```

결과 타입:

```ts
export type CollectionRunResult =
  | { readonly kind: 'succeeded'; readonly pagesStored: number; readonly requests: number }
  | { readonly kind: 'partial'; readonly pagesStored: number; readonly requests: number; readonly reason: 'PAGE_BUDGET_SPENT' | 'FEED_HORIZON' }
  | { readonly kind: 'interrupted'; readonly pagesStored: number; readonly requests: number; readonly reason: 'ABORTED' }
  | { readonly kind: 'cas_conflict'; readonly pagesStored: number; readonly requests: number; readonly latestState: CollectionFeedState | null }
  | { readonly kind: 'failed'; readonly pagesStored: number; readonly requests: number; readonly code: string }

/**
 * The last page the cafe serves of any list. Asking beyond it answers with
 * page 1. Measured 2026-09-05 on the whole-cafe list and three boards.
 */
export const FEED_HORIZON_PAGE = 1000
```

`run` 안에서 `reader`를 `try` 밖에서 보이도록 `let reader: ScheduledReader | null = null`로 선언하고, 모든 `return { kind: ... }`에 `requests: reader?.reads ?? 0`를 넣는다. `catch`의 세 return도 같다.

재개:

```ts
      if (resumed?.kind === 'complete') { ... }
      // The cursor is real and the feed no longer serves the page it points
      // at. Finding the period afresh from its top would re-read everything
      // this job already holds; ending here leaves the reason on the run.
      if (resumed?.kind === 'unusable') throw new CollectionPageError('RESUME_POSITION_LOST')
      if (resumed?.kind === 'found') { ... } else { ...findCollectionStartPage... }
```

fallback 분기:

```ts
        if (fallback(page, pageNumber)) {
          if (continuity === null) throw new CollectionPageError('BOARD_PAGE_SILENT_FALLBACK')
          // Under way, a page the feed does not have is the end of the feed.
          // Which end matters: below the cafe's last servable page there may
          // be more, and calling that the period's end would mark a job done
          // that is not.
          if (continuity.page >= FEED_HORIZON_PAGE) {
            await deps.repository.markHorizonReached(options.feed, new Date(deps.clock.now()))
            await deps.repository.finishRun(options.run.id, 'partial', 'FEED_HORIZON', new Date(deps.clock.now()))
            return { kind: 'partial', pagesStored, requests: reader.reads, reason: 'FEED_HORIZON' }
          }
          await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
          return { kind: 'succeeded', pagesStored, requests: reader.reads }
        }
```

`continuity.page`는 직전에 처리한 쪽 번호다(저장 여부와 무관하게 마지막으로 읽은 쪽). `verifyContinuity`의 `ANCHOR_RELOCATION_FAILED` 경로도 `locateResumePosition`의 `unusable`을 그대로 받으므로 그대로 둔다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm typecheck && pnpm vitest run tests/desktop/collectionOrchestrator.test.ts tests/desktop/collectionResume.test.ts`
Expected: PASS. 기존 "finishes when the period reaches back to the end of the feed" 테스트는 2쪽에서 끝나므로 그대로 통과한다.

- [ ] **Step 5: 커밋**

```bash
git add src/desktop/collectionOrchestrator.ts tests/desktop/collectionOrchestrator.test.ts
git commit -m "fix: keep a lost cursor and the cafe horizon out of completion"
```

---

### Task 4: 러너가 피드 목록을 한 블록 예산 안에서 이어 걷는다

**Files:**
- Modify: `src/desktop/collectionRunner.ts`
- Create: `tests/desktop/collectionRunner.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CollectionStartRequest {
    readonly range: CollectionRange
    readonly kind: CollectionRunKind
    readonly maxPages: number
    /** In walking order. A whole-cafe job is one; a board job is what remains of its queue. */
    readonly feeds: readonly CollectionFeed[]
    readonly resumeFromCheckpoint?: boolean
  }
  ```
  `ALL_ARTICLES_FEED` 상수는 남긴다(전체글 범위가 쓴다).
- Consumes: Task 3의 `createBoardPageFetcher(transport, newId, menuId)`와 `CollectionRunResult.requests`.

- [ ] **Step 1: 실패하는 테스트**

`tests/desktop/collectionRunner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createCollectionRunner } from '../../src/desktop/collectionRunner.js'
import type { CollectionRepository } from '../../src/desktop/collection-db/repository.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'

function post(id: string, postedAt: number): CollectedPostMetadata {
  return { cafeId: '14538121', postId: id, boardId: '1', boardName: '게시판', title: null, prefix: null, authorId: null, authorNickname: null, postedAt, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false }
}
function page(items: CollectedPostMetadata[], last = 2): CollectedArticlePage {
  return { items, pageInfo: { lastNavigationPageNumber: last, visibleNextButton: true, totalArticleCount: 9 }, pageIdentity: `p:${items.map((i) => i.postId).join(',')}` }
}

/** A cafe of tiny boards: each has one page inside the period and then ends. */
function transport(pagesByMenu: Record<string, Record<number, CollectedArticlePage>>, failing: string[] = []) {
  const asked: string[] = []
  return {
    asked,
    transport: {
      isConnected: () => true,
      request: async (message: { menuId: string; page: number; requestId: string }) => {
        asked.push(`${message.menuId}:${message.page}`)
        if (failing.includes(message.menuId)) return { type: 'ERROR', requestId: message.requestId, code: 'BOARD_PAGE_HTTP_ERROR', message: '' }
        const found = pagesByMenu[message.menuId]?.[message.page]
        return { type: 'BOARD_PAGE_COLLECTED', requestId: message.requestId, page: message.page, result: found ?? page([post(`fresh-${message.menuId}`, 999)], 1) }
      },
    } as never,
  }
}

function repository() {
  const finished: string[] = []
  const repo: CollectionRepository = {
    readFeedState: async () => null,
    listFeedStates: async () => [],
    replaceJob: async () => [],
    startRun: async (input) => ({ stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null, cursorUpdatedAtMs: 0, complete: false, forced: false, horizonReached: false, targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs }),
    recordPageRequest: async () => undefined,
    finishRun: async (id, status, reason) => { finished.push(`${status}:${reason ?? ''}`) },
    markHorizonReached: async () => undefined,
    setForced: async () => undefined,
    reconcileOrphanedRuns: async () => 0,
    persistPage: async (input) => ({ kind: 'stored', insertedPostCount: input.page.items.length, updatedPostCount: 0, nextStateVersion: 1, anchorPostId: input.page.items.at(-1)!.postId }),
  }
  return { repo, finished }
}

function runner(repo: CollectionRepository, t: ReturnType<typeof transport>['transport'], onFinished?: (r: unknown) => void) {
  return createCollectionRunner({
    repository: () => repo, transport: t, clock: { now: () => 1_000 }, random: { intInclusive: () => 0 },
    sleep: async () => undefined, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => 'id',
    onFinished: onFinished as never,
  })
}

const inPeriod = (id: string) => page([post(id, 150)], 1)
const feeds = [{ feedKind: 'board' as const, menuId: '137' }, { feedKind: 'board' as const, menuId: '189' }, { feedKind: 'board' as const, menuId: '205' }]

describe('collection runner over a queue of feeds', () => {
  it('walks the feeds in order within one budget', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '189': { 1: inPeriod('b') }, '205': { 1: inPeriod('c') } })
    const { repo, finished } = repository()
    const done = new Promise<void>((resolve) => { r = runner(repo, t.transport, () => resolve()) })
    let r!: ReturnType<typeof runner>
    expect(r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 30, feeds, resumeFromCheckpoint: true })).toEqual({ kind: 'started' })
    await done
    // Each board: page 1 (in period), page 2 (falls back → end). Three boards.
    expect(t.asked).toEqual(['137:1', '137:2', '189:1', '189:2', '205:1', '205:2'])
    expect(finished).toEqual(['succeeded:', 'succeeded:', 'succeeded:'])
  })

  it('stops when the budget is spent and leaves the rest for the next block', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '189': { 1: inPeriod('b') }, '205': { 1: inPeriod('c') } })
    const { repo, finished } = repository()
    let r!: ReturnType<typeof runner>
    const done = new Promise<void>((resolve) => { r = runner(repo, t.transport, () => resolve()) })
    r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 3, feeds, resumeFromCheckpoint: true })
    await done
    expect(t.asked).toEqual(['137:1', '137:2', '189:1'])
    expect(finished).toEqual(['succeeded:', 'partial:PAGE_BUDGET_SPENT'])
  })

  it('goes on to the next feed when one fails', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '205': { 1: inPeriod('c') } }, ['189'])
    const { repo, finished } = repository()
    let r!: ReturnType<typeof runner>
    const done = new Promise<void>((resolve) => { r = runner(repo, t.transport, () => resolve()) })
    r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 30, feeds, resumeFromCheckpoint: true })
    await done
    expect(finished).toEqual(['succeeded:', 'failed:BOARD_PAGE_HTTP_ERROR', 'succeeded:'])
  })

  it('does not go on after a stop', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '189': { 1: inPeriod('b') } })
    const { repo, finished } = repository()
    let r!: ReturnType<typeof runner>
    const done = new Promise<void>((resolve) => { r = runner(repo, t.transport, () => resolve()) })
    const original = t.transport.request
    ;(t.transport as { request: unknown }).request = async (message: never) => { r.stop(); return original(message) }
    r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 30, feeds: feeds.slice(0, 2), resumeFromCheckpoint: true })
    await done
    expect(finished).toEqual(['interrupted:ABORTED'])
    expect(t.asked.filter((a) => a.startsWith('189'))).toEqual([])
  })
})
```

`onFinished`는 지금 실행 하나마다 불린다. 이 테스트는 **블록이 끝날 때 한 번** 불리는 것으로 바꾼다(아래 구현). 첫 테스트의 `let r` 선언 순서를 두 번째 테스트처럼 `done` 앞에 둔다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/collectionRunner.test.ts`
Expected: 타입 오류(`feeds` 없음) 또는 FAIL.

- [ ] **Step 3: 구현한다**

`src/desktop/collectionRunner.ts`의 `start`:

```ts
export interface CollectionStartRequest {
  readonly range: CollectionRange
  readonly kind: CollectionRunKind
  /** Pages this block may ask for, shared across every feed it walks. */
  readonly maxPages: number
  /** In walking order. A whole-cafe job is one; a board job is what remains of its queue. */
  readonly feeds: readonly CollectionFeed[]
  /** Whether to resume from each feed's checkpoint (for continuing jobs). */
  readonly resumeFromCheckpoint?: boolean
}

export interface CollectionRunnerDeps {
  ...
  /** Called once per block, with every feed's result in walking order. */
  readonly onFinished?: (results: readonly CollectionRunResult[]) => void
  ...
}
```

```ts
      abortRequested = false
      const orchestrator = createCollectionOrchestrator({ ...deps 공통, fetcher는 피드마다 아래에서 })

      inFlight = walk(request, repository)
        .then((results) => { deps.onFinished?.(results) })
        .catch((error: unknown) => { deps.onError?.(error) })
        .finally(() => { inFlight = null; deps.lock.release() })
      return { kind: 'started' }
```

```ts
  /**
   * One block over a queue of feeds. Small boards would otherwise each cost a
   * whole block — twenty of this cafe's boards hold under a hundred posts —
   * so a feed that ends hands its unused budget to the next. A failure moves
   * on too: one board's bad page is no reason to hold the other thirty-seven.
   * A stop does not; it is the operator asking for quiet.
   */
  async function walk(request: CollectionStartRequest, repository: CollectionRepository): Promise<readonly CollectionRunResult[]> {
    const results: CollectionRunResult[] = []
    let spent = 0
    for (const feed of request.feeds) {
      if (abortRequested || spent >= request.maxPages) break
      const orchestrator = createCollectionOrchestrator({
        repository,
        fetcher: createBoardPageFetcher(deps.transport, deps.newId, feed.menuId),
        clock: deps.clock,
        random: deps.random,
        sleep: deps.sleep,
        isSessionBusy: deps.isSessionBusy,
        isAbortRequested: () => abortRequested,
      })
      const result = await orchestrator.run({
        feed,
        run: {
          ...feed,
          id: deps.newId(),
          runKind: request.kind === 'backfill' ? 'backfill' : 'incremental',
          resumeFromCheckpoint: request.resumeFromCheckpoint ?? false,
          targetStartMs: request.range.startMs,
          targetEndMs: request.range.endMs,
          startedAt: new Date(deps.clock.now()),
        },
        maxPages: request.maxPages - spent,
      })
      results.push(result)
      spent += result.requests
      if (result.kind === 'interrupted') break
    }
    return results
  }
```

`walk`는 `createCollectionRunner` 안의 클로저다. `bootstrap.ts`의 `onError`는 그대로 맞는다. `onFinished`를 쓰는 곳이 있으면 배열을 받도록 고친다(`grep -rn onFinished src`).

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm typecheck && pnpm vitest run tests/desktop/collectionRunner.test.ts`
Expected: PASS. `collectionJob.ts`와 `rendererApi.ts`가 `feeds`를 안 넘겨 타입 오류가 나면 잠시 `feeds: [deps.feed]` / `feeds: [ALL_ARTICLES_FEED]`로 두고 Task 5에서 바로잡는다.

- [ ] **Step 5: 커밋**

```bash
git add src/desktop/collectionRunner.ts tests/desktop/collectionRunner.test.ts src/desktop/collectionJob.ts src/desktop/rendererApi.ts src/desktop/bootstrap.ts
git commit -m "feat: walk a queue of feeds within one block's page budget"
```

---

### Task 5: 작업·예약·IPC가 범위를 안다

**Files:**
- Modify: `src/desktop/collectionJob.ts:25-47`
- Modify: `src/desktop/ipc.ts:172-180` (`CollectionRunRequest`)
- Modify: `src/desktop/rendererApi.ts:53-56`, `:232-305`, `:313-317`
- Modify: `src/desktop/bootstrap.ts:399-404`
- Test: `tests/desktop/collectionJob.test.ts`, `tests/desktop/rendererApi.test.ts`

**Interfaces:**
- `CollectionRunRequest`에 `readonly scope?: CollectionFeedKind` (없으면 `'board'`).
- `createArticleCollectionJob({ repository, runner })` — `feed` 인자가 사라진다.
- `CollectionStatusQuery.read()` — 인자가 사라진다(Task 6에서 구현; 여기서는 호출부만 바꾸고 Task 6 전까지는 `read(ALL_ARTICLES_FEED)`가 남아 있어도 된다. 순서상 Task 6을 먼저 해도 된다).

- [ ] **Step 1: 실패하는 테스트**

`tests/desktop/collectionJob.test.ts`에 추가:

```ts
function fakeCollectionRepo(rows: StoredFeedState[]): CollectionRepository {
  return { listFeedStates: async () => rows } as unknown as CollectionRepository
}
function fakeRunner(): { runner: CollectionRunner; starts: CollectionStartRequest[] } {
  const starts: CollectionStartRequest[] = []
  return { starts, runner: { start(req) { starts.push(req); return { kind: 'started' } }, stop() {}, isRunning() { return false } } }
}
function board(menuId: string, queueOrder: number, over: Partial<StoredFeedState> = {}): StoredFeedState {
  return { feed: { feedKind: 'board', menuId }, queueOrder, boardName: `board ${menuId}`, stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null, cursorUpdatedAtMs: 0, targetStartMs: 100, targetEndMs: 200, complete: false, forced: false, horizonReached: false, ...over }
}

describe('createArticleCollectionJob over a board job', () => {
  it('reports the job from its rows and starts what remains, in order', async () => {
    const { runner, starts } = fakeRunner()
    const job = createArticleCollectionJob({ repository: () => fakeCollectionRepo([board('205', 3), board('137', 1, { complete: true }), board('189', 2)]), runner })
    expect(await job.readProgress()).toEqual({ exists: true, complete: false, forced: false })
    job.start(50)
    expect(starts[0]).toMatchObject({ range: { startMs: 100, endMs: 200 }, maxPages: 50, resumeFromCheckpoint: true, feeds: [{ feedKind: 'board', menuId: '189' }, { feedKind: 'board', menuId: '205' }] })
  })

  it('has nothing to start when no row exists', async () => {
    const { runner, starts } = fakeRunner()
    const job = createArticleCollectionJob({ repository: () => fakeCollectionRepo([]), runner })
    expect(await job.readProgress()).toEqual({ exists: false, complete: false, forced: false })
    expect(job.start(50)).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    expect(starts).toHaveLength(0)
  })
})
```

import에 `StoredFeedState`, `CollectionStartRequest`를 더한다.

`tests/desktop/rendererApi.test.ts`의 수집 관련 테스트에서 가짜 저장소/상태 조회가 `read(feed)`를 받던 것을 `read()`로, `setForced(feed, at)`를 `setForced(at)`로 바꾸고, 테스트 하나를 더한다(그 파일의 기존 헬퍼 이름을 따른다):

```ts
  it('makes a board job by default and passes its queue to the runner', async () => {
    // 기존 헬퍼로 api를 만들되, repository.replaceJob이 [board 137, board 189]를 돌려주고
    // status.read()가 job === null(아직 작업 없음)을 돌려주도록 둔다.
    const result = await api.startCollection({ firstDayMs: DAY_1, lastDayMs: DAY_2 })
    expect(result).toEqual({ kind: 'started' })
    expect(replaced).toEqual([{ scope: 'board', targetStartMs: DAY_1, targetEndMs: DAY_2 + 86_400_000 }])
    expect(runnerStarts[0]?.feeds.map((f) => f.menuId)).toEqual(['137', '189'])
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/collectionJob.test.ts tests/desktop/rendererApi.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현한다**

`src/desktop/collectionJob.ts`:

```ts
import { describeJob, type JobDescription } from './collectionScope.js'

export function createArticleCollectionJob(deps: {
  repository: () => CollectionRepository | null
  runner: CollectionRunner
}): CollectionJob {
  let last: JobDescription | null = null
  return {
    name: 'articles',
    async readProgress() {
      const repository = deps.repository()
      last = repository === null ? null : describeJob(await repository.listFeedStates())
      return { exists: last !== null, complete: last?.complete ?? false, forced: last?.forced ?? false }
    },
    start(maxPages) {
      if (last === null) return { kind: 'refused', reason: 'NO_JOB' }
      return deps.runner.start({
        range: { startMs: last.targetStartMs, endMs: last.targetEndMs },
        kind: 'incremental',
        maxPages,
        feeds: last.remaining.map((row) => row.feed),
        resumeFromCheckpoint: true,
      })
    },
  }
}
```

`bootstrap.ts`에서 `feed: ALL_ARTICLES_FEED` 인자를 지운다.

`src/desktop/ipc.ts`:

```ts
export interface CollectionRunRequest {
  readonly firstDayMs: number
  readonly lastDayMs: number
  /**
   * Which lists to read the period from. The whole-cafe list reaches back
   * only so far — a thousand pages, about four months at this cafe's rate —
   * and past that every board's own list has to be walked. Board by board is
   * the default because it always reaches; the whole list is the cheap
   * choice for a period it can reach.
   */
  readonly scope?: CollectionFeedKind
  readonly replace?: boolean
}
```

`CollectionFeedKind`를 `./collection-db/repository.js`에서 import한다.

`src/desktop/rendererApi.ts` — `ALL_ARTICLES_FEED` 상수를 지우고 `startCollection`을 다음으로 바꾼다:

```ts
    async startCollection(request?: CollectionRunRequest): Promise<StartCollectionResult> {
      const collection = deps.collection()
      const stored = collection.kind === 'ready' ? await collection.status.read() : null
      const inProgress = stored?.job ?? null

      const startFor = (range: CollectionRange, feeds: readonly CollectionFeed[], resumeFromCheckpoint: boolean): StartCollectionResult => {
        const schedule = readCollectionSchedule(settings)
        const started = deps.collectionRunner.start({
          range, kind: 'backfill', maxPages: pagesPerWorkBlock(schedule.workBlockMinutes), feeds, resumeFromCheckpoint,
        })
        return started.kind === 'started' ? { kind: 'started' } : { kind: 'refused', reason: started.reason }
      }

      if (request === undefined) {
        if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
        if (inProgress === null) return { kind: 'refused', reason: 'NO_JOB' }
        if (inProgress.complete) return { kind: 'refused', reason: 'JOB_FINISHED' }
        const rows = describeJob(await collection.repository.listFeedStates())
        if (rows === null) return { kind: 'refused', reason: 'NO_JOB' }
        return startFor({ startMs: rows.targetStartMs, endMs: rows.targetEndMs }, rows.remaining.map((row) => row.feed), true)
      }

      if (collection.kind !== 'ready') return { kind: 'refused', reason: 'NO_STORAGE' }
      const range = collectionRangeOfDays(request.firstDayMs, request.lastDayMs)
      const problem = checkCollectionRange(range, deps.clock.now())
      if (problem !== null) return { kind: 'rejected', problem }
      const scope = request.scope ?? 'board'

      const sameJob =
        inProgress !== null && inProgress.scope === scope &&
        inProgress.targetStartMs === range.startMs && inProgress.targetEndMs === range.endMs

      if (inProgress !== null && !sameJob && !inProgress.complete && request.replace !== true) {
        return { kind: 'needs_replace', job: inProgress }
      }
      if (inProgress !== null && !sameJob && deps.collectionRunner.isRunning()) {
        return { kind: 'refused', reason: 'STOP_RUNNING_FIRST' }
      }

      // The same unfinished job carries on from its cursors. Anything else —
      // a new period, a new scope, or the same one asked for again after it
      // finished — is made afresh, without touching the posts already held.
      if (sameJob && !inProgress.complete) {
        const rows = describeJob(await collection.repository.listFeedStates())
        if (rows === null) return { kind: 'refused', reason: 'NO_JOB' }
        return startFor(range, rows.remaining.map((row) => row.feed), true)
      }
      const made = describeJob(await collection.repository.replaceJob({ scope, targetStartMs: range.startMs, targetEndMs: range.endMs, at: new Date(deps.clock.now()) }))
      if (made === null) return { kind: 'refused', reason: 'NO_JOB' }
      return startFor(range, made.feeds.map((row) => row.feed), false)
    },
```

`CollectionJob`(statusQuery의 화면용 타입)에 `scope`가 있어야 `inProgress.scope`가 컴파일된다 — Task 6에서 더한다. Task 6을 먼저 하면 여기서 바로 통과한다.

`setCollectionForced`: `collection.status.read()`; `collection.repository.setForced(forced ? new Date(...) : null)`.
`getCollectionStatus`: `collection.status.read()`.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm typecheck && pnpm vitest run tests/desktop/collectionJob.test.ts tests/desktop/rendererApi.test.ts tests/desktop/collectionLoop.test.ts tests/desktop/bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/desktop/collectionJob.ts src/desktop/ipc.ts src/desktop/rendererApi.ts src/desktop/bootstrap.ts tests/desktop/collectionJob.test.ts tests/desktop/rendererApi.test.ts
git commit -m "feat: start and continue a job by its scope"
```

---

### Task 6: 상태 조회가 게시판별 진행을 답한다

**Files:**
- Modify: `src/desktop/collection-db/statusQuery.ts`
- Test: `tests/desktop/collection-db/integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BoardProgressState = 'waiting' | 'walking' | 'complete' | 'horizon' | 'failed'
  export interface BoardProgress {
    readonly queueOrder: number
    readonly boardId: string
    readonly name: string
    readonly state: BoardProgressState
    readonly cursorPostedAtMs: number | null
    /** Posts this job inserted from this board, summed over its runs. */
    readonly insertedPostCount: number
  }
  export interface CollectionJob {
    readonly scope: CollectionFeedKind
    readonly targetStartMs: number
    readonly targetEndMs: number
    /** For a board job: the oldest cursor among boards still walking. */
    readonly cursorPostedAtMs: number | null
    readonly cursorUpdatedAtMs: number
    readonly complete: boolean
    readonly forced: boolean
    /** Empty for a whole-cafe job. */
    readonly boards: readonly BoardProgress[]
  }
  export interface CollectionRunSummary { ...기존..., readonly boardName: string | null }
  export interface CollectionStatusQuery { read(): Promise<CollectionStatus> }
  ```

- [ ] **Step 1: 실패하는 통합 테스트**

`integration.test.ts`에 추가(Task 2의 테스트 뒤, 같은 DB 상태를 이어 쓴다):

```ts
  it('describes a board job board by board', async () => {
    const repository = createCollectionRepository(connection.db)
    const status = createCollectionStatusQuery(connection.db)
    const made = await repository.replaceJob({ scope: 'board', targetStartMs: 1_000, targetEndMs: 2_000_000_000_000, at: new Date(5_000) })
    const first = made[0]!
    const state = await repository.startRun({ ...first.feed, id: randomUUID(), runKind: 'development', resumeFromCheckpoint: true, targetStartMs: first.targetStartMs, targetEndMs: first.targetEndMs, startedAt: new Date(6_000) })
    const own = { ...page, items: page.items.filter((item) => item.boardId === first.feed.menuId) }
    await repository.persistPage({ feed: first.feed, runId: /* the id above */ , observedAt: new Date(7_000), referencePage: 1, expectedState: state, page: own })

    const read = await status.read()
    expect(read.job).toMatchObject({ scope: 'board', complete: false })
    expect(read.job?.boards[0]).toMatchObject({ queueOrder: 1, boardId: first.feed.menuId, name: first.boardName, state: 'walking', insertedPostCount: 0 })
    expect(read.job?.boards[1]).toMatchObject({ queueOrder: 2, state: 'waiting', cursorPostedAtMs: null })
    expect(read.running?.boardName).toBe(first.boardName)
  })
```

`runId`는 `startRun`에 넘긴 id를 변수로 잡아 쓴다. `insertedPostCount`는 이 글들이 앞 테스트에서 이미 저장됐으므로 0이다.

- [ ] **Step 2: 실패를 확인한다**

Run: 통합 테스트 명령. Expected: FAIL (`read()`가 인자를 요구, `boards` 없음).

- [ ] **Step 3: 구현한다**

`statusQuery.ts`의 `read()`:

- `feedState` 조회를 `listFeedStates`와 같은 조인(`boards` left join)으로 바꾸고 모든 행을 읽는다. `describeJob`으로 작업을 만든다.
- 실행 목록은 피드 조건 없이 최근 24건, `boards.name`을 `menu_id`로 left join하여 `boardName`으로 낸다(`feed_kind = 'board'`일 때만 조인).
- 게시판별 삽입 건수: `select menu_id, sum(inserted_post_count) from runs where feed_kind = 'board' and target_start_ms = ? and target_end_ms = ? group by menu_id`.
- 게시판 상태: `horizonReached` → `'horizon'`; `complete` → `'complete'`; 이 피드의 running 실행이 있으면 `'walking'`; 가장 최근 실행이 `failed`면 `'failed'`; 앵커가 있으면 `'walking'`; 아니면 `'waiting'`.
- 작업의 `cursorPostedAtMs`: 전체글이면 그 행의 앵커 시각. 게시판별이면 `remaining` 중 앵커가 있는 것들의 **가장 오래된** 앵커 시각(없으면 null). `cursorUpdatedAtMs`는 행들 중 최대.

```ts
function boardState(row: StoredFeedState, running: boolean, lastFailed: boolean): BoardProgressState {
  if (row.horizonReached) return 'horizon'
  if (row.complete) return 'complete'
  if (running) return 'walking'
  if (lastFailed) return 'failed'
  return row.anchorPostId === null ? 'waiting' : 'walking'
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm typecheck && pnpm test` 그리고 통합 테스트.
Expected: PASS. 이제 Task 5의 `inProgress.scope`도 컴파일된다.

- [ ] **Step 5: 커밋**

```bash
git add src/desktop/collection-db/statusQuery.ts tests/desktop/collection-db/integration.test.ts
git commit -m "feat: answer the collection screen board by board"
```

---

### Task 7: 화면이 범위를 고르고 게시판별 진행을 보여 준다

**Files:**
- Modify: `src/shared/text.ts:73-150` (`collection`), `:194-235` (`dashboard.job`, `period`)
- Modify: `src/renderer/views/CollectionStatus.tsx:250-300`, `:455-505`
- Create: `src/renderer/views/collection/BoardQueue.tsx`
- Modify: `src/renderer/views/dashboard/CollectionJob.tsx:75-90`
- Test: 렌더러 테스트가 없다면 `pnpm typecheck`와 `pnpm build:renderer`, 그리고 개발 실행(`pnpm build:all && pnpm start`)에서 눈으로 확인한다.

- [ ] **Step 1: 문구**

`TEXT.collection`에 추가:

```ts
    /** Which lists a period is read from. */
    scope: {
      heading: '읽는 목록',
      board: '게시판별',
      boardHint: '게시판마다 자기 목록을 걷습니다. 전체글 목록이 닿지 않는 오래된 기간도 닿습니다.',
      allArticles: '전체글',
      allArticlesHint: '전체글 목록 하나를 걷습니다. 최근 넉 달 안이면 이쪽이 훨씬 적게 읽습니다.',
    },
    boards: {
      heading: '게시판별 진행',
      summary: (done: number, total: number) => `${done} / ${total} 게시판 완료`,
      walking: (name: string) => `지금 ${name}`,
      order: '순서',
      name: '게시판',
      state: '상태',
      cursor: '내려온 위치',
      inserted: '이 작업에서 옮김',
      states: {
        waiting: '대기',
        walking: '진행',
        complete: '완료',
        horizon: '카페 한계',
        failed: '실패',
      },
      horizonHint: '카페가 이 게시판의 목록을 여기까지만 줍니다. 그 아래는 이 방법으로 닿지 않습니다.',
    },
```

`TEXT.collection.runStatus` 옆의 실행 사유 표시가 `stopReason`을 그대로 보이므로 `FEED_HORIZON`/`RESUME_POSITION_LOST`에 별도 문구는 두지 않는다.

- [ ] **Step 2: 범위 라디오**

`CollectionStatus.tsx`의 기간 폼에 `const [scope, setScope] = useState<CollectionFeedKind>('board')`를 두고, 끝 날짜 입력 뒤에:

```tsx
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.collection.scope.heading}
          </legend>
          {(['board', 'all_articles'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="collect-scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
              <span>{value === 'board' ? TEXT.collection.scope.board : TEXT.collection.scope.allArticles}</span>
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {value === 'board' ? TEXT.collection.scope.boardHint : TEXT.collection.scope.allArticlesHint}
              </span>
            </label>
          ))}
        </fieldset>
```

`press({ firstDayMs, lastDayMs, scope })`로 넘긴다. 교체 확인(`replacing`)도 `scope`를 그대로 들고 간다.

- [ ] **Step 3: 게시판별 표**

`src/renderer/views/collection/BoardQueue.tsx`:

```tsx
import { TEXT } from '../../../shared/text.js'
import type { BoardProgress } from '../../../desktop/collection-db/statusQuery.js'
import { formatKstDateTime } from '../../format.js'

/**
 * The queue as a table, one row per board in walking order. The row being
 * walked is the one thing an operator looks for, so it is the only row with
 * an accent; the rest read as a list of what is done and what is left.
 */
export function BoardQueue({ boards }: { boards: readonly BoardProgress[] }): React.JSX.Element {
  const done = boards.filter((board) => board.state === 'complete' || board.state === 'horizon').length
  const walking = boards.find((board) => board.state === 'walking') ?? null
  return (
    <section className="panel px-5 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">{TEXT.collection.boards.heading}</h2>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collection.boards.summary(done, boards.length)}
          {walking !== null && ` · ${TEXT.collection.boards.walking(walking.name)}`}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead style={{ color: 'var(--ink-muted)' }}>
            <tr>
              <th className="text-left font-medium">{TEXT.collection.boards.order}</th>
              <th className="text-left font-medium">{TEXT.collection.boards.name}</th>
              <th className="text-left font-medium">{TEXT.collection.boards.state}</th>
              <th className="text-left font-medium">{TEXT.collection.boards.cursor}</th>
              <th className="text-right font-medium">{TEXT.collection.boards.inserted}</th>
            </tr>
          </thead>
          <tbody>
            {boards.map((board) => (
              <tr key={board.boardId} className={board.state === 'walking' ? 'font-bold' : ''} title={board.state === 'horizon' ? TEXT.collection.boards.horizonHint : undefined}>
                <td>{board.queueOrder}</td>
                <td>{board.name}</td>
                <td>{TEXT.collection.boards.states[board.state]}</td>
                <td>{board.cursorPostedAtMs === null ? '—' : formatKstDateTime(board.cursorPostedAtMs)}</td>
                <td className="text-right">{board.insertedPostCount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
```

`CollectionStatus.tsx`에서 작업 카드 아래에 `{job !== null && job.boards.length > 0 && <BoardQueue boards={job.boards} />}`.

- [ ] **Step 4: 대시보드 카드**

`CollectionJob.tsx`의 "walked" 줄 아래에, 게시판별 작업이면 요약 한 줄:

```tsx
                {job.boards.length > 0 && (
                  <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {TEXT.collection.boards.summary(
                      job.boards.filter((b) => b.state === 'complete' || b.state === 'horizon').length,
                      job.boards.length,
                    )}
                    {(() => { const walking = job.boards.find((b) => b.state === 'walking'); return walking === undefined ? '' : ` · ${TEXT.collection.boards.walking(walking.name)}` })()}
                  </div>
                )}
```

기간 막대(`periodDays`)는 작업의 `cursorPostedAtMs`(남은 게시판 중 가장 오래된 앵커)로 그대로 그린다.

- [ ] **Step 5: 확인**

Run: `pnpm typecheck && pnpm lint && pnpm build:all`
Expected: 오류 없음. 이어서 `pnpm start`로 개발 앱을 띄워 수집 현황에서 라디오와 표가 보이는지 본다(작업이 없으면 표는 비어 있다).

- [ ] **Step 6: 커밋**

```bash
git add src/shared/text.ts src/renderer/views/CollectionStatus.tsx src/renderer/views/collection/BoardQueue.tsx src/renderer/views/dashboard/CollectionJob.tsx
git commit -m "feat: choose the lists a period is read from and show the board queue"
```

---

### Task 8: 배포와 전환

**Files:**
- Modify: `package.json` (version 1.3.0)
- Modify: `docs/superpowers/specs/2026-09-05-per-board-collection-design.md` 상태를 "구현됨"으로

- [ ] **Step 1: 전체 검증**

Run: `pnpm typecheck && pnpm lint && pnpm test && COLLECTION_TEST_DATABASE_URL=… pnpm test:collection:integration`
Expected: 모두 PASS.

- [ ] **Step 2: 버전과 패키징**

`package.json`의 `"version"`을 `1.3.0`으로. `pnpm package:app:mac`. 결과물 `release/mac-arm64/Whisky Manager.app`.

- [ ] **Step 3: 커밋**

```bash
git add package.json docs/superpowers/specs/2026-09-05-per-board-collection-design.md
git commit -m "chore: release 1.3.0 with board-by-board collection"
```

- [ ] **Step 4: 전환 절차(운영자와 함께)**

1. 돌고 있는 앱에서 수집을 **중지**한다(페이지 경계에서 멈춘다). 실행 목록에 `interrupted`가 찍히는지 본다.
2. 앱을 끄고 마이그레이션을 적용한다:
   ```bash
   COLLECTION_MIGRATION_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection pnpm db:collection:migrate
   ```
   그 뒤 새 패키지를 띄운다. 앱은 마이그레이션을 적용하지 않고 적용됐는지만 확인한다. `psql -d whisky_manager_collection -c '\d feed_state'`로 `queue_order`, `horizon_reached_at`을 확인한다.
3. 확장을 다시 불러온다(`PROTOCOL_VERSION` 10). 대시보드에서 확장 연결을 확인한다.
4. 수집 현황에서 기간 `2026-01-01 ~ 2026-05-05`, 읽는 목록 **게시판별**, 「이 기간 수집」. 교체 확인이 뜨면 「기간 바꾸기」.
5. 표에 38개 게시판이 글 수 순으로 나오고 1번(국내구입기)이 `진행`이 되는지 본다. 첫 실행이 05-05 근처 페이지를 이분 탐색으로 찾은 뒤 저장을 시작한다.
6. 예약을 켠다. 다음 블록이 남은 게시판을 이어받는다.

**되돌리기:** 문제가 있으면 1.2.x 패키지를 다시 띄운다. 스키마 변경은 열 추가와 enum 값 추가뿐이라 옛 앱도 그대로 읽는다. 다만 옛 앱도 마이그레이션 해시를 확인하므로, 0004 행을 지워야 한다(해시는 `drizzle-collection/meta/_journal.json` 또는 테이블에서 확인한다):
```sql
delete from drizzle.__drizzle_migrations where hash = '<0004 hash>';
```
그 다음 `board` 행도 지우고 전체글 기간을 다시 지정한다:
```sql
delete from feed_state where feed_kind = 'board';
```
추가된 열과 enum 값은 옛 앱에 무해하다.

---

## Self-review

- **§1 한계·§5 두 결함** → Task 3. **§3 작업 모양·스키마** → Task 2. **§4 이어 걷기** → Task 4. **§3 범위 선택·§6 화면** → Task 5, 7. **§7 프로토콜** → Task 1. **§8 절차** → Task 8. **§9 테스트** → 각 Task의 Step 1.
- `setForced(forcedAt)`는 Task 2에서 정의하고 Task 5에서 그 시그니처로 부른다. `createBoardPageFetcher(transport, newId, menuId)`는 Task 3 정의, Task 4 사용. `describeJob`은 Task 2 정의, Task 5·6 사용. `CollectionStartRequest.feeds`는 Task 4 정의, Task 5 사용. `CollectionJob.scope`/`boards`는 Task 6 정의, Task 5·7 사용 — Task 5보다 Task 6을 먼저 해도 되고, 그렇게 하면 임시 타입 오류가 없다.
- 남겨 둔 것: `FEED_HORIZON` 뒤 그 게시판을 예약이 건너뛰는 규칙은 `describeJob`의 `settled`가 갖는다. 화면 문구는 `horizonHint` 하나다.
