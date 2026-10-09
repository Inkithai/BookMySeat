import { openDatabase, type Database } from './index.js';
import { recordAudit, type AuditWriter } from '../lib/audit.js';
import { hashPassword } from '../lib/auth.js';
import { addDays, nowIso, todayDate } from '../lib/datetime.js';
import { num, str } from '../lib/rows.js';
import type { Role } from '../types.js';

/**
 * Demo data.
 *
 * A brand new database is seeded automatically so the app is usable the moment
 * it starts; `npm run seed` empties the database and rebuilds it.
 *
 * The dev-only credentials below are deliberately simple. They exist for this
 * assessment and must never be used anywhere real.
 */

export const DEMO_ACCOUNTS = [
  {
    name: 'Dana Whitfield',
    email: 'admin@bookmyseat.test',
    role: 'ADMIN' as Role,
    password: 'Admin123!',
    blurb: 'Administrator - manages staff accounts only',
  },
  {
    name: 'Marcus Bell',
    email: 'manager@bookmyseat.test',
    role: 'MANAGER' as Role,
    password: 'Manager123!',
    blurb: 'Programme manager - schedules workshops',
  },
  {
    name: 'Aisha Rahman',
    email: 'staff@bookmyseat.test',
    role: 'STAFF' as Role,
    password: 'Staff123!',
    blurb: 'Front desk - registers and cancels attendees',
  },
];

const FIRST_NAMES = [
  'Amara', 'Noah', 'Priya', 'Liam', 'Sofia', 'Yusuf', 'Elena', 'Marcus', 'Chloe', 'Daniel',
  'Fatima', 'Oliver', 'Grace', 'Hassan', 'Isla', 'Tomas', 'Nadia', 'Ethan', 'Layla', 'Owen',
  'Maya', 'Jonas', 'Rosa', 'Kai', 'Ines', 'Adam', 'Zara', 'Felix', 'Hana', 'Leo',
  'Marta', 'Omar', 'Ruby', 'Sam', 'Tara', 'Victor', 'Wren', 'Yara', 'Zoe', 'Idris',
];

const LAST_NAMES = [
  'Okafor', 'Whitfield', 'Nair', 'Fischer', 'Rossi', 'Haddad', 'Kowalski', 'Bell', 'Dubois',
  'Mensah', 'Silva', 'Nowak', 'Ivanov', 'Larsen', 'Moreau', 'Tanaka', 'Ferrari', 'Osei',
  'Kim', 'Novak',
];

/** Accounts by role, for stamping audit rows during the seed. */
const ACCOUNT_BY_ROLE = Object.fromEntries(DEMO_ACCOUNTS.map((a) => [a.role, a])) as Record<
  Role,
  (typeof DEMO_ACCOUNTS)[number]
>;

