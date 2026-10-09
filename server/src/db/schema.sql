-- BookMySeat schema (PostgreSQL - Supabase in production, PGlite locally).
--
-- Every statement is idempotent, and the server runs this file on every start,
-- so it is safe against an existing database. There are no down-migrations:
-- this is a small single-venue system, and `npm run seed` rebuilds the demo
-- data from scratch.
--
-- Timestamps are stored as ISO 8601 text. Audit timestamps are UTC
-- ("2026-03-14T09:31:00.000Z"); workshop start times are local wall-clock
-- values without an offset ("2026-03-14T10:00") because that is what the front
-- desk types in and expects to read back. ISO text sorts chronologically.

-- ---------------------------------------------------------------------------
-- Staff accounts. There is no public signup: the first ADMIN is seeded and
-- Admins create every other account. Emails are stored lower-cased.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL  PRIMARY KEY,
  email         TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'STAFF')),
  password_hash TEXT    NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT    NOT NULL,
  created_by    INTEGER REFERENCES users(id),
  updated_at    TEXT,
  updated_by    INTEGER REFERENCES users(id),
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------------------------------------------------------------------------
-- Server-side sessions. Only a SHA-256 hash of the random token is stored, so
-- a leaked database cannot be used to hijack a signed-in session.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Workshop catalogue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workshops (
  id               SERIAL  PRIMARY KEY,
  code             TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  instructor       TEXT    NOT NULL,
  starts_at        TEXT    NOT NULL, -- local wall-clock, 'YYYY-MM-DDTHH:mm'
  duration_minutes INTEGER NOT NULL DEFAULT 120 CHECK (duration_minutes > 0),
  capacity         INTEGER NOT NULL CHECK (capacity > 0),
  status           TEXT    NOT NULL CHECK (status IN ('SCHEDULED', 'CANCELLED', 'COMPLETED')),
  location         TEXT    NOT NULL DEFAULT '',
  notes            TEXT    NOT NULL DEFAULT '',
  created_at       TEXT    NOT NULL,
  created_by       INTEGER REFERENCES users(id),
  updated_at       TEXT,
  updated_by       INTEGER REFERENCES users(id),
  CONSTRAINT workshops_code_key UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_workshops_starts_at ON workshops(starts_at);
CREATE INDEX IF NOT EXISTS idx_workshops_status ON workshops(status);

-- ---------------------------------------------------------------------------
-- Registrations. Attendees have no accounts: they are just a name and an email
-- typed in by staff. Rows are never deleted - cancelling sets status and stamps
-- who did it and when, so the full history stays available.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registrations (
  id             SERIAL  PRIMARY KEY,
  workshop_id    INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  attendee_name  TEXT    NOT NULL,
  attendee_email TEXT    NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('REGISTERED', 'WAITLISTED', 'CANCELLED')),
  registered_at  TEXT    NOT NULL,
  registered_by  INTEGER NOT NULL REFERENCES users(id),
  cancelled_at   TEXT,
  cancelled_by   INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_registrations_workshop_status ON registrations(workshop_id, status);

-- At most one live (registered or waitlisted) entry per attendee per workshop.
-- The partial WHERE clause is what makes cancelled history rows exempt, and
-- lower() keeps "Sam@Example.com" and "sam@example.com" the same person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_live_unique
  ON registrations(workshop_id, lower(attendee_email))
  WHERE status IN ('REGISTERED', 'WAITLISTED');

-- ---------------------------------------------------------------------------
-- Audit trail: who changed what, and when.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL  PRIMARY KEY,
  entity_type TEXT    NOT NULL CHECK (entity_type IN ('WORKSHOP', 'USER', 'REGISTRATION', 'SESSION')),
  entity_id   INTEGER,
  action      TEXT    NOT NULL,
  summary     TEXT    NOT NULL,
  detail      TEXT, -- JSON, e.g. { "capacity": { "from": 20, "to": 16 } }
  actor_id    INTEGER REFERENCES users(id),
  actor_email TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- The one rule the client cares about most, enforced by the database itself:
-- a workshop can never hold more active registrations than its capacity.
--
-- Application code also checks, but this trigger makes the invariant hold even
-- if a future code path forgets to. It first locks the workshop row, so two
-- connections registering for the same workshop at the same moment queue up
-- behind each other and the second one counts the first one's seat.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrations_prevent_overbooking() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  seat_limit INTEGER;
  booked     INTEGER;
BEGIN
  IF NEW.status <> 'REGISTERED' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'REGISTERED' AND OLD.workshop_id = NEW.workshop_id THEN
    RETURN NEW;
  END IF;

  SELECT capacity INTO seat_limit FROM workshops WHERE id = NEW.workshop_id FOR UPDATE;
  IF seat_limit IS NULL THEN
    RETURN NEW; -- the foreign key rejects the row
  END IF;

  SELECT COUNT(*) INTO booked FROM registrations
   WHERE workshop_id = NEW.workshop_id AND status = 'REGISTERED' AND id <> NEW.id;

  IF booked >= seat_limit THEN
    RAISE EXCEPTION 'WORKSHOP_CAPACITY_EXCEEDED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS registrations_prevent_overbooking ON registrations;
CREATE TRIGGER registrations_prevent_overbooking
BEFORE INSERT OR UPDATE OF status ON registrations
FOR EACH ROW EXECUTE FUNCTION registrations_prevent_overbooking();

-- ---------------------------------------------------------------------------
-- Supabase publishes every table in the public schema through its REST API.
-- BookMySeat never uses that API - only the server talks to the database - so
-- row level security is switched on with no policies, which shuts the REST
-- API out completely. The server connects as the table owner and is not
-- affected.
-- ---------------------------------------------------------------------------
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshops     ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;
