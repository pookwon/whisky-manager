/**
 * `code` is the stable name a screen and a query can match on. `detail` is what
 * a person needs to see when the code alone does not say what to do — it is
 * carried into the run's stop reason, so the answer sits in the app's own run
 * list rather than in a log file nobody opens. It must never carry post titles
 * or response bodies: identifiers and times only.
 */
export class CollectionPageError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail === undefined ? code : `${code}: ${detail}`)
    this.name = 'CollectionPageError'
  }
}
