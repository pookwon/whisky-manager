import { describe, expect, it } from 'vitest'
import { waitForReadTurn, type ReadTurnDeps } from '../../src/desktop/collectionReadTurn.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { CollectionPacing } from '../../src/shared/collectionPacing.js'

const TWO_SECONDS: CollectionPacing = {
  perPage: { minSeconds: 2, maxSeconds: 2 },
  everyTwentyPages: { minSeconds: 0, maxSeconds: 0 },
  everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
}

function turn(setup: { readonly busyChecks?: boolean[]; readonly abortAfterSleeps?: number } = {}) {
  const sleeps: number[] = []
  const busy = [...(setup.busyChecks ?? [])]
  const deps: ReadTurnDeps = {
    isSessionBusy: () => busy.shift() ?? false,
    sleep: async (ms) => { sleeps.push(ms) },
    random: { intInclusive: (min: number) => min },
    isAborted: () => setup.abortAfterSleeps !== undefined && sleeps.length >= setup.abortAfterSleeps,
  }
  return { deps, sleeps }
}

const aborted = (promise: Promise<void>) => expect(promise).rejects.toEqual(new CollectionPageError('ABORTED'))

describe('waitForReadTurn', () => {
  it('lets the first request go at once', async () => {
    const { deps, sleeps } = turn()
    await waitForReadTurn(deps, 1, TWO_SECONDS)
    expect(sleeps).toEqual([])
  })

  it('waits the paced delay in slices before a later request', async () => {
    const { deps, sleeps } = turn()
    await waitForReadTurn(deps, 2, TWO_SECONDS)
    expect(sleeps).toEqual([1_000, 1_000])
  })

  it('yields to a busy session before the pause and again after it', async () => {
    const { deps, sleeps } = turn({ busyChecks: [true, false, true, false] })
    await waitForReadTurn(deps, 2, TWO_SECONDS)
    expect(sleeps).toEqual([1_000, 1_000, 1_000, 1_000])
  })

  it('ends at a stop while it yields to the session', async () => {
    const { deps } = turn({ busyChecks: [true, true, true], abortAfterSleeps: 1 })
    await aborted(waitForReadTurn(deps, 1, TWO_SECONDS))
  })

  it('ends at a stop during the pause', async () => {
    const { deps, sleeps } = turn({ abortAfterSleeps: 1 })
    await aborted(waitForReadTurn(deps, 2, TWO_SECONDS))
    expect(sleeps).toEqual([1_000])
  })

  it('ends at a stop that came while it yielded after the pause', async () => {
    const { deps, sleeps } = turn({ busyChecks: [false, true, false], abortAfterSleeps: 1 })
    await aborted(waitForReadTurn(deps, 1, TWO_SECONDS))
    expect(sleeps).toEqual([1_000])
  })
})
