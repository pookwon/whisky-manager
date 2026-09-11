import { useEffect, useState } from 'react'
import { TEXT } from '../../../shared/text.js'
import { api } from '../../api.js'
import { useApp } from '../../store.js'
import type { SectionProps } from './sections.js'

/** The welcome automation's own settings: the one board it watches. */
export function WelcomeBoardSection({ automationId, settings }: SectionProps): React.JSX.Element {
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  const [boardId, setBoardId] = useState(settings.boardId)

  // Keyed on the stored value, not the settings object: the screen polls, every
  // poll brings a new object, and following that would wipe what the operator
  // is typing every few seconds.
  useEffect(() => {
    setBoardId(settings.boardId)
  }, [settings.boardId])

  return (
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
  )
}
