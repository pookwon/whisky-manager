import { useEffect, useRef, useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchView } from '../../../desktop/boardSearchView.js'
import type { BoardSearchPlanView } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { Details } from '../dashboard/Details.js'
import { boardSearchPlanOutcome, dayKeyLabel, dayKeyOfDateInput } from './boardSearchLines.js'

/** Where a new search starts unless the job in hand says otherwise: the gap this app was built to fill began here. */
const DEFAULT_FROM = '2025-01-01'

const MUTED = { color: 'var(--ink-muted)' }

/** A press elsewhere asking for this form with a board chosen; `at` grows with each press. */
export interface SearchFormRequest {
  readonly boardId: string
  readonly at: number
}

interface BoardSearchJobFormProps {
  readonly view: BoardSearchView
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly request: SearchFormRequest | null
  readonly initiallyOpen: boolean
}

/**
 * A new search job: a board and the day to search back from, previewed before
 * it is made. Replacing an unfinished job asks on the screen, saying what it
 * costs, rather than in a browser dialog that says nothing.
 */
export function BoardSearchJobForm({ view, busy, act, request, initiallyOpen }: BoardSearchJobFormProps): React.JSX.Element {
  const { job, running } = view
  const [boardId, setBoardId] = useState(job?.boardId ?? view.boards[0]?.boardId ?? '')
  const [fromDate, setFromDate] = useState(job === null ? DEFAULT_FROM : dayKeyLabel(job.fromDay))
  const [open, setOpen] = useState(initiallyOpen)
  const [confirming, setConfirming] = useState(false)
  /** The last preview or create that came back as a plan, until the next press. */
  const [plan, setPlan] = useState<string | null>(null)
  /** Why the last press did nothing, until the next press. */
  const [refusal, setRefusal] = useState<string | null>(null)
  const [seenRequest, setSeenRequest] = useState(request?.at ?? null)
  const anchor = useRef<HTMLDivElement>(null)
  const fromDay = dayKeyOfDateInput(fromDate)

  // Adjusting state while rendering, so the unfold and the chosen board land with the press.
  if ((request?.at ?? null) !== seenRequest) {
    setSeenRequest(request?.at ?? null)
    if (request !== null) {
      setOpen(true)
      setBoardId(request.boardId)
    }
  }
  useEffect(() => {
    if (request !== null) anchor.current?.scrollIntoView({ block: 'center' })
  }, [request])

  const clear = (): void => {
    setPlan(null)
    setRefusal(null)
  }

  const answer = (outcome: BoardSearchPlanView): void => {
    const { kind, text } = boardSearchPlanOutcome(outcome, fromDay)
    if (kind === 'plan') setPlan(text)
    else setRefusal(text)
  }

  const create = (): void => {
    clear()
    setConfirming(false)
    void act(async () => answer(await api.createBoardSearchJob({ boardId, fromDay })))
  }

  return (
    <div ref={anchor}>
      <Details summary={TEXT.collection.newSearchJob} open={open} onToggle={() => setOpen((value) => !value)}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (job !== null) setConfirming(true)
            else create()
          }}
        >
          <label className="flex flex-col gap-1 text-xs" style={MUTED}>
            {TEXT.boardSearch.board}
            <select className="field" value={boardId} disabled={busy || running} onChange={(event) => setBoardId(event.target.value)}>
              {view.boards.map((board) => (
                <option key={board.boardId} value={board.boardId}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={MUTED}>
            {TEXT.boardSearch.fromDay}
            <input className="field" type="date" value={fromDate} disabled={busy || running} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || boardId === '' || fromDate === ''}
            onClick={() => {
              clear()
              void act(async () => answer(await api.previewBoardSearchJob({ boardId, fromDay })))
            }}
          >
            {TEXT.boardSearch.previewButton}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || running || boardId === '' || fromDate === ''}>
            {TEXT.boardSearch.create}
          </button>
        </form>
        {plan !== null && (
          <p className="text-sm tabular-nums" style={MUTED}>
            {plan}
          </p>
        )}
        {refusal !== null && <p className="text-sm tone-warn">{refusal}</p>}
        {confirming && job !== null && (
          <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
            <p className="text-sm font-semibold tone-warn">
              {job.current === null ? TEXT.boardSearch.replace.finishedHeading : TEXT.boardSearch.replace.heading}
            </p>
            <p className="mt-1 text-sm tabular-nums">
              {TEXT.boardSearch.replace.progress(job.completedCount, job.queries.length, job.insertedTotal)}
            </p>
            <p className="mt-1 text-sm" style={MUTED}>
              {job.current === null ? TEXT.boardSearch.replace.finishedCost : TEXT.boardSearch.replace.cost}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>
                {TEXT.boardSearch.replace.confirm}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>
                {TEXT.boardSearch.replace.cancel}
              </button>
            </div>
          </div>
        )}
      </Details>
    </div>
  )
}
