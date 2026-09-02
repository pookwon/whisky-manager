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
})
