import type { BridgeStatus, CollectionScheduleView, CollectionStatusView } from '../../../desktop/ipc.js'
import { TEXT } from '../../../shared/text.js'
import { activeWindowLabel, elapsedLabel, formatKstTime, kstHourOf } from '../../format.js'
import type { Tone } from '../../format.js'

/**
 * Why each job is quiet, as present state.
 *
 * `outcomeSummary` answers what the last session ended as, which is a different
 * question and often a much older one: an automation switched off an hour ago
 * still reports a successful run from before that. An operator looking at a
 * still screen is asking about now, so these read the state rather than the
 * history — and they say the same thing whether the reason is a switch, a
 * window, a rest between blocks or a missing extension.
 */

/** Accent is present activity; the rest are the app's ordinary status tones. */
export type JobTone = Tone | 'accent'

export interface JobState {
  /** Colours the panel's rail and the state word beside the name. */
  readonly tone: JobTone
  /** What the job is, in a word: 진행 중 / 대기 중 / 정지 / 꺼짐. */
  readonly status: string
  /** The sentence that answers "왜 지금 조용한가". */
  readonly why: string
}

export interface CommentJobInput {
  readonly loopRunning: boolean
  readonly automationEnabled: boolean
  readonly withinActiveHours: boolean
  readonly activeHourStart: number
  readonly activeHourEnd: number
  readonly nextSessionAt: number | null
  readonly bridgeStatus: BridgeStatus
  /** Non-null exactly while a session is in flight, already worded. */
  readonly progress: string | null
}

/**
 * The comment job's present state.
 *
 * Ordered by what an operator would have to fix first: a session in flight
 * needs no explanation, a switch that is off makes every other reason moot, and
 * a missing extension stops the run even inside the operating window.
 */
export function commentJobState(input: CommentJobInput): JobState {
  if (input.progress !== null) {
    return { tone: 'accent', status: TEXT.dashboard.job.running, why: input.progress }
  }
  if (!input.automationEnabled) {
    return { tone: 'idle', status: TEXT.dashboard.job.off, why: TEXT.dashboard.quiet.sessionDisabled }
  }
  if (!input.loopRunning) {
    return { tone: 'idle', status: TEXT.dashboard.job.stopped, why: TEXT.dashboard.quiet.sessionStopped }
  }
  if (input.bridgeStatus === 'OFFLINE') {
    return { tone: 'warn', status: TEXT.dashboard.job.waiting, why: TEXT.dashboard.quiet.bridgeOffline }
  }

  const window = activeWindowLabel(input.activeHourStart, input.activeHourEnd)
  if (!input.withinActiveHours) {
    return {
      tone: 'idle',
      status: TEXT.dashboard.job.waiting,
      why:
        input.nextSessionAt === null
          ? TEXT.dashboard.quiet.sessionOutside(window)
          : TEXT.dashboard.quiet.sessionOutsideUntil(window, formatKstTime(input.nextSessionAt)),
    }
  }
  return {
    tone: 'ok',
    status: TEXT.dashboard.job.waiting,
    why:
      input.nextSessionAt === null
        ? TEXT.dashboard.quiet.sessionWaitingNoTime
        : TEXT.dashboard.quiet.sessionWaiting(formatKstTime(input.nextSessionAt), window),
  }
}

export interface CollectionJobInput {
  readonly nowMs: number
  readonly collection: CollectionStatusView
  readonly schedule: CollectionScheduleView | null
  readonly bridgeStatus: BridgeStatus
}

/**
 * The collection job's present state.
 *
 * The case this exists for is the quiet one: a run ending is not a job ending,
 * and between blocks there is nothing to see. Saying "휴식 중" with the time the
 * next block is due is the difference between a schedule working and a tool
 * that looks broken.
 */
export function collectionJobState(input: CollectionJobInput): JobState {
  if (input.collection.kind === 'disabled') {
    return {
      tone: 'idle',
      status: TEXT.dashboard.job.off,
      why: TEXT.collection.disabledHow,
    }
  }
  if (input.collection.kind === 'unavailable') {
    return {
      tone: 'warn',
      status: TEXT.dashboard.job.unavailable,
      why: TEXT.collection.unavailable[input.collection.code],
    }
  }

  const { job, running } = input.collection.status
  const schedule = input.schedule

  if (running !== null) {
    return {
      tone: 'accent',
      status: TEXT.dashboard.job.running,
      why: TEXT.dashboard.quiet.collectionRunning(
        elapsedLabel(running.startedAtMs, input.nowMs),
        schedule?.schedule.restMinutes ?? 0,
      ),
    }
  }
  if (job === null) {
    return { tone: 'idle', status: TEXT.dashboard.job.waiting, why: TEXT.dashboard.quiet.collectionNoJob }
  }
  if (job.complete) {
    return { tone: 'ok', status: TEXT.dashboard.job.waiting, why: TEXT.dashboard.quiet.collectionComplete }
  }
  // Before the bridge, because a schedule that is off is why nothing runs
  // whether or not an extension is attached — and it is the one the operator
  // can fix from inside this app.
  if (schedule === null || !schedule.schedule.enabled) {
    return {
      tone: 'idle',
      status: TEXT.dashboard.job.waiting,
      why: TEXT.dashboard.quiet.collectionScheduleOff,
    }
  }
  if (input.bridgeStatus === 'OFFLINE') {
    return { tone: 'warn', status: TEXT.dashboard.job.waiting, why: TEXT.dashboard.quiet.bridgeOffline }
  }
  if (schedule.nextRunAtMs === null) {
    return { tone: 'warn', status: TEXT.dashboard.job.waiting, why: TEXT.dashboard.quiet.collectionNoNext }
  }

  // Inside the window a still screen means a rest; outside it, the window
  // itself. The two look identical and are fixed by different things, so the
  // hour is compared rather than guessed from the gap to the next block.
  const hour = kstHourOf(input.nowMs)
  const { activeWindowStartHourKst: start, activeWindowEndHourKst: end } = schedule.schedule
  const inWindow = hour >= start && hour < end
  const at = formatKstTime(schedule.nextRunAtMs)
  return {
    tone: 'ok',
    status: TEXT.dashboard.job.waiting,
    why: inWindow
      ? TEXT.dashboard.quiet.collectionResting(at)
      : TEXT.dashboard.quiet.collectionOutside(activeWindowLabel(start, end), at),
  }
}
