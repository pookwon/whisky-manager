import { describe, expect, it } from 'vitest'
import { CollectionPageError } from '../../src/desktop/collectionOrchestrator.js'
import { failedRunStopReason } from '../../src/desktop/failedRunStopReason.js'

describe('failedRunStopReason', () => {
  it('keeps a bare page error bare', () => {
    expect(failedRunStopReason(new CollectionPageError('BOARD_SEARCH_HTTP_ERROR'))).toEqual({ code: 'BOARD_SEARCH_HTTP_ERROR', stopReason: 'BOARD_SEARCH_HTTP_ERROR' })
  })

  it('carries a page error detail in the stop reason only', () => {
    expect(failedRunStopReason(new CollectionPageError('BOARD_SEARCH_WRONG_BOARD', '9 on 188'))).toEqual({ code: 'BOARD_SEARCH_WRONG_BOARD', stopReason: 'BOARD_SEARCH_WRONG_BOARD: 9 on 188' })
  })

  it('names an unclassified failure', () => {
    expect(failedRunStopReason(new Error('connection refused'))).toEqual({ code: 'COLLECTION_FAILURE', stopReason: 'COLLECTION_FAILURE: Error: connection refused' })
  })
})
