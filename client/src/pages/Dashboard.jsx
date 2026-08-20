import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import Applications from './Applications'
import Events from './Events'
import Goals from './Goals'
import GitHub from './GitHub'

// The browser's local date as YYYY-MM-DD. toISOString() would give UTC, which is a
// different day for most of the world for part of every day.
// ponytail: 'en-CA' formats as YYYY-MM-DD. Reach for date-fns when we need real math.
const today = () => new Date().toLocaleDateString('en-CA')

export default function Dashboard({ user, onLogout }) {
  const [data, setData] = useState({ habits: null, applications: [], events: [], goals: [] })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      // Four independent requests — fire them together rather than awaiting in sequence.
      const [habits, applications, events, goals] = await Promise.all([
        api(`/habits?today=${today()}`),
        api('/applications'),
        api('/events'),
        api('/goals'),
      ])
      setData({
        habits: habits.habits,
        applications: applications.applications,
        events: events.events,
        goals: goals.goals,
      })
    } catch (err) {
      setError(err.message)
    }
  }, [])

  // Fetch-on-mount. The lint rule below guards against *synchronous* setState in an
  // effect causing cascading renders; ours happens after an await, so it doesn't apply.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function toggle(habit) {
    const url = `/habits/${habit.id}/completions/${today()}`
    // Optimistic: flip it now so the checkbox feels instant, then confirm with the
    // server. If the request fails we reload and the truth wins.
    setData((d) => ({
      ...d,
      habits: d.habits.map((h) => (h.id === habit.id ? { ...h, done_today: !h.done_today } : h)),
    }))
    try {
      await api(url, { method: habit.done_today ? 'DELETE' : 'PUT' })
      load() // refresh so the streak recomputes server-side
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  async function addHabit(e) {
    e.preventDefault()
    const title = e.target.title.value.trim()
    if (!title) return
    try {
      await api('/habits', { method: 'POST', body: { title } })
      e.target.reset()
      load()
    } catch (err) { setError(err.message) }
  }

  async function removeHabit(id) {
    try {
      await api(`/habits/${id}`, { method: 'DELETE' })
      load()
    } catch (err) { setError(err.message) }
  }

  const { habits, applications, events, goals } = data
  const done = habits?.filter((h) => h.done_today).length ?? 0

  const upcoming = events
    .filter((e) => new Date(e.starts_at) >= new Date(new Date().setHours(0, 0, 0, 0)))
    .slice(0, 3)

  return (
    <div className="dashboard">
      <header>
        <div>
          <h1>Today</h1>
          <p className="tagline">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="who">
          <span>{user.email}</span>
          <button className="secondary" onClick={onLogout}>Log out</button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error} <button className="ghost inline" onClick={() => setError('')}>dismiss</button>
        </p>
      )}

      {(habits?.some((h) => !h.done_today) || upcoming.length > 0) && (
        <div className="summary">
          {habits?.filter((h) => !h.done_today).length > 0 && (
            <span>{habits.filter((h) => !h.done_today).length} habit(s) left today</span>
          )}
          {upcoming.map((e) => (
            <span key={e.id}>
              {e.title} · {new Date(e.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          ))}
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Habits</h2>
          {habits?.length > 0 && <span className="count">{done} of {habits.length} done</span>}
        </div>

        {habits === null && <p className="muted">Loading…</p>}
        {habits?.length === 0 && (
          <p className="muted">
            Nothing yet. Add what you want to stay consistent at — LeetCode, commits,
            reaching out to people.
          </p>
        )}

        <ul className="rows habits">
          {habits?.map((habit) => (
            <li key={habit.id} className={habit.done_today ? 'done' : ''}>
              <label className="grow">
                <input type="checkbox" checked={habit.done_today} onChange={() => toggle(habit)} />
                <span>
                  <span className="title">{habit.title}</span>
                  <span className="sub">{habit.last_7_days}/7 this week</span>
                </span>
              </label>
              <div className="meta">
                {habit.streak > 0 && <span className="streak" title="day streak">{habit.streak}🔥</span>}
                <button className="ghost" onClick={() => removeHabit(habit.id)} aria-label={`Delete ${habit.title}`}>×</button>
              </div>
            </li>
          ))}
        </ul>

        <form className="add" onSubmit={addHabit}>
          <input name="title" placeholder="Add a habit — e.g. LeetCode daily" maxLength={120} />
          <button>Add</button>
        </form>
      </section>

      <GitHub onError={setError} />
      <Applications items={applications} reload={load} onError={setError} />
      <Events items={events} reload={load} onError={setError} />
      <Goals items={goals} reload={load} onError={setError} />
    </div>
  )
}
