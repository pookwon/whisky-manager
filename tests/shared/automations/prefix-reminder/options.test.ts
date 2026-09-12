import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NICKNAME_FALLBACK,
  DEFAULT_PREFIX_REMINDER_OPTIONS,
  parsePrefixReminderOptions,
  serializePrefixReminderOptions,
} from '../../../../src/shared/automations/prefix-reminder/options.js'

describe('parsePrefixReminderOptions', () => {
  it('reads what was stored', () => {
    expect(
      parsePrefixReminderOptions(
        '{"commentText":"말머리를 골라 주세요","nicknameFallback":"손님","excludedBoardIds":["147","1"]}',
      ),
    ).toEqual({
      commentText: '말머리를 골라 주세요',
      nicknameFallback: '손님',
      excludedBoardIds: ['147', '1'],
    })
  })
  it('falls back to defaults on broken json', () => {
    expect(parsePrefixReminderOptions('{nope')).toEqual(DEFAULT_PREFIX_REMINDER_OPTIONS)
    expect(parsePrefixReminderOptions('')).toEqual(DEFAULT_PREFIX_REMINDER_OPTIONS)
  })
  it('keeps only digit board ids, trimmed and deduplicated', () => {
    expect(parsePrefixReminderOptions('{"excludedBoardIds":[" 147 ","abc","147",12]}').excludedBoardIds).toEqual(['147'])
  })
  it('round-trips through serialize', () => {
    const options = { commentText: 'x', nicknameFallback: '회원', excludedBoardIds: ['1', '2'] }
    expect(parsePrefixReminderOptions(serializePrefixReminderOptions(options))).toEqual(options)
  })

  it('gives a blob written before the field existed the default fallback', () => {
    // Nobody decided anything about a key that was not there to decide about,
    // so the reminder goes out on its own rather than parking every post whose
    // author it could not read.
    expect(parsePrefixReminderOptions('{"commentText":"x"}').nicknameFallback).toBe(
      DEFAULT_NICKNAME_FALLBACK,
    )
    expect(DEFAULT_PREFIX_REMINDER_OPTIONS.nicknameFallback).toBe(DEFAULT_NICKNAME_FALLBACK)
  })

  it('keeps a fallback the operator cleared cleared', () => {
    // Present and blank is a decision, and the opposite one: do not guess.
    // Reading it as the default would put the word back every time the options
    // were reloaded, and no amount of clearing would stick.
    expect(parsePrefixReminderOptions('{"nicknameFallback":""}').nicknameFallback).toBe('')
    expect(parsePrefixReminderOptions('{"nicknameFallback":"   "}').nicknameFallback).toBe('')
  })

  it('trims the fallback, like the comment text', () => {
    expect(parsePrefixReminderOptions('{"nicknameFallback":"  회원  "}').nicknameFallback).toBe('회원')
  })

  it('reads a fallback that is not text at all as the default', () => {
    expect(parsePrefixReminderOptions('{"nicknameFallback":42}').nicknameFallback).toBe(
      DEFAULT_NICKNAME_FALLBACK,
    )
  })
})
