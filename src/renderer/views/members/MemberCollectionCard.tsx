import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { MemberCollectionStatusView, StartCollectionResult } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { formatKstDateTime } from '../../format.js'
import { progressLine, stopReasonLine } from '../memberCollectionCard.js'

/** Why a member collection press did nothing. */
function memberRefusalText(result: StartCollectionResult): string | null {
  if (result.kind === 'refused') return TEXT.memberCollection.refused[result.reason] ?? null
  return null
}

export function MemberCollectionCard({
  memberCollection,
  busy,
  act,
}: {
  memberCollection: MemberCollectionStatusView | null
  busy: boolean
  act: (run: () => Promise<unknown>) => Promise<boolean>
}): React.JSX.Element | null {
  const [refusal, setRefusal] = useState<string | null>(null)

  if (memberCollection === null || memberCollection.kind !== 'ready') return null

  const { status, stopping } = memberCollection
  const { running, complete, forced, memberCount, completedAtMs, toppedUpAtMs, authorCount, matchedAuthorCount, lastRunStatus } = status

  const stopLine = stopReasonLine(status)

  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${running ? 'bar-accent' : 'bar-idle'}`} />
        <div className="flex flex-1 items-center justify-between gap-6 px-5 py-4">
          <div className="flex-1 min-w-0">
            <div
              className="text-[0.6875rem] font-medium uppercase tracking-wider"
              style={{ color: 'var(--ink-muted)' }}
            >
              {TEXT.memberCollection.heading}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {running ? (
                <span className="tone-accent">{TEXT.memberCollection.running}</span>
              ) : memberCount === 0 ? (
                <span style={{ color: 'var(--ink-muted)' }}>{TEXT.memberCollection.never}</span>
              ) : (
                <span>{TEXT.memberCollection.idle}</span>
              )}
            </div>
            <div className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.memberCollection.memberCount(memberCount)}
              {' · '}
              {progressLine(status)}
            </div>
            <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
              {completedAtMs !== null
                ? TEXT.memberCollection.completedAt(formatKstDateTime(completedAtMs))
                : TEXT.memberCollection.incomplete}
              {' · '}
              {toppedUpAtMs !== null
                ? TEXT.memberCollection.toppedUpAt(formatKstDateTime(toppedUpAtMs))
                : TEXT.memberCollection.toppedUpNever}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.memberCollection.match(matchedAuthorCount, authorCount)}
            </div>
            {stopLine !== null && (
              <div className={`mt-1 text-sm ${lastRunStatus === 'failed' ? 'tone-alarm' : 'tone-warn'}`}>{stopLine}</div>
            )}
            {forced && (
              <div className="mt-1 text-sm tone-warn">{TEXT.memberCollection.forcedOn}</div>
            )}
            {refusal !== null && <div className="mt-1 text-sm tone-warn">{refusal}</div>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!complete && (
              <button
                type="button"
                className="btn"
                disabled={busy || running}
                onClick={() => {
                  setRefusal(null)
                  void act(async () => {
                    const result = await api.startMemberCollection()
                    setRefusal(memberRefusalText(result))
                  })
                }}
              >
                {memberCount === 0 ? TEXT.memberCollection.start : TEXT.memberCollection.resume}
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={busy || !running || stopping}
              onClick={() => void act(() => api.stopMemberCollection())}
            >
              {stopping ? TEXT.memberCollection.stopping : TEXT.memberCollection.stop}
            </button>
            {!complete && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setRefusal(null)
                  void act(async () => {
                    const result = await api.setMemberCollectionForced(!forced)
                    if (result.kind === 'refused') setRefusal(TEXT.memberCollection.refused[result.reason] ?? null)
                  })
                }}
              >
                {forced ? TEXT.memberCollection.forceRelease : TEXT.memberCollection.force}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
