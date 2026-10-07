# Collection Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run ① the list walk, ② the search backfill of every board the list could not finish, and ③ the article id probe of the whole period one after another without the operator, each step taking its period from ①, and give the search dictionary the longer words (`홈플러스` after `홈플`) the morpheme-matching search needs.

**Architecture:** A new desktop module `collectionPipeline` replaces the loop's three separate jobs (articles, boardSearch, articleProbe) with one. A pure function reads the stage off `feed_state` (three new timestamp columns record what is done per period); the pipeline makes the next search or probe job itself and, when a runner reports through a new `onBlockEnd` callback that its work ran out with budget left, starts the next stage with what is left. The dictionary gains a second greedy pass over words that extend a picked query. The renderer loses the forms and buttons that made jobs by hand and shows the pipeline's stage.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Electron main + React renderer, PostgreSQL via drizzle-orm / drizzle-kit, vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-collection-pipeline-design.md` — read it before any task. `§n` below refers to it.

## Global Constraints

- Times are computed in KST only: `kstDayKey`, `kstDayKeyRange` from `src/shared/kst.ts`; never `getHours()`/`toLocaleString` with a zone (project `CLAUDE.md`).
- Korean only, but every user-facing string lives in `src/shared/text.ts`; strings that take values are functions.
- Code and comments in English; comment density and voice match the surrounding file.
- No TODO comments, no placeholders, no `test.skip`/`.only`. Code a task makes unused is deleted in that task, with its tests.
- Commit messages `<type>: <description>`, **no AI attribution, no `Co-Authored-By`** (user `CLAUDE.md` overrides the harness).
- Never `git checkout <file>` / `git restore` / `git reset` / `git stash`. Never switch branches.
- The Edit/Write tools' hook points at a removed worktree on this machine; if Edit/Write is refused, make the change with a shell heredoc or `python3` instead.
- The production app is running. Never start Electron. Never write to `whisky_manager_collection` (read-only `select` is fine). Migrations are generated with `pnpm db:collection:generate`; the operator applies them by hand with the app quit.
- Integration tests run only against `whisky_manager_collection_test`: `COLLECTION_TEST_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection_test pnpm test:collection:integration`.
- Checks per task: `pnpm typecheck`, `pnpm test`, `npx eslint src tests scripts`.
- Board search limits: `BOARD_SEARCH_QUERY_LIMIT = 300`, `BOARD_SEARCH_MIN_GAIN = 5`, new `BOARD_SEARCH_EXTENSION_LIMIT = 300` (§4.1).
- Step ② window: `fromDay = kstDayKey(period.targetStartMs)`, `toDay` from `planBoardSearchJob` (the board's oldest stored post day). Step ③ window: `fromDay = kstDayKey(targetStartMs)`, `toDay = kstDayKey(targetEndMs)` (§3.2).
- The pipeline never runs ② while ① has an unsettled feed, and never ③ while a horizon board lacks `search_finished_at` (§3.1).

## Review Focus

1. **A finished period asked for again.** `replaceJob` makes fresh `feed_state` rows, so the three new columns start empty and the pipeline walks ②/③ again for the new period — Task 2's integration test pins that `replaceJob` leaves them null.
2. **Probe window overlapping an earlier probe.** Ids already answered in another window must not be re-inserted or re-read — Task 4 pins `createJob` on a window overlapping a finished one.
3. **A search job left from before the pipeline for another board or start day.** It is replaced, not adopted, and the job for the same board and start day is adopted with its progress kept — Task 7 pins both.
4. **Stop pressed between two stages of one block.** The chain must not start the next stage after `stop()` — Task 7 pins `stop()` during a block whose end would otherwise continue.
5. **A block that spends nothing.** A stage whose runner returns at once (job already done, nothing to read) must not loop — Task 7 pins the zero-request guard.

---

### Task 1: Extension words for the dictionary (sonnet)

**Files:**
- Modify: `src/shared/boardSearchDictionary.ts` (add `BOARD_SEARCH_EXTENSION_LIMIT`, `extendBoardSearchQueries`; fix the module comment's matching claim)
- Modify: `src/desktop/boardSearchPlan.ts:21` (append the extensions to the plan's queries)
- Test: `tests/shared/boardSearchDictionary.test.ts`, `tests/desktop/boardSearchPlan.test.ts`

**Interfaces:**
- Produces: `export const BOARD_SEARCH_EXTENSION_LIMIT = 300`; `export function extendBoardSearchQueries(titles: readonly string[], queries: readonly string[], options?: { readonly limit?: number; readonly minGain?: number }): readonly BoardSearchQuery[]`. `buildBoardSearchDictionary` is unchanged (picks only). `planBoardSearchJob(...).queries` becomes `[...picked, ...extendBoardSearchQueries(titles, picked.map((q) => q.query))]`.

- [ ] **Step 1: Write the failing tests** — append to `tests/shared/boardSearchDictionary.test.ts` (import `extendBoardSearchQueries` beside `buildBoardSearchDictionary`):

```ts
describe('extendBoardSearchQueries', () => {
  it('offers a longer word that starts with an asked query, since the search matches whole words', () => {
    // '홈플' does not find '월드컵 홈플러스' (measured 2026-09-26): '홈플러스' must be asked itself.
    const titles = ['월드컵 홈플러스', '홈플러스 득템', '동광주홈플', '홈플 오픈런']
    expect(extendBoardSearchQueries(titles, ['홈플'], { minGain: 1 })).toEqual([{ query: '홈플러스', expectedGain: 2 }])
  })

  it('counts only titles no asked query matches as a whole word', () => {
    // The second title has '홈플' itself, so asking '홈플' already finds it.
    const titles = ['홈플러스 득템', '홈플 홈플러스']
    expect(extendBoardSearchQueries(titles, ['홈플'], { minGain: 1 })).toEqual([{ query: '홈플러스', expectedGain: 1 }])
  })

  it('never offers an asked query, a word extending none, or a word whose every title is already found', () => {
    // '이마트24' extends '이마트', but its one title also holds '홈플' itself.
    const titles = ['홈플 이마트', '이마트24 홈플', 'x 오픈런']
    expect(extendBoardSearchQueries(titles, ['홈플', '이마트'], { minGain: 1 })).toEqual([])
  })

  it('picks greedily, a title counted once, and stops below the minimum gain and at the limit', () => {
    const titles = ['홈플러스 홈플런', '홈플러스', '홈플런', '홈플런 구매기', '구매기']
    expect(extendBoardSearchQueries(titles, ['홈플', '구매'], { minGain: 1 })).toEqual([
      { query: '홈플런', expectedGain: 3 },
      { query: '구매기', expectedGain: 1 },
      { query: '홈플러스', expectedGain: 1 },
    ])
    expect(extendBoardSearchQueries(titles, ['홈플', '구매'], { minGain: 2 })).toEqual([{ query: '홈플런', expectedGain: 3 }])
    expect(extendBoardSearchQueries(titles, ['홈플', '구매'], { minGain: 1, limit: 1 })).toEqual([{ query: '홈플런', expectedGain: 3 }])
  })

  it('breaks an equal gain by how many titles use the word, then by code-unit order', () => {
    // '홈플러스' and '홈플런' each catch one open title; '홈플러스' is used in two titles.
    const titles = ['홈플러스', '홈플런', '홈플 홈플러스']
    expect(extendBoardSearchQueries(titles, ['홈플'], { minGain: 1 }).map((entry) => entry.query)).toEqual(['홈플러스', '홈플런'])
  })

  it('defaults to the minimum gain of five', () => {
    const titles = Array.from({ length: 4 }, () => '홈플러스')
    expect(extendBoardSearchQueries(titles, ['홈플'])).toEqual([])
    expect(extendBoardSearchQueries([...titles, '홈플러스'], ['홈플'])).toEqual([{ query: '홈플러스', expectedGain: 5 }])
  })
})
```

Append inside `describe('planBoardSearchJob', ...)` of `tests/desktop/boardSearchPlan.test.ts` (it uses the file's own `repo` fake and `OLDEST`):

```ts
  it('appends the longer forms of the picked words after the picks', async () => {
    // '홈플' catches all eleven titles by prefix and is the only pick; the five
    // '홈플러스' titles have no '홈플' of their own, so the search needs '홈플러스'.
    const titles = [...Array.from({ length: 6 }, () => '홈플 득템'), ...Array.from({ length: 5 }, () => '월드컵 홈플러스')]
    const plan = await planBoardSearchJob(repo(titles, OLDEST), { boardId: '137', fromDay: '20250101' })
    expect(plan.kind === 'ready' ? plan.queries : null).toEqual([{ query: '홈플', expectedGain: 11 }, { query: '홈플러스', expectedGain: 5 }])
  })
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run tests/shared/boardSearchDictionary.test.ts tests/desktop/boardSearchPlan.test.ts`
Expected: FAIL — `extendBoardSearchQueries` is not exported; the plan test sees only `홈플`.

- [ ] **Step 3: Implement** — in `src/shared/boardSearchDictionary.ts`:

Replace the module comment's second paragraph claim "it catches a title when one of its words starts with the query — '구매' finds '구매했습니다', '글렌' finds '글렌알라키' (measured 2026-09-25)" with the measured model: the search matches the analyser's whole-word tokens; `'홈플'` finds `'동광주홈플'` but not `'월드컵 홈플러스'` (measured 2026-09-26), so a picked word does not stand for its longer forms, and `extendBoardSearchQueries` asks those forms themselves. Keep the rest of the comment.

Add below `BOARD_SEARCH_CANDIDATE_LIMIT`:

```ts
/** How many longer forms of the picked words a job may add after its picks. */
export const BOARD_SEARCH_EXTENSION_LIMIT = 300
```

Add after `buildBoardSearchDictionary`:

```ts
/** Whether `word` is longer than, and starts with, one of the asked queries. */
function extendsAsked(word: string, asked: ReadonlySet<string>): boolean {
  for (let length = MIN_WORD_LENGTH; length < word.length; length += 1) {
    if (asked.has(word.slice(0, length))) return true
  }
  return false
}

/**
 * The longer forms of the asked queries that are worth asking themselves.
 *
 * The search matches whole words, so '홈플' leaves '월드컵 홈플러스' behind. A
 * title an asked query matches as a whole word is already found; each pick is
 * the extending word written in the most titles that no asked query and no
 * earlier pick finds. Ties go as in `buildBoardSearchDictionary`.
 */
export function extendBoardSearchQueries(
  titles: readonly string[],
  queries: readonly string[],
  options: { readonly limit?: number; readonly minGain?: number } = {},
): readonly BoardSearchQuery[] {
  const limit = options.limit ?? BOARD_SEARCH_EXTENSION_LIMIT
  const minGain = options.minGain ?? BOARD_SEARCH_MIN_GAIN
  const asked = new Set(queries)
  const caught = new Map<string, number[]>()
  const uses = new Map<string, number>()
  titles.forEach((title, index) => {
    const words = new Set(titleWords(title))
    const found = [...words].some((word) => asked.has(word))
    for (const word of words) {
      if (asked.has(word) || !isBoardSearchQuery(word) || !extendsAsked(word, asked)) continue
      uses.set(word, (uses.get(word) ?? 0) + 1)
      if (found) continue
      const list = caught.get(word) ?? []
      list.push(index)
      caught.set(word, list)
    }
  })
  const covered = new Set<number>()
  const picked: BoardSearchQuery[] = []
  while (picked.length < limit) {
    let best: string | null = null
    let bestGain = 0
    for (const [word, list] of caught) {
      const gain = list.reduce((count, index) => (covered.has(index) ? count : count + 1), 0)
      const better =
        gain > bestGain ||
        (gain === bestGain &&
          best !== null &&
          ((uses.get(word) ?? 0) > (uses.get(best) ?? 0) || ((uses.get(word) ?? 0) === (uses.get(best) ?? 0) && compareCodeUnits(word, best) < 0)))
      if (better) {
        best = word
        bestGain = gain
      }
    }
    if (best === null || bestGain < minGain) break
    for (const index of caught.get(best) ?? []) covered.add(index)
    caught.delete(best)
    picked.push({ query: best, expectedGain: bestGain })
  }
  return picked
}
```

In `src/desktop/boardSearchPlan.ts` replace the two lines from `const queries = buildBoardSearchDictionary(...)` through the `NO_QUERIES` check with:

```ts
  const titles = await repository.readBoardTitles(input.boardId)
  const picked = buildBoardSearchDictionary(titles)
  if (picked.length === 0) return { kind: 'refused', reason: 'NO_QUERIES' }
  // The longer forms go last: the picks are the best order the stored titles
  // give, and the forms only catch what the whole-word match leaves.
  const queries = [...picked, ...extendBoardSearchQueries(titles, picked.map((entry) => entry.query))]
