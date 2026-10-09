import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatTimestamp } from '../format';
import type { AuditEntry } from '../types';

const FILTERS = [
  { value: '', label: 'Everything I can see' },
  { value: 'WORKSHOP', label: 'Workshop changes' },
  { value: 'REGISTRATION', label: 'Registrations' },
  { value: 'USER', label: 'Account changes' },
] as const;

export function ActivityPage() {
  const { user } = useAuth();
  const [entityType, setEntityType] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Administrators only see account history; managers see the whole trail.
  const available = FILTERS.filter((filter) =>
    user?.role === 'ADMIN' ? filter.value === '' || filter.value === 'USER' : true,
  );

  useEffect(() => {
    let active = true;
    setEntries(null);
    setError(null);
    api
      .listAudit(entityType || undefined)
      .then(({ audit }) => {
        if (active) setEntries(audit);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load the activity log.');
      });
    return () => {
      active = false;
    };
  }, [entityType]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Activity log</h1>
          <p className="muted">Who changed what, and when.</p>
        </div>
        <label className="field field-inline">
          <span className="field-label">Show</span>
          <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
            {available.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        {entries === null ? (
          <p className="loading-note">Loading activity...</p>
        ) : entries.length === 0 ? (
          <p className="muted">Nothing has been recorded yet.</p>
        ) : (
          <ul className="timeline">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="timeline-time">{formatTimestamp(entry.createdAt)}</span>
                <span className="timeline-body">
                  {entry.summary}
                  <small>
                    {entry.actor.name} ({entry.actor.email}) &middot; {entry.entityType}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
