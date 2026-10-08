import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { CollectionStatus } from '../../../desktop/collection-db/statusQuery.js'
import type { CollectionPipelineStage } from '../../../desktop/collectionPipelineStage.js'
import { api } from '../../api.js'
import { collectionCoveragePercent, collectionRangeLabel, elapsedLabel, formatKstDate, relativeTime } from '../../format.js'
import { Details } from '../dashboard/Details.js'
import { BoardQueue } from './BoardQueue.js'
import { CollectionStep } from './CollectionStep.js'
import { PeriodForm } from './PeriodForm.js'
import { listStartRefusal } from './startRefusals.js'
import type { StepState } from './stepStates.js'

const MUTED = { color: 'var(--ink-muted)' }

function ProgressBar({ percent }: { percent: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
        <div className="h-full bar-accent" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs tabular-nums" style={MUTED}>
        {TEXT.collection.coverage(percent)}
      </span>
    </div>
  )
}

interface ListWalkStepProps {
  readonly status: CollectionStatus
  readonly pipeline: CollectionPipelineStage
  readonly state: StepState
  /** This walk is under way, which is known before its run row is: the row is what `status.running` carries. */
  readonly listRunning: boolean
  /** A stop was asked and the walk is finishing its page. */
  readonly stopping: boolean
  /** Another walk holds the shared lock, so this one's start would only be refused. */
  readonly otherRunning: boolean
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly periodRequest: number | null
}

/**
 * ① Walking the lists: the job in hand, how far it came, each board's place,
 * and the form for a new period — folded while a job is unfinished, because
 * a newcomer pressing it would throw that job's position away.
 */
export function ListWalkStep(props: ListWalkStepProps): React.JSX.Element {
  const { job, running, recentRuns } = props.status
  const [refusal, setRefusal] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const nowMs = Date.now()
  const unfinished = job !== null && !job.complete
  const lastFinished = recentRuns.find((run) => run.status !== 'running') ?? null
  const runningPercent = running === null ? null : collectionCoveragePercent(running)
  const jobPercent = job === null ? null : collectionCoveragePercent(job)

  const resume = (): void => {
    setRefusal(null)
    void props.act(async () => setRefusal(listStartRefusal(await api.startCollection())))
  }

  const action =
    props.listRunning ? (
      <button type="button" className="btn" disabled={props.busy || props.stopping} onClick={() => void props.act(() => api.stopCollection())}>
        {props.stopping ? TEXT.collection.stopping : TEXT.collection.stop}
      </button>
    ) : unfinished ? (
      <button type="button" className="btn btn-primary" disabled={props.busy || props.otherRunning} onClick={resume}>
        {TEXT.collection.collectNow}
      </button>
    ) : undefined

  return (
    <CollectionStep
      number={TEXT.collection.steps.list.number}
      title={TEXT.collection.steps.list.title}
      what={TEXT.collection.steps.list.what}
      badge={props.state.badge}
      reason={props.state.reason}
      action={action}
    >
      <div className="flex flex-col gap-2">
        {running !== null ? (
          <>
            <div className="text-sm font-semibold tone-accent">
              {collectionRangeLabel(running)} · {TEXT.collection.pagesRead(running.collectionPages)}
            </div>
            {runningPercent !== null && <ProgressBar percent={runningPercent} />}
            <div className="text-sm tabular-nums" style={MUTED}>
              {/* elapsedLabel, not relativeTime: this run is still going, and "22분 전" reads as one that ended. */}
              {TEXT.collection.newPosts(running.insertedPostCount)} · {elapsedLabel(running.startedAtMs, nowMs)}
            </div>
          </>
        ) : (
          <>
            {job !== null && (
              <div className="text-sm font-semibold">
                {TEXT.collection.steps.list.period(formatKstDate(job.targetStartMs), formatKstDate(job.targetEndMs - 1))}
              </div>
            )}
            {unfinished && jobPercent !== null && <ProgressBar percent={jobPercent} />}
            <div className="text-sm" style={MUTED}>
              {TEXT.collection.lastRun} ·{' '}
              {lastFinished === null
                ? TEXT.collection.never
                : `${collectionRangeLabel(lastFinished)} · ${relativeTime(lastFinished.finishedAtMs ?? lastFinished.startedAtMs, nowMs)}`}
            </div>
          </>
        )}
        {unfinished && running === null && props.otherRunning && (
          <p className="text-xs" style={MUTED}>
            {TEXT.collection.otherRunning}
          </p>
        )}
        {job?.forced === true && <p className="text-sm tone-warn">{TEXT.collection.forcedOn}</p>}
        {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
      </div>

      {job !== null && job.boards.length > 0 && <BoardQueue boards={job.boards} />}

      <PeriodForm
        job={job}
        pipeline={props.pipeline}
        busy={props.busy}
        blockedReason={
          props.listRunning ? TEXT.collection.refused.STOP_RUNNING_FIRST : props.otherRunning ? TEXT.collection.otherRunning : null
        }
        act={props.act}
        request={props.periodRequest}
        initiallyOpen={!unfinished}
      />

      {/* Only the hours give way, and only for the job in hand — which is why
          this sits with the job rather than in the schedule settings. */}
      {unfinished && (
        <Details summary={TEXT.collection.details} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)}>
          <div>
            <button
              type="button"
              className="btn"
              disabled={props.busy}
              onClick={() => {
                setRefusal(null)
                void props.act(async () => {
                  const result = await api.setCollectionForced(!job.forced)
                  if (result.kind === 'refused') setRefusal(TEXT.collection.refused[result.reason])
                })
              }}
            >
              {job.forced ? TEXT.collection.forceRelease : TEXT.collection.force}
            </button>
          </div>
        </Details>
      )}
    </CollectionStep>
  )
}
