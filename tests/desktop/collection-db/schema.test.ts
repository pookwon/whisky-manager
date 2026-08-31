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
