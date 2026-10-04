import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchView } from '../../../desktop/boardSearchView.js'
import { api } from '../../api.js'
import { Details } from '../dashboard/Details.js'
import {
  boardSearchBlockFailureLine,
  boardSearchCoverageLine,
  boardSearchProgressLine,
  boardSearchRemainingLine,
  boardSearchStartLabel,
  boardSearchSummaryLine,
  dayKeyLabel,
} from './boardSearchLines.js'
import { BoardSearchJobForm, type SearchFormRequest } from './BoardSearchJobForm.js'
import { BoardSearchQueryTable } from './BoardSearchQueryTable.js'
import { CollectionStep } from './CollectionStep.js'
import { searchStartRefusal } from './startRefusals.js'
import type { StepState } from './stepStates.js'

const MUTED = { color: 'var(--ink-muted)' }

interface BoardSearchStepProps {
  readonly view: BoardSearchView
  readonly state: StepState
  readonly otherRunning: boolean
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly request: SearchFormRequest | null
}

/**
 * ② The search backfill: past the list's reach, a board's older posts are
 * found by searching its titles. The job in hand up front, its arithmetic
 * and per-query table under 자세히, the form for a new job folded once a
 * job exists.
 */
export function BoardSearchStep({ view, state, otherRunning, busy, act, request }: BoardSearchStepProps): React.JSX.Element {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { job, running } = view
  const finished = job !== null && job.current === null
  const progressLine = running ? boardSearchProgressLine(view.progress) : null
  const blockFailureLine = boardSearchBlockFailureLine(view.blockFailure)
  const remainingLine = job === null ? null : boardSearchRemainingLine(job.coverage)
  const coverageLine = job === null ? null : boardSearchCoverageLine(job.coverage)

  const action =
    job === null || finished ? undefined : running ? (
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => {
          setRefusal(null)
          void act(() => api.stopBoardSearch())
        }}
      >
        {TEXT.boardSearch.stop}
      </button>
    ) : (
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || otherRunning}
        onClick={() => {
          setRefusal(null)
          void act(async () => setRefusal(searchStartRefusal(await api.startBoardSearch())))
        }}
      >
        {boardSearchStartLabel(job)}
      </button>
    )

  return (
    <CollectionStep
      number={TEXT.collection.steps.search.number}
      title={TEXT.collection.steps.search.title}
      what={TEXT.collection.steps.search.what}
      badge={state.badge}
      reason={state.reason}
      action={action}
      fold={state.badge === 'notNeeded' ? { summary: TEXT.collection.useAnyway, initiallyOpen: false } : undefined}
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
      {!finished && job !== null && !running && otherRunning && (
        <p className="text-xs" style={MUTED}>
          {TEXT.collection.otherRunning}
        </p>
      )}
      {blockFailureLine !== null && <p className="text-sm tone-warn">{blockFailureLine}</p>}
      {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
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
      <BoardSearchJobForm view={view} busy={busy} act={act} request={request} initiallyOpen={job === null} />
    </CollectionStep>
  )
}
