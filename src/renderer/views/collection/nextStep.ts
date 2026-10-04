import {
  boardNeedingSearch,
  listUnfinished,
  probeSpent,
  probeUnfinished,
  runningStep,
  searchFinished,
  searchUnfinished,
  type CollectionStepInputs,
  type WalkStep,
} from './stepFacts.js'

/** The one thing the top of the screen tells a newcomer to do now. */
export type NextStep =
  | { readonly kind: 'running'; readonly step: WalkStep }
  | { readonly kind: 'listWaiting'; readonly nextRunAtMs: number | null }
  | { readonly kind: 'searchResume'; readonly nextRunAtMs: number | null }
  | { readonly kind: 'probeResume'; readonly nextRunAtMs: number | null }
  | { readonly kind: 'searchNeeded'; readonly boardId: string; readonly boardName: string }
  | { readonly kind: 'probeCreate' }
  | { readonly kind: 'probeSpent' }
  | { readonly kind: 'pickPeriod' }
  | { readonly kind: 'allDone' }

/**
 * The first answer that applies, in the order a collection goes: a walk in
 * flight is waited for; an unfinished walk is resumed earliest step first;
 * then whatever the finished steps opened up — a board the list could not
 * reach, a finished search that wants its probe — and only then a new period.
 */
export function nextStep(inputs: CollectionStepInputs, nextRunAtMs: number | null): NextStep {
  const running = runningStep(inputs)
  if (running !== null) return { kind: 'running', step: running }
  if (listUnfinished(inputs.status)) return { kind: 'listWaiting', nextRunAtMs }
  if (searchUnfinished(inputs.search)) return { kind: 'searchResume', nextRunAtMs }
  if (probeUnfinished(inputs.probe)) return { kind: 'probeResume', nextRunAtMs }
  const board = boardNeedingSearch(inputs)
  if (board !== null) return { kind: 'searchNeeded', boardId: board.boardId, boardName: board.name }
  if (searchFinished(inputs.search) && inputs.probe !== null && inputs.probe.job === null) return { kind: 'probeCreate' }
  if (probeSpent(inputs)) return { kind: 'probeSpent' }
  if (inputs.status.job === null) return { kind: 'pickPeriod' }
  return { kind: 'allDone' }
}
