/**
 * Waits out a delay between requests without going deaf to a stop.
 *
 * The pacing pauses for two to five minutes every twentieth request and ten
 * to twenty every hundredth. Slept in one piece, a stop pressed at the start
 * of such a pause was not read until it ended — twenty minutes of a button
 * that appeared to do nothing. Sleeping in slices costs nothing and lets the
 * stop land within a second.
 *
 * Resolves true when the whole delay passed, false when a stop cut it short.
 */
const SLICE_MS = 1_000

export async function pauseUnlessStopped(
  totalMs: number,
  sleep: (ms: number) => Promise<void>,
  isStopRequested: () => boolean,
): Promise<boolean> {
  let remaining = totalMs
  while (remaining > 0) {
    if (isStopRequested()) return false
    const slice = Math.min(remaining, SLICE_MS)
    await sleep(slice)
    remaining -= slice
  }
  return !isStopRequested()
}