```

and import `extendBoardSearchQueries` beside `buildBoardSearchDictionary`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run tests/shared/boardSearchDictionary.test.ts tests/desktop/boardSearchPlan.test.ts` → PASS. Then `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/boardSearchDictionary.ts src/desktop/boardSearchPlan.ts tests/shared/boardSearchDictionary.test.ts tests/desktop/boardSearchPlan.test.ts
git commit -m "feat: ask the longer forms of picked search words after the picks"
```

---

### Task 2: Stage columns on feed_state (sonnet)

**Files:**
- Modify: `src/desktop/collection-db/schema.ts` (`feedState`: three columns after `horizonReachedAt`)
- Create: `drizzle-collection/0010_*.sql` and `drizzle-collection/meta/0010_snapshot.json`, `_journal.json` entry — generated, never hand-written
- Modify: `src/desktop/collection-db/repository.ts` (`CollectionFeedState` fields, `toFeedState`, three mark methods)
- Test: `tests/desktop/collection-db/integration.test.ts`, and every unit-test fake of `CollectionRepository` / `StoredFeedState` the typecheck names

**Interfaces:**
- Produces on `CollectionFeedState`: `readonly searchExtended: boolean`, `readonly searchFinished: boolean`, `readonly probeFinished: boolean`.
- Produces on `CollectionRepository`:
  - `markSearchExtended(boardId: string, at: Date): Promise<void>` — the `board` row of that menu.
  - `markSearchFinished(boardId: string, at: Date): Promise<void>` — the `board` row of that menu.
  - `markProbeFinished(at: Date): Promise<void>` — every row (the period's fact, like `setForced`).

- [ ] **Step 1: Write the failing integration test** — add after `'makes a board job with one row per board, most stored posts first, and replaces it whole'`:

```ts
  it('records the later steps per period, and a new period starts them over', async () => {
    const repository = createCollectionRepository(connection.db)
    const made = await repository.replaceJob({ scope: 'board', targetStartMs: 1_000, targetEndMs: 2_000, at: new Date(5_000) })
    const first = made[0]!.feed.menuId
    expect(made.every((row) => !row.searchExtended && !row.searchFinished && !row.probeFinished)).toBe(true)

    await repository.markSearchExtended(first, new Date(6_000))
    await repository.markSearchFinished(first, new Date(6_000))
    await repository.markProbeFinished(new Date(7_000))
    const marked = await repository.listFeedStates()
    expect(marked.find((row) => row.feed.menuId === first)).toMatchObject({ searchExtended: true, searchFinished: true, probeFinished: true })
    expect(marked.filter((row) => row.feed.menuId !== first).every((row) => !row.searchExtended && !row.searchFinished && row.probeFinished)).toBe(true)

    const again = await repository.replaceJob({ scope: 'board', targetStartMs: 1_000, targetEndMs: 3_000, at: new Date(8_000) })
    expect(again.every((row) => !row.searchExtended && !row.searchFinished && !row.probeFinished)).toBe(true)
  })
```

- [ ] **Step 2: Run it to see it fail**

Run: `COLLECTION_TEST_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection_test pnpm test:collection:integration`
Expected: FAIL (type errors / missing methods).

- [ ] **Step 3: Implement**

In `schema.ts`, after `horizonReachedAt`:

```ts
    /**
     * When the search job of this board's unreached part was given the longer
     * forms of its words. Once per job: asked every block, newly stored titles
     * would keep adding words.
     */
    searchExtendedAt: observedTimestamp('search_extended_at'),
    /** When the search backfill of this board's unreached part ran out, or had nothing to search. */
    searchFinishedAt: observedTimestamp('search_finished_at'),
    /** When every article id hole of the period was answered; written on every row of the job. */
    probeFinishedAt: observedTimestamp('probe_finished_at'),
```

Run `pnpm db:collection:generate`; confirm the new `0010_*.sql` holds exactly three `ALTER TABLE "feed_state" ADD COLUMN ... timestamp (3) with time zone;` statements and nothing else.

In `repository.ts`: add the three fields to `CollectionFeedState` with doc comments (`Whether ... Written, never inferred.` as the neighbours), map them in `toFeedState` (`searchExtended: row.searchExtendedAt !== null`, etc.), add the three methods to the interface (doc comments from the Interfaces block) and implement:

```ts
    async markSearchExtended(boardId, at) {
      await db.update(feedState).set({ searchExtendedAt: at }).where(and(eq(feedState.feedKind, 'board'), eq(feedState.menuId, boardId)))
    },

    async markSearchFinished(boardId, at) {
      await db.update(feedState).set({ searchFinishedAt: at }).where(and(eq(feedState.feedKind, 'board'), eq(feedState.menuId, boardId)))
    },

    async markProbeFinished(at) {
      await db.update(feedState).set({ probeFinishedAt: at })
    },
```

In `startRun`'s `reset` branch (`reset = !input.resumeFromCheckpoint && inserted.length === 0`: a fresh start on an existing row) also clear `searchExtendedAt: null, searchFinishedAt: null, probeFinishedAt: null` beside `horizonReachedAt: null` — a feed started afresh is a new period.

Run `pnpm typecheck`; add the three fields (`false`) and three methods (`vi.fn()` / no-op resolving `undefined`, matching each fake's style) to every fake it names.

- [ ] **Step 4: Run the tests to see them pass**

Integration command above → PASS; `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/collection-db/schema.ts src/desktop/collection-db/repository.ts drizzle-collection tests
git commit -m "feat: record per period which later collection steps are done"
```

---

### Task 3: Append extension words to an existing search job (sonnet)

**Files:**
- Modify: `src/desktop/collection-db/boardSearchRepository.ts` (`extendJob`)
- Test: `tests/desktop/collection-db/integration.test.ts`, fakes of `BoardSearchRepository`

**Interfaces:**
- Consumes: `BoardSearchQuery` from `src/shared/boardSearchDictionary.ts`.
- Produces on `BoardSearchRepository`: `extendJob(input: { readonly queries: readonly BoardSearchQuery[]; readonly at: Date }): Promise<number>` — appends the queries the job does not hold, in the given order, after its last `queue_order`, in the job's own board and window; returns how many it added. Throws when no job exists or a `board_search` run is `running`.

- [ ] **Step 1: Write the failing integration test** — after `'keeps a search job query by query, writing pages and completion atomically'`:

```ts
  it('appends words to the search job after its last, keeping every query\'s progress', async () => {
    const collection = createCollectionRepository(connection.db)
    const search = createBoardSearchRepository(connection.db, collection)
    const at = new Date('2026-10-07T00:00:00.000Z')
    await search.replaceJob({ boardId: '137', fromDay: '20240101', toDay: '20250101', at, queries: [{ query: '홈플', expectedGain: 9 }, { query: '구매', expectedGain: 6 }] })
    const runId = randomUUID()
    await search.startRun({ id: runId, boardId: '137', query: '홈플', fromDay: '20240101', toDay: '20250101', startedAt: at })
    await expect(search.extendJob({ at, queries: [{ query: '홈플러스', expectedGain: 5 }] })).rejects.toThrow()
    await search.finishRun(runId, 'succeeded', null, at)

    expect(await search.extendJob({ at, queries: [{ query: '홈플러스', expectedGain: 5 }, { query: '구매', expectedGain: 5 }, { query: '구매기', expectedGain: 5 }] })).toBe(2)
    expect(await search.extendJob({ at, queries: [{ query: '홈플러스', expectedGain: 5 }] })).toBe(0)
    expect((await search.listQueries()).map((q) => [q.queueOrder, q.query, q.complete, q.fromDay, q.toDay])).toEqual([
      [1, '홈플', true, '20240101', '20250101'],
      [2, '구매', false, '20240101', '20250101'],
      [3, '홈플러스', false, '20240101', '20250101'],
      [4, '구매기', false, '20240101', '20250101'],
    ])
  })
```

(If an earlier test left a `running` board_search run, this test's first `replaceJob` would throw; the earlier tests close theirs — if it throws, read why before changing anything.)

- [ ] **Step 2: Run it to see it fail** — integration command → FAIL (`extendJob` missing).

- [ ] **Step 3: Implement** — add to the interface after `replaceJob`, with the doc comment from the Interfaces block, and implement:

```ts
    async extendJob(input) {
      return await db.transaction(async (tx) => {
        const running = await tx
          .select({ id: collectionRuns.id })
          .from(collectionRuns)
          .where(and(eq(collectionRuns.feedKind, 'board_search'), eq(collectionRuns.status, 'running')))
          .limit(1)
        if (running.length > 0) throw new Error('cannot extend the search job while a run is writing its cursor')
        const rows = await tx.select().from(boardSearchState).orderBy(asc(boardSearchState.queueOrder))
        const last = rows.at(-1)
        if (last === undefined) throw new Error('there is no search job to extend')
        const held = new Set(rows.map((row) => row.query))
        const added = input.queries.filter((entry) => !held.has(entry.query))
        if (added.length === 0) return 0
        await tx.insert(boardSearchState).values(
          added.map((entry, index) => ({
            boardId: last.boardId,
            query: entry.query,
            fromDay: last.fromDay,
            toDay: last.toDay,
            queueOrder: last.queueOrder + index + 1,
            expectedGain: entry.expectedGain,
            updatedAt: input.at,
          })),
        )
        return added.length
      })
    },
```

Add `extendJob: vi.fn()` (or the fake's style) to each `BoardSearchRepository` fake `pnpm typecheck` names.

- [ ] **Step 4: Run the tests to see them pass** — integration → PASS; `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/collection-db/boardSearchRepository.ts tests
git commit -m "feat: append words to a search job without touching its progress"
```

---

### Task 4: A probe job per window (opus)

**Files:**
- Modify: `src/desktop/collection-db/articleProbeRepository.ts` (`readJob`, `createJob`, `nextWaitingId`; rename `CreateArticleProbeJobInput` → `ArticleProbeWindowDays`)
- Modify: `src/desktop/articleProbeRunner.ts` (`start` takes the window)
- Modify (keep today's behaviour until Task 8/9 replace them): `src/desktop/articleProbeJob.ts`, `src/desktop/articleProbeView.ts`, `src/desktop/rendererApi.ts` (`createArticleProbeJob`, `startArticleProbe`), `src/desktop/bootstrap.ts` (the probe job's deps)
- Test: `tests/desktop/collection-db/integration.test.ts`, `tests/desktop/articleProbeRunner.test.ts`, `tests/desktop/articleProbeJob.test.ts`, `tests/desktop/articleProbeView.test.ts`, `tests/desktop/rendererApi.test.ts`

**Interfaces:**
- Produces in `articleProbeRepository.ts`:
  - `export interface ArticleProbeWindowDays { readonly fromDay: string; readonly toDay: string }` (replaces `CreateArticleProbeJobInput` everywhere).
  - `readJob(window: ArticleProbeWindowDays): Promise<ArticleProbeJob | null>` — the rows with exactly this `window_from_day`/`window_to_day`.
  - `createJob(window: ArticleProbeWindowDays): Promise<number>` — throws while **any** id of any window waits (`outcome is null`); inserts the window's holes with `on conflict (post_id) do nothing`; returns how many it inserted.
  - `nextWaitingId(window: ArticleProbeWindowDays): Promise<string | null>` — the smallest waiting id of this window.
- Produces in `articleProbeRunner.ts`: `start(request: { readonly maxPages: number; readonly window: ArticleProbeWindowDays }): CollectionStartResult`.
- Until Task 8/9, every caller derives the window as today: `articleProbeWindow(await search.listQueries())` (`src/desktop/articleProbePlan.ts`); when it is not `ready`, there is no job.

- [ ] **Step 1: Write the failing tests**

In `integration.test.ts`:
- In `'makes the probe job once, ...'` rename to `'makes a probe job per window, from the id holes between the window\'s first and last stored post'`; define `const MARCH = { fromDay: '20190301', toDay: '20190401' }` at the top of the test and pass it to every `readJob`, `createJob`, `nextWaitingId` call. Keep the second `createJob` expectation (`rejects.toThrow()`): six ids still wait.
- In `'records each verdict once, ...'` pass the same window (`{ fromDay: '20190301', toDay: '20190401' }`) to `nextWaitingId` and `readJob`.
- Add after it:

```ts
  it('makes a later window\'s job once every id waits no more, skipping ids an earlier window answered', async () => {
    const probe = createArticleProbeRepository(connection.db, createCollectionRepository(connection.db))
    // March 2019's six ids are all answered above. A window that also spans
    // March finds the same holes there and must leave them as answered.
    const SPRING = { fromDay: '20190301', toDay: '20190501' }
    await pool.query(
      `insert into posts (post_id, board_id, posted_at, snapshot_at, first_seen_at) values ('5000013', 'probe-1', $1, $2, $2)`,
      [new Date('2019-04-10T12:00:00+09:00'), new Date('2026-10-07T00:00:00.000Z')],
    )
    // Stored now: 5000001..5000004 (5000002 by its verdict, 5000004 by the
    // other walk), 5000009, 5000010, 5000013. Holes: 5..8, answered above, and
    // 11, 12, which are new.
    expect(await probe.createJob(SPRING)).toBe(2)
    expect(await probe.readJob(SPRING)).toMatchObject({ total: 2, probed: 0 })
    expect(await probe.nextWaitingId(SPRING)).toBe('5000011')
    expect(await probe.nextWaitingId({ fromDay: '20190301', toDay: '20190401' })).toBeNull()
    // Two ids wait, so no further job may be made.
    await expect(probe.createJob({ fromDay: '20190101', toDay: '20190501' })).rejects.toThrow()
  })
```

(The verdict test stores 5000002 as a post and inserts 5000004; ids of the other tests' fixtures lie far below 5000001, so nothing else falls in the span.)

In `tests/desktop/articleProbeRunner.test.ts`:
- Add `const WINDOW = { fromDay: '20250101', toDay: '20250829' }` beside `NO_WAIT`; make every `runner.start({ maxPages: N })` read `runner.start({ maxPages: N, window: WINDOW })`.
- Make the fake record what it is asked: `readJob: async (window) => { asked.push(\`job ${window.fromDay}-${window.toDay}\`); return ... }` and the same for `nextWaitingId` (`ids ${...}`); return `asked` from the harness. Add:

```ts
  it('reads the job and the waiting ids of the window it was started on', async () => {
    const h = harness(['2'], { 2: DELETED })
    h.runner.start({ maxPages: 10, window: { fromDay: '20240101', toDay: '20250102' } })
    await h.settle()
    expect(new Set(h.asked)).toEqual(new Set(['job 20240101-20250102', 'ids 20240101-20250102']))
  })
```

In the job, view and renderer API tests: fakes of `readJob`/`nextWaitingId` take the window argument; `tests/desktop/articleProbeJob.test.ts` also needs a `search` fake whose `listQueries` returns the finished search job's rows; add to each one assertion that it was called with the search job's window (`{ fromDay: '20250101', toDay: '20250829' }` in their fixtures).

- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/desktop/articleProbeRunner.test.ts` and the integration command → FAIL.

- [ ] **Step 3: Implement**

`readJob(window)`: add `.where(and(eq(articleProbe.windowFromDay, window.fromDay), eq(articleProbe.windowToDay, window.toDay)))` before `.groupBy(...)`.

`nextWaitingId(window)`: `.where(and(isNull(articleProbe.outcome), eq(articleProbe.windowFromDay, window.fromDay), eq(articleProbe.windowToDay, window.toDay)))`.

`createJob(window)`: replace the existence check with

```ts
        const waiting = await tx.select({ postId: articleProbe.postId }).from(articleProbe).where(isNull(articleProbe.outcome)).limit(1)
        if (waiting.length > 0) throw new Error('an article probe job still has ids waiting; finish it before making another')
```

and end the insert with `on conflict (post_id) do nothing` (after the `where stored.next_id > stored.id + 1` line). Update the comment above it: an id an earlier window answered keeps its answer. Update the interface doc of `createJob`: "Refused while any id of any window waits; ids an earlier window answered are left as they are."

Runner: `walk(repository, maxPages, window)` passes `window` to `readJob` and to `walkIds`, which passes it to `nextWaitingId`. `start(request)` calls `walk(repository, request.maxPages, request.window)`.

Callers, keeping today's behaviour:
- `articleProbeJob.ts`: deps gain `readonly search: () => BoardSearchRepository | null`. `readProgress`: `const search = deps.search(); if (search === null) return { exists: false, complete: false, forced: false }`, then `articleProbeWindow(await search.listQueries())`; not ready → `{ exists: false, complete: false, forced: false }`; else keeps the window in a `let` and reads `readJob(window)` as before. `start(maxPages)` → refused `NO_JOB` when no window was kept, else `deps.runner.start({ maxPages, window })`. Wire `search` in `bootstrap.ts` as the other deps (`collection.kind === 'ready' ? collection.boardSearchRepository : null`).
- `articleProbeView.ts`: compute `window` first; `job = window.kind === 'ready' ? await repository.readJob(window) : null`; the view's `window` field stays `job === null ? window : null`.
- `rendererApi.ts` `createArticleProbeJob`: compute the window first (refusal as before), then `JOB_EXISTS` when `readJob(window)` is not null, then `createJob(window)`. `startArticleProbe`: window not ready → `NO_JOB`; `readJob(window)`; `start({ maxPages, window })`.

- [ ] **Step 4: Run the tests to see them pass** — unit + integration → PASS; `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/desktop tests
git commit -m "feat: make an article probe job per window, never reading an answered id again"
```

---

### Task 5: Each runner says how its block ended (opus)

**Files:**
- Create: `src/desktop/collectionBlockEnd.ts`
- Modify: `src/desktop/collectionRunner.ts`, `src/desktop/boardSearchRunner.ts`, `src/desktop/articleProbeRunner.ts`
- Test: `tests/desktop/collectionRunner.test.ts`, `tests/desktop/boardSearchRunner.test.ts`, `tests/desktop/articleProbeRunner.test.ts`

**Interfaces:**
- Produces `src/desktop/collectionBlockEnd.ts`:

```ts
/**
 * How a block ended, for whoever goes on with what it left. Said once per
 * block, after the lock is free, so the next walk can take it at once.
 */
export interface CollectionBlockEnd {
  /** Requests the block made. */
  readonly requests: number
  /**
   * `budget`: it spent what it was given. `drained`: its walk had nothing
   * left, with budget to spare. `stopped`: the operator asked. `failed`: a
   * failure ended it or left work behind it.
   */
  readonly endedBy: 'budget' | 'drained' | 'stopped' | 'failed'
}

export type OnCollectionBlockEnd = (end: CollectionBlockEnd) => void
```

- Each runner's start request gains `readonly onBlockEnd?: OnCollectionBlockEnd`: `CollectionStartRequest` (list), `{ maxPages; onBlockEnd? }` (search), `{ maxPages; window; onBlockEnd? }` (probe). It is called exactly once per started block, in the `finally` after `lock.release()`; never for a refused start.

The verdict, per runner, in this order (first that applies):

| Runner | `stopped` | `failed` | `budget` | `drained` |
|---|---|---|---|---|
| list | a stop was asked (`abortRequested`) | any feed result `failed` or `cas_conflict`, or the walk threw | requests ≥ `maxPages` | otherwise |
| search | a stop was asked | any query run closed `failed`, a run that could not start, or the walk threw | requests ≥ `maxPages` | otherwise |
| probe | a stop was asked (including `abortRequested` at `walk`'s early return, before any run) | the run closed `failed`, could not start, or the walk threw | the run closed `partial` `PAGE_BUDGET_SPENT` | otherwise (including no job / nothing waiting) |

- [ ] **Step 1: Write the failing tests**

`tests/desktop/collectionRunner.test.ts` — add inside `describe('collection runner over a queue of feeds', ...)`:

```ts
  it('says how each block ended, after it has let go of the lock', async () => {
    const ended = async (t: ReturnType<typeof transport>, maxPages: number) => {
      const { repo } = repository()
      const r = runner(repo, t.transport)
      return await new Promise<CollectionBlockEnd>((resolve) => {
        expect(r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages, feeds, resumeFromCheckpoint: true, onBlockEnd: (end) => {
          expect(r.isRunning()).toBe(false)
          resolve(end)
        } })).toEqual({ kind: 'started' })
      })
    }
    const pages = { '137': { 1: inPeriod('a') }, '189': { 1: inPeriod('b') }, '205': { 1: inPeriod('c') } }
    expect(await ended(transport(pages), 30)).toEqual({ requests: 9, endedBy: 'drained' })
    expect(await ended(transport(pages), 4)).toEqual({ requests: 4, endedBy: 'budget' })
    expect(await ended(transport({ '137': { 1: inPeriod('a') }, '205': { 1: inPeriod('c') } }, ['189']), 30)).toMatchObject({ endedBy: 'failed' })
  })
```

(The counts follow the two tests above it: nine requests for three tiny boards, four with a budget of four. If `isRunning()` is still true inside the callback, the call is not after the `finally`.)

`tests/desktop/boardSearchRunner.test.ts` — add:

```ts
  it('says how each block ended', async () => {
    const ended = (h: ReturnType<typeof harness>, maxPages: number) =>
      new Promise<CollectionBlockEnd>((resolve) => {
        h.runner.start({ maxPages, onBlockEnd: (end) => { expect(h.runner.isRunning()).toBe(false); resolve(end) } })
      })
    expect(await ended(harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1, 2], 3), page([3], 3)], 구매: [page([4], 1)] }), 10)).toEqual({ requests: 5, endedBy: 'drained' })
    expect(await ended(harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1], 9), page([2], 9), page([3], 9)] }), 2)).toEqual({ requests: 2, endedBy: 'budget' })
    expect(await ended(harness([query('글렌', 1), query('구매', 2)], { 구매: [page([4], 1)] }, { 글렌: 'BOARD_SEARCH_HTTP_ERROR' }), 10)).toEqual({ requests: 1, endedBy: 'failed' })
    let stop = (): void => undefined
    const stopped = harness([query('글렌', 1)], { 글렌: [page([1], 9), page([2], 9)] }, {}, () => stop())
    stop = () => stopped.runner.stop()
    expect(await ended(stopped, 10)).toMatchObject({ endedBy: 'stopped' })
  })
