import { WebSocketServer, type WebSocket } from 'ws'
import {
  isExtensionMessage,
  isInterimMessage,
  type AppMessage,
  type ExtensionMessage,
} from '../../shared/protocol.js'
import { verifyHello, type PairingState } from './pairing.js'

export interface ExtensionTransport {
  isConnected(): boolean
  request(message: AppMessage, timeoutMs: number, onInterim?: (message: ExtensionMessage) => void): Promise<ExtensionMessage>
}

export interface BridgeServer extends ExtensionTransport {
  readonly port: number
  close(): Promise<void>
}

export interface BridgeServerOptions extends PairingState {
  /** 0 lets the OS pick a free port, which keeps tests independent. */
  readonly port?: number
  readonly onBind?: (extensionId: string) => void
}

interface Pending {
  resolve(message: ExtensionMessage): void
  reject(error: Error): void
  timer: NodeJS.Timeout
  timeoutMs: number
  messageType: string
  onInterim: ((message: ExtensionMessage) => void) | undefined
}

function requestIdOf(message: AppMessage): string | null {
  return 'requestId' in message ? message.requestId : null
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: options.port ?? 0 })
  const pending = new Map<string, Pending>()
  let peer: WebSocket | null = null
  let bound = options.boundExtensionId

  await new Promise<void>((resolve) => wss.once('listening', resolve))

  wss.on('connection', (socket, req) => {
    let authorised = false

    socket.on('message', (data) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(data))
      } catch {
        return
      }
      if (!isExtensionMessage(parsed)) return

      if (parsed.type === 'HELLO') {
        const verdict = verifyHello(
          { token: options.token, boundExtensionId: bound },
          { token: parsed.token, origin: req.headers.origin, protocolVersion: parsed.protocolVersion },
        )
        const ack: AppMessage = {
          type: 'HELLO_ACK',
          accepted: verdict.accepted,
          reason: verdict.accepted ? null : verdict.reason,
        }
        socket.send(JSON.stringify(ack))
        if (!verdict.accepted) {
          socket.close()
          return
        }
        authorised = true
        peer = socket
        if (bound === null) {
          bound = verdict.boundExtensionId
          options.onBind?.(verdict.boundExtensionId)
        }
        return
      }

      if (!authorised) return

      // Every reply but HELLO carries a requestId; a PING always carries null and
      // an ERROR may, when it is not tied to a specific request. There is nothing
      // to resolve then, and a keepalive must not disturb a request in flight.
      const requestId: string | null = parsed.requestId
      if (requestId === null) return

      const waiting = pending.get(requestId)
      if (waiting === undefined) return

      // A message about a request still running refreshes the wait rather than
      // ending it, so the timeout measures silence instead of total work. Which
      // types those are is declared with the messages themselves, so a new one
      // cannot reach this line as a final reply by omission.
      if (isInterimMessage(parsed)) {
        waiting.onInterim?.(parsed)
        clearTimeout(waiting.timer)
        waiting.timer = setTimeout(() => {
          pending.delete(requestId)
          waiting.reject(new Error(`request ${waiting.messageType} timed out after ${waiting.timeoutMs}ms`))
        }, waiting.timeoutMs)
        return
      }

      // Final message: resolve the request and stop waiting.
      clearTimeout(waiting.timer)
      pending.delete(requestId)
      waiting.resolve(parsed)
    })

    socket.on('close', () => {
      if (peer === socket) peer = null
    })
  })

  return {
    port: (wss.address() as { port: number }).port,

    isConnected() {
      return peer !== null
    },

    request(message, timeoutMs, onInterim) {
      const socket = peer
      if (socket === null) {
        return Promise.reject(new Error('extension is not connected'))
      }
      const requestId = requestIdOf(message)
      if (requestId === null) {
        return Promise.reject(new Error('message has no requestId and cannot be awaited'))
      }

      return new Promise<ExtensionMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(`request ${message.type} timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        pending.set(requestId, { resolve, reject, timer, timeoutMs, messageType: message.type, onInterim })
        socket.send(JSON.stringify(message))
      })
    },

    async close() {
      for (const [, waiting] of pending) {
        clearTimeout(waiting.timer)
        waiting.reject(new Error('bridge server closed'))
      }
      pending.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
