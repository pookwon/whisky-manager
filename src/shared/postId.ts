const NUMERIC = /^\d+$/

/**
 * Naver post ids are ascending decimal integers, but they outgrow Number's safe
 * range, so comparison goes through BigInt. Non-numeric ids fall back to
 * lexicographic order rather than throwing — a stalled watermark is a bug we
 * want visible in tests, not a crash in production.
 */
export function laterPostId(current: string | null, candidate: string): string {
  if (current === null) return candidate
  if (NUMERIC.test(current) && NUMERIC.test(candidate)) {
    return BigInt(candidate) > BigInt(current) ? candidate : current
  }
  return candidate > current ? candidate : current
}
