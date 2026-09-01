import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import type {
  Connection, ConnectionNote, OutreachMessage, Relationship,
  MessageReviewResult, CardProps,
} from '@/types'
import { api } from '../api'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import MessageReview, { ReviewUnavailable } from '../components/MessageReview'
import { useReview } from '../useReview'
import { errorMessage } from '@/lib/utils'

const RELATIONSHIPS = ['recruiter', 'engineer', 'alum', 'professor', 'peer', 'manager', 'other'] as const
const LABELS: Record<Relationship, string> = {
  recruiter: 'Recruiter', engineer: 'Engineer', alum: 'Alum',
  professor: 'Professor', peer: 'Peer', manager: 'Manager', other: 'Other',
}

const dueLabel = (iso: string | null) => {
  if (!iso) return null
  const days = Math.round((new Date(iso + 'T00:00').getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
  if (days < 0) return { text: `${-days}d overdue`, overdue: true }
  if (days === 0) return { text: 'today', overdue: true }
  return { text: `in ${days}d`, overdue: false }
}

export default function Connections({ items, loading, full = false, reload, onError, onToast, onDelete }: CardProps<Connection>) {
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const el = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value
    const name = el('name')
    try {
      await api('/connections', {
        method: 'POST',
        body: {
          name,
          company: el('company') || null,
          role: el('role') || null,
          relationship: el('relationship'),
          met_at: el('met_at') || null,
        },
      })
      f.reset()
      setAdding(false)
      reload()
      onToast(`Added ${name}`)
    } catch (err) { onError(errorMessage(err)) }
  }

  const due = items.filter((c) => dueLabel(c.follow_up_on)?.overdue)
  // Overdue follow-ups always make the card — burying an overdue reply under six newer
  // names is how a warm contact goes cold. The page shows everyone.
  const shown = full ? items : [...due, ...items.filter((c) => !due.includes(c))].slice(0, 6)

  // Full width once there's a list to spread out — a roster reads better wide. While
  // it's empty that's a full-width band holding one sentence, wedged between two
  // two-column rows, so it takes an ordinary column until it has something to show.
  return (
    <section className={`card${items.length > 0 ? ' span-all' : ''}`}>
      <div className="card-head">
        <h2>Connections</h2>
        <span className="head-meta">
          {items.length > 0 && (
            <span className="count">
              {items.length} tracked{due.length > 0 && ` · ${due.length} to follow up`}
            </span>
          )}
          {!full && items.length > 0 && <Link to="/connections" className="link small">View all →</Link>}
        </span>
      </div>

      {loading && <Skeleton rows={2} />}

      {!loading && items.length === 0 && (
        <EmptyState
          title="Nobody tracked yet"
          hint="Recruiters, engineers you met at events, alumni. Keep notes on each one so your next message isn't generic."
        />
      )}

      {items.length > 0 && (
        <ul className="rows">
          {shown.map((c) => {
            const d = dueLabel(c.follow_up_on)
            return (
              <li key={c.id} className="connection">
                <button
                  className="grow row-open"
                  onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  aria-expanded={openId === c.id}
                >
                  <span className="title">{c.name}</span>
                  <span className="sub">
                    {[c.role, c.company].filter(Boolean).join(' · ') || LABELS[c.relationship]}
                    {c.last_contacted_on && ` · last contacted ${new Date(c.last_contacted_on + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                  </span>
                </button>
                <div className="meta">
                  {d && <span className={`badge ${d.overdue ? 'soon' : ''}`}>{d.text}</span>}
                  <button className="ghost" onClick={() => onDelete(c)} aria-label={`Delete ${c.name}`}>×</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!full && items.length > shown.length && (
        <p className="muted small">
          <Link to="/connections" className="link">+{items.length - shown.length} more</Link>
        </p>
      )}

      {openId && (
        <ConnectionDetail
          id={openId}
          name={items.find((c) => c.id === openId)?.name ?? ''}
          onClose={() => setOpenId(null)}
          onError={onError}
          onToast={onToast}
          reload={reload}
        />
      )}

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="name" placeholder="Name" required autoFocus maxLength={120} aria-label="Name" />
          <div className="row">
            <input name="company" placeholder="Company" maxLength={120} aria-label="Company" />
            <input name="role" placeholder="Role" maxLength={120} aria-label="Role" />
          </div>
          <div className="row">
            <select name="relationship" defaultValue="other" aria-label="Relationship">
              {RELATIONSHIPS.map((r) => <option key={r} value={r}>{LABELS[r]}</option>)}
            </select>
            <input name="met_at" placeholder="Where you met" maxLength={200} aria-label="Where you met" />
          </div>
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>Add connection</button>
      )}
    </section>
  )
}

interface DetailData {
  connection: Connection
  notes: ConnectionNote[]
  messages: OutreachMessage[]
}

interface DetailProps {
  id: number
  name: string
  onClose: () => void
  onError: (message: string) => void
  onToast: (message: string) => void
  reload: () => void
}

function ConnectionDetail({ id, name, onClose, onError, onToast, reload }: DetailProps) {
  const [data, setData] = useState<DetailData | null>(null)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState('')
  const review = useReview<MessageReviewResult>('/ai/review-message')

  const load = useCallback(
    () => api<DetailData>(`/connections/${id}`).then(setData).catch((e) => onError(errorMessage(e))),
    [id, onError],
  )

  // Reload when a different person is opened, not just once on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setData(null); load() }, [load])

  // The form is captured BEFORE the await. React nulls a synthetic event's currentTarget
  // once dispatch finishes, so reading it after `await` threw "Cannot read properties of
  // null (reading 'reset')" — which the catch turned into an error banner at the top of
  // the page. The note had already been saved by then; what was skipped was the reset and
  // the reload. So the note never appeared, the box never cleared, and pressing Add again
  // posted the same text a second time. That is where the duplicate notes came from.
  async function addNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const body = (form.elements.namedItem('body') as HTMLInputElement).value.trim()
    if (!body) return
    try {
      await api(`/connections/${id}/notes`, { method: 'POST', body: { body } })
      form.reset()
      load()
    } catch (err) { onError(errorMessage(err)) }
  }

  async function deleteNote(noteId: number) {
    try {
      await api(`/connections/${id}/notes/${noteId}`, { method: 'DELETE' })
      load()
    } catch (err) { onError(errorMessage(err)) }
  }

  async function saveAndReview() {
    // Inline, next to the button that was pressed. This used to call onError, which
    // renders the banner at the very top of the dashboard — a thousand pixels above the
    // textarea you are looking at, so pressing Review draft read as doing nothing.
    setDraftError('')
    if (draft.trim().length < 20) return setDraftError('Write at least 20 characters before reviewing.')
    try {
      const { message } = await api<{ message: OutreachMessage }>(`/connections/${id}/messages`, { method: 'POST', body: { draft } })
      await review.run(null, `/ai/review-message/${message.id}`)
      load()
    } catch (err) { onError(errorMessage(err)) }
  }

  async function markSent(messageId: number) {
    try {
      await api(`/connections/${id}/messages/${messageId}`, { method: 'PATCH', body: { sent: true } })
      load()
      reload()
      onToast('Marked as sent')
    } catch (err) { onError(errorMessage(err)) }
  }

  if (!data) return <Skeleton rows={2} />

  return (
    <div className="detail">
      {/* Clicking the row again also closes this, but nothing on screen said so — and the
          only visible × belonged to the row above and DELETES the person. An explicit
          Close, named, is the difference between "collapse this" and "lose this". */}
      <div className="detail-bar">
        <span className="muted small">Notes and drafts for {name}</span>
        <button type="button" className="secondary small-btn" onClick={onClose}>Close</button>
      </div>

      <div className="detail-col">
        <h3>Notes</h3>
        {data.notes.length === 0 && <p className="muted small">Nothing yet. What did you talk about?</p>}
        <ul className="rows tight">
          {data.notes.map((n) => (
            <li key={n.id}>
              <span className="grow">
                <span className="title">{n.body}</span>
                <span className="sub">{new Date(n.created_at).toLocaleDateString()}</span>
              </span>
              {/* The DELETE route already existed; nothing ever called it, so a note was
                  permanent once written — and the bug above made stray ones easy to make. */}
              <button className="ghost" onClick={() => deleteNote(n.id)} aria-label={`Delete note: ${n.body.slice(0, 40)}`}>×</button>
            </li>
          ))}
        </ul>
        <form className="add" onSubmit={addNote}>
          <input name="body" placeholder="Add a note" maxLength={4000} aria-label="New note" />
          <button className="secondary">Add</button>
        </form>
      </div>

      <div className="detail-col">
        <h3>Draft a message</h3>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write your outreach message. The review checks it for a clear ask, specificity, and length — then you send it yourself."
          rows={6}
          maxLength={4000}
          aria-label="Draft message"
        />
        <div className="row end">
          <span className="muted small">{draft.length}/4000</span>
          <button onClick={saveAndReview} disabled={review.loading}>
            {review.loading ? 'Reviewing…' : 'Review draft'}
          </button>
        </div>

        {draftError && <p className="error" role="alert">{draftError}</p>}
        {review.unavailable && <ReviewUnavailable message={review.unavailable} />}
        {review.error && (
          <p className="error" role="alert">
            {review.error}
            {review.upgrade && (
              <button type="button" className="link" onClick={review.buy}>
                Get more reviews
              </button>
            )}
          </p>
        )}
        <MessageReview review={review.review} cached={review.cached} onUseRewrite={setDraft} />

        {data.messages.length > 0 && (
          <>
            <h3 className="mt">Earlier drafts</h3>
            <ul className="rows tight">
              {data.messages.map((m) => (
                <li key={m.id}>
                  <span className="grow">
                    <span className="title">{m.draft.slice(0, 80)}{m.draft.length > 80 ? '…' : ''}</span>
                    <span className="sub">
                      {m.sent_at ? `sent ${new Date(m.sent_at).toLocaleDateString()}` : 'not sent'}
                      {m.review_json && ' · reviewed'}
                    </span>
                  </span>
                  {!m.sent_at && (
                    <button className="secondary small-btn" onClick={() => markSent(m.id)}>Mark sent</button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
