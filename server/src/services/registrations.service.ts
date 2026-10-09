import type { Database } from '../db/index.js';
import { isCapacityError, isUniqueConstraintError, withTransaction } from '../db/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { nowIso } from '../lib/datetime.js';
import type { ActorRef, Registration, RegistrationStatus, WorkshopStatus } from '../types.js';
import { num, nullableStr, str, type Row } from '../lib/rows.js';

/**
 * Registrations.
 *
 * The capacity rule - a workshop can never hold more active registrations than
 * its capacity - is enforced in three places, deliberately:
 *
 *  1. The count-then-insert below runs inside one transaction.
 *  2. That transaction starts by locking the workshop row (SELECT ... FOR
 *     UPDATE), so two staff members clicking at the same moment - even on
 *     different server connections - are serialised per workshop.
 *  3. The trigger in schema.sql aborts the write if the count is somehow wrong,
 *     which is what the `isCapacityError` handling below turns into a clean 409.
 *
 * A full workshop does not reject people: it puts them on the waitlist, and a
 * freed seat is offered to the longest-waiting person automatically.
 */

type RegisterAttendeeInput = {
  workshopId: number;
  attendeeName: string;
  attendeeEmail: string;
};

type RegisterAttendeeResult = {
  registration: Registration;
  /** Seats still free after this registration. */
  seatsRemaining: number;
  /** True when the attendee was queued rather than given a seat. */
  waitlisted: boolean;
};

type CancelResult = {
  registration: Registration;
  /** Set when the freed seat was handed to the next person waiting. */
  promoted: Registration | null;
};

const SELECT_REGISTRATIONS = `
  SELECT r.id, r.workshop_id, r.attendee_name, r.attendee_email, r.status,
         r.registered_at, r.cancelled_at,
         rb.id AS registered_by_id, rb.name AS registered_by_name, rb.email AS registered_by_email,
         cb.id AS cancelled_by_id, cb.name AS cancelled_by_name, cb.email AS cancelled_by_email
  FROM registrations r
  JOIN users rb ON rb.id = r.registered_by
  LEFT JOIN users cb ON cb.id = r.cancelled_by`;

/** Active attendees first, then the waitlist, then the most recent history. */
const ORDER_REGISTRATIONS = `
  ORDER BY CASE r.status WHEN 'REGISTERED' THEN 0 WHEN 'WAITLISTED' THEN 1 ELSE 2 END,
           CASE WHEN r.status = 'CANCELLED' THEN r.cancelled_at END DESC,
           r.id ASC`;

function toRegistration(row: Row): Registration {
  return {
    id: num(row.id),
    workshopId: num(row.workshop_id),
    attendeeName: str(row.attendee_name),
    attendeeEmail: str(row.attendee_email),
    status: str(row.status) as RegistrationStatus,
    waitlistPosition: null,
    registeredAt: str(row.registered_at),
    registeredBy: {
      id: num(row.registered_by_id),
      name: str(row.registered_by_name),
      email: str(row.registered_by_email),
    },
    cancelledAt: nullableStr(row.cancelled_at),
    cancelledBy:
      row.cancelled_by_id == null
        ? null
        : {
            id: num(row.cancelled_by_id),
            name: str(row.cancelled_by_name),
            email: str(row.cancelled_by_email),
          },
  };
}

async function countWhere(db: Database, sql: string, ...params: (string | number)[]): Promise<number> {
  return num((await db.get(sql, params))?.n ?? 0);
}

/** Attendees currently holding a seat. */
function countActiveRegistrations(db: Database, workshopId: number): Promise<number> {
  return countWhere(
    db,
    `SELECT COUNT(*) AS n FROM registrations WHERE workshop_id = ? AND status = 'REGISTERED'`,
    workshopId,
  );
}

export async function listRegistrations(db: Database, workshopId: number): Promise<Registration[]> {
  const rows = await db.all(`${SELECT_REGISTRATIONS} WHERE r.workshop_id = ? ${ORDER_REGISTRATIONS}`, [
    workshopId,
  ]);

  const registrations = rows.map(toRegistration);
  let position = 0;
  for (const registration of registrations) {
    if (registration.status === 'WAITLISTED') {
      registration.waitlistPosition = ++position;
    }
  }
  return registrations;
}

