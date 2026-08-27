import { useEffect, useState } from 'react'
import { TEXT } from '../../shared/text.js'
import { api } from '../api.js'
import { useApp } from '../store.js'
import { ConfigTransfer } from './ConfigTransfer.js'

export function CommonSettings(): React.JSX.Element {
  const settings = useApp((s) => s.commonSettings)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  const [cafeId, setCafeId] = useState('')
  const [cafeUrlName, setCafeUrlName] = useState('')
  const [accountDraft, setAccountDraft] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    if (settings === null) return
    setCafeId(settings.cafeId)
    setCafeUrlName(settings.cafeUrlName)
  }, [settings])

  useEffect(() => {
    void api.getPairingToken().then(setToken)
  }, [])

  if (settings === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const addAccount = (): void => {
    const trimmed = accountDraft.trim()
    if (trimmed === '' || settings.operatorAccounts.includes(trimmed)) {
      setAccountDraft('')
      return
    }
    void act(() => api.setOperatorAccounts([...settings.operatorAccounts, trimmed])).then((ok) => {
      if (ok) setAccountDraft('')
    })
  }

  const removeAccount = (account: string): void => {
    void act(() => api.setOperatorAccounts(settings.operatorAccounts.filter((a) => a !== account)))
  }

  return (
    <div className="flex max-w-2xl flex-col gap-7">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{TEXT.settings.commonHeading}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.settings.cafe}
        </h2>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.settings.cafeId}
          <input className="field" value={cafeId} onChange={(e) => setCafeId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.settings.cafeUrlName}
          <input
            className="field"
            value={cafeUrlName}
            onChange={(e) => setCafeUrlName(e.target.value)}
          />
          <span className="mt-0.5">{TEXT.settings.cafeUrlNameHint(cafeUrlName)}</span>
        </label>
        <button
          type="button"
          className="btn btn-primary self-start"
          disabled={busy}
          onClick={() => void act(() => api.setCafe(cafeId, cafeUrlName))}
        >
          {TEXT.settings.save}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.settings.operatorAccounts}
        </h2>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.settings.operatorAccountsHint}
        </p>

        <div className="flex gap-2">
          <input
            className="field"
            value={accountDraft}
            placeholder={TEXT.settings.operatorAccountsPlaceholder}
            onChange={(e) => setAccountDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addAccount()
            }}
          />
          <button type="button" className="btn shrink-0" disabled={busy} onClick={addAccount}>
            {TEXT.settings.operatorAccountsAdd}
          </button>
        </div>

        {settings.operatorAccounts.length === 0 ? (
          <div className="panel px-4 py-3 text-xs tone-warn">
            {TEXT.settings.operatorAccountsEmpty}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {settings.operatorAccounts.map((account) => (
              <li
                key={account}
                className="panel flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="text-sm">{account}</span>
                <button
                  type="button"
                  className="btn btn-danger shrink-0"
                  disabled={busy}
                  onClick={() => removeAccount(account)}
                >
                  {TEXT.settings.operatorAccountsRemove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.settings.pairing}
        </h2>
        <code
          className="panel select-all break-all px-4 py-3 font-mono text-xs"
          style={{ background: 'var(--surface-sunken)' }}
        >
          {token}
        </code>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.settings.pairingHint}
        </span>
      </section>

      <ConfigTransfer />
    </div>
  )
}
