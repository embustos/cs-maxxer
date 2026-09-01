import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { InterviewAnswer, Application, CardProps } from '@/types'
import { api } from '../api'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { errorMessage } from '@/lib/utils'

// ponytail: a client constant, not a table. Nobody edits this list, and static data in a
// database is a migration you have to run to change a string.
const QUESTION_BANK = [
  'Tell me about a time you disagreed with a teammate.',
  'Describe a project you are proud of. What was your specific contribution?',
  'Tell me about a time you failed or shipped a bug.',
  'Describe a time you had to learn something unfamiliar quickly.',
  'Tell me about a time you received difficult feedback.',
  'Describe a time you had to make a decision without enough information.',
  'Tell me about a time you took initiative on something nobody asked for.',
  'Describe the hardest technical problem you have debugged.',
]

const PARTS: [StarPart, string, string][] = [
  ['situation', 'Situation', 'What was going on? Set the scene in a sentence.'],
  ['task', 'Task', 'What were you specifically responsible for?'],
  ['action', 'Action', 'What did YOU do? This is the part interviewers care about.'],
  ['result', 'Result', 'What happened? Numbers if you have them.'],
]

const completeness = (a: Draft) => PARTS.filter(([k]) => a[k]?.trim()).length

type StarPart = 'situation' | 'task' | 'action' | 'result'
type Draft = Partial<InterviewAnswer> & { question: string }

interface InterviewPrepProps extends CardProps<InterviewAnswer> {
  interviewing: Application[]
}

export default function InterviewPrep({ items, loading, full = false, reload, onError, onToast, onDelete, interviewing }: InterviewPrepProps) {
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>({ question: '' })

  const answered = new Set(items.map((a) => a.question))
  const unanswered = QUESTION_BANK.filter((q) => !answered.has(q))

  const start = (question: string, existing: InterviewAnswer | null = null) => {
    setEditing(existing?.id ?? 'new')
    setDraft(existing ?? { question, situation: '', task: '', action: '', result: '' })
  }

  async function save() {
    const body = {
      question: draft.question,
      situation: draft.situation || null,
      task: draft.task || null,
      action: draft.action || null,
      result: draft.result || null,
    }
    try {
      if (editing === 'new') await api('/interview-answers', { method: 'POST', body })
      else await api(`/interview-answers/${editing}`, { method: 'PATCH', body })
      setEditing(null)
      reload()
      onToast('Answer saved')
    } catch (err) { onError(errorMessage(err)) }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Interview prep</h2>
        <span className="head-meta">
          {items.length > 0 && <span className="count">{items.length} answers ready</span>}
          {!full && items.length > 0 && <Link to="/interviews" className="link small">View all →</Link>}
        </span>
      </div>

      {/* Surfaces only when it's actually relevant — an application reached the
          interview stage. Otherwise this card stays quiet. */}
      {interviewing.length > 0 && (
        <div className="summary">
          {interviewing.map((a) => (
            <span key={a.id} className="chip-static">Interviewing: {a.company}</span>
          ))}
        </div>
      )}

      {loading && <Skeleton rows={2} />}

      {!loading && items.length === 0 && !editing && (
        <EmptyState
          title="No answers written yet"
          hint="Write these once and reuse them. The hard part in the room is recall, not thinking."
          suggestions={QUESTION_BANK.slice(0, 3)}
          onPick={(q) => start(q)}
        />
      )}

      {items.length > 0 && (
        <ul className="rows">
          {items.map((a) => {
            const done = completeness(a)
            return (
              <li key={a.id}>
                <button className="grow row-open" onClick={() => start(a.question, a)}>
                  <span className="title">{a.question}</span>
                  <span className="sub">
                    {done === 4 ? 'complete' : `${done}/4 parts — missing ${PARTS.filter(([k]) => !a[k]?.trim()).map(([, l]) => l).join(', ')}`}
                  </span>
                </button>
                <div className="meta">
                  <span className={`badge ${done === 4 ? 'soon' : ''}`}>{done}/4</span>
                  <button className="ghost" onClick={() => onDelete(a)} aria-label={`Delete answer to ${a.question}`}>×</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <div className="star-editor">
          <h3>{draft.question}</h3>
          {PARTS.map(([key, label, hint]) => (
            <label key={key} className="field">
              <span className="muted small"><strong>{label}</strong> — {hint}</span>
              <textarea
                value={draft[key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                rows={2}
                maxLength={3000}
                aria-label={label}
              />
            </label>
          ))}
          <div className="row end">
            <button className="secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button onClick={save}>Save answer</button>
          </div>
        </div>
      )}

      {/* Only once something IS answered. With nothing answered, `unanswered` is the
          whole bank and the EmptyState above is already offering its first three — the
          same questions, wired to the same start(), rendered twice a hundred pixels
          apart. The empty state owns the first prompt; this is the follow-on. */}
      {!editing && items.length > 0 && unanswered.length > 0 && (
        <>
          <p className="muted small mt">Questions you haven't answered yet</p>
          <div className="suggestions">
            {unanswered.slice(0, 4).map((q) => (
              <button key={q} className="chip" onClick={() => start(q)}>{q}</button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
