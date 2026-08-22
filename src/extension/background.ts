import { charsetFromContentType, isProbeTarget } from '../shared/probe.js'
import type { AppMessage } from '../shared/protocol.js'
import { createBridgeClient, type Reply } from './bridgeClient.js'
import { stubCandidates } from './stub.js'

const BRIDGE_URL = 'ws://127.0.0.1:39217'
const RECONNECT_ALARM = 'bridge-reconnect'
const RECONNECT_PERIOD_MINUTES = 1

/**
 * Fetches through the browser's own session and hands the decoded body back.
 * The body is decoded with the charset the response declares, because the
 * cafe's legacy pages are MS949 and `res.text()` would mangle every hangul.
 */
async function probe(requestId: string, url: string, reply: Reply): Promise<void> {
  if (!isProbeTarget(url)) {
    reply({ type: 'PROBE_RESULT', requestId, status: 0, contentType: null, text: '', error: 'URL_NOT_ALLOWED' })
    return
  }
  try {
    const response = await fetch(url, { credentials: 'include' })
    const contentType = response.headers.get('content-type')
    const body = await response.arrayBuffer()
    reply({
      type: 'PROBE_RESULT',
      requestId,
      status: response.status,
      contentType,
      text: new TextDecoder(charsetFromContentType(contentType)).decode(body),
      error: null,
    })
  } catch (error) {
    reply({
      type: 'PROBE_RESULT',
      requestId,
      status: 0,
      contentType: null,
      text: '',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function handle(message: AppMessage, reply: Reply): void {
  switch (message.type) {
    case 'HELLO_ACK':
      if (!message.accepted) {
        console.warn('[bridge] handshake rejected:', message.reason)
        client.disconnect()
      }
      return

    case 'CHECK_LOGIN':
      reply({ type: 'LOGIN_STATE', requestId: message.requestId, loggedIn: true, account: 'stub-operator' })
      return

    case 'COLLECT':
      reply({ type: 'COLLECTED', requestId: message.requestId, candidates: stubCandidates(message.sincePostId) })
      return

    case 'CHECK_COMMENTS':
      reply({ type: 'COMMENTS', requestId: message.requestId, authors: [] })
      return

    case 'EXECUTE':
      reply({
        type: 'EXECUTED',
        requestId: message.requestId,
        ok: true,
        strategy: 'FETCH',
        commentAuthors: [],
        error: null,
      })
      return

    case 'PROBE':
      void probe(message.requestId, message.url, reply)
      return

    case 'ABORT':
      return
  }
}

const client = createBridgeClient({
  url: BRIDGE_URL,
  extensionId: chrome.runtime.id,
  open: (url) => new WebSocket(url),
  readToken: async () => {
    const stored = await chrome.storage.local.get('pairingToken')
    const token: unknown = stored.pairingToken
    return typeof token === 'string' ? token : null
  },
  handle,
})

/**
 * The only timer in the extension. WebSocket traffic keeps the service worker
 * alive during a session (Chrome 116+), but between sessions the worker is torn
 * down and takes the socket with it. The app cannot wake a dead worker, so the
 * extension re-establishes the connection on its own.
 */
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_PERIOD_MINUTES })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void client.connect()
})

/** Saving a token in the options page should pair immediately, not in a minute. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || changes.pairingToken === undefined) return
  client.disconnect()
  void client.connect()
})

chrome.runtime.onStartup.addListener(() => void client.connect())
chrome.runtime.onInstalled.addListener(() => void client.connect())
void client.connect()
