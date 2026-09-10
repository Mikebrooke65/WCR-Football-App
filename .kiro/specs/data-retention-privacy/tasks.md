# Data Retention & Privacy Assurance (V1.R Part 2) — Tasks

**Reads with:** `requirements.md`, `design.md` (including the "Review pass
(2026-09-10)" section — its three fixes are already folded into the tasks
below, not left as follow-ups). Build **Piece A before Piece B before Piece
C**: B's `retentionScan()` calls A's `scrubUser()` internally; C only reads
what A/B produce. Verify each slice: `npm run build` + scoped `tsc` per
CLAUDE.md's approach (a throwaway `tsconfig.tmpcheck.json` limited to changed
`.tsx`/`.ts` files); `npx vitest --run` (baseline **254 passed, 2 skipped**
as of 2026-09-04 — confirm current baseline against a fresh clone before
trusting that number, per CLAUDE.md). Commit in sensible batches (Netlify
rebuilds on push — batch to limit them, and check Netlify's Usage & billing
page if a push doesn't seem to go live).

**Deploy reminders:** migrations run manually in the Supabase SQL Editor
(never `supabase db push`); the `retention-scan` Edge Function deploys
manually via `supabase functions deploy retention-scan` (not on git push) —
verify its TypeScript first with `deno check --allow-import index.ts` against
an isolated copy of the function folder, per CLAUDE.md.

**Migration number:** design.md was written against `081` as the next free
number (latest on `prototype` was `080`). **Re-confirm this against the
actual current HEAD before writing the file** — `ls supabase/migrations`
sorted, same check used here — since Kiro's separate clone can push in
between sessions.

---

## Piece A — Scrub-in-place mechanism

- [x] A1. **DONE 2026-09-10, live.** **Migration `081_data_retention_scrub_mechanism.sql`** — everything
  Piece A and B need in one file (per design.md, A.1/B.1 are "same
  migration"):
  - `ALTER TABLE public.users ADD COLUMN retired_at timestamptz, ADD COLUMN
    role_ended_at timestamptz` + the two `COMMENT ON COLUMN` statements
    (design A.1 — copy verbatim, they document the distinction from
    `active` and the recompute-monthly semantics).
  - `ALTER TABLE public.player_caregivers ADD COLUMN inactive_at
    timestamptz` (design A.2's caregiver-link-clearing detail — **option
    1**, add the column, don't hard-delete the link row).
  - `CREATE OR REPLACE FUNCTION public.user_holds_active_role(p_user_id
    uuid) RETURNS boolean ... SECURITY DEFINER` exactly per design A.3 (the
    `team_members` OR `player_caregivers ... JOIN team_members` check —
    this is what fixes requirements.md B2's "caregiver never has a
    `team_members` row" gap; don't reduce it to a bare `team_members`
    count).
  - `CREATE INDEX IF NOT EXISTS admin_action_items_kind_status_idx ON
    public.admin_action_items(kind, status)` (design B.1).
  - Confirm the migration number against current HEAD first (see header).
- [x] A2. **DONE 2026-09-10.** **Types** (`src/types/database.ts`): add `retired_at: string |
  null` and `role_ended_at: string | null` to the `users`/`User` type; add
  `inactive_at: string | null` to whatever type models `player_caregivers`
  rows (add one if none currently exists — check first).
- [x] A3. **DONE 2026-09-10, deployed.** **`scrubUser()`** — an internal, non-exported-from-router, plain
  function living inside `supabase/functions/retention-scan/index.ts`
  (design A.2, **as revised by the review pass**: this is deliberately
  *not* a second `Deno.serve` endpoint and *not* a separately deployed
  function — there is no legitimate caller other than `retentionScan()` in
  the same file, and that's what closes the security gap the review pass
  found). Implements, in order:
  1. Look up the user; return `{skipped: 'admin'}` if `role === 'admin'`
     (A7) or `{skipped: 'already-retired'}` if `retired_at` is already set
     (A4 — idempotent).
  2. Clear this person's caregiver links **first** (A5), while `player_id`
     still resolves: `UPDATE player_caregivers SET inactive_at = now()
     WHERE player_id = userId AND inactive_at IS NULL` (the `IS NULL`
     guard is what makes re-running this safe per A4 — a second pass is a
     no-op, doesn't need to be conditioned on the outer idempotency check
     alone).
  3. Scrub the `public.users` row: `first_name = 'Former', last_name =
     'Member'`, `email = `retired-${userId}@deleted.invalid`` (A3 —
     collision-proof by construction, satisfies the UNIQUE NOT NULL
     constraint), `cellphone = NULL`, `date_of_birth = NULL`, `active =
     false` (review-pass finding 3 — matches migration 058's convention),
     `retired_at = now()`.
  4. Auth-side, service-role only:
     `supabaseAdmin.auth.admin.updateUserById(userId, { email:
     placeholder_email, phone: null, user_metadata: {} })`. **Never call
     `auth.admin.deleteUser()`** — design.md's "Key finding" section
     explains why (it cascades into deleting the `public.users` row via
     `auth.users → public.users ON DELETE CASCADE`, which is the exact FK
     breakage Piece A exists to avoid). Add a one-line code comment saying
     the same, so a future edit doesn't reintroduce it.
  5. Return `{scrubbed: true}`.
- [x] A4. **DONE 2026-09-10.** Note in a code comment above `scrubUser()`, and in the migration
  file's header comment, that A6 (the child-must-have-a-caregiver
  invariant) is satisfied by construction here — scrubbing a child marks
  *their own* row inactive, it never removes a caregiver from an
  *active* child, so V1.R Part 1's invariant is never in tension with this
  mechanism. No code change needed for A6 beyond that note.

## Piece B — Scheduled retention job + review queue

- [x] B1. **DONE 2026-09-10, deployed.** **`retentionScan()`** — the exported `Deno.serve` handler in the
  same `supabase/functions/retention-scan/index.ts` file, implementing all
  four steps from design B.2 pseudocode **exactly**, including both
  review-pass fixes already folded in below (don't re-derive from
  requirements.md's B2/B3, which predate the fixes):
  1. **Resolve due candidates**: every `admin_action_items` row with
     `kind='retention_candidate'`, `status='pending'`, and
     `(detail->>'scheduled_scrub_at')::timestamptz <= now()`. For each: if
     `user_holds_active_role(row.player_id)` is now true (they rejoined
     during the grace window), mark it `actioned` with
     `outcome: 'no_longer_eligible'` and move on — no separate
     cancellation path needed (B7). Otherwise call `scrubUser(row.player_id)`
     and mark the row `actioned`, `actioned_at = now()`, `actioned_by =
     NULL` (NULL specifically distinguishes a system auto-scrub from an
     admin's own exemption, which sets `actioned_by` — B8/B4).
  2. **Recompute `role_ended_at`** for every non-admin, non-retired user:
     set it to `now()` where it's currently NULL and
     `NOT user_holds_active_role(id)`; clear it back to NULL where it's
     currently set and the user now holds a role again — **guard both
     directions on `retired_at IS NULL`** (review-pass finding 3; the
     second `UPDATE`'s guard is the one requirements.md's draft was
     missing).
  3. **Open new standard candidates**: `role_ended_at <= now() - interval
     '12 months'`, not already admin, not already retired, excluding
     anyone with an existing **`pending`** (not `pending` *or*
     `actioned`) candidate row — this is what makes an admin's exemption a
     one-cycle snooze rather than permanent (B4). Insert with
     `detail = {clock: 'standard', role_ended_at, scheduled_scrub_at: now()
     + interval '30 days'}`.
  4. **Open new orphaned-child candidates**: `caregiver_approvals` rows
     with `request_kind='add_child'`, `status='denied'`, `responded_by IS
     NULL` (distinguishes migration 058's auto-deny from a human's
     explicit decline), `responded_at <= now() - interval '90 days'`
     (design's confirmed Option A clock — measured from the auto-deny, not
     the original invite), **excluding only an existing `pending` row**
     (review-pass finding 2 — the bug being fixed here: requirements.md's
     draft excluded `pending`/`actioned` both, which would have made an
     exemption of an orphaned child accidentally permanent, unlike every
     other population). Also re-check `NOT user_holds_active_role(player_id)`
     in case they joined a different team since. Insert with
     `detail = {clock: 'orphaned_child', ...}`.
  Wrap the whole handler so a partial/timeout failure is safe to re-run
  (B7) — every step above is already naturally idempotent by its own
  `WHERE` clauses; don't add extra state to track "did this run
  fully" on top of that.
- [x] B2. **DONE 2026-09-10.** Document the `admin_action_items.detail` jsonb shape (design
  B.1) in a code comment next to where rows are inserted: `{clock:
  "standard" | "orphaned_child", role_ended_at, scheduled_scrub_at,
  outcome?: "exempted" | "auto_scrubbed" | "no_longer_eligible"}`.
- [x] B3. **DONE 2026-09-10, live — cron job registered (verified via `SELECT * FROM cron.job`).** **Scheduling** — add to the same `081` migration file (or a
  follow-on `081b` if that reads more cleanly once A1 is drafted; match
  whichever convention the file ends up needing): `CREATE EXTENSION IF NOT
  EXISTS pg_cron` (`pg_net` should already exist from migration 078), a
  `trigger_retention_scan()` `SECURITY DEFINER` function that reads the
  Vault `service_role_key` secret and `net.http_post`s
  `/functions/v1/retention-scan`, `REVOKE EXECUTE ... FROM PUBLIC` on it,
  the idempotent unschedule-then-schedule guard, and `cron.schedule(
  'retention-scan', '0 4 1 * *', ...)` — **monthly**, not hourly; this is
  migration 078's exact pattern (`trigger_send_rsvp_reminders`), copied and
  renamed, with the RSVP-specific reasoning in its comments swapped for
  this job's. No new manual Vault step needed if migration 042/078 has
  already been applied (confirm, don't assume).
- [x] B4. **DONE 2026-09-10 — `deno check --allow-import index.ts` clean**, run twice (once pre-delivery in a sandbox, once against the real fresh-clone patch before sending). **Verify the function's TypeScript**: copy
  `supabase/functions/retention-scan/` to an isolated directory outside
  `node_modules` and run `deno check --allow-import index.ts`, per
  CLAUDE.md's Edge Function verification step.

## Piece C — Desktop "Data Retention & Privacy Assurance" report

- [x] C1. **DONE 2026-09-10, live.** **Route + nav, independent of `desktopFeatures.reporting`**: add
  `{ path: 'data-retention', element: <DataRetentionReport /> }` to
  `routes/index.tsx`'s `/desktop` children array as a **plain, unconditional
  entry** — do not put it inside the `...(desktopFeatures.reporting ? [...]
  : [])` spread around line 235, and do not gate it behind any new flag
  either (design C.1 leans always-on). Add a matching plain entry to
  `DesktopLayout.tsx`'s `NAV_ITEMS` array (no `desktopFeatures` conditional,
  unlike the Reporting entry it sits near). Reuses the existing `/desktop`
  route's `ProtectedRoute allowedRoles={[UserRole.ADMIN]} requireDesktop`
  guard — no new guard code (C2).
- [x] C2. **DONE 2026-09-10.** **`src/lib/retention-api.ts`** (`exemptCandidate`/`unexemptCandidate` take the full row rather than `id`/`adminId` alone, so the existing `detail` fields survive the jsonb merge, done client-side) — new client module, following
  `caregivers-api.ts`'s existing `admin_action_items` query conventions
  (see `getPendingAdminActionItems`/`dismissAdminActionItem` for the
  pattern to match — same error handling via `ApiError`, same `supabase`
  client import):
  - `listRetentionCandidates()`: `admin_action_items` where
    `kind='retention_candidate' AND status='pending'`, ordered by
    `scheduled_scrub_at` ascending, joined/looked-up against `users` for
    display name (mirror `AdminActionItems.tsx`'s existing pattern of a
    separate `users` lookup by id rather than a Supabase join, since that's
    what the reference page already does).
  - `exemptCandidate(id, adminId)`: `UPDATE admin_action_items SET
    status='actioned', actioned_by=adminId, actioned_at=now(), detail =
    detail || '{"outcome":"exempted"}' WHERE id = id` (design C.2/B.4).
  - `listRecentlyActioned(limit = 20)`: `admin_action_items` where
    `kind='retention_candidate' AND status='actioned'`, ordered by
    `actioned_at` descending, limited.
- [x] C3. **DONE 2026-09-10.** **`src/pages/desktop/DataRetentionReport.tsx`** — new page,
  following `AdminActionItems.tsx`'s existing shape (loading/error state
  handling, a name-resolution pass against `users` after the initial
  fetch, empty-state copy, Tailwind classes matching the rest of
  `/desktop`) rather than inventing a new page structure:
  1. **Pending review** (C3/C4): table listing name, role(s) held +
     `role_ended_at`, `scheduled_scrub_at`, which clock (`detail->>'clock'`
     — display "Standard (no role)" vs "Orphaned pending child"), and an
     "Exempt" button per row calling `exemptCandidate`. Empty state:
     "Nothing scheduled this cycle."
  2. **Recent history** (C6): shorter list below, e.g. "Sarah Jones —
     auto-scrubbed 3 Sep 2026" / "Tom Reid — exempted by [admin] 1 Sep
     2026", reading `listRecentlyActioned` and branching display on
     `detail->>'outcome'` (`auto_scrubbed` / `exempted` /
     `no_longer_eligible` each get distinct copy/badge colour).
- [x] C4. **DONE 2026-09-10** — built as described, with one refinement: Undo is offered on any row this page session itself exempted (tracked client-side), not scoped to "the most recent" one, so exempting several candidates in a row doesn't lose the Undo option on the earlier ones. **Un-exempt / undo** (C5): within the same page session, let an
  admin reverse an exemption they just made — simplest UX matching C5's
  "exact UX is a design call": an inline "Undo" affordance that appears
  next to a just-exempted row for the rest of that session (client-side
  state, no new server call needed beyond re-flipping `status` back to
  `pending` and clearing `actioned_by`/`actioned_at`/the `outcome` key if
  they click it) rather than a separate re-toggle control that looks the
  same as the original "Exempt" button.
- [x] C5. **DONE 2026-09-10.** Confirm no manual "run cleanup now" trigger exists anywhere on
  this page (C's explicit out-of-scope item) — the only thing that invokes
  a scrub is B3's monthly cron.

## Verification checkpoint

- [x] **DONE.** Full `npm run build` + `npx vitest --run` clean against the
  sandbox for every patch — confirmed on a genuinely fresh clone of the real
  current HEAD each time (not just the sandbox), per CLAUDE.md's
  verification protocol. Baseline held at **300 passed | 2 skipped**
  throughout (this project's baseline had already moved to 300|2 by V1.7's
  own checkpoint, ahead of the 254|2 figure this file's header cited from
  2026-09-04 — confirmed current, not assumed, before relying on it).
- [x] **DONE.** `deno check --allow-import index.ts` clean for
  `retention-scan` (B4) — confirmed twice, including against the real
  fresh-clone copy of the patch before delivery.
- [x] **DONE 2026-09-10, live**, after migration 081 was run. All three
  cases matched expectation against real production data:
  `user_holds_active_role()` on a `team_members` row holder → `true`; on a
  pure caregiver of a still-rostered child with **no** `team_members` row of
  their own → `true` (the exact gap A3 exists to fix); on a genuinely
  roleless non-admin user → `false`.
- [x] **DONE 2026-09-10** — see `CHANGELOG.md`'s 2026-09-10 entry and
  `NEXT-SESSION-NOTES.md`'s "Current State — 10 September 2026" section
  (plus its status-table row and workstream note further down that file).
- [x] **DONE** — `design.md` and this `tasks.md` were both committed and
  pushed to git before any code patch (delivered and applied first, per the
  repo owner's explicit request to review the task breakdown before code).

**Not yet done, flagged rather than silently assumed** (see
`NEXT-SESSION-NOTES.md`'s "Current State" section for the full note): no
real candidate has been through an actual full monthly cycle yet — the
cron's first real tick is naturally in the future (next 1st-of-month, 04:00
UTC) — and the Desktop report page hasn't had a live admin click-through.
Neither blocks calling the *build* done; both are worth a look once there's
real data to look at.

## Deferred / out of scope (unchanged from requirements.md)

- The annual de-identified performance/feedback aggregate job (V2).
- Any automated notice to the affected person (admin-review-only, per
  decision #7).
- A manual "run cleanup now" admin trigger (B3's cron is the only trigger).
- Confirming the project's actual Supabase plan/PITR setting, and who
  monitors `privacy@clubfootball.app` — both operational items for Mike,
  not build items.
