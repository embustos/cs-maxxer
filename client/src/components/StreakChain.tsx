// The last 14 days of a habit as a row of cells, oldest first.
//
// This is the loss-aversion surface: an unbroken run that is about to end is a stronger
// pull than a reminder. Today is drawn with a ring when it's still open, so the gap is
// the thing your eye lands on.
export default function StreakChain({ chain }: { chain: boolean[] }) {
  if (!chain?.length) return null
  const todayIndex = chain.length - 1

  return (
    <span
      className="chain"
      role="img"
      aria-label={`${chain.filter(Boolean).length} of the last ${chain.length} days completed`}
    >
      {chain.map((done, i) => (
        <i
          key={i}
          className={[
            'chain-cell',
            done ? 'on' : '',
            i === todayIndex ? 'today' : '',
            i === todayIndex && !done ? 'open' : '',
          ].filter(Boolean).join(' ')}
        />
      ))}
    </span>
  )
}
