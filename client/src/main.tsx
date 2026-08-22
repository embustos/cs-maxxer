import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// The router wraps the whole app, not just the dashboard: a deep link like
// /applications must survive the login gate — you land on Login, sign in, and the
// dashboard's routes then resolve the path you originally asked for.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
