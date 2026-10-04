# Collection Screen as Ordered Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the renderer's 수집 현황 screen as a "다음 할 일" panel followed by four ordered steps (① 목록 수집 → ② 검색어 보충 → ③ 빈 글 번호 확인 → ④ 점검) that a beginner can follow, without changing any main-process behaviour.

**Architecture:** Two pure modules decide what the screen says — `stepFacts.ts`/`stepStates.ts` give each step its badge, `nextStep.ts` picks the one thing to do now — and are unit-tested. Each step is one presentational component sharing a `CollectionStep` frame; `CollectionStatus.tsx` only composes them. All data comes from the views the store already polls.

**Tech Stack:** React 19 + TypeScript, Tailwind 4 utility classes plus the app's own CSS classes (`panel`, `btn`, `field`, `chip`, `tone-*`, `bar-*`, `disclosure`), zustand store, vitest (node environment, `tests/**/*.test.ts` only — `.tsx` components are verified by typecheck and the visual check in Task 10).

**Spec:** `docs/superpowers/specs/2026-10-04-collection-screen-steps-design.md`

## Global Constraints

- `tsconfig.json` has `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: an optional prop that may be passed `undefined` must be typed `?: T | undefined`.
- Renderer only. No change to `src/desktop/**`, `src/extension/**`, `src/shared/protocol.ts`, `drizzle-collection/**`, the dashboard, the log screen, the member screens or the collection settings screen.
- The renderer may import **types only** from `src/desktop/**` (`import type`). `tests/renderer/mainProcessBoundary.test.ts` fails the build otherwise.
- Every operator-facing word lives in `src/shared/text.ts`; text that takes a value is a function. Korean only, no i18n layer.
- Times and days are KST: use `formatKstTime`, `formatKstDate`, `formatKstDateTime` (`src/renderer/format.ts`) and `kstDayKeyRange` (`src/shared/kst.ts`). Never `9 * 60 * 60 * 1000`, `+09:00` or `toLocaleString()` for times.
- Colours only through existing tokens: `var(--ink)`, `var(--ink-muted)`, `var(--accent)`, `var(--ok)`, `var(--warn)`, `var(--alarm)` and the `tone-*` / `bar-*` classes. Both themes come from those tokens.
- Folding defaults apply on first draw only; a two-second poll must never undo an operator's fold or unfold.
- Code and comments in English; comment density like the surrounding files (a short doc comment saying *why* on exported things).
- Commit messages: `<type>: <description>`, no attribution lines.
- Run from the worktree root: `/Volumes/VideoWorks/workspace/whisky-manager/.claude/worktrees/gesapan-collection-ui-cleanup-6495b2`.

## Review Focus

1. **Two boards at the list horizon, the search job is for the first** — the guide must name the second board, not the one already searched. Pinned in Task 4.
2. **Search or probe storage not ready while the list is ready** — the step logic gets `null` views and must answer (② not needed, ③ not needed) instead of throwing. Pinned in Tasks 3 and 4.
3. **Operator clears a date input** — `kstDayKeyRange('')` throws; the run button must be disabled for an empty date instead of crashing the screen on press. Pinned in Task 6 (button `disabled` on empty input) and checked in Task 10.
4. **Operator unfolds a folded step, then the poll redraws** — the step stays unfolded. Checked in Task 10.
5. **"보충 준비" pressed a second time after folding the form again** — the form unfolds and scrolls again, with the board re-selected. Pinned by the request counter in Tasks 7 and 9, checked in Task 10.

---

### Task 0: Dependencies in the worktree

The worktree has no `node_modules` (only the main checkout does), so every `pnpm` command below fails until this runs.

- [ ] **Step 1: Install from the lockfile**

Run: `pnpm install --frozen-lockfile`
Expected: completes without changing `pnpm-lock.yaml` (`git status --short` prints nothing).

- [ ] **Step 2: Confirm the baseline is green**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. If anything fails here, stop and report it — it is not caused by this plan.

No commit.

---

### Task 1: Plain wording and the new step words

**Files:**
- Modify: `src/shared/text.ts` (the `collection`, `boardSearch` and `articleProbe` objects)
- Modify: `src/renderer/views/collection/boardSearchLines.ts`
- Modify: `src/renderer/views/collection/articleProbeLines.ts`
- Test: `tests/renderer/boardSearchLines.test.ts`, `tests/renderer/articleProbeLines.test.ts`

**Interfaces:**
- Produces (text): `TEXT.collection.steps.{list,search,probe,check}` (with `steps.list.period(from, to)`), `blockFailed` in the newcomer's wording for `boardSearch`/`articleProbe`, `TEXT.collection.badges`, `TEXT.collection.details`, `TEXT.collection.newPeriod`, `TEXT.collection.newSearchJob`, `TEXT.collection.otherRunning`, `TEXT.collection.useAnyway`, `TEXT.collection.scope.summary(label)`, `TEXT.collection.next.*`, `TEXT.boardSearch.remaining(count)`, `TEXT.boardSearch.replace.*`, `TEXT.articleProbe.headline(probed, total, stored)`, `TEXT.articleProbe.breakdown(deleted, unreadable, other)`.
- Produces (functions): `boardSearchRemainingLine(coverage: BoardSearchCoverage): string | null`, `articleProbeHeadlineLine(job: ArticleProbeJob): string`, `articleProbeBreakdownLine(job: ArticleProbeJob): string`.
- Nothing is removed in this task: keys the old cards still read are deleted in Tasks 6–8, together with the cards.

- [ ] **Step 1: Update the wording tests first**

In `tests/renderer/boardSearchLines.test.ts`, add `boardSearchRemainingLine` to the import list and change the progress assertion and add a test:

```ts
  it('reads a running block\'s progress as pages of its budget and the query in hand, and nothing before it has one', () => {
    expect(boardSearchProgressLine({ query: '알라키', requestedPages: 12, maxPages: 60 })).toBe(TEXT.boardSearch.progress(12, 60, '알라키'))
    expect(TEXT.boardSearch.progress(12, 60, '알라키')).toBe("이번 차례 12 / 60쪽 · '알라키'")
    expect(boardSearchProgressLine(null)).toBeNull()
  })

  it('says what is still to recover in one plain line, and nothing before there is a baseline', () => {
    expect(boardSearchRemainingLine({ span: 111973, missing: 9660, baselineMissingRatio: 0.0678, estimatedRemaining: 2066 })).toBe('아직 못 거둔 글 약 2,066건')
    expect(boardSearchRemainingLine({ span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null })).toBeNull()
  })
```

(Keep whatever else the existing progress test asserts; only the expected string changes from `이번 블록` to `이번 차례`.)

In `tests/renderer/articleProbeLines.test.ts`, add `articleProbeBreakdownLine, articleProbeHeadlineLine` to the import list, and change these expectations:

```ts
  it('shows a running block\'s ids of its budget', () => {
    expect(articleProbeProgressLine({ requested: 40, maxPages: 60 })).toBe('이번 차례 40 / 60건')
    expect(articleProbeProgressLine(null)).toBeNull()
  })

  it('spells the window as the gap\'s days, ending the day before the search job\'s last day', () => {
    expect(articleProbeWindowLine({ fromDay: '20250101', toDay: '20250829' })).toBe('2025-01-01 ~ 2025-08-28 사이의 빈 글 번호')
    // Across a month end, on the KST calendar.
    expect(articleProbeWindowLine({ fromDay: '20250101', toDay: '20250301' })).toBe('2025-01-01 ~ 2025-02-28 사이의 빈 글 번호')
  })
```

In the failure-line test change the first expectation to `'09-26 17:47 차례가 실행을 남기지 못하고 끝났습니다 · COLLECTION_FAILURE: x'` and the second to `'09-26 17:47 차례가 멈췄습니다 · ARTICLE_PROBE_UNKNOWN_ANSWER: id 700001 500 9999'`. (The board search failure test compares against `TEXT.boardSearch.blockFailed(...)` and passes unchanged; add `expect(TEXT.boardSearch.blockFailed('09-26 03:06', 'x')).toBe('09-26 03:06 차례가 실행을 남기지 못하고 끝났습니다 · x')` to it so the wording is pinned.) In the create test change the ready expectation to `{ kind: 'created', text: '빈 글 번호 9,660개를 목록에 넣었습니다' }`. Add:

```ts
  it('splits the job into the line a glance wants and the breakdown kept below the fold', () => {
    expect(articleProbeHeadlineLine(job(3120))).toBe('확인 3,120 / 9,660 · 저장 684건')
    expect(articleProbeBreakdownLine(job(3120))).toBe('삭제 2,391 · 읽기 불가 45')
    expect(articleProbeBreakdownLine(job(3120, 7, 2))).toBe('삭제 2,391 · 읽기 불가 45 · 기타(다른 게시판·공지) 9')
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/renderer/boardSearchLines.test.ts tests/renderer/articleProbeLines.test.ts`
Expected: FAIL — `boardSearchRemainingLine`/`articleProbeHeadlineLine`/`articleProbeBreakdownLine` are not exported, and the changed strings do not match.

- [ ] **Step 3: Change the wording in `src/shared/text.ts`**

In `TEXT.collection.scope`, add after `allArticlesHint`:

```ts
      /** The fold the choice sits behind, naming the choice in force. */
      summary: (label: string) => `읽는 목록 · ${label}`,
```

At the end of `TEXT.collection` (after the `boards` object, before the closing `},` of `collection`), add:

```ts
    /** The four steps the screen reads top to bottom, in the order a collection actually goes. */
    steps: {
      list: {
        number: '①',
        title: '목록 수집',
        what: '고른 기간의 글을 게시판 목록에서 차례로 읽어 옵니다.',
        /** Both days `YYYY-MM-DD` KST; the last is the period's own last day, not the midnight after it. */
        period: (from: string, to: string) => `대상 기간 ${from} — ${to}`,
      },
      search: {
        number: '②',
        title: '검색어 보충',
        what: '목록으로 닿지 않는 오래된 글을 제목 검색으로 찾아 채웁니다.',
        notNeeded: '목록 끝에 닿은 게시판이 없어 필요 없습니다.',
      },
      probe: {
        number: '③',
        title: '빈 글 번호 확인',
        what: '검색으로도 못 찾은 글을 글 번호로 하나씩 읽어 거둡니다. 읽어도 조회수는 오르지 않습니다.',
        notNeeded: '② 보충이 끝나야 쓸 수 있습니다.',
        spent: '이미 한 번 확인했습니다. 다시 만들 수는 없습니다.',
        folded: (stored: number) => `확인 완료 · 저장 ${stored.toLocaleString('ko-KR')}건`,
      },
      check: { number: '④', title: '점검', what: '모은 글의 범위와, 빠진 페이지가 없는지 보여 줍니다.' },
    },
    badges: { todo: '할 일', running: '진행 중', done: '완료', notNeeded: '필요 없음' },
    details: '자세히',
    newPeriod: '새 기간 수집',
    newSearchJob: '새 보충 작업',
    /** Under a button that waits for another walk: the lock is shared, so only one walks at a time. */
    otherRunning: '다른 수집이 도는 중입니다. 끝나면 누를 수 있습니다.',
    /** The fold over a step that is not needed, for an operator who wants it anyway. */
    useAnyway: '그래도 직접 쓰기',
    /** The panel at the top: the one thing to do now, read off the state the screen already has. */
    next: {
      heading: '다음 할 일',
      running: {
        list: '① 목록 수집이 돌고 있습니다. 기다리면 됩니다.',
        search: '② 검색어 보충이 돌고 있습니다. 기다리면 됩니다.',
        probe: '③ 빈 글 번호 확인이 돌고 있습니다. 기다리면 됩니다.',
      },
      listWaitingAt: (time: string) => `① ${time}에 이어서 돕니다. 기다리거나 지금 이어서 할 수 있습니다.`,
      listWaitingManual: '① 예약이 없어 직접 눌러야 이어서 돕니다.',
      searchResume: '② 이어서 보충할 수 있습니다.',
      probeResume: '③ 이어서 확인할 수 있습니다.',
      searchNeeded: (board: string) => `${board} 게시판은 목록으로 더 내려갈 수 없습니다. ② 검색어 보충으로 채우세요.`,
      probeCreate: '③ 검색으로도 못 찾은 글을 하나씩 확인하세요.',
      probeSpent: '③ 빈 글 번호 확인은 이미 한 번 했습니다. 다시 만들 수는 없습니다.',
      pickPeriod: '① 수집할 기간을 고르세요.',
      allDone: '할 일이 없습니다. ④ 점검에서 빠진 글이 없는지만 보세요.',
      resumeList: '지금 이어서',
      prepareSearch: '보충 준비',
      pickPeriodAction: '기간 고르기',
    },
