# Next Session Notes
## Current State — 4 September 2026

**V1.8 Admin Console rework — DONE (built + pushed).** The full 10-task Kiro
spec (`.kiro/specs/admin-console-v1.8/`) is complete: flat single-list desktop
nav; Coaching hub on real counts; Users list/detail cleanup (highest-role badge,
child/device rows show caregiver, per-person team/role list, appoint-admin,
Progress Notes link, role-free delete guard); Caregiver Reviews folded into Users
as a tab; Teams manager column + pending badge + Assign Manager (search existing
or invite-by-email, 2-manager cap); Competitions split into External Leagues /
Club Events with click-throughs and a Fixtures & standings button. No new
migrations — all client-side. Commits: Tasks 1–5 `dfa15dc`, Tasks 6–8 `076fbd9`,
Task 10 docs this batch. Full detail in `CHANGELOG.md` (2026-09-04 "V1.8: Admin
desktop console rework") and the spec's `tasks.md`.

**Still to do on V1.8 — the live eyeball (owner):** manual admin pass, especially
the real-data bits — Teams manager/pending display, assign/invite flow,
Competitions tabs + click-throughs, and the fixtures link. Task 9 mobile paths
(admin role actions + Coaching delivery access) were confirmed in code but the
device tap-through is still worth a look.

**Two follow-ups parked (in the spec's Deferred list):**
1. **"Active Coaches" count** on the desktop Coaching page is strict global
   `users.role='coach'` (undercounts — shows 1). Broaden to coach-authority
   (`team_members` role='coach' OR `is_coach`).
2. **Coaching-activity dashboard** (lesson deliveries + coach feedback surfacing
   on desktop Coaching) → V2.

**Watch items (unchanged):** the 2 `redeem-invite` tests in
`invites-api.preservation.test.ts` run + fail on this laptop because
`SUPABASE_SERVICE_ROLE_KEY` is set (they skip in CI without it) — a known
env quirk, not a regression. Mike Brooke's admin role was restored via SQL
(migration 066 keeps `users.role` as the trigger-maintained highest role).

---

## Current State — 28 August 2026

**Since this was last updated (25 -> 28 August):** the entire
**Streamlined Invites & Child Account Access** Kiro spec (12 tasks) has
been built, applied, and pushed — 11 of 12 tasks done. Task 12's manual
test pass got underway on 2026-08-28: item 1 (Adult happy path) confirmed
working; item 2 (Child happy path) was live-tested twice, found genuinely
broken in six ways, and all six were diagnosed and fixed same session (6
patches pushed, migration 059 run, two Edge Functions redeployed) — it
now needs one clean re-test before items 3-6 can start. A separate,
unrelated bug (Announcements admin modal crashing on every open) was also
found and fixed along the way. This is the "Model A reversed" redesign:
children now get a real, direct, device-bound login instead of only ever
being a record their caregiver manages. Full detail in the new section
immediately below, in `CHANGELOG.md`'s 2026-08-26/28 entries, and in
`task12-manual-test-script.md` / `caregiver-invite-flow-fix-plan.md`; full
task-by-task detail lives in
`.kiro/specs/streamlined-invites-and-child-access/tasks.md`.

**This directly resolves one of the two decisions parked at the bottom of
the Add Player / DOB section further down** ("Existing-User Invite
Shortcut" — now built as this spec's Requirement 2 / Task 4) **and leaves
the other one — "Caregiver DOB Correction Threshold" — still genuinely
open**, now more precisely scoped: see the note inline in that section.

**Also worth knowing about, not part of V1:** two operational docs were
added this session — `CLAUDE.md` at the repo root and a paired
`session-playbook.md` in this project's claude.ai Project — capturing how
an AI session should work in this repo (git-patch delivery, verification
discipline, migration/deploy steps) so that knowledge survives across
separate Cowork sessions rather than living only in one long chat history.
Two early planning docs for a possible future "Gant" AI coaching-feedback
assistant were also added to `docs/project/` — no build started, not
currently in V1 scope.

**Older context below, still accurate:** the Add Player / DOB age model
Kiro spec (13 tasks) was fully built, applied to `prototype`, pushed to
GitHub, and both affected Edge Functions redeployed — see that section
below. That closed out the "no nav link to Caregiver Approvals" follow-up
noted throughout this file under V1.4/TASK 1 (fixed via a real nav tab),
and superseded the older "no DOB field, age comes from `teams.age_group`
only" design decisions recorded further down — DOB is now collected.
Historical sections are left in place with inline correction notes rather
than deleted, so the "why" of the original decision isn't lost.

**2026-08-25 follow-up, found while live-testing the above:** the
self-registration page made the invitee retype their name and email from
scratch even though the Manager already typed the name into Add Player and
the email is inherently verified (it's the exact address the invite went
to). Fixed and shipped same day — name now prefills (editable), email locks
read-only, DOB stays untouched by design. Full detail: `CHANGELOG.md`,
"2026-08-25 - Add Player / DOB age model — self-registration UX follow-up."
Applied, pushed, and migration run; **live-testing this fix is what's
happening right now** — see the dedicated section below for what to confirm.

**Housekeeping pass (2026-08-25):** this file had accumulated three separate
write-ups of the same completed work in different places (e.g. the Task 1
add-a-junior RLS fix appeared in full three times), plus a few section
headers that still said "NOT STARTED" for features that had shipped weeks
ago. Cleaned up: **`CHANGELOG.md` is this project's permanent historical
record — every shipped fix/feature has its own dated entry there with full
technical detail.** This file only needs to say what's done (one line + a
CHANGELOG pointer) and what's still open. No separate "archive" section was
added here for that reason — CHANGELOG.md already *is* the archive. Where a
section still holds genuinely reusable reference material (account IDs, a
device-setup runbook, DNS gotchas, a design decision's rationale), that
stayed — only the redundant blow-by-blow narrative was trimmed.

---

## 🟢 Streamlined Invites & Child Account Access — 11/12 tasks done, Task 12 checkpoint in progress (2026-08-26/28)

The biggest change in the app to date: children get a real, independent,
device-bound login rather than only ever being a record their caregiver
manages (`NEXT-SESSION-NOTES` previously recorded "Model A CONFIRMED —
child never logs in" as a 2026-08-18 decision, explicitly reversed by
`requirements.md`'s Section 7). Spec: `.kiro/specs/streamlined-invites-and-child-access/`.

**What shipped (Tasks 1, 3a/3c/3e, 4, 6, 8, 9, 11 — full detail in that
spec's `tasks.md` and `CHANGELOG.md`'s 2026-08-26/27 entries):**
- Existing-user bypass on every invite path that can name an already-real
  account (Add Player, caregiver-invite, Admin assign-existing-Manager) —
  skips the registration form for a one-button "join" screen.
- Symmetric DOB self-declaration with wrong-tick self-correction: an
  Adult-ticked invite that comes back under-16 bounces to the Manager to
  redo as a Junior; a Child-ticked (caregiver) invite that comes back
  16-or-older converts in place into a normal adult registration.
- Child accounts with one-time device-code login (a caregiver issues a
  link, the child opens it once on their own device and stays signed in;
  issuing a new code ends the prior session).
- Child-scoped bottom nav (Home/Team/Schedule/Messages) and confirmation
  that Team-tab contact visibility needs no new gating — it already runs
  through the same age-band logic any adult Player's row uses.
- Multi-caregiver admin gate (a child's 2nd+ caregiver needs a club Admin)
  plus an admin review queue for caregiver removals, so device-access
  revocation stays a deliberate Admin decision rather than automatic.
- Consent-timeout auto-dropoff — a Junior whose caregiver never responds
  within **30 days** automatically drops off the team list (`pg_cron` +
  a new Postgres function, migration 058).

**Real production bug found and fixed along the way, not part of the
spec's design but discovered building it:** two migrations' `CREATE
POLICY` statements had never actually taken effect on the live database
despite being in the migration files — found once, then confirmed via a
full audit to have happened twice more. All three restored (migrations
056, 057). **This is now a documented, repeatable check** — see
`CLAUDE.md`'s "Database migrations" section — worth re-running
periodically, not just after a surprise.

**Applied & deployed:** all patches applied via `git am` on the repo
owner's machine and pushed to `origin/prototype`
(`4999a27` chain through `b1511eb`); migrations run via the Supabase SQL
Editor as each landed; affected Edge Functions (`check-invite-recipient`,
`link-player-caregiver`, `revoke-child-device-access`,
`redeem-device-code`) redeployed.

**Task 12 — final checkpoint — in progress.** Automated half confirmed
clean on the live pushed head: `npm test` (211 passing/2 skipped) and
`npm run build`. The manual half is a full pass of 6 sections — script:
`task12-manual-test-script.md`. Status as of 2026-08-28:

1. **Adult happy path** — ✅ confirmed working as expected.
2. **Child happy path** — tested live twice (James Corrigan/Donny Trump,
   then Mortimer Mouse/Micky Mouse) and found genuinely broken: stale
   Edge Functions (`redeem-invite`, `respond-junior-approval` running
   code ~7 days old — `supabase functions deploy` doesn't happen on
   `git push`), a child's DOB not persisting, a caregiver unable to reach
   their child's Team page or Messages at all, a confusing/hard-to-reach
   Approvals page, and no indication anywhere (email or form) that a
   child was involved. All six findings diagnosed and fixed — 6 patches
   pushed (`6dcc185..dc499b5`), migration 059 run, both Edge Functions
   redeployed. **Re-testing this clean turned up two more issues**, both
   now resolved: (a) an undocumented live `teams` RLS policy required the
   *caregiver's own* `team_members` row to read a team, which a caregiver
   never has (only their child does) — fixed via migration 060, run and
   confirmed working (Mortimer now sees Open Riverhead Frogs with Micky on
   it); (b) Micky's `date_of_birth` was still `null` (registered while
   `redeem-invite` was stale, same timing as the DOB bug above, just never
   backfilled once the code was fixed) — a one-time `UPDATE` for that test
   record, run and confirmed. Item 2 looked clean with the Mortimer/Micky
   pair at that point — **but a follow-up test with a brand-new
   child/caregiver pair (George Pig / Daddy Pig) found an 8th, separate
   bug**: a caregiver whose only linked child is still *pending* (not yet
   approved) has no `team_members`-based connection to the team at all, so
   `getMyTeams()` found nothing and Daddy Pig had no way to ever reach the
   inline Accept/Deny row — a genuine chicken-and-egg gap in retiring the
   old dedicated Approvals page. Fixed: `teamsApi.getMyTeams()` now also
   unions in a pending child's team via `caregiver_approvals`, migration
   061 adds the matching RLS grant, and the confusing leftover "Approvals"
   nav tab (pointing at the same place as Team) was retired in favour of
   the badge living on Team directly. Migration 061 run, code patch
   applied and pushed (`cfa5660`) — **confirmed working end-to-end**:
   Daddy Pig reached the team, saw George's pending row, and George's DOB
   persisted correctly on a completely fresh redemption with zero backfill
   needed this time. One polish item found on the same pass and fixed:
   the Accept/Deny fields re-asked for name/DOB the caregiver had already
   confirmed once at registration — now shown read-only with just
   Accept/Deny when a DOB is already on file (the one remaining editable
   case is an existing-caregiver-account bypass onto a new child, which
   never collects a DOB anywhere else). **✅ Item 2 is now fully clean.**
   Full detail: `CHANGELOG.md`'s 2026-08-28/29 entries and
   `caregiver-invite-flow-fix-plan.md`.
3. **6.1 bounce-back** (Adult ticked, actually a Child) — **✅ fully done,
   confirmed live.** Add Player'd Hewie Duck as Adult, entered an
   under-16 DOB: got the "Let's get your Manager to help" screen
   correctly, and confirmed no account was created — both as expected.
   Live-testing also turned up two problems, neither in the test script's
   original checks: (a) reopening the *same* invite link and entering a
   16+ DOB let a second, successful redemption through — the code had
   never been marked expired/redeemed on a bounce, so it just stayed
   valid; (b) the Manager who created the invite got no notification of
   any kind that a bounce had happened. **Fixed**: `redeem-invite/index.ts`'s
   `bounce_to_manager` branch now backdates the invite's `expires_at` to
   kill it, and sends the Manager an in-app message explaining what
   happened and that they need to re-add the person as a Junior with
   caregiver details. Deployed and **re-confirmed live end-to-end** with a
   second fresh pair (Dewie Duck / West Coast Rangers, different email):
   the bounce screen showed correctly, reopening the same link now shows
   "Code Expired — your coach/manager has been notified and can send you a
   new one," and the Manager's Messages tab showed the new notification.
   Full detail: `CHANGELOG.md`'s 2026-08-30 entry.
4. **6.2 conversion** (Child ticked, actually an Adult) — **✅ redesign
   confirmed working live**, plus one pre-existing gap found and fixed
   along the way. Live-testing found the original "convert in place"
   behavior broken: it assumes whoever redeems a Child-ticked invite IS the
   subject (a 16-17 year old who put their own email in as "the caregiver"
   for themselves) — but tested with a genuinely separate caregiver (Goofy
   Dog / "Goofys mum," distinct real people, distinct emails), it produced
   a `users` row with the caregiver's own name/email but the *child's* date
   of birth. No reliable way to tell the two cases apart from the submitted
   form data alone. **Product decision**: stop guessing at redemption
   time — a Child-ticked registration now always proceeds as an ordinary
   pending child regardless of declared DOB, and a 16+ player instead gets
   a self-service "Remove My Caregiver" action once they have their own
   login (nothing forces this — a 16+ person staying caregiver-linked is
   fine unless THEY choose otherwise). Built: retired
   `resolveAgeTickOutcome`'s `convert_to_adult` outcome, new
   `canSelfRemoveCaregiver` gate + `RemoveMyCaregiverModal.tsx` + migration
   062 (new `player_caregivers` DELETE policy, additive to the existing
   admin-only one). Deployed and **live-tested end-to-end** with a fresh
   pair (Aella Dog / "Aella mum," DOB 16+): registration completed as an
   ordinary pending child with no conversion notice, mum approved her
   normally, device access was issued, Aella signed in on her own device,
   saw "Remove My Caregiver" on her own row, confirmed through the modal,
   and a direct DB query confirmed her `player_caregivers` row was
   genuinely deleted (not just hidden from view). One confirmed non-issue
   along the way: an adult-band player's roster row never shows "(caregiver)"
   regardless of whether a link exists — `contactFor` always shows an
   adult-band row's own contact — confirmed as intended behavior, not a
   bug, per product decision ("they're over 16"). **One real gap found**:
   migration 056's caregiver-removal `admin_action_items` trigger doesn't
   actually exist live (same "migration never fully applied" pattern as
   earlier tonight) — confirmed via a direct `pg_trigger` query, not
   assumed. **Fixed**: `063_restore_caregiver_removed_trigger.sql`,
   idempotent, restores it verbatim. **Run and confirmed live 2026-08-31**:
   a direct `pg_trigger` re-check shows `on_player_caregiver_removed`
   enabled, definition matching migration 056's original — see
   `CHANGELOG.md`'s 2026-08-30/31 entries for full detail on both. Not yet
   exercised end-to-end with a fresh removal (i.e. an actual
   `admin_action_items` row appearing on the Caregiver Removal Reviews
   screen after this). Also captured, not yet built: three small UX polish
   items on "Issue Device Access" (bland button styling + unclear label;
   the generated link has no instructions on what to do with it or who
   should open it; needs a Copy button next to the link).
5. **Device-code redemption + revocation** — ✅ fully confirmed live
   2026-08-31. Issuing Aella's device code, opening it fresh in another
   browser, and landing signed in as her with scoped child nav (script
   steps 1-4) worked first, on item 4's own test. Reopening the same
   one-time link a second time (steps 5-6) was explicitly re-tested and
   **confirmed failing as expected** — not valid a second time. Attempting
   steps 7-8 (the revocation check) on Aella found a real gap first: her
   caregiver had lost the "Issue Device Access" button entirely after Aella
   removed her (correct — that's the point of removal) but there was **no
   fallback for Admin/Coach/Manager at all**, so nobody could issue her a
   fresh code. **Fixed and deployed**: new `canIssueDeviceAccess` gate
   (client + `generate-device-code` Edge Function, redeployed via `npx
   supabase functions deploy`). With that live, the actual steps 7-8 check
   was **run and confirmed on a fresh pair (George Pig / Daddy Pig)**:
   Daddy issued George's second code and George's first session was
   correctly signed out. Two more polish items landed on the same pass, per
   live feedback: the device-link box now says explicitly to open it on the
   child's own device and has a Copy Link button; the button itself is now
   labeled "Give App Access" instead of "Issue Device Access" (not "Give
   your child app access" — Coach/Manager/Admin can trigger it too now, and
   the player isn't necessarily "their child"). **Migration 063's trigger
   now fully confirmed live, 2026-09-01**: the Caregiver Removal Reviews
   screen shows both "Mortimer Mouse was removed from Micky Mouse" (the
   earlier Remove-cascade test) and "Mike Brooke was removed from Amy
   Brook" (an accidental full-team removal of Amy rather than just her
   caregiver link — see the "New gap" note below on `unlinkCaregiverFromPlayer`
   having no minimum-caregiver floor; Amy is being re-added as a Junior to
   restore her). Both rows prove the trigger fires end-to-end regardless of
   which code path deletes the `player_caregivers` row. **Task 12 item 5 is
   now fully, unambiguously closed.** Full detail: `CHANGELOG.md`'s
   2026-08-31 entries.

   **How the "Mike Brooke was removed from Amy Brook" row happened,
   2026-09-01 (worth recording, not a new bug — it's the accidental
   discovery that validated a real gap already captured above)**: while
   picking a test case for this exact verification, the repo owner clicked
   the new roster-wide "Remove" button on Amy Brook's own row instead of
   "Manage Caregivers" — removing Amy from the team entirely rather than
   just unlinking Mike as her caregiver. Since that was Amy's only team
   membership, the cascade rule correctly fired and deleted her caregiver
   link too, which is what produced this review row. Confirmed as a real
   demonstration of the "child must always have a caregiver" gap captured
   above, not a new one — and confirmed the two roster actions ("Remove
   Amy" vs. "unlink one of Amy's caregivers") are easy to conflate in the
   UI, since both show as red "Remove"-styled controls on the same row (a
   possible future UI-clarity item, not yet separately captured as its
   own thing). **Fully recovered, live-tested 2026-09-01**: George Pig
   (Manager) re-added Amy Brooke as a Junior via Add Player, naming Mike
   Brooke (an existing account) as her caregiver — this created a pending
   `caregiver_approvals` request rather than an instant join (correct:
   the zero-click bypass only applies to the adult-account routes, never
   Junior/caregiver additions). Mike, despite having ZERO real connection
   to Open Riverhead Frogs at that point (no team_members row, no
   caregiver link), correctly saw the team reappear in his own list with
   Amy's row waiting for Accept/Deny — a live, unplanned confirmation that
   migration 061's pending-child-caregiver visibility fix still works
   correctly. Mike entered Amy's DOB and Accepted; she's back on the
   roster with Mike re-linked as her caregiver, restoring the pre-mishap
   state. **Net effect**: this detour ended up validating three separate
   things at once (the migration-063 trigger, the child-caregiver-floor
   gap as a live scenario, and migration 061's pending-caregiver
   visibility fix) that would otherwise have needed separate tests.

   **New polish item found along the way, 2026-09-01, not yet built**:
   `AddPlayerModal.tsx`'s `handleContinue` (confirmed by reading the code)
   validates the form and, on failure, only sets a per-field error flag
   and returns — no scroll-to-first-error and no summary banner. In a
   scrollable modal, a failing field below the fold (repo owner hit this
   with the caregiver phone number field) means clicking Continue looks
   like it does nothing at all, with no visible feedback until the user
   scrolls down themselves. Fix direction: scroll the first errored field
   into view on failed validation, and/or show a "please fix the
   highlighted fields" banner at the top of the form. Small and low-risk
   compared to everything else queued up — repo owner has not yet said
   whether to fix this now or queue it; ask again next time it comes up.
6. **Existing-user bypass**, all three call sites — 🟡 in progress, first
   call site now ✅ confirmed working live. Testing started by adding Daddy
   Pig (an existing caregiver account) as a Player via Add Player: instead
   of Requirement 2.2's intended lightweight "you already have an account,
   join?" screen, it showed the **full** registration form (new password,
   DOB, fresh privacy checkbox) — a real bug. Investigating that also
   raised a sharper product question directly: should an existing,
   already-verified account need to click through *anything* when a
   Manager/Admin explicitly names them? **Product decision: no — zero
   clicks.** The Manager/Admin's own action is authority enough; there's
   nothing left for that person to agree to that they didn't already agree
   to when their account was first created. **Built and deployed**:
   `AddPlayerModal.tsx`'s adult route and `CompetitionsPage.tsx`'s
   assign-existing-Manager flow now call `checkInviteRecipient` right after
   creating the invite, and if the email already has an account,
   immediately call `joinExistingAccount` instead of sending a registration
   email (`redeem-invite`'s own existing-profile branch already creates
   nothing and just adds the membership — confirmed by reading its logic
   directly, not assumed). The "Add Caregiver to a child" call site was
   checked and already did exactly this (direct `player_caregivers` link,
   no invite) — no change needed there. Also found and fixed along the way:
   `check-invite-recipient` was suspected stale and redeployed (turned out
   to be unnecessary, but harmless). **First live test (Mortimer Mouse)
   appeared to fail** — he got a registration invite email — but a direct
   SQL check (`auth.users`/`public.users`, zero rows both) showed the test
   itself used a nonexistent email (`+care2` instead of his real `+care1`
   address); `check-invite-recipient` had been answering correctly all
   along. **Re-tested with his correct email and confirmed working**:
   added directly, no invite sent, no click required. **Confirmed live,
   2026-09-01**: the assign-existing-Manager call site (Competitions page)
   was tested by creating a new tournament team ("Open huapai demons") with
   the repo owner's own existing email as Manager — his account auto-
   confirmed and joined immediately, no click required, exactly matching
   the Add Player path's behavior. Confirmed at the database level too:
   `check-huapai-demons-origin.sql` shows a single `team_members` row,
   `role: manager`, `created_at: 2026-09-01 22:25:47`. **Task 12 item 6 is
   now confirmed on both call sites — fully, unambiguously closed.** Full
   detail: `CHANGELOG.md`'s 2026-08-31 entries.

   **New bug found on this test, 2026-09-01, not yet fixed**: the
   confirmation email sent for this flow ("You're all set — your account
   is confirmed and you've joined Open huapai demons...") has a template
   bug — the blue header banner reads "West Coast Rangers" while the body
   text correctly says "Open huapai demons." Header and body are clearly
   pulling the team name from two different (inconsistent) places in the
   email template — likely a hardcoded/stale value in whatever renders the
   header vs. the interpolated value used in the body copy. Cosmetic but
   confusing (a recipient could reasonably think they joined the wrong
   team). Not investigated further yet — needs someone to find the email
   template/generation code for this notification and fix the header to
   use the same team-name value as the body.

Also found and fixed along the way, unrelated to this spec: the
Announcements admin modal crashed on every open (New or Edit) —
`CHANGELOG.md`'s 2026-08-28 entry. **Deploying and confirming items 3 and
4's fixes, then working through items 5-6, is the one thing standing
between this spec and being fully closed out** — see "PLAN FOR NEXT
SESSION" below.

### ✅ BUILT, DEPLOYED, LIVE-TESTED — Roster "Remove" redesign (surfaced testing item 6, 2026-08-31)

**Confirmed live end-to-end, 2026-08-31 evening**: self-removal, the
cascade rule (both the "last team → caregiver link goes too" case AND a
non-cascading separate caregiver relationship surviving untouched), and
first-Manager protection (refused for anyone else, allowed for the first
Manager themselves) all tested and working exactly as designed.

**Variant 1 (multi-team removal) confirmed live, 2026-09-01**: added Amy
Brooke (the real one — see the "three Amys" note below) to a second team
("Open huapai demons") alongside her existing Open Riverhead Frogs
membership, then removed her from huapai demons only. Confirmed at the
database level: exactly one `team_members` row left (Frogs), the huapai
demons row gone, and her `player_caregivers` link to Mike completely
untouched — exactly as designed, since Frogs was not her last team.

**New data-hygiene gap found while setting this test up, not yet fixed**:
`caregiversApi.addJunior` (via `createAuthUser`) creates a brand-new
`public.users` row every single time a Junior is added, with zero
deduplication against an existing child of the same name — confirmed by
reading the code, then confirmed live by accident. Investigating why a
freshly-queried Amy showed "Caregiver contact details missing" led to
discovering **three separate "Amy" person-records** in this test data:
one on U9 Lithium (unrelated, pre-existing, fine), one an orphaned
typo'd duplicate ("Amy Brook" vs. the correct "Amy Brooke", zero
caregivers, zero real team, harmless leftover from earlier testing), and
the real one (created during this evening's mishap-recovery, correctly
on Frogs with a valid caregiver link — the recovery flow was never
actually broken, a same-named orphan was just misdiagnosed as it during
this test setup). Low priority — nothing user-facing breaks today, and
Task 12's item 5/6 recovery is confirmed correct — but worth a line under
V1.R's scoping: there's no mechanism to detect or prevent duplicate
child records from accumulating from repeated Add Player attempts.

**Variant 2 (plain Coach removal) confirmed live, 2026-09-01**: promoted
Hewie Duck to `role='coach'` on Open Riverhead Frogs (no "Make Coach"
button exists yet, so this was set directly via SQL for test purposes —
reverted back to Player immediately after). Signed in as Hewie, confirmed
the roster correctly showed Remove available on every row except George
Pig's (the protected first Manager) — matching the authorization rule
exactly. Removed Fred Trump; confirmed at the database level with zero
`team_members` rows left for him. A Coach's removal works identically to
a Manager's, exactly as designed.

**New bug found and confirmed by reading the code, 2026-09-01, not yet
fixed**: the top nav still labelled Hewie "player" while the roster row
correctly showed "Coach." This is not just a cosmetic label mismatch —
`MainLayout.tsx`'s header reads `user?.role` (the global `users.role`
column), and `main-layout-logic.ts`'s `tabsForRole` uses that exact same
global field to decide whether the "Coaching" and "Games" bottom-nav tabs
show at all (`showCoaching = role === ADMIN || role === COACH`). Since
promoting someone to Coach or Manager on a specific team only writes
`team_members.role` and never touches their global `users.role`, a
per-team-promoted Coach or Manager is missing real functionality (the
Coaching tab, in Hewie's case) that an account with the matching global
role would have — this isn't just about what the header text says.
Directly the same underlying issue as migration-036's RLS gap and the
missing Demote-to-Player/Make-Coach controls already scoped under V1.R
below: this app has two separate, not-kept-in-sync role concepts (a
single global `users.role`, and a per-team `team_members.role`), and
nothing reconciles them when one changes. Worth folding into V1.R's
scoping alongside the other two rather than a standalone patch, since a
quick fix here (e.g. "also update `users.role` on promotion") would
raise the same "what does global role even mean once a person can have
different roles on different teams" question V1.R already needs to
answer.

**Both minor Remove variants are now done. The Roster "Remove" action is
fully built, deployed, and live-tested end to end — nothing left
outstanding on it.**

**New gap captured, 2026-09-01, not yet built: no self-service profile
editing exists for anyone.** Directly motivated by the "Amy Brook" vs.
"Amy Brooke" typo above — if a Manager or caregiver could just fix a
misspelled name themselves, that duplicate-record mess wouldn't have
needed SQL surgery to untangle, and in production nobody may even have
Admin/database access to fix it. Confirmed by reading the code, not
assumed: there is no Profile/Settings page anywhere in the app for an
ordinary user (Player, Caregiver, Coach, Manager) to edit their own
record. The only editing surface that exists at all is
`UserManagement.tsx` — a desktop-only, club-wide-Admin-only screen — which
can already edit `first_name`, `last_name`, `cellphone`, `email`, `role`,
and `active` for **any** user. So today, fixing your own typo'd name or
updating your own phone number requires finding an Admin with desktop
access, or (as tonight) a direct SQL edit.

**Open questions, not yet decided — this needs its own small scoping
pass, not a guess:**
- Which fields should a person be trusted to edit on their own record,
  with no approval needed? Phone number seems the obvious, low-risk case
  (people's numbers change; getting it wrong just means a missed call).
  Name correction (fixing a genuine misspelling) is the case that
  motivated this, but raises a fraud/impersonation question that phone
  number doesn't — should it be truly self-service, or Manager/Admin-
  assisted (a request the child's Manager/caregiver actions, rather than
  a raw self-edit)?
- Email — almost certainly should stay gated, since it's tied to sign-in;
  changing it needs the same care as any account-recovery flow, likely
  its own dedicated verification step rather than a plain profile field.
- Date of birth — already a related, still-open decision (see "Caregiver
  DOB Correction Threshold," item 4 in the build order and the Add
  Player / DOB section further down) — worth deciding both together,
  since they're the same underlying question: which parts of a person's
  own data can they correct themselves, and does correcting it need a
  gate?
- Should a child's own record (Junior, `can_sign_in: false`) be editable
  by their linked caregiver directly, separately from whether the
  caregiver can edit their *own* record? These are naturally different
  trust levels.
- Does self-editing a name need any kind of audit trail (who changed
  what, when), given roster contact details are visible to every other
  team member (per `contactFor`'s documented no-viewer-gate design)?

**Update, same evening**: the patch was applied (`git am`), pushed (`6722785`),
and `remove-team-member` deployed (`npx supabase functions deploy
remove-team-member`) — all confirmed clean, no errors.

**Live-testing started, same evening:**
- ✅ Promote-to-Manager cap confirmed working as a side effect of testing
  (George Pig promoted to Manager alongside Mike Brooke; `Make Manager`
  correctly greyed out on the remaining Player rows once at the 2-Manager
  cap) — not new, but re-confirmed live incidentally.
- ✅ Remove confirmed working on a Player row, AND confirmed at the database
  level, not just in the UI: repo owner clicked Remove on Aella Dog, got
  the two-step confirmation modal, confirmed, and Aella disappeared from
  the roster. `check-aella-removal.sql` then confirmed directly against
  Supabase — zero rows in `team_members` for her (the delete genuinely
  happened, not just a UI refresh hiding a stale row) and zero rows in
  `player_caregivers` (expected — she'd already self-removed her only
  caregiver earlier this spec, so this test didn't exercise the
  cascade-delete-caregiver-links branch at all, since there was nothing
  left to cascade).
- ✅ Cascade rule fully confirmed with a second, more thorough test: removed
  Micky Mouse (a child Player whose caregiver, Mortimer Mouse, is ALSO a
  separate Player on the same team). Result, confirmed both in the roster
  UI and via direct SQL (`check-micky-removal-cascade.sql`): Micky's
  `team_members` row is gone, the `player_caregivers` link to Mortimer was
  cascade-deleted along with it (this WAS his last team membership), and —
  critically — Mortimer's own separate Player `team_members` row was
  completely untouched (confirmed still present, same `created_at`, same
  role). This is the cleanest possible proof the cascade only ever touches
  the caregiver link, never another person's own membership.
- ✅ First-Manager protection confirmed live: logged in as George Pig (a
  Manager on Open Riverhead Frogs, but not the first one — Mike Brooke is),
  George's own row shows Remove as expected, but Mike Brooke's row shows
  only "Give App Access" — no Remove button at all, confirming the client
  correctly refuses to offer Remove on the first Manager's row to anyone
  but themselves. (This confirms the client-side gate; the server-side
  refusal in `remove-team-member` itself hasn't been separately forced,
  but the button being absent is the practical protection for the normal
  UI flow.)
- ✅ First-Manager self-removal confirmed live: Mike Brooke (the first
  Manager on Open Riverhead Frogs) removed himself successfully — the one
  exception to the rule above worked as designed. One thing that looked
  odd at first but turned out to be correct, not a bug: after removing
  himself, Mike still sees Open Riverhead Frogs in his own team list, and
  it survived a hard refresh. Root cause (confirmed by reading
  `teams-api.ts`'s `getMyTeams`, not assumed): Mike is ALSO Amy Brook's
  linked caregiver (`player_caregivers`), and Amy is still an active
  Player on that team — `getMyTeams` correctly unions in a caregiver's
  linked children's teams independently of the caregiver's own
  `team_members` rows, so losing his own Manager membership had no effect
  on that separate relationship. He correctly no longer appears as his own
  roster row (no `team_members` row of his own left there), matching how
  every other pure-caregiver relationship already displays. This is the
  same "one association removed cleanly, a separate one untouched"
  principle already confirmed with Mortimer/Micky, just observed from the
  other direction.
- **Still untested**: someone still on more than one team being removed
  from just one of them (to confirm the caregiver link is correctly left
  alone when it's NOT their last team membership); a plain Coach removing
  someone else's row (only Manager-vs-Manager has been tried so far).

**Two related gaps found live-testing the deployed Remove action, same
evening — the repo owner has decided these get folded into V1.R rather
than tackled as their own small fixes** (2026-08-31: "i think we need to
manage 3,4 and V1.R together as one piece fully scoped"). Full detail,
including the repo owner's own decisions on the cascade judgment call and
the migration 036 RLS gap, has moved to **V1.R's own section** further
down this file, alongside V1.R's existing data-retention scoping — see
that section for everything: the missing "Demote to Player" / "Make
Coach" roster controls, the migration 036 RLS scoping fix (also still
conceptually linked to V1.M's messaging bug), and how they all touch the
same underlying question V1.R was already scoping (how team/role
associations get modeled, scoped, and torn down).

**Built autonomously while the repo owner was away this session, following
their explicit "yes lets get thios soprted!" go-ahead and "im heading off,
you work on this in the background!" instruction.** Everything below is
written, verified (`npm test`, `npm run build`, `deno check`/`deno lint` on
the new Edge Function — all clean), and delivered as a patch — but **has
not yet been live-tested against Supabase**, per this project's own
discipline that nothing counts as done until proven live. That is the very
next thing to do next session.

**What shipped:**
- `canRemoveTeamMember` (`src/lib/permissions-logic.ts`) — the pure rule:
  self-removal always allowed; otherwise Coach/Manager/Admin (no tiering)
  UNLESS the row is the team's first Manager, who may only remove
  themselves; External League always blocks Remove entirely. 6 new tests,
  all passing.
- `remove-team-member` (new Edge Function) — the privileged server-side
  twin of that rule. Re-derives self-removal, Admin/Coach-Manager-on-this-
  team status, and first-Manager protection independently under service
  role (never trusts the client), then deletes exactly the one
  `team_members` row. **Not yet deployed** — needs
  `npx supabase functions deploy remove-team-member` after the patch is
  applied, same as every other Edge Function change this project makes.
- **Cascade judgment call (flagged for review, not explicitly specified
  this precisely by the repo owner)**: removing a Player's LAST remaining
  `team_members` row anywhere in the app also deletes their
  `player_caregivers` links, so no caregiver link survives with zero team
  membership behind it. A player still on at least one OTHER team keeps
  their caregiver link untouched, since `player_caregivers` isn't
  team-scoped in this schema — severing it over a single team's Remove
  would affect every team the child is on. **Worth confirming this
  interpretation matches intent** once live-tested.
- `RemoveTeamMemberModal.tsx` (new) — two-step confirm, same pattern as
  `RemoveMyCaregiverModal.tsx`.
- `TeamPage.tsx` — Deactivate/Reactivate are **gone from this page
  entirely**, replaced by one "Remove" button per role a person holds on
  the team (usually just one; two only when someone holds e.g. both Coach
  and Player on the same team — each role's Remove is gated independently,
  since first-Manager protection applies per membership row, not per
  person).
- `UserManagement.tsx` — Deactivate/Reactivate now live here instead
  (Admin-only, whole-account, via the Status column/button and the edit
  modal's Status dropdown), and are now **actually wired to the database**
  for the first time. Found and fixed two pre-existing bugs along the way,
  both flagged in code comments: (1) the Status toggle button and the edit
  modal's Status dropdown were bound to `user.status`/`formData.status`, a
  field that doesn't exist on the `User` interface (only `active: boolean`
  does) — so neither ever had any real effect; (2) `handleToggleStatus` was
  local-React-state-only, never calling Supabase at all. Both fixed
  together since a genuinely functional Deactivate/Reactivate was the
  point of moving it here. **`handleDelete` on this same screen is a
  separate, still-unfixed, pre-existing no-op** (local-state-only, never
  calls the database) — deliberately NOT touched, since a real "Delete"
  raises its own design questions (hard-delete? cascade to every team/
  caregiver link?) well beyond this change's scope. Flagged in code and
  here rather than silently fixed or silently left undocumented.
- **A known, separate, pre-existing security gap, found while designing
  this — NOT fixed, deliberately**: migration 036 created a `team_members`
  RLS policy that lets ANY user whose GLOBAL `users.role` is
  admin/coach/manager manage (insert/update/delete) ANY `team_members` row
  for ANY team, completely unscoped to teams they actually belong to.
  Postgres OR's every applicable RLS policy together, so a new, narrower
  policy cannot take that access back — it's why `remove-team-member` had
  to be a privileged Edge Function rather than "just add an RLS policy."
  This pre-existing looseness also still applies to `roles-api.ts`'s
  plain `addTeamMember`/`updateTeamMemberRole`/`removeTeamMember` (used by
  `UserManagement.tsx`'s own team-assignment UI), which were left as-is.
  **Worth a dedicated look in a future session** — narrowing it risks
  breaking those other flows, so it wasn't attempted here.

Original design discussion, kept for context on what was decided and why:

Came up live: once an existing account can be added to a role/team with
zero clicks (above), the repo owner asked what undoes a mistaken add. That
led to checking what today's "Deactivate" button actually does — it flips
`users.active` for the **whole account**, every team and role that person
has, not just one membership. Using it to undo a single mistaken add (e.g.
Daddy Pig wrongly added as a Player) would also kill his unrelated
caregiver access to George Pig. Too blunt for this purpose. Discussed and
decided, but **no code written yet**:

- New **"Remove"** action, distinct from Deactivate, scoped to exactly one
  `(person, role, team)` association — a **real delete** of that one
  `team_members` row (or `player_caregivers` link for a caregiver role),
  same semantics as caregiver removal already has (migration 062/063), not
  a soft flag. No roster-table trace afterward; any audit trail is
  whatever gets logged to `admin_action_items`, same as caregiver removal.
- **Visibility**: any user sees "Remove" on their **own** row(s) — self-
  removal from a role they hold on that team. A Coach/Manager/Admin sees
  "Remove" on **every** row (no tiering between Coach/Manager/Admin for
  this) — **except** the team's very first Manager, who can only remove
  *themselves*, not be removed by anyone else. (External League teams stay
  fully read-only for everyone as always, so this never applies there —
  also sidesteps the "bulk-imported league teams may have no clear first
  Manager" edge case the repo owner flagged.) "First Manager" isn't stored
  anywhere today — needs deriving (earliest `team_members` row with
  `role = 'manager'` for that team, by `created_at`) or a new column, for
  `club_tournament` teams only.
- Removing a **child Player** row cascades to automatically remove that
  child's linked caregiver(s) too (no orphaned caregiver link with no
  child).
- An adult-band (16+) player additionally sees "Remove" for their own
  linked caregiver(s) specifically — this **is** the already-shipped
  "Remove My Caregiver" feature (migration 062), just reframed as part of
  this same unified action set rather than a one-off.
- Two-step confirm (click, then a confirmation modal) for every one of
  these — same UX pattern as the existing "Remove My Caregiver" modal.
- **Deactivate/Reactivate move off the Team roster page entirely** —
  become Admin-only, on a separate Admin Users screen (possibly
  `pages/desktop/UserManagement.tsx` — not yet checked whether that
  already has something to extend), for genuinely disabling someone's
  whole account everywhere. Distinct purpose from "Remove."

Built this session (see "BUILT, NOT YET LIVE-TESTED" summary above) —
delivered as its own follow-up patch after item 6's zero-click bug was
resolved and confirmed live.

## ✅ Add Player / DOB Age Model — FULLY BUILT, APPLIED & DEPLOYED (2026-08-21; UX follow-up 2026-08-25)

All 13 tasks of the `.kiro/specs/add-player-and-dob-age-model/` spec are
done. Built across a long autonomous session (delivered as a chain of 7
git-am-able patches — Task 1, Tasks 2-3, Task 5, Tasks 6-7, Task 9, Task 10,
Task 11, Task 12, Task 13 — each independently verified via `git am` on a
clean clone, `npm test`, and `npm run build` before delivery), then applied,
pushed to `origin/prototype`, and deployed in this same session. **Nothing
outstanding on this spec.**

**What shipped:**
- **Unified "Add Player" entry point** replaces "Add Junior" on the Team
  page (`AddPlayerModal.tsx`, `AddJuniorModal.tsx` deleted) — same
  Coach/Manager/Admin + Club-Tournament-only gating as before.
- **DOB-based age classification** (16+ = adult) instead of relying only on
  `teams.age_group`. Falls back to the team's age group only when no DOB is
  recorded for that person — per-person, not per-team. This is the change
  that supersedes the "no DOB field" decisions recorded later in this file.
- **Adult path** reuses the existing invite mechanism. The DOB entered by
  the Manager/Coach adding them is provisional routing only — the invitee
  **self-declares their own DOB** when redeeming the invite, and that
  self-declaration is the record of truth. An under-16 self-declaration is
  rejected server-side with a message telling the Manager to redo it as a
  Junior instead — deliberately not duplicated client-side, so there's one
  source of truth for the age rule.
- **Junior path** — when the caregiver's account doesn't exist yet, a
  **Caregiver invite** is generated (instead of the old immediate-link-only
  path); redeeming it never auto-approves the pending request — double
  opt-in stays two separate acts, same as the existing add-a-junior consent
  model documented later in this file.
- **Caregiver-team affiliation stays derived, never stored** (joins
  `player_caregivers` against the child's `team_members` row) — this is why
  the new Approvals nav tab is **not gated by `users.role`**: the same
  person can be Admin/Coach/Manager and a caregiver of their own child at
  the same time.
- **The long-standing "no nav link to Caregiver Approvals" gap is fixed.**
  A new bottom-nav "Approvals" tab appears (with an exact pending-count
  badge) whenever a user has a pending caregiver approval, for any role. A
  failed pending-count fetch just hides the tab rather than blocking
  navigation. This closes the follow-up first noted 2026-08-20 under V1.4/
  TASK 1 and repeated in the "Known issues" section near the end of this
  file — both of those notes can now be read as historical/resolved.
- **Invite redemption's Success Screen** routes straight to
  `/caregiver-approvals` when the server signals a pending approval, instead
  of the normal post-registration destination.

**Applied & deployed this session (2026-08-21):**
- All 7 patches applied via `git am` on the Snapdragon laptop
  (`C:\Users\miker\WCR-Football-App`), pushed to `origin/prototype`
  (`8a0415a..6286a19`).
- Both changed Edge Functions redeployed: `create-auth-user` (gained
  `date_of_birth`) and `redeem-invite` (adult self-declaration + caregiver
  invite handling).
- **Live-testing started 2026-08-25 — both Adult and Junior paths confirmed
  end to end, two real UX gaps found and fixed same day:**
  1. Adult self-registration made the invitee retype name and email from
     scratch even though the Manager already had both — fixed (name
     prefills editable, email locks read-only, DOB deliberately untouched;
     migration 054), then a small caption added mid-test explaining the
     prefill. Confirmed live: name prefilled and was correctable (caught a
     real typo — "Thimas" → "Thomas" — that the Manager had made), email
     locked correctly, DOB stayed blank and had to be typed fresh, account
     created successfully with the *corrected* name.
  2. Junior/caregiver path: confirmed DOB-based routing to the caregiver
     fields works, and confirmed the **existing-caregiver-account branch**
     (caregiver email already has an account) links immediately and creates
     a pending approval — no invite email in that branch, just a
     notification, so the name-prefill fix doesn't apply there (only the
     new-caregiver-invite branch generates an invite code). Testing this
     surfaced a second, more important gap: the Approve/Deny screen never
     showed the child's DOB and gave no way to correct the name or DOB the
     Manager had entered — fixed same day, see the "Caregiver Approve/Deny"
     entry in `CHANGELOG.md`.

  Full detail on both fixes: `CHANGELOG.md`, the two 2026-08-25 entries.

  **Two decisions deliberately parked, coming back to them soon — named so
  they're easy to find again:**

  **Parked Decision 1 — "Caregiver DOB Correction Threshold." STILL OPEN
  (re-checked 2026-08-27) — distinct from, and not resolved by, the
  Streamlined Invites & Child Account Access spec above.** No
  age-threshold check exists for a caregiver-corrected DOB on the Approve
  screen — nothing currently stops a caregiver "correcting" a child's DOB to
  something that would actually make them 16+, and it would still go
  through as a Junior. **Confirmed this is a different gap from the new
  spec's Section 6.2**: 6.2 only fires at initial redemption, before any
  `caregiver_approvals`/child row exists. This decision is about the
  *later* Approve-screen correction, in `respond-junior-approval`'s
  `date_of_birth` field — that function's `isPlausibleDate` check
  deliberately only validates "a real, non-future date," nothing about
  age, by design as of when it was written. Needs a real decision on what
  should happen then (reject like the Adult under-16 case does, redirect
  to the Adult path, something else) — not a silent addition.

  **Parked Decision 2 — "Existing-User Invite Shortcut." RESOLVED
  2026-08-26** — built as Requirement 2 / Task 4 of the Streamlined
  Invites & Child Account Access spec above (`check-invite-recipient`
  Edge Function + a "You already have an account" redemption screen).
  Final live confirmation across all three call sites named below is part
  of that spec's Task 12 manual test pass, in progress. Original write-up
  kept for context. Found
  2026-08-25 while testing a Club Admin setting up a new team and naming an
  already-verified user as Manager: any invite path (Add Player adult,
  competition team setup, a caregiver without an existing link) that emails
  someone who **already has a real account** still sends them through the
  full "Create your account" self-registration form — name, password, DOB,
  privacy checkbox, all of it — even though every one of those values gets
  silently discarded server-side once `redeem-invite` recognises the email
  already belongs to a real account (confirmed in `redeem-invite/index.ts`,
  step 3.1: it just adds them to the new team, nothing else). Not a data
  risk or a security bug — the server-side behaviour is already correct and
  safe — but it is pointless, confusing busywork for someone who's already
  a verified member, and it's the same shape of gap the caregiver-reuse
  branch (Requirement 4.4) already solves for its own path — just not
  applied anywhere else.
  Real fix needs: a small, code-scoped server check the redemption page can
  call *before* rendering the form (today nothing tells the client "this
  invite's email already has an account" until deep in server logic, way
  past the point the form was already filled in), then a genuinely simpler
  "You already have an account — click to join {team} as {role}" screen for
  that case, with no name/password/DOB fields at all. Bigger than a
  one-line tweak — a new server-side check plus a real UI branch in
  `LiteLandingPage.tsx`.

  **Status as of 2026-08-27: Decision 2 done; Decision 1 is the one
  outstanding item before considering both this spec and its follow-on
  fully closed.**

  **Still to do this same session**: exercise the under-16 self-declaration
  rejection message on the Adult path at least once, and test Deny (never
  exercised in any session so far — only Approve has been).

---

## 🟢 V1.1a Progress — Android Device Testing (updated 2026-08-19, Kiro Web session)

**Working on the Snapdragon laptop (the "other laptop") via Kiro Web.**
**The app is RUNNING on the Oppo phone. WebView question answered: YES it works.**

### ✅ Completed (all done 2026-08-19)
- Node.js v24.19.0 — verified working
- Git for Windows — verified working
- Android Studio Quail — installed, Gradle sync complete
- Oppo CPH2477 — Developer Mode enabled, USB Debugging on, detected by Studio
- Repo cloned, `npm install` done, `.env.development` copied, built, synced
- **App runs on device** — login works, navigation works, UI renders correctly
- **Push notification permission** — auto-granted (Android 13+, fresh USB install)
- **FCM token received** — `cwfMAUmgQVqiTktxNjRDqd:APA91bF...`
- **Device token stored in Supabase** — confirmed in Logcat: "Device token registered for push notifications"
- **Data loads correctly** — teams, games, messaging threads (4 active) all fetch

### ⚠️ Gotchas encountered this session
- **Blank white screen on first run** — caused by `npm run build` using production
  mode which reads `.env.production` not `.env.development`. Fix: `copy .env.development .env`
  then rebuild. **Always copy as `.env` too** (or use `.env.production` for the
  Capacitor build).
- **Don't upgrade AGP or Gradle** when prompted by Android Studio — dismiss those
  popups. The project works as-is.
- **Oppo Build Number** is under Settings → About Device → (look inside for
  Build Number, may be one level deeper under Version/Version Info).
- Oppo build identifier: `CPH2477_11_A_5.5`

### 🔲 Next steps — PUSH NOTIFICATION END-TO-END TEST

The app is running and the token is registered, but we haven't yet confirmed a
push notification actually **arrives** on the Oppo. The issue is:

**Problem: Can't test push between two users because they're on different teams.**

- Mike (admin, `mikerbrooke@outlook.com`, on Oppo) is in **U9 Lithium** (`16f292bb-02f2-4da3-9e76-4a4cd5b3168f`)
- Mikey (test, `mandcbrooke1@gmail.com`, on other phone) is in **riverhead tests** (`d7b3943a-...`)
- The messaging context only fetches threads for teams the user is a `team_members`
  member of — even for admins. So they can't see each other's threads or message
  each other.

**Fix to unblock the test (pick one):**

Option A — Add Mikey to U9 Lithium (quickest, run in Supabase SQL Editor):
```sql
INSERT INTO team_members (user_id, team_id, role)
VALUES ('72d19061-63fd-4c6d-8770-a8c8393cd693', '16f292bb-02f2-4da3-9e76-4a4cd5b3168f', 'player')
ON CONFLICT DO NOTHING;
```
Then refresh both apps — they should see each other in messaging. Send from
Mikey → Mike to test push delivery to the Oppo.

Option B — Log in as another user who is already in U9 Lithium on the other
phone. Check `team_members` for other users in that team.

**V1.1a verification checklist:**
1. ✅ App installs on device
2. ✅ WebView renders correctly
3. ✅ Login works
4. ✅ Navigation works
5. ✅ Push permission granted
6. ✅ FCM token received and stored
7. ✅ Data loads (teams, games, messaging)
8. ✅ **Push notification arrives with sound + vibration — confirmed live on
   the Oppo, phone locked.** Root-caused and fixed this session (see below).
   Foreground toast and tap-to-open also confirmed live (see below).
9. ✅ Safe-area / notch handling added (`viewport-fit=cover` +
   `.safe-area-top`/`.safe-area-bottom` in `theme.css`, applied to
   `MainLayout.tsx`'s header and bottom nav) — **confirmed live on the
   Oppo**, header/nav sit clear of the screen edges.
10. ✅ Bottom-nav touch targets enlarged to a `min-h-[48px]` tap area
    (Material's recommended minimum), icons/labels bumped up — **confirmed
    live on the Oppo**, tabs feel noticeably easier to hit.

**V1.1a is now fully closed out.** All 10 checklist items done and verified
live on the Oppo (CPH2477, Android 12, ColorOS 12.1).

### RESOLVED (2026-08-19) — Push arrived but silent (no sound/vibrate)

Two-part fix, confirmed end-to-end via Logcat with the Oppo's screen
**locked** — the correct real-world test. (Earlier attempts in this same
session were inconclusive because the app was still foregrounded or only
backgrounded-with-screen-on; Android suppresses system-level notification
display for a foregrounded app by design, regardless of app code, so that
never tested the real pipeline.)

**Part 1 — no notification channel declared at all.** Logcat showed:
`FirebaseMessaging: Missing Default Notification Channel metadata in
AndroidManifest. Default value will be used.` Without a declared default
channel, FCM posts to its own auto-created "Miscellaneous" channel at
`IMPORTANCE_LOW`, which is silent by design — a notification appeared on the
lock screen, but with no sound or vibration.
- Fix: `MainActivity.java` creates a `"messages"` channel at
  `IMPORTANCE_HIGH` in `onCreate()`; `AndroidManifest.xml` declares
  `com.google.firebase.messaging.default_notification_channel_id` pointing
  at it. Rebuilt + retested: the "Missing Default Notification Channel"
  warning was gone, and a notification appeared with **sound working** —
  but still no vibration.

**Part 2 — vibration still silent even with the channel fixed.** Checked
(and ruled out) the per-app channel vibration toggle in ColorOS notification
settings (was on), and phone-wide vibration settings (ring/silent vibrate
toggles — on, but those are call-specific, ColorOS has no separate
notification-vibration master toggle on this device). Root cause: the
`"messages"` channel only called `enableVibration(true)` without an explicit
vibration pattern, relying on Android's implicit default pattern — which
this device (ColorOS 12.1, Oppo A17/CPH2477) doesn't reliably supply.
Android notification channels are **immutable once created**, so this
couldn't be patched in place; the channel needed a new ID to pick up a
proper definition.
- Fix: bumped the channel ID to `"messages_v2"` in both files, and added an
  explicit `channel.setVibrationPattern(new long[]{0, 250, 250, 250})`
  rather than relying on the implicit default.

**Verified live, phone locked, 2026-08-19:** both sound and vibration now
fire correctly. Item 8 above is fully done.

### RESOLVED (2026-08-19, continued) — Foreground/tap handling, safe-area, touch targets

Closed out the remaining V1.1a checklist items in the same session, once
sound + vibration were confirmed:

- **Foreground + tap listeners added** to `usePushNotifications.ts`:
  `pushNotificationReceived` now shows an in-app toast (via `sonner`,
  `<Toaster />` mounted in `App.tsx`) with a "View" action when a push
  arrives while the app is open (previously showed nothing at all, since
  Android suppresses its own banner for a foregrounded app regardless of
  code). `pushNotificationActionPerformed` now navigates to `/messaging`
  when a delivered notification is tapped, via `router.navigate()` on the
  `createBrowserRouter` instance exported from `src/routes/index.tsx` (works
  outside React's tree, since the hook runs above `<RouterProvider>`). No
  per-thread deep link — the app only has one Messaging screen today, so
  every push routes there; a real per-thread link would need the
  `send-message-push` Edge Function to start sending a `data` payload
  (currently `notification`-only) and a per-thread route to exist, neither
  of which do yet. Noted as a future enhancement, not a blocker.
- **Safe-area (item 9)**: `index.html` viewport meta gained
  `viewport-fit=cover`; `src/styles/theme.css` gained `.safe-area-top` /
  `.safe-area-bottom` utilities (using `env(safe-area-inset-*)`, a no-op on
  devices without a notch/gesture-bar cutout); applied to the header and
  bottom nav in `src/layouts/MainLayout.tsx`. Turned out there was **no**
  safe-area handling anywhere in the layout actually in use — an unused
  legacy `src/app/components/MainLayout.tsx` referenced `safe-area-top`/
  `safe-area-bottom` classes, but they were never defined in CSS and that
  file isn't the one routed to.
- **Touch targets (item 10)**: bottom-nav tabs bumped from a ~40px
  shrink-wrapped tap area (16px icon + 9px label) to `min-h-[48px]`
  (Material's recommended minimum), icons to 20px, labels to 10px. Main
  content's bottom padding adjusted to match the taller nav plus its
  safe-area inset.
- `npm run build` verified clean after all of the above (no new
  TypeScript/build errors).

**Verified live on the Oppo, 2026-08-20:** foreground toast appears when a
push arrives while the app is open; tapping a delivered notification (app
backgrounded, not locked) opens straight to the Messaging page; header and
bottom nav sit clear of the screen edges; bottom-nav tabs feel easier to hit.
All four items fully done.

### Gotcha hit while verifying this session: stale build looked like a bug

First verification attempt showed no foreground toast and a notification tap
that didn't navigate anywhere — looked like the new listener code was
broken. It wasn't. `npx cap sync android` only copies whatever's already in
`dist/`; it doesn't run `npm run build` itself. The Oppo was running a build
from *before* tonight's `usePushNotifications.ts`/`App.tsx` changes, even
though `npx cap sync android` completed with no errors and Android Studio's
Gradle build succeeded — neither step will warn you if `dist/` is stale.
Confirmed via Logcat: the JS bundle filename running on-device
(`index-a0YP_yLY.js`) didn't match a fresh local build of the same commit
(`index-BpluvNrK.js`) — different content hash, so provably different code.
Fix: **always run `npm run build` immediately before `npx cap sync android`,
every time**, even if you built earlier in the same session. Worth treating
this as a standing rule for future device-testing rounds, not just this one.

### Known issue discovered: Messaging not admin-aware

The `MessagingContext.tsx` fetches threads by querying `team_members` for the
logged-in user's teams — even admins only see threads for teams they're explicitly
a member of. This means an admin can't message users on teams they're not a member
of. Not blocking V1.1a, but noted as a bug/limitation for the messaging feature.

Location: `src/contexts/MessagingContext.tsx` lines ~70–90.

### Environment on the Snapdragon laptop
- Repo location: `C:\Users\miker\WCR-Football-App`
- Branch: `prototype`
- Disk free: 341 GB (plenty)
- `.env` AND `.env.development` both present in repo root
- Android Studio has the project open, Oppo CPH2477 connected via USB

---

## 🔴 V1.M Messaging — "send to Admins" not delivered (captured 2026-08-19)

**The bug — a message sent TO the Admin group is not received by an admin.**
- Repro: Mikey (manager) used the messaging page's "send a message to Admins"
  option and sent a message. Mike (`mikerbrooke@outlook.com`, an admin) never
  received it.
- Expected: a message addressed to the Admins group reaches admin users. Sending
  to admins is a needed capability (a manager/caregiver escalating to the club),
  so this is a bug.

**Design clarification (2026-08-19) — this is NOT about admins seeing all teams.**
An earlier note framed a second "admins can't see all team threads" bug. Mike has
confirmed that is **correct by design, not a bug**: an admin does not browse or go
looking for a team's threads. An admin only receives messages sent **to them
personally** or **to the Admin group**. So the team-scoped thread fetch in
`MessagingContext.tsx` is intended behaviour and should stay. The only defect is
Admin-group delivery.

**CONFIRMED ROOT CAUSE (2026-08-19) — it's a schema gap, not a delivery bug.**
Live error on send-to-Club-Admin: `invalid input syntax for type uuid: ""`.
- `messagingApi.createMessage` inserts `team_id: payload.team_id`. A "Club Admin"
  message has no team, so the compose screen passes `team_id: ""` → empty string
  into a uuid column → the error. (`src/lib/messaging-api.ts`, `createMessage`.)
- The deeper problem: `messages.team_id` is `uuid **NOT NULL** references
  teams(id)` (migration 033), and **all** messaging RLS is team-scoped
  (`team_members.team_id = messages.team_id`). So a teamless message can't be
  stored *or* read as things stand. Coercing `""` → `null` does NOT fix it (NOT
  NULL rejects it; and RLS would hide it anyway).
- `resolveRecipients('club_admin')` is fine — it correctly returns admin user ids.
  The message row just can't exist without a team. So **`club_admin` (and any
  cross-team `individual`) targeting is unsupported by the data model** even
  though the targeting types exist in code.

**Fix shape (a small build, not a one-liner):**
1. Migration: make `messages.team_id` **nullable** (a club-admin / cross-team
   message has no team).
2. RLS: add read/write policies for teamless messages keyed off
   `message_recipients.recipient_user_ids` (already stores the resolved ids) plus
   the sender — so an admin-targeted message is readable by its recipients without
   a team, without loosening the existing team-scoped rules.
3. `createMessage`: pass `team_id: payload.team_id || null`.
4. Confirm the `send-message-push` trigger/Edge Function handles a teamless
   message (it currently keys off team context — check migration 042 path).
5. Re-test send-to-Club-Admin end to end, including the push.

**Not a V1.1a blocker.** V1.1a's push test does **not** need club-admin — use a
normal U9 Lithium team message (Mikey is now a manager there). See below.

---

## TODO — Club logo in club_settings (V1.4 follow-up)

`club_settings` was seeded on 2026-08-18 with club name (`West Coast Rangers
FC`), primary colour (`#0091f3`), and app URL (`https://clubfootball.app`), but
**`logo_url` is NULL**. The app logo is currently a *bundled asset* (hashed
filename that changes each build), so there's no stable URL to point at.

To light up the logo on the post-registration Success Screen (and any future
`useClubBranding()` consumer):
1. Upload the WCR logo to a **public Supabase Storage bucket** (stable URL).
2. `UPDATE public.club_settings SET logo_url = '<public-url>', updated_at = now() WHERE id = true;`

Until then the Success Screen omits the logo cleanly (by design — no broken
image). This is cosmetic, not blocking.

---

## ✅ V1.4 + V1.5 — built & deployed (2026-08-18)

**V1.4 (post-registration-welcome-and-team-page) and V1.5 (role-aware nav) are
both built and live on clubfootball.app.** Frontend deployed at
`prototype@01d41fd`; migrations 046–051 (+ the 045b `caregiver_approvals`
backfill) applied; Edge Functions `redeem-invite`, `send-email`,
`create-auth-user` deployed.

### Verified working in the smoke test
- **Home "Teams" count fix (Finding A)** — player/manager sees their own team
  count, not the club-wide count. ✅
- **Team page (`/team`)** — loads the team, shows the roster, Add Junior modal
  opens. ✅
- **Manager on redemption (Finding B)** — the "Add Tournament Team" manager
  invite sets `intended_role = 'manager'` and redemption grants Manager. ✅
- **club_settings** seeded (name/colour/app_url; logo_url still null).

### V1.5 role-aware nav — DONE this session
Replaced the old crude `hasFullVersion`/`hasLiteVersion` (3-vs-6) split in
`src/layouts/MainLayout.tsx` with a **per-role tab list driven by App_Role**
(user_type is irrelevant — a lite manager sees the Manager nav). Max 6 tabs:
- Player / Caregiver: Home · Team · Schedule · Messages (4)
- Manager: Home · Team · Games · Schedule · Messages (5)
- Coach / Admin: Home · Team · Coaching · Games · Schedule · Messages (6)

Decisions locked: Coaching = Coach/Admin only; Games = Manager/Coach/Admin (its
coach-only feedback section gated inside the page); **Resources moved off the
bottom bar to a card on Home** (route opened to all roles); the **Team tab uses
the freed Resources purple `#8b5cf6`**, sitting 2nd after Home. This resolves
**Open Decision 4** (the two undecided nav slots).

### ⚠️ Gotcha that cost time: stale bundle / cache
`/team` first showed "not a member of any team" though the data was correct — it
was a **stale cached bundle**; incognito showed it fine. RLS was NOT the problem
(a `Members can read their teams` SELECT policy already exists on `teams`).
**After any deploy, hard-refresh / use incognito before assuming a bug.**

### ⚠️ New gotcha (2026-08-27): "not deploying" can mean Netlify ran out of
### credits, not a cache problem
A run of same-day pushes (Task 11, Add Player/Success Screen copy, the
Announcements crash fix) looked identical live for hours after each push —
same error, same hashed JS filename every time — which normally screams
"stale cache." This time it wasn't: Netlify's dashboard showed **"running
on operational credits... production deploys paused"** — the team's
monthly deploy-credit allowance was fully used up, so GitHub pushes were
landing correctly but nothing was actually building or publishing. Full
write-up and the "how to tell the difference" check (compare the JS bundle
hash across a hard refresh, incognito, *and* a different device — if it's
still identical everywhere, it's not caching) is in `CLAUDE.md`'s new
"Frontend deploys" section. Fix is a billing action on the repo owner's
Netlify account (add credits / upgrade / wait for the monthly reset), not
anything fixable in a coding session.

### Still open to fully close V1.4
1. **Finish the smoke test** — the one flow not yet exercised end-to-end is
   **add-a-junior consent**: submit modal → caregiver approval email → approve →
   child activates on the roster. Highest-value remaining check (hits the
   recovered `caregiver_approvals` table + RLS).
2. **Verify the new nav on device** — confirm each role sees the right tabs and
   the Resources-on-Home card works (hard-refresh first).
3. **Logo** — set `club_settings.logo_url` once the WCR logo is hosted (see the
   logo TODO above).
4. **32 optional tests** — property/unit/integration; prioritise task **10.6**
   integration tests (manager-cap trigger, RLS, add-junior writes).

### Reference IDs / accounts (test data)
- **mikey Brooo** (mobile test login, `mandcbrooke1@gmail.com`):
  user_id `72d19061-63fd-4c6d-8770-a8c8393cd693`, profile role `manager`.
  Member of **riverhead tests** (Open), team_id
  `d7b3943a-1f5a-4088-97f0-198353edf56d`, team role now `manager` (corrected via
  a manual UPDATE this session).
- **Mike Brooke** (`mikerbrooke@outlook.com`) = the admin account
  (`ad7b7dfa-…`), coach of U9 Lithium.

### Migration 036 recovery (important context)
Applying migration 051 failed with `caregiver_approvals does not exist`.
Migration 036 had only been **partially applied** in production long ago — its
`caregiver_approvals` table (036 §6) was never created. We re-created it via
`supabase/migrations/045b_caregiver_approvals_backfill.sql` (idempotent) ahead of
051, then applied 046–051. All good now, but be aware other bits of very old
migrations *could* also be partially applied — verify with `pg_policies` /
`information_schema` before assuming.

### Git state
All work pushed to `kiro prototype` and deployed (`prototype@01d41fd`, 2026-08-18):
the V1.4 feature, the migration recovery, the V1.5 nav rework, and the doc
updates. Working tree clean.

---

## Quick Reference

**App URL**: https://clubfootball.app  *(live 2026-08-14 — the old
`wcrfootball.netlify.app` still works but this is the one to use)*
**Branch**: `prototype`
**Single remote (`origin`), push here every time**:
```bash
git push origin prototype
```
*(Corrected 2026-08-25 — this previously said remote `kiro`, which no
longer exists; the checked-out repo only has `origin`, confirmed working
all through the Add Player / DOB age model session. As of 2026-08-13, the
old dual-remote setup is retired — see `docs/deployment/DEPLOYMENT-GUIDE.md`.)*

**Deploys lag your browser cache.** After any push, hard-refresh
(Ctrl+Shift+R) before concluding something is broken. This has already
cost time twice.

---

## Strategic Context

The app has a lot of functionality built, arguably progressed faster than
real-world usage. Decision made 2026-08-13: **stop expanding features,
focus on getting V1 usable by real coaches/managers/families.**

Two things drove this:
1. Reviewed against Heja (the main competition) — the critical gaps are
   **RSVP/availability** and **push notifications**. Without these it
   isn't a credible Heja replacement no matter what else exists.
2. A web app isn't taken seriously as "a real app" by families — it needs
   App Store / Google Play distribution with working push. Decided on
   **Capacitor** wrapping the existing React/Vite app, **Firebase Cloud
   Messaging** for push.

**Launch approach (updated 2026-08-14): soft launch, no hard deadline.**
When the build is ready, pick the next available competition and trial it
with a few people. The earlier formal "10-week trial with <20 teams"
structure from `docs/project/PROJECT-ROLLOUT.md` has been superseded —
that document is now historical context, not the plan.

Junior coaching content (10 weeks) is already loaded and is fine as-is.

Full Capacitor scoping: `docs/project/CAPACITOR-SCOPING.md`

---

## V1 — Where Things Stand (updated 2026-08-31 evening)

One-line status per item. Detail is in the sections further down.

| Item | Status | What's left |
|------|--------|-------------|
| V1.0 Product domain | ✅ DONE | — |
| V1.1 Capacitor + push | ✅ DONE | — |
| V1.1a Android testing | ✅ DONE | — |
| V1.1b iOS testing | ⬜ Blocked | Needs a borrowed Mac + Xcode |
| V1.2 Email service | ✅ DONE | — |
| V1.3 Self-registration fix | ✅ DONE | 3 small follow-ups |
| V1.4 Welcome + Team page | ✅ DONE | Logo; 32 optional tests |
| Add Player / DOB age model | ✅ DONE | "Caregiver DOB Correction Threshold" decision still open |
| **Streamlined Invites & Child Account Access (Task 12)** | ✅ **Fully closed, 2026-09-01** | All 6 test sections fully confirmed live, including both migration-063 admin-review trigger firing (twice, independently) and the Competitions page assign-existing-Manager path (confirmed via a real "Open huapai demons" tournament team, timestamp `2026-09-01 22:25:47`). One new cosmetic bug found on the way: the confirmation email's header banner shows the wrong team name — see Task 12 item 6 write-up |
| **Roster "Remove" action** (new, surfaced from Task 12 item 6) | ✅ **Fully done, 2026-09-01** | Self-removal, the caregiver cascade (both directions), first-Manager protection, multi-team removal, and a plain Coach doing the removing — all confirmed live. Nothing left outstanding |
| V1.5 Role-aware nav | ✅ DONE | — |
| V1.6 Invite page branding | ⬜ Not started | Independent |
| V1.7 RSVP / availability | 🟠 Mostly built | RSVP reminder pushes; caregiver multi-child RSVP build (design already agreed) |
| V1.8 Admin console correctness pass | 🟠 Scoped 2026-09-04, not built | Redefined (was "feature flags"). Reporting is moving to V2 (hidden at launch, see V2.8). V1.8 is now working through the remaining admin tabs to make them correct — see the detailed "V1.8 — Admin console correctness pass" section below |
| V1.M Messaging — send to Admins | ✅ **Fixed 2026-09-04 (migration 075 run), send confirmed live** | Root cause was two coupled things: (1) "Club Admin" messages are team-less but `messages.team_id` was NOT NULL and the compose form only auto-fills a team when you're on exactly one — so a multi-team admin sent an empty `team_id` and the insert was rejected (the "nothing happens" repro); (2) the inbox query keyed on team membership, so a team-less admin message wouldn't appear anyway. Fix (migration `075_messages_admin_inbox.sql` + client): `team_id` nullable, INSERT policy allows a team-less message from any authenticated user (contact-the-club path), a `SECURITY DEFINER` `message_thread_root_sender()` helper drives a SELECT clause so the thread's original sender sees admin replies (no recursion — the mig-035 trap), compose sends `team_id: null` for Club Admin, and `getThreads` now includes team-less threads. Confirmed live on localhost against the migrated DB: sending to Club Admin resolved to all 6 admins and appeared in the shared inbox. **Still to verify with a second account:** a non-admin sender seeing an admin's reply (the root-sender SELECT clause) — mechanism built, not yet live-tested end to end |
| **V1.R Part 1 — Role model & RLS fix** | ✅ **Fully done, live-verified, 2026-09-02** | Make Coach, Stop being Coach, Demote (incl. first-Manager protection both directions), the role-sync trigger + its Coaching-tab follow-up fix, and the caregiver-floor invariant all confirmed live. Nothing outstanding. Surfaced one new, separate, not-yet-fixed bug: "Manage Caregivers" visibility uses the team's age band instead of the person's own — see V1.R's write-up |
| V1.R Part 2 — Automated data retention & deletion | ⬜ Deferred, own future spec | Competition cleanup clocks, the 12-month "no role" user-deletion job, de-identified performance data, pre-deletion notice/export. Nothing blocks on it today — scoping notes live in `docs/data-retention-scoping.md`, untouched |
| V1.9 Store + privacy policy | 🟠 Rewrite now confirmed required | Gate before store submission — the child-account model is live now, not hypothetical. Depends on V1.R's retention decisions locking first. `club_settings.app_url` still needs the real store listing at go-live |
| V1.T Friendly Manager import | ⬜ Blocked | Waiting on a CSV export sample |
| **Two pre-existing bugs found building Gant (2026-09-03)** | 🟠 One fixed, one still open | (1) `teams-api.ts` line 168: a genuine TS type error (missing `is_coach` on `TeamMemberWithTeam`), invisible to `npm run build` since Vite doesn't type-check — confirmed via `git diff` unrelated to the Gant build. **Still open** — not yet fixed. (2) ✅ **Fixed 2026-09-03, live-confirmed by the repo owner**: `ProtectedRoute` was redirecting a coach-authority Manager/Admin away from `/coaching`/`/ai-coach` the moment they tapped the tab, despite correctly seeing it in nav — it now mirrors `tabsForRole`'s exact `hasCoachAuthorityOnAnyTeam` check (via `user.teamMemberships`), gated only when COACH is an allowed role so no other route is affected |
| **Four Gant bugs found + fixed live-testing, same session (2026-09-03)** | ✅ **Fixed and live-verified** | (1) Tick/Save failed silently: `game_feedback.game_id` is a required FK to `events`, but capture never creates one — `approve()` now creates a minimal ad-hoc `general` event on the fly. (2) The failure in (1) was invisible because `GantReviewModal`/`GantCaptureSheet` only reported errors to a page-level banner sitting BEHIND their own full-screen modal — both now always show an inline error too. (3) A second RLS gap surfaced once (1) was fixed: `gant_outcomes`' insert-then-return pattern needs a SELECT policy for the resolver, not just admins — migration 074, run and confirmed. (4) The real functional bug: a further "Work on" round had no memory of Gant's own prior response, so it read as two disconnected fragments and could regress into asking basic clarifying questions (incl. asking the team's age group, which is already-known data) even after a genuinely good first draft. Fixed by passing `priorResponse` (Gant's latest output, always current across any number of rounds) and `ageGroup` through on every call — live-verified with a 3-round conversation that correctly built on itself each time. See `.kiro/specs/gant-ai-feedback-assistant/tasks.md`'s "Live bugs found and fixed" section for full detail and verification scripts |
| **Second Gant live-test batch — UX polish + 1 more save bug (2026-09-03)** | ✅ **Fixed, build + tests clean; awaiting repo owner hard-refresh re-test** | Client-side only, no Edge Function redeploy. (5) Latent Save bug that would have defeated bug-(1)'s fix in the real UI: `handleTick` passed `entry.event_id ?? entry.id` — `entry.id` is a `gant_pending_entries` id, not an `events` id, and its truthiness made `approve()` skip the ad-hoc-event creation and insert `game_feedback` with a bogus `game_id` (FK violation on a writable team; RLS error on one you can't write to — exactly the "violates RLS for game_feedback" the owner hit). Now passes `entry.event_id ?? undefined`. (6) Progress Notes team picker offered caregiver-only teams via `getMyTeams`; new `getMyCoachingTeams` returns write-authority teams only (coach/manager/`is_coach`) and the pending queue uses it. (7) `GantCaptureSheet` rewrite: "Done"→"Close", persistent captured-count banner (was a 1.5s fade that looked like a no-op), up-front helper copy, inline discard-confirm when closing with un-captured text. (8) Review screen: when "Add more" has unsaved text, Save is HIDDEN and "Work on" is emphasised (saving would silently discard the addition). (9) Coaching + Games dropdowns now dedupe teams by id (a coach who is also a caregiver on the same team saw it listed twice). Full detail: tasks.md "Second live-test batch" |

**Substantive build work left for V1, in the agreed order** (updated 2026-09-01):
1. ~~Two quick verification loose ends~~ — ✅ **done, 2026-09-01**: both the
   migration-063 trigger and the Competitions assign-existing-Manager path
   are confirmed live. One small new item fell out of this: the
   assign-existing-Manager confirmation email has a header/body team-name
   mismatch bug (cosmetic, not yet fixed — see Task 12 item 6 write-up).
2. ~~Two minor untested Remove variants~~ — ✅ **both done, 2026-09-01**:
   multi-team removal (confirmed the caregiver link is correctly left
   alone when it's NOT the child's last team; also surfaced a data-hygiene
   gap, see the Remove-action write-up) and a plain Coach removing someone
   else (confirmed identical behaviour to a Manager).
3. ~~V1.R Part 1 — role model & RLS fix~~ — ✅ **fully done and
   live-verified, 2026-09-02.** Built, pushed (`v1r-part1.patch` +
   a same-day follow-up patch for the Coaching-tab gap), all 4 migrations
   run, and every piece confirmed live: Make Coach (both a plain Player
   and a Manager gaining Coach authority), Stop being Coach, Demote to
   Player, first-Manager protection on Demote (checked both directions),
   and the child-caregiver-floor block. Surfaced one new, separate,
   not-yet-fixed bug along the way — see the write-up in V1.R's section
   ("Manage Caregivers" uses the team's age band instead of the person's
   own). Part 2 (automated data retention/deletion) stays deferred to its
   own future spec — nothing blocks on it today.
4. **New, small: fix "Manage Caregivers"/"Add Caregiver" visibility to use
   the person's own age band, not the team's.** Found live-testing V1.R
   Part 1's caregiver-floor check, 2026-09-02 — see V1.R's write-up for
   the full detail. `TeamPage.tsx`'s `isChildBandPlayerRow` checks
   `roster.ageBand === 'child'` (team-level) instead of the per-row
   `ageBandFor(...)` the contact display already uses correctly. Currently
   blocks caregiver management entirely for a real child registered on an
   Open/adult team. Small, well-understood fix, not yet built.
5. **"Caregiver DOB Correction Threshold" decision + build** (parked from
   the Add Player / DOB spec, still open).
6. V1.M "Send to Admins" messaging bug — worth doing alongside step 3
   given the conceptual overlap, even though it's a separate build.
7. **Privacy policy rewrite** for the now-live child-account model, plus
   re-examining the Play Console audience declaration — hard gate before
   store submission, depends on step 3's retention decisions locking.
8. V1.6 invite-page branding.
9. V1.7 caregiver multi-child RSVP build + reminder pushes.
10. V1.8 feature flags.
11. Small standalone polish item, not yet scheduled: `AddPlayerModal.tsx`'s
    `handleContinue` doesn't scroll to or surface a below-the-fold
    validation error — see Task 12 item 6 write-up. Repo owner hasn't yet
    said whether to fix now or queue.

Everything else (V1.1b iOS, V1.T Friendly Manager import) is blocked on
hardware or an external data export, not build work.

### Privacy + retention — the final combined V1 workstream (recorded 2026-09-04)

**Repo owner's explicit sequencing decision (2026-09-04):** privacy and data
retention are to be handled as ONE workstream, done *last*, only once all other
V1 functionality is complete. This deliberately supersedes treating them as
scattered items (Gant's Task 11, V1.9 store privacy rewrite, and V1.R Part 2
retention build are all folded into this single pass). The order within it:

1. **Revisit the privacy policy against everything actually built** — not the
   old draft in the abstract. Reconcile it with the now-live reality: child
   accounts + caregiver links, device-access codes, the streamlined invite
   flow, Progress Notes / Gant (User-ID-only to the AI, no audio transmitted,
   the short-lived `gant_pending_entries` surface, `gant_outcomes`,
   `gant_player_summaries`), game feedback, messaging, etc. Every data surface
   V1 introduced needs to be represented.
2. **Reconcile with V1.R Part 2 retention scoping** — `docs/data-retention-
   scoping.md` already holds the scoping notes (competition cleanup clocks, the
   12-month no-role user-deletion job, de-identified performance data,
   pre-deletion notice/export). Use it as the starting point.
3. **DEFINE the retention/deletion policy** — decide the actual rules (what is
   kept, for how long, what gets de-identified vs hard-deleted, notice/export
   before deletion). This is the decision step that everything else waits on.
4. **BUILD the retention/deletion management** — the jobs/tooling to enforce
   the policy (this is the V1.R Part 2 build, its own spec).
5. **Fold Gant's Task 11 privacy section in as part of the same pass** — it is
   no longer a standalone task; it's one input to step 1.

Rationale: the privacy policy can only be honest and complete once the feature
set is frozen, and the retention *build* can't start until the retention
*policy* is defined — so doing this last, as one connected piece, avoids
rewriting the policy repeatedly as features land. Hard gate before any store
submission.

**Gant V1 build status as of 2026-09-04 (context for the above):** Tasks 1–9 of
the `gant-ai-feedback-assistant` spec are built (1–7 live-verified; 8 & 9 built
and locally verified, held uncommitted per the repo owner's batch-commit
preference to limit Netlify rebuilds). Task 10 is the deliberately-deferred
V2/phase-2 backlog (nothing to build for V1). Task 11 = the privacy section,
now merged into the workstream above. Task 0 (coach guardrails refinement) is
the ongoing non-code loop, now enabled by the desktop admin screen (Task 8).

### V1.8 — Admin console correctness pass (scoped 2026-09-04)

**Redefined.** V1.8 was "feature flags"; it's now a correctness pass over the
desktop admin tabs. The only thing being flagged/hidden is **Reporting**, which
moves to **V2 (see V2.8)** — it's the biggest immature surface and not needed
for the trial. Everything else stays in V1, but several admin tabs need
functional work before launch. Desktop is confirmed **Admin-only for V1**, so
the sidebar's "Main/Admin" split is now purely visual grouping (kept as a
scanning aid, no permission meaning).

Scope (all found by the repo owner working through the live admin console
2026-09-04; **documented here, not yet built**):

1. **Reporting → hidden for V1, deferred to V2.8.** The 6-page suite stays in
   the codebase, just removed from the admin nav + routes at launch via a
   small `src/config/desktopFeatures.ts` flag (`reporting: false`) so it's a
   one-line re-enable in V2. (Done 2026-09-04 alongside this note.)

2. **Competitions vs Tournaments — needs clarification.** Two adjacent,
   identically-styled admin nav items with nothing telling you which does
   what. They're genuinely different (Competitions = create/edit a
   league/club-tournament entity and invite teams in — the *setup* side;
   Tournaments = view fixtures/standings for club-run tournaments — the *run*
   side). Decide clearer labels and/or short descriptions (not a merge). Open.

3. **Caregiver Reviews probably belongs under Users**, not as its own
   top-level admin tab. Consolidate the `admin-action-items` (Caregiver
   Reviews) surface into the Users area. Open.

4. **Teams page (admin) — several fixes.** This is the page that lists all
   teams and lets you select one to edit.
   - **Pending teams must be shown as pending.** Repo owner created a team
     yesterday and sent the invite to the manager — the manager hasn't
     accessed it yet, so it's effectively a *pending* team. The Competitions
     page already shows such a team with a "pending" state (under e.g. the
     Summer competition's team list), but the admin Teams page shows it
     identically to a live team. Fix: on the admin Teams page, a pending team
     should be **greyed out with a "Pending" stamp and the date the invite was
     sent** next to it. (Signal of pending = the invited manager hasn't
     accessed/accepted yet — reuse whatever the Competitions page already keys
     off.)
   - **Show the Manager, not just the Coach.** The teams list currently shows
     the coach but not the manager. Show both. If there are multiple coaches
     and/or managers, just show the first of each.
   - **Assign Manager belongs here.** The team-edit view (selecting a team on
     this page) is where an "Assign Manager" action should live/be captured.

**Next step for V1.8:** build items 2–4 (item 1 is done). To be picked up after
the repo owner's current priority, V1.M. Worth a dedicated Kiro spec given the
Teams-page work has real data-model/RLS surface (pending state, manager
display, assign-manager).

**Gant (AI coaching feedback assistant) — PULLED FORWARD AND BUILT INTO V1
(2026-09-04).** No longer "being considered" — it was accelerated ahead of its
V2 slot and the `gant-ai-feedback-assistant` spec Tasks 1–9 are built (see the
"Gant V1 build status" note just above, and the spec's `tasks.md`). Design docs
`docs/project/GANT-AI-REQUIREMENTS.md` and `GANT-COACH-GUARDRAILS-CONVERSATION-
GUIDE.md` remain the reference. The coach guardrails work (Task 0) is now an
ongoing refinement loop against the live admin screen rather than a pre-build
gate. Remaining Gant scope is V2/phase-2 only — see the refreshed V2.7 section
further down.

### PLAN FOR NEXT SESSION (updated 2026-08-30)

**Do first — deploy item 3's fix and confirm it live, then finish items
4-6.** Automated checks are already clean on the live head. Items 1 and 2
are both **✅ fully done**. Item 2 took 6 patches (`6dcc185..dc499b5`),
migration 059, both Edge Functions redeployed, migration 060 (an
undocumented live RLS policy blocked a caregiver from reading their
*active* linked child's team) plus a one-time data backfill, then an 8th
bug found testing a brand-new pair (George Pig / Daddy Pig): a caregiver
whose only linked child is still *pending* had no way to reach the team at
all — fixed via a `getMyTeams()` code change plus migration 061, with the
confusing leftover "Approvals" nav tab retired at the same time. All of it
run, applied, pushed (`cfa5660`), and confirmed working end-to-end live —
George's DOB persisted correctly on a completely fresh redemption with
zero backfill needed. A UX polish landed on the same pass too: the
Accept/Deny screen no longer re-asks for name/DOB the caregiver already
confirmed once at registration.

**Item 3 (6.1 bounce-back)** is now **✅ fully done, confirmed live**: the
happy-path bounce screen works, and live-testing's two follow-on gaps — a
bounced invite staying reusable forever, and the Manager never learning a
bounce happened — are both fixed in `redeem-invite/index.ts` (kill the
code on bounce by backdating `expires_at`; send the Manager an in-app
self-addressed message), deployed, and re-confirmed end-to-end with a
second fresh pair (Dewie Duck / West Coast Rangers): reopening a bounced
link now shows "Code Expired," and the Manager's Messages tab shows the
notification.

**Item 4 (6.2 conversion) is now ✅ redesigned, deployed, and confirmed
live.** The original "convert the redeemer into the player in place"
approach turned out to only work when the redeemer IS the subject (a
self-inviting 16-17 year old) — live-testing with a genuinely separate
caregiver (Goofy Dog / "Goofys mum") produced a mismatched-identity player
record instead. Product decision: stop guessing at redemption time
entirely. A Child-ticked registration now always proceeds as an ordinary
pending child regardless of declared DOB; a 16+ player instead gets a
self-service "Remove My Caregiver" action once they have their own login.
Migration 062 run, `redeem-invite` redeployed, and both halves live-tested
end-to-end with a fresh pair (Aella Dog / "Aella mum," DOB 16+): clean
pending-child registration with no conversion notice, mum approved
normally, device access issued, Aella signed in on her own device, saw and
used "Remove My Caregiver," and a direct DB query confirmed the
`player_caregivers` row was genuinely deleted. **One real gap found along
the way, not yet fixed live**: migration 056's caregiver-removal
`admin_action_items` trigger never actually existed on the live database
(confirmed via a direct `pg_trigger` query — same "migration file vs. live
drift" pattern as migrations 056/057 earlier), so no caregiver removal —
admin-initiated or self-service — has ever queued an admin review. **Fixed
and confirmed live 2026-08-31**: `063_restore_caregiver_removed_trigger.sql`
run in the Supabase SQL Editor, then re-verified with
`check-caregiver-removed-trigger-exists.sql` — now returns
`on_player_caregiver_removed`, enabled, matching migration 056's original
definition. Not yet exercised with an actual fresh removal to confirm an
`admin_action_items` row appears on the Caregiver Removal Reviews screen
end-to-end. Three UX polish items on "Issue Device Access" were also
captured but explicitly not built yet per the repo owner's own instruction
each time: bland button styling/unclear copy, no usage instructions on the
generated device link, and no Copy button next to it.

**Item 5 (device-code redemption + revocation) is now ✅ fully confirmed
live**, plus a real gap found, fixed, deployed, and two more UX polish
items landed along the way. Testing item 4 already exercised most of its
mechanism live: issuing Aella's device code, opening the link fresh in
another browser, and landing signed in as her with scoped child nav (script
steps 1-4) all worked. Re-testing the same link a second time was
explicitly re-checked and **confirmed correctly rejected** (one-time use,
steps 5-6). Trying to do the steps 7-8 revocation check (generate a
*second* device code, confirm the first session dies) surfaced that Aella's
caregiver "Aella mum" could no longer see "Issue Device Access" at all —
correct, since removing her caregiver is supposed to lose her that
visibility, but tracing it further found the button (and its Edge Function)
were gated **purely** on being a linked caregiver, with no Admin/Coach/
Manager fallback — meaning a 16+ player with zero caregivers could never be
issued a new code by anyone, a real lockout risk if they ever lose their
session. **Fixed and deployed**: new `canIssueDeviceAccess` in
`permissions-logic.ts` (same authority model as `canAddCaregiver` —
caregiver, OR Admin, OR Coach/Manager on the team) wired into
`TeamPage.tsx`, with the matching server-side fallback added to
`generate-device-code` and redeployed via `npx supabase functions deploy`.
With that live, **the actual steps 7-8 check was run and confirmed on a
fresh pair (George Pig / Daddy Pig)**: Daddy issued a second code and
George's first session was correctly signed out on the next load. Two more
long-parked UX polish items were built on request during this same live
pass: the device-link box now says explicitly to open the link on the
child's own device and has a Copy Link button; the button itself is now
labeled "Give App Access" instead of "Issue Device Access" (deliberately
not "Give your child app access," since Coach/Manager/Admin can trigger it
too now). **Only remaining loose end**: confirming a fresh caregiver
removal now actually queues an `admin_action_items` row (migration 063,
confirmed live above) — not yet exercised end-to-end.

**Item 6 (existing-user bypass)** is ✅ confirmed working live for its first
call site (Add Player, adult route — the Mortimer Mouse retest, correct
email this time). Second call site (assign-existing-Manager on
Competitions) still needs a live test; third (Add Caregiver) was already
correct before this work, per the earlier entry in `CHANGELOG.md`.

**Next up — first, deploy and live-test the new "Remove" roster action**
(built this session while the repo owner was away — see the "✅ BUILT, NOT
YET LIVE-TESTED" section above for the full list of what shipped and the
one cascade judgment call worth double-checking). Needs, in order: apply
the patch, `npx supabase functions deploy remove-team-member`, then a live
pass covering — a Manager removing a Coach; a Player removing themselves;
a Coach/Manager attempting to remove the team's first Manager (should be
refused); the first Manager removing themselves (should succeed); a child
Player's removal cascading to their caregiver link when it's their last
team, and NOT cascading when they're still on another team; and confirming
Deactivate/Reactivate on the Admin Users screen (`UserManagement.tsx`) now
actually persists to the database (previously silently didn't). **Then**
confirm migration 063's admin-queue effect with one more caregiver removal,
then finish item 6's second call site (assign-existing-Manager) — note the
existing-user-bypass path is also the one case that still shows editable
fields on Accept/Deny, worth confirming that still works right — report
results back so `tasks.md` can be closed out. Full detail: `CHANGELOG.md`'s
2026-08-28/29/30/31 entries, `task12-manual-test-script.md`,
`caregiver-invite-flow-fix-plan.md`. Once the Remove redesign and item 6's
last call site are both confirmed live, this is the only thing left on
that entire 12-task spec.

**Then — decide and build the one remaining parked decision** (dedicated
section near the top of this file): **"Caregiver DOB Correction
Threshold"** — nothing today stops a caregiver "correcting" a child's DOB
to 16+ on the Approve screen and it still going through as a Junior. Needs
a real decision first: reject it the way an under-16 Adult self-declaration
is rejected server-side, redirect the Manager to redo the person as an
Adult, or something else — then build it. (The other parked decision,
"Existing-User Invite Shortcut," is now built — see above.)

**Then — start the V1.9 privacy policy rewrite.** This just became urgent
rather than hypothetical: the child-account redesign that made the privacy
draft's assumptions stale is now actually shipped, not just designed.
Re-examine the Play Console audience declaration (Decision 3b) at the same
time — see the V1.9 section for the full gate checklist. Treat this as a
hard gate before store submission, not a parallel-track item that can slip.

**Then — finish the last bits of Add Player / DOB live-testing**: exercise
the under-16 self-declaration rejection message on the Adult path at least
once, and test Deny on a Junior/caregiver request (never exercised in any
session so far — only Approve has been, both for the original TASK 1 flow
and for this spec).

**Then, in rough priority order:**
1. **V1.M** — "Send to Admins" messaging bug (🔴, not yet root-caused).
2. **V1.6** — invite landing-page branding. Independent, easy wiring now
   that `club_settings` + `useClubBranding` exist.
3. **V1.7 RSVP** — caregiver multi-child RSVP build (design already agreed
   2026-08-20, see that section above) + RSVP reminder pushes. Resolve
   Decision 5 first.
4. **V1.8** — feature flags, once the trial group's needs are known.
5. **V1.R** — data retention & deletion scoping — gates the privacy policy
   (V1.9). Open decisions in `docs/data-retention-scoping.md`.
6. **Loose ends**: V1.4's logo + 32 optional tests, V1.3's 3 follow-ups,
   TASK 3's cheap modal sweep (below), and the app_url → real store listing
   swap noted under V1.9 (must happen before app-store go-live, easy to
   forget since nothing breaks if it isn't done).
7. **Worth doing periodically, not just once**: re-run the RLS
   migration-vs-live-state audit described in `CLAUDE.md` — two real gaps
   of this exact kind were found this session alone.

**Blocked, not actionable next session:** V1.1b iOS testing (needs a
borrowed Mac + Xcode), V1.T Friendly Manager import (waiting on a CSV
export sample from the club, Decision 6).

---

### Historical items, resolved (kept as one-line pointers only)

*The detailed write-ups these used to be lived here in triplicate — once
in a "plan," once in a "done" narrative, once in a "known issues"
recap — with none of them updated as things got fixed. All of that detail
already exists, correctly dated, in `CHANGELOG.md`. Pointers only, below.*

- **TASK 1 — add-a-junior RLS bug + the bigger roster gap behind it.**
  DONE & live-confirmed 2026-08-20. Full root-cause writeup:
  `CHANGELOG.md`, "2026-08-20 - Task 1: add-a-junior RLS fix, plus a bigger
  gap found behind it." One thing from it is still genuinely open, carried
  into "Loose ends" above: **the Deny and Escalate paths were never
  exercised** (only Approve was tested). The "no nav link to Caregiver
  Approvals" gap this surfaced is now fixed (Task 12 of Add Player / DOB,
  2026-08-21).
- **TASK 2 — finish the V1.4/V1.5 run-through** (post-registration success
  screen, contact display by age band). Done — both shipped as part of the
  V1.4 build itself (see the V1.4 section further down and its CHANGELOG
  entry); this was never a separate follow-up in practice.
- **TASK 3 — cheap modal sweep** (align other mobile modals to the
  Schedule pattern so they don't sit behind the bottom nav). Still open,
  low effort — carried into "Loose ends" above.

---

## V1 — Open Decisions Needed

These block or shape work below. Listed here so they don't stay buried.

| # | Decision | Blocks | Recommendation |
|---|----------|--------|----------------|
| 1 | ~~**Email provider** — Resend, SendGrid, Postmark, or AWS SES?~~ | V1.2 | **RESOLVED 2026-08-14** — Resend, live and sending. See V1.2 |
| 1b | **`EMAIL_REPLY_TO` is not set** — replies to invite emails bounce | Nothing, but affects deliverability and looks unpolished | Decide whether invites should be repliable, and which monitored address. See V1.2 |
| 8 | **Rate limiting on `redeem-invite`** — it's an unauthenticated endpoint that can create auth users; the invite code is the only authorization | Public launch, not the trial | Fine for a small trial. Needs a decision before wider release. See V1.3 |
| 2 | **Which events trigger a push in V1?** Candidates: new message (built), new schedule event, event change/cancellation, RSVP reminder | V1.1 completion | Start with new message (done) + event change/cancellation. RSVP reminders once V1.7 exists |
| 3 | **Privacy policy** — club has none to extend (confirmed 2026-08-17), so writing from scratch | V1.9 store submission | **User-owned, in progress.** Start from the Privacy Commissioner's Priv-o-matic generator — templates and the store questionnaires are listed in V1.9 |
| 3b | **Play Console target-audience declaration** — is this an app for children, or an app about children used by adults? | V1.9, and whether Google's Families policy applies | ⚠️ **No longer "almost certainly adults-only," and this is now live, not proposed** — the child-account redesign (Streamlined Invites spec) is built and shipped: children have their own direct login and can message a coach. Re-examine, don't assume. See the "Privacy policy & audience declaration" note under V1.9 |
| 3c | **Data retention & cleanup** — how long data is kept after a role/team ends, and what triggers removal | The privacy statement can't be finished without it; also a **future build** | ⏳ Mike scoping. Detailed thinking captured in **`docs/data-retention-scoping.md`** (3 data layers, per-competition clocks, open questions). Becomes its own build/spec once decisions lock — see "V1.R" below |
| 4 | **Player/Caregiver nav — 2 undecided slots** | V1.5 | Options: Announcements, or fold Announcements into Home and leave 5 buttons |
| 5 | **Does RSVP apply to Club Tournament teams, or only club teams?** | V1.7 scope | Probably club teams only for V1 — social/summer teams may just turn up |
| 6 | **Friendly Manager export format** — waiting on sample | V1.T | User to obtain export sample or screenshot |
| 7 | ~~Which machine for Android Studio?~~ | V1.1a | **RESOLVED 2026-08-14** — use the other laptop (has adequate disk/RAM). This laptop stays the main build machine. See V1.1a |
| 9 | ~~Consent-timeout exact day count~~ | Streamlined Invites Task 11 | **RESOLVED 2026-08-27** — 30 days. See `CHANGELOG.md`'s 2026-08-27 entry |
| 10 | **"Caregiver DOB Correction Threshold"** — should a caregiver be able to "correct" a child's DOB to 16+ on the Approve screen and have it still go through as a Junior? | Nothing blocks on it today, but it's a real, live gap | Parked from the Add Player / DOB spec, still open — see that section near the top of this file for the full write-up. Needs the same kind of decision as the Adult under-16 case: reject, redirect to Adult path, or something else |
| 11 | **Self-service profile editing** — which fields (name, phone, DOB, email) should a user be able to edit on their own record, with no Admin needed? | Nothing blocks on it today; found via the "Amy Brook"/"Amy Brooke" typo mess (see the Remove-action write-up) | New, 2026-09-01. No Profile/Settings page exists for anyone today — the only edit surface at all is the desktop-only, Admin-only `UserManagement.tsx`. Related to, and worth deciding alongside, item 10 above |

---

## V1 — Build Order

Dependency chain. Items further down depend on items above them.

```
V1.1a Android device testing    ── needs a machine that can run Android Studio
V1.1b iOS device testing        ── needs Mac + Xcode (borrowed)
V1.2  Email Service             ── ✅ DONE (2026-08-14)
 └─ V1.3  Fix Self-Registration ── ✅ DONE (2026-08-17), 3 follow-ups open
     └─ V1.4  Welcome + Team Page ── UNBLOCKED, next in the chain
         └─ V1.5  Role-Aware Nav  ── needs Team page to exist first

Independent (can happen any time):
V1.6  Invite Landing Page Branding
V1.7  RSVP / Availability
V1.8  Feature Flags for Launch
V1.9  Store Distribution + Privacy Policy   ── last, needs V1.1a + V1.1b
V1.T  Friendly Manager Import   ── separate track, External Leagues only
```

**Nothing except V1.9 depends on V1.1.** Everything in V1.2–V1.8 and V1.T
is web-testable in a browser. Device testing can happen whenever hardware
becomes available without causing rework — the only known follow-ups after
device testing are global (safe-area insets for the iPhone notch, minor
touch-target tweaks), not per-feature rebuilds.

---

### V1.1 Capacitor + Push Notifications — ✅ DONE; V1.1a Android ✅ DONE; V1.1b iOS ⬜ Blocked

*(Header corrected 2026-08-25 — previously said "IN PROGRESS," stale since
2026-08-19/20. V1.1 and V1.1a are both fully verified live on the Oppo —
full record in `CHANGELOG.md`'s three 2026-08-19/20 V1.1a entries. The
device-setup steps below stay — they're a reusable runbook, not history —
but the "already done and verified" list right below this was folded into
one line since CHANGELOG has the detail.)*

**Done and verified, full detail in CHANGELOG:** Capacitor init, Firebase
project, `device_tokens` table, push registration, the `send-message-push`
Edge Function + DB trigger (`pg_net` workaround for broken Database
Webhooks — see migration 042), and — on real Android hardware — sound,
vibration, foreground toast, tap-to-navigate, safe-area insets, and
touch-target sizing, all confirmed live on the Oppo (CPH2477).

**Machine decision (resolved 2026-08-14):** the original primary dev
laptop was too tight on disk (1.4 GB free) to run Android Studio, so
Android device testing moved to the Snapdragon laptop (341 GB free) —
which is now also just the main working machine day to day. Not a live
concern any more; kept only so nobody re-diagnoses it if disk pressure
ever comes up again on the original machine.

Below is the run sheet actually used to set up and execute V1.1a — kept
as a reusable runbook (e.g. for setting up a fresh machine, or as a
template for the still-open V1.1b iOS track), not because it's pending.

---

### V1.1a run sheet (self-contained runbook, already executed 2026-08-19)

**Pre-flight (assistant, first):** confirm this environment can (a) read/write the
local project files and (b) run local shell (`node -v`, `npm -v`, `git --version`).
If it cannot run shell, stop — Mike must use Kiro desktop on this machine, because
the build needs local `npm` / `npx cap` / `git`. Also check ≥ 20 GB free disk.

**Software to install (in order):**
1. **Node.js — any current LTS (20, 22 or 24 all fine)** (includes npm) —
   https://nodejs.org . Node 24 is the newest LTS and works here; nothing in the
   project pins a version. Verify `node -v`. (If a native dep ever fails on the
   newest Node during `npm install`, drop to LTS 22 — not expected here.)
2. **Git** — https://git-scm.com . Verify `git --version`.
3. **Android Studio (latest)** — https://developer.android.com/studio . During
   setup accept the default **Android SDK**, **platform-tools**, and one recent
   **system image** (e.g. API 34/35, Google Play image so FCM works). Studio
   bundles its own JDK — no separate JDK needed for the emulator path.
   This is the ~15–20 GB item; it's why this laptop was chosen.

**Project setup:**
4. Clone: `git clone https://github.com/Mikebrooke65/WCR-Football-App.git`
5. `cd WCR-Football-App` then `npm install`.
6. Copy **`.env.development`** into the repo root — it is git-ignored, so it did
   NOT come with the clone. Source: OneDrive backup
   `C:\Users\miker\OneDrive\Project Secrets\WCR-Football.env.development`
   (rename to `.env.development`). Without it the app can't reach Supabase.

Note: the Android platform is already committed (`android/` folder) and
`android/app/google-services.json` (Firebase config) is already in the repo — do
NOT re-init Capacitor or re-add the platform.

**Build & run:**
7. `npm run build`
8. `npx cap sync android`
9. `npx cap open android` (opens Android Studio) — OR from a real Android phone
   with Developer Mode + USB debugging on, plug in and run to the device.
10. In Android Studio, start an emulator (Play-enabled image) or select the phone,
    then Run.

**Verify (the point of V1.1a — does the app work in a native WebView + does push
register?):**
11. App loads; login works; the six-button nav and pages behave in the WebView.
12. The push-permission prompt appears; accept it.
13. Confirm a row lands in **`device_tokens`** (Supabase table editor, filter by
    the logged-in user).
14. Send a real Team Message to that user; confirm the `send-message-push` path
    returns `devicesFound` > 0 (was 0 with no device) and a push actually arrives.
15. Record the outcome back in this doc and update the V1.1 status in the table.

**Known traps:** hard-refresh isn't a thing on native, but a stale JS bundle is —
if behaviour looks wrong, re-run steps 7–8 (`build` + `sync`) before assuming a
bug. If `npm install` throws `TAR_ENTRY_ERROR`, it's almost always low disk.

#### V1.1b — iOS track (needs a Mac)

See `docs/project/MAC-SESSION-CHECKLIST.md` for the full step-by-step.

1. Install Xcode, install Kiro, clone repo, copy `.env.development` across
2. Install CocoaPods, `npx cap open ios`
3. Run in simulator, then on a real device
4. Confirm push permission + token registration populates `device_tokens`
5. Send a test message, confirm `devicesFound` > 0 and a push arrives

**Note**: testing push on a *real* iPhone requires the paid Apple
Developer account ($99/yr) — the simulator can request permission but
can't receive real pushes. Safe-area insets (iPhone notch/home indicator)
are an iOS-specific polish item that comes out of this track.

---

### V1.0 Buy a Product Domain — ✅ DONE (2026-08-14)

**`clubfootball.app` is bought, configured and live.** Verified from here:
HTTPS 200 on the apex, `www` 301s to it, certificate covers both.

What was done:
1. Registered at Cloudflare Registrar (~$14.20/yr). ICANN contact
   verification already satisfied from a pre-existing Cloudflare account.
2. Added `clubfootball.app` as a custom domain on the Netlify site.
3. Two Cloudflare DNS records, **both proxy-off / DNS-only**:
   apex CNAME → `apex-loadbalancer.netlify.com`, `www` CNAME →
   `wcrfootball.netlify.app`.
4. Netlify issued the Let's Encrypt certificate.

**Netlify's DNS verification flip-flopped** — reported success, then
"clubfootball.app doesn't appear to be served by Netlify", then success
again. It was wrong: at the time it failed, the apex already resolved to
exactly the same IPs as `apex-loadbalancer.netlify.com` from multiple
resolvers, and plain HTTP already returned `200` with `Server: Netlify`
serving the real app. Their check seems to trip on HTTPS not being live
yet — which is the thing the certificate fixes. **If this happens again,
just retry; don't start changing DNS records.**

#### ✅ Immediate follow-up — Supabase Auth URL configuration — DONE (2026-08-18)

**Completed and verified in the dashboard.** Both fields confirmed set:
- **Site URL** → `https://clubfootball.app` ✅
- **Redirect URLs** → `https://clubfootball.app/**` present, alongside
  `https://wcrfootball.netlify.app/**`, `https://wcrfootball.netlify.app/login`
  and `http://localhost:5173/**` ✅

The original instructions are kept below for the record.

Supabase dashboard → Authentication → URL Configuration:
1. **Site URL** → `https://clubfootball.app`
2. **Redirect URLs** → add `https://clubfootball.app/**`
   (keep `https://wcrfootball.netlify.app/**` and `http://localhost:5173/**`
   so the old domain and local dev both keep working)

Why it matters concretely:
- `AuthContext.resetPassword()` builds its redirect from
  `window.location.origin`, so from the new domain it asks Supabase for
  `https://clubfootball.app/reset-password`. Supabase **silently ignores**
  redirect targets that aren't allowlisted and falls back to the Site URL
  — so password resets would bounce people to the old domain instead of
  failing loudly, which is harder to notice.
- Supabase's own signup confirmation emails use the **Site URL**, which
  currently still points at `wcrfootball.netlify.app`. Relevant to V1.3.

Two Netlify suggestions were deliberately **declined**:
- *"Use Netlify DNS"* — impossible here. Cloudflare Registrar only
  registers domains that use Cloudflare's own nameservers.
- *"Make `www` your primary domain"* — apex gets marginally less optimal
  CDN routing, but this URL goes into invite emails, texts to parents and
  eventually app deep links. `clubfootball.app` wins on shareability.
  Revisit only if performance actually becomes a problem.

---

### V1.0 Reference — the original decision

**Decision (2026-08-14): Option A — buy a product domain**, not use the
club's domain. Something like `clubfootballapp.com`. ~$10–15/year.

**Why a product domain rather than the club's**: matches the
club-agnostic direction, needs no club/DNS cooperation (which — like the
privacy policy — is the kind of dependency that sits blocked for weeks),
and works for every club that ever uses this. Resend supports multiple
verified domains, so any club that later wants invites coming from their
own address can add theirs, while the product domain stays the default
that always works.

**One purchase unblocks four things**:

| Need | Currently | With the domain |
|------|-----------|----------------|
| Email sending (V1.2) | Test sender only reaches the Resend account owner's own inbox | Real invites to anyone |
| App URL | `wcrfootball.netlify.app` — club-specific *and* Netlify-branded | e.g. `app.<domain>` |
| Privacy policy hosting (V1.9) | Nowhere — both stores require a public URL | A page on the domain |
| Invite deep links (V2 backlog) | Not possible | App Links / Universal Links require a domain you control |

**Consistent with** the App ID already being generic
(`com.clubfootball.app`, deliberately not `nz.wcr.app`) — that can't be
changed after publishing, so a matching product domain keeps things
coherent.

**Domain and registrar DECIDED (2026-08-14): `clubfootball.app` from
Cloudflare Registrar, ~$14.20/yr.**

Domainz was considered first (familiarity — used for a previous project)
but **doesn't sell `.app`** and was more expensive, so familiarity wasn't
worth a worse outcome. Cloudflare sells at registry cost with no markup
and no first-year teaser rate, so ~$14.20 is roughly the ongoing renewal
too. DNS hosting, WHOIS privacy and registry lock are included free.

`clubfootball.app` mirrors the App ID `com.clubfootball.app`, which can't
be changed after publishing.

**Register personally, not under the club** — consistent with this being
a product domain, not a club asset.

#### DNS / hostname plan

| Hostname | Purpose | Record | Proxy |
|----------|---------|--------|-------|
| `clubfootball.app` (apex) | The app itself | CNAME → `apex-loadbalancer.netlify.com` | **DNS-only** |
| `www` | Redirects to apex (Netlify handles this) | CNAME → `wcrfootball.netlify.app` | **DNS-only** |
| `clubfootball.app/privacy` | Privacy policy (V1.9) | Static HTML page, **not** a React route — store reviewers must get it even if the app bundle fails to load | — |
| `send.clubfootball.app` | Sending domain verified in Resend | TXT (SPF, DKIM), optional DMARC | — |

Cloudflare flattens apex CNAMEs automatically (it can't be switched off at
the apex), which is why a CNAME works at the root here where most
registrars would need an A record. Netlify explicitly lists flattened
CNAMEs at Cloudflare as a supported apex setup, and
`apex-loadbalancer.netlify.com` is their current recommended target —
better than a hardcoded IP, which is what bit sites when Netlify retired
an old load balancer address in 2025.

**No code changes needed for the domain switch.** "Copy Link" builds from
`window.location.origin`, so it follows whatever domain the admin is on.
Emailed links build from the Edge Function's `APP_URL` secret. Both adapt
without a rebuild.

**App at the root**, not `app.clubfootball.app` — shortest to share, and
there's no marketing site competing for it.

**Email from a subdomain** (`noreply@send.clubfootball.app`), not the
root. If deliverability ever goes bad it damages the subdomain's
reputation, not the domain the app itself is served from. Free to do now,
painful to retrofit.

#### Four gotchas to get right

**0. Verify the ICANN registrant email immediately after purchase.** If
it isn't verified within 15 days, ICANN requires the registrar to place a
hold and Cloudflare replaces the nameservers with parking nameservers —
the domain stops resolving. Verifying restores them automatically, but
Cloudflare's forum shows people stuck in that state waiting on support
tickets. (Flagged 2026-08-14, on purchase.)

Cloudflare Registrar **requires the domain's DNS to be on Cloudflare**,
so their proxy is in the path by default. That's where the rest of the
traps are:

1. **Set the Netlify record to DNS-only (grey cloud), not proxied
   (orange).** Netlify issues its own certificate. Proxying on
   Cloudflare's default "Flexible" SSL mode produces a redirect loop. If
   the proxy is ever wanted, SSL mode must be Full (strict).
2. **`.app` is HSTS-preloaded** — browsers refuse plain HTTP outright,
   with no fallback. Fine with Netlify, but it means a misconfigured
   certificate presents as a hard failure rather than a warning. Know
   this so it isn't misdiagnosed.
3. **Deep links (V2)** need `/.well-known/assetlinks.json` (Android) and
   `/.well-known/apple-app-site-association` (iOS) served over HTTPS with
   correct content types and no redirects. Another reason to keep the
   record DNS-only.

**Then**: verify `send.clubfootball.app` in Resend (SPF/DKIM DNS
records), set `EMAIL_FROM`, `APP_URL` and optionally `EMAIL_REPLY_TO` as
Supabase secrets.

---

### V1.2 Transactional Email Service — ✅ DONE (2026-08-14)

**Live and verified end-to-end.** A real email was sent through the
deployed function and Resend returned a message ID.

- Resend account: **separate account, separate login** from the Riverhead
  Community one. Resend's free plan allows only **one domain per team**,
  that team's slot was already used by `riverheadcommunity.org.nz`, and
  creating a second team is a paid feature ($20/mo Pro). A second free
  account was the sane answer.
- Sending domain: **`send.clubfootball.app`**, verified, region Tokyo
  (`ap-northeast-1` — closest offered to NZ).
- DNS records added manually in Cloudflare (**not** Resend's "Auto
  configure", which would have granted a standing OAuth token with DNS
  write access to the same zone that points the app at Netlify):
  DKIM TXT at `resend._domainkey.send`, SPF TXT + MX at `send.send`,
  DMARC TXT at `_dmarc`. All four confirmed resolving.
  - Resend presents record names **relative to the zone root**, which is
    exactly what Cloudflare expects — enter them verbatim. Appending
    `.clubfootball.app` yourself produces
    `send.send.clubfootball.app.clubfootball.app`.
- **"Enable Receiving" deliberately left OFF** — send-only by design, no
  mailbox on the domain.
- Supabase secrets set: `RESEND_API_KEY`, `EMAIL_FROM`
  (`West Coast Rangers <noreply@send.clubfootball.app>`), `APP_URL`
  (`https://clubfootball.app`), `CLUB_NAME` (`West Coast Rangers`),
  `CLUB_COLOR` (`#0091f3`).
- `supabase functions deploy send-email` — deployed.
- Test send returned `{"success":true,"id":"..."}`.

**First real email landed in Outlook's Junk folder.** Expected, not a
misconfiguration — the domain was verified minutes earlier and has no
sending reputation, and Outlook is unusually harsh on new domains.
SPF/DKIM/DMARC were all confirmed resolving correctly beforehand.

Two things were fixed in response:
- ✅ **Added a plain-text alternative** alongside the HTML. HTML-only mail
  is a recognised spam signal. Redeployed and re-tested.
- ✅ **Fixed the subject line**, which was using HTML-escaped values — a
  team called "Mike's Team" would have arrived as "Mike&#39;s Team".

**Deliverability is now mostly a reputation problem, which needs time and
volume, not more configuration:**
1. Mark the test emails **"Not junk"** in Outlook — direct positive signal.
2. Real invites to real recipients who open them build reputation fastest.
3. After a couple of weeks of clean sending, consider tightening DMARC
   from `p=none` to `p=quarantine`. Don't do it sooner — `p=none` is the
   monitoring phase and tightening early can bounce legitimate mail.
4. Setting `EMAIL_REPLY_TO` to a real monitored address also helps, since
   `noreply@` with no reply path is a mild negative signal.

**To confirm authentication actually passed** (worth doing once): open the
message in Outlook → View message source, and look for
`Authentication-Results` showing `spf=pass`, `dkim=pass`, `dmarc=pass`.
Easier alternative: send one to a Gmail address, where "Show original"
displays all three in plain language.

**Still open — `EMAIL_REPLY_TO` is not set.** Replies to invite emails
will bounce. Decide whether invites should be repliable and, if so, which
monitored address they go to. Setting a personal address exposes it to
every recipient, which is why this wasn't just picked.

**Security note**: the first API key was pasted into chat and was
therefore revoked immediately and replaced. The replacement was created
with **Sending access only** (not Full access) and transferred via a file
outside the repo, which was deleted after use. Do it that way every time.

**The problem**: the admin has to manually copy an invite link and paste
it into their own email or text. For a launch with multiple teams
onboarding, this needs to be a "Send" button that emails the recipient
directly from the app — branded, automated, trackable.

**Provider: Resend** (decided 2026-08-14).

**Done**:
- ✅ `supabase/functions/send-email/index.ts` written — generic sender,
  `team_invite` template first; RSVP reminders and announcements slot
  into the same `type` switch later. Templates built **server-side** so
  the client sends `type` + data, never raw HTML (a compromised client
  can't push arbitrary content through the sending domain). User-supplied
  values HTML-escaped. Requires an auth header.
- ✅ Club-agnostic: `CLUB_NAME`, `CLUB_COLOR`, `APP_URL`, `EMAIL_FROM`,
  `EMAIL_REPLY_TO` all from env vars with generic fallbacks.

- ✅ **"Send Link" wired into `CompetitionsPage`** (2026-08-14) — three
  places, all with **"Copy Link" kept as a fallback** (genuinely useful,
  and it changes the security model — see V1.3):
  1. Add Tournament Team modal, after the team is created
  2. Per-team Invite modal, after the code is generated
  3. Each pending row in the Invites panel — so an invite can be
     **resent** later without regenerating the code
  Button label changes to "Resend Link" once sent. On failure the error
  explicitly tells the admin to fall back to Copy Link, so a Resend
  outage never blocks onboarding.
- ✅ `src/lib/email-api.ts` — client wrapper. Passes **only data** (team
  name, competition name, code, recipient); **no branding from the
  browser**, so branding has one source (the function's env vars).
  Also unwraps `functions.invoke` errors, which otherwise surface as an
  unhelpful "Edge Function returned a non-2xx status code".
- ✅ `npm run build` passes.

~~**Remaining**~~ — **all four steps below are now DONE** (2026-08-14):
Resend account + `RESEND_API_KEY` secret, `supabase functions deploy
send-email`, test send returning a message ID, and "Send Link" confirmed
from the app. Kept for the record; nothing here is outstanding.

**The only V1.2 item still open is `EMAIL_REPLY_TO`** (Open Decision 1b) —
replies to invite emails currently bounce.

**Note on team names in the email**: passed as `"{age_group} {name}"`
(e.g. "Open Bozos") per the project display standard, not the bare name.

**Not verified**: no Deno runtime locally to type-check or execute the
function. Same caveat as `send-message-push`.

**Send-only by design** — no mailbox needed on the sending domain,
`noreply@` is fine. But SPF/DKIM are still required or mail lands in
spam, and replies bounce unless `EMAIL_REPLY_TO` points at a monitored
address. Decision needed on whether invites should be repliable.

**Also unlocks later**: RSVP reminders by email, announcements by email,
custom password-reset emails.

---

### V1.3 Fix Lite User Self-Registration — ✅ DONE (2026-08-17)

**Shipped.** Self-registration from an invite link works. Built as a spec
(`.kiro/specs/lite-user-registration-fix/`) with the full record of what
was observed, decided and verified.

What landed:
- New `redeem-invite` Edge Function runs the whole redemption server-side
  as `service_role` — account, profile row, team membership, then mark the
  code redeemed **last** so a failure never burns the invite. **Deployed
  and ACTIVE; it does NOT ship with `git push`.**
- Compensating rollback undoes only what a failed attempt created, never
  pre-existing records. A retry with the same email and code then works.
- Pre-confirmation follows the email match: register with the address the
  invite was sent to → confirmed immediately, no confirmation email, log
  straight in. A different address → account and membership still created,
  but held behind Supabase's confirmation gate.
- Orphaned accounts from the old bug are **adopted** for the invited
  address; an account on a non-invited address is refused, not taken over.
- Registration errors are plain language — no policy or constraint text
  can reach the page.
- **Migration `045`** grants the anonymous role a *scoped* read on `teams`
  (only teams with a live invite). This fixed the invite heading rendering
  "undefined undefined" for anonymous visitors — a second latent defect
  found while verifying. Applied via the SQL Editor.

Verified: 101 unit/property tests, plus four live scripts against the real
project (12 exploration, 15 preservation, 39 integration, 21 rollback), all
green. `npm run build` clean.

#### V1.3 follow-ups still open — carried into V1

These were found while verifying and deliberately left out of the bugfix.
None of them block V1.4.

1. **Expired-code notification to the inviter emits nothing.**
   `validateInviteCode()` stays client-side and anonymous, so it can't read
   the inviter from `public.users` (RLS returns 0 rows silently). It is also
   still a `console.log` TODO with no in-app message wired. Fix: move the
   notification server-side, or grant a scoped read. **Small.**
2. **A non-matching-email registrant can't get past the login gate.**
   The account is correctly left unconfirmed, but GoTrue sends no
   confirmation email for an admin-created account, so nothing reaches
   them. Needs a resend/confirmation trigger. **Naturally belongs with
   V1.4's welcome email** — do it there rather than separately.
   **DECIDED 2026-08-18 (see V1.4)**: Option A + one explanatory line —
   generate the confirmation link server-side and send it via the Resend
   `send-email` function, with a sentence noting the address differs from
   the invited one. No correction workflow.
3. **Duplicate-key branch in `redeem-invite/index.ts` is too broad.**
   It treats any 23505 on the profile insert as the migration-006 trigger
   case, so a genuine email collision on a different id surfaces the wrong
   message. Rollback still holds and nothing leaks. Unreachable in normal
   use on this project (that trigger isn't live). Fix: narrow the check to
   the id conflict, or check affected rows. **Small, low urgency.**

Also outstanding, recorded not fixed: `redeem-invite` is an
unauthenticated endpoint that can create auth users — the invite code is
the authorization and **rate limiting is out of scope**. Worth a decision
before a public launch.

**✅ Browser pass DONE (2026-08-18).** Opened `/invite/SPEC67RG` on
clubfootball.app in an incognito window with the console open, for a fresh
tournament team "Open riverhead tests". Verified:
- Invite heading rendered the real team name ("Join Open riverhead tests"),
  not "undefined undefined" — migration 045's scoped anonymous read on
  `teams` working under a genuine anonymous session.
- Registration with the invited address succeeded; the success screen
  ("You've been added to Open riverhead tests") rendered.
- The `team_members` row was created — confirmed in the admin Teams view
  (member "mikey Brooo" / mandcbrooke1@gmail.com / role `player`).
- Immediate login on the invited address worked, landed on the home
  dashboard, no confirmation gate.

The matching-address path is signed off. The non-matching-address path was
not exercised (its outcome is known and scheduled — V1.4 Option A).

#### V1.3 browser-pass findings (2026-08-18) — NOT blockers, carried forward

**Finding A — player home dashboard shows "Teams: 0".** Reproduced on both
desktop and phone for the newly-registered player: the home dashboard shows
"Users: 19" but "Teams: 0", despite the player being a valid member of one
team (verified in the admin view).
- **Root cause**: `src/pages/Landing.tsx` → `fetchStats()` renders the
  "Teams" card as a **club-wide `count(*)` on the `teams` table**
  (`.from('teams').select('*', { count: 'exact', head: true })`), the same
  shape as the Users count. Under RLS, a player-role user gets 0 rows back
  from `teams` — the SELECT policy keys on the coach relationship, not
  `team_members` — so the count is 0. The Users count isn't similarly
  restricted, hence 19 vs 0. Admin sees 11 because admin RLS is
  unrestricted.
- **Two angles to resolve**:
  1. **Verify the player isn't also starved elsewhere by the same `teams`
     RLS.** `Games.tsx`/`Coaching.tsx` read teams via a `team_members`
     join (`team:teams(*)`); if the `teams` SELECT policy blocks players,
     that join may also return empty for a player. Check before assuming
     the impact is cosmetic.
  2. **Design**: a *player* arguably shouldn't see a club-wide "Teams"
     total at all — the card should show "the teams I'm in". Fold the
     display decision into **V1.4 / V1.5 role-aware home**.

**Finding B — a Manager invite assigns `role: 'player'`.** The Add
Tournament Team modal issues a "Manager invite code", but the registrant
comes through as a **Player** (confirmed on the dashboard and in the admin
Teams view). Root cause: `redeem-invite/index.ts` hardcodes `role:
'player'` for both the `users` profile row and the `team_members` row,
regardless of the invite's intent. So the manager-onboarding path produces
a player, which contradicts V1.4's welcome copy ("the teams you can
manage") and the whole Team-page permission model. **Fold into V1.4** —
that's where role/permissions are built. The invite likely needs to carry
an intended role that `redeem-invite` honours instead of hardcoding.

**Cleanup note**: this session created two throwaway tournament teams —
"Open Riverhead Frogs" (code PPZ65DXS, created on the old netlify.app
domain) and "Open riverhead tests" (code SPEC67RG). Mark inactive or remove
when convenient so they don't clutter real data.

#### Original diagnosis, kept for context

The invite flow worked right up to the registration form, then submitting
failed with *"new row violates row-level security policy for table
users"*.

**Root cause (confirmed by testing 2026-08-14)**: `signUp()` with email
confirmation enabled does **not** grant a session immediately. Supabase
sends its own "confirm your email" message and withholds the session until
the link is clicked. So the client is still acting as `anon` when it tries
to insert the profile row, and the RLS policy (`id = auth.uid()`) can't
match because there's no authenticated user yet.

RLS policies added while diagnosing (migrations 043, 044) were necessary
but not sufficient — they're correct and should stay.

**Key insight — this and V1.2 are really one piece of work**:
If *we* sent the invite to the manager's address and they clicked *our*
link from that inbox, that already proves they own the email. Supabase's
second confirmation email is redundant friction.

- **Fix**: create the auth user in an Edge Function with
  `email_confirm: true` (the same flag the existing `create-user` Edge
  Function already uses) → no Supabase confirmation email → immediate
  session → profile insert succeeds.
- **Applies when** the invite went through our own email service (we can
  prove delivery to the right address).
- **The "Copy Link" fallback keeps Supabase confirmation** as a safety
  net, because a pasted link proves nothing about who clicked it.

**Approach**: one Edge Function handling the whole registration — auth
user (`email_confirm: true`) + profile row + team membership + mark invite
redeemed — using `service_role`, so RLS isn't in the way. Same pattern as
`create-user`.

**Already correct, don't break it**: the existing code handles the
"user already exists" case properly. If the email matches an existing
full user (e.g. John Smith already in the system for an External League
team), it skips account creation and just adds the team membership. One
person, one account, multiple team memberships.

---

### V1.4 Post-Registration Welcome & Team Page — ✅ DONE (2026-08-18)

*(Header corrected 2026-08-25 — this was the original spec, written before
build, and never updated; it still said "NOT STARTED" weeks after shipping.
Kept below as-is since it's a clean record of what was actually built —
success screen copy, Team page layout, permissions table. Build/deploy
record: `CHANGELOG.md`, "2026-08-18 - V1.4 Post-Registration Welcome, Team
Page & Fixes." Still-open follow-ups: see the "✅ V1.4 + V1.5 — built &
deployed" section further up.)*

**Fold in V1.3 follow-up 2 here**: a registrant who used an address the
invite was *not* sent to is left unconfirmed with no email from Supabase.
The welcome email this section adds is the natural place to give them a
confirmation/resend path.

#### DECIDED (2026-08-18) — how the non-matching-address case is handled

**Chosen: Option A + one explanatory line. No correction workflow.**

Why this exists at all: on the non-matching path `redeem-invite` correctly
creates the account with `email_confirm: false` and returns
`email_confirmation_required: true`, but `admin.auth.admin.createUser` does
**not** send a confirmation email the way normal `signUp` does. So the
person ends up with an account they can't log into and no way out. That's
the dead end being fixed here.

The fix:
1. On the non-matching path, generate a confirmation/magic link
   **server-side** (`admin.auth.admin.generateLink`) and send it through
   the existing Resend `send-email` Edge Function — **do not** rely on
   GoTrue's built-in mail. Resend is the one real sending path on this
   project, and routing it ourselves keeps branding in one place (the
   function's env vars) per the club-agnostic rule.
2. The email carries **one explanatory sentence**, roughly:
   > You registered for {team} using this address, which is different from
   > the one your invite was sent to. If that was intentional, confirm
   > below to finish. If it was a mistake, ignore this email and register
   > again using the address your invite was sent to.

**Explicitly NOT building** a correction/re-point flow, undo logic, or any
"change your address" UI — judged over the top for V1. The typo case is
handled by the sentence above: the wrong account simply stays unconfirmed
and inert (no cleanup needed, it never becomes usable), and the person
re-registers with the right address.

Scope: this is **two copy variants of the same email** (plain welcome for
the matching path, welcome-with-context for the non-matching path), not two
systems. The link-generation + Resend plumbing is shared with 4a's welcome
email, so it's not throwaway work.

Two related pieces: the success screen after registering, and the new
Team page it points people to.

#### 4a. Success screen

Currently: *"You've been added to [Team]. You can now log in."* — no
context, no next steps.

Should be (dynamic):
> Welcome [FIRST NAME] and the [TEAM NAME]!
> You have been entered into the [COMPETITION NAME].
> Please use our app [APP LINK], and log in with the details you have set
> up. On the TEAM page you will see the teams you can manage — select your
> team and add players (names and email addresses). You can make one more
> player a Manager as well (maximum of two per team). Players will get
> emails to join, just as you have, and will get access to this App.

#### 4b. New mobile "Team" page

**Layout**:
- Team selector dropdown at top (same pattern as the Coaching page —
  auto-selects when there's only one team)
- Roster below, grouped by role: **Coach → Manager → Player**
- Multi-role users appear **once** with all roles listed
  ("John Smith — Coach, Manager"), not duplicated across groups
- Inactive users greyed out and moved to the bottom

**Contact display** (see Junior Player Model below):
- U17 / Open teams → show the player's own cellphone
- U16 and below → show the linked caregiver's name + cellphone

**Permissions**:

| Who | On a Club Tournament team | On an External League team |
|-----|--------------------------|---------------------------|
| Coach / Manager / Admin | Full edit — edit name details, change role, mark inactive, "+ Add User" | **Read-only** — the Club manages these rosters |
| Player / Caregiver | Read-only roster | Read-only roster |

**Rules**:
- **No delete/remove anywhere** — only "mark inactive" (reversible, in
  case they come back)
- Max 2 managers per team, enforced
- External League rosters are club-managed (desktop admin, or Friendly
  Manager import — V1.T). Team managers don't edit them because the club
  controls Federation registrations.
- The roster view is useful to **every** role — only the actions differ

---

### V1.5 Role-Aware Mobile Navigation — ✅ DONE (2026-08-18)

*(Header corrected 2026-08-25 — same as V1.4 above: this was the original
spec, stale-labeled "NOT STARTED" long after shipping. Build/deploy
record: `CHANGELOG.md`, "2026-08-18 - V1.5 Role-Aware Navigation." Kept
below since it's a clean record of the per-role tab design.)*

**Hard constraint: maximum 6 nav buttons per role.** The six-button bottom
nav is the app's primary mobile navigation — it works well visually and
for thumb reach. A seventh breaks it. This is a design rule, not a
preference.

Once nav is role-aware, adding the Team page costs nothing for any role,
because each role's six slots are chosen for that role's actual workflow.

| Role | Proposed 6 | Notes |
|------|-----------|-------|
| Manager / Coach | **Team**, Coaching, Games, Schedule, Messaging, Resources | Team replaces Home; Home moves to a header icon |
| Player | Home, **Team** (read-only), Schedule, Messaging, Resources, *?* | Coaching & Games hidden — not relevant |
| Caregiver | Home, **Team** (read-only), Schedule, Messaging, Resources, *?* | As player — viewing, not managing |

- Coaching and Games remain **accessible** (direct URL, links from other
  pages) — they're just not in the nav for roles that don't use them
- Home still exists, reached via the header logo/icon for manager/coach
- The two `*?*` slots are Open Decision 4

---

### V1.6 Invite Landing Page — Branding & Context — NOT STARTED

Independent of the chain above; can be done any time.

**Partly improved already by V1.3**: migration 045 means the team name now
actually renders for an anonymous visitor. Before that the heading read
"undefined undefined", which would have undercut any branding added here.
The remaining work below is unchanged.

When someone clicks an invite link they currently land on a bare white
"Join [Team]" form — no branding, no competition context, no sense of
where they've arrived. It needs to look legitimate (not like a phishing
page) and orient the person:

- Club logo / branding
- Competition name prominent (e.g. "Join the Summer Competitions")
- Short explanation: what this app is, what they're signing up for, what
  happens next (they'll be able to add their own players)
- Visual consistency with the rest of the app

---

### V1.7 RSVP / Availability — MOSTLY BUILT (corrected 2026-08-20 — this
section was stale; the RSVP UI already existed in code and was undocumented)

**Why it matters**: this is Heja's core feature. "Is my kid at training
this week?" Every parent expects it. Without it the app isn't a credible
Heja replacement.

**What's actually there (Schedule page, `src/pages/Schedule.tsx` +
`src/lib/events-api.ts`)**:
- Going / Maybe / Can't Go RSVP buttons on every event card, with a
  decline-reason picker for Can't Go.
- "X/Y attending" counter, and (as of 2026-08-20) tapping it opens a modal
  listing everyone by status, sourced from the event's target-team roster.
- Optimistic UI updates (2026-08-20) — RSVP taps reflect instantly instead
  of the multi-second lag reported this session.
- Past/upcoming split (2026-08-20) — past events grey out, RSVP buttons
  replaced with "Event has passed — RSVP closed"; coach/manager/admin can
  still Edit a past event (e.g. mark cancelled, fix a moved date).
- Create Event validation now names the specific missing field(s) instead
  of failing silently (2026-08-20).

**Still open / not built**:
- **RSVP reminder push notifications** (needs V1.1 proven on hardware —
  V1.1 is now done, so this is unblocked whenever it's prioritized).
- **Caregiver multi-child RSVP — DESIGN AGREED 2026-08-20, not yet built.**
  Queued to build alongside Task 1 (add-a-junior RLS fix) since they share
  the same server-side write pattern. Worked example that drove the
  design: John Smith is a coach of a team, and also caregiver to Johnny
  and Jenny Smith who are both players on that same team.

  **Agreed UX**: for any given event, work out how many "identities" a
  logged-in user has — their own (if they're a player/coach on the
  event's target team) plus one per child linked via `player_caregivers`
  who is also a player on that team. If it's exactly one identity, RSVP
  buttons behave exactly as they do today (single immediate RSVP). If
  it's two or more, tapping any of Going/Maybe/Can't Go opens a modal
  listing each identity down the left (e.g. "John Smith — Coach",
  "Johnny Smith", "Jenny Smith"), each with its own independent
  Going/Maybe/Can't Go — including its own decline-reason flow for Can't
  Go — and each one saves immediately on tap, same as a normal RSVP does
  today. **Confirmed: each identity's RSVP is fully independent** — no
  requirement to set your own status before setting a child's, or vice
  versa.

  **Agreed data model**: add a new `subject_user_id` column to
  `event_rsvps` — records who the RSVP is actually *about* (defaults to
  the same value as the logged-in user for a normal self-RSVP; set to the
  child's own `users.id` when a caregiver responds on their behalf). Move
  the unique constraint from `(event_id, user_id)` to
  `(event_id, subject_user_id)` so one login can hold multiple RSVP rows
  for the same event. `user_id` stays as "who actually submitted this,"
  for audit purposes.

  **Note this doesn't require any change to the "X/Y attending"
  counter/denominator** — Johnny and Jenny are already counted in that
  total via their own `team_members` rows; a caregiver responding "for
  Johnny" is just supplying the RSVP value for a roster member who
  doesn't personally use the app, not adding a new person to count.

  **RLS wrinkle — same fix as Task 1**: `event_rsvps` RLS currently only
  allows writing a row where `user_id = auth.uid()`, so a caregiver
  writing on behalf of a child would be blocked the same way the
  add-a-junior flow is blocked today. Don't solve this twice — route
  caregiver-on-behalf-of-child RSVP writes through a service-role Edge
  Function, same pattern as the Task 1 fix below.

  **Scope check done 2026-08-20 — RSVP is the only place this is needed
  today.** Walked every caregiver/player-reachable page looking for
  anywhere else "act on behalf of a child" comes up: Team (roster —
  read-only), Messaging (caregiver gets their own inbox, not one per
  child), Tournaments/Resources (read-only). Caregiver-approvals (Add
  Junior) needs the same *server-side write* fix but is a one-time
  consent decision, not a recurring per-event action, so it doesn't need
  the identity-picker modal. Coaching/Lessons/Games/Subs/AI Coach are all
  locked to coach/manager/admin at the routing level — caregivers can't
  reach them, so no concern there either. Given that, build the two
  reusable pieces generally rather than RSVP-specifically, so a future
  feature that needs "act on behalf of my child" (payments per child, a
  medical/consent form, etc.) doesn't have to redo this: (1) a shared
  helper resolving "given a logged-in user and a team, what are their
  eligible identities" rather than baking that lookup into Schedule.tsx,
  and (2) the Edge Function itself built generically (subject/child id +
  action type) so Task 1 and the RSVP fix can both call it.

  **Superseded 2026-08-20 — this generic-Edge-Function plan was NOT what
  got built.** When Task 1 was actually implemented, it shipped as two
  single-purpose Edge Functions (`link-player-caregiver`,
  `respond-junior-approval`), narrowly shaped around the add-a-junior
  tables specifically, matching the existing `create-auth-user`
  single-purpose pattern — not the generic "subject/child id + action
  type" function described above. The shared "eligible identities" helper
  (point 1) is still a reasonable idea for whoever builds this RSVP piece,
  but decide fresh whether it's worth it, rather than assuming a generic
  Edge Function already exists to call into — it doesn't. Full detail:
  `CHANGELOG.md`, "2026-08-20 - Task 1: add-a-junior RLS fix...".
- Also ties into eligibility more broadly — RSVP should cover players,
  managers, and coaches of a team. Confirm this is actually correctly
  scoped once the caregiver build lands — not verified either way yet.
  Note `team_members.role` currently only allows `'player'` or `'coach'`
  (migration 021) — there's no `'manager'` option, which is a related gap
  worth checking when this gets built (does a manager currently even get
  a `team_members` row at all?).

**Open**: does this apply to Club Tournament teams too, or only club
teams? (Open Decision 5)

---

### V1.8 Feature Flags for Launch — NOT STARTED

Some already-built features should be **hidden** at launch — not removed,
just switched off, so a first-time user sees a focused app rather than
everything at once:

- Tournament management (park until there's proven demand)
- Admin reporting (admin-only, can wait)
- Session Builder / Lesson Builder advanced authoring (keep basic
  lesson delivery, hide the authoring complexity)
- Competitions page (admin-only)

Do this near launch, once we know what the trial group actually needs.

---

### V1.9 Store Distribution & Privacy Policy — NOT STARTED (needs V1.1)

**Found 2026-08-25 while live-testing Add Player registration — capture for
go-live**: the post-registration Welcome screen's "Open the app" button
(`MatchingWelcome` in `LiteLandingPage.tsx`) is driven by
`club_settings.app_url`. Today that's just pointing back at
`https://clubfootball.app` (the web app/PWA), so registrants tapping it stay
in the browser. **Once this app is actually published to the App Store and
Play Store, `app_url` needs to be updated** (in `club_settings`, no code
change) to point at the real store listing — or a smart link that routes to
the right store per platform — so new registrants get sent to install the
real app instead of bouncing back into the web version. Easy to miss because
nothing breaks if it's forgotten; it just quietly keeps sending everyone to
the PWA forever. Add this as a concrete line item in the go-live checklist
once one exists, and as a check in the V1.9 build itself.

**Privacy policy & audience declaration — confirmed invalidated by the
child-account redesign, which is now built and live (flagged 2026-08-25,
shipped 2026-08-26/27).** Full detail: Section 9 of
`.kiro/specs/streamlined-invites-and-child-access/requirements.md` — read
that section before touching the privacy draft or Decision 3b below. Short
version: the existing privacy draft and Decision 3b's "almost certainly
adults-only audience" conclusion were both built on the old Model A
assumption — no child DOB collected, no child login, minimal child data.
**That assumption is no longer just at risk — it's factually wrong as of
this session's Task 6/8 work**: children now have their own DOB on file,
their own device-bound login, and the ability to message a coach directly,
all shipped and running on `prototype`. That means:
- The privacy policy draft (`docs/privacy-policy-draft.md`) needs rewriting
  now, to reflect what's actually collected and who actually uses the app
  directly — this is no longer a "once it's built" future step, it's built.
- Decision 3b (below) needs re-examining, not assumed — a real child
  end-user population is a different conversation with Google/Apple than
  "an app about children, used by adults."
- The existing legal caveat (NZ Privacy Act, app-store children's policies)
  is now more load-bearing than when it was first written.
**Treat this as a hard gate before store submission** — it's the single
highest-priority open item in V1.9 now that the build side is done; don't
let it keep sitting on a separate track from the child-account work it
depends on.

**Accounts**:
- Google Play Console — **$25 one-time**, needed before distributing to
  testers or publishing
- Apple Developer Program — **$99/year**, needed to test push on a real
  iPhone and to submit at all. Worth starting the application early —
  Apple's identity verification can take a day or two on its own.

**Assets**: app icon, splash screen, screenshots per platform, store
listing copy.

#### Privacy policy — what this actually is and why it's required

You asked what this piece means, so in plain terms:

**Both Apple and Google require a publicly accessible privacy policy URL
before they will publish an app that collects personal data.** It's not
optional and it's not a formality — submissions get rejected without it.

This app collects a fair amount: names, email addresses, phone numbers,
team affiliations, attendance records, messages between users — **and data
about children**, which raises the bar. NZ's Privacy Act 2020 applies.

Both stores also make you complete a **separate questionnaire** (Apple's
"App Privacy", Google's "Data Safety") declaring what you collect and why.
Those answers need to match what the policy says, or it fails review.

**What already exists**: the lite-user registration page shows a privacy
notice with consent checkbox (name/role visible to coaches, caregiver
details visible to other caregivers, data used only for team
coordination), and consent is recorded in `users.privacy_consent_at`.
That's a genuinely good start and shows the thinking is already right —
but an in-app consent notice is **not** the same thing as a hosted
privacy policy document, and won't satisfy the stores.

#### Templates and starting points (researched 2026-08-17)

**The club has no existing privacy policy to extend** (confirmed
2026-08-17), so this is being written from scratch. User-owned task,
running in parallel with the build.

*Not legal advice — this is process guidance and a list of sources.*

**Start here — the NZ Privacy Commissioner's own generator.** The Office of
the Privacy Commissioner publishes **Priv-o-matic**, a free privacy
statement generator built for small and medium organisations. Their own
description is that it takes about five minutes and covers the core
elements a statement needs under NZ law. It's the most defensible starting
point available, because it comes from the regulator rather than a
commercial template vendor.
- [OPC transparency guidance, links to Priv-o-matic](https://privacy.org.nz/responsibilities/poupou-matatapu-doing-privacy-well/transparency/)
- [Priv-o-matic source, open on GitHub](https://github.com/OPCNZ/priv-o-matic) — confirms it's a real OPC tool, not a third-party lookalike
- [OPC's own website privacy statement](https://www.privacy.org.nz/about-us/website-privacy-statement/) — usable as a worked example of the finished article

**Useful supporting reading:**
- [What a privacy statement must include](https://www.privacy.org.nz/resources-and-learning/knowledge-base/view/312/)
- [Statement vs notice vs policy](https://www.privacy.org.nz/resources-and-learning/a-z-topics/whats-the-difference-between-a-privacy-statement-notice-and-policy/) — the stores ask for a public-facing **statement**; the internal **policy** is a different document
- [digital.govt.nz guidance on privacy statements for websites](https://www.digital.govt.nz/standards-and-guidance/design-and-ux/usability/privacy-statements-for-websites)

**Then the two store questionnaires**, which are separate from the hosted
document and must agree with it:
- [Google Play Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469) — a mandatory form in Play Console
- [Apple App Privacy in App Store Connect](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/) — Apple's guidance is to answer inclusively, and to cover third-party code you integrate (for us: Supabase, Firebase Cloud Messaging, Resend)

**One distinction worth getting right before filling in the store forms.**
This app holds data *about* children, but children are not the intended
*users* — coaches, managers and caregivers are. That likely puts it outside
Google's Families programme, which is aimed at apps designed for children,
while leaving the Privacy Act 2020 obligations fully intact either way. The
target-audience declaration in Play Console is what commits you, so worth
deciding deliberately rather than clicking through.
- [Google Play Families policies](https://support.google.com/googleplay/android-developer/answer/9893335) — Google requires apps targeting children to comply with applicable children's laws including COPPA and GDPR. Worth reading to confirm we're *outside* it rather than assuming.
- Also worth a look given Team Messaging exists: [Child Safety Standards policy](https://support.google.com/googleplay/android-developer/answer/14747720). It's aimed at Social, Dating and anonymous/random chat apps — closed team messaging in a known group probably isn't in scope, but confirm rather than assume, because getting a category declaration wrong is a rejection.

**Sections that need real thought for this app specifically** — a generator
won't fill these in for you:
- **Children's data** — names, team affiliation, attendance, and caregiver
  contact details for U16 and below
- **Data retention** — how long after a child leaves a team is their data
  kept, and what triggers deletion. The app currently has *no* delete, only
  "mark inactive" (a deliberate V1.4 rule), which is a retention decision
  the policy has to describe honestly
- **Who can see what** — the existing in-app consent notice already covers
  this well and is a good source of wording
- **Third parties** — Supabase (database, hosting the data), Firebase Cloud
  Messaging (push), Resend (email), Netlify/Cloudflare (hosting, DNS)
- **Overseas storage** — worth checking which region the Supabase project
  sits in, since sending personal information offshore has its own
  Privacy Act principle (IPP 12). The Resend sending domain is already in
  Tokyo (`ap-northeast-1`)

**What already exists and helps**: the lite-user registration page shows a
privacy notice with a consent checkbox (name/role visible to coaches,
caregiver details visible to other caregivers, data used only for team
coordination), and consent is recorded in `users.privacy_consent_at` —
verified still working as part of V1.3. That's the right thinking and good
raw material for the wording, but an in-app notice is **not** a hosted
privacy statement and won't satisfy either store on its own.

**Hosting**: `clubfootball.app/privacy` as a static HTML page, **not** a
React route — store reviewers must be able to reach it even if the app
bundle fails to load. Already noted in the V1.0 DNS table.

*Sources above were summarised and rephrased rather than reproduced.*

---

### V1.R Data Retention & Cleanup — SCOPING (future build, gates the privacy policy)

**Now explicitly a combined piece, per the repo owner's 2026-08-31
decision** ("i think we need to manage 3,4 and V1.R together as one piece
fully scoped... our plan is 1, 2 then bigger piece V1.R"): this section
now absorbs **five** gaps found live-testing the new Remove action
(2026-08-31 through 2026-09-01), all of which turned out to be the same
underlying question this scoping doc was already wrestling with — how
team/role associations get modeled, scoped, and torn down. **Next
session's plan, updated 2026-09-01: the two quick verification loose ends
are now done** (migration-063 trigger confirmed twice; Competitions
assign-existing-Manager path confirmed live via "Open huapai demons"). The
two minor Remove variants are also both done: multi-team removal and a
plain Coach removal, both confirmed 2026-09-01 (the Coach-removal test is
what surfaced item 5 below). **Everything ahead of this piece on the
punch list is now clear — this is next up.** Treat everything below as
one fully-scoped piece of work, not five separate small fixes.**

**1. The missing "Demote to Player" / "Make Coach" roster controls.**
Found testing Remove: the roster only offers "Make Manager" (promote) and
"Remove" (fully delete the membership) — there's no way to **demote** a
Manager back to Player without removing them from the team entirely.
Repro: promoting George Pig to Manager alongside Mike Brooke hit the
2-Manager cap, with no way to undo the promotion short of Remove — the
wrong tool, since Remove ends their team membership altogether rather than
just stepping their role down. Scenario given: a promotion made in error,
or reconsidered later ("after three weeks he might say no, make Mortimer
the assistant manager instead"). Likely shape: a "Demote to Player"
control using the already-existing `rolesApi.updateTeamMemberRole`
(already used by `UserManagement.tsx` and by promotion itself), same
mechanism as promotion, reverse direction. Second half of the same gap:
there's no "Make Coach" at all today — `TeamRole` already includes
`'coach'` (`resolveCapabilities` already grants Coaches full edit
authority, same as Manager), but the roster only ever offers promotion to
Manager. The repo owner's framing: a Manager should be able to appoint a
Coach the same way they appoint a second Manager, and demote-without-
removing needs to apply symmetrically to both roles — "Make Coach"
alongside "Make Manager," and "Demote to Player" available from BOTH.
Unlike Manager, Coach has no 2-person cap today (`MANAGER_CAP` in
`permissions-logic.ts` is Manager-specific) — decided uncapped (see the
"SCOPE LOCKED" block below).

**Refinement, 2026-09-01: Make Coach must be additive, not a role
mutation.** Raised by the repo owner: "the initial Manager set up with a
team could also be the Coach — first thing they do is select Make Coach,
they then have both roles." "Make Manager" today works by *mutating* the
person's existing Player row in place (`updateTeamMemberRole` on their
one `team_members` row) — fine for Player→Manager since there's nothing
lost. But if "Make Coach" worked the same way on a Manager, it would
overwrite their Manager row and they'd end up Coach-only, losing the
Manager role instead of gaining a second one.

**Superseded, 2026-09-01: NOT a second `team_members` row.** The first
draft of this fix (insert a second row, same `team_id`/`user_id`,
`role='coach'`) turned out to be invalid the moment the actual schema was
checked: `team_members` has `UNIQUE(team_id, user_id)` (migration 021) —
a person can have **at most one row per team**, full stop. A second row
for the same person on the same team is rejected by the database, not
just discouraged.

**Final design (built): an additive `is_coach` boolean column on the
existing row** (migration 064), completely independent of `role`.
`role` keeps its exact current meaning and values (`player`/`coach`/
`manager`) untouched — several live Edge Functions (`bulk-create-users`,
`create-user`, `redeem-invite`) still write `role: 'coach'` directly, and
several read paths (`reporting-api.ts`, `messaging-api.ts`,
`usePermissions.ts`) still filter on `role IN ('coach','manager')`; none
of those were touched. `is_coach = true` means "this member also has
Coach authority on this team," on top of whatever `role` says — so a
Manager who also coaches ends up `role: 'manager', is_coach: true`, one
row, both badges. Every new authorization check added in this patch
(the scoped RLS policy, the role-sync trigger, the roster UI's
Demote/Make-Coach gating) treats "effectively a coach" as
`role IN ('coach','manager') OR is_coach = true`.

**Known small gap, flagged not fixed**: the three pre-existing read paths
named above (`reporting-api.ts`, `messaging-api.ts`, `usePermissions.ts`)
do not yet recognise a `role='manager', is_coach=true` member as a coach
for their own purposes (e.g. a "message all coaches" recipient list).
Auditing/updating those was judged outside V1.R Part 1's scope — they're
unrelated live call sites, not part of the roster/role-model work this
patch is about. Worth a follow-up pass if "message all coaches" is ever
found to miss a dual-role Manager+Coach.

Knock-on effect on Demote, corrected to match: since `is_coach` lives on
the SAME row as `role` (not a second row), there is no "redundant extra
row" problem to solve at all. "Demote to Player" (`role` manager/coach →
player, with first-Manager protection where applicable) and "stop being
Coach" (`is_coach` → false, `role` left untouched) are two fully
independent actions on the one row — see items B/C below and
`permissions-logic.ts`'s `canDemoteFromManager`/`canRemoveCoachFlag` for
the shipped rules.

**Why this belongs with V1.R, not as its own fix**: it's new write
traffic on the exact same `team_members` table, through the exact same
`rolesApi` methods, that items 2 and 3 below are also about — building it
in isolation risks testing it against an authorization model (see #2)
that's about to change, and a promote/demote/remove feature set is itself
a "how do roles get created and torn down" question, i.e. V1.R's actual
subject.

**2. The migration 036 `team_members` RLS gap.** A pre-existing policy
lets ANY user whose global `users.role` is admin/coach/manager manage
(insert/update/delete) ANY `team_members` row for ANY team, completely
unscoped to teams they actually belong to — found while designing the
Remove Edge Function, which had to route around it via a privileged
service-role function rather than relying on RLS (Postgres OR's every
applicable policy together, so a narrower policy can't take back access a
broader one already grants). **Repo owner confirmed this is a real bug,
wants it fixed**: "an admin can see any team, a coach and manager can only
see a team they are associated with." Target end state: Admin stays
global; Coach/Manager narrowed to only their own team(s). When picked up,
this needs narrowing the migration 036 policy without breaking plain
Player/Caregiver roster viewing — migration 036 was the ONLY
`team_members` policy found by grepping every migration for it, so it's
not yet confirmed whether some other policy independently covers plain
viewing; narrowing a policy that turns out to be the only thing letting a
Player see their own roster would break roster viewing entirely, so this
needs checking carefully (possibly live via the SQL Editor) before writing
a fix. Likely shape: keep Admin as an unscoped `OR` branch, replace the
Coach/Manager branch with a team-scoped check — probably via a `SECURITY
DEFINER` helper function rather than a raw self-referencing subquery on
`team_members` from within its own policy, to avoid a known
Postgres/Supabase "infinite recursion detected in policy" failure mode
with that pattern. This is also the RLS policy behind `UserManagement
.tsx`'s own `addTeamMember`/`updateTeamMemberRole`/`removeTeamMember`
calls (and hence #1's new controls too), so fixing it needs re-verifying
all of those flows afterward, not just the new ones. **Still separately,
conceptually linked to V1.M's "Send to Admins" messaging bug** (its own
section below): both are really the same underlying question of how a
user's team/role scope is modeled and enforced — migration 036 over-scopes
a Coach/Manager to every team, while V1.M under-scopes messaging (an
Admin-targeted message can't exist at all today, since `messages.team_id`
is mandatory and every messaging RLS rule is team-scoped). Worth reading
both sections together when the time comes, even though V1.M itself isn't
being folded into this combined V1.R piece.

**4. A child must always have at least one caregiver — found verifying
Task 12's migration-063 loose end, 2026-09-01, captured only (repo owner:
"capture that issue around, child must have a caregiver, so you can't
remove a caregiver if there is only one for that child, and get it
scoped into that V1.R").** Confirmed by reading the actual code
(`caregivers-api.ts`'s `unlinkCaregiverFromPlayer` is an unconditional
delete with no check on how many caregivers remain) that today, nothing
prevents a club Admin from removing a child's (under-16) LAST remaining
caregiver, leaving them with zero. The only existing safeguard is
reactive, not preventive: migration 056/063's trigger queues an
`admin_action_items` review row afterward for an admin to decide what to
do next — it doesn't block the removal itself. Repo owner's position: a
child should never be allowed to end up with zero caregivers at all — the
system should refuse to remove a child's only/last caregiver outright,
only permitting it once a replacement caregiver already exists (i.e. this
becomes a genuine minimum-of-one-caregiver invariant for anyone under 16,
not just an after-the-fact review). Confirmed live as a real, not just
theoretical, scenario: Amy Brook (child-band) has exactly one caregiver on
file (Mike Brooke) — checked via SQL, not assumed. **Explicitly folded
into the same combined V1.R piece as items 1-3 above** — this is the same
"how are these associations modeled, scoped, and safely torn down"
question, just adding a genuine safeguarding/minimum-cardinality rule
(child ⟶ at least one caregiver) to the pile of things that piece needs to
resolve together, alongside the migration-036 RLS scoping fix and the
Demote/Make-Coach controls. **Adult (16+) self-removal (migration 062)
already correctly has no such floor** — an adult choosing to have zero
caregivers is fine by design; this new invariant is specifically about
players who are still legally children.

**3. How #1 and #2 connect to V1.R's existing scoping questions below**:
V1.R was already asking "soft-delete vs hard-delete for role/status" and
"confirm the intent of the caregiver-link `ON DELETE CASCADE`" — the new
Remove action already made live, shipped decisions on both (a genuine hard
delete of `team_members` rows, and a specific rule cascading caregiver
link removal only when it was the child's last team membership). When
V1.R's scoping doc gets finalised, it should treat tonight's Remove
feature as precedent to build from, not a separate question to
re-decide — otherwise there's a real risk V1.R lands on a different answer
(e.g. favouring a soft/reversible model for privacy reasons) that
contradicts what's already live and would need reconciling.

**5. Global `users.role` vs. per-team `team_members.role` are two separate,
not-kept-in-sync concepts — found testing a plain Coach doing a Remove,
2026-09-01.** Promoting Hewie Duck to Coach on one team (via a direct
`team_members.role` update, since no "Make Coach" UI exists yet — see
item 1 above) left his global `users.role` unchanged at "player." Confirmed
by reading the code that this is more than a cosmetic mismatch:
`main-layout-logic.ts`'s `tabsForRole` reads the global role to decide
whether the Coaching/Games bottom-nav tabs show at all, so a per-team-
promoted Coach or Manager is actually missing functionality a "real"
Coach/Manager account would have, not just seeing a wrong label. Same
root question as items 1-2: this app currently models "role" in two
disconnected places, and nothing reconciles them. Needs deciding
alongside the rest of this piece — e.g. should a global role become "the
highest role you hold on any team," computed rather than stored, or does
the header/nav need to go per-team-context instead of reading one global
field at all?

---

## V1.R — SCOPE LOCKED, 2026-09-01: split into two pieces

Repo owner's decision, working through this live: **V1.R splits into Part
1 (role model — build now) and Part 2 (automated data retention/deletion
— its own future spec, nothing blocks on it today)**. The five items
above (1, 2, 4, 5, plus the hard-delete precedent from 3) are Part 1.
Everything in `docs/data-retention-scoping.md` (competition cleanup
clocks, the 12-month grace window, de-identified performance data, the
pre-deletion notice) is Part 2 — untouched, still just scoping notes, not
built.

**Foundational decisions locked for Part 1:**
- **Hard delete is the ratified pattern**, not a question anymore. The
  already-shipped Remove action's genuine `DELETE` on `team_members`
  stands as the real answer to the scoping doc's old "soft vs hard
  delete" open question (which had recommended the opposite — null the
  team ref, keep the row). Reversing already-tested, working behaviour
  wasn't worth it; retention cleanup (Part 2, later) follows the same
  hard-delete pattern rather than maintaining two models.
- **Global `users.role` stays a stored field**, actively kept in sync
  rather than removed or computed on every read. Smallest change; keeps
  `main-layout-logic.ts`'s existing `tabsForRole` code as-is.
- **"Make Coach" is uncapped** — unlike Manager's 2-per-team cap. A head
  coach plus one or more assistants is a normal real-world shape, and
  Coach already carries the same full edit authority as Manager, so
  there's no security reason to cap it either.

**Part 1 build shape (design, not yet built):**

**A. Migration-036 RLS fix.** Replace the unscoped `team_members` write
policy (`FOR ALL USING (users.role IN ('admin','coach','manager'))` —
lets a Coach/Manager write to ANY team, not just their own) with one
scoped to `team_id`: permit when `users.role = 'admin'`, OR when a
`team_members` row exists for the acting user on *that specific*
`team_id` with role `coach` or `manager`. This mirrors exactly what
`remove-team-member`'s Edge Function already independently re-derives
server-side — RLS has just been silently over-permissive underneath it,
not actually relied on for anything exploitable today, but worth closing
now that this whole area is being reworked.

**B. Demote-to-Player control.** New roster button, reusing
`rolesApi.updateTeamMemberRole` (same mechanism promotion already uses),
sets `team_members.role = 'player'`. Available for both Manager and Coach
rows. **Open question, not yet decided**: should the first Manager be
protected from being *demoted* by someone else, mirroring the existing
Remove protection (only the first Manager can remove themselves, nobody
else can remove them)? My read: yes, for the same reason — otherwise
Remove's protection is trivially bypassed by demoting the first Manager
to Player first, then removing them normally.

**C. Make-Coach control.** New roster button alongside Make Manager. Built
as the additive `is_coach` boolean (see the corrected item 1 above), not a
role mutation — so it can grant Coach authority to a Player OR a Manager
without disturbing their existing `role`. Uncapped, per the decision
above. Paired with its inverse, "Stop being Coach" (turns `is_coach` back
off, `role` untouched).

**D. Role-sync trigger** (new). A Postgres trigger on `team_members`
(`AFTER INSERT OR UPDATE OR DELETE`) that recomputes the affected user's
global `users.role` automatically, rather than scattering "also update
`users.role`" calls across every promotion/demotion/remove call site
(current and future). Logic:
  - If the user's current `users.role` is `'admin'`, skip entirely —
    admin is a manual-only designation via `UserManagement.tsx`, never
    auto-derived from team membership.
  - Otherwise, compute the highest-precedence role across **all** of that
    user's `team_members` rows, any team: `manager` > `coach` (`role =
    'coach'` OR `is_coach = true`) > `player`.
  - If they hold zero `team_members` rows anywhere, fall back to
    `'caregiver'` if any `player_caregivers` row has them as
    `caregiver_id`, else `'player'`.
  A trigger (rather than explicit app-code updates at each call site) is
  the recommended shape because it's the one place that's guaranteed to
  catch every current and future path that changes `team_members` —
  Make Manager, Make Coach, Demote, Remove, even a direct SQL edit like
  tonight's testing — without relying on every call site remembering to
  also sync the global field.

**E. Child-must-have-a-caregiver invariant.** Block (not just flag)
deleting a child's (under-16) last remaining `player_caregivers` row,
unless a replacement caregiver link is added first. Likely shape: a
`BEFORE DELETE` trigger on `player_caregivers` that raises an exception
if the delete would leave an under-16 player with zero caregiver rows.
Confirmed live as a real, not just theoretical, gap — see item 4 above.

**Both open questions resolved, 2026-09-01:**
- **First-Manager demote protection: yes, agreed.** Item B's Demote
  control gets the same protection Remove already has — only the first
  Manager can demote themselves; nobody else can demote them. Otherwise
  Remove's protection is trivially bypassed (demote the first Manager to
  Player, then remove them normally).
- **`UserManagement.tsx`'s manual role editor: make it read-only for the
  derived values (player/caregiver/coach/manager); keep only the Admin
  toggle manually editable.** Settled by the repo owner's description of
  how role changes actually happen in practice: **"the only people that
  are changing these roles are admins, or coaches and managers. Admins
  will only initially get involved with league teams — club teams get
  administered/managed by the players, with the first-set-up Manager
  having primacy. The admin would only get involved to help them fix
  something, if the wrong thing happened."** Since ordinary role changes
  are already fully covered by the roster actions (Remove, Demote, Make
  Manager/Coach — all of which the new sync trigger keeps in step
  automatically), there's no real scenario needing a disconnected manual
  dropdown for those values, and an Admin's "fix something that went
  wrong" role fits more naturally through those same roster actions than
  a separate field that could silently drift from reality. Admin status
  itself stays manually toggleable, since that's the one value the
  trigger deliberately never derives.

**Separately noted, not part of this scope**: repo owner flagged wanting
to revisit the desktop admin screens (`UserManagement.tsx` and others)
more broadly at some future stage — a broader UX/functionality pass, not
just this role-field question. Capture only, not scheduled yet.

**Part 1's scope and both open questions are now fully locked — ready to
turn into a patch.**

**Cross-team multi-role, explicitly checked and confirmed unbroken,
2026-09-01.** The repo owner flagged this specifically before the build
started: "it was always in the original specifications that a user could
have multiple roles — manager for one team, caregiver for a child in
another, coach and manager in a third — we need to ensure this is all
working and we don't break anything." This is a DIFFERENT capability from
the same-team dual-role case (item C/`is_coach`) — a person having
different roles on *different* teams, which already worked via one
`team_members` row per team (no conflict with `UNIQUE(team_id, user_id)`,
since that constraint is scoped per team). Confirmed nothing in this
patch touches it:
  - Migration 065's new RLS policy checks edit authority **per
    `team_id`** (`user_can_edit_team(target_team_id)`) — a person's row on
    Team A never affects, and is never affected by, their row on Team B.
    If anything this is now MORE correctly scoped than migration 036's old
    global-role check, not less.
  - Migration 066's role-sync trigger computes the global `users.role`
    from the highest-precedence role across **all** of that person's
    `team_members` rows on **every** team they belong to — it reads every
    row, never deletes or mutates any of them, and a caregiver link
    (`player_caregivers`) is an entirely separate table it only reads as a
    last-resort fallback when zero `team_members` rows exist anywhere.
  - Migration 067 touches only `player_caregivers` deletes; unrelated to
    `team_members` or cross-team roles entirely.
  Net effect: cross-team multi-role continues to work exactly as before —
  this patch only changes how same-team dual-role (`is_coach`) and the
  single global `users.role` summary field behave.

**Built, 2026-09-01 — migrations 064-067 plus client changes, ready to
verify and patch:**
- `supabase/migrations/064_team_members_is_coach.sql` — additive
  `is_coach boolean not null default false` on `team_members` (item C).
- `supabase/migrations/065_team_members_scoped_rls.sql` — `SECURITY
  DEFINER` function `user_can_edit_team(target_team_id)` + replaces
  migration 036's unscoped `team_members` policy with one scoped to the
  specific team (item A).
- `supabase/migrations/066_user_role_sync_trigger.sql` — the role-sync
  trigger (item D), `AFTER INSERT OR UPDATE OR DELETE ON team_members`,
  skips Admins, treats `role IN ('coach','manager') OR is_coach = true`
  as coach-tier.
- `supabase/migrations/067_player_requires_a_caregiver.sql` — `BEFORE
  DELETE` trigger on `player_caregivers` blocking a Junior's last
  remaining caregiver link from being deleted (item E).
- `src/lib/permissions-logic.ts` — added `canDemoteFromManager` (mirrors
  `canRemoveTeamMember` exactly, including first-Manager parity) and
  `canRemoveCoachFlag` (same shape, no first-Manager concept), plus tests
  in `permissions-logic.test.ts`.
- `src/lib/roles-api.ts` — added `setCoachFlag(membershipId, isCoach)`;
  `updateTeamMemberRole` (pre-existing) is reused as-is for Demote.
- `src/types/database.ts` — `TeamMember.is_coach: boolean`.
- `src/pages/TeamPage.tsx` — `fetchRoster` synthesizes a second `'coach'`
  `RosterMember` for any `is_coach=true` row (so it merges into
  `entry.roles` with zero changes needed to `roster-logic.ts`), folds
  `is_coach` into `currentUserRoles` so every existing
  `.includes('coach')` capability check picks up an `is_coach` holder's
  edit authority automatically; added "Make Coach" / "Demote to Player" /
  "Stop being Coach" buttons and handlers; `handleRemoveCaregiver` now
  maps migration 067's `player_requires_a_caregiver` error to a friendly
  message ("This is the child's only caregiver. Add a replacement
  caregiver before removing this one."), same pattern as the existing
  `manager_cap_reached` handling.
- `src/pages/desktop/UserManagement.tsx` — the Edit User modal's Role
  field is now read-only (shows the derived value) with a separate
  "Admin access" checkbox, per the locked resolution above. Unchecking
  Admin recomputes a best-effort non-admin role client-side from that
  user's already-loaded team memberships (`deriveNonAdminRole` — mirrors
  the trigger's manager > coach/is_coach > player precedence, skipping the
  caregiver-fallback edge case as an acceptable simplification for this
  rare path).

**New gap found while wiring UserManagement.tsx, not fixed, flagged for
its own future pass**: `handleSave`'s "Edit User" path does a plain
client-side `supabase.from('users').update({...}).eq('id',
editingUser.id)` for ANY user being edited — but the only live `users`
UPDATE policy (`users_update_own`, migrations 004/057) is `USING
(auth.uid() = id)`, i.e. **self only**. There is no admin-broad UPDATE
policy on `users` anywhere in the migration history. That means today,
an Admin editing anyone OTHER than themselves in this screen (name,
phone, active status, or — before this patch — role) is silently
rejected by RLS, not just the role field. Out of scope for V1.R Part 1
(a different, pre-existing gap, not something this patch introduced or
was asked to fix) — would need its own design, most likely a privileged
Edge Function mirroring `remove-team-member`'s pattern, or a properly
scoped admin-only RLS policy. Worth an empirical check (an Admin editing
someone else's phone number) next session to confirm this is really as
broken as the policy read suggests.

**Update, 2026-09-02: code patch applied and pushed.** `v1r-part1.patch`
applied cleanly via `git am` and pushed to `prototype`
(`ac0e6b8..48473ba`) — all 7 code files + the 4 new migration files are
now on the branch that goes live at clubfootball.app. `CHANGELOG.md` entry
was included in the same patch.

**Update, 2026-09-02: all 4 migrations run live, Make Coach confirmed
working — and one real gap found + fixed the same session.**

All four migrations ran clean in the Supabase SQL Editor, in order (065
needed the usual destructive-operations confirmation for its `DROP
POLICY`, expected). Live-tested on Open Riverhead Frogs:

- **Make Coach on Hewie Duck (plain Player → also Coach)**: roster shows
  both `Coach`/`Player` badges immediately. Confirmed via SQL that the
  role-sync trigger correctly flipped his GLOBAL role from `player` to
  `coach` (no manager row to compete with). His own header/nav still said
  "player" until he did a full page refresh — expected, not a bug: the
  React session caches the profile at login/mount and only re-fetches on
  a fresh load, same as any SPA. After refreshing, his header correctly
  read "Coach" and the Coaching tab appeared. **This is the original bug,
  now confirmed fixed.**
- **Make Coach on George Pig (Manager → also Coach)**: roster showed both
  `Coach`/`Manager` badges correctly, and SQL confirmed `is_coach = true`
  on his row — but his GLOBAL role stayed `manager` (migration 066's
  trigger deliberately gives Manager precedence over Coach), and his own
  nav only showed the tabs he already had as Manager (Games) — **no
  Coaching tab**, despite genuinely holding Coach authority now. Root
  cause: `main-layout-logic.ts`'s `tabsForRole` decides `showCoaching`
  from the single global `role` value alone (`role === 'coach'`), so a
  Manager who also becomes a Coach can never trip that check — the exact
  "first Manager also makes themselves Coach" scenario this whole feature
  was built for.

**Fixed same session, not deferred**: `tabsForRole` gained a third,
defaulted-`false` parameter, `hasCoachAuthorityOnAnyTeam` — `showCoaching`
is now `role === 'coach' || role === 'admin' || hasCoachAuthorityOnAnyTeam`.
`MainLayout.tsx` derives it from `user.teamMemberships` (already fetched
by `AuthContext` — no new query): `some(tm => tm.role === 'coach' ||
tm.is_coach)`. Every existing call site and test is unaffected (parameter
defaults to `false`); 3 new tests added in `main-layout-logic.test.ts`.
Verified via `npx vitest run` (239 passing) and `npm run build` (clean).
**Not yet re-tested live** — George needs to refresh his own session and
confirm Coaching now shows, same as Hewie's confirmation above.

Packaged as a second patch, `v1r-part1-followup-coaching-tab.patch`,
applying on top of `48473ba` (the first V1.R Part 1 patch already
pushed). No new SQL — this is a client-only fix.

**Confirmed live, 2026-09-02 (`646efcd` pushed + deployed).** George Pig
refreshed his session after the follow-up patch deployed and now sees
Coaching alongside Games, same as Hewie Duck's earlier confirmation.
**Both dual-role scenarios (plain Player → Coach, and Manager → also
Coach) are now fully confirmed working end to end.** Make Coach, its
nav-tab consequence, and the role-sync trigger are done.

**Everything else confirmed live, 2026-09-02 — V1.R Part 1 is fully done.**

- **Stop being Coach**: confirmed on George Pig — `is_coach` flipped back
  to false, role stayed Manager, Coaching tab disappeared. Correctly
  independent of `role`.
- **Demote to Player**: confirmed on Mortimer Mouse (not the first
  Manager) — dropped cleanly to Player, and the Manager cap correctly
  freed up (Goofys mum's Make Manager button un-greyed immediately after).
- **First-Manager demote protection**: confirmed both directions. Mike
  Brooke (Admin) could NOT demote or remove George Pig (the team's first
  Manager) — no button even showed. Logged in as George himself, Demote
  to Player on his own row worked and he correctly lost the Coaching tab.
- **Migration 065's scoped RLS**: not demonstrable through the normal app
  UI — the team selector already only lists teams a user actually belongs
  to (separate, pre-existing, correct behaviour unrelated to this fix), so
  there's no UI path to even attempt writing to a team you're not on. The
  fix is defense-in-depth against direct API access; confirmed structurally
  (the migration's `CREATE POLICY` ran clean, and the SQL/logic were
  reviewed carefully) rather than via a live exploit attempt.
- **Migration 067's child-caregiver-floor invariant**: confirmed via a
  direct SQL delete attempt on George Pig's only caregiver link (Daddy
  Pig) — correctly rejected: `ERROR: P0001: player_requires_a_caregiver`,
  with the friendly hint text, and the delete rolled back with nothing
  actually removed. Couldn't reach this through the roster UI's "Manage
  Caregivers" button — see the new bug captured just below for why — so
  this was verified at the data layer directly instead, which is a fully
  valid test of the trigger itself.

**New bug found along the way, NOT fixed, captured for later**: the
roster's "Manage Caregivers" (and by the same logic, "Add Caregiver")
visibility checks `roster.ageBand` — the TEAM's own age_group-derived
band — instead of that specific PERSON's own age band the way the
contact-display logic elsewhere on the same page already correctly does
(`ageBandFor(row.user?.date_of_birth)`, per the add-player-and-dob-age-
model work). Confirmed live: George Pig, genuinely 13 years old
(`date_of_birth` 2013-05-07) and registered on an "Open" (adult-band)
team, never gets a "Manage Caregivers" option shown to anyone, Admin
included, because the team itself is Open. A real child on an Open/adult
team can have their caregiver link created (via Add Caregiver, if that
ever becomes reachable) but never removed or managed through the roster
UI at all — the only way to touch it is direct SQL, which is how tonight's
test of migration 067 had to be done. Exact fix shape: change
`isChildBandPlayerRow` in `TeamPage.tsx` from `roster.ageBand === 'child'`
to the same per-row `ageBandFor(...)` check the contact display already
uses for that entry. Small, well-understood fix — just not built tonight,
since it surfaced mid-testing and is unrelated to V1.R's actual scope.

**V1.R Part 1: fully built, deployed, and live-verified, 2026-09-02.**
Nothing outstanding on this piece. Next up per the build order: the
"Manage Caregivers" per-person age-band bug just found (quick, worth
doing soon since it currently blocks legitimate caregiver management for
any child on an Open/adult team), then the "Caregiver DOB Correction
Threshold" decision, V1.M's messaging fix, V1.9's privacy policy rewrite,
then V1.6/V1.7/V1.8.

**Deferred to V1.R Part 2 (own future spec, no build now)** — everything
below stays exactly as scoped in `docs/data-retention-scoping.md`,
untouched by tonight's decisions:
- Automated competition-instance cleanup clocks (League 31 Dec / Club
  rolling 12-month window — still undecided which).
- The automated "no role for 12 months → delete the user" job.
- De-identified performance data retention (Q2's anonymised vs.
  pseudonymised distinction).
- Pre-deletion notice + data export flow.
- Backup-retention window wording for the privacy policy.

---

Not started as a build; **scoping in progress** in
`docs/data-retention-scoping.md`. This is the work behind open decision **3c**,
and the privacy policy's retention section can't be finalised until its key
decisions lock.

The shape: three data layers with different lifespans — competition-instance data
(disposable when a competition closes), player/role identity data (kept a grace
window to ease rejoining), and de-identified performance data (kept indefinitely
*if* genuinely non-personal). A scheduled job closes competitions on their clock,
dissociates roles and flags users inactive, then after a grace window deletes or
de-identifies, with advance notice first.

**Decisions that gate the build** (detail + Kiro's read in the scoping doc):
- ~~**Soft-delete vs hard-delete.**~~ **RESOLVED 2026-09-01 — see "V1.R —
  SCOPE LOCKED" above.** Hard delete ratified as the real pattern, matching
  the already-shipped Remove action. `deleted_at` is implemented on only
  ONE table — `delivery_records` (coach lesson-delivery audit history) —
  not on any personal data this build touches, so this doesn't conflict
  with the steering "soft delete" convention in practice.
- **CSV, not API (correction 2026-08-19).** League rosters import via CSV from
  Friendly Manager — there is no API (roadmap decision 6 / V1.T).
- **Club close-delay + new edge cases (added 2026-08-19).** When does a Club
  competition close after its last event (2wk/4wk/?), and confirm no auto-close
  exists yet (Q1b); plus lite-users-with-no-team, orphaned pending children,
  backup-retention window, and data export on request (Q8–Q11). All in the
  scoping doc.
- **Anonymised vs pseudonymised performance data** — decides whether "kept
  indefinitely" is a legal claim. Store no FK back to a person for it to be
  genuinely non-personal.
- ~~**Role/status model.**~~ **PARTIALLY RESOLVED 2026-09-01** — the
  original "null the team ref + inactive" lean is superseded by the hard-
  delete decision above for `team_members`. What's left for Part 2 is
  narrower: the *user*-level "no role for 12 months → delete" clock,
  which is a different question (when to delete the person, not the
  membership).
- **Caregiver link handling** — partly answered by the existing
  `player_caregivers … ON DELETE CASCADE`; confirm the intent.
- **Club retention clock** — recommend a rolling 12-month window (one simple rule
  for the policy), not a fixed 31 Dec.
- **Notice before deletion** — warning + export window; ties to the monitored
  privacy-inbox decision.

**Best sized as its own spec once those decisions are locked.** Not small, but each
stage is independent and testable.

---

### V1.T Friendly Manager Import (External Leagues) — SEPARATE TRACK

Independent of the lite-user chain. Only relevant to External League
teams, not Club Tournaments.

**How the club actually operates**:
- The **Federation** owns the competition — name, dates, draws, fixtures.
  All external. We don't build any of that.
- The **Club** forms teams and rosters in **Friendly Manager** (external
  system, **no API** — CSV export only), then enters those teams into the
  Federation's own system separately.
- Today: families check the Federation's website for fixtures, and each
  team manager sets up their own Heja (or similar) for communication. Our
  app has **zero visibility** into any of it.

**Goal**: pull team + roster data out of Friendly Manager and into our
app — ideally a recurring (weekly?) sync rather than a one-off import — so
our app becomes the coaching and communication home for these teams too.

**Next step**: get a sample Friendly Manager export (or a screenshot of
the export screen). The format determines everything — which fields are
available (age group? manager email?), and crucially whether there are
**stable IDs** we can match on for re-import, or whether we have to match
on name/email. Design after seeing real data, not before.

**Likely shape**: a staging table the export is loaded into, then a
reconcile step that applies changes into the main tables. Not designed
yet.

---

### V1.B Club Branding Config — NOT STARTED (standing pattern)

**The point (stated 2026-08-14)**: club-agnostic does **not** mean
generic-looking. The WCR result should look exactly as it does now — the
difference is that WCR's name, logo and colour come from a defined source
rather than being baked into components, so another club can be delivered
by changing data, not code.

**Standing rule for all new build**: at every step, explicitly state
where each piece of club branding (name / text / colour / logo) comes
from. Don't hardcode, and don't silently invent a new mechanism — use the
shared source below. (This rule is also in
`.kiro/steering/project-standards.md` so it applies automatically in
future sessions.)

**Live hardcoded branding — the actual list (audited 2026-08-14)**:

| File | What's hardcoded |
|------|-----------------|
| `src/pages/Login.tsx` | "West Coast Rangers FC" |
| `src/layouts/MainLayout.tsx` | "Urrah" + subtitle |
| `src/layouts/DesktopLayout.tsx` | logo PNG import, "WCRF Admin", "Urrah", `#0091f3` header |
| `src/lib/invites-api.ts` | a comment only — harmless |

Smaller than it first appears: a lot of WCR references live in
`src/app/**`, which `docs/deployment/DEPLOYMENT.md` marks as dead/unused
code. Ignore those.

**Both open questions now RESOLVED (2026-08-14)**:
1. ✅ **"Urrah" is configurable** — it's a club-specific term, so it
   becomes part of the branding config, not a hardcoded product name.
2. ✅ **The six page colours are product-standard, NOT configurable** —
   Coaching green, Games orange, Resources purple, Schedule cyan,
   Messaging grey stay fixed for every club. They're semantic product
   design, not club identity. **Only the primary/header colour is club
   branding.**

**Agreed approach**:

A single-row `club_settings` table, editable without redeploy, which
naturally becomes the `clubs` table when full multi-tenancy arrives
(V2/V3 backlog) rather than being thrown away:

| Field | Example (WCR) | Used by |
|-------|--------------|---------|
| `club_name` | "West Coast Rangers FC" | Login page, email footer |
| `club_short_name` | "WCRF" | Desktop sidebar ("WCRF Admin") |
| `app_title` | "Urrah" | Mobile + desktop header |
| `app_subtitle` | *(current MainLayout subtitle)* | Mobile header |
| `logo_url` | the gannet PNG | Sidebar, headers, login |
| `primary_color` | `#0091f3` | Header background, primary buttons |
| `app_url` | `https://...` | Email links, deep links |

**Explicitly NOT in the table** (product design, same for all clubs): the
six page colours, typography, layout, iconography.

- A `useClubBranding()` hook so components read from one place.
- **Edge Functions keep using env vars** (as `send-email` already does) —
  a DB round-trip per email adds latency and needs service-role access.
  Accepting a small duplication between env vars and the table is
  simpler than the alternatives; worth noting rather than hiding.
- **Logo** needs somewhere to live — currently a bundled PNG import.
  Options: keep bundled per-deployment, or move to Supabase Storage so
  it's swappable without a rebuild. Storage is the better fit for the
  table-driven approach; not yet decided.

**Sequencing**: no need to build this before V1.2/V1.3. It matters when
V1.4 (Team page) and V1.6 (invite landing page branding) get built, since
those are new UI that would otherwise hardcode more WCR references.

---

### Adult / Child User Model — CONFIRMED & EXPANDED (2026-08-18)

Foundational for the Team page (V1.4), the Friendly Manager import (V1.T)
and the **privacy policy** (V1.9). Builds on the 2026-08-14 Junior Player
model below, which stands — this section confirms it and adds the consent
architecture.

**Age split**: adults are **U17 and up**, children are **U16 and down**.
The band comes from `teams.age_group`, not a per-player DOB (we deliberately
do **not** collect birthdates — see point 4 below).

> **Superseded 2026-08-21** — the Add Player / DOB age model spec now
> collects DOB per-person (adults self-declare at invite redemption;
> children's DOB is recorded when added as a Junior) and uses it as the
> primary age signal, falling back to `teams.age_group` only when no DOB is
> on record. This section's reasoning (privacy-minimal, avoids collecting
> birthdates) is kept below for the historical "why," but is no longer the
> current behaviour — see the dedicated section near the top of this file.

#### Model A CONFIRMED — child never logs in, caregiver is the account

A child (U16 and down) is a **data record, not a login**. They get a real
`users` row with a synthetic email, but they **never sign in and never
interact with the app directly**. The **caregiver's** account is the active
one — it receives all notifications, messages and schedule updates and acts
on the child's behalf.

Model B (children interacting directly) is **explicitly rejected for V1**:
it drags in child logins, messaging safeguarding, contactability and a far
larger privacy surface. Not a V1 conversation.

**Future direction (V2/V3, noted 2026-08-18) — a scoped child view.** If we
later want children to see e.g. their next game, we handle it *separately
and simply*, as a deliberately limited, opt-in experience gated on explicit
caregiver authorisation. The idea: with the caregiver's approval, a child
gets read-mostly access to a **narrow slice** of the app for **their team
only** — roughly the Team tab, the Calendar/Schedule tab and (team-only)
Messaging, or similar. This is **not** the same as full Model B: it's a
constrained, caregiver-authorised child mode, not a general child login.
Recorded so the V1 model doesn't foreclose it — the synthetic-email junior
record and the `player_caregivers` link are compatible with bolting a
limited child login on later. Out of scope for V1; safeguarding and the
per-tab access rules would need their own design.

Every child **must** be linked to at least one caregiver (an adult). The
link table `player_caregivers` (many-to-many, so more than one caregiver is
allowed) already supports this.

#### Two-path consent — CONFIRMED

**Who is responsible for a child's authorisation depends on how the child
entered the system, and that path is already encoded in the team type:**

| Path | Team type | Consent responsibility | Consent record |
|------|-----------|------------------------|----------------|
| **Import** | External League (club-managed, read-only in app) | **Upstream — the club.** The club's own systems managed authorisation before the data reached us. The fact the club supplies a child record is the assertion it's authorised. | Club's assertion at import time; **no** `caregiver_approvals` row |
| **Self-service** | Club Tournament (manager adds in-app) | **Ours — we capture it.** No upstream system exists. | A `caregiver_approvals` row (`status='approved'`, `responded_at`) is the provable consent record |

**Both paths still need a caregiver *link*** (child never logs in, so
notifications must reach an adult) — but only the tournament path runs the
**approval** step. Import relies on the club's upstream consent and just
stores the caregiver contact for notifications.

#### Points to carry into the V1.4 spec and the privacy policy

1. **Record provenance per child** — which path a child came in on
   (inferable from team type today; make it explicit for audit).
2. **Capture the club's assertion for imports** — record that the club
   warrants it holds consent, at import time. Protects the app; our
   position is "the club is the source of truth," not "we obtained it."
3. **Confirm the Friendly Manager export includes caregiver contact**
   (blocked on the export sample — Decision 6). Without it, imported
   children have nowhere to send notifications.
4. **No DOB collected** — age band is by `teams.age_group`. Privacy-
   friendly but approximate; accepted edge case: a 17-year-old in a U15
   team is treated as a child. State this deliberately in the policy.
5. **Minimal child data** — first/last name only. No contact, no DOB, no
   photo. Enforce in the add-a-junior form. "We hold only a child's name"
   is a strong, simple privacy claim.
6. **Active consent vs notification (tournament path)** — the child record
   should be **inactive until the caregiver approves** (double opt-in), not
   active-on-entry. Strongest position and the schema supports it.
7. **If consent never comes** — define what happens to an unapproved child
   record and after how long (ties to Decision 3c: app has no delete, only
   "mark inactive"). The policy can't be finished without this answer.
8. **Multiple / separated caregivers** — two caregivers are allowed. Do
   both have equal rights; can either remove the other? Don't need to fully
   solve for V1, but UI and policy must not assume exactly one caregiver.
9. **Dual roles** — a caregiver is often also a coach/manager. One person
   must be caregiver + coach at once; the Team page must render them
   sensibly (once, all roles listed).
10. **Age-boundary transition** — when a child moves to U17/Open, define
    the path from caregiver-proxy to their own login (manual in V1 is fine).
11. **Child consent timestamp** — adults get `privacy_consent_at` on their
    own row; a child's "authorisation to be here" is the caregiver's
    approval. Point at `caregiver_approvals.responded_at`, or copy a
    consent timestamp onto the child row, as the auditable record.

**Legal caveat**: the privacy-law framing (valid parental consent,
controller vs processor, retention obligations) needs review against the NZ
Privacy Act and the app-store children's policies before launch. The model
above is the data/flow design, not legal advice.

**Schema already supports all of this — no change needed**: `users`
(synthetic-email juniors), `player_caregivers` (the link),
`caregiver_approvals` (pending→approved→denied→escalated, with
`requested_by` / `responded_by` / `responded_at`).

---

### Reference — Junior Player User Model (DECIDED 2026-08-14)

Not a task; a decision that feeds into V1.4 and V1.T.

**Problem**: most players U16 and below have no email address or phone of
their own, but every `users` row requires an `auth.users` row (i.e. an
email and the ability to sign in).

**Agreed approach**:
- Juniors **get a real `users` row**, but **never log in themselves**. The
  caregiver's account is the active one that receives notifications,
  messages and schedule updates.
- **External League**: data arrives via Friendly Manager import; admin
  creates the row with a synthetic email (e.g.
  `player-{uuid}@app.internal`) since the child won't sign in.
- **Club Tournament**: when a manager adds a junior via the Team page, the
  form captures the **caregiver's** real details (name, email, phone) plus
  the **child's** minimum data (first/last name), producing:
  - a caregiver user (real email — they sign in)
  - a player user (synthetic email — never signs in)
  - a `player_caregivers` link between them
- The junior's `cellphone` stays empty; the Team page shows the
  caregiver's contact details beside the child's name instead.
- **Age threshold** comes from `teams.age_group`, not per-player DOB
  (there is no DOB field). U17/Open → player's own phone. U16 and below →
  caregiver's. Edge case accepted: a 17-year-old in a U15 team would show
  caregiver info.
  **Superseded 2026-08-21** — see the correction note under "Adult / Child
  User Model" above: DOB is now collected and is the primary age signal.
- **No schema change needed** — `users`, `player_caregivers` and
  `caregiver_approvals` already support all of this. It's purely a
  UI/flow question.

---

## V2 — Already Built, Valuable, Not Blocking Launch

Everything below was previously tracked as "Outstanding Work" — all of it
is real, done or partly done, and worth coming back to. None of it blocks
getting V1 in front of real users.

### What's Built (Complete, as of pre-2026-08-13 work)

| Feature | Status | Notes |
|---------|--------|-------|
| Mobile app (all 6 areas) | ✅ Complete | Landing, Coaching, Games, Resources, Schedule, Messaging |
| Desktop admin (all 12 areas) | ✅ Complete | Includes Reporting, Competitions, Tournaments |
| Authentication & RBAC | ✅ Complete | 5 roles: player, caregiver, coach, manager, admin |
| Team Messaging | ✅ Complete | Realtime, threads, archive, reactions, read receipts |
| Game Day Subs | ✅ Complete | Live timer, rotation alerts, coach strategy mode |
| User Role Management | ✅ Complete | Dual role system, lite users, invite codes |
| Lesson Builder CRUD | ✅ Complete | Create, edit, copy, allocation system |
| Admin Reporting (Phase 1+2) | ✅ Complete | 6 reports: delivery, coach activity, team training, lesson effectiveness, session ratings, game feedback |
| Tournament Management (Phase 1) | ✅ Complete | Round-robin, standings, fixture generation |
| Academy Lessons (Bailey) | ✅ Complete | 38 lessons, 152 sessions (migrations 028-030) |
| Community Lessons (U9) | ✅ Complete | 16 lessons across 8 skills |

### V2.1 Tournament — Needs User Testing
**Status**: Code complete, not yet tested with real data

**New field research to review (2026-09-01)**: `docs/project/TOURNAMENT-REFERENCE-2026.md`
— the repo owner's on-site observations from a live secondary schools
tournament (Rex Dawkins Tournament, Huapai) running on Friendly Manager,
captured specifically to inform how this app's own tournament feature
should evolve for V2. Covers how that tool handles a Summary/Draws/Teams/
Placements split, domain/pitch visibility, live in-line score entry,
personalized per-team schedules with played-vs-pending colour coding, and
time-slot grouping for parallel games — plus a list of open questions
(score-entry workflow, notifications, standings/advancement rules,
offline/pitch-side considerations, multi-division management). Worth
reading before doing any further design work on this item.
**Steps**:
1. Run migration `040` in Supabase SQL Editor
2. Create a Club Tournament on Competitions page
3. Add 3+ teams (use "Add Tournament Team" for external teams)
4. Go to Tournaments page → configure format (Single Round Robin)
5. Set match day dates, start time, duration, venue, pitches → Generate Fixtures
6. Verify fixtures appear grouped by round
7. Verify standings table shows all teams at 0-0-0-0
8. Record scores on Games page → verify standings update
9. Test mobile `/tournaments` page (standings + fixtures tabs)
10. Test lite user invite flow: create tournament team → share link → register

### V2.2 Schedule/Games ↔ Tournament Integration
- Add competition name badge on tournament fixtures in Schedule page
- Add "Tournament" filter to Schedule event type filter
- Add competition indicator on Games page for tournament fixtures
- Trigger standings recalculation when score saved from Games page

### V2.3 Reporting Phase 3
- PDF export for reports
- Session Popularity report
- Lite Users report

### V2.4 Team Messaging — Needs Live Testing
- Thread detail view, reply, archive/unarchive
- Realtime subscriptions working
- Desktop two-panel layout
- UnreadBadge in bottom nav

### V2.5 Game Day Subs — Needs Live Testing
- Live count-up timer
- Substitution alerts (orange banner + audio beep)
- Coach strategy mode
- Playing time bars
- Guest players

### V2.6 Academy Lesson Images — Pending Bailey
- 13 slides still missing scraped content (Bailey needs to re-scrape)
- Images not yet uploaded to Supabase Storage
- See `docs/lessons/ACADEMY-MIGRATION-PROGRESS.md` for full status

### V2.7 Gant — AI Coaching Feedback Assistant (docs only, added 2026-08-25)
**Status (updated 2026-09-04)**: PULLED FORWARD AND BUILT INTO V1. The
`gant-ai-feedback-assistant` Kiro spec Tasks 1–9 are built — the capture →
refine → review → approve loop, pending queue, person-detail notes, team
notes, auto-summary, the `gant-refine` Edge Function (deployed), and the
admin guardrails + usage-CSV desktop screen (`/desktop/progress-notes`).
Tasks 1–7 are live-verified; 8 & 9 built and locally verified (uncommitted at
2026-09-04 per the batch-commit preference). User-facing name is "Progress
Notes"; "Gant" stays internal. What remains below is the genuinely-deferred
V2/phase-2 scope only.

Gant is a planned AI-assisted layer (Claude Sonnet 5 via a Supabase Edge
Function) that helps coaches refine dictated feedback into structured,
club-standard commentary — checked against an agreed phases-of-play list,
feedback model, and tone guide — before the coach approves and posts it.
Coach retains full editorial control throughout; Gant never posts
unilaterally and is never disclosed to players/caregivers as the source of
the wording. Two docs capture the design so far, added to `docs/`:

- `docs/project/GANT-AI-REQUIREMENTS.md` — full requirements draft: purpose, model
  choice and why, live/reflective capture flows, the raw→refine→approve
  data flow, offline/no-coverage handling (text-level queue preferred over
  audio), privacy constraints (linked only to a User ID, no name/DOB/contact
  passed to the AI layer), technical architecture (Edge Function holds the
  Anthropic API key as a secret, prompt caching for the guardrails system
  prompt), and open questions/decisions confirmed so far.
- `docs/project/GANT-COACH-GUARDRAILS-CONVERSATION-GUIDE.md` — a working doc for
  running an actual conversation with 3-5 experienced coaches to produce
  the three inputs Gant needs: an agreed phases-of-play list, a feedback
  model (what "good feedback" contains structurally), and a tone/style
  guide for phrasing "areas to work on" well (with real before/after
  examples). Not a technical task — the next step here is a coach working
  session, not code.

**Gant phase-2 / V2 — deferred from the V1 build (spec Task 10).** These were
explicitly parked when Gant was pulled into V1; captured here so they live in
the V2 backlog, not just the spec file:
- **Continuous multi-player dictation** — a coach dictates about several
  players in one flow; the system segments it and fuzzy-matches names against
  the roster, feeding each segment into the same review loop unchanged.
- **Progression review** — Gant flags recurring issues while a coach is
  *writing* a new note (distinct from the read-side auto-summary already built).
- **Session suggestions** — Gant proposes training exercises/drills based on
  the patterns in a player's or team's accumulated notes.
- **Team-page / roster layout redesign** — scope once Gant's additions
  (person-detail link, team-notes link) are in and real crowding is visible.
- **Editable personal fields + the "player can't see their own phone number"
  gap** — a separate future conversation, not a Gant task; the phone-number
  visibility gap is tracked in this file's Team-page notes.
- **In-app "ask Claude to refine the guardrails" button** — considered and
  deliberately deferred (2026-09-04): the V1 admin screen uses an external
  copy-to-Claude workflow; an in-app one-click refine could come later if the
  external loop proves too fiddly.

The naming decision ("Progress Notes", spec Task 10.4) is already resolved and
shipped. Task 0 (coach guardrails refinement) is an ongoing non-code loop, now
enabled by the live admin screen — not a V2 build item.

### V2.8 Admin Reporting suite — deferred from V1 launch (2026-09-04)

**Status**: Built, working, hidden at V1 launch. The 6-page desktop reporting
suite (Lesson Deliveries, Coach Activity, Team Training, Lesson Effectiveness,
Session Ratings, Game Feedback) plus its `DesktopReporting` hub. Removed from
the admin nav + routes for V1 via `src/config/desktopFeatures.ts`
(`reporting: false`) — the code is untouched, so re-enabling is flipping that
one flag back to `true` in V2. Deferred because it's the biggest immature
surface and isn't needed by the launch trial group.

### V2 Backlog (Future)

*(Numbered V2 items live above as V2.1–V2.8; the list below is the unNumbered
future backlog — number these into the V2.x sequence as they get picked up.)*
- Notification preferences UI
- Audit trail for role changes
- RLS policy audit (remove any remaining `user_teams` references)
- SMS gateway integration (Twilio/AWS SNS)
- Bulk CSV user import UI
- Session Builder save functionality
- Admin-configurable venue list
- Tournament Phase 2: Knockout brackets, group stages, referee assignment
- Tournament Phase 3: Public view, online registration, Stripe payments
- Invite code deep links (App Links/Universal Links) — Step 3 of Capacitor scoping doc
- Multi-club support — if another club wants to adopt this app, needs a
  `clubs` table above `teams` and per-club branding/theming (currently
  hardcoded to West Coast Rangers). Not designed for today; App ID
  (`com.clubfootball.app`) was deliberately kept generic so this option
  stays open.

---

## Key Files

| Purpose | Location |
|---------|----------|
| Project standards + deployment rules | `.kiro/steering/project-standards.md` |
| Capacitor/push notification scoping | `docs/project/CAPACITOR-SCOPING.md` |
| Mac session checklist (device testing) | `docs/project/MAC-SESSION-CHECKLIST.md` |
| Feature history | `CHANGELOG.md` |
| Session-by-session decisions | `CONVERSATION-HISTORY.md` |
| Deployment instructions | `docs/deployment/DEPLOYMENT-GUIDE.md` |
| Bailey lesson progress | `docs/lessons/ACADEMY-MIGRATION-PROGRESS.md` |
| Lesson creation guide | `docs/lessons/LESSON-CREATION-GUIDE.md` |
| Original handover spec | `docs/project/KIRO_HANDOVER.md` |
| Push notification Edge Function setup | `supabase/functions/send-message-push/README.md` |
| Historical rollout plan (superseded) | `docs/project/PROJECT-ROLLOUT.md` |

---

## Docs Structure

```
docs/
  project/        ← planning, requirements, analysis docs
  deployment/     ← deployment, setup, troubleshooting
  lessons/        ← Bailey content, lesson guides, image prompts
    image-prompts/  ← U9 image prompt files
  archive/        ← old/superseded docs
```


---

## Modal layout — TASK 3, still open (this is the detail behind that pointer)

**Fixed already (`8d699de`):** the Add Junior modal's buttons were hidden behind the
bottom nav (equal `z-50`, nav painted on top) and the form couldn't scroll to
them. Now uses the proven mobile modal pattern from `src/pages/Schedule.tsx`:
`z-[60]`, `max-h-[85vh]`, `flex flex-col` with a pinned header, a
`flex-1 overflow-y-auto` body, and a pinned footer. Confirmed working.

**Still to check — other mobile modals may have the same overlap.** Several still
use the older centered `p-6 max-h-[90vh] overflow-y-auto` style at `z-50`, which
can sit behind the bottom nav on a tall form. Known candidates:
`src/components/SessionFeedbackModal.tsx`, and any mobile-route modal not already
on the Schedule pattern. **Do a cheap sweep** — grep for `max-h-[90vh]` /
`z-50` modal overlays on mobile routes and align them to the Schedule pattern —
rather than fixing reactively one bug report at a time.
