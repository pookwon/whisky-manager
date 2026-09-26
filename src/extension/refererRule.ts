/**
 * `Referer` cannot be set through `fetch` — it is a forbidden header — and the
 * cafe's comment endpoints ignore a request that does not carry one, answering
 * 200 while writing nothing. `Origin` is forbidden in the same way, and the
 * article endpoints allow only `https://cafe.naver.com`, so both headers are
 * rewritten together for the one request that needs them.
 */

/**
 * How Chrome is told which addresses a rule covers — exactly one of the two.
 * `urlFilter` spelled `||host/path` is a host-anchored prefix of host plus
 * path; `regexFilter` is for an address that is a prefix of another endpoint's
 * and can only be told apart by what follows it.
 */
type RefererMatch = { readonly urlFilter: string } | { readonly regexFilter: string }

type RefererEndpoint = RefererMatch & {
  /**
   * The rule's own id. One id per endpoint, because the rule is installed for
   * one request and removed when it ends: with a single shared id, a second
   * request's teardown strips the first request's rule, and that request then
   * goes out with no referer — answered 200, writing nothing.
   */
  readonly ruleId: number
  /** The host the endpoint lives on. Chrome reads it as the host or a sub-domain of it. */
  readonly requestDomain: string
  /** Above 1 for an endpoint whose addresses another rule's filter also covers; that one must win. */
  readonly priority?: number
}

/**
 * Every request that needs a referer, and nothing else.
 *
 * Scoped to the address rather than to the host: the board list the collection
 * walks lives on `apis.naver.com` too and legitimately carries neither referer
 * nor origin, so a host-wide rule rewrote both on a collection read that
 * happened during someone else's write. An endpoint missing from this list is
 * not a visible error — the request simply goes out without a referer and the
 * comment is lost — so it is the one place that knows these addresses, and its
 * tests hold them against the clients that build them.
 */
const ENDPOINTS: readonly RefererEndpoint[] = [
  // The memo board's comment write.
  {
    ruleId: 1,
    urlFilter: '||cafe.naver.com/MemoCommentPost.nhn',
    requestDomain: 'cafe.naver.com',
  },
  // An ordinary article's comment write.
  {
    ruleId: 2,
    urlFilter: '||apis.naver.com/cafe-web/cafe-mobile/CommentPost.json',
    requestDomain: 'apis.naver.com',
  },
  // An article read by id. Rule 3's path covers it too, but that rule belongs to
  // the comment read, and sharing its id would let one request's teardown strip
  // the other's referer. The comment path goes on after the id
  // (`/articles/{id}/comments/...`), so only the query right after the id tells
  // them apart. Listed first, and above rule 3 in priority, so the article read
  // is always this rule's.
  {
    ruleId: 5,
    regexFilter: '^https://article\\.cafe\\.naver\\.com/gw/v4/cafes/[0-9]+/articles/[0-9]+\\?',
    requestDomain: 'article.cafe.naver.com',
    priority: 2,
  },
  // An ordinary article's comment read, which proves both the login and the write.
  {
    ruleId: 3,
    urlFilter: '||article.cafe.naver.com/gw/v4/',
    requestDomain: 'article.cafe.naver.com',
  },
  // The board title search. The search screen sends it from the board's own
  // page, and the worker's request is made to look the same.
  {
    ruleId: 4,
    urlFilter: '||apis.cafe.naver.com/search/v2/cafes/14538121/search/articles',
    requestDomain: 'apis.cafe.naver.com',
  },
]

export const REFERER_RULE_IDS: readonly number[] = ENDPOINTS.map((endpoint) => endpoint.ruleId)

/** Whether an endpoint covers an address, read the way Chrome reads the condition we hand it. */
function covers(endpoint: RefererEndpoint, parsed: URL): boolean {
  if ('regexFilter' in endpoint) return new RegExp(endpoint.regexFilter).test(parsed.href)
  return `${parsed.host}${parsed.pathname}`.startsWith(endpoint.urlFilter.slice(2))
}

/** Which endpoint an address belongs to: the first that covers it. */
function endpointFor(url: string): RefererEndpoint | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return ENDPOINTS.find((endpoint) => covers(endpoint, parsed)) ?? null
}

/**
 * The rule for this one request, or null when the address needs none. A null is
 * the caller's cue that the request is about to go out as it is.
 */
export function refererRuleFor(url: string, referer: string): chrome.declarativeNetRequest.Rule | null {
  const endpoint = endpointFor(url)
  if (endpoint === null) return null

  return {
    id: endpoint.ruleId,
    priority: endpoint.priority ?? 1,
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
      requestDomains: [endpoint.requestDomain],
      ...('regexFilter' in endpoint ? { regexFilter: endpoint.regexFilter } : { urlFilter: endpoint.urlFilter }),
      resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType],
    },
  }
}
