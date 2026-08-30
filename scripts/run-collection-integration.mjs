/** Runs destructive-cleanup integration tests only against an explicitly named test database. */
import { spawnSync } from 'node:child_process'

if (process.env.COLLECTION_TEST_DATABASE_URL?.trim() === undefined || process.env.COLLECTION_TEST_DATABASE_URL.trim() === '') {
  console.error('COLLECTION_TEST_DATABASE_URL is required; no PostgreSQL integration test was run.')
  process.exit(1)
}

const result = spawnSync('pnpm', ['vitest', 'run', 'tests/desktop/collection-db/integration.test.ts'], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)
