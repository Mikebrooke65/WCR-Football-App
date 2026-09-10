# Data Retention & Privacy Assurance (V1.R Part 2) — Design

**Reads with:** `requirements.md` (this folder), `docs/data-retention-scoping.md`
("DECISIONS LOCKED"). Grounded against the current schema (2026-09-09):
`users` (migration `001`, `date_of_birth` added `052`), `team_members`
(`021`, `is_coach` added `064`), `player_caregivers` (`001`/`036`),
`caregiver_approvals` + its stale-consent auto-expiry (`036`, `045b`, `058`),
`admin_action_items` (`055`), `game_feedback` (`022`), `gant_player_summaries`
(`073`), migration `078`'s `pg_cron`+`pg_net` scheduling pattern,
`desktopFeatures.ts` / `DesktopLayout.tsx` / `routes/index.tsx` (V1.8).

Latest migration on `prototype` as of this design: `080`. Next free number:
**`081`**.

---

## Key finding that reshapes Piece A: `users` is not a freestanding table

`public.users.id` is `PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`
(migration `001`) — every app user is a 1:1 extension row on top of a real
Supabase Auth identity. This changes what "scrub in place" has to mean:

- Scrubbing only `public.users` (name/email/phone/DOB) leaves the person's
  **`auth.users` row, login email and password completely untouched** — they
  could still sign in normally to an account whose profile has just been
  wiped. That's not a real scrub.
- **The trap to avoid**: `auth.users → public.users` is `ON DELETE CASCADE`.
  If a build ever calls Supabase's `auth.admin.deleteUser()` on a retired
  person "to be thorough," it deletes the `auth.users` row, which **cascades
  into deleting the `public.users` row**, which immediately hits every FK
  violation Piece A exists to avoid (`messages.sender_id`,
  `game_feedback.created_by`/`player_id`, etc. — see `requirements.md`'s
  Piece A problem statement). **Never call `deleteUser` as part of this
  build.** This needs saying explicitly because it's the single easiest way
  to accidentally reintroduce the exact bug this spec was written to route
  around.
- The right auth-side action is **`auth.admin.updateUserById(id, { email:
  <placeholder>, phone: null, user_metadata: {} })`** — freeing up the
  person's real email/phone (see A.2) so it's available again the moment
  they want to use it, without deleting the identity. This can only be done
  with the **service-role key**, which is never available to a plain
  Postgres function — it has to happen in an **Edge Function**, not a SQL
  migration function. This is why Piece A below is an Edge Function
  (`scrub-user`), not just a SQL helper.
- **Decided 2026-09-10 (Mike): no login ban.** A scrubbed person can come
  straight back in and re-register as if they were new — someone who
  genuinely rejoins the day after being scrubbed is just bad timing, not
  someone to lock out. No `ban_duration` step. One implementation detail
  this implies: because the real email is freed for reuse (previous bullet),
  a rejoin naturally creates a **new** `auth.users`/`public.users` row under
  that email — there's no path back into the old scrubbed row's data, which
  matches "as though they're a new person" without needing an explicit ban.

---

## Piece A — Scrub-in-place mechanism

### A.1 Migration `081` — new columns on `users`

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS role_ended_at timestamptz;

COMMENT ON COLUMN public.users.retired_at IS
  'Set once this row''s PII has been scrubbed by the retention job (Piece A). NULL = never retired. Distinct from `active`, which has other, older meanings.';
COMMENT ON COLUMN public.users.role_ended_at IS
  'When this user was last observed holding zero active roles (see Piece B''s monthly recompute). NULL = currently holds a role. Cleared back to NULL the moment they hold one again. The retention job''s 12-month clock is measured from this timestamp, not from any single team_members row.';
