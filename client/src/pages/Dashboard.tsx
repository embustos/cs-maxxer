import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  User, Habit, Application, CalendarEvent, Goal, Connection,
  InterviewAnswer, WeeklyReviewData, Toast as ToastData,
} from '@/types'

interface DashboardData {
  habits: Habit[] | null
  applications: Application[]
  events: CalendarEvent[]
  goals: Goal[]
  connections: Connection[]
  interviews: InterviewAnswer[]
  weekly: WeeklyReviewData | null
}

// Every list the dashboard holds, keyed by the state field it lives under.
type ListKey = 'habits' | 'applications' | 'events' | 'goals' | 'connections' | 'interviews'

import { api } from '../api'
import { useUndoableDelete } from '../useUndoableDelete'
import Applications from './Applications'
import Events from './Events'
import Goals from './Goals'
import GitHub from './GitHub'
import Connections from './Connections'
import ResumeReview from './ResumeReview'
import InterviewPrep from './InterviewPrep'
import WeeklyReview from '../components/WeeklyReview'
import { NeonMesh } from '@/components/ui/neon-mesh'
import StreakChain from '../components/StreakChain'
import Toast from '../components/Toast'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { errorMessage } from '@/lib/utils'

// The browser's local date as YYYY-MM-DD. toISOString() would give UTC, which is a
// different day for most of the world for part of every day.
// ponytail: 'en-CA' formats as YYYY-MM-DD. Reach for date-fns when we need real math.
const today = () => new Date().toLocaleDateString('en-CA')

const STARTER_HABITS = ['LeetCode daily', 'Commit to a side project', 'Message 2 connections']

