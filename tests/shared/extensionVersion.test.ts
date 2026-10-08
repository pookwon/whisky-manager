import { describe, expect, it } from 'vitest'
import { extensionVersionWarning } from '../../src/shared/extensionVersion.js'

describe('extensionVersionWarning', () => {
  it('says nothing when the extension is this build', () => {
    expect(extensionVersionWarning('1.9.15', '1.9.15')).toBeNull()
  })

  it('names both versions when they differ', () => {
    expect(extensionVersionWarning('1.9.15', '1.9.12')).toBe(
      '확장 프로그램이 1.9.12입니다(앱 1.9.15). chrome://extensions에서 Whisky Manager를 다시 불러오세요.',
    )
  })

  it('reads a missing version as an extension older than the check', () => {
    expect(extensionVersionWarning('1.9.15', null)).toBe(
      '확장 프로그램이 앱(1.9.15)보다 이전 버전입니다. chrome://extensions에서 Whisky Manager를 다시 불러오세요.',
    )
  })
})
