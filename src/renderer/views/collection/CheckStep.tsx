import { TEXT } from '../../../shared/text.js'
import type { CollectionStatus } from '../../../desktop/collection-db/statusQuery.js'
import { formatKstDateTime } from '../../format.js'
import { CollectionStep } from './CollectionStep.js'
import { IdGapPanel } from './IdGapPanel.js'

/** Same shape the dashboard's numbers wear, so the two screens read alike. */
function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-lg px-4 py-3.5" style={{ background: 'var(--surface-sunken)' }}>
      <div className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold tabular-nums leading-none">{value.toLocaleString()}</div>
    </div>
  )
}

/**
 * ④ What is stored, and whether anything was lost. No badge: there is
 * nothing to press here, only something to read.
 */
export function CheckStep({ status }: { status: CollectionStatus }): React.JSX.Element {
  const { totals, idGaps } = status
  return (
    <CollectionStep number={TEXT.collection.steps.check.number} title={TEXT.collection.steps.check.title} what={TEXT.collection.steps.check.what}>
      <div className="grid grid-cols-2 gap-3">
        <Stat label={TEXT.collection.totals.posts} value={totals.posts} />
        <Stat label={TEXT.collection.totals.boards} value={totals.boards} />
      </div>
      {/* Said in dates rather than page numbers: a page number points at
          different posts an hour later, so it cannot describe what is stored. */}
      <div>
        <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collection.span}
        </div>
        <div className="mt-1 text-sm font-semibold tabular-nums">
          {totals.oldestPostedAtMs === null || totals.newestPostedAtMs === null
            ? TEXT.collection.spanEmpty
            : TEXT.collection.spanRange(formatKstDateTime(totals.oldestPostedAtMs), formatKstDateTime(totals.newestPostedAtMs))}
        </div>
      </div>
      {totals.posts > 0 && <IdGapPanel report={idGaps} />}
    </CollectionStep>
  )
}
