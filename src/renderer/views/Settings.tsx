import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApprovalPolicy } from '../../shared/types.js'
import { WELCOME_AUTOMATION_ID } from '../../shared/automations/catalog.js'
import { api } from '../api.js'
import { useApp } from '../store.js'

const POLICIES: ApprovalPolicy[] = ['AUTO', 'SEMI', 'MANUAL']
const POLICY_LABEL: Record<ApprovalPolicy, { label: string; hint: string }> = {
  AUTO: { label: 'settings.policyAuto', hint: 'settings.policyAutoHint' },
  SEMI: { label: 'settings.policySemi', hint: 'settings.policySemiHint' },
  MANUAL: { label: 'settings.policyManual', hint: 'settings.policyManualHint' },
}

export function Settings(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  const [cafeId, setCafeId] = useState('')
  const [boardId, setBoardId] = useState('')
  const [cafeUrlName, setCafeUrlName] = useState('')
  const [accountDraft, setAccountDraft] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    if (settings === null) return
    setCafeId(settings.cafeId)
    setBoardId(settings.boardId)
    setCafeUrlName(settings.cafeUrlName)
  }, [settings])

  useEffect(() => {
    void api.getPairingToken().then(setToken)
  }, [])

  if (settings === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const saveCafe = (): void => {
    void act(async () => {
      await api.setCafe(cafeId, cafeUrlName)
      await api.setBoardId(WELCOME_AUTOMATION_ID, boardId)
    })
  }

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
        <h1 className="text-lg font-bold tracking-tight">{t('settings.heading')}</h1>
      </header>

      <section className="panel flex items-center justify-between px-5 py-4">
        <span className="text-sm font-medium">{t('settings.enabled')}</span>
        <button
          type="button"
          className={settings.enabled ? 'btn btn-primary' : 'btn'}
          disabled={busy}
          onClick={() => void act(() => api.setEnabled(WELCOME_AUTOMATION_ID, !settings.enabled))}
        >
          {t(settings.enabled ? 'status.running' : 'status.stopped')}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.policy')}
        </h2>
        {POLICIES.map((policy) => (
          <button
            key={policy}
            type="button"
            className="panel px-4 py-3 text-left"
            style={settings.policy === policy ? { borderColor: 'var(--accent)' } : undefined}
            disabled={busy}
            onClick={() => void act(() => api.setPolicy(WELCOME_AUTOMATION_ID, policy))}
          >
            <div className={`text-sm font-semibold ${settings.policy === policy ? 'tone-warn' : ''}`}>
              {t(POLICY_LABEL[policy].label)}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {t(POLICY_LABEL[policy].hint)}
            </div>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.cafe')}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {t('settings.cafeId')}
            <input className="field" value={cafeId} onChange={(e) => setCafeId(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {t('settings.boardId')}
            <input className="field" value={boardId} onChange={(e) => setBoardId(e.target.value)} />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.cafeUrlName')}
          <input className="field" value={cafeUrlName} onChange={(e) => setCafeUrlName(e.target.value)} />
          <span className="mt-0.5">{t('settings.cafeUrlNameHint', { url: `cafe.naver.com/${cafeUrlName}` })}</span>
        </label>

        <button type="button" className="btn btn-primary self-start" disabled={busy} onClick={saveCafe}>
          {t('settings.save')}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
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
          <div className="panel px-4 py-3 text-xs tone-warn">{t('settings.operatorAccountsEmpty')}</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {settings.operatorAccounts.map((account) => (
              <li key={account} className="panel flex items-center justify-between gap-3 px-4 py-2.5">
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
        <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
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
