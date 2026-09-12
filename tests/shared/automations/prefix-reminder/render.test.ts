import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFIX_REMINDER_OPTIONS } from '../../../../src/shared/automations/prefix-reminder/options.js'
import { renderPrefixReminder } from '../../../../src/shared/automations/prefix-reminder/render.js'
import type { Candidate } from '../../../../src/shared/types.js'

/** What an operator who cleared the fallback field has configured: do not guess. */
const NO_FALLBACK = ''

function candidate(authorNickname: string | null): Candidate {
  return {
    automationId: 'prefix-reminder',
    cafeId: '10000000',
    boardId: '5',
    postId: '1001',
    title: null,
    bodyText: null,
    authorNickname,
    authorId: 'm1',
    postedAt: 0,
    prefix: null,
  }
}

describe('renderPrefixReminder', () => {
  it('refuses when no comment text is configured', () => {
    expect(renderPrefixReminder('', NO_FALLBACK, candidate('왕밤이'))).toEqual({
      ok: false,
      missing: ['comment'],
    })
    expect(renderPrefixReminder('   ', NO_FALLBACK, candidate('왕밤이'))).toEqual({
      ok: false,
      missing: ['comment'],
    })
  })

  it('posts the configured text with no template behind it', () => {
    expect(renderPrefixReminder('  말머리를 골라 주세요  ', NO_FALLBACK, candidate('왕밤이'))).toEqual({
      ok: true,
      templateId: null,
      body: '말머리를 골라 주세요',
    })
  })

  it('fills the nickname in, spelled the way the greeting automation spells it', () => {
    expect(
      renderPrefixReminder('{닉네임}님, 말머리를 골라 주세요', NO_FALLBACK, candidate('왕밤이')),
    ).toEqual({ ok: true, templateId: null, body: '왕밤이님, 말머리를 골라 주세요' })
  })

  it('fills the nickname in when it is spelled in English', () => {
    expect(
      renderPrefixReminder('{nickname}님, 말머리를 골라 주세요', NO_FALLBACK, candidate('왕밤이')),
    ).toEqual({ ok: true, templateId: null, body: '왕밤이님, 말머리를 골라 주세요' })
  })

  it('accepts both spellings in one wording', () => {
    expect(renderPrefixReminder('{닉네임}님 = {nickname}님', NO_FALLBACK, candidate('왕밤이'))).toEqual({
      ok: true,
      templateId: null,
      body: '왕밤이님 = 왕밤이님',
    })
  })

  it('posts a wording that asks for no nickname even when none could be read', () => {
    expect(renderPrefixReminder('말머리를 골라 주세요', NO_FALLBACK, candidate(null))).toEqual({
      ok: true,
      templateId: null,
      body: '말머리를 골라 주세요',
    })
  })

  describe('when the nickname cannot be read', () => {
    it('goes out under the shipped fallback, so nobody has to find the field', () => {
      // The default is a word rather than nothing: an operator who never opens
      // the field still gets the reminder posted, which is the whole point of
      // the automation. Substituted means no risk flag, so AUTO posts it and
      // MANUAL parks the finished text for the operator to read and approve.
      expect(
        renderPrefixReminder(
          '{닉네임}님, 말머리를 골라 주세요',
          DEFAULT_PREFIX_REMINDER_OPTIONS.nicknameFallback,
          candidate(null),
        ),
      ).toEqual({ ok: true, templateId: null, body: '회원님, 말머리를 골라 주세요' })
    })

    it('parks the post when the operator cleared the fallback', () => {
      // Blank is the deliberate opposite of the default: do not guess. The
      // missing variable becomes VARIABLE_EXTRACTION_FAILED in screening, so
      // the post waits for a person rather than getting a comment with a hole
      // where the name should be.
      expect(
        renderPrefixReminder('{닉네임}님, 말머리를 골라 주세요', NO_FALLBACK, candidate(null)),
      ).toEqual({ ok: false, missing: ['닉네임'] })
      expect(
        renderPrefixReminder('{nickname}님, 말머리를 골라 주세요', NO_FALLBACK, candidate(null)),
      ).toEqual({ ok: false, missing: ['nickname'] })
    })

    it('uses the fallback the operator set, in either spelling', () => {
      expect(renderPrefixReminder('{닉네임}님, 말머리를 골라 주세요', '회원', candidate(null))).toEqual({
        ok: true,
        templateId: null,
        body: '회원님, 말머리를 골라 주세요',
      })
      expect(renderPrefixReminder('{nickname}님, 말머리를 골라 주세요', '회원', candidate(null))).toEqual({
        ok: true,
        templateId: null,
        body: '회원님, 말머리를 골라 주세요',
      })
    })
  })

  it('ignores the fallback when the post carries a readable nickname', () => {
    expect(renderPrefixReminder('{닉네임}님, 말머리를 골라 주세요', '회원', candidate('왕밤이'))).toEqual({
      ok: true,
      templateId: null,
      body: '왕밤이님, 말머리를 골라 주세요',
    })
  })
})