```

No new table needed for the scrub state itself — two columns on `users` is
enough, matching this project's general preference for the smallest schema
change that works (see V1.R Part 1's `is_coach` precedent).

### A.2 `scrub-user` Edge Function (service role)

New `supabase/functions/scrub-user/index.ts`, invoked only server-side (by
Piece B's scheduled job — never exposed as a callable a client could hit).
Per requirement, idempotent (A4) and admin-excluded (A7):

```
scrubUser(userId):
  user = SELECT * FROM users WHERE id = userId
  if user.role == 'admin': return {skipped: 'admin'}          // A7
  if user.retired_at is not null: return {skipped: 'already-retired'}  // A4

  // A5 — clear this person's caregiver links FIRST, while their real
  // player_id still exists to filter on (order matters: do this before
  // the UPDATE below, not after).
  UPDATE player_caregivers SET ... -- see note below on "clearing" a link
    WHERE player_id = userId

  // A1-A3 — scrub the public.users row
  placeholder_email = `retired-${userId}@deleted.invalid`  -- keeps the
    UNIQUE NOT NULL constraint satisfied without colliding, ever, with a
    real signup or a different retired row
  UPDATE users SET
    first_name = 'Former', last_name = 'Member',
    email = placeholder_email, cellphone = NULL, date_of_birth = NULL,
    retired_at = now()
  WHERE id = userId

  // Auth-side (see "Key finding" above) — service role only, this is why
  // this step lives in an Edge Function and not a SQL trigger/function.
  // No ban_duration (decided 2026-09-10): a rejoin lands on a brand new
  // auth.users/public.users row anyway, since the real email/phone freed
  // up here are what a rejoin would sign up with.
  supabaseAdmin.auth.admin.updateUserById(userId, {
    email: placeholder_email, phone: null,
    user_metadata: {},
  })

  return {scrubbed: true}
```

**A5 detail — "clearing" a caregiver link.** `player_caregivers` has no
`active`/status column today (migration `001`/`036`: just `player_id`,
`caregiver_id`, `created_at`, unique pair) — there's nothing to "mark
inactive" on the row as it stands. Two options:

1. Add a `player_caregivers.inactive_at timestamptz` column (mirrors the
   `retired_at`/`role_ended_at` shape above) and set it rather than deleting
   the row — keeps the historical link visible for audit ("who used to be
   this child's caregiver").
2. Delete the row outright (the schema's own `ON DELETE CASCADE` already
   implies links are treated as disposable join rows elsewhere).

**Recommended: option 1** (add `inactive_at`), for the same reason
`role_ended_at` exists rather than just deleting: Piece B's caregiver
eligibility check (A.3/B.2 below) needs to distinguish "this caregiver has
no *currently active* linked child" from "this caregiver never had one,"
and an audit trail of who-cared-for-whom is cheap to keep and plausibly
useful later (e.g. a caregiver's own retention review, or a rejoin flow).
Add to migration `081`:

```sql
ALTER TABLE public.player_caregivers
  ADD COLUMN IF NOT EXISTS inactive_at timestamptz;
```

### A.3 Reusable "does this user hold a role" check

Both Piece A's caregiver-link step and Piece B's monthly eligibility scan
need the same answer to "is this person currently role-holding," so it's
worth one `SECURITY DEFINER` SQL function rather than duplicating the join
in two places:

```sql
CREATE OR REPLACE FUNCTION public.user_holds_active_role(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members WHERE user_id = p_user_id
  ) OR EXISTS (
    -- A caregiver "holds a role" for as long as at least one child they
    -- care for is themselves still on a team. This is the fix for a real
    -- gap in requirements.md's B2 (see "Corrections vs requirements.md"
    -- below) — a pure caregiver never has a team_members row at all, by
    -- design (V1.R Part 1), so team_members alone would make every
    -- caregiver instantly "eligible" the moment their child scan runs.
    SELECT 1 FROM public.player_caregivers pc
    JOIN public.team_members tm ON tm.user_id = pc.player_id
    WHERE pc.caregiver_id = p_user_id AND pc.inactive_at IS NULL
  );
$$;
```

### Out of scope for A (unchanged from requirements.md)
`game_feedback` / `gant_player_summaries` content is untouched — still
attributed to the now-scrubbed `player_id`, which is the point.

---

## Piece B — Scheduled retention job

### Corrections vs `requirements.md` found while designing

1. **B2's "zero active `team_members` rows" is incomplete for caregivers**
   (explained in A.3 above) — a pure caregiver structurally never has a
   `team_members` row, so that check alone would flag every caregiver whose
   child is *currently active* as instantly roleless. Fixed by
   `user_holds_active_role()`, which is the actual eligibility test used
   below, not a raw `team_members` count.
2. **B2's "orphaned pending children: 90 days" interacts with an existing,
   earlier-built mechanism** migration `058` (`expire_stale_child_consents`,
   already live, runs daily) already auto-denies a stale add-a-junior
   `caregiver_approvals` request after **30 days** and sets the child's
   `users.active = false` — this pre-dates this spec and Mike's 90-day
   decision was made without either of us having that migration in view.
   Two clocks are now in play for the same population, and they need
   reconciling rather than stacking silently:
   - **Decided 2026-09-10 (Mike): Option A.** Migration `058`'s auto-deny is
     the event that starts the clock, not the original invite — the new
     90-day rule in Piece B measures from `caregiver_approvals.responded_at`
     (set by migration `058` when it auto-denies), not from the request's
     original `created_at`. Net effect: **~120 days from the original
     unanswered invite to the child's information actually being scrubbed**
     (30 to auto-deny + this spec's own 90 to scrub). The `interval '90
     days'` in B.2's pseudocode below is correct as written — no change
     needed from this decision.

