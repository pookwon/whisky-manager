import { TEXT } from '../../../shared/text.js'
import type { IdGapReport } from '../../../desktop/collection-db/idGapReport.js'
import { formatKstDateTime } from '../../format.js'

/**
 * The answer to "the cafe says more posts than we have". Green with one line
 * when every hole is a deletion; a warning with the widest holes listed, each
 * as the two stored neighbours and when they were written, so the operator can
 * open the list at that hour and see what sits between them.
 */
export function IdGapPanel({ report }: { report: IdGapReport }): React.JSX.Element {
  const clean = report.suspectCount === 0
  return (
    <section className="overflow-hidden rounded-lg" style={{ background: 'var(--surface-sunken)' }}>
      <div className="flex">
        <div className={`w-1 shrink-0 ${clean ? 'bar-ok' : 'bar-warn'}`} />
        <div className="flex-1 px-5 py-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold">{TEXT.collection.idGaps.heading}</h2>
          </div>
          <p className="mt-1.5 text-sm font-semibold tabular-nums">
            {clean
              ? TEXT.collection.idGaps.clean(report.deletedLikeIds)
              : TEXT.collection.idGaps.suspects(report.suspectCount, report.suspectIds)}
          </p>
          {!clean && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <tbody>
                  {report.suspects.map((suspect) => (
                    <tr key={suspect.id}>
                      <td className="pr-4 font-bold">{TEXT.collection.idGaps.gapRow(suspect.gap)}</td>
                      <td className="pr-4" style={{ color: 'var(--ink-muted)' }}>
                        {TEXT.collection.idGaps.between(suspect.id, suspect.nextId)}
                      </td>
                      <td>{TEXT.collection.idGaps.between(formatKstDateTime(suspect.atMs), formatKstDateTime(suspect.nextAtMs))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.collection.idGaps.hint}
          </p>
        </div>
      </div>
    </section>
  )
}
