import type { Random } from '../shared/ports.js'
import type { CollectionRange } from '../shared/collectionSchedule.js'
import type { CollectionFeed, CollectionRepository } from './collection-db/repository.js'
import {
  createBoardPageFetcher,
  createCollectionOrchestrator,
  type CollectionClock,
  type CollectionRunResult,
} from './collectionOrchestrator.js'
import type { CollectionLock } from './collectionLock.js'
import type { ExtensionTransport } from './ws/server.js'

export type CollectionRunKind = 'backfill' | 'incremental'

export interface CollectionStartRequest {
  readonly range: CollectionRange
  readonly kind: CollectionRunKind
  /** Pages this block may ask for, shared across every feed it walks. */
  readonly maxPages: number
  /** In walking order. A whole-cafe job is one; a board job is what remains of its queue. */
  readonly feeds: readonly CollectionFeed[]
  /** Whether to resume from each feed's checkpoint (for continuing jobs). */
  readonly resumeFromCheckpoint?: boolean
}

/**
 * Why a start did not happen. Every one of these is an ordinary answer the
 * screen can name, not an exception: the operator pressed a button and is owed
 * a reason.
 */
export type CollectionStartRefusal =
  | 'NO_STORAGE'
  | 'ALREADY_RUNNING'
  | 'BRIDGE_OFFLINE'
  /** A period was asked for while a run is still writing the cursor. */
  | 'STOP_RUNNING_FIRST'
  /** Nothing to carry on with: no period has ever been asked for. */
  | 'NO_JOB'
  /** The stored job has already walked past its period's start. */
  | 'JOB_FINISHED'

export type CollectionStartResult =
  | { readonly kind: 'started' }
  | { readonly kind: 'refused'; readonly reason: CollectionStartRefusal }

export interface CollectionRunnerDeps {
  /** Null while no collection database is usable, which is a normal install. */
  readonly repository: () => CollectionRepository | null
  readonly transport: ExtensionTransport
  readonly clock: CollectionClock
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  /** True while a greeting session holds the browser; the walk waits it out. */
  readonly isSessionBusy: () => boolean
  readonly lock: CollectionLock
  readonly newId: () => string
  /** Called once per block, with every feed's result in walking order. */
  readonly onFinished?: (results: readonly CollectionRunResult[]) => void
  readonly onError?: (error: unknown) => void
}

export interface CollectionRunner {
  /**
   * Decides now and reads later. A walk takes the better part of a quarter of
   * an hour, and a renderer waiting that out would hold its own controls shut —
   * progress is read from the database instead.
   */
  start(request: CollectionStartRequest): CollectionStartResult
  /** Asks the walk to stop at the next page boundary. */
  stop(): void
  isRunning(): boolean
}

export function createCollectionRunner(deps: CollectionRunnerDeps): CollectionRunner {
  let inFlight: Promise<void> | null = null
  let abortRequested = false

  /**
   * One block over a queue of feeds. Small boards would otherwise each cost a
   * whole block — twenty of this cafe's boards hold under a hundred posts —
   * so a feed that ends hands its unused budget to the next. A failure moves
   * on too: one board's bad page is no reason to hold the other thirty-seven.
   * A stop does not; it is the operator asking for quiet.
   */
  async function walk(request: CollectionStartRequest, repository: CollectionRepository): Promise<readonly CollectionRunResult[]> {
    const results: CollectionRunResult[] = []
    let spent = 0
    for (const feed of request.feeds) {
      if (abortRequested || spent >= request.maxPages) break
      const orchestrator = createCollectionOrchestrator({
        repository,
        fetcher: createBoardPageFetcher(deps.transport, deps.newId, feed.menuId),
        clock: deps.clock,
        random: deps.random,
        sleep: deps.sleep,
        isSessionBusy: deps.isSessionBusy,
        isAbortRequested: () => abortRequested,
      })
      const result = await orchestrator.run({
        feed,
        run: {
          ...feed,
          id: deps.newId(),
          runKind: request.kind === 'backfill' ? 'backfill' : 'incremental',
          resumeFromCheckpoint: request.resumeFromCheckpoint ?? false,
          targetStartMs: request.range.startMs,
          targetEndMs: request.range.endMs,
          startedAt: new Date(deps.clock.now()),
        },
        maxPages: request.maxPages - spent,
      })
      results.push(result)
      spent += result.requests
      if (result.kind === 'interrupted') break
    }
    return results
  }

  return {
    start(request) {
      if (inFlight !== null) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      const repository = deps.repository()
      if (repository === null) return { kind: 'refused', reason: 'NO_STORAGE' }
      // Refused rather than queued: the extension holds the login, so without it
      // there is nothing to read and a queued run would only fail later, out of
      // sight of whoever pressed the button.
      if (!deps.transport.isConnected()) return { kind: 'refused', reason: 'BRIDGE_OFFLINE' }
      // The member walk shares this browser session, so only one walk runs at a
      // time. A held lock reads as ALREADY_RUNNING, the same as this runner's own
      // in-flight guard above.
      if (!deps.lock.tryAcquire()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }

      abortRequested = false

      inFlight = walk(request, repository)
        .then((results) => { deps.onFinished?.(results) })
        .catch((error: unknown) => { deps.onError?.(error) })
        .finally(() => { inFlight = null; deps.lock.release() })

      return { kind: 'started' }
    },

    stop() {
      abortRequested = true
    },

    isRunning() {
      return inFlight !== null
    },
  }
}