async function loadRegistration(db: Database, id: number): Promise<Registration> {
  const row = await db.get(`${SELECT_REGISTRATIONS} WHERE r.id = ?`, [id]);
  if (!row) throw notFound('That registration no longer exists.');
  const registration = toRegistration(row);
  if (registration.status === 'WAITLISTED') {
    registration.waitlistPosition = await countWhere(
      db,
      `SELECT COUNT(*) AS n FROM registrations
        WHERE workshop_id = ? AND status = 'WAITLISTED' AND id <= ?`,
      registration.workshopId,
      id,
    );
  }
  return registration;
}

/** The workshop fields the registration flow needs; owned here to avoid a cycle. */
type WorkshopForRegistration = {
  id: number;
  code: string;
  title: string;
  capacity: number;
  status: WorkshopStatus;
};

/**
 * Loads the workshop and locks its row until the surrounding transaction ends,
 * which is what serialises concurrent registrations for the same workshop.
 */
async function loadWorkshopForRegistration(
  db: Database,
  workshopId: number,
): Promise<WorkshopForRegistration> {
  const row = await db.get(
    'SELECT id, code, title, capacity, status FROM workshops WHERE id = ? FOR UPDATE',
    [workshopId],
  );
  if (!row) throw notFound('That workshop no longer exists.');
  return {
    id: num(row.id),
    code: str(row.code),
    title: str(row.title),
    capacity: num(row.capacity),
    status: str(row.status) as WorkshopStatus,
  };
}

