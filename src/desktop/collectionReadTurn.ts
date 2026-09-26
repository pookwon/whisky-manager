import type { CollectionPacing } from '../shared/collectionPacing.js'
import { collectionDelayMs } from '../shared/collectionPacing.js'
import type { Random } from '../shared/ports.js'
import { CollectionPageError } from './collectionPageError.js'
import { pauseUnlessStopped } from './collectionPause.js'

const SESSION_YIELD_MS = 1_000

export interface ReadTurnDeps {
  readonly isSessionBusy: () => boolean
  readonly sleep: (ms: number) => Promise<void>
  readonly random: Random
  readonly isAborted: () => boolean
}

/**
 * What a walk's request waits for before it goes: the operator's own session
 * first, then the paced pause, then the session again, since it may have
 * started during the pause. A stop seen anywhere on the way throws `ABORTED`.
 */
export async function waitForReadTurn(deps: ReadTurnDeps, ordinal: number, pacing: CollectionPacing): Promise<void> {
  const yieldToSession = async () => {
    while (deps.isSessionBusy()) {
      if (deps.isAborted()) throw new CollectionPageError('ABORTED')
      await deps.sleep(SESSION_YIELD_MS)
    }
  }
  await yieldToSession()
  if (!(await pauseUnlessStopped(collectionDelayMs(ordinal, pacing, deps.random), deps.sleep, deps.isAborted))) {
    throw new CollectionPageError('ABORTED')
  }
  await yieldToSession()
  if (deps.isAborted()) throw new CollectionPageError('ABORTED')
}
