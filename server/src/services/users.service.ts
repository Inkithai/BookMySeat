import type { Database } from '../db/index.js';
import { isUniqueConstraintError, withTransaction } from '../db/index.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { nowIso } from '../lib/datetime.js';
import { deleteSessionsForUser, hashPassword } from '../lib/auth.js';
import type { ActorRef, Role, UserSummary } from '../types.js';
import { bool, num, nullableStr, str, type Row } from '../lib/rows.js';

/**
 * Staff accounts. Only Admins reach this service: there is no public signup and
 * no self-service profile editing.
 */

type CreateUserInput = {
  name: string;
  email: string;
  role: Role;
  password: string;
};

type UpdateUserInput = {
  name?: string;
  role?: Role;
  isActive?: boolean;
  /** Set to rotate a password; never returned by any read. */
  password?: string;
};

const SELECT_USERS = `
  SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at,
         creator.name AS created_by_name
  FROM users u
  LEFT JOIN users creator ON creator.id = u.created_by`;

function toSummary(row: Row): UserSummary {
  return {
    id: num(row.id),
    email: str(row.email),
    name: str(row.name),
    role: str(row.role) as Role,
    isActive: bool(row.is_active),
    createdAt: str(row.created_at),
    createdByName: nullableStr(row.created_by_name),
  };
}

export async function listUsers(db: Database): Promise<UserSummary[]> {
  return (await db.all(`${SELECT_USERS} ORDER BY u.name ASC`)).map(toSummary);
}

export async function getUser(db: Database, id: number): Promise<UserSummary> {
  const row = await db.get(`${SELECT_USERS} WHERE u.id = ?`, [id]);
  if (!row) throw notFound('That account no longer exists.');
  return toSummary(row);
}

/** Normalised email, so "Sam@Example.com" and "sam@example.com" are one account. */
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Counts active admins. The admin rows are locked first, so two admins
 * deactivating each other at the same moment cannot both see "one other admin
 * is left" and end up locking everyone out.
 */
async function countActiveAdmins(db: Database, exceptId?: number): Promise<number> {
  await db.all(`SELECT id FROM users WHERE role = 'ADMIN' AND is_active = 1 ORDER BY id FOR UPDATE`);
  const row = exceptId
    ? await db.get(`SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND is_active = 1 AND id <> ?`, [exceptId])
    : await db.get(`SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND is_active = 1`);
  return num(row?.n ?? 0);
}

export function createUser(
  db: Database,
  input: CreateUserInput,
  actor: ActorRef,
): Promise<UserSummary> {
  return withTransaction(db, async (db) => {
    let id: number;
    try {
      const inserted = await db.get(
        `INSERT INTO users (email, name, role, password_hash, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          normalizeEmail(input.email),
          input.name.trim(),
          input.role,
          hashPassword(input.password),
          nowIso(),
          actor.id,
        ],
      );
      id = num(inserted?.id);
    } catch (error) {
      if (isUniqueConstraintError(error, 'users_email_key')) {
        throw conflict(`An account for ${input.email} already exists.`, 'EMAIL_TAKEN');
      }
      throw error;
    }

    await recordAudit(db, actor, {
      entityType: 'USER',
      entityId: id,
      action: 'USER_CREATED',
      summary: `Created ${input.role} account for ${input.name} (${normalizeEmail(input.email)})`,
      detail: { name: input.name.trim(), email: normalizeEmail(input.email), role: input.role },
    });
    return await getUser(db, id);
  });
}

export function updateUser(
  db: Database,
  id: number,
  patch: UpdateUserInput,
  actor: ActorRef,
): Promise<UserSummary> {
  return withTransaction(db, async (db) => {
    const current = await getUser(db, id);
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (patch.name !== undefined && patch.name.trim() !== current.name) {
      changes.name = { from: current.name, to: patch.name.trim() };
    }
    if (patch.role !== undefined && patch.role !== current.role) {
      changes.role = { from: current.role, to: patch.role };
    }
    if (patch.isActive !== undefined && patch.isActive !== current.isActive) {
      changes.isActive = { from: current.isActive, to: patch.isActive };
    }

    // Two guards so an admin cannot lock everyone (including themselves) out.
    if (id === actor.id && (patch.role !== undefined || patch.isActive === false)) {
      throw forbidden('You cannot change your own role or deactivate your own account.');
    }
    if (patch.isActive === false && current.role === 'ADMIN' && (await countActiveAdmins(db, id)) === 0) {
      throw conflict('This is the only active Admin account, so it cannot be deactivated.', 'LAST_ADMIN');
    }
    if (patch.role !== undefined && patch.role !== 'ADMIN' && current.role === 'ADMIN'
        && (await countActiveAdmins(db, id)) === 0) {
      throw conflict('This is the only active Admin account, so its role cannot be changed.', 'LAST_ADMIN');
    }

    // Columns to write, kept separate from the audit diff: a password rotation
    // is recorded but never written through the same statement.
    const columns: Record<string, string | number> = {};
    if (changes.name) columns.name = String(patch.name ?? '').trim();
    if (changes.role) columns.role = String(patch.role);
    if (changes.isActive) columns.is_active = patch.isActive ? 1 : 0;

    if (patch.password !== undefined) {
      changes.password = { from: '(hidden)', to: '(rotated)' };
    }

    const columnNames = Object.keys(columns);
    if (columnNames.length > 0) {
      const assignments = columnNames.map((column) => `${column} = ?`).join(', ');
      await db.run(
        `UPDATE users SET ${assignments}, updated_at = ?, updated_by = ? WHERE id = ?`,
        [...columnNames.map((column) => columns[column]), nowIso(), actor.id, id],
      );
    }

    if (patch.password !== undefined) {
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [
        hashPassword(patch.password),
        id,
      ]);
      // A rotated password invalidates existing sign-ins for that account.
      await deleteSessionsForUser(db, id);
    }

    if (columnNames.length > 0 || patch.password !== undefined) {
      await recordAudit(db, actor, {
        entityType: 'USER',
        entityId: id,
        action: 'USER_UPDATED',
        summary: `Updated account ${current.email} (${Object.keys(changes).join(', ')})`,
        detail: changes,
      });
    }
    return await getUser(db, id);
  });
}
