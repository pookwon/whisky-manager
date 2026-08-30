import { defineConfig } from 'drizzle-kit'

// Drizzle Kit's PostgreSQL config type requires a URL even for `generate`, but
// generation reads only this schema and never connects. Real migration is kept
// in scripts/migrate-collection-db.mjs and refuses to use this placeholder.
const databaseUrl = process.env.COLLECTION_MIGRATION_DATABASE_URL ?? 'postgresql://drizzle-generate-placeholder.invalid/collection'

export default defineConfig({
  schema: './src/desktop/collection-db/schema.ts',
  out: './drizzle-collection',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
})