```

`tests/desktop/articleProbeRunner.test.ts` — add:

```ts
  it('says how each block ended', async () => {
    const ended = (h: ReturnType<typeof harness>, maxPages: number) =>
      new Promise<CollectionBlockEnd>((resolve) => {
        h.runner.start({ maxPages, window: WINDOW, onBlockEnd: (end) => { expect(h.runner.isRunning()).toBe(false); resolve(end) } })
      })
    expect(await ended(harness(['2', '3'], { 2: DELETED, 3: DELETED }), 10)).toEqual({ requests: 2, endedBy: 'drained' })
    expect(await ended(harness(['2', '3', '4'], { 2: DELETED, 3: DELETED, 4: DELETED }), 2)).toEqual({ requests: 2, endedBy: 'budget' })
    expect(await ended(harness(['2'], { 2: 'ARTICLE_HTTP_ERROR' }), 10)).toEqual({ requests: 1, endedBy: 'failed' })
    expect(await ended(harness([], {}, { noJob: true }), 10)).toEqual({ requests: 0, endedBy: 'drained' })
    let stop = (): void => undefined
    const stopped = harness(['2', '3'], { 2: DELETED, 3: DELETED }, { onRead: () => stop() })
    stop = () => stopped.runner.stop()
    expect(await ended(stopped, 10)).toMatchObject({ endedBy: 'stopped' })
  })
```

Import `type CollectionBlockEnd` from `../../src/desktop/collectionBlockEnd.js` in all three files.

- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/desktop/collectionRunner.test.ts tests/desktop/boardSearchRunner.test.ts tests/desktop/articleProbeRunner.test.ts` → FAIL (`onBlockEnd` never called / type error).

- [ ] **Step 3: Implement**

Create `src/desktop/collectionBlockEnd.ts` with the code in Interfaces.

`collectionRunner.ts`:
- `CollectionStartRequest` gains `readonly onBlockEnd?: OnCollectionBlockEnd` with the doc line "Told how the block ended, once, after the lock is free."
- `walk` returns its results as now; in `start`, keep `let end: CollectionBlockEnd = { requests: 0, endedBy: 'failed' }` and a `let spent = 0` that `walk` updates (make `walk` take a `report: (requests: number) => void` it calls after each feed with the running total). In `.then((results) => { end = blockEndOf(results, request.maxPages, abortRequested); deps.onFinished?.(results) })`, in `.catch` keep `end = { requests: spent, endedBy: abortRequested ? 'stopped' : 'failed' }`, and in `.finally` after `deps.lock.release()` call `request.onBlockEnd?.(end)`.
- Add, beside `walk`:

```ts
/** The block's verdict off its feeds' results; see `CollectionBlockEnd`. */
function blockEndOf(results: readonly CollectionRunResult[], maxPages: number, aborted: boolean): CollectionBlockEnd {
  const requests = results.reduce((sum, result) => sum + result.requests, 0)
  if (aborted || results.some((result) => result.kind === 'interrupted')) return { requests, endedBy: 'stopped' }
  if (results.some((result) => result.kind === 'failed' || result.kind === 'cas_conflict')) return { requests, endedBy: 'failed' }
  return { requests, endedBy: requests >= maxPages ? 'budget' : 'drained' }
}
```

(`aborted` is `abortRequested` at the end of the walk).

`boardSearchRunner.ts`:
- `QueryOutcome` gains `readonly failed: boolean`; `walkQuery` returns `failed: true` from the start-run failure and the non-abort catch, `false` elsewhere.
- `walk` returns `{ spent, failed }` (any outcome failed); `start` keeps `let end` like the list runner and resolves it in `.then` as `abortRequested ? 'stopped' : failed ? 'failed' : spent >= maxPages ? 'budget' : 'drained'`, in `.catch` as `stopped`/`failed` with the requests counted so far (keep a block-level `let spent` the walk updates), and calls `request.onBlockEnd?.(end)` after `lock.release()`.

