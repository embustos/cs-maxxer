// Placeholder rows shaped like the content that's coming, so the layout doesn't jump
// when data lands. aria-hidden because a screen reader should hear the live region,
// not a pile of empty boxes.
export default function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="rows skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i}>
          <span className="sk-box" />
          <span className="grow">
            <span className="sk-line" style={{ width: `${55 + ((i * 17) % 30)}%` }} />
            <span className="sk-line short" />
          </span>
        </li>
      ))}
    </ul>
  )
}
