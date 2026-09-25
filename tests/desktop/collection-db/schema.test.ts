import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDirectory = fileURLToPath(new URL('../../../drizzle-collection', import.meta.url))
const migration = readFileSync(
  `${migrationsDirectory}/${readdirSync(migrationsDirectory).find((name) => /^0000_.*\.sql$/.test(name)) ?? 'missing.sql'}`,
  'utf8',
)
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
) as { build: { files: string[] } }

describe('collection PostgreSQL schema migration', () => {
  it('holds one cafe per database, so no table carries a cafe column', () => {
    for (const table of ['boards', 'posts', 'runs', 'feed_state']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
    }
    // The cafe is the database's own scope. A column repeated on every row
    // would be carried, indexed and joined on forever for a value that never
    // varies; a second cafe gets a second database instead.
    expect(migration).not.toContain('"cafe_id"')
    expect(migration).toContain('REFERENCES "public"."boards"')
    expect(migration).toContain('REFERENCES "public"."runs"')
  })

  it('keeps a post and its latest reading in one row', () => {
    // Splitting the counters out only earns its keep when the same post is read
    // many times and the growth between readings is the point. This collection
    // reads a post to know where it stands, so the reading lives on the post.
    expect(migration).toContain('"view_count" bigint')
    expect(migration).toContain('"comment_count" bigint')
    expect(migration).toContain('"snapshot_at" timestamp')
    expect(migration).not.toContain('post_metric_observations')
  })

  it('enforces running-feed exclusivity and the cursor invariants in PostgreSQL', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "runs_one_running_feed"')
    expect(migration).toContain('WHERE "runs"."status" = \'running\'')
    expect(migration).toContain('CONSTRAINT "feed_state_version" CHECK')
    expect(migration).toContain('runs_target_range')
    expect(migration).toContain('runs_nonnegative_counts')
    expect(migration).toContain("ENUM('development', 'backfill', 'incremental')")
  })

  it('packages collection migrations with the Electron app', () => {
    expect(packageJson.build.files).toContain('drizzle-collection/**/*')
  })
})

const migrationNumbered = (number: string) =>
  readFileSync(`${migrationsDirectory}/${readdirSync(migrationsDirectory).find((name) => name.startsWith(`${number}_`) && name.endsWith('.sql')) ?? 'missing.sql'}`, 'utf8')

describe('board search migration', () => {
  const sqlText = migrationNumbered('0007')

  it('adds the search state table keyed by board and query', () => {
    expect(sqlText).toContain('CREATE TABLE "board_search_state"')
    expect(sqlText).toContain('"board_search_state_pkey" PRIMARY KEY("board_id","query")')
    expect(sqlText).toContain('REFERENCES "public"."boards"')
    expect(sqlText).toContain('REFERENCES "public"."runs"')
  })

  it('lets a run name the search it walked', () => {
    expect(sqlText).toContain("ADD VALUE 'board_search'")
    expect(sqlText).toContain('ADD COLUMN "search_query" text')
  })
})

describe('board search segment migration', () => {
  const sqlText = migrationNumbered('0008')

  it('adds the end of the window a query is walking, inside the job window', () => {
    expect(sqlText).toContain('ALTER TABLE "board_search_state" ADD COLUMN "segment_to_day" text;')
    expect(sqlText).toContain('ADD CONSTRAINT "board_search_state_segment" CHECK')
    expect(sqlText).toContain('"board_search_state"."segment_to_day" is null or')
  })

  it('only adds: an operator migrates a live database by hand', () => {
    expect(sqlText).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER COLUMN/)
  })
})
