import { describe, expect, it } from 'vitest'
import { createMemberCollectionOrchestrator, MEMBERS_PER_PAGE, TOPUP_MAX_PAGES } from '../../src/desktop/memberCollectionOrchestrator.js'
import type { MemberRepository, PersistMemberPageInput } from '../../src/desktop/collection-db/memberRepository.js'
import type { CollectedMember, CollectedMemberPage } from '../../src/shared/cafeMemberList.js'

const run = { id: '00000000-0000-4000-8000-000000000001', runKind: 'backfill' as const, resumeFromCheckpoint: false, startedAt: new Date(1_000) }

function members(prefix: string, count: number, joinDate: string): CollectedMember[] {
  return Array.from({ length: count }, (_, i) => ({ memberKey: `${prefix}-${i}`, nickname: null, joinDate, levelName: '', isManager: false, isStaff: false }))
}
function page(items: CollectedMember[]): CollectedMemberPage {
  return { items, pageIdentity: `id:${items.map((m) => m.memberKey).join(',')}` }
}
function fullPage(prefix: string, joinDate: string): CollectedMemberPage {
  return page(members(prefix, MEMBERS_PER_PAGE, joinDate))
}

function fakeRepo(overrides: Partial<MemberRepository> = {}) {
  const persisted: PersistMemberPageInput[] = []
  const finished: string[] = []
  let completed = false
  let version = 0
  let anchor: string | null = null
  const base: MemberRepository = {
    readMemberFeedState: async () => ({ stateVersion: version, anchorMemberKey: anchor, anchorJoinDate: null, referencePage: null, pageIdentity: null, totalMemberCount: null, cursorUpdatedAtMs: 1_000, complete: false, forced: false, toppedUpAtMs: null }),
    startRun: async () => ({ stateVersion: version, anchorMemberKey: anchor, anchorJoinDate: null, referencePage: null, pageIdentity: null, totalMemberCount: null, cursorUpdatedAtMs: 1_000, complete: false, forced: false, toppedUpAtMs: null }),
    recordPageRequest: async () => undefined,
    finishRun: async (_id, status, reason) => { finished.push(`${status}:${reason ?? ''}`) },
    persistPage: async (input) => {
      persisted.push(input)
      version += 1
      anchor = input.page.items.at(-1)?.memberKey ?? null
      return { kind: 'stored', insertedMemberCount: input.page.items.length, updatedMemberCount: 0, nextStateVersion: version, anchorMemberKey: anchor ?? '' }
    },
    markCompleted: async () => { completed = true },
    markToppedUp: async () => undefined,
    setForced: async () => { throw new Error('the walk never toggles forced') },
    reconcileOrphanedRuns: async () => 0,
    knownMemberKeys: async () => new Set<string>(),
    ...overrides,
  }
  return { repo: base, persisted, finished, isCompleted: () => completed }
}

const noBusy = { random: { intInclusive: (min: number) => min }, sleep: async () => undefined, clock: { now: () => 1_000 }, isSessionBusy: () => false, isAbortRequested: () => false }

