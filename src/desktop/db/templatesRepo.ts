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

/** A template as it sits in the table, disabled ones included. */
export interface StoredTemplate {
  readonly id: string
  readonly body: string
  readonly enabled: boolean
  readonly createdAt: number
}

export interface TemplatesRepo {
  listEnabled(automationId: string): Template[]
  /**
   * Every template this automation has, oldest first — disabled ones too.
   * Export needs them: a template the operator switched off is still a choice
   * they made, and dropping it would make "the same settings" untrue.
   */
  listAll(automationId: string): StoredTemplate[]
  add(input: AddTemplateInput): void
  /**
   * Swaps this automation's whole set for another one, atomically. Ids and
   * timestamps come from the caller because they are the caller's to decide:
   * an imported template is new to this database and gets a new identity here.
   */
  replaceAll(automationId: string, entries: readonly StoredTemplate[]): void
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
    listAll(automationId) {
      return db
        .select()
        .from(templates)
        .where(eq(templates.automationId, automationId))
        .orderBy(asc(templates.createdAt))
        .all()
        .map((r) => ({ id: r.id, body: r.body, enabled: r.enabled, createdAt: r.createdAt }))
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
    replaceAll(automationId, entries) {
      // One unit: an interrupted swap that had deleted but not yet inserted
      // would leave the automation with no templates at all, and a session
      // that refuses every candidate for a reason nobody chose.
      db.transaction((tx) => {
        tx.delete(templates).where(eq(templates.automationId, automationId)).run()
        for (const entry of entries) {
          tx.insert(templates)
            .values({
              id: entry.id,
              automationId,
              body: entry.body,
              enabled: entry.enabled,
              createdAt: entry.createdAt,
            })
            .run()
        }
      })
    },
    setEnabled(id, enabled) {
      db.update(templates).set({ enabled }).where(eq(templates.id, id)).run()
    },
    remove(id) {
      db.delete(templates).where(eq(templates.id, id)).run()
    },
  }
}
