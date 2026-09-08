# Data Retention & Privacy Assurance (V1.R Part 2) — Requirements

**Status:** decisions locked (2026-09-08), requirements drafted, not yet
designed or built. This spec is what `NEXT-SESSION-NOTES.md`'s "privacy +
retention" workstream calls step 4 — the automated build behind the
retention rules that step 3 defined.

**Context:** `docs/data-retention-scoping.md`'s "DECISIONS LOCKED —
2026-09-08" section settled every open question about how user/role data
gets cleaned up. This spec turns those decisions into an actual build:
a scheduled job that finds people who no longer hold a role, a review
step admins control before anything is touched, and the mechanism that
does the touching. Nothing here is built yet — `user_type`,
`rolesApi.promoteToFullUser`, and the "Cleanup Lite Users" button
(`docs/data-retention-scoping.md`'s Kiro-read section) are all still the
old vestigial mechanism this spec supersedes.

**Reads with:** `docs/data-retention-scoping.md` (decisions + reasoning),
`NEXT-SESSION-NOTES.md` (workstream + V1.R Part 1 precedent),
`.kiro/steering/project-standards.md`. Existing code/schema this builds
on: `admin_action_items` (migration `055`) — the existing generic,
never-auto-actioned admin review queue, already the right shape for
Piece B/C below; `team_members` (`021`, hard-delete precedent from V1.R
Part 1); `player_caregivers` (`001`/`036`, `ON DELETE CASCADE` that
Piece A supersedes); `game_feedback` (`022`) and `gant_player_summaries`
(`073`), both FK'd to a player; `src/config/desktopFeatures.ts` +
`src/layouts/DesktopLayout.tsx` (the `reporting` flag this spec's report
deliberately does **not** use).

This spec covers three independent pieces:

- **Piece A — scrub-in-place mechanism** (schema + the function that does it)
- **Piece B — the scheduled job** (monthly candidate list + automatic scrub
  after the grace window)
- **Piece C — the Desktop "Data Retention & Privacy Assurance" report**
  (admin visibility + exemption control)

---

## Piece A — Scrub-in-place mechanism

### Problem

"Delete the user" cannot mean a literal `DELETE FROM users` — found live
while scoping this: `messages.sender_id`, `game_feedback.created_by` /
`player_id`, substitution `player_on_id` / `player_off_id`, and other
columns reference `users(id)` with no `ON DELETE CASCADE` / `SET NULL`. A
real row delete throws an FK violation today, and changing every one of
those FKs to allow it risks cascading away other people's message/
feedback history just because one participant aged out. Per the locked
decision, this becomes an in-place PII scrub instead.

### Requirements

- **A1. What gets scrubbed.** On a `users` row being retired: `name` (or
  first/last name fields, whichever the schema actually has — confirm in
  design), `email`, `phone`, `date_of_birth` are cleared or replaced with
  a non-identifying placeholder. The row's `id` is kept, so every FK
  referencing it (messages, feedback, substitutions, `created_by` /
  `updated_by` audit columns) stays valid — no FK migration needed.
- **A2. Marking, not hiding.** The row gets an explicit marker (e.g.
  `retired_at timestamptz`, exact column TBD in design) distinct from
  the existing `users.active` flag, so "scrubbed for retention" is
  distinguishable from other reasons a user might be inactive.
- **A3. Email uniqueness.** If `users.email` has a uniqueness constraint,
  scrubbing must not collide with a later scrub or a future signup at the
  same address — confirm the constraint in design and null the column (or
  use a per-row non-colliding placeholder) accordingly.
- **A4. Idempotent + safe to re-run.** Running the scrub twice on the same
  row must not error and must not re-fire anything (e.g. a second
  caregiver-link-clearing pass on an already-cleared link).
- **A5. Caregiver link handling (decision #4).** When a **child's** row is
  scrubbed, their `player_caregivers` link(s) are cleared / marked
  inactive in the same pass — the schema's `ON DELETE CASCADE` never fires
  under this mechanism (nothing is ever actually deleted), so this needs
  its own explicit step. The **caregiver's own** eligibility for scrubbing
  is evaluated independently later (Piece B) — a caregiver is never kept
  or scrubbed *because of* this link.
- **A6. Child-must-have-a-caregiver invariant stays intact.** This
  mechanism must not conflict with the existing minimum-one-caregiver rule
  (V1.R Part 1, `docs/data-retention-scoping.md`'s item 4) — scrubbing a
  child does not touch that invariant (the child themselves is going
  inactive, not losing a caregiver while still active).
- **A7. Admins excluded (decision #5).** This mechanism is never invoked
  for a `users` row with an admin role — confirm the exact check
  (global `users.role = 'admin'`, per the existing stored-field decision
  in V1.R Part 1) in design.

### Out of scope for A

- Any change to `game_feedback` / `gant_player_summaries` content itself —
  those rows stay as they are, still attributed to the now-scrubbed
  `player_id` (this is the point: no FK break). What eventually happens to
  that content long-term is Piece C of the *performance-data* decision
  (the deferred-to-V2 annual anonymised-aggregate job), not this piece.

---

## Piece B — Scheduled retention job + review queue

### Problem

Per decisions #6 and #7: eligibility is mechanical (zero active
team-linked roles for a defined window), but nothing gets scrubbed
without a human admin having had a chance to review and exempt first.

### Requirements

- **B1. Monthly cadence.** A scheduled job (pg_cron + pg_net Edge
  Function, same pattern as migration `078`'s `send-rsvp-reminders`) runs
  once a month.
- **B2. Two eligibility clocks.**
  - Standard: a `users` row with **zero active `team_members` rows** for
    **12 months** (decision #6 — no activity/login signal, purely
    role-based).
  - Orphaned pending children (decision #9): an add-a-junior invite never
    approved by a caregiver, **90 days** old.
  - Club-competition-linked roles additionally respect the Club retention
    clock (decision #3 — rolling 12 months from the competition's close,
    itself 4 weeks after its last event) rather than the role's own
    creation date where the two differ; confirm exact precedence in
    design.
- **B3. Candidate list, not immediate action.** For each newly-eligible
  person, the job creates an `admin_action_items` row (reusing the
  existing generic review-queue table from migration `055` — new `kind`,
  e.g. `retention_candidate`; `detail` jsonb carries at minimum: role(s)
  held, date the role ended, which clock applied (standard / orphaned
  child), and the scheduled scrub date). It does **not** scrub anyone the
  moment they become eligible.
- **B4. One-month grace window, admin-exemptible.** Each candidate sits
  for **30 days** after being listed. An admin can exempt a candidate at
  any point in that window (Piece C's report is the control surface for
  this — see C4). An exempted candidate is removed from this cycle's
  queue; if they're still eligible next month (still no role), a fresh
  candidate row is created rather than the exemption silently persisting
  forever (**assumption — flag for confirmation**: exemption is a one-cycle
  snooze, not a permanent "never touch this person" flag; if a permanent
  exemption is wanted instead, that's a different `admin_action_items`
  status this design should account for).
- **B5. Automatic scrub (decision #7).** After the 30-day window, for
  every non-exempted candidate still eligible, the job invokes Piece A's
  scrub mechanism automatically — no separate admin click required, per
  the locked decision.
- **B6. Caregiver clock independence (decision #4).** The eligibility
  check for a caregiver never treats "caregiver of an inactive/scrubbed
  child" as an active role. A caregiver whose only link was to a now-
  scrubbed child is judged solely on whether they hold any other active
  `team_members` row.
- **B7. Idempotent + resumable.** If the job fails partway (e.g. mid-batch
  Edge Function timeout), re-running it must not double-create candidate
  rows for someone already queued, and must not re-scrub someone already
  scrubbed (ties to A4).
- **B8. Audit trail.** Every scrub performed by this job should be
  traceable after the fact — at minimum, the `admin_action_items` row's
  `status` moves to `actioned` (or a new terminal status distinguishing
  "auto-scrubbed" from "admin-exempted") with `actioned_at` set, so
  "what happened to this person and when" is answerable later without
  reverse-engineering it from a scrubbed row.

### Out of scope for B

- The annual de-identified performance/feedback aggregate job (decision
  #2) — explicitly deferred to V2, not part of this spec.
- Notifying the affected person directly (decision #7 — admin-only
  review, no automated email to the person).

---

## Piece C — Desktop "Data Retention & Privacy Assurance" report

### Problem

Admins need to see who's queued for scrubbing and be able to act (exempt)
before the 30-day window closes. Desktop Reporting (the 6-page suite) is
currently OFF for V1 (`desktopFeatures.reporting = false`, deferred to
V2.8) — but per Mike's explicit decision, this specific report is not
part of that deferral and ships independently for V1.

### Requirements

- **C1. Ships independently of the `reporting` flag.** This report gets
  its own nav entry in `DesktopLayout.tsx` / route in `routes/index.tsx`,
  **not** gated by `desktopFeatures.reporting` and **not** part of the
  6-page suite that flag controls. (Whether it needs its own flag at all,
  or is simply always-on for V1, is a design call — leaning toward
  always-on, since there's no plan to hide it later the way Reporting was
  hidden.)
- **C2. Admin-only.** Same route-guard pattern as the rest of `/desktop`
  (desktop is confirmed admin-only for V1 per V1.8).
- **C3. List view.** Shows every open `admin_action_items` row of kind
  `retention_candidate`: person's name, role(s) held and when that role
  ended, which clock applied (standard no-role / orphaned pending child),
  and the scheduled scrub date (grace-window end).
- **C4. Inline exempt action.** Per decision — admins act right there on
  the report, no bouncing to User Management: a button/toggle per row
  that exempts that candidate for this cycle (see B4's flagged open
  question about whether that's a one-cycle snooze or sticks).
- **C5. Un-exempt / undo.** An admin should be able to reverse an
  exemption they just made (e.g. exempted the wrong row) within the same
  session — exact UX (immediate undo vs re-toggle) is a design call.
- **C6. Recently-actioned history.** Some visibility into what was
  actually scrubbed in past cycles (even a simple "last scrubbed: N
  people on [date]" or a short recent-history list) — an admin-facing
  privacy-assurance report that only ever shows *future* actions, never
  confirming what already happened, is a weaker assurance tool. Exact
  depth/retention of this history is a design call.

### Out of scope for C

- Any UI for the annual anonymised-aggregate job (deferred to V2 along
  with the job itself).
- A manual "run cleanup now" trigger — the scrub is fully automatic per
  decision (B5); this report is visibility + exemption, not a trigger.

---

## Cross-cutting / explicitly out of scope for this whole spec

Per the decisions already locked in `docs/data-retention-scoping.md`,
these are **not** part of this build:

- The annual de-identified performance/feedback aggregate table (tagged
  by age band + team + theme) — deferred to V2, real design not started.
- Confirming the project's actual Supabase plan/PITR setting for exact
  backup-retention wording in the privacy policy — Mike's action item.
- Setting up / assigning who monitors `privacy@clubfootball.app` —
  operational, not a build item.
- The privacy policy document rewrite itself — a separate step in the
  same workstream, not this spec.
