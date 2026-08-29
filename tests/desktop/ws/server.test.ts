import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { generateToken } from '../../../src/desktop/ws/pairing.js'
import { createBridgeServer, type BridgeServer } from '../../../src/desktop/ws/server.js'
import { PROTOCOL_VERSION, type ExtensionMessage } from '../../../src/shared/protocol.js'

const TOKEN = generateToken()
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

let server: BridgeServer | undefined
const firstMessages = new WeakMap<WebSocket, Promise<Record<string, unknown>>>()

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function connect(token: string, origin = ORIGIN): Promise<WebSocket> {
  if (server === undefined) throw new Error('server not started')
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin })
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  firstMessages.set(
    ws,
    new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(String(data)) as Record<string, unknown>))
    }),
  )
  ws.send(JSON.stringify({ type: 'HELLO', token, extensionId: 'ignored', protocolVersion: PROTOCOL_VERSION }))
  return ws
}

async function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  const first = firstMessages.get(ws)
  if (first !== undefined) {
    firstMessages.delete(ws)
    return first
  }
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

  it('rotates the token before accepting a replacement extension', async () => {
    server = await createBridgeServer({
      token: TOKEN,
      boundExtensionId: 'oldoldoldoldoldoldoldoldoldoldol',
    })
    const replacementOrigin = 'chrome-extension://newnewnewnewnewnewnewnewnewnewne'

    const rejected = await connect(TOKEN, replacementOrigin)
    expect(await nextMessage(rejected)).toEqual({
      type: 'HELLO_ACK',
      accepted: false,
      reason: 'WRONG_EXTENSION',
    })

    const nextToken = generateToken()
    server.resetPairing(nextToken)

    const stale = await connect(TOKEN, replacementOrigin)
    expect(await nextMessage(stale)).toEqual({
      type: 'HELLO_ACK',
      accepted: false,
      reason: 'BAD_TOKEN',
    })

    const accepted = await connect(nextToken, replacementOrigin)
    expect(await nextMessage(accepted)).toEqual({
      type: 'HELLO_ACK',
      accepted: true,
      reason: null,
    })
    expect(server.isConnected()).toBe(true)
    accepted.close()
  })

  it('rejects an in-flight request immediately when pairing is reset', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
    await nextMessage(ws)
    const request = server.request(
      { type: 'CHECK_LOGIN', requestId: 'reset-r1', source: { cafeId: 'c', boardId: 'b' } },
      5_000,
    )

    server.resetPairing(generateToken())

    await expect(request).rejects.toThrow(/pairing reset/i)
  })

  it('closes every authorised socket when pairing is reset', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const first = await connect(TOKEN)
    await nextMessage(first)
    const second = await connect(TOKEN)
    await nextMessage(second)
    const firstClosed = new Promise<void>((resolve) => first.once('close', () => resolve()))
    const secondClosed = new Promise<void>((resolve) => second.once('close', () => resolve()))

    server.resetPairing(generateToken())

    await Promise.all([firstClosed, secondClosed])
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

    const reply = (await server.request({ type: 'CHECK_LOGIN', requestId: 'r1', source: { cafeId: 'c', boardId: 'b' } }, 1_000)) as Extract<
      ExtensionMessage,
      { type: 'LOGIN_STATE' }
    >

    expect(reply.loggedIn).toBe(true)
    expect(reply.account).toBe('cafe-ops')
    ws.close()
  })

  it('takes a keepalive without disturbing the request in flight', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
    await nextMessage(ws)

    const promise = server.request(
      { type: 'CHECK_LOGIN', requestId: 'r6', source: { cafeId: 'c', boardId: 'b' } },
      1_000,
    )

    // A keepalive belongs to no request. Resolving or refreshing one on it would
    // answer the app with a message that carries none of what it asked for.
    ws.send(JSON.stringify({ type: 'PING', requestId: null }))
    await new Promise((r) => setTimeout(r, 20))

    ws.send(JSON.stringify({ type: 'LOGIN_STATE', requestId: 'r6', loggedIn: true, account: 'cafe-ops' }))

    const reply = (await promise) as Extract<ExtensionMessage, { type: 'LOGIN_STATE' }>
    expect(reply.type).toBe('LOGIN_STATE')
    expect(reply.account).toBe('cafe-ops')
    expect(server.isConnected()).toBe(true)
    ws.close()
  })

  it('rejects a request that gets no reply before the timeout', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
    await nextMessage(ws)

    await expect(server.request({ type: 'CHECK_LOGIN', requestId: 'r2', source: { cafeId: 'c', boardId: 'b' } }, 50)).rejects.toThrow(/timed out/i)
    ws.close()
  })

  it('rejects a request when no extension is connected', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    await expect(server.request({ type: 'CHECK_LOGIN', requestId: 'r3', source: { cafeId: 'c', boardId: 'b' } }, 50)).rejects.toThrow(/not connected/i)
  })

  it('does not resolve on interim COLLECT_PROGRESS messages', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
    await nextMessage(ws)

    let resolved = false
    const request = server.request(
      { type: 'COLLECT', requestId: 'r4', automationId: 'welcome-comment', source: { cafeId: 'c', boardId: 'b' }, sincePostedAt: 0 },
      5_000,
    )

    const promise = request.then(() => {
      resolved = true
      return 'done'
    })

    // Send an interim progress message
    ws.send(JSON.stringify({ type: 'COLLECT_PROGRESS', requestId: 'r4', pagesRead: 1, collected: 50 }))

    // Let the async handler run
    await new Promise((r) => setTimeout(r, 20))

    // Interim message should not have resolved the request
    expect(resolved).toBe(false)

    // Now send the final message
    ws.send(JSON.stringify({ type: 'COLLECTED', requestId: 'r4', candidates: [] }))

    const result = await promise
    expect(result).toEqual('done')
    ws.close()
  })

  it('refreshes timeout on interim COLLECT_PROGRESS messages', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
    await nextMessage(ws)

    const promise = server.request(
      { type: 'COLLECT', requestId: 'r5', automationId: 'welcome-comment', source: { cafeId: 'c', boardId: 'b' }, sincePostedAt: 0 },
      50, // Very short timeout
    )

    // Send interim progress before timeout
    await new Promise((r) => setTimeout(r, 30))
    ws.send(JSON.stringify({ type: 'COLLECT_PROGRESS', requestId: 'r5', pagesRead: 1, collected: 50 }))

    // Should still be waiting, not timed out
    await new Promise((r) => setTimeout(r, 30))

    // Send final message while still within refreshed timeout
    ws.send(JSON.stringify({ type: 'COLLECTED', requestId: 'r5', candidates: [] }))

    const result = await promise
    expect(result).toEqual({ type: 'COLLECTED', requestId: 'r5', candidates: [] })
    ws.close()
  })
})
