import { describe, expect, it } from 'vitest'
import { createCollectionLoop } from '../../src/desktop/collectionLoop.js'
import {
  DEFAULT_COLLECTION_SCHEDULE,
  type CollectionSchedule,
} from '../../src/shared/collectionSchedule.js'
import type { CollectionStartResult } from '../../src/desktop/collectionRunner.js'
import type { CollectionJob, CollectionJobProgress } from '../../src/desktop/collectionJob.js'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
/** 2026-08-31 08:00 KST, an hour before the 09:00 window opens. */
const NOW = Date.UTC(2026, 7, 30, 23)
const kst = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 16).replace('T', ' ')

interface FakeJobSpec {
  name: 'articles' | 'members'
  progress: CollectionJobProgress
  startResult?: CollectionStartResult
  maintenance?: (nowMs: number) => CollectionStartResult | null
}

function harness(schedule: CollectionSchedule, specs: FakeJobSpec[]) {
  const started: { name: string; maxPages: number }[] = []
  const cleared: number[] = []
  let pending: { fn: () => void; dueAt: number; handle: number } | null = null
  let now = NOW
  let current = schedule
  let handles = 0
  let liveSpecs = specs

  const jobs = (): CollectionJob[] =>
    liveSpecs.map((spec) => ({
      name: spec.name,
      readProgress: async () => spec.progress,
      start: (maxPages: number) => {
        started.push({ name: spec.name, maxPages })
        return spec.startResult ?? { kind: 'started' as const }
      },
      ...(spec.maintenance === undefined
        ? {}
        : {
            startDailyMaintenance: async (maxPages: number, nowMs: number) => {
              const result = spec.maintenance!(nowMs)
              if (result !== null) started.push({ name: `${spec.name}:topup`, maxPages })
              return result
            },
          }),
    }))

  const loop = createCollectionLoop({
    schedule: () => current,
    clock: { now: () => now },
    jobs,
    setTimer: (fn, ms) => {
      handles += 1
      pending = { fn, dueAt: now + ms, handle: handles }
      return handles
    },
    clearTimer: (handle) => {
      cleared.push(handle)
      if (pending?.handle === handle) pending = null
    },
  })

  return {
    loop,
    started,
    cleared,
    pendingDelayMs: () => (pending === null ? null : pending.dueAt - now),
    advance: async (ms: number, fireLimit = 200): Promise<number> => {
      const target = now + ms
      let fired = 0
      while (pending !== null && pending.dueAt <= target) {
        if ((fired += 1) > fireLimit) throw new Error('loop fired too many times — busy loop')
        const due = pending
        now = Math.max(now, due.dueAt)
        pending = null
        due.fn()
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
      }
      now = target
      return fired
    },
    setSchedule: (next: CollectionSchedule) => { current = next },
    setSpecs: (next: FakeJobSpec[]) => { liveSpecs = next },
  }
}

const enabled: CollectionSchedule = { ...DEFAULT_COLLECTION_SCHEDULE, enabled: true }

const articleSpec = (overrides: Partial<CollectionJobProgress> = {}, startResult?: CollectionStartResult): FakeJobSpec => ({
  name: 'articles',
  progress: { exists: true, complete: false, forced: false, ...overrides },
  ...(startResult !== undefined ? { startResult } : {}),
})

