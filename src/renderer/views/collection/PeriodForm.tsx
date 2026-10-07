import { useEffect, useRef, useState } from 'react'
import { MS_PER_DAY, kstDayKeyRange } from '../../../shared/kst.js'
import { TEXT } from '../../../shared/text.js'
import type { CollectionFeedKind } from '../../../desktop/collection-db/repository.js'
import type { CollectionJob } from '../../../desktop/collection-db/statusQuery.js'
import type { CollectionPipelineStage } from '../../../desktop/collectionPipelineStage.js'
import type { CollectionRunRequest } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { collectionCoveragePercent, formatKstDate, formatKstDateTime } from '../../format.js'
import { Details } from '../dashboard/Details.js'
import { dayKeyOfDateInput } from './boardSearchLines.js'
import { replaceLaterStepsLine } from './replacePeriodLines.js'
import { listStartRefusal } from './startRefusals.js'

/** How far back the form starts, so a first press reads a few days rather than one. */
const DEFAULT_LOOKBACK_DAYS = 3

const MUTED = { color: 'var(--ink-muted)' }

/** Midnight KST of a date the operator picked; the input already speaks the KST calendar. */
function midnightOf(value: string): number {
  return kstDayKeyRange(dayKeyOfDateInput(value)).startMs
}

function DateField(props: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly max: string
  readonly onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div>
      <label className="block text-xs" style={MUTED} htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type="date"
        className="field mt-1"
        value={props.value}
        max={props.max}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  )
}

/**
 * Replacing a job the operator has not finished, said as what it costs. The
 * job and the stage are read live from props, so a block that advances the
 * cursor while this is open cannot leave a stale number in front of the answer.
 */
function ReplacePeriod(props: {
  readonly job: CollectionJob
  readonly pipeline: CollectionPipelineStage
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}): React.JSX.Element {
  const { job } = props
  const percent = collectionCoveragePercent(job)
  const laterStepsLine = replaceLaterStepsLine(props.pipeline)
  return (
    <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
      <p className="text-sm font-semibold tone-warn">{TEXT.collection.replace.heading}</p>
      {/* The end is the midnight after the last day, so naming it directly
          would announce a day that is not in the period. */}
      <p className="mt-1 text-sm">
        {TEXT.collection.replace.period(formatKstDate(job.targetStartMs), formatKstDate(job.targetEndMs - 1))}
      </p>
      <p className="mt-1 text-sm tabular-nums" style={MUTED}>
        {percent === null || job.cursorPostedAtMs === null
          ? TEXT.collection.replace.progressUnknown
          : `${TEXT.collection.replace.progress(percent)} · ${TEXT.collection.replace.walkedTo(formatKstDateTime(job.cursorPostedAtMs))}`}
      </p>
      <p className="mt-1 text-sm" style={MUTED}>
        {TEXT.collection.replace.cost}
      </p>
      {laterStepsLine !== null && (
        <p className="mt-1 text-sm" style={MUTED}>
          {laterStepsLine}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={props.busy} onClick={props.onConfirm}>
          {TEXT.collection.replace.confirm}
        </button>
        <button type="button" className="btn" disabled={props.busy} onClick={props.onCancel}>
          {TEXT.collection.replace.cancel}
        </button>
      </div>
    </div>
  )
}

interface PeriodFormProps {
  readonly job: CollectionJob | null
  /** Where the period stands past the list, for what replacing it costs. */
  readonly pipeline: CollectionPipelineStage
  readonly busy: boolean
  /**
   * Why a new period cannot start now — the list walk itself is running, or
   * another walk holds the lock — or null when it can.
   */
  readonly blockedReason: string | null
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  /** Bumped by a press elsewhere that wants this form open and in view. */
  readonly request: number | null
  readonly initiallyOpen: boolean
}

/**
 * A window the operator names, in whole days. Already-stored posts gain one
 * more observation rather than a duplicate row, which the hint says.
 */
export function PeriodForm(props: PeriodFormProps): React.JSX.Element {
  const today = formatKstDate(Date.now())
  const [firstDay, setFirstDay] = useState(() => formatKstDate(Date.now() - DEFAULT_LOOKBACK_DAYS * MS_PER_DAY))
  const [lastDay, setLastDay] = useState(today)
  const [scope, setScope] = useState<CollectionFeedKind>('board')
  const [open, setOpen] = useState(props.initiallyOpen)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  /** The period asked for while another job is unfinished, held until the operator answers. */
  const [replacing, setReplacing] = useState<CollectionRunRequest | null>(null)
  const [seenRequest, setSeenRequest] = useState(props.request)
  const anchor = useRef<HTMLDivElement>(null)

  // Adjusting state while rendering, so the unfold lands in the same commit as the press.
  if (props.request !== seenRequest) {
    setSeenRequest(props.request)
    if (props.request !== null) setOpen(true)
  }
  useEffect(() => {
    if (props.request !== null) anchor.current?.scrollIntoView({ block: 'center' })
  }, [props.request])

  const press = (request: CollectionRunRequest): void => {
    setRefusal(null)
    setReplacing(null)
    void props.act(async () => {
      const result = await api.startCollection(request)
      if (result.kind === 'needs_replace') {
        setReplacing(request)
        return
      }
      setRefusal(listStartRefusal(result))
    })
  }

  const scopeLabel = scope === 'board' ? TEXT.collection.scope.board : TEXT.collection.scope.allArticles
  const datesPicked = firstDay !== '' && lastDay !== ''

  return (
    <div ref={anchor}>
      <Details summary={TEXT.collection.newPeriod} open={open} onToggle={() => setOpen((value) => !value)}>
        <div className="flex flex-wrap items-end gap-3">
          <DateField id="collect-from" label={TEXT.collection.periodFrom} value={firstDay} max={today} onChange={setFirstDay} />
          <DateField id="collect-to" label={TEXT.collection.periodTo} value={lastDay} max={today} onChange={setLastDay} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={props.busy || props.blockedReason !== null || !datesPicked}
            onClick={() => press({ firstDayMs: midnightOf(firstDay), lastDayMs: midnightOf(lastDay), scope })}
          >
            {TEXT.collection.periodRun}
          </button>
        </div>
        {props.blockedReason !== null && (
          <p className="text-xs" style={MUTED}>
            {props.blockedReason}
          </p>
        )}
        <p className="text-xs" style={MUTED}>
          {TEXT.collection.periodHint}
        </p>
        <Details summary={TEXT.collection.scope.summary(scopeLabel)} open={scopeOpen} onToggle={() => setScopeOpen((value) => !value)}>
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">{TEXT.collection.scope.heading}</legend>
            {(['board', 'all_articles'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="collect-scope" value={value} checked={scope === value} onChange={() => setScope(value)} />
                <span>{value === 'board' ? TEXT.collection.scope.board : TEXT.collection.scope.allArticles}</span>
                <span className="text-xs" style={MUTED}>
                  {value === 'board' ? TEXT.collection.scope.boardHint : TEXT.collection.scope.allArticlesHint}
                </span>
              </label>
            ))}
          </fieldset>
        </Details>
        {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
        {replacing !== null && props.job !== null && (
          <ReplacePeriod
            job={props.job}
            pipeline={props.pipeline}
            busy={props.busy}
            onConfirm={() => press({ ...replacing, replace: true })}
            onCancel={() => setReplacing(null)}
          />
        )}
      </Details>
    </div>
  )
}
