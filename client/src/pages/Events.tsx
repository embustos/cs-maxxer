import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const KINDS = ['club', 'career_fair', 'conference', 'networking', 'deadline', 'other'] as const
const LABELS: Record<EventKind, string> = {
  club: 'Club', career_fair: 'Career fair', conference: 'Conference',
  networking: 'Networking', deadline: 'Deadline', other: 'Other',
}

const DAY = 86400000
const midnight = (iso: string) => new Date(iso).setHours(0, 0, 0, 0)
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// A span is measured in days, not milliseconds: a conference that started this morning
// is "on now" and one that ends tonight is not past yet. Both ends are snapped to
// midnight first so a 9am start and a 6pm end land on the same footing.
const when = (ev: Pick<CalendarEvent, 'starts_at' | 'ends_at'>) => {
  const today = new Date().setHours(0, 0, 0, 0)
  const start = midnight(ev.starts_at)
  const end = ev.ends_at ? midnight(ev.ends_at) : start
  const startsIn = Math.round((start - today) / DAY)
  const endsIn = Math.round((end - today) / DAY)

  // "Oct 28 – 31" inside one month, "Oct 28 – Nov 2" across two. Same month a year
  // apart is still two months to a reader, so the year has to agree as well.
  const s = new Date(ev.starts_at)
  const e = new Date(ev.ends_at ?? ev.starts_at)
  const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()
  const date =
    end === start
      ? dayMonth(ev.starts_at)
      : `${dayMonth(ev.starts_at)} – ${sameMonth ? e.getDate() : dayMonth(ev.ends_at!)}`

  if (endsIn < 0) return { date, rel: `${-endsIn}d ago`, past: true }
  if (startsIn <= 0) return { date, rel: endsIn === 0 ? 'today' : 'on now', past: false }
  return { date, rel: startsIn === 1 ? 'tomorrow' : `in ${startsIn}d`, past: false }
}

// 'Other' is a placeholder until the user names it themselves.
const kindOf = (ev: CalendarEvent) =>
  ev.kind === 'other' && ev.kind_label ? ev.kind_label : LABELS[ev.kind]

import type { CalendarEvent, EventKind, CardProps } from '@/types'
import { errorMessage } from '@/lib/utils'

export default function Events({ items, loading, full = false, reload, onError, onToast, onDelete }: CardProps<CalendarEvent>) {
  const [adding, setAdding] = useState(false)
  // Two fields only exist for some answers: a name for 'Other', an end for a span.
  // They're state rather than form values because the markup reacts to them.
  const [kind, setKind] = useState<EventKind>('club')
  const [multiDay, setMultiDay] = useState(false)
  // Kept only to feed the end field's min — the browser refuses a backwards span itself,
  // which beats a round trip to hear it from zod.
  const [startsAt, setStartsAt] = useState('')

  function close() {
    setAdding(false)
    setKind('club')
    setMultiDay(false)
    setStartsAt('')
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    // A field that isn't rendered isn't in the form — the ?? keeps that a blank, not a crash.
    const el = (n: string) => (f.elements.namedItem(n) as HTMLInputElement | null)?.value ?? ''
    const title = el('title')
    try {
      // datetime-local gives "2026-09-01T18:00" with no timezone. new Date() reads it as
      // local time, and toISOString converts to the UTC the API expects.
      await api('/events', {
        method: 'POST',
        body: {
          title,
          kind,
          kind_label: kind === 'other' ? el('kind_label').trim() || null : null,
          starts_at: new Date(el('starts_at')).toISOString(),
          // The last day, stored at the end of it: a conference is over when its final
          // day is, not at midnight that morning.
          ends_at: multiDay && el('ends_at') ? new Date(`${el('ends_at')}T23:59`).toISOString() : null,
        },
      })
      f.reset()
      close()
      reload()
      onToast(`Added ${title}`)
    } catch (err) { onError(errorMessage(err)) }
  }

  async function toggleAttended(ev: CalendarEvent) {
    try {
      await api(`/events/${ev.id}`, { method: 'PATCH', body: { attended: !ev.attended } })
      reload()
    } catch (err) { onError(errorMessage(err)) }
  }

  const upcoming = items.filter((e) => !when(e).past)
  // Most recent first — on the page, last week's career fair matters more than March's.
  const past = items.filter((e) => when(e).past).reverse()
  // The card is what's still ahead, scrolling past ~5 rows; the page is the whole record.
  const shown = full ? items : upcoming

  const row = (ev: CalendarEvent) => {
    const w = when(ev)
    return (
      <li key={ev.id} className={w.past ? 'past' : ''}>
        <label className="grow">
          <input type="checkbox" checked={ev.attended} onChange={() => toggleAttended(ev)} />
          <span>
            <span className="title">{ev.title}</span>
            <span className="sub">{kindOf(ev)} · {w.date}</span>
          </span>
        </label>
        <span className={`badge ${w.past ? '' : 'soon'}`}>{w.rel}</span>
        <button className="ghost" onClick={() => onDelete(ev)} aria-label={`Delete ${ev.title}`}>×</button>
      </li>
    )
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Events &amp; deadlines</h2>
        <span className="head-meta">
          {items.length > 0 && <span className="count">{upcoming.length} upcoming</span>}
          {!full && items.length > 0 && <Link to="/events" className="link small">View all →</Link>}
        </span>
      </div>

      {loading && <Skeleton rows={2} />}

      {!loading && items.length === 0 && (
        <EmptyState
          title="Nothing scheduled"
          hint="Club meetings, career fairs, and application deadlines you don't want to miss."
        />
      )}

      {/* Card: what's coming, capped. Page: coming and gone, in their own sections —
          the attended checkbox on a past event is how the weekly review gets its count. */}
      {full ? (
        <>
          {upcoming.length > 0 && (
            <>
              <h3 className="group-head">Upcoming <span className="count">{upcoming.length}</span></h3>
              <ul className="rows">{upcoming.map(row)}</ul>
            </>
          )}
          {past.length > 0 && (
            <>
              <h3 className="group-head">Past <span className="count">{past.length}</span></h3>
              <ul className="rows">{past.map(row)}</ul>
            </>
          )}
        </>
      ) : (
        shown.length > 0 && <ul className="rows">{shown.map(row)}</ul>
      )}

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="title" placeholder="Title — e.g. ACM general meeting" required autoFocus maxLength={160} aria-label="Event title" />
          <div className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} aria-label="Event kind">
              {KINDS.map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}
            </select>
            <input
              name="starts_at"
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              aria-label="Starts at"
            />
          </div>
          {/* 'Other' asks what it actually is rather than filing it under nothing. */}
          {kind === 'other' && (
            <input name="kind_label" placeholder="What kind? — e.g. Hackathon" required maxLength={40} aria-label="Kind of event" />
          )}
          <div className="row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={multiDay}
                onChange={(e) => setMultiDay(e.target.checked)}
              />
              Runs more than one day
            </label>
            {multiDay && (
              <input name="ends_at" type="date" required min={startsAt.slice(0, 10)} aria-label="Last day" />
            )}
          </div>
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={close}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>Add event</button>
      )}
    </section>
  )
}
