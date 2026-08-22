import { Link } from 'react-router-dom'
import type { Habit } from '@/types'
import StreakChain from '../components/StreakChain'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const STARTER_HABITS = ['LeetCode daily', 'Commit to a side project', 'Message 2 connections']

// Extracted from Dashboard when habits earned a page of their own. State stays with the
// parent — toggling recomputes streaks server-side, so the handlers are the dashboard's
// load-refreshing ones, passed down.
export default function Habits({
  items,
  full = false,
  onToggle,
  onAdd,
  onDelete,
}: {
  items: Habit[] | null
  full?: boolean
  onToggle: (habit: Habit) => void
  onAdd: (title: string) => void
  onDelete: (habit: Habit) => void
}) {
  const done = items?.filter((h) => h.done_today).length ?? 0

  return (
    <section className="card">
      <div className="card-head">
        <h2>Habits</h2>
        <span className="head-meta">
          {items && items.length > 0 && <span className="count">{done} of {items.length} done</span>}
          {!full && items && items.length > 0 && (
            <Link to="/habits" className="link small">View all →</Link>
          )}
        </span>
      </div>

      {items === null && <Skeleton rows={3} />}

      {items?.length === 0 && (
        <EmptyState
          title="Nothing tracked yet"
          hint="Pick one to start, or write your own below."
          suggestions={STARTER_HABITS}
          onPick={onAdd}
        />
      )}

      {items && items.length > 0 && (
        <ul className="rows">
          {items.map((habit) => (
            <li key={habit.id} className={habit.done_today ? 'done' : ''}>
              <label className="grow">
                <input type="checkbox" checked={habit.done_today} onChange={() => onToggle(habit)} />
                <span>
                  <span className="title">{habit.title}</span>
                  <span className="sub">
                    <StreakChain chain={habit.chain} />
                    {habit.last_7_days}/7 this week
                    {full && ` · ${habit.cadence === 'daily' ? 'daily' : `${habit.target_per_week}×/week`}`}
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
                  onClick={() => onDelete(habit)}
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
          onAdd((e.currentTarget.elements.namedItem('title') as HTMLInputElement).value)
          ;(e.target as HTMLFormElement).reset()
        }}
      >
        <input name="title" placeholder="Add a habit" maxLength={120} aria-label="New habit" />
        <button>Add</button>
      </form>
    </section>
  )
}
