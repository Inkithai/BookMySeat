import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';

const DEMO_ACCOUNTS = [
  { role: 'Administrator', email: 'admin@bookmyseat.test', password: 'Admin123!', access: 'Staff accounts' },
  { role: 'Manager', email: 'manager@bookmyseat.test', password: 'Manager123!', access: 'Workshops, attendees, activity log' },
  { role: 'Front desk', email: 'staff@bookmyseat.test', password: 'Staff123!', access: 'Register and cancel attendees' },
];

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function useAccount(accountEmail: string, accountPassword: string) {
    setEmail(accountEmail);
    setPassword(accountPassword);
    setError(null);
  }

  return (
    <div className="login-shell">
      <section className="login-intro">
        <span className="brand-mark brand-mark-lg" aria-hidden="true">
          BMS
        </span>
        <h1>BookMySeat</h1>
        <p className="login-tagline">Every seat. Every workshop. Sorted.</p>
        <p>
          Manage workshops, register attendees, track availability and never overbook a seat - all
          in one place.
        </p>
        <ul className="login-points">
          <li>Three roles, enforced by the server</li>
          <li>Full registration history, including cancellations</li>
          <li>Waitlist when a workshop fills up</li>
        </ul>
      </section>

      <section className="login-card">
        <h2>Sign in</h2>
        <p className="muted">Use the account your administrator set up for you.</p>

        <form onSubmit={onSubmit} noValidate>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="demo-accounts">
          <h3>Demo accounts</h3>
          <p className="muted small">
            Sample data for this assessment - not for real use. Click one to fill the form.
          </p>
          <ul>
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  className="demo-account"
                  onClick={() => useAccount(account.email, account.password)}
                >
                  <span>
                    <strong>{account.role}</strong>
                    <small>{account.access}</small>
                  </span>
                  <code>{account.email}</code>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
