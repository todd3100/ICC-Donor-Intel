# ICC Donor Intelligence

A living CRM and AI-powered research platform for the Israel on Campus Coalition (ICC) donor development team. It profiles high-potential Jewish and pro-Israel prospects, surfaces warm introduction pathways through ICC's existing donor network, and tracks outreach across a small (2–5 person) internal team.

## What's inside

- **100 real ICC donors** pre-seeded from `Donor-Program-Data.xlsx` (grand-total deduplicated)
- **3 sample prospects** so the app is never empty on first boot
- **AI research engine** — server-side Claude Sonnet 4.5 with web search, injecting the full live donor list into every research call
- **Full audit trail + team notes** on every prospect
- **CSV donor import** (admin only) with upsert-by-name

## Tech stack

- Frontend: React 18 + Vite
- Backend: Node 20 + Express
- Database: PostgreSQL (Railway managed)
- ORM: Prisma 5
- Auth: JWT in an httpOnly cookie, bcrypt-hashed passwords, 7-day expiry
- AI: Anthropic Claude via `@anthropic-ai/sdk` (server-side only — the API key is never exposed to the browser)
- Deployment: Railway via `railway.toml` + Nixpacks

## Repo layout

```
/
├── client/             React + Vite frontend
├── server/             Express API + Prisma + seed
│   └── prisma/         schema.prisma, seed.js, donors_seed.json (100 real donors)
├── railway.toml        Railway build/deploy config
├── nixpacks.toml       Nixpacks build plan
├── .env.example
└── package.json        root workspace scripts
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Railway's Postgres plugin injects this automatically. |
| `JWT_SECRET` | 64+ character random string used to sign login cookies. Generate with `openssl rand -hex 32`. |
| `ANTHROPIC_API_KEY` | Claude API key used for the AI research engine. |
| `SEED_ADMIN_EMAIL` | Email of the default admin. Created once, on first boot only. |
| `SEED_ADMIN_PASSWORD` | Password of the default admin (change after first login). |
| `PORT` | HTTP port. Railway injects this; locally defaults to `3000`. |
| `NODE_ENV` | `production` on Railway, otherwise unset. |
| `RUN_SEED_ON_START` | Set to `false` to disable the idempotent boot-time seed. Default `true`. |

## Local development

Requires Node 20+ and a local Postgres database.

```bash
# 1. Clone and install everything
git clone <your-repo-url>
cd icc-donor-intel
npm install          # installs root + client + server

# 2. Copy env template and fill in real values
cp .env.example server/.env
# edit server/.env — set DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY,
# SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD

# 3. Create the database schema
cd server
npx prisma db push   # syncs schema to your Postgres (no migrations to manage)
npm run seed         # loads the 100 donors + 3 sample prospects + admin user
cd ..

# 4. Run the app (two processes)
npm run dev          # runs server on :3000 and client on :5173
```

The client dev server proxies `/api/*` to the Express server, so `http://localhost:5173` is your working URL.

## Deploy to Railway

1. **Create a Railway project** and connect this GitHub repo.
2. **Add the PostgreSQL plugin** — Railway will auto-inject `DATABASE_URL`.
3. **Add these environment variables** in the Railway service settings:
   - `JWT_SECRET`
   - `ANTHROPIC_API_KEY`
   - `SEED_ADMIN_EMAIL`
   - `SEED_ADMIN_PASSWORD`
   - `NODE_ENV=production`
4. **First deploy**: Railway runs `npm run build`, which:
   - installs dependencies
   - generates the Prisma client
   - runs `prisma db push` to sync the schema to the managed Postgres
   - builds the Vite client bundle into `client/dist`
5. **Boot**: `node server/index.js` starts the Express server on the injected `PORT`, serves the static client from `/client/dist`, and runs the idempotent seed (creates the admin user, donors, and sample prospects if they don't exist).
6. Open the Railway-provided URL and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
7. In the Users tab, invite your other 1–4 teammates. Change your own password afterward (for now, change it by adding yourself as a new user with a fresh password and deleting the seeded account, or update the hash directly).

> **Schema management**: this repo uses `prisma db push` to sync `schema.prisma` directly to your database on every deploy — no migration files to maintain. This is a pragmatic choice for a small internal tool where the schema changes slowly and there's no production data to carefully migrate. If you later want full migration history, run `npx prisma migrate dev --name init` locally once, commit the generated `server/prisma/migrations/` folder, and change `prisma:deploy` in `server/package.json` to run `prisma migrate deploy` instead of `prisma db push`.

## Using the app

### Prospects tab
- List of all prospects with filter/search/sort
- Click any row to open the detail drawer
- `+ Add Prospect` to create a new one (only name is required)
- Inside a prospect: edit fields, run AI research, link ICC donors, log outreach, post team notes

### AI research
- Click **Run AI Research** on any prospect's detail view
- Claude is called server-side with the full live donor list in context
- You get back a structured review UI — uncheck any field you don't want applied
- Click **Apply to Profile** to save. An audit-log entry is recorded.
- If Claude returns malformed JSON, the raw output is shown and the profile is untouched.

### ICC Donor Network tab
- Permanent institutional memory — 100 donors pre-seeded from `Donor-Program-Data.xlsx`
- Principals are empty on seed; fill them in manually or via CSV re-import (upsert by name)
- Admins can add/edit/delete donors or import a CSV (`name, type, principals, notes` — principals semicolon-separated)
- Each donor card shows how many prospects are linked to it

### Users tab (admin only)
- Create and delete team members
- Two roles: `admin` (full access + user management) and `member` (everything except user management)

## Security notes

- All routes except `/api/auth/login` and `/api/health` require authentication.
- The Anthropic API key lives only on the server — the client never sees it.
- Passwords are bcrypt-hashed (cost factor 12).
- JWTs are stored in an httpOnly cookie with `sameSite=lax` and `secure` in production.
- The AI research endpoint is rate-limited only by your Anthropic account's rate limits — add an application-level limiter if needed for cost control.

## License

Internal ICC project — not for redistribution.
