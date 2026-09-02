/**
 * A small decoder for the entity forms the cafe management API uses in
 * `memberLevelName`: the five named references plus decimal and hexadecimal
 * numeric references. The repository has no general HTML parser, and pulling one
 * in for a level name would be far more than this needs. Unknown tokens are left
 * verbatim so a malformed reference is never silently dropped.
 */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+\d*);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    const named = NAMED[entity]
    return named ?? match
  })
}
