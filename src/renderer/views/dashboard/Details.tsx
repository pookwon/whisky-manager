import { useId } from 'react'

/**
 * What a card keeps below its fold.
 *
 * The dashboard's first job is to say whether each job is running and why it
 * is quiet; everything that answers a later question — today's counts, the
 * period walked so far, the day drawn as a band — waits behind one press. The
 * summary line is the whole of what shows while folded, so it has to carry
 * the figures a glance wants without the panel they belong to.
 */

interface DetailsProps {
  readonly summary: string
  readonly open: boolean
  readonly onToggle: () => void
  /** What sits at the summary's right, visible while folded. */
  readonly aside?: React.ReactNode
  readonly children: React.ReactNode
}

function Chevron(): React.JSX.Element {
  return (
    <svg
      className="disclosure-chevron"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 1.5l4 3.5-4 3.5z" />
    </svg>
  )
}

export function Details(props: DetailsProps): React.JSX.Element {
  const regionId = useId()
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          className="disclosure"
          aria-expanded={props.open}
          aria-controls={regionId}
          onClick={props.onToggle}
        >
          <Chevron />
          <span className="tabular-nums">{props.summary}</span>
        </button>
        {props.aside}
      </div>
      {/* Mounted while folded so the button's aria-controls always names an
          element. The reveal animation restarts by itself each time the
          region comes back from display: none, so no remount is needed. */}
      <div id={regionId} hidden={!props.open} className="reveal mt-3 flex flex-col gap-3">
        {props.children}
      </div>
    </div>
  )
}
