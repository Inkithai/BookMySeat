# Deploying BookMySeat: Vercel + Render + Supabase

One repository and one `package.json`, deployed to three services:

```
 browser ──► Vercel   React site (client/dist)
               │  /api/*  forwarded (proxied) to
               ▼
             Render   Express API (server/dist)
               │
               ▼
             Supabase PostgreSQL database
```

Vercel forwards `/api` to Render, so the browser only ever talks to the Vercel
address. The sign-in cookie is a normal first-party cookie, and you don't need to
set up CORS.

Do the steps in this order: **Supabase → Render → Vercel**. Each one needs a value
from the step before.

---

## 1. Supabase: the database

1. Go to <https://supabase.com> → **New project**.
   - **Region:** Southeast Asia (Singapore). Render will use the same region, so the
     database is close to the API.
   - **Database password:** use letters and digits only (or URL-encode symbols later).
     Save it.
2. When the project is ready, click **Connect** (top bar) and open the
   **Session pooler** tab. Copy the string:

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

   Replace `[YOUR-PASSWORD]` (including the brackets) with your password.

   > Use the **Session pooler**, not **Direct connection**. The direct host is
   > IPv6-only and Render can't reach it.

You don't need to create any tables. The API creates the schema on its first start,
and it turns on row level security so Supabase's public REST API can't read the
data. Only the API server can.

---

## 2. Render: the API

1. Push this repository to GitHub (the branch you want to deploy, normally `main`).
2. Render dashboard → **New → Blueprint** → connect the repository.
   Render reads `render.yaml` and creates the `bookmyseat-api` web service.
3. When it asks for `DATABASE_URL`, paste the Supabase string from step 1.
4. Click **Apply**. The first build takes about 2–3 minutes.
5. Open `https://bookmyseat-api.onrender.com/api/health` (use the URL Render shows
   you). You should see:

   ```json
   {"ok":true}
   ```

   The first start also creates the demo accounts and workshops
   (`SEED_DEMO_DATA=true`).

**Without the Blueprint.** Choose **New → Web Service** and fill in:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Region | Singapore |
| Build command | `npm ci --include=dev && npm run build:api` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Environment | **Add from .env** → paste the contents of `.env.production.example`, then fill in `DATABASE_URL` |

---

## 3. Vercel: the frontend

1. Open `vercel.json` and set the `/api` rewrite to **your** Render address:

   ```json
   "destination": "https://bookmyseat-api.onrender.com/api/:path*"
   ```

   Commit and push.
2. Vercel → **Add New → Project** → import the repository.
   - Root directory: the repository root (leave the default).
   - Build settings come from `vercel.json`. Don't override them.
   - Environment variables: **none**.
3. Click **Deploy**, then open the Vercel URL and sign in with a demo account.

---

## Production environment variables

**Render (API).** These are also in `.env.production.example`:

```env
DATABASE_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_DB_PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
NODE_VERSION=22
NODE_ENV=production
TZ=Asia/Colombo
SEED_DEMO_DATA=true
DATABASE_POOL_SIZE=5
SESSION_TTL_DAYS=14
```

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Supabase Session pooler string. The only secret. |
| `NODE_VERSION` | The app needs Node 22.5 or newer. |
| `NODE_ENV=production` | Marks the session cookie `Secure` (HTTPS only). |
| `TZ` | Render runs on UTC. This makes "today" (demo dates) match Sri Lanka time. |
| `SEED_DEMO_DATA=true` | Fills an **empty** database with demo data. It never changes existing data. |
| `DATABASE_POOL_SIZE` | Maximum database connections. 5 fits the Supabase free tier comfortably. |
| `SESSION_TTL_DAYS` | How long a sign-in lasts. |

Don't set `PORT`: Render sets it for you.

**Vercel (frontend).** No variables. The Render address lives in `vercel.json`.

**Supabase.** Nothing to configure.

---

## Demo data in production (`SEED_DEMO_DATA=true`)

- Seeding runs only while the `users` table is empty, which means once, on the first
  start. Restarts and redeploys never reset or duplicate the data.
- Demo sign-ins (also shown on the login page):

  | Role | Email | Password |
  | --- | --- | --- |
  | Admin | admin@bookmyseat.test | Admin123! |
  | Manager | manager@bookmyseat.test | Manager123! |
  | Staff | staff@bookmyseat.test | Staff123! |

  These passwords are public. Anyone who opens the site can sign in as Admin. That's
  fine for a demo. Change them (Accounts page) before you store real data.
- Workshop dates are relative to the day of seeding, so they drift into the past over
  the weeks. To refresh the demo, run this from your computer. It refuses if real
  (non-demo) accounts exist, unless you add `FORCE_SEED=true`:

  ```bash
  DATABASE_URL='postgresql://…your Supabase string…' npm run seed
  ```

---

## Good to know

- **Render free plan sleeps** after 15 minutes without traffic. The first request
  afterwards takes 30–60 seconds while it wakes up. If the site shows "server is not
  responding yet", wait a moment and try again.
- **Supabase free projects pause** after 7 days without activity. Resume the project
  from the Supabase dashboard if `/api/health` starts returning
  `DATABASE_UNAVAILABLE`.
- **Auto-deploys:** pushing to the connected branch redeploys both Render and Vercel.
  If you only change the API, Vercel redeploys anyway. That's harmless.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Render log: `could not open postgresql://…` / `ENOTFOUND` / `ENETUNREACH` | You used the *Direct connection* string. Use the **Session pooler** one. |
| Render log: `password authentication failed` | Wrong password, or `[YOUR-PASSWORD]` still has its brackets. |
| Render log: `Invalid URL` | The password has symbols. URL-encode them or reset the password. |
| Render build: `tsc: not found` | The build command is missing `--include=dev`. |
| Vercel site loads, but sign-in fails with "server is not responding" | `vercel.json` still points at the wrong Render address, or Render is waking up. |
