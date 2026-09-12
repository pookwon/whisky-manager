import type { ExecutionsRepo } from './db/executionsRepo.js'

/**
 * Retires queued rows that carry no text, so the posts behind them can be
 * judged again.
 *
 * `listQueued` skips such a row — its own comment says a queued row with no
 * text belongs to the session that claimed it, which renders and executes it in
 * the same pass — so normal operation cannot leave one behind. What could was
 * an approval of a row the screening had parked unrenderable: it reached QUEUED
 * with nothing to send, the backlog walk passed it over, `claim` read QUEUED as
 * in progress and never revived it, and no sweep retired it. Two days later the
 * backlog brake read it as a sign something was broken and refused every
 * session of that automation, permanently.
 *
 * SKIPPED rather than EXPIRED because SKIPPED is what `claim` revives: the post
 * goes back through the screening this session, which is the answer the row
 * never got. The rows this can touch are only ones an earlier build wedged.
 */
export function retireTextlessQueued(
  repo: ExecutionsRepo,
  automationId: string,
  nowMs: number,
): number {
  const ids = repo.listQueuedWithoutText(automationId)
  for (const id of ids) {
    repo.applyPatch(id, { status: 'SKIPPED', reason: 'NO_RENDERED_TEXT', resolvedAt: nowMs })
  }
  return ids.length
}
