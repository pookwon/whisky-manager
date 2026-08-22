import { randomBytes, timingSafeEqual } from 'node:crypto'
import { PROTOCOL_VERSION } from '../../shared/protocol.js'

export interface PairingState {
  readonly token: string
  /** Set on the first successful handshake and never changed silently. */
  readonly boundExtensionId: string | null
}

export interface HelloAttempt {
  readonly token: string
  readonly origin: string | undefined
  readonly protocolVersion: number
}

export type PairingVerdict =
  | { accepted: true; boundExtensionId: string }
  | { accepted: false; reason: 'BAD_TOKEN' | 'WRONG_EXTENSION' | 'BAD_ORIGIN' | 'PROTOCOL_MISMATCH' }

export function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

export function extensionIdFromOrigin(origin: string | undefined): string | null {
  if (origin === undefined) return null
  const prefix = 'chrome-extension://'
  if (!origin.startsWith(prefix)) return null
  const id = origin.slice(prefix.length)
  return id.length > 0 ? id : null
}

function tokensMatch(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Trust on first use: the first extension presenting the correct token is
 * remembered, and only that extension is accepted afterwards. This removes the
 * need to know the extension id before the web store assigns one.
 */
export function verifyHello(state: PairingState, attempt: HelloAttempt): PairingVerdict {
  if (attempt.protocolVersion !== PROTOCOL_VERSION) {
    return { accepted: false, reason: 'PROTOCOL_MISMATCH' }
  }
  const extensionId = extensionIdFromOrigin(attempt.origin)
  if (extensionId === null) {
    return { accepted: false, reason: 'BAD_ORIGIN' }
  }
  if (!tokensMatch(state.token, attempt.token)) {
    return { accepted: false, reason: 'BAD_TOKEN' }
  }
  if (state.boundExtensionId !== null && state.boundExtensionId !== extensionId) {
    return { accepted: false, reason: 'WRONG_EXTENSION' }
  }
  return { accepted: true, boundExtensionId: extensionId }
}
