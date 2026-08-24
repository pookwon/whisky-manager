import { TEXT } from '../../shared/text.js'
import { api } from '../api.js'
import { relativeTime } from '../format.js'
import { useApp } from '../store.js'

interface ApprovalsProps {
  /**
   * Which automation's queue this is. approve/reject key off a globally unique
   * execution id, so nothing in the body needs it — it is the route saying what
   * the store already fetched.
   */
  readonly automationId: string
}

export function Approvals(_props: ApprovalsProps): React.JSX.Element {
  const awaiting = useApp((s) => s.awaiting)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  const now = Date.now()

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{TEXT.approvals.heading}</h1>
      </header>

      {awaiting.length === 0 ? (
        <div className="panel px-5 py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.approvals.empty}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {awaiting.map((item) => {
            const age = relativeTime(item.detectedAt, now)
            return (
              <article key={item.id} className="panel px-5 py-4">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{item.author ?? '—'}</span>
                      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                        {TEXT.approvals.post} {item.postId} · {age}
                      </span>
                      {item.riskFlags.map((flag) => (
                        <span key={flag} className="chip tone-warn">
                          {/* Stored flags are read back without validation, so a
                              row written by another build can name one this one
                              has no word for. Showing the raw name beats an
                              empty chip on a queue someone is approving from. */}
                          {TEXT.risk[flag] ?? flag}
                        </span>
                      ))}
                    </div>

                    {item.title !== null && (
                      <div className="mt-1.5 truncate text-sm" style={{ color: 'var(--ink-muted)' }}>
                        {item.title}
                      </div>
                    )}

                    <div
                      className="mt-3 rounded-lg px-3 py-2 text-sm"
                      style={{ background: 'var(--surface-sunken)' }}
                    >
                      <div
                        className="mb-1 text-[0.625rem] font-medium uppercase tracking-wider"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        {TEXT.approvals.preview}
                      </div>
                      {item.renderedText ?? TEXT.approvals.noText}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void act(() => api.approve(item.id))}
                    >
                      {TEXT.approvals.approve}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => void act(() => api.reject(item.id))}
                    >
                      {TEXT.approvals.reject}
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