```

Above `TEXT` (next to `BLOCK_FAILED_LINE`, which the member walks keep), add:

```ts
/** The same line in the newcomer's word for a block, for the collection screen's steps. */
const TURN_FAILED_LINE = (at: string, stopReason: string): string => `${at} 차례가 실행을 남기지 못하고 끝났습니다 · ${stopReason}`
```

and set `blockFailed: TURN_FAILED_LINE,` in both `TEXT.boardSearch` and `TEXT.articleProbe` (replacing `blockFailed: BLOCK_FAILED_LINE,` there only).

In `TEXT.boardSearch`:
- change `progress` to:
  ```ts
    progress: (requested: number, max: number, query: string) =>
      `이번 차례 ${requested.toLocaleString('ko-KR')} / ${max.toLocaleString('ko-KR')}쪽 · '${query}'`,
  ```
- add after `coverage`:
  ```ts
    /** The coverage in the one figure a newcomer acts on; the full sum stays under 자세히. */
    remaining: (count: number) => `아직 못 거둔 글 약 ${count.toLocaleString('ko-KR')}건`,
    /** Replacing an unfinished search job, said as what it costs, on the screen rather than in a browser dialog. */
    replace: {
      heading: '진행 중인 보충 작업이 있습니다',
      progress: (done: number, total: number, inserted: number) =>
        `검색어 ${done} / ${total}까지 걸었고 새 글 ${inserted.toLocaleString('ko-KR')}건을 거뒀습니다`,
      cost: '새로 만들면 이 작업의 진행 위치가 사라지고 처음부터 시작합니다. 이미 거둔 글은 지워지지 않습니다.',
      confirm: '새로 만들기',
      cancel: '그대로 두기',
    },
  ```

In `TEXT.articleProbe`:
- `create: '빈 글 번호 목록 만들기',`
- `window: (firstDay: string, lastDay: string) => \`${firstDay} ~ ${lastDay} 사이의 빈 글 번호\`,`
- add after `summary`:
  ```ts
    /** What a glance wants of the job; the breakdown below it waits under 자세히. */
    headline: (probed: number, total: number, stored: number) =>
      `확인 ${probed.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')} · 저장 ${stored.toLocaleString('ko-KR')}건`,
    /** `other`: live posts not stored — on a board this app does not collect, or notices. */
    breakdown: (deleted: number, unreadable: number, other: number) =>
      `삭제 ${deleted.toLocaleString('ko-KR')} · 읽기 불가 ${unreadable.toLocaleString('ko-KR')}${other === 0 ? '' : ` · 기타(다른 게시판·공지) ${other.toLocaleString('ko-KR')}`}`,
  ```
- `progress: (requested: number, max: number) => \`이번 차례 ${requested.toLocaleString('ko-KR')} / ${max.toLocaleString('ko-KR')}건\`,`
- `created: (count: number) => \`빈 글 번호 ${count.toLocaleString('ko-KR')}개를 목록에 넣었습니다\`,`
- `runFailed: (at: string, stopReason: string) => \`${at} 차례가 멈췄습니다 · ${stopReason}\`,`
- in `refused`: `NO_SEARCH_JOB: '검색어 보충 작업이 없습니다. 빈 글 번호는 그 기간에서 뽑습니다.'`, `JOB_EXISTS: '빈 글 번호 확인 작업이 이미 있습니다. 한 번 답을 얻은 글 번호는 다시 읽지 않습니다.'`, `NO_GAP: '빈 구간에 비어 있는 글 번호가 없습니다.'`
- in `startRefused`: `NO_JOB: '빈 글 번호 목록을 먼저 만드세요.'`, `JOB_FINISHED: '빈 글 번호를 모두 확인했습니다.'`

- [ ] **Step 4: Add the three line functions**

Append to `src/renderer/views/collection/boardSearchLines.ts`:

```ts
/** The figure a newcomer acts on; null until there is a baseline to subtract. */
export function boardSearchRemainingLine(coverage: BoardSearchCoverage): string | null {
  return coverage.estimatedRemaining === null ? null : TEXT.boardSearch.remaining(coverage.estimatedRemaining)
}
```

Append to `src/renderer/views/collection/articleProbeLines.ts`:

```ts
export function articleProbeHeadlineLine(job: ArticleProbeJob): string {
  return TEXT.articleProbe.headline(job.probed, job.total, job.stored)
}

/** Another board's posts and notices fold into one count: neither is stored. */
export function articleProbeBreakdownLine(job: ArticleProbeJob): string {
  return TEXT.articleProbe.breakdown(job.deleted, job.unreadable, job.otherBoard + job.notice)
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm vitest run tests/renderer/boardSearchLines.test.ts tests/renderer/articleProbeLines.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/text.ts src/renderer/views/collection/boardSearchLines.ts src/renderer/views/collection/articleProbeLines.ts tests/renderer/boardSearchLines.test.ts tests/renderer/articleProbeLines.test.ts
git commit -m "feat: word the collection steps for a newcomer"
```

---

### Task 2: One place that names why a start did nothing

**Files:**
- Create: `src/renderer/views/collection/startRefusals.ts`
- Modify: `src/renderer/views/CollectionStatus.tsx` (remove `refusalText`, use `listStartRefusal`)
- Modify: `src/renderer/views/collection/BoardSearchCard.tsx` (remove `startRefusal`, use `searchStartRefusal`)
- Modify: `src/renderer/views/collection/ArticleProbeCard.tsx` (remove `startRefusal`, use `probeStartRefusal`)
- Test: `tests/renderer/startRefusals.test.ts`

**Interfaces:**
- Produces: `listStartRefusal(result: StartCollectionResult): string | null`, `searchStartRefusal(result: StartCollectionResult): string | null`, `probeStartRefusal(result: StartCollectionResult): string | null`. The next-step panel and the step components (Tasks 6–9) both press the same starts, so the wording must come from one module.

- [ ] **Step 1: Write the failing test** — `tests/renderer/startRefusals.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { listStartRefusal, probeStartRefusal, searchStartRefusal } from '../../src/renderer/views/collection/startRefusals.js'
import { TEXT } from '../../src/shared/text.js'

describe('start refusals', () => {
  it('names a list refusal and a rejected period, and nothing for a start', () => {
    expect(listStartRefusal({ kind: 'refused', reason: 'BRIDGE_OFFLINE' })).toBe(TEXT.collection.refused.BRIDGE_OFFLINE)
    expect(listStartRefusal({ kind: 'rejected', problem: 'TOO_LONG' })).toBe(TEXT.collection.rejected.TOO_LONG)
    expect(listStartRefusal({ kind: 'started' })).toBeNull()
  })

  it('names a missing job in the search and probe walks\' own words', () => {
    expect(searchStartRefusal({ kind: 'refused', reason: 'NO_JOB' })).toBe(TEXT.boardSearch.startRefused.NO_JOB)
    expect(probeStartRefusal({ kind: 'refused', reason: 'NO_JOB' })).toBe(TEXT.articleProbe.startRefused.NO_JOB)
    expect(searchStartRefusal({ kind: 'started' })).toBeNull()
    expect(probeStartRefusal({ kind: 'started' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/renderer/startRefusals.test.ts`
Expected: FAIL — cannot resolve `startRefusals.js`.

- [ ] **Step 3: Create `src/renderer/views/collection/startRefusals.ts`**

```ts
import { TEXT } from '../../../shared/text.js'
import type { StartCollectionResult } from '../../../desktop/ipc.js'

/**
 * Why a press to start a walk did nothing, in the words of the thing the
 * operator can fix. Both the next-step panel and the steps press these starts,
 * so they read the answer from here rather than each spelling it.
 */
export function listStartRefusal(result: StartCollectionResult): string | null {
  if (result.kind === 'refused') return TEXT.collection.refused[result.reason]
  if (result.kind === 'rejected') return TEXT.collection.rejected[result.problem]
  return null
}

export function searchStartRefusal(result: StartCollectionResult): string | null {
  return result.kind === 'refused' ? TEXT.boardSearch.startRefused[result.reason] : null
}

export function probeStartRefusal(result: StartCollectionResult): string | null {
  return result.kind === 'refused' ? TEXT.articleProbe.startRefused[result.reason] : null
}
```

- [ ] **Step 4: Use it in the three existing files (zero behaviour change)**

- `CollectionStatus.tsx`: delete the `refusalText` function and its doc comment; add `import { listStartRefusal } from './collection/startRefusals.js'`; in `press` replace `setRefusal(refusalText(result))` with `setRefusal(listStartRefusal(result))`. Remove the now-unused `StartCollectionResult` from the `ipc.js` type import.
- `BoardSearchCard.tsx`: delete the local `startRefusal` function; add `import { searchStartRefusal } from './startRefusals.js'`; replace `startRefusal(await api.startBoardSearch())` with `searchStartRefusal(await api.startBoardSearch())`; drop `StartCollectionResult` from its type import.
- `ArticleProbeCard.tsx`: same with `probeStartRefusal` and `api.startArticleProbe()`.

- [ ] **Step 5: Run tests, typecheck and lint**

Run: `pnpm vitest run tests/renderer && pnpm typecheck && pnpm lint`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/views/collection/startRefusals.ts tests/renderer/startRefusals.test.ts src/renderer/views/CollectionStatus.tsx src/renderer/views/collection/BoardSearchCard.tsx src/renderer/views/collection/ArticleProbeCard.tsx
git commit -m "refactor: name a refused collection start in one place"
```

---

### Task 3: Each step's badge

**Files:**
- Create: `src/renderer/views/collection/stepFacts.ts`
- Create: `src/renderer/views/collection/stepStates.ts`
- Create: `tests/renderer/collectionStepFixtures.ts` (shared builders; not a test file, vitest only runs `*.test.ts`)
- Test: `tests/renderer/stepStates.test.ts`

**Interfaces:**
- Produces from `stepFacts.ts`:
  ```ts
  export type WalkStep = 'list' | 'search' | 'probe'
  export interface CollectionStepInputs {
    readonly status: CollectionStatus
    readonly search: BoardSearchView | null
    readonly probe: ArticleProbeView | null
  }
  export function runningStep(inputs: CollectionStepInputs): WalkStep | null
  export function listUnfinished(status: CollectionStatus): boolean
  export function searchUnfinished(search: BoardSearchView | null): boolean
  export function searchFinished(search: BoardSearchView | null): boolean
  export function probeUnfinished(probe: ArticleProbeView | null): boolean
  export function probeFinished(probe: ArticleProbeView | null): boolean
  export function boardNeedingSearch(inputs: CollectionStepInputs): BoardProgress | null
  export function probeSpent(inputs: CollectionStepInputs): boolean
  ```
- Produces from `stepStates.ts`:
  ```ts
  export type StepBadge = 'todo' | 'running' | 'done' | 'notNeeded'
  export interface StepState { readonly badge: StepBadge; readonly reason: string | null }
  export function listStepState(inputs: CollectionStepInputs): StepState
  export function searchStepState(inputs: CollectionStepInputs): StepState
  export function probeStepState(inputs: CollectionStepInputs): StepState
  ```
- Produces from the fixtures: `board`, `listJob`, `runningRun`, `status`, `searchJob`, `search`, `probeJob`, `probe`, `inputs` (signatures below). Task 4 reuses them.

- [ ] **Step 1: Write the fixtures** — `tests/renderer/collectionStepFixtures.ts`

```ts
import type { ArticleProbeView } from '../../src/desktop/articleProbeView.js'
import type { BoardSearchJobView, BoardSearchView } from '../../src/desktop/boardSearchView.js'
import type { ArticleProbeJob } from '../../src/desktop/collection-db/articleProbeRepository.js'
import { EMPTY_ID_GAP_REPORT } from '../../src/desktop/collection-db/idGapReport.js'
import type { BoardProgress, CollectionJob, CollectionRunSummary, CollectionStatus } from '../../src/desktop/collection-db/statusQuery.js'
import type { CollectionStepInputs } from '../../src/renderer/views/collection/stepFacts.js'

export const board = (queueOrder: number, boardId: string, state: BoardProgress['state']): BoardProgress => ({
  queueOrder, boardId, name: `게시판${boardId}`, state, cursorPostedAtMs: null, insertedPostCount: 0,
})

export const listJob = (overrides: Partial<CollectionJob> = {}): CollectionJob => ({
  scope: 'board', targetStartMs: 0, targetEndMs: 86_400_000, cursorPostedAtMs: null, cursorUpdatedAtMs: 0,
  complete: false, forced: false, boards: [], ...overrides,
})

export const runningRun: CollectionRunSummary = {
  id: '1', runKind: 'backfill', status: 'running', stopReason: null, startedAtMs: 0, finishedAtMs: null,
  targetStartMs: 0, targetEndMs: 86_400_000, collectionPages: 3, requestPages: 3, insertedPostCount: 10,
  observedPostCount: 10, cursorPostedAtMs: null, boardName: null,
}

export const status = (overrides: Partial<CollectionStatus> = {}): CollectionStatus => ({
  totals: { posts: 0, boards: 0, oldestPostedAtMs: null, newestPostedAtMs: null, lastSnapshotAtMs: null },
  job: null, running: null, recentRuns: [], idGaps: EMPTY_ID_GAP_REPORT, ...overrides,
})

export const searchJob = (overrides: Partial<BoardSearchJobView> = {}): BoardSearchJobView => ({
  boardId: '137', boardName: '국내구입기', fromDay: '20250101', toDay: '20250829', queries: [],
  completedCount: 0, insertedTotal: 0, current: '글렌',
  coverage: { span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null }, ...overrides,
})

export const search = (job: BoardSearchJobView | null, running = false): BoardSearchView => ({
  boards: [], running, progress: null, blockFailure: null, job,
})

export const probeJob = (overrides: Partial<ArticleProbeJob> = {}): ArticleProbeJob => ({
  fromDay: '20250101', toDay: '20250829', total: 100, probed: 0, stored: 0, deleted: 0, unreadable: 0,
  otherBoard: 0, notice: 0, ...overrides,
})

export const probe = (job: ArticleProbeJob | null, running = false): ArticleProbeView => ({
  running, progress: null, blockFailure: null, lastRun: null, job, window: null,
})

export const inputs = (overrides: Partial<CollectionStepInputs> = {}): CollectionStepInputs => ({
  status: status(), search: null, probe: null, ...overrides,
})
```

- [ ] **Step 2: Write the failing test** — `tests/renderer/stepStates.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { listStepState, probeStepState, searchStepState } from '../../src/renderer/views/collection/stepStates.js'
import { TEXT } from '../../src/shared/text.js'
import { board, inputs, listJob, probe, probeJob, runningRun, search, searchJob, status } from './collectionStepFixtures.js'

describe('list step badge', () => {
  it('is to do with no job or an unfinished one, and done once the job is', () => {
    expect(listStepState(inputs())).toEqual({ badge: 'todo', reason: null })
    expect(listStepState(inputs({ status: status({ job: listJob() }) })).badge).toBe('todo')
    expect(listStepState(inputs({ status: status({ job: listJob({ complete: true }) }) })).badge).toBe('done')
  })

  it('is running while a list run is in flight', () => {
    expect(listStepState(inputs({ status: status({ job: listJob(), running: runningRun }) })).badge).toBe('running')
  })
})

describe('search step badge', () => {
  it('is not needed, saying why, with no job and no board at the list horizon', () => {
    expect(searchStepState(inputs({ search: search(null) }))).toEqual({ badge: 'notNeeded', reason: TEXT.collection.steps.search.notNeeded })
    // Storage for the search not answering is the same as no search at all.
    expect(searchStepState(inputs()).badge).toBe('notNeeded')
  })

  it('is to do when a board reached the horizon that the job is not for', () => {
    const atHorizon = status({ job: listJob({ complete: true, boards: [board(1, '137', 'horizon')] }) })
    expect(searchStepState(inputs({ status: atHorizon, search: search(null) })).badge).toBe('todo')
    expect(searchStepState(inputs({ status: atHorizon, search: search(searchJob({ boardId: '200', current: null })) })).badge).toBe('todo')
    // No search storage: there is no step to send the operator to.
    expect(searchStepState(inputs({ status: atHorizon })).badge).toBe('notNeeded')
  })

  it('is to do while its job is unfinished, and running while it walks', () => {
    expect(searchStepState(inputs({ search: search(searchJob()) })).badge).toBe('todo')
    expect(searchStepState(inputs({ search: search(searchJob(), true) })).badge).toBe('running')
  })

  it('is done once every query finished and no other board waits', () => {
    const atHorizon = status({ job: listJob({ complete: true, boards: [board(1, '137', 'horizon')] }) })
    expect(searchStepState(inputs({ status: atHorizon, search: search(searchJob({ current: null })) }))).toEqual({ badge: 'done', reason: null })
  })
})

describe('probe step badge', () => {
  it('is not needed until the search has finished', () => {
    expect(probeStepState(inputs({ probe: probe(null) }))).toEqual({ badge: 'notNeeded', reason: TEXT.collection.steps.probe.notNeeded })
    expect(probeStepState(inputs({ search: search(searchJob()), probe: probe(null) })).badge).toBe('notNeeded')
    expect(probeStepState(inputs()).badge).toBe('notNeeded')
  })

  it('is to do once the search finished and no probe job exists, or while one is unfinished', () => {
    expect(probeStepState(inputs({ search: search(searchJob({ current: null })), probe: probe(null) })).badge).toBe('todo')
    expect(probeStepState(inputs({ probe: probe(probeJob({ probed: 40 })) })).badge).toBe('todo')
    expect(probeStepState(inputs({ probe: probe(probeJob({ probed: 40 }), true) })).badge).toBe('running')
  })

  it('is done, and says it cannot be made again when the search moved to another window', () => {
    const done = probe(probeJob({ probed: 100 }))
    expect(probeStepState(inputs({ search: search(searchJob({ current: null })), probe: done }))).toEqual({ badge: 'done', reason: null })
    const elsewhere = search(searchJob({ boardId: '200', fromDay: '20240101', toDay: '20240601', current: null }))
    expect(probeStepState(inputs({ search: elsewhere, probe: done }))).toEqual({ badge: 'done', reason: TEXT.collection.steps.probe.spent })
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run tests/renderer/stepStates.test.ts`
Expected: FAIL — cannot resolve `stepStates.js` / `stepFacts.js`.

- [ ] **Step 4: Create `src/renderer/views/collection/stepFacts.ts`**

```ts
import type { ArticleProbeView } from '../../../desktop/articleProbeView.js'
import type { BoardSearchView } from '../../../desktop/boardSearchView.js'
import type { BoardProgress, CollectionStatus } from '../../../desktop/collection-db/statusQuery.js'

/** The three walks the loop takes turns with, in the order a collection goes. */
export type WalkStep = 'list' | 'search' | 'probe'

/**
 * What the step logic reads: the list status, and the two later walks' views
 * when their storage answered. A walk whose view is not ready counts as no
 * walk at all, so the screen degrades to fewer steps rather than to an error.
 */
export interface CollectionStepInputs {
  readonly status: CollectionStatus
  readonly search: BoardSearchView | null
  readonly probe: ArticleProbeView | null
}

/** The walks share one lock, so at most one of these is ever true. */
export function runningStep({ status, search, probe }: CollectionStepInputs): WalkStep | null {
  if (status.running !== null) return 'list'
  if (search?.running === true) return 'search'
  if (probe?.running === true) return 'probe'
  return null
}

export function listUnfinished(status: CollectionStatus): boolean {
  return status.job !== null && !status.job.complete
}

export function searchUnfinished(search: BoardSearchView | null): boolean {
  return search !== null && search.job !== null && search.job.current !== null
}

export function searchFinished(search: BoardSearchView | null): boolean {
  return search !== null && search.job !== null && search.job.current === null
}

export function probeUnfinished(probe: ArticleProbeView | null): boolean {
  return probe !== null && probe.job !== null && probe.job.probed < probe.job.total
}

export function probeFinished(probe: ArticleProbeView | null): boolean {
  return probe !== null && probe.job !== null && probe.job.probed >= probe.job.total
}

/**
 * The first board, in walking order, whose list ran out before the period did
 * and that the search job is not already for. That board's older posts are
 * reachable only by searching its titles — and only when the search storage
 * answered, since otherwise there is no search step on screen to go to.
 */
export function boardNeedingSearch({ status, search }: CollectionStepInputs): BoardProgress | null {
  if (search === null) return null
  const searchedBoardId = search.job?.boardId ?? null
  const boards = [...(status.job?.boards ?? [])].sort((a, b) => a.queueOrder - b.queueOrder)
  return boards.find((board) => board.state === 'horizon' && board.boardId !== searchedBoardId) ?? null
}

/**
 * The probe job was made once, for an earlier search window, and the
 * repository refuses a second one: the finished search in hand cannot be
 * followed by a probe of its own.
 */
export function probeSpent({ search, probe }: CollectionStepInputs): boolean {
  const searchJob = search?.job ?? null
  const probeJob = probe?.job ?? null
  if (searchJob === null || probeJob === null) return false
  if (searchJob.current !== null || probeJob.probed < probeJob.total) return false
  return searchJob.fromDay !== probeJob.fromDay || searchJob.toDay !== probeJob.toDay
}
```

- [ ] **Step 5: Create `src/renderer/views/collection/stepStates.ts`**

```ts
import { TEXT } from '../../../shared/text.js'
import {
  boardNeedingSearch,
  probeFinished,
  probeSpent,
  probeUnfinished,
  runningStep,
  searchFinished,
  searchUnfinished,
  type CollectionStepInputs,
} from './stepFacts.js'

export type StepBadge = 'todo' | 'running' | 'done' | 'notNeeded'

/** A step's badge and, when the badge alone would leave a newcomer asking why, the reason. */
export interface StepState {
  readonly badge: StepBadge
  readonly reason: string | null
}

export function listStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'list') return { badge: 'running', reason: null }
  const { job } = inputs.status
  return { badge: job !== null && job.complete ? 'done' : 'todo', reason: null }
}

export function searchStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'search') return { badge: 'running', reason: null }
  if (searchUnfinished(inputs.search) || boardNeedingSearch(inputs) !== null) return { badge: 'todo', reason: null }
  if (searchFinished(inputs.search)) return { badge: 'done', reason: null }
  return { badge: 'notNeeded', reason: TEXT.collection.steps.search.notNeeded }
}

export function probeStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'probe') return { badge: 'running', reason: null }
  if (probeUnfinished(inputs.probe)) return { badge: 'todo', reason: null }
  if (probeFinished(inputs.probe)) return { badge: 'done', reason: probeSpent(inputs) ? TEXT.collection.steps.probe.spent : null }
  if (searchFinished(inputs.search)) return { badge: 'todo', reason: null }
  return { badge: 'notNeeded', reason: TEXT.collection.steps.probe.notNeeded }
}
```

- [ ] **Step 6: Run the test, typecheck and lint**

Run: `pnpm vitest run tests/renderer/stepStates.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/views/collection/stepFacts.ts src/renderer/views/collection/stepStates.ts tests/renderer/collectionStepFixtures.ts tests/renderer/stepStates.test.ts
git commit -m "feat: decide each collection step's badge"
```

---

### Task 4: The one thing to do next

**Files:**
- Create: `src/renderer/views/collection/nextStep.ts`
- Create: `src/renderer/views/collection/nextStepLines.ts`
- Test: `tests/renderer/nextStep.test.ts`

**Interfaces:**
- Consumes: everything `stepFacts.ts` produces (Task 3), the fixtures (Task 3).
- Produces:
  ```ts
  export type NextStep =
    | { readonly kind: 'running'; readonly step: WalkStep }
    | { readonly kind: 'listWaiting'; readonly nextRunAtMs: number | null }
    | { readonly kind: 'searchResume'; readonly nextRunAtMs: number | null }
    | { readonly kind: 'probeResume'; readonly nextRunAtMs: number | null }
    | { readonly kind: 'searchNeeded'; readonly boardId: string; readonly boardName: string }
    | { readonly kind: 'probeCreate' }
    | { readonly kind: 'probeSpent' }
    | { readonly kind: 'pickPeriod' }
    | { readonly kind: 'allDone' }
  export function nextStep(inputs: CollectionStepInputs, nextRunAtMs: number | null): NextStep
  export function nextStepSentence(next: NextStep): string   // nextStepLines.ts
  export function nextStepScheduleLine(next: NextStep): string | null   // nextStepLines.ts
  ```

- [ ] **Step 1: Write the failing test** — `tests/renderer/nextStep.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { nextStep } from '../../src/renderer/views/collection/nextStep.js'
import { nextStepScheduleLine, nextStepSentence } from '../../src/renderer/views/collection/nextStepLines.js'
import { TEXT } from '../../src/shared/text.js'
import { board, inputs, listJob, probe, probeJob, runningRun, search, searchJob, status } from './collectionStepFixtures.js'

