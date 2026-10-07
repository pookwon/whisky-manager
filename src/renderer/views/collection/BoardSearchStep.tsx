import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchView } from '../../../desktop/boardSearchView.js'
import { Details } from '../dashboard/Details.js'
import {
  boardSearchBlockFailureLine,
  boardSearchCoverageLine,
  boardSearchProgressLine,
  boardSearchRemainingLine,
  boardSearchSummaryLine,
  dayKeyLabel,
} from './boardSearchLines.js'
import { BoardSearchQueryTable } from './BoardSearchQueryTable.js'
import { CollectionStep } from './CollectionStep.js'
import type { StepState } from './stepStates.js'

const MUTED = { color: 'var(--ink-muted)' }

interface BoardSearchStepProps {
  readonly view: BoardSearchView
  readonly state: StepState
}

/**
 * ② The search backfill: past the list's reach, a board's older posts are
 * found by searching its titles. The pipeline makes and walks the job; the
 * card shows it. The job in hand up front, its arithmetic and per-query table
 * under 자세히.
 */
export function BoardSearchStep({ view, state }: BoardSearchStepProps): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { job, running } = view
  const progressLine = running ? boardSearchProgressLine(view.progress) : null
  const blockFailureLine = boardSearchBlockFailureLine(view.blockFailure)
  const remainingLine = job === null ? null : boardSearchRemainingLine(job.coverage)
  const coverageLine = job === null ? null : boardSearchCoverageLine(job.coverage)

  return (
    <CollectionStep
      number={TEXT.collection.steps.search.number}
      title={TEXT.collection.steps.search.title}
      what={TEXT.collection.steps.search.what}
      badge={state.badge}
      reason={state.reason}
    >
      {job !== null && (
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-semibold">
            {TEXT.boardSearch.window(job.boardName ?? job.boardId, dayKeyLabel(job.fromDay), dayKeyLabel(job.toDay))}
          </div>
          <div className="text-sm tabular-nums" style={MUTED}>
            {boardSearchSummaryLine(job)}
          </div>
          {progressLine !== null && <div className="text-sm tabular-nums tone-accent">{progressLine}</div>}
          {remainingLine !== null && <div className="text-sm tabular-nums">{remainingLine}</div>}
        </div>
      )}
      {blockFailureLine !== null && <p className="text-sm tone-warn">{blockFailureLine}</p>}
      {job !== null && (
        <Details summary={TEXT.collection.details} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)}>
          {coverageLine !== null && (
            <p className="text-sm tabular-nums" style={MUTED}>
              {coverageLine}
            </p>
          )}
          <BoardSearchQueryTable job={job} running={running} />
        </Details>
      )}
    </CollectionStep>
  )
}
