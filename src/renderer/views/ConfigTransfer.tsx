import { useState } from 'react'
import type { BundleProblem } from '../../shared/configBundle.js'
import { TEXT } from '../../shared/text.js'
import { api } from '../api.js'
import { useApp } from '../store.js'

/**
 * What the last press did. Held here rather than in the store because it is
 * the answer to one press on one screen: leaving the settings route and coming
 * back should not put a stale "saved to…" back in front of the operator.
 */
type Notice =
  | { readonly kind: 'EXPORTED'; readonly path: string }
  | {
      readonly kind: 'IMPORTED'
      readonly templateCount: number
      readonly enabledCount: number
    }
  | { readonly kind: 'REJECTED'; readonly problem: BundleProblem }

export function ConfigTransfer(): React.JSX.Element {
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const runExport = (): void => {
    setNotice(null)
    void act(async () => {
      const result = await api.exportConfig()
      // A closed dialog leaves the screen as it was. Saying "취소했습니다"
      // would report the operator's own press back to them as an event.
      if (result.kind === 'SAVED') setNotice({ kind: 'EXPORTED', path: result.path })
    })
  }

  const runImport = (): void => {
    setConfirming(false)
    setNotice(null)
    void act(async () => {
      const result = await api.importConfig()
      if (result.kind === 'IMPORTED') {
        setNotice({
          kind: 'IMPORTED',
          templateCount: result.templateCount,
          enabledCount: result.enabledCount,
        })
      } else if (result.kind === 'REJECTED') {
        setNotice({ kind: 'REJECTED', problem: result.problem })
      }
    })
  }

  return (
    <section className="flex flex-col gap-2">
      <h2
        className="text-[0.6875rem] font-medium uppercase tracking-wider"
        style={{ color: 'var(--ink-muted)' }}
      >
        {TEXT.configTransfer.heading}
      </h2>
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {TEXT.configTransfer.hint}
      </p>

      <div className="flex gap-2">
        <button type="button" className="btn" disabled={busy} onClick={runExport}>
          {TEXT.configTransfer.exportButton}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setNotice(null)
            setConfirming(true)
          }}
        >
          {TEXT.configTransfer.importButton}
        </button>
      </div>

      {confirming && (
        <div className="panel mt-1 overflow-hidden">
          <div className="flex">
            <div className="w-1 shrink-0 bar-warn" />
            <div className="flex-1 px-5 py-4">
              <div
                className="text-[0.6875rem] font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-muted)' }}
              >
                {TEXT.configTransfer.confirmHeading}
              </div>
              <p className="mt-1 text-sm tone-warn">{TEXT.configTransfer.confirmBody}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={runImport}
                >
                  {TEXT.configTransfer.confirm}
                </button>
                <button type="button" className="btn" onClick={() => setConfirming(false)}>
                  {TEXT.configTransfer.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {notice !== null && (
        <div
          className={
            notice.kind === 'REJECTED'
              ? 'panel mt-1 px-4 py-3 text-xs tone-warn'
              : 'panel mt-1 px-4 py-3 text-xs tone-ok'
          }
        >
          {notice.kind === 'EXPORTED' && TEXT.configTransfer.exported(notice.path)}
          {notice.kind === 'REJECTED' && TEXT.configTransfer.rejected[notice.problem]}
          {notice.kind === 'IMPORTED' && (
            <>
              <div>{TEXT.configTransfer.imported(notice.templateCount)}</div>
              {/* Whether comments can now go out is the one thing an operator
                  must not have to work out from a quiet screen, so it is said
                  either way rather than only when the answer is awkward. */}
              {notice.enabledCount > 0 ? (
                <div className="mt-1 tone-warn">
                  {TEXT.configTransfer.importedEnabled(notice.enabledCount)}
                </div>
              ) : (
                <div className="mt-1" style={{ color: 'var(--ink-muted)' }}>
                  {TEXT.configTransfer.importedAllOff}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
