import { useState } from 'react'
import { TEXT } from '../../shared/text.js'
import { ArticleProbeStep } from './collection/ArticleProbeStep.js'
import { BoardSearchStep } from './collection/BoardSearchStep.js'
import { CheckStep } from './collection/CheckStep.js'
import { CollectionUnavailable } from './collection/CollectionUnavailable.js'
import { ListWalkStep } from './collection/ListWalkStep.js'
import { NextStepPanel } from './collection/NextStepPanel.js'
import { nextStep } from './collection/nextStep.js'
import { RecentRuns } from './collection/RecentRuns.js'
import { runningStep, type CollectionStepInputs } from './collection/stepFacts.js'
import { listStepState, probeStepState, searchStepState } from './collection/stepStates.js'
import { useApp } from '../store.js'

/**
 * The collection screen, top to bottom in the order a collection goes: what
 * to do now, then ① the list walk, ② the search backfill past its reach,
 * ③ the article numbers search could not find, ④ the check. The pipeline
 * stage drives the next-step panel and the step badges; this file only puts
 * the steps in order and carries the panel's period-pick press to the form.
 */
export function CollectionStatus(): React.JSX.Element {
  const collection = useApp((s) => s.collection)
  const schedule = useApp((s) => s.collectionSchedule)
  const boardSearch = useApp((s) => s.boardSearch)
  const articleProbe = useApp((s) => s.articleProbe)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  /** Grows with each "기간 고르기" press, which asks ①'s form to open and come into view. */
  const [periodRequest, setPeriodRequest] = useState<number | null>(null)

  if (collection === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const heading = (
    <header>
      <h1 className="text-lg font-bold tracking-tight">{TEXT.collection.heading}</h1>
    </header>
  )

  if (collection.kind !== 'ready') {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <CollectionUnavailable view={collection} />
      </div>
    )
  }

  const inputs: CollectionStepInputs = {
    status: collection.status,
    search: boardSearch?.kind === 'ready' ? boardSearch.view : null,
    probe: articleProbe?.kind === 'ready' ? articleProbe.view : null,
    pipeline: collection.pipeline,
  }
  const running = runningStep(inputs)
  const next = nextStep(inputs, schedule?.nextRunAtMs ?? null)
  const otherThan = (step: 'list' | 'search' | 'probe'): boolean => running !== null && running !== step

  return (
    <div className="flex flex-col gap-6">
      {heading}
      <NextStepPanel
        key={next.kind}
        next={next}
        busy={busy}
        act={act}
        onPickPeriod={() => setPeriodRequest((count) => (count ?? 0) + 1)}
      />
      <ListWalkStep
        status={collection.status}
        pipeline={collection.pipeline}
        state={listStepState(inputs)}
        otherRunning={otherThan('list')}
        busy={busy}
        act={act}
        periodRequest={periodRequest}
      />
      {inputs.search !== null && (
        <BoardSearchStep
          view={inputs.search}
          state={searchStepState(inputs)}
        />
      )}
      {inputs.probe !== null && (
        <ArticleProbeStep view={inputs.probe} state={probeStepState(inputs)} />
      )}
      <CheckStep status={collection.status} />
      <RecentRuns runs={collection.status.recentRuns} />
    </div>
  )
}
