import { useState } from 'react'
import type { User } from '@/types'
import { api, setToken } from '../api'
import { errorMessage } from '@/lib/utils'
import { NeonMesh } from '@/components/ui/neon-mesh'

export default function Login({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setBusy(true)
    // Which button was clicked decides the endpoint — one form, two actions.
    const path = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value
    const body = Object.fromEntries(new FormData(e.currentTarget))
    try {
      const { token } = await api<{ token: string }>(path, { method: 'POST', body })
      setToken(token)
      const { user } = await api<{ user: User }>('/auth/me')
      onAuthed(user)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <NeonMesh variant="hero">
      <div className="auth">
      <h1>cs-tracker</h1>
      <p className="tagline">Stay on top of what the market expects.</p>

      {/* ponytail: native form validation. type=email and minLength do this for free. */}
      <form onSubmit={submit}>
        <input name="email" type="email" placeholder="you@school.edu" required autoComplete="email" />
        <input
          name="password"
          type="password"
          placeholder="password (8+ characters)"
          required
          minLength={8}
          autoComplete="current-password"
        />
        <div className="row">
          <button value="/auth/login" disabled={busy}>Log in</button>
          <button value="/auth/register" className="secondary" disabled={busy}>
            Create account
          </button>
        </div>
      </form>

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </NeonMesh>
  )
}