`articleProbeRunner.ts`:
- `walkIds` returns `'drained' | 'budget'` (the two `finishRun` branches); `walk` returns a `CollectionBlockEnd` — no job or nothing waiting → `{ requests: 0, endedBy: 'drained' }`; start-run failure → `failed`; `ABORTED` → `stopped`; other catch → `failed`. Count requests in a block-level `let requested` (the existing `blockProgress.requested` is the same number; read it before it is cleared). `start` calls `request.onBlockEnd?.(end)` after `lock.release()`; the outer `.catch` sets `failed`.

- [ ] **Step 4: Run the tests to see them pass** — the three files → PASS; `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/collectionBlockEnd.ts src/desktop/collectionRunner.ts src/desktop/boardSearchRunner.ts src/desktop/articleProbeRunner.ts tests/desktop/collectionRunner.test.ts tests/desktop/boardSearchRunner.test.ts tests/desktop/articleProbeRunner.test.ts
git commit -m "feat: let each collection walk say how its block ended"
```

---

### Task 6: The stage, read off the job (sonnet)

**Files:**
- Create: `src/desktop/collectionPipelineStage.ts`
- Test: `tests/desktop/collectionPipelineStage.test.ts`

**Interfaces:**
- Consumes: `JobDescription` (`src/desktop/collectionScope.ts`), `StoredFeedState` with Task 2's `searchExtended`/`searchFinished`/`probeFinished`.
- Produces:

```ts
/** KST `yyyymmdd` days of the period; `toDay` is the exclusive end, the day after the last. */
export interface CollectionPeriodDays {
  readonly fromDay: string
  readonly toDay: string
}

export type CollectionPipelineStage =
  /** No period has been asked for. */
  | { readonly kind: 'idle' }
  | { readonly kind: 'list'; readonly period: CollectionPeriodDays }
  | {
      readonly kind: 'search'
      readonly period: CollectionPeriodDays
      readonly boardId: string
      readonly boardName: string | null
      /** 1-based, among the boards the list could not finish, in queue order. */
      readonly position: number
      readonly count: number
      readonly searchExtended: boolean
    }
  | { readonly kind: 'probe'; readonly period: CollectionPeriodDays }
  | { readonly kind: 'done'; readonly period: CollectionPeriodDays }

export function collectionPeriodDays(job: JobDescription): CollectionPeriodDays
export function collectionPipelineStage(job: JobDescription | null): CollectionPipelineStage
```

- [ ] **Step 1: Write the failing test** — `tests/desktop/collectionPipelineStage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { collectionPipelineStage } from '../../src/desktop/collectionPipelineStage.js'
import { describeJob } from '../../src/desktop/collectionScope.js'
import type { StoredFeedState } from '../../src/desktop/collection-db/repository.js'

// [2024-01-01, 2025-01-02) KST.
const START = Date.UTC(2023, 11, 31, 15)
const END = Date.UTC(2025, 0, 1, 15)
const PERIOD = { fromDay: '20240101', toDay: '20250102' }

function feed(menuId: string, queueOrder: number, facts: Partial<StoredFeedState> = {}): StoredFeedState {
  return {
    feed: { feedKind: 'board', menuId }, queueOrder, boardName: `게시판${menuId}`,
    stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null, cursorUpdatedAtMs: 0,
    targetStartMs: START, targetEndMs: END, complete: false, forced: false, horizonReached: false,
    searchExtended: false, searchFinished: false, probeFinished: false, ...facts,
  }
}
const stage = (...feeds: StoredFeedState[]) => collectionPipelineStage(describeJob(feeds))

describe('collectionPipelineStage', () => {
  it('is idle without a period', () => {
    expect(collectionPipelineStage(null)).toEqual({ kind: 'idle' })
  })

  it('walks the list while any board is neither finished nor beyond reach', () => {
    expect(stage(feed('188', 1, { horizonReached: true }), feed('137', 2))).toEqual({ kind: 'list', period: PERIOD })
  })

  it('searches the boards the list could not finish, one at a time in queue order, once the list is settled', () => {
    const feeds = [feed('189', 1, { complete: true }), feed('205', 2, { horizonReached: true }), feed('188', 3, { horizonReached: true, searchExtended: true })]
    expect(stage(...feeds)).toEqual({ kind: 'search', period: PERIOD, boardId: '205', boardName: '게시판205', position: 1, count: 2, searchExtended: false })
    expect(stage(feeds[0]!, { ...feeds[1]!, searchFinished: true }, feeds[2]!)).toEqual({
      kind: 'search', period: PERIOD, boardId: '188', boardName: '게시판188', position: 2, count: 2, searchExtended: true,
    })
  })

  it('probes the whole period once every such board is searched, and is done when the probe is', () => {
    const searched = [feed('189', 1, { complete: true }), feed('205', 2, { horizonReached: true, searchFinished: true })]
    expect(stage(...searched)).toEqual({ kind: 'probe', period: PERIOD })
    expect(stage(...searched.map((row) => ({ ...row, probeFinished: true })))).toEqual({ kind: 'done', period: PERIOD })
  })

  it('searches nothing for a whole-cafe job, which has no board to search', () => {
    const cafe = { ...feed('0', 1, { horizonReached: true }), feed: { feedKind: 'all_articles' as const, menuId: '0' }, queueOrder: null }
    expect(stage(cafe)).toEqual({ kind: 'probe', period: PERIOD })
  })
})
```

- [ ] **Step 2: Run it to see it fail** — `pnpm vitest run tests/desktop/collectionPipelineStage.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/desktop/collectionPipelineStage.ts`:

```ts
import { kstDayKey } from '../shared/kst.js'
import type { JobDescription } from './collectionScope.js'

// (the two types and their doc comments from the Interfaces block)

export function collectionPeriodDays(job: JobDescription): CollectionPeriodDays {
  return { fromDay: kstDayKey(job.targetStartMs), toDay: kstDayKey(job.targetEndMs) }
}

/**
 * Where a collection stands, in the order it goes: ① the list until every
 * board is finished or beyond reach, ② the search of each board the list
 * could not finish, ③ the article id holes of the whole period. Read off the
 * job's rows alone, so the loop, the pipeline and the screen cannot disagree.
 */
export function collectionPipelineStage(job: JobDescription | null): CollectionPipelineStage {
  if (job === null) return { kind: 'idle' }
  const period = collectionPeriodDays(job)
  if (!job.complete) return { kind: 'list', period }
  // Only a board list has a board to search; the whole-cafe list goes straight on.
  const beyondReach = job.feeds.filter((feed) => feed.feed.feedKind === 'board' && feed.horizonReached)
  const index = beyondReach.findIndex((feed) => !feed.searchFinished)
  const board = beyondReach[index]
  if (board !== undefined) {
    return {
      kind: 'search', period, boardId: board.feed.menuId, boardName: board.boardName,
      position: index + 1, count: beyondReach.length, searchExtended: board.searchExtended,
    }
  }
  return job.feeds.every((feed) => feed.probeFinished) ? { kind: 'done', period } : { kind: 'probe', period }
}
```

- [ ] **Step 4: Run it to see it pass** — the test → PASS; `pnpm typecheck && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/collectionPipelineStage.ts tests/desktop/collectionPipelineStage.test.ts
git commit -m "feat: read the collection's stage off its job"
```

---

### Task 7: The pipeline (opus)

**Files:**
- Create: `src/desktop/collectionPipeline.ts`
- Modify: `src/desktop/collectionRunner.ts` (`CollectionStartRefusal` gains `'STEP_FAILED'`), `src/shared/text.ts` (every `Record` over that union the typecheck names: `STEP_FAILED: '다음 단계를 준비하지 못했습니다. 최근 기록의 오류를 보세요.'`)
- Test: `tests/desktop/collectionPipeline.test.ts`

**Interfaces:**
- Consumes: Task 1 `extendBoardSearchQueries`; `planBoardSearchJob` (`src/desktop/boardSearchPlan.ts`); Task 2 marks; Task 3 `extendJob`; Task 4 windowed probe repository and `start({ maxPages, window, onBlockEnd })`; Task 5 `CollectionBlockEnd`; Task 6 stage.
- Produces:

```ts
export interface CollectionPipelineStores {
  readonly collection: CollectionRepository
  readonly boardSearch: BoardSearchRepository
  readonly articleProbe: ArticleProbeRepository
}

export interface CollectionPipelineDeps {
  readonly stores: () => CollectionPipelineStores | null
  readonly listRunner: CollectionRunner
  readonly searchRunner: BoardSearchRunner
  readonly probeRunner: ArticleProbeRunner
  readonly clock: CollectionClock
  readonly onError?: (error: unknown) => void
  /** A stage passed without a walk, and why, for the diagnostics log. */
  readonly onSkipped?: (message: string) => void
}

export interface CollectionPipelineStartRequest {
  readonly maxPages: number
  /** `backfill` when the operator pressed, `incremental` when the loop's beat started it. */
  readonly runKind: CollectionRunKind
}

export interface CollectionPipelineReading {
  readonly stage: CollectionPipelineStage
  /** The list's own "around the clock"; the search and the probe never run through the night. */
  readonly forced: boolean
}

export interface CollectionPipeline {
  /** Null without collection storage. Reads only; makes no job. */
  read(): Promise<CollectionPipelineReading | null>
  start(request: CollectionPipelineStartRequest): Promise<CollectionStartResult>
  /** Stops the walk in flight and ends the chain: nothing starts after it. */
  stop(): void
  /** From a start until its chain ends, including between two stages. */
  isRunning(): boolean
}

export function createCollectionPipeline(deps: CollectionPipelineDeps): CollectionPipeline
```

Behaviour (§3.3–§3.5):

1. `start`: refused `ALREADY_RUNNING` while `isRunning()` or any runner `isRunning()`; `NO_STORAGE` without stores. Otherwise mark the chain running, clear the stop flag, and run one stage with `budget = maxPages`.
2. Running one stage: `prepare` (below) the stage; any error from it → `onError`, chain ends, `STEP_FAILED`. `idle` → `NO_JOB`; `done` → `JOB_FINISHED`; both end the chain. Otherwise start the stage's runner with the budget and an `onBlockEnd`; a refusal from the runner ends the chain and is returned; `started` is returned.
   - list: `listRunner.start({ range: { startMs: job.targetStartMs, endMs: job.targetEndMs }, kind: runKind, maxPages: budget, feeds: job.remaining.map((row) => row.feed), resumeFromCheckpoint: true, onBlockEnd })`
   - search: `searchRunner.start({ maxPages: budget, onBlockEnd })`
   - probe: `probeRunner.start({ maxPages: budget, window: stage.period, onBlockEnd })`
3. `onBlockEnd(end)`: the chain goes on only when the stop flag is clear, `end.endedBy === 'drained'` and `budget - end.requests > 0`; then it runs one stage again with the rest. If the new stage has the same key (`kind` plus `boardId` for search) as the one that just ended and that block made no request, the chain ends instead. Any rejection here → `onError`, chain ends. The chain ending clears `isRunning()`.
4. `prepare(stores)` loops: read `describeJob(await collection.listFeedStates())` and its stage;
   - `search` → `ensureSearchJob`; if it says the board needs nothing, loop (the board is now marked);
   - `probe` → `ensureProbeJob`; if it says the period is done, loop;
   - else return the stage (with the job for `list`).
5. `ensureSearchJob(stage)` (`at = new Date(clock.now())`):
   - the job is **adopted** when `listQueries()[0]` has `boardId === stage.boardId` and `fromDay === stage.period.fromDay`;
   - not adopted → `planBoardSearchJob(boardSearch, { boardId, fromDay: stage.period.fromDay })`; refused → `onSkipped(\`search ${boardId}: ${reason}\`)`, `markSearchFinished(boardId, at)`, needs nothing; ready → `replaceJob({ ...plan, at })`, `markSearchExtended(boardId, at)` (its plan already holds the extensions);
   - adopted and `!stage.searchExtended` → `extendJob({ queries: extendBoardSearchQueries(await readBoardTitles(boardId), queries.map((q) => q.query)), at })`, `markSearchExtended(boardId, at)`;
   - then every query complete → `markSearchFinished(boardId, at)`, needs nothing; else the job is ready.
6. `ensureProbeJob(period)`: `readJob(period)`; null → `createJob(period)` (its throw propagates to `runStage`, which reports it through `onError` — the error's own text says another window's ids wait — and answers `STEP_FAILED`); 0 made → `markProbeFinished(at)`, done; a job whose `probed === total` → `markProbeFinished(at)`, done; else ready.
7. `read()`: stores null → null; else `{ stage: collectionPipelineStage(job), forced: stage.kind === 'list' && job.forced }`.

