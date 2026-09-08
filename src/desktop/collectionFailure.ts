/**
 * What a run's stop reason says about an exception the walk did not classify.
 *
 * A bare `COLLECTION_FAILURE` told the operator nothing: a bridge reply that
 * timed out and a database that refused a row read the same. The name and
 * message are enough to tell them apart and are what a person would look for
 * first. Kept to one line and a bounded length so a stop reason stays a
 * label, and never carries a response body — the messages that reach here
 * name requests, timeouts and constraints, not posts.
 */
const MAX_DETAIL_LENGTH = 200

export function describeFailure(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_DETAIL_LENGTH ? `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1)}…` : oneLine
}
