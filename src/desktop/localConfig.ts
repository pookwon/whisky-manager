import { readFileSync } from 'node:fs'

/**
 * Which cafe a development machine works against.
 *
 * The source ships none of this. A cafe compiled into the tool would point
 * every build at whoever wrote it, so the operator enters it in the settings
 * screen and it lives in their database. That leaves developers re-typing the
 * same board into every fresh database, which this file spares them — and only
 * them: it is read on unpackaged runs alone, and it is not in the repository.
 *
 * See `config/local.example.json` for the shape.
 */
export interface LocalConfig {
  readonly cafeId?: string | undefined
  readonly boardId?: string | undefined
  readonly cafeUrlName?: string | undefined
}

/** Null when there is no such file, or when it is not readable as this shape. */
export function readLocalConfig(path: string): LocalConfig | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    // Absent is the ordinary case — every machine but a developer's own.
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const pick = (key: string): string | undefined =>
      typeof record[key] === 'string' && record[key].trim() !== '' ? record[key].trim() : undefined
    return { cafeId: pick('cafeId'), boardId: pick('boardId'), cafeUrlName: pick('cafeUrlName') }
  } catch {
    // A malformed file is worth saying out loud: it was put there on purpose
    // and is silently doing nothing.
    console.warn(`[local-config] ${path} is not valid JSON; ignoring it`)
    return null
  }
}
