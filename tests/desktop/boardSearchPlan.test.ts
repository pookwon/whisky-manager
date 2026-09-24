import { describe, expect, it } from 'vitest'
import { planBoardSearchJob } from '../../src/desktop/boardSearchPlan.js'
import type { BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'

function repo(titles: string[], oldest: number | null): BoardSearchRepository {
  return { readBoardTitles: async () => titles, oldestPostedAtMs: async () => oldest } as unknown as BoardSearchRepository
}
// 2025-08-29 10:00 KST
const OLDEST = Date.UTC(2025, 7, 29, 1)

describe('planBoardSearchJob', () => {
  it('ends the window on the KST day of the oldest stored post and picks queries from the titles', async () => {
    const titles = Array.from({ length: 6 }, (_, i) => `글렌 ${i}`)
    await expect(planBoardSearchJob(repo(titles, OLDEST), { boardId: '137', fromDay: '20250101' })).resolves.toEqual({
      kind: 'ready', boardId: '137', fromDay: '20250101', toDay: '20250829', queries: [{ query: '글렌', expectedGain: 6 }],
    })
  })

  it('refuses a board with nothing stored, a start after the oldest post, a bad day, and titles with no usable word', async () => {
    await expect(planBoardSearchJob(repo([], null), { boardId: '137', fromDay: '20250101' })).resolves.toEqual({ kind: 'refused', reason: 'NO_POSTS' })
    await expect(planBoardSearchJob(repo(['글렌'], OLDEST), { boardId: '137', fromDay: '20250830' })).resolves.toEqual({ kind: 'refused', reason: 'NOTHING_BEFORE' })
    await expect(planBoardSearchJob(repo(['글렌'], OLDEST), { boardId: '137', fromDay: '2025-01-01' })).resolves.toEqual({ kind: 'refused', reason: 'BAD_DAY' })
    await expect(planBoardSearchJob(repo(['ㅎㅎ'], OLDEST), { boardId: '137', fromDay: '20250101' })).resolves.toEqual({ kind: 'refused', reason: 'NO_QUERIES' })
  })
})
