import { TEXT } from '../../../shared/text.js'
import { useApp } from '../../store.js'
import { CollectionUnavailable } from '../collection/CollectionUnavailable.js'
import { MemberCollectionCard } from './MemberCollectionCard.js'

/** The member list's own screen: the walk that copies it, apart from the boards. */
export function MemberCollection(): React.JSX.Element {
  const memberCollection = useApp((s) => s.memberCollection)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  if (memberCollection === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{TEXT.memberCollection.pageHeading}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.memberCollection.sharesSchedule}
        </p>
      </header>
      {memberCollection.kind === 'ready' ? (
        <MemberCollectionCard memberCollection={memberCollection} busy={busy} act={act} />
      ) : (
        <CollectionUnavailable view={memberCollection} />
      )}
    </div>
  )
}
