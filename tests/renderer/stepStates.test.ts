import { describe, expect, it } from 'vitest'
import { listStepState, probeStepState, searchStepState } from '../../src/renderer/views/collection/stepStates.js'
import { board, inputs, listJob, probe, probeJob, runningRun, status, PERIOD } from './collectionStepFixtures.js'

describe('step badges', () => {
  it('list: running while a list run is in flight, done once its job is complete, else to do', () => {
    expect(listStepState(inputs({ status: status({ running: runningRun }) })).badge).toBe('running')
    expect(listStepState(inputs({ status: status({ job: listJob({ complete: true }) }) })).badge).toBe('done')
    expect(listStepState(inputs()).badge).toBe('todo')
  })

  it('search: to do while it is the stage or a board at the horizon waits, done after, not needed without such a board', () => {
    const horizon = status({ job: listJob({ complete: true, boards: [board(1, '188', 'horizon')] }) })
    expect(searchStepState(inputs({ status: horizon, pipeline: { kind: 'search', period: PERIOD, boardId: '188', boardName: null, position: 1, count: 1, searchExtended: true } })).badge).toBe('todo')
    expect(searchStepState(inputs({ status: horizon, pipeline: { kind: 'probe', period: PERIOD } })).badge).toBe('done')
    expect(searchStepState(inputs({ status: status({ job: listJob({ boards: [board(1, '188', 'horizon')] }) }), pipeline: { kind: 'list', period: PERIOD } })).badge).toBe('todo')
    expect(searchStepState(inputs({ status: status({ job: listJob({ complete: true, boards: [board(1, '189', 'complete')] }) }), pipeline: { kind: 'probe', period: PERIOD } }))).toEqual({ badge: 'notNeeded', reason: '목록 끝에 닿은 게시판이 없어 필요 없습니다.' })
  })

  it('probe: done when the pipeline is, to do while it is the stage, and waiting with a reason before', () => {
    expect(probeStepState(inputs({ pipeline: { kind: 'done', period: PERIOD } })).badge).toBe('done')
    expect(probeStepState(inputs({ pipeline: { kind: 'probe', period: PERIOD } })).badge).toBe('todo')
    expect(probeStepState(inputs({ pipeline: { kind: 'list', period: PERIOD } }))).toEqual({ badge: 'notNeeded', reason: '② 보충이 끝나면 저절로 시작합니다.' })
    expect(probeStepState(inputs({ probe: probe(probeJob(), true), pipeline: { kind: 'probe', period: PERIOD } })).badge).toBe('running')
  })
})
