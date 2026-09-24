import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import { MEMBER_RESYNC_INTERVAL_CHOICES } from '../../../shared/memberResync.js'
import type { MemberCollectionStatusView, StartCollectionResult } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { resyncScheduleLine, resyncStateLine, resyncStopLine } from './resyncLines.js'

type ReadyView = Extract<MemberCollectionStatusView, { readonly kind: 'ready' }>

interface MemberResyncCardProps {
  readonly view: ReadyView
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
}

function refusalText(result: StartCollectionResult): string | null {
  return result.kind === 'refused' ? TEXT.memberResync.refused[result.reason] : null
}

/**
 * The periodic re-walk: where it stands, when it comes next, and a press to
 * start (or carry on) one now. Stopping it is the member card's stop button —
 * both walks go through the same list and only one runs at a time.
 */
export function MemberResyncCard({ view, busy, act }: MemberResyncCardProps): React.JSX.Element {
  const [refusal, setRefusal] = useState<string | null>(null)
  const { resync, status } = view
  const scheduleLine = resyncScheduleLine(resync, Date.now())
  const stopLine = resyncStopLine(resync)

  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${resync.running ? 'bar-accent' : 'bar-idle'}`} />
        <div className="flex flex-1 flex-col gap-3 px-5 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {TEXT.memberResync.heading}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {resync.inProgress ? (
                  <span className="tone-accent">{TEXT.memberResync.inProgress}</span>
                ) : (
                  <span>{TEXT.memberResync.idle}</span>
                )}
              </div>
              <div className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                {resyncStateLine(resync, status.totalMemberCount)}
              </div>
              {scheduleLine !== null && (
                <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {scheduleLine}
                </div>
              )}
              {stopLine !== null && (
                <div className={`mt-1 text-sm ${resync.lastRun?.status === 'failed' ? 'tone-alarm' : 'tone-warn'}`}>{stopLine}</div>
              )}
              {refusal !== null && <div className="mt-1 text-sm tone-warn">{refusal}</div>}
            </div>
            <button
              type="button"
              className="btn shrink-0"
              disabled={busy || status.running || !resync.available}
              onClick={() => {
                setRefusal(null)
                void act(async () => setRefusal(refusalText(await api.startMemberResync())))
              }}
            >
              {resync.inProgress ? TEXT.memberResync.resume : TEXT.memberResync.start}
            </button>
          </div>

          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.memberResync.interval}
            </legend>
            {MEMBER_RESYNC_INTERVAL_CHOICES.map((days) => (
              <label key={days} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="member-resync-interval"
                  value={days}
                  checked={resync.intervalDays === days}
                  disabled={busy}
                  onChange={() => void act(() => api.setMemberResyncInterval(days))}
                />
                <span>{TEXT.memberResync.intervalChoice(days)}</span>
              </label>
            ))}
          </fieldset>

          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.memberResync.why}
          </p>
        </div>
      </div>
    </section>
  )
}
