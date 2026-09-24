/**
 * Waits out a delay between requests without going deaf to a stop.
 *
 * The pacing takes minutes-long breaks every twentieth and hundredth request.
 * Slept in one piece, a stop pressed at the start of such a break was not read
 * until it ended — up to an hour of a button that appeared to do nothing.
 * Sleeping in slices costs nothing and lets the stop land within a second.
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
