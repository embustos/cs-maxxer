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

      {/* One number for "am I accelerating or drifting", weighted so sending an
          application counts for more than ticking a box. */}
      <div className="momentum">
        <div>
          <strong>{data.momentum.score}</strong>
          <span>Momentum</span>
        </div>
        <span className={`delta ${data.momentum.delta > 0 ? 'up' : data.momentum.delta < 0 ? 'down' : 'flat'}`}>
          {data.momentum.delta > 0 ? '▲' : data.momentum.delta < 0 ? '▼' : '—'}{' '}
          {data.momentum.delta === 0 ? 'level with last week' : `${data.momentum.delta > 0 ? '+' : ''}${data.momentum.delta} vs last week`}
        </span>
      </div>

      {/* The card used to report numbers and draw no conclusion. This is the one thing
          to actually do next — a rule over the same numbers, not an AI call. */}
      <div className={`verdict-box ${data.verdict.tone}`}>
        <p className="empty-title">{data.verdict.headline}</p>
        <p className="muted small">{data.verdict.next}</p>
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
