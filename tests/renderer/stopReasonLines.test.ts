import { describe, expect, it } from 'vitest'
import { describeStopReason } from '../../src/renderer/views/collection/stopReasonLines.js'
import { TEXT } from '../../src/shared/text.js'

describe('describeStopReason', () => {
  it('puts the meaning first and keeps the code and detail for the report', () => {
    expect(describeStopReason('BOARD_SEARCH_HTTP_ERROR: 500')).toBe('검색 요청이 HTTP 오류로 끝났습니다 (BOARD_SEARCH_HTTP_ERROR: 500)')
    expect(describeStopReason('ARTICLE_NETWORK_ERROR')).toBe('글 요청 중 네트워크 오류가 발생했습니다 (ARTICLE_NETWORK_ERROR)')
  })

  it('shows a code it does not know as itself', () => {
    expect(describeStopReason('BOARD_SEARCH_SOMETHING_ELSE: 7')).toBe('BOARD_SEARCH_SOMETHING_ELSE: 7')
  })

  it('names every search and probe code the walks can write', () => {
    for (const code of [
      'BOARD_SEARCH_PARSE_ERROR', 'BOARD_SEARCH_INVALID_JSON', 'BOARD_SEARCH_HTTP_ERROR', 'BOARD_SEARCH_NETWORK_ERROR', 'BOARD_SEARCH_BAD_REQUEST',
      'BOARD_SEARCH_UNEXPECTED_REPLY', 'BOARD_SEARCH_WRONG_BOARD', 'BOARD_SEARCH_OUT_OF_WINDOW', 'BOARD_SEARCH_OUT_OF_ORDER', 'BOARD_SEARCH_SEGMENT_EMPTY',
      'BOARD_SEARCH_CAP_UNCLEAR', 'ARTICLE_PARSE_ERROR', 'ARTICLE_INVALID_JSON', 'ARTICLE_HTTP_ERROR', 'ARTICLE_NETWORK_ERROR', 'ARTICLE_BAD_REQUEST',
      'ARTICLE_UNEXPECTED_REPLY', 'ARTICLE_PROBE_UNKNOWN_ANSWER', 'NOT_LOGGED_IN', 'EXTENSION_FAILURE', 'COLLECTION_FAILURE',
    ]) {
      expect(TEXT.collectionStopReason[code], code).toBeDefined()
    }
  })
})
