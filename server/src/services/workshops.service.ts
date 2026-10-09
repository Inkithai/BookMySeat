import type { Database } from '../db/index.js';
import { isUniqueConstraintError, withTransaction } from '../db/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { escapeLike } from '../lib/validate.js';
import { addDays, nowIso } from '../lib/datetime.js';
import type {
  ActorRef,
  WorkshopDetail,
  WorkshopStatus,
  WorkshopSummary,
} from '../types.js';
import { num, nullableStr, str, type Row } from '../lib/rows.js';
import { listRegistrations } from './registrations.service.js';
import { listAuditForWorkshop } from './audit.service.js';

export type WorkshopFilters = {
  q?: string;
  status?: WorkshopStatus;
  /** Inclusive lower bound on the workshop date, "YYYY-MM-DD". */
  from?: string;
  /** Inclusive upper bound on the workshop date, "YYYY-MM-DD". */
  to?: string;
  /** Only workshops that still have at least one free seat. */
  hasSeats?: boolean;
};

type CreateWorkshopInput = {
  code: string;
  title: string;
  instructor: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  status: WorkshopStatus;
  location: string;
  notes: string;
};

type UpdateWorkshopInput = Partial<CreateWorkshopInput>;

const SELECT_WORKSHOPS = `
  SELECT w.id, w.code, w.title, w.instructor, w.starts_at, w.duration_minutes,
         w.capacity, w.status, w.location, w.notes, w.created_at, w.updated_at,
         (SELECT COUNT(*) FROM registrations r
           WHERE r.workshop_id = w.id AND r.status = 'REGISTERED') AS registered_count,
         (SELECT COUNT(*) FROM registrations r
           WHERE r.workshop_id = w.id AND r.status = 'WAITLISTED') AS waitlist_count
  FROM workshops w`;

/** Soonest scheduled workshop first, then anything cancelled or completed. */
const ORDER_BY = `ORDER BY CASE WHEN w.status = 'SCHEDULED' THEN 0 ELSE 1 END, w.starts_at ASC, w.id ASC`;

function toSummary(row: Row): WorkshopSummary {
  const capacity = num(row.capacity);
  const registeredCount = num(row.registered_count);
  return {
    id: num(row.id),
    code: str(row.code),
    title: str(row.title),
    instructor: str(row.instructor),
    startsAt: str(row.starts_at),
    durationMinutes: num(row.duration_minutes),
    capacity,
    status: str(row.status) as WorkshopStatus,
    location: str(row.location),
    notes: str(row.notes),
    registeredCount,
    waitlistCount: num(row.waitlist_count),
    seatsRemaining: Math.max(0, capacity - registeredCount),
    createdAt: str(row.created_at),
    updatedAt: nullableStr(row.updated_at),
  };
}

