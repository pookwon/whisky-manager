import type { Clock, Random, TimeParts } from '../src/shared/ports.js'

const DAY_MS = 86_400_000

/** Fake clock anchored to UTC so tests never depend on the host timezone. */
export class FakeClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current
  }

  set(epochMs: number): void {
    this.current = epochMs
  }

  parts(epochMs: number): TimeParts {
    const d = new Date(epochMs)
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayOfWeek: d.getUTCDay() }
  }

  atHour(epochMs: number, hour: number): number {
    const d = new Date(epochMs)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0)
  }

  addDays(epochMs: number, days: number): number {
    return epochMs + days * DAY_MS
  }
}

/** Returns the supplied values in order, then repeats the last one. */
export class SequenceRandom implements Random {
  private index = 0

  constructor(private readonly values: number[]) {}

  intInclusive(min: number, max: number): number {
    const raw = this.values[Math.min(this.index, this.values.length - 1)] ?? min
    this.index += 1
    return Math.min(Math.max(raw, min), max)
  }
}
