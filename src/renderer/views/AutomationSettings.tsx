import { useEffect, useState } from 'react'
import { TEXT } from '../../shared/text.js'
import type { ApprovalPolicy } from '../../shared/types.js'
import { api } from '../api.js'
import { useApp } from '../store.js'

const POLICIES: ApprovalPolicy[] = ['AUTO', 'SEMI', 'MANUAL']

/** Every policy is named and explained, or the build fails. */
const POLICY_LABEL: Record<ApprovalPolicy, { label: string; hint: string }> = {
  AUTO: { label: TEXT.settings.policyAuto, hint: TEXT.settings.policyAutoHint },
  SEMI: { label: TEXT.settings.policySemi, hint: TEXT.settings.policySemiHint },
  MANUAL: { label: TEXT.settings.policyManual, hint: TEXT.settings.policyManualHint },
}

interface AutomationSettingsProps {
  readonly automationId: string
}

export function AutomationSettings({ automationId }: AutomationSettingsProps): React.JSX.Element {
  const settings = useApp((s) => s.automationSettings)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  const [boardId, setBoardId] = useState('')

  useEffect(() => {
    if (settings === null) return
    setBoardId(settings.boardId)
  }, [settings])

  if (settings === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  return (
    <div className="flex max-w-2xl flex-col gap-7">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{TEXT.settings.automationHeading}</h1>
      </header>

      <section className="panel flex items-center justify-between px-5 py-4">
        <span className="text-sm font-medium">{TEXT.settings.enabled}</span>
        <button
          type="button"
          className={settings.enabled ? 'btn btn-primary' : 'btn'}
          disabled={busy}
          onClick={() => void act(() => api.setEnabled(automationId, !settings.enabled))}
        >
          {settings.enabled ? TEXT.status.running : TEXT.status.stopped}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.settings.policy}
        </h2>
        {POLICIES.map((policy) => (
          <button
            key={policy}
            type="button"
            className="panel px-4 py-3 text-left"
            style={settings.policy === policy ? { borderColor: 'var(--accent)' } : undefined}
            disabled={busy}
            onClick={() => void act(() => api.setPolicy(automationId, policy))}
          >
            <div
              className={`text-sm font-semibold ${settings.policy === policy ? 'tone-warn' : ''}`}
            >
              {POLICY_LABEL[policy].label}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {POLICY_LABEL[policy].hint}
            </div>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.settings.board}
        </h2>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.settings.boardId}
          <input className="field" value={boardId} onChange={(e) => setBoardId(e.target.value)} />
          <span className="mt-0.5">{TEXT.settings.boardIdHint}</span>
        </label>
        <button
          type="button"
          className="btn btn-primary self-start"
          disabled={busy}
          onClick={() => void act(() => api.setBoardId(automationId, boardId))}
        >
          {TEXT.settings.save}
        </button>
      </section>
    </div>
  )
}
