import { useState } from 'react'
import { api } from '../api'

const KINDS = ['club', 'career_fair', 'conference', 'networking', 'deadline', 'other']
const LABELS = {
  club: 'Club', career_fair: 'Career fair', conference: 'Conference',
  networking: 'Networking', deadline: 'Deadline', other: 'Other',
}

const when = (iso) => {
  const d = new Date(iso)
  const days = Math.round((d - new Date().setHours(0, 0, 0, 0)) / 86400000)
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (days < 0) return { date, rel: `${-days}d ago`, past: true }
  return { date, rel: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`, past: false }
}

export default function Events({ items, reload, onError }) {
  const [adding, setAdding] = useState(false)

  async function add(e) {
    e.preventDefault()
    const f = e.target
    try {
      // datetime-local gives "2026-09-01T18:00" with no timezone. new Date() reads it as
      // local time, and toISOString converts to the UTC the API expects.
      await api('/events', {
        method: 'POST',
        body: {
          title: f.title.value,
          kind: f.kind.value,
          starts_at: new Date(f.starts_at.value).toISOString(),
        },
      })
      f.reset()
      setAdding(false)
      reload()
    } catch (err) { onError(err.message) }
  }

  async function toggleAttended(ev) {
    try {
      await api(`/events/${ev.id}`, { method: 'PATCH', body: { attended: !ev.attended } })
      reload()
    } catch (err) { onError(err.message) }
  }

  async function remove(id) {
    try {
      await api(`/events/${id}`, { method: 'DELETE' })
      reload()
    } catch (err) { onError(err.message) }
  }

  const upcoming = items.filter((e) => !when(e.starts_at).past)

  return (
    <section className="card">
      <div className="card-head">
        <h2>Events &amp; deadlines</h2>
        <span className="count">{upcoming.length} upcoming</span>
      </div>

      {items.length === 0 && <p className="muted">Nothing scheduled.</p>}

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
              <button className="ghost" onClick={() => remove(ev.id)} aria-label={`Delete ${ev.title}`}>×</button>
            </li>
          )
        })}
      </ul>

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="title" placeholder="Title — e.g. ACM general meeting" required autoFocus maxLength={160} />
          <div className="row">
            <select name="kind" defaultValue="club">
              {KINDS.map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}
            </select>
            <input name="starts_at" type="datetime-local" required />
          </div>
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>+ Add event</button>
      )}
    </section>
  )
}
