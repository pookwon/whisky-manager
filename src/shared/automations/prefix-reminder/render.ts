import { renderTemplate, type RenderOutcome } from '../../templates.js'
import type { Candidate } from '../../types.js'

/**
 * The nickname variable, accepted in both spellings. `{닉네임}` is what the
 * greeting automation's hint teaches, so an operator who learned it there
 * writes the same thing here; `{nickname}` is what an operator who reached for
 * a variable without reading either hint actually types. Neither spelling is
 * more correct than the other, and refusing one would be a rule to memorise
 * rather than anything the tool needs.
 */
const NICKNAME_VARIABLES = ['닉네임', 'nickname'] as const

/**
 * The reminder is operator wording rather than a drawn template — hence
 * `templateId: null` — but it may name the author it is aimed at, which is the
 * one thing about a missing-prefix post the operator cannot type in advance.
 *
 * Empty wording is a refusal, not an empty comment: a run with no text
 * configured posts nothing rather than an empty line.
 *
 * A post whose nickname could not be read falls back to `nicknameFallback`, and
 * a blank one is a refusal — for the same reason the greeting refuses one. The
 * screening turns it into a risk flag and the post waits for a person, where
 * posting it would leave "님, 말머리를 골라 주세요" under someone's post. Blank
 * therefore means "do not guess", which is what an operator who never opened
 * the field has.
 */
export function renderPrefixReminder(
  commentText: string,
  nicknameFallback: string,
  candidate: Candidate,
): RenderOutcome {
  const body = commentText.trim()
  if (body === '') return { ok: false, missing: ['comment'] }

  // The fallback stands in only for a name that could not be read, never for
  // one that could: a post that names its author is never addressed as 회원님.
  const nickname = candidate.authorNickname ?? nicknameFallback
  const result = renderTemplate(
    body,
    Object.fromEntries(NICKNAME_VARIABLES.map((name) => [name, nickname])),
  )
  return result.ok
    ? { ok: true, templateId: null, body: result.text }
    : { ok: false, missing: result.missing }
}
