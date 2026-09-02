import type { Random } from '../shared/ports.js'
import type { MemberRepository } from './collection-db/memberRepository.js'
import type { CollectionLock } from './collectionLock.js'
import {
  createMemberCollectionFetcher,
  createMemberCollectionOrchestrator,
  type MemberCollectionClock,
  type MemberCollectionRunResult,
  type MemberRunMode,
} from './memberCollectionOrchestrator.js'
import type { CollectionStartResult } from './collectionRunner.js'
import type { ExtensionTransport } from './ws/server.js'

export interface MemberCollectionStartRequest {
  readonly mode: MemberRunMode
  readonly maxPages: number
  readonly resumeFromCheckpoint: boolean
}

export interface MemberCollectionRunnerDeps {
  readonly repository: () => MemberRepository | null
  readonly transport: ExtensionTransport
  readonly clock: MemberCollectionClock
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  readonly lock: CollectionLock
  readonly newId: () => string
  readonly onFinished?: (result: MemberCollectionRunResult) => void
  readonly onError?: (error: unknown) => void
}

export interface MemberCollectionRunner {
  start(request: MemberCollectionStartRequest): CollectionStartResult
  stop(): void
  isRunning(): boolean
}

export function createMemberCollectionRunner(deps: MemberCollectionRunnerDeps): MemberCollectionRunner {
  let inFlight: Promise<void> | null = null
  let abortRequested = false

  return {
    start(request) {
      if (inFlight !== null) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      const repository = deps.repository()
      if (repository === null) return { kind: 'refused', reason: 'NO_STORAGE' }
      if (!deps.transport.isConnected()) return { kind: 'refused', reason: 'BRIDGE_OFFLINE' }
      if (!deps.lock.tryAcquire()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }

      abortRequested = false
      const orchestrator = createMemberCollectionOrchestrator({
        repository,
        fetcher: createMemberCollectionFetcher(deps.transport, deps.newId),
        clock: deps.clock,
        random: deps.random,
        sleep: deps.sleep,
        isSessionBusy: deps.isSessionBusy,
        isAbortRequested: () => abortRequested,
      })

      inFlight = orchestrator
        .run({
          run: {
            id: deps.newId(),
            runKind: request.mode,
            resumeFromCheckpoint: request.resumeFromCheckpoint,
            startedAt: new Date(deps.clock.now()),
          },
          maxPages: request.maxPages,
          mode: request.mode,
        })
        .then((result) => {
          deps.onFinished?.(result)
        })
        .catch((error: unknown) => {
          deps.onError?.(error)
        })
        .finally(() => {
          inFlight = null
          deps.lock.release()
        })

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
