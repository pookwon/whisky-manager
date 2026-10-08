import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import type { StartCollectionResult } from '../../../desktop/ipc.js'
import { api } from '../../api.js'
import type { NextStep } from './nextStep.js'
import { nextStepScheduleLine, nextStepSentence } from './nextStepLines.js'
import { listStartRefusal } from './startRefusals.js'

interface NextStepPanelProps {
  readonly next: NextStep
  readonly busy: boolean
  /** A stop was asked and the walk is finishing its page. */
  readonly stopping: boolean
  readonly act: (run: () => Promise<unknown>) => Promise<boolean>
  readonly onPickPeriod: () => void
}

/**
 * The top of the screen: one sentence saying what to do now, and the one
 * button that resumes the pipeline. Everything it says is read off the steps
 * below; it starts nothing they could not.
 */
export function NextStepPanel({ next, busy, stopping, act, onPickPeriod }: NextStepPanelProps): React.JSX.Element {
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

  const button = (label: string, onClick: () => void, primary = true, disabled = busy): React.JSX.Element => (
    <button type="button" className={primary ? 'btn btn-primary' : 'btn'} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )

  const action = ((): React.JSX.Element | null => {
    switch (next.kind) {
      case 'running':
        return button(
          stopping ? TEXT.collection.stopping : TEXT.collection.stop,
          () => void act(() => api.stopCollection()),
          false,
          busy || stopping,
        )
      case 'resume':
        return button(TEXT.collection.next.resumeList, () => start(() => api.startCollection(), listStartRefusal))
      case 'pickPeriod':
        return button(TEXT.collection.next.pickPeriodAction, onPickPeriod)
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