- [ ] **Step 1: Write the failing test** — `tests/desktop/collectionPipeline.test.ts`. The fakes record calls and hold the `onBlockEnd` each runner was given, so a test ends a block by hand:

```ts
import { describe, expect, it } from 'vitest'
import { createCollectionPipeline, type CollectionPipelineStores } from '../../src/desktop/collectionPipeline.js'
import type { CollectionBlockEnd, OnCollectionBlockEnd } from '../../src/desktop/collectionBlockEnd.js'
import type { CollectionRepository, StoredFeedState } from '../../src/desktop/collection-db/repository.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { ArticleProbeJob, ArticleProbeRepository } from '../../src/desktop/collection-db/articleProbeRepository.js'
import type { CollectionRunner } from '../../src/desktop/collectionRunner.js'
import type { BoardSearchRunner } from '../../src/desktop/boardSearchRunner.js'
import type { ArticleProbeRunner } from '../../src/desktop/articleProbeRunner.js'

const START = Date.UTC(2023, 11, 31, 15)
const END = Date.UTC(2025, 0, 1, 15)
const PERIOD = { fromDay: '20240101', toDay: '20250102' }

function feed(menuId: string, queueOrder: number, facts: Partial<StoredFeedState> = {}): StoredFeedState {
  return {
    feed: { feedKind: 'board', menuId }, queueOrder, boardName: null,
    stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null, cursorUpdatedAtMs: 0,
    targetStartMs: START, targetEndMs: END, complete: false, forced: false, horizonReached: false,
    searchExtended: false, searchFinished: false, probeFinished: false, ...facts,
  }
}

function query(boardId: string, q: string, order: number, complete = false, fromDay = '20240101'): BoardSearchQueryState {
  return { boardId, query: q, fromDay, toDay: '20240301', segmentToDay: null, queueOrder: order, expectedGain: 5, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, lastRunId: null }
}

function harness(setup: { feeds: StoredFeedState[]; queries?: BoardSearchQueryState[]; probe?: ArticleProbeJob | null; made?: number; titles?: string[]; failRead?: boolean }) {
  const calls: string[] = []
  let feeds = setup.feeds
  let queries = setup.queries ?? []
  let probe = setup.probe ?? null
  const mark = (menuId: string | null, facts: Partial<StoredFeedState>) => {
    feeds = feeds.map((row) => (menuId === null || row.feed.menuId === menuId ? { ...row, ...facts } : row))
  }
  const collection = {
    listFeedStates: async () => {
      if (setup.failRead === true) throw new Error('database went away')
      return feeds
    },
    markSearchExtended: async (boardId: string) => { calls.push(`extended ${boardId}`); mark(boardId, { searchExtended: true }) },
    markSearchFinished: async (boardId: string) => { calls.push(`searched ${boardId}`); mark(boardId, { searchFinished: true }) },
    markProbeFinished: async () => { calls.push('probed'); mark(null, { probeFinished: true }) },
  } as unknown as CollectionRepository
  const boardSearch = {
    listQueries: async () => queries,
    readBoardTitles: async () => setup.titles ?? [],
    oldestPostedAtMs: async () => Date.UTC(2024, 2, 1, 3),
    replaceJob: async (input: { boardId: string; fromDay: string; queries: { query: string }[] }) => {
      calls.push(`replace ${input.boardId} ${input.fromDay} ${input.queries.map((q) => q.query).join(',')}`)
      queries = input.queries.map((q, index) => query(input.boardId, q.query, index + 1, false, input.fromDay))
    },
    extendJob: async (input: { queries: { query: string }[] }) => { calls.push(`extend ${input.queries.map((q) => q.query).join(',')}`); return input.queries.length },
  } as unknown as BoardSearchRepository
  const articleProbe = {
    readJob: async () => probe,
    createJob: async (window: { fromDay: string; toDay: string }) => {
      calls.push(`create ${window.fromDay}-${window.toDay}`)
      const made = setup.made ?? 3
      if (made > 0) probe = { fromDay: window.fromDay, toDay: window.toDay, total: made, probed: 0, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 }
      return made
    },
  } as unknown as ArticleProbeRepository
  const ends: { list?: OnCollectionBlockEnd; search?: OnCollectionBlockEnd; probe?: OnCollectionBlockEnd } = {}
  let running = false
  const runner = (name: 'list' | 'search' | 'probe') => ({
    start: (request: { maxPages: number; onBlockEnd?: OnCollectionBlockEnd; window?: { fromDay: string; toDay: string }; feeds?: { menuId: string }[] }) => {
      calls.push(`${name} ${request.maxPages}${request.window ? ` ${request.window.fromDay}-${request.window.toDay}` : ''}${request.feeds ? ` ${request.feeds.map((f) => f.menuId).join(',')}` : ''}`)
      ends[name] = request.onBlockEnd
      running = true
      return { kind: 'started' as const }
    },
    stop: () => { calls.push(`stop ${name}`) },
    isRunning: () => running,
  })
  const errors: unknown[] = []
  const pipeline = createCollectionPipeline({
    stores: () => ({ collection, boardSearch, articleProbe }) satisfies CollectionPipelineStores,
    listRunner: runner('list') as unknown as CollectionRunner,
    searchRunner: runner('search') as unknown as BoardSearchRunner,
    probeRunner: runner('probe') as unknown as ArticleProbeRunner,
    clock: { now: () => 0 },
    onError: (error) => errors.push(error),
    onSkipped: (message) => calls.push(`skipped ${message}`),
  })
  /** Ends the named runner's block as the runner would: lock released, then told. */
  const end = async (name: 'list' | 'search' | 'probe', blockEnd: CollectionBlockEnd, then: Partial<{ feeds: StoredFeedState[]; queries: BoardSearchQueryState[]; probe: ArticleProbeJob | null }> = {}) => {
    feeds = then.feeds ?? feeds
    queries = then.queries ?? queries
    probe = then.probe === undefined ? probe : then.probe
    running = false
    ends[name]?.(blockEnd)
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { pipeline, calls, errors, end }
}

describe('collectionPipeline', () => {
  it('walks the list first, with the rest of its feeds', async () => {
    const h = harness({ feeds: [feed('189', 1, { complete: true }), feed('137', 2)] })
    expect(await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })).toEqual({ kind: 'started' })
    expect(h.calls).toEqual(['list 100 137'])
    expect(h.pipeline.isRunning()).toBe(true)
  })

  it('goes from the list to the search of a board it could not finish in the same block, with what is left', async () => {
    const h = harness({ feeds: [feed('137', 1)], titles: Array.from({ length: 6 }, () => '홈플') })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    await h.end('list', { requests: 40, endedBy: 'drained' }, { feeds: [feed('137', 1, { horizonReached: true })] })
    expect(h.calls).toEqual(['list 100 137', 'replace 137 20240101 홈플', 'extended 137', 'search 60'])
  })

  it('adopts the search job of the same board and start day, keeping its progress and giving it the longer words once', async () => {
    const h = harness({
      feeds: [feed('137', 1, { horizonReached: true })],
      queries: [query('137', '홈플', 1, true), query('137', '구매', 2)],
      titles: ['월드컵 홈플러스', '홈플러스', '홈플러스', '홈플러스', '홈플러스'],
    })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['extend 홈플러스', 'extended 137', 'search 50'])
  })

  it('replaces a search job left for another board or another start day', async () => {
    const h = harness({ feeds: [feed('205', 1, { horizonReached: true })], queries: [query('137', '홈플', 1, false, '20250101')], titles: Array.from({ length: 5 }, () => '득템') })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['replace 205 20240101 득템', 'extended 205', 'search 50'])
  })

  it('marks a board with nothing to search and goes on to the next', async () => {
    // No titles: the plan refuses with NO_QUERIES.
    const h = harness({ feeds: [feed('205', 1, { horizonReached: true }), feed('188', 2, { horizonReached: true, searchFinished: true })] })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['skipped search 205: NO_QUERIES', 'searched 205', 'create 20240101-20250102', 'probe 50 20240101-20250102'])
  })

  it('marks a finished search and makes the probe of the whole period', async () => {
    const h = harness({ feeds: [feed('137', 1, { horizonReached: true, searchExtended: true })], queries: [query('137', '홈플', 1, true)] })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['searched 137', 'create 20240101-20250102', 'probe 50 20240101-20250102'])
  })

  it('is done when the period has no hole left, and refuses to start', async () => {
    const h = harness({ feeds: [feed('189', 1, { complete: true })], made: 0 })
    expect(await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })).toEqual({ kind: 'refused', reason: 'JOB_FINISHED' })
    expect(h.calls).toEqual(['create 20240101-20250102', 'probed'])
    expect(h.pipeline.isRunning()).toBe(false)
  })

  it('ends the chain when a block spent its budget, failed or was stopped', async () => {
    for (const endedBy of ['budget', 'failed', 'stopped'] as const) {
      const h = harness({ feeds: [feed('137', 1)] })
      await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
      await h.end('list', { requests: 10, endedBy }, { feeds: [feed('137', 1, { horizonReached: true })] })
      expect(h.calls).toEqual(['list 100 137'])
      expect(h.pipeline.isRunning()).toBe(false)
    }
  })

  it('starts nothing after a stop, even when the block ends with budget to spare', async () => {
    const h = harness({ feeds: [feed('137', 1)] })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    h.pipeline.stop()
    await h.end('list', { requests: 10, endedBy: 'drained' }, { feeds: [feed('137', 1, { horizonReached: true })] })
    expect(h.calls).toEqual(['list 100 137', 'stop list', 'stop search', 'stop probe'])
    expect(h.pipeline.isRunning()).toBe(false)
  })

  it('does not go round again on a stage whose block read nothing', async () => {
    const h = harness({ feeds: [feed('137', 1)] })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    await h.end('list', { requests: 0, endedBy: 'drained' })
    expect(h.calls).toEqual(['list 100 137'])
    expect(h.pipeline.isRunning()).toBe(false)
  })

  it('refuses while running, and says when it cannot prepare a stage', async () => {
    const h = harness({ feeds: [feed('137', 1)] })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    expect(await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })

    expect(await harness({ feeds: [] }).pipeline.start({ maxPages: 1, runKind: 'backfill' })).toEqual({ kind: 'refused', reason: 'NO_JOB' })

    const broken = harness({ feeds: [], failRead: true })
    expect(await broken.pipeline.start({ maxPages: 1, runKind: 'backfill' })).toEqual({ kind: 'refused', reason: 'STEP_FAILED' })
    expect(broken.errors).toHaveLength(1)
    expect(broken.pipeline.isRunning()).toBe(false)
  })

  it('reads the stage, and the list\'s around-the-clock flag only while the list walks', async () => {
    expect(await harness({ feeds: [feed('137', 1, { forced: true })] }).pipeline.read()).toEqual({ stage: { kind: 'list', period: PERIOD }, forced: true })
    expect(await harness({ feeds: [feed('137', 1, { complete: true, forced: true })] }).pipeline.read()).toEqual({ stage: { kind: 'probe', period: PERIOD }, forced: false })
  })
})
```

The dictionary results these expectations rest on: five `'득템'` titles pick `득템` (gain 5); `extendBoardSearchQueries` over five titles holding `홈플러스` and none holding `홈플` gives `[홈플러스]` (gain 5); no titles give no picks, so the plan refuses `NO_QUERIES`.

- [ ] **Step 2: Run it to see it fail** — `pnpm vitest run tests/desktop/collectionPipeline.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/desktop/collectionPipeline.ts`, following Behaviour 1–7 above. Shape:

