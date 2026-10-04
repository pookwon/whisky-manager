import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { ArticleProbeStatusView } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import {
  articleProbeCreateOutcome,
  articleProbeCreateRefusal,
  articleProbeFailureLine,
  articleProbeProgressLine,
  articleProbeStartLabel,
  articleProbeSummaryLine,
  articleProbeWindowLine,
} from './articleProbeLines.js'
import { probeStartRefusal } from './startRefusals.js'

type ReadyView = Extract<ArticleProbeStatusView, { readonly kind: 'ready' }>['view']

interface ArticleProbeCardProps {
  readonly view: ReadyView
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
}

/**
 * Reading the gap's ids one by one: make the job once the search backfill is
 * done, see where it stands, start or stop a block. It takes turns with the
 * other walks on the schedule; the buttons are for not waiting.
 */
export function ArticleProbeCard({ view, busy, act }: ArticleProbeCardProps): React.JSX.Element {
  /** What the last create press said, until the next press. */
  const [created, setCreated] = useState<string | null>(null)
  /** Why the last press did nothing, until the next press. */
  const [refusal, setRefusal] = useState<string | null>(null)
  const { job, running, window } = view
  const finished = job !== null && job.probed === job.total
  const progressLine = running ? articleProbeProgressLine(view.progress) : null
  const failureLine = articleProbeFailureLine(view.blockFailure, view.lastRun)
  const createRefusal = articleProbeCreateRefusal(window)
  const windowLine = job !== null ? articleProbeWindowLine(job) : window?.kind === 'ready' ? articleProbeWindowLine(window) : null

  const clear = (): void => {
    setCreated(null)
    setRefusal(null)
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex">
        <div className={`w-1 shrink-0 ${running ? 'bar-accent' : 'bar-idle'}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                {TEXT.articleProbe.heading}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {job === null ? (
                  <span>{TEXT.articleProbe.none}</span>
                ) : running ? (
                  <span className="tone-accent">{TEXT.articleProbe.running}</span>
                ) : (
                  <span>{finished ? TEXT.articleProbe.finished : TEXT.articleProbe.idle}</span>
                )}
              </div>
              {windowLine !== null && (
                <div className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  {windowLine}
                </div>
              )}
              {job !== null && (
                <div className="mt-0.5 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {articleProbeSummaryLine(job)}
                </div>
              )}
              {progressLine !== null && <div className="mt-0.5 text-sm tabular-nums tone-accent">{progressLine}</div>}
              {created !== null && (
                <div className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {created}
                </div>
              )}
              {failureLine !== null && <div className="mt-1 text-sm tone-warn">{failureLine}</div>}
              {createRefusal !== null && <div className="mt-1 text-sm tone-warn">{createRefusal}</div>}
              {refusal !== null && <div className="mt-1 text-sm tone-warn">{refusal}</div>}
            </div>
            {job === null ? (
              <button
                type="button"
                className="btn shrink-0"
                disabled={busy || window?.kind !== 'ready'}
                onClick={() => {
                  clear()
                  void act(async () => {
                    const outcome = articleProbeCreateOutcome(await api.createArticleProbeJob())
                    if (outcome.kind === 'created') setCreated(outcome.text)
                    else setRefusal(outcome.text)
                  })
                }}
              >
                {TEXT.articleProbe.create}
              </button>
            ) : (
              !finished &&
              (running ? (
                <button
                  type="button"
                  className="btn shrink-0"
                  disabled={busy}
                  onClick={() => {
                    clear()
                    void act(() => api.stopArticleProbe())
                  }}
                >
                  {TEXT.articleProbe.stop}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn shrink-0"
                  disabled={busy}
                  onClick={() => {
                    clear()
                    void act(async () => setRefusal(probeStartRefusal(await api.startArticleProbe())))
                  }}
                >
                  {articleProbeStartLabel(job)}
                </button>
              ))
            )}
          </div>

          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.articleProbe.why}
          </p>
        </div>
      </div>
    </section>
  )
}
