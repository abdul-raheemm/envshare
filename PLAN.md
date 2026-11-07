# EnvShare: Phased Project Plan

> **How to use this file:** Phase 1 is fully detailed. Phases 2 and 3 are outlined, with the decisions and traps you'll need. When a phase is finished, tick its checklist, update the **Status Tracker**, and ask Claude to expand the next phase using the template at the bottom. Keep this file in your repo as `PLAN.md`.

---

## Status Tracker

| Phase | Scope | Status |
|---|---|---|
| 1. Foundation | Auth, projects, membership, environments, plain variable CRUD | ✅ Done |
| 2. Security and History | Sensitive variables, encryption, masking/reveal, change history | 🔲 Not started |
| 3. Smart Import and Polish | .env parser, New/Update/Unchanged preview, bulk import, polish | 🔲 Not started |

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
6. Not in this version: password reset and email verification. (Login rate limiting is covered in assumption 33.)

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
26. Stack: Next.js 16 (App Router), Prisma 7.10.1 (pinned exactly), PostgreSQL 16 in Docker for development, Tailwind CSS 4 as the only styling system, zod for validation.
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
  updatedVariables Variable[]
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
  @@index([userId]) 
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
  updatedBy User @relation(fields: [updatedById], references: [id])
}
generator client { provider = "prisma-client", output = "../src/generated/prisma" }
datasource db { provider = "postgresql" }

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
- [x] Create the Next.js app (TypeScript, Tailwind, App Router) and init git.
- [x] Install: `prisma @prisma/client bcryptjs jose zod` (plus `vitest` for later).installed in the steps that use them; vitest is deferred to Phase 3
- [x] Create `.env` and `.env.example` with `DATABASE_URL` and `JWT_SECRET`. Add `.env` to `.gitignore` (an env manager project that leaks its own `.env` looks bad).
- [x] Set up a local Postgres database (Docker or a hosted free tier).

## Step 1.2: Database schema
- [x] Paste the schema above into `prisma/schema.prisma`, run `prisma migrate dev`. note: Prisma 7 also needs the generator and datasource blocks and a prisma.config.ts; see the real prisma/schema.prisma
- [x] Create a `lib/db.ts` that exports a single Prisma client instance.
- [x] Write a small seed script (2 users, 1 project, 3 environments) for demos.

## Step 1.3: UI foundation (do this early so everything stays uniform)
- [x] Define Tailwind theme colors in globals.css using @theme (Tailwind 4).
- [x] Build reusable components: `Button` (primary/secondary/danger), `Input` (with label and error text), `Card`, `Modal`, `Alert`, `PageHeader`, `Textarea` and `Badge`.
- [x] Build one shared layout with a navbar (app name, user name, logout),built in 1.4 together with the login check
- [x] Rule: **no page may use ad-hoc button or input styles.** Use only these components.

## Step 1.4: Authentication
- [x] `POST /api/auth/signup`: validate email format and password length (8+), reject duplicates ("An account with this email already exists"), hash with bcrypt, store.
- [x] `POST /api/auth/login`: verify the hash, set the JWT cookie. Use the **same generic error** for wrong email and wrong password ("Invalid email or password").
- [x] `POST /api/auth/logout`: clear the cookie.
- [x] Helper `getCurrentUser(request)` that returns the user or null.
- [x] Middleware or helper that redirects unauthenticated users to `/login`.
- [x] Pages: `/signup`, `/login`.

## Step 1.5: Projects and membership
- [x] Helper `requireProjectAccess(userId, projectId)`: looks up `ProjectMember`; throws 403/404 if none. **Every project, environment, and variable route must call this.**
- [x] `POST /api/projects`: create the project and, in the same transaction, insert the owner as a `ProjectMember`.
- [x] `GET /api/projects`: list projects the current user is a member of.
- [x] `POST /api/projects/:id/members`: owner only. Takes an email; errors: "No registered user with this email", "User is already a member".
- [x] `GET /api/projects/:id/members`: list members.
- [x] Pages: `/dashboard` (project list + create form), `/projects/[id]` (overview + members panel; invite form visible to owner only).(done as a server-side function, not an API route; see Deviations)

