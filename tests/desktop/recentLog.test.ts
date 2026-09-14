import { describe, expect, it } from 'vitest'
import type { CollectionRunSummary } from '../../src/desktop/collection-db/statusQuery.js'
import { mergeRecentLog } from '../../src/desktop/recentLog.js'
import { stamp } from '../../src/desktop/refusalLog.js'
import { TEXT } from '../../src/shared/text.js'

const T0 = Date.UTC(2026, 8, 13, 15, 0, 0) // 2026-09-14 00:00 KST

function run(overrides: Partial<CollectionRunSummary> = {}): CollectionRunSummary {
  return {
    id: 'run-1', runKind: 'backfill', status: 'succeeded', stopReason: null,
    startedAtMs: T0 + 3_000, finishedAtMs: T0 + 4_000, targetStartMs: T0, targetEndMs: T0,
    collectionPages: 12, requestPages: 12, insertedPostCount: 38, observedPostCount: 50,
    cursorPostedAtMs: null, boardName: null,
    ...overrides,
  }
}

describe('mergeRecentLog', () => {
  it('lays the three sources on one timeline, newest first', () => {
    const entries = mergeRecentLog({
      sessionLines: [`${stamp(T0 + 1_000)} KST  welcome-comment  SETTLE  opened  executed=2`],
      diagnostics: [{ atMs: T0 + 2_000, level: 'error', tag: 'collection', text: 'Error: boom' }],
      collectionRuns: [run()],
      limit: 200,
    })

    expect(entries.map((entry) => entry.source)).toEqual(['collection', 'diagnostic', 'session'])
    expect(entries.map((entry) => entry.atMs)).toEqual([T0 + 3_000, T0 + 2_000, T0 + 1_000])
  })

  it('files a refused session under its own source, from the line itself', () => {
    const [entry] = mergeRecentLog({
      sessionLines: [`${stamp(T0)} KST  welcome-comment  SCHEDULED  refused OUTSIDE_ACTIVE_HOURS  unscheduled`],
      diagnostics: [],
      collectionRuns: [],
      limit: 200,
    })

    expect(entry?.source).toBe('refusal')
    expect(entry?.text).toBe('welcome-comment  SCHEDULED  refused OUTSIDE_ACTIVE_HOURS  unscheduled')
  })

  it('does not mistake an opened session that mentions refusing for a refusal', () => {
    const [entry] = mergeRecentLog({
      sessionLines: [`${stamp(T0)} KST  welcome-comment  SETTLE  opened  day=09-13 note=refused-by-cafe`],
      diagnostics: [],
      collectionRuns: [],
      limit: 200,
    })

    expect(entry?.source).toBe('session')
  })

  it('leaves out a session line it cannot place in time', () => {
    expect(mergeRecentLog({ sessionLines: ['garbage'], diagnostics: [], collectionRuns: [], limit: 200 })).toEqual([])
  })

  it('words a collection run by what it did and why it stopped', () => {
    const [entry] = mergeRecentLog({
      sessionLines: [],
      diagnostics: [],
      collectionRuns: [run({ status: 'interrupted', stopReason: 'PAGE_BUDGET', boardName: '자유게시판' })],
      limit: 200,
    })

    expect(entry?.text).toBe(TEXT.log.collectionRun('interrupted', 12, 38, '자유게시판', 'PAGE_BUDGET'))
  })

  it('keeps only the newest entries up to the limit', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `${stamp(T0 + i * 1_000)} KST  welcome-comment  SETTLE  opened`)
    const entries = mergeRecentLog({ sessionLines: lines, diagnostics: [], collectionRuns: [], limit: 2 })

    expect(entries.map((entry) => entry.atMs)).toEqual([T0 + 4_000, T0 + 3_000])
  })
})
