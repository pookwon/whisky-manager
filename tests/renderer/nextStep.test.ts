import { describe, expect, it } from 'vitest'
import { nextStep } from '../../src/renderer/views/collection/nextStep.js'
import { nextStepScheduleLine, nextStepSentence } from '../../src/renderer/views/collection/nextStepLines.js'
import { TEXT } from '../../src/shared/text.js'
import { board, inputs, listJob, probe, probeJob, runningRun, search, searchJob, status } from './collectionStepFixtures.js'

// 2026-10-04 14:20 KST.
const AT = Date.UTC(2026, 9, 4, 5, 20)
const done = listJob({ complete: true })

describe('next step', () => {
  it('asks for a period when nothing has ever been asked for', () => {
    expect(nextStep(inputs(), null)).toEqual({ kind: 'pickPeriod' })
  })

  it('says to wait while any walk runs, before anything else', () => {
    expect(nextStep(inputs({ status: status({ job: listJob(), running: runningRun }) }), AT)).toEqual({ kind: 'running', step: 'list' })
    expect(nextStep(inputs({ status: status({ job: listJob() }), search: search(searchJob(), true) }), AT)).toEqual({ kind: 'running', step: 'search' })
    expect(nextStep(inputs({ probe: probe(probeJob(), true) }), AT)).toEqual({ kind: 'running', step: 'probe' })
  })

  it('offers the earliest unfinished step first: list, then search, then probe', () => {
    const all = inputs({ status: status({ job: listJob() }), search: search(searchJob()), probe: probe(probeJob({ probed: 3 })) })
    expect(nextStep(all, AT)).toEqual({ kind: 'listWaiting', nextRunAtMs: AT })
    expect(nextStep({ ...all, status: status({ job: done }) }, AT)).toEqual({ kind: 'searchResume', nextRunAtMs: AT })
    expect(nextStep({ ...all, status: status({ job: done }), search: search(searchJob({ current: null })) }, AT)).toEqual({ kind: 'probeResume', nextRunAtMs: AT })
  })

  it('names the first board at the list horizon that the search job is not for', () => {
    const boards = [board(2, '300', 'horizon'), board(1, '137', 'horizon'), board(3, '400', 'complete')]
    const atHorizon = status({ job: listJob({ complete: true, boards }) })
    expect(nextStep(inputs({ status: atHorizon, search: search(null) }), null)).toEqual({ kind: 'searchNeeded', boardId: '137', boardName: '게시판137' })
    // 137 already searched to the end: the next board at the horizon is the one to name.
    expect(nextStep(inputs({ status: atHorizon, search: search(searchJob({ current: null })) }), null)).toEqual({ kind: 'searchNeeded', boardId: '300', boardName: '게시판300' })
  })

  it('offers a probe once the search finished, and says when the one probe was already spent', () => {
    const finished = search(searchJob({ current: null }))
    expect(nextStep(inputs({ status: status({ job: done }), search: finished, probe: probe(null) }), null)).toEqual({ kind: 'probeCreate' })
    const elsewhere = search(searchJob({ boardId: '200', fromDay: '20240101', toDay: '20240601', current: null }))
    expect(nextStep(inputs({ status: status({ job: done }), search: elsewhere, probe: probe(probeJob({ probed: 100 })) }), null)).toEqual({ kind: 'probeSpent' })
  })

  it('has nothing to do when every step finished, and does not trip over storage that did not answer', () => {
    const finished = search(searchJob({ current: null }))
    expect(nextStep(inputs({ status: status({ job: done }), search: finished, probe: probe(probeJob({ probed: 100 })) }), null)).toEqual({ kind: 'allDone' })
    expect(nextStep(inputs({ status: status({ job: done }) }), null)).toEqual({ kind: 'allDone' })
    // A board at the horizon but no search storage: no step to send the operator to.
    const atHorizon = status({ job: listJob({ complete: true, boards: [board(1, '137', 'horizon')] }) })
    expect(nextStep(inputs({ status: atHorizon }), null)).toEqual({ kind: 'allDone' })
  })
})

describe('next step sentence', () => {
  it('says the time the list resumes on the cafe\'s clock, or that it waits for a press', () => {
    expect(nextStepSentence({ kind: 'listWaiting', nextRunAtMs: AT })).toBe('① 14:20에 이어서 돕니다. 기다리거나 지금 이어서 할 수 있습니다.')
    expect(nextStepSentence({ kind: 'listWaiting', nextRunAtMs: null })).toBe(TEXT.collection.next.listWaitingManual)
  })

  it('names the running step and the board to search', () => {
    expect(nextStepSentence({ kind: 'running', step: 'probe' })).toBe(TEXT.collection.next.running.probe)
    expect(nextStepSentence({ kind: 'searchNeeded', boardId: '137', boardName: '국내구입기' })).toBe('국내구입기 게시판은 목록으로 더 내려갈 수 없습니다. ② 검색어 보충으로 채우세요.')
    expect(nextStepSentence({ kind: 'allDone' })).toBe(TEXT.collection.next.allDone)
  })

  it('says when the loop next runs a search or probe turn, and nothing for answers that carry no turn', () => {
    expect(nextStepScheduleLine({ kind: 'searchResume', nextRunAtMs: AT })).toBe(TEXT.collection.nextRunAt('14:20'))
    expect(nextStepScheduleLine({ kind: 'probeResume', nextRunAtMs: null })).toBe(TEXT.collection.nextRunNone)
    // The list sentence already says its time.
    expect(nextStepScheduleLine({ kind: 'listWaiting', nextRunAtMs: AT })).toBeNull()
    expect(nextStepScheduleLine({ kind: 'allDone' })).toBeNull()
  })
})
