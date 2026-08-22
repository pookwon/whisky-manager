import { PROTOCOL_VERSION, isAppMessage, type AppMessage, type ExtensionMessage } from '../shared/protocol.js'

/** The slice of WebSocket this client uses, so it can be driven in tests. */
export interface Socket {
  readonly readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: (event: unknown) => void): void
}

const OPEN = 1

export type Reply = (message: ExtensionMessage) => void

export interface BridgeClientDeps {
  readonly url: string
  readonly extensionId: string
  readonly open: (url: string) => Socket
  readonly readToken: () => Promise<string | null>
  readonly handle: (message: AppMessage, reply: Reply) => void
}

export interface BridgeClient {
  connect(): Promise<void>
  disconnect(): void
  isConnected(): boolean
}

/**
 * Owns the single socket to the desktop app.
 *
 * Two rules keep it honest, and both exist because breaking them produced real
 * `InvalidStateError` crashes. Replies go through the socket that carried the
 * request, never through whichever socket happens to be current — an open event
 * can arrive after its socket was replaced. And `connect()` shares one in-flight
 * promise, because reading the token is async: a guard checked before that await
 * does not still hold after it, so three callers would open three sockets.
 */
export function createBridgeClient(deps: BridgeClientDeps): BridgeClient {
  let socket: Socket | null = null
  let connecting: Promise<void> | null = null

  const replyVia =
    (target: Socket): Reply =>
    (message) => {
      // A socket that has been replaced or dropped is simply not written to.
      if (target.readyState === OPEN) target.send(JSON.stringify(message))
    }

  function forget(target: Socket): void {
    if (socket === target) socket = null
  }

  async function dial(token: string): Promise<void> {
    const ws = deps.open(deps.url)
    socket = ws
    const reply = replyVia(ws)

    ws.addEventListener('open', () => {
      reply({ type: 'HELLO', token, extensionId: deps.extensionId, protocolVersion: PROTOCOL_VERSION })
    })

    ws.addEventListener('message', (event) => {
      const data: unknown = (event as { data?: unknown }).data
      let parsed: unknown
      try {
        parsed = JSON.parse(String(data))
      } catch {
        return
      }
      if (isAppMessage(parsed)) deps.handle(parsed, reply)
    })

    // The app is not always running, so a refused connection is a state, not a
    // fault. Without a listener chrome logs it as an uncaught extension error.
    ws.addEventListener('error', () => forget(ws))
    ws.addEventListener('close', () => forget(ws))

    await Promise.resolve()
  }

  async function run(): Promise<void> {
    const token = await deps.readToken()
    // Nothing to dial with until the operator pastes the token from the app.
    if (token === null) return
    if (socket !== null) return
    await dial(token)
  }

  return {
    connect() {
      if (socket !== null) return Promise.resolve()
      connecting ??= run().finally(() => {
        connecting = null
      })
      return connecting
    },

    disconnect() {
      socket?.close()
      socket = null
    },

    isConnected() {
      return socket !== null && socket.readyState === OPEN
    },
  }
}
