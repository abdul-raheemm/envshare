# EnvShare: Phased Project Plan

> **How to use this file:** Phase 1 is fully detailed. Phases 2 and 3 are outlined, with the decisions and traps you'll need. When a phase is finished, tick its checklist, update the **Status Tracker**, and ask Claude to expand the next phase using the template at the bottom. Keep this file in your repo as `PLAN.md`.

---

## Status Tracker

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Auth, projects, membership, environments, plain variable CRUD | 🔲 Not started |
| 2. Security and History | Sensitive variables, encryption, masking/reveal, change history | 🔲 Not started |
| 3. Smart Import and Polish | .env parser, New/Update/Unchanged preview, bulk import, polish | 🔲 Not started |

---

## Project-wide Decisions (apply to all phases)

### Stack (swap if your course requires something else)
| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) with TypeScript; one repo for UI and API |
| Database | PostgreSQL |
| ORM | Prisma |
| Styling | Tailwind CSS (the only styling system; no mixing) |
| Password hashing | bcryptjs (cost factor 12) |
| Sessions | JWT in an httpOnly, SameSite=Lax cookie (via `jose`) |
| Validation | zod |
| Encryption (Phase 2) | Node `crypto`, AES-256-GCM |
| Tests | Vitest (needed mainly for the Phase 3 parser) |

## Assumptions and design decisions

### Accounts and sessions
1. Emails are trimmed and lowercased before saving, and must be unique.
2. Passwords must be at least 8 characters and at most 72 bytes (bcrypt ignores anything beyond 72 bytes). They are hashed with bcrypt (cost 12).
3. Sessions use a signed JWT in an httpOnly, SameSite=Lax cookie that lasts 7 days (Secure flag in production). The user is re-read from the database on every request, so a deleted user's old cookie stops working.
4. Login gives the same message ("Invalid email or password") for an unknown email and a wrong password, and takes about the same time for both.
5. Signup does tell the visitor when an email is already registered, because the brief asks for that kind of clear message. This is a known trade-off.
6. Not in this version: password reset, email verification, and rate limiting on login (rate limiting is planned for the Step 1.9 pass).

### Projects and membership
7. The project owner is also stored as a `ProjectMember` row, so every access check is one query.
8. Two roles: **owner** (can invite members) and **member** (can view and edit all environments and variables in the project). There are no per-environment permissions.
9. Anyone logged in can create a project and becomes its owner. Project names don't have to be unique (max 100 characters).
10. Members are added immediately by email (no pending invitations), and only registered users can be added. Only the owner can invite.
11. Non-members get a **404** (not 403) for projects, environments and variables, so IDs can't be probed. A member who is not the owner gets a **403** on owner-only actions.
12. All members can see the member list, including emails.
13. Not in this version: removing members, renaming projects, deleting projects (not required by the brief).

### Environments
14. New projects automatically get Development, Staging and Production. Projects created before this feature have none and can add them manually.
15. Any member can add an environment.
16. Environment names are unique per project, ignoring upper/lower case and surrounding spaces (max 50 characters).
17. Environments cannot be renamed or deleted in this version.
18. The selected environment tab is stored in the URL (`?env=<id>`); an invalid or foreign ID falls back to the first tab.

### Variables
19. Keys match `^[A-Za-z_][A-Za-z0-9_]*$` (max 128 characters), are **case-sensitive**, and are unique per environment (`port` and `PORT` are different keys).
20. Values may be empty or span several lines (max 10,000 characters) and are stored exactly as entered (not trimmed).
21. Any member can add, edit, delete and copy variables in any environment of their project. Variables are listed alphabetically by key.
22. Edits use optimistic locking: each variable has a version number, and a save only succeeds if the version is unchanged. A stale edit shows "This variable was changed by someone else. Reload and try again". Saving without changing anything does not bump the version.
23. Deleting a variable is permanent in Phase 1 (Phase 2 history will keep a record).
24. In Phase 1, values are stored as plain text and a banner says so. Phase 2 adds encryption.
25. Importing a pasted `.env` never deletes keys missing from the pasted text (Phase 3).

### Architecture
26. Stack: Next.js 16 (App Router), Prisma 7.10.0 (pinned exactly), PostgreSQL 16 in Docker for development, Tailwind CSS 4 as the only styling system, zod for validation.
27. Pages read data through server components that call functions in `src/lib/`; changes go through API routes. Every data function takes the user's ID and checks access itself.
28. The login check in the page layout is a convenience only. The real protection is the access check inside every data function and API route.
29. All API errors use one shape: `{ error: "message", fields?: { fieldName: "message" } }`.
30. All variable writes live in `src/lib/variables.ts`, so Phase 2 history logging only has to change that file.
31. Next.js Cache Components is turned off, because every page depends on who is logged in. There is no middleware.
32. Required environment variables: `DATABASE_URL`, `JWT_SECRET` (at least 32 characters). `.env` is never committed; `.env.example` is.