```ts
type PreparedStage =
  | { readonly stage: Extract<CollectionPipelineStage, { kind: 'list' }>; readonly job: JobDescription }
  | { readonly stage: Exclude<CollectionPipelineStage, { kind: 'list' }>; readonly job: JobDescription | null }

const stageKey = (stage: CollectionPipelineStage): string => (stage.kind === 'search' ? `search:${stage.boardId}` : stage.kind)

export function createCollectionPipeline(deps: CollectionPipelineDeps): CollectionPipeline {
  let chainRunning = false
  let stopRequested = false
  const at = () => new Date(deps.clock.now())
  const anyRunnerRunning = () => deps.listRunner.isRunning() || deps.searchRunner.isRunning() || deps.probeRunner.isRunning()

  async function ensureSearchJob(stores: CollectionPipelineStores, stage: Extract<CollectionPipelineStage, { kind: 'search' }>): Promise<boolean> { /* Behaviour 5; true = ready */ }
  async function ensureProbeJob(stores: CollectionPipelineStores, period: CollectionPeriodDays): Promise<boolean> { /* Behaviour 6; true = ready */ }
  async function prepare(stores: CollectionPipelineStores): Promise<PreparedStage> { /* Behaviour 4 */ }

  async function runStage(stores: CollectionPipelineStores, request: CollectionPipelineStartRequest, budget: number, previous: { readonly key: string; readonly requests: number } | null): Promise<CollectionStartResult> {
    let prepared: PreparedStage
    try {
      prepared = await prepare(stores)
    } catch (error) {
      deps.onError?.(error)
      chainRunning = false
      return { kind: 'refused', reason: 'STEP_FAILED' }
    }
    const { stage } = prepared
    if (stopRequested || (previous !== null && previous.requests === 0 && previous.key === stageKey(stage))) {
      chainRunning = false
      return { kind: 'refused', reason: 'JOB_FINISHED' }
    }
    if (stage.kind === 'idle' || stage.kind === 'done') {
      chainRunning = false
      return { kind: 'refused', reason: stage.kind === 'idle' ? 'NO_JOB' : 'JOB_FINISHED' }
    }
    const onBlockEnd = (end: CollectionBlockEnd): void => {
      const left = budget - end.requests
      if (stopRequested || end.endedBy !== 'drained' || left <= 0) {
        chainRunning = false
        return
      }
      runStage(stores, request, left, { key: stageKey(stage), requests: end.requests })
        .then((result) => {
          // A refusal here has no one pressing to be told: a member walk the
          // loop started meanwhile, or the extension gone.
          if (result.kind === 'refused' && result.reason !== 'JOB_FINISHED') deps.onSkipped?.(`after ${stageKey(stage)}: next stage refused ${result.reason}`)
        })
        .catch((error: unknown) => {
          deps.onError?.(error)
          chainRunning = false
        })
    }
    const started = /* start the stage's runner as Behaviour 2 lists */
    if (started.kind !== 'started') chainRunning = false
    return started
  }

  return {
    async read() { /* Behaviour 7 */ },
    async start(request) {
      if (chainRunning || anyRunnerRunning()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      const stores = deps.stores()
      if (stores === null) return { kind: 'refused', reason: 'NO_STORAGE' }
      chainRunning = true
      stopRequested = false
      return await runStage(stores, request, request.maxPages, null)
    },
    stop() {
      stopRequested = true
      deps.listRunner.stop()
      deps.searchRunner.stop()
      deps.probeRunner.stop()
    },
    isRunning() {
      return chainRunning || anyRunnerRunning()
    },
  }
}
```

Give the module a doc comment saying what it owns (the order of the three walks, and making the second and third walk's jobs) and what it does not (how any walk reads; the loop's timing). Add `'STEP_FAILED'` to `CollectionStartRefusal` with the doc line "The pipeline could not make or read the next step's job; the reason is in the diagnostics log." and give it the Korean line in every `Record` the typecheck names.

- [ ] **Step 4: Run it to see it pass** — the test → PASS; `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/collectionPipeline.ts src/desktop/collectionRunner.ts src/shared/text.ts tests/desktop/collectionPipeline.test.ts
git commit -m "feat: chain the list walk, the search backfill and the article probe"
```

---

### Task 8: The loop takes the pipeline as one job (sonnet)

**Files:**
- Create: `src/desktop/collectionPipelineJob.ts`
- Modify: `src/desktop/collectionJob.ts` (job names; `start` may be async; delete `createArticleCollectionJob`)
- Modify: `src/desktop/collectionLoop.ts:142` (`await` the start; the `attempted.kind === 'started'` check after it stays)
- Modify: `src/desktop/bootstrap.ts` (make the pipeline; loop jobs; `AppContext.collectionPipeline`; shutdown)
- Delete: `src/desktop/boardSearchJob.ts`, `src/desktop/articleProbeJob.ts`, `tests/desktop/boardSearchJob.test.ts`, `tests/desktop/articleProbeJob.test.ts`, the `createArticleCollectionJob` describes in `tests/desktop/collectionJob.test.ts`
- Test: `tests/desktop/collectionPipelineJob.test.ts`, `tests/desktop/collectionLoop.test.ts`, `tests/desktop/bootstrap.test.ts` (whatever it asserts about the jobs list)

