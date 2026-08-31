import { useState, useEffect, useCallback } from 'react'
import type { GitHubActivity } from '@/types'
import { api } from '../api'
import ContributionGraph from '../components/ContributionGraph'
import CommitMeter from '../components/CommitMeter'
import Skeleton from '../components/Skeleton'
import { errorMessage, timeAgo } from '@/lib/utils'

const today = () => new Date().toLocaleDateString('en-CA')

interface GitHubProps {
  onError: (message: string) => void
  onToast: (message: string) => void
}

export default function GitHub({ onError, onToast }: GitHubProps) {
  const [data, setData] = useState<GitHubActivity | null>(null)
  const [editing, setEditing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(
    (force = false) =>
      api<GitHubActivity>(`/github/activity?today=${today()}${force ? '&refresh=1' : ''}`)
        .then(setData)
        .catch((e) => onError(errorMessage(e))),
    [onError],
  )
  useEffect(() => { load() }, [load])

  // Deliberately does NOT clear `data` first: the graph stays on screen while the new copy
  // is on its way, instead of collapsing into a skeleton and back.
  const refresh = async () => {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    try {
      await api('/github/username', { method: 'PUT', body: { username: (e.currentTarget.elements.namedItem('username') as HTMLInputElement).value } })
      setEditing(false)
      setData(null)
      await load()
      onToast('GitHub connected')
    } catch (err) { onError(errorMessage(err)) }
  }

  const disconnect = async () => {
    try {
      await api('/github/username', { method: 'DELETE' })
      setData({ connected: false, daily_commit_goal: null })
      onToast('GitHub disconnected')
    } catch (err) { onError(errorMessage(err)) }
  }

  const setGoal = async (goal: number) => {
    try {
      await api('/github/goal', { method: 'PUT', body: { goal } })
      await load()
      onToast(`Daily goal set to ${goal}`)
    } catch (err) { onError(errorMessage(err)) }
  }

  const clearGoal = async () => {
    try {
      await api('/github/goal', { method: 'DELETE' })
      await load()
      onToast('Daily goal cleared')
    } catch (err) { onError(errorMessage(err)) }
  }

  if (data === null) {
    return (
      <section className="card span-all">
        <div className="card-head"><h2>GitHub</h2></div>
        <Skeleton rows={2} />
      </section>
    )
  }

  if (!data.connected || editing) {
    return (
      <section className="card span-all">
        <div className="card-head"><h2>GitHub</h2></div>
        <p className="muted small">
          Connect your account to see your contribution graph and track a daily commit goal.
        </p>
        <form className="add" onSubmit={save}>
          <input name="username" placeholder="github username" required autoFocus={editing} aria-label="GitHub username" />
          <button>Connect</button>
        </form>
        {editing && (
          <button className="secondary small-btn mt" onClick={() => setEditing(false)}>Cancel</button>
        )}
      </section>
    )
  }

  return (
    <section className="card span-all">
      <div className="card-head">
        <h2>GitHub</h2>
        <span className="count">
          @{data.username}
          {data.stale ? ' · showing cached data' : data.fetched_at && ` · updated ${timeAgo(data.fetched_at)}`}
        </span>
      </div>

      {data.stale && <p className="muted small">Could not reach GitHub — {data.error}</p>}

      <div className="gh-body">
        <ContributionGraph days={data.days} total={data.total} source={data.source} />
        <CommitMeter
          count={data.today_count ?? 0}
          goal={data.daily_commit_goal}
          onSetGoal={setGoal}
          onClearGoal={clearGoal}
        />
      </div>

      <div className="row end">
        <button className="secondary small-btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : '⟳ Refresh'}
        </button>
        <button className="secondary small-btn" onClick={() => setEditing(true)}>Change account</button>
        {/* Disconnect throws the account away. It sat here styled exactly like Refresh,
            which makes the destructive option as easy to hit by accident as the routine
            one. Quieter treatment, and it turns danger-coloured on hover/focus so what
            it does is obvious the moment you go near it — not one pixel sooner. */}
        <button className="link dim danger-hover" onClick={disconnect}>Disconnect</button>
      </div>
    </section>
  )
}
