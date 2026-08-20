import { useState } from 'react'
import { api } from '../api'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const KINDS = ['club', 'career_fair', 'conference', 'networking', 'deadline', 'other'] as const
const LABELS: Record<EventKind, string> = {
  club: 'Club', career_fair: 'Career fair', conference: 'Conference',
  networking: 'Networking', deadline: 'Deadline', other: 'Other',
}

const when = (iso: string) => {
  const d = new Date(iso)
  const days = Math.round((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (days < 0) return { date, rel: `${-days}d ago`, past: true }
  return { date, rel: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`, past: false }
}

import type { CalendarEvent, EventKind, CardProps } from '@/types'
import { errorMessage } from '@/lib/utils'

export default function Events({ items, loading, reload, onError, onToast, onDelete }: CardProps<CalendarEvent>) {
  const [adding, setAdding] = useState(false)

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const el = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value
    const title = el('title')
    try {
      // datetime-local gives "2026-09-01T18:00" with no timezone. new Date() reads it as
      // local time, and toISOString converts to the UTC the API expects.
      await api('/events', {
        method: 'POST',
        body: { title, kind: el('kind'), starts_at: new Date(el('starts_at')).toISOString() },
      })
      f.reset()
      setAdding(false)
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

  const upcoming = items.filter((e) => !when(e.starts_at).past)

  return (
    <section className="card">
      <div className="card-head">
        <h2>Events &amp; deadlines</h2>
        {items.length > 0 && <span className="count">{upcoming.length} upcoming</span>}
      </div>

      {loading && <Skeleton rows={2} />}

      {!loading && items.length === 0 && (
        <EmptyState
          title="Nothing scheduled"
          hint="Club meetings, career fairs, and application deadlines you don't want to miss."
        />
      )}

      {items.length > 0 && (
        <ul className="rows">
          {items.map((ev) => {
            const w = when(ev.starts_at)
            return (
              <li key={ev.id} className={w.past ? 'past' : ''}>
                <label className="grow">
                  <input type="checkbox" checked={ev.attended} onChange={() => toggleAttended(ev)} />
                  <span>
                    <span className="title">{ev.title}</span>
                    <span className="sub">{LABELS[ev.kind]} · {w.date}</span>
                  </span>
                </label>
                <span className={`badge ${w.past ? '' : 'soon'}`}>{w.rel}</span>
                <button className="ghost" onClick={() => onDelete(ev)} aria-label={`Delete ${ev.title}`}>×</button>
              </li>
            )
          })}
        </ul>
      )}

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="title" placeholder="Title — e.g. ACM general meeting" required autoFocus maxLength={160} aria-label="Event title" />
          <div className="row">
            <select name="kind" defaultValue="club" aria-label="Event kind">
              {KINDS.map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}
            </select>
            <input name="starts_at" type="datetime-local" required aria-label="Starts at" />
          </div>
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>Add event</button>
      )}
    </section>
  )
}
