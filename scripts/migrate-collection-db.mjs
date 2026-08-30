/** Applies the separately packaged PostgreSQL collection migrations. */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'

const databaseUrl = process.env.COLLECTION_MIGRATION_DATABASE_URL?.trim()
if (databaseUrl === undefined || databaseUrl === '') {
  console.error('COLLECTION_MIGRATION_DATABASE_URL is required to apply collection migrations.')
  process.exit(1)
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 })
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../drizzle-collection', import.meta.url)),
  })
  console.log('PostgreSQL collection migrations applied.')
} finally {
  await pool.end()
}
