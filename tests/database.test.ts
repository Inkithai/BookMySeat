import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openDatabase,
  isCapacityError,
  isUniqueConstraintError,
  toPositional,
  type Database,
} from '../server/src/db/index.js';
import { seedFromCli, DEMO_ACCOUNTS } from '../server/src/db/seed.js';

/**
 * The database itself: the constraints and trigger that make overbooking
 * impossible even if a caller ever forgets to check. These are tested directly
 * against SQL because no HTTP request should ever get past them.
 */

let db: Database;
let tmpDir: string;

async function insertAttendee(workshopId: number, email: string, status: string): Promise<void> {
  await db.run(
    `INSERT INTO registrations (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by)
     VALUES (?, ?, ?, ?, '2030-01-01T10:00:00Z', 1)`,
    [workshopId, email.split('@')[0], email, status],
  );
}

async function countStatus(workshopId: number, status: string): Promise<number> {
  const row = await db.get(
    'SELECT COUNT(*) AS total FROM registrations WHERE workshop_id = ? AND status = ?',
    [workshopId, status],
  );
  return Number(row?.total);
}

async function insertWorkshop(values: string): Promise<number> {
  const row = await db.get(
    `INSERT INTO workshops (code, title, instructor, starts_at, duration_minutes, capacity, status, created_at, created_by)
     VALUES ${values} RETURNING id`,
  );
  return Number(row?.id);
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmyseat-db-'));
  db = await openDatabase(path.join(tmpDir, 'constraints'));
  await db.run(
    `INSERT INTO users (email, name, role, password_hash, created_at)
     VALUES ('ops@example.com', 'Ops', 'ADMIN', 'x', '2030-01-01T00:00:00Z')`,
  );
});