export default function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [data, setData] = useState<DashboardData>({
    habits: null, applications: [], events: [], goals: [],
    connections: [], interviews: [], weekly: null,
  })
  const [error, setError] = useState('')
  const [toast, setToast] = useState<ToastData | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const showToast = useCallback((message: string, onUndo: (() => void) | null = null) => {
    clearTimeout(toastTimer.current)
    setToast({ message, onUndo })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }, [])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const load = useCallback(async () => {
    try {
      // Four independent requests — fire them together rather than awaiting in sequence.
      const [habits, applications, events, goals, connections, interviews, weekly] = await Promise.all([
        api<{ habits: Habit[] }>(`/habits?today=${today()}`),
        api<{ applications: Application[] }>('/applications'),
        api<{ events: CalendarEvent[] }>('/events'),
        api<{ goals: Goal[] }>('/goals'),
        api<{ connections: Connection[] }>('/connections'),
        api<{ interview_answers: InterviewAnswer[] }>('/interview-answers'),
        api<WeeklyReviewData>(`/review/weekly?today=${today()}`),
      ])
      setData({
        habits: habits.habits,
        applications: applications.applications,
        events: events.events,
        goals: goals.goals,
        connections: connections.connections,
        interviews: interviews.interview_answers,
        weekly,
      })
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const hideRow = useCallback((key: string) => {
    const [kind, id] = key.split(':') as [ListKey, string]
    setData((d) => ({ ...d, [kind]: (d[kind] ?? []).filter((x: { id: number }) => String(x.id) !== id) }))
  }, [])

  const { remove, isPending } = useUndoableDelete({
    onCommit: hideRow,
    onToast: showToast,
    reload: load,
  })

  // A reload can resurrect a row whose delete is still pending — filter those out.
  function visible<K extends ListKey>(kind: K): NonNullable<DashboardData[K]> {
    const list = (data[kind] ?? []) as NonNullable<DashboardData[K]>
    return list.filter((x: { id: number }) => !isPending(`${kind}:${x.id}`)) as NonNullable<DashboardData[K]>
  }

  // The state key and the API path differ for one resource, so the path is explicit.
  const API_PATH: Partial<Record<ListKey, string>> = { interviews: 'interview-answers' }
  const deleteRow = (kind: ListKey, item: { id: number }, label: string) =>
    remove(`${kind}:${item.id}`, label, () =>
      api(`/${API_PATH[kind] ?? kind}/${item.id}`, { method: 'DELETE' }))

  async function toggle(habit: Habit) {
    const url = `/habits/${habit.id}/completions/${today()}`
    // Optimistic: flip it now so the checkbox feels instant, then confirm with the
    // server. If the request fails we reload and the truth wins.
    setData((d) => ({
      ...d,
      habits: (d.habits ?? []).map((h) => (h.id === habit.id ? { ...h, done_today: !h.done_today } : h)),
    }))
    try {
      await api(url, { method: habit.done_today ? 'DELETE' : 'PUT' })
      load() // refresh so the streak recomputes server-side
    } catch (err) {
      setError(errorMessage(err))
      load()
    }
  }

  const addHabit = async (title: string) => {
    if (!title.trim()) return
    try {
      await api('/habits', { method: 'POST', body: { title: title.trim() } })
      load()
      showToast(`Added ${title.trim()}`)
    } catch (err) { setError(errorMessage(err)) }
  }

  const habits = data.habits
  const done = habits?.filter((h) => h.done_today).length ?? 0
  const events = visible('events')
  const upcoming = events
    .filter((e) => new Date(e.starts_at) >= new Date(new Date().setHours(0, 0, 0, 0)))
    .slice(0, 3)
  const remaining = habits?.filter((h) => !h.done_today).length ?? 0

  return (
    <div className="dashboard">
      <header className="masthead">
        <NeonMesh variant="ambient" className="masthead-mesh" aria-hidden="true">
          <span />
        </NeonMesh>
        <div className="masthead-content">
          <h1>Today</h1>
          <p className="tagline">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="who masthead-content">
          <span className="muted small">{user.email}</span>
          <button className="secondary small-btn" onClick={onLogout}>Log out</button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
          <button className="link" onClick={() => setError('')}>Dismiss</button>
        </p>
      )}

      {(remaining > 0 || upcoming.length > 0) && (
        <div className="summary">
          {remaining > 0 && (
            <span className="chip-static">
              {remaining} habit{remaining === 1 ? '' : 's'} left today
            </span>
          )}
          {upcoming.map((e) => (
            <span key={e.id} className="chip-static">
              {e.title} · {new Date(e.starts_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          ))}
        </div>
      )}

      <div className="grid">
        <WeeklyReview data={data.weekly} />
        <GitHub onError={setError} onToast={showToast} />

        <section className="card">
          <div className="card-head">
            <h2>Habits</h2>
            {habits && habits.length > 0 && <span className="count">{done} of {habits.length} done</span>}
          </div>

          {habits === null && <Skeleton rows={3} />}

          {habits?.length === 0 && (
            <EmptyState
              title="Nothing tracked yet"
              hint="Pick one to start, or write your own below."
              suggestions={STARTER_HABITS}
              onPick={addHabit}
            />
          )}

          {habits && habits.length > 0 && (
            <ul className="rows">
              {habits.map((habit) => (
                <li key={habit.id} className={habit.done_today ? 'done' : ''}>
                  <label className="grow">
                    <input type="checkbox" checked={habit.done_today} onChange={() => toggle(habit)} />
                    <span>
                      <span className="title">{habit.title}</span>
                      <span className="sub">
                        <StreakChain chain={habit.chain} />
                        {habit.last_7_days}/7 this week
                      </span>
                    </span>
                  </label>
                  <div className="meta">
                    {habit.streak > 0 && (
                      <span className="streak" title={`${habit.streak} day streak`}>
                        {habit.streak}d
                      </span>
                    )}
                    <button
                      className="ghost"
                      onClick={() => deleteRow('habits', habit, habit.title)}
                      aria-label={`Delete ${habit.title}`}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form
            className="add"
            onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
              e.preventDefault()
              addHabit((e.currentTarget.elements.namedItem('title') as HTMLInputElement).value)
              ;(e.target as HTMLFormElement).reset()
            }}
          >
            <input name="title" placeholder="Add a habit" maxLength={120} aria-label="New habit" />
            <button>Add</button>
          </form>
        </section>

        <Applications
          items={visible('applications')}
          loading={habits === null}
          reload={load}
          onError={setError}
          onToast={showToast}
          onDelete={(a) => deleteRow('applications', a, a.company)}
        />
        <Events
          items={events}
          loading={habits === null}
          reload={load}
          onError={setError}
          onToast={showToast}
          onDelete={(e) => deleteRow('events', e, e.title)}
        />
        <Goals
          items={visible('goals')}
          loading={habits === null}
          reload={load}
          onError={setError}
          onToast={showToast}
          onDelete={(g) => deleteRow('goals', g, g.title)}
        />
        <Connections
          items={visible('connections')}
          loading={habits === null}
          reload={load}
          onError={setError}
          onToast={showToast}
          onDelete={(c) => deleteRow('connections', c, c.name)}
        />
        <InterviewPrep
          items={visible('interviews')}
          loading={habits === null}
          reload={load}
          onError={setError}
          onToast={showToast}
          onDelete={(a) => deleteRow('interviews', a, 'answer')}
          interviewing={visible('applications').filter((a) => a.stage === 'interview')}
        />
        <ResumeReview onError={setError} />
      </div>

      <Toast
        toast={toast}
        onUndo={() => { toast?.onUndo?.(); setToast(null) }}
        onDismiss={() => setToast(null)}
      />
    </div>
  )
}
