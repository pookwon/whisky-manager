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
  it('keeps collection tables out of the SQLite migration folder and defines all collection relations', () => {
    for (const table of ['cafe_boards', 'cafe_posts', 'post_metric_observations', 'collection_runs', 'collection_feed_state']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
    }
    expect(migration).toContain('FOREIGN KEY ("cafe_id","board_id") REFERENCES "public"."cafe_boards"')
    expect(migration).toContain('FOREIGN KEY ("cafe_id","post_id") REFERENCES "public"."cafe_posts"')
  })

  it('enforces running-feed exclusivity, state-version constraints, and metric idempotency in PostgreSQL', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "collection_runs_one_running_feed"')
    expect(migration).toContain('WHERE "collection_runs"."status" = \'running\'')
    expect(migration).toContain('CONSTRAINT "collection_feed_state_version" CHECK')
    expect(migration).toContain('CREATE UNIQUE INDEX "post_metric_observations_run_post_source"')
    expect(migration).toContain('collection_runs_target_range')
    expect(migration).toContain('collection_runs_nonnegative_counts')
    expect(migration).toContain("ENUM('development', 'backfill', 'incremental')")
    expect(migration).not.toContain('smoke_2026_07')
  })

  it('packages collection migrations with the Electron app', () => {
    expect(packageJson.build.files).toContain('drizzle-collection/**/*')
  })
})