## Step 1.6: Environments
- [x] `POST /api/projects/:id/environments`: unique name per project ("This environment already exists").
- [x] `GET /api/projects/:id/environments`.
- [x] Optionally auto-create Development, Staging, Production when a project is created.
- [x] UI: environment tabs on the project page.

## Step 1.7: Variable CRUD (plain text)
- [x] `GET /api/environments/:id/variables`
- [x] `POST /api/environments/:id/variables`: validate key format (`^[A-Za-z_][A-Za-z0-9_]*$`), reject duplicate keys ("This key already exists"), set `updatedById`.
- [x] `PATCH /api/variables/:id`: edit key or value. Send the current `version`; if it doesn't match, return a conflict ("This variable was changed by someone else. Reload and try again") and increment the version on success.
- [x] `DELETE /api/variables/:id`: with a confirmation modal in the UI.
- [x] UI: table of key/value rows, "Add variable" form, inline edit, a clear **Copy** button on each value, delete button.

## Step 1.8: Authorization sweep (do not skip)
- [x] Walk through every route and confirm it checks membership. For variable routes, load the variable, then its environment, then its project, then check access.
- [x] Test manually: log in as User B and try to fetch User A's project, environment, and variable by ID. Every attempt must fail.
- [x] Return 404 (not 403) for resources the user can't access, so IDs aren't confirmed to exist.

## Step 1.9: Errors, validation, and usability pass
- [x] Use zod on every request body; return field-level messages.
- [x] Show server errors in an `Alert` or under the relevant input, never raw JSON.
- [x] Loading and empty states ("No projects yet. Create your first one").
- [x] Make sure nothing logs full request bodies (habit for Phase 2).

## Phase 1: Definition of Done
- [x] Two accounts can sign up and log in; passwords are bcrypt hashes in the DB (verify by looking at the table).
- [x] Owner creates a project and invites the second user by email; the second user sees it on their dashboard.
- [x] Both users can create environments and add, edit, delete, and copy variables.
- [x] A non-member cannot read or modify anything in that project (tested via URL/ID tampering).
- [x] Duplicate key, invalid email, unknown invitee, and stale-edit errors all show clear messages.
- [x] UI uses only the shared components; looks uniform on every page.
- [x] README has setup instructions and the assumptions listed above.

## Phase 1 → Phase 2 handoff notes
Before starting Phase 2, record here:

**Final file layout / route names**
- Pages: `/login`, `/signup`, `/dashboard`, `/projects/[projectId]?env=<environmentId>`
- API: `POST /api/auth/{signup,login,logout}`, `POST /api/projects`,
  `POST /api/projects/[projectId]/members`, `POST /api/projects/[projectId]/environments`,
  `POST /api/environments/[environmentId]/variables`, `PATCH|DELETE /api/variables/[variableId]`
- `src/lib`: `db.ts`, `password.ts`, `session.ts`, `validation.ts`, `errors.ts`, `access.ts`,
  `projects.ts`, `environments.ts`, `variables.ts`, `rateLimit.ts`
- `src/components`: `ui/` (Button, Input, Textarea, Card, Modal, Alert, Badge, PageHeader),
  `auth/`, `projects/`, `variables/`, `Navbar.tsx`, `NotFoundCard.tsx`
- Data is read in server components through `src/lib` functions; changes go through API routes.
- All variable writes go through `src/lib/variables.ts` (add history logging there in Phase 2).
- Generated Prisma client lives in `src/generated/prisma` (not committed; run `npx prisma generate`).
- missing special pages: prisma/seed.ts, prisma.config.ts, docker-compose.yml, and the error.tsx, not-found.tsx and (app)/loading.tsx pages

**Deviations from the schema in this plan**
- Added a `Variable.updatedBy` relation to `User` (and `User.updatedVariables`).
- Added an index on `ProjectMember.userId`.
- `HistoryEntry` is not created yet.

