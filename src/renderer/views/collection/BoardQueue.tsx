import { TEXT } from '../../../shared/text.js'
import type { BoardProgress } from '../../../desktop/collection-db/statusQuery.js'
import { formatKstDateTime } from '../../format.js'

/**
 * The queue as a table, one row per board in walking order. The row being
 * walked is the one thing an operator looks for, so it is the only row with
 * an accent; the rest read as a list of what is done and what is left.
 */
export function BoardQueue({ boards }: { boards: readonly BoardProgress[] }): React.JSX.Element {
  const done = boards.filter((board) => board.state === 'complete' || board.state === 'horizon').length
  const walking = boards.find((board) => board.state === 'walking') ?? null
  return (
    <section className="panel px-5 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">{TEXT.collection.boards.heading}</h2>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collection.boards.summary(done, boards.length)}
          {walking !== null && ` · ${TEXT.collection.boards.walking(walking.name)}`}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead style={{ color: 'var(--ink-muted)' }}>
            <tr>
              <th className="text-left font-medium">{TEXT.collection.boards.order}</th>
              <th className="text-left font-medium">{TEXT.collection.boards.name}</th>
              <th className="text-left font-medium">{TEXT.collection.boards.state}</th>
              <th className="text-left font-medium">{TEXT.collection.boards.cursor}</th>
              <th className="text-right font-medium">{TEXT.collection.boards.inserted}</th>
            </tr>
          </thead>
          <tbody>
            {boards.map((board) => (
              <tr key={board.boardId} className={board.state === 'walking' ? 'font-bold' : ''} title={board.state === 'horizon' ? TEXT.collection.boards.horizonHint : undefined}>
                <td>{board.queueOrder}</td>
                <td>{board.name}</td>
                <td>{TEXT.collection.boards.states[board.state]}</td>
                <td>{board.cursorPostedAtMs === null ? '—' : formatKstDateTime(board.cursorPostedAtMs)}</td>
                <td className="text-right">{board.insertedPostCount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
