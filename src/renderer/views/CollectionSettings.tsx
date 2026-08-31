import { useEffect, useState } from 'react'
import { TEXT } from '../../shared/text.js'
import {
  MAX_REST_MINUTES,
  MAX_WORK_BLOCK_MINUTES,
  MIN_REST_MINUTES,
  MIN_WORK_BLOCK_MINUTES,
  pagesPerWorkBlock,
  type CollectionSchedule,
} from '../../shared/collectionSchedule.js'
import { api } from '../api.js'
import { formatKstTime } from '../format.js'
import { useApp } from '../store.js'

export function CollectionSettings(): React.JSX.Element {
  const view = useApp((s) => s.collectionSchedule)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)
  const [draft, setDraft] = useState<CollectionSchedule | null>(null)

  useEffect(() => {
    if (view !== null) setDraft(view.schedule)
  }, [view])

  if (view === null || draft === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const save = (next: CollectionSchedule): void => {
    setDraft(next)
    void act(() => api.setCollectionSchedule(next))
  }

  return (
    <div className="flex max-w-2xl flex-col gap-7">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{TEXT.collectionSettings.heading}</h1>
      </header>

      {/* State and press kept apart, the way the automation switch does it. */}
      <section className="panel flex items-center justify-between px-5 py-4">
        <span className="text-sm font-medium">{TEXT.collectionSettings.scheduled}</span>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium ${draft.enabled ? 'tone-ok' : 'tone-idle'}`}>
            {draft.enabled ? TEXT.status.running : TEXT.status.stopped}
          </span>
          <button
            type="button"
            className={draft.enabled ? 'btn' : 'btn btn-primary'}
            disabled={busy}
            onClick={() => save({ ...draft, enabled: !draft.enabled })}
          >
            {draft.enabled ? TEXT.status.turnOff : TEXT.status.turnOn}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.collectionSettings.activeWindow}
        </h2>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collectionSettings.activeWindowHint}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.collectionSettings.startHour}
            <input
              type="number"
              className="field"
              min={0}
              max={23}
              value={draft.activeWindowStartHourKst}
              disabled={busy}
              onChange={(event) => {
                const hour = Math.max(0, Math.min(23, Number(event.target.value)))
                save({ ...draft, activeWindowStartHourKst: hour })
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.collectionSettings.endHour}
            <input
              type="number"
              className="field"
              min={0}
              max={23}
              value={draft.activeWindowEndHourKst}
              disabled={busy}
              onChange={(event) => {
                const hour = Math.max(0, Math.min(23, Number(event.target.value)))
                save({ ...draft, activeWindowEndHourKst: hour })
              }}
            />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.collectionSettings.workBlock}
        </h2>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collectionSettings.workBlockMinutes(draft.workBlockMinutes)}
          <input
            type="range"
            className="field"
            min={MIN_WORK_BLOCK_MINUTES}
            max={MAX_WORK_BLOCK_MINUTES}
            step={30}
            value={draft.workBlockMinutes}
            disabled={busy}
            onChange={(event) => {
              const minutes = Math.max(MIN_WORK_BLOCK_MINUTES, Math.min(MAX_WORK_BLOCK_MINUTES, Number(event.target.value)))
              save({ ...draft, workBlockMinutes: minutes })
            }}
          />
        </label>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collectionSettings.workBlockHint(pagesPerWorkBlock(draft.workBlockMinutes))}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.collectionSettings.restPeriod}
        </h2>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collectionSettings.restMinutes(draft.restMinutes)}
          <input
            type="range"
            className="field"
            min={MIN_REST_MINUTES}
            max={MAX_REST_MINUTES}
            step={30}
            value={draft.restMinutes}
            disabled={busy}
            onChange={(event) => {
              const minutes = Math.max(MIN_REST_MINUTES, Math.min(MAX_REST_MINUTES, Number(event.target.value)))
              save({ ...draft, restMinutes: minutes })
            }}
          />
        </label>
      </section>

      {/* The one line the operator opens this screen to check. */}
      <section className="panel overflow-hidden">
        <div className="flex">
          <div className={`w-1 shrink-0 ${view.nextRunAtMs === null ? 'bar-idle' : 'bar-accent'}`} />
          <div className="flex-1 px-5 py-4">
            <div
              className="text-[0.6875rem] font-medium uppercase tracking-wider"
              style={{ color: 'var(--ink-muted)' }}
            >
              {TEXT.collection.nextRun}
            </div>
            <div
              className={`mt-1 text-lg font-semibold tabular-nums ${view.nextRunAtMs === null ? '' : 'tone-accent'}`}
              style={view.nextRunAtMs === null ? { color: 'var(--ink-muted)' } : undefined}
            >
              {view.nextRunAtMs === null
                ? TEXT.collection.nextRunNone
                : TEXT.collection.nextRunAt(formatKstTime(view.nextRunAtMs))}
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.collectionSettings.yieldsToSession}
            </p>
          </div>
        </div>
      </section>

      {/* Stated rather than offered: these are not knobs. */}
      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.collectionSettings.pace}
        </h2>
        <div className="panel flex flex-col gap-1.5 px-4 py-3 text-[0.8125rem]">
          {[
            [TEXT.collectionSettings.paceBetween, TEXT.collectionSettings.paceBetweenValue],
            [TEXT.collectionSettings.paceTwenty, TEXT.collectionSettings.paceTwentyValue],
            [TEXT.collectionSettings.paceHundred, TEXT.collectionSettings.paceHundredValue],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span style={{ color: 'var(--ink-muted)' }}>{label}</span>
              <span className="tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {TEXT.collectionSettings.paceWhy}
        </p>
      </section>
    </div>
  )
}