export async function listWorkshops(db: Database, filters: WorkshopFilters): Promise<WorkshopSummary[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.q) {
    conditions.push(
      '(w.code ILIKE ? ESCAPE ? OR w.title ILIKE ? ESCAPE ? OR w.instructor ILIKE ? ESCAPE ?)',
    );
    const pattern = `%${escapeLike(filters.q)}%`;
    params.push(pattern, '\\', pattern, '\\', pattern, '\\');
  }
  if (filters.status) {
    conditions.push('w.status = ?');
    params.push(filters.status);
  }
  if (filters.from) {
    conditions.push('w.starts_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    // ISO strings sort lexicographically, so "before the next day" is exactly
    // "on or before this date" - including a 23:59:59 start time.
    conditions.push('w.starts_at < ?');
    params.push(addDays(filters.to, 1));
  }
  if (filters.hasSeats) {
    // A cancelled or completed workshop has no seats to sell, even when the
    // numbers say otherwise.
    conditions.push(
      `w.status = 'SCHEDULED' AND
       (SELECT COUNT(*) FROM registrations r
          WHERE r.workshop_id = w.id AND r.status = 'REGISTERED') < w.capacity`,
    );
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.all(`${SELECT_WORKSHOPS} ${where} ${ORDER_BY}`, params);
  return rows.map(toSummary);
}

async function getWorkshopSummary(db: Database, id: number): Promise<WorkshopSummary> {
  const row = await db.get(`${SELECT_WORKSHOPS} WHERE w.id = ?`, [id]);
  if (!row) throw notFound('That workshop no longer exists.');
  return toSummary(row);
}

export async function getWorkshopDetail(db: Database, id: number): Promise<WorkshopDetail> {
  const summary = await getWorkshopSummary(db, id);
  return {
    ...summary,
    registrations: await listRegistrations(db, id),
    recentActivity: await listAuditForWorkshop(db, id),
  };
}

async function assertCodeAvailable(db: Database, code: string, exceptId?: number): Promise<void> {
  const row = exceptId
    ? await db.get('SELECT id FROM workshops WHERE code = ? AND id <> ?', [code, exceptId])
    : await db.get('SELECT id FROM workshops WHERE code = ?', [code]);
  if (row) throw conflict(`Workshop code ${code} is already in use.`, 'CODE_TAKEN');
}

export function createWorkshop(
  db: Database,
  input: CreateWorkshopInput,
  actor: ActorRef,
): Promise<WorkshopDetail> {
  return withTransaction(db, async (db) => {
    await assertCodeAvailable(db, input.code);
    let id: number;
    try {
      const inserted = await db.get(
        `INSERT INTO workshops
           (code, title, instructor, starts_at, duration_minutes, capacity, status,
            location, notes, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          input.code,
          input.title,
          input.instructor,
          input.startsAt,
          input.durationMinutes,
          input.capacity,
          input.status,
          input.location,
          input.notes,
          nowIso(),
          actor.id,
        ],
      );
      id = num(inserted?.id);
    } catch (error) {
      if (isUniqueConstraintError(error, 'workshops_code_key')) {
        throw conflict(`Workshop code ${input.code} is already in use.`, 'CODE_TAKEN');
      }
      throw error;
    }

    await recordAudit(db, actor, {
      entityType: 'WORKSHOP',
      entityId: id,
      action: 'WORKSHOP_CREATED',
      summary: `Created workshop ${input.code} - ${input.title}`,
      detail: { ...input },
    });
    return await getWorkshopDetail(db, id);
  });
}

/** Fields a manager may edit, mapped to the column each one writes. */
const EDITABLE_FIELDS: Record<string, string> = {
  code: 'code',
  title: 'title',
  instructor: 'instructor',
  startsAt: 'starts_at',
  durationMinutes: 'duration_minutes',
  capacity: 'capacity',
  status: 'status',
  location: 'location',
  notes: 'notes',
};

type ColumnUpdate = { column: string; value: string | number };

export function updateWorkshop(
  db: Database,
  id: number,
  patch: UpdateWorkshopInput,
  actor: ActorRef,
): Promise<WorkshopDetail> {
  return withTransaction(db, async (db) => {
    // Lock the workshop first so a capacity change cannot race a registration.
    await db.get('SELECT id FROM workshops WHERE id = ? FOR UPDATE', [id]);
    const current = await getWorkshopSummary(db, id);

    // Lowering capacity below the number of booked seats would overbook the
    // workshop, so refuse it and say how many registrations are in the way.
    if (patch.capacity !== undefined && patch.capacity < current.registeredCount) {
      throw conflict(
        `Cannot set capacity to ${patch.capacity}: ${current.registeredCount} attendee(s) already hold a seat. ` +
          'Cancel some registrations first.',
        'CAPACITY_BELOW_BOOKED',
      );
    }

    if (patch.code !== undefined && patch.code !== current.code) {
      await assertCodeAvailable(db, patch.code, id);
    }

    const updates: ColumnUpdate[] = [];
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, column] of Object.entries(EDITABLE_FIELDS)) {
      const next = patch[field as keyof UpdateWorkshopInput];
      const before = current[field as keyof WorkshopSummary];
      if (next === undefined || next === before) continue;
      updates.push({ column, value: next });
      changes[field] = { from: before, to: next };
    }

    if (updates.length === 0) return await getWorkshopDetail(db, id);

    const assignments = updates.map((update) => `${update.column} = ?`).join(', ');
    try {
      await db.run(
        `UPDATE workshops SET ${assignments}, updated_at = ?, updated_by = ? WHERE id = ?`,
        [...updates.map((update) => update.value), nowIso(), actor.id, id],
      );
    } catch (error) {
      if (isUniqueConstraintError(error, 'workshops_code_key')) {
        throw conflict(`Workshop code ${patch.code} is already in use.`, 'CODE_TAKEN');
      }
      throw error;
    }

    await recordAudit(db, actor, {
      entityType: 'WORKSHOP',
      entityId: id,
      action: 'WORKSHOP_UPDATED',
      summary: `Updated workshop ${current.code} (${Object.keys(changes).join(', ')})`,
      detail: changes,
    });
    return await getWorkshopDetail(db, id);
  });
}
