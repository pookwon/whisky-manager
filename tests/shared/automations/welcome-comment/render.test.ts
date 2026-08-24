import { describe, expect, it } from 'vitest'
import {
  renderAnyWelcomeComment,
  renderWelcomeComment,
} from '../../../../src/shared/automations/welcome-comment/render.js'
import type { Candidate, Template } from '../../../../src/shared/types.js'
import { SequenceRandom } from '../../../fakes.js'

const NAMED: Template = { id: 'named', body: '{닉네임}님 환영합니다' }
const PLAIN: Template = { id: 'plain', body: '환영합니다' }

function candidate(authorNickname: string | null): Candidate {
  return {
    automationId: 'welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    postId: '1001',
    title: null,
    bodyText: null,
    authorNickname,
    authorId: 'm1',
    postedAt: 0,
  }
}

describe('renderWelcomeComment — the comment a run posts', () => {
  it('fills the nickname in', () => {
    const outcome = renderWelcomeComment([NAMED], new SequenceRandom([0]), candidate('왕밤이'))
    expect(outcome).toEqual({ ok: true, templateId: 'named', body: '왕밤이님 환영합니다' })
  })

  it('refuses when nothing is registered', () => {
    expect(renderWelcomeComment([], new SequenceRandom([0]), candidate('왕밤이'))).toEqual({
      ok: false,
      missing: ['template'],
    })
  })

  it('fails rather than posting a greeting with the name missing', () => {
    expect(renderWelcomeComment([NAMED], new SequenceRandom([0]), candidate(null))).toEqual({
      ok: false,
      missing: ['닉네임'],
    })
  })

  it('draws between registered templates', () => {
    const first = renderWelcomeComment([NAMED, PLAIN], new SequenceRandom([0]), candidate('왕밤이'))
    const second = renderWelcomeComment([NAMED, PLAIN], new SequenceRandom([1]), candidate('왕밤이'))
    expect(first).toMatchObject({ templateId: 'named' })
    expect(second).toMatchObject({ templateId: 'plain' })
  })
})

describe('renderAnyWelcomeComment — what a count screens against', () => {
  it('refuses when nothing is registered, because a run would post nothing', () => {
    expect(renderAnyWelcomeComment([], candidate('왕밤이'))).toEqual({
      ok: false,
      missing: ['template'],
    })
  })

  it('answers the same way however the registered wordings are ordered', () => {
    // The run draws; a count must not, or the panel disagrees with itself when
    // pressed twice. Order is the only thing a draw could have keyed off here.
    const forward = renderAnyWelcomeComment([NAMED, PLAIN], candidate(null))
    const reversed = renderAnyWelcomeComment([PLAIN, NAMED], candidate(null))
    expect(forward.ok).toBe(true)
    expect(reversed.ok).toBe(true)
  })

  it('counts a post that some registered wording can answer', () => {
    // The nickname is unreadable, so the named template cannot be filled — but
    // a run that draws the plain one still comments. Leaving this out would
    // show a smaller number than the run goes on to post.
    expect(renderAnyWelcomeComment([NAMED, PLAIN], candidate(null)).ok).toBe(true)
  })

  it('leaves out a post no registered wording can answer', () => {
    expect(renderAnyWelcomeComment([NAMED], candidate(null))).toEqual({
      ok: false,
      missing: ['닉네임'],
    })
  })

  it('never promises fewer than the run can post', () => {
    // Every draw the run could make, against the one answer the count gives.
    const templates = [NAMED, PLAIN]
    const target = candidate(null)
    const counted = renderAnyWelcomeComment(templates, target).ok

    const drawn = templates.map(
      (_, index) => renderWelcomeComment(templates, new SequenceRandom([index]), target).ok,
    )

    expect(drawn.some((ok) => ok && !counted)).toBe(false)
  })
})
