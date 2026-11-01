import { matchesJoinPattern } from '../shared/joinPattern.js'
import { TIMEOUTS, type AppMessage, type ExtensionMessage } from '../shared/protocol.js'
import { recentJoinWindows, type JoinWindow, type StudioJoinMember, type StudioJoinPage } from '../shared/studioJoinList.js'
import type { ExtensionTransport } from './ws/server.js'

const SEARCH_DAYS = 30
/** The studio is one operator's screen, so the search keeps to that pace. */
const PAGE_PAUSE_MS = 1_000

const IDENTITY_REQUIRED = 'STUDIO_IDENTITY_REQUIRED'

export type JoinPatternSearchResult =
  | { readonly kind: 'EXTENSION_OFFLINE' }
  | { readonly kind: 'IDENTITY_REQUIRED' }
  | { readonly kind: 'FAILED'; readonly code: string }
  | {
      readonly kind: 'DONE'
      readonly from: string
      readonly to: string
      readonly scannedCount: number
      readonly candidates: readonly StudioJoinMember[]
    }

export interface JoinPatternSearchDeps {
  readonly transport: ExtensionTransport
  readonly newId: () => string
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

export interface JoinPatternSearch {
  search(): Promise<JoinPatternSearchResult>
  /** Sends the operator to the check; false when no browser is there to open it. */
  openIdentityCheck(): Promise<boolean>
  /** What the last finished search found. Held in memory only: it names members. */
  latestCandidates(): readonly StudioJoinMember[]
}

class StudioStop extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export function createJoinPatternSearch(deps: JoinPatternSearchDeps): JoinPatternSearch {
  let candidates: readonly StudioJoinMember[] = []
  let inFlight: Promise<JoinPatternSearchResult> | null = null

  async function ask(message: AppMessage): Promise<ExtensionMessage> {
    const reply = await deps.transport.request(message, TIMEOUTS.memberPageMs)
    if (reply.type === 'ERROR') throw new StudioStop(reply.code)
    return reply
  }

  async function identityVerified(): Promise<boolean> {
    const reply = await ask({ type: 'CHECK_STUDIO_IDENTITY', requestId: deps.newId() })
    if (reply.type !== 'STUDIO_IDENTITY') throw new StudioStop('STUDIO_UNEXPECTED_REPLY')
    return reply.verified
  }

  async function readPage(window: JoinWindow, page: number): Promise<StudioJoinPage> {
    const reply = await ask({
      type: 'COLLECT_STUDIO_JOIN_PAGE',
      requestId: deps.newId(),
      joinedFrom: window.from,
      joinedTo: window.to,
      page,
    })
    if (reply.type !== 'STUDIO_JOIN_PAGE_COLLECTED') throw new StudioStop('STUDIO_UNEXPECTED_REPLY')
    if (reply.result.capped) throw new StudioStop('STUDIO_WINDOW_CAPPED')
    return reply.result
  }

  /** Every member of one window, checked against the count the list itself gave. */
  async function readWindow(window: JoinWindow): Promise<readonly StudioJoinMember[]> {
    const members: StudioJoinMember[] = []
    for (let page = 1; ; page += 1) {
      const result = await readPage(window, page)
      members.push(...result.members)
      if (result.members.length === 0 || members.length >= result.totalCount) {
        if (members.length < result.totalCount) throw new StudioStop('STUDIO_WINDOW_SHORT')
        return members
      }
      await deps.sleep(PAGE_PAUSE_MS)
    }
  }

  async function run(): Promise<JoinPatternSearchResult> {
    if (!deps.transport.isConnected()) return { kind: 'EXTENSION_OFFLINE' }
    try {
      if (!(await identityVerified())) return { kind: 'IDENTITY_REQUIRED' }
      const windows = recentJoinWindows(deps.now(), SEARCH_DAYS)
      const scanned = new Map<string, StudioJoinMember>()
      for (const window of windows) {
        for (const member of await readWindow(window)) scanned.set(member.memberKey, member)
      }
      candidates = [...scanned.values()]
        .filter((member) => matchesJoinPattern(member.answers))
        .sort((left, right) => right.joinedAt.localeCompare(left.joinedAt))
      const from = windows[0]?.from ?? ''
      const to = windows[windows.length - 1]?.to ?? ''
      return { kind: 'DONE', from, to, scannedCount: scanned.size, candidates }
    } catch (error) {
      if (error instanceof StudioStop) {
        return error.code === IDENTITY_REQUIRED ? { kind: 'IDENTITY_REQUIRED' } : { kind: 'FAILED', code: error.code }
      }
      return { kind: 'FAILED', code: 'STUDIO_REQUEST_FAILED' }
    }
  }

  return {
    search() {
      inFlight ??= run().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    async openIdentityCheck() {
      if (!deps.transport.isConnected()) return false
      const reply = await deps.transport.request({ type: 'OPEN_STUDIO_IDENTITY', requestId: deps.newId() }, TIMEOUTS.extensionReplyMs)
      return reply.type === 'STUDIO_IDENTITY_OPENED'
    },
    latestCandidates: () => candidates,
  }
}