**Known issues / things Phase 2 must change**
- Values are plain text and a temporary banner says so (remove it in `VariablesPanel.tsx`).
- `listVariables` and `requireVariableAccess` return plaintext values: Phase 2 must mask server-side and stop selecting `value` where it is not needed.
- The Copy button copies from the page's data: Phase 2 needs an authorized reveal endpoint instead.
- Deleting a variable is permanent; history will keep a record in Phase 2.
- The seed script stores plain values: update it for encryption.
- `.env.example` needs `ENCRYPTION_KEY` (32 bytes) added; never commit the real key.
- Login rate limiting is in memory (single server, resets on restart).
- Production dependencies audit clean (Prisma upgraded to clear advisories in its tooling); remaining findings are in development-only tools.
- No removing members, renaming or deleting projects or environments (not required by the brief).

---

# PHASE 2: Security and History

**Goal:** The secure core. Sensitive values are encrypted, masked, revealed only to authorized members (with an audit trail), and every change is logged without leaking secrets.

**Covers brief sections:** 2C (Plain vs Sensitive), 2E (History and Version Tracking), and the security and usability requirements in section 3.

> ⚠️ **Variables created during Phase 1 are stored as plain text. Delete any real secrets you entered while testing (and rotate them if they were real).**

## Phase 2 Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Who can reveal a sensitive value? | Any project member. Every reveal is audited (who, which key, when, never the value). |
| 2 | Password re-entry before reveal? | No. Stretch goal only. |
| 3 | Where do reveal audits go? | A separate `RevealLog` table, so the timeline stays about changes, not views. |
| 4 | History granularity | One `HistoryEntry` row per key per change, grouped by `batchId`. |
| 5 | Key rename | One `UPDATE` row that also records `oldKey`. |
| 6 | Standard → Sensitive | Re-encrypt every earlier plain-text history value for that key, in the same transaction. |
| 7 | Sensitive → Standard | Old history stays encrypted (never decrypt history in bulk). |
| 8 | Type-change rows | A `TYPE_CHANGE` row stores no values, only the old and new type. |
| 9 | History is append-only | No API edits or deletes history. The only internal rewrite is the re-encryption in decision 6. |

## Assumptions to add to your README
5. Any project member can reveal sensitive values; every reveal is logged with user, key and time (never the value).
6. History has one row per key per change, grouped into batches. It survives variable deletion.
7. A rename is logged as an UPDATE with the old key recorded.
8. When a variable becomes Sensitive, its earlier plain-text history values are encrypted. Switching back to Standard does not decrypt history.
9. Losing `ENCRYPTION_KEY` makes all encrypted values unrecoverable. Key rotation is out of scope.

---

## Step 2.0: Prerequisites (do these before any code)
- [ x] Phase 1 Definition of Done is fully ticked, the working tree is clean and committed, and the Phase 1 handoff notes are filled in.
- [x ] Docker Postgres is running and `npm run dev` works.
- [ x] Delete or rotate any real secrets typed into the app during Phase 1 (they are plain text in the DB).
- [ x] Generate `ENCRYPTION_KEY` (64 hex chars = 32 bytes), separate from `JWT_SECRET`:
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [x ] Add `ENCRYPTION_KEY` to `.env` (real value) and `.env.example` (placeholder only). Confirm `.env` is still git-ignored.
- [ x] Install and configure Vitest (`npm i -D vitest`), add an `npm test` script, and make the `@/` path alias resolve in the Vitest config. Run one trivial test to confirm it works.
- [ x] List every Phase 1 route and data function that returns or accepts variable values (create, list, patch, delete, seed). These all get touched in 2.3 and 2.4. Write the list in the handoff notes.
- [ x] Add a new shared UI components list to plan: `Badge` (Standard / Sensitive / action labels), `Switch` or checkbox toggle, `Toast` (for "Copied"). Rule from Phase 1 still applies: no ad-hoc styles.

