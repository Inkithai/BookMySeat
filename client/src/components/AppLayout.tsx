import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { ROLE_LABELS, initials } from '../format';

/** Shell shared by every signed-in page: header, navigation and the user chip. */
export function AppLayout() {
  const { user, signOut } = useAuth();

  const links = [
    { to: '/', label: 'Workshops', roles: ['MANAGER', 'STAFF'] },
    { to: '/activity', label: 'Activity log', roles: ['ADMIN', 'MANAGER'] },
    { to: '/accounts', label: 'Staff accounts', roles: ['ADMIN'] },
  ].filter((link) => (user ? link.roles.includes(user.role) : false));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              BMS
            </span>
            <span className="brand-text">
              <strong>BookMySeat</strong>
              <small>Workshop Registration System</small>
            </span>
          </div>

          {user && (
            <nav className="app-nav" aria-label="Main">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          )}

          {user && (
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">
                {initials(user.name)}
              </span>
              <span className="user-chip-text">
                <strong>{user.name}</strong>
                <small>{ROLE_LABELS[user.role] ?? user.role}</small>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