/** Deterministic attendee pool: index 0 -> "Amara Okafor <amara.okafor0@example.com>". */
function attendeeAt(index: number): { name: string; email: string } {
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[(index * 7) % LAST_NAMES.length];
  return {
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${index}@example.com`,
  };
}

/** "18:00" plus a day offset from today, as a local wall-clock value. */
function at(dayOffset: number, time: string): string {
  return `${addDays(todayDate(), dayOffset)}T${time}`;
}

type WorkshopSpec = {
  code: string;
  title: string;
  instructor: string;
  startsAt: string;
  durationMinutes: number;
  capacity: number;
  status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';
  location: string;
  notes: string;
  registered: number;
  waitlisted: number;
  cancelled: number;
};

const WORKSHOPS: WorkshopSpec[] = [
  {
    code: 'FIT-105',
    title: 'Morning Yoga',
    instructor: 'Lena Fischer',
    startsAt: at(1, '07:00'),
    durationMinutes: 60,
    capacity: 25,
    status: 'SCHEDULED',
    location: 'Northside Hall',
    notes: 'Bring a mat. Suitable for all levels.',
    registered: 18,
    waitlisted: 0,
    cancelled: 0,
  },
  {
    code: 'POT-101',
    title: 'Pottery Basics: Hand Building',
    instructor: 'Nadia Haddad',
    startsAt: at(3, '18:00'),
    durationMinutes: 120,
    capacity: 12,
    status: 'SCHEDULED',
    location: 'Riverside Studio',
    notes: 'Apron provided. Clay and firing included in the fee.',
    registered: 7,
    waitlisted: 2,
    cancelled: 1,
  },
  {
    code: 'COD-110',
    title: 'Intro to JavaScript',
    instructor: 'Tom Osei',
    startsAt: at(4, '09:30'),
    durationMinutes: 180,
    capacity: 20,
    status: 'SCHEDULED',
    location: 'City Lab 2',
    notes: 'Laptops available to borrow - please ask at the front desk.',
    registered: 20,
    waitlisted: 3,
    cancelled: 2,
  },
  {
    code: 'POT-204',
    title: 'Wheel Throwing: Intermediate',
    instructor: 'Nadia Haddad',
    startsAt: at(6, '10:00'),
    durationMinutes: 150,
    capacity: 8,
    status: 'SCHEDULED',
    location: 'Riverside Studio',
    notes: 'For students who have completed Pottery Basics.',
    registered: 8,
    waitlisted: 2,
    cancelled: 0,
  },
  {
    code: 'MUS-140',
    title: 'Drumming Circle',
    instructor: 'Ruth Adeyemi',
    startsAt: at(8, '17:00'),
    durationMinutes: 90,
    capacity: 20,
    status: 'CANCELLED',
    location: 'Northside Hall',
    notes: 'Cancelled - the hall floor is being resurfaced that week.',
    registered: 5,
    waitlisted: 0,
    cancelled: 0,
  },
  {
    code: 'COD-220',
    title: 'Building APIs with Node',
    instructor: 'Tom Osei',
    startsAt: at(11, '18:00'),
    durationMinutes: 180,
    capacity: 16,
    status: 'SCHEDULED',
    location: 'City Lab 2',
    notes: 'Assumes basic JavaScript. Bring your own laptop if you can.',
    registered: 11,
    waitlisted: 0,
    cancelled: 1,
  },
  {
    code: 'GAR-150',
    title: 'Growing Vegetables in Small Spaces',
    instructor: 'Sam Ellis',
    startsAt: at(18, '11:00'),
    durationMinutes: 90,
    capacity: 14,
    status: 'SCHEDULED',
    location: 'Northside Hall',
    notes: 'Take-home seedling included.',
    registered: 0,
    waitlisted: 0,
    cancelled: 0,
  },
  {
    code: 'ART-130',
    title: 'Watercolour for Beginners',
    instructor: 'Priya Nair',
    startsAt: at(-5, '11:00'),
    durationMinutes: 120,
    capacity: 10,
    status: 'COMPLETED',
    location: 'Riverside Studio',
    notes: 'Materials provided.',
    registered: 10,
    waitlisted: 0,
    cancelled: 2,
  },
  {
    code: 'COD-099',
    title: 'Git and GitHub Essentials',
    instructor: 'Tom Osei',
    startsAt: at(-12, '09:30'),
    durationMinutes: 120,
    capacity: 20,
    status: 'COMPLETED',
    location: 'City Lab 2',
    notes: '',
    registered: 16,
    waitlisted: 0,
    cancelled: 1,
  },
];

/** Seeds a brand new database. Existing data is left untouched. */
export async function ensureSeedData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialise concurrent first starts, so two instances cannot both seed.
    await tx.exec('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const row = await tx.get('SELECT COUNT(*) AS n FROM users');
    if (num(row?.n ?? 0) > 0) return;
    await seedDemoData(tx);
  });
}

/** Wipes every table and rebuilds the demo data. */
export async function resetAndSeed(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(
      'TRUNCATE audit_log, registrations, workshops, sessions, users RESTART IDENTITY CASCADE',
    );
    await seedDemoData(tx);
  });
}

/** Inserts the demo data. Always called inside a transaction. */
async function seedDemoData(db: Database): Promise<void> {
  const actorIds: Record<Role, number> = { ADMIN: 0, MANAGER: 0, STAFF: 0 };

  for (const account of DEMO_ACCOUNTS) {
    const inserted = await db.get(
      `INSERT INTO users (email, name, role, password_hash, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)
       RETURNING id`,
      [account.email, account.name, account.role, hashPassword(account.password), nowIso()],
    );
    actorIds[account.role] = num(inserted?.id);
  }

  const manager = actorIds.MANAGER;
  const frontDesk = actorIds.STAFF;
  let attendeeIndex = 0;
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

  const actorFor = (role: Role) => {
    const account = ACCOUNT_BY_ROLE[role];
    return { id: actorIds[role], name: account.name, email: account.email };
  };
  const auditAs = (role: Role, entry: AuditWriter) => recordAudit(db, actorFor(role), entry);

  for (const spec of WORKSHOPS) {
    if (spec.registered > spec.capacity) {
      throw new Error(`Seed data is invalid: ${spec.code} registers more attendees than seats.`);
    }

    const workshop = await db.get(
      `INSERT INTO workshops
         (code, title, instructor, starts_at, duration_minutes, capacity, status,
          location, notes, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        spec.code,
        spec.title,
        spec.instructor,
        spec.startsAt,
        spec.durationMinutes,
        spec.capacity,
        spec.status,
        spec.location,
        spec.notes,
        hoursAgo(24 * 14),
        manager,
      ],
    );
    const workshopId = num(workshop?.id);

    await auditAs('MANAGER', {
      entityType: 'WORKSHOP',
      entityId: workshopId,
      action: 'WORKSHOP_CREATED',
      summary: `Created workshop ${spec.code} - ${spec.title}`,
      detail: { capacity: spec.capacity, instructor: spec.instructor },
    });

    for (let i = 0; i < spec.registered; i += 1) {
      const attendee = attendeeAt(attendeeIndex);
      attendeeIndex += 1;
      const registration = await db.get(
        `INSERT INTO registrations
           (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by)
         VALUES (?, ?, ?, 'REGISTERED', ?, ?)
         RETURNING id`,
        [workshopId, attendee.name, attendee.email, hoursAgo(72 + i), frontDesk],
      );
      await auditAs('STAFF', {
        entityType: 'REGISTRATION',
        entityId: num(registration?.id),
        action: 'REGISTRATION_CREATED',
        summary: `Registered ${attendee.name} for ${spec.code}`,
        detail: { attendeeEmail: attendee.email },
      });
    }

    for (let i = 0; i < spec.waitlisted; i += 1) {
      const attendee = attendeeAt(attendeeIndex);
      attendeeIndex += 1;
      await db.run(
        `INSERT INTO registrations
           (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by)
         VALUES (?, ?, ?, 'WAITLISTED', ?, ?)`,
        [workshopId, attendee.name, attendee.email, hoursAgo(48 + i), frontDesk],
      );
    }

    for (let i = 0; i < spec.cancelled; i += 1) {
      const attendee = attendeeAt(attendeeIndex);
      attendeeIndex += 1;
      await db.run(
        `INSERT INTO registrations
           (workshop_id, attendee_name, attendee_email, status, registered_at, registered_by,
            cancelled_at, cancelled_by)
         VALUES (?, ?, ?, 'CANCELLED', ?, ?, ?, ?)`,
        [
          workshopId,
          attendee.name,
          attendee.email,
          hoursAgo(96 + i),
          frontDesk,
          hoursAgo(24 + i),
          frontDesk,
        ],
      );
    }
  }
}

/** Emails that belong to the demo data rather than to real staff. */
const DEMO_EMAILS = new Set(DEMO_ACCOUNTS.map((account) => account.email));

/**
 * `npm run seed` entry point: rebuild the configured database from scratch.
 *
 * This wipes every table, so it refuses to run against a database that holds
 * real accounts unless FORCE_SEED=true is set. Pointing DATABASE_URL at the
 * production database and running the documented command should not silently
 * destroy it.
 */
export async function seedFromCli(target: string, label = target): Promise<boolean> {
  const db = await openDatabase(target);
  try {
    if (!process.env.FORCE_SEED) {
      const rows = await db.all('SELECT email FROM users');
      const foreign = rows.map((row) => str(row.email)).filter((email) => !DEMO_EMAILS.has(email));
      if (foreign.length > 0) {
        console.error(
          `Refusing to reset ${label}: it holds ${foreign.length} account(s) that are not part of the demo data ` +
            `(for example ${foreign[0]}).\n` +
            'If you really want to throw this database away, run the command again with FORCE_SEED=true.',
        );
        return false;
      }
    }
    await resetAndSeed(db);
    return true;
  } finally {
    await db.close();
  }
}
