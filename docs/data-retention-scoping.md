# Data Retention & Cleanup — Scoping Notes (Draft)

> **STATUS: SCOPING / NOT BUILT.** Working notes to shape both (a) the privacy
> policy's retention wording and (b) the future build scope for automated cleanup
> of competition, team, and user data. Captures the thinking so far and flags
> what's undecided — not a finished policy or a build spec.
>
> **Related:** privacy policy retention section (`docs/privacy-policy-draft.md`,
> "How long we keep your information"); roadmap open decision **3c** and the
> "Data retention & cleanup" build item in `NEXT-SESSION-NOTES.md`.
>
> Source: Mike's brainstorming (with Claude), captured 2026-08-19. **Not legal
> advice** — the children's-data and de-identification points need qualified
> review before either the policy or the build is finalised.

---

## DECISIONS LOCKED — 2026-09-08 (Cowork session)

**Status upgrade: every open question below that gates the build is now
resolved.** This is step 3 of the "privacy + retention final combined
workstream" (`NEXT-SESSION-NOTES.md`) — the policy is still SCOPING (not
built), but no longer undecided. The sections below this one are kept
as-is for the reasoning trail; this section is what the privacy policy
rewrite (step 1) and the V1.R Part 2 spec/build (step 4) should actually
build from.

