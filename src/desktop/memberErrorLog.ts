/**
 * What may be written to the log when a member collection run fails.
 *
 * It is a function of its own, and not a few lines inside the runner's
 * `onError`, so that a test can hold it to the rule: nothing derived from a
 * member row ever reaches the console. Inline, the rule was enforced by a
 * comment, and the next refactor would have had nothing to fail against.
 *
 * The danger is one field. Drizzle builds a query error's `message` from the
 * SQL text and the bound parameters, and for the member upsert those
 * parameters are the page's hundred member keys and nicknames. A raw pg error
 * carries the same thing in `detail` ("Failing row contains (...)"). So
 * `message` is kept only for errors that are not query errors — the
 * repository's own guards throw plain `Error`s whose messages are fixed
 * sentences, and those are what makes a failure diagnosable at all — while
 * `detail` and `params` are never read on any path.
 */
export interface SafeErrorFields {
  readonly name: string
  readonly message?: string
  readonly code?: string
  readonly constraint?: string
  readonly query?: string
}

function isQueryError(error: Error, fields: Record<string, unknown>): boolean {
  // Two tests rather than one: the constructor name survives normal builds, and
  // the `params` property survives a minifier that renames the class.
  return error.constructor.name === 'DrizzleQueryError' || 'params' in fields
}

export function safeMemberErrorFields(error: Error): SafeErrorFields {
  const fields = error as unknown as Record<string, unknown>
  const safe: { -readonly [K in keyof SafeErrorFields]: SafeErrorFields[K] } = { name: error.name }
  if (!isQueryError(error, fields)) safe.message = error.message
  // The SQL text keeps its parameters as placeholders, so it names the failing
  // statement without carrying a single value from it.
  if (typeof fields['code'] === 'string') safe.code = fields['code']
  if (typeof fields['constraint'] === 'string') safe.constraint = fields['constraint']
  if (typeof fields['query'] === 'string') safe.query = fields['query']
  return safe
}
