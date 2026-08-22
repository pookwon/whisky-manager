import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api.js'
import { useApp } from '../store.js'

export function Templates(): React.JSX.Element {
  const { t } = useTranslation()
  const templates = useApp((s) => s.templates)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  const [draft, setDraft] = useState('')

  const submit = (): void => {
    const body = draft.trim()
    if (body === '') return
    void act(() => api.addTemplate(body)).then(() => setDraft(''))
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{t('templates.heading')}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
          {t('templates.hint')}
        </p>
      </header>

      <div className="flex gap-2">
        <input
          className="field"
          value={draft}
          placeholder={t('templates.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button type="button" className="btn btn-primary shrink-0" disabled={busy} onClick={submit}>
          {t('templates.add')}
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="panel px-5 py-8 text-center text-sm tone-warn">{t('templates.empty')}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <li key={template.id} className="panel flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm">{template.body}</span>
              <button
                type="button"
                className="btn btn-danger shrink-0"
                disabled={busy}
                onClick={() => void act(() => api.removeTemplate(template.id))}
              >
                {t('templates.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
