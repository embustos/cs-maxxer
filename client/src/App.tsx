import { useState, useEffect, useCallback } from 'react'
import type { User, BootstrapPayload } from '@/types'
import { api, getToken, clearToken } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Onboarding from './pages/Onboarding'
import EmailAction from './pages/EmailAction'
import './App.css'

const today = () => new Date().toLocaleDateString('en-CA')

// Emailed links use the query string (?reset=, ?verify=) rather than routes, and stay
// that way even now that a router exists: the format is already in sent emails, and a
// token does not belong in a path segment where every log line and Referer header keeps
// it. This runs ahead of the router's own matching, which never sees these URLs.
const emailLink = () => {
  const q = new URLSearchParams(window.location.search)
  for (const kind of ['reset', 'verify'] as const) {
    const token = q.get(kind)
    if (token) return { kind, token }
  }
  return null
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [boot, setBoot] = useState<BootstrapPayload | null>(null)
  // No token means nothing to check — derive that up front rather than setting it
  // inside the effect, which would cost an extra render pass.
  const [checking, setChecking] = useState(() => !!getToken())
  const [link, setLink] = useState(emailLink)

  // Strip the token out of the address bar as soon as it's been read. Left there it ends
  // up in browser history, in a screenshot, or pasted into a bug report.
  const clearLink = useCallback(() => {
    window.history.replaceState(null, '', window.location.pathname)
    setLink(null)
  }, [])

  // A token sitting in localStorage proves nothing — it may be expired, or edited.
  // Only the server can say. Until it answers we render nothing, so a stale token
  // never flashes the dashboard.
  //
  // This asks /bootstrap rather than /auth/me because it needs the same authority check
  // and the dashboard's data lands with it. Asking "who am I?" and then, once that
  // answered, asking for seven lists was two round trips where one does.
  useEffect(() => {
    if (!getToken()) return
    api<BootstrapPayload>(`/bootstrap?today=${today()}`)
      .then((payload) => {
        setUser(payload.user)
        setBoot(payload)
      })
      .catch(() => clearToken())
      .finally(() => setChecking(false))
  }, [])

  // Login hands back the user with the token, so there's no second request to identify
  // them. The dashboard data still has to be fetched — but by then it's the only thing
  // left to wait for.
  const onAuthed = useCallback((u: User) => {
    setUser(u)
    setBoot(null)
  }, [])

  if (checking) return null

  // Ahead of the auth gate: a reset link is precisely for someone who cannot log in, and
  // a verify link should work whether or not this browser has a session.
  if (link) {
    return (
      <EmailAction
        kind={link.kind}
        token={link.token}
        onAuthed={(u) => {
          clearLink()
          onAuthed(u)
        }}
        onDone={clearLink}
      />
    )
  }

  if (!user) return <Login onAuthed={onAuthed} />

  // A brand-new account goes through the survey first, so the dashboard it lands on is
  // populated rather than five empty cards. onboarded_at survives a reload because it
  // comes from the server, so this can't be skipped by refreshing.
  if (!user.onboarded_at) {
    return (
      <Onboarding
        user={user}
        onDone={() => setUser({ ...user, onboarded_at: new Date().toISOString() })}
      />
    )
  }

  // The router lives inside Dashboard (section pages under /). The auth gates above
  // stay plain conditionals — Login and Onboarding are states, not places.
  return (
    <Dashboard
      user={user}
      initial={boot ?? undefined}
      onLogout={() => {
        clearToken()
        setUser(null)
        setBoot(null)
      }}
    />
  )
}
