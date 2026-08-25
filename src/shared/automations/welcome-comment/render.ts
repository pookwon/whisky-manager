import type { Random } from '../../ports.js'
import { pickTemplate, renderTemplate, type RenderOutcome } from '../../templates.js'
import type { Candidate, Template } from '../../types.js'

/**
 * The one variable a greeting template may carry, written `{닉네임}`. Named
 * here rather than at the point of substitution because the wording shown to
 * the operator has to teach the same spelling the renderer accepts.
 */
export const NICKNAME_VARIABLE = '닉네임'

/**
 * The comment a run will leave on a post.
 *
 * Takes the enabled templates rather than reaching for them, which keeps it a
 * pure function of what the operator has registered.
 *
 * Not deterministic when several are registered: the draw is the point, so a
 * caller renders once and keeps the result rather than calling again and
 * getting a different comment.
 */
export function renderWelcomeComment(
  templates: readonly Template[],
  random: Random,
  candidate: Candidate,
): RenderOutcome {
  const template = pickTemplate(templates, random)
  if (template === null) return { ok: false, missing: ['template'] }
  return renderWith(template, candidate)
}

/**
 * Whether any registered wording could answer this post, and the first that can.
 *
 * What the count shown before a run screens through, in place of the draw the
 * run itself makes. A draw would make the panel disagree with itself — pressed
 * twice, with templates that need different variables, it would answer twice.
 * Worse, it could land on a template that fails where the run's lands on one
 * that succeeds, showing a smaller number than the run goes on to post. That is
 * the one direction a figure being approved against must never err in: an
 * operator may end up with fewer comments than they were shown, never more.
 */
export function renderAnyWelcomeComment(
  templates: readonly Template[],
  candidate: Candidate,
): RenderOutcome {
  // Nothing registered is its own answer: the run refuses outright and posts
  // nothing, so no post on the day is a target.
  let refusal: RenderOutcome = { ok: false, missing: ['template'] }

  for (const template of templates) {
    const outcome = renderWith(template, candidate)
    if (outcome.ok) return outcome
    refusal = outcome
  }
  return refusal
}

function renderWith(template: Template, candidate: Candidate): RenderOutcome {
  const result = renderTemplate(template.body, {
    [NICKNAME_VARIABLE]: candidate.authorNickname ?? '',
  })
  return result.ok
    ? { ok: true, templateId: template.id, body: result.text }
    : { ok: false, missing: result.missing }
}
