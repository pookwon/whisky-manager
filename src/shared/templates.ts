import type { Random } from './ports.js'
import type { Template } from './types.js'

const PLACEHOLDER = /\{([^{}]+)\}/g

/**
 * One registered template means that template; several means a uniform draw.
 * The operator controls variety by how many they register, not by a mode flag.
 */
export function pickTemplate(templates: readonly Template[], random: Random): Template | null {
  if (templates.length === 0) return null
  if (templates.length === 1) return templates[0] ?? null
  const index = random.intInclusive(0, templates.length - 1)
  return templates[index] ?? null
}

export type RenderResult = { ok: true; text: string } | { ok: false; missing: string[] }

/**
 * Substitution fails loudly rather than posting a half-filled template. An
 * empty value counts as missing: "님 환영합니다" reads as broken to a member.
 */
export function renderTemplate(body: string, vars: Readonly<Record<string, string>>): RenderResult {
  const missing: string[] = []

  const text = body.replace(PLACEHOLDER, (_match, rawName: string) => {
    const name = rawName.trim()
    const value = vars[name]
    if (value === undefined || value === '') {
      if (!missing.includes(name)) missing.push(name)
      return ''
    }
    return value
  })

  return missing.length > 0 ? { ok: false, missing } : { ok: true, text }
}
