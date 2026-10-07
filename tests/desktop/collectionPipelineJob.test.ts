import { describe, expect, it } from 'vitest'
import { createCollectionPipelineJob } from '../../src/desktop/collectionPipelineJob.js'
import type { CollectionPipeline, CollectionPipelineReading } from '../../src/desktop/collectionPipeline.js'

const PERIOD = { fromDay: '20240101', toDay: '20250102' }

function pipeline(reading: CollectionPipelineReading | null, starts: unknown[] = []): CollectionPipeline {
  return {
    read: async () => reading,
    start: async (request) => { starts.push(request); return { kind: 'started' } },
    stop: () => undefined,
    isRunning: () => false,
  }
}

describe('createCollectionPipelineJob', () => {
  it('exists from a period on, and is complete when the probe is done', async () => {
    expect(await createCollectionPipelineJob({ pipeline: pipeline(null) }).readProgress()).toEqual({ exists: false, complete: false, forced: false })
    expect(await createCollectionPipelineJob({ pipeline: pipeline({ stage: { kind: 'idle' }, forced: false }) }).readProgress()).toEqual({ exists: false, complete: false, forced: false })
    expect(await createCollectionPipelineJob({ pipeline: pipeline({ stage: { kind: 'list', period: PERIOD }, forced: true }) }).readProgress()).toEqual({ exists: true, complete: false, forced: true })
    expect(await createCollectionPipelineJob({ pipeline: pipeline({ stage: { kind: 'probe', period: PERIOD }, forced: false }) }).readProgress()).toEqual({ exists: true, complete: false, forced: false })
    expect(await createCollectionPipelineJob({ pipeline: pipeline({ stage: { kind: 'done', period: PERIOD }, forced: false }) }).readProgress()).toEqual({ exists: true, complete: true, forced: false })
  })

  it('starts a scheduled block as an incremental one', async () => {
    const starts: unknown[] = []
    expect(await createCollectionPipelineJob({ pipeline: pipeline(null, starts) }).start(120)).toEqual({ kind: 'started' })
    expect(starts).toEqual([{ maxPages: 120, runKind: 'incremental' }])
  })
})
