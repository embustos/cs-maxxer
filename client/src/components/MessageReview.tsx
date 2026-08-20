// The review panel. The AI never sends anything — it returns text you read, edit, and
// send yourself. `onUseRewrite` puts its suggestion in the editor, it doesn't apply it.
import type { MessageReviewResult } from '@/types'

interface MessageReviewProps {
  review: MessageReviewResult | null
  cached?: boolean
  onUseRewrite: (rewrite: string) => void
}

export default function MessageReview({ review, cached, onUseRewrite }: MessageReviewProps) {
  if (!review) return null

  return (
    <div className={`review ${review.verdict}`}>
      <div className="review-head">
        <span className="verdict">
          {review.verdict === 'send' ? 'Ready to send' : 'Worth revising'}
        </span>
        {cached && <span className="muted small">saved review</span>}
      </div>

      {review.strengths?.length > 0 && (
        <ul className="review-list">
          {review.strengths.map((s, i) => (
            <li key={i}><span className="tag good">Works</span>{s}</li>
          ))}
        </ul>
      )}

      {review.issues?.length > 0 && (
        <ul className="review-list">
          {review.issues.map((issue, i) => (
            <li key={i}>
              <span className="tag fix">Fix</span>
              <span>
                <q className="quoted">{issue.quote}</q>
                <span className="sub">{issue.problem}</span>
                <span className="sub strong">{issue.fix}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {review.rewrite && (
        <div className="rewrite">
          <div className="card-head">
            <h3>Suggested rewrite</h3>
            <button className="secondary small-btn" onClick={() => onUseRewrite(review.rewrite)}>
              Use this
            </button>
          </div>
          <p className="rewrite-body">{review.rewrite}</p>
        </div>
      )}
    </div>
  )
}

// Shown instead of a dead button when there's no API key. Tells you exactly how to turn
// the feature on rather than failing silently.
export function ReviewUnavailable({ message }: { message: string }) {
  return (
    <div className="notice">
      <p className="empty-title">AI review is off</p>
      <p className="muted small">{message}</p>
      <ol className="muted small steps">
        <li>Create a key at console.anthropic.com under API keys</li>
        <li>Add credit under Billing (minimum $5, about 200 reviews)</li>
        <li>Put <code>ANTHROPIC_API_KEY=…</code> in <code>server/.env</code> and restart</li>
      </ol>
    </div>
  )
}
