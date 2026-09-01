import { describe, expect, it } from 'vitest'
import type {
  CollectionScheduleView,
  CollectionStatusView,
} from '../../src/desktop/ipc.js'
import type { CollectionJob, CollectionRunSummary } from '../../src/desktop/collection-db/statusQuery.js'
import { TEXT } from '../../src/shared/text.js'
import {
  collectionJobState,
  commentJobState,
  type CommentJobInput,
} from '../../src/renderer/views/dashboard/quiet.js'

function kst(iso: string): number {
  return Date.parse(`${iso}+09:00`)
}

const NOW = kst('2026-08-24T13:52:00')

/** A healthy comment job: switched on, running, inside the window. */
const HEALTHY: CommentJobInput = {
  loopRunning: true,
  automationEnabled: true,
  withinActiveHours: true,
  activeHourStart: 8,
  activeHourEnd: 24,
  nextSessionAt: kst('2026-08-24T14:20:00'),
  bridgeStatus: 'CONNECTED',
  progress: null,
}

describe('commentJobState', () => {
  it('names the session in flight rather than any reason to be quiet', () => {
    const state = commentJobState({ ...HEALTHY, progress: '3건 중 2건째' })

    expect(state.tone).toBe('accent')
    expect(state.status).toBe(TEXT.dashboard.job.running)
    expect(state.why).toBe('3건 중 2건째')
  })

  it('says a switched-off automation before anything else', () => {
    // Every other reason is moot while the switch is off: the loop can be
    // running, the window open and the extension attached, and still nothing
    // goes out.
    const state = commentJobState({ ...HEALTHY, automationEnabled: false })

    expect(state.status).toBe(TEXT.dashboard.job.off)
    expect(state.why).toBe(TEXT.dashboard.quiet.sessionDisabled)
  })

  it('says a stopped loop as a press the operator has not made', () => {
    const state = commentJobState({ ...HEALTHY, loopRunning: false })

    expect(state.status).toBe(TEXT.dashboard.job.stopped)
    expect(state.why).toBe(TEXT.dashboard.quiet.sessionStopped)
  })

  it('warns when the extension is gone, because the window opening will not help', () => {
    const state = commentJobState({ ...HEALTHY, bridgeStatus: 'OFFLINE' })

    expect(state.tone).toBe('warn')
    expect(state.why).toBe(TEXT.dashboard.quiet.bridgeOffline)
  })

  it('names the window and the next session when the window is shut', () => {
    const state = commentJobState({ ...HEALTHY, withinActiveHours: false })

    expect(state.tone).toBe('idle')
    expect(state.why).toBe(TEXT.dashboard.quiet.sessionOutsideUntil('08~24시', '14:20'))
  })

  it('drops the time from the shut-window line when no session is scheduled', () => {
    const state = commentJobState({ ...HEALTHY, withinActiveHours: false, nextSessionAt: null })

    expect(state.why).toBe(TEXT.dashboard.quiet.sessionOutside('08~24시'))
  })

  it('reads a healthy wait as the tool working, not as a problem', () => {
    const state = commentJobState(HEALTHY)

    expect(state.tone).toBe('ok')
    expect(state.status).toBe(TEXT.dashboard.job.waiting)
    expect(state.why).toBe(TEXT.dashboard.quiet.sessionWaiting('14:20', '08~24시'))
  })

  it('says the window in the hours the profile carries, not a wording of its own', () => {
    const state = commentJobState({ ...HEALTHY, activeHourStart: 10, activeHourEnd: 22 })

    expect(state.why).toContain('10~22시')
  })
})

const JOB: CollectionJob = {
  targetStartMs: kst('2026-08-01T00:00:00'),
  targetEndMs: kst('2026-09-01T00:00:00'),
  cursorPostedAtMs: kst('2026-08-13T04:12:00'),
  cursorUpdatedAtMs: kst('2026-08-24T13:42:00'),
  complete: false,
}

function running(startedAtMs: number): CollectionRunSummary {
  return {
    id: 'run-1',
    runKind: 'backfill',
    status: 'running',
    stopReason: null,
    startedAtMs,
    finishedAtMs: null,
    targetStartMs: JOB.targetStartMs,
    targetEndMs: JOB.targetEndMs,
    collectionPages: 9,
    requestPages: 9,
    insertedPostCount: 31,
    observedPostCount: 40,
    cursorPostedAtMs: JOB.cursorPostedAtMs,
  }
}

function view(
  job: CollectionJob | null,
  run: CollectionRunSummary | null = null,
): CollectionStatusView {
  return {
    kind: 'ready',
    status: {
      totals: { posts: 0, boards: 0, oldestPostedAtMs: null, newestPostedAtMs: null, lastSnapshotAtMs: null },
      job,
      running: run,
      recentRuns: run === null ? [] : [run],
    },
  }
}

