import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api.js'
import { useApp } from '../store.js'

export function CommonSettings(): React.JSX.Element {
  const { t } = useTranslation()
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
        <h1 className="text-lg font-bold tracking-tight">{t('settings.commonHeading')}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('settings.cafe')}
        </h2>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.cafeId')}
          <input className="field" value={cafeId} onChange={(e) => setCafeId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.cafeUrlName')}
          <input
            className="field"
            value={cafeUrlName}
            onChange={(e) => setCafeUrlName(e.target.value)}
          />
          <span className="mt-0.5">
            {t('settings.cafeUrlNameHint', { url: `cafe.naver.com/${cafeUrlName}` })}
          </span>
        </label>
        <button
          type="button"
          className="btn btn-primary self-start"
          disabled={busy}
          onClick={() => void act(() => api.setCafe(cafeId, cafeUrlName))}
        >
          {t('settings.save')}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('settings.operatorAccounts')}
        </h2>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.operatorAccountsHint')}
        </p>

        <div className="flex gap-2">
          <input
            className="field"
            value={accountDraft}
            placeholder={t('settings.operatorAccountsPlaceholder')}
            onChange={(e) => setAccountDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addAccount()
            }}
          />
          <button type="button" className="btn shrink-0" disabled={busy} onClick={addAccount}>
            {t('settings.operatorAccountsAdd')}
          </button>
        </div>

        {settings.operatorAccounts.length === 0 ? (
          <div className="panel px-4 py-3 text-xs tone-warn">
            {t('settings.operatorAccountsEmpty')}
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
                  {t('settings.operatorAccountsRemove')}
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
          {t('settings.pairing')}
        </h2>
        <code
          className="panel select-all break-all px-4 py-3 font-mono text-xs"
          style={{ background: 'var(--surface-sunken)' }}
        >
          {token}
        </code>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.pairingHint')}
        </span>
      </section>
    </div>
  )
}
