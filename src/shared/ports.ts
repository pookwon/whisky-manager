export interface TimeParts {
  readonly hour: number
  readonly minute: number
  /** 0 = Sunday, 6 = Saturday. */
  readonly dayOfWeek: number
}

/**
 * All time reading goes through this port so tests can drive the scheduler with
 * a fake calendar instead of waiting for real clocks.
 */
export interface Clock {
  now(): number
  parts(epochMs: number): TimeParts
  /** Same local day as `epochMs`, at `hour`:00:00.000 local time. */
  atHour(epochMs: number, hour: number): number
  addDays(epochMs: number, days: number): number
}

export interface Random {
  /** Uniform integer in [min, max], both inclusive. */
  intInclusive(min: number, max: number): number
}