## Step 2.1: Encryption helper (`src/lib/crypto.ts`)
- [ x] `encrypt(plaintext)` returns `{ value, iv, authTag }` (all base64). Algorithm AES-256-GCM, 12-byte random IV generated fresh on every call, 16-byte auth tag.
- [x ] `decrypt({ value, iv, authTag })` returns the plaintext string.
- [x ] Load the key lazily from `ENCRYPTION_KEY`; validate it is exactly 32 bytes (64 hex chars). If missing or invalid, throw a clear but value-free error (e.g. "ENCRYPTION_KEY is missing or invalid").
- [ x] All crypto errors are generic ("Could not decrypt this value"). Never include plaintext, ciphertext, IV or key in any message.
- [ x] Vitest tests: round-trip works; same plaintext encrypted twice gives different ciphertext and IV; wrong key fails; a tampered ciphertext or auth tag fails; empty string and unicode round-trip; missing and short key are rejected.
- [ x] Mask constant (`MASK = "••••••••"`) exported from one shared place.

## Step 2.2: Schema migration
Add these models and enums (new tables only, no existing data touched), plus back-relations on `User` and `Environment`:

```prisma
enum HistoryAction { CREATE UPDATE DELETE TYPE_CHANGE }
enum RevealSource  { VARIABLE HISTORY }

model HistoryEntry {
  id             String        @id @default(cuid())
  environmentId  String
  batchId        String
  action         HistoryAction
  key            String        // string, NOT a foreign key (survives deletion)
  oldKey         String?       // only set on renames
  oldValue       String?       // set only when the value changed / was deleted
  oldIv          String?       // non-null means oldValue is encrypted
  oldAuthTag     String?
  newValue       String?       // set only when the value changed / was created
  newIv          String?       // non-null means newValue is encrypted
  newAuthTag     String?
  oldIsSensitive Boolean?      // type snapshots, for display
  newIsSensitive Boolean?
  changedById    String
  changedAt      DateTime      @default(now())
  environment    Environment   @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  changedBy      User          @relation(fields: [changedById], references: [id])
  @@index([environmentId, changedAt])
  @@index([environmentId, key])
  @@index([batchId])
}

model RevealLog {
  id            String       @id @default(cuid())
  environmentId String
  key           String       // string, not a foreign key
  source        RevealSource
  userId        String
  revealedAt    DateTime     @default(now())
  environment   Environment  @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  user          User         @relation(fields: [userId], references: [id])
  @@index([environmentId, revealedAt])
}
```

- [ x] Run `npx prisma migrate dev --name add_history_and_reveal_log`, then `npx prisma generate`.
- [ x] Rule: a history value is **encrypted if and only if its `iv` is non-null**. This is the single source of truth for masking.
- [ x] Note the deviation from the old draft (`wasSensitive` became `oldIsSensitive` / `newIsSensitive`, plus `oldKey`, and a separate `RevealLog`) in the handoff notes.

## Step 2.3: Service layer with transactional history (plain variables first)
Build history before encryption, so it is never retrofitted around secrets.
- [ x] Move variable writes into service functions (in `src/lib`): `createVariable`, `updateVariable`, `deleteVariable`. Routes become thin wrappers. Each service function calls `requireProjectAccess` (loading variable → environment → project) as in Phase 1.
- [ x] Internal `applyChange(tx, ...)` does the variable write plus the history write(s) inside one `prisma.$transaction`. It accepts an optional `batchId` (default: a new id). **Phase 3 import will reuse this with one shared `batchId`.**
- [x ] CREATE row: `newValue` set. DELETE row: `oldValue` set. UPDATE row: `oldValue` and `newValue` set only if the value changed; a rename-only UPDATE stores `oldKey` and no values.
- [ x] If the transaction fails, neither the variable change nor the history row is saved. Test this by forcing a failure.
- [ x] Keep optimistic locking (`version`) working exactly as in Phase 1.
- [ x] Verify: add, edit, rename, delete each produce the right history rows (check in Prisma Studio), and deleting a variable keeps its history.

