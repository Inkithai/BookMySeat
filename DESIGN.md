# BookMySeat — design notes

One page on the choices behind the build, the trade-offs, and what is deliberately
missing. Companion to `README.md`.

## Stack, and why

**Node 22 + Express 5 + PostgreSQL for the API.**
The app started on SQLite (`node:sqlite`) as one self-contained process. It now runs
on PostgreSQL so it can be hosted the usual way — static frontend on Vercel, API on
Render, database on Supabase — with no state on the API host's disk (Render's free
disk is wiped on every deploy). For local development and the tests, PGlite (a WASM
build of PostgreSQL) runs in-process, so there is still no database server to
install and no native module to compile. Express 5 is the boring, well-understood
choice, and it handles errors thrown from async handlers on its own. TypeScript
throughout, because "which role is allowed to do this" is exactly the kind of thing
that should be a compile-time error rather than a runtime surprise.

**PostgreSQL for storage, with the capacity rule written into the schema.**
The overbooking rule lives in the database (the `registrations_prevent_overbooking`
trigger) as well as in application code, so the invariant holds even if someone
later adds a code path that forgets to check. Both the services and the trigger lock
the workshop row before counting, so concurrent bookings queue up instead of racing.

**React 19 + Vite + React Router for the frontend.**
The interface is a handful of screens over one resource, so a component-per-page SPA
with a typed `fetch` wrapper is proportionate. No state-management library and no
UI kit: a single hand-written stylesheet with CSS variables is easier for the next
developer to change than a dependency is. `zod` validates every request at the
boundary so the services can trust their inputs.

**Session cookies, not JWTs.**
The token is 32 random bytes, stored only as a SHA-256 hash in a `sessions` table,
and sent as an httpOnly, `SameSite=Lax` cookie. That means a leaked database file
cannot be used to hijack a session, deactivating an account takes effect
immediately, and rotating a password signs that user out everywhere — none of which
a stateless JWT gives you for free.

## Design decisions

**The permissions matrix is enforced literally.** The client marked Admin's access
to workshops, registrations and history as "No", and said anything not marked must
be refused by the backend. So `GET /api/workshops` returns `403` for an
Administrator. It reads strictly, but it is what was asked for, and it is one line
per route to widen later if the client changes their mind.

**Routes parse and authorise; services hold the logic.** Each route module is a
factory (`workshopsRouter(db)`) so a test can build an app against a fresh in-memory
database. Services take the database as a parameter and never import Express, which
keeps the business rules testable and the HTTP concerns in one place.

**Registrations are never deleted.** Cancelling sets `status`, `cancelled_at` and
`cancelled_by`. A partial unique index on `(workshop_id, attendee_email)` where the
status is live is what stops the same person holding two places while still allowing
them to register again after a cancellation. `COLLATE NOCASE` keeps
`Sam@Example.com` and `sam@example.com` the same person.

**A full workshop queues people rather than refusing them.** The waitlist is the
bonus feature, but it also makes the capacity rule easier to hold: there is never a
reason to squeeze someone in. Cancelling a seat automatically promotes the
longest-waiting attendee, and the API response says who got the seat so the front
desk can tell the person on the phone. Promotion only happens on a scheduled
workshop: a cancelled or completed workshop keeps its freed seat free and refuses a
manual promotion with `WORKSHOP_CLOSED`, because the attendee is not going to a
workshop that is not happening.

**Workshop times are local wall-clock values.** Staff type `10:00` and expect to
read back `10:00`, so `starts_at` is stored as a naive ISO string with no offset.
Audit timestamps, by contrast, are UTC instants. Mixing the two would have been
worse than picking one rule per kind of time and documenting it.

**Capacity can only go up, or down to the number of booked seats.** Reducing a
20-seat workshop to 12 seats when 18 people hold seats would silently overbook it,
so that is refused with a message that says how many registrations are in the way.

**The audit trail is scoped by role.** Managers see everything; Administrators see
account history only, matching what they are allowed to touch.

## How over-registration is prevented

Three layers, on purpose:

1. **Transaction.** `withTransaction` wraps the count and the insert in one
   transaction; any failure rolls the whole unit back.
2. **Serialisation.** The transaction first locks the workshop row
   (`SELECT … FOR UPDATE`), so concurrent registrations for the same workshop, even
   from different connections or server instances, wait their turn rather than race.
3. **Database trigger.** The trigger aborts a write that would exceed capacity,
   turning a hypothetical bug into a `409` instead of an overbooked workshop.

The test suite fires 25 simultaneous registrations at a 3-seat workshop and asserts
three seats and 22 queued — the "two of us promised the last seat at the same time"
scenario from the brief.

## Trade-offs

- **Two PostgreSQL engines.** Production uses a real server (Supabase); development
  and tests use PGlite. Both are PostgreSQL, so the SQL is identical, but PGlite runs
  everything on one connection. The multi-connection locking was verified separately
  against a real PostgreSQL server.
- **Timestamps are ISO text, not `timestamptz`.** That kept the move from SQLite
  small and the wall-clock workshop times exactly as typed. ISO strings sort
  correctly, so filtering and ordering still work.
- **No migrations.** `schema.sql` is idempotent and re-applied on boot; `npm run
  seed` rebuilds demo data. There are no down-migrations, which is a deliberate
  simplification for a system with one deployment.
- **Client and server each define their types.** The HTTP response is the contract,
  and the duplication is ~60 lines. A shared package would be the next step, not a
  prerequisite.
- **Duplicate attendees are blocked.** The same email cannot hold two places in one
  workshop. That is a business rule the client did not specify; it prevents the
  obvious spreadsheet mistake, and it is easy to relax.

## Assumptions

- The centre runs in a single timezone; workshop times are local wall-clock.
- Attendees have no accounts and no login, so no notifications were built.
- "Workshop code" is a short unique identifier (`POT-101`), not the database id.
- Statuses are `SCHEDULED`, `CANCELLED` and `COMPLETED`; a cancelled workshop keeps
  its registrations as history but refuses new ones.
- Roles are a fixed set of three, assigned by an Administrator.
- A deactivated account keeps its history but cannot sign in, and its sessions are
  revoked.

## What was skipped

- **Attendee notifications** (email/SMS) — attendees have no accounts or contact
  preferences.
- **Password reset and self-service password change.** Admins can rotate a password;
  there is no "forgot password" flow, which would need an email transport.
- **Login rate limiting.** Fine for one office LAN, not fine exposed to the
  internet.
- **Pagination.** The workshop list is filtered rather than paged, and the activity
  log is capped at 100 entries.
- **Recurring workshops.** Each occurrence is its own row.
- **Deleting workshops.** Cancelling is the supported path; destructive deletes
  were left out on purpose so history cannot disappear.
- **Automated browser (end-to-end) tests.** The suite drives the real HTTP API with
  `node:test`, including the concurrency case; a Playwright pass would be the next
  addition.
