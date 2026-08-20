import { useState } from 'react'
import { api, setToken } from '../api'

export default function Login({ onAuthed }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    // Which button was clicked decides the endpoint — one form, two actions.
    const path = e.nativeEvent.submitter.value
    const body = Object.fromEntries(new FormData(e.target))
    try {
      const { token } = await api(path, { method: 'POST', body })
      setToken(token)
      const { user } = await api('/auth/me')
      onAuthed(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
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
  )
}
