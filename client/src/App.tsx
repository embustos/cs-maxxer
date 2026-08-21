import { useState, useEffect, useCallback } from 'react'
import type { User, BootstrapPayload } from '@/types'
import { api, getToken, clearToken } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Onboarding from './pages/Onboarding'
import './App.css'

const today = () => new Date().toLocaleDateString('en-CA')

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [boot, setBoot] = useState<BootstrapPayload | null>(null)
  // No token means nothing to check — derive that up front rather than setting it
  // inside the effect, which would cost an extra render pass.
  const [checking, setChecking] = useState(() => !!getToken())

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

  // ponytail: still no router. Three views, two booleans. react-router when a view
  // needs its own URL.
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
