import { parse } from 'node-html-parser'

/** Reads the cafe's own preview image off its public landing page. */
export function extractOgImage(html: string): string | null {
  const content = parse(html).querySelector('meta[property="og:image"]')?.getAttribute('content')
  return content === undefined || content === '' ? null : content
}
