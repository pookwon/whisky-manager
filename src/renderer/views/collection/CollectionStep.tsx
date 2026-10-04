import { useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import { Details } from '../dashboard/Details.js'
import type { StepBadge } from './stepStates.js'

/** The palette role each badge wears; the bar on the left wears the same one. */
const BADGE_TONE: Record<StepBadge, 'warn' | 'accent' | 'ok' | 'idle'> = {
  todo: 'warn',
  running: 'accent',
  done: 'ok',
  notNeeded: 'idle',
}

/** `idle` has no token of its own; it reads as muted ink. */
function toneColor(tone: 'warn' | 'accent' | 'ok' | 'idle'): string {
  return tone === 'idle' ? 'var(--ink-muted)' : `var(--${tone})`
}

export interface StepFold {
  readonly summary: string
  readonly initiallyOpen: boolean
}

interface CollectionStepProps {
  readonly number: string
  readonly title: string
  /** What the step does, in one sentence a newcomer can act on. */
  readonly what: string
  readonly badge?: StepBadge | undefined
  /** Under the description: why the step is not needed, or how it ended. */
  readonly reason?: string | null | undefined
  /** The step's one button, already chosen for its state. */
  readonly action?: React.ReactNode
  /**
   * Folds the body behind one line. Only the first drawing reads
   * `initiallyOpen`: the poll redraws every two seconds and must not undo
   * what the operator pressed.
   */
  readonly fold?: StepFold | undefined
  readonly children?: React.ReactNode
}

/**
 * One step of the collection: number, name, badge and button on one line, a
 * sentence saying what the step is for, and its body. Every step wears this
 * frame so a newcomer reads four steps the same way.
 */
export function CollectionStep(props: CollectionStepProps): React.JSX.Element {
  const [open, setOpen] = useState(props.fold?.initiallyOpen ?? true)
  const tone = props.badge === undefined ? 'idle' : BADGE_TONE[props.badge]
  return (
    <section className="panel overflow-hidden" style={props.badge === 'notNeeded' ? { opacity: 0.75 } : undefined}>
      <div className="flex">
        <div className={`w-1 shrink-0 bar-${tone}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-4">
          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold" aria-hidden="true">
                  {props.number}
                </span>
                <h2 className="text-base font-bold tracking-tight">{props.title}</h2>
                {props.badge !== undefined && (
                  <span className="chip" style={{ color: toneColor(tone) }}>
                    {TEXT.collection.badges[props.badge]}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                {props.what}
              </p>
              {props.reason != null && <p className="mt-1 text-sm">{props.reason}</p>}
            </div>
            {props.action !== undefined && <div className="flex shrink-0 items-center gap-2">{props.action}</div>}
          </header>
          {props.fold === undefined ? (
            props.children
          ) : (
            <Details summary={props.fold.summary} open={open} onToggle={() => setOpen((value) => !value)}>
              {props.children}
            </Details>
          )}
        </div>
      </div>
    </section>
  )
}
