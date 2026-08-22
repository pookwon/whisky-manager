import type { Config } from 'drizzle-kit'

export default {
  schema: './src/desktop/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
} satisfies Config
