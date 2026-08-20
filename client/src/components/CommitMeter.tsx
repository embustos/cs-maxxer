import { useState } from 'react'

// Today's commits against the daily goal, as an arc.
//
// The dataviz method's form for "a single ratio against a limit" is a meter, not a
// two-slice pie. The unfilled track is the same ramp, lighter; the fill carries
// severity as it approaches the goal. role="meter" + aria values mean the number is
// available without reading the arc, so it is never color-alone.
const SIZE = 132
const STROKE = 12
const R = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * R
const GAP = 0.28 // fraction of the circle left open at the bottom
const ARC = CIRC * (1 - GAP)

interface CommitMeterProps {
  count: number
  goal: number | null
  onSetGoal: (goal: number) => void
  onClearGoal: () => void
}

export default function CommitMeter({ count, goal, onSetGoal, onClearGoal }: CommitMeterProps) {
  const [editing, setEditing] = useState(false)

  if (!goal) {
    return (
      <div className="meter-empty">
        <p className="muted small">Set a daily commit goal to track it here.</p>
        <form
          className="row"
          onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault()
            const n = Number((e.currentTarget.elements.namedItem('goal') as HTMLInputElement).value)
            if (n >= 1) onSetGoal(n)
          }}
        >
          <input name="goal" type="number" min="1" max="50" placeholder="3" aria-label="Commits per day" />
          <button>Set goal</button>
        </form>
      </div>
    )
  }

  const ratio = Math.min(count / goal, 1)
  const state = count >= goal ? 'hit' : count > 0 ? 'partial' : 'none'

  return (
    <div className="meter">
      <svg width={SIZE} height={SIZE} role="meter" aria-valuenow={count} aria-valuemin={0}
           aria-valuemax={goal} aria-label={`${count} of ${goal} commits today`}>
        <g transform={`rotate(${90 + (360 * GAP) / 2} ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            className="meter-track"
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            strokeWidth={STROKE} fill="none"
            strokeDasharray={`${ARC} ${CIRC}`}
            strokeLinecap="round"
          />
          <circle
            className={`meter-fill ${state}`}
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            strokeWidth={STROKE} fill="none"
            strokeDasharray={`${ARC * ratio} ${CIRC}`}
            strokeLinecap="round"
          />
        </g>
        <text x="50%" y="47%" className="meter-value" textAnchor="middle">{count}</text>
        <text x="50%" y="64%" className="meter-goal" textAnchor="middle">of {goal} today</text>
      </svg>

      <div className="meter-actions">
        {editing ? (
          <form
            className="row"
            onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
              e.preventDefault()
              const n = Number((e.currentTarget.elements.namedItem('goal') as HTMLInputElement).value)
              if (n >= 1) onSetGoal(n)
              setEditing(false)
            }}
          >
            <input name="goal" type="number" min="1" max="50" defaultValue={goal} autoFocus aria-label="Commits per day" />
            <button>Save</button>
          </form>
        ) : (
          <>
            <button className="secondary small-btn" onClick={() => setEditing(true)}>Edit goal</button>
            <button className="secondary small-btn" onClick={onClearGoal}>Clear</button>
          </>
        )}
      </div>
    </div>
  )
}
