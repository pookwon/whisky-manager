import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFIX_REMINDER_OPTIONS,
  parsePrefixReminderOptions,
  serializePrefixReminderOptions,
} from '../../../../src/shared/automations/prefix-reminder/options.js'

describe('parsePrefixReminderOptions', () => {
  it('reads what was stored', () => {
    expect(parsePrefixReminderOptions('{"commentText":"말머리를 골라 주세요","excludedBoardIds":["147","1"]}'))
      .toEqual({ commentText: '말머리를 골라 주세요', excludedBoardIds: ['147', '1'] })
  })
  it('falls back to defaults on broken json', () => {
    expect(parsePrefixReminderOptions('{nope')).toEqual(DEFAULT_PREFIX_REMINDER_OPTIONS)
    expect(parsePrefixReminderOptions('')).toEqual(DEFAULT_PREFIX_REMINDER_OPTIONS)
  })
  it('keeps only digit board ids, trimmed and deduplicated', () => {
    expect(parsePrefixReminderOptions('{"excludedBoardIds":[" 147 ","abc","147",12]}').excludedBoardIds).toEqual(['147'])
  })
  it('round-trips through serialize', () => {
    const options = { commentText: 'x', excludedBoardIds: ['1', '2'] }
    expect(parsePrefixReminderOptions(serializePrefixReminderOptions(options))).toEqual(options)
  })
})
