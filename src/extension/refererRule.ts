/**
 * `Referer` cannot be set through `fetch` — it is a forbidden header — and the
 * cafe's comment endpoints ignore a request that does not carry one, answering
 * 200 while writing nothing. `Origin` is forbidden in the same way, and the
 * article endpoints allow only `https://cafe.naver.com`, so both headers are
 * rewritten together for the one request that needs them.
 */
export const REFERER_RULE_ID = 1

/**
 * Every host the comment endpoints live on. Chrome matches sub-domains too, so
 * `cafe.naver.com` also covers `article.cafe.naver.com`, where the article
 * comments are read. A host left out of this list is not a visible error: the
 * request simply goes out without a referer and the comment is lost.
 */
const COMMENT_DOMAINS = ['cafe.naver.com', 'apis.naver.com']

export function refererRule(referer: string): chrome.declarativeNetRequest.Rule {
  return {
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
      requestDomains: COMMENT_DOMAINS,
      resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType],
    },
  }
}