### Deviations from the original plan
- Prisma was set up by hand (no `prisma init`) with the `prisma.config.ts` file and a driver adapter, which Prisma 7 requires.
- Dependencies were installed in the step that first uses them, not all in Step 1.1.
- The listed `GET` endpoints for projects, members, environments and variables were not built. Pages read the same data directly on the server, with the same access checks.
- Default environments are auto-created (the plan marked this as optional).

### Authorization audit (Step 1.8)

| Endpoint / page | Login check | Resource check | Outsider result |
|---|---|---|---|
| POST /api/projects | requireUser | owner = session user | n/a |
| POST /api/projects/:id/members | requireUser | requireProjectOwner | 404 (non-member), 403 (member, not owner) |
| POST /api/projects/:id/environments | requireUser | requireProjectAccess | 404 |
| POST /api/environments/:id/variables | requireUser | requireEnvironmentAccess | 404 |
| PATCH /api/variables/:id | requireUser | requireVariableAccess | 404 |
| DELETE /api/variables/:id | requireUser | requireVariableAccess | 404 |
| /dashboard | requireUserForPage | list filtered by membership | n/a |
| /projects/:id | requireUserForPage | getProjectAccess, else notFound | 404 page |

Public by design: signup, login, logout.
Missing and inaccessible resources return the same 404 message, so IDs cannot be probed.
Mutating endpoints accept only application/json (415 otherwise). Logged-out requests get 401.
Tested: 11 scripted attacks as a non-member, the same 11 logged out, page URL tampering,
a tampered session cookie, and a database check that nothing changed.

### Added in Step 1.9
33. After 5 failed logins for an email, that email is locked for up to 15 minutes. The counter is kept in memory, so it resets when the server restarts and works for a single server only; a production deployment would use a shared store such as Redis. Because the lock is per email, someone could lock a known email out for 15 minutes; this is an accepted trade-off.
34. Server logs record only the type of an error (for example a database error code), never error messages, request bodies, or values.
35. All endpoints that read a body accept only application/json (415 otherwise).

### Full data model (create the whole schema once, so later phases need no rework)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  createdAt    DateTime @default(now())
  ownedProjects Project[]
  memberships   ProjectMember[]
}

model Project {
  id           String   @id @default(cuid())
  name         String
  ownerId      String
  createdAt    DateTime @default(now())
  owner        User     @relation(fields: [ownerId], references: [id])
  members      ProjectMember[]
  environments Environment[]
}

model ProjectMember {
  id        String   @id @default(cuid())
  projectId String
  userId    String
  createdAt DateTime @default(now())
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id])
  @@unique([projectId, userId])
}

model Environment {
  id        String   @id @default(cuid())
  projectId String
  name      String
  createdAt DateTime @default(now())
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  variables Variable[]
  @@unique([projectId, name])
}

model Variable {
  id            String   @id @default(cuid())
  environmentId String
  key           String
  value         String            // Phase 1: plain text. Phase 2: ciphertext when isSensitive
  isSensitive   Boolean  @default(false)
  iv            String?           // Phase 2
  authTag       String?           // Phase 2
  version       Int      @default(1)  // optimistic locking
  updatedById   String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  environment   Environment @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  @@unique([environmentId, key])
}