describe('collection loop', () => {
  it('waits for the active window to open', () => {
    const h = harness(enabled, [articleSpec()])
    h.loop.refresh()

    expect(h.pendingDelayMs()).toBe(1 * HOUR)
    expect(kst(h.loop.nextRunAt() ?? 0)).toBe('2026-08-31 09:00')
  })

  it('lays nothing while switched off', () => {
    const h = harness({ ...enabled, enabled: false }, [articleSpec()])
    h.loop.refresh()

    expect(h.pendingDelayMs()).toBeNull()
    expect(h.loop.nextRunAt()).toBeNull()
  })

  it('rests between blocks instead of beating continuously', async () => {
    const h = harness(enabled, [articleSpec()])
    h.loop.refresh()
    const fired = await h.advance(12 * HOUR)

    expect(fired).toBe(3)
    expect(h.started.filter((s) => s.name === 'articles')).toHaveLength(3)
  })

  it('continues the stored job rather than a window of its own', async () => {
    const h = harness(enabled, [articleSpec()])
    h.loop.refresh()
    await h.advance(2 * HOUR)

    expect(h.started[0]?.maxPages).toBeGreaterThan(0)
  })

  it('spends the work block as its page budget', async () => {
    const h = harness({ ...enabled, workBlockMinutes: 120 }, [articleSpec()])
    h.loop.refresh()
    await h.advance(2 * HOUR)

    expect(h.started[0]?.maxPages).toBeGreaterThan(250)
    expect(h.started[0]?.maxPages).toBeLessThan(320)
  })

  it('makes no request at all when there is no job', async () => {
    const h = harness(enabled, [articleSpec({ exists: false })])
    h.loop.refresh()
    const fired = await h.advance(12 * HOUR)

    expect(fired).toBeGreaterThan(0)
    expect(h.started).toHaveLength(0)
  })

  it('leaves a finished job alone instead of re-walking it every rest', async () => {
    const h = harness(enabled, [articleSpec({ complete: true })])
    h.loop.refresh()
    const fired = await h.advance(24 * HOUR)

    expect(fired).toBeGreaterThan(0)
    expect(h.started).toHaveLength(0)
  })

  it('keeps to the rhythm through the night when the job says to', async () => {
    const held = harness(enabled, [articleSpec({ forced: false })])
    held.loop.refresh()
    await held.advance(DAY)

    const h = harness(enabled, [articleSpec({ forced: true })])
    h.loop.refresh()
    await h.advance(DAY)

    expect(held.started).toHaveLength(3)
    expect(h.started.length).toBeGreaterThan(held.started.length)
  })

  it('goes back inside the hours as soon as the force is released', async () => {
    const h = harness(enabled, [articleSpec({ forced: true })])
    h.loop.refresh()
    await h.advance(6 * HOUR)
    const forcedCount = h.started.length

    h.setSpecs([articleSpec({ forced: false })])
    await h.advance(6 * HOUR)

    expect(h.started.length).toBeGreaterThan(forcedCount)
    expect(h.pendingDelayMs()).not.toBe(2 * MINUTE)
  })

  it('does not run at all through the night when the collection is switched off', async () => {
    const h = harness({ ...enabled, enabled: false }, [articleSpec({ forced: true })])
    h.loop.refresh()
    await h.advance(DAY)

    expect(h.started).toHaveLength(0)
    expect(h.loop.nextRunAt()).toBeNull()
  })

  it('waits one rest before looking again when nothing was started', async () => {
    const h = harness(enabled, [articleSpec({ exists: false })])
    h.loop.refresh()
    await h.advance(1 * HOUR)

    expect(h.pendingDelayMs()).toBe(enabled.restMinutes * MINUTE)
  })

  it('keeps beating after a refused start', async () => {
    const h = harness(enabled, [articleSpec({}, { kind: 'refused', reason: 'BRIDGE_OFFLINE' })])
    h.loop.refresh()
    await h.advance(1 * HOUR + 10 * MINUTE)

    expect(h.started.length).toBeGreaterThan(1)
  })

  it('looks again in a couple of minutes when the extension was not there', async () => {
    const h = harness(enabled, [articleSpec({}, { kind: 'refused', reason: 'BRIDGE_OFFLINE' })])
    h.loop.refresh()
    await h.advance(1 * HOUR)

    expect(h.pendingDelayMs()).toBe(2 * MINUTE)
  })

  it('still pays a rest for a refusal the extension cannot fix', async () => {
    const h = harness(enabled, [articleSpec({}, { kind: 'refused', reason: 'ALREADY_RUNNING' })])
    h.loop.refresh()
    await h.advance(1 * HOUR)

    expect(h.pendingDelayMs()).toBe(enabled.restMinutes * MINUTE)
  })

  it('does not run a beat the operator switched off while it was pending', async () => {
    const h = harness(enabled, [articleSpec()])
    h.loop.refresh()
    h.setSchedule({ ...enabled, enabled: false })
    await h.advance(2 * HOUR)

    expect(h.started).toHaveLength(0)
    expect(h.loop.nextRunAt()).toBeNull()
  })

  it('carries the rhythm into the next day rather than working through the night', async () => {
    const h = harness(enabled, [articleSpec()])
    h.loop.refresh()
    await h.advance(DAY + 12 * HOUR)

    expect(h.started.filter((s) => s.name === 'articles')).toHaveLength(6)
  })

  it('replaces the pending beat when the schedule is saved again', () => {
    const h = harness(enabled, [articleSpec()])
    h.loop.refresh()
    h.setSchedule({ ...enabled, activeWindowStartHourKst: 10 })
    h.loop.refresh()

    expect(h.cleared).toHaveLength(1)
    expect(kst(h.loop.nextRunAt() ?? 0)).toBe('2026-08-31 10:00')
  })

  it('leaves nothing pending after stop', () => {
    const h = harness(enabled, [articleSpec()])
    h.loop.refresh()
    h.loop.stop()

    expect(h.pendingDelayMs()).toBeNull()
    expect(h.loop.nextRunAt()).toBeNull()
  })

  it('round-robins between two unfinished jobs in alternating order', async () => {
    const h = harness(enabled, [
      { name: 'articles', progress: { exists: true, complete: false, forced: false } },
      { name: 'members', progress: { exists: true, complete: false, forced: false } },
    ])
    h.loop.refresh()
    // 09:00-21:00 window with 2h work + 2h rest = 3 beats; add a 4th by advancing further
    await h.advance(DAY)
    const names = h.started.map((s) => s.name)
    // Must alternate: articles, members, articles, members, …
    for (let i = 1; i < names.length; i += 1) {
      expect(names[i]).not.toBe(names[i - 1])
    }
    expect(names[0]).toBe('articles')
    expect(names[1]).toBe('members')
    expect(names).toContain('articles')
    expect(names).toContain('members')
  })

  it('does not spend a job\'s turn on a refusal the extension will fix', async () => {
    // The app beats the moment it starts, before the extension has dialled
    // back in. That refusal is not a block the first job had; two minutes
    // later the retry must go to the same job, not hand the block to the next.
    const first: FakeJobSpec = { name: 'articles', progress: { exists: true, complete: false, forced: false }, startResult: { kind: 'refused', reason: 'BRIDGE_OFFLINE' } }
    const h = harness(enabled, [first, { name: 'members', progress: { exists: true, complete: false, forced: false } }])
    h.loop.refresh()
    await h.advance(1 * HOUR)
    expect(h.started.map((s) => s.name)).toEqual(['articles'])

    h.setSpecs([{ ...first, startResult: { kind: 'started' } }, { name: 'members', progress: { exists: true, complete: false, forced: false } }])
    await h.advance(2 * MINUTE)
    expect(h.started.map((s) => s.name)).toEqual(['articles', 'articles'])
  })

  it('runs the member top-up once when the walk is complete and it is due', async () => {
    let due = true
    const h = harness(enabled, [
      { name: 'members', progress: { exists: false, complete: true, forced: false }, maintenance: () => (due ? (due = false, { kind: 'started' as const }) : null) },
    ])
    h.loop.refresh()
    await h.advance(24 * HOUR)
    expect(h.started.filter((s) => s.name === 'members:topup')).toHaveLength(1)
  })

  it('starts nothing when the only job is a completed member walk with no top-up due', async () => {
    const h = harness(enabled, [
      { name: 'members', progress: { exists: false, complete: true, forced: false }, maintenance: () => null },
    ])
    h.loop.refresh()
    const fired = await h.advance(24 * HOUR)
    expect(fired).toBeGreaterThan(0)
    expect(h.started).toHaveLength(0)
  })

  it('a failed readProgress on one job does not stop the other job from starting', async () => {
    // Use a clock inside the active window (09:00 KST) and a fake timer that fires at delay 0.
    const inWindow = NOW + HOUR
    const errors: unknown[] = []
    const started: string[] = []
    // Use an object wrapper so TypeScript does not narrow the mutable captured value to never.
    const timer: { fn: (() => void) | null } = { fn: null }

    const loop = createCollectionLoop({
      schedule: () => ({ ...enabled }),
      clock: { now: () => inWindow },
      jobs: () => [
        {
          name: 'articles' as const,
          readProgress: async () => ({ exists: true, complete: false, forced: false }),
          start: (_maxPages: number) => { started.push('articles'); return { kind: 'started' as const } },
        },
        {
          name: 'members' as const,
          readProgress: async (): Promise<CollectionJobProgress> => { throw new Error('db gone') },
          start: (_maxPages: number) => { started.push('members'); return { kind: 'started' as const } },
        },
      ],
      setTimer: (fn, _ms) => { timer.fn = fn; return 1 },
      clearTimer: () => { timer.fn = null },
      onError: (e) => { errors.push(e) },
    })

    loop.refresh()
    // Fire the beat that was scheduled (delay 0 since we are in-window).
    timer.fn?.()
    // Let the async beat (allSettled + jobs) resolve.
    await new Promise((r) => setTimeout(r, 50))

    // The article job must have started despite the members job's readProgress rejecting.
    expect(started).toContain('articles')
    // onError must have been called with the members rejection.
    expect(errors.length).toBeGreaterThan(0)
    expect((errors[0] as Error).message).toBe('db gone')
  })
})
