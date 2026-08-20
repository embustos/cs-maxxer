// An empty section should say what to do next, not just that it's empty.
// `suggestions` turns the blank state into one-click onboarding.
interface EmptyStateProps {
  title: string
  hint?: string
  suggestions?: string[]
  onPick?: (value: string) => void
}

export default function EmptyState({ title, hint, suggestions = [], onPick }: EmptyStateProps) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint && <p className="muted small">{hint}</p>}
      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((s) => (
            <button key={s} className="chip" onClick={() => onPick?.(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  )
}
