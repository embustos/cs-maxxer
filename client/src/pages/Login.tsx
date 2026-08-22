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
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const registering = mode === 'register'
  const forgot = mode === 'forgot'
  const [sent, setSent] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const body = Object.fromEntries(new FormData(e.currentTarget))
    try {
      if (forgot) {
        await api('/auth/forgot', { method: 'POST', body })
        // The server answers identically whether or not that address has an account, so
        // this message has to be vague on purpose. Saying "sent!" for a real address and
        // "no such user" for a fake one would hand out the account list one guess at a time.
        setSent(true)
        return
      }

      // Both endpoints return the user alongside the token — the server already knows
      // who just authenticated, so a follow-up "who am I?" request was a wasted trip.
      const { token, user } = await api<{ token: string; user: User }>(`/auth/${mode}`, {
        method: 'POST',
        body,
      })
      setToken(token)
      onAuthed(user)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Every mode switch clears the leftovers. An error from a failed login sitting above
  // the signup form describes a problem that no longer exists.
  function switchTo(next: typeof mode) {
    setMode(next)
    setError('')
    setSent(false)
  }

  return (
    <NeonMesh variant="hero">
      <div className="auth-wrap">
        <div className="auth">
          <h1>cs maxxer</h1>
          <p className="tagline">
            {forgot ? 'We’ll email you a link to set a new one.' : 'Stay on top of what the market expects.'}
          </p>

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
            {!forgot && (
              <input
                name="password"
                type="password"
                placeholder="password (8+ characters)"
                required
                minLength={8}
                autoComplete={registering ? 'new-password' : 'current-password'}
              />
            )}
            <button className="wide" disabled={busy || sent}>
              {forgot ? 'Send reset link' : registering ? 'Create account' : 'Log in'}
            </button>
          </form>

          {error && <p className="error" role="alert">{error}</p>}
          {sent && (
            <p className="centered small" role="status">
              If that address has an account, a reset link is on its way. It expires in an hour.
            </p>
          )}

          <p className="centered small">
            {forgot ? 'Remembered it?' : registering ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" className="link" onClick={() => switchTo(forgot || registering ? 'login' : 'register')}>
              {forgot || registering ? 'Log in' : 'Create an account'}
            </button>
          </p>

          {mode === 'login' && (
            <p className="centered small">
              <button type="button" className="link" onClick={() => switchTo('forgot')}>
                Forgot your password?
              </button>
            </p>
          )}
        </div>
      </div>
    </NeonMesh>
  )
}
