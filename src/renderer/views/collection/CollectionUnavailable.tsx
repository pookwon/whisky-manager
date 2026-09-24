import { TEXT } from '../../../shared/text.js'
import type { CollectionStatusView } from '../../../desktop/ipc.js'

/** The two ways collection storage can be missing; both status views share them. */
export type CollectionStorageAbsence = Exclude<CollectionStatusView, { readonly kind: 'ready' }>

/** Storage is optional; both ways it can be absent get their own explanation. */
export function CollectionUnavailable({ view }: { view: CollectionStorageAbsence }): React.JSX.Element {
  const disabled = view.kind === 'disabled'
  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${disabled ? 'bar-idle' : 'bar-warn'}`} />
        <div className="flex-1 px-5 py-4">
          <div
            className="text-[0.6875rem] font-medium uppercase tracking-wider"
            style={{ color: 'var(--ink-muted)' }}
          >
            {disabled ? TEXT.collection.disabledHeading : TEXT.collection.unavailableHeading}
          </div>
          <p className={`mt-1 text-sm ${disabled ? '' : 'tone-warn'}`}>
            {disabled
              ? TEXT.collection.disabledHow
              : TEXT.collection.unavailable[view.code]}
          </p>
        </div>
      </div>
    </section>
  )
}