test.after(async () => {
  await db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('placeholders become positional parameters, but not inside quoted text', () => {
  assert.equal(toPositional('SELECT ? AS a, ? AS b'), 'SELECT $1 AS a, $2 AS b');
  assert.equal(toPositional(`SELECT '?' AS q, ? AS a`), `SELECT '?' AS q, $1 AS a`);
});

const W = (code: string, title: string, day: string, capacity: number, status = 'SCHEDULED') =>
  `('${code}', '${title}', 'Someone', '2030-06-${day}T10:00', 60, ${capacity}, '${status}', '2030-01-01T00:00:00Z', 1)`;

test('the insert trigger refuses to overbook a workshop', async () => {
  const id = await insertWorkshop(W('DB-001', 'Two seats', '01', 2));

  await insertAttendee(id, 'a@example.com', 'REGISTERED');
  await insertAttendee(id, 'b@example.com', 'REGISTERED');
  assert.equal(await countStatus(id, 'REGISTERED'), 2);

  await assert.rejects(
    insertAttendee(id, 'c@example.com', 'REGISTERED'),
    (error: unknown) => isCapacityError(error),
    'a third REGISTERED row must be blocked',
  );
  assert.equal(await countStatus(id, 'REGISTERED'), 2);
});

test('waitlisted and cancelled rows never count against capacity', async () => {
  const id = await insertWorkshop(W('DB-002', 'One seat', '02', 1));

  await insertAttendee(id, 'seat@example.com', 'REGISTERED');
  await insertAttendee(id, 'wait1@example.com', 'WAITLISTED');
  await insertAttendee(id, 'wait2@example.com', 'WAITLISTED');
  await insertAttendee(id, 'gone@example.com', 'CANCELLED');

  await assert.rejects(
    insertAttendee(id, 'toomany@example.com', 'REGISTERED'),
    (error: unknown) => isCapacityError(error),
    'the single seat is already taken',
  );
});

test('the update trigger refuses to promote into a full workshop', async () => {
  const id = await insertWorkshop(W('DB-003', 'Two seats', '03', 2));

  await insertAttendee(id, 'seat1@example.com', 'REGISTERED');
  await insertAttendee(id, 'seat2@example.com', 'REGISTERED');
  await insertAttendee(id, 'waiting@example.com', 'WAITLISTED');

  const waiter = Number(
    (await db.get(`SELECT id FROM registrations WHERE workshop_id = ? AND status = 'WAITLISTED'`, [id]))?.id,
  );

  await assert.rejects(
    db.run(`UPDATE registrations SET status = 'REGISTERED' WHERE id = ?`, [waiter]),
    (error: unknown) => isCapacityError(error),
    'promoting the waitlisted row must be blocked',
  );

  // Freeing a seat first makes the same promotion legal, which is the
  // behaviour the auto-promotion relies on.
  await db.run(
    `UPDATE registrations SET status = 'CANCELLED'
      WHERE workshop_id = ? AND attendee_email = 'seat1@example.com'`,
    [id],
  );
  await db.run(`UPDATE registrations SET status = 'REGISTERED' WHERE id = ?`, [waiter]);
  assert.equal(await countStatus(id, 'REGISTERED'), 2);
  assert.equal(await countStatus(id, 'CANCELLED'), 1);
});

test('the capacity trigger ignores workshop status, so nobody can slip past it', async () => {
  const id = await insertWorkshop(W('DB-004', 'Cancelled', '04', 1, 'CANCELLED'));

  await insertAttendee(id, 'one@example.com', 'REGISTERED');
  await assert.rejects(
    insertAttendee(id, 'two@example.com', 'REGISTERED'),
    (error: unknown) => isCapacityError(error),
    'the trigger is the backstop even when the workshop is closed',
  );
});

test('the same attendee cannot hold two live places on one workshop', async () => {
  const id = await insertWorkshop(W('DB-005', 'Unique email', '05', 5));

  await insertAttendee(id, 'case@example.com', 'REGISTERED');
  await assert.rejects(
    insertAttendee(id, 'CASE@example.com', 'REGISTERED'),
    (error: unknown) => isUniqueConstraintError(error, 'idx_registrations_live_unique'),
    'the index is case-insensitive',
  );
  await assert.rejects(
    insertAttendee(id, 'case@example.com', 'WAITLISTED'),
    (error: unknown) => isUniqueConstraintError(error, 'idx_registrations_live_unique'),
    'a live waitlist entry counts too',
  );

  // Cancelling releases the email, so the attendee can come back later.
  await db.run(
    `UPDATE registrations SET status = 'CANCELLED'
      WHERE workshop_id = ? AND attendee_email = 'case@example.com'`,
    [id],
  );
  await insertAttendee(id, 'case@example.com', 'WAITLISTED');
  assert.equal(await countStatus(id, 'WAITLISTED'), 1);
});

test('the same attendee may book two different workshops', async () => {
  const first = await insertWorkshop(W('DB-006', 'First', '06', 3));
  const second = await insertWorkshop(W('DB-007', 'Second', '07', 3));

  await insertAttendee(first, 'both@example.com', 'REGISTERED');
  await insertAttendee(second, 'both@example.com', 'REGISTERED');
  assert.equal(await countStatus(first, 'REGISTERED'), 1);
  assert.equal(await countStatus(second, 'REGISTERED'), 1);
});

test('check constraints reject impossible stored values', async () => {
  await assert.rejects(db.run(`INSERT INTO users (email, name, role, password_hash, created_at) VALUES ('x@example.com', 'X', 'OWNER', 'y', 'now')`));
  await assert.rejects(insertWorkshop(W('DB-BAD', 'T', '08', 0)));
  await assert.rejects(insertWorkshop(W('DB-BAD', 'T', '08', -1)));
  await assert.rejects(insertWorkshop(W('DB-BAD', 'T', '08', 1, 'OPEN')));

  const workshop = await insertWorkshop(W('DB-008', 'Check', '08', 4));
  await assert.rejects(
    db.run(
      `INSERT INTO registrations (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by)
       VALUES (?, 'N', 'n@example.com', 'MAYBE', '2030-01-01T10:00:00Z', 1)`,
      [workshop],
    ),
  );
  await assert.rejects(
    db.run(
      `INSERT INTO registrations (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by)
       VALUES (99999, 'N', 'n@example.com', 'REGISTERED', '2030-01-01T10:00:00Z', 1)`,
    ),
    'a registration cannot point at a workshop that does not exist',
  );
});

test('workshop codes and staff emails are unique', async () => {
  await insertWorkshop(W('DB-009', 'Original', '09', 4));
  await assert.rejects(insertWorkshop(W('DB-009', 'Copy', '10', 4)), (error: unknown) =>
    isUniqueConstraintError(error, 'workshops_code_key'),
  );
  await assert.rejects(
    db.run(
      `INSERT INTO users (email, name, role, password_hash, created_at)
       VALUES ('ops@example.com', 'Again', 'STAFF', 'x', '2030-01-01T00:00:00Z')`,
    ),
    (error: unknown) => isUniqueConstraintError(error, 'users_email_key'),
  );
});

test('a failed statement inside a transaction rolls the whole unit back', async () => {
  const id = await insertWorkshop(W('DB-010', 'Rollback', '10', 1));
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO registrations (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by)
         VALUES (?, 'A', 'a@example.com', 'REGISTERED', '2030-01-01T10:00:00Z', 1)`,
        [id],
      );
      await tx.run(
        `INSERT INTO registrations (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by)
         VALUES (?, 'B', 'b@example.com', 'REGISTERED', '2030-01-01T10:00:00Z', 1)`,
        [id],
      );
    }),
    (error: unknown) => isCapacityError(error),
  );
  assert.equal(await countStatus(id, 'REGISTERED'), 0, 'the first insert was rolled back too');
});

test('row level security keeps the tables closed to Supabase\'s public API', async () => {
  const rows = await db.all(
    `SELECT relname FROM pg_class
      WHERE relname IN ('users', 'sessions', 'workshops', 'registrations', 'audit_log')
        AND relrowsecurity`,
  );
  assert.equal(rows.length, 5);
});

test('opening an existing database again is safe (the schema is idempotent)', async () => {
  const target = path.join(tmpDir, 'reopen');
  const first = await openDatabase(target);
  await first.run(
    `INSERT INTO users (email, name, role, password_hash, created_at)
     VALUES ('keep@example.com', 'Keep', 'STAFF', 'x', '2030-01-01T00:00:00Z')`,
  );
  await first.close();

  const second = await openDatabase(target);
  try {
    const row = await second.get(`SELECT COUNT(*) AS total FROM users`);
    assert.equal(Number(row?.total), 1);
  } finally {
    await second.close();
  }
});

test('a fresh database seeds the demo catalogue', async () => {
  const target = path.join(tmpDir, 'seeded');
  assert.equal(await seedFromCli(target), true);

  const seeded = await openDatabase(target);
  try {
    const users = await seeded.get('SELECT COUNT(*) AS total FROM users');
    const workshops = await seeded.get('SELECT COUNT(*) AS total FROM workshops');
    assert.equal(Number(users?.total), DEMO_ACCOUNTS.length);
    assert.ok(Number(workshops?.total) > 0, 'the catalogue is not empty');
  } finally {
    await seeded.close();
  }
});

test('the seed command refuses to reset a database holding real accounts', async () => {
  const target = path.join(tmpDir, 'guarded');
  await seedFromCli(target);

  const withReal = await openDatabase(target);
  await withReal.run(
    `INSERT INTO users (email, name, role, password_hash, created_at)
     VALUES ('real.person@example.com', 'Real Person', 'STAFF', 'x', '2030-01-01T00:00:00Z')`,
  );
  await withReal.close();

  assert.equal(
    await seedFromCli(target),
    false,
    'the reset must be refused rather than silently wiping the database',
  );

  const countReal = async () => {
    const after = await openDatabase(target);
    try {
      const kept = await after.get(
        `SELECT COUNT(*) AS total FROM users WHERE email = 'real.person@example.com'`,
      );
      return Number(kept?.total);
    } finally {
      await after.close();
    }
  };
  assert.equal(await countReal(), 1, 'the real account survives');

  // FORCE_SEED is the documented escape hatch.
  const previous = process.env.FORCE_SEED;
  process.env.FORCE_SEED = 'true';
  try {
    assert.equal(await seedFromCli(target), true);
    assert.equal(await countReal(), 0);
  } finally {
    if (previous === undefined) delete process.env.FORCE_SEED;
    else process.env.FORCE_SEED = previous;
  }
});
