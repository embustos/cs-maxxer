import { useState } from 'react'
import { api } from '../api'

const STAGES = ['applied', 'oa', 'interview', 'offer', 'rejected', 'ghosted']
const LABELS = {
  applied: 'Applied', oa: 'OA', interview: 'Interview',
  offer: 'Offer', rejected: 'Rejected', ghosted: 'Ghosted',
}

export default function Applications({ items, reload, onError }) {
  const [adding, setAdding] = useState(false)

  async function add(e) {
    e.preventDefault()
    const f = e.target
    try {
      await api('/applications', {
        method: 'POST',
        body: { company: f.company.value, role: f.role.value },
      })
      f.reset()
      setAdding(false)
      reload()
    } catch (err) { onError(err.message) }
  }

  async function setStage(app, stage) {
    try {
      await api(`/applications/${app.id}`, { method: 'PATCH', body: { stage } })
      reload()
    } catch (err) { onError(err.message) }
  }

  async function remove(id) {
    try {
      await api(`/applications/${id}`, { method: 'DELETE' })
      reload()
    } catch (err) { onError(err.message) }
  }

  const active = items.filter((a) => !['rejected', 'ghosted'].includes(a.stage))

  return (
    <section className="card">
      <div className="card-head">
        <h2>Applications</h2>
        <span className="count">{active.length} active / {items.length} total</span>
      </div>

      {items.length === 0 && <p className="muted">No applications yet.</p>}

      <ul className="rows">
        {items.map((a) => (
          <li key={a.id}>
            <div className="grow">
              <span className="title">{a.company}</span>
              <span className="sub">{a.role}</span>
            </div>
            <select value={a.stage} onChange={(e) => setStage(a, e.target.value)} className={`stage ${a.stage}`}>
              {STAGES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
            </select>
            <button className="ghost" onClick={() => remove(a.id)} aria-label={`Delete ${a.company}`}>×</button>
          </li>
        ))}
      </ul>

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="company" placeholder="Company" required autoFocus maxLength={120} />
          <input name="role" placeholder="Role — e.g. SWE Intern Summer 2027" required maxLength={120} />
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>+ Add application</button>
      )}
    </section>
  )
}
