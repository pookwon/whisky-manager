import { randomInt } from 'node:crypto'
import type { Clock, Random } from '../shared/ports.js'

/** Local-time clock. The operating window is expressed in the operator's day. */
export const systemClock: Clock = {
  now() {
    return Date.now()
  },
  parts(epochMs) {
    const d = new Date(epochMs)
    return { hour: d.getHours(), minute: d.getMinutes(), dayOfWeek: d.getDay() }
  },
  atHour(epochMs, hour) {
    const d = new Date(epochMs)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0).getTime()
  },
  addDays(epochMs, days) {
    const d = new Date(epochMs)
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + days,
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    ).getTime()
  },
}

export const systemRandom: Random = {
  intInclusive(min, max) {
    // randomInt's upper bound is exclusive.
    return randomInt(min, max + 1)
  },
}