1. **User deletion mechanism.** Not a literal `DELETE FROM users`. When
   the 12-month no-role clock expires (after admin review — see #7), PII
   is scrubbed in place: name/email/phone/DOB nulled, the row marked
   deleted/inactive, `id` kept. Found live while scoping this: `messages
   .sender_id`, `game_feedback.created_by`/`player_id`, substitution
   `player_on_id`/`player_off_id`, and other columns reference `users(id)`
   with no `ON DELETE CASCADE`/`SET NULL` — a genuine row delete would hit
   an FK violation today, and fixing every one of those FKs to allow it
   risks cascading away other people's message/feedback history just
   because one participant aged out. Scrub-in-place needs no FK migration
   at all.
2. **Individual performance/feedback data (Q2).** `game_feedback` and
   `gant_player_summaries` stay personal data — retained as long as the
   player is still listed with the club, then scrubbed with the person
   per #1 like everything else. **Drop the privacy policy's current
   "kept indefinitely, anonymised" claim for this individual-level data**
   — it isn't true today (both tables carry a live FK to the player) and
   no aggregate table backs it. Separately, **once a year**, a scrape job
   is to copy anonymised, *tagged* content — age band + team + theme
   (e.g. "positive/strength" vs. "work-on/improvement"), not raw text, no
   name — into a new aggregate table with no FK back to a person, for
   admin/AI trend analysis (strong vs. weak year groups, what's working
   club-wide). **This table's design and the annual job are deferred to
   V2** — not part of the Part 2 retention build. This is the real shape
   of the policy draft's existing "Anonymised summary data" section; that
   section can stay directionally but should say "planned," not imply it
   already exists.
3. **Club retention clock (Q1) + close-delay (Q1b).** Rolling **12
   months** from when a Club competition's last event closes it — same
   shape as League's grace year, so the policy states one rule ("12
   months after you stop holding a role") instead of two clocks to
   reconcile. The competition itself closes (stops taking new admin
   actions like messaging/wrap-up) **4 weeks after its last event**. No
   auto-close exists today — this is new behaviour to build.
4. **Caregiver link handling (Q4).** The schema's `player_caregivers ...
   ON DELETE CASCADE` never fires under decision #1 (nothing is ever
   literally deleted from `users`), so a new explicit rule replaces it:
   when a child's role goes inactive/scrubbed, their caregiver link is
   cleared/marked inactive in the same pass. The caregiver's **own**
   12-month clock runs independently — being caregiver of a now-inactive
   child does not keep the caregiver's account alive; they're judged
   solely on whether they hold any other active role.
5. **Admins.** Confirmed out of scope, as originally scoped — no team or
   competition association, so nothing in this build applies to them.
6. **Definition of "no role" (Q6).** Kept simple and mechanical: zero
   active team-linked roles for 12 months, no activity/login signal
   folded into the job's own logic — the admin review step (#7) is the
   human safety net for edge cases instead.
7. **Notice before deletion (Q7) + export (Q11).** Not an automated email
   to the person. Once a month, admins get a review list of everyone
   about to age out (name, last role held, when) and can tag/exempt
   anyone they don't want scrubbed; after a **1-month grace window**,
   whoever's left on the list gets scrubbed per #1. No direct contact to
   the flagged person — the existing "Your rights" access-on-request
   process (already in the privacy draft) covers anyone who wants a copy
   of their data at any time, independent of this flow.
8. **Lite users with no team (Q8).** No special case — same admin-review
   flow as anyone else with zero active team-linked roles. Matches the
   `user_type` retirement already noted below (the tier isn't real
   today).
9. **Orphaned pending children (Q9).** Shorter window than the standard
   grace year: **90 days** from an unapproved add-a-junior invite, then
   treated the same as any other no-role case.
10. **Backups (Q10).** Still needs the project's actual Supabase
    plan/PITR setting confirmed before the policy states a specific
    number. Supabase's own published retention: 7 days of daily backups
    on Pro, 14 on Team, 30 on Enterprise (Free has none; PITR is a paid
    add-on with 7/14/28-day options and replaces daily backups when
    enabled). Whichever applies here, the policy should say "deleted data
    may persist in backups for up to N days," not imply instant erasure
    everywhere.
11. **Export on request.** Covered by #7 above — no separate build. Note
    that the "Your rights" contact address (`privacy@clubfootball.app`)
    needs an actual person monitoring it; that's an operational task for
    Mike, not a build item.

**Two small loose ends, not blocking:** (a) confirm which Supabase
plan/PITR setting this project is actually on, for exact backup wording
in #10; (b) confirm who's actually monitoring `privacy@clubfootball.app`
for #11.

---

## The two competition types

- **League Competitions** run ~20 weeks across terms 2 and 3. Each year, team
  names and rosters (players, caregivers where relevant, managers, coaches) are
  imported **via CSV** from the club's Friendly Manager system. That roster data
  is only valid for the year it's imported — a fresh import each season, not a
  persistent structure.
  - *Correction 2026-08-19:* there is **no API** — Friendly Manager is CSV export
    only; an API is a "maybe one day", not current. (Roadmap decision 6 / V1.T,
    still waiting on an export sample.)
- **Club Competitions** are built through an invite process: a manager is invited
  to set one up and in turn invites the roles they need. They run from a single
  one-day tournament up to a 10-week tournament. A competition should **close a
  defined period *after* its last event** — deliberately after, not on, the final
  event, because the club admin may still need to work with the data (messaging,
  wrap-up) for a short while afterwards.
  - *Correction 2026-08-19:* this close is a **proposed process, not confirmed
    built** — Mike thought it existed; needs checking (likely does not auto-close
    today). The exact delay is **undecided** (2 weeks? 4 weeks? other?) — see Q1b.

## The three layers of data

Rather than one cleanup rule, there are really three layers with different
lifespans:

1. **Competition-instance data** — the team name and the specific roster tied to
   that year's League import or that specific Club event. Inherently disposable
   once the competition closes; nothing about it needs to persist.
2. **Player/role identity data** — the underlying person: name, contact details,
   the caregiver-to-player relationship, and their role type (player, coach,
   manager, caregiver). Worth retaining only if it makes it easier to reassociate
   the person with a new team next year rather than re-registering from scratch.
3. **De-identified performance data** — ongoing performance/stats with identity
   stripped, intended to be kept indefinitely regardless of what happens to the
   competition, team, or user record.

## Retention rules by competition type (current thinking)

| Layer | League Competitions | Club Competitions |
|-------|--------------------|-------------------|
| Competition / team data | Team deleted automatically on **31 December** each year | Competition closed **a defined period after the last event** (delay undecided — see Q1b; and confirm whether any auto-close exists today, it likely does not) |
| Player/role identity data | Team association removed but user record kept; if no new role/reassociation by **31 December the following year**, the user is deleted | Same principle proposed (retain if it eases rejoining) — **retention clock not yet fixed** (see open questions) |
| Performance data | Retained indefinitely, identity removed | Presumed same, not yet confirmed |

## Open questions to settle before this is build- or policy-ready

1. **Club retention clock.** League has a natural anchor (31 Dec, school-term
   calendar). Club events close at different points in the year — does the same
   fixed 31 Dec cutoff apply, or a rolling window (e.g. 12 months from the event's
   close)? A fixed date gives some users a much longer grace period than others.
2. **Anonymised vs pseudonymised performance data.** "Identity removed" needs to
   be precise. If the performance record can be re-linked to a player even
   indirectly, that's *pseudonymisation* and it likely still counts as personal
   information under the Privacy Act — so it needs its own retention justification.
   If there's genuinely no way to re-identify, it falls outside "personal
   information" and can be kept indefinitely with no deletion obligation. Which one
   the build implements changes what the privacy policy can honestly claim.
3. **How "inactive, no team" is modelled.** To make rejoining easier, the lean is:
   when a team is deleted, don't delete the role records — null the team reference
   and mark the role/user inactive/unassociated. Deleting the row would undercut
   the point. Confirm this as the intended approach before scoping.
4. **Caregiver-player relationships.** Caregivers link to a specific player, not
   the team. When a player's role goes inactive, does the caregiver relationship
   stay attached and go inactive in step, or need separate handling? The trickiest
   edge case, since caregivers aren't team members in the same sense.
5. **Admins.** Outside all of this — admin accounts aren't tied to a team or
   competition. State explicitly so they aren't swept into the same logic.
6. **Definition of "no role."** Eligible for deletion purely on zero active
   team-linked roles, or do other signals (recent login/activity) factor in?
7. **Notice before deletion.** Permanent deletion of personal data — best practice
   favours warning the person / offering data export before the cutoff rather than
   silent deletion. Decide whether the build needs a notification step.

**1b. Club competition close-delay.** Separate from the retention clock above:
   how long *after its last event* does a Club competition stay open before it
   closes/marks inactive? The delay exists on purpose (admin may still message /
   wrap up), so it's a deliberate window, not zero. Fixed period (2 wk / 4 wk?) or
   configurable per competition? Also confirm no auto-close is built yet.

8. **Lite users with no team.** Invited players/caregivers who registered but never
   got (or have lost) a team association are exactly the "no active role"
   population. Confirm they fall under the same cleanup rule rather than being an
   untracked exception.

9. **Orphaned pending children.** An add-a-junior child whose caregiver never
   approved sits inactive indefinitely. Likely wants a **shorter** cleanup window
   than a full grace year — decide it.

10. **Backups.** Deleting from the live DB does not purge Supabase's backups
    immediately. If the policy claims deletion, it must account for a
    backup-retention window, or the claim is technically wrong the moment someone
    checks.

11. **Export on request.** The privacy "Your rights" section promises access — the
    build and the pre-deletion notice (Q7) should make a person's data
    **exportable**, not just deletable.

## Competitor benchmarking — what comparable platforms actually do

Neither reviewed platform is strong on retention, and both are notably weak on
children's data.

- **Friendly Manager** — single generic retention clause ("so long as required for
  the purpose … or as required by law"); no period, timeline, or erasure process.
  Nothing specific on children — no age threshold, no guardian-consent requirement,
  no special handling for minors. Roles not distinguished anywhere; no mention of
  what happens to data when a team or role ends.
- **Heja** (a platform this build would replace for some clubs) — activity-based
  retention ("as long as you stay a registered user … longer inactivity, we erase
  on a regular basis"), neither term defined. Carve-outs for legal/contractual
  needs and for data that "may be anonymized to prevent history for teams and
  organizations" — essentially our Layer 3, useful precedent, but doesn't say
  whether that anonymisation is reversible. Acknowledges collecting "information
  about your children" but no age threshold, no explicit parental consent, no
  GDPR Art. 8 reference despite being an EU/Swedish company.

**Takeaway:** the market hasn't actually solved children's-data retention — there's
no established practice to copy. Building explicit age handling, guardian consent,
and a defined deletion timeline would put this app *ahead* of both, not just
catching up.

## Where this leaves things

The **League** side is close to a workable rule: team data dies annually on a fixed
date, identity data survives one grace year contingent on reassociation,
performance data survives indefinitely if truly de-identified. The **Club** side is
the same shape but still needs its retention clock defined. Questions **3 (role/
status model)** and **4 (caregiver edge case)** are the two most likely to affect
build scope, so resolve those first.

---

## Kiro read — what gates the build (added 2026-08-19)

Grounded against the current schema/conventions. Brief, to help the decisions.

- **The policy↔code tension — smaller than it looks (finding 2026-08-19).** The
  privacy draft promises the app *deletes* data after 12 months, while the steering
  standard says *"Soft Deletes: use `deleted_at`, don't hard delete."* A grep
  settles what soft-delete was actually for: `deleted_at` is implemented on
  **exactly one table — `delivery_records`** (coach lesson-delivery history, from
  the technical-foundation spec), as an audit-trail soft delete. It is **not** used
  on `users`, `teams`, `team_members` or `player_caregivers` — none of the personal
  data this retention build touches. So the "convention" is largely aspirational and
  scoped to audit history, not personal-data lifecycle. Practical effect: adopting
  genuine **hard delete for privacy cleanup conflicts with almost no real code** —
  it just needs a documented exception to the steering rule for retention, while
  the delivery-records audit soft-delete stays as-is. (Mike's steer 2026-08-19:
  move to best-practice privacy data-management thinking rather than defaulting to
  the old soft-delete convention.) Whichever way, policy wording and build must
  say the same thing.

- **Q2 (anonymised vs pseudonymised) is the highest-value decision** — it's the
  one that decides whether the "kept indefinitely" claim in the policy is even
  legal. Cleanest path for an honest "not personal information" claim: the
  performance layer stores **no user_id/FK back to a person** — aggregate to
  `team + age_group + season` (or hash-with-discarded-salt if per-event rows are
  needed), so re-identification is genuinely impossible, not just discouraged.
  If any per-player row with a live FK survives, treat it as personal information
  and it inherits the 12-month rule.

- **Q4 (caregivers) partly answered by the schema already.** `player_caregivers`
  is defined `player_id … REFERENCES users(id) ON DELETE CASCADE` (migration 001 /
  036). So if a child user row is ever hard-deleted, the caregiver *link* cascades
  away automatically — but the caregiver's own `users` row does not. Likely intent:
  when a player goes inactive, the link goes inactive in step; when a player is
  deleted, the link cascades; a caregiver with no remaining active links is then
  evaluated for deletion under the same "no active role" rule as anyone else.
  Confirm, and note the cascade means "null the team ref, keep the row" (Q3) has to
  be modelled on the *role/membership*, not by deleting the user.

- **Q3 (soft dissociation) is sound and cheap.** Nulling the team reference on
  `team_members` (or marking the membership inactive) and leaving the `users` row
  intact is the right shape and matches how the app already thinks (mark inactive,
  don't delete). This is the low-risk core of the build.

- **Q1 (Club clock) — recommend a rolling window, not a fixed date.** A rolling
  "12 months from the event's close" is fairer, and — importantly — lets the
  privacy policy state **one simple rule** ("12 months after you stop holding a
  role") instead of two different clocks the reader has to reconcile. Simpler to
  say, simpler to defend.

- **Q7 (notice before deletion) ties to the monitored-inbox decision.** A warning
  email + export window needs a real send path (have it) and a real reply/contact
  address (the open privacy-inbox decision). Worth bundling those.

- **`user_type` (lite/full) folds into this work (decided 2026-09-04).** Review
  during the V1.8 admin console rework found `user_type` is effectively
  vestigial: it does **not** gate nav, permissions, or RLS (nav is explicitly
  role-based; `resolveCapabilities` and the roster actions read `role` +
  `team_members`, never `user_type`). Its only behavioural hook is
  `competitionsApi.cleanupLiteUsers`, which on a closed Club Tournament flips
  `users.active = false` for everyone tagged `lite` — a blunt, account-wide
  sweep keyed off a flag, exactly the thing this retention model replaces with
  **team-membership-scoped** removal (dissociate the person's `team_members`
  rows for that competition's teams; Q3/Q8 above). Action taken now: the V1.8
  Users admin **dropped the "Lite" badge, the Full/Lite type filter, and the
  "Promote to full" button** (they signalled a capability tier that doesn't
  exist). Left in place for the retention build to supersede: the `user_type`
  column, `rolesApi.promoteToFullUser`, and the "Cleanup Lite Users" button on
  closed Club Tournaments. When retention lands, retire `user_type` (or repurpose
  it as a deliberate tier if a real lite restriction is ever wanted) and replace
  the cleanup sweep with team-scoped dissociation. Ties directly to Q8.

**Rough build shape, when it happens:** a scheduled job (Supabase cron / pg_cron or
a scheduled Edge Function) that (1) closes/deletes competition-instance data on its
clock, (2) dissociates roles and flags users inactive, (3) after the grace window
with no reactivation, deletes or de-identifies per the Q2 decision, (4) sends
advance notice before step 3. Not small, but each stage is independent and
testable. Best sized as its own spec once the decisions above are locked.
