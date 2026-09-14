import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTailLines } from '../../src/desktop/logTail.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-tail-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readTailLines', () => {
  it('returns every line of a small file, in file order, without the trailing newline', () => {
    const path = join(dir, 'sessions.log')
    writeFileSync(path, 'one\ntwo\nthree\n')

    expect(readTailLines(path, 1024)).toEqual(['one', 'two', 'three'])
  })

  it('reads only the tail of a large file and drops the line the cut fell in', () => {
    const path = join(dir, 'sessions.log')
    const lines = Array.from({ length: 100 }, (_, i) => `line-${String(i).padStart(3, '0')}`)
    writeFileSync(path, `${lines.join('\n')}\n`)

    const tail = readTailLines(path, 50)

    expect(tail.length).toBeGreaterThan(0)
    expect(tail.length).toBeLessThan(10)
    expect(tail[tail.length - 1]).toBe('line-099')
    for (const line of tail) expect(line).toMatch(/^line-\d{3}$/)
  })

  it('drops the fragment when the cut lands inside a Korean character', () => {
    const path = join(dir, 'sessions.log')
    const lines = ['자유게시판 읽는 중', '공지 게시판 완료', '질문 게시판 대기']
    writeFileSync(path, `${lines.join('\n')}\n`)
    // 3 bytes per Hangul syllable; a budget that is not a multiple of three
    // lands inside one somewhere in the second line.
    const tail = readTailLines(path, 40)

    expect(tail).toEqual(['질문 게시판 대기'])
  })

  it('answers a missing file with nothing rather than a throw', () => {
    expect(readTailLines(join(dir, 'absent.log'), 1024)).toEqual([])
  })
})
