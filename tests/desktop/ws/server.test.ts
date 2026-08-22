import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { generateToken } from '../../../src/desktop/ws/pairing.js'
import { createBridgeServer, type BridgeServer } from '../../../src/desktop/ws/server.js'
import { PROTOCOL_VERSION, type ExtensionMessage } from '../../../src/shared/protocol.js'

const TOKEN = generateToken()
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

let server: BridgeServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function connect(token: string): Promise<WebSocket> {
  if (server === undefined) throw new Error('server not started')
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: ORIGIN })
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ type: 'HELLO', token, extensionId: 'ignored', protocolVersion: PROTOCOL_VERSION }))
  return ws
}

async function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data)) as Record<string, unknown>))
  })
}

describe('createBridgeServer', () => {
  it('acknowledges a valid handshake', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)

    expect(await nextMessage(ws)).toEqual({ type: 'HELLO_ACK', accepted: true, reason: null })
    expect(server.isConnected()).toBe(true)
    ws.close()
  })

  it('rejects a bad token and reports not connected', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect('wrong-token')

    const ack = await nextMessage(ws)
    expect(ack.accepted).toBe(false)
    expect(ack.reason).toBe('BAD_TOKEN')
    expect(server.isConnected()).toBe(false)
  })

  it('round-trips a request and its reply', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
    await nextMessage(ws)

    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { type: string; requestId?: string }
      if (msg.type === 'CHECK_LOGIN' && msg.requestId !== undefined) {
        ws.send(JSON.stringify({ type: 'LOGIN_STATE', requestId: msg.requestId, loggedIn: true, account: 'cafe-ops' }))
      }
    })

    const reply = (await server.request({ type: 'CHECK_LOGIN', requestId: 'r1' }, 1_000)) as Extract<
      ExtensionMessage,
      { type: 'LOGIN_STATE' }
    >

    expect(reply.loggedIn).toBe(true)
    expect(reply.account).toBe('cafe-ops')
    ws.close()
  })

  it('rejects a request that gets no reply before the timeout', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
    await nextMessage(ws)

    await expect(server.request({ type: 'CHECK_LOGIN', requestId: 'r2' }, 50)).rejects.toThrow(/timed out/i)
    ws.close()
  })

  it('rejects a request when no extension is connected', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    await expect(server.request({ type: 'CHECK_LOGIN', requestId: 'r3' }, 50)).rejects.toThrow(/not connected/i)
  })
})
