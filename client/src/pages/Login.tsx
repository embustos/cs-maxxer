import { useState } from 'react'
import type { User } from '@/types'
import { api, ApiError, setToken } from '../api'
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
  // Green informational state (mail sent, account created) as opposed to `error` — the
  // difference between "something happened, check your inbox" and "fix your input".
  const [notice, setNotice] = useState('')
  // Set when login says the email has no account, so switching to register carries it
  // over — retyping the address you just typed is pure friction.
  const [prefillEmail, setPrefillEmail] = useState('')
  const [offerRegister, setOfferRegister] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setOfferRegister(false)
    setBusy(true)
    const body = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    try {
      if (forgot) {
        await api('/auth/forgot', { method: 'POST', body })
        // The server answers identically whether or not that address has an account —
        // there is nothing useful to disclose here, so the message stays conditional.
        setNotice('If that address has an account, a reset link is on its way. It expires in an hour.')
        return
      }

      if (registering) {
        // No token comes back — the account belongs to whoever reads the inbox, and
        // the emailed link is what signs them in (and proves it's really their email).
        await api('/auth/register', { method: 'POST', body })
        setNotice(`Account created. Check ${body.email} for the confirmation link — clicking it signs you straight in.`)
        return
      }

      const { token, user } = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body,
      })
      setToken(token)
      onAuthed(user)
    } catch (err) {
      // The server names which thing went wrong (a designated code, not just prose), so
      // the form can offer the fix instead of making the user guess which field to retry.
      const code = err instanceof ApiError ? err.data.code : undefined
      if (code === 'no_account') {
        setError('No account with that email.')
        setPrefillEmail(body.email)
        setOfferRegister(true)
      } else if (code === 'unverified') {
        setNotice('Confirm your email first — we just sent you a fresh link.')
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  // Every mode switch clears the leftovers. An error from a failed login sitting above
  // the signup form describes a problem that no longer exists.
  function switchTo(next: typeof mode) {
    setMode(next)
    setError('')
    setNotice('')
    setOfferRegister(false)
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
          {/* key: switching modes remounts the fields, so defaultValue re-applies and the
              conditional username input can't inherit a neighbour's DOM state. */}
          <form onSubmit={submit} key={mode}>
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
            <input
              name="email"
              type="email"
              placeholder="you@school.edu"
              required
              autoComplete="email"
              defaultValue={prefillEmail}
            />
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
            <button className="wide" disabled={busy || !!notice}>
              {forgot ? 'Send reset link' : registering ? 'Create account' : 'Log in'}
            </button>
          </form>

          {error && (
            <p className="error" role="alert">
              {error}
              {offerRegister && (
                <button type="button" className="link" onClick={() => switchTo('register')}>
                  Create one?
                </button>
              )}
            </p>
          )}
          {notice && (
            <p className="centered small" role="status">
              {notice}
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
