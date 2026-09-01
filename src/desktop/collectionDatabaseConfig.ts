import { readFileSync, writeFileSync } from 'node:fs'
import { collectionDatabaseUrl } from './collection-db/client.js'

/**
 * Where the installed build is told which PostgreSQL to collect into.
 *
 * `DATABASE_URL` alone cannot reach it. A packaged app opened from Finder or
 * started as a login item inherits no shell, so the variable is always absent
 * there and the collection screen could only ever report it as unset — no
 * matter that the database was sitting on the same machine. This file is how
 * the installed build hears about it, and the variable still wins so a
 * development run can point one launch somewhere else.
 *
 * The URL holds a password and stays in the main process, the same rule the
 * environment variable it stands in for already follows.
 */
const CONFIG_TEMPLATE = `{
  "_comment": "수집 DB 연결 문자열. 예: postgresql://사용자@127.0.0.1:5432/whisky_manager_collection",
  "databaseUrl": ""
}
`

/** Null when there is no such file, or when it holds no usable URL. */
export function readCollectionDatabaseConfig(path: string): string | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    // Absent is the ordinary case: collection storage is optional.
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const value = (parsed as Record<string, unknown>).databaseUrl
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  } catch {
    // Worth saying out loud: the file was put there on purpose and is doing
    // nothing. The path is named, never the contents.
    console.warn(`[collection-config] ${path} is not valid JSON; ignoring it`)
    return null
  }
}

/**
 * Leaves an empty file for the operator to fill in, so opening the setting
 * from the tray lands on the shape it expects rather than on nothing. An
 * existing file is never touched — it is the only copy of the URL.
 */
export function ensureCollectionDatabaseConfig(path: string): void {
  try {
    writeFileSync(path, CONFIG_TEMPLATE, { encoding: 'utf8', flag: 'wx' })
  } catch {
    // Already there, or the directory is not writable. Either way the caller
    // opens what exists and the operator sees the result.
  }
}

/** The environment wins; the file is what an installed build actually has. */
export function resolveCollectionDatabaseUrl(
  environment: NodeJS.ProcessEnv,
  configPath?: string,
): string | null {
  const fromEnvironment = collectionDatabaseUrl(environment)
  if (fromEnvironment !== null) return fromEnvironment
  return configPath === undefined ? null : readCollectionDatabaseConfig(configPath)
}
