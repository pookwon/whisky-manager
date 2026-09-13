import { TEXT } from '../../../shared/text.js'

/**
 * Today as twenty-four bars, one per KST hour.
 *
 * The folded card says how many went out today; this says when. An operator
 * who sees three bars in the morning and none since knows the afternoon is
 * quiet without unfolding anything. Heights are relative to the busiest hour
 * so a slow day still draws, and the hour under way is the accent colour —
 * the same colour the running rail wears.
 */

const BAR_WIDTH = '4px'
const BAR_GAP = '2px'
const CHART_HEIGHT = 14
const EMPTY_HEIGHT = 2

interface HourBarsProps {
  /** Twenty-four counts, hour 0 first. */
  readonly counts: readonly number[]
  readonly currentHour: number
}

export function HourBars(props: HourBarsProps): React.JSX.Element {
  const busiest = Math.max(1, ...props.counts)
  const sent = props.counts.reduce((total, count) => total + count, 0)
  return (
    <div
      role="img"
      aria-label={TEXT.dashboard.details.hourBars(sent)}
      className="flex items-end"
      style={{ gap: BAR_GAP, height: `${CHART_HEIGHT}px` }}
    >
      {props.counts.map((count, hour) => {
        const empty = count === 0
        const height = empty ? EMPTY_HEIGHT : Math.max(EMPTY_HEIGHT + 2, Math.round((count / busiest) * CHART_HEIGHT))
        return (
          <div
            key={hour}
            className={empty ? '' : hour === props.currentHour ? 'bar-accent' : 'bar-ok'}
            style={{
              width: BAR_WIDTH,
              height: `${height}px`,
              borderRadius: '2px 2px 0 0',
              background: empty ? 'var(--line)' : undefined,
            }}
          />
        )
      })}
    </div>
  )
}
