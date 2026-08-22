import { PROTOCOL_VERSION, isAppMessage, type AppMessage, type ExtensionMessage } from '../shared/protocol.js'
import { stubCandidates } from './stub.js'

const BRIDGE_URL = 'ws://127.0.0.1:39217'
const RECONNECT_ALARM = 'bridge-reconnect'
const RECONNECT_PERIOD_MINUTES = 1

let socket: WebSocket | null = null

function send(message: ExtensionMessage): void {
  socket?.send(JSON.stringify(message))
}

async function readToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get('pairingToken')
  const token: unknown = stored.pairingToken
  return typeof token === 'string' ? token : null
}

function handle(message: AppMessage): void {
  switch (message.type) {
    case 'HELLO_ACK':
      if (!message.accepted) {
        console.warn('[bridge] handshake rejected:', message.reason)
        socket?.close()
      }
      return

    case 'CHECK_LOGIN':
      send({ type: 'LOGIN_STATE', requestId: message.requestId, loggedIn: true, account: 'stub-operator' })
      return

    case 'COLLECT':
      send({ type: 'COLLECTED', requestId: message.requestId, candidates: stubCandidates(message.sincePostId) })
      return

    case 'EXECUTE':
      send({
        type: 'EXECUTED',
        requestId: message.requestId,
        ok: true,
        strategy: 'FETCH',
        commentAuthors: [],
        error: null,
      })
      return

    case 'ABORT':
      return
  }
}

async function connect(): Promise<void> {
  if (socket !== null && socket.readyState <= WebSocket.OPEN) return

  const token = await readToken()
  if (token === null) return

  const ws = new WebSocket(BRIDGE_URL)
  socket = ws

  ws.addEventListener('open', () => {
    send({ type: 'HELLO', token, extensionId: chrome.runtime.id, protocolVersion: PROTOCOL_VERSION })
  })

  ws.addEventListener('message', (event) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (isAppMessage(parsed)) handle(parsed)
  })

  ws.addEventListener('close', () => {
    if (socket === ws) socket = null
  })
}

/**
 * The only timer in the extension. WebSocket traffic keeps the service worker
 * alive during a session (Chrome 116+), but between sessions the worker is torn
 * down and takes the socket with it. The app cannot wake a dead worker, so the
 * extension re-establishes the connection on its own.
 */
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_PERIOD_MINUTES })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connect()
})
chrome.runtime.onStartup.addListener(() => void connect())
chrome.runtime.onInstalled.addListener(() => void connect())
void connect()
