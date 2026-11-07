# EnvShare

A secure, internal portal where a team can store, share and track changes to project environment variables (database URLs, API keys, feature flags). Sensitive values are encrypted at rest, masked in the UI, revealed only on request, and every change is logged.

## Project status

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Auth, projects, membership, environments, plain variable CRUD | ✅ Done |
| 2. Security and History | Sensitive variables, encryption, masking/reveal, change history | ✅ Done |
| 3. Smart Import and Polish | .env parser, New/Update/Unchanged preview, bulk import, polish | 🔲 Not started |

## Tech stack

Next.js 16 (App Router, TypeScript) · PostgreSQL 16 · Prisma 7 · Tailwind CSS 4 · zod ·
bcryptjs · jose (JWT sessions) · Node `crypto` (AES-256-GCM) · Vitest

## Prerequisites

- Node.js 20.19 or newer
- Docker Desktop (for local PostgreSQL), or any PostgreSQL 16 database

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your environment file and fill it in:
   ```bash
   cp .env.example .env        # Windows PowerShell: copy .env.example .env
   ```
   Generate a value for `JWT_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Generate a **different** value for `ENCRYPTION_KEY` with the same command (it must be 64 hex characters).
3. Start the database:
   ```bash
   docker compose up -d
   ```
4. Apply the database migrations and generate the Prisma client:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```
5. (Optional) Add demo data:
   ```bash
   npm run db:seed
   ```
   Demo logins: `alice@example.com` and `bob@example.com`, both with password `password123`.
   The demo data uses obviously fake values only.
6. Run the app:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000

## Environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing session cookies (at least 32 characters) |
| `ENCRYPTION_KEY` | 64 hex characters (32 bytes). Encrypts Sensitive variable values and their history |

`.env` is never committed. `.env.example` is the template.

> **Keep `ENCRYPTION_KEY` safe.** If it is lost, or changed after values were saved, every Sensitive value becomes unrecoverable. Key rotation is not implemented. Use a separate key for every deployment, and never reuse `JWT_SECRET` as the encryption key.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` / `npm run start` | Production build and server |
| `npm run lint` | Run ESLint |
| `npm run db:seed` | Add demo users, project, variables and history |
| `npm test` | Unit tests (crypto, response masking). No database needed |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:security` | Security suite on a separate `envshare_test` database (needs Docker Postgres running) |
| `npm run sweep:http` | HTTP security sweep against a running dev server (`-- --log dev.log` also scans a saved server log) |

## Project layout

- `src/app` pages and API routes
- `src/components/ui` shared UI components (the only place buttons and inputs are styled)
- `src/components/variables`, `src/components/history` feature components
- `src/lib` data access and security helpers (every data function checks project access)
- `prisma` schema, migrations and seed script
- `tests/security` automated security suite
- `scripts` test database setup and the HTTP sweep

## Security notes

- Passwords are hashed with bcrypt; sessions use an httpOnly, SameSite=Lax cookie.
- Every project, environment, variable and history operation checks membership on the server.
  Resources a user cannot access return 404, the same as missing ones.
- Login is rate-limited per email (in memory; see assumptions).
- Server logs record only error types, never messages, request bodies or values.
- **Sensitive variables** are encrypted with AES-256-GCM, with a fresh random IV for every value, before they are written to the database. The key comes from `ENCRYPTION_KEY`.
- Sensitive values are masked everywhere the server sends data (pages, API responses, history). Plaintext leaves the server only through the reveal endpoints, which use `POST`, send `Cache-Control: no-store`, require project membership, and write an audit row first.
- Every reveal is recorded (who, which key, when, never the value).
- History is append-only and stores encrypted values for Sensitive variables. When a variable becomes Sensitive, its earlier plain-text history is encrypted as well.
- Variable changes and their history rows are written in one database transaction.
- The suites above check these rules automatically: ciphertext at rest, a plaintext scan of the whole database, masking, non-member access, tampering, key problems, route methods, cache headers, and that real keys are never committed.

## Assumptions

1. The project owner is also stored as a `ProjectMember` row, so access checks are one query.
2. Roles: **owner** (can invite members) and **member** (can view and edit variables).
3. Environment variable keys are case-sensitive and unique per environment.
4. Importing never deletes keys that are missing from the pasted text (Phase 3).
5. Any project member can reveal Sensitive values. Every reveal is logged with user, key and time, never the value.
6. History has one row per key per change, grouped into batches. It survives variable deletion.
7. A rename is logged as an update with the old key recorded.
8. When a variable becomes Sensitive, its earlier plain-text history values are encrypted. Switching back to Standard does not decrypt history.
9. Losing `ENCRYPTION_KEY` makes all encrypted values unrecoverable. Key rotation is out of scope.
10. When editing a Sensitive variable, a blank value field means "keep the current value".
11. A type change (Standard or Sensitive) is logged without storing any value.
12. A revealed value hides itself after 15 seconds.
13. The login rate limit is kept in server memory, so it resets on restart and is not shared between server instances.