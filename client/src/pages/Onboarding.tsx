import { useState } from 'react'
import type { User } from '@/types'
import { api } from '../api'
import { errorMessage } from '@/lib/utils'

// Suggestions, not a fixed menu — every one is editable and the custom field is always
// there. A survey that only offers preset answers teaches people the app is rigid.
const HABIT_IDEAS = [
  'LeetCode daily',
  'Commit to a side project',
  'Message 2 connections a week',
  'Apply to 3 internships a week',
  'Read one engineering blog post',
  'Work on my resume',
]

const GOAL_IDEAS = [
  { title: '100 LeetCode problems', target: 100 },
  { title: '40 applications this semester', target: 40 },
  { title: '20 people reached out to', target: 20 },
  { title: '5 career events attended', target: 5 },
]

const CADENCES = [
  { value: 'daily', label: 'Every day', hint: "What's due today" },
  { value: 'weekly', label: 'Once a week', hint: 'A Sunday summary' },
  { value: 'off', label: 'Never', hint: 'I’ll check in myself' },
]

export default function Onboarding({ user, onDone }: { user: User; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [habits, setHabits] = useState<Set<string>>(() => new Set(['LeetCode daily', 'Commit to a side project']))
  const [customHabit, setCustomHabit] = useState('')
  const [goals, setGoals] = useState<Map<string, number>>(() => new Map())
  const [cadence, setCadence] = useState('weekly')
  const [github, setGithub] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Functional updates, not `new Set(habits)` from the closure: two chips clicked in the
  // same tick would both start from the same stale value and the second would silently
  // overwrite the first. Selections were being dropped.
  const toggleHabit = (value: string) =>
    setHabits((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })

  const toggleGoal = (idea: { title: string; target: number }) =>
    setGoals((prev) => {
      const next = new Map(prev)
      if (next.has(idea.title)) next.delete(idea.title)
      else next.set(idea.title, idea.target)
      return next
    })

  async function finish() {
    setBusy(true)
    setError('')
    try {
      await api('/onboarding', {
        method: 'POST',
        body: {
          habits: [...habits],
          goals: [...goals].map(([title, target]) => ({ title, target })),
          reminder_cadence: cadence,
          github_username: github.trim() || null,
        },
      })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  async function skip() {
    setBusy(true)
    try {
      await api('/onboarding/skip', { method: 'POST' })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const steps = [
    {
      title: 'What do you want to stay consistent at?',
      hint: 'These become habits you check off. You can change them any time.',
      body: (
        <>
          <div className="suggestions">
            {/* Suggestions plus anything typed in, so a custom habit visibly lands
                somewhere instead of appearing to be swallowed. */}
            {[...HABIT_IDEAS, ...[...habits].filter((h) => !HABIT_IDEAS.includes(h))].map((h) => (
              <button
                key={h}
                className={`chip ${habits.has(h) ? 'on' : ''}`}
                onClick={() => toggleHabit(h)}
                aria-pressed={habits.has(h)}
              >
                {h}
              </button>
            ))}
          </div>
          <form
            className="add"
            onSubmit={(e) => {
              e.preventDefault()
              const v = customHabit.trim()
              if (v) setHabits((prev) => new Set(prev).add(v))
              setCustomHabit('')
            }}
          >
            <input
              value={customHabit}
              onChange={(e) => setCustomHabit(e.target.value)}
              placeholder="Something else"
              maxLength={120}
              aria-label="Add your own habit"
            />
            <button className="secondary">Add</button>
          </form>
        </>
      ),
    },
    {
      title: 'What are you aiming at?',
      hint: 'Goals get a progress bar. Numbers are editable later.',
      body: (
        <div className="suggestions column">
          {GOAL_IDEAS.map((g) => (
            <button
              key={g.title}
              className={`chip wide-chip ${goals.has(g.title) ? 'on' : ''}`}
              onClick={() => toggleGoal(g)}
              aria-pressed={goals.has(g.title)}
            >
              {g.title}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: 'How often should we nudge you?',
      hint: 'Used for the digest. You can turn it off later.',
      body: (
        <>
          <div className="suggestions column">
            {CADENCES.map((c) => (
              <button
                key={c.value}
                className={`chip wide-chip ${cadence === c.value ? 'on' : ''}`}
                onClick={() => setCadence(c.value)}
                aria-pressed={cadence === c.value}
              >
                {c.label}
                <span className="sub">{c.hint}</span>
              </button>
            ))}
          </div>
          <label className="field">
            <span className="muted small">GitHub username (optional)</span>
            <input
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              placeholder="your-username"
              maxLength={39}
            />
          </label>
        </>
      ),
    },
  ]

  const current = steps[step]
  const last = step === steps.length - 1

  return (
    <div className="onboarding">
      <header>
        <p className="muted small">Step {step + 1} of {steps.length}</p>
        <h1>{current.title}</h1>
        <p className="tagline">{current.hint}</p>
      </header>

      <div className="onboarding-body">{current.body}</div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="onboarding-actions">
        <button className="secondary" onClick={skip} disabled={busy}>Skip for now</button>
        <div className="row">
          {step > 0 && (
            <button className="secondary" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>
          )}
          {last ? (
            <button onClick={finish} disabled={busy}>
              {busy ? 'Setting up…' : `Create ${habits.size + goals.size} item${habits.size + goals.size === 1 ? '' : 's'}`}
            </button>
          ) : (
            <button onClick={() => setStep(step + 1)}>Next</button>
          )}
        </div>
      </div>

      <p className="muted small centered">
        Signed in as {user.username}
      </p>
    </div>
  )
}
