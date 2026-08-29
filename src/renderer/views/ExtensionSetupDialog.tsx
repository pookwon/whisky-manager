import { useEffect, useRef, useState } from 'react'
import type { ExtensionSetupResult } from '../../desktop/extensionSetup.js'
import { CHROME_EXTENSIONS_URL } from '../../shared/chrome.js'
import { TEXT } from '../../shared/text.js'
import { api } from '../api.js'
import { EXTENSION_SETUP_ART } from './extensionSetupArt.js'
import {
  EXTENSION_SETUP_STEPS,
  shouldLoadExistingPairingToken,
  type ExtensionSetupMode,
} from './extensionSetupSteps.js'

/** Long enough to be read, short enough that the button is a button again. */
const COPIED_FOR_MS = 1_600

/**
 * A value the operator has to move into Chrome by hand.
 *
 * The copy goes through the main process rather than `navigator.clipboard`:
 * the renderer is loaded from `file://`, and the token is the one thing in this
 * dialog that must not quietly fail to copy.
 */
function CopyRow({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-[0.6875rem] font-medium uppercase tracking-wider"
        style={{ color: 'var(--ink-muted)' }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code
          className="panel select-all flex-1 break-all px-3 py-2 font-mono text-xs"
          style={{ background: 'var(--surface-sunken)' }}
        >
          {value}
        </code>
        <button
          type="button"
          className="btn shrink-0"
          // `invoke` rejects when the main process throws, and an uncaught one
          // here leaves a button that does nothing and says nothing. The value
          // is selectable either way, which is the fallback.
          onClick={() =>
            void api
              .copyToClipboard(value)
              .then(() => setCopied(true))
              .catch(console.error)
          }
        >
          {copied ? TEXT.extensionSetup.copied : TEXT.extensionSetup.copy}
        </button>
      </div>
    </div>
  )
}

/**
 * The walkthrough an operator meets before anything works.
 *
 * It reads first and acts once. Every step is something they will do in Chrome
 * a minute from now, and the confirmation at the end opens all of it — the
 * folder, the address, the browser — so that nothing in the list has to be
 * hunted for. Chrome refuses to be pointed at its own extensions page from the
 * command line, so the address arrives on the clipboard instead and the last
 * step says so plainly rather than pretending the page will appear.
 */
export function ExtensionSetupDialog({
  mode,
  onClose,
}: {
  readonly mode: ExtensionSetupMode
  readonly onClose: () => void
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const [position, setPosition] = useState(0)
  const [token, setToken] = useState('')
  const [result, setResult] = useState<ExtensionSetupResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // showModal, not the `open` attribute: this is what makes the rest of the
    // window inert and hands over Esc and the focus trap without writing either.
    dialog.current?.showModal()
  }, [])

  useEffect(() => {
    // A token that never arrives leaves the field out rather than showing an
    // empty box; the guide still walks, and the settings screen still has it.
    // Recovery rotates the token only on confirmation, so fetching here would
    // retain a stale secret in component state even though it stays hidden.
    if (!shouldLoadExistingPairingToken(mode)) return
    void api.getPairingToken().then(setToken).catch(console.error)
  }, [mode])

  const total = EXTENSION_SETUP_STEPS.length
  const stepKey = EXTENSION_SETUP_STEPS[position] ?? EXTENSION_SETUP_STEPS[0]
  const step = TEXT.extensionSetup.steps[stepKey]
  const Art = EXTENSION_SETUP_ART[stepKey]
  const recoveryTokenStep = mode === 'recover' && stepKey === 'token'

  const openEverything = (): void => {
    setBusy(true)
    setFailure(null)
    const open = mode === 'recover' ? api.recoverExtensionSetup : api.openExtensionSetup
    void open()
      .then((opened) => {
        if ('pairingToken' in opened && typeof opened.pairingToken === 'string') {
          setToken(opened.pairingToken)
        }
        setResult(opened)
      })
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setBusy(false))
  }

  const hint = (text: string): React.JSX.Element => (
    <p
      className="mt-3 border-l-2 pl-3 text-xs leading-relaxed"
      style={{ borderColor: 'var(--accent)', color: 'var(--ink-muted)' }}
    >
      {text}
    </p>
  )

  return (
    <dialog ref={dialog} className="modal" onClose={onClose} aria-labelledby="extension-setup-heading">
      <div className="flex max-h-[calc(100vh-4rem)] flex-col">
        <header
          className="flex items-start justify-between gap-4 border-b px-6 py-4"
          style={{ borderColor: 'var(--line)' }}
        >
          <div>
            <h2 id="extension-setup-heading" className="text-base font-bold tracking-tight">
              {mode === 'recover'
                ? TEXT.extensionSetup.recovery.heading
                : TEXT.extensionSetup.heading}
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {mode === 'recover'
                ? TEXT.extensionSetup.recovery.subheading
                : TEXT.extensionSetup.subheading}
            </p>
          </div>
          {result === null && (
            <span className="chip shrink-0 tabular-nums">
              {TEXT.extensionSetup.position(position + 1, total)}
            </span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {result === null ? (
            <>
              <Art />
              <h3 className="mt-5 text-sm font-bold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                {recoveryTokenStep ? TEXT.extensionSetup.recovery.tokenStep.body : step.body}
              </p>
              {hint(recoveryTokenStep ? TEXT.extensionSetup.recovery.tokenStep.note : step.note)}
              {mode === 'connect' && stepKey === 'token' && token !== '' && (
                <div className="mt-4">
                  <CopyRow label={TEXT.extensionSetup.done.token} value={token} />
                </div>
              )}
            </>
          ) : (
            <>
              <p
                className={`text-sm font-semibold ${result.chromeOpened ? 'tone-accent' : 'tone-warn'}`}
              >
                {result.chromeOpened
                  ? TEXT.extensionSetup.done.urlCopied(CHROME_EXTENSIONS_URL)
                  : TEXT.extensionSetup.done.chromeMissing}
              </p>
              <div className="mt-4 flex flex-col gap-3">
                <CopyRow label={TEXT.extensionSetup.done.folder} value={result.extensionDir} />
                {token !== '' && (
                  <CopyRow label={TEXT.extensionSetup.done.token} value={token} />
                )}
              </div>
              {hint(TEXT.extensionSetup.done.remaining)}
            </>
          )}

          {failure !== null && (
            <div role="alert" className="panel mt-4 px-4 py-3 text-sm tone-alarm">
              {TEXT.app.actionFailed(failure)}
            </div>
          )}
        </div>

        <footer
          className={`flex items-center gap-2 border-t px-6 py-4 ${
            result === null ? 'justify-between' : 'justify-end'
          }`}
          style={{ borderColor: 'var(--line)' }}
        >
          {/* Once everything is open there is nothing left to do here, so
              closing stops being the quiet way out and becomes the action. */}
          <button
            type="button"
            className={result === null ? 'btn' : 'btn btn-primary'}
            onClick={() => dialog.current?.close()}
          >
            {TEXT.extensionSetup.close}
          </button>

          {result === null && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn"
                disabled={position === 0}
                onClick={() => setPosition((current) => current - 1)}
              >
                {TEXT.extensionSetup.back}
              </button>
              {position === total - 1 ? (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={openEverything}>
                  {mode === 'recover'
                    ? TEXT.extensionSetup.recovery.confirm
                    : TEXT.extensionSetup.confirm}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setPosition((current) => current + 1)}
                >
                  {TEXT.extensionSetup.next}
                </button>
              )}
            </div>
          )}
        </footer>
      </div>
    </dialog>
  )
}
