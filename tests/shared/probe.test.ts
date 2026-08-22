import { describe, expect, it } from 'vitest'
import { charsetFromContentType, isProbeTarget } from '../../src/shared/probe.js'

describe('isProbeTarget', () => {
  it('allows the cafe hosts the extension holds permission for', () => {
    expect(isProbeTarget('https://cafe.naver.com/MemoList.nhn?search.clubid=1')).toBe(true)
    expect(isProbeTarget('https://apis.naver.com/cafe-web/cafe2/x.json')).toBe(true)
  })

  it('refuses anything else, so a probe cannot borrow the session at large', () => {
    expect(isProbeTarget('https://mail.naver.com/')).toBe(false)
    expect(isProbeTarget('https://evil.example.com/')).toBe(false)
    // A lookalike host must not pass on a suffix match.
    expect(isProbeTarget('https://cafe.naver.com.evil.example.com/')).toBe(false)
  })

  it('refuses plaintext and unparseable urls', () => {
    expect(isProbeTarget('http://cafe.naver.com/')).toBe(false)
    expect(isProbeTarget('not a url')).toBe(false)
  })
})

describe('charsetFromContentType', () => {
  it('maps the MS949 label naver serves onto the decoder TextDecoder knows', () => {
    // TextDecoder('ms949') throws; euc-kr is the standard label for windows-949.
    expect(charsetFromContentType('text/html;charset=MS949')).toBe('euc-kr')
    expect(charsetFromContentType('text/html; charset=cp949')).toBe('euc-kr')
  })

  it('passes standard labels through', () => {
    expect(charsetFromContentType('application/json; charset=UTF-8')).toBe('utf-8')
    expect(charsetFromContentType('text/html;charset="euc-kr"')).toBe('euc-kr')
  })

  it('defaults to utf-8 when the header says nothing', () => {
    expect(charsetFromContentType('text/html')).toBe('utf-8')
    expect(charsetFromContentType(null)).toBe('utf-8')
  })

  it('produces a label TextDecoder actually accepts', () => {
    expect(() => new TextDecoder(charsetFromContentType('text/html;charset=MS949'))).not.toThrow()
  })
})