## Step 2.4: Sensitive variables, masking and type toggle
**Write path**
- [x ] zod: add `isSensitive` (boolean, default false) to create and patch bodies. For sensitive rows, `value` is optional on patch (**omitted = unchanged**).
- [ x] Create sensitive: encrypt value, store ciphertext in `value` plus `iv` and `authTag`; `isSensitive = true`.
- [x ] Edit sensitive value: encrypt the new value with a fresh IV. To decide whether the value actually changed, decrypt the old one server-side and compare.
- [ x] **Reject a patch whose value equals the mask string** for a sensitive row (prevents saving "••••••••" over a real secret).
- [ x] History rows copy the ciphertext, IV and auth tag from the variable columns (no re-encryption, no IV reuse issues). Standard values go into history as plain text with `iv = null`.

**Type toggle (both directions, logged as `TYPE_CHANGE`)**
- [ x] Standard → Sensitive: encrypt the stored value, set `isSensitive`, bump `version`. Write a `TYPE_CHANGE` row with no values.
- [x ] Sensitive → Standard: decrypt, store plain, clear `iv` and `authTag`, bump `version`. Write a `TYPE_CHANGE` row with no values.
- [ x] If type and value change in the same request, write an `UPDATE` row and a `TYPE_CHANGE` row in the same batch.
- [ x] **History re-encryption (decision 6):** after a variable becomes Sensitive (also on creating a sensitive variable), find all history rows in that environment whose `key` matches the current key **or any earlier key in its rename chain** (walk the `oldKey` links), and encrypt any `oldValue` / `newValue` that is still plain (`iv = null`). Do it inside the same transaction.
- [ x] Vitest or manual test: create Standard → edit twice → rename → delete? (no) → toggle Sensitive → query `HistoryEntry`: no plaintext remains for that key.

**Masking (every exit path)**
- [ x] One serializer `toVariableDTO(variable)` is the **only** way a variable leaves the server. Returns `{ id, environmentId, key, isSensitive, value, masked, version, updatedAt, updatedBy }` where sensitive rows get `value = MASK` and `masked = true`. Never return ciphertext, `iv` or `authTag`.
- [ x] Apply it to list, create, patch and any other route that returns variables. The list endpoint never decrypts anything.
- [ x] Test: response JSON for a sensitive variable contains neither the plaintext nor the ciphertext.

**UI**
- [ x] "Sensitive" switch on the add form and the edit form. Type badge on each row.
- [ x] Sensitive rows show `••••••••`. Editing a sensitive row shows an empty value field ("Leave blank to keep the current value").
- [x ] Switching Sensitive → Standard opens a confirmation `Modal`: "This value will be stored unencrypted."

## Step 2.5: Reveal and Copy
- [x ] `POST /api/variables/:id/reveal` (POST, not GET). Checks project access (404 if none), requires the variable to be sensitive, decrypts, and returns `{ value }` with `Cache-Control: no-store`.
- [ x] **Fail closed:** write the `RevealLog` row (source `VARIABLE`) before returning the value. If logging fails, return an error and no value.
- [ x] Decryption failure returns a generic error ("Could not decrypt this value") and logs only the error type.
- [ x] UI: an eye/Reveal button on sensitive rows. The revealed value is held in component state only (not in URLs, not in localStorage), and **auto-hides after about 15 seconds**.
- [ x] UI: the Copy button on a sensitive row calls reveal, copies to the clipboard without displaying it, and shows a "Copied" toast. Standard rows copy directly as before.
- [ x] Optional: simple per-user rate limit on reveal (in memory, like the login limit).

