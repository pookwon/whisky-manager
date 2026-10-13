import type { UpdateNotice as UpdateNoticeContent } from '../updateNotice.js'

interface UpdateNoticeProps {
  readonly notice: UpdateNoticeContent
  readonly onApply: () => void
  readonly onCancel: () => void
}

export function UpdateNotice({ notice, onApply, onCancel }: UpdateNoticeProps) {
  return (
    <div className="mt-3">
      <p className={`text-[0.6875rem] leading-snug ${notice.tone === 'warn' ? 'tone-warn' : ''}`}>{notice.text}</p>
      {notice.action !== null && (
        <button
          type="button"
          className="btn btn-primary mt-2 w-full"
          onClick={notice.action.kind === 'apply' ? onApply : onCancel}
        >
          {notice.action.label}
        </button>
      )}
    </div>
  )
}
