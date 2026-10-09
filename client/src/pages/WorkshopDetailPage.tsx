import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Field } from '../components/Field';
import {
  STATUS_LABELS,
  formatDate,
  formatDuration,
  formatTime,
  formatTimestamp,
  toDateTimeInputValue,
} from '../format';
import type { NewWorkshop, Registration, WorkshopDetail, WorkshopStatus } from '../types';

export function WorkshopDetailPage() {
  const { id } = useParams();
  const workshopId = Number(id);
  const { user } = useAuth();
  const { notify } = useToast();

  const [workshop, setWorkshop] = useState<WorkshopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const canManageWorkshops = user?.role === 'MANAGER';

  const reload = useCallback(() => {
    let active = true;
    setLoading(true);
    api
      .getWorkshop(workshopId)
      .then(({ workshop: detail }) => {
        if (!active) return;
        setWorkshop(detail);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : 'Could not load that workshop.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workshopId]);

  useEffect(() => {
    const cleanup = reload();
    return cleanup;
  }, [reload]);

  if (loading && !workshop) return <p className="loading-note">Loading workshop...</p>;
  if (error && !workshop) {
    return (
      <div className="page">
        <p className="alert alert-error" role="alert">
          {error}
        </p>
        <Link className="btn btn-ghost" to="/">
          Back to workshops
        </Link>
      </div>
    );
  }
  if (!workshop) return null;

  const attending = workshop.registrations.filter((row) => row.status === 'REGISTERED');
  const waiting = workshop.registrations.filter((row) => row.status === 'WAITLISTED');
  const cancelled = workshop.registrations.filter((row) => row.status === 'CANCELLED');
  const closed = workshop.status !== 'SCHEDULED';

  return (
    <div className="page">
      <Link className="back-link" to="/">
        &larr; All workshops
      </Link>

      <div className="page-head">
        <div>
          <p className="eyebrow">
            <code>{workshop.code}</code>
          </p>
          <h1>{workshop.title}</h1>
          <p className="muted">
            {workshop.instructor}
            {workshop.location && ` · ${workshop.location}`}
          </p>
        </div>
        <div className="head-actions">
          <span className={`badge badge-${workshop.status.toLowerCase()}`}>
            {STATUS_LABELS[workshop.status]}
          </span>
          {canManageWorkshops && (
            <button type="button" className="btn btn-ghost" onClick={() => setEditing((open) => !open)}>
              {editing ? 'Close editor' : 'Edit workshop'}
            </button>
          )}
        </div>
      </div>

      {editing && canManageWorkshops && (
        <EditWorkshopPanel
          workshop={workshop}
          onSaved={() => {
            setEditing(false);
            notify('Workshop details updated.', 'success');
            reload();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <section className="detail-grid">
        <article className="card stat-card">
          <h2>Seats</h2>
          <p className="stat-value">
            {workshop.registeredCount}
            <span className="stat-total"> / {workshop.capacity}</span>
          </p>
          <p className={workshop.seatsRemaining === 0 ? 'stat-note is-full' : 'stat-note'}>
            {workshop.seatsRemaining === 0
              ? 'Full - new registrations join the waitlist'
              : `${workshop.seatsRemaining} seat${workshop.seatsRemaining === 1 ? '' : 's'} still free`}
          </p>
        </article>
        <article className="card stat-card">
          <h2>When</h2>
          <p className="stat-value stat-value-sm">{formatDate(workshop.startsAt)}</p>
          <p className="stat-note">
            {formatTime(workshop.startsAt)} &middot; {formatDuration(workshop.durationMinutes)}
          </p>
        </article>
        <article className="card stat-card">
          <h2>Waitlist</h2>
          <p className="stat-value">{workshop.waitlistCount}</p>
          <p className="stat-note">
            {workshop.waitlistCount === 0 ? 'nobody waiting' : 'in the queue'}
          </p>
        </article>
      </section>

      {workshop.notes && (
        <section className="card">
          <h2>Notes</h2>
          <p className="notes">{workshop.notes}</p>
        </section>
      )}

      <RegisterAttendeePanel
        workshop={workshop}
        disabled={closed}
        onRegistered={(message) => {
          notify(message, 'success');
          reload();
        }}
      />

      <section className="card">
        <div className="card-head">
          <h2>Attending ({attending.length})</h2>
        </div>
        {attending.length === 0 ? (
          <p className="muted">Nobody has registered for this workshop yet.</p>
        ) : (
          <ul className="record-list">
            {attending.map((registration) => (
              <RegistrationRow
                key={registration.id}
                registration={registration}
                onCancelled={(message) => {
                  notify(message, 'success');
                  reload();
                }}
                onFailed={(message) => notify(message, 'error')}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Waitlist ({waiting.length})</h2>
          <p className="muted small">First in line gets the next seat that is freed.</p>
        </div>
        {waiting.length === 0 ? (
          <p className="muted">Nobody is waiting for a seat.</p>
        ) : (
          <ul className="record-list">
            {waiting.map((registration) => (
              <RegistrationRow
                key={registration.id}
                registration={registration}
                showPromote
                onCancelled={(message) => {
                  notify(message, 'success');
                  reload();
                }}
                onPromoted={(message) => {
                  notify(message, 'success');
                  reload();
                }}
                onFailed={(message) => notify(message, 'error')}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Cancelled ({cancelled.length})</h2>
          <p className="muted small">Cancellations are kept, never deleted.</p>
        </div>
        {cancelled.length === 0 ? (
          <p className="muted">No cancellations for this workshop.</p>
        ) : (
          <ul className="record-list">
            {cancelled.map((registration) => (
              <RegistrationRow key={registration.id} registration={registration} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Recent activity</h2>
        </div>
        {workshop.recentActivity.length === 0 ? (
          <p className="muted">Nothing recorded for this workshop yet.</p>
        ) : (
          <ul className="timeline">
            {workshop.recentActivity.map((entry) => (
              <li key={entry.id}>
                <span className="timeline-time">{formatTimestamp(entry.createdAt)}</span>
                <span className="timeline-body">
                  {entry.summary}
                  <small>
                    {entry.actor.name} ({entry.actor.email})
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

function RegisterAttendeePanel({
  workshop,
  disabled,
  onRegistered,
}: {
  workshop: WorkshopDetail;
  disabled: boolean;
  onRegistered: (message: string) => void;
}) {
  const [attendeeName, setAttendeeName] = useState('');
  const [attendeeEmail, setAttendeeEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.registerAttendee(workshop.id, attendeeName.trim(), attendeeEmail.trim());
      onRegistered(
        result.waitlisted
          ? `${attendeeName} is number ${result.registration.waitlistPosition} on the waitlist.`
          : `${attendeeName} is registered - ${result.seatsRemaining} seat(s) left.`,
      );
      setAttendeeName('');
      setAttendeeEmail('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not register that attendee.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Register an attendee</h2>
        <p className="muted small">Attendees do not need an account - a name and email is enough.</p>
      </div>
      {disabled && (
        <p className="alert alert-info">
          This workshop is {STATUS_LABELS[workshop.status].toLowerCase()}, so it cannot take new
          registrations.
        </p>
      )}
      <form className="form-inline" onSubmit={onSubmit} noValidate>
        <Field label="Attendee name">
          <input
            value={attendeeName}
            onChange={(event) => setAttendeeName(event.target.value)}
            placeholder="Amara Okafor"
            disabled={disabled}
            required
          />
        </Field>
        <Field label="Attendee email">
          <input
            type="email"
            value={attendeeEmail}
            onChange={(event) => setAttendeeEmail(event.target.value)}
            placeholder="amara@example.com"
            disabled={disabled}
            required
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
          {busy ? 'Saving...' : 'Register'}
        </button>
      </form>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function RegistrationRow({
  registration,
  showPromote = false,
  onCancelled,
  onPromoted,
  onFailed,
}: {
  registration: Registration;
  showPromote?: boolean;
  onCancelled?: (message: string) => void;
  onPromoted?: (message: string) => void;
  onFailed?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      const result = await api.cancelRegistration(registration.id);
      onCancelled?.(
        result.promoted
          ? `Seat freed and offered to ${result.promoted.attendeeName}.`
          : 'Registration cancelled. The record is kept in the history.',
      );
    } catch (caught) {
      // A failure must not look like a success: the toast is an error and the
      // list is left alone rather than reloaded from a possibly stale view.
      onFailed?.(caught instanceof Error ? caught.message : 'Could not cancel that registration.');
    } finally {
      setBusy(false);
    }
  }

  async function promote() {
    setBusy(true);
    try {
      await api.promoteRegistration(registration.id);
      onPromoted?.(`${registration.attendeeName} now has a seat.`);
    } catch (caught) {
      onFailed?.(caught instanceof Error ? caught.message : 'Could not offer that seat.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="record">
      <div className="record-main">
        <strong>{registration.attendeeName}</strong>
        <a href={`mailto:${registration.attendeeEmail}`}>{registration.attendeeEmail}</a>
      </div>
      <div className="record-meta">
        {registration.status === 'WAITLISTED' && registration.waitlistPosition && (
          <span className="badge badge-waitlist">#{registration.waitlistPosition} in line</span>
        )}
        {registration.status === 'CANCELLED' ? (
          <span className="muted small">
            Cancelled {registration.cancelledAt ? formatTimestamp(registration.cancelledAt) : ''}
            {registration.cancelledBy && ` by ${registration.cancelledBy.name}`}
          </span>
        ) : (
          <span className="muted small">
            Registered {formatTimestamp(registration.registeredAt)} by {registration.registeredBy.name}
          </span>
        )}
      </div>
      <div className="record-actions">
        {showPromote && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void promote()} disabled={busy}>
            Give seat
          </button>
        )}
        {registration.status !== 'CANCELLED' && onCancelled && (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void cancel()} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </li>
  );
}

function EditWorkshopPanel({
  workshop,
  onSaved,
  onCancel,
}: {
  workshop: WorkshopDetail;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    title: workshop.title,
    instructor: workshop.instructor,
    location: workshop.location,
    startsAt: toDateTimeInputValue(workshop.startsAt),
    durationMinutes: workshop.durationMinutes,
    capacity: workshop.capacity,
    status: workshop.status,
    notes: workshop.notes,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.updateWorkshop(workshop.id, draft as Partial<NewWorkshop>);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save those changes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Edit workshop</h2>
      <p className="muted small">
        Capacity cannot be set below the {workshop.registeredCount} seat(s) already booked.
      </p>
      <form className="form-grid" onSubmit={onSubmit} noValidate>
        <Field label="Title">
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
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
          />
        </Field>
        <Field label="Capacity (seats)">
          <input
            type="number"
            min={1}
            max={500}
            value={draft.capacity}
            onChange={(event) => setDraft({ ...draft, capacity: Number(event.target.value) })}
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
            {busy ? 'Saving...' : 'Save changes'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
