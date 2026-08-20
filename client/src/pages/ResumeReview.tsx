import { useState } from 'react'
import type { ResumeReviewResult } from '@/types'
import { ReviewUnavailable } from '../components/MessageReview'
import { useReview } from '../useReview'

// Paste a resume or a LinkedIn About section and get line-level feedback.
// Deliberately NOT a wholesale rewrite: you have to defend every line of a resume in an
// interview, so a document the model rewrote for you is worse than useless.
export default function ResumeReview({ onError }: { onError: (message: string) => void }) {
  const [text, setText] = useState('')
  const [role, setRole] = useState('')
  const [open, setOpen] = useState(false)
  const review = useReview<ResumeReviewResult>('/ai/review-resume')

  const run = () => {
    if (text.trim().length < 100) return onError('Paste a bit more — at least a full section.')
    review.run({ text, target_role: role.trim() || null })
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Resume review</h2>
        {!open && (
          <button className="secondary small-btn" onClick={() => setOpen(true)}>Open</button>
        )}
      </div>

      {!open && (
        <p className="muted small">
          Paste your resume or LinkedIn About section for line-by-line feedback on what a
          recruiter sees in six seconds.
        </p>
      )}

      {open && (
        <>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Target role (optional) — e.g. Backend Intern Summer 2027"
            maxLength={120}
            aria-label="Target role"
          />
          <textarea
            className="mt"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your resume text here…"
            rows={10}
            maxLength={20000}
            aria-label="Resume text"
          />
          <div className="row end">
            <span className="muted small">{text.length}/20000</span>
            <button className="secondary" onClick={() => setOpen(false)}>Close</button>
            <button onClick={run} disabled={review.loading}>
              {review.loading ? 'Reviewing…' : 'Review'}
            </button>
          </div>

          {review.unavailable && <ReviewUnavailable message={review.unavailable} />}
          {review.error && <p className="error" role="alert">{review.error}</p>}

          {review.review && (
            <div className="review">
              <p className="rewrite-body">{review.review.overall}</p>

              {review.review.sections?.map((s) => (
                <div key={s.section} className="resume-section">
                  <h3>{s.section}</h3>
                  {s.working?.length > 0 && (
                    <ul className="review-list">
                      {s.working.map((w: string, i: number) => (
                        <li key={i}><span className="tag good">Works</span>{w}</li>
                      ))}
                    </ul>
                  )}
                  {s.fix?.length > 0 && (
                    <ul className="review-list">
                      {s.fix.map((f, i: number) => (
                        <li key={i}>
                          <span className="tag fix">Rewrite</span>
                          <span>
                            <q className="quoted">{f.quote}</q>
                            <span className="sub strong">{f.rewrite}</span>
                            <span className="sub">{f.why}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              {review.review.missing?.length > 0 && (
                <div className="resume-section">
                  <h3>Missing</h3>
                  <ul className="review-list">
                    {review.review.missing.map((m: string, i: number) => (
                      <li key={i}><span className="tag fix">Add</span>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
