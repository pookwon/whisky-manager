import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

/**
 * The last lines of a log file, read without loading the file.
 *
 * `sessions.log` grows one line per session for as long as the app is used,
 * and the log screen wants the recent end of it every few seconds. Reading the
 * whole file for that would cost more each month; reading the last chunk
 * costs the same forever.
 */
export function readTailLines(path: string, maxBytes: number): readonly string[] {
  try {
    const fd = openSync(path, 'r')
    try {
      const size = fstatSync(fd).size
      const start = Math.max(0, size - maxBytes)
      const buffer = Buffer.alloc(size - start)
      readSync(fd, buffer, 0, buffer.length, start)
      const lines = buffer.toString('utf8').split('\n')
      // A cut inside the file lands mid-line — and, for a Korean line, maybe
      // mid-character; that fragment is not a line.
      const whole = start > 0 ? lines.slice(1) : lines
      return whole.filter((line) => line.length > 0)
    } finally {
      closeSync(fd)
    }
  } catch {
    // No file yet is what a fresh install looks like, and a disk that fails
    // mid-read is a diagnostic's own problem; either way the screen shows
    // what it has rather than an error about its error.
    return []
  }
}
