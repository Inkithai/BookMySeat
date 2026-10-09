import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Field } from '../components/Field';
import {
  addDays,
  nextDaysRange,
  relativeDayLabel,
  STATUS_LABELS,
  formatDate,
  formatDuration,
  formatTime,
  todayDate,
} from '../format';
import type { NewWorkshop, Workshop, WorkshopFilters, WorkshopStatus } from '../types';

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Monday of the current week. */
function startOfWeek(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const current = new Date(year, month - 1, day);
  const weekday = (current.getDay() + 6) % 7;
  return addDays(date, -weekday);
}

const EMPTY_WORKSHOP: NewWorkshop = {
  code: '',
  title: '',
  instructor: '',
  startsAt: `${todayDate()}T18:00`,
  durationMinutes: 120,
  capacity: 12,
  status: 'SCHEDULED',
  location: '',
  notes: '',
};

export function WorkshopsPage() {
  const { user } = useAuth();
  const { notify } = useToast();

  const [filters, setFilters] = useState<WorkshopFilters>({});
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 250);

  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);

  const canManageWorkshops = user?.role === 'MANAGER';

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .listWorkshops({ ...filters, q: debouncedSearch.trim() || undefined })
      .then(({ workshops: rows }) => {
        if (!active) return;
        setWorkshops(rows);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Could not load workshops.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, debouncedSearch]);

  const summary = useMemo(() => {
    const upcoming = workshops.filter((workshop) => workshop.status === 'SCHEDULED').length;
    const withSeats = workshops.filter(
      (workshop) => workshop.status === 'SCHEDULED' && workshop.seatsRemaining > 0,
    ).length;
    return { total: workshops.length, upcoming, withSeats };
  }, [workshops]);

  function updateFilters(patch: Partial<WorkshopFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  const hasActiveFilters =
    Boolean(search.trim()) ||
    Boolean(filters.status) ||
    Boolean(filters.from) ||
    Boolean(filters.to) ||
    Boolean(filters.hasSeats);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Workshop Dashboard</h1>
          <p className="muted">
            {summary.total} workshop{summary.total === 1 ? '' : 's'} shown &middot; {summary.upcoming}{' '}
            upcoming &middot; {summary.withSeats} with seats free
          </p>
        </div>
        {canManageWorkshops && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreate((open) => !open)}
          >
            {showCreate ? 'Close' : 'New workshop'}
          </button>
        )}
      </div>

      {showCreate && canManageWorkshops && (
        <CreateWorkshopPanel
          onCreated={(workshop) => {
            setShowCreate(false);
            notify(`${workshop.code} - ${workshop.title} has been added.`, 'success');
            setFilters({});
            setSearch('');
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <section className="card filters" aria-label="Find workshops">
        <div className="filters-row">
          <label className="field field-grow">
            <span className="field-label">Search</span>
            <input
              type="search"
              value={search}
              placeholder="Title, code or instructor"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Status</span>
            <select
              value={filters.status ?? ''}
              onChange={(event) =>
                updateFilters({ status: (event.target.value || undefined) as WorkshopStatus | undefined })
              }
            >
              <option value="">All statuses</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>

          <label className="field">
            <span className="field-label">From</span>
            <input
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => updateFilters({ from: event.target.value || undefined })}
            />
          </label>

          <label className="field">
            <span className="field-label">To</span>
            <input
              type="date"
              value={filters.to ?? ''}
              onChange={(event) => updateFilters({ to: event.target.value || undefined })}
            />
          </label>
        </div>

        <div className="filters-row filters-quick">
          <button
            type="button"
            className="chip"
            onClick={() => updateFilters({ from: startOfWeek(todayDate()), to: addDays(startOfWeek(todayDate()), 6) })}
          >
            This week
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => updateFilters(nextDaysRange(7))}
          >
            Next 7 days
          </button>
          <button
            type="button"
            className={filters.hasSeats ? 'chip chip-on' : 'chip'}
            aria-pressed={Boolean(filters.hasSeats)}
            onClick={() => updateFilters({ hasSeats: !filters.hasSeats })}
          >
            Seats available
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              className="chip chip-clear"
              onClick={() => {
                setFilters({});
                setSearch('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="loading-note">Loading workshops...</p>
      ) : workshops.length === 0 ? (
        <div className="card empty-state">
          <h2>No workshops match those filters</h2>
          <p className="muted">Try widening the date range or clearing the search.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Workshop</th>
                <th scope="col">When</th>
                <th scope="col">Seats</th>
                <th scope="col">Availability</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {workshops.map((workshop) => (
                <tr key={workshop.id}>
                  <td>
                    <div className="cell-title">
                      <Link to={`/workshops/${workshop.id}`}>{workshop.title}</Link>
                      <span className="cell-sub">
                        <code>{workshop.code}</code> &middot; {workshop.instructor}
                        {workshop.location && ` · ${workshop.location}`}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="cell-title">{formatDate(workshop.startsAt)}</div>
                    <span className="cell-sub">
                      {formatTime(workshop.startsAt)} &middot; {formatDuration(workshop.durationMinutes)}
                      {relativeDayLabel(workshop.startsAt.slice(0, 10)) &&
                        ` · ${relativeDayLabel(workshop.startsAt.slice(0, 10))}`}
                    </span>
                  </td>
                  <td>
                    <div className="cell-title">
                      {workshop.registeredCount} / {workshop.capacity}
                    </div>
                    <span className="cell-sub">
                      {workshop.waitlistCount > 0
                        ? `${workshop.waitlistCount} waiting`
                        : 'no waitlist'}
                    </span>
                  </td>
                  <td>
                    <CapacityBar workshop={workshop} />
                  </td>
                  <td>
                    <span className={`badge badge-${workshop.status.toLowerCase()}`}>
                      {STATUS_LABELS[workshop.status]}
                    </span>
                  </td>
                  <td>
                    <Link className="btn btn-ghost btn-sm" to={`/workshops/${workshop.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CapacityBar({ workshop }: { workshop: Workshop }) {
  const percent = workshop.capacity === 0 ? 0 : Math.round((workshop.registeredCount / workshop.capacity) * 100);
  const tone = workshop.seatsRemaining === 0 ? 'full' : percent >= 75 ? 'high' : 'ok';
  return (
    <div className="capacity">
      <div className="capacity-track" aria-hidden="true">
        <div className={`capacity-fill capacity-${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <span className={`capacity-label capacity-${tone}`}>
        {workshop.seatsRemaining === 0
          ? 'Full'
          : `${workshop.seatsRemaining} seat${workshop.seatsRemaining === 1 ? '' : 's'} free`}
      </span>
    </div>
  );
}

function CreateWorkshopPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (workshop: Workshop) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<NewWorkshop>(EMPTY_WORKSHOP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workshop } = await api.createWorkshop(draft);
      onCreated(workshop);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the workshop.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>New workshop</h2>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <Field label="Code">
          <input
            value={draft.code}
            onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })}
            placeholder="POT-101"
            required
          />
        </Field>
        <Field label="Title">
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="Pottery Basics"
            required
          />
        </Field>
        <Field label="Instructor">
          <input
            value={draft.instructor}
            onChange={(event) => setDraft({ ...draft, instructor: event.target.value })}
            required
          />
        </Field>
        <Field label="Location">
          <input
            value={draft.location}
            onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            placeholder="Riverside Studio"
          />
        </Field>
        <Field label="Starts">
          <input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
            required
          />
        </Field>
        <Field label="Duration (minutes)">
          <input
            type="number"
            min={15}
            max={480}
            step={15}
            value={draft.durationMinutes}
            onChange={(event) => setDraft({ ...draft, durationMinutes: Number(event.target.value) })}
            required
          />
        </Field>
        <Field label="Capacity (seats)">
          <input
            type="number"
            min={1}
            max={500}
            value={draft.capacity}
            onChange={(event) => setDraft({ ...draft, capacity: Number(event.target.value) })}
            required
          />
        </Field>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value as WorkshopStatus })}
          >
            <option value="SCHEDULED">Scheduled</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </Field>
        <Field label="Notes">
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </Field>

        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Create workshop'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
