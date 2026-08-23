/**
 * Only the parts of a keyboard event this decision needs, so the rule can be
 * tested without a DOM.
 */
export interface SubmitKeyEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

/**
 * A greeting may span lines, so a plain Enter belongs to the textarea and
 * submitting moves to the modifier — the convention every chat box uses.
 */
export function isSubmitKey(event: SubmitKeyEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey)
}
