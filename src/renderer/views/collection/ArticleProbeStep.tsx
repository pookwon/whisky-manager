import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { ArticleProbeView } from '../../../desktop/articleProbeView.js'
import { api } from '../../api.js'
import { Details } from '../dashboard/Details.js'
import {
  articleProbeBreakdownLine,
  articleProbeFailureLine,
  articleProbeHeadlineLine,
  articleProbeProgressLine,
  articleProbeStartLabel,
  articleProbeWindowLine,
} from './articleProbeLines.js'
import { CollectionStep, type StepFold } from './CollectionStep.js'
import { probeStartRefusal } from './startRefusals.js'
import type { StepState } from './stepStates.js'

const MUTED = { color: 'var(--ink-muted)' }

interface ArticleProbeStepProps {
  readonly view: ArticleProbeView
  readonly state: StepState
  readonly otherRunning: boolean
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
}

/**
 * ③ Reading the gap's article numbers one by one. A finished job folds to the
 * one line that matters — how many posts it saved — because there is nothing
 * left to press.
 */
export function ArticleProbeStep({ view, state, otherRunning, busy, act }: ArticleProbeStepProps): React.JSX.Element {
  /** Why the last press did nothing, until the next press. */
  const [refusal, setRefusal] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { job, running } = view
  const finished = job !== null && job.probed >= job.total
  const progressLine = running ? articleProbeProgressLine(view.progress) : null
  const failureLine = articleProbeFailureLine(view.blockFailure, view.lastRun)
  const windowLine = job !== null ? articleProbeWindowLine(job) : null

  const action =
    job === null || finished ? undefined : running ? (
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => {
          setRefusal(null)
          void act(() => api.stopCollection())
        }}
      >
        {TEXT.articleProbe.stop}
      </button>
    ) : (
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || otherRunning}
        onClick={() => {
          setRefusal(null)
          void act(async () => setRefusal(probeStartRefusal(await api.startCollection())))
        }}
      >
        {articleProbeStartLabel(job)}
      </button>
    )

  const fold: StepFold | undefined = finished
    ? { summary: TEXT.collection.steps.probe.folded(job.stored), initiallyOpen: false }
    : state.badge === 'notNeeded'
      ? { summary: TEXT.collection.useAnyway, initiallyOpen: false }
      : undefined

  return (
    <CollectionStep
      number={TEXT.collection.steps.probe.number}
      title={TEXT.collection.steps.probe.title}
      what={TEXT.collection.steps.probe.what}
      badge={state.badge}
      reason={state.reason}
      action={action}
      fold={fold}
    >
      <div className="flex flex-col gap-0.5">
        {windowLine !== null && <div className="text-sm font-semibold">{windowLine}</div>}
        {job !== null && <div className="text-sm tabular-nums">{articleProbeHeadlineLine(job)}</div>}
        {progressLine !== null && <div className="text-sm tabular-nums tone-accent">{progressLine}</div>}
      </div>
      {job !== null && !finished && !running && otherRunning && (
        <p className="text-xs" style={MUTED}>
          {TEXT.collection.otherRunning}
        </p>
      )}
      {failureLine !== null && <p className="text-sm tone-warn">{failureLine}</p>}
      {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
      {job !== null && (
        <Details summary={TEXT.collection.details} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)}>
          <p className="text-sm tabular-nums" style={MUTED}>
            {articleProbeBreakdownLine(job)}
          </p>
        </Details>
      )}
    </CollectionStep>
  )
}
