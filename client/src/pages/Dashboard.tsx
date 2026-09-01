import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import type {
  User, Habit, Application, CalendarEvent, Goal, Connection,
  InterviewAnswer, WeeklyReviewData, Toast as ToastData, BootstrapPayload } from '@/types'

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
import Habits from './Habits'
import Applications from './Applications'
import Events from './Events'
import Goals from './Goals'
import GitHub from './GitHub'
import Connections from './Connections'
import ResumeReview from './ResumeReview'
import InterviewPrep from './InterviewPrep'
import WeeklyReview from '../components/WeeklyReview'
import { NeonMesh } from '@/components/ui/neon-mesh'
import Toast from '../components/Toast'
import SideNav from '../components/SideNav'
import { LINKS } from '@/lib/nav'
import { errorMessage } from '@/lib/utils'

// The browser's local date as YYYY-MM-DD. toISOString() would give UTC, which is a
// different day for most of the world for part of every day.
// ponytail: 'en-CA' formats as YYYY-MM-DD. Reach for date-fns when we need real math.
const today = () => new Date().toLocaleDateString('en-CA')

export default function Dashboard({
  user,
  initial,
  onLogout,
}: {
  user: User
  // App already fetched this to decide whether to show the survey, so handing it down
  // means the dashboard paints on its first render instead of after another request.
  initial?: BootstrapPayload
  onLogout: () => void
}) {
  const [data, setData] = useState<DashboardData>(() =>
    initial
      ? {
          habits: initial.habits,
          applications: initial.applications,
          events: initial.events,
          goals: initial.goals,
          connections: initial.connections,
          interviews: initial.interview_answers,
          weekly: initial.weekly,
        }
      : { habits: null, applications: [], events: [], goals: [], connections: [], interviews: [], weekly: null },
  )
  const [error, setError] = useState('')
  const [toast, setToast] = useState<ToastData | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const showToast = useCallback((message: string, onUndo: (() => void) | null = null) => {
    clearTimeout(toastTimer.current)
    setToast({ message, onUndo })
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }, [])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // One request, not seven. Seven parallel fetches still queue behind the browser's
  // six-connections-per-origin cap, and each one re-pays the round trip.
  const load = useCallback(async () => {
    try {
      const b = await api<BootstrapPayload>(`/bootstrap?today=${today()}`)
      setData({
        habits: b.habits,
        applications: b.applications,
        events: b.events,
        goals: b.goals,
        connections: b.connections,
        interviews: b.interview_answers,
        weekly: b.weekly,
      })
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!initial) load() }, [load, initial])

  // Stripe Checkout lands back here with ?purchase=success|cancelled. Acknowledge and
  // strip it — left in the URL it would re-toast on every reload. Deferred a tick so the
  // toast isn't a synchronous setState inside the effect body.
  useEffect(() => {
    const purchase = new URLSearchParams(window.location.search).get('purchase')
    if (!purchase) return
    window.history.replaceState(null, '', window.location.pathname)
    if (purchase !== 'success') return
    const t = setTimeout(() => showToast('Payment received — your reviews are being credited.'), 0)
    return () => clearTimeout(t)
  }, [showToast])

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
  const events = visible('events')
  const upcoming = events
    .filter((e) => new Date(e.starts_at) >= new Date(new Date().setHours(0, 0, 0, 0)))
    .slice(0, 3)
  const remaining = habits?.filter((h) => !h.done_today).length ?? 0
  const loading = habits === null
  const { pathname } = useLocation()

  // One props object per section, spread into both the card (index route) and the full
  // page — the same live handlers either way, so a page is never a stale copy.
  const sections = {
    habits: {
      items: habits,
      onToggle: toggle,
      onAdd: addHabit,
      onDelete: (h: Habit) => deleteRow('habits', h, h.title),
    },
    applications: {
      items: visible('applications'),
      loading,
      reload: load,
      onError: setError,
      onToast: showToast,
      onDelete: (a: Application) => deleteRow('applications', a, a.company),
    },
    events: {
      items: events,
      loading,
      reload: load,
      onError: setError,
      onToast: showToast,
      onDelete: (e: CalendarEvent) => deleteRow('events', e, e.title),
    },
    goals: {
      items: visible('goals'),
      loading,
      reload: load,
      onError: setError,
      onToast: showToast,
      onDelete: (g: Goal) => deleteRow('goals', g, g.title),
    },
    connections: {
      items: visible('connections'),
      loading,
      reload: load,
      onError: setError,
      onToast: showToast,
      onDelete: (c: Connection) => deleteRow('connections', c, c.name),
    },
    interviews: {
      items: visible('interviews'),
      loading,
      reload: load,
      onError: setError,
      onToast: showToast,
      onDelete: (a: InterviewAnswer) => deleteRow('interviews', a, 'answer'),
      interviewing: visible('applications').filter((a) => a.stage === 'interview'),
    },
  }

  // A section page: the same component the card grid uses, told to show everything.
  // No "← Back to Today" any more — the sidebar is always on screen and marks where you
  // are, which is what that link was standing in for.
  const page = (el: React.ReactNode) => <div className="page">{el}</div>

  const grid = (
    <>
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
        <Habits {...sections.habits} />
        <Applications {...sections.applications} />
        <Events {...sections.events} />
        <Goals {...sections.goals} />
        <Connections {...sections.connections} />
        <InterviewPrep {...sections.interviews} />
        <ResumeReview onError={setError} user={user} />
      </div>
    </>
  )

  return (
    <div className="shell">
      <SideNav username={user.username} onLogout={onLogout} />

      <div className="shell-main">
      <header className="masthead">
        <NeonMesh variant="ambient" className="masthead-mesh" aria-hidden="true">
          <span />
        </NeonMesh>
        <div className="masthead-content">
          {/* The section you're on, not the product name — the sidebar already says
              that, and a page titled "cs maxxer" tells you nothing about where you are. */}
          <h1>{LINKS.find((l) => l.to === pathname)?.label ?? 'Today'}</h1>
          <p className="tagline">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
          <button className="link" onClick={() => setError('')}>Dismiss</button>
        </p>
      )}

      <Routes>
        <Route index element={grid} />
        <Route path="habits" element={page(<Habits {...sections.habits} full />)} />
        <Route path="applications" element={page(<Applications {...sections.applications} full />)} />
        <Route path="events" element={page(<Events {...sections.events} full />)} />
        <Route path="goals" element={page(<Goals {...sections.goals} full />)} />
        <Route path="connections" element={page(<Connections {...sections.connections} full />)} />
        <Route path="interviews" element={page(<InterviewPrep {...sections.interviews} full />)} />
        {/* Anything else is a typo'd URL — Today is always a safe landing. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      </div>

      <Toast
        toast={toast}
        onUndo={() => { toast?.onUndo?.(); setToast(null) }}
        onDismiss={() => setToast(null)}
      />
    </div>
  )
}
