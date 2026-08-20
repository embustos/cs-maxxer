import { useState, useEffect } from 'react'
import { api, getToken, clearToken } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import './App.css'

export default function App() {
  const [user, setUser] = useState(null)
  // No token means nothing to check — derive that up front rather than setting it
  // inside the effect, which would cost an extra render pass.
  const [checking, setChecking] = useState(() => !!getToken())

  // A token sitting in localStorage proves nothing — it may be expired, or edited.
  // Only the server can say. Until it answers we render nothing, so a stale token
  // never flashes the dashboard.
  useEffect(() => {
    if (!getToken()) return
    api('/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => clearToken())
      .finally(() => setChecking(false))
  }, [])

  if (checking) return null

  // ponytail: no router. Two views, one boolean. Add react-router at the third page.
  return user ? (
    <Dashboard
      user={user}
      onLogout={() => {
        clearToken()
        setUser(null)
      }}
    />
  ) : (
    <Login onAuthed={setUser} />
  )
}
