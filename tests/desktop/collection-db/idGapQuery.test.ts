import { describe, expect, it } from 'vitest'
import type { CollectionDatabase } from '../../../src/desktop/collection-db/client.js'
import { createIdGapQuery } from '../../../src/desktop/collection-db/idGapQuery.js'

/**
 * The driver hands aggregates and casts back as strings, and the two
 * statements answer in a fixed order: histogram first, suspects second.
 */
function stubDatabase(answers: readonly (readonly Record<string, unknown>[])[]): { db: CollectionDatabase; executions: () => number } {
  let calls = 0
  const db = {
    execute: () => {
      const rows = answers[calls % answers.length] ?? []
      calls += 1
      return Promise.resolve({ rows })
    },
  } as unknown as CollectionDatabase
  return { db, executions: () => calls }
}

describe('createIdGapQuery', () => {
  it('maps the driver rows into numbers and epoch milliseconds', async () => {
    const { db } = stubDatabase([
      [{ gap: '1', occurrences: '360' }, { gap: '2', occurrences: '23' }, { gap: '7', occurrences: '1' }],
      [{ id: '835171', next_id: '835179', gap: '7', at_seconds: '1769222559.57', next_at_seconds: '1769222956.73' }],
    ])
    const report = await createIdGapQuery(db).read('a')
    expect(report).toEqual({
      deletedLikeIds: 406,
      suspectCount: 1,
      suspectIds: 7,
      suspects: [{ id: '835171', nextId: '835179', gap: 7, atMs: 1769222559570, nextAtMs: 1769222956730 }],
    })
  })

  it('answers a repeated fingerprint from memory and a new one from the database', async () => {
    const { db, executions } = stubDatabase([[], []])
    const query = createIdGapQuery(db)
    const first = await query.read('97043:1')
    expect(executions()).toBe(2)
    const again = await query.read('97043:1')
    expect(again).toBe(first)
    expect(executions()).toBe(2)
    await query.read('97093:2')
    expect(executions()).toBe(4)
  })
})
