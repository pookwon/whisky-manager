/**
 * What one request to the cafe looks like, and what comes back.
 *
 * These live in `shared` rather than in the extension because the modules that
 * build requests are pure functions tested against real captures, and those may
 * not import from `src/extension`. The extension owns the only implementation
 * of `Http`: it is the boundary where the browser session, its cookies and the
 * response charset are handled.
 */
export interface HttpRequest {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly body?: string
  readonly contentType?: string
  /**
   * Page this request should appear to come from. The extension sets `origin`
   * from it as well, because both headers are forbidden to `fetch` and the
   * endpoints that need one need the other.
   */
  readonly referer?: string
  /**
   * Headers beyond the content type. The article comment endpoints answer an
   * error page without `x-cafe-product`, so the request that needs it carries
   * it rather than the transport guessing which host wants what.
   */
  readonly headers?: Readonly<Record<string, string>>
}

export interface HttpResponse {
  readonly status: number
  readonly contentType: string | null
  /** Already decoded with the charset the response declared. */
  readonly text: string
}

export type Http = (request: HttpRequest) => Promise<HttpResponse>
