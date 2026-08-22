import { and, asc, eq } from 'drizzle-orm'
import type { Template } from '../../shared/types.js'
import type { AppDatabase } from './client.js'
import { templates } from './schema.js'

export interface AddTemplateInput {
  readonly id: string
  readonly automationId: string
  readonly body: string
  readonly createdAt: number
}

export interface TemplatesRepo {
  listEnabled(automationId: string): Template[]
  add(input: AddTemplateInput): void
  setEnabled(id: string, enabled: boolean): void
  remove(id: string): void
}

export function createTemplatesRepo(db: AppDatabase): TemplatesRepo {
  return {
    listEnabled(automationId) {
      return db
        .select()
        .from(templates)
        .where(and(eq(templates.automationId, automationId), eq(templates.enabled, true)))
        .orderBy(asc(templates.createdAt))
        .all()
        .map((r) => ({ id: r.id, body: r.body }))
    },
    add(input) {
      db.insert(templates)
        .values({
          id: input.id,
          automationId: input.automationId,
          body: input.body,
          enabled: true,
          createdAt: input.createdAt,
        })
        .run()
    },
    setEnabled(id, enabled) {
      db.update(templates).set({ enabled }).where(eq(templates.id, id)).run()
    },
    remove(id) {
      db.delete(templates).where(eq(templates.id, id)).run()
    },
  }
}
