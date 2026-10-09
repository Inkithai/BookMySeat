# BookMySeat — Workshop Registration System

> Book simply. Manage easily.

Every seat. Every workshop. Sorted.

A full-stack registration system for a community training centre: manage workshops,
register attendees at the front desk, track seat availability, and never overbook a
workshop — no matter how many people are registering at the same moment.

- **Backend** — Node.js + Express + PostgreSQL, TypeScript
- **Frontend** — React + Vite, TypeScript
- **Storage** — PostgreSQL: [Supabase](https://supabase.com) in production, an
  embedded PostgreSQL ([PGlite](https://pglite.dev)) locally, so there is still no
  database server to install for development
- **Hosting** — frontend on **Vercel**, API on **Render**, database on **Supabase**
  (see [DEPLOYMENT.md](DEPLOYMENT.md))

---

## Quick start

You need **Node.js 22.5 or newer** (Node 22 LTS or 24 both work). Nothing else — no
database server, no Docker. Without `DATABASE_URL` the app keeps its data in an
embedded PostgreSQL under `data/pglite/`.

```bash
# 1. install dependencies
npm install

# 2. build the frontend and the API
npm run build

# 3. start it
npm start
```

Then open <http://localhost:4000> and sign in.

A brand-new database is created and seeded with demo data automatically on first
start, so there is nothing else to set up. To start over from scratch at any time:

```bash
npm run seed      # rebuilds the demo database (refuses if it holds real accounts)
```

### Running in development mode

For hot-reloading while you work:

```bash
npm run dev
```

That starts the API on <http://localhost:4000> and the Vite dev server on
<http://localhost:5173> (which proxies `/api` to the API). Use
<http://localhost:5173> in the browser.

| Command | What it does |
| --- | --- |
| `npm run dev` | API + frontend with hot reload (two processes) |
| `npm run build` | Compiles the API to `server/dist` and the UI to `client/dist` |
| `npm start` | Serves the built UI **and** the API from one port (4000) |
| `npm run seed` | Rebuilds the demo database from scratch. Refuses to run against a database holding accounts that are not part of the demo data, unless `FORCE_SEED=true` is set |
| `npm test` | Runs the test suite (59 tests, in-memory database) |
| `npm run typecheck` | Type-checks the server and the client |

---

## Signing in

There is no public signup. The first Administrator is seeded, and Administrators
create every other account.

| Role | Email | Password | What they can do |
| --- | --- | --- | --- |
| Administrator | `admin@bookmyseat.test` | `Admin123!` | Create staff accounts and set roles |
| Manager | `manager@bookmyseat.test` | `Manager123!` | Add/edit workshops, register and cancel attendees, read the activity log |
| Front desk | `staff@bookmyseat.test` | `Staff123!` | Register and cancel attendees |

> These are development-only credentials for this assessment. Never use them
> anywhere real.

### What each role may do

| | Admin | Manager | Staff |
| --- | :---: | :---: | :---: |
| Create user accounts and set roles | ✅ | ❌ | ❌ |
| Add and edit workshops | ❌ | ✅ | ❌ |
| Register and cancel attendees | ❌ | ✅ | ✅ |
| View workshops, registrations and history | ❌ | ✅ | ✅ |

**Everything not marked is refused by the API**, not merely hidden in the interface —
a `403` comes back from the server. The permissions matrix above is implemented
literally: an Administrator manages accounts and nothing else.

---

## Sample data

Nine workshops are seeded across three locations (Riverside Studio, City Lab 2,
Northside Hall), spread over the past two weeks and the next three, so the filters
have something to chew on:

- **Full workshops with a waitlist** — `COD-110` (20/20 with 3 waiting) and
  `POT-204` (8/8 with 2 waiting), for trying the waitlist.
- **A workshop with seats free** — `GAR-150`, empty and ready for registrations.
- **Cancellations in the history** — `ART-130` and `COD-099`, so the "who cancelled
  it and when" trail has real content.
- **A cancelled workshop** — `MUS-140`, which refuses new registrations.

Workshops are dated relative to the day you seed, so the list always looks current.

---

## How over-registration is prevented

This is the rule the client cares about most, so it is enforced in three places:

1. **One transaction.** Counting the seats and inserting the registration happen
   inside a single transaction.
2. **No interleaving.** That transaction starts by locking the workshop's row
   (`SELECT … FOR UPDATE`). Two staff members pressing *Register* at the same
   moment — even through different database connections or server instances —
   are serialised per workshop: the second one waits, then sees the first one's seat.
3. **The database has the final say.** A trigger in `schema.sql` (which takes the
   same row lock) aborts any insert or status change that would push a workshop past
   its capacity, even if a future code path forgets to check. That failure is turned
   into a clean `409`.

`tests/registrations.test.ts` fires **25 simultaneous registrations at a 3-seat
workshop** and asserts exactly three attendees get a seat and the other 22 are
queued.

The suite also covers the awkward cases the first version got wrong, so they stay
fixed: impossible dates such as 30 February or a 24:00 start time, a date range
that has to include the whole of its last day, "seats available" that ignores
cancelled and completed workshops, `hasSeats=false` not behaving like `true`,
promotions into closed workshops, and a seed command that refuses to reset a
database holding real accounts.

When a workshop is full, the attendee is **not** turned away — they go on the
waitlist, and when a seat is freed the longest-waiting person is offered it
automatically (the cancellation response says who got the seat).

Cancelling never deletes anything: the row keeps its place in the history with who
cancelled it and when, so the seat is genuinely reusable while the record survives.

---

## The API

All responses are JSON. Authentication is an httpOnly session cookie; there are no
tokens in JavaScript to steal.

| Method | Endpoint | Who |
| --- | --- | --- |
| `POST` | `/api/auth/login` | anyone |
| `POST` | `/api/auth/logout` | signed in |
| `GET` | `/api/auth/me` | signed in |
| `GET` | `/api/workshops?q=&status=&from=&to=&hasSeats=` | Manager, Staff |
| `POST` | `/api/workshops` | Manager |
| `GET` | `/api/workshops/:id` | Manager, Staff |
| `PATCH` | `/api/workshops/:id` | Manager |
| `POST` | `/api/workshops/:id/registrations` | Manager, Staff |
| `DELETE` | `/api/registrations/:id` | Manager, Staff |
| `POST` | `/api/registrations/:id/promote` | Manager, Staff |
| `GET` | `/api/users` | Admin |
| `POST` | `/api/users` | Admin |
| `PATCH` | `/api/users/:id` | Admin |
| `GET` | `/api/audit?entityType=&limit=` | Admin (account history), Manager (everything) |

Example:

```bash
curl -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff@bookmyseat.test","password":"Staff123!"}'

curl -b cookies.txt 'http://localhost:4000/api/workshops?hasSeats=true&from=2026-03-09&to=2026-03-15'

curl -b cookies.txt -X POST http://localhost:4000/api/workshops/3/registrations \
  -H 'Content-Type: application/json' \
  -d '{"attendeeName":"Amara Okafor","attendeeEmail":"amara@example.com"}'
```

Errors always look like `{"error": {"code": "...", "message": "...", "details": [...]}}`
with a matching HTTP status: `400` validation, `401` not signed in, `403` wrong role,
`404` no such record, `409` a business rule (workshop full, duplicate attendee,
capacity below the number of booked seats, email already in use).

---

## Finding workshops

The dashboard has a search box (title, code or instructor), a status filter, a
from/to date range, and one-click filters for **This week**, **Next 7 days** and
**Seats available** — the "which workshops this week still have seats" question the
front desk asked for. Upcoming workshops are listed first.

---

## Deploying (Vercel + Render + Supabase)

Frontend on **Vercel**, API on **Render**, database on **Supabase**. The full guide,
including the production environment variables, is in **[DEPLOYMENT.md](DEPLOYMENT.md)**.
The env template is [`.env.production.example`](.env.production.example).

| File | Used by |
| --- | --- |
| `vercel.json` | Vercel: builds `client/dist` and forwards `/api/*` to Render |
| `render.yaml` | Render Blueprint: builds and runs the API |
| `.env.production.example` | Render environment variables |

---

## Configuration

Everything has a working default; these are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Port the single-process server listens on |
| `DATABASE_URL` | – | PostgreSQL connection string (Supabase). When unset, the embedded database is used |
| `DATABASE_PATH` | `data/pglite` | Folder for the embedded database (only without `DATABASE_URL`) |
| `DATABASE_SSL` | on, except for `localhost` | Set to `false` to connect without TLS |
| `DATABASE_POOL_SIZE` | `5` | Maximum connections the API opens (1–100) |
| `TZ` | system | Time zone for "today" (demo dates). Production uses `Asia/Colombo` |
| `SEED_DEMO_DATA` | `true` | Seed demo data when a database is first created |
| `SESSION_TTL_DAYS` | `14` | How long a sign-in lasts |
| `WEB_PORT` | `5173` | Dev-server port (`npm run dev`) |
| `API_URL` | `http://localhost:4000` | Proxy target for the dev server |
| `NODE_ENV` | – | Set to `production` to mark the session cookie `Secure` |
| `FORCE_SEED` | – | Set to `true` to let `npm run seed` reset a database that holds real accounts |

Unusable values stop the app with a plain-language message instead of being
silently ignored: `SESSION_TTL_DAYS=abc`, `SESSION_TTL_DAYS=0`, `PORT=abc` and
`SEED_DEMO_DATA=maybe` all refuse to start, as does a `DATABASE_URL` that is not a
`postgresql://` URL. An empty value means "use the
default", so `SEED_DEMO_DATA=` behaves like `true`; use `false`, `0` or `no` to
turn the demo seed off.

---

## Project layout

```
server/
  src/
    index.ts            entry point: opens the database, seeds, listens
    app.ts              Express app, middleware, error handling, static files
    config.ts           environment-driven configuration
    schemas.ts          Zod request schemas (the validation boundary)
    types.ts            domain types
    db/
      schema.sql        tables, indexes, the capacity trigger, row level security
      index.ts          Postgres (Supabase) / PGlite connection, transaction helper
      seed.ts           demo accounts, workshops and registrations
    lib/                auth, audit, dates, errors, row mapping
    routes/             HTTP layer: parse, authorise, respond
    services/           business logic and SQL (one module per aggregate)
client/
  src/
    api.ts              typed API client
    auth.tsx            session context and route guards
    pages/              login, dashboard, workshop detail, accounts, activity log
    components/         layout, toasts, form fields
tests/                  64 tests over the real HTTP API, the database and the
                      date/config helpers
scripts/copy-sql.mjs    ships schema.sql with the compiled server
vercel.json             Vercel: builds the frontend, forwards /api to Render
render.yaml             Render Blueprint for the API
.env.production.example production environment variables (Render)
DEPLOYMENT.md           step-by-step deploy guide
```

---

## What was skipped

Deliberate scope cuts, all noted in [DESIGN.md](DESIGN.md):

- No email or SMS notifications to attendees (they have no accounts).
- No self-service password change, and no password reset flow.
- No pagination — the list is filtered and capped by the activity log instead.
- No login rate limiting (fine for one office, not fine on the public internet).
- No down-migrations; `npm run seed` rebuilds rather than migrates.
- Timezone handling assumes the centre's local wall-clock time.

See **[DESIGN.md](DESIGN.md)** for the reasoning behind the stack, the design
decisions, the trade-offs and the assumptions.
