import { useState } from 'react'
import { api } from '../api'

export default function Goals({ items, reload, onError }) {
  const [adding, setAdding] = useState(false)

  async function add(e) {
    e.preventDefault()
    const f = e.target
    try {
      await api('/goals', {
        method: 'POST',
        body: { title: f.title.value, target: f.target.value, due_on: f.due_on.value || null },
      })
      f.reset()
      setAdding(false)
      reload()
    } catch (err) { onError(err.message) }
  }

  async function bump(goal, delta) {
    const next = Math.max(0, goal.current + delta)
    try {
      await api(`/goals/${goal.id}`, { method: 'PATCH', body: { current: next } })
      reload()
    } catch (err) { onError(err.message) }
  }

  async function remove(id) {
    try {
      await api(`/goals/${id}`, { method: 'DELETE' })
      reload()
    } catch (err) { onError(err.message) }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Goals</h2>
        <span className="count">{items.filter((g) => g.current >= g.target).length} hit</span>
      </div>

      {items.length === 0 && <p className="muted">No goals set.</p>}

      <ul className="rows">
        {items.map((g) => {
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
                <progress value={g.current} max={g.target} />
              </div>
              <div className="meta">
                <button className="tiny" onClick={() => bump(g, -1)} aria-label="Decrease">−</button>
                <button className="tiny" onClick={() => bump(g, 1)} aria-label="Increase">+</button>
                <span className="pct">{pct}%</span>
                <button className="ghost" onClick={() => remove(g.id)} aria-label={`Delete ${g.title}`}>×</button>
              </div>
            </li>
          )
        })}
      </ul>

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="title" placeholder="Goal — e.g. 100 LeetCode problems" required autoFocus maxLength={160} />
          <div className="row">
            <input name="target" type="number" min="1" placeholder="Target" required />
            <input name="due_on" type="date" />
          </div>
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>+ Add goal</button>
      )}
    </section>
  )
}