export function registerAttendee(
  db: Database,
  input: RegisterAttendeeInput,
  actor: ActorRef,
): Promise<RegisterAttendeeResult> {
  return withTransaction(db, async (db) => {
    const workshop = await loadWorkshopForRegistration(db, input.workshopId);

    if (workshop.status !== 'SCHEDULED') {
      throw conflict(
        workshop.status === 'COMPLETED'
          ? 'That workshop has already taken place, so it cannot take new registrations.'
          : 'That workshop has been cancelled, so it cannot take new registrations.',
        'WORKSHOP_CLOSED',
      );
    }

    const live = await db.get(
      `SELECT id, status FROM registrations
        WHERE workshop_id = ? AND lower(attendee_email) = lower(?)
          AND status IN ('REGISTERED', 'WAITLISTED')`,
      [input.workshopId, input.attendeeEmail],
    );
    if (live) {
      throw conflict(
        `${input.attendeeEmail} is already ${
          str(live.status) === 'REGISTERED' ? 'registered' : 'on the waitlist'
        } for ${workshop.code}.`,
        'ALREADY_REGISTERED',
      );
    }

    const booked = await countActiveRegistrations(db, workshop.id);
    const waitlisted = booked >= workshop.capacity;
    let id: number;
    try {
      const inserted = await db.get(
        `INSERT INTO registrations
           (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          workshop.id,
          input.attendeeName,
          input.attendeeEmail,
          waitlisted ? 'WAITLISTED' : 'REGISTERED',
          nowIso(),
          actor.id,
        ],
      );
      id = num(inserted?.id);
    } catch (error) {
      // Only reachable if the count above was stale; the trigger in schema.sql
      // are the real backstop.
      if (isCapacityError(error)) {
        throw conflict(
          'The last seat for this workshop was taken a moment ago. Refresh and try again.',
          'WORKSHOP_FULL',
        );
      }
      if (isUniqueConstraintError(error, 'idx_registrations_live_unique')) {
        throw conflict(
          `${input.attendeeEmail} is already registered for ${workshop.code}.`,
          'ALREADY_REGISTERED',
        );
      }
      throw error;
    }

    const registration = await loadRegistration(db, id);
    await recordAudit(db, actor, {
      entityType: 'REGISTRATION',
      entityId: id,
      action: waitlisted ? 'REGISTRATION_WAITLISTED' : 'REGISTRATION_CREATED',
      summary: waitlisted
        ? `Waitlisted ${input.attendeeName} for ${workshop.code} (position ${registration.waitlistPosition})`
        : `Registered ${input.attendeeName} for ${workshop.code}`,
      detail: {
        attendeeName: input.attendeeName,
        attendeeEmail: input.attendeeEmail,
        workshopCode: workshop.code,
        workshopTitle: workshop.title,
      },
    });

    return {
      registration,
      seatsRemaining: Math.max(0, workshop.capacity - (await countActiveRegistrations(db, workshop.id))),
      waitlisted,
    };
  });
}

/**
 * Offers the freed seat to the longest-waiting attendee. Returns null when
 * nobody is waiting, or when the workshop is no longer taking attendees - a
 * cancelled or completed workshop keeps its freed seat free.
 */
async function promoteNextWaitlisted(
  db: Database,
  workshop: WorkshopForRegistration,
  actor: ActorRef,
): Promise<Registration | null> {
  if (workshop.status !== 'SCHEDULED') return null;

  const next = await db.get(
    `SELECT id FROM registrations
      WHERE workshop_id = ? AND status = 'WAITLISTED' ORDER BY id ASC LIMIT 1`,
    [workshop.id],
  );
  if (!next) return null;

  const id = num(next.id);
  const waiting = await loadRegistration(db, id);
  // A savepoint, so a refused promotion does not abort the whole cancellation.
  await db.exec('SAVEPOINT promote_next');
  try {
    await db.run(`UPDATE registrations SET status = 'REGISTERED' WHERE id = ?`, [id]);
    await db.exec('RELEASE SAVEPOINT promote_next');
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT promote_next');
    if (isCapacityError(error)) return null;
    throw error;
  }

  await recordAudit(db, actor, {
    entityType: 'REGISTRATION',
    entityId: id,
    action: 'REGISTRATION_PROMOTED',
    summary: `Offered the freed seat to ${waiting.attendeeName} (${waiting.attendeeEmail})`,
    detail: {
      attendeeName: waiting.attendeeName,
      attendeeEmail: waiting.attendeeEmail,
      fromWaitlistPosition: waiting.waitlistPosition,
    },
  });
  return await loadRegistration(db, id);
}

/**
 * Cancels a registration. The row is kept forever - only its status and the
 * who/when stamps change - so the history stays readable.
 */
export function cancelRegistration(
  db: Database,
  registrationId: number,
  actor: ActorRef,
): Promise<CancelResult> {
  return withTransaction(db, async (db) => {
    const registration = await loadRegistration(db, registrationId);
    if (registration.status === 'CANCELLED') {
      throw conflict('That registration is already cancelled.', 'ALREADY_CANCELLED');
    }

    const workshop = await loadWorkshopForRegistration(db, registration.workshopId);
    await db.run(
      `UPDATE registrations
          SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?
        WHERE id = ?`,
      [nowIso(), actor.id, registration.id],
    );

    const promoted =
      registration.status === 'REGISTERED' ? await promoteNextWaitlisted(db, workshop, actor) : null;

    await recordAudit(db, actor, {
      entityType: 'REGISTRATION',
      entityId: registration.id,
      action: 'REGISTRATION_CANCELLED',
      summary: `Cancelled ${registration.attendeeName} from ${workshop.code}`,
      detail: {
        attendeeName: registration.attendeeName,
        attendeeEmail: registration.attendeeEmail,
        wasWaitlisted: registration.status === 'WAITLISTED',
        seatOfferedTo: promoted ? promoted.attendeeName : null,
      },
    });

    return { registration: await loadRegistration(db, registration.id), promoted };
  });
}

/** Manually moves a waitlisted attendee into a seat, if one is free. */
export function promoteWaitlisted(
  db: Database,
  registrationId: number,
  actor: ActorRef,
): Promise<Registration> {
  return withTransaction(db, async (db) => {
    const registration = await loadRegistration(db, registrationId);
    if (registration.status !== 'WAITLISTED') {
      throw conflict('That attendee is not on the waitlist.', 'NOT_WAITLISTED');
    }

    const workshop = await loadWorkshopForRegistration(db, registration.workshopId);
    if (workshop.status !== 'SCHEDULED') {
      throw conflict(
        workshop.status === 'COMPLETED'
          ? 'That workshop has already taken place, so no seat can be offered.'
          : 'That workshop has been cancelled, so no seat can be offered.',
        'WORKSHOP_CLOSED',
      );
    }

    try {
      await db.run(`UPDATE registrations SET status = 'REGISTERED' WHERE id = ?`, [registration.id]);
    } catch (error) {
      if (isCapacityError(error)) {
        throw conflict('That workshop is full, so there is no seat to offer.', 'WORKSHOP_FULL');
      }
      throw error;
    }

    await recordAudit(db, actor, {
      entityType: 'REGISTRATION',
      entityId: registration.id,
      action: 'REGISTRATION_PROMOTED',
      summary: `Moved ${registration.attendeeName} off the waitlist into a seat`,
      detail: {
        attendeeName: registration.attendeeName,
        attendeeEmail: registration.attendeeEmail,
        fromWaitlistPosition: registration.waitlistPosition,
      },
    });
    return await loadRegistration(db, registration.id);
  });
}
