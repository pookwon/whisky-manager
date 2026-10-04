import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { StartCollectionResult } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import { articleProbeCreateOutcome } from './articleProbeLines.js'
import type { NextStep } from './nextStep.js'
import { nextStepScheduleLine, nextStepSentence } from './nextStepLines.js'
import { listStartRefusal, probeStartRefusal, searchStartRefusal } from './startRefusals.js'
import type { WalkStep } from './stepFacts.js'

/** Each walk's stop, so the panel can stop whichever is running without asking which. */
const STOP: Record<WalkStep, () => Promise<void>> = {
  list: () => api.stopCollection(),
  search: () => api.stopBoardSearch(),
  probe: () => api.stopArticleProbe(),
}

const STOP_LABEL: Record<WalkStep, string> = {
  list: TEXT.collection.stop,
  search: TEXT.boardSearch.stop,
  probe: TEXT.articleProbe.stop,
}

interface NextStepPanelProps {
  readonly next: NextStep
  readonly busy: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly onPickPeriod: () => void
  readonly onPrepareSearch: (boardId: string) => void
}

/**
 * The top of the screen: one sentence saying what to do now, and the one
 * button that does it. Everything it says is read off the steps below; it
 * starts nothing they could not.
 */
export function NextStepPanel({ next, busy, act, onPickPeriod, onPrepareSearch }: NextStepPanelProps): React.JSX.Element {
  const scheduleLine = nextStepScheduleLine(next)
  /**
   * What the last press here answered, until the next press. The composer keys
   * this panel by `next.kind`, so an answer never outlives the step it was for.
   */
  const [answer, setAnswer] = useState<{ readonly text: string; readonly warn: boolean } | null>(null)

  const start = (run: () => Promise<StartCollectionResult>, refusal: (result: StartCollectionResult) => string | null): void => {
    setAnswer(null)
    void act(async () => {
      const text = refusal(await run())
      if (text !== null) setAnswer({ text, warn: true })
    })
  }

  const button = (label: string, onClick: () => void, primary = true): React.JSX.Element => (
    <button type="button" className={primary ? 'btn btn-primary' : 'btn'} disabled={busy} onClick={onClick}>
      {label}
    </button>
  )

  const action = ((): React.JSX.Element | null => {
    switch (next.kind) {
      case 'running':
        return button(STOP_LABEL[next.step], () => void act(STOP[next.step]), false)
      case 'listWaiting':
        return button(TEXT.collection.next.resumeList, () => start(() => api.startCollection(), listStartRefusal))
      case 'searchResume':
        return button(TEXT.boardSearch.resume, () => start(() => api.startBoardSearch(), searchStartRefusal))
      case 'probeResume':
        return button(TEXT.articleProbe.resume, () => start(() => api.startArticleProbe(), probeStartRefusal))
      case 'searchNeeded':
        return button(TEXT.collection.next.prepareSearch, () => onPrepareSearch(next.boardId))
      case 'probeCreate':
        return button(TEXT.articleProbe.create, () => {
          setAnswer(null)
          void act(async () => {
            const outcome = articleProbeCreateOutcome(await api.createArticleProbeJob())
            setAnswer({ text: outcome.text, warn: outcome.kind === 'refusal' })
          })
        })
      case 'pickPeriod':
        return button(TEXT.collection.next.pickPeriodAction, onPickPeriod)
      case 'probeSpent':
      case 'allDone':
        return null
    }
  })()

  return (
    <section className="panel overflow-hidden" aria-labelledby="collection-next-heading">
      <div className="flex">
        <div className={`w-1 shrink-0 ${next.kind === 'running' ? 'bar-accent' : next.kind === 'allDone' ? 'bar-ok' : 'bar-warn'}`} />
        <div className="flex flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="collection-next-heading" className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.collection.next.heading}
            </h2>
            <p className="mt-1 text-base font-semibold">{nextStepSentence(next)}</p>
            {scheduleLine !== null && (
              <p className="mt-1 text-sm tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                {scheduleLine}
              </p>
            )}
            {answer !== null && <p className={`mt-1 text-sm ${answer.warn ? 'tone-warn' : ''}`}>{answer.text}</p>}
          </div>
          {action !== null && <div className="shrink-0">{action}</div>}
        </div>
      </div>
    </section>
  )
}
