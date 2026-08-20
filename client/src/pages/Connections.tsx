import { useState, useEffect, useCallback } from 'react'
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

export default function Connections({ items, loading, reload, onError, onToast, onDelete }: CardProps<Connection>) {
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

  return (
    <section className="card span-all">
      <div className="card-head">
        <h2>Connections</h2>
        {items.length > 0 && (
          <span className="count">
            {items.length} tracked{due.length > 0 && ` · ${due.length} to follow up`}
          </span>
        )}
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
          {items.map((c) => {
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

      {openId && <ConnectionDetail id={openId} onError={onError} onToast={onToast} reload={reload} />}

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
  onError: (message: string) => void
  onToast: (message: string) => void
  reload: () => void
}

function ConnectionDetail({ id, onError, onToast, reload }: DetailProps) {
  const [data, setData] = useState<DetailData | null>(null)
  const [draft, setDraft] = useState('')
  const review = useReview<MessageReviewResult>('/ai/review-message')

  const load = useCallback(
    () => api<DetailData>(`/connections/${id}`).then(setData).catch((e) => onError(errorMessage(e))),
    [id, onError],
  )

  // Reload when a different person is opened, not just once on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setData(null); load() }, [load])

  async function addNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const body = (e.currentTarget.elements.namedItem('body') as HTMLInputElement).value.trim()
    if (!body) return
    try {
      await api(`/connections/${id}/notes`, { method: 'POST', body: { body } })
      e.currentTarget.reset()
      load()
    } catch (err) { onError(errorMessage(err)) }
  }

  async function saveAndReview() {
    if (draft.trim().length < 20) return onError('Write a bit more before reviewing.')
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

        {review.unavailable && <ReviewUnavailable message={review.unavailable} />}
        {review.error && <p className="error" role="alert">{review.error}</p>}
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
