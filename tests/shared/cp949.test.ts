import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { encodeFormBody, encodeFormValue } from '../../src/shared/cp949.js'

describe('encodeFormValue', () => {
  it('encodes hangul as the bytes the cafe server decodes', () => {
    // Verified against the live search endpoint: this exact encoding returned
    // results while the utf-8 one returned mojibake and none.
    expect(encodeFormValue('환영')).toBe('%C8%AF%BF%B5')
    expect(encodeFormValue('한글')).toBe('%C7%D1%B1%DB')
  })

  it('covers the extended area strict euc-kr leaves out', () => {
    // Node's own decoder reads these two bytes as the letter "A"; a table built
    // from the platform would silently corrupt every syllable in this range.
    expect(encodeFormValue('갂')).toBe('%81%41')
    expect(encodeFormValue('뷁')).toBe('%94%EE')
  })

  it('passes unreserved ascii through and encodes a space as plus', () => {
    expect(encodeFormValue('hello-world_1.2*3')).toBe('hello-world_1.2*3')
    expect(encodeFormValue('a b')).toBe('a+b')
  })

  it('percent-encodes reserved ascii', () => {
    expect(encodeFormValue('a&b=c')).toBe('a%26b%3Dc')
    expect(encodeFormValue('!')).toBe('%21')
  })

  it('escapes what cp949 cannot represent the way a browser form does', () => {
    // A browser submitting from a cp949 page replaces unrepresentable
    // characters with a numeric reference rather than dropping them.
    expect(encodeFormValue('😀')).toBe('%26%23128512%3B')
  })

  it('keeps a newline, which memo comments allow', () => {
    expect(encodeFormValue('a\nb')).toBe('a%0Ab')
  })

  it('returns an empty string unchanged', () => {
    expect(encodeFormValue('')).toBe('')
  })
})

describe('the vendored table', () => {
  it('agrees with the reference encoder across every hangul syllable', () => {
    // The table is generated once and committed, so this guards it against a
    // bad regeneration. iconv-lite is the generator's source and stays a dev
    // dependency; nothing ships it.
    const mismatches: string[] = []

    for (let codePoint = 0xac00; codePoint <= 0xd7a3; codePoint += 1) {
      const char = String.fromCodePoint(codePoint)
      const expected = [...iconv.encode(char, 'cp949')]
        .map((byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0'))
        .join('')
      if (encodeFormValue(char) !== expected) mismatches.push(char)
    }

    expect(mismatches).toEqual([])
  })
})

describe('encodeFormBody', () => {
  it('joins fields in the order given', () => {
    expect(encodeFormBody({ m: 'write', content: '환영', articleid: '334381' })).toBe(
      'm=write&content=%C8%AF%BF%B5&articleid=334381',
    )
  })

  it('keeps empty fields, because the cafe form posts every one of them', () => {
    expect(encodeFormBody({ content: 'hi', commentid: '' })).toBe('content=hi&commentid=')
  })
})