**Interfaces:**
- Consumes: Task 7 `CollectionPipeline`.
- Produces:
  - `CollectionJob.name: 'pipeline' | 'members' | 'memberResync'`; `CollectionJob.start(maxPages: number): CollectionStartResult | Promise<CollectionStartResult>`.
  - `export function createCollectionPipelineJob(deps: { readonly pipeline: CollectionPipeline }): CollectionJob`
  - `AppContext.collectionPipeline: CollectionPipeline` (Task 9's renderer API reads it).

- [ ] **Step 1: Write the failing tests**

`tests/desktop/collectionPipelineJob.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createCollectionPipelineJob } from '../../src/desktop/collectionPipelineJob.js'
import type { CollectionPipeline, CollectionPipelineReading } from '../../src/desktop/collectionPipeline.js'

const PERIOD = { fromDay: '20240101', toDay: '20250102' }

function pipeline(reading: CollectionPipelineReading | null, starts: unknown[] = []): CollectionPipeline {
  return {
    read: async () => reading,
    start: async (request) => { starts.push(request); return { kind: 'started' } },
    stop: () => undefined,
    isRunning: () => false,
  }
}

describe('createCollectionPipelineJob', () => {
  it('exists from a period on, and is complete when the probe is done', async () => {
    expect(await createCollectionPipelineJob({ pipeline: pipeline(null) }).readProgress()).toEqual({ exists: false, complete: false, forced: false })
    expect(await createCollectionPipelineJob({ pipeline: pipeline({ stage: { kind: 'idle' }, forced: false }) }).readProgress()).toEqual({ exists: false, complete: false, forced: false })
    expect(await createCollectionPipelineJob({ pipeline: pipeline({ stage: { kind: 'list', period: PERIOD }, forced: true }) }).readProgress()).toEqual({ exists: true, complete: false, forced: true })
    expect(await createCollectionPipelineJob({ pipeline: pipeline({ stage: { kind: 'probe', period: PERIOD }, forced: false }) }).readProgress()).toEqual({ exists: true, complete: false, forced: false })
    expect(await createCollectionPipelineJob({ pipeline: pipeline({ stage: { kind: 'done', period: PERIOD }, forced: false }) }).readProgress()).toEqual({ exists: true, complete: true, forced: false })
  })

  it('starts a scheduled block as an incremental one', async () => {
    const starts: unknown[] = []
    expect(await createCollectionPipelineJob({ pipeline: pipeline(null, starts) }).start(120)).toEqual({ kind: 'started' })
    expect(starts).toEqual([{ maxPages: 120, runKind: 'incremental' }])
  })
})
```

`tests/desktop/collectionLoop.test.ts`: its `FakeJobSpec.name` is `'articles' | 'members'` and four assertions filter on `'articles'`; rename `'articles'` → `'pipeline'` in the type, every spec and those assertions. Then add a case where a fake job's `start` returns a `Promise` resolving `{ kind: 'started' }` and assert the next beat is laid at `work + rest` as the synchronous case is (copy the nearest existing "started" case and make its `start` async).

- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/desktop/collectionPipelineJob.test.ts tests/desktop/collectionLoop.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/desktop/collectionPipelineJob.ts`:

```ts
import type { CollectionJob } from './collectionJob.js'
import type { CollectionPipeline } from './collectionPipeline.js'

/**
 * The list walk, the search backfill and the article probe as the one job the
 * loop takes turns with: which of the three a block walks is the pipeline's
 * to say, and a block that finishes one goes on to the next.
 */
export function createCollectionPipelineJob(deps: { readonly pipeline: CollectionPipeline }): CollectionJob {
  return {
    name: 'pipeline',
    async readProgress() {
      const reading = await deps.pipeline.read()
      if (reading === null || reading.stage.kind === 'idle') return { exists: false, complete: false, forced: false }
      return { exists: true, complete: reading.stage.kind === 'done', forced: reading.forced }
    },
    start(maxPages) {
      return deps.pipeline.start({ maxPages, runKind: 'incremental' })
    },
  }
}
```

`collectionJob.ts`: name union and `start` return type as in Interfaces; update the interface comment ("round-robin over the collection pipeline and the member walks"); delete `createArticleCollectionJob` and the now-unused imports (`describeJob`, `JobDescription`, `CollectionRepository`, `CollectionRunner`).

`collectionLoop.ts`: `attempted = await next.job.start(maxPages)`.

`bootstrap.ts`:
- After `articleProbeRunner`, make

```ts
  // The three article walks go one after another: the list, then the search of
  // each board it could not finish, then the period's id holes.
  const collectionPipeline = createCollectionPipeline({
    stores: () => (collection.kind === 'ready'
      ? { collection: collection.repository, boardSearch: collection.boardSearchRepository, articleProbe: collection.articleProbeRepository }
      : null),
    listRunner: collectionRunner,
    searchRunner: boardSearchRunner,
    probeRunner: articleProbeRunner,
    clock: systemClock,
    onError: (error) => diagnostics.error('collection-pipeline', error),
    onSkipped: (message) => diagnostics.warn('collection-pipeline', message),
  })
```

- `jobs: () => [createCollectionPipelineJob({ pipeline: collectionPipeline }), createMemberCollectionJob(...), createMemberResyncJob(...)]` — the pipeline first, where the article job was; drop the three old entries and their imports.
- `AppContext` gains `readonly collectionPipeline: CollectionPipeline` (doc: "The article walks in order; the renderer starts and stops collection through it.") and the context object returns it.
- Shutdown: replace `collectionRunner.stop()`, `boardSearchRunner.stop()`, `articleProbeRunner.stop()` with `collectionPipeline.stop()` (it stops all three), keeping the comment above.

Delete the four files and the describes listed under Files.

- [ ] **Step 4: Run the tests to see them pass** — `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add -A src/desktop tests/desktop
git commit -m "feat: let the collection loop walk the article steps as one pipeline"
```

---

### Task 9: The renderer API goes through the pipeline (sonnet)

**Files:**
- Modify: `src/desktop/rendererApi.ts`, `src/desktop/ipc.ts`, `src/desktop/main.ts` (the `collectionPipeline` dep only). `preload.ts` and `main.ts` register handlers by iterating `IPC_CHANNELS`, so removing the channels from `ipc.ts` is the whole channel change there.
- Modify: `src/desktop/articleProbeView.ts` (window from the stage; drop `window` field)
- Delete: `src/desktop/articleProbePlan.ts`, `tests/desktop/articleProbePlan.test.ts`
- Test: `tests/desktop/rendererApi.test.ts`, `tests/desktop/articleProbeView.test.ts`

**Interfaces:**
- Consumes: `AppContext.collectionPipeline`; Task 6 stage.
- Produces:
  - `CollectionStatusView` ready: `{ readonly kind: 'ready'; readonly status: CollectionStatus; readonly pipeline: CollectionPipelineStage }`.
  - `ArticleProbeView` without `window`; `readArticleProbeView({ repository, period: CollectionPeriodDays | null, running, progress, blockFailure })` — `job = period === null ? null : await repository.readJob(period)`.
  - Removed IPC (channel, `RendererApi` method, preload entry, main handler, types): `previewBoardSearchJob`, `createBoardSearchJob`, `startBoardSearch`, `stopBoardSearch`, `createArticleProbeJob`, `startArticleProbe`, `stopArticleProbe`; types `BoardSearchPlanRefusal`, `BoardSearchPlanView`, `ArticleProbeCreateRefusal`, `ArticleProbeCreateView`.
  - Kept: `startCollection(request?)`, `stopCollection()`, `getBoardSearchStatus()`, `getArticleProbeStatus()`. Deliberate departure from spec §6's single `wm:startCollectionPipeline`: the existing `startCollection`/`stopCollection` channels become the pipeline's start and stop, so the dashboard's collection buttons follow without change.

- [ ] **Step 1: Write the failing tests** — in `tests/desktop/rendererApi.test.ts`:

1. Delete the cases for the seven removed methods, and drop their channels from the `IPC_CHANNELS` coverage test's expected list. Drop the `CollectionOverrides` fields only those cases used (`searchQueries`; keep `boardSearchBusy`/`articleProbeBusy`/`articleProbeJob` if the status cases still read them).
2. Add to `CollectionOverrides`:

```ts
  /** The stage the pipeline reads; by default idle without a job, done when the job's list is complete, else the list. */
  readonly pipelineStage?: CollectionPipelineStage
  /** Whether the pipeline has a chain in flight. */
  readonly pipelineBusy?: boolean
```

3. In `build`, beside `started`, add a fake pipeline and pass it as `collectionPipeline`:

```ts
  /** Every pipeline start the api asked for, and every stop. */
  const pipelineStarts: CollectionPipelineStartRequest[] = []
  const pipelineStops = { count: 0 }
  const pipelineStage = (): CollectionPipelineStage => {
    if (collection.pipelineStage !== undefined) return collection.pipelineStage
    const job = collection.job ?? null
    if (job === null) return { kind: 'idle' }
    const period = { fromDay: kstDayKey(job.targetStartMs), toDay: kstDayKey(job.targetEndMs) }
    return job.complete ? { kind: 'done', period } : { kind: 'list', period }
  }
  const collectionPipeline: CollectionPipeline = {
    read: async () => (collection.job === undefined ? null : { stage: pipelineStage(), forced: false }),
    start: async (request) => {
      pipelineStarts.push(request)
      // After a replace a real pipeline reads the new period's list.
      if (replaced.length > 0) return { kind: 'started' }
      const kind = pipelineStage().kind
      if (kind === 'idle') return { kind: 'refused', reason: 'NO_JOB' }
      if (kind === 'done') return { kind: 'refused', reason: 'JOB_FINISHED' }
      return { kind: 'started' }
    },
    stop: () => { pipelineStops.count += 1 },
    isRunning: () => collection.pipelineBusy === true,
  }
```

and return `pipelineStarts`, `pipelineStops` from `build`. (The fake reads `collection.job`, which a replace does not change, so a case that replaces asserts on `replaced` and `pipelineStarts`, never on the stage after.)

4. Rewrite `describe('asking for a period while a job is unfinished', ...)` against the pipeline. Its `job(...)` helper stays. Each case, by name:

```ts
  it('carries on with the period already under way', async () => {
    const { api, replaced, pipelineStarts } = build(MON_10_00, {}, { job: job() })
    expect(await api.startCollection({ firstDayMs, lastDayMs, scope: 'all_articles' })).toEqual({ kind: 'started' })
    expect(replaced).toEqual([])
    expect(pipelineStarts).toEqual([{ maxPages: expect.any(Number), runKind: 'backfill' }])
  })

  it('asks before replacing a different period, and starts nothing yet', async () => {
    const { api, pipelineStarts } = build(MON_10_00, {}, { job: job() })
    const result = await api.startCollection({ firstDayMs: firstDayMs - 7 * DAY, lastDayMs })
    expect(result.kind).toBe('needs_replace')
    if (result.kind !== 'needs_replace') return
    expect(result.job.targetStartMs).toBe(targetStartMs)
    expect(result.job.cursorPostedAtMs).toBe(targetStartMs + DAY)
    expect(pipelineStarts).toEqual([])
  })

  it('asks before replacing a period whose list is done but whose search or probe is not', async () => {
    const period = { fromDay: kstDayKey(targetStartMs), toDay: kstDayKey(targetEndMs) }
    const { api, pipelineStarts } = build(MON_10_00, {}, {
      job: job({ complete: true }),
      pipelineStage: { kind: 'search', period, boardId: '137', boardName: null, position: 1, count: 1, searchExtended: true },
    })
    expect((await api.startCollection({ firstDayMs: firstDayMs - 7 * DAY, lastDayMs })).kind).toBe('needs_replace')
    expect(pipelineStarts).toEqual([])
  })

  it('makes the new period once the operator has answered, then starts the pipeline', async () => {
    const { api, replaced, pipelineStarts } = build(MON_10_00, {}, { job: job() })
    expect(await api.startCollection({ firstDayMs: firstDayMs - 7 * DAY, lastDayMs, replace: true })).toEqual({ kind: 'started' })
    expect(replaced).toEqual([{ scope: 'board', targetStartMs: firstDayMs - 7 * DAY, targetEndMs }])
    expect(pipelineStarts).toHaveLength(1)
  })

  it('does not ask about a period the pipeline has finished', async () => {
    const { api, replaced } = build(MON_10_00, {}, { job: job({ complete: true }) })
    expect(await api.startCollection({ firstDayMs: firstDayMs - 7 * DAY, lastDayMs })).toEqual({ kind: 'started' })
    expect(replaced).toHaveLength(1)
  })

  it('sends the operator to stop the pipeline before changing the period under it', async () => {
    const { api, replaced, pipelineStarts } = build(MON_10_00, {}, { job: job(), pipelineBusy: true })
    expect(await api.startCollection({ firstDayMs: firstDayMs - 7 * DAY, lastDayMs, replace: true })).toEqual({ kind: 'refused', reason: 'STOP_RUNNING_FIRST' })
    expect(replaced).toEqual([])
    expect(pipelineStarts).toEqual([])
  })

  it('carries the stored job on through the pipeline when no period is named', async () => {
    const { api, pipelineStarts } = build(MON_10_00, {}, { job: job() })
    expect(await api.startCollection()).toEqual({ kind: 'started' })
    expect(pipelineStarts).toEqual([{ maxPages: expect.any(Number), runKind: 'backfill' }])
  })

  it('passes on the pipeline\'s answer when there is nothing to carry on', async () => {
    expect(await build(MON_10_00, {}, { job: null }).api.startCollection()).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    expect(await build(MON_10_00, {}, { job: job({ complete: true }) }).api.startCollection()).toEqual({ kind: 'refused', reason: 'JOB_FINISHED' })
  })

  it('names the missing database rather than the missing job', async () => {
    expect(await build().api.startCollection()).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
  })

  it('reads a finished period over again, made afresh', async () => {
    const { api, replaced } = build(MON_10_00, {}, { job: job({ complete: true }) })
    expect(await api.startCollection({ firstDayMs, lastDayMs })).toEqual({ kind: 'started' })
    expect(replaced).toEqual([{ scope: 'board', targetStartMs: firstDayMs, targetEndMs }])
  })

  it('makes a board job by default when no period has ever been asked for', async () => {
    const { api, replaced, pipelineStarts } = build(MON_10_00, {}, { job: null })
    expect(await api.startCollection({ firstDayMs, lastDayMs })).toEqual({ kind: 'started' })
    expect(replaced).toEqual([{ scope: 'board', targetStartMs: firstDayMs, targetEndMs: lastDayMs + DAY }])
    expect(pipelineStarts).toHaveLength(1)
  })
```

Add one more case:

```ts
  it('stops collection by stopping the pipeline', async () => {
    const { api, pipelineStops } = build(MON_10_00, {}, { job: job() })
    await api.stopCollection()
    expect(pipelineStops.count).toBe(1)
  })
```

5. In the collection status tests (search the file for `getCollectionStatus`), assert the ready view carries `pipeline` — e.g. `expect((await api.getCollectionStatus())).toMatchObject({ kind: 'ready', pipeline: { kind: 'list' } })` for a stored unfinished job.

`tests/desktop/articleProbeView.test.ts`: replace the window-from-search cases with: given `period: { fromDay: '20240101', toDay: '20250102' }`, `readJob` is called with exactly that and its job is the view's; given `period: null`, `readJob` is not called and `job` is null.

- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/desktop/rendererApi.test.ts tests/desktop/articleProbeView.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`rendererApi.ts`:
- Deps gain `readonly collectionPipeline: CollectionPipeline` (wired in `main.ts` from `appContext.collectionPipeline`).
- `startFor(...)` becomes `startPipeline = () => deps.collectionPipeline.start({ maxPages: pagesPerWorkBlock(schedule.workBlockMinutes, readCollectionPacing(settings)), runKind: 'backfill' })`.
- `startCollection()` without a request: `NO_STORAGE` without storage, else `return startPipeline()` (the pipeline answers `NO_JOB` / `JOB_FINISHED` itself).
- With a request: keep the range check and `sameJob`. Read `const pipelineDone = (await deps.collectionPipeline.read())?.stage.kind === 'done'`; the replace question is asked when `inProgress !== null && !sameJob && !pipelineDone && request.replace !== true`; `STOP_RUNNING_FIRST` when `!sameJob && deps.collectionPipeline.isRunning()`. The same unfinished job (`sameJob && !pipelineDone`) → `startPipeline()`; otherwise `replaceJob(...)` then `startPipeline()`.
- `stopCollection()` → `deps.collectionPipeline.stop()`.
- `getCollectionStatus()` ready → add `pipeline: (await deps.collectionPipeline.read())?.stage ?? { kind: 'idle' }`.
- `getArticleProbeStatus()` → pass `period` = the stage's `period` when the stage is `probe` or `done`, else null.
- Delete the seven methods and the imports only they used (`planBoardSearchJob`, `articleProbeWindow`).

`ipc.ts`: drop the seven channels and their types; add `pipeline` to the ready `CollectionStatusView` (import `type CollectionPipelineStage`).

`articleProbeView.ts`: as in Interfaces; drop the `search` input and the `window` field.

Delete `articleProbePlan.ts` and its test (nothing calls `articleProbeWindow` any more — confirm with `grep -rn articleProbeWindow src tests`).

- [ ] **Step 4: Run the tests to see them pass** — `pnpm typecheck` names the renderer files that still call removed methods: leave them for Task 10 only if the typecheck of `tsconfig.json` covers the renderer — it does, so this task must keep the renderer compiling. Note `tsconfig.json` includes `tests/**/*`, so the typecheck covers tests too. Make the smallest renderer edits that compile: delete `articleProbeCreateRefusal` and `articleProbeCreateOutcome` (`articleProbeLines.ts`) and `boardSearchPlanOutcome` (`boardSearchLines.ts`) with their cases in `tests/renderer/articleProbeLines.test.ts` / `boardSearchLines.test.ts` and their call sites (`ArticleProbeStep.tsx`'s create button and `window?.kind === 'ready'` branch; `NextStepPanel.tsx`'s `probeCreate` branch, the `STOP` map entries calling `api.stopBoardSearch`/`api.stopArticleProbe` — use `api.stopCollection` for every step — and the `searchResume`/`probeResume` branches calling the removed starts — use `api.startCollection()`); remove the buttons that call removed methods from `NextStepPanel.tsx`, `BoardSearchStep.tsx`, `ArticleProbeStep.tsx`, delete `BoardSearchJobForm.tsx` with its import in `BoardSearchStep.tsx` and `CollectionStatus.tsx`, drop the reads of `view.window` in `ArticleProbeStep.tsx` and `window: null` in `tests/renderer/collectionStepFixtures.ts`, and add `pipeline` wherever a test builds a ready `CollectionStatusView`. Task 10 then reshapes those screens. `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat: start and stop collection through the pipeline"
```

---

### Task 10: The screen shows the pipeline (sonnet)

**Files:**
- Modify: `src/renderer/views/collection/stepFacts.ts`, `nextStep.ts`, `nextStepLines.ts`, `NextStepPanel.tsx`, `stepStates.ts`, `BoardSearchStep.tsx`, `ArticleProbeStep.tsx`, `articleProbeLines.ts`, `boardSearchLines.ts`, `startRefusals.ts`, `src/renderer/views/CollectionStatus.tsx`, `src/shared/text.ts`
- Test: `tests/renderer/nextStep.test.ts`, `tests/renderer/stepStates.test.ts`, `tests/renderer/collectionStepFixtures.ts`, `tests/renderer/articleProbeLines.test.ts`, `tests/renderer/boardSearchLines.test.ts`, `tests/renderer/startRefusals.test.ts`

**Interfaces:**
- Consumes: `CollectionStatusView` ready `.pipeline: CollectionPipelineStage` (Task 9).
- Produces:
  - `CollectionStepInputs` gains `readonly pipeline: CollectionPipelineStage`.
  - `NextStep`:

```ts
export type NextStep =
  | { readonly kind: 'running'; readonly step: WalkStep }
  | { readonly kind: 'resume'; readonly stage: Extract<CollectionPipelineStage, { kind: 'list' | 'search' | 'probe' }>; readonly nextRunAtMs: number | null }
  | { readonly kind: 'pickPeriod' }
  | { readonly kind: 'allDone' }
```

  - New words in `TEXT.collection.next` (remove `listWaitingAt`, `listWaitingManual`, `searchResume`, `probeResume`, `searchNeeded`, `probeCreate`, `probeSpent`, `prepareSearch`):

```ts
      resume: {
        list: '① 목록 수집 차례입니다. 끝나면 ②, ③으로 저절로 이어집니다.',
        search: (board: string, position: number, count: number) =>
          `② 검색어 보충 차례입니다 · ${board} 게시판 (목록 끝에 닿은 ${count}개 중 ${position}번째). 끝나면 다음으로 저절로 이어집니다.`,
        probe: '③ 빈 글 번호 확인 차례입니다. 고른 기간 전체의 빈 번호를 읽습니다.',
      },
```

  - Remove `TEXT.collection.steps.probe.spent`; change `TEXT.collection.steps.probe.notNeeded` to `'② 보충이 끝나면 저절로 시작합니다.'`.

- [ ] **Step 1: Write the failing tests**

`tests/renderer/collectionStepFixtures.ts`: `inputs(...)` defaults `pipeline: { kind: 'idle' }`; `probe(...)` drops `window`; add `export const PERIOD = { fromDay: '20240101', toDay: '20250102' }`.

Rewrite `tests/renderer/nextStep.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextStep } from '../../src/renderer/views/collection/nextStep.js'
import { nextStepScheduleLine, nextStepSentence } from '../../src/renderer/views/collection/nextStepLines.js'
import { inputs, listJob, PERIOD, probe, probeJob, runningRun, search, searchJob, status } from './collectionStepFixtures.js'

