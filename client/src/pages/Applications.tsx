import { useState } from 'react'
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

export default function Applications({ items, loading, reload, onError, onToast, onDelete }: CardProps<Application>) {
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

  return (
    <section className="card">
      <div className="card-head">
        <h2>Applications</h2>
        {items.length > 0 && (
          <span className="count">{active.length} active / {items.length} total</span>
        )}
      </div>

      {loading && <Skeleton rows={2} />}

      {!loading && items.length === 0 && (
        <EmptyState
          title="No applications tracked"
          hint="Add the roles you've applied to so you can see where each one stands."
        />
      )}

      {items.length > 0 && (
        <ul className="rows">
          {items.map((a) => (
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
          ))}
        </ul>
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
