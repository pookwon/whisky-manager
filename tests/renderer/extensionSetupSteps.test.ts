import { describe, expect, it } from 'vitest'
import {
  EXTENSION_SETUP_STEPS,
  shouldLoadExistingPairingToken,
} from '../../src/renderer/views/extensionSetupSteps.js'
import { TEXT } from '../../src/shared/text.js'

describe('the extension walkthrough', () => {
  /**
   * The order is a plain list, so the compiler cannot notice a step that was
   * written down and never walked. Left alone, a step added to the wording
   * simply never appears — the dialog still runs, one instruction short, and
   * the operator is stuck at whatever it skipped.
   */
  it('walks every step it has wording for, exactly once', () => {
    expect([...EXTENSION_SETUP_STEPS].sort()).toEqual(
      Object.keys(TEXT.extensionSetup.steps).sort(),
    )
  })

  it('ends on the step the confirmation belongs to', () => {
    expect(EXTENSION_SETUP_STEPS.at(-1)).toBe('launch')
  })

  it('never exposes the old token during recovery', () => {
    expect(shouldLoadExistingPairingToken('connect')).toBe(true)
    expect(shouldLoadExistingPairingToken('recover')).toBe(false)
  })
})
