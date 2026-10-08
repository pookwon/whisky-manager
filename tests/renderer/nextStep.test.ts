import { describe, expect, it } from 'vitest'
import { nextStep } from '../../src/renderer/views/collection/nextStep.js'
import { nextStepScheduleLine, nextStepSentence } from '../../src/renderer/views/collection/nextStepLines.js'
import { inputs, listJob, PERIOD, probe, probeJob, runningRun, search, searchJob, status } from './collectionStepFixtures.js'

const SEARCH = { kind: 'search' as const, period: PERIOD, boardId: '188', boardName: '자유게시판', position: 1, count: 2, searchExtended: true }

describe('nextStep', () => {
  it('asks for a period when the pipeline is idle', () => {
    expect(nextStep(inputs(), null)).toEqual({ kind: 'pickPeriod' })
  })

  it('says to wait while any walk runs, before anything else', () => {
    expect(nextStep(inputs({ status: status({ running: runningRun }), pipeline: SEARCH }), null)).toEqual({ kind: 'running', step: 'list' })
    expect(nextStep(inputs({ search: search(searchJob(), true), pipeline: SEARCH }), null)).toEqual({ kind: 'running', step: 'search' })
    expect(nextStep(inputs({ probe: probe(probeJob(), true), pipeline: { kind: 'probe', period: PERIOD } }), null)).toEqual({ kind: 'running', step: 'probe' })
  })

  it('names the stage about to run while a walk is under way but has no run row yet', () => {
    expect(nextStep(inputs({ walking: true, pipeline: { kind: 'list', period: PERIOD } }), null)).toEqual({ kind: 'running', step: 'list' })
    expect(nextStep(inputs({ walking: true, pipeline: SEARCH }), null)).toEqual({ kind: 'running', step: 'search' })
    expect(nextStep(inputs({ walking: true, pipeline: { kind: 'probe', period: PERIOD } }), null)).toEqual({ kind: 'running', step: 'probe' })
  })

  it('does not take a stage for a walk the pipeline has not started', () => {
    expect(nextStep(inputs({ walking: false, pipeline: SEARCH }), null)).toMatchObject({ kind: 'resume' })
  })

  it('offers to resume the stage the pipeline is at', () => {
    expect(nextStep(inputs({ status: status({ job: listJob() }), pipeline: { kind: 'list', period: PERIOD } }), 5)).toEqual({ kind: 'resume', stage: { kind: 'list', period: PERIOD }, nextRunAtMs: 5 })
    expect(nextStep(inputs({ pipeline: SEARCH }), null)).toEqual({ kind: 'resume', stage: SEARCH, nextRunAtMs: null })
  })

  it('has nothing to do once the pipeline is done', () => {
    expect(nextStep(inputs({ pipeline: { kind: 'done', period: PERIOD } }), null)).toEqual({ kind: 'allDone' })
  })
})

describe('nextStep lines', () => {
  it('names the stage, and the board with its place among the boards to search', () => {
    expect(nextStepSentence({ kind: 'resume', stage: { kind: 'list', period: PERIOD }, nextRunAtMs: null })).toBe('① 목록 수집 차례입니다. 끝나면 ②, ③으로 저절로 이어집니다.')
    expect(nextStepSentence({ kind: 'resume', stage: SEARCH, nextRunAtMs: null })).toBe('② 검색어 보충 차례입니다 · 자유게시판 게시판 (목록 끝에 닿은 2개 중 1번째). 끝나면 다음으로 저절로 이어집니다.')
    expect(nextStepSentence({ kind: 'resume', stage: { ...SEARCH, boardName: null }, nextRunAtMs: null })).toContain('188 게시판')
  })

  it('says when the loop next takes a turn under any resume, and nothing otherwise', () => {
    expect(nextStepScheduleLine({ kind: 'resume', stage: { kind: 'probe', period: PERIOD }, nextRunAtMs: null })).not.toBeNull()
    expect(nextStepScheduleLine({ kind: 'allDone' })).toBeNull()
  })
})
