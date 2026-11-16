import { parseAttendanceTitle } from '../shared/attendanceTitle.js'
import { parseAttendanceWinners } from '../shared/attendanceWinners.js'
import { collectionDelayMs, type CollectionPacing } from '../shared/collectionPacing.js'
import type { Random } from '../shared/ports.js'
import type { ArticleBodyFetcher } from './articleBodyFetcher.js'
import type { AttendancePostRecord, AttendanceRepository } from './collection-db/attendanceRepository.js'
import type { CollectionLock } from './collectionLock.js'
import { CollectionPageError } from './collectionPageError.js'
import { FEED_HORIZON_PAGE, type BoardPageFetcher } from './collectionOrchestrator.js'

/** The Member of the Month board, where every attendance round is posted. */
export const ATTENDANCE_BOARD_MENU_ID = '207'

/** The code a failure keeps when the error is not one a page read already named. */
const UNEXPECTED_ERROR = 'ATTENDANCE_UNEXPECTED_ERROR'

/** How often the walk looks back while it is yielding Naver to an in-flight session. */
const SESSION_BUSY_POLL_MS = 1_000

export type AttendanceRunState = 'idle' | 'listing' | 'reading' | 'done' | 'stopped' | 'failed'

export interface AttendanceProgress {
  readonly state: AttendanceRunState
  readonly listPage: number        // last list page read
  readonly postsTotal: number      // attendance posts this run has to read
  readonly postsRead: number       // of those, stored so far (recorded or refused)
  readonly failureCode: string | null
}

export type AttendanceStartResult = 'STARTED' | 'ALREADY_RUNNING' | 'EXTENSION_OFFLINE' | 'DATABASE_DISABLED' | 'COLLECTION_BUSY'

export interface AttendanceCollectionDeps {
  readonly repository: () => AttendanceRepository | null
  readonly listFetcher: BoardPageFetcher            // already bound to ATTENDANCE_BOARD_MENU_ID
  readonly bodyFetcher: ArticleBodyFetcher
  readonly isConnected: () => boolean
  readonly lock: CollectionLock
  /** True while a greeting session holds Naver; the walk yields to it before each read. */
  readonly isSessionBusy: () => boolean
  readonly pacing: () => CollectionPacing
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly onError: (error: unknown) => void
}

export interface AttendanceCollection {
  start(): AttendanceStartResult
  stop(): void
  progress(): AttendanceProgress
  /** Settles when the run in flight ends; resolves at once when none is. For tests and shutdown. */
  settled(): Promise<void>
}

/**
 * The desktop service that collects attendance awards from the member board. It
 * walks the board's article list newest first, reads the body of every
 * attendance post it has not already recorded, and stores what it reads — one
 * run at a time, sharing the single browser session through the collection lock.
 *
 * The walk never guesses: a post whose period the title did not yield is refused
 * without a body read, a body the cafe no longer serves is refused, and a body
 * the winners parser cannot be sure of is refused with the rule that caught it.
 * A thrown read or save ends the run failed and keeps everything stored so far,
 * so the next run resumes from what is already recorded rather than redoing it.
 */