## Step 2.6: History read API and timeline UI
- [ x] `GET /api/environments/:id/history?cursor=&limit=` (membership checked, 404 otherwise). Newest first, cursor pagination (default 50). Each item: `id, batchId, action, key, oldKey, oldIsSensitive, newIsSensitive, changedAt, changedBy { name }, old: { masked, value }, new: { masked, value }`. If a value is encrypted (`iv` non-null) return `masked: true` and `value = MASK`; otherwise the plain value. Never return `iv` / `authTag` / ciphertext.
- [x ] `POST /api/history/:id/reveal` with body `{ which: "old" | "new" }`. Load entry → environment → project → check access. Only works for encrypted values. Writes `RevealLog` (source `HISTORY`) before returning, `no-store`.
- [ x] No endpoint exists that edits or deletes history.
- [ x] UI: an obvious **History** button/tab per environment, leading to a timeline page.
- [ x] Timeline groups entries by `batchId`: header with user, date/time and change count. Each row shows an action `Badge` (text + color), the key (with "renamed from X" when `oldKey` is set), and old → new values. Encrypted values show the mask with a per-row, per-side reveal button (auto-hide like 2.5). `TYPE_CHANGE` rows show "Standard → Sensitive" and no values.
- [x ] Empty state ("No changes yet"), loading state, and a "Load more" button.

## Step 2.7: Security sweep (do not skip)
- [ x] **DB inspection:** in Prisma Studio or psql, `Variable` and `HistoryEntry` show ciphertext (base64) for sensitive values. Dump the DB and search it for a known test secret: zero matches.
- [x ] **Network tab:** create, list, patch, history list and reveal responses. A masked value never appears in plaintext, except in the reveal response itself. Check the reveal response has `Cache-Control: no-store`.
- [ x] **Logs:** search the dev server output for the test secret: zero matches. Confirm validation errors never echo submitted values.
- [ x] **Non-member attack:** as User B, call history list, history reveal and variable reveal on User A's IDs. All must return 404.
- [ x] **Tamper test:** change one character of a ciphertext (or auth tag) in the DB. Reveal returns the generic error, nothing leaks, and the list endpoint still works.
- [ x] **Wrong key test:** restart with a different `ENCRYPTION_KEY`. The app does not crash, lists still load, reveals fail gracefully. Restore the real key afterwards.
- [x ] **IV test:** encrypt the same value twice; ciphertext and IV differ.
- [ x] **Toggle test:** Standard → Sensitive → Standard; both are logged, and old history is still encrypted afterwards.
- [x ] **Re-encryption trap test:** a key edited several times and renamed while Standard has no plaintext history left once it becomes Sensitive.
- [x ] **Mask-overwrite test:** try to save the mask string over a sensitive value: rejected. Editing with the value field blank leaves the secret unchanged.
- [ x] **Stale edit:** two tabs editing the same variable still produce the conflict message.
- [ x] **Deletion test:** deleting a variable keeps its history rows.
- [x ] **Audit test:** every reveal (variable and history) creates a `RevealLog` row with the right user and key, and never the value.

## Step 2.8: Seed, README, handoff
- [ ] Update the seed script to create a few sensitive variables and some history (use the service functions or the crypto helper, never raw plain text in sensitive rows).
- [ ] README: add `ENCRYPTION_KEY` to the environment table with the generation command and the key-loss warning, add assumptions 5-9, update security notes (encryption, masking, reveal audit, append-only history), and add the new `npm test` script.
- [ ] Confirm `.env.example` has the placeholder and `.env` is untracked.
- [ ] Update the Status Tracker, tick this checklist, and fill in the handoff notes below.
- [ ] Commit.

---

## Traps to watch
| Trap | What to do |
|---|---|
| Plaintext returned by an API route because the UI hides it | One `toVariableDTO` for all exits; test the JSON |
| Old Copy button still sends the raw value | Sensitive Copy goes through reveal |
| Mask string saved as the value | Omit value to keep; reject the mask string |
| History storing plaintext secrets | Copy ciphertext into history; re-encrypt on Standard → Sensitive, including renamed keys |
| Reusing an IV | `encrypt()` always generates a new IV; never reuse one for a new value |
| Reveal via `GET` or cached response | `POST` + `no-store` |
| Reveal succeeds but audit fails | Log first; fail closed |
| Secrets in logs or error messages | Log error types only; never interpolate values |
| History and variable out of sync | One transaction for both |
| Losing `ENCRYPTION_KEY` | Separate from `JWT_SECRET`, never committed, documented |

