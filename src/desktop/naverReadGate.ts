import type { AppMessage, ExtensionMessage } from '../shared/protocol.js'
import type { ExtensionTransport } from './ws/server.js'

type InterimListener = (message: ExtensionMessage) => void

interface QueuedBoardPage {
  readonly message: Extract<AppMessage, { type: 'COLLECT_BOARD_PAGE' }>
  readonly timeoutMs: number
  readonly onInterim: InterimListener | undefined
  readonly resolve: (message: ExtensionMessage) => void
  readonly reject: (error: Error) => void
}

/**
 * Serializes all Naver reads without changing createCollectGate's special
 * same-range joining behaviour. Existing COLLECT calls may join the active
 * walk; a queued COLLECT always runs before the next board page. Writes and
 * other non-read messages deliberately bypass this gate.
 */
export function createNaverReadGate(inner: ExtensionTransport): ExtensionTransport {
  let activeCollects = 0
  let boardPageInFlight = false
  const queuedCollects: Array<{
    message: Extract<AppMessage, { type: 'COLLECT' }>
    timeoutMs: number
    onInterim: InterimListener | undefined
    resolve: (message: ExtensionMessage) => void
    reject: (error: Error) => void
  }> = []
  const queuedBoardPages: QueuedBoardPage[] = []

  const startCollect = (
    message: Extract<AppMessage, { type: 'COLLECT' }>,
    timeoutMs: number,
    onInterim: InterimListener | undefined,
  ): Promise<ExtensionMessage> => {
    activeCollects += 1
    const reply = inner.request(message, timeoutMs, onInterim)
    void reply.then(
      () => {
        activeCollects -= 1
        drain()
      },
      () => {
        activeCollects -= 1
        drain()
      },
    )
    return reply
  }

  const startBoardPage = (queued: QueuedBoardPage): void => {
    boardPageInFlight = true
    void inner.request(queued.message, queued.timeoutMs, queued.onInterim).then(
      (result) => queued.resolve(result),
      (error: unknown) => queued.reject(error instanceof Error ? error : new Error(String(error))),
    ).finally(() => {
      boardPageInFlight = false
      drain()
    })
  }

  const drain = (): void => {
    if (boardPageInFlight || activeCollects > 0) return
    if (queuedCollects.length > 0) {
      // Start every waiting COLLECT together. The inner collect gate preserves
      // same-range joining and serializes different ranges as it always has.
      for (const queued of queuedCollects.splice(0)) {
        void startCollect(queued.message, queued.timeoutMs, queued.onInterim).then(queued.resolve, queued.reject)
      }
      return
    }
    const boardPage = queuedBoardPages.shift()
    if (boardPage !== undefined) startBoardPage(boardPage)
  }

  return {
    isConnected: () => inner.isConnected(),

    request(message, timeoutMs, onInterim) {
      if (message.type === 'COLLECT') {
        if (!boardPageInFlight) return startCollect(message, timeoutMs, onInterim)
        return new Promise<ExtensionMessage>((resolve, reject) => {
          queuedCollects.push({ message, timeoutMs, onInterim, resolve, reject })
        })
      }

      if (message.type === 'COLLECT_BOARD_PAGE') {
        return new Promise<ExtensionMessage>((resolve, reject) => {
          queuedBoardPages.push({ message, timeoutMs, onInterim, resolve, reject })
          drain()
        })
      }

      return inner.request(message, timeoutMs, onInterim)
    },
  }
}
