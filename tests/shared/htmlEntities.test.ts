import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities } from '../../src/shared/htmlEntities.js'

describe('decodeHtmlEntities', () => {
  it('decodes the five named entities', () => {
    expect(decodeHtmlEntities('a&amp;b&lt;c&gt;d&quot;e&#39;f')).toBe('a&b<c>d"e\'f')
  })
  it('decodes decimal and hex numeric references', () => {
    expect(decodeHtmlEntities('&#51221;&#47932;')).toBe('정물')
    expect(decodeHtmlEntities('&#xC2A4;&#x53F1;')).toBe('스叱')
  })
  it('leaves plain text and unknown tokens untouched', () => {
    expect(decodeHtmlEntities('plain & ok')).toBe('plain & ok')
    expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;')
  })
  it('leaves out-of-range code points verbatim instead of throwing', () => {
    // 0x10FFFF is the last valid Unicode scalar value.
    expect(decodeHtmlEntities('&#1114111;')).toBe('\u{10FFFF}')
    // 0x110000 is out of range — must leave the original text, never throw.
    expect(decodeHtmlEntities('&#1114112;')).toBe('&#1114112;')
    expect(decodeHtmlEntities('&#x110000;')).toBe('&#x110000;')
  })
  it('leaves surrogate code points verbatim instead of throwing', () => {
    // Surrogates (0xD800-0xDFFF) are not valid scalar values.
    expect(decodeHtmlEntities('&#xD800;')).toBe('&#xD800;')
    expect(decodeHtmlEntities('&#xDFFF;')).toBe('&#xDFFF;')
    expect(decodeHtmlEntities('&#55296;')).toBe('&#55296;')
  })
})
