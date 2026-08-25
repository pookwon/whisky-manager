import type { Limits, Profile } from './types.js'

const SECOND = 1_000
const MINUTE = 60_000
const HOUR = 3_600_000

const SHARED = {
  // Drawn per hour rather than per day because that is the stretch steady
  // operation is judged over. The figure has to cover a board's busiest hour —
  // signups arrive in bursts, not evenly — while keeping a catch-up run from
  // emptying a backlog in one sitting.
  hourlyCap: 150,
  // Signups barely arrive before mid-morning, and a greeting posted to an
  // empty board is one nobody is there to read.
  activeHourStart: 10,
  activeHourEnd: 24,
  weekendIntervalMultiplier: 1.5,
  backlogMaxAgeMs: 24 * HOUR,
  approvalTtlMs: 48 * HOUR,
  maxAttempts: 3,
} as const

export const PROFILES: Record<Profile, Limits> = {
  /**
   * Four sessions across the operating window, each able to clear well over a
   * day's greetings on its own. The intervals are bands rather than fixed
   * numbers because a tool that knocks on the exact same minute reads as one.
   */
  production: {
    ...SHARED,
    // Four hours, give or take an hour.
    sessionIntervalMinMs: 3 * HOUR,
    sessionIntervalMaxMs: 5 * HOUR,
    // Roughly forty seconds apart, so a full session spreads over about an
    // hour instead of arriving as one burst.
    actionIntervalMinMs: 20 * SECOND,
    actionIntervalMaxMs: 60 * SECOND,
    // Around 150 greetings a day over four sessions is under forty each; the
    // headroom is for a day the tool was off.
    perSessionCap: 75,
  },
  debug: {
    ...SHARED,
    sessionIntervalMinMs: 2 * MINUTE,
    sessionIntervalMaxMs: 4 * MINUTE,
    actionIntervalMinMs: 3 * SECOND,
    actionIntervalMaxMs: 8 * SECOND,
    perSessionCap: 5,
  },
}
