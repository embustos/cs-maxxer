import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

import type { Goal, CardProps } from '@/types'
import { errorMessage } from '@/lib/utils'

export default function Goals({ items, loading, full = false, reload, onError, onToast, onDelete }: CardProps<Goal>) {
  const [adding, setAdding] = useState(false)

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const el = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value
    const title = el('title')
    try {
      await api('/goals', {
        method: 'POST',
        body: { title, target: el('target'), due_on: el('due_on') || null },
      })
      f.reset()
      setAdding(false)
      reload()
      onToast(`Added ${title}`)
    } catch (err) { onError(errorMessage(err)) }
  }

  async function bump(goal: Goal, delta: number) {
    const next = Math.max(0, goal.current + delta)
    try {
      await api(`/goals/${goal.id}`, { method: 'PATCH', body: { current: next } })
      reload()
      if (next >= goal.target && goal.current < goal.target) onToast(`${goal.title} — goal reached`)
    } catch (err) { onError(errorMessage(err)) }
  }

  const inProgress = items.filter((g) => g.current < g.target)
  const reached = items.filter((g) => g.current >= g.target)
  const shown = full ? items : inProgress.slice(0, 6)

  const row = (g: Goal) => {
    const pct = Math.min(100, Math.round((g.current / g.target) * 100))
    return (
      <li key={g.id} className="goal">
        <div className="grow">
          <div className="goal-head">
            <span className="title">{g.title}</span>
            <span className="sub">
              {g.current}/{g.target}
              {g.due_on && ` · by ${new Date(g.due_on + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
            </span>
          </div>
          {/* ponytail: native <progress>, no chart library */}
          <progress value={g.current} max={g.target} aria-label={`${pct}% of ${g.title}`} />
        </div>
        <div className="meta">
          <button className="tiny" onClick={() => bump(g, -1)} aria-label={`Decrease ${g.title}`}>−</button>
          <button className="tiny" onClick={() => bump(g, 1)} aria-label={`Increase ${g.title}`}>+</button>
          <span className="pct">{pct}%</span>
          <button className="ghost" onClick={() => onDelete(g)} aria-label={`Delete ${g.title}`}>×</button>
        </div>
      </li>
    )
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Goals</h2>
        <span className="head-meta">
          {items.length > 0 && <span className="count">{reached.length} reached</span>}
          {!full && items.length > 0 && <Link to="/goals" className="link small">View all →</Link>}
        </span>
      </div>

      {loading && <Skeleton rows={2} />}

      {!loading && items.length === 0 && (
        <EmptyState
          title="No goals set"
          hint="Give yourself a number and a deadline — e.g. 100 LeetCode problems by May."
        />
      )}

      {/* Card: what's still being chased. Page: those plus the trophy shelf. */}
      {full ? (
        <>
          {inProgress.length > 0 && (
            <>
              <h3 className="group-head">In progress <span className="count">{inProgress.length}</span></h3>
              <ul className="rows">{inProgress.map(row)}</ul>
            </>
          )}
          {reached.length > 0 && (
            <>
              <h3 className="group-head">Reached <span className="count">{reached.length}</span></h3>
              <ul className="rows">{reached.map(row)}</ul>
            </>
          )}
        </>
      ) : (
        shown.length > 0 && <ul className="rows">{shown.map(row)}</ul>
      )}
      {!full && inProgress.length > shown.length && (
        <p className="muted small">
          <Link to="/goals" className="link">+{inProgress.length - shown.length} more in progress</Link>
        </p>
      )}

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="title" placeholder="Goal — e.g. 100 LeetCode problems" required autoFocus maxLength={160} aria-label="Goal" />
          <div className="row">
            <input name="target" type="number" min="1" placeholder="Target" required aria-label="Target number" />
            <input name="due_on" type="date" aria-label="Due date" />
          </div>
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>Add goal</button>
      )}
    </section>
  )
}
