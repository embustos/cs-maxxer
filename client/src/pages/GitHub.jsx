import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

export default function GitHub({ onError }) {
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)

  const load = useCallback(
    () => api('/github/activity').then(setData).catch((e) => onError(e.message)),
    [onError],
  )
  useEffect(() => { load() }, [load])

  async function save(e) {
    e.preventDefault()
    try {
      await api('/github/username', { method: 'PUT', body: { username: e.target.username.value } })
      setEditing(false)
      setData(null)
      load()
    } catch (err) { onError(err.message) }
  }

  async function disconnect() {
    try {
      await api('/github/username', { method: 'DELETE' })
      setData({ connected: false })
    } catch (err) { onError(err.message) }
  }

  if (data === null) return <section className="card"><p className="muted">Loading GitHub…</p></section>

  if (!data.connected || editing) {
    return (
      <section className="card">
        <div className="card-head"><h2>GitHub</h2></div>
        <p className="muted">Connect your account to track side-project commits.</p>
        <form className="add" onSubmit={save}>
          <input name="username" placeholder="github username" required autoFocus={editing} />
          <button>Connect</button>
        </form>
      </section>
    )
  }

  // The upstream failed but we had a cached copy — show the number AND say it's stale,
  // rather than an error page or a silent lie.
  const days = Object.entries(data.by_day ?? {}).sort()

  return (
    <section className="card">
      <div className="card-head">
        <h2>GitHub</h2>
        <span className="count">
          @{data.username}
          {data.stale && ' · stale'}
          {data.cached && !data.stale && ' · cached'}
        </span>
      </div>

      <div className="stats">
        <div><strong>{data.total}</strong><span>pushes</span></div>
        <div><strong>{data.days_active}</strong><span>active days</span></div>
        <div>
          <strong>{data.last_commit_on ? new Date(data.last_commit_on + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</strong>
          <span>last push</span>
        </div>
      </div>

      {days.length > 0 && (
        <div className="spark" aria-label="Recent push activity by day">
          {days.map(([day, n]) => (
            <span key={day} title={`${day}: ${n}`} style={{ height: `${Math.min(100, n * 12)}%` }} />
          ))}
        </div>
      )}

      {data.stale && <p className="muted small">Showing cached data — {data.error}</p>}

      <div className="row end">
        <button className="secondary" onClick={() => setEditing(true)}>Change</button>
        <button className="secondary" onClick={disconnect}>Disconnect</button>
      </div>
    </section>
  )
}