## Phase 2: Definition of Done
- [ ] DB inspection shows ciphertext for sensitive values in **both** `Variable` and `HistoryEntry`.
- [ ] The network tab never shows plaintext for masked values (only the explicit reveal response).
- [ ] Type toggle works in both directions and is logged; old history is protected on Standard → Sensitive.
- [ ] Reveal and Copy work for sensitive values, auto-hide works, and every reveal is audited.
- [ ] History is written in the same transaction as every add, edit, rename, delete and type change, and survives variable deletion.
- [ ] Timeline shows who, what and when, grouped by batch, with masked sensitive values and a per-row reveal.
- [ ] Non-members cannot reach any new endpoint (404).
- [ ] Crypto unit tests pass; the security sweep checklist is fully ticked.
- [ ] README and seed are updated.

## Phase 2 → Phase 3 handoff notes
- **Final file layout / route names:**
  - `src/lib`: `crypto.ts` (encrypt/decrypt), `mask.ts` (MASK constant, client-safe), `variables.ts` (service functions plus `applyCreate` / `applyUpdate` / `applyDelete`), `variableDto.ts` (the only way a variable leaves the server), `history.ts` (`writeHistory`, `newBatchId`, `encryptPlainHistoryForKey`), `historyDto.ts`, `historyRead.ts` (`listHistory`, `revealHistoryValue`), `reveal.ts` (`revealVariable`), `access.ts` (adds `requireHistoryEntryAccess`).
  - API: `POST /api/variables/[variableId]/reveal`, `GET /api/environments/[environmentId]/history`, `POST /api/history/[entryId]/reveal`.
  - Pages and components: `/projects/[projectId]/history`, `components/history/HistoryTimeline` and `HistoryButton`, `components/ui/Switch`, new `Badge` variants.
  - Tests: `tests/security/*`, `scripts/setup-test-db.mjs`, `scripts/http-sweep.mjs`. Commands: `npm test`, `npm run test:security`, `npm run sweep:http`.
- **Deviations from the schema/plan:**
  - `HistoryEntry` has `oldIsSensitive` / `newIsSensitive` (instead of a single `wasSensitive`) and `oldKey` for renames. Added `RevealLog` and the `HistoryAction` / `RevealSource` enums.
  - A value is encrypted if and only if its `iv` is non-null (history and variables).
  - `MASK` lives in `lib/mask.ts`, not `crypto.ts`, so client components can import it.
  - No Toast component: "Copied!" shows on the button.
  - There is no `GET` variables API route; the list is loaded server-side by the project page through `listVariables`.
  - Added beyond the plan: an automated security suite and an HTTP sweep.
- **Known issues / limits carried over:**
  - A blank edit means "keep", so an existing Sensitive variable cannot be edited to an empty value.
  - Reveal has no rate limit; password re-entry before reveal was not built (stretch goals).
  - No key rotation.
  - The history page shows one environment at a time (use the project page to switch).
  - The HTTP sweep leaves a throwaway user and some history rows in the dev database (`npx prisma migrate reset` cleans it).
  - Login rate limiting is in memory.
- **Reusable for Phase 3:**
  - `applyCreate(tx, ctx, environmentId, key, value, isSensitive)`, `applyUpdate(tx, ctx, current, input)` and `applyDelete(tx, ctx, variableId)` take a transaction and `ctx = { userId, batchId }`. Pass one shared `batchId` for a whole import. `applyUpdate` expects `current` loaded with the same fields as `requireVariableAccess` (including `isSensitive`, `iv`, `authTag`).
  - `encrypt` / `decrypt`, `toVariableDTO`, and `writeHistory`.
  - **To build in Phase 3:** a server-side helper that loads an environment's variables decrypted, for diffing only, never returned to the client.
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
