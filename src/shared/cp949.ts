import { CP949_LEAD_MIN, CP949_TABLE, CP949_TRAIL_MIN, CP949_TRAIL_SPAN } from './cp949Table.js'

/**
 * Percent-encodes form bodies the way a browser would from a CP949 page.
 *
 * The cafe's legacy endpoints decode request parameters as MS949, not UTF-8:
 * the same search term sent as UTF-8 comes back mojibake and matches nothing,
 * while the CP949 bytes match. `URLSearchParams` and `encodeURIComponent` only
 * ever produce UTF-8, so the encoding has to be done here.
 */
let encodeTable: Map<string, number> | null = null

function table(): Map<string, number> {
  if (encodeTable !== null) return encodeTable

  const built = new Map<string, number>()
  for (let index = 0; index < CP949_TABLE.length; index += 1) {
    const codePoint = CP949_TABLE.charCodeAt(index)
    if (codePoint === 0) continue
    const lead = CP949_LEAD_MIN + Math.floor(index / CP949_TRAIL_SPAN)
    const trail = CP949_TRAIL_MIN + (index % CP949_TRAIL_SPAN)
    // Earlier pairs win, matching the table's own decode order.
    const char = String.fromCharCode(codePoint)
    if (!built.has(char)) built.set(char, (lead << 8) | trail)
  }
  encodeTable = built
  return built
}

/** The set `application/x-www-form-urlencoded` leaves alone. */
function isUnreserved(char: string): boolean {
  return /[A-Za-z0-9*\-._]/.test(char)
}

function percentOf(...bytes: number[]): string {
  return bytes.map((byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join('')
}

function encodeAscii(char: string): string {
  return percentOf(char.charCodeAt(0))
}

/**
 * What a browser does with a character the page's charset cannot express: it
 * substitutes a numeric character reference rather than dropping the character.
 */
function numericReference(char: string): string {
  return [...`&#${char.codePointAt(0) ?? 0};`]
    .map((part) => (isUnreserved(part) ? part : encodeAscii(part)))
    .join('')
}

export function encodeFormValue(text: string): string {
  let out = ''

  for (const char of text) {
    if (char === ' ') {
      out += '+'
      continue
    }
    if (isUnreserved(char)) {
      out += char
      continue
    }
    if (char.charCodeAt(0) < 0x80 && char.length === 1) {
      out += encodeAscii(char)
      continue
    }
    const pair = char.length === 1 ? table().get(char) : undefined
    out += pair === undefined ? numericReference(char) : percentOf(pair >> 8, pair & 0xff)
  }

  return out
}

export function encodeFormBody(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${encodeFormValue(name)}=${encodeFormValue(value)}`)
    .join('&')
}
