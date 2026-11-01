import type { StudioJoinMember } from './studioJoinList.js'
import { TEXT } from './text.js'

/** Excel reads a BOM-less UTF-8 file as the system code page, and Hangul breaks. */
const BYTE_ORDER_MARK = '﻿'

/** A spreadsheet runs a cell starting with these, and nicknames are anyone's to choose. */
const FORMULA_START = /^[=+\-@\t\r]/

function cell(value: string | number): string {
  const raw = String(value)
  const text = typeof value === 'string' && FORMULA_START.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function row(member: StudioJoinMember): readonly (string | number)[] {
  return [
    member.joinedAt.slice(0, 19).replace('T', ' '),
    member.nickname,
    member.memberTag,
    member.maskedMemberId,
    member.levelName,
    member.answers[0] ?? '',
    member.answers[1] ?? '',
    member.answers[2] ?? '',
    member.visitCount,
    member.articleCount,
    member.commentCount,
    member.activityStopped ? TEXT.joinPattern.stopped : '',
    member.memberKey,
  ]
}

export function joinPatternCsv(members: readonly StudioJoinMember[]): string {
  const lines = [TEXT.joinPattern.csvHeader, ...members.map(row)]
  return `${BYTE_ORDER_MARK}${lines.map((line) => line.map(cell).join(',')).join('\r\n')}\r\n`
}