export function createAttendanceCollection(deps: AttendanceCollectionDeps): AttendanceCollection {
  let inFlight: Promise<void> | null = null
  let abortRequested = false

  let state: AttendanceRunState = 'idle'
  let listPage = 0
  let postsTotal = 0
  let postsRead = 0
  let failureCode: string | null = null

  const failureCodeOf = (error: unknown): string =>
    error instanceof CollectionPageError ? error.code : UNEXPECTED_ERROR

  /**
   * Hand Naver to an in-flight greeting session before a read: a session has a
   * person waiting on it, where this walk has hours to spare. Returns false when
   * a stop lands while waiting, so the caller makes no request and ends the run
   * `stopped`; true to go ahead with the read.
   */
  async function yieldToSession(): Promise<boolean> {
    while (deps.isSessionBusy()) {
      if (abortRequested) return false
      await deps.sleep(SESSION_BUSY_POLL_MS)
    }
    return !abortRequested
  }

  /**
   * One run: list the board, then read the bodies it has to. Pacing counts list
   * and body reads on one ordinal, so the traffic keeps its rhythm across the
   * switch from listing to reading. The run ends `stopped` the moment a stop is
   * seen between requests.
   */
  async function run(repository: AttendanceRepository): Promise<void> {
    const pacing = deps.pacing()
    let requestOrdinal = 0
    const pace = async (): Promise<void> => {
      requestOrdinal += 1
      if (requestOrdinal > 1) await deps.sleep(collectionDelayMs(requestOrdinal, pacing, deps.random))
    }

    state = 'listing'
    const toRead = await walkList(pace)
    if (abortRequested) { state = 'stopped'; return }

    const recorded = await repository.recordedPostIds()
    const pending = toRead
      .filter((post) => !recorded.has(post.postId))
      .sort((left, right) => Number(right.postId) - Number(left.postId))
    postsTotal = pending.length

    state = 'reading'
    for (const post of pending) {
      if (abortRequested) { state = 'stopped'; return }
      if (!(await readOne(repository, post, pace))) { state = 'stopped'; return }
      postsRead += 1
    }
    if (abortRequested) { state = 'stopped'; return }
    state = 'done'
  }

  /** Walk pages newest first, returning the attendance posts the list names, deduped. */
  async function walkList(pace: () => Promise<void>): Promise<AttendancePostRecord[]> {
    const seen = new Set<string>()
    const attendance = new Map<string, AttendancePostRecord>()
    for (let pageNumber = 1; pageNumber <= FEED_HORIZON_PAGE; pageNumber += 1) {
      if (abortRequested) break
      await pace()
      if (!(await yieldToSession())) break
      const list = await deps.listFetcher.read(pageNumber)
      listPage = pageNumber
      if (list.items.length === 0) break
      let allSeen = true
      for (const item of list.items) {
        if (seen.has(item.postId)) continue
        allSeen = false
        seen.add(item.postId)
        const title = parseAttendanceTitle(item.title, item.postedAt)
        // A title null enough to parse as `other` has no post to store; an
        // attendance title is always a real string by the time it is one.
        if (title.kind === 'attendance' && item.title !== null) {
          attendance.set(item.postId, {
            postId: item.postId,
            kind: title.attendanceKind,
            period: title.period,
            title: item.title,
            postedAt: new Date(item.postedAt),
          })
        }
      }
      if (allSeen) break
    }
    return [...attendance.values()]
  }

  /**
   * Read and store one attendance post, or refuse it with the rule that caught it.
   * Returns false when a stop lands while yielding to a session before the body
   * read, so the run ends `stopped` with nothing stored for this post.
   */
  async function readOne(repository: AttendanceRepository, post: AttendancePostRecord, pace: () => Promise<void>): Promise<boolean> {
    if (post.period === null) {
      await repository.saveRefused(post, 'PERIOD_UNREADABLE', new Date(deps.now()))
      return true
    }
    await pace()
    if (!(await yieldToSession())) return false
    const body = await deps.bodyFetcher.read(post.postId)
    const readAt = new Date(deps.now())
    if (body.kind === 'absent') {
      await repository.saveRefused(post, 'ARTICLE_ABSENT', readAt)
      return true
    }
    const winners = parseAttendanceWinners(body.contentHtml)
    if (!winners.ok) {
      await repository.saveRefused(post, winners.rule, readAt)
      return true
    }
    await repository.saveRecorded({ ...post, period: post.period }, winners.nicknames, readAt)
    return true
  }

  return {
    start() {
      if (inFlight !== null) return 'ALREADY_RUNNING'
      const repository = deps.repository()
      if (repository === null) return 'DATABASE_DISABLED'
      if (!deps.isConnected()) return 'EXTENSION_OFFLINE'
      if (!deps.lock.tryAcquire()) return 'COLLECTION_BUSY'
      abortRequested = false
      state = 'idle'
      listPage = 0
      postsTotal = 0
      postsRead = 0
      failureCode = null
      inFlight = run(repository)
        .catch((error: unknown) => {
          state = 'failed'
          failureCode = failureCodeOf(error)
          deps.onError(error)
        })
        .finally(() => {
          inFlight = null
          deps.lock.release()
        })
      return 'STARTED'
    },
    stop() {
      abortRequested = true
    },
    progress() {
      return { state, listPage, postsTotal, postsRead, failureCode }
    },
    settled() {
      return inFlight ?? Promise.resolve()
    },
  }
}
