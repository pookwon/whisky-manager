import type { ExtensionSetupStepKey } from '../../shared/text.js'

/**
 * The order the operator performs the steps in, which is not the order they
 * happen in: the folder is named first because it is what Chrome will be asked
 * for, and it only opens at the end, when the confirmation is pressed.
 *
 * `satisfies` rather than a type annotation keeps this a tuple, so the first
 * step is known to exist and the walkthrough cannot start on nothing. A test
 * holds it against the wording, so a step written in one place and forgotten
 * in the other is caught rather than silently skipped.
 */
export const EXTENSION_SETUP_STEPS = [
  'folder',
  'devMode',
  'load',
  'token',
  'launch',
] as const satisfies readonly ExtensionSetupStepKey[]
