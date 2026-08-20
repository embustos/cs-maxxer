import { useState } from 'react'

interface Day {
  date: string
  count: number
  month: number
  dayOfMonth: number
}

interface ContributionGraphProps {
  days: Record<string, number> | undefined
  total: number | undefined
  source?: 'graphql' | 'events'
}

// GitHub-style contribution calendar: one column per week, one row per weekday.
//
// Sequential encoding (magnitude), so per the dataviz method it is ONE hue stepped
// light→dark, never a rainbow. The four filled steps are validated for both light and
// dark surfaces — see --level-1..4 in App.css. Level 0 is the empty track, meaning
// "no contributions", and is a surface tone rather than a data color.
//
// Buckets are relative to the user's own busiest day, so a person averaging 2 commits
// still sees contrast instead of a uniformly pale grid.
const CELL = 11
const GAP = 3
const ROWS = 7

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function bucket(count: number, max: number): number {
  if (!count) return 0
  if (max <= 4) return Math.min(count, 4) // few contributions: one level per commit
  const q = count / max
  return q > 0.66 ? 4 : q > 0.33 ? 3 : q > 0.12 ? 2 : 1
}

// Build weeks as columns, starting on the Sunday on or before the first date.
function toWeeks(days: Record<string, number>): Day[][] {
  const dates = Object.keys(days).sort()
  if (!dates.length) return []

  const start = new Date(dates[0] + 'T00:00:00')
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(dates[dates.length - 1] + 'T00:00:00')

  const weeks: Day[][] = []
  let week: Day[] = []
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toLocaleDateString('en-CA')
    week.push({ date: iso, count: days[iso] ?? 0, month: d.getMonth(), dayOfMonth: d.getDate() })
    if (week.length === ROWS) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length) weeks.push(week)
  return weeks
}

export default function ContributionGraph({ days, total, source }: ContributionGraphProps) {
  const [hover, setHover] = useState<Day | null>(null)

  const weeks = toWeeks(days ?? {})
  if (!weeks.length) return <p className="muted">No contribution data yet.</p>

  const max = Math.max(...Object.values(days ?? {}), 0)
  const width = weeks.length * (CELL + GAP)
  const height = ROWS * (CELL + GAP)

  // A month label on the first week whose month differs from the previous week's.
  const monthLabels = weeks.reduce<{ week: number; month: number }[]>((acc, week, i) => {
    const m = week[0].month
    if (i === 0 || m !== weeks[i - 1][0].month) {
      // skip if it would collide with the previous label
      if (!acc.length || i - acc[acc.length - 1].week >= 3) acc.push({ week: i, month: m })
    }
    return acc
  }, [])

  return (
    <div className="calendar">
      <div className="calendar-scroll">
        <svg
          width={width}
          height={height + 18}
          role="img"
          aria-label={`${total} contributions in the last year`}
        >
          {monthLabels.map(({ week, month }) => (
            <text key={week} x={week * (CELL + GAP)} y={9} className="cal-month">
              {MONTHS[month]}
            </text>
          ))}
          {weeks.map((week, x) =>
            week.map((day, y) => (
              <rect
                key={day.date}
                x={x * (CELL + GAP)}
                y={y * (CELL + GAP) + 18}
                width={CELL}
                height={CELL}
                rx={2}
                className={`cal-cell lvl-${bucket(day.count, max)}`}
                onMouseEnter={() => setHover(day)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${day.count} on ${day.date}`}</title>
              </rect>
            )),
          )}
        </svg>
      </div>

      <div className="calendar-foot">
        <span className="muted small">
          {total} contributions
          {source === 'events' && ' · last 90 days only — add a GITHUB_TOKEN for the full year'}
        </span>
        <span className="legend">
          <span className="muted small">Less</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`cal-cell lvl-${l}`} />
          ))}
          <span className="muted small">More</span>
        </span>
      </div>

      {/* Live region rather than a floating tooltip: it never clips at the container
          edge, and a screen reader announces it. */}
      <p className="cal-hover muted small" aria-live="polite">
        {hover
          ? `${hover.count} contribution${hover.count === 1 ? '' : 's'} on ${new Date(
              hover.date + 'T00:00:00',
            ).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
          : ' '}
      </p>
    </div>
  )
}
