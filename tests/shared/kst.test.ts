import { describe, expect, it } from 'vitest'
import { joinDateToKstDay, kstDayOf, kstDayToJoinDate } from '../../src/shared/kst.js'

describe('kstDayOf', () => {
  it('counts the KST calendar day, not the UTC one', () => {
    // 2026-08-23 00:30 KST and 2026-08-23 23:00 KST are the same KST day,
    // but they fall on different UTC days.
    const justAfterKstMidnight = Date.UTC(2026, 7, 22, 15, 30)
    const lateSameKstDay = Date.UTC(2026, 7, 23, 14, 0)
    expect(kstDayOf(justAfterKstMidnight)).toBe(kstDayOf(lateSameKstDay))
  })

  it('agrees with the join date the cafe sends for that day', () => {
    expect(kstDayOf(Date.UTC(2026, 7, 22, 15, 30))).toBe(joinDateToKstDay('2026.08.23.'))
  })
})

describe('joinDateToKstDay', () => {
  it('counts one day between consecutive dates', () => {
    const earlier = joinDateToKstDay('2026.08.22.')
    const later = joinDateToKstDay('2026.08.23.')
    expect(later).not.toBeNull()
    expect(earlier).not.toBeNull()
    expect((later as number) - (earlier as number)).toBe(1)
  })

  it('rejects anything that is not the cafe shape', () => {
    expect(joinDateToKstDay('2026-08-23')).toBeNull()
    expect(joinDateToKstDay('2026.8.23.')).toBeNull()
    expect(joinDateToKstDay('')).toBeNull()
  })
})

describe('kstDayToJoinDate', () => {
  it('round-trips a join date string', () => {
    const day = joinDateToKstDay('2026.08.23.')
    expect(day).not.toBeNull()
    expect(kstDayToJoinDate(day as number)).toBe('2026.08.23.')
  })

  it('pads single digit months and days', () => {
    const day = joinDateToKstDay('2026.01.05.')
    expect(kstDayToJoinDate(day as number)).toBe('2026.01.05.')
  })
})
