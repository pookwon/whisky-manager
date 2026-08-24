import type { ExtensionMessage } from '../shared/protocol.js'
import type { ExtensionTransport } from './ws/server.js'

type InterimListener = (message: ExtensionMessage) => void

interface Walk {
  readonly sincePostedAt: number
  readonly reply: Promise<ExtensionMessage>
  readonly listeners: Set<InterimListener>
}

/**
 * Keeps the app to one collection walk at a time.
 *
 * A walk is a run of paged reads spaced seconds apart, and three of them can be
 * wanted at once: the startup banner's count, the confirmation panel's count,
 * and the session itself. Run together they interleave into a single stream of
 * requests at several times the pace each was written to keep — the very thing
 * the page gap exists to avoid — and they stretch each other past the collect
 * timeout, which the operator reads as a failure on a banner whose read was
 * fine.
 *
 * Callers wanting the range already under way join it rather than starting a
 * second walk. What they get back is a snapshot seconds old at worst, which is
 * what their own walk would have handed them anyway. Everything else — login
 * checks, comment lookups, executions — passes straight through: a walk must
 * not hold up a write.
 */
export function createCollectGate(inner: ExtensionTransport): ExtensionTransport {
  let walk: Walk | null = null

  return {
    isConnected: () => inner.isConnected(),

    async request(message, timeoutMs, onInterim) {
      if (message.type !== 'COLLECT') {
        return await inner.request(message, timeoutMs, onInterim)
      }

      // A walk over another range has to finish first. Whether it succeeded is
      // its own caller's to report, so its failure is swallowed here.
      while (walk !== null && walk.sincePostedAt !== message.sincePostedAt) {
        await walk.reply.catch(() => undefined)
      }

      if (walk !== null) {
        // The reply carries the requestId of whoever started the walk. Every
        // caller reads the candidates off it and none reads the id back.
        if (onInterim !== undefined) walk.listeners.add(onInterim)
        return await walk.reply
      }

      const listeners = new Set<InterimListener>()
      if (onInterim !== undefined) listeners.add(onInterim)

      const reply = inner.request(message, timeoutMs, (interim) => {
        for (const listener of listeners) listener(interim)
      })
      const started: Walk = { sincePostedAt: message.sincePostedAt, reply, listeners }
      walk = started

      try {
        return await reply
      } finally {
        // Only clear the walk this call started; a later one may already hold
        // the slot.
        if (walk === started) walk = null
      }
    },
  }
}
