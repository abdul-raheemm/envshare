This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Auth, projects, membership, environments, plain variable CRUD | ✅ Done |
| 2. Security and History | Sensitive variables, encryption, masking/reveal, change history | 🔲 Not started |
| 3. Smart Import and Polish | .env parser, New/Update/Unchanged preview, bulk import, polish | 🔲 Not started |

---
## Tech stack

Next.js 16 (App Router, TypeScript) · PostgreSQL 16 · Prisma 7 · Tailwind CSS 4 · zod ·
bcryptjs · jose (JWT sessions)

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

`.env` is never committed. `.env.example` is the template.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` / `npm run start` | Production build and server |
| `npm run lint` | Run ESLint |
| `npm run db:seed` | Add demo users, project and variables |

## Project layout

- `src/app` pages and API routes
- `src/components/ui` shared UI components (the only place buttons and inputs are styled)
- `src/lib` data access and security helpers (every data function checks project access)
- `prisma` schema, migrations and seed script

## Security notes

- Passwords are hashed with bcrypt; sessions use an httpOnly, SameSite=Lax cookie.
- Every project, environment and variable operation checks membership on the server.
  Resources a user cannot access return 404, the same as missing ones.
- Login is rate-limited per email (in memory; see assumptions).
- Server logs record only error types, never messages, request bodies or values.