### B.1 Migration `081` (same migration as Piece A) — nothing new needed for `admin_action_items`

`admin_action_items` (migration `055`) is generic enough already — `kind`
and `detail jsonb` need no schema change, just a new `kind` value used by
convention (`'retention_candidate'`) and a documented `detail` shape:

```json
{
  "clock": "standard" | "orphaned_child",
  "role_ended_at": "2025-09-01T00:00:00Z",
  "scheduled_scrub_at": "2026-09-09T00:00:00Z",
  "outcome": "exempted" | "auto_scrubbed"   // set only once resolved
}
```

Add one index for the scan/report queries:

```sql
CREATE INDEX IF NOT EXISTS admin_action_items_kind_status_idx
  ON public.admin_action_items(kind, status);
```

### B.2 `retention-scan` Edge Function — one monthly run does both halves

Given the review-and-grace window (30 days, per decision #7) is itself
month-scale, one monthly tick can both close out last cycle's candidates
and open this cycle's — no separate "process expirations" job is needed:

```
retentionScan():
  # --- Step 1: resolve due candidates from previous cycles ---
  due = SELECT * FROM admin_action_items
        WHERE kind = 'retention_candidate' AND status = 'pending'
          AND (detail->>'scheduled_scrub_at')::timestamptz <= now()
  for row in due:
    # Defensive re-check (B7/idempotency, and covers "they rejoined during
    # the grace window" without needing separate cancellation logic):
    if user_holds_active_role(row.player_id): 
      UPDATE admin_action_items SET status='actioned',
        detail = detail || '{"outcome":"no_longer_eligible"}'
        WHERE id = row.id
      continue
    scrub-user(row.player_id)   -- Piece A
    UPDATE admin_action_items SET status='actioned', actioned_at=now(),
      actioned_by=NULL,   -- NULL = system-actioned, distinguishes from an
                           -- admin's own exemption (actioned_by = their id)
      detail = detail || '{"outcome":"auto_scrubbed"}'
      WHERE id = row.id

  # --- Step 2: recompute role_ended_at for every non-admin user ---
  # (No triggers on team_members/player_caregivers — recomputing fresh each
  # month is simpler and robust to every existing removal code path
  # (the Remove Edge Function, cascades, this spec's own caregiver-link
  # clearing) without needing every one of them updated to also maintain a
  # timestamp. A month's imprecision on when the clock "really" started is
  # immaterial given the whole mechanism already ticks monthly.)
  UPDATE users SET role_ended_at = now()
    WHERE role != 'admin' AND retired_at IS NULL AND role_ended_at IS NULL
      AND NOT user_holds_active_role(id)
  UPDATE users SET role_ended_at = NULL
    WHERE role_ended_at IS NOT NULL AND user_holds_active_role(id)

  # --- Step 3: open new candidates — standard 12-month population ---
  newly_eligible = SELECT id, role_ended_at FROM users
    WHERE role != 'admin' AND retired_at IS NULL
      AND role_ended_at <= now() - interval '12 months'
      AND NOT EXISTS (
        SELECT 1 FROM admin_action_items
        WHERE kind='retention_candidate' AND player_id=users.id AND status='pending'
      )
  for user in newly_eligible:
    INSERT INTO admin_action_items (kind, player_id, detail, status)
    VALUES ('retention_candidate', user.id, jsonb_build_object(
      'clock', 'standard',
      'role_ended_at', user.role_ended_at,
      'scheduled_scrub_at', now() + interval '30 days'
    ), 'pending')

  # --- Step 4: open new candidates — orphaned pending children ---
  # See "Corrections" above re: the 90-vs-60-day reconciliation.
  orphaned = SELECT player_id, responded_at FROM caregiver_approvals
    WHERE request_kind='add_child' AND status='denied' AND responded_by IS NULL
      AND responded_at <= now() - interval '90 days'   -- confirm vs 60, see above
      AND NOT EXISTS (matching pending/actioned admin_action_items already)
      AND NOT user_holds_active_role(player_id)   -- in case they were added
                                                    -- to a different team since
  for row in orphaned:
    INSERT INTO admin_action_items (...) VALUES ('retention_candidate',
      row.player_id, jsonb_build_object('clock','orphaned_child', ...), 'pending')
```

`admin_action_items` doesn't currently have a `player_id`-typed column
matching this use directly — it does (`player_id uuid REFERENCES
public.users(id)`, migration `055`), reused here for "the user this
candidate is about," consistent with its existing usage for
`caregiver_removed_review`.

### B.3 Scheduling — same pattern as migration `078`

`pg_cron` + `pg_net` invoking `retention-scan` monthly (not hourly like
RSVP reminders). Cron expression for "once a month": `0 4 1 * *` (04:00 UTC
on the 1st — outside any club's typical evening hours, matching migration
`058`'s reasoning for its own 3am slot). Reuses the same Vault
`service_role_key` secret migrations `042`/`078` already require — no new
manual secret step if either has been applied.

### B.4 Exemption semantics (confirms requirements.md B4)

An admin's exemption (Piece C) is itself just an `admin_action_items`
update: `status='actioned'`, `actioned_by=<admin id>`, `detail.outcome =
'exempted'`. Because Step 3/4 above only ever look for an *existing pending*
row before creating a new one, an exempted (now `actioned`) row doesn't
block a fresh candidate row from being created next month if the person is
still roleless then — this is what gives the "one-cycle snooze" behaviour
requirements.md flagged as an assumption, for free, with no extra status
value needed.

---

## Piece C — Desktop "Data Retention & Privacy Assurance" report

### C.1 Route + nav — independent of `desktopFeatures.reporting`

New page `src/pages/desktop/DataRetentionReport.tsx`, registered as a normal
(always-on) route in `routes/index.tsx` — **not** inside the
`...(desktopFeatures.reporting ? [...] : [])` spread that gates the deferred
6-page suite (see that file's existing pattern around line 235). Nav entry
added to `DesktopLayout.tsx`'s `NAV_ITEMS` array as a plain, unconditional
entry (no flag at all — there's no plan to hide this one later the way
Reporting was hidden for V1).

### C.2 `retention-api.ts` — client data access

```
listRetentionCandidates(): reads admin_action_items
  WHERE kind='retention_candidate' AND status='pending'
  joined to users for display name, ordered by scheduled_scrub_at asc

exemptCandidate(id, adminId): updates that row per B.4

listRecentlyActioned(limit=20): reads admin_action_items
  WHERE kind='retention_candidate' AND status='actioned'
  ORDER BY actioned_at DESC LIMIT limit
  -- powers C6's "recently actioned" history; distinguishes
  -- detail->>'outcome' = 'auto_scrubbed' vs 'exempted' vs 'no_longer_eligible'
  -- for display (e.g. different badge colours)
```

### C.3 Page layout

Two sections on one page (matches C6's "not just future actions" note):

1. **Pending review** (C3/C4): table — name, role(s) held, `role_ended_at`,
   `scheduled_scrub_at`, an "Exempt" button per row. Empty state: "Nothing
   scheduled this cycle."
2. **Recent history** (C6): a shorter list below — "Sarah Jones — auto-
   scrubbed 3 Sep 2026" / "Tom Reid — exempted by [admin] 1 Sep 2026" —
   giving the assurance half of "privacy assurance," not just a to-do list.

### C.4 RLS / access

Reads go through the normal admin-only `admin_action_items` RLS already
established by migration `055` (no policy change needed) — the route itself
is reachable only under `/desktop`, already admin-gated per V1.8.

### Out of scope for C (unchanged)
No manual "run cleanup now" button — B.3's monthly cron is the only trigger
for the actual scrub, matching the locked decision.

---

## Summary of open items for Mike before/while building

Both items originally raised here are now resolved:

1. ~~**Auth-side ban on scrub.**~~ **RESOLVED 2026-09-10: no ban.** A
   scrubbed person can come straight back in and re-registers as if new —
   see the "Key finding" section and A.2 above.
2. ~~**Orphaned-pending-children clock.**~~ **RESOLVED 2026-09-10: Option
   A.** 90 days measured from migration `058`'s auto-deny, ~120 days total
   from the original invite — see the "Corrections" section above.
3. Everything else in `requirements.md`'s own "cross-cutting / out of scope"
   list (V2 anonymised-aggregate job, Supabase plan/PITR wording, the
   privacy-inbox owner) is unchanged by this design pass.