const SCHEDULE: CollectionScheduleView = {
  schedule: {
    enabled: true,
    activeWindowStartHourKst: 9,
    activeWindowEndHourKst: 21,
    workBlockMinutes: 30,
    restMinutes: 30,
  },
  nextRunAtMs: kst('2026-08-24T14:12:00'),
  running: false,
}

describe('collectionJobState', () => {
  it('explains storage that was never configured as a choice, not a fault', () => {
    const state = collectionJobState({
      nowMs: NOW,
      collection: { kind: 'disabled' },
      schedule: SCHEDULE,
      bridgeStatus: 'CONNECTED',
    })

    expect(state.tone).toBe('idle')
    expect(state.why).toBe(TEXT.collection.disabledHow)
  })

  it('warns with the reason when storage is configured but unusable', () => {
    const state = collectionJobState({
      nowMs: NOW,
      collection: { kind: 'unavailable', code: 'COLLECTION_SCHEMA_MISSING' },
      schedule: SCHEDULE,
      bridgeStatus: 'CONNECTED',
    })

    expect(state.tone).toBe('warn')
    expect(state.why).toBe(TEXT.collection.unavailable.COLLECTION_SCHEMA_MISSING)
  })

  it('says what happens after the block, not only that one is running', () => {
    // The misreading this whole screen exists to fix: a block ending is not the
    // job ending, and the sentence has to say so while the block is still on.
    const state = collectionJobState({
      nowMs: NOW,
      collection: view(JOB, running(kst('2026-08-24T13:30:00'))),
      schedule: SCHEDULE,
      bridgeStatus: 'CONNECTED',
    })

    expect(state.tone).toBe('accent')
    expect(state.status).toBe(TEXT.dashboard.job.running)
    expect(state.why).toBe(TEXT.dashboard.quiet.collectionRunning('22분째', 30))
  })

  it('points at the period picker when there is no job to carry on', () => {
    const state = collectionJobState({
      nowMs: NOW,
      collection: view(null),
      schedule: SCHEDULE,
      bridgeStatus: 'CONNECTED',
    })

    expect(state.why).toBe(TEXT.dashboard.quiet.collectionNoJob)
  })

  it('reports a finished job as finished rather than as one more quiet hour', () => {
    const state = collectionJobState({
      nowMs: NOW,
      collection: view({ ...JOB, complete: true }),
      schedule: SCHEDULE,
      bridgeStatus: 'CONNECTED',
    })

    expect(state.tone).toBe('ok')
    expect(state.why).toBe(TEXT.dashboard.quiet.collectionComplete)
  })

  it('says a switched-off schedule before it says the extension is missing', () => {
    // With the schedule off nothing would run whatever the bridge does, and
    // the schedule is the one the operator can turn on from inside this app.
    const state = collectionJobState({
      nowMs: NOW,
      collection: view(JOB),
      schedule: { ...SCHEDULE, schedule: { ...SCHEDULE.schedule, enabled: false } },
      bridgeStatus: 'OFFLINE',
    })

    expect(state.why).toBe(TEXT.dashboard.quiet.collectionScheduleOff)
  })

  it('warns about the extension once the schedule is on', () => {
    const state = collectionJobState({
      nowMs: NOW,
      collection: view(JOB),
      schedule: SCHEDULE,
      bridgeStatus: 'OFFLINE',
    })

    expect(state.tone).toBe('warn')
    expect(state.why).toBe(TEXT.dashboard.quiet.bridgeOffline)
  })

  it('calls a gap inside the active window a rest, and names when it ends', () => {
    const state = collectionJobState({
      nowMs: NOW,
      collection: view(JOB),
      schedule: SCHEDULE,
      bridgeStatus: 'CONNECTED',
    })

    expect(state.tone).toBe('ok')
    expect(state.status).toBe(TEXT.dashboard.job.waiting)
    expect(state.why).toBe(TEXT.dashboard.quiet.collectionResting('14:12'))
  })

  it('calls a gap outside the window the window, because they are fixed differently', () => {
    const state = collectionJobState({
      nowMs: kst('2026-08-24T22:10:00'),
      collection: view(JOB),
      schedule: { ...SCHEDULE, nextRunAtMs: kst('2026-08-25T09:00:00') },
      bridgeStatus: 'CONNECTED',
    })

    expect(state.why).toBe(TEXT.dashboard.quiet.collectionOutside('09~21시', '09:00'))
  })

  it('does not claim a rest when the schedule has no next block to name', () => {
    const state = collectionJobState({
      nowMs: NOW,
      collection: view(JOB),
      schedule: { ...SCHEDULE, nextRunAtMs: null },
      bridgeStatus: 'CONNECTED',
    })

    expect(state.tone).toBe('warn')
    expect(state.why).toBe(TEXT.dashboard.quiet.collectionNoNext)
  })
})
