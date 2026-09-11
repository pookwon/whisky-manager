import type { Limits, Profile } from '../../types.js'

const HOUR = 3_600_000

/**
 * Only the session interval differs from the shared profile; everything else a
 * greeting uses fits a reminder too. A partial override, merged over the profile
 * at the call site, so a change to caps or the operating window is inherited
 * rather than copied.
 */
export const PREFIX_REMINDER_LIMITS: Record<Profile, Partial<Limits>> = {
  // Two hours give or take half: the board fills through the day and a reminder
  // hours late still reaches a post that is still on the first page.
  production: { sessionIntervalMinMs: 1.5 * HOUR, sessionIntervalMaxMs: 2.5 * HOUR },
  debug: {},
}
