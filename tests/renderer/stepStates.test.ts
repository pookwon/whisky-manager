import { describe, expect, it } from 'vitest'
import { listStepState, probeStepState, searchStepState } from '../../src/renderer/views/collection/stepStates.js'
import { TEXT } from '../../src/shared/text.js'
import { board, inputs, listJob, probe, probeJob, runningRun, search, searchJob, status } from './collectionStepFixtures.js'

describe('list step badge', () => {
  it('is to do with no job or an unfinished one, and done once the job is', () => {
    expect(listStepState(inputs())).toEqual({ badge: 'todo', reason: null })
    expect(listStepState(inputs({ status: status({ job: listJob() }) })).badge).toBe('todo')
    expect(listStepState(inputs({ status: status({ job: listJob({ complete: true }) }) })).badge).toBe('done')
  })

  it('is running while a list run is in flight', () => {
    expect(listStepState(inputs({ status: status({ job: listJob(), running: runningRun }) })).badge).toBe('running')
  })
})

describe('search step badge', () => {
  it('is not needed, saying why, with no job and no board at the list horizon', () => {
    expect(searchStepState(inputs({ search: search(null) }))).toEqual({ badge: 'notNeeded', reason: TEXT.collection.steps.search.notNeeded })
    // Storage for the search not answering is the same as no search at all.
    expect(searchStepState(inputs()).badge).toBe('notNeeded')
  })

  it('is to do when a board reached the horizon that the job is not for', () => {
    const atHorizon = status({ job: listJob({ complete: true, boards: [board(1, '137', 'horizon')] }) })
    expect(searchStepState(inputs({ status: atHorizon, search: search(null) })).badge).toBe('todo')
    expect(searchStepState(inputs({ status: atHorizon, search: search(searchJob({ boardId: '200', current: null })) })).badge).toBe('todo')
    // No search storage: there is no step to send the operator to.
    expect(searchStepState(inputs({ status: atHorizon })).badge).toBe('notNeeded')
  })

  it('is to do while its job is unfinished, and running while it walks', () => {
    expect(searchStepState(inputs({ search: search(searchJob()) })).badge).toBe('todo')
    expect(searchStepState(inputs({ search: search(searchJob(), true) })).badge).toBe('running')
  })

  it('is done once every query finished and no other board waits', () => {
    const atHorizon = status({ job: listJob({ complete: true, boards: [board(1, '137', 'horizon')] }) })
    expect(searchStepState(inputs({ status: atHorizon, search: search(searchJob({ current: null })) }))).toEqual({ badge: 'done', reason: null })
  })
})

describe('probe step badge', () => {
  it('is not needed until the search has finished', () => {
    expect(probeStepState(inputs({ probe: probe(null) }))).toEqual({ badge: 'notNeeded', reason: TEXT.collection.steps.probe.notNeeded })
    expect(probeStepState(inputs({ search: search(searchJob()), probe: probe(null) })).badge).toBe('notNeeded')
    expect(probeStepState(inputs()).badge).toBe('notNeeded')
  })

  it('is to do once the search finished and no probe job exists, or while one is unfinished', () => {
    expect(probeStepState(inputs({ search: search(searchJob({ current: null })), probe: probe(null) })).badge).toBe('todo')
    expect(probeStepState(inputs({ probe: probe(probeJob({ probed: 40 })) })).badge).toBe('todo')
    expect(probeStepState(inputs({ probe: probe(probeJob({ probed: 40 }), true) })).badge).toBe('running')
  })

  it('is done, and says it cannot be made again when the search moved to another window', () => {
    const done = probe(probeJob({ probed: 100 }))
    expect(probeStepState(inputs({ search: search(searchJob({ current: null })), probe: done }))).toEqual({ badge: 'done', reason: null })
    const elsewhere = search(searchJob({ boardId: '200', fromDay: '20240101', toDay: '20240601', current: null }))
    expect(probeStepState(inputs({ search: elsewhere, probe: done }))).toEqual({ badge: 'done', reason: TEXT.collection.steps.probe.spent })
  })
})