// 2026-10-04 14:20 KST.
const AT = Date.UTC(2026, 9, 4, 5, 20)
const done = listJob({ complete: true })

describe('next step', () => {
  it('asks for a period when nothing has ever been asked for', () => {
    expect(nextStep(inputs(), null)).toEqual({ kind: 'pickPeriod' })
  })

  it('says to wait while any walk runs, before anything else', () => {
    expect(nextStep(inputs({ status: status({ job: listJob(), running: runningRun }) }), AT)).toEqual({ kind: 'running', step: 'list' })
    expect(nextStep(inputs({ status: status({ job: listJob() }), search: search(searchJob(), true) }), AT)).toEqual({ kind: 'running', step: 'search' })
    expect(nextStep(inputs({ probe: probe(probeJob(), true) }), AT)).toEqual({ kind: 'running', step: 'probe' })
  })

  it('offers the earliest unfinished step first: list, then search, then probe', () => {
    const all = inputs({ status: status({ job: listJob() }), search: search(searchJob()), probe: probe(probeJob({ probed: 3 })) })
    expect(nextStep(all, AT)).toEqual({ kind: 'listWaiting', nextRunAtMs: AT })
    expect(nextStep({ ...all, status: status({ job: done }) }, AT)).toEqual({ kind: 'searchResume', nextRunAtMs: AT })
    expect(nextStep({ ...all, status: status({ job: done }), search: search(searchJob({ current: null })) }, AT)).toEqual({ kind: 'probeResume', nextRunAtMs: AT })
  })

  it('names the first board at the list horizon that the search job is not for', () => {
    const boards = [board(2, '300', 'horizon'), board(1, '137', 'horizon'), board(3, '400', 'complete')]
    const atHorizon = status({ job: listJob({ complete: true, boards }) })
    expect(nextStep(inputs({ status: atHorizon, search: search(null) }), null)).toEqual({ kind: 'searchNeeded', boardId: '137', boardName: '게시판137' })
    // 137 already searched to the end: the next board at the horizon is the one to name.
    expect(nextStep(inputs({ status: atHorizon, search: search(searchJob({ current: null })) }), null)).toEqual({ kind: 'searchNeeded', boardId: '300', boardName: '게시판300' })
  })

  it('offers a probe once the search finished, and says when the one probe was already spent', () => {
    const finished = search(searchJob({ current: null }))
    expect(nextStep(inputs({ status: status({ job: done }), search: finished, probe: probe(null) }), null)).toEqual({ kind: 'probeCreate' })
    const elsewhere = search(searchJob({ boardId: '200', fromDay: '20240101', toDay: '20240601', current: null }))
    expect(nextStep(inputs({ status: status({ job: done }), search: elsewhere, probe: probe(probeJob({ probed: 100 })) }), null)).toEqual({ kind: 'probeSpent' })
  })

  it('has nothing to do when every step finished, and does not trip over storage that did not answer', () => {
    const finished = search(searchJob({ current: null }))
    expect(nextStep(inputs({ status: status({ job: done }), search: finished, probe: probe(probeJob({ probed: 100 })) }), null)).toEqual({ kind: 'allDone' })
    expect(nextStep(inputs({ status: status({ job: done }) }), null)).toEqual({ kind: 'allDone' })
    // A board at the horizon but no search storage: no step to send the operator to.
    const atHorizon = status({ job: listJob({ complete: true, boards: [board(1, '137', 'horizon')] }) })
    expect(nextStep(inputs({ status: atHorizon }), null)).toEqual({ kind: 'allDone' })
  })
})

