import { describe, expect, it } from 'vitest'
import type { CollectionRepository, ReplaceJobInput, StoredFeedState } from '../../src/desktop/collection-db/repository.js'
import { createMonthStartCollection } from '../../src/desktop/monthStartCollection.js'

const DAY = 86_400_000
const kst = (ms: number): string => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10)
/** 2026-11-01 10:00 KST. */
const NOV_1 = Date.UTC(2026, 10, 1, 1)
const OCT_START = Date.UTC(2026, 8, 30, 15)
const NOV_START = Date.UTC(2026, 9, 31, 15)

function boardRow(overrides: Partial<{ targetStartMs: number; targetEndMs: number; complete: boolean; probeFinished: boolean }> = {}): StoredFeedState {
  return {
    feed: { feedKind: 'board', menuId: '10' },
    boardName: '자유',
    queueOrder: 1,
    targetStartMs: OCT_START,
    targetEndMs: NOV_START,
    complete: false,
    horizonReached: false,
    searchExtended: false,
    searchFinished: false,
    probeFinished: false,
    forced: false,
    ...overrides,
  } as unknown as StoredFeedState
}

function harness(options: { nowMs?: number; rows?: readonly StoredFeedState[]; running?: boolean; storage?: boolean; scheduleOn?: boolean; failReplace?: boolean; rowsAfterFirstRead?: readonly StoredFeedState[] } = {}) {
  const replaced: ReplaceJobInput[] = []
  const errors: unknown[] = []
  const seeded: unknown[] = []
  let reads = 0
  const repository = {
    listFeedStates: async () => {
      reads += 1
      return reads > 1 && options.rowsAfterFirstRead !== undefined ? options.rowsAfterFirstRead : (options.rows ?? [])
    },
    replaceJob: async (input: ReplaceJobInput) => {
      if (options.failReplace === true) throw new Error('no boards')
      replaced.push(input)
      return []
    },
  } as unknown as CollectionRepository
  const seed = createMonthStartCollection({
    repository: () => (options.storage === false ? null : repository),
    isPipelineRunning: () => options.running ?? false,
    scheduleEnabled: () => options.scheduleOn ?? true,
    clock: { now: () => options.nowMs ?? NOV_1 },
    onSeeded: (made) => seeded.push(made),
    onError: (error) => errors.push(error),
  })
  return { seed, replaced, errors, seeded }
}

describe('month start collection', () => {
  it('makes last month\'s board job when there is none', async () => {
    const { seed, replaced } = harness()
    await seed()
    expect(replaced).toHaveLength(1)
    expect(replaced[0]).toMatchObject({ scope: 'board' })
    expect(kst(replaced[0]!.targetStartMs)).toBe('2026-10-01')
    expect(kst(replaced[0]!.targetEndMs)).toBe('2026-11-01')
  })

  it('replaces a finished job of an older period', async () => {
    const older = boardRow({ targetStartMs: OCT_START - 30 * DAY, targetEndMs: OCT_START, complete: true, probeFinished: true })
    const { seed, replaced, seeded } = harness({ rows: [older] })
    await seed()
    expect(replaced).toHaveLength(1)
    expect(seeded).toEqual([{ period: replaced[0] && { startMs: replaced[0].targetStartMs, endMs: replaced[0].targetEndMs }, replaced: { startMs: OCT_START - 30 * DAY, endMs: OCT_START }, madeAtMs: NOV_1 }])
  })

  it('leaves a job that already reaches the end of last month, finished or not', async () => {
    for (const row of [boardRow(), boardRow({ complete: true, probeFinished: true })]) {
      const { seed, replaced } = harness({ rows: [row] })
      await seed()
      expect(replaced).toEqual([])
    }
  })

  it('leaves an older job still under way', async () => {
    const older = boardRow({ targetStartMs: OCT_START - 30 * DAY, targetEndMs: OCT_START })
    const { seed, replaced } = harness({ rows: [older] })
    await seed()
    expect(replaced).toEqual([])
  })

  it('does nothing after the first three days, while the pipeline is running, without storage, or with the schedule off', async () => {
    for (const options of [{ nowMs: NOV_1 + 3 * DAY }, { running: true }, { storage: false }, { scheduleOn: false }]) {
      const { seed, replaced } = harness(options)
      await seed()
      expect(replaced).toEqual([])
    }
  })

  it('makes the job once when asked twice at the same time', async () => {
    const { seed, replaced } = harness()
    await Promise.all([seed(), seed()])
    expect(replaced).toHaveLength(1)
  })

  it('replaces a finished job that only reaches into last month', async () => {
    const short = boardRow({ targetStartMs: NOV_START - DAY, complete: true, probeFinished: true, targetEndMs: NOV_START + 2 * DAY })
    const { seed, replaced } = harness({ rows: [short] })
    await seed()
    expect(replaced).toHaveLength(1)
  })

  it('does not write over a job the operator made while it was reading', async () => {
    const older = boardRow({ targetStartMs: OCT_START - 30 * DAY, targetEndMs: OCT_START, complete: true, probeFinished: true })
    const chosen = boardRow({ targetStartMs: OCT_START - 20 * DAY, targetEndMs: OCT_START - 10 * DAY })
    const { seed, replaced } = harness({ rows: [older], rowsAfterFirstRead: [chosen] })
    await seed()
    expect(replaced).toEqual([])
  })

  it('reports a failure to make the job instead of throwing', async () => {
    const { seed, errors } = harness({ failReplace: true })
    await expect(seed()).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })
})
