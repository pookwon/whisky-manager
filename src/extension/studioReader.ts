import type { HttpRequest, HttpResponse } from './cafeClient.js'
import type { CollectStudioJoinPageRequest } from '../shared/protocol.js'
import {
  isStudioIdentityRefusal,
  parseStudioIdentity,
  parseStudioJoinPage,
  STUDIO_IDENTITY_STATUS_URL,
  STUDIO_MEMBER_PAGE_URL,
  studioJoinPageUrl,
  type StudioJoinPage,
} from '../shared/studioJoinList.js'

export type StudioFailureCode =
  | 'STUDIO_IDENTITY_REQUIRED'
  | 'STUDIO_NETWORK_ERROR'
  | 'STUDIO_HTTP_ERROR'
  | 'STUDIO_PARSE_ERROR'

export type StudioRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: StudioFailureCode }

export interface StudioReaderDeps {
  readonly http: (request: HttpRequest) => Promise<HttpResponse>
}

/** Reads one studio answer at a time; paging and judging belong to the desktop. */
export function createStudioReader(deps: StudioReaderDeps) {
  async function read<T>(url: string, parse: (body: string) => T): Promise<StudioRead<T>> {
    let response: HttpResponse
    try {
      response = await deps.http({ url, referer: STUDIO_MEMBER_PAGE_URL })
    } catch {
      return { ok: false, code: 'STUDIO_NETWORK_ERROR' }
    }
    if (isStudioIdentityRefusal(response.status, response.text)) return { ok: false, code: 'STUDIO_IDENTITY_REQUIRED' }
    if (response.status !== 200) return { ok: false, code: 'STUDIO_HTTP_ERROR' }
    try {
      return { ok: true, value: parse(response.text) }
    } catch {
      return { ok: false, code: 'STUDIO_PARSE_ERROR' }
    }
  }

  return {
    checkIdentity: (): Promise<StudioRead<boolean>> => read(STUDIO_IDENTITY_STATUS_URL, parseStudioIdentity),
    readJoinPage: (request: CollectStudioJoinPageRequest): Promise<StudioRead<StudioJoinPage>> =>
      read(studioJoinPageUrl(request.joinedFrom, request.joinedTo, request.page), parseStudioJoinPage),
  }
}
