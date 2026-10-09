import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Field } from '../components/Field';
import { ROLE_LABELS, formatTimestamp } from '../format';
import type { Role, User } from '../types';

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'STAFF'];

export function AccountsPage() {
  const { notify } = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const { users: rows } = await api.listUsers();
      setUsers(rows);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load staff accounts.');
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Staff accounts</h1>
          <p className="muted">
            There is no public signup. You create every account here and set its role.
          </p>
        </div>
      </div>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <CreateAccountPanel
        onCreated={(user) => {
          notify(`${user.name} can now sign in as ${ROLE_LABELS[user.role]}.`, 'success');
          void reload();
        }}
      />

      <section className="card">
        <div className="card-head">
          <h2>Accounts ({users?.length ?? 0})</h2>
        </div>
        {users === null ? (
          <p className="loading-note">Loading accounts...</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Access</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <AccountRow
                    key={user.id}
                    user={user}
                    isSelf={user.id === currentUser?.id}
                    onSaved={(message) => {
                      notify(message, 'success');
                      void reload();
                    }}
                    onFailed={(message) => notify(message, 'error')}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const ROLE_ACCESS: Record<Role, string> = {
  ADMIN: 'Staff accounts',
  MANAGER: 'Workshops, attendees, activity log',
  STAFF: 'Register and cancel attendees',
};

function CreateAccountPanel({ onCreated }: { onCreated: (user: User) => void }) {
  const [draft, setDraft] = useState({ name: '', email: '', role: 'STAFF' as Role, password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.createUser(draft);
      onCreated(user);
      setDraft({ name: '', email: '', role: 'STAFF', password: '' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create that account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>New account</h2>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <Field label="Full name">
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            required
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            required
          />
        </Field>
        <Field label="Role">
          <select
            value={draft.role}
            onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]} - {ROLE_ACCESS[role]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Temporary password" hint="At least 8 characters. Share it with them directly.">
          <input
            type="text"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            required
          />
        </Field>

        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating...' : 'Create account'}
          </button>
        </div>
      </form>
    </section>
  );
}

function AccountRow({
  user,
  isSelf,
  onSaved,
  onFailed,
}: {
  user: User;
  isSelf: boolean;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}) {
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const patch: { role?: Role; isActive?: boolean; password?: string } = {};
    if (role !== user.role) patch.role = role;
    if (isActive !== user.isActive) patch.isActive = isActive;
    if (password) patch.password = password;
    if (Object.keys(patch).length === 0) {
      onFailed('Nothing to change for that account.');
      setBusy(false);
      return;
    }
    try {
      await api.updateUser(user.id, patch);
      onSaved(`${user.name}'s account updated.`);
      setPassword('');
    } catch (caught) {
      onFailed(caught instanceof Error ? caught.message : 'Could not update that account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <div className="cell-title">{user.name}</div>
        <span className="cell-sub">{user.email}</span>
      </td>
      <td>
        <select
          className="inline-select"
          value={role}
          disabled={isSelf}
          onChange={(event) => setRole(event.target.value as Role)}
          aria-label={`Role for ${user.name}`}
        >
          {ROLES.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option]}
            </option>
          ))}
        </select>
      </td>
      <td className="muted small">{ROLE_ACCESS[user.role]}</td>
      <td className="muted small">{formatTimestamp(user.createdAt)}</td>
      <td>
        <label className="switch">
          <input
            type="checkbox"
            checked={isActive}
            disabled={isSelf}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <span>{isActive ? 'Active' : 'Off'}</span>
        </label>
      </td>
      <td>
        <div className="row-actions">
          <input
            type="text"
            className="inline-input"
            placeholder="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-label={`New password for ${user.name}`}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void save()}
            disabled={busy || isSelf}
          >
            Save
          </button>
        </div>
      </td>
    </tr>
  );
}
