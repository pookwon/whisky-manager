/**
 * An expensive read, done again only when a cheap fingerprint of its inputs
 * changes.
 *
 * The status screens are polled every few seconds, and a figure that sweeps
 * whole tables costs the same on every poll even though it moves only when a
 * collection writes. Callers that ask while a read is in flight share it, and
 * a failed read is forgotten so the next ask tries again.
 */
export function createFingerprintedRead<T>(compute: () => Promise<T>): (fingerprint: string) => Promise<T> {
  let cached: { readonly fingerprint: string; readonly value: Promise<T> } | null = null

  return (fingerprint) => {
    if (cached !== null && cached.fingerprint === fingerprint) return cached.value
    const value = compute()
    const entry = { fingerprint, value }
    cached = entry
    value.catch(() => {
      if (cached === entry) cached = null
    })
    return value
  }
}
