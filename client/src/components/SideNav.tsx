import { NavLink } from 'react-router-dom'
import { LINKS } from '@/lib/nav'

export default function SideNav({ username, onLogout }: { username: string; onLogout: () => void }) {
  return (
    <nav className="sidenav" aria-label="Sections">
      <div className="sidenav-brand">cs maxxer</div>

      <ul className="sidenav-links">
        {LINKS.map(({ to, label, Icon, end }) => (
          <li key={to}>
            {/* aria-current tells a screen reader which section it's in; the class is
                what says the same thing visually. Both, not one. */}
            <NavLink to={to} end={end} className={({ isActive }) => `sidenav-link${isActive ? ' active' : ''}`}>
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="sidenav-foot">
        <span className="muted small">{username}</span>
        <button className="secondary small-btn" onClick={onLogout}>Log out</button>
      </div>
    </nav>
  )
}
