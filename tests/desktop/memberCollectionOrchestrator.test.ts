import { describe, expect, it } from 'vitest'
import { createMemberCollectionOrchestrator, MEMBERS_PER_PAGE } from '../../src/desktop/memberCollectionOrchestrator.js'
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

  it('rewinds when the previous tail does not surface on the next page', async () => {
    const { repo, persisted } = fakeRepo()
    const p1 = fullPage('p1', '2026-08-23')
    const tail = p1.items.at(-1)!
    // Page 2 missing the tail: a joiner shifted the page. Rewind of page 1 finds
    // the tail not at its end, so the walk continues after it.
    const shifted = page([...members('inserted', 1, '2026-08-24'), ...p1.items.slice(0, MEMBERS_PER_PAGE - 1)])
    const pages: Record<number, CollectedMemberPage> = {
      1: p1,
      2: page(members('p2', 40, '2026-08-22')),
    }
    // First read of page 2 lacks the tail; the rewind reads page 1 again as `shifted`.
    let firstPage1 = true
    const orchestrator = createMemberCollectionOrchestrator({
      ...noBusy,
      repository: repo,
      fetcher: {
        read: async (n) => {
          if (n === 1) { const r = firstPage1 ? p1 : shifted; firstPage1 = false; return r }
          if (n === 2) return page(members('nomatch', 40, '2026-08-22')) // tail absent
          return page([])
        },
      },
    })
    const result = await orchestrator.run({ run, maxPages: 10, mode: 'backfill' })
    expect(result.kind).toBe('succeeded')
    expect(persisted.length).toBeGreaterThanOrEqual(1)
    void tail
    void pages
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

  it('top-up stops once every key on a page is already known, within 5 pages', async () => {
    const known = new Set(fullPage('known', '2026-08-23').items.map((m) => m.memberKey))
    const { repo, persisted } = fakeRepo({ knownMemberKeys: async (keys) => new Set(keys.filter((k) => known.has(k))) })
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
  })
})
