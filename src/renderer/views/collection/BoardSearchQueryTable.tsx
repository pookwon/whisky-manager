import { TEXT } from '../../../shared/text.js'
import type { BoardSearchJobView } from '../../../desktop/boardSearchView.js'
import {
  boardSearchPageLabel,
  boardSearchQueryState,
  boardSearchQueryStateText,
  boardSearchTotalLabel,
} from './boardSearchLines.js'

/** Every query of the job in queue order: where each stands and what it brought in. */
export function BoardSearchQueryTable({ job, running }: { job: BoardSearchJobView; running: boolean }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
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
  )
}
