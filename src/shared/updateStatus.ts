/** Why an update did not go through. Each has one line of words in `TEXT.update`. */
export type UpdateFailureReason =
  | 'CHECK_FAILED'
  | 'RELEASE_UNUSABLE'
  | 'DOWNLOAD_FAILED'
  | 'DIGEST_MISMATCH'
  | 'MARKER_NOT_WRITTEN'
  | 'INSTALLER_UNAVAILABLE'
  | 'INSTALL_FAILED'

/** What the update machinery is doing, as the operator's screens read it. */
export type UpdateState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'downloading'; readonly version: string }
  | { readonly kind: 'ready'; readonly version: string }
  /** Pressed, but work is in progress; it installs when that work ends. */
  | { readonly kind: 'waitingIdle'; readonly version: string }
  | { readonly kind: 'applying'; readonly version: string }
  /** The file was opened for the operator to finish by hand. */
  | { readonly kind: 'handedOver'; readonly version: string }
  | { readonly kind: 'failed'; readonly reason: UpdateFailureReason }