// Added in Phase 2 (design it now, build it then):
// model HistoryEntry {
//   id, environmentId, batchId, action (CREATE|UPDATE|DELETE|TYPE_CHANGE),
//   key (string, NOT a foreign key), oldValue?, newValue?, wasSensitive,
//   iv/authTag for each encrypted value, changedById, changedAt
// }
```

> `Variable` has the Phase 2 columns now (`isSensitive`, `iv`, `authTag`) so you won't need a migration that touches existing data later.

---

# PHASE 1: Foundation

**Goal:** Two users can sign up, share a project, and manage plain variables, with access control enforced everywhere.

**Covers brief sections:** 2A (accounts, projects, team access), 2B (environments), the CRUD part of 2C, and the usability requirements in section 3.

> ⚠️ **During Phase 1, values are stored as plain text. Do not enter real secrets while testing.**

## Step 1.1: Repo and tooling
- [✅ ] Create the Next.js app (TypeScript, Tailwind, App Router) and init git.
- [✅ ] Install: `prisma @prisma/client bcryptjs jose zod` (plus `vitest` for later).
- [✅ ] Create `.env` and `.env.example` with `DATABASE_URL` and `JWT_SECRET`. Add `.env` to `.gitignore` (an env manager project that leaks its own `.env` looks bad).
- [✅ ] Set up a local Postgres database (Docker or a hosted free tier).

## Step 1.2: Database schema
- [✅ ] Paste the schema above into `prisma/schema.prisma`, run `prisma migrate dev`.
- [✅ ] Create a `lib/db.ts` that exports a single Prisma client instance.
- [✅ ] Write a small seed script (2 users, 1 project, 3 environments) for demos.

## Step 1.3: UI foundation (do this early so everything stays uniform)
- [✅ ] Define Tailwind theme colors (primary, danger, muted) in the config.
- [✅ ] Build reusable components: `Button` (primary/secondary/danger), `Input` (with label and error text), `Card`, `Modal`, `Alert`, `PageHeader`.
- [✅ ] Build one shared layout with a navbar (app name, user name, logout).
- [ ✅] Rule: **no page may use ad-hoc button or input styles.** Use only these components.

## Step 1.4: Authentication
- [ ✅] `POST /api/auth/signup`: validate email format and password length (8+), reject duplicates ("An account with this email already exists"), hash with bcrypt, store.
- [✅ ] `POST /api/auth/login`: verify the hash, set the JWT cookie. Use the **same generic error** for wrong email and wrong password ("Invalid email or password").
- [✅ ] `POST /api/auth/logout`: clear the cookie.
- [✅ ] Helper `getCurrentUser(request)` that returns the user or null.
- [✅ ] Middleware or helper that redirects unauthenticated users to `/login`.
- [✅ ] Pages: `/signup`, `/login`.

## Step 1.5: Projects and membership
- [ ✅] Helper `requireProjectAccess(userId, projectId)`: looks up `ProjectMember`; throws 403/404 if none. **Every project, environment, and variable route must call this.**
- [✅ ] `POST /api/projects`: create the project and, in the same transaction, insert the owner as a `ProjectMember`.
- [✅ ] `GET /api/projects`: list projects the current user is a member of.
- [ ✅] `POST /api/projects/:id/members`: owner only. Takes an email; errors: "No registered user with this email", "User is already a member".
- [ ✅] `GET /api/projects/:id/members`: list members.
- [ ✅] Pages: `/dashboard` (project list + create form), `/projects/[id]` (overview + members panel; invite form visible to owner only).

## Step 1.6: Environments
- [✅] `POST /api/projects/:id/environments`: unique name per project ("This environment already exists").
- [✅] `GET /api/projects/:id/environments`.
- [✅] Optionally auto-create Development, Staging, Production when a project is created.
- [✅] UI: environment tabs on the project page.

## Step 1.7: Variable CRUD (plain text)
- [✅ ] `GET /api/environments/:id/variables`
- [✅ ] `POST /api/environments/:id/variables`: validate key format (`^[A-Za-z_][A-Za-z0-9_]*$`), reject duplicate keys ("This key already exists"), set `updatedById`.
- [ ✅] `PATCH /api/variables/:id`: edit key or value. Send the current `version`; if it doesn't match, return a conflict ("This variable was changed by someone else. Reload and try again") and increment the version on success.
- [✅ ] `DELETE /api/variables/:id`: with a confirmation modal in the UI.
- [✅ ] UI: table of key/value rows, "Add variable" form, inline edit, a clear **Copy** button on each value, delete button.

## Step 1.8: Authorization sweep (do not skip)
- [ ] Walk through every route and confirm it checks membership. For variable routes, load the variable, then its environment, then its project, then check access.
- [ ] Test manually: log in as User B and try to fetch User A's project, environment, and variable by ID. Every attempt must fail.
- [ ] Return 404 (not 403) for resources the user can't access, so IDs aren't confirmed to exist.

## Step 1.9: Errors, validation, and usability pass
- [ ] Use zod on every request body; return field-level messages.
- [ ] Show server errors in an `Alert` or under the relevant input, never raw JSON.
- [ ] Loading and empty states ("No projects yet. Create your first one").
- [ ] Make sure nothing logs full request bodies (habit for Phase 2).

## Phase 1: Definition of Done
- [ ] Two accounts can sign up and log in; passwords are bcrypt hashes in the DB (verify by looking at the table).
- [ ] Owner creates a project and invites the second user by email; the second user sees it on their dashboard.
- [ ] Both users can create environments and add, edit, delete, and copy variables.
- [ ] A non-member cannot read or modify anything in that project (tested via URL/ID tampering).
- [ ] Duplicate key, invalid email, unknown invitee, and stale-edit errors all show clear messages.
- [ ] UI uses only the shared components; looks uniform on every page.
- [ ] README has setup instructions and the assumptions listed above.

## Phase 1 → Phase 2 handoff notes
Before starting Phase 2, record here:
- Final file layout / route names: _(fill in)_
- Any deviations from the schema above: _(fill in)_
- Known issues carried over: _(fill in)_

---

# PHASE 2: Security and History _(outline; expand when Phase 1 is done)_

**Goal:** The secure core. Sensitive values are encrypted, masked, revealed only when authorized, and every change is logged without leaking secrets.

**Covers brief sections:** 2C (Plain vs Sensitive), 2E (history), the security requirements in section 3.

### Scope
1. **Encryption helper:** AES-256-GCM with a random IV per value; key from an environment variable (`ENCRYPTION_KEY`, 32 bytes), never stored in the DB or the repo.
2. **Sensitive toggle:** create/edit with a type; switching type encrypts or decrypts the stored value.
3. **Masking:** list endpoints return `••••••••` for sensitive values and never send plaintext.
4. **Reveal and Copy:** a separate authorized endpoint; consider password re-entry and logging each reveal.
5. **History:** a `HistoryEntry` table written **in the same transaction** as every add, edit, delete, and type change. Stores key name (not a foreign key), old/new values (encrypted when sensitive), who, when, and a `batchId`.
6. **Timeline UI:** per-environment history with masked sensitive values and a per-row reveal.

### Decisions you'll need to make
- What happens to **old history entries** when a variable switches from Standard to Sensitive? (Recommended: re-encrypt them.)
- Which reveal rules apply: any member, or owner only? Is every reveal audited?
- One history row per key, or one snapshot per save? (`batchId` supports both.)

### Traps to watch
- History storing plaintext secrets.
- Plaintext returned by any API route just because the UI hides it.
- Secrets in server logs or error messages.
- Reusing an IV (always generate a new one for each encryption).

### Definition of Done (draft)
- [ ] DB inspection shows ciphertext for sensitive values in **both** `Variable` and `HistoryEntry`.
- [ ] Network tab never shows plaintext for masked values.
- [ ] Toggling type works in both directions and is logged.
- [ ] History survives variable deletion.

_Detailed step-by-step: to be generated after Phase 1._

---

# PHASE 3: Smart Import and Polish _(outline; expand when Phase 2 is done)_

**Goal:** The .env paste import with visual review, plus final polish for the demo.

**Covers brief sections:** 2D (Smart Copy-Paste Import), the usability and consistency requirements.

### Scope
1. **Parser** (`lib/parseEnv.ts`, a pure function with unit tests): skips blank lines and `#` lines; handles `export KEY=value`, quoted values, inline comments, `=` inside values, CRLF/BOM, empty values, multiline quoted values, and duplicate keys.
2. **Diff:** compare parsed pairs with the environment's existing variables → 🟢 New / 🟡 Update (old vs new) / ⚪ Unchanged. Sensitive values are decrypted server-side only for the comparison.
3. **Preview UI:** text labels as well as colors; masked values for sensitive keys with per-row reveal; summary counts.
4. **Apply:** a single transaction that writes the variables and one history batch. Missing keys are not deleted.
5. **Type handling:** new keys default to Standard, with optional auto-flagging of names containing SECRET, KEY, TOKEN, PASSWORD; existing keys keep their current type.
6. **Polish:** README, seed data, error-message review, loading/empty states, and demo script.

### Optional extras (pick based on time)
- Per-row checkboxes to skip lines in the preview.
- `.env` export for authorized users.
- Restore a previous version from history, and a diff view between versions.
- Clone one environment into another.

### Definition of Done (draft)
- [ ] Parser unit tests pass for all edge cases listed.
- [ ] A messy pasted .env shows the correct New/Update/Unchanged breakdown before saving.
- [ ] Applying the import creates the right variables and exactly one history batch.
- [ ] A full demo run works end to end from a fresh seed.

_Detailed step-by-step: to be generated after Phase 2._

---

## Template: asking Claude to expand the next phase

Copy this into a chat with the plan attached:

> Phase [N] is done. Notes from the handoff section: [paste]. Please expand **Phase [N+1]** into the same level of detail as Phase 1 (numbered steps with checkboxes, endpoints, UI work, a definition of done, and handoff notes), and flag any traps I should watch for.
