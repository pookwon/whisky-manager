/**
 * A single-holder mutual exclusion between the two collection walks. The article
 * walk and the member walk share one browser session, so at most one may be in
 * flight at a time. This is a synchronous, in-process gate: each runner tries to
 * take it before starting and releases it when its walk settles.
 */
export interface CollectionLock {
  tryAcquire(): boolean
  release(): void
  isHeld(): boolean
}

export function createCollectionLock(): CollectionLock {
  let held = false
  return {
    tryAcquire() {
      if (held) return false
      held = true
      return true
    },
    release() {
      held = false
    },
    isHeld() {
      return held
    },
  }
}
