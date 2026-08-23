const NUMERIC = /^\d+$/

/**
 * Naver post ids are ascending decimal integers, but they outgrow Number's safe
 * range, so comparison goes through BigInt. Non-numeric ids fall back to
 * lexicographic order rather than throwing — a mis-ordered id is a bug we want
 * visible in tests, not a crash in production.
 */
export function comparePostId(a: string, b: string): number {
  if (NUMERIC.test(a) && NUMERIC.test(b)) {
    const left = BigInt(a)
    const right = BigInt(b)
    return left === right ? 0 : left < right ? -1 : 1
  }
  return a === b ? 0 : a < b ? -1 : 1
}
