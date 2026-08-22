import { describe, expect, it } from 'vitest'
import { createBridgeClient, type Socket } from '../../src/extension/bridgeClient.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3

class FakeSocket implements Socket {
  readyState = CONNECTING
  readonly sent: string[] = []
  closed = false
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  send(data: string): void {
    if (this.readyState !== OPEN) {
      // The real WebSocket throws exactly here; that is the bug under test.
      throw new Error("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.")
    }
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.readyState = CLOSED
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, event: unknown = {}): void {
    if (type === 'open') this.readyState = OPEN
    if (type === 'close' || type === 'error') this.readyState = CLOSED
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function harness(overrides: { token?: string | null } = {}) {
  const sockets: FakeSocket[] = []
  const handled: AppMessage[] = []
  const client = createBridgeClient({
    url: 'ws://127.0.0.1:39217',
    extensionId: 'abcdef',
    open: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    readToken: () => Promise.resolve(overrides.token === undefined ? 'tok' : overrides.token),
    handle: (message, reply) => {
      handled.push(message)
      if (message.type === 'CHECK_LOGIN') {
        reply({ type: 'LOGIN_STATE', requestId: message.requestId, loggedIn: true, account: 'ops' })
      }
    },
  })
  return { client, sockets, handled }
}

describe('createBridgeClient', () => {
  it('opens one socket even when connect is called concurrently', async () => {
    const { client, sockets } = harness()

    // The alarm, onInstalled and a token save all call connect(); the token read
    // is async, so a guard checked before the await would let every one through.
    await Promise.all([client.connect(), client.connect(), client.connect()])

    expect(sockets).toHaveLength(1)
  })

  it('does not send through a socket that replaced the one it was opened for', async () => {
    const { client, sockets } = harness()
    await client.connect()
    const first = sockets[0] as FakeSocket

    // A token change drops the current socket and dials again. The old socket
    // may still fire `open` afterwards, and it must not reach the new one.
    client.disconnect()
    await client.connect()
    const second = sockets[1] as FakeSocket
    expect(second.readyState).toBe(CONNECTING)

    expect(() => first.emit('open')).not.toThrow()
    expect(second.sent).toHaveLength(0)
  })

  it('greets with the paired token once the socket opens', async () => {
    const { client, sockets } = harness()
    await client.connect()
    const socket = sockets[0] as FakeSocket

    socket.emit('open')

    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({
      type: 'HELLO',
      token: 'tok',
      extensionId: 'abcdef',
    })
  })

  it('routes app messages to the handler and replies through the same socket', async () => {
    const { client, sockets, handled } = harness()
    await client.connect()
    const socket = sockets[0] as FakeSocket
    socket.emit('open')

    socket.emit('message', { data: JSON.stringify({ type: 'CHECK_LOGIN', requestId: 'r1', source: { cafeId: 'c', boardId: 'b' } }) })

    expect(handled.map((m) => m.type)).toEqual(['CHECK_LOGIN'])
    const reply = JSON.parse(socket.sent[1] as string) as ExtensionMessage
    expect(reply).toMatchObject({ type: 'LOGIN_STATE', requestId: 'r1' })
  })

  it('ignores traffic that is not an app message', async () => {
    const { client, sockets, handled } = harness()
    await client.connect()
    const socket = sockets[0] as FakeSocket
    socket.emit('open')

    socket.emit('message', { data: 'not json' })
    socket.emit('message', { data: JSON.stringify({ type: 'LOGIN_STATE' }) })

    expect(handled).toEqual([])
  })

  it('reconnects after the socket drops', async () => {
    const { client, sockets } = harness()
    await client.connect()
    ;(sockets[0] as FakeSocket).emit('close')
    expect(client.isConnected()).toBe(false)

    await client.connect()

    expect(sockets).toHaveLength(2)
  })

  it('treats a refused connection as a normal state, not a throw', async () => {
    const { client, sockets } = harness()
    await client.connect()

    // The app is not always running; an error event must clear the socket so the
    // next alarm can retry, without surfacing as an uncaught extension error.
    expect(() => (sockets[0] as FakeSocket).emit('error')).not.toThrow()
    expect(client.isConnected()).toBe(false)
  })

  it('stays idle until the operator has pasted a pairing token', async () => {
    const { client, sockets } = harness({ token: null })

    await client.connect()

    expect(sockets).toHaveLength(0)
  })
})
