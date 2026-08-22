import { describe, expect, it } from 'vitest'
import { extractOgImage } from '../../src/shared/cafeImage.js'

describe('extractOgImage', () => {
  it('reads the content of the og:image meta tag', () => {
    const html = `<html><head><meta property="og:image" content="https://cdn.example.com/cafe.jpg"></head></html>`
    expect(extractOgImage(html)).toBe('https://cdn.example.com/cafe.jpg')
  })

  it('reads the tag regardless of attribute order', () => {
    const html = `<meta content="https://cdn.example.com/cafe.jpg" property="og:image">`
    expect(extractOgImage(html)).toBe('https://cdn.example.com/cafe.jpg')
  })

  it('returns null when the page has no og:image tag', () => {
    expect(extractOgImage('<html><head></head></html>')).toBeNull()
  })

  it('returns null when the content attribute is empty', () => {
    expect(extractOgImage('<meta property="og:image" content="">')).toBeNull()
  })
})
