import { cafeMemberListUrl } from '../shared/cafeMemberFixture.js'
import { CafeMemberListParseError, parseCafeMemberListText, type CollectedMemberPage } from '../shared/cafeMemberList.js'
import { isCollectMemberPageRequest, type CollectMemberPageRequest } from '../shared/protocol.js'
import type { HttpRequest, HttpResponse } from './cafeClient.js'

export type MemberPageReadResult =
  | { readonly ok: true; readonly page: number; readonly result: CollectedMemberPage }
  | {
      readonly ok: false
      readonly code:
        | 'MEMBER_PAGE_BAD_REQUEST'
        | 'MEMBER_PAGE_NETWORK_ERROR'
        | 'MEMBER_PAGE_HTTP_ERROR'
        | 'MEMBER_PAGE_INVALID_JSON'
        | 'MEMBER_PAGE_PARSE_ERROR'
        | 'MEMBER_PAGE_FORBIDDEN'
    }

export interface MemberPageReaderDeps {
  /** The extension-owned request keeps credentials and charset decoding in one boundary. */
  readonly http: (request: HttpRequest) => Promise<HttpResponse>
}

/**
 * Reads exactly one member-list page. Pagination, cursor, sleep and storage are
 * desktop-owned, so this reader intentionally has no loop or policy. A session
 * without management rights answers `isSuccess:false`, which the parser rejects
 * with NOT_SUCCESS; that one case is surfaced as FORBIDDEN so the desktop can
 * name it, while every other parse failure stays a generic PARSE_ERROR.
 */
export function createMemberPageReader(deps: MemberPageReaderDeps) {
  return {
    async read(request: CollectMemberPageRequest): Promise<MemberPageReadResult> {
      if (!isCollectMemberPageRequest(request)) return { ok: false, code: 'MEMBER_PAGE_BAD_REQUEST' }

      let response: HttpResponse
      try {
        response = await deps.http({ url: cafeMemberListUrl(request.page) })
      } catch {
        return { ok: false, code: 'MEMBER_PAGE_NETWORK_ERROR' }
      }
      if (response.status !== 200) return { ok: false, code: 'MEMBER_PAGE_HTTP_ERROR' }

      try {
        return { ok: true, page: request.page, result: parseCafeMemberListText(response.text) }
      } catch (error) {
        if (error instanceof CafeMemberListParseError) {
          if (error.code === 'INVALID_JSON') return { ok: false, code: 'MEMBER_PAGE_INVALID_JSON' }
          if (error.code === 'NOT_SUCCESS') return { ok: false, code: 'MEMBER_PAGE_FORBIDDEN' }
        }
        return { ok: false, code: 'MEMBER_PAGE_PARSE_ERROR' }
      }
    },
  }
}
