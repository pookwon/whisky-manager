import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { BoardSearchPlanView, BoardSearchStatusView } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import {
  boardSearchBlockFailureLine,
  boardSearchCoverageLine,
  boardSearchPageLabel,
  boardSearchPlanOutcome,
  boardSearchProgressLine,
  boardSearchQueryState,
  boardSearchQueryStateText,
  boardSearchStartLabel,
  boardSearchSummaryLine,
  boardSearchTotalLabel,
  dayKeyLabel,
  dayKeyOfDateInput,
} from './boardSearchLines.js'
import { searchStartRefusal } from './startRefusals.js'

type ReadyView = Extract<BoardSearchStatusView, { readonly kind: 'ready' }>['view']

interface BoardSearchCardProps {
  readonly view: ReadyView
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
}

const DEFAULT_FROM = '2025-01-01'

/**
 * The search backfill: make a job for a board, see where it stands, start or
 * stop a block. It takes turns with the other walks on the schedule; the
 * buttons are for not waiting.
 */
export function BoardSearchCard({ view, busy, act }: BoardSearchCardProps): React.JSX.Element {
  const [boardId, setBoardId] = useState(view.job?.boardId ?? view.boards[0]?.boardId ?? '')
  const [fromDate, setFromDate] = useState(view.job === null ? DEFAULT_FROM : dayKeyLabel(view.job.fromDay))
  /** The last preview or create that came back as a plan, until the next press. */
  const [plan, setPlan] = useState<string | null>(null)
  /** Why the last press did nothing, until the next press. */
  const [refusal, setRefusal] = useState<string | null>(null)
  const { job, running } = view
  const fromDay = dayKeyOfDateInput(fromDate)
  const coverageLine = job === null ? null : boardSearchCoverageLine(job.coverage)
  const blockFailureLine = boardSearchBlockFailureLine(view.blockFailure)
  const progressLine = running ? boardSearchProgressLine(view.progress) : null
  const finished = job !== null && job.current === null

  const clear = (): void => {
    setPlan(null)
    setRefusal(null)
  }

  const answer = (outcome: BoardSearchPlanView): void => {
    const { kind, text } = boardSearchPlanOutcome(outcome, fromDay)
    if (kind === 'plan') setPlan(text)
    else setRefusal(text)
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${running ? 'bar-accent' : 'bar-idle'}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {TEXT.boardSearch.heading}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {job === null ? (
                  <span>{TEXT.boardSearch.none}</span>
                ) : running ? (
                  <span className="tone-accent">{TEXT.boardSearch.running}</span>
                ) : (
                  <span>{finished ? TEXT.boardSearch.finished : TEXT.boardSearch.idle}</span>
                )}
              </div>
              {job !== null && (
                <>
                  <div className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                    {TEXT.boardSearch.window(job.boardName ?? job.boardId, dayKeyLabel(job.fromDay), dayKeyLabel(job.toDay))}
                  </div>
                  <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                    {boardSearchSummaryLine(job)}
                  </div>
                  {progressLine !== null && (
                    <div className="mt-0.5 text-sm tabular-nums tone-accent">
                      {progressLine}
                    </div>
                  )}
                  {coverageLine !== null && (
                    <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                      {coverageLine}
                    </div>
                  )}
                </>
              )}
              {plan !== null && (
                <div className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {plan}
                </div>
              )}
              {blockFailureLine !== null && <div className="mt-1 text-sm tone-warn">{blockFailureLine}</div>}
              {refusal !== null && <div className="mt-1 text-sm tone-warn">{refusal}</div>}
            </div>
            {job !== null &&
              !finished &&
              (running ? (
                <button
                  type="button"
                  className="btn shrink-0"
                  disabled={busy}
                  onClick={() => {
                    clear()
                    void act(() => api.stopBoardSearch())
                  }}
                >
                  {TEXT.boardSearch.stop}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn shrink-0"
                  disabled={busy}
                  onClick={() => {
                    clear()
                    void act(async () => setRefusal(searchStartRefusal(await api.startBoardSearch())))
                  }}
                >
                  {boardSearchStartLabel(job)}
                </button>
              ))}
          </div>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (job !== null && !window.confirm(TEXT.boardSearch.replaceConfirm)) return
              clear()
              void act(async () => answer(await api.createBoardSearchJob({ boardId, fromDay })))
            }}
          >
            <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.boardSearch.board}
              <select className="field" value={boardId} disabled={busy || running} onChange={(event) => setBoardId(event.target.value)}>
                {view.boards.map((board) => (
                  <option key={board.boardId} value={board.boardId}>
                    {board.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.boardSearch.fromDay}
              <input
                className="field"
                type="date"
                value={fromDate}
                disabled={busy || running}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={busy || boardId === ''}
              onClick={() => {
                clear()
                void act(async () => answer(await api.previewBoardSearchJob({ boardId, fromDay })))
              }}
            >
              {TEXT.boardSearch.previewButton}
            </button>
            <button type="submit" className="btn" disabled={busy || running || boardId === ''}>
              {TEXT.boardSearch.create}
            </button>
          </form>

          {job !== null && (
            <details>
              <summary className="cursor-pointer text-sm">{TEXT.boardSearch.queries}</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr style={{ color: 'var(--ink-muted)' }}>
                      <th className="text-left">{TEXT.boardSearch.columns.order}</th>
                      <th className="text-left">{TEXT.boardSearch.columns.query}</th>
                      <th className="text-left">{TEXT.boardSearch.columns.state}</th>
                      <th className="text-right">{TEXT.boardSearch.columns.page}</th>
                      <th className="text-right">{TEXT.boardSearch.columns.inserted}</th>
                      <th className="text-right">{TEXT.boardSearch.columns.total}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.queries.map((query) => {
                      const state = boardSearchQueryState(query, running)
                      return (
                        <tr key={query.query}>
                          <td>{query.queueOrder}</td>
                          <td>{query.query}</td>
                          <td className={state === 'failed' ? 'tone-warn' : undefined}>{boardSearchQueryStateText(query, state)}</td>
                          <td className="text-right">{boardSearchPageLabel(query)}</td>
                          <td className="text-right">{query.insertedCount.toLocaleString('ko-KR')}</td>
                          <td className="text-right">{boardSearchTotalLabel(query.totalCount)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.boardSearch.why}
          </p>
        </div>
      </div>
    </section>
  )
}
