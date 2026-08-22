import type { Limits, Profile } from './types.js'

const SECOND = 1_000
const MINUTE = 60_000
const HOUR = 3_600_000

const SHARED = {
  activeHourStart: 8,
  activeHourEnd: 24,
  weekendIntervalMultiplier: 1.5,
  backlogMaxAgeMs: 24 * HOUR,
  approvalTtlMs: 48 * HOUR,
  maxAttempts: 3,
} as const

export const PROFILES: Record<Profile, Limits> = {
  production: {
    ...SHARED,
    sessionIntervalMinMs: 45 * MINUTE,
    sessionIntervalMaxMs: 75 * MINUTE,
    actionIntervalMinMs: 8 * SECOND,
    actionIntervalMaxMs: 25 * SECOND,
    perSessionCap: 15,
    dailyCap: 200,
  },
  debug: {
    ...SHARED,
    sessionIntervalMinMs: 2 * MINUTE,
    sessionIntervalMaxMs: 4 * MINUTE,
    actionIntervalMinMs: 3 * SECOND,
    actionIntervalMaxMs: 8 * SECOND,
    perSessionCap: 5,
    dailyCap: 200,
  },
}
