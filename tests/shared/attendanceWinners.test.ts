import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAttendanceWinners } from '../../src/shared/attendanceWinners.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')

describe('parseAttendanceWinners', () => {
  it('reads the nicknames in the order the post names them', () => {
    expect(parseAttendanceWinners(fixture('attendance-body.html')))
      .toEqual({ ok: true, nicknames: ['가상하나', '두 번째 회원', '선생님', 'A&B', 'tester01'] })
  })

  it('reads a single winner', () => {
    expect(parseAttendanceWinners('<p> 혼자님이 당첨 되셨습니다. 축하드려요! </p>')).toEqual({ ok: true, nicknames: ['혼자'] })
  })

  it('reads thousands of winners', () => {
    const names = Array.from({ length: 8000 }, (_, i) => `회원${i}`)
    const html = `<p> ${names.map((n) => `${n}님`).join(', ')}이 당첨 되셨습니다. 축하드려요! </p>`
    expect(parseAttendanceWinners(html)).toEqual({ ok: true, nicknames: names })
  })

  it('refuses a body it cannot be sure of', () => {
    expect(parseAttendanceWinners('<p> 이번 회차는 당첨자가 없습니다. </p>')).toEqual({ ok: false, rule: 'NO_CLOSING_PHRASE' })
    expect(parseAttendanceWinners('<p> 님이 당첨 되셨습니다. </p>')).toEqual({ ok: false, rule: 'NO_WINNERS' })
    expect(parseAttendanceWinners('<p> 가상하나님, 님, 가상둘님이 당첨 되셨습니다. </p>')).toEqual({ ok: false, rule: 'EMPTY_NICKNAME' })
    expect(parseAttendanceWinners('<p> 가상하나님, &nbsp;님, 가상둘님이 당첨 되셨습니다. </p>')).toEqual({ ok: false, rule: 'EMPTY_NICKNAME' })
    expect(parseAttendanceWinners('')).toEqual({ ok: false, rule: 'NO_CLOSING_PHRASE' })
  })
})