describe('next step sentence', () => {
  it('says the time the list resumes on the cafe\'s clock, or that it waits for a press', () => {
    expect(nextStepSentence({ kind: 'listWaiting', nextRunAtMs: AT })).toBe('① 14:20에 이어서 돕니다. 기다리거나 지금 이어서 할 수 있습니다.')
    expect(nextStepSentence({ kind: 'listWaiting', nextRunAtMs: null })).toBe(TEXT.collection.next.listWaitingManual)
  })

  it('names the running step and the board to search', () => {
    expect(nextStepSentence({ kind: 'running', step: 'probe' })).toBe(TEXT.collection.next.running.probe)
    expect(nextStepSentence({ kind: 'searchNeeded', boardId: '137', boardName: '국내구입기' })).toBe('국내구입기 게시판은 목록으로 더 내려갈 수 없습니다. ② 검색어 보충으로 채우세요.')
    expect(nextStepSentence({ kind: 'allDone' })).toBe(TEXT.collection.next.allDone)
  })

  it('says when the loop next runs a search or probe turn, and nothing for answers that carry no turn', () => {
    expect(nextStepScheduleLine({ kind: 'searchResume', nextRunAtMs: AT })).toBe(TEXT.collection.nextRunAt('14:20'))
    expect(nextStepScheduleLine({ kind: 'probeResume', nextRunAtMs: null })).toBe(TEXT.collection.nextRunNone)
    // The list sentence already says its time.
    expect(nextStepScheduleLine({ kind: 'listWaiting', nextRunAtMs: AT })).toBeNull()
    expect(nextStepScheduleLine({ kind: 'allDone' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/renderer/nextStep.test.ts`
Expected: FAIL — cannot resolve `nextStep.js`.

- [ ] **Step 3: Create `src/renderer/views/collection/nextStep.ts`**

```ts
import {
  boardNeedingSearch,
  listUnfinished,
  probeSpent,
  probeUnfinished,
  runningStep,
  searchFinished,
  searchUnfinished,
  type CollectionStepInputs,
  type WalkStep,
} from './stepFacts.js'

/** The one thing the top of the screen tells a newcomer to do now. */
export type NextStep =
  | { readonly kind: 'running'; readonly step: WalkStep }
  | { readonly kind: 'listWaiting'; readonly nextRunAtMs: number | null }
  | { readonly kind: 'searchResume'; readonly nextRunAtMs: number | null }
  | { readonly kind: 'probeResume'; readonly nextRunAtMs: number | null }
  | { readonly kind: 'searchNeeded'; readonly boardId: string; readonly boardName: string }
  | { readonly kind: 'probeCreate' }
  | { readonly kind: 'probeSpent' }
  | { readonly kind: 'pickPeriod' }
  | { readonly kind: 'allDone' }

/**
 * The first answer that applies, in the order a collection goes: a walk in
 * flight is waited for; an unfinished walk is resumed earliest step first;
 * then whatever the finished steps opened up — a board the list could not
 * reach, a finished search that wants its probe — and only then a new period.
 */
export function nextStep(inputs: CollectionStepInputs, nextRunAtMs: number | null): NextStep {
  const running = runningStep(inputs)
  if (running !== null) return { kind: 'running', step: running }
  if (listUnfinished(inputs.status)) return { kind: 'listWaiting', nextRunAtMs }
  if (searchUnfinished(inputs.search)) return { kind: 'searchResume', nextRunAtMs }
  if (probeUnfinished(inputs.probe)) return { kind: 'probeResume', nextRunAtMs }
  const board = boardNeedingSearch(inputs)
  if (board !== null) return { kind: 'searchNeeded', boardId: board.boardId, boardName: board.name }
  if (searchFinished(inputs.search) && inputs.probe !== null && inputs.probe.job === null) return { kind: 'probeCreate' }
  if (probeSpent(inputs)) return { kind: 'probeSpent' }
  if (inputs.status.job === null) return { kind: 'pickPeriod' }
  return { kind: 'allDone' }
}
```

- [ ] **Step 4: Create `src/renderer/views/collection/nextStepLines.ts`**

```ts
import { TEXT } from '../../../shared/text.js'
import { formatKstTime } from '../../format.js'
import type { NextStep } from './nextStep.js'

export function nextStepSentence(next: NextStep): string {
  switch (next.kind) {
    case 'running':
      return TEXT.collection.next.running[next.step]
    case 'listWaiting':
      return next.nextRunAtMs === null
        ? TEXT.collection.next.listWaitingManual
        : TEXT.collection.next.listWaitingAt(formatKstTime(next.nextRunAtMs))
    case 'searchResume':
      return TEXT.collection.next.searchResume
    case 'probeResume':
      return TEXT.collection.next.probeResume
    case 'searchNeeded':
      return TEXT.collection.next.searchNeeded(next.boardName)
    case 'probeCreate':
      return TEXT.collection.next.probeCreate
    case 'probeSpent':
      return TEXT.collection.next.probeSpent
    case 'pickPeriod':
      return TEXT.collection.next.pickPeriod
    case 'allDone':
      return TEXT.collection.next.allDone
  }
}

/**
 * When the loop next takes a turn, under a resume sentence: the loop walks the
 * search and the probe too, so a newcomer can wait instead of pressing. The
 * list's own sentence already carries its time.
 */
export function nextStepScheduleLine(next: NextStep): string | null {
  if (next.kind !== 'searchResume' && next.kind !== 'probeResume') return null
  return next.nextRunAtMs === null ? TEXT.collection.nextRunNone : TEXT.collection.nextRunAt(formatKstTime(next.nextRunAtMs))
}
```

- [ ] **Step 5: Run the test, typecheck and lint**

Run: `pnpm vitest run tests/renderer/nextStep.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/views/collection/nextStep.ts src/renderer/views/collection/nextStepLines.ts tests/renderer/nextStep.test.ts
git commit -m "feat: pick the one collection step to do next"
```

---

### Task 5: The shared step frame

**Files:**
- Create: `src/renderer/views/collection/CollectionStep.tsx`

**Interfaces:**
- Consumes: `StepBadge` (Task 3), `Details` from `src/renderer/views/dashboard/Details.tsx` (`{ summary: string; open: boolean; onToggle: () => void; aside?: ReactNode; children: ReactNode }`).
- Produces:
  ```ts
  export interface StepFold { readonly summary: string; readonly initiallyOpen: boolean }
  export function CollectionStep(props: {
    number: string; title: string; what: string
    badge?: StepBadge | undefined; reason?: string | null | undefined
    action?: React.ReactNode; fold?: StepFold | undefined
    children?: React.ReactNode
  }): React.JSX.Element
  ```

This task has no unit test (components are `.tsx`, which vitest does not run); the typecheck is its gate, and Task 10 checks it on screen.

- [ ] **Step 1: Create `src/renderer/views/collection/CollectionStep.tsx`**

```tsx
import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import { Details } from '../dashboard/Details.js'
import type { StepBadge } from './stepStates.js'

/** The palette role each badge wears; the bar on the left wears the same one. */
const BADGE_TONE: Record<StepBadge, 'warn' | 'accent' | 'ok' | 'idle'> = {
  todo: 'warn',
  running: 'accent',
  done: 'ok',
  notNeeded: 'idle',
}

/** `idle` has no token of its own; it reads as muted ink. */
function toneColor(tone: 'warn' | 'accent' | 'ok' | 'idle'): string {
  return tone === 'idle' ? 'var(--ink-muted)' : `var(--${tone})`
}

export interface StepFold {
  readonly summary: string
  readonly initiallyOpen: boolean
}

interface CollectionStepProps {
  readonly number: string
  readonly title: string
  /** What the step does, in one sentence a newcomer can act on. */
  readonly what: string
  readonly badge?: StepBadge | undefined
  /** Under the description: why the step is not needed, or how it ended. */
  readonly reason?: string | null | undefined
  /** The step's one button, already chosen for its state. */
  readonly action?: React.ReactNode
  /**
   * Folds the body behind one line. Only the first drawing reads
   * `initiallyOpen`: the poll redraws every two seconds and must not undo
   * what the operator pressed.
   */
  readonly fold?: StepFold | undefined
  readonly children?: React.ReactNode
}

/**
 * One step of the collection: number, name, badge and button on one line, a
 * sentence saying what the step is for, and its body. Every step wears this
 * frame so a newcomer reads four steps the same way.
 */
export function CollectionStep(props: CollectionStepProps): React.JSX.Element {
  const [open, setOpen] = useState(props.fold?.initiallyOpen ?? true)
  const tone = props.badge === undefined ? 'idle' : BADGE_TONE[props.badge]
  return (
    <section className="panel overflow-hidden" style={props.badge === 'notNeeded' ? { opacity: 0.75 } : undefined}>
      <div className="flex">
        <div className={`w-1 shrink-0 bar-${tone}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-4">
          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold" aria-hidden="true">
                  {props.number}
                </span>
                <h2 className="text-base font-bold tracking-tight">{props.title}</h2>
                {props.badge !== undefined && (
                  <span className="chip" style={{ color: toneColor(tone) }}>
                    {TEXT.collection.badges[props.badge]}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                {props.what}
              </p>
              {props.reason != null && <p className="mt-1 text-sm">{props.reason}</p>}
            </div>
            {props.action !== undefined && <div className="flex shrink-0 items-center gap-2">{props.action}</div>}
          </header>
          {props.fold === undefined ? (
            props.children
          ) : (
            <Details summary={props.fold.summary} open={open} onToggle={() => setOpen((value) => !value)}>
              {props.children}
            </Details>
          )}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/views/collection/CollectionStep.tsx
git commit -m "feat: add the frame every collection step wears"
```

---

### Task 6: ① 목록 수집

**Files:**
- Create: `src/renderer/views/collection/PeriodForm.tsx`
- Create: `src/renderer/views/collection/ListWalkStep.tsx`
- Modify: `src/renderer/views/CollectionStatus.tsx` (replace the run banner, the replace panel and the period form with `ListWalkStep`)
- Modify: `src/shared/text.ts` (delete `TEXT.collection.periodHeading`)

**Interfaces:**
- Consumes: `CollectionStep` (Task 5), `StepState` (Task 3), `runningStep`/`listStepState` (Task 3), `listStartRefusal` (Task 2), `BoardQueue` (existing, `{ boards: readonly BoardProgress[] }`).
- Produces:
  ```ts
  // PeriodForm.tsx
  export function PeriodForm(props: {
    job: CollectionJob | null; busy: boolean; blockedReason: string | null
    act: (run: () => Promise<unknown>) => Promise<boolean>
    request: number | null; initiallyOpen: boolean
  }): React.JSX.Element
  // ListWalkStep.tsx
  export function ListWalkStep(props: {
    status: CollectionStatus; state: StepState; otherRunning: boolean; busy: boolean
    act: (run: () => Promise<unknown>) => Promise<boolean>
    periodRequest: number | null
  }): React.JSX.Element
  ```
- `request` / `periodRequest` is a counter the composer bumps (Task 9): each new value unfolds the form and scrolls it into view.

Note: spec 3.3 lists `읽는 목록` under ①'s 자세히; this plan folds it inside the new-period form instead (as `읽는 목록 · 게시판별`), because it is an input of that form and means nothing without it. ①'s own 자세히 then holds only `활동 시간 무시`.

Note: the "다음 예정" line leaves ① in this task and comes back at the top in Task 9 (`NextStepPanel`). Between the two commits the branch does not show it; that is expected.

- [ ] **Step 1: Create `src/renderer/views/collection/PeriodForm.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { MS_PER_DAY, kstDayKeyRange } from '../../../shared/kst.js'
import { TEXT } from '../../../shared/text.js'
import type { CollectionFeedKind } from '../../../desktop/collection-db/repository.js'
import type { CollectionJob } from '../../../desktop/collection-db/statusQuery.js'
import type { CollectionRunRequest } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { collectionCoveragePercent, formatKstDate, formatKstDateTime } from '../../format.js'
import { Details } from '../dashboard/Details.js'
import { dayKeyOfDateInput } from './boardSearchLines.js'
import { listStartRefusal } from './startRefusals.js'

/** How far back the form starts, so a first press reads a few days rather than one. */
const DEFAULT_LOOKBACK_DAYS = 3

const MUTED = { color: 'var(--ink-muted)' }

/** Midnight KST of a date the operator picked; the input already speaks the KST calendar. */
function midnightOf(value: string): number {
  return kstDayKeyRange(dayKeyOfDateInput(value)).startMs
}

function DateField(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly max: string
  readonly onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div>
      <label className="block text-xs" style={MUTED} htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type="date"
        className="field mt-1"
        value={props.value}
        max={props.max}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  )
}

/**
 * Replacing a job the operator has not finished, said as what it costs. The
 * job is read live from props, so a block that advances the cursor while this
 * is open cannot leave a stale number in front of the answer.
 */
function ReplacePeriod(props: {
  readonly job: CollectionJob
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}): React.JSX.Element {
  const { job } = props
  const percent = collectionCoveragePercent(job)
  return (
    <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
      <p className="text-sm font-semibold tone-warn">{TEXT.collection.replace.heading}</p>
      {/* The end is the midnight after the last day, so naming it directly
          would announce a day that is not in the period. */}
      <p className="mt-1 text-sm">
        {TEXT.collection.replace.period(formatKstDate(job.targetStartMs), formatKstDate(job.targetEndMs - 1))}
      </p>
      <p className="mt-1 text-sm tabular-nums" style={MUTED}>
        {percent === null || job.cursorPostedAtMs === null
          ? TEXT.collection.replace.progressUnknown
          : `${TEXT.collection.replace.progress(percent)} · ${TEXT.collection.replace.walkedTo(formatKstDateTime(job.cursorPostedAtMs))}`}
      </p>
      <p className="mt-1 text-sm" style={MUTED}>
        {TEXT.collection.replace.cost}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={props.busy} onClick={props.onConfirm}>
          {TEXT.collection.replace.confirm}
        </button>
        <button type="button" className="btn" disabled={props.busy} onClick={props.onCancel}>
          {TEXT.collection.replace.cancel}
        </button>
      </div>
    </div>
  )
}

interface PeriodFormProps {
  readonly job: CollectionJob | null
  readonly busy: boolean
  /**
   * Why a new period cannot start now — the list walk itself is running, or
   * another walk holds the lock — or null when it can.
   */
  readonly blockedReason: string | null
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  /** Bumped by a press elsewhere that wants this form open and in view. */
  readonly request: number | null
  readonly initiallyOpen: boolean
}

/**
 * A window the operator names, in whole days. Already-stored posts gain one
 * more observation rather than a duplicate row, which the hint says.
 */
export function PeriodForm(props: PeriodFormProps): React.JSX.Element {
  const today = formatKstDate(Date.now())
  const [firstDay, setFirstDay] = useState(() => formatKstDate(Date.now() - DEFAULT_LOOKBACK_DAYS * MS_PER_DAY))
  const [lastDay, setLastDay] = useState(today)
  const [scope, setScope] = useState<CollectionFeedKind>('board')
  const [open, setOpen] = useState(props.initiallyOpen)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  /** The period asked for while another job is unfinished, held until the operator answers. */
  const [replacing, setReplacing] = useState<CollectionRunRequest | null>(null)
  const [seenRequest, setSeenRequest] = useState(props.request)
  const anchor = useRef<HTMLDivElement>(null)

  // Adjusting state while rendering, so the unfold lands in the same commit as the press.
  if (props.request !== seenRequest) {
    setSeenRequest(props.request)
    if (props.request !== null) setOpen(true)
  }
  useEffect(() => {
    if (props.request !== null) anchor.current?.scrollIntoView({ block: 'center' })
  }, [props.request])

  const press = (request: CollectionRunRequest): void => {
    setRefusal(null)
    setReplacing(null)
    void props.act(async () => {
      const result = await api.startCollection(request)
      if (result.kind === 'needs_replace') {
        setReplacing(request)
        return
      }
      setRefusal(listStartRefusal(result))
    })
  }

  const scopeLabel = scope === 'board' ? TEXT.collection.scope.board : TEXT.collection.scope.allArticles
  const datesPicked = firstDay !== '' && lastDay !== ''

  return (
    <div ref={anchor}>
      <Details summary={TEXT.collection.newPeriod} open={open} onToggle={() => setOpen((value) => !value)}>
        <div className="flex flex-wrap items-end gap-3">
          <DateField id="collect-from" label={TEXT.collection.periodFrom} value={firstDay} max={today} onChange={setFirstDay} />
          <DateField id="collect-to" label={TEXT.collection.periodTo} value={lastDay} max={today} onChange={setLastDay} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={props.busy || props.blockedReason !== null || !datesPicked}
            onClick={() => press({ firstDayMs: midnightOf(firstDay), lastDayMs: midnightOf(lastDay), scope })}
          >
            {TEXT.collection.periodRun}
          </button>
        </div>
        {props.blockedReason !== null && (
          <p className="text-xs" style={MUTED}>
            {props.blockedReason}
          </p>
        )}
        <p className="text-xs" style={MUTED}>
          {TEXT.collection.periodHint}
        </p>
        <Details summary={TEXT.collection.scope.summary(scopeLabel)} open={scopeOpen} onToggle={() => setScopeOpen((value) => !value)}>
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">{TEXT.collection.scope.heading}</legend>
            {(['board', 'all_articles'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="collect-scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
                <span>{value === 'board' ? TEXT.collection.scope.board : TEXT.collection.scope.allArticles}</span>
                <span className="text-xs" style={MUTED}>
                  {value === 'board' ? TEXT.collection.scope.boardHint : TEXT.collection.scope.allArticlesHint}
                </span>
              </label>
            ))}
          </fieldset>
        </Details>
        {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
        {replacing !== null && props.job !== null && (
          <ReplacePeriod
            job={props.job}
            busy={props.busy}
            onConfirm={() => press({ ...replacing, replace: true })}
            onCancel={() => setReplacing(null)}
          />
        )}
      </Details>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/renderer/views/collection/ListWalkStep.tsx`**

```tsx
import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { CollectionStatus } from '../../../desktop/collection-db/statusQuery.js'
import { api } from '../../api.js'
import { collectionCoveragePercent, collectionRangeLabel, elapsedLabel, formatKstDate, relativeTime } from '../../format.js'
import { Details } from '../dashboard/Details.js'
import { BoardQueue } from './BoardQueue.js'
import { CollectionStep } from './CollectionStep.js'
import { PeriodForm } from './PeriodForm.js'
import { listStartRefusal } from './startRefusals.js'
import type { StepState } from './stepStates.js'

const MUTED = { color: 'var(--ink-muted)' }

function ProgressBar({ percent }: { percent: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
        <div className="h-full bar-accent" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs tabular-nums" style={MUTED}>
        {TEXT.collection.coverage(percent)}
      </span>
    </div>
  )
}

interface ListWalkStepProps {
  readonly status: CollectionStatus
  readonly state: StepState
  /** Another walk holds the shared lock, so this one's start would only be refused. */
  readonly otherRunning: boolean
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly periodRequest: number | null
}

/**
 * ① Walking the lists: the job in hand, how far it came, each board's place,
 * and the form for a new period — folded while a job is unfinished, because
 * a newcomer pressing it would throw that job's position away.
 */
export function ListWalkStep(props: ListWalkStepProps): React.JSX.Element {
  const { job, running, recentRuns } = props.status
  const [refusal, setRefusal] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const nowMs = Date.now()
  const unfinished = job !== null && !job.complete
  const lastFinished = recentRuns.find((run) => run.status !== 'running') ?? null
  const runningPercent = running === null ? null : collectionCoveragePercent(running)
  const jobPercent = job === null ? null : collectionCoveragePercent(job)

  const resume = (): void => {
    setRefusal(null)
    void props.act(async () => setRefusal(listStartRefusal(await api.startCollection())))
  }

  const action =
    running !== null ? (
      <button type="button" className="btn" disabled={props.busy} onClick={() => void props.act(() => api.stopCollection())}>
        {TEXT.collection.stop}
      </button>
    ) : unfinished ? (
      <button type="button" className="btn btn-primary" disabled={props.busy || props.otherRunning} onClick={resume}>
        {TEXT.collection.collectNow}
      </button>
    ) : undefined

  return (
    <CollectionStep
      number={TEXT.collection.steps.list.number}
      title={TEXT.collection.steps.list.title}
      what={TEXT.collection.steps.list.what}
      badge={props.state.badge}
      reason={props.state.reason}
      action={action}
    >
      <div className="flex flex-col gap-2">
        {running !== null ? (
          <>
            <div className="text-sm font-semibold tone-accent">
              {collectionRangeLabel(running)} · {TEXT.collection.pagesRead(running.collectionPages)}
            </div>
            {runningPercent !== null && <ProgressBar percent={runningPercent} />}
            <div className="text-sm tabular-nums" style={MUTED}>
              {/* elapsedLabel, not relativeTime: this run is still going, and "22분 전" reads as one that ended. */}
              {TEXT.collection.newPosts(running.insertedPostCount)} · {elapsedLabel(running.startedAtMs, nowMs)}
            </div>
          </>
        ) : (
          <>
            {job !== null && (
              <div className="text-sm font-semibold">
                {TEXT.collection.steps.list.period(formatKstDate(job.targetStartMs), formatKstDate(job.targetEndMs - 1))}
              </div>
            )}
            {unfinished && jobPercent !== null && <ProgressBar percent={jobPercent} />}
            <div className="text-sm" style={MUTED}>
              {TEXT.collection.lastRun} ·{' '}
              {lastFinished === null
                ? TEXT.collection.never
                : `${collectionRangeLabel(lastFinished)} · ${relativeTime(lastFinished.finishedAtMs ?? lastFinished.startedAtMs, nowMs)}`}
            </div>
          </>
        )}
        {unfinished && running === null && props.otherRunning && (
          <p className="text-xs" style={MUTED}>
            {TEXT.collection.otherRunning}
          </p>
        )}
        {job?.forced === true && <p className="text-sm tone-warn">{TEXT.collection.forcedOn}</p>}
        {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
      </div>

      {job !== null && job.boards.length > 0 && <BoardQueue boards={job.boards} />}

      <PeriodForm
        job={job}
        busy={props.busy}
        blockedReason={
          running !== null ? TEXT.collection.refused.STOP_RUNNING_FIRST : props.otherRunning ? TEXT.collection.otherRunning : null
        }
        act={props.act}
        request={props.periodRequest}
        initiallyOpen={!unfinished}
      />

      {/* Only the hours give way, and only for the job in hand — which is why
          this sits with the job rather than in the schedule settings. */}
      {unfinished && (
        <Details summary={TEXT.collection.details} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)}>
          <div>
            <button
              type="button"
              className="btn"
              disabled={props.busy}
              onClick={() => {
                setRefusal(null)
                void props.act(async () => {
                  const result = await api.setCollectionForced(!job.forced)
                  if (result.kind === 'refused') setRefusal(TEXT.collection.refused[result.reason])
                })
              }}
            >
              {job.forced ? TEXT.collection.forceRelease : TEXT.collection.force}
            </button>
          </div>
        </Details>
      )}
    </CollectionStep>
  )
}
```

`BoardQueue` renders its own `panel`; inside a step that is a card in a card. In `BoardQueue.tsx` change the root `<section className="panel px-5 py-4">` to `<section>` so it sits flat in the step (it has no other caller — verify with `grep -rn "BoardQueue" src/renderer`).

- [ ] **Step 3: Wire it into `src/renderer/views/CollectionStatus.tsx`**

Replace the body of the component from the `const press = …` declaration down to (and including) the period-form `<section>`, so that the component reads:

```tsx
import { TEXT } from '../../shared/text.js'
import type { CollectionRunSummary } from '../../desktop/collection-db/statusQuery.js'
import { ArticleProbeCard } from './collection/ArticleProbeCard.js'
import { BoardSearchCard } from './collection/BoardSearchCard.js'
import { CollectionUnavailable } from './collection/CollectionUnavailable.js'
import { IdGapPanel } from './collection/IdGapPanel.js'
import { ListWalkStep } from './collection/ListWalkStep.js'
import { runningStep } from './collection/stepFacts.js'
import { listStepState } from './collection/stepStates.js'
import { collectionRangeLabel, formatKstDateTime, relativeTime } from '../format.js'
import { useApp } from '../store.js'

// Stat, RECENT_RUN_ROWS, RUN_TONE and RunRow stay exactly as they are.

export function CollectionStatus(): React.JSX.Element {
  const collection = useApp((s) => s.collection)
  const boardSearch = useApp((s) => s.boardSearch)
  const articleProbe = useApp((s) => s.articleProbe)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  if (collection === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const heading = (
    <header>
      <h1 className="text-lg font-bold tracking-tight">{TEXT.collection.heading}</h1>
    </header>
  )

  if (collection.kind !== 'ready') {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <CollectionUnavailable view={collection} />
      </div>
    )
  }

  const { totals, recentRuns, idGaps } = collection.status
  const nowMs = Date.now()
  const inputs = {
    status: collection.status,
    search: boardSearch?.kind === 'ready' ? boardSearch.view : null,
    probe: articleProbe?.kind === 'ready' ? articleProbe.view : null,
  }
  const running = runningStep(inputs)

  return (
    <div className="flex flex-col gap-6">
      {heading}
      <ListWalkStep
        status={collection.status}
        state={listStepState(inputs)}
        otherRunning={running !== null && running !== 'list'}
        busy={busy}
        act={act}
        periodRequest={null}
      />
      {boardSearch?.kind === 'ready' && <BoardSearchCard view={boardSearch.view} busy={busy} act={act} />}
      {articleProbe?.kind === 'ready' && <ArticleProbeCard view={articleProbe.view} busy={busy} act={act} />}
      {/* the stats grid, the span section, the IdGapPanel and the recent-runs section stay exactly as they are */}
    </div>
  )
}
```

Delete from the file: `useState`, `kstDateValue`, `kstMidnightOf`, the `schedule` selector, `press`, `refusal`/`replacing` state, `listStartRefusal` import (Task 2 added it; `PeriodForm`/`ListWalkStep` own it now), `BoardQueue` import, `collectionCoveragePercent`, `formatKstDate`, `formatKstTime` imports and the `CollectionFeedKind`/`CollectionRunRequest`/`StartCollectionResult` type imports — whatever the typecheck and lint then report unused.

- [ ] **Step 4: Delete `TEXT.collection.periodHeading` and `TEXT.collection.elapsed`** from `src/shared/text.ts` (neither has a reader once ① uses `elapsedLabel`: `grep -rn "periodHeading\|collection\.elapsed" src tests` must print nothing after the edit).

- [ ] **Step 5: Run the whole suite, typecheck and lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/views/collection/PeriodForm.tsx src/renderer/views/collection/ListWalkStep.tsx src/renderer/views/collection/BoardQueue.tsx src/renderer/views/CollectionStatus.tsx src/shared/text.ts
git commit -m "feat: show the list walk as the collection's first step"
```

---

### Task 7: ② 검색어 보충

**Files:**
- Create: `src/renderer/views/collection/BoardSearchQueryTable.tsx`
- Create: `src/renderer/views/collection/BoardSearchJobForm.tsx`
- Create: `src/renderer/views/collection/BoardSearchStep.tsx`
- Delete: `src/renderer/views/collection/BoardSearchCard.tsx`
- Modify: `src/renderer/views/CollectionStatus.tsx`
- Modify: `src/shared/text.ts` (delete the keys only the card read)

**Interfaces:**
- Consumes: `CollectionStep`, `StepState`, `searchStepState`, `searchStartRefusal`, and from `boardSearchLines.ts`: `boardSearchBlockFailureLine`, `boardSearchCoverageLine`, `boardSearchPageLabel`, `boardSearchPlanOutcome`, `boardSearchProgressLine`, `boardSearchQueryState`, `boardSearchQueryStateText`, `boardSearchRemainingLine`, `boardSearchStartLabel`, `boardSearchSummaryLine`, `boardSearchTotalLabel`, `dayKeyLabel`, `dayKeyOfDateInput`.
- Produces:
  ```ts
  export interface SearchFormRequest { readonly boardId: string; readonly at: number }   // BoardSearchJobForm.tsx
  export function BoardSearchJobForm(props: {
    view: BoardSearchView; busy: boolean
    act: (run: () => Promise<unknown>) => Promise<boolean>
    request: SearchFormRequest | null; initiallyOpen: boolean
  }): React.JSX.Element
  export function BoardSearchQueryTable(props: { job: BoardSearchJobView; running: boolean }): React.JSX.Element
  export function BoardSearchStep(props: {
    view: BoardSearchView; state: StepState; otherRunning: boolean; busy: boolean
    act: (run: () => Promise<unknown>) => Promise<boolean>
    request: SearchFormRequest | null
  }): React.JSX.Element
  ```

- [ ] **Step 1: Create `src/renderer/views/collection/BoardSearchQueryTable.tsx`** (the table moved unchanged out of the card)

```tsx
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchJobView } from '../../../desktop/boardSearchView.js'
import {
  boardSearchPageLabel,
  boardSearchQueryState,
  boardSearchQueryStateText,
  boardSearchTotalLabel,
} from './boardSearchLines.js'

/** Every query of the job in queue order: where each stands and what it brought in. */
export function BoardSearchQueryTable({ job, running }: { job: BoardSearchJobView; running: boolean }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
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
          {job.queries.map((query) => {
            const state = boardSearchQueryState(query, running)
            return (
              <tr key={query.query}>
                <td>{query.queueOrder}</td>
                <td>{query.query}</td>
                <td className={state === 'failed' ? 'tone-warn' : undefined}>{boardSearchQueryStateText(query, state)}</td>
                <td className="text-right">{boardSearchPageLabel(query)}</td>
                <td className="text-right">{query.insertedCount.toLocaleString('ko-KR')}</td>
                <td className="text-right">{boardSearchTotalLabel(query.totalCount)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/renderer/views/collection/BoardSearchJobForm.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchView } from '../../../desktop/boardSearchView.js'
import type { BoardSearchPlanView } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { Details } from '../dashboard/Details.js'
import { boardSearchPlanOutcome, dayKeyLabel, dayKeyOfDateInput } from './boardSearchLines.js'

/** Where a new search starts unless the job in hand says otherwise: the gap this app was built to fill began here. */
const DEFAULT_FROM = '2025-01-01'

const MUTED = { color: 'var(--ink-muted)' }

/** A press elsewhere asking for this form with a board chosen; `at` grows with each press. */
export interface SearchFormRequest {
  readonly boardId: string
  readonly at: number
}

interface BoardSearchJobFormProps {
  readonly view: BoardSearchView
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly request: SearchFormRequest | null
  readonly initiallyOpen: boolean
}

/**
 * A new search job: a board and the day to search back from, previewed before
 * it is made. Replacing an unfinished job asks on the screen, saying what it
 * costs, rather than in a browser dialog that says nothing.
 */
export function BoardSearchJobForm({ view, busy, act, request, initiallyOpen }: BoardSearchJobFormProps): React.JSX.Element {
  const { job, running } = view
  const [boardId, setBoardId] = useState(job?.boardId ?? view.boards[0]?.boardId ?? '')
  const [fromDate, setFromDate] = useState(job === null ? DEFAULT_FROM : dayKeyLabel(job.fromDay))
  const [open, setOpen] = useState(initiallyOpen)
  const [confirming, setConfirming] = useState(false)
  /** The last preview or create that came back as a plan, until the next press. */
  const [plan, setPlan] = useState<string | null>(null)
  /** Why the last press did nothing, until the next press. */
  const [refusal, setRefusal] = useState<string | null>(null)
  const [seenRequest, setSeenRequest] = useState(request?.at ?? null)
  const anchor = useRef<HTMLDivElement>(null)
  const fromDay = dayKeyOfDateInput(fromDate)

  // Adjusting state while rendering, so the unfold and the chosen board land with the press.
  if ((request?.at ?? null) !== seenRequest) {
    setSeenRequest(request?.at ?? null)
    if (request !== null) {
      setOpen(true)
      setBoardId(request.boardId)
    }
  }
  useEffect(() => {
    if (request !== null) anchor.current?.scrollIntoView({ block: 'center' })
  }, [request])

  const clear = (): void => {
    setPlan(null)
    setRefusal(null)
  }

  const answer = (outcome: BoardSearchPlanView): void => {
    const { kind, text } = boardSearchPlanOutcome(outcome, fromDay)
    if (kind === 'plan') setPlan(text)
    else setRefusal(text)
  }

  const create = (): void => {
    clear()
    setConfirming(false)
    void act(async () => answer(await api.createBoardSearchJob({ boardId, fromDay })))
  }

  return (
    <div ref={anchor}>
      <Details summary={TEXT.collection.newSearchJob} open={open} onToggle={() => setOpen((value) => !value)}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (job !== null) setConfirming(true)
            else create()
          }}
        >
          <label className="flex flex-col gap-1 text-xs" style={MUTED}>
            {TEXT.boardSearch.board}
            <select className="field" value={boardId} disabled={busy || running} onChange={(event) => setBoardId(event.target.value)}>
              {view.boards.map((board) => (
                <option key={board.boardId} value={board.boardId}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={MUTED}>
            {TEXT.boardSearch.fromDay}
            <input className="field" type="date" value={fromDate} disabled={busy || running} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || boardId === '' || fromDate === ''}
            onClick={() => {
              clear()
              void act(async () => answer(await api.previewBoardSearchJob({ boardId, fromDay })))
            }}
          >
            {TEXT.boardSearch.previewButton}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || running || boardId === '' || fromDate === ''}>
            {TEXT.boardSearch.create}
          </button>
        </form>
        {plan !== null && (
          <p className="text-sm tabular-nums" style={MUTED}>
            {plan}
          </p>
        )}
        {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
        {confirming && job !== null && (
          <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
            <p className="text-sm font-semibold tone-warn">{TEXT.boardSearch.replace.heading}</p>
            <p className="mt-1 text-sm tabular-nums">
              {TEXT.boardSearch.replace.progress(job.completedCount, job.queries.length, job.insertedTotal)}
            </p>
            <p className="mt-1 text-sm" style={MUTED}>
              {TEXT.boardSearch.replace.cost}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>
                {TEXT.boardSearch.replace.confirm}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>
                {TEXT.boardSearch.replace.cancel}
              </button>
            </div>
          </div>
        )}
      </Details>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/views/collection/BoardSearchStep.tsx`**

```tsx
import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchView } from '../../../desktop/boardSearchView.js'
import { api } from '../../api.js'
import { Details } from '../dashboard/Details.js'
import {
  boardSearchBlockFailureLine,
  boardSearchCoverageLine,
  boardSearchProgressLine,
  boardSearchRemainingLine,
  boardSearchStartLabel,
  boardSearchSummaryLine,
  dayKeyLabel,
} from './boardSearchLines.js'
import { BoardSearchJobForm, type SearchFormRequest } from './BoardSearchJobForm.js'
import { BoardSearchQueryTable } from './BoardSearchQueryTable.js'
import { CollectionStep } from './CollectionStep.js'
import { searchStartRefusal } from './startRefusals.js'
import type { StepState } from './stepStates.js'

const MUTED = { color: 'var(--ink-muted)' }

interface BoardSearchStepProps {
  readonly view: BoardSearchView
  readonly state: StepState
  readonly otherRunning: boolean
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly request: SearchFormRequest | null
}

/**
 * ② The search backfill: past the list's reach, a board's older posts are
 * found by searching its titles. The job in hand up front, its arithmetic
 * and per-query table under 자세히, the form for a new job folded once a
 * job exists.
 */
export function BoardSearchStep({ view, state, otherRunning, busy, act, request }: BoardSearchStepProps): React.JSX.Element {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { job, running } = view
  const finished = job !== null && job.current === null
  const progressLine = running ? boardSearchProgressLine(view.progress) : null
  const blockFailureLine = boardSearchBlockFailureLine(view.blockFailure)
  const remainingLine = job === null ? null : boardSearchRemainingLine(job.coverage)
  const coverageLine = job === null ? null : boardSearchCoverageLine(job.coverage)

  const action =
    job === null || finished ? undefined : running ? (
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => {
          setRefusal(null)
          void act(() => api.stopBoardSearch())
        }}
      >
        {TEXT.boardSearch.stop}
      </button>
    ) : (
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || otherRunning}
        onClick={() => {
          setRefusal(null)
          void act(async () => setRefusal(searchStartRefusal(await api.startBoardSearch())))
        }}
      >
        {boardSearchStartLabel(job)}
      </button>
    )

  return (
    <CollectionStep
      number={TEXT.collection.steps.search.number}
      title={TEXT.collection.steps.search.title}
      what={TEXT.collection.steps.search.what}
      badge={state.badge}
      reason={state.reason}
      action={action}
      fold={state.badge === 'notNeeded' ? { summary: TEXT.collection.useAnyway, initiallyOpen: false } : undefined}
    >
      {job !== null && (
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-semibold">
            {TEXT.boardSearch.window(job.boardName ?? job.boardId, dayKeyLabel(job.fromDay), dayKeyLabel(job.toDay))}
          </div>
          <div className="text-sm tabular-nums" style={MUTED}>
            {boardSearchSummaryLine(job)}
          </div>
          {progressLine !== null && <div className="text-sm tabular-nums tone-accent">{progressLine}</div>}
          {remainingLine !== null && <div className="text-sm tabular-nums">{remainingLine}</div>}
        </div>
      )}
      {!finished && job !== null && !running && otherRunning && (
        <p className="text-xs" style={MUTED}>
          {TEXT.collection.otherRunning}
        </p>
      )}
      {blockFailureLine !== null && <p className="text-sm tone-warn">{blockFailureLine}</p>}
      {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
      {job !== null && (
        <Details summary={TEXT.collection.details} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)}>
          {coverageLine !== null && (
            <p className="text-sm tabular-nums" style={MUTED}>
              {coverageLine}
            </p>
          )}
          <BoardSearchQueryTable job={job} running={running} />
        </Details>
      )}
      <BoardSearchJobForm view={view} busy={busy} act={act} request={request} initiallyOpen={job === null} />
    </CollectionStep>
  )
}
```

- [ ] **Step 4: Swap it into `CollectionStatus.tsx` and delete the card**

In `CollectionStatus.tsx`: replace the `BoardSearchCard` import with `import { BoardSearchStep } from './collection/BoardSearchStep.js'`, add `searchStepState` to the `stepStates.js` import, and replace the `BoardSearchCard` line with:

```tsx
      {inputs.search !== null && (
        <BoardSearchStep
          view={inputs.search}
          state={searchStepState(inputs)}
          otherRunning={running !== null && running !== 'search'}
          busy={busy}
          act={act}
          request={null}
        />
      )}
```

Then delete the card: `git rm src/renderer/views/collection/BoardSearchCard.tsx`.

- [ ] **Step 5: Delete the text only the card read**

In `TEXT.boardSearch` delete `heading`, `why`, `replaceConfirm`, `none`, `running`, `idle`, `finished`, `queries`. Confirm each has no reader left:

Run: `for k in heading why replaceConfirm none running idle finished queries; do echo "$k $(grep -rn "TEXT.boardSearch.$k\b" src tests | wc -l)"; done`
Expected: every count `0`.

- [ ] **Step 6: Run the whole suite, typecheck and lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/renderer/views/collection src/renderer/views/CollectionStatus.tsx src/shared/text.ts
git commit -m "feat: show the search backfill as the collection's second step"
```

---

### Task 8: ③ 빈 글 번호 확인

**Files:**
- Create: `src/renderer/views/collection/ArticleProbeStep.tsx`
- Delete: `src/renderer/views/collection/ArticleProbeCard.tsx`
- Modify: `src/renderer/views/CollectionStatus.tsx`
- Modify: `src/renderer/views/collection/articleProbeLines.ts` (delete `articleProbeSummaryLine`)
- Modify: `tests/renderer/articleProbeLines.test.ts` (delete the `sums the job the way the spec spells it` test and the import)
- Modify: `src/shared/text.ts` (delete the keys only the card read)

**Interfaces:**
- Consumes: `CollectionStep`, `StepState`, `probeStepState`, `probeStartRefusal`, and from `articleProbeLines.ts`: `articleProbeBreakdownLine`, `articleProbeCreateOutcome`, `articleProbeCreateRefusal`, `articleProbeFailureLine`, `articleProbeHeadlineLine`, `articleProbeProgressLine`, `articleProbeStartLabel`, `articleProbeWindowLine`.
- Produces: `export function ArticleProbeStep(props: { view: ArticleProbeView; state: StepState; otherRunning: boolean; busy: boolean; act: (run: () => Promise<unknown>) => Promise<boolean> }): React.JSX.Element`

- [ ] **Step 1: Create `src/renderer/views/collection/ArticleProbeStep.tsx`**

```tsx
import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { ArticleProbeView } from '../../../desktop/articleProbeView.js'
import { api } from '../../api.js'
import { Details } from '../dashboard/Details.js'
import {
  articleProbeBreakdownLine,
  articleProbeCreateOutcome,
  articleProbeCreateRefusal,
  articleProbeFailureLine,
  articleProbeHeadlineLine,
  articleProbeProgressLine,
  articleProbeStartLabel,
  articleProbeWindowLine,
} from './articleProbeLines.js'
import { CollectionStep, type StepFold } from './CollectionStep.js'
import { probeStartRefusal } from './startRefusals.js'
import type { StepState } from './stepStates.js'

const MUTED = { color: 'var(--ink-muted)' }

interface ArticleProbeStepProps {
  readonly view: ArticleProbeView
  readonly state: StepState
  readonly otherRunning: boolean
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
}

/**
 * ③ Reading the gap's article numbers one by one. A finished job folds to the
 * one line that matters — how many posts it saved — because there is nothing
 * left to press.
 */
export function ArticleProbeStep({ view, state, otherRunning, busy, act }: ArticleProbeStepProps): React.JSX.Element {
  /** What the last create press said, until the next press. */
  const [created, setCreated] = useState<string | null>(null)
  /** Why the last press did nothing, until the next press. */
  const [refusal, setRefusal] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { job, running, window } = view
  const finished = job !== null && job.probed >= job.total
  const progressLine = running ? articleProbeProgressLine(view.progress) : null
  const failureLine = articleProbeFailureLine(view.blockFailure, view.lastRun)
  const createRefusal = job === null ? articleProbeCreateRefusal(window) : null
  const windowLine = job !== null ? articleProbeWindowLine(job) : window?.kind === 'ready' ? articleProbeWindowLine(window) : null

  const clear = (): void => {
    setCreated(null)
    setRefusal(null)
  }

  const action =
    job === null ? (
      <button
        type="button"
        className="btn btn-primary"
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
    ) : finished ? undefined : running ? (
      <button
        type="button"
        className="btn"
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
        className="btn btn-primary"
        disabled={busy || otherRunning}
        onClick={() => {
          clear()
          void act(async () => setRefusal(probeStartRefusal(await api.startArticleProbe())))
        }}
      >
        {articleProbeStartLabel(job)}
      </button>
    )

  const fold: StepFold | undefined = finished
    ? { summary: TEXT.collection.steps.probe.folded(job.stored), initiallyOpen: false }
    : state.badge === 'notNeeded'
      ? { summary: TEXT.collection.useAnyway, initiallyOpen: false }
      : undefined

  return (
    <CollectionStep
      number={TEXT.collection.steps.probe.number}
      title={TEXT.collection.steps.probe.title}
      what={TEXT.collection.steps.probe.what}
      badge={state.badge}
      reason={state.reason}
      action={action}
      fold={fold}
    >
      <div className="flex flex-col gap-0.5">
        {windowLine !== null && <div className="text-sm font-semibold">{windowLine}</div>}
        {job !== null && <div className="text-sm tabular-nums">{articleProbeHeadlineLine(job)}</div>}
        {progressLine !== null && <div className="text-sm tabular-nums tone-accent">{progressLine}</div>}
      </div>
      {job !== null && !finished && !running && otherRunning && (
        <p className="text-xs" style={MUTED}>
          {TEXT.collection.otherRunning}
        </p>
      )}
      {created !== null && (
        <p className="text-sm tabular-nums" style={MUTED}>
          {created}
        </p>
      )}
      {failureLine !== null && <p className="text-sm tone-warn">{failureLine}</p>}
      {createRefusal !== null && <p className="text-sm tone-warn">{createRefusal}</p>}
      {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
      {job !== null && (
        <Details summary={TEXT.collection.details} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)}>
          <p className="text-sm tabular-nums" style={MUTED}>
            {articleProbeBreakdownLine(job)}
          </p>
        </Details>
      )}
    </CollectionStep>
  )
}
```

- [ ] **Step 2: Swap it into `CollectionStatus.tsx` and delete the card**

Replace the `ArticleProbeCard` import with `import { ArticleProbeStep } from './collection/ArticleProbeStep.js'`, add `probeStepState` to the `stepStates.js` import, and replace the `ArticleProbeCard` line with:

```tsx
      {inputs.probe !== null && (
        <ArticleProbeStep
          view={inputs.probe}
          state={probeStepState(inputs)}
          otherRunning={running !== null && running !== 'probe'}
          busy={busy}
          act={act}
        />
      )}
```

Then: `git rm src/renderer/views/collection/ArticleProbeCard.tsx`.

- [ ] **Step 3: Delete what only the card read**

- `articleProbeLines.ts`: delete `articleProbeSummaryLine`.
- `tests/renderer/articleProbeLines.test.ts`: delete `articleProbeSummaryLine` from the import and the whole `it('sums the job the way the spec spells it', …)` block (the headline/breakdown test from Task 1 covers the same counts).
- `TEXT.articleProbe`: delete `heading`, `why`, `none`, `running`, `idle`, `finished`, `summary`.

Run: `for k in heading why none running idle finished summary; do echo "$k $(grep -rn "TEXT.articleProbe.$k\b" src tests | wc -l)"; done; grep -rn "articleProbeSummaryLine" src tests | wc -l`
Expected: every count `0`.

- [ ] **Step 4: Run the whole suite, typecheck and lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/renderer/views/collection src/renderer/views/CollectionStatus.tsx src/shared/text.ts tests/renderer/articleProbeLines.test.ts
git commit -m "feat: show the article number probe as the collection's third step"
```

---

### Task 9: ④ 점검, the next-step panel, and the composer

**Files:**
- Create: `src/renderer/views/collection/CheckStep.tsx`
- Create: `src/renderer/views/collection/RecentRuns.tsx`
- Create: `src/renderer/views/collection/NextStepPanel.tsx`
- Modify: `src/renderer/views/collection/IdGapPanel.tsx` (sit flat inside ④ instead of as a card in a card)
- Modify: `src/renderer/views/CollectionStatus.tsx` (becomes the composer only)

**Interfaces:**
- Consumes: `nextStep`, `NextStep` (Task 4), `nextStepSentence`, `nextStepScheduleLine` (Task 4), `WalkStep`, `runningStep` (Task 3), the three `*StepState` functions (Task 3), the three start refusals (Task 2), `articleProbeCreateOutcome`, `SearchFormRequest` (Task 7), the step components (Tasks 6–8), `IdGapPanel` (existing, `{ report: IdGapReport }`).
- Produces:
  ```ts
  export function CheckStep(props: { status: CollectionStatus }): React.JSX.Element
  export function RecentRuns(props: { runs: readonly CollectionRunSummary[] }): React.JSX.Element
  export function NextStepPanel(props: {
    next: NextStep; busy: boolean
    act: (run: () => Promise<unknown>) => Promise<boolean>
    onPickPeriod: () => void
    onPrepareSearch: (boardId: string) => void
  }): React.JSX.Element
  ```

- [ ] **Step 1: Create `src/renderer/views/collection/CheckStep.tsx`** (`Stat` and the span section move here unchanged)

```tsx
import { TEXT } from '../../../shared/text.js'
import type { CollectionStatus } from '../../../desktop/collection-db/statusQuery.js'
import { formatKstDateTime } from '../../format.js'
import { CollectionStep } from './CollectionStep.js'
import { IdGapPanel } from './IdGapPanel.js'

/** Same shape the dashboard's numbers wear, so the two screens read alike. */
function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-lg px-4 py-3.5" style={{ background: 'var(--surface-sunken)' }}>
      <div className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums leading-none">{value.toLocaleString()}</div>
    </div>
  )
}

/**
 * ④ What is stored, and whether anything was lost. No badge: there is
 * nothing to press here, only something to read.
 */
export function CheckStep({ status }: { status: CollectionStatus }): React.JSX.Element {
  const { totals, idGaps } = status
  return (
    <CollectionStep number={TEXT.collection.steps.check.number} title={TEXT.collection.steps.check.title} what={TEXT.collection.steps.check.what}>
      <div className="grid grid-cols-2 gap-3">
        <Stat label={TEXT.collection.totals.posts} value={totals.posts} />
        <Stat label={TEXT.collection.totals.boards} value={totals.boards} />
      </div>
      {/* Said in dates rather than page numbers: a page number points at
          different posts an hour later, so it cannot describe what is stored. */}
      <div>
        <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collection.span}
        </div>
        <div className="mt-1 text-sm font-semibold tabular-nums">
          {totals.oldestPostedAtMs === null || totals.newestPostedAtMs === null
            ? TEXT.collection.spanEmpty
            : TEXT.collection.spanRange(formatKstDateTime(totals.oldestPostedAtMs), formatKstDateTime(totals.newestPostedAtMs))}
        </div>
      </div>
      {totals.posts > 0 && <IdGapPanel report={idGaps} />}
    </CollectionStep>
  )
}
```

- [ ] **Step 2: Create `src/renderer/views/collection/RecentRuns.tsx`** (`RUN_TONE`, `RunRow`, `RECENT_RUN_ROWS` move here unchanged from `CollectionStatus.tsx`)

```tsx
import { TEXT } from '../../../shared/text.js'
import type { CollectionRunSummary } from '../../../desktop/collection-db/statusQuery.js'
import { collectionRangeLabel, relativeTime } from '../../format.js'

/** How many finished runs this screen lists before it stops being readable. */
const RECENT_RUN_ROWS = 8

const RUN_TONE: Record<CollectionRunSummary['status'], string> = {
  running: 'accent',
  succeeded: 'ok',
  partial: 'warn',
  failed: 'alarm',
  interrupted: 'idle',
}

/**
 * A finished run in one line: what it was asked for, what it stored, and — when
 * it did not finish cleanly — the reason, which is the whole point of keeping
 * failures on the list rather than hiding them.
 */
function RunRow({ run, nowMs }: { run: CollectionRunSummary; nowMs: number }): React.JSX.Element {
  const tone = RUN_TONE[run.status]
  const detail = [TEXT.collection.pagesRead(run.collectionPages), TEXT.collection.newPosts(run.insertedPostCount)]
  if (run.stopReason !== null) detail.push(run.stopReason)
  return (
    <div className="panel flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full bar-${tone}`} />
          <span className="text-sm font-semibold">
            {collectionRangeLabel(run)} · {TEXT.collection.runStatus[run.status]}
          </span>
        </div>
        <div className="mt-0.5 text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
          {detail.join(' · ')}
        </div>
      </div>
      <span className={`shrink-0 text-xs tone-${tone === 'accent' ? 'accent' : 'idle'}`}>
        {run.status === 'running' ? TEXT.collection.running : relativeTime(run.finishedAtMs ?? run.startedAtMs, nowMs)}
      </span>
    </div>
  )
}

export function RecentRuns({ runs }: { runs: readonly CollectionRunSummary[] }): React.JSX.Element {
  const nowMs = Date.now()
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
        {TEXT.collection.recent}
      </h2>
      {/* The query keeps a day's worth so the dashboard can draw it; this
          list is read, not scanned, and a screenful is what it wants. */}
      {runs.slice(0, RECENT_RUN_ROWS).map((run) => (
        <RunRow key={run.id} run={run} nowMs={nowMs} />
      ))}
    </section>
  )
}
```

- [ ] **Step 3: Create `src/renderer/views/collection/NextStepPanel.tsx`**

```tsx
import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { StartCollectionResult } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { articleProbeCreateOutcome } from './articleProbeLines.js'
import type { NextStep } from './nextStep.js'
import { nextStepScheduleLine, nextStepSentence } from './nextStepLines.js'
import { listStartRefusal, probeStartRefusal, searchStartRefusal } from './startRefusals.js'
import type { WalkStep } from './stepFacts.js'

/** Each walk's stop, so the panel can stop whichever is running without asking which. */
const STOP: Record<WalkStep, () => Promise<void>> = {
  list: () => api.stopCollection(),
  search: () => api.stopBoardSearch(),
  probe: () => api.stopArticleProbe(),
}

const STOP_LABEL: Record<WalkStep, string> = {
  list: TEXT.collection.stop,
  search: TEXT.boardSearch.stop,
  probe: TEXT.articleProbe.stop,
}

interface NextStepPanelProps {
  readonly next: NextStep
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly onPickPeriod: () => void
  readonly onPrepareSearch: (boardId: string) => void
}

/**
 * The top of the screen: one sentence saying what to do now, and the one
 * button that does it. Everything it says is read off the steps below; it
 * starts nothing they could not.
 */
export function NextStepPanel({ next, busy, act, onPickPeriod, onPrepareSearch }: NextStepPanelProps): React.JSX.Element {
  const scheduleLine = nextStepScheduleLine(next)
  /**
   * What the last press here answered, until the next press. The composer keys
   * this panel by `next.kind`, so an answer never outlives the step it was for.
   */
  const [answer, setAnswer] = useState<{ readonly text: string; readonly warn: boolean } | null>(null)

  const start = (run: () => Promise<StartCollectionResult>, refusal: (result: StartCollectionResult) => string | null): void => {
    setAnswer(null)
    void act(async () => {
      const text = refusal(await run())
      if (text !== null) setAnswer({ text, warn: true })
    })
  }

  const button = (label: string, onClick: () => void, primary = true): React.JSX.Element => (
    <button type="button" className={primary ? 'btn btn-primary' : 'btn'} disabled={busy} onClick={onClick}>
      {label}
    </button>
  )

  const action = ((): React.JSX.Element | null => {
    switch (next.kind) {
      case 'running':
        return button(STOP_LABEL[next.step], () => void act(STOP[next.step]), false)
      case 'listWaiting':
        return button(TEXT.collection.next.resumeList, () => start(() => api.startCollection(), listStartRefusal))
      case 'searchResume':
        return button(TEXT.boardSearch.resume, () => start(() => api.startBoardSearch(), searchStartRefusal))
      case 'probeResume':
        return button(TEXT.articleProbe.resume, () => start(() => api.startArticleProbe(), probeStartRefusal))
      case 'searchNeeded':
        return button(TEXT.collection.next.prepareSearch, () => onPrepareSearch(next.boardId))
      case 'probeCreate':
        return button(TEXT.articleProbe.create, () => {
          setAnswer(null)
          void act(async () => {
            const outcome = articleProbeCreateOutcome(await api.createArticleProbeJob())
            setAnswer({ text: outcome.text, warn: outcome.kind === 'refusal' })
          })
        })
      case 'pickPeriod':
        return button(TEXT.collection.next.pickPeriodAction, onPickPeriod)
      case 'probeSpent':
      case 'allDone':
        return null
    }
  })()

  return (
    <section className="panel overflow-hidden" aria-labelledby="collection-next-heading">
      <div className="flex">
        <div className={`w-1 shrink-0 ${next.kind === 'running' ? 'bar-accent' : next.kind === 'allDone' ? 'bar-ok' : 'bar-warn'}`} />
        <div className="flex flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="collection-next-heading" className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.collection.next.heading}
            </h2>
            <p className="mt-1 text-base font-semibold">{nextStepSentence(next)}</p>
            {scheduleLine !== null && (
              <p className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                {scheduleLine}
              </p>
            )}
            {answer !== null && <p className={`mt-1 text-sm ${answer.warn ? 'tone-warn' : ''}`}>{answer.text}</p>}
          </div>
          {action !== null && <div className="shrink-0">{action}</div>}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3b: Flatten `IdGapPanel`** — its only caller is now `CheckStep`, inside a step `panel`. In `src/renderer/views/collection/IdGapPanel.tsx` change the root `<section className="panel overflow-hidden">` to:

```tsx
    <section className="overflow-hidden rounded-lg" style={{ background: 'var(--surface-sunken)' }}>
```

Keep the coloured left bar (`bar-ok` / `bar-warn`): it is what says "lost pages or not" at a glance. Verify the single caller first: `grep -rn "IdGapPanel" src/renderer` must list only `IdGapPanel.tsx` and `CheckStep.tsx` after Step 4.

- [ ] **Step 4: Make `src/renderer/views/CollectionStatus.tsx` the composer** — replace the whole file with:

```tsx
import { useState } from 'react'
import { TEXT } from '../../shared/text.js'
import { ArticleProbeStep } from './collection/ArticleProbeStep.js'
import { BoardSearchStep } from './collection/BoardSearchStep.js'
import type { SearchFormRequest } from './collection/BoardSearchJobForm.js'
import { CheckStep } from './collection/CheckStep.js'
import { CollectionUnavailable } from './collection/CollectionUnavailable.js'
import { ListWalkStep } from './collection/ListWalkStep.js'
import { NextStepPanel } from './collection/NextStepPanel.js'
import { nextStep } from './collection/nextStep.js'
import { RecentRuns } from './collection/RecentRuns.js'
import { runningStep, type CollectionStepInputs } from './collection/stepFacts.js'
import { listStepState, probeStepState, searchStepState } from './collection/stepStates.js'
import { useApp } from '../store.js'

/**
 * The collection screen, top to bottom in the order a collection goes: what
 * to do now, then ① the list walk, ② the search backfill past its reach,
 * ③ the article numbers search could not find, ④ the check. This file only
 * puts them in order and carries the next-step panel's presses to the form
 * they open.
 */
export function CollectionStatus(): React.JSX.Element {
  const collection = useApp((s) => s.collection)
  const schedule = useApp((s) => s.collectionSchedule)
  const boardSearch = useApp((s) => s.boardSearch)
  const articleProbe = useApp((s) => s.articleProbe)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  /** Grows with each "기간 고르기" press, which asks ①'s form to open and come into view. */
  const [periodRequest, setPeriodRequest] = useState<number | null>(null)
  /** Each "보충 준비" press, with the board it is for. */
  const [searchRequest, setSearchRequest] = useState<SearchFormRequest | null>(null)

  if (collection === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const heading = (
    <header>
      <h1 className="text-lg font-bold tracking-tight">{TEXT.collection.heading}</h1>
    </header>
  )

  if (collection.kind !== 'ready') {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <CollectionUnavailable view={collection} />
      </div>
    )
  }

  const inputs: CollectionStepInputs = {
    status: collection.status,
    search: boardSearch?.kind === 'ready' ? boardSearch.view : null,
    probe: articleProbe?.kind === 'ready' ? articleProbe.view : null,
  }
  const running = runningStep(inputs)
  const next = nextStep(inputs, schedule?.nextRunAtMs ?? null)
  const otherThan = (step: 'list' | 'search' | 'probe'): boolean => running !== null && running !== step

  return (
    <div className="flex flex-col gap-6">
      {heading}
      <NextStepPanel
        key={next.kind}
        next={next}
        busy={busy}
        act={act}
        onPickPeriod={() => setPeriodRequest((count) => (count ?? 0) + 1)}
        onPrepareSearch={(boardId) => setSearchRequest((previous) => ({ boardId, at: (previous?.at ?? 0) + 1 }))}
      />
      <ListWalkStep
        status={collection.status}
        state={listStepState(inputs)}
        otherRunning={otherThan('list')}
        busy={busy}
        act={act}
        periodRequest={periodRequest}
      />
      {inputs.search !== null && (
        <BoardSearchStep
          view={inputs.search}
          state={searchStepState(inputs)}
          otherRunning={otherThan('search')}
          busy={busy}
          act={act}
          request={searchRequest}
        />
      )}
      {inputs.probe !== null && (
        <ArticleProbeStep view={inputs.probe} state={probeStepState(inputs)} otherRunning={otherThan('probe')} busy={busy} act={act} />
      )}
      <CheckStep status={collection.status} />
      <RecentRuns runs={collection.status.recentRuns} />
    </div>
  )
}
```

- [ ] **Step 5: Run the whole suite, typecheck, lint and the renderer build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build:renderer`
Expected: PASS, and `dist/renderer` builds.

Also confirm the old card names are gone: `grep -rn "BoardSearchCard\|ArticleProbeCard" src tests` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add -A src/renderer/views/collection src/renderer/views/CollectionStatus.tsx
git commit -m "feat: lead the collection screen with the next step to take"
```

---

### Task 10: See it on screen

**Files:**
- Create (scratchpad only, never committed): `<scratchpad>/preview/` — a copy of `dist/renderer` plus `wm-shim.js`

**Interfaces:**
- Consumes: the built renderer (Task 9), the fixture shapes `CollectionStatus` (`src/desktop/collection-db/statusQuery.ts`), `BoardSearchView` (`src/desktop/boardSearchView.ts`), `ArticleProbeView` (`src/desktop/articleProbeView.ts`), `CollectionScheduleView` (`src/desktop/ipc.ts`).

The production app is running on this machine; never `pnpm start` a second instance. Verify through the built renderer with a fake `window.wm` (project memory: renderer preview without Electron).

- [ ] **Step 1: Build and copy the renderer**

Run: `pnpm build:renderer && rm -rf "$SCRATCH/preview" && cp -R dist/renderer "$SCRATCH/preview"` with `SCRATCH` set to the session scratchpad directory.

- [ ] **Step 2: Write `$SCRATCH/preview/wm-shim.js`** and add `<script src="./wm-shim.js"></script>` before the module script in `$SCRATCH/preview/index.html`.

```js
// Fake preload bridge: every method resolves a fixture; unknown ones resolve null.
const STATE = new URLSearchParams(location.search).get('state') ?? 'fresh'
const now = Date.now()
const day = 86_400_000
const gaps = { deletedLikeIds: 120, suspectCount: 0, suspectIds: 0, suspects: [] }
const totals = { posts: 82661, boards: 14, oldestPostedAtMs: now - 600 * day, newestPostedAtMs: now - 3600_000, lastSnapshotAtMs: now }
const boardRow = (queueOrder, boardId, name, state) => ({ queueOrder, boardId, name, state, cursorPostedAtMs: now - 30 * day, insertedPostCount: 1200 })
const run = (status) => ({ id: String(Math.random()), runKind: 'backfill', status, stopReason: status === 'partial' ? 'PAGE_BUDGET_SPENT' : null, startedAtMs: now - 40 * 60_000, finishedAtMs: status === 'running' ? null : now - 10 * 60_000, targetStartMs: now - 30 * day, targetEndMs: now, collectionPages: 120, requestPages: 120, insertedPostCount: 340, observedPostCount: 900, cursorPostedAtMs: now - 12 * day, boardName: '국내구입기' })
const job = (complete, boards) => ({ scope: 'board', targetStartMs: now - 30 * day, targetEndMs: now, cursorPostedAtMs: now - 12 * day, cursorUpdatedAtMs: now, complete, forced: false, boards })
const searchJob = (current) => ({ boardId: '137', boardName: '국내구입기', fromDay: '20250101', toDay: '20250829', queries: [{ boardId: '137', query: '글렌', fromDay: '20250101', toDay: '20250829', segmentToDay: null, queueOrder: 1, expectedGain: 10, lastCommittedPage: 4, insertedCount: 210, totalCount: 2000, complete: current === null, lastRunId: null, lastRun: null }], completedCount: current === null ? 300 : 180, insertedTotal: 12410, current, coverage: { span: 111973, missing: 9660, baselineMissingRatio: 0.0678, estimatedRemaining: 2066 } })
const probeJob = (probed) => ({ fromDay: '20250101', toDay: '20250829', total: 9660, probed, stored: 1625, deleted: 7800, unreadable: 45, otherBoard: 0, notice: 0 })

const SCENARIOS = {
  fresh: { job: null, running: null, runs: [], search: null, probe: null },
  listRunning: { job: job(false, [boardRow(1, '137', '국내구입기', 'walking'), boardRow(2, '20', '시음기', 'waiting')]), running: run('running'), runs: [run('running'), run('partial')], search: null, probe: null },
  horizon: { job: job(true, [boardRow(1, '137', '국내구입기', 'horizon'), boardRow(2, '20', '시음기', 'complete')]), running: null, runs: [run('partial')], search: null, probe: null },
  searchRunning: { job: job(true, [boardRow(1, '137', '국내구입기', 'horizon')]), running: null, runs: [run('succeeded')], search: { job: searchJob('구매'), running: true }, probe: null },
  allDone: { job: job(true, [boardRow(1, '137', '국내구입기', 'horizon')]), running: null, runs: [run('succeeded')], search: { job: searchJob(null), running: false }, probe: probeJob(9660) },
}
const s = SCENARIOS[STATE]
const collection = { kind: 'ready', status: { totals, job: s.job, running: s.running, recentRuns: s.runs, idGaps: gaps } }
const boardSearch = { kind: 'ready', view: { boards: [{ boardId: '137', name: '국내구입기' }, { boardId: '20', name: '시음기' }], running: s.search?.running ?? false, progress: s.search?.running ? { query: '구매', requestedPages: 12, maxPages: 60 } : null, blockFailure: null, job: s.search?.job ?? null } }
const articleProbe = { kind: 'ready', view: { running: false, progress: null, blockFailure: null, lastRun: null, job: s.probe, window: s.probe === null && s.search?.job?.current === null ? { kind: 'ready', fromDay: '20250101', toDay: '20250829' } : null } }
const schedule = { schedule: { enabled: true, startHour: 8, endHour: 24, workBlockMinutes: 60, restMinutes: 120 }, pacing: null, nextRunAtMs: now + 25 * 60_000, running: s.running !== null }

const FIXTURES = {
  getCollectionStatus: collection,
  getBoardSearchStatus: boardSearch,
  getArticleProbeStatus: articleProbe,
  getCollectionSchedule: schedule,
  startCollection: { kind: 'refused', reason: 'BRIDGE_OFFLINE' },
  startBoardSearch: { kind: 'refused', reason: 'BRIDGE_OFFLINE' },
  startArticleProbe: { kind: 'refused', reason: 'BRIDGE_OFFLINE' },
  previewBoardSearchJob: { kind: 'ready', toDay: '20250829', queryCount: 300 },
}
window.wm = new Proxy({}, { get: (_t, name) => async () => FIXTURES[name] ?? null })
```

If the app shell needs other fixtures to reach the collection screen (dashboard snapshot, common settings), add them from `src/desktop/ipc.ts` the same way; methods that resolve `null` must not crash the shell — if one does, add its fixture rather than changing app code.

- [ ] **Step 3: Serve it and look at the five states**

Run (background): `cd "$SCRATCH/preview" && python3 -m http.server 8765`

Then for each `state` in `fresh`, `listRunning`, `horizon`, `searchRunning`, `allDone`, open `http://localhost:8765/?state=<state>`, navigate to 게시판 수집 → 수집 현황, and check (per the user's rule, browse with `aside`: `aside exec "<task>"` or `aside repl` after `aside guide repl`):

| state | must see |
|---|---|
| fresh | 다음 할 일 `① 수집할 기간을 고르세요.` + `기간 고르기`; pressing it scrolls to ①'s unfolded `새 기간 수집`; ② and ③ dimmed `필요 없음` with their reasons |
| listRunning | 다음 할 일 `① 목록 수집이 돌고 있습니다…` + `중지`; ① badge 진행 중, progress bar, 게시판별 진행표 flat inside the step; `새 기간 수집` folded |
| horizon | `국내구입기 게시판은 목록으로 더 내려갈 수 없습니다…` + `보충 준비`; pressing it unfolds ② `새 보충 작업` with 국내구입기 selected and scrolls there; fold it, press again → unfolds and scrolls again (Review Focus 5) |
| searchRunning | ② 진행 중, `이번 차례 12 / 60쪽 · '구매'`, `아직 못 거둔 글 약 2,066건`; 자세히 holds the coverage sum and the query table; ① `이어서 수집` absent (job complete); ③ 필요 없음 |
| allDone | `할 일이 없습니다…`; ③ folded to `확인 완료 · 저장 1,625건`; unfold it, wait 5 s for polls → stays unfolded (Review Focus 4) |

Fold defaults are read on first draw only (spec 3.2), so load each state directly by URL — a step that finishes while you watch stays open, which is intended.

In `listRunning`, ①'s new-period form, when unfolded, says `수집이 도는 중입니다. 중지한 뒤에 기간을 바꾸세요.` (its own run), not `다른 수집이 도는 중입니다…`.

Also: in `fresh`, clear a date input → `이 기간 수집` is disabled and nothing throws (Review Focus 3); press `이 기간 수집` with dates set → `확장이 연결되어 있지 않습니다.` appears under the form.

- [ ] **Step 4: Both themes and a narrow window**

Repeat `horizon` and `allDone` with the browser in dark colour scheme, and at 375 px width: no horizontal page scroll, badge and button wrap under the title instead of overflowing, text stays readable in both themes.

- [ ] **Step 5: Final gate**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. Stop the http server. Nothing from the scratchpad is committed.

Report what was seen per state (screenshots to the user via SendUserFile if anything looks off), then hand the branch to the final review.
