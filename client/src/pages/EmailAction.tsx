import { useState, useEffect, useRef } from 'react'
import type { User } from '@/types'
import { api, setToken } from '../api'
import { errorMessage } from '@/lib/utils'
import { NeonMesh } from '@/components/ui/neon-mesh'

/**
 * The landing page for a link we mailed someone — either a password reset or an email
 * confirmation. One component because the two differ only in what happens after the
 * token is accepted: reset needs a new password first, verify needs nothing at all.
 */
export default function EmailAction({
  kind,
  token,
  onAuthed,
  onDone,
}: {
  kind: 'reset' | 'verify'
  token: string
  onAuthed: (user: User) => void
  onDone: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(kind === 'verify')

  // Verification has nothing to ask the user, so it runs on arrival. Reset waits for a
  // password.
  //
  // The ref is not optional. StrictMode runs effects twice in development, and this one
  // SPENDS a single-use token — the second call redeems an already-redeemed token and
  // fails, so the page rendered "Email confirmed" and "that link has already been used"
  // at the same time. A double-fire is wrong here for the same reason a double-charge is.
  const fired = useRef(false)
  useEffect(() => {
    if (kind !== 'verify' || fired.current) return
    fired.current = true
    // Verify returns a session — clicking the emailed link is the strongest ownership
    // proof this app gets, and for a fresh account it IS the first login.
    api<{ token: string; user: User }>('/auth/verify', { method: 'POST', body: { token } })
      .then((res) => {
        setToken(res.token)
        onAuthed(res.user)
      })
      .catch((err) => {
        setError(errorMessage(err))
        setBusy(false)
      })
  }, [kind, token, onAuthed])

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { password } = Object.fromEntries(new FormData(e.currentTarget)) as { password: string }
    try {
      // Proving control of the inbox is proof enough — the server signs them straight in
      // rather than bouncing them to a login form to retype what they just chose.
      const res = await api<{ token: string; user: User }>('/auth/reset', {
        method: 'POST',
        body: { token, password },
      })
      setToken(res.token)
      onAuthed(res.user)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <NeonMesh variant="hero">
      <div className="auth-wrap">
        <div className="auth">
          <h1>cs maxxer</h1>

          {kind === 'verify' ? (
            <>
              <p className="tagline">{busy ? 'Confirming your email…' : 'That link didn’t work.'}</p>
              {!busy && (
                <button className="wide" onClick={onDone}>
                  Back to log in
                </button>
              )}
            </>
          ) : (
            <>
              <p className="tagline">Choose a new password.</p>
              <form onSubmit={submit}>
                <input
                  name="password"
                  type="password"
                  placeholder="new password (8+ characters)"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  autoFocus
                />
                <button className="wide" disabled={busy}>
                  {busy ? 'Saving…' : 'Set password'}
                </button>
              </form>
            </>
          )}

          {error && <p className="error" role="alert">{error}</p>}

          {kind === 'reset' && (
            <p className="centered small">
              <button type="button" className="link" onClick={onDone}>
                Back to log in
              </button>
            </p>
          )}
        </div>
      </div>
    </NeonMesh>
  )
}
