import { useState } from 'react'
import type { User } from '@/types'
import { api, setToken } from '../api'
import { errorMessage } from '@/lib/utils'
import { NeonMesh } from '@/components/ui/neon-mesh'

export default function Login({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Two buttons on one form worked while both endpoints took the same fields. Signing up
  // now needs a username that logging in must not ask for, so the form has a mode.
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const registering = mode === 'register'

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const body = Object.fromEntries(new FormData(e.currentTarget))
    try {
      const { token } = await api<{ token: string }>(`/auth/${mode}`, { method: 'POST', body })
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
      <div className="auth-wrap">
        <div className="auth">
          <h1>cs maxxer</h1>
          <p className="tagline">Stay on top of what the market expects.</p>

          {/* ponytail: native form validation. type=email, minLength and pattern do this for free. */}
          <form onSubmit={submit}>
            {registering && (
              <input
                name="username"
                placeholder="username"
                required
                minLength={3}
                maxLength={20}
                pattern="[A-Za-z0-9_]+"
                title="3-20 letters, numbers, or underscores"
                autoComplete="username"
              />
            )}
            <input name="email" type="email" placeholder="you@school.edu" required autoComplete="email" />
            <input
              name="password"
              type="password"
              placeholder="password (8+ characters)"
              required
              minLength={8}
              autoComplete={registering ? 'new-password' : 'current-password'}
            />
            <button className="wide" disabled={busy}>
              {registering ? 'Create account' : 'Log in'}
            </button>
          </form>

          {error && <p className="error" role="alert">{error}</p>}

          <p className="centered small">
            {registering ? 'Already have an account?' : 'New here?'}{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode(registering ? 'login' : 'register')
                setError('')
              }}
            >
              {registering ? 'Log in' : 'Create an account'}
            </button>
          </p>
        </div>
      </div>
    </NeonMesh>
  )
}
