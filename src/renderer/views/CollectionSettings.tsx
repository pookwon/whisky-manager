import { useEffect, useState } from 'react'
import { TEXT } from '../../shared/text.js'
import {
  COLLECTION_INTERVAL_MS,
  MAX_MAX_PAGES,
  MAX_RANGE_DAYS,
  MIN_MAX_PAGES,
  MIN_RANGE_DAYS,
  type CollectionInterval,
  type CollectionSchedule,
} from '../../shared/collectionSchedule.js'
import { api } from '../api.js'
import { formatKstTime } from '../format.js'
import { useApp } from '../store.js'

const INTERVALS: CollectionInterval[] = ['SIX_HOURS', 'TWELVE_HOURS', 'DAILY', 'MANUAL']

/** `HH:MM` as the time input speaks it, from minutes past KST midnight. */
function timeValue(minuteOfDay: number): string {
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const minutes = String(minuteOfDay % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}

function minuteOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * The slots a schedule actually fires at, spelled out rather than left for the
 * operator to work out from an interval and a base time.
 */
function gridTimes(schedule: CollectionSchedule): string | null {
  if (schedule.interval === 'MANUAL') return null
  const step = COLLECTION_INTERVAL_MS[schedule.interval]
  const slots: string[] = []
  for (let at = 0; at < 86_400_000; at += step) {
    slots.push(timeValue((schedule.baseMinuteOfDayKst + at / 60_000) % 1_440))
  }
  return slots.sort().join(', ')
}

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

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.collectionSettings.interval}
        </h2>
        {INTERVALS.map((interval) => (
          <button
            key={interval}
            type="button"
            className="panel px-4 py-3 text-left"
            style={draft.interval === interval ? { borderColor: 'var(--accent)' } : undefined}
            disabled={busy}
            onClick={() => save({ ...draft, interval })}
          >
            <div className={`text-sm font-semibold ${draft.interval === interval ? 'tone-warn' : ''}`}>
              {TEXT.collectionSettings.intervals[interval].label}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {TEXT.collectionSettings.intervals[interval].hint}
            </div>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {TEXT.collectionSettings.baseAndRange}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.collectionSettings.baseTime}
            <input
              type="time"
              className="field"
              value={timeValue(draft.baseMinuteOfDayKst)}
              disabled={busy}
              onChange={(event) => {
                const minutes = minuteOfDay(event.target.value)
                if (minutes !== null) save({ ...draft, baseMinuteOfDayKst: minutes })
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.collectionSettings.rangeDays}
            <input
              type="number"
              className="field"
              min={MIN_RANGE_DAYS}
              max={MAX_RANGE_DAYS}
              value={draft.rangeDays}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, rangeDays: Number(event.target.value) })}
              onBlur={() => save(draft)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.collectionSettings.maxPages}
            <input
              type="number"
              className="field"
              min={MIN_MAX_PAGES}
              max={MAX_MAX_PAGES}
              value={draft.maxPages}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, maxPages: Number(event.target.value) })}
              onBlur={() => save(draft)}
            />
          </label>
        </div>
        {gridTimes(draft) !== null && (
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {TEXT.collectionSettings.grid(gridTimes(draft) ?? '')}
          </p>
        )}
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
