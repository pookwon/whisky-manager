import { WebSocketServer, type WebSocket } from 'ws'
import { isExtensionMessage, type AppMessage, type ExtensionMessage } from '../../shared/protocol.js'
import { verifyHello, type PairingState } from './pairing.js'

export interface ExtensionTransport {
  isConnected(): boolean
  request(message: AppMessage, timeoutMs: number): Promise<ExtensionMessage>
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
      if (parsed.type === 'ERROR' && parsed.requestId === null) return

      const waiting = pending.get(parsed.requestId)
      if (waiting === undefined) return
      clearTimeout(waiting.timer)
      pending.delete(parsed.requestId)
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

    request(message, timeoutMs) {
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

        pending.set(requestId, { resolve, reject, timer })
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
