import { useEffect, useState } from 'react'
import { TEXT } from '../../shared/text.js'
import {
  MAX_BREAK_SECONDS,
  MAX_PAGE_DELAY_SECONDS,
  MIN_BREAK_SECONDS,
  MIN_PAGE_DELAY_SECONDS,
  type CollectionPacing,
  type DelayRange,
} from '../../shared/collectionPacing.js'

interface PacingRow {
  readonly key: keyof CollectionPacing
  readonly label: string
  readonly low: number
  readonly high: number
}

const ROWS: readonly PacingRow[] = [
  { key: 'perPage', label: TEXT.collectionSettings.paceBetween, low: MIN_PAGE_DELAY_SECONDS, high: MAX_PAGE_DELAY_SECONDS },
  { key: 'everyTwentyPages', label: TEXT.collectionSettings.paceTwenty, low: MIN_BREAK_SECONDS, high: MAX_BREAK_SECONDS },
  { key: 'everyHundredPages', label: TEXT.collectionSettings.paceHundred, low: MIN_BREAK_SECONDS, high: MAX_BREAK_SECONDS },
]

const BOUNDS = ['minSeconds', 'maxSeconds'] as const

interface CollectionPacingFieldsProps {
  readonly pacing: CollectionPacing
  /** Called with every edit, so the page budget shown beside it can follow. */
  readonly onDraft: (pacing: CollectionPacing) => void
  /** Called when a row is left; the desktop normalizes what it stores. */
  readonly onSave: (pacing: CollectionPacing) => void
}

/** An emptied field keeps what was stored rather than reading as zero seconds. */
function withStoredFor(draft: CollectionPacing, stored: CollectionPacing): CollectionPacing {
  const fill = (key: keyof CollectionPacing): DelayRange => ({
    minSeconds: Number.isNaN(draft[key].minSeconds) ? stored[key].minSeconds : draft[key].minSeconds,
    maxSeconds: Number.isNaN(draft[key].maxSeconds) ? stored[key].maxSeconds : draft[key].maxSeconds,
  })
  return { perPage: fill('perPage'), everyTwentyPages: fill('everyTwentyPages'), everyHundredPages: fill('everyHundredPages') }
}

/**
 * The three delay ranges, each as a pair of seconds. A row is saved when focus
 * leaves it, not per field: saving the minimum alone would normalize the pair
 * while the maximum is still to be typed.
 *
 * The fields stay editable while a save is in flight — the screen's busy flag
 * would otherwise disable the field focus has just moved to.
 */
export function CollectionPacingFields({ pacing, onDraft, onSave }: CollectionPacingFieldsProps): React.JSX.Element {
  const [draft, setDraft] = useState(pacing)
  // The screen polls, handing over a fresh but equal object every few seconds;
  // only a stored value that actually changed may replace what is being typed.
  const stored = JSON.stringify(pacing)

  useEffect(() => setDraft(JSON.parse(stored) as CollectionPacing), [stored])

  const edit = (key: keyof CollectionPacing, bound: keyof DelayRange, text: string): void => {
    const next = { ...draft, [key]: { ...draft[key], [bound]: text === '' ? Number.NaN : Number(text) } }
    setDraft(next)
    onDraft(withStoredFor(next, pacing))
  }

  const leaveRow = (event: React.FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    const resolved = withStoredFor(draft, pacing)
    if (JSON.stringify(resolved) !== stored) onSave(resolved)
    else setDraft(resolved)
  }

  return (
    <div className="panel flex flex-col gap-2.5 px-4 py-3 text-[0.8125rem]">
      {ROWS.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-4" onBlur={leaveRow}>
          <span style={{ color: 'var(--ink-muted)' }}>{row.label}</span>
          <span className="flex items-center gap-1.5 tabular-nums">
            {BOUNDS.map((bound, index) => (
              <label key={bound} className="flex items-center gap-1.5">
                {index > 0 && <span style={{ color: 'var(--ink-muted)' }}>~</span>}
                <input
                  type="number"
                  className="field w-20"
                  aria-label={`${row.label} ${bound === 'minSeconds' ? TEXT.collectionSettings.paceFrom : TEXT.collectionSettings.paceTo}`}
                  min={row.low}
                  max={row.high}
                  value={Number.isNaN(draft[row.key][bound]) ? '' : draft[row.key][bound]}
                  onChange={(event) => edit(row.key, bound, event.target.value)}
                />
              </label>
            ))}
            <span style={{ color: 'var(--ink-muted)' }}>{TEXT.collectionSettings.paceSeconds}</span>
          </span>
        </div>
      ))}
    </div>
  )
}
