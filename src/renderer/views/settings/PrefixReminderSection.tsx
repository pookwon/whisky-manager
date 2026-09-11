import { useEffect, useState } from 'react'
import { parsePrefixReminderOptions } from '../../../shared/automations/prefix-reminder/options.js'
import { TEXT } from '../../../shared/text.js'
import { api } from '../../api.js'
import { useApp } from '../../store.js'
import { parseExcludedBoardLines } from './excludedBoards.js'
import type { SectionProps } from './sections.js'

/**
 * The prefix reminder's own settings: the one comment it posts and the boards
 * where a missing prefix is not a mistake. One save for both, because the two
 * only make sense together — a comment with the wrong boards excluded is the
 * reminder landing on notices.
 */
export function PrefixReminderSection({ automationId, settings }: SectionProps): React.JSX.Element {
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  // Read the way the automation reads it, so the form shows what will actually
  // be posted and skipped rather than whatever shape happens to be stored.
  const stored = parsePrefixReminderOptions(JSON.stringify(settings.options))
  const storedLines = stored.excludedBoardIds.join('\n')

  const [commentText, setCommentText] = useState(stored.commentText)
  const [excludedLines, setExcludedLines] = useState(storedLines)
  /** The line that stopped the last save, until the next press. */
  const [invalid, setInvalid] = useState<string | null>(null)

  // Keyed on the stored strings, not the settings object: the screen polls,
  // and following each new object would wipe a comment mid-sentence.
  useEffect(() => {
    setCommentText(stored.commentText)
  }, [stored.commentText])
  useEffect(() => {
    setExcludedLines(storedLines)
  }, [storedLines])

  const save = (): void => {
    const parsed = parseExcludedBoardLines(excludedLines)
    if (!parsed.ok) {
      setInvalid(parsed.invalid)
      return
    }
    setInvalid(null)
    void act(() => api.setAutomationOptions(automationId, { commentText, excludedBoardIds: parsed.ids }))
  }

  return (
    <section className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
        {TEXT.settings.prefix.commentText}
        <textarea
          className="field field-multiline"
          rows={3}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
        />
        <span className="mt-0.5">{TEXT.settings.prefix.commentTextHint}</span>
      </label>
      <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
        {TEXT.settings.prefix.excludedBoards}
        <textarea
          className="field field-multiline tabular-nums"
          rows={6}
          value={excludedLines}
          onChange={(e) => setExcludedLines(e.target.value)}
        />
        <span className="mt-0.5">{TEXT.settings.prefix.excludedBoardsHint}</span>
      </label>
      {invalid !== null && (
        <p className="text-xs tone-alarm">{TEXT.settings.prefix.invalidBoardId(invalid)}</p>
      )}
      <button type="button" className="btn btn-primary self-start" disabled={busy} onClick={save}>
        {TEXT.settings.save}
      </button>
    </section>
  )
}
