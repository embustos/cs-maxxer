import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const STAGES = ['applied', 'oa', 'interview', 'offer', 'rejected', 'ghosted'] as const
const LABELS: Record<ApplicationStage, string> = {
  applied: 'Applied', oa: 'OA', interview: 'Interview',
  offer: 'Offer', rejected: 'Rejected', ghosted: 'Ghosted',
}

import type { Application, ApplicationStage, CardProps } from '@/types'
import { errorMessage } from '@/lib/utils'

const isStage = (v: string): v is ApplicationStage => (STAGES as readonly string[]).includes(v)

export default function Applications({ items, loading, full = false, reload, onError, onToast, onDelete }: CardProps<Application>) {
  const [adding, setAdding] = useState(false)

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const company = (f.elements.namedItem('company') as HTMLInputElement).value
    try {
      await api('/applications', { method: 'POST', body: { company, role: (f.elements.namedItem('role') as HTMLInputElement).value } })
      f.reset()
      setAdding(false)
      reload()
      onToast(`Added ${company}`)
    } catch (err) { onError(errorMessage(err)) }
  }

  async function setStage(app: Application, stage: string) {
    if (!isStage(stage)) return
    try {
      await api(`/applications/${app.id}`, { method: 'PATCH', body: { stage } })
      reload()
      onToast(`${app.company} → ${LABELS[stage]}`)
    } catch (err) { onError(errorMessage(err)) }
  }

  const active = items.filter((a) => !['rejected', 'ghosted'].includes(a.stage))
  // The card is a working surface, not an archive: live applications only, capped so
  // six rejections can't bury the one offer. The page shows the whole history.
  const shown = full ? items : active.slice(0, 6)

  const row = (a: Application) => (
    <li key={a.id}>
      <div className="grow">
        <span className="title">{a.company}</span>
        <span className="sub">{a.role}</span>
      </div>
      <select
        value={a.stage}
        onChange={(e) => setStage(a, e.target.value)}
        className={`stage ${a.stage}`}
        aria-label={`Stage for ${a.company}`}
      >
        {STAGES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
      </select>
      <button className="ghost" onClick={() => onDelete(a)} aria-label={`Delete ${a.company}`}>×</button>
    </li>
  )

  return (
    <section className="card">
      <div className="card-head">
        <h2>Applications</h2>
        <span className="head-meta">
          {items.length > 0 && (
            <span className="count">{active.length} active / {items.length} total</span>
          )}
          {!full && items.length > 0 && <Link to="/applications" className="link small">View all →</Link>}
        </span>
      </div>

      {loading && <Skeleton rows={2} />}

      {!loading && items.length === 0 && (
        <EmptyState
          title="No applications tracked"
          hint="Add the roles you've applied to so you can see where each one stands."
        />
      )}

      {/* Page: grouped by stage in pipeline order, closed stages included — the point
          of the page is the full record. Card: the active slice, flat. */}
      {full
        ? STAGES.map((stage) => {
            const group = items.filter((a) => a.stage === stage)
            if (group.length === 0) return null
            return (
              <div key={stage}>
                <h3 className="group-head">
                  {LABELS[stage]} <span className="count">{group.length}</span>
                </h3>
                <ul className="rows">{group.map(row)}</ul>
              </div>
            )
          })
        : shown.length > 0 && <ul className="rows">{shown.map(row)}</ul>}
      {!full && active.length > shown.length && (
        <p className="muted small">
          <Link to="/applications" className="link">+{active.length - shown.length} more active</Link>
        </p>
      )}

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="company" placeholder="Company" required autoFocus maxLength={120} aria-label="Company" />
          <input name="role" placeholder="Role — e.g. SWE Intern Summer 2027" required maxLength={120} aria-label="Role" />
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>Add application</button>
      )}
    </section>
  )
}
