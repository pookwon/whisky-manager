import type { RenderOutcome } from '../../templates.js'

/**
 * The reminder is fixed operator wording, the same for every post that forgot a
 * prefix, so there is nothing to substitute and no template to draw from — hence
 * `templateId: null`. Empty wording is a refusal, not an empty comment: a run
 * with no text configured posts nothing rather than an empty line, and the
 * automation reports itself as having no wording to say.
 */
export function renderPrefixReminder(commentText: string): RenderOutcome {
  const body = commentText.trim()
  return body === '' ? { ok: false, missing: ['comment'] } : { ok: true, templateId: null, body }
}
