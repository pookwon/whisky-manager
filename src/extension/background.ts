import { charsetFromContentType, isProbeTarget } from '../shared/probe.js'
import type { AppMessage } from '../shared/protocol.js'
import { createBridgeClient, type Reply } from './bridgeClient.js'
import { createCafeClient, type HttpRequest, type HttpResponse } from './cafeClient.js'

const BRIDGE_URL = 'ws://127.0.0.1:39217'
const RECONNECT_ALARM = 'bridge-reconnect'
const RECONNECT_PERIOD_MINUTES = 1

/**
 * `Referer` cannot be set through `fetch` — it is a forbidden header — and the
 * cafe's write endpoints ignore a request that does not carry one. A session
 * rule rewrites the header for the one request that needs it, and is torn down
 * straight afterwards so nothing else in the browser is affected.
 */
const REFERER_RULE_ID = 1

async function withReferer<T>(referer: string | undefined, run: () => Promise<T>): Promise<T> {
  if (referer === undefined) return run()

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [REFERER_RULE_ID],
    addRules: [
      {
        id: REFERER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [
            {
              header: 'referer',
              operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
              value: referer,
            },
            {
              header: 'origin',
              operation: 'set' as chrome.declarativeNetRequest.HeaderOperation,
              value: new URL(referer).origin,
            },
          ],
        },
        condition: {
          urlFilter: '|https://cafe.naver.com/',
          resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType],
        },
      },
    ],
  })

  try {
    return await run()
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [REFERER_RULE_ID] })
  }
}

/**
 * Every request goes through the browser's own session, so no cookie ever
 * leaves it. Bodies are decoded with the charset the response declares: the
 * memo board is served as MS949 and `res.text()` would mangle every hangul.
 */
async function request(init: HttpRequest): Promise<HttpResponse> {
  const response = await withReferer(init.referer, () =>
    fetch(init.url, {
      method: init.method ?? 'GET',
      credentials: 'include',
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.contentType === undefined ? {} : { headers: { 'Content-Type': init.contentType } }),
    }),
  )
  const contentType = response.headers.get('content-type')
  const body = await response.arrayBuffer()
  return {
    status: response.status,
    contentType,
    text: new TextDecoder(charsetFromContentType(contentType)).decode(body),
  }
}

const cafe = createCafeClient({ http: request })

/** Diagnostic only; see `isProbeTarget` for the hosts it may reach. */
async function probe(requestId: string, url: string, reply: Reply): Promise<void> {
  if (!isProbeTarget(url)) {
    reply({ type: 'PROBE_RESULT', requestId, status: 0, contentType: null, text: '', error: 'URL_NOT_ALLOWED' })
    return
  }
  try {
    const response = await request({ url })
    reply({ type: 'PROBE_RESULT', requestId, ...response, error: null })
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

function failed(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The extension decides nothing. Each of these runs one instruction from the
 * app and reports what happened, so a torn-down service worker loses no state.
 */
async function dispatch(message: AppMessage, reply: Reply): Promise<void> {
  switch (message.type) {
    case 'HELLO_ACK':
      if (!message.accepted) {
        console.warn('[bridge] handshake rejected:', message.reason)
        client.disconnect()
      }
      return

    case 'CHECK_LOGIN': {
      const state = await cafe.checkLogin(message.source)
      reply({
        type: 'LOGIN_STATE',
        requestId: message.requestId,
        loggedIn: state.loggedIn,
        account: state.account,
      })
      return
    }

    case 'COLLECT': {
      const candidates = await cafe.collect(message.source, message.sincePostId)
      reply({ type: 'COLLECTED', requestId: message.requestId, candidates })
      return
    }

    case 'CHECK_COMMENTS': {
      const authors = await cafe.checkComments(
        { cafeId: message.action.cafeId, boardId: message.action.boardId },
        message.action.postId,
      )
      reply({ type: 'COMMENTS', requestId: message.requestId, authors })
      return
    }

    case 'EXECUTE': {
      const { cafeId, boardId, postId, body } = message.action
      const result = await cafe.execute({ cafeId, boardId }, postId, body)
      reply({
        type: 'EXECUTED',
        requestId: message.requestId,
        ok: result.ok,
        strategy: 'FETCH',
        commentAuthors: result.commentAuthors,
        error: result.error,
        diagnostic: result.diagnostic,
      })
      return
    }

    case 'PROBE':
      await probe(message.requestId, message.url, reply)
      return

    case 'ABORT':
      return
  }
}

function handle(message: AppMessage, reply: Reply): void {
  // A thrown request must still answer, or the app waits out its whole timeout
  // for a reply that is never coming.
  void dispatch(message, reply).catch((error: unknown) => {
    if ('requestId' in message) {
      reply({ type: 'ERROR', requestId: message.requestId, code: 'EXTENSION_FAILURE', message: failed(error) })
    }
  })
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
