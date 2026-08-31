import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { errorMessage } from '@/lib/utils'
import { STAGE_LABELS } from '@/lib/stages'
import type { Application } from '@/types'

// A native <dialog> opened with showModal(), not a hand-rolled overlay. The browser
// already does the four things a modal has to get right — focus trapped inside, Escape
// closes, focus returned to whatever opened it, and rendering in the top layer so no
// z-index can ever cover it. None of that is worth reimplementing.

// The panel is one list of fields, so it's declared as data and mapped. Order is the
// order you'd actually fill them in: what the job is, then how you got to it, then who
// you know, then everything you want to remember.
const FIELDS = [
  { name: 'role', label: 'Role', type: 'text', required: true },
  { name: 'applied_on', label: 'Date applied', type: 'date', required: true },
  { name: 'company_size', label: 'Company size', type: 'text', placeholder: 'e.g. ~500, Series B, FAANG' },
  { name: 'location', label: 'Location', type: 'text', placeholder: 'e.g. Austin, TX · Remote' },
  { name: 'source', label: 'How did you find this?', type: 'text', placeholder: 'Referral, LinkedIn, careers page…' },
  { name: 'url', label: 'Application link', type: 'url', placeholder: 'https://…' },
  { name: 'requirements', label: 'Requirements', type: 'textarea', rows: 3, placeholder: 'Stack, years, grad date, visa…' },
  { name: 'recruiter', label: 'Recruiter', type: 'textarea', rows: 2, placeholder: 'Name, email, when they last replied' },
  { name: 'contacts', label: 'Connections (non-recruiter)', type: 'textarea', rows: 2, placeholder: 'Engineers, alumni, anyone who can refer' },
  { name: 'documents', label: 'Documents', type: 'textarea', rows: 2, placeholder: 'Which resume version, cover letter, links' },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 4, placeholder: 'Anything you want to remember' },
] as const

// The two the server will not accept as null: role is `trimmed(120)` (min 1) and
// applied_on is `not null` in the table. Both are marked required above, so the
// browser blocks an empty submit before it can become a 400.
type FieldName = (typeof FIELDS)[number]['name']

export default function ApplicationDetail({
  app, onClose, reload, onError, onToast,
}: {
  app: Application
  onClose: () => void
  reload: () => void | Promise<void>
  onError: (message: string) => void
  onToast: (message: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [saving, setSaving] = useState(false)

  // showModal() can only run against a mounted node, so it happens here rather than in
  // an `open` attribute — the attribute renders a non-modal dialog with no backdrop,
  // no focus trap and no Escape, which is the wrong half of the feature.
  useEffect(() => { ref.current?.showModal() }, [])

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    // Uncontrolled inputs, read once on submit: eleven fields do not need eleven
    // useStates, and nothing here needs to react to a keystroke.
    const body = Object.fromEntries(
      FIELDS.map((f) => [f.name, String(form.get(f.name) ?? '').trim() || null]),
    ) as Record<FieldName, string | null>

    setSaving(true)
    try {
      await api(`/applications/${app.id}`, { method: 'PATCH', body })
      await reload()
      onToast(`Saved ${app.company}`)
      ref.current?.close()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="app-detail"
      // Every close path lands here — Escape, the backdrop, Cancel, the × and a
      // finished save all go through close(), and this is where the parent's open-panel
      // state is cleared. Without it the panel would close visually but stay "open" in
      // React, and clicking the same tile again would be a no-op state write.
      onClose={onClose}
      aria-label={`Details for ${app.company}`}
      // A click that lands on the dialog element itself landed on the backdrop — the
      // form covers the whole box, so anything inside it targets a child.
      onClick={(e) => { if (e.target === ref.current) ref.current?.close() }}
    >
      <form className="app-detail-form" onSubmit={save}>
        <header className="app-detail-head">
          <div>
            <h2>{app.company}</h2>
            <span className={`stage-tag ${app.stage}`}>{STAGE_LABELS[app.stage]}</span>
          </div>
          <button type="button" className="ghost info" onClick={() => ref.current?.close()} aria-label="Close details">
            ×
          </button>
        </header>

        <div className="app-detail-body">
          {FIELDS.map((f) => (
            <label key={f.name} className={f.type === 'textarea' ? 'field wide' : 'field'}>
              {/* A visible label on every field, never a placeholder standing in for one:
                  the placeholder disappears the moment there's a value in the box. */}
              <span>{f.label}</span>
              {f.type === 'textarea' ? (
                <textarea
                  name={f.name}
                  rows={'rows' in f ? f.rows : 3}
                  defaultValue={app[f.name] ?? ''}
                  placeholder={'placeholder' in f ? f.placeholder : undefined}
                />
              ) : (
                <input
                  type={f.type}
                  name={f.name}
                  required={'required' in f && f.required}
                  defaultValue={app[f.name] ?? ''}
                  placeholder={'placeholder' in f ? f.placeholder : undefined}
                />
              )}
            </label>
          ))}
        </div>

        <footer className="app-detail-foot">
          <button disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="secondary" onClick={() => ref.current?.close()}>Cancel</button>
        </footer>
      </form>
    </dialog>
  )
}
