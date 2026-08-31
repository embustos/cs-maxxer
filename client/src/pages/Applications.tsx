import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { api } from '../api'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ApplicationDetail from '../components/ApplicationDetail'

import type { Application, ApplicationStage, CardProps } from '@/types'
import { errorMessage } from '@/lib/utils'
import { STAGES, STAGE_LABELS as LABELS, isStage } from '@/lib/stages'

export default function Applications({ items, loading, full = false, reload, onError, onToast, onDelete }: CardProps<Application>) {
  const [adding, setAdding] = useState(false)
  // Stage changes the server hasn't confirmed yet, id → stage. A drop has to land the
  // tile in its new column on the same frame you let go; waiting for the round trip
  // means the tile snaps back and then jumps, which reads as a bug.
  const [moving, setMoving] = useState<Record<number, ApplicationStage>>({})
  // What's being carried, and where it's hovering. Both cleared by dragend, which fires
  // whether the drop landed, missed, or was cancelled with Escape.
  //
  // The id lives in a ref, not in state, because dragover and drop have to *decide* with
  // it. A state write from dragstart isn't guaranteed to have re-rendered by the time the
  // first dragover fires, and a dragover that reads a stale null refuses to become a drop
  // target — a drag that's over quickly gets silently rejected. The ref is current the
  // instant dragstart assigns it. State still holds the same id for the visual only,
  // where a frame's delay is invisible and a re-render is the whole point.
  const dragRef = useRef<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overStage, setOverStage] = useState<ApplicationStage | null>(null)
  // Which application's detail panel is open. An id, not the row: the row is re-fetched
  // by every reload, and a held copy would go stale the moment anything else changed it.
  const [detailId, setDetailId] = useState<number | null>(null)

  const endDrag = () => {
    dragRef.current = null
    setDragId(null)
    setOverStage(null)
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = e.currentTarget
    const company = (f.elements.namedItem('company') as HTMLInputElement).value
    try {
      await api('/applications', { method: 'POST', body: { company, role: (f.elements.namedItem('role') as HTMLInputElement).value } })
      f.reset()
      setAdding(false)
      reload()
      onToast(`Added ${company}`)
    } catch (err) { onError(errorMessage(err)) }
  }

  async function setStage(app: Application, stage: string) {
    if (!isStage(stage) || stage === app.stage) return
    setMoving((m) => ({ ...m, [app.id]: stage }))
    try {
      await api(`/applications/${app.id}`, { method: 'PATCH', body: { stage } })
      await reload()
      onToast(`${app.company} → ${LABELS[stage]}`)
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      // Cleared either way: on success the reloaded row already says this, on failure
      // dropping the override is what returns the tile to where it really is.
      setMoving((m) => {
        const next = { ...m }
        delete next[app.id]
        return next
      })
    }
  }

  // Unconfirmed moves applied once, here, so every read below sees the same list.
  const view = items.map((a) => (moving[a.id] ? { ...a, stage: moving[a.id] } : a))
  const active = view.filter((a) => !['rejected', 'ghosted'].includes(a.stage))
  // Resolved from the live list every render, so a save or a stage change behind the
  // dialog is reflected in it. A deleted row resolves to null and the dialog unmounts.
  const detail = view.find((a) => a.id === detailId) ?? null
  // The card is a working surface, not an archive: live applications only, so six
  // rejections can't bury the one offer. It scrolls past ~5 rows (see .grid .card >
  // ul.rows). The page is the board, and shows every stage.

  const row = (a: Application) => (
    <li key={a.id}>
      <div className="grow">
        <span className="title">{a.company}</span>
        <span className="sub">{a.role}</span>
      </div>
      <select
        value={a.stage}
        onChange={(e) => setStage(a, e.target.value)}
        className={`stage ${a.stage}`}
        aria-label={`Stage for ${a.company}`}
      >
        {STAGES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
      </select>
      {/* The same panel the board tiles open. A dashboard row is one line by design —
          this is the door to everything that doesn't fit on it. */}
      <button className="ghost info" onClick={() => setDetailId(a.id)} aria-label={`Details for ${a.company}`}>
        <Info size={16} aria-hidden="true" />
      </button>
      <button className="ghost" onClick={() => onDelete(a)} aria-label={`Delete ${a.company}`}>×</button>
    </li>
  )

  // Only the body carries `draggable`, never the whole tile: a select inside a draggable
  // ancestor is the classic broken-kanban bug — the browser starts a drag when you reach
  // for the dropdown and you can never open it. Controls live outside the drag source.
  const tile = (a: Application) => (
    <li key={a.id} className={`tile ${a.stage}${dragId === a.id ? ' dragging' : ''}`}>
      {/* Drag and click share one surface. They don't collide: a drag that starts here
          ends in dragend, and the browser fires no click after a completed drag — so a
          click is by definition a press that never moved. role/tabIndex rather than a
          real <button> because a draggable button is inconsistent across browsers, and
          the drag path here is the one that already works. */}
      <div
        className="tile-body"
        draggable
        role="button"
        tabIndex={0}
        aria-label={`Details for ${a.company}`}
        onClick={() => setDetailId(a.id)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault() // Space would scroll the column instead of opening
          setDetailId(a.id)
        }}
        onDragStart={(e) => {
          dragRef.current = a.id
          setDragId(a.id)
          e.dataTransfer.effectAllowed = 'move'
          // Firefox refuses to start a drag at all without payload on the transfer.
          e.dataTransfer.setData('text/plain', String(a.id))
        }}
        onDragEnd={endDrag}
      >
        <span className="title">{a.company}</span>
        <span className="sub">{a.role}</span>
      </div>
      <div className="tile-foot">
        {/* Drag is the fast path, not the only one: this is how the board works with a
            keyboard, a screen reader, or a touchscreen, none of which get HTML5 drag. */}
        <select
          value={a.stage}
          onChange={(e) => setStage(a, e.target.value)}
          className={`stage ${a.stage}`}
          aria-label={`Move ${a.company} to another stage`}
        >
          {STAGES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
        </select>
        <button className="ghost" onClick={() => onDelete(a)} aria-label={`Delete ${a.company}`}>×</button>
      </div>
    </li>
  )

  const column = (stage: ApplicationStage) => {
    const group = view.filter((a) => a.stage === stage)
    return (
      <section
        key={stage}
        className={`board-col ${stage}${overStage === stage ? ' over' : ''}`}
        aria-label={`${LABELS[stage]} — ${group.length} application${group.length === 1 ? '' : 's'}`}
        onDragOver={(e) => {
          // Nothing of ours in flight means this is a file or a link from another app:
          // no preventDefault, so the browser keeps its own drop behaviour.
          if (dragRef.current === null) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setOverStage(stage)
        }}
        onDrop={(e) => {
          e.preventDefault()
          const app = view.find((a) => a.id === dragRef.current)
          endDrag()
          if (app) setStage(app, stage)
        }}
      >
        <h3 className="board-head">
          {LABELS[stage]} <span className="count">{group.length}</span>
        </h3>
        <ul className="tiles">
          {group.map(tile)}
          {group.length === 0 && <li className="tile-slot" aria-hidden="true">Drop here</li>}
        </ul>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Applications</h2>
        <span className="head-meta">
          {items.length > 0 && (
            <span className="count">{active.length} active / {items.length} total</span>
          )}
          {!full && items.length > 0 && <Link to="/applications" className="link small">View all →</Link>}
        </span>
      </div>

      {loading && <Skeleton rows={2} />}

      {!loading && items.length === 0 && (
        <EmptyState
          title="No applications tracked"
          hint="Add the roles you've applied to so you can see where each one stands."
        />
      )}

      {/* Page: a board, one column per stage, drag a tile across to move it. Card: the
          active slice as a flat list — a pipeline needs room the dashboard doesn't have. */}
      {full
        ? items.length > 0 && (
            <div className={`board${dragId !== null ? ' dragging' : ''}`}>
              {STAGES.map(column)}
            </div>
          )
        : active.length > 0 && <ul className="rows">{active.map(row)}</ul>}

      {adding ? (
        <form className="add stack" onSubmit={add}>
          <input name="company" placeholder="Company" required autoFocus maxLength={120} aria-label="Company" />
          <input name="role" placeholder="Role — e.g. SWE Intern Summer 2027" required maxLength={120} aria-label="Role" />
          <div className="row">
            <button>Save</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary wide" onClick={() => setAdding(true)}>Add application</button>
      )}

      {/* Keyed by id so opening a different application remounts the form with its own
          values — without it the uncontrolled inputs would keep the previous row's. */}
      {detail && (
        <ApplicationDetail
          key={detail.id}
          app={detail}
          onClose={() => setDetailId(null)}
          reload={reload}
          onError={onError}
          onToast={onToast}
        />
      )}
    </section>
  )
}
