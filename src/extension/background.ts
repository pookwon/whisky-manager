import { charsetFromContentType, isProbeTarget } from '../shared/probe.js'
import type { AppMessage } from '../shared/protocol.js'
import type { Random } from '../shared/ports.js'
import { createArticleClient } from './articleClient.js'
import { createBridgeClient, type Reply } from './bridgeClient.js'
import { createCafeClient, type HttpRequest, type HttpResponse } from './cafeClient.js'
import { createBoardPageReader } from './boardPageReader.js'
import { createBoardSearchPageReader } from './boardSearchPageReader.js'
import { createArticleReader } from './articleReader.js'
import { createDispatcher, type CollectionProgress } from './dispatch.js'
import { createMemberPageReader } from './memberPageReader.js'
import { refererRuleFor } from './refererRule.js'

const BRIDGE_URL = 'ws://127.0.0.1:39217'
const RECONNECT_ALARM = 'bridge-reconnect'
const RECONNECT_PERIOD_MINUTES = 1

/** Random number generator for the extension using crypto.getRandomValues. */
const extensionRandom: Random = {
  intInclusive(min, max) {
    const range = max - min + 1
    const bytesNeeded = Math.ceil(Math.log2(range) / 8)
    const randomBytes = new Uint8Array(bytesNeeded)
    const maxRandom = Math.pow(256, bytesNeeded)
    const bucket = Math.floor(maxRandom / range) * range
    let randomValue: number

    do {
      globalThis.crypto?.getRandomValues(randomBytes)
      randomValue = 0
      for (let i = 0; i < bytesNeeded; i++) {
        randomValue = (randomValue << 8) | (randomBytes[i] ?? 0)
      }
    } while (randomValue >= bucket)

    return min + (randomValue % range)
  },
}

/**
 * The rule is installed for the one request that needs it and torn down
 * straight afterwards, so nothing else in the browser is affected.
 *
 * The rule is the endpoint's own, not a shared one: installing and removing by
 * a single id let one request's teardown strip another's rule mid-flight, and a
 * comment write that goes out without a referer is answered 200 and writes
 * nothing. Scheduling now runs one session at a time, so the two automations no
 * longer overlap — but a rule that is only correct while that holds is a rule
 * waiting for the next caller.
 */
async function withReferer<T>(url: string, referer: string | undefined, run: () => Promise<T>): Promise<T> {
  if (referer === undefined) return run()

  const rule = refererRuleFor(url, referer)
  if (rule === null) {
    // Saying so out loud, because the request still goes out: an address that
    // needs a referer and has no rule is a comment lost with no error anywhere.
    console.warn('[cafe] no referer rule covers', url)
    return run()
  }

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [rule.id],
    addRules: [rule],
  })

  try {
    return await run()
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule.id] })
  }
}

/**
 * Every request goes through the browser's own session, so no cookie ever
 * leaves it. Bodies are decoded with the charset the response declares: the
 * memo board is served as MS949 and `res.text()` would mangle every hangul.
 */
async function request(init: HttpRequest): Promise<HttpResponse> {
  const headers = {
    ...init.headers,
    ...(init.contentType === undefined ? {} : { 'Content-Type': init.contentType }),
  }
  const response = await withReferer(init.url, init.referer, () =>
    fetch(init.url, {
      method: init.method ?? 'GET',
      credentials: 'include',
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
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

/**
 * Naver defines `lcs_do` in the page's main world, not in the extension
 * worker. It is telemetry only, so an absent function (or no open cafe tab)
 * must not prevent a legitimate comment from being sent.
 */
async function runLcsDo(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id === undefined || !tab.url?.startsWith('https://cafe.naver.com/')) return

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const lcsDo = (globalThis as typeof globalThis & { lcs_do?: unknown }).lcs_do
        if (typeof lcsDo === 'function') lcsDo.call(globalThis)
      },
    })
  } catch (error) {
    // The tab may have navigated between query and injection. The following
    // request is still valid and its result is verified by re-reading comments.
    console.warn('[cafe] lcs_do could not run:', error)
  }
}

let onCollectionProgress: CollectionProgress | null = null

const cafe = createCafeClient({
  http: request,
  random: extensionRandom,
  beforeCommentPost: async () => runLcsDo(),
  onCollectionProgress: (pagesRead, collected) => onCollectionProgress?.(pagesRead, collected),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
})

/**
 * Ordinary articles are a different surface from the memo board: another host,
 * another body encoding, and a login the comment response itself names. It
 * shares the transport and the telemetry hook, and nothing else.
 */
const articleCafe = createArticleClient({ http: request, beforeCommentPost: async () => runLcsDo() })

const boardPageReader = createBoardPageReader({ http: request })
const boardSearchPageReader = createBoardSearchPageReader({ http: request })
const articleReader = createArticleReader({ http: request })
const memberPageReader = createMemberPageReader({ http: request })

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

const dispatch = createDispatcher({
  cafe,
  articleCafe,
  boardPageReader,
  boardSearchPageReader,
  articleReader,
  memberPageReader,
  probe,
  onHandshakeRejected: (reason) => {
    console.warn('[bridge] handshake rejected:', reason)
    client.disconnect()
  },
  setCollectionProgress: (listener) => {
    onCollectionProgress = listener
  },
})

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
  repeat: (periodMs, run) => {
    const timer = setInterval(run, periodMs)
    return () => clearInterval(timer)
  },
})

/**
 * Recovery, not upkeep. The keepalive holds an established connection open; this
 * alarm dials again after the things it cannot prevent — a browser restart, a
 * crashed worker, or an app that was not running when the extension first tried.
 * The app cannot wake a dead worker, so the extension retries on its own.
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
