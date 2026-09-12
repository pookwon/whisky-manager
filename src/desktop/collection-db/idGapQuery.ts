import { sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import { posts } from './schema.js'
import { SUSPECT_GAP_MIN, SUSPECT_LIST_LIMIT, summarizeIdGaps, type IdGapHistogramRow, type IdGapReport, type IdGapRow } from './idGapReport.js'

export interface IdGapQuery {
  /**
   * `fingerprint` names the table's contents as the caller already knows them
   * — the post count and the latest snapshot time do — so a screen refresh
   * that changed nothing does not pay for a walk over every stored id.
   */
  read(fingerprint: string): Promise<IdGapReport>
}

type HistogramRow = {
  readonly gap: string | number
  readonly occurrences: string | number
}

type SuspectRow = {
  readonly id: string
  readonly next_id: string
  readonly gap: string | number
  readonly at_seconds: string | number
  readonly next_at_seconds: string | number
}

function secondsToMs(value: string | number): number {
  return Math.round(Number(value) * 1000)
}

export function createIdGapQuery(db: CollectionDatabase): IdGapQuery {
  let cached: { readonly fingerprint: string; readonly report: IdGapReport } | null = null

  // One neighbour per stored id, by id. Ids are stored as text and compared as
  // numbers here, because '99' sorts after '100' as text.
  const neighbours = sql`
    select ${posts.postId}::bigint as id,
           ${posts.postedAt} as at,
           lead(${posts.postId}::bigint) over (order by ${posts.postId}::bigint) as next_id,
           lead(${posts.postedAt}) over (order by ${posts.postId}::bigint) as next_at
    from ${posts}`

  return {
    async read(fingerprint) {
      if (cached !== null && cached.fingerprint === fingerprint) return cached.report

      const [histogram, suspects] = await Promise.all([
        db.execute<HistogramRow>(sql`
          with g as (${neighbours})
          select next_id - id - 1 as gap, count(*) as occurrences
          from g
          where next_id - id - 1 > 0
          group by 1`),
        db.execute<SuspectRow>(sql`
          with g as (${neighbours})
          select id::text as id, next_id::text as next_id, next_id - id - 1 as gap,
                 extract(epoch from at) as at_seconds, extract(epoch from next_at) as next_at_seconds
          from g
          where next_id - id - 1 >= ${SUSPECT_GAP_MIN}
          order by gap desc, at desc
          limit ${SUSPECT_LIST_LIMIT}`),
      ])

      const histogramRows: IdGapHistogramRow[] = histogram.rows.map((row) => ({
        gap: Number(row.gap),
        occurrences: Number(row.occurrences),
      }))
      const suspectRows: IdGapRow[] = suspects.rows.map((row) => ({
        id: row.id,
        nextId: row.next_id,
        gap: Number(row.gap),
        atMs: secondsToMs(row.at_seconds),
        nextAtMs: secondsToMs(row.next_at_seconds),
      }))

      const report = summarizeIdGaps(histogramRows, suspectRows)
      cached = { fingerprint, report }
      return report
    },
  }
}
