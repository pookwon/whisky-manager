import type { Guard, GuardOutcome } from '../../guards.js'
import { joinDateToKstDay, kstDayOf } from '../../kst.js'

/**
 * Greets only members who joined recently. Join dates carry no time, so the
 * window is counted in whole KST calendar days and never in hours. The window
 * is measured from the day the session runs, not the day the post was written.
 *
 * The judgement uses the member list as the only basis. An absent member is
 * treated as having joined outside the window (because the list covers the
 * window), and a present member's eligibility depends on their recorded join date.
 */
export const newMemberGuard: Guard = (candidate, ctx): GuardOutcome => {
  if (ctx.authorMembership.kind === 'NOT_TRACKED') {
    return { kind: 'SKIP', reason: 'NOT_NEW_MEMBER' }
  }
  const joinDay = joinDateToKstDay(ctx.authorMembership.joinDate)
  // The parser only stores dates it could read, so this means the stored shape
  // changed under us rather than that the member is old.
  if (joinDay === null) return { kind: 'RISK', flag: 'STRUCTURE_CHANGED' }

  const nowDay = kstDayOf(ctx.nowMs)
  return nowDay - joinDay <= ctx.newMemberWindowDays
    ? null
    : { kind: 'SKIP', reason: 'NOT_NEW_MEMBER' }
}