describe('member collection orchestrator', () => {
  it('walks from page 1 and ends on a short final page', async () => {
    const { repo, persisted, finished, isCompleted } = fakeRepo()
    const pages: Record<number, CollectedMemberPage> = {
      1: fullPage('p1', '2026-08-23'),
      2: page(members('p2', 40, '2026-08-22')), // < 100 → end
    }
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async (n) => pages[n] ?? page([]) } })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('succeeded')
    expect(persisted).toHaveLength(2)
    expect(isCompleted()).toBe(true)
    expect(finished[0]).toBe('succeeded:')
  })

  it('rewinds and continues from the item right after the tail when the tail lands at last position in the rewound page', async () => {
    // After persisting page 1, the continuity check on page 2 cannot find the tail.
    // Rewinding page 1 shows a shifted identity with the tail at the very last slot:
    // the walk continues from the next page with offset 0.
    const { repo, persisted } = fakeRepo()
    const p1 = fullPage('p1', '2026-08-23')
    const tailKey = p1.items.at(-1)!.memberKey
    // Shifted p1 has the same items as p1 but a different identity: the tail is at
    // the very last slot (index === length - 1) so the orchestrator falls to the
    // implicit-else branch (firstOffset = 0) and continues from the next page.
    const p1Orig = p1
    const p1Shifted = { ...p1, pageIdentity: 'p1-shifted' }

    let p1ReadCount = 0
    const orchestrator = createMemberCollectionOrchestrator({
      ...noBusy,
      repository: repo,
      fetcher: {
        read: async (n: number): Promise<CollectedMemberPage> => {
          if (n === 1) { p1ReadCount++; return p1ReadCount === 1 ? p1Orig : p1Shifted }
          // Page 2: tail absent on first visit; short page thereafter.
          return page(members('nomatch', 10, '2026-08-22'))
        },
      },
    })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('succeeded')
    // Page 1 (original) stored; short page 2 (nomatch) stored; tail at last position
    // → firstOffset = 0 on the short page → walk ends normally.
    expect(persisted.length).toBeGreaterThanOrEqual(1)
    // The walk must not have used tailKey as the first item of any stored slice.
    const firstItemsOfStoredPages = persisted.map((p) => p.page.items[0]?.memberKey)
    expect(firstItemsOfStoredPages).not.toContain(tailKey)
  })

  it('stops on abort with the cursor kept', async () => {
    const { repo, finished } = fakeRepo()
    let aborted = false
    const orchestrator = createMemberCollectionOrchestrator({
      ...noBusy,
      isAbortRequested: () => aborted,
      repository: repo,
      fetcher: { read: async () => { aborted = true; return fullPage('p', '2026-08-23') } },
    })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('interrupted')
    expect(finished[0]).toBe('interrupted:ABORTED')
  })

  it('spends the page budget as PAGE_BUDGET_SPENT', async () => {
    const { repo, finished } = fakeRepo()
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async (n) => fullPage(`p${n}`, '2026-08-23') } })
    const result = await orchestrator.run({ run, maxPages: 2, mode: 'backfill' })
    expect(result.kind).toBe('partial')
    expect(finished[0]).toBe('partial:PAGE_BUDGET_SPENT')
  })

  it('ends on a CAS conflict', async () => {
    const { repo } = fakeRepo({ persistPage: async () => ({ kind: 'conflict' }) })
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async () => fullPage('p', '2026-08-23') } })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('cas_conflict')
  })

  it('rewind mid-page: continues from the item right after the tail found mid-page in the rewound page', async () => {
    const { repo, persisted } = fakeRepo()
    // Build a 100-item page; its tail will be moved to index 49 in the shifted version.
    const p1Items = members('a', MEMBERS_PER_PAGE, '2026-08-23')
    const tailKey = p1Items[MEMBERS_PER_PAGE - 1]!.memberKey // 'a-99'
    // Shifted p1: [a-0..a-48, a-99, a-49..a-97, extra-0] — 100 items, tail at index 49.
    const shiftedItems: typeof p1Items = [
      ...p1Items.slice(0, 49),          // a-0..a-48  (index 0–48)
      p1Items[99]!,                     // a-99       (index 49)
      ...p1Items.slice(49, 98),         // a-49..a-97 (index 50–98)
      { memberKey: 'extra-0', nickname: null, joinDate: '2026-08-23', levelName: '', isManager: false, isStaff: false },
    ]
    const p1Orig = { items: p1Items, pageIdentity: 'p1-orig' }
    const p1Shifted = { items: shiftedItems, pageIdentity: 'p1-shifted' }

    let p1ReadCount = 0
    const fetcher = {
      read: async (n: number): Promise<CollectedMemberPage> => {
        if (n === 1) { p1ReadCount++; return p1ReadCount === 1 ? p1Orig : p1Shifted }
        // Page 2: first read has no tail; subsequent reads are short to end the walk.
        return page(members('end', 5, '2026-08-21'))
      },
    }
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher })
    const result = await orchestrator.run({ run, maxPages: 20, mode: 'backfill' })
    expect(result.kind).toBe('succeeded')
    // persisted[0] = p1Orig (100 items); persisted[1] = p1Shifted from index 50 (50 items);
    // persisted[2] = short page 2 (5 items).
    expect(persisted.length).toBe(3)
    // The walk re-collects from the item right after the tail's new position (index 50).
    expect(persisted[1]!.page.items[0]!.memberKey).toBe(shiftedItems[50]!.memberKey)
    // The tail itself must not appear in the re-collected slice.
    expect(persisted[1]!.page.items.some((m) => m.memberKey === tailKey)).toBe(false)
  })

  it('top-up stops at TOPUP_MAX_PAGES when every page still has fresh members', async () => {
    // Build a flat member array large enough for TOPUP_MAX_PAGES overlapping pages.
    // Each page shares its last item with the next page's first item so the
    // continuity check (previousTailKey found at index 0) never triggers a rewind.
    const total = TOPUP_MAX_PAGES * (MEMBERS_PER_PAGE - 1) + 1
    const flat: CollectedMember[] = Array.from({ length: total }, (_, i) => ({
      memberKey: `m-${i}`, nickname: null, joinDate: '2026-08-23', levelName: '', isManager: false, isStaff: false,
    }))
    // Page n (1-indexed) is flat[(n-1)*(MEMBERS_PER_PAGE-1) .. n*(MEMBERS_PER_PAGE-1)].
    const pageOf = (n: number): CollectedMemberPage => {
      const start = (n - 1) * (MEMBERS_PER_PAGE - 1)
      const items = flat.slice(start, start + MEMBERS_PER_PAGE)
      return { items, pageIdentity: `fp${n}` }
    }
    let fetchCount = 0
    let toppedUpCount = 0
    const { repo, persisted } = fakeRepo({ knownMemberKeys: async () => new Set<string>(), markToppedUp: async () => { toppedUpCount++ } })
    const topupRun = { ...run, runKind: 'topup' as const }
    const orchestrator = createMemberCollectionOrchestrator({
      ...noBusy,
      repository: repo,
      fetcher: { read: async (n) => { fetchCount++; return pageOf(n) } },
    })
    const result = await orchestrator.run({ run: topupRun, maxPages: 50, mode: 'topup' })
    expect(result.kind).toBe('succeeded')
    expect(fetchCount).toBe(TOPUP_MAX_PAGES)
    expect(persisted.length).toBe(TOPUP_MAX_PAGES)
    expect(toppedUpCount).toBe(1)
  })

  it('top-up stops once every key on a page is already known, within 5 pages', async () => {
    const known = new Set(fullPage('known', '2026-08-23').items.map((m) => m.memberKey))
    let toppedUpCount = 0
    const { repo, persisted } = fakeRepo({ knownMemberKeys: async (keys) => new Set(keys.filter((k) => known.has(k))), markToppedUp: async () => { toppedUpCount++ } })
    const topupRun = { ...run, runKind: 'topup' as const }
    const pages: Record<number, CollectedMemberPage> = {
      1: page([...members('new', 2, '2026-08-25'), ...fullPage('known', '2026-08-23').items.slice(0, 98)]),
      2: fullPage('known', '2026-08-23'), // all known → stop
    }
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async (n) => pages[n] ?? page([]) } })
    const result = await orchestrator.run({ run: topupRun, maxPages: 50, mode: 'topup' })
    expect(result.kind).toBe('succeeded')
    // Page 1 had new members and was persisted; page 2 was all known and stopped the walk.
    expect(persisted.length).toBeGreaterThanOrEqual(1)
    expect(toppedUpCount).toBe(1)
  })

  it('top-up stops when a short page is reached before TOPUP_MAX_PAGES', async () => {
    // A short page (< MEMBERS_PER_PAGE) means the member list is exhausted.
    const { repo, finished } = fakeRepo({ knownMemberKeys: async () => new Set<string>(), markToppedUp: async () => undefined })
    const topupRun = { ...run, runKind: 'topup' as const }
    const pages: Record<number, CollectedMemberPage> = {
      1: page(members('new', 30, '2026-08-25')), // < 100 → short page
    }
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async (n) => pages[n] ?? page([]) } })
    const result = await orchestrator.run({ run: topupRun, maxPages: 50, mode: 'topup' })
    expect(result.kind).toBe('succeeded')
    expect(finished[0]).toBe('succeeded:')
  })

  it('fails with MEMBER_PAGE_SILENT_FALLBACK when the API returns page 1 content for a later page', async () => {
    // The API silently falls back to page 1 when asked for a page past the end.
    const { repo, persisted } = fakeRepo()
    const page1 = fullPage('p1', '2026-08-23')
    const page2 = fullPage('p2', '2026-08-22')
    const fetcher = {
      read: async (n: number): Promise<CollectedMemberPage> => {
        if (n === 1) return page1
        if (n === 2) return page2
        // Page 3+ returns page 1's content (same identity, different page number)
        return page1
      },
    }
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('failed')
    expect((result as { code: string }).code).toBe('MEMBER_PAGE_SILENT_FALLBACK')
    // The cursor must not have advanced to the fallback page's data.
    expect(persisted.some((p) => p.referencePage >= 3)).toBe(false)
  })

  it('fails with MEMBER_ANCHOR_RELOCATION_FAILED when the tail vanishes from the rewound page and cannot be relocated', async () => {
    const { repo } = fakeRepo()
    const p1 = fullPage('p1', '2026-08-23')
    const tailKey = p1.items.at(-1)!.memberKey
    // Rewound page 1 has a different identity and completely different member keys so
    // findIndex returns -1 (index < 0). Relocation probes (all reads after the third)
    // return empty pages, forcing locateMemberResumePosition to return 'unusable'.
    const p1Rewound = { items: members('new', MEMBERS_PER_PAGE, '2026-08-23'), pageIdentity: 'p1-rewound' }
    let readCount = 0
    const orchestrator = createMemberCollectionOrchestrator({
      ...noBusy,
      repository: repo,
      fetcher: {
        read: async (n: number): Promise<CollectedMemberPage> => {
          readCount++
          if (n === 1 && readCount === 1) return p1                    // initial collection of page 1
          if (n === 2) return page(members('nomatch', MEMBERS_PER_PAGE, '2026-08-22')) // no tail
          if (n === 1 && readCount === 3) return p1Rewound             // continuity rewind: tail absent
          return page([])  // relocation probes: empty → locateMemberResumePosition returns unusable
        },
      },
    })
    const result = await orchestrator.run({ run, maxPages: 20, mode: 'backfill' })
    expect(result.kind).toBe('failed')
    expect((result as { code: string }).code).toBe('MEMBER_ANCHOR_RELOCATION_FAILED')
    void tailKey
  })

  it('fails with MEMBER_PAGE_DATE_ORDER when a fetched page has joinDate values out of order', async () => {
    const { repo } = fakeRepo()
    // Page 1 has a join date that increases (should be non-increasing).
    const badPage: CollectedMemberPage = {
      items: [
        { memberKey: 'a', nickname: null, joinDate: '2026-08-22', levelName: '', isManager: false, isStaff: false },
        { memberKey: 'b', nickname: null, joinDate: '2026-08-23', levelName: '', isManager: false, isStaff: false }, // newer than previous → invalid
      ],
      pageIdentity: 'bad',
    }
    const orchestrator = createMemberCollectionOrchestrator({ ...noBusy, repository: repo, fetcher: { read: async () => badPage } })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('failed')
    expect((result as { code: string }).code).toBe('MEMBER_PAGE_DATE_ORDER')
  })
})