const SEARCH = { kind: 'search' as const, period: PERIOD, boardId: '188', boardName: '자유게시판', position: 1, count: 2, searchExtended: true }

describe('nextStep', () => {
  it('asks for a period when the pipeline is idle', () => {
    expect(nextStep(inputs(), null)).toEqual({ kind: 'pickPeriod' })
  })

  it('says to wait while any walk runs, before anything else', () => {
    expect(nextStep(inputs({ status: status({ running: runningRun }), pipeline: SEARCH }), null)).toEqual({ kind: 'running', step: 'list' })
    expect(nextStep(inputs({ search: search(searchJob(), true), pipeline: SEARCH }), null)).toEqual({ kind: 'running', step: 'search' })
    expect(nextStep(inputs({ probe: probe(probeJob(), true), pipeline: { kind: 'probe', period: PERIOD } }), null)).toEqual({ kind: 'running', step: 'probe' })
  })

  it('offers to resume the stage the pipeline is at', () => {
    expect(nextStep(inputs({ status: status({ job: listJob() }), pipeline: { kind: 'list', period: PERIOD } }), 5)).toEqual({ kind: 'resume', stage: { kind: 'list', period: PERIOD }, nextRunAtMs: 5 })
    expect(nextStep(inputs({ pipeline: SEARCH }), null)).toEqual({ kind: 'resume', stage: SEARCH, nextRunAtMs: null })
  })

  it('has nothing to do once the pipeline is done', () => {
    expect(nextStep(inputs({ pipeline: { kind: 'done', period: PERIOD } }), null)).toEqual({ kind: 'allDone' })
  })
})

describe('nextStep lines', () => {
  it('names the stage, and the board with its place among the boards to search', () => {
    expect(nextStepSentence({ kind: 'resume', stage: { kind: 'list', period: PERIOD }, nextRunAtMs: null })).toBe('① 목록 수집 차례입니다. 끝나면 ②, ③으로 저절로 이어집니다.')
    expect(nextStepSentence({ kind: 'resume', stage: SEARCH, nextRunAtMs: null })).toBe('② 검색어 보충 차례입니다 · 자유게시판 게시판 (목록 끝에 닿은 2개 중 1번째). 끝나면 다음으로 저절로 이어집니다.')
    expect(nextStepSentence({ kind: 'resume', stage: { ...SEARCH, boardName: null }, nextRunAtMs: null })).toContain('188 게시판')
  })

  it('says when the loop next takes a turn under any resume, and nothing otherwise', () => {
    expect(nextStepScheduleLine({ kind: 'resume', stage: { kind: 'probe', period: PERIOD }, nextRunAtMs: null })).not.toBeNull()
    expect(nextStepScheduleLine({ kind: 'allDone' })).toBeNull()
  })
})
```

Rewrite `tests/renderer/stepStates.test.ts` so it pins:

```ts
describe('step badges', () => {
  it('list: running while a list run is in flight, done once its job is complete, else to do', () => {
    expect(listStepState(inputs({ status: status({ running: runningRun }) })).badge).toBe('running')
    expect(listStepState(inputs({ status: status({ job: listJob({ complete: true }) }) })).badge).toBe('done')
    expect(listStepState(inputs()).badge).toBe('todo')
  })

  it('search: to do while it is the stage or a board at the horizon waits, done after, not needed without such a board', () => {
    const horizon = status({ job: listJob({ complete: true, boards: [board(1, '188', 'horizon')] }) })
    expect(searchStepState(inputs({ status: horizon, pipeline: { kind: 'search', period: PERIOD, boardId: '188', boardName: null, position: 1, count: 1, searchExtended: true } })).badge).toBe('todo')
    expect(searchStepState(inputs({ status: horizon, pipeline: { kind: 'probe', period: PERIOD } })).badge).toBe('done')
    expect(searchStepState(inputs({ status: status({ job: listJob({ boards: [board(1, '188', 'horizon')] }) }), pipeline: { kind: 'list', period: PERIOD } })).badge).toBe('todo')
    expect(searchStepState(inputs({ status: status({ job: listJob({ complete: true, boards: [board(1, '189', 'complete')] }) }), pipeline: { kind: 'probe', period: PERIOD } }))).toEqual({ badge: 'notNeeded', reason: '목록 끝에 닿은 게시판이 없어 필요 없습니다.' })
  })

  it('probe: done when the pipeline is, to do while it is the stage, and waiting with a reason before', () => {
    expect(probeStepState(inputs({ pipeline: { kind: 'done', period: PERIOD } })).badge).toBe('done')
    expect(probeStepState(inputs({ pipeline: { kind: 'probe', period: PERIOD } })).badge).toBe('todo')
    expect(probeStepState(inputs({ pipeline: { kind: 'list', period: PERIOD } }))).toEqual({ badge: 'notNeeded', reason: '② 보충이 끝나면 저절로 시작합니다.' })
    expect(probeStepState(inputs({ probe: probe(probeJob(), true), pipeline: { kind: 'probe', period: PERIOD } })).badge).toBe('running')
  })
})
```

`articleProbeLines.test.ts`, `boardSearchLines.test.ts`, `startRefusals.test.ts`: delete the cases of the functions this task deletes (below).

- [ ] **Step 2: Run them to see them fail** — `pnpm vitest run tests/renderer` → FAIL.

- [ ] **Step 3: Implement**

`stepFacts.ts`: add `pipeline` to `CollectionStepInputs` (doc: "Where the pipeline stands; the walks run in its order, so the screen reads it rather than working the order out again."); keep `runningStep`; delete `listUnfinished`, `searchUnfinished`, `searchFinished`, `probeUnfinished`, `probeFinished`, `boardNeedingSearch`, `probeSpent` and add

```ts
/** Whether any board of the job ran out of list before the period did. */
export function anyBoardBeyondReach({ status }: CollectionStepInputs): boolean {
  return (status.job?.boards ?? []).some((board) => board.state === 'horizon')
}
```

`nextStep.ts`:

```ts
/**
 * The one thing the top of the screen tells a newcomer to do now: wait for the
 * walk in flight, or carry the pipeline on from its stage, which then goes on
 * to the next stage by itself.
 */
export function nextStep(inputs: CollectionStepInputs, nextRunAtMs: number | null): NextStep {
  const running = runningStep(inputs)
  if (running !== null) return { kind: 'running', step: running }
  const { pipeline } = inputs
  if (pipeline.kind === 'idle') return { kind: 'pickPeriod' }
  if (pipeline.kind === 'done') return { kind: 'allDone' }
  return { kind: 'resume', stage: pipeline, nextRunAtMs }
}
```

`nextStepLines.ts`: `resume` → by `stage.kind`: `list`/`probe` the fixed lines, `search` → `TEXT.collection.next.resume.search(stage.boardName ?? stage.boardId, stage.position, stage.count)`. `nextStepScheduleLine`: for `resume`, `nextRunAtMs === null ? TEXT.collection.nextRunNone : TEXT.collection.nextRunAt(formatKstTime(nextRunAtMs))`; otherwise null.

`NextStepPanel.tsx`: drop `onPrepareSearch`, `STOP`, `STOP_LABEL`, the probe-create branch and its imports. `running` → `button(TEXT.collection.stop, () => void act(() => api.stopCollection()), false)`; `resume` → `button(TEXT.collection.next.resumeList, () => start(() => api.startCollection(), listStartRefusal))`; `pickPeriod` as now; `allDone` → null. Update the doc comment: the panel's one button resumes the pipeline.

`stepStates.ts`:

```ts
export function searchStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'search') return { badge: 'running', reason: null }
  if (inputs.pipeline.kind === 'search') return { badge: 'todo', reason: null }
  if (!anyBoardBeyondReach(inputs)) return { badge: 'notNeeded', reason: TEXT.collection.steps.search.notNeeded }
  return { badge: inputs.pipeline.kind === 'probe' || inputs.pipeline.kind === 'done' ? 'done' : 'todo', reason: null }
}

export function probeStepState(inputs: CollectionStepInputs): StepState {
  if (runningStep(inputs) === 'probe') return { badge: 'running', reason: null }
  if (inputs.pipeline.kind === 'done') return { badge: 'done', reason: null }
  if (inputs.pipeline.kind === 'probe') return { badge: 'todo', reason: null }
  return { badge: 'notNeeded', reason: TEXT.collection.steps.probe.notNeeded }
}
```

`listStepState` stays.

`BoardSearchStep.tsx`: no `action`, no `refusal` state, no form, no `request`/`otherRunning`/`act`-only-for-buttons props (keep `busy`/`act` only if something left uses them; otherwise drop them from the props and from `CollectionStatus.tsx`). Keep the window line, summary, progress, remaining line, block failure line and the 자세히 table. Update its doc comment: the pipeline makes and walks the job; the card shows it.

`ArticleProbeStep.tsx`: the same — no buttons, no `created`/`refusal` state, no `createRefusal`; `windowLine` from `job` only; keep the fold when finished, the headline, progress, failure line and 자세히.

`articleProbeLines.ts`: delete `articleProbeStartLabel` (and `articleProbeCreateOutcome`/`articleProbeCreateRefusal` if Task 9 left them). `boardSearchLines.ts`: delete `boardSearchStartLabel` (and `boardSearchPlanOutcome` if Task 9 left it). `startRefusals.ts`: delete `searchStartRefusal`, `probeStartRefusal`. Then delete every `TEXT` key only those used (`TEXT.boardSearch.startRefused`, the search form and replace-confirmation words, `TEXT.articleProbe.create`, `createRefused`, `created`, `startRefused`, `resume`, `stop`, and so on) — for each key, `grep -rn "<key>" src` must show no use before you delete it, and must show none after.

`CollectionStatus.tsx`: `inputs.pipeline = collection.pipeline`; drop `searchRequest` and `onPrepareSearch`; update the doc comment.

- [ ] **Step 4: Run the tests to see them pass** — `pnpm vitest run tests/renderer` → PASS; `pnpm typecheck && pnpm test && npx eslint src tests scripts` → clean.

- [ ] **Step 5: Look at it** — build the renderer (`pnpm build:renderer`) and check the collection screen in the renderer preview as memory `renderer-preview-without-electron` describes (`dist/renderer` with a fake `window.wm`), through Aside (`aside guide repl` once, then `aside repl`), never by starting Electron. Fake three states — stage `list`, stage `search` (board 188, 1 of 2), stage `done` — and check, in light and dark: the panel sentence and its one button; ② and ③ cards show no buttons; badges as Step 1 pins. Write down what you saw in the task report.

- [ ] **Step 6: Commit**

```bash
git add -A src/renderer src/shared/text.ts tests/renderer
git commit -m "feat: show the collection pipeline's stage and drop the hand-made jobs"
```

---

### Task 11: Whole-branch verification and hand-off (sonnet)

**Files:** none new.

- [ ] **Step 1: Every check**

```bash
pnpm typecheck
pnpm test
npx eslint src tests scripts
COLLECTION_TEST_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection_test pnpm test:collection:integration
pnpm build:all
```

All must pass with no warnings.

- [ ] **Step 2: Leftovers** — each must print nothing:

```bash
grep -rn "TODO\|test\.skip\|\.only(" src tests
grep -rn "createBoardSearchJob\|createArticleProbeJob\|previewBoardSearchJob\|startBoardSearch\|startArticleProbe\|stopBoardSearch\|stopArticleProbe\|articleProbeWindow\|BoardSearchJobForm\|createArticleCollectionJob" src tests
```

- [ ] **Step 3: The migration, read-only** — confirm `drizzle-collection/0010_*.sql` holds only the three `ADD COLUMN` statements, and read the production state the pipeline will meet (read-only):

```bash
psql -X postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection -c "select menu_id, completed_at is not null done, horizon_reached_at is not null horizon from feed_state order by queue_order"
psql -X -At postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection -c "select board_id, from_day, to_day, count(*), count(completed_at) from board_search_state group by 1,2,3"
```

Report what §7 predicts from it. As read on 2026-10-07: period 2024-01-01 → 2025-01-02 KST; horizon 188 (queue 2), 205 (queue 4); list unfinished 137 (queue 1), 43, 253, 207, 235, 165; `board_search_state` 137 / 20240101–20250101 / 300 queries, 256 complete. If 137's list reaches the horizon (expected: 1,000 pages from today do not reach 2024), 137 is searched first and its job adopted with its 256 kept, keeping `to_day 20250101`; if 137's list instead completes, 188's `replaceJob` discards 137's job. Say which the data supports.

- [ ] **Step 4: Hand-off note** — in the final report, list for the operator: quit the app; `COLLECTION_MIGRATION_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection pnpm db:collection:migrate`; install the new package; the pipeline then resumes at ① for the 2024 period. No `PROTOCOL_VERSION` change, so the extension needs no reload.
