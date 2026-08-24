import { useState } from 'react'
import { TEXT } from '../../shared/text.js'
import { api } from '../api.js'
import { useApp } from '../store.js'
import { isSubmitKey } from './templateInput.js'

interface TemplatesProps {
  readonly automationId: string
}

export function Templates({ automationId }: TemplatesProps): React.JSX.Element {
  const templates = useApp((s) => s.templates)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  const [draft, setDraft] = useState('')

  const submit = (): void => {
    const body = draft.trim()
    if (body === '') return
    void act(() => api.addTemplate(automationId, body)).then((ok) => {
      // A failed add keeps the draft so the operator does not retype it.
      if (ok) setDraft('')
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{TEXT.templates.heading}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.templates.hint}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.templates.submitHint}
        </p>
      </header>

      <div className="flex items-start gap-2">
        <textarea
          className="field field-multiline"
          value={draft}
          rows={3}
          placeholder={TEXT.templates.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isSubmitKey(e)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button type="button" className="btn btn-primary shrink-0" disabled={busy} onClick={submit}>
          {TEXT.templates.add}
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="panel px-5 py-8 text-center text-sm tone-warn">{TEXT.templates.empty}</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <li key={template.id} className="panel flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm whitespace-pre-wrap">{template.body}</span>
              <button
                type="button"
                className="btn btn-danger shrink-0"
                disabled={busy}
                onClick={() => void act(() => api.removeTemplate(template.id))}
              >
                {TEXT.templates.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
