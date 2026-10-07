/**
 * How a block ended, for whoever goes on with what it left. Said once per
 * block, after the lock is free, so the next walk can take it at once.
 */
export interface CollectionBlockEnd {
  /** Requests the block made. */
  readonly requests: number
  /**
   * `budget`: it spent what it was given. `drained`: its walk had nothing
   * left, with budget to spare. `stopped`: the operator asked. `failed`: a
   * failure ended it or left work behind it.
   */
  readonly endedBy: 'budget' | 'drained' | 'stopped' | 'failed'
}

export type OnCollectionBlockEnd = (end: CollectionBlockEnd) => void
