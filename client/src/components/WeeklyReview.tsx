// Four numbers with their week-over-week change.
//
// Per the dataviz method this is a KPI row, not a chart: four independent counts with no
// shared scale have nothing to gain from axes. Direction is carried by an arrow AND a
// sign AND colour — never colour alone, so it survives a colourblind reader.
import type { WeeklyReviewData } from '@/types'

export default function WeeklyReview({ data }: { data: WeeklyReviewData | null }) {
  if (!data) return null

  const range = `${new Date(data.week_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(data.week_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

  const anyActivity = data.metrics.some((m) => m.value > 0 || m.previous > 0)

  return (
    <section className="card span-all">
      <div className="card-head">
        <h2>This week</h2>
        <span className="count">{range}</span>
      </div>

      {!anyActivity ? (
        <p className="muted small">
          Nothing logged yet this week or last. Check a habit off and this fills in.
        </p>
      ) : (
        <div className="stats kpi">
          {data.metrics.map((m) => {
            const dir = m.delta > 0 ? 'up' : m.delta < 0 ? 'down' : 'flat'
            return (
              <div key={m.label} className="kpi-cell">
                <strong>{m.value}</strong>
                <span>{m.label}</span>
                <span className={`delta ${dir}`}>
                  {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—'}{' '}
                  {m.delta === 0 ? 'same as last week' : `${m.delta > 0 ? '+' : ''}${m.delta} vs last week`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
