# Changelog

All notable changes to the football coaching app prototype will be documented in this file.

## [2026-09-08] - V1.6: Invite landing page — branding & context

### Changed
- **The invite link now looks like your club, not a bare form.** When someone
  opens an invite they land on a branded page — the club logo, name and colour
  in the header — instead of a plain white "Join {team}" box, so it reads as
  legitimate rather than a phishing page.
- **It says what you're joining.** The competition is now shown prominently
  ("Join {competition}", with the team beneath), and a short intro explains what
  the app is and what happens next once you're in.
- The branded, consistent look now carries across every version of that page —
  the form, the error screens, the "ask your manager" outcome, and the "you
  already have an account" screen.

### Technical Notes
- The invite page is anonymous (visitor isn't logged in yet), but `club_settings`
  (migration 046) and `competitions` were `authenticated`-only, so neither the
  branding nor the competition name could load. **Migration `076` (run manually)**
  adds anon `SELECT` on `club_settings` (single-row, public-facing branding) and
  a scoped anon `SELECT` on `competitions` limited to those referenced by a live
  invite (mirrors migration 045's teams policy) + an `invite_codes(competition_id)`
  index.
- `invitesApi.validateInviteCode` embeds `competition:competitions(name)`;
  `InviteCodeValidation` gains `competition?: { name } | null`.
- `LiteLandingPage.tsx`: new `InvitePageShell` (branded header, club-agnostic —
  omits any absent value, neutral fallback when branding is missing) wraps the
  form / error / bounce / existing-user states; competition-aware heading +
  intro copy added to the form.
- **Deploy:** run migration `076` in the Supabase SQL Editor — branding +
  competition context won't appear for anon visitors until it's applied.
- Verified: scoped `tsc` clean, `npm run build` clean, vitest 254 passing (2
  env-gated redeem-invite tests unchanged). Commit `b8b9c61`.

## [2026-09-08] - V1 correctness pass: caregiver age band, coach count, add-player UX, email branding

### Fixed
- **Managing a child's caregivers now works even when the child is on an adult /
  Open team.** Whether the "Add / Manage Caregivers" controls appear follows the
  individual person's age (from their date of birth), not the team's age group.
  A genuine under-16 registered on an Open team is treated as a child, as they
  should be — previously they were blocked from caregiver management entirely.
- **The Coaching page's "Active Coaches" now counts everyone who actually
  coaches.** It previously counted only accounts whose top-level role is "coach",
  so a coach promoted on a specific team (or a manager who also coaches) wasn't
  counted — it could read as low as 1. It now counts each distinct active person
  with coaching authority on any team.
- **Add Player shows you the problem when a field is invalid.** If a required
  field below the visible area was wrong, clicking Continue looked like it did
  nothing; the form now scrolls to and focuses the first field that needs fixing.

### Changed
- **Club branding in emails now comes from your club settings, not a fixed
  value.** The email header (club name and colour) and the app link are read from
  the same club settings the app itself uses, so they stay correct for any club.
  (Requires the email function to be redeployed to take effect.)

### Technical Notes
- Caregiver age band: added a per-person `ageBand` to `RosterMember` /
  `RosterEntry` (`roster-logic.ts`), populated via `deriveAgeBandForPerson` in
  `TeamPage.fetchRoster`; `isChildBandPlayerRow` now reads `entry.ageBand`
  instead of the team-level `roster.ageBand`.
- Fixed a build-invisible TS error in `teams-api.ts` (`getMyTeams`'s synthetic
  pending-child membership was missing `is_coach`).
- Active Coaches: counts distinct active users from `team_members` where
  role='coach' OR is_coach, deduped in JS (one person can coach several teams).
- `AddPlayerModal`: `scrollToFirstError` wired into all three validation-failure
  paths, using the existing `add-player-<field>` ids (no refs).
- `send-email` Edge Function: resolves `club_settings` (club_name /
  primary_color / app_url) server-side via a service-role client, with the
  `CLUB_*` env secrets + hardcoded defaults as fallback; server-side read only,
  so "branding never from the request body" (Req 2.6) still holds. **Deploy
  required:** `supabase functions deploy send-email` (does not take effect on git
  push; not locally type-checkable — no Deno).
- Verified: scoped `tsc` clean, `npm run build` clean, vitest 254 passing (2
  env-gated redeem-invite tests unchanged).
- Commits: `997f650` (four client fixes), `ed55caa` (email branding).

## [2026-09-04] - Users admin: remove vestigial lite/full UI

### Changed
- **Removed the "Lite" badge, the Full/Lite filter, and the "Promote to full"
  button from the Users admin.** They implied a capability difference that
  doesn't exist: a "lite" user has the same access as a "full" one (navigation,
  permissions and data are all role/team-based, not `user_type`-based). Nothing
  a user can do changes when promoted.

### Technical Notes
- `UserManagement.tsx`: removed the badge, the `filterUserType` state + filter,
  and `handlePromoteToFull`. The `user_type` column, `rolesApi.promoteToFullUser`,
  and the tournament "Cleanup Lite Users" action are left in place, to be
  superseded by the data-retention workstream (which removes team memberships,
  not whole accounts). Decision + retirement path recorded in
  `docs/data-retention-scoping.md`. Commit `9061382`.

## [2026-09-04] - V1.8: Admin desktop console rework

### Changed
- **The admin desktop menu is now one simple list.** The old "Main / Admin"
  split is gone, along with menu items you didn't need at the top level
  (Games, Session Builder, Lesson Builder, Tournaments, Caregiver Reviews).
  What's left is the set of pages an admin actually works from, in a sensible
  order. The builders are still there — you reach them from the Coaching page —
  and a competition's fixtures open from that Club Event.
- **The Coaching page shows real numbers.** Total lessons and total sessions
  are now live counts instead of placeholder figures, and a mock "recent
  activity" panel that never did anything was removed.
- **The Users list is cleaner.** Dropped the empty Team column; each person
  shows a single highest-role badge. Child / device accounts now show a
  "Child / device access" pill and the caregiver's name and contact, instead
  of the internal placeholder email.
- **A person's detail view now lists every team and role they hold,** lets you
  edit their name and phone, appoint them as an admin, jump straight to a
  player's Progress Notes, and click through to a team. Delete is only offered
  once someone holds no team roles (the actual delete stays parked with the
  retention work).
- **Caregiver Reviews now lives inside the Users page** as a tab with a pending
  count, rather than its own menu item.
- **The Teams page shows each team's manager,** and greys out teams whose
  manager invite is still outstanding with a "Pending" badge and the invite
  date. You can now **assign a manager** right from a team: search for an
  existing person (type-ahead) or invite one by email, capped at two managers
  per team.
- **Competitions is split into External Leagues and Club Events.** Team names
  click through to that team, "Invite" reads "Reinvite" where a resend is what's
  needed, and each Club Event has a "Fixtures & standings" button.

### Technical Notes
- No new migrations — entirely client-side over the existing schema.
- Spec: `.kiro/specs/admin-console-v1.8/` (requirements / design / tasks).
- `DesktopLayout` is now a data-driven flat `NAV_ITEMS` list (inline-style accent
  colours to dodge Tailwind dynamic-class purging). Reporting stays hidden behind
  the existing `desktopFeatures` flag.
- Teams manager/pending derived from `team_members` (role='manager') +
  outstanding `invite_codes` (`intended_role='manager'`, `redeemed_by IS NULL`,
  unexpired); assign reuses `rolesApi` / `invitesApi.generateInviteCode` and
  surfaces the migration-048 `manager_cap_reached` guard as a friendly message.
- Cross-page click-throughs use query params (`teams?team=<id>`,
  `tournaments?comp=<id>`).
- Mobile in-field paths confirmed at code level: `tabsForRole` gives admins the
  Coaching tab (`ProtectedRoute` mirrors it) and `resolveCapabilities` grants an
  admin full roster role actions on Club Tournament teams (External League stays
  read-only for everyone by design).
- Two follow-ups recorded in the spec's Deferred list: broaden the "Active
  Coaches" count to coach-authority (team_members role='coach' OR is_coach), and
  the V2 coaching-activity dashboard (lesson deliveries + feedback).
- Verified: `npm run build` clean; vitest 254 passing (2 env-gated
  `redeem-invite` tests unchanged).

## [2026-09-04] - Messaging: reach the club admins; admin console tidy

### Fixed
- **You can now message the club admins.** Choosing "Club Admin" when composing
  a message used to silently do nothing — a message to the admins has no team,
  but the system required one. Now it sends, lands in a shared admin inbox, and
  the person who sent it will see the admin's reply.

### Changed
- **Admin desktop console tidied.** The Reporting suite is hidden for the launch
  trial (it's built and will return post-launch). Removed a large block of dead,
  duplicated scaffolding code and a couple of debug leftovers — no change to any
  feature you use, just less clutter behind the scenes.

### Technical Notes
- Messaging fix: migration `075_messages_admin_inbox.sql` makes `messages.team_id`
  nullable, allows team-less messages from any authenticated user, and adds a
  `SECURITY DEFINER` `message_thread_root_sender()` helper so the thread's
  original sender can read replies without reintroducing the migration-035 RLS
  recursion. Client: `ComposeForm` sends a null team for Club Admin; `getThreads`
  includes team-less threads; `team_id` is nullable on the messaging types.
- Reporting hidden via a new `src/config/desktopFeatures.ts` flag (one-line
  re-enable). Deleted the orphaned `src/app/` tree (~12k lines) and the unused
  `pages/desktop/Reporting.tsx`. Full detail in NEXT-SESSION-NOTES (V1.8 / V1.M /
  V2.8).

## [2026-09-03] - Gant / Progress Notes: live-test polish batch

### Fixed
- **Progress Notes could fail to save on some teams.** The team picker in the
  pending queue offered teams you're only linked to as a caregiver; saving a
  note there was correctly refused by the database. The picker now lists only
  teams you coach or manage.
- **A note could silently fail to save even on your own team.** A latent bug
  made the Save action reference the wrong record; the underlying event is now
  created correctly so Save works from the review screen.
- **Duplicate teams in the Coaching and Games dropdowns.** If you both coach a
  team and are a caregiver of a child on it, the team now appears once instead
  of several times.

### Changed
- **Capture sheet is clearer.** "Done" is now "Close"; a persistent banner
  confirms how many notes you've captured (rather than a quick flash that
  looked like nothing happened); short helper text explains that you capture
  each note then close and refine from the queue. Closing with un-captured
  text now asks before discarding it.
- **Review screen guides the right next step.** When you've typed more into
  "Add more", Save is hidden and "Work on" is highlighted, so your addition
  is folded in by Gant rather than being lost.

### Technical Notes
- All client-side — no Edge Function redeploy required for this batch.
- Full detail in `.kiro/specs/gant-ai-feedback-assistant/tasks.md`
  ("Second live-test batch") and `NEXT-SESSION-NOTES.md`.

## [2026-09-02] - V1.R Part 1: fully live-verified, all 4 migrations run in production

Full checklist worked through live against the real Supabase-backed app
(migrations 064-067 run in the SQL Editor, both patches applied and
pushed) after the Coaching-tab follow-up below. Everything in scope now
confirmed working:

- **Make Coach** — confirmed for both a plain Player (Hewie Duck: global
  role flips `player` → `coach`, gets Coaching+Games) and an existing
  Manager (George Pig: stays global `manager`, gains Coaching via the
  `hasCoachAuthorityOnAnyTeam` fix below). Client-side role caching in
  `AuthContext.tsx` means a logged-in user needs a refresh/re-login to see
  their own updated header/nav — expected SPA behaviour, not a bug.
- **Stop being Coach** and **Demote to Player** — both confirmed
  (Mortimer Mouse demoted to Player, "Make Manager" un-greys correctly for
  the next candidate).
- **First-Manager protection** — confirmed in both directions: an Admin
  (Mike Brooke) could not Demote or Remove George Pig while he was the
  team's first Manager; George successfully demoted himself.
- **Team-scoped RLS (migration 065)** — not independently demonstrable
  through the normal UI (the team selector only ever lists teams you
  belong to, so there's no "wrong team" screen to click into as a lower
  read to try). Accepted as covered by code review plus the policy
  migration running cleanly, consistent with the existing Remove-action
  Edge Function's already-privileged access being unaffected.
- **Child-must-have-a-caregiver invariant (migration 067)** — the normal
  UI path to test this (Manage Caregivers / Remove Caregiver on George
  Pig, an actual child) turned out to be blocked by a separate,
  pre-existing bug (see below), so verified directly instead: a manual
  `DELETE FROM player_caregivers` on George's only caregiver link
  correctly failed with `ERROR: P0001: player_requires_a_caregiver` /
  `HINT: This is the child's only caregiver...`, exactly as designed.

**New bug found along the way, NOT fixed this session** — `TeamPage.tsx`'s
`isChildBandPlayerRow` (gates "Add Caregiver"/"Manage Caregivers"
visibility) checks the TEAM's `roster.ageBand`, not the person's own —
`roster-logic.ts`'s per-person `ageBandFor(dateOfBirth)` is already used
correctly elsewhere on the same page for contact display. Confirmed live:
George Pig (real DOB 2013-05-07, genuinely 13/child) registered on an
"Open" (adult-band) team never shows "Manage Caregivers" to anyone,
Admin included. Pre-existing, unrelated to V1.R's locked scope — captured
as a new build-order item in `NEXT-SESSION-NOTES.md` rather than fixed
now.

**V1.R Part 1 is now fully done and live-verified.** No further build
work planned against it; V1.R Part 2 (deferred items) remains a separate,
later piece of work.

## [2026-09-02] - V1.R Part 1 follow-up: Coaching tab for a Manager who is also a Coach

Found live-testing V1.R Part 1 immediately after the migrations were run:
Make Coach on George Pig (a Manager) correctly set `is_coach = true` and
showed both badges on the roster, but his own bottom nav never gained the
Coaching tab — only Hewie Duck's test (a plain Player made Coach) picked
it up. Root cause: migration 066's role-sync trigger deliberately gives
Manager precedence over Coach when computing the single global
`users.role`, so a Manager+`is_coach` person's global role stays
`'manager'` and `main-layout-logic.ts`'s `tabsForRole` (`showCoaching =
role === 'coach' || role === 'admin'`) has nothing to trigger on. This is
exactly the "first Manager also makes themselves Coach" scenario the
whole feature was built for, so it needed fixing immediately rather than
filing it away.

- **`tabsForRole`** (`main-layout-logic.ts`) — new third parameter,
  `hasCoachAuthorityOnAnyTeam` (defaults to `false`, so every existing
  call site is unaffected): `showCoaching` is now `role === 'coach' ||
  role === 'admin' || hasCoachAuthorityOnAnyTeam`. 3 new tests.
- **`MainLayout.tsx`** — derives that flag from the already-fetched
  `user.teamMemberships` (`some(tm => tm.role === 'coach' ||
  tm.is_coach)`) — no new query needed, `AuthContext` already loads every
  team membership row (including `is_coach`) alongside the profile.

Client-only fix, no new migrations. Verified via `npx vitest run` (239
passing, 2 pre-existing skips) and `npm run build` (clean). Not yet
re-tested live — needs George Pig to refresh his session and confirm
Coaching now appears, mirroring how Hewie Duck's fix was confirmed.

## [2026-09-01] - V1.R Part 1: role model & RLS fix (Make Coach, Demote, team-scoped RLS, role-sync trigger, caregiver floor)

Built following the repo owner's explicit "yes lets buiold the patch!"
go-ahead, after a full scoping pass (see `NEXT-SESSION-NOTES.md`'s "V1.R —
SCOPE LOCKED, 2026-09-01" section) resolved via `AskUserQuestion` and
follow-up discussion — hard delete ratified as the retention pattern,
global `users.role` stays a stored+synced field, Coach stays uncapped, and
both of item B/C's open questions (first-Manager parity for Demote;
`UserManagement.tsx`'s role editor) were explicitly settled.

**Not yet live-tested or deployed** — verified via `npx vitest run` (236
passing, 2 pre-existing skips) and `npm run build` (clean), matching this
project's usual pre-delivery bar, but nothing here has touched the actual
Supabase project yet. No Edge Functions changed, so no `deno check`/`deno
lint` step was needed this time.

- **`is_coach` (migration 064)** — an additive boolean on `team_members`,
  independent of `role`. Lets one person hold `role: 'manager'` (or
  `'player'`) AND Coach authority on the SAME team without a second row
  (blocked by `team_members`'s existing `UNIQUE(team_id, user_id)`).
  `role='coach'` keeps its exact current meaning; several live Edge
  Functions (`bulk-create-users`, `create-user`, `redeem-invite`) and read
  paths (`reporting-api.ts`, `messaging-api.ts`, `usePermissions.ts`) still
  use it directly and are untouched by this patch — "effectively a coach"
  for every NEW check added here is `role IN ('coach','manager') OR
  is_coach = true`.
- **Team-scoped `team_members` RLS (migration 065)** — replaces migration
  036's unscoped policy (any global admin/coach/manager could write to
  ANY team's roster) with a `SECURITY DEFINER` function,
  `user_can_edit_team(target_team_id)`, checked per team. Closes a real
  gap the previous Remove-action patch had already flagged and routed
  around via a privileged Edge Function rather than fix directly.
- **Role-sync trigger (migration 066)** — `AFTER INSERT OR UPDATE OR
  DELETE ON team_members` recomputes the affected user's global
  `users.role` (manager > coach/is_coach > player, falling back to
  caregiver/player with zero memberships), skipping Admins (manual-only).
  Fixes a confirmed real bug found live-testing 2026-09-01: promoting a
  member to Coach via direct SQL left their header/bottom-nav tabs
  (`main-layout-logic.ts`'s `tabsForRole`) still reading "player."
- **Child-must-have-a-caregiver invariant (migration 067)** — a `BEFORE
  DELETE` trigger on `player_caregivers` blocks removing an under-16
  player's last remaining caregiver link outright, rather than only
  flagging it after the fact (migration 056/063's existing
  `admin_action_items` review row still fires too). Adults (16+) are
  unaffected — migration 062's self-removal path can never hit this.
- **"Make Coach" / "Demote to Player" / "Stop being Coach"** (`TeamPage.tsx`,
  `permissions-logic.ts`'s new `canDemoteFromManager`/`canRemoveCoachFlag`,
  `roles-api.ts`'s new `setCoachFlag`) — the roster's two other missing
  role-management controls, alongside the existing Make Manager/Remove.
  Demote mirrors Remove's exact self-or-edit-authority + first-Manager
  rule (agreed explicitly, to avoid trivially bypassing Remove's own
  protection). Make Coach/Stop-being-Coach have no first-Manager concept —
  `is_coach` isn't the `role` column.
- **`UserManagement.tsx`'s role editor** — now read-only for the derived
  values (player/caregiver/coach/manager), with a separate "Admin access"
  checkbox as the only manually-editable piece, matching the repo owner's
  description of how role changes actually happen in practice (roster
  actions, or an Admin "fixing something that went wrong").
- **Cross-team multi-role explicitly checked, confirmed unaffected** — a
  person holding different roles on different teams (e.g. Manager on one
  team, linked caregiver on another, Coach+Manager on a third) was flagged
  by the repo owner as a must-not-break case; every change above is scoped
  either per-`team_id` (RLS) or reads across all of a user's memberships
  without mutating any of them (the sync trigger), so this is unaffected.
- **New gap found, flagged not fixed**: `UserManagement.tsx`'s "Edit User"
  save does a plain client-side `users` UPDATE for any user, but the only
  live `users` UPDATE policy (migrations 004/057) is self-only
  (`auth.uid() = id`) — meaning an Admin editing anyone OTHER than
  themselves there (name, phone, active status) is likely silently
  rejected by RLS today. Pre-existing, unrelated to this patch's actual
  ask; needs its own fix (most likely a privileged Edge Function,
  mirroring `remove-team-member`'s pattern).

## [2026-08-31] - New roster "Remove" action, replacing Deactivate for undoing a mistaken add (built autonomously while the repo owner was away)

Built end-to-end following the repo owner's explicit "yes lets get thios
soprted!" go-ahead (full design recap in the previous session's discussion,
now superseded by "DECIDED, NOT YET BUILT — Roster 'Remove' redesign" in
`NEXT-SESSION-NOTES.md`, which this entry marks as now built) and "im
heading off, you work on this in the background!" — no further questions
asked since nobody was available to answer them; judgment calls made along
the way are documented below and in code comments for review.

**Not yet live-tested or deployed** — verified via `npm test` (226 passing,
2 pre-existing skips), `npm run build`, and `deno check`/`deno lint` on the
new Edge Function (all clean), per this project's usual pre-delivery bar,
but nothing here has touched the actual Supabase project yet.

- **`canRemoveTeamMember`** (`permissions-logic.ts`) — self-removal always
  allowed; otherwise Coach/Manager/Admin, no tiering between them, EXCEPT
  the team's first Manager (earliest `team_members` row with
  `role='manager'`, by `created_at`) can only remove themselves. External
  League teams block Remove entirely, same as every other roster-modifying
  action. 6 new tests.
- **`remove-team-member`** (new Edge Function) — the server-side
  enforcement of that same rule, under service role. Deliberately NOT
  relying on RLS: migration 036 already has a blanket
  `team_members` FOR ALL policy letting any global admin/coach/manager
  touch any team's memberships, unscoped — Postgres OR's every applicable
  policy together, so a new, narrower one can't take that access back. This
  pre-existing gap is flagged here and in the Edge Function's own header
  comment as a known, separate issue — not silently fixed (risks breaking
  `roles-api.ts`'s plain `addTeamMember`/`updateTeamMemberRole`/
  `removeTeamMember`, which still rely on it for `UserManagement.tsx`'s own
  team-assignment UI) and not silently ignored either.
- **Cascade (judgment call — flagged for the repo owner to confirm intent
  matches)**: removing a Player's LAST remaining `team_members` row
  anywhere also deletes their `player_caregivers` links; a player still on
  at least one other team keeps their caregiver link, since that link isn't
  team-scoped in this schema and severing it over one team's Remove would
  affect every team they're on.
- **`TeamPage.tsx`**: Deactivate/Reactivate are gone from this page —
  replaced by a "Remove" button per role a person holds on the team (one
  button in the common case; two only if someone holds e.g. both Coach and
  Player on the same team, each gated independently). Two-step confirm via
  new `RemoveTeamMemberModal.tsx`, mirroring `RemoveMyCaregiverModal.tsx`'s
  pattern exactly.
- **`UserManagement.tsx`**: Deactivate/Reactivate now live here instead
  (Admin-only, whole-account), and for the first time are actually wired to
  the database. Found and fixed two pre-existing bugs while doing this: the
  Status toggle/edit-dropdown were bound to a `status` field that doesn't
  exist on the `User` interface (only `active: boolean` does — so neither
  ever had any real effect on save); and the toggle handler itself only
  ever mutated local React state, never calling Supabase. `handleDelete` on
  the same screen is a separate, still-broken, pre-existing no-op —
  deliberately left as-is, flagged in a code comment, since a real "Delete"
  needs its own design decision well beyond this change's scope.

## [2026-08-31] - Zero-click existing-user assignment: confirmed working — the earlier "failure" was a wrong test email, not a bug

Resolved the entry below via direct SQL rather than more guessing (this
project's established discipline, paid off again): querying `auth.users`
and `public.users` for `mandcbrooke1+care2@gmail.com` returned **zero rows
in both** — that address was never a real account at all. `Mortimer
Mouse`'s actual registered email is `mandcbrooke1+care2@gmail.com`'s
neighbour, `mandcbrooke1+care1@gmail.com` (`+care1`, confirmed via a
`public.users` lookup by name). `check-invite-recipient` was answering
"no account" correctly the whole time — the test itself used an address
that had never been created.

Re-tested live with the correct email: Mortimer was added directly, no
invite email sent, no click required from him. **Task 12 item 6's first
call site (Add Player, adult route) is now ✅ confirmed working live.**
Second call site (assign-existing-Manager on Competitions) still needs a
live test; third (Add Caregiver) was already correct before tonight, per
the earlier entry below.

## [2026-08-31] - Zero-click existing-user assignment: still not working live after redeploy, root cause not yet found

Deployed the fix below (`checkInviteRecipient` + `joinExistingAccount` at
Add Player's adult route), then redeployed `check-invite-recipient`
(suspected stale — separate entry below) as the first thing to rule out.
Retested live with a second existing account (Mortimer Mouse, an existing
caregiver) via Add Player: **still got sent a registration invite email**,
meaning the zero-click path did not fire. The fallback did its job (Mortimer
wasn't lost), but the underlying cause is still open. Two candidates, not
yet distinguished: (a) `checkInviteRecipient` is still answering "no
account" for a real account even after redeploying the function, or (b)
`joinExistingAccount` itself throws and the code correctly (if silently)
falls back to the old invite-email path. **Next step**: check the browser
console for a `"Existing-account auto-join failed"` warning (logs the
actual thrown error if (b)); if absent, dig into whether
`public.users.email` and the `auth.users` email GoTrue's admin API matches
on actually agree for these test accounts — a direct SQL check, not an
assumption, given tonight's repeated pattern of assumed-vs-actual gaps.

## [2026-08-31] - Existing-user invites (Add Player adult route, assign-existing-Manager) now complete with zero clicks from the invitee

Found live-testing Task 12 item 6 (existing-user bypass): adding Daddy Pig
(an existing caregiver account) as a Player via Add Player showed the full
"create your account" registration form — new password, DOB, fresh privacy
checkbox — instead of the intended lightweight "you already have an
account, join?" screen from Requirement 2.2. That screen not rendering at
all is a separate bug (see below), but investigating it also raised the
sharper product question directly: does an existing, already-verified
account need to click through *anything* when a Manager/Admin explicitly
names them by email? Product decision: no — the Manager/Admin's own action
is authority enough. There's nothing left for that person to agree to that
they didn't already agree to when their account was first created.

- **Fix**: `AddPlayerModal.tsx`'s adult route and `CompetitionsPage.tsx`'s
  "add tournament team + Manager" flow both now call
  `invitesApi.checkInviteRecipient` right after creating the invite, and if
  the email already has an account, immediately call
  `invitesApi.joinExistingAccount` — the same call the (separate) lite-
  landing "Join" button uses — instead of sending a registration email.
  This is safe because `redeem-invite`'s own existing-profile branch
  already creates nothing and just adds the membership when the email
  matches a real account (confirmed by reading its 2a/3 logic directly, not
  assumed) — `joinExistingAccount` sends a throwaway password that's never
  used and asks the person nothing. Any failure in the check or the join
  falls through to the ordinary invite-email path, so a genuinely new
  person is never affected. `AddPlayerOutcome`/`addTeamResult` both gained
  an `existingAccount` flag so the Manager/Admin sees "added directly, no
  invite needed" instead of an invite code/link with nothing to do with it.
- **Confirmed already correct, no change needed**: the "Add Caregiver to a
  child" call site (both `addJunior`'s caregiver branch and
  `addCaregiverToExistingChild`) already did exactly this — direct
  `player_caregivers` link via `link-player-caregiver`, no invite at all —
  for an existing account. Only the adult Add Player route and the
  assign-existing-Manager flow were still invite-only.
- Verified: `npm test` (220/2 skipped, unaffected), `npm run build`
  (clean). **Not yet live-tested** — and this whole mechanism depends on
  `check-invite-recipient` actually working, which is the same function
  that's separately suspected broken/stale (see next entry) — needs that
  resolved first or this will silently fall back to the old invite-email
  behavior every time.

## [2026-08-31] - "Issue Device Access" screen showed the full registration form instead of the existing-user "Join" screen (suspected stale/undeployed Edge Function)

Found testing the above: `check-invite-recipient` — the Edge Function that
answers "does this invite's email already have an account?" — appears to
be failing, silently, for a known-existing account (Daddy Pig). Its client
wrapper (`invitesApi.checkInviteRecipient`) is deliberately fail-safe: any
error at all is swallowed and treated as "no account found," so the
symptom is just the full form rendering with no visible error anywhere.
Matches this project's repeated "Edge Function code committed to git but
never actually deployed" pattern (`redeem-invite`/`respond-junior-approval`
earlier in this same spec). Asked the repo owner to try
`npx supabase functions deploy check-invite-recipient` first, as the
cheapest explanation to rule out — **not yet confirmed fixed**.

## [2026-08-31] - "Give App Access" replaces "Issue Device Access" on the roster button

Third and last of the parked "Issue Device Access" polish items, built on
request after live-testing surfaced the same feedback again: "token"/
"device" language isn't how a caregiver thinks about this action.
Deliberately not "Give your child app access" — the button is now also
reachable by a Coach, Manager, or Admin (2026-08-31's `canIssueDeviceAccess`
fix, above), for whom the player on that row isn't necessarily "their
child". Loading state changed to match ("Setting up..." instead of
"Creating..."). Button background/styling itself was not touched — not
asked for this pass.

Verified: `npm test` (220/2 skipped, unaffected), `npm run build` (clean).
Pure copy change, no data-layer or Edge Function involvement.

## [2026-08-31] - Task 12 item 5 (device-code redemption + revocation) confirmed fully live

The last outstanding piece of item 5 — generating a second device code and
confirming the first device session gets signed out — was tested live on
George Pig / Daddy Pig once the `canIssueDeviceAccess` fix (above) was
deployed: Daddy issued George's second code, and George's existing signed-in
session was confirmed logged out. Combined with the already-confirmed
steps 1-6 (issuing, fresh redemption, one-time-use rejection), **all of
item 5's device-code mechanics are now confirmed working end-to-end.**
Section 5's step 9 (Admin "Caregiver Reviews" queue, tied to migration 063
above) is a separate check, not yet exercised with a fresh removal.

## [2026-08-31] - Device link box: clearer instructions + a Copy button

Two of the three "Issue Device Access" polish items captured earlier
tonight and explicitly parked ("don't do anything yet, let's just capture
that") — built now on request. Third (button styling/copy on "Issue Device
Access" itself) still parked, not part of this change.

- Copy text changed from "share this with them once. They'll be signed in
  on that device from then on." to "share this with them to open on their
  own device. It'll automatically sign them in to the app on that device
  from then on." — makes explicit that the link is meant to be opened *on
  the child's own device*, not the caregiver's.
- Added a "Copy Link" button under the generated link, same pattern as
  `CompetitionsPage.tsx`'s existing `copyInviteLink` (`navigator.clipboard.writeText`
  + a confirmation `alert`) — no new pattern introduced.

Verified: `npm test` (220 passing/2 skipped, unaffected), `npm run build`
(clean). Pure copy/UI change, no data-layer or Edge Function involvement —
just the client patch, no migration or redeploy needed.

## [2026-08-31] - A 16+ player who self-removes their only caregiver could get permanently locked out of device access

Found immediately after Aella Dog's own "Remove My Caregiver" test
(previous entries): trying to issue her a **second** device code (to check
Task 6's revocation behavior — generating a new code should sign out the
old session) turned up that her caregiver, "Aella mum," could no longer see
the "Issue Device Access" button at all. Correct — the modal warned exactly
that removal means losing visibility into her activity — but tracing it
further showed the button was gated purely on
`myLinkedChildIds.has(entry.userId)`, with no admin/coach/manager fallback
at all. Once a 16+ player has zero linked caregivers, **nobody** —
caregiver, Coach, Manager, or club Admin — could issue them a fresh code.
Harmless today (Aella is still signed in), but a real production lockout
risk: if she ever loses that session (new device, cleared browser), there
was no way back in.

- **Fix**: new pure function `canIssueDeviceAccess` in
  `permissions-logic.ts`, same authority model `canAddCaregiver` already
  uses for this class of problem — a linked caregiver, OR club-wide Admin,
  OR a Coach/Manager on the team, may issue a code (External League teams
  stay read-only for everyone, as always). Wired into `TeamPage.tsx`
  replacing the old caregiver-only check. The real authorization gate
  (`generate-device-code` Edge Function, under service role) got the
  matching fallback: linked caregiver, OR `users.role = 'admin'`, OR a
  `team_members` row with role `coach`/`manager` on any team the child
  plays on — a client-side "show the button" change alone would have been
  unenforceable.
- Verified: `deno check`/`deno lint` on the Edge Function (clean); `npm
  test` (220 passing/2 skipped, 5 new tests); `npm run build` (clean).
  **Not yet deployed or live-tested** — needs `supabase functions deploy
  generate-device-code` alongside the usual `git am` for the client/Edge
  Function code (no migration needed, this is a pure code fix).

## [2026-08-30] - Migration 063: the caregiver-removal admin notification never actually existed live

Found live-testing the new self-service "Remove My Caregiver" feature
(previous entry, same date): Aella Dog's own removal confirmed working
correctly at the data layer — a direct query showed her `player_caregivers`
row genuinely gone — but the Admin "Caregiver Removal Reviews" screen
showed nothing, and a `pg_trigger` query confirmed why:
`on_player_caregiver_removed` (migration 056) does not exist on the live
database at all, despite being in that migration's file.

Same failure pattern this project has hit repeatedly — migration 057's own
header documents four earlier cases of a migration's `CREATE POLICY` never
actually applying live. This one slipped past that audit because a trigger
isn't a policy, so `pg_policies` never surfaced it. Net effect: **every**
caregiver removal to date — admin-initiated or self-service — has silently
never notified an admin, even though `TeamPage.tsx`'s "An admin has been
notified to review device access" message and the review screen itself
both assumed it did.

- **Fix**: `063_restore_caregiver_removed_trigger.sql` recreates the
  trigger + function verbatim from migration 056's own definition
  (idempotent `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`) — no behavior
  change from what was always intended, just actually applying it. No data
  recovery for removals that already happened before this runs; they're
  just gone without ever having been reviewed. Every removal going forward
  — including the new self-service path — will queue the
  `admin_action_items` row as designed.

Verified: confirmed missing via a direct `pg_trigger` diagnostic query
before writing the fix (not guessed from the migration file, per this
project's own established gotcha about live/file drift). **Re-verified live
2026-08-31**: the same diagnostic query now returns
`on_player_caregiver_removed`, enabled (`tgenabled = 'O'`), definition
matching migration 056's original exactly. Next caregiver removal
(admin-initiated or self-service) should now show up on the Caregiver
Removal Reviews screen — not yet exercised with a fresh removal to confirm
end-to-end.

## [2026-08-30] - Section 6.2 redesigned: stop guessing at redemption time, let a 16+ player self-serve out of a caregiver link instead

Found live-testing Task 12 item 4 (Section 6.2 — Child ticked, actually an
Adult): Add-Player'd Goofy Dog as a Child with a genuinely separate
caregiver ("Goofys mum," a different real person, different email). On the
caregiver's registration form, Goofy's own entered date of birth came back
16+, which triggered the existing "convert in place" behavior — but that
behavior assumes the *redeemer* IS the subject (a 16-17 year old who put
their own email in as "the caregiver" for themselves, mistakenly Child-
ticked by the Manager). Here the redeemer and the subject are two different
real people, so converting the redeemer into the player produced a
`users` row built from the caregiver's own name/email ("Goofys mum") but
the *child's* date of birth — an internally inconsistent, mismatched
identity. Goofy's own email was never collected anywhere, so there was no
way to register him directly either. Meanwhile the original pending
"Goofy Dog" child record was left behind forever (by design — nothing
deletes it — but the test script expected it gone).

**Root cause**: the two real-world cases — "redeemer IS the subject,
mis-ticked" vs. "redeemer is a genuinely separate caregiver, subject is
just older than the Manager guessed" — are indistinguishable from the
submitted form data alone. There is no reliable signal to add at
redemption time to tell them apart.

**Decision (product owner, 2026-08-30)**: stop trying. A Child-ticked
registration now always proceeds as an ordinary pending child, whatever
date of birth is entered — nothing wrong with a 16+ person still being
caregiver-linked, if that's how they came into the system. Instead, once
that person has their own login (via device-code access), THEY get a
self-service way to end the caregiver relationship whenever they choose —
never automatic, and never guessed at on their behalf.

- **Retired**: `resolveAgeTickOutcome`'s `'convert_to_adult'` outcome
  (`redeem-invite/logic.ts`). A Child-ticked redemption is always `'ok'`
  now once the DOB parses at all (`'invalid_date_of_birth'` still applies
  to a genuinely unparseable date). `redeem-invite/index.ts`'s matching
  branch, `convertedFromCaregiver` variable, and the `redemptionRole`
  divergence it drove are removed; the `converted_from_caregiver` response
  field is hardcoded `false` going forward rather than deleted outright, so
  an older client build still gets the shape it expects — the client-side
  "you were registered as yourself, not a caregiver" branch
  (`LiteLandingPage.tsx`, `success-screen-logic.ts`) is now permanently
  unreachable but left in place rather than torn out in the same pass.
- **New**: a player who is 16 or older may remove their own caregiver
  link(s) themselves.
  - `src/lib/roster-logic.ts`'s `canSelfRemoveCaregiver(ageBand,
    linkedCaregiverCount)` — pure, unit- and property-tested — gates a new
    "Remove My Caregiver" button that only ever appears on the viewer's OWN
    roster row.
  - `src/components/team/RemoveMyCaregiverModal.tsx` — one explicit confirm
    step (per product decision: click the button, read the consequence,
    confirm) before anything is written. Removes every linked caregiver at
    once (the intent is "no caregiver oversight," not fine-grained
    per-caregiver management) via the existing
    `caregiversApi.unlinkCaregiverFromPlayer`.
  - `062_players_can_remove_own_caregiver.sql` — the data-layer half: a new
    `player_caregivers` DELETE policy additive to the existing admin-only
    one (migrations 036/057), scoped to `player_id = auth.uid()` and the
    player's own recorded `date_of_birth` clearing 16. No change needed to
    migration 056's removal-notification trigger — it already fires on ANY
    delete regardless of who performed it, so a self-removal queues the
    exact same `admin_action_items` review row an admin-initiated one does
    today.

Verified: `npm test` (215 passing/2 skipped, up from 211 — 4 new
`canSelfRemoveCaregiver` tests), `npm run build`, and `deno check`/`deno
lint` on the Edge Function, all clean on a fresh clone. **Not yet live-
tested** — needs migration 062 run, `supabase functions deploy
redeem-invite`, then: (1) confirm Goofy Dog's original registration now
completes as an ordinary pending child regardless of his declared DOB, (2)
issue Goofy his own device access, log in as him, confirm "Remove My
Caregiver" appears and works, and (3) confirm it does NOT appear for an
under-16 child's own view (should be structurally impossible via device-
code login today, but worth a look).

## [2026-08-30] - A bounced invite stayed valid forever, and the Manager never heard about the bounce

Found live-testing Task 12 item 3 (Section 6.1 — Adult ticked, actually a
Child): Hewie Duck was Add-Player'd as an Adult, opened the invite, entered
an under-16 DOB, and correctly hit the "Let's get your Manager to help"
bounce screen with no account created — so far, exactly as designed. But
Hewie then reopened the *same* invite link, re-entered a 16+ DOB, and it
redeemed normally: same code, second attempt, silently allowed. Separately,
nothing had ever told the Manager who created that invite that a bounce
happened at all — no email, no in-app message, no `admin_action_items` row.

Both traced to the same spot: `redeem-invite/index.ts`'s `bounce_to_manager`
branch threw its rejection with a comment saying "nothing has been written
yet" — true, and deliberately so (a rejection should have nothing to
compensate), but it meant nobody ever touched `invite_codes` on this path
either. `redeemed_by`/`redeemed_at` only get set at the very end of a
*successful* redemption, so a bounced code's `expires_at` was untouched and
`deriveInviteStatus` kept reporting it `valid` indefinitely.

- **Fix — kill the code on bounce**: the `bounce_to_manager` branch now
  backdates `invite_codes.expires_at` to "now" before throwing
  (`killBouncedInvite`). No new column: this makes `deriveInviteStatus`
  report the invite as `expired`, which the landing page already has copy
  for ("This code has expired. Your coach/manager has been notified and can
  send you a new one.") — copy that, as of this fix, is now actually true.
  Decision, confirmed with the product owner: once a self-declared DOB shows
  the Manager ticked the wrong box, the person must go through the Manager
  again as a proper Junior/caregiver addition — not silently retry the
  Adult path a second time on the same link.
- **Fix — notify the Manager**: `notifyManagerOfBounce` sends the invite's
  creator an in-app message (same `messages`/`message_recipients` tables the
  Messages tab already reads) explaining what happened and that they need to
  re-add the person as a Junior with caregiver details. There is no "system"
  sender in this schema and every message row requires a real `sender_id`,
  so it's addressed by the Manager to themselves — it will show their own
  name as the sender in their own Messages tab. Unusual, but functional, and
  avoids a new table/column for a first cut.
- Both writes are best-effort (logged and swallowed on failure) — the person
  standing at the registration form still needs to see the bounce screen
  either way, so neither one is allowed to turn into a 500.

Deployed and **confirmed live end-to-end** with a second fresh pair (Dewie
Duck / West Coast Rangers, different email): the bounce screen showed
correctly, reopening the same link afterward now shows "Code Expired —
your coach/manager has been notified and can send you a new one" instead
of letting a second registration through, and the Manager's Messages tab
showed the new notification. Verified before deploy: `deno check` on the
Edge Function (clean — this file has no automated test coverage;
`logic.ts`'s pure functions are unit-tested but `index.ts` itself only
runs under Deno), plus `npm test` (211 passing/2 skipped, unchanged) and
`npm run build` clean on a fresh clone. **Task 12 item 3 is now fully
done.**

## [2026-08-29] - Drop redundant re-confirmation fields from the pending-consent Accept/Deny

Flagged live-testing George Pig/Daddy Pig, right after confirming migration
061's fix worked end-to-end: the roster's inline Accept/Deny for a pending
child (Decision 1) always showed editable name/DOB fields to fill in again,
even though the caregiver had already typed and confirmed the exact same
details once already — via the "I confirm these details are correct"
checkbox added to the registration form itself (Decision 2, migration
059). Re-typing the same thing twice was pure friction.

- **Fix**: when the child's `date_of_birth` is already on file — true for
  every normal Child happy path registration — Accept/Deny now render with
  no editable fields at all, just a plain-text summary
  (`{name} ({dob}) is waiting for your consent to join the team`).
  `handleRespondToJunior` skips validation and sends no correction in this
  case (`caregiversApi.approveJunior`'s `correction` param is already
  optional; `undefined` means "approve as recorded").
- **The one case that keeps the editable fields**: an *existing*-caregiver-
  account bypass linking to a brand-new pending child skips the
  registration form entirely (Requirement 2.2), so nothing ever collects
  that child's DOB anywhere else — that's the only path where this screen
  is still the sole place to enter or correct it, and it's untouched.

Verified: `npm test` (211 passing/2 skipped, unchanged) and `npm run
build` clean on a fresh clone.

## [2026-08-29] - Migration 061 + code fix: a brand-new caregiver couldn't reach their pending child's team at all

Found immediately after migration 060, live-testing a fresh child/caregiver
pair (George Pig / Daddy Pig) as the real end-to-end confirmation of that
fix. Daddy Pig redeemed his caregiver invite successfully — the Manager's
roster correctly showed George pending with Daddy Pig linked as his
caregiver — but Daddy Pig's own Team page still read "not a member of any
team yet."

- **Root cause**: a pending child has no `team_members` row at all — only a
  `caregiver_approvals` row (`TeamPage.tsx`'s `fetchRoster` already has its
  own comment on this: "Pending children awaiting caregiver consent are not
  yet team_members"). Migration 060 fixed a caregiver reading their
  *active* child's team, but a caregiver whose ONLY linked child is still
  pending has no `team_members`-based connection to the team at all, active
  or otherwise — so `teamsApi.getMyTeams()` found nothing, and the
  caregiver had zero way to ever open the team and reach the inline
  Accept/Deny row that replaced the old dedicated Approvals page. A
  genuine chicken-and-egg gap in that redesign: the old page read pending
  requests directly, independent of team membership; the new inline
  approach depends on opening the team first. Mortimer/Micky didn't hit
  this earlier because Micky was already approved and active by the time
  migration 060 was verified.
- **Fix**: `teamsApi.getMyTeams()` now also unions in the team of any
  pending `add_child` approval for a linked child not already covered by
  an active membership, reading `caregiver_approvals` directly instead of
  `team_members`. Migration 061 adds the matching RLS grant this new read
  needs (migration 060's policy alone doesn't cover it, since it also
  requires a `team_members` row that doesn't exist yet for a pending
  child) — additive only, scoped to a caregiver's own named pending
  requests.
- **Also retired the leftover "Approvals" nav tab**, flagged as confusing
  during this same test — it pointed at the exact same `/team` destination
  as the Team tab itself (a leftover from repointing rather than removing
  it when the dedicated Approvals page was retired earlier tonight), and
  the two tabs shared a React key besides. The pending-count badge now
  lives directly on the Team tab instead of a separate one.

Verified: `npm test` (211 passing/2 skipped — 3 nav tests updated for the
retired Approvals tab, count unchanged) and `npm run build` clean on a
fresh clone. Migration 061 run via the Supabase SQL Editor.

## [2026-08-28] - Migration 060: caregivers couldn't read their linked child's team

Found live during the clean re-test of Task 12 item #2, right after the
6-patch fix below: Mortimer (caregiver) still saw "You are not a member of
any team yet" on the Team page, even though Mickey (his linked child) is an
active member of Open Riverhead Frogs. Ruled out browser/session caching
first (closed the session, logged back in — no change) before digging
further.

- **Root cause**: a `teams` SELECT policy that exists **live** on the
  database but was never captured in any migration file — `pg_policy`
  confirms today's actual live policy set on `teams` is "Admins can manage
  teams", "Allow anon users to read teams with a live invite", "Members can
  read their teams" (undocumented — requires the *requesting* user to have
  their own `team_members` row on that team), and "Users can view assigned
  teams" (a dead policy — keyed off a `user_teams` table nothing in this
  app's code has ever written a row to). `teamsApi.getMyTeams()` (fixed
  earlier tonight, commit `6dcc185`) correctly reads a caregiver's linked
  child's `team_members` row and joins to `teams` — but that join is still
  evaluated under the *caregiver's* `auth.uid()`, and a caregiver never has
  their own `team_members` row on that team, only their child does. Result:
  the `teams` embed silently comes back `null`, and `buildTeamSelection`
  treats a null `.team` as "skip this membership" — zero options, "not a
  member of any team," for a caregiver whose child is very much on the
  roster.
- **Same blind spot, same places**: `TeamPage.tsx`, `Games.tsx`, and
  `Coaching.tsx` all filter out a null `.team` from `getMyTeams()`'s result
  the same way, so all three would have shown "no teams" for a caregiver,
  not just the roster page. `MessagingContext.tsx` only reads `.team_id`
  off the same rows, never `.team`, so it wasn't affected by this specific
  gap.
- **Fix**: migration 060 adds one new, narrowly-scoped SELECT policy on
  `teams` — "Caregivers can read their linked children's teams" — mirroring
  "Members can read their teams" but keyed off the requesting user's
  `player_caregivers` links instead of their own `team_members` row.
  Additive only: a user with no caregiver links gets no new access; a
  caregiver only ever sees a team their own linked child is actually on. No
  application code changes needed — `teamsApi.getMyTeams()`'s join was
  already correct.

Run via the Supabase SQL Editor (not `git am` — this is a database-only
change). Verified: `player_caregivers` link and `team_members` row for the
test case both independently re-confirmed correct via direct query first,
to isolate this as an RLS-only gap rather than a data problem.

**Follow-on data fix, same re-test:** once migration 060 let Mortimer see
the Frogs roster at all, Micky's own row showed no caregiver contact
underneath (Amy Brook's does, on the same roster) — the roster derives a
child's age band from their own `date_of_birth`, falling back to the
team's `age_group` ("Open" here, i.e. adult) when none is recorded, so a
DOB-less child shows their own (blank) number instead of routing through
their caregiver. Confirmed via direct query: Micky's `date_of_birth` was
`null`. Not a code bug — `redeem-invite` does write the caregiver's typed
child DOB onto the child's record, but only once, at registration time,
and Micky was registered while that function was still running the stale
~7-day-old code from before tonight's redeploy (same root cause as the
6-patch entry below), so the write never happened for his specific row and
the later redeploy can't retroactively fix already-written data. Fixed
with a one-time `UPDATE public.users SET date_of_birth = ...` for this one
test record via the SQL Editor. The real check going forward is that a
**brand-new** child/caregiver redemption writes the DOB correctly on the
first try now that both Edge Functions are actually current — that's part
of the still-pending clean re-test with a fresh pair.

## [2026-08-28] - Caregiver invite / add-a-junior flow: live-tested twice, 6 fixes shipped

Task 12 of `.kiro/specs/streamlined-invites-and-child-access/` (final checkpoint)
called for a full manual pass of the Child happy path. Two live tests tonight
(James Corrigan/Donny Trump, then Mortimer Mouse/Micky Mouse) surfaced six
real problems in the caregiver-invite/add-a-junior flow — all diagnosed,
fixed, and pushed. Full root-cause writeup and per-patch detail:
`caregiver-invite-flow-fix-plan.md` (also saved to the project's knowledge
base). Summary:

- **Root cause of most symptoms: stale Edge Functions.** `redeem-invite` and
  `respond-junior-approval` were running code ~7 days out of date —
  `supabase functions deploy` is a separate step from `git push` and had
  been missed. Redeployed both; this alone explains several of the items
  below looking like fresh bugs when they were actually already-fixed code
  that had never gone live.
- **Caregivers had no access to their child's Team page or Messages at
  all.** `teamsApi.getMyTeams` only checked the caregiver's own
  `team_members` rows, which a caregiver never has — added a shared
  team-access resolver (covering caregiver-linked children too) and
  switched both the roster query and `MessagingContext` to use it.
- **The dedicated Approvals tab/page was confusing and easy to lose**, and
  a caregiver couldn't even reach their child's roster to find it. Replaced
  with an inline Accept/Deny (with confirm-or-correct child name + DOB)
  right on the child's own pending roster row; the old
  `/caregiver-approvals` route now redirects to `/team` instead of
  404ing, and the Approvals nav tab points at `/team`.
- **A child's DOB never actually persisted** through the add-a-junior flow,
  which silently misrouted the roster's contact display (a DOB-less child
  fell back to the team's own age group and showed no caregiver contact —
  a blank line, not an error).
- **Nothing told the caregiver a child was involved.** The invite email and
  the registration form's blank child-name fields gave no indication at
  all — added a dedicated `caregiver_invite` email (new Edge Function email
  type) naming the child and team, and a prefilled, confirmation-checkbox-
  gated child-name field on the registration form (migration 059 adds
  `invite_codes.subject_first_name`/`subject_last_name`, mirroring the
  existing `recipient_first_name`/`recipient_last_name` pattern —
  deliberately name-only, since Add Player collects no child DOB to
  prefill).
- **Login page subtitle** ("Sign in to your coaching account") was shown to
  every role, not just Coach — changed to role-neutral copy.

Verified via 6 separate patches, each independently fresh-clone-checked
(`git am` apply, `npm test`, `npm run build`) before delivery — 211
passing / 2 skipped throughout, clean build every time. Migration 059 run
via the Supabase SQL Editor; both `redeem-invite` and `send-email` Edge
Functions redeployed. Pushed to `origin/prototype` across commits
`6dcc185..dc499b5`.

**Not done as part of this pass** (out of scope, noted for later):
`teamsApi.getMyTeamCount` has the same caregiver blind spot the
messaging/roster resolver fixed elsewhere, and Announcements' "Team Types"
targeting filter doesn't fully cover every case — see
`caregiver-invite-flow-fix-plan.md` for detail.

## [2026-08-28] - Netlify production deploys can silently pause on exhausted build credits

Documented (not code) — added a new "Frontend deploys" section to
`CLAUDE.md`. Pushing to `prototype` on GitHub does not guarantee a new
Netlify deploy: Netlify's git integration only builds while the team has
deploy credits, and when they're exhausted, deploys silently pause while
the already-published site keeps serving its last build (no error, no
obvious banner unless you check Netlify's dashboard directly). Diagnostic:
compare the hashed JS bundle filename across a hard refresh, an incognito
window, and a different device — if it's identical everywhere, it isn't
browser caching; check Netlify's dashboard for a "production deploys
paused" / "running on operational credits" notice. Fix is a billing action
(add credits, upgrade plan, or wait for the monthly reset), not something
fixable from a coding session — once credits return, a manual "Trigger
deploy" may still be needed. Pushed as `0fff190`.

## [2026-08-28] - Fix crash on every Announcement create/edit

Found live 2026-08-27 during Task 12 testing (unrelated to the
caregiver-invite work above): opening the Announcements admin modal — New
or Edit, every single time — threw `TypeError: Cannot read properties of
undefined (reading 'includes')` and made the feature completely unusable.

- **Root cause**: an incomplete prior refactor. `Announcements.tsx` already
  imported the shared `TargetingSelector` component and already had a
  correctly-populated `targetingData` state (set from the announcement's
  `target_*` columns, read back on save) — but the rendered JSX was never
  switched over, and still had the old ~110-line duplicated inline
  targeting UI referencing `formData.target_roles` etc. (fields `formData`
  never actually had) plus a `teams` variable that was never declared
  anywhere in the file. Vite's build doesn't type-check, so this shipped
  without anything catching it.
- **Fix**: deleted the broken inline duplicate, rendered
  `<TargetingSelector value={targetingData} onChange={setTargetingData} />`
  in its place (the component already does everything that block was
  trying to), and updated the save handler to read `targetingData` instead
  of the non-existent `formData.target_*` fields.

Verified with a scoped strict `tsc` check on this one file (previously
surfaced the bug, now passes clean), plus `npm test` (210/2 skipped,
unchanged) and `npm run build` clean on a fresh clone. Pushed as `5bf8f97`.

## [2026-08-27] - Task 12 live-testing follow-up: Add Player copy + Success Screen guidance text

First round of Task 12 manual testing turned up two copy/clarity gaps (not
functional bugs):

- **Add Player modal** subtitle rewritten to explain *why* a Child needs a
  caregiver ("List the player's details — an email is required for them to
  register. Players under 16 (Child) will need a caregiver's details,
  since the caregiver gives consent and registers on their behalf."), plus
  a `<16` hint under the Child button; the old separate explanatory line
  under the Adult/Child buttons was removed as redundant.
- **Success screen** ("What you can do next") bullets made role-agnostic
  rather than assuming every new user is a Manager — added two new bullets
  (messaging teammates, seeing/RSVPing to events) and scoped the
  Manager-specific bullet with "if you are a Manager".
- `.kiro/specs/post-registration-welcome-and-team-page/requirements.md`
  Requirement 1.5 corrected to match (role-agnostic wording).

Pushed as `782dce8`.

## [2026-08-27] - Task 11: consent-timeout auto-dropoff for stale add-a-junior requests

Closes out Requirement 8.4 of `.kiro/specs/streamlined-invites-and-child-access/`:
a child added as a Junior whose caregiver never responds to the consent
request now automatically drops off the team list after **30 days**
(previously an open "blocked on a human decision" item, proposed at ~2
months in requirements.md — decided by the project owner).

- **Migration 058** adds `expire_stale_child_consents()`, a `SECURITY
  DEFINER` Postgres function scheduled daily via `pg_cron` (new extension,
  first use in this project). It denies any `caregiver_approvals` row with
  `request_kind = 'add_child'` still `status = 'pending'` past the
  threshold — mirroring the `respond-junior-approval` Edge Function's exact
  `deny` outcome (status -> `denied`, child's `users.active` -> false) — and
  deactivates the linked child. There's no `expired` value in the `status`
  CHECK constraint, so "consent never arrived in time" is treated as a
  denial rather than widening that constraint.
- **No application code changes.** `TeamPage.tsx`'s roster query already
  only surfaces children with a `pending` `caregiver_approvals` row, so the
  moment the job flips a stale row away from `pending`, the child stops
  appearing on the Manager's team list — exactly the "shows as pending...
  auto-drops off" behaviour Section 8.4 calls for.
- Threshold kept as a named constant inside the function (matching this
  project's existing pattern for this exact kind of value — see migration
  009's `INTERVAL '7 days'` announcement expiry), not a new settings-table
  row. `EXECUTE` on the function is revoked from `PUBLIC` — Supabase
  exposes public-schema functions as RPC endpoints by default, so without
  this any authenticated user could have called it directly and forced
  other users' pending requests to expire early.

Verified against a local Postgres 16 instance with `pg_cron` actually
installed and running (not just read for syntax): 7 scenarios covering a
stale row expiring correctly, a fresh row and an already-decided row both
left untouched, a wrong-`request_kind` row left untouched, idempotent
re-runs, the `PUBLIC` execute revoke actually blocking a test role, and the
cron job registering with the right schedule. Applied via the Supabase SQL
Editor and `git am`, pushed to `origin/prototype` (`9ec9bf4..b1511eb`).

## [2026-08-26] - Streamlined Invites & Child Account Access — spec built (Tasks 1–11 of 12)

The full `.kiro/specs/streamlined-invites-and-child-access/` spec, covering
ten sections of `requirements.md` — this is the "Model A reversed" redesign
that gives children their own direct, device-bound login instead of only
ever being a record their caregiver manages. Full task-by-task detail
(mechanism, verification, deployment steps) lives in that spec's
`tasks.md`, kept up to date inline as each task lands — not duplicated in
full here. Task 12 (final checkpoint: automated tests/build plus a full
manual pass of every path below) is in progress; see that file for current
status.

**What shipped, in build order:**
- **Existing-user bypass (Requirement 2, Task 4).** A new
  `check-invite-recipient` Edge Function lets the (unauthenticated)
  redemption page check, before rendering anything, whether an invite's
  recipient email already has a real account. If so, the registration form
  is skipped entirely in favour of a one-button "You already have an
  account — join {team} as {role}?" screen. Applies to every
  invite-generation path that can name an existing user: Add Player, the
  caregiver-invite path, and the Club Admin "assign existing user as
  Manager" flow on the Competitions page.
- **Symmetric DOB + wrong-tick self-correction (Requirements 5–6, Tasks
  3a/3c/3e).** The Manager's Adult/Child tick on Add Player is now
  provisional routing only, symmetric on both branches: the person
  redeeming self-declares their own (or, on the caregiver side, their
  child's) date of birth, and that's the record of truth. An Adult-ticked
  invite whose self-declared DOB comes back under 16 bounces back to the
  Manager to redo them as a Junior (Section 6.1) rather than letting a
  minor name their own caregiver inline. A Child-ticked (caregiver) invite
  whose declared DOB comes back 16-or-older converts in place into a
  normal adult self-registration for the person filling in the form
  (Section 6.2), skipping the caregiver-approval flow entirely.
- **Child accounts + device-code login (Requirement 7.1/7.4, Task 6).** A
  child's `auth.users` row already existed (Model A's `can_sign_in: false`
  synthetic-email pattern) — this adds a way to establish a real session
  for it without ever knowing or setting a password. A caregiver generates
  a one-time device-code link (`generateChildDeviceCode`); the child opens
  it once on their own device (`DeviceAccessLandingPage.tsx`) and is
  signed in permanently from then on via `supabase.auth.verifyOtp`.
  Generating a new code for the same child ends any prior session
  (resolved via rotating the child's password through GoTrue's
  `updateUserById` — no admin revoke-by-user-id route exists, confirmed
  against `supabase/auth` source).
- **Child scoped nav + Team-tab contact scope (Requirement 7.2, Task 8).**
  A child's account mirrors the existing adult/caregiver bottom-nav
  structure (Home / Team / Schedule / Messages), scoped to their own
  team(s). Contact-detail visibility on the Team tab is gated only by the
  *viewed* row's age band — same code path as any adult Player — not by a
  Manager/Coach viewer tier (this had been mis-described in
  `requirements.md` and was corrected in a follow-up sync, see below).
- **Multi-caregiver admin gate + admin notification queue (Requirement
  7.5, Task 9).** A child's first caregiver is still added by a
  Coach/Manager as today; any caregiver beyond the first now requires a
  club Admin. Removing a caregiver never auto-revokes the child's device
  access on its own — it queues a review item (new `admin_action_items`
  table + `AdminActionItems.tsx` screen, linked from the desktop nav as
  "Caregiver Reviews") so an Admin decides explicitly whether to revoke.

**Two real production RLS gaps found and fixed while building Task 9,
worth its own callout:** the coach/manager `invite_codes` INSERT policy
that migration 036's file defines had never actually been applied to the
live database — discovered when a `56` migration's `ALTER POLICY` against
it failed with "policy does not exist." Root-caused via direct `pg_policies`
queries rather than guesswork, fixed via `DROP POLICY IF EXISTS` + `CREATE
POLICY` (migration 056). This prompted a full audit of every `CREATE
POLICY` across all 57 migration files at the time against the live
database's actual policy set, which found two more of the same class of
gap — `player_caregivers`'s read/manage policies (migration 036) and
`users`' `users_update_own`/`service_role_delete` policies (migration
004) — restored via migration 057. Likely root cause: a "migration 036
recovery" commit earlier in this project's history only partially reapplied
that migration. **Lesson captured in the new `CLAUDE.md`** (see below):
migration files in this repo don't reliably reflect live state; verify
before assuming.

Also synced during this work: `requirements.md`'s Section 7.2 / Deferred
Decisions item 8 was corrected to describe contact-visibility gating
accurately (age-band of the viewed row, not a Manager/Coach viewer tier) —
this content had existed on disk since the correction but was never
committed to git until now.

Verified per-task via the established sandbox → fresh-clone tree-match →
`git am` → `npm test` + `npm run build` pipeline before delivery; applied
and pushed to `origin/prototype` across a chain of commits from `8d253b6`
through `f351814`, then `388c0c9` and `2517388` for the migration fixes,
and `03dcda8` for the requirements.md sync.

## [2026-08-26] - Operational docs: `CLAUDE.md` + Project session playbook

Added `CLAUDE.md` at the repo root — a playbook for any AI session (Cowork,
Claude Code, or otherwise) picking up work on this repo, covering the
git-patch delivery workflow, pre-delivery verification discipline, the
"always hand over runnable SQL/patches as a file, not just chat text"
convention, migration/Edge-Function deployment steps, and the
migration-files-vs-live-state lesson from the RLS audit above. Paired with
a shorter `session-playbook.md` doc in this project's claude.ai Project
knowledge base, referenced from the Project's custom instructions so it
auto-loads into any new session attached to this Project without needing
an explicit "please read this" prompt. Written after the repo owner asked
about splitting work across separate Cowork sessions per task without
losing the accumulated operational context.

## [2026-08-26] - Gant AI coaching assistant — planning docs added (no code)

Added `docs/project/GANT-AI-REQUIREMENTS.md` and
`docs/project/GANT-COACH-GUARDRAILS-CONVERSATION-GUIDE.md` — early
requirements and a coach-facing working doc for a future AI feedback
assistant ("Gant") that would help coaches phrase player feedback
consistently with club standards. Planning material only, uploaded by the
repo owner for safekeeping in the repo; no build work has started and this
is not currently part of the V1 scope tracked below.

## [2026-08-25] - Add Player / DOB age model — self-registration UX follow-up: prefill name, lock verified email

Found while live-testing the Add Player / DOB age model spec (shipped
2026-08-21, full detail in the entry below): the self-registration page
asked the invitee to retype their name and email from scratch, even though
the Manager already typed the name into Add Player and the email address is
inherently verified — it's the exact address the invite was delivered to.
Rubber-stamping it as editable meant a mistyped address could accidentally
route the registrant onto the worse "non-matching address" confirmation-gate
path for no reason.

- **Migration 054** adds nullable `recipient_first_name`/`recipient_last_name`
  to `invite_codes` (no backfill — older invites simply read NULL here).
- **`generateInviteCode()`** (`invites-api.ts`) grows two trailing optional
  params carrying the name already in scope at both call sites that create a
  self-registration invite: the Add Player adult path
  (`AddPlayerModal.tsx`) and the caregiver-invite path
  (`caregivers-api.ts`, which already had `caregiverFirstName` in scope).
- **`LiteLandingPage.tsx`** (self-registration) now prefills first/last name
  — still fully editable — and locks the email field read-only (with a short
  caption explaining why), both sourced from the invite record once
  validated.
- **Date of birth is deliberately untouched.** Self-declaration only works as
  an integrity check if it's freshly typed every time; prefilling it from the
  Manager's provisional routing entry would let a mistaken or deliberately
  gamed DOB get rubber-stamped through a confirm click instead of caught.

Verified via `git am` + `npm test` (158 passing) + `npm run build` on a
clean clone of `prototype` before delivery. Applied via `git am` on the
Snapdragon laptop and pushed to `origin/prototype`; migration run via the
Supabase SQL Editor. No Edge Function changes needed — `redeem-invite`
already just accepts whatever the client submits for name/email, so nothing
server-side had to change.

**Live-testing in progress** as part of the same Add Player / DOB smoke test
called out as outstanding in the entry below.

**Follow-up during testing:** added a short caption under the prefilled name
fields ("Pre-filled from your invite — edit if it's not quite right"), shown
only when the invite actually carries a name, so the prefill doesn't read as
unexplained or like a mistake.

## [2026-08-25] - Caregiver Approve/Deny now shows editable child name & DOB

Second gap found in the same live-testing pass, on the Junior/caregiver
path this time: the Approve/Deny screen only ever showed the child's name
and let the caregiver blindly rubber-stamp a decision. It never showed the
child's date of birth at all — the same value that decided Adult vs Junior
routing back in Add Player — and neither the name nor DOB could be
corrected by the one person in this flow who'd actually know if the Manager
got either wrong. This is the mirror of the Adult path's self-declaration
protection, exercised by the caregiver instead of the child (who, being a
Junior, doesn't self-declare anything).

- **`CaregiverApprovalPage.tsx`** now shows editable First name / Last name
  / Date of birth fields for an `add_child` approval, seeded from the
  child's current record, with inline validation (non-empty names, a real
  non-future date) before Approve is allowed to proceed.
- **`caregivers-api.ts`**: `getMyPendingApprovals` now also fetches the
  child's `date_of_birth`; `approveJunior`/`respondToJuniorApproval` grow an
  optional `correction` parameter, sent only on approve — deny/escalate are
  completely unaffected.
- **`respond-junior-approval` Edge Function** validates the correction
  server-side and applies it to the child's `users` row as part of the same
  atomic approve transaction that activates them and adds them to the
  roster — nothing client-side is trusted as-is.

Verified via `git am` (stacks on the entry above) + `npm test` (158
passing) + `npm run build` on a clean clone before delivery. **Requires an
Edge Function redeploy** (`supabase functions deploy
respond-junior-approval`) in addition to the `git push` — this one doesn't
touch the database at all, so no migration.

**Deliberately parked, not forgotten:** no age-threshold check exists yet
for a caregiver-corrected DOB — e.g. nothing stops a caregiver "correcting"
the DOB to something that would actually make the child 16+, which would
still go through as a Junior. This is a real process/design question (does
it get rejected the way an under-16 Adult self-declaration is? Redirected to
the Adult path instead? Something else?) that needs its own decision, not a
silent addition. Flagged for a follow-up session.

## [2026-08-21] - Add Player / DOB age model — full spec built, applied & deployed

All 13 tasks of the `.kiro/specs/add-player-and-dob-age-model/` spec, built
across a single long session and delivered as a chain of 7 git-am-able
patches (Task 1, Tasks 2-3, Task 5, Tasks 6-7, Task 9, Task 10, Task 11,
Task 12, Task 13), each independently verified via `git am` on a clean
clone plus `npm test`/`npm run build` before delivery. Applied to
`prototype`, pushed to GitHub (`8a0415a..6286a19`), and both affected Edge
Functions redeployed, all in this session.

- **"Add Player" replaces "Add Junior"** as the Team page's single entry
  point (`AddPlayerModal.tsx`; `AddJuniorModal.tsx` removed), routing to an
  adult-invite path or a junior/caregiver path based on the person's age.
- **Age is now DOB-based, not just team-based.** 16+ counts as adult;
  falls back to `teams.age_group` only when no DOB is on file for that
  person. Adults self-declare their own DOB when redeeming their invite —
  that self-declaration is the record of truth, not whatever the Manager
  guessed when sending the invite. An under-16 self-declaration is rejected
  server-side (message points the Manager to redo it as a Junior) — the
  16-year threshold is deliberately not duplicated client-side.
- **Caregiver invites**: adding a Junior whose caregiver doesn't have an
  account yet now sends them an invite (`intended_role: 'caregiver'`)
  instead of silently failing to link. Redeeming it never auto-approves the
  pending caregiver-approval request — double opt-in stays two separate
  acts.
- **New "Approvals" bottom-nav tab**, with an exact pending-count badge,
  appears for any role with a pending caregiver approval — not gated by
  `users.role`, since caregiver affiliation is derived (via
  `player_caregivers` + `team_members`), not stored, so an Admin/Coach/
  Manager can simultaneously be a caregiver of their own child. This closes
  a gap called out in the 2026-08-20 entry below and in `NEXT-SESSION-NOTES.md`:
  there was previously no way for a caregiver to discover
  `/caregiver-approvals` short of typing the URL by hand.
- Invite redemption's Success Screen now routes straight to
  `/caregiver-approvals` when the server signals a pending approval.
- `create-auth-user` and `redeem-invite` Edge Functions both redeployed to
  match (DOB field, adult self-declaration, caregiver-invite handling).

**Not yet live-tested end to end on a device** — automated tests (158
passing) and a clean build are the only verification so far. Next session
should do a real click-through: Add Player as both adult and junior, redeem
both invite types, confirm the Approvals tab appears with the correct badge
and disappears after approving. Full detail in `NEXT-SESSION-NOTES.md`.

## [2026-08-21] - Fix broken password-reset completion

Found while reviewing whether username/password setup was fully sorted for
every way a user account gets created: the "Forgot your password?" flow on
the Login screen only ever sent the reset email — `AuthContext.resetPassword`
correctly called `supabase.auth.resetPasswordForEmail(...)` with
`redirectTo: '${origin}/reset-password'`, but no `/reset-password` route
existed. The router's catch-all sent that link straight back to the app's
home screen with no way to actually set a new password — a live, currently-
broken dead end, not a future gap. It's also the exact mechanism every
caregiver added through the current "Add Junior" flow is told to rely on
(`create-auth-user`'s code comment: "capable of signing in via password
reset / magic link") — so this was quietly blocking real accounts, not just
an edge case.

Added a real `/reset-password` page (`src/pages/ResetPassword.tsx`) and
route. No manual token parsing was needed: Supabase's client already turns
the emailed link into a short-lived recovery session on load
(`detectSessionInUrl`, on by default), which `AuthContext`'s existing
session check picks up the same way it picks up any other session — so the
new page just reads `useAuth()`'s `isLoading`/`isAuthenticated` and shows one
of three states: still checking the link, invalid/expired (no session
materialized), or a set-new-password form. Added `updatePassword` to
`AuthContext` alongside the existing `resetPassword`, calling
`supabase.auth.updateUser({ password })`.

**Not yet live-tested** — needs a real "forgot password" run end to end
(request email → click link → land on the new page → set password → land in
the app) once deployed. Also worth checking the Supabase dashboard's
Authentication → URL Configuration → Redirect URLs list includes
`/reset-password` (or a wildcard covering it) — `resetPasswordForEmail`
silently fails to redirect correctly if the URL isn't allow-listed there,
and that's a dashboard setting, not something in this codebase.

## [2026-08-20] - Task 1: add-a-junior RLS fix, plus a bigger gap found behind it

Investigating the known "manager can't submit Add Junior" RLS bug (NEXT-SESSION-NOTES
Task 1) surfaced a second, more serious problem: even with that RLS error fixed,
an **approved** add-a-junior child would never have actually appeared on the team
roster. Both are fixed here.

- **The reported bug.** `caregiversApi.addJunior` step 4 inserted into
  `player_caregivers` client-side as the coach/manager. The only INSERT-capable
  policies on that table are admin-only (migrations 002, 036) — no policy lets a
  coach/manager insert. New service-role Edge Function
  `supabase/functions/link-player-caregiver` does this insert instead, gated on
  the caller being admin or a coach/manager of the specific team the child
  belongs to.
- **The bigger gap.** No code path anywhere ever wrote a `team_members` row for
  an add-a-junior child — not pending, not approved. Pending children display
  correctly via a separate, `caregiver_approvals`-based query (by design, Req
  5.10), but nothing filled the gap once a caregiver actually approved:
  `respondToJuniorApproval()` had the right logic (activate the child) but was
  never called by any UI. The only reachable Approve/Deny button
  (`CaregiverApprovalPage.tsx`) called the older, generic `respondToApproval()`,
  which doesn't check `request_kind` and has no path to activate a child or add
  them to the roster — so an approved child would have stayed permanently
  invisible. Separately, even the unwired logic would itself have hit RLS:
  activating `users.active` and inserting `team_members` are both blocked for a
  caregiver who is neither admin, self, nor a coach/manager of that team.
  New service-role Edge Function `supabase/functions/respond-junior-approval`
  now does all three writes (approval status, child activation, roster insert)
  together so a decision can't land half-done. `CaregiverApprovalPage.tsx` now
  branches on `request_kind`: add-a-junior rows go through the new
  approve/deny path with correct wording (naming the child, not implying the
  caregiver themself is being added); the legacy add-caregiver flow is
  unchanged. Response errors now show in the page instead of only the console.
- **Correction to the record:** the original Round 2 attendee-list fix write-up
  (this file and a comment in `events-api.ts`) claimed `team_members.role`
  doesn't allow `'manager'` — that was wrong (migration 048 added it). Both are
  corrected below/inline; the underlying fix was unaffected.
- **Deployed and live-tested, same day.** Both Edge Functions deployed
  (`link-player-caregiver`, `respond-junior-approval`). Full flow run on a
  real team as a coach/manager: Add Junior submitted with no RLS error →
  child created → caregiver approval email arrived, correctly naming the
  child → Caregiver Approvals page (reached at `/caregiver-approvals` —
  see follow-up below) showed a clear Approve/Deny UI → approved → page
  correctly emptied to "no pending approvals" → Team page roster showed the
  child as an active player. Deny/Escalate not yet tested.
- **Follow-up found, not yet fixed:** there is no nav link, button, or
  notification anywhere in the app pointing to `/caregiver-approvals` — the
  page only exists as a route. Today's test only worked because the URL was
  typed in by hand; a real caregiver has no way to discover this page.
  Logged in `NEXT-SESSION-NOTES.md` under TASK 1 as a small follow-up.

## [2026-08-20] - Caregiver multi-child RSVP — design agreed, docs only

No code changes. Talked through the caregiver multi-child RSVP design
(the deferred question from the Round 1 Schedule/RSVP fixes) using a
worked example: John Smith is a coach of a team and also caregiver to
Johnny and Jenny Smith, both players on that same team.

Agreed design, written up in full in `NEXT-SESSION-NOTES.md` under the
V1.7 section: if a logged-in user has more than one "identity" eligible
to respond to an event (their own, plus one per linked child who's also
on the roster), tapping any RSVP button opens a modal listing each
identity separately, each with its own fully independent Going/Maybe/
Can't Go. Data model: a new `subject_user_id` column on `event_rsvps`
records who the RSVP is actually about, separate from `user_id` (who
submitted it); the unique constraint moves to `(event_id, subject_user_id)`.
Caregiver-on-behalf-of-child writes route through a service-role Edge
Function — the same pattern already planned for the Task 1 add-a-junior
RLS fix, so build queued alongside that task rather than solving the
same RLS problem twice.

Also did a scope check across every caregiver/player-reachable page to
confirm RSVP isn't about to be the first of several places needing this
pattern — it's the only one today. Add Junior needs the same server-side
write fix but is a one-time consent decision, not a recurring per-event
action. Everything else caregivers can reach is read-only (Team,
Tournaments, Resources) or already caregiver-level (Messaging). Pages
with per-player actions (Games feedback, Subs/lineup management) are
locked to coach/manager/admin at the routing level, so caregivers can't
reach them at all. Given that, the plan is to build the identity-lookup
helper and the Edge Function generically rather than RSVP-specifically,
so a future feature needing the same "act on behalf of my child" pattern
doesn't have to redo this design work.

## [2026-08-20] - Schedule/RSVP Fixes Round 3 — page-load speed

Live-tested Round 2: the lock-contention fix and Create Event both check
out (Create Event does work — a newly created event just sorts into the
upcoming list by date rather than always landing first, which is correct
now that past/upcoming are split). The attendee-list-modal report turned
out to be specific to the two original seed events, not a code bug — new
events show attendance correctly, so it's a data gap on those two old
events rather than something to fix in `getEventAttendeeDetails`. One real
item left: Schedule still took ~5 seconds to appear.

### Fixed
- **Schedule page took several seconds to load.** `loadEvents()` in
  `src/pages/Schedule.tsx` (and `DesktopSchedule.tsx`) awaited
  `getUserRsvps()`, `getAttendeeCounts()`, and `getTotalMemberCounts()` one
  after another — three separate network round trips stacked in sequence,
  even though none of them depend on each other's result (all three only
  need the event list, which is already fetched by that point). They now
  run together with `Promise.all`, so the wait is however long the
  slowest of the three takes, not the sum of all three.
- **Attendee list modal was slow to open.** Same cause, smaller scale:
  `getEventAttendeeDetails()` awaited the `team_members` roster query and
  the `event_rsvps` query one after another even though neither depends on
  the other. Now run together with `Promise.all`.

## [2026-08-20] - Schedule/RSVP Fixes Round 2 — lock contention, attendee list dropping real RSVPs

Two bugs found live-testing the Round 1 Schedule/RSVP fixes below.

### Fixed
- **"Lock was stolen by another request" red banner on Schedule load, and
  Create Event silently doing nothing.** `loadEvents()` in
  `src/pages/Schedule.tsx` (and `src/pages/desktop/DesktopSchedule.tsx`,
  same pattern) fetched each event's RSVP with
  `Promise.all(events.map(event => eventsApi.getUserRsvp(event.id)))`.
  Every one of those calls independently hit `supabase.auth.getUser()`,
  which does a network round trip and takes an internal navigator lock to
  guard session refresh. Firing N of those concurrently on page load (one
  per event) contended for that lock — surfacing as the "Lock was stolen"
  error in the page banner, slowing the page load, and apparently leaving
  the auth client in a state where an immediately-following
  `auth.getUser()` call (e.g. from Create Event) could hang indefinitely,
  matching the "nothing happens" report. New `eventsApi.getUserRsvps()`
  does one `auth.getUser()` call and one query for the whole event list
  instead of N of each; wired into both Schedule pages.
- **Attendee list modal didn't show your own "Going" even though the RSVP
  was recorded.** `getEventAttendeeDetails()` built its roster from
  `team_members` for the event's target team(s), then merged RSVPs onto
  that roster — so anyone who RSVP'd but wasn't returned by that roster
  query (most likely because they'd since left the team, or the event's
  target teams changed after they RSVP'd) was silently dropped from every
  list, despite their RSVP being correctly saved.
  **Correction (2026-08-20):** the original write-up of this fix blamed
  `team_members.role` for not allowing `'manager'` — that was wrong.
  Migration 048 added `'manager'` as a valid `team_members.role` value
  back in V1.4, and this query has no role filter, so managers were never
  excluded. The method now also looks up anyone in `event_rsvps` who
  wasn't matched to a roster row and shows them in the right bucket under
  their real name, instead of discarding a response someone actually
  gave — that defensive fix is still correct regardless of the exact
  reason a roster row was missing.

## [2026-08-20] - Schedule/RSVP Fixes (validation, performance, past/upcoming, attendee list)

Six issues reported on the Schedule/RSVP page after V1.1a closeout. This
entry covers the four tackled first per the agreed fix order; caregiver
multi-child RSVP is a deferred schema/design discussion, not yet built —
see NEXT-SESSION-NOTES.md.

### Fixed
- **Create Event validation gave no indication of what was missing.**
  `handleCreateEvent` in `src/pages/Schedule.tsx` now builds a specific set
  of missing fields and shows a red banner naming them (e.g. "Please
  complete: Date, Venue"), plus red-border highlighting on each invalid
  field. The banner previously rendered at the page level, behind the
  modal's `z-[60]` overlay — from the user's perspective, hitting Create on
  an incomplete form did nothing at all. It's now inside the modal itself.
- **RSVP tap had a multi-second delay before reflecting the change.**
  `handleRsvp` and `handleDeclineConfirm` now update local state
  immediately (optimistic update), then reconcile with the server response
  or roll back on error. `eventsApi.setRsvp` (`src/lib/events-api.ts`) was
  also collapsed from a SELECT-then-INSERT/UPDATE (two network round trips
  per tap) to a single `.upsert()` on the `(event_id, user_id)` unique
  constraint from migration 023. Combined, RSVP taps and decline-reason
  confirms should now feel instant.

### Added
- **Past events grey out and lock RSVP.** Schedule now splits events into
  Upcoming (ascending date) and Past (descending date, own "Past Events"
  section, greyed card + "Event has passed — RSVP closed" in place of the
  buttons). Coach/manager/admin can still hit Edit on a past event (e.g. to
  mark it cancelled or correct a date that was actually moved) — only the
  Send Reminder button and RSVP buttons are hidden for past events.
- **Attendee list view.** Tapping the "X/Y attending" line on any event now
  opens a modal listing everyone by status (Going / Maybe / Can't Go with
  their decline reason / No Response), sourced from the event's target
  team roster so "no response" is derivable, not just silence. New
  `eventsApi.getEventAttendeeDetails()` in `src/lib/events-api.ts`.

### Not yet fixed
- **New events sort to the bottom instead of the top.** Turned out to
  already be correct once past/upcoming were split — upcoming events sort
  ascending by date, so a newly created *future* event lands in its
  correct chronological slot, not necessarily first. If this still looks
  wrong after this update, it's worth a closer look at whether the
  complaint was really about past events cluttering the list (now fixed
  separately) rather than sort order itself.
- **Caregiver multi-child RSVP.** `event_rsvps` has one row per
  `(event_id, user_id)` — no per-child dimension. A caregiver with two kids
  on the same team currently can't RSVP separately for each. This needs a
  design decision (e.g. a `child_id` column, or treating each child as
  having their own RSVP-eligible identity) before any schema change —
  intentionally deferred, see NEXT-SESSION-NOTES.md.

## [2026-08-20] - V1.1a Fully Closed Out — Live Device Verification

No code changes — this entry verifies the [2026-08-19] V1.1a Closeout entry
below on the actual Oppo device and documents a build-tooling gotcha hit
along the way.

### Verified
- **Foreground toast**: confirmed live — a push arriving while the app is
  open surfaces an in-app toast.
- **Tap-to-open**: confirmed live — tapping a delivered notification
  (app backgrounded, not locked) opens straight to Messaging.
- **Safe-area**: confirmed live — header and bottom nav sit clear of the
  screen edges on-device.
- **Touch targets**: confirmed live — bottom-nav tabs are noticeably easier
  to hit.
- Sound + vibration (from the 2026-08-19 entry) reconfirmed working
  throughout this round too.

**V1.1a is now fully closed out** — all 10 items on the verification
checklist done and confirmed on the Oppo (CPH2477, Android 12, ColorOS 12.1).

### Fixed (process, not code)
- **First verification attempt looked like a regression — it wasn't.** No
  foreground toast, and a tapped notification didn't navigate. Root cause:
  `npx cap sync android` only copies whatever's currently in `dist/`, it
  doesn't run `npm run build` itself — and neither that command nor the
  subsequent Gradle build in Android Studio errors or warns when `dist/` is
  stale. The Oppo was running a build from before this session's JS changes.
  Confirmed via Logcat: the on-device JS bundle filename
  (`index-a0YP_yLY.js`) didn't match a fresh local build of the same commit
  (`index-BpluvNrK.js`) — different content hash, provably different code.
  **Standing rule going forward: always run `npm run build` immediately
  before `npx cap sync android`, every time, even if you built earlier in
  the same session.**

## [2026-08-19] - V1.1a Closeout — Vibration Fix, Foreground/Tap Push Handling, Safe-Area & Touch Targets

Closes out V1.1a. Continuation of the same-day push-notification work below:
the sound fix landed first, this entry covers the vibration follow-up plus
the three remaining checklist items (foreground/tap push handling, safe-area,
touch targets).

### Fixed
- **Vibration still silent after the sound fix.** Root cause: the
  `"messages"` channel only called `enableVibration(true)` with no explicit
  pattern, relying on Android's implicit default — unreliable on this device
  (ColorOS 12.1, Oppo A17/CPH2477). Notification channels are **immutable
  once created**, so this couldn't be patched in place.
  - `MainActivity.java` / `AndroidManifest.xml`: bumped the channel id to
    `"messages_v2"` and added an explicit
    `channel.setVibrationPattern(new long[]{0, 250, 250, 250})`.
  - **Verified live, phone locked:** both sound and vibration now fire
    correctly.

### Added
- **Foreground push handling** (`src/hooks/usePushNotifications.ts`): added
  the missing `pushNotificationReceived` listener. A push arriving while the
  app is open now surfaces as an in-app toast (via `sonner`, mounted in
  `src/App.tsx`) with a "View" action, since Android suppresses its own
  system banner for a foregrounded app by design and previously this case
  produced nothing visible at all.
- **Tap-to-open handling**: added the missing `pushNotificationActionPerformed`
  listener. Tapping a delivered notification now navigates straight to
  Messaging (via `router.navigate()` on the app's `createBrowserRouter`
  instance, so it works from outside React's render tree). No per-thread deep
  link yet — the app has a single Messaging screen, so every push routes
  there regardless of content.
- **Safe-area (notch/gesture-bar) handling**: `index.html`'s viewport meta
  now includes `viewport-fit=cover` (required for `env(safe-area-inset-*)` to
  report real values instead of 0), and `src/styles/theme.css` gained
  `.safe-area-top` / `.safe-area-bottom` utility classes applied to the fixed
  header and bottom nav in `src/layouts/MainLayout.tsx`. Previously **no
  safe-area handling existed anywhere in the active layout** — the only trace
  of it was in an unused legacy `src/app/components/MainLayout.tsx` that
  referenced classes that were never defined in CSS.
- **Bottom nav touch targets**: each tab now has a `min-h-[48px]` target
  (Material Design's recommended minimum) instead of shrink-wrapping to a
  16px icon + 9px label — icons bumped to 20px, labels to 10px, tab padding
  increased. Main content's bottom padding adjusted to match the taller nav
  plus its safe-area inset so page content is never hidden behind it.

### Verified
- `npm run build` (`vite build`) completes clean with the above changes —
  no new TypeScript/build errors.
- Not yet re-verified live on the Oppo after this round — needs
  `npx cap sync android`, rebuild in Android Studio, and reinstall before
  the foreground toast, tap-to-open, safe-area and touch-target changes are
  confirmed on-device (same as any native/JS change, a hot reload alone
  won't pick these up).

### Not yet done
- No per-thread deep link — tapping any message notification opens Messaging
  generally, not the specific thread. Would need the `send-message-push` Edge
  Function to attach a `data` payload (currently sends `notification` only)
  and a per-thread route in the app, neither of which exist today. Not
  blocking V1.1a; noted as a future enhancement.

## [2026-08-19] - V1.1a Android Push Notifications — Silent Notification Root-Caused & Fixed

Continuation of on-device Android testing (Snapdragon laptop + Oppo CPH2477,
via Android Studio). Push delivery itself was already working — the missing
piece turned out to be sound/vibration, not delivery.

### Fixed
- **Push notifications arrived silently — no sound, no vibration, no heads-up
  banner.** Root cause confirmed via Logcat: `AndroidManifest.xml` had no
  `com.google.firebase.messaging.default_notification_channel_id` meta-data,
  so FCM fell back to its own auto-created "Miscellaneous" channel at
  `IMPORTANCE_LOW`, which delivers quietly into the notification shade with no
  sound/vibration/heads-up. Confirmed live: Logcat showed `FirebaseMessaging:
  Missing Default Notification Channel metadata in AndroidManifest. Default
  value will be used.` at the exact moment a locked-screen test push arrived,
  and the phone showed a silent lock-screen popup with no sound — matching the
  fallback-channel theory exactly.
- **`android/app/src/main/java/com/clubfootball/app/MainActivity.java`**: now
  creates a `"messages"` notification channel at `IMPORTANCE_HIGH` (vibration +
  lights enabled) in `onCreate()`, before any push can arrive.
- **`android/app/src/main/AndroidManifest.xml`**: added the
  `com.google.firebase.messaging.default_notification_channel_id` meta-data
  tag, pointing FCM at the `"messages"` channel above.

### Verified
- Delivery itself (separate from the sound/vibration bug above) was confirmed
  live via Logcat with the phone **locked** (the correct test — app
  foregrounded or even just backgrounded-but-visible doesn't exercise real
  system-level display): `FirebaseInstanceIdReceiver` fired and
  `FirebaseMessaging` processed the message, and a silent notification did
  appear on the lock screen.

### Not yet done
- **Rebuild + reinstall not yet verified on device** — this fix needs
  `npx cap sync android` and a fresh install on the Oppo before it's confirmed
  end-to-end. Native manifest/Java changes aren't picked up by a JS-only reload.
- **Foreground/tap handling still missing** — `usePushNotifications.ts` only
  listens for `registration`/`registrationError`. There's no
  `pushNotificationReceived` listener (so a push arriving while the app is open
  does nothing visible) and no `pushNotificationActionPerformed` listener (so
  tapping a notification doesn't deep-link to the relevant thread). Separate
  from the silent-notification fix above; not yet scheduled.

## [2026-08-18] - V1.5 Role-Aware Navigation

### Changed
- **Bottom navigation is now per-role, driven by App_Role** (`users.role`),
  replacing the old `hasFullVersion`/`hasLiteVersion` (3-vs-6) split in
  `src/layouts/MainLayout.tsx`. `user_type` (lite/full) no longer affects the
  nav — a lite manager sees the same tabs as a full manager. Max 6 tabs per role:
  - Player / Caregiver: Home · Team · Schedule · Messages (4)
  - Manager: Home · Team · Games · Schedule · Messages (5)
  - Coach / Admin: Home · Team · Coaching · Games · Schedule · Messages (6)
- **Coaching** tab is now Coach/Admin only; **Games** is Manager/Coach/Admin (its
  coach-only feedback section is gated inside the page).
- **Resources** moved off the bottom bar to a card on the Home dashboard, and its
  route (`/resources`) is now open to every authenticated role (was
  admin/manager/coach only).

### Added
- **Team** tab in the mobile bottom nav (route `/team` existed since V1.4 but had
  no nav entry). Positioned 2nd, after Home, using the freed Resources purple
  (`#8b5cf6`).
- **Resources quick-link card** on the Home dashboard (`src/pages/Landing.tsx`).

### Technical Notes
- Deployed 2026-08-18 as `prototype@01d41fd`. Resolves Open Decision 4 (the two
  undecided player/caregiver nav slots).

## [2026-08-18] - V1.4 Post-Registration Welcome, Team Page & Fixes

Spec: `.kiro/specs/post-registration-welcome-and-team-page/`. Bundles the
post-invite onboarding experience, the first mobile **Team** page, the
foundational **add-a-junior** consent flow, and two defect fixes (Finding A:
player home teams count; Finding B: manager invitees landing as players).
Deployed to production on 2026-08-18 (migrations, three Edge Functions, and the
frontend via `prototype@bcc63ce`).

### Fixed
- **Manager role on invite redemption (Finding B)** — `redeem-invite` hardcoded
  `role: 'player'`, so Manager invitees landed as players. Redemption now
  resolves the effective role from the invite's `intended_role` via
  `resolveEffectiveRole` and applies it identically to both the `users` profile
  row and the `team_members` row. Null/absent or any invalid value (including
  `admin`) safely defaults to `player`; the server continues to ignore any
  client-supplied `role`/`user_type`/`team_id`/`active`. The Add Tournament Team
  manager-invite flow now sets `intended_role = 'manager'`.
- **Player home dashboard "Teams" count (Finding A)** — the home dashboard
  "Teams" stat counted all `teams` rows, which RLS reduces to zero for
  player-role users. Player-role users now see their personal count derived
  from `team_members` via `teamsApi.getMyTeamCount`; admins still see the
  club-wide count. A failed team-membership query now shows an error
  indicator for the "Teams" stat only, leaving the other stats unaffected.
- **Games and Coaching team reads** — both pages now read team data through
  the `team_members → teams` join keyed on the current user
  (`teamsApi.getMyTeams`) so the result equals the user's membership rather
  than being reduced to zero by the `teams` SELECT policy. Coaching previously
  read `teams` filtered by `coach_id`, which returned nothing for players.

### Added
- **Database schema (migrations 046–051)**:
  - `046` — single-row `club_settings` branding table (RLS: authenticated read,
    admin manage).
  - `047` — `teams.team_type` (`club_tournament` | `external_league`) driving
    editability and the consent path.
  - `048` — allow `manager` on `team_members.role` and enforce a max-two-Managers
    cap at the data layer via the `enforce_manager_cap()` trigger.
  - `049` — `invite_codes.intended_role` (`player`/`coach`/`manager`; `admin`
    excluded by design).
  - `050` — `users.is_child` + `users.child_provenance` for Model-A children.
  - `051` — `caregiver_approvals.request_kind` (`add_caregiver`/`add_child`) and
    `team_id` so the table also serves as the add-a-child consent record.
- **Mobile Team page** (`src/pages/TeamPage.tsx`, routed at `/team`) — team
  selector (auto-select single team, prompt on multiple, empty state on none),
  roster grouped Coach → Manager → Player with inactive members greyed and sorted
  last, contact display by age band (own cellphone for U17/Open; caregiver for
  U16-and-below; missing indicator when unlinked), role/team-type-gated actions
  (edit, change role, deactivate/reactivate, promote-to-Manager disabled at cap),
  a 10-second roster-load timeout with retry, and `pb-20` mobile clearance.
- **Add-a-Junior modal** (`src/components/team/AddJuniorModal.tsx`) — captures
  caregiver name/email/phone and child first/last name only (no child contact,
  DOB, or photo), surfaces per-field validation errors while retaining values.
- **Branded, path-aware post-registration Success Screen**
  (`src/pages/LiteLandingPage.tsx`) — matching / confirmation-required / generic
  variants driven by the `redeem-invite` result, with guidance text and
  conditional competition name and app link. All branding via `useClubBranding()`.
- **`useClubBranding()` hook** (`src/hooks/useClubBranding.ts`) — reads the
  single-row `club_settings` table; every field nullable so absent values are
  omitted rather than defaulted (club-agnostic rule).
- **API wrappers** — `invites-api` returns a typed `RedeemInviteResult` and
  fire-and-forget-triggers the `welcome` email on the matching path;
  `teams-api.getMyTeamCount` / `getMyTeams` (team_members → teams join).
- **Add-a-Junior consent flow — API layer** (`caregivers-api.addJunior` + consent
  handlers). Orchestrates the double opt-in for adding a child to a Club
  Tournament team: validates the form, resolves or creates the caregiver
  (reusing an existing `users` row where the email matches, otherwise creating
  a sign-in-capable account), creates an inactive child `users` row with a
  synthetic non-sign-in email and recorded provenance, links child↔caregiver
  in `player_caregivers` (no duplicates), inserts a pending `caregiver_approvals`
  record (`request_kind = 'add_child'`), and emails the caregiver an
  approval request. Consent handlers (`approveJunior` / `denyJunior` /
  `escalateJunior`) set the approval status + `responded_at` and activate or
  keep the child inactive accordingly. All decision logic reuses the pure
  helpers in `add-junior-logic.ts`.
- **`create-auth-user` Edge Function** — service-role primitive that creates a
  single `auth.users` + `public.users` row and returns the id. Needed because
  the browser cannot mint auth users. Creates sign-in-capable caregivers (real
  email) or no-sign-in children (server-generated synthetic `.invalid` email,
  unconfirmed). Gated to admin or coach/manager callers. Requires
  `supabase functions deploy create-auth-user`.
- **`caregiver_approval_request` email type** (`send-email` Edge Function) — the
  add-a-junior approval-request notification to caregivers, sharing the existing
  onboarding email build/send path; copy only, club branding still from env vars.


- **Welcome and confirmation onboarding emails** (`send-email` Edge Function).
  The function now accepts two new email types alongside `team_invite`:
  - `welcome` — sent on the matching-address registration path to greet the
    registrant and point them at their Team page.
  - `confirm_registration` — sent on the non-matching-address path, carrying
    a server-generated confirmation link and one explanatory sentence noting
    the address used differs from the invited one, that confirming completes
    registration if intentional, and that the recipient may ignore it and
    re-register with the invited address.
  Both types share a single email-build/send implementation, differing only
  in copy. Club branding still comes solely from env vars (`CLUB_NAME`,
  `CLUB_COLOR`, `APP_URL`, `EMAIL_FROM`, `EMAIL_REPLY_TO`) and team names are
  rendered verbatim from server-supplied `{age_group} {name}` values — the
  client passes no branding or team-name overrides.

### Technical Notes
- **Deployment (2026-08-18)**: migrations 046–051 applied to production; Edge
  Functions `redeem-invite`, `send-email`, and `create-auth-user` deployed;
  frontend pushed to `kiro prototype` and published by Netlify as
  `prototype@bcc63ce`.
- **Migration 036 recovery**: applying 051 failed with `relation
  "public.caregiver_approvals" does not exist`. Investigation showed migration
  036 had only been *partially* applied in production — its earlier objects
  (competitions, competition_teams, invite_codes, player_caregivers) existed but
  the `caregiver_approvals` table (036 §6) had never been created. A recovery
  migration `045b_caregiver_approvals_backfill.sql` re-creates that table
  (idempotent) and must run before 051; it is now committed so fresh setups get
  it too. All six V1.4 migrations plus the backfill were applied together.
- **Post-deploy follow-ups**: seed the `club_settings` row (branding is omitted
  until it exists); production smoke test (Team page, success screen, teams
  count, end-to-end add-a-junior consent); the spec's 32 optional
  property/unit/integration tests remain unwritten (task 10.6 integration tests
  prioritised given the 036 partial-application finding).
- **Verification**: `npm run build` green and full test suite (101 tests)
  passing at time of ship.

## [2026-08-17] - Lite User Registration From An Invite Link (Bug Fix)

### Fixed
- **Self-registration from an invite link now works.** It previously failed
  with *"new row violates row-level security policy for table users"* and
  no account was created. Cause: with email confirmation enabled,
  `supabase.auth.signUp()` returns **no session**, so the browser was still
  the anonymous role when it tried to insert the profile row, and the
  `id = auth.uid()` policy could never pass.
- **The whole redemption is now one server-side transaction** in a new
  `redeem-invite` Edge Function running as `service_role`: create or resolve
  the account, insert the `users` row, add the `team_members` row, then mark
  the code redeemed last, so a failure never burns the invite code.
- **No half-finished accounts.** If any step fails, the function undoes, in
  reverse, only what that attempt created — membership, then profile row,
  then auth user — and never touches records that already existed. A retry
  with the same email and the same code then succeeds.
- **Registrants who use the address the invite was sent to are confirmed
  immediately** and can log straight in with no confirmation email. Someone
  registering with a *different* address still gets the account and the team
  membership, but stays behind Supabase's email-confirmation gate.
- **Accounts orphaned by the old bug are adopted, not blocked.** Where the
  old flow created a login but never got as far as the profile row, the
  invited address now takes that account over and sets the submitted
  password. A login that exists for an address the invite was *not* sent to
  is refused with "an account already exists for this email — try logging in
  instead" rather than being taken over.
- **Registration errors are now plain language.** Nothing on the page can
  show a policy name, constraint name or raw database text; the raw detail is
  logged server-side only.
- **Invite pages no longer show "undefined undefined" as the team.** New
  migration `045_anon_select_teams_for_invites.sql` grants the anonymous role
  a **scoped** read on `teams` — only teams reachable through a valid,
  unexpired, unredeemed invite code. A team whose only invite has expired
  stays invisible, and anonymous visitors still cannot write to `teams`. The
  invite heading and success screen now read "U9 Hydrogen".

### Technical Notes
- **This fix needs `supabase functions deploy redeem-invite`.** Already run —
  the function is ACTIVE at version 1 on `pikrxkxpizdezazlwxhb`, deployed
  with default JWT verification (`--no-verify-jwt` was not needed; the anon
  key supabase-js sends satisfies it).
- **`git push kiro prototype` does NOT deploy Edge Functions.** Pushing app
  code alone would leave the client calling a function that does not exist.
  Migration `045` must be run in the Supabase SQL Editor the same way — it
  has been applied.
- The client wrapper `invitesApi.redeemInviteCode()` keeps its signature and
  is now a single `functions.invoke('redeem-invite', …)` plus an error-body
  read, so `functions.invoke` cannot collapse every failure into
  "Edge Function returned a non-2xx status code".
- `validateInviteCode()` deliberately stays client-side and anonymous, so the
  three invite states (Invalid Code / Already Used / Code Expired) and their
  copy are unchanged.
- The function is club-agnostic: it returns data only, no club name, colour,
  logo or URL. `LiteLandingPage` still formats the team as
  `{age_group} {name}`.
- Test tooling added: `vitest` + `fast-check` as devDependencies with
  `npm test` (`vitest --run`, never watch mode), plus `tsx` verification
  scripts under `scripts/` for the paths that need real RLS and real GoTrue
  behaviour.

### Security
- `redeem-invite` is an **unauthenticated** endpoint that can create auth
  users; the invite code is the authorization, and any client-supplied
  `role`, `user_type`, `team_id` or `active` is ignored and set server-side.
  **Rate limiting is out of scope for this fix** and remains an open item.

### Outstanding
- A registrant who signs up with an address the invite was *not* sent to is
  left unconfirmed, and GoTrue does not send a confirmation email for an
  admin-created account — so they need a resend/confirmation trigger before
  they can get past the login gate.
- The expired-code notification to the inviter still emits nothing:
  `validateInviteCode()` stays anonymous and cannot read the inviter from
  `public.users`. It is also still a `console.log` TODO with no in-app
  message wired.
- The duplicate-key branch on the profile insert treats **any** 23505 as the
  migration-006 trigger case, so a genuine `users_email_key` collision on a
  different id would surface the wrong message. Unreachable in normal use on
  this project (that trigger is not live); needs the check narrowed to the id
  conflict or an affected-row count.

## [2026-08-14 - Part 4] - Transactional Email Live (V1.2 Complete)

### Added
- **Resend sending domain `send.clubfootball.app`**, verified, Tokyo
  region. DKIM, SPF, MX and DMARC records added in Cloudflare and all
  confirmed resolving.
- Supabase secrets: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`,
  `CLUB_NAME`, `CLUB_COLOR`.
- `send-email` Edge Function deployed. **Test send succeeded** —
  Resend returned a message ID.

### Technical Notes
- **Separate Resend account, not the existing one.** The free plan allows
  one domain per team; the existing team's slot was used by another
  project, and creating a second team is a paid Pro feature ($20/mo).
- **Manual DNS entry chosen over Resend's "Auto configure"** — the latter
  grants an OAuth token with ongoing DNS write access to the same zone
  that points the app at Netlify. Four one-time records, verified by DNS
  lookup, is the better trade.
- **Resend shows record names relative to the zone root**, which is what
  Cloudflare expects. Enter them verbatim; appending the domain yourself
  yields `send.send.clubfootball.app.clubfootball.app`.
- "Enable Receiving" left off — send-only by design.
- Sending from the `send.` subdomain rather than the root isolates email
  reputation from the domain serving the app.

### Security
- The first Resend API key was pasted into chat and so was **revoked and
  replaced immediately**. The replacement is scoped to **Sending access
  only** and was transferred via a file outside the repo, deleted after
  use. Recorded as a standing rule in the steering file.

### Fixed
- **Invite emails now include a plain-text alternative.** HTML-only mail
  is a recognised spam signal, and the first test email landed in
  Outlook's Junk folder.
- **Subject line was using HTML-escaped values.** A team named
  "Mike's Team" would have arrived as "Mike&#39;s Team". Subject lines and
  the plain-text part now use raw values; only the HTML body is escaped.

### Outstanding
- `EMAIL_REPLY_TO` unset, so replies to invites bounce. Needs a decision
  on whether invites should be repliable and to which monitored address.
- **Deliverability needs reputation, not configuration.** New sending
  domain with no history; Outlook filed the first message as junk despite
  correct SPF/DKIM/DMARC. Marking messages "Not junk" and real recipient
  engagement are the fixes. Revisit tightening DMARC from `p=none` to
  `p=quarantine` after a couple of weeks of clean sending.

## [2026-08-14 - Part 3] - Product Domain Live: clubfootball.app

### Added
- **`clubfootball.app`** registered at Cloudflare Registrar (~$14.20/yr)
  and now serving the app over HTTPS. `www.clubfootball.app` 301-redirects
  to the apex; the Let's Encrypt certificate covers both hostnames.
- DNS: apex CNAME → `apex-loadbalancer.netlify.com`, `www` CNAME →
  `wcrfootball.netlify.app`, **both with the Cloudflare proxy disabled
  (DNS only)**.

### Changed
- Active docs and scripts now reference `https://clubfootball.app` as the
  production URL: steering standards, `DEPLOYMENT.md`,
  `DEPLOYMENT-GUIDE.md`, `DEPLOY-EDGE-FUNCTIONS.md`, `TROUBLESHOOTING.md`,
  `UPTIME-MONITORING.md`, `scripts/bulk-import-users.js`. The old
  `wcrfootball.netlify.app` still resolves and remains the Netlify build
  target.
- `send-email` Edge Function `DEFAULT_APP_URL` → `https://clubfootball.app`.
  Still overridable via the `APP_URL` secret, and still club-agnostic —
  this is the *product* domain, which is the right default for any club
  deploying unchanged.

### Fixed
- `docs/deployment/TROUBLESHOOTING.md` named the archived
  `coaching-app-prototype` repo and a `main` branch. Corrected to
  `WCR-Football-App` / `prototype`.

### Technical Notes
- **Netlify's DNS verification is unreliable — don't trust it over
  evidence.** It reported success, then "clubfootball.app doesn't appear
  to be served by Netlify", then success again. At the point it claimed
  failure, the apex already resolved to exactly the same IPs as
  `apex-loadbalancer.netlify.com` from both Cloudflare and Google
  resolvers, and plain HTTP returned `200` with `Server: Netlify` serving
  the real app. Their check appears to depend on HTTPS being live, which
  is the very thing the certificate provides. Retry rather than changing
  DNS records.
- **Cloudflare proxy must stay off.** On Cloudflare's default "Flexible"
  SSL mode a proxied record produces a redirect loop and blocks Netlify's
  certificate. Cloudflare's dashboard actively nags to enable proxying —
  ignore it.
- Cloudflare flattens CNAMEs at the apex automatically, which satisfies
  Netlify's *recommended* apex configuration. The `75.2.60.5` A-record
  fallback isn't needed, and avoiding a hardcoded IP is what protects
  against repeats of Netlify's 2025 load-balancer IP retirement.
- **Declined**: "Use Netlify DNS" (impossible — Cloudflare Registrar
  requires Cloudflare nameservers) and "make `www` primary" (marginal CDN
  gain, but this URL goes into invite emails, texts and future app deep
  links, where the short form wins).
- **Outstanding**: Supabase Auth URL Configuration still points at the old
  domain. `resetPassword()` derives its redirect from
  `window.location.origin`, and Supabase silently falls back to the Site
  URL for non-allowlisted redirects — so resets would bounce to the old
  domain rather than error visibly. See NEXT-SESSION-NOTES V1.0.

## [2026-08-14 - Part 2] - "Send Link" — Invites Emailed Directly from the App

### Added
- **`src/lib/email-api.ts`**: client wrapper for the `send-email` Edge
  Function. Sends only data (recipient, team name, competition name,
  invite code) — deliberately **no branding from the browser**, so club
  name/colour/app URL have exactly one source (the function's env vars).
  Also unwraps `functions.invoke` errors, which otherwise surface as an
  unhelpful "Edge Function returned a non-2xx status code".
- **"Send Link" buttons on the Competitions page**, in three places:
  1. Add Tournament Team modal, once the team and manager invite exist
  2. Per-team Invite modal, once the code is generated
  3. Each pending row in the Invites panel — so an invite can be resent
     later without regenerating the code

### Changed
- Invite emails send the team name in the project's standard display
  format, `"{age_group} {name}"` (e.g. "Open Bozos"), not the bare name.
- Modal helper text now mentions emailing rather than only sharing.
- `.kiro/steering/project-standards.md`: recorded which values are club
  branding (configurable — including "Urrah") versus product design
  (fixed — the six page colours, typography, layout). Only the
  primary/header colour is club branding.

### Technical Notes
- **"Copy Link" is retained everywhere as a fallback.** It's not legacy —
  it stays useful, and it carries a different security model: a pasted
  link proves nothing about who clicked it, whereas an emailed link
  proves the recipient owns the address (this is what unblocks V1.3).
  If a send fails, the error message tells the admin to use Copy Link, so
  an email outage never blocks onboarding.
- Send state is tracked per invite code, so each row shows its own
  Sending/Sent state. The button becomes "Resend Link" after a send.
- **Not yet functional end-to-end**: needs `RESEND_API_KEY` set and
  `send-email` deployed. `npm run build` passes; no Deno runtime locally
  to execute the function.

## [2026-08-13 - Part 3] - Push Notification Pipeline Confirmed Working End-to-End

### Added
- **`supabase/migrations/042_message_push_trigger.sql`**: database trigger
  on `message_recipients` INSERT that calls the `send-message-push` Edge
  Function via `pg_net` directly. Built as a workaround after discovering
  Supabase's dashboard "Database Webhooks" feature is broken on this
  project (see Fixed section below).
- Service role key stored in Supabase Vault, read by the trigger function
  at runtime rather than hardcoded.

### Fixed
- **Dashboard Database Webhooks feature is broken on this Supabase
  project**: creating a webhook via the dashboard UI consistently failed
  with `schema "supabase_functions" does not exist` / `function
  supabase_functions.http_request() does not exist`. This is an internal
  Supabase-managed function that should be pre-provisioned automatically
  on every project but is missing here. Two attempts to fix it directly
  (creating the schema, enabling the `http` extension) did not resolve
  it — concluded this isn't fixable via ordinary SQL and worked around it
  entirely by calling the lower-level `pg_net` extension directly instead
  (confirmed already properly installed on this project).
- **Edge Function rejecting requests with `401 UNAUTHORIZED_INVALID_JWT_FORMAT`**:
  root cause was a copy-paste error — the Vault secret had literally been
  set to the placeholder text from setup instructions
  (`YOUR_ACTUAL_SERVICE_ROLE_KEY_HERE`) rather than the real key. Fixed via
  `vault.update_secret()`, re-verified by checking key length/prefix
  directly in SQL before re-testing.

### Verified
- **Confirmed end-to-end, live, in production**: sent a real message
  through the deployed web app, confirmed via `net._http_response` that
  the trigger fired, called the Edge Function, and got back HTTP 200 with
  `{"success":true,"devicesFound":0,"sent":0}`. Zero devices found is
  correct and expected — no device tokens exist yet since no native app
  has run on real hardware. This confirms the entire pipeline (trigger →
  Edge Function → FCM readiness) works correctly up to the point where a
  real device token would exist.

## [2026-08-13 - Part 2] - Capacitor Setup & Push Notifications Infrastructure

### Added
- **Capacitor initialized**: App ID `com.clubfootball.app` (deliberately
  generic, not tied to WCR specifically, in case other clubs adopt this
  app in future). Android and iOS native platform projects added
  (`android/`, `ios/`). Plugins installed: `@capacitor/app`,
  `@capacitor/push-notifications`, `@capacitor/status-bar`,
  `@capacitor/splash-screen`. Confirmed: `npm run build` succeeds,
  `cap sync` recognizes all 4 plugins on both platforms.
- **Firebase project created**: `club-football-app` (Spark/free plan).
  Android and iOS apps registered under `com.clubfootball.app`.
  `google-services.json` and `GoogleService-Info.plist` downloaded and
  placed (safe to commit — scoped to package name/bundle ID, not a
  general secret).
- **`device_tokens` schema alignment** (migration 041): the table already
  existed from migration 033 (Team Messaging), unused until now — added
  the missing `updated_at` column/trigger rather than duplicating the
  table.
- **`src/lib/device-tokens-api.ts`**: register/remove a device's push
  token, matching the real `device_tokens` schema (`device_token` column,
  not `token` — see Fixed section below).
- **`src/hooks/usePushNotifications.ts`**: requests push permission,
  registers with FCM, stores/removes the token in Supabase on
  sign-in/sign-out. Wired into `App.tsx`. No-ops entirely on web
  (`Capacitor.isNativePlatform()` check) — zero impact on the existing
  Netlify-deployed web app.
- **Realtime reconnect on app resume**: mobile OSes suspend WebSocket
  connections while an app is backgrounded; without this, Team Messaging
  would appear frozen until a manual refresh. Bundled into the same hook.
- **`supabase/functions/send-message-push`**: Edge Function that sends a
  push notification (via FCM HTTP v1 API, OAuth through a service
  account) when a new team message is inserted. Uses
  `message_recipients.notification_pending`, a column that existed
  unused since migration 033. Includes a README with the manual setup
  steps (Firebase service account key, `supabase secrets set`, webhook
  configuration) — none of which can be automated, all require dashboard
  access.
- **`docs/project/CAPACITOR-SCOPING.md`** (see previous entry) is now
  partially implemented — Steps 1, 4, and 5 of its build order are code-
  complete; Steps 2, 3, 6, 7 remain.

### Fixed
- **`device_tokens` migration mismatch**: the first version of migration
  041 assumed the table didn't exist and tried to create it fresh with
  different column names (`token` vs the real `device_token`). Since it
  used `CREATE TABLE IF NOT EXISTS`, it silently no-op'd against the
  table already created in migration 033 — no error, just quietly did
  nothing. Caught by querying the live schema directly rather than
  trusting the "success" result. Replaced with a corrected migration
  that only adds what was missing, and fixed the API layer to use the
  real column names.

### Technical Notes
- **Not yet verified on a real device.** No Mac/Xcode or Android Studio
  available on this machine. All code is written against Capacitor and
  Firebase's documented APIs and follows this repo's existing
  conventions, but "compiles and matches the docs" is not the same as
  "confirmed working." Real device testing is the next milestone once
  a Mac is available.
- **Edge Function is genuinely untested** — no Deno runtime available
  locally to execute or type-check it. Requires manual deployment and a
  Firebase service account key (a sensitive credential) that only the
  user can generate and store via Supabase secrets — cannot be automated
  by an assistant.
- Installed Firebase CLI and GitHub CLI on this machine during setup;
  both required troubleshooting corrupted/interrupted installs before
  working correctly (documented inline in the session, not repeated
  here for brevity).

## [2026-08-13 - Part 1] - GitHub Structure Cleanup, Repo Recovery & Capacitor Scoping

### Fixed
- **Recovered `src/` and `supabase/migrations/`**: both were missing from disk
  (245 files) following a laptop folder consolidation earlier the same day.
  Nothing was actually lost — restored cleanly from the last commit on the
  `kiro/prototype` branch (April 7). Confirmed complete: 186 files in `src/`,
  43 migrations restored.
- **Fixed Supabase keep-alive workflow returning HTTP 401**: the anon key
  cannot query the bare REST root (`/rest/v1/`) on current Supabase projects —
  that endpoint now requires the `service_role` key. Switched the ping to
  query the `teams` table instead (confirmed HTTP 200), and added a failure
  check so the job goes red in GitHub Actions if it breaks again instead of
  passing silently.
- **Fixed GitHub Actions not recognizing the keep-alive workflow**
  (`workflow_dispatch` returned 404): the workflow was only pushed to
  `prototype`, but GitHub only recognizes scheduled/manually-triggered
  workflows from the repository's *default* branch, which was still `main`
  (months stale). Fixed by making `prototype` the default branch.

### Changed
- **Consolidated GitHub structure from two repositories to one.** The
  previous setup (`Mikebrooke65/.kiro` + `Mikebrooke65/coaching-app-prototype`)
  was legacy clutter from initial project setup, not a deliberate backup
  strategy, and the two repos had silently drifted out of sync more than
  once — `coaching-app-prototype` was missing entire features (Tournament
  Management, Admin Reporting, Team Messaging, Game Day Subs, User Role
  Management) that had been on `.kiro` for months.
  - Renamed `Mikebrooke65/.kiro` → `Mikebrooke65/WCR-Football-App`
  - Renamed `Mikebrooke65/coaching-app-prototype` → `Mikebrooke65/football-app-old`
    and archived it (read-only)
  - Removed the local `origin` git remote entirely — `kiro` is now the only
    remote
  - Updated all active documentation (steering file, both deployment guides,
    `NEXT-SESSION-NOTES.md`) to reflect the single-remote workflow
- **Reorganized root-level documentation into `docs/`** subfolders
  (`docs/project`, `docs/deployment`, `docs/lessons`, `docs/archive`) — this
  reorg had been done on disk previously but never committed to git; it's
  now properly recorded as file renames/moves.
- **Excluded local `_archive/` folder from git** via `.gitignore`. This
  folder (kept on disk intentionally as a safety net during the laptop
  folder consolidation) contains nested repositories from other projects
  (`coaching-app-prototype`, `family-resource-project`, `Urrah-coaching-app`)
  and specs belonging to a different project ("The Landing") — none of it
  belongs in this project's git history.

### Added
- **Supabase keep-alive GitHub Action** (`.github/workflows/supabase-keepalive.yml`):
  pings the Supabase project every 3 days to prevent the free tier's
  7-day auto-pause. Confirmed working (HTTP 200).
- **`docs/project/CAPACITOR-SCOPING.md`**: scoping document for wrapping the
  app with Capacitor for App Store / Google Play distribution. Reviews an
  external technical brief against the actual codebase — confirms auth is
  email/password only (the complex magic-link deep-linking pattern in most
  generic guides doesn't apply), flags the password reset redirect and
  invite-code deep links as real gaps needing a decision, and sequences the
  work against the three V1 priorities identified versus Heja: RSVP, push
  notifications, and app store distribution.

### Technical Notes
- GitHub CLI (`gh`) installed and authenticated on this machine, enabling
  direct repo administration (secrets, renames, archiving, default branch)
  going forward without manual dashboard steps.
- Root-level test credentials in `docs/deployment/DEPLOYMENT.md` were
  reviewed and intentionally kept as-is (plaintext, git-tracked) — flagged
  as a minor security tradeoff, kept for practical convenience on a
  test-only account.

## [2026-04-07] - Tournament Management Phase 1 MVP

### Added
- **Tournament Management**: Complete Phase 1 MVP implementation
  - Round-robin fixture generator (circle method algorithm, single/double format)
  - Standings engine with configurable scoring rules and tiebreakers
  - Tournament API layer (config, fixtures, standings, generation, recalculation)
  - Desktop Tournament Page (admin: config, generate fixtures, view standings/fixtures)
  - Mobile Tournament Page (user: standings/fixtures tabs, team highlighting)
  - StandingsTable, FixtureList, TournamentConfig reusable components
  - Database migration 040 (competitions extensions, events extensions, competition_standings table)
  - Routes: `/tournaments` (mobile), `/desktop/tournaments` (desktop)
  - "Tournaments" link in desktop sidebar navigation
  - events-api: `getEventsByCompetition()` method
- **Add Tournament Team**: Quick-create for external teams on CompetitionsPage
  - One-step flow: enter team name, age group, manager email → creates team, links to competition, generates invite code
  - Manager receives shareable link to register and onboard their players
  - Only visible for active Club Tournament competitions
- **Missing Tables Fix**: Created `competition_teams` and `invite_codes` tables (migration 036 had not been fully applied)
  - Round-robin fixture generator (circle method algorithm, single/double format)
  - Standings engine with configurable scoring rules and tiebreakers
  - Tournament API layer (config, fixtures, standings, generation, recalculation)
  - Desktop Tournament Page (admin: config, generate fixtures, view standings/fixtures)
  - Mobile Tournament Page (user: standings/fixtures tabs, team highlighting)
  - StandingsTable, FixtureList, TournamentConfig reusable components
  - Database migration 040 (competitions extensions, events extensions, competition_standings table)
  - Routes: `/tournaments` (mobile), `/desktop/tournaments` (desktop)
  - events-api: `getEventsByCompetition()` method

### Technical Notes
- Fixtures stored as events (automatic Schedule/Games integration)
- Standings materialized in competition_standings table (fast reads)
- Pure logic modules (round-robin.ts, standings-engine.ts) have no DB dependencies
- RLS: all authenticated read standings, admin-only write
- Schema supports Phase 2/3 extensibility (knockout, groups, referees, public views)

## [2026-04-07] - Lite User UI & Competition Type Rename

### Added
- **Lite User Invite UI**: Complete invite workflow on CompetitionsPage
  - "Invite" button on each team in Club Tournaments
  - Modal to enter email/phone and generate invite code
  - Shareable link with copy-to-clipboard
  - Invites panel showing all invites with status (Pending/Redeemed/Expired)
- **invites-api methods**: `getPendingInvitesForCompetition()`, `getAllInvitesForCompetition()`

### Changed
- **Competition types renamed**: `wcr` → `external_league`, `other` → `club_tournament`
- **CompetitionsPage**: Updated labels and conditional logic for new types
- **competitions-api**: Updated cleanup to check for `club_tournament`

### Technical Notes
- Migration 039 renames competition types in database
- Invite features only visible for Club Tournament competitions
- Lite users register via `/invite/:code` route (LiteLandingPage)

## [2026-04-07] - Admin Reporting Dashboard Phase 2

### Added
- **Phase 2 Feedback Analysis Reports**: Complete implementation
  - Lesson Effectiveness Report: View lesson quality based on coach feedback ratings
  - Session Ratings Report: Identify which sessions work well and need improvement
  - Game Feedback Report: View post-match analysis using 4 Moments framework
- **DrillDownModal Component**: Click-through to view detailed feedback comments
  - Star rating display
  - Coach name, team, and date for each feedback entry
  - Loading and empty states
- **Extended Reporting API**: New methods in `reporting-api.ts`
  - `getLessonEffectiveness()`: Aggregates lesson ratings and delivery counts
  - `getSessionRatings()`: Aggregates session ratings and usage counts
  - `getGameFeedback()`: Fetches 4 Moments game feedback with filters
  - `getLessonFeedbackDetails()`: Drill-down for individual lesson feedback
  - `getSessionFeedbackDetails()`: Drill-down for individual session feedback
- **New TypeScript Interfaces**: 
  - `LessonEffectivenessRow`, `SessionRatingsRow`, `GameFeedbackRow`, `FeedbackDetail`

### Technical Notes
- All 6 Phase 1+2 reports now complete and routed
- Phase 1: Lesson Delivery, Coach Activity, Team Training
- Phase 2: Lesson Effectiveness, Session Ratings, Game Feedback
- Routes added at `/desktop/reporting/*`
- Game Feedback uses card-based layout with 4 Moments color coding
- Drill-down modal reusable for both lesson and session feedback

## [2026-03-23] - Lesson Builder Enhancements & Allocation System

### Added
- **Lesson Allocation System**: Complete feature for controlling lesson availability
  - New `lesson_allocations` table tracking which lessons are allocated to which age groups
  - Allocation UI in Desktop Lesson Builder with U4-U17 toggle buttons
  - Green checkmark badges on allocated age groups
  - Allocation count display on lesson cards (e.g., "✓ 3")
  - Mobile coaching page now filters by allocation status
  - Only shows lessons allocated to team's age group
  - Bulk allocation SQL for initial setup
- **Save as New Button**: Desktop Lesson Builder
  - Green "Save as New" button next to "Save Changes"
  - Modal prompts for new lesson name
  - Creates copy of lesson with modifications
  - Button visibility based on create vs edit mode

### Changed
- **Desktop Lesson Builder UI**: Compact lesson cards
  - Reduced from 3 lines to 2 lines maximum
  - Smaller padding (p-3 → p-2)
  - Smaller fonts (text-sm → text-xs, text-xs → text-[10px])
  - All badges on single line
  - More lessons visible in left panel
- **Mobile Coaching Filtering**: Enhanced lesson filtering
  - Added division field to team query
  - Filters by age_group (from allocations), division, and delivery status
  - Removes lesson's own age_group constraint (allows cross-age allocation)
  - Shows "No available lessons" when none allocated

### Fixed
- **Division Filtering**: Mobile coaching page now correctly filters by team division
  - Added `division` to team SELECT query in Coaching.tsx
  - Teams now properly load with division field
  - Lessons filter by both age_group AND division

### Technical Notes
- Migration 037 creates lesson_allocations table with unique constraint
- RLS policies: all users view, admins manage allocations
- Allocation toggle updates database and refreshes UI optimistically
- Graceful fallback if allocations table doesn't exist
- Community pattern: allocate all lessons to age group
- Academy pattern: selectively allocate 2-3 lessons per week

---

## [2026-03-20] - Desktop UI Enhancements

### Added
- **Desktop Games Page**: Complete real data integration replacing mock data
  - Age group filtering for admin users (U4-U17 dropdown)
  - Team selection filtered by selected age group
  - Past games list with navigation arrows
  - Score recording and updating functionality
  - Game analysis with team and player feedback
  - Previous feedback display with timestamps
  - Manage Subs button linking to substitution management
- **Desktop Landing Dashboard**: Real statistics display
  - Total users count from database
  - Total teams count from database
  - Lessons and sessions counts
  - Deliveries this week (from lesson_deliveries table)
  - Feedback received this month (from game_feedback table)

### Changed
- **Desktop Schedule**: Redesigned layout for better space utilization
  - Changed from modal-based to inline event creation form
  - Left column narrowed to w-1/3 with compact event cards
  - Right column expanded to w-2/3 for event form
  - Event cards made more compact with smaller text and tighter spacing
- **Desktop Resources**: Fixed rules display
  - Removed duplicate unformatted rules list from left panel
  - Left panel now shows only age group selector
  - All formatted rules display exclusively in right panel

### Technical Notes
- Desktop Games uses gamesApi and eventsApi for real data
- Age group filter shows all U4-U17 groups with team counts
- Admin users can access all teams across all age groups
- Non-admin users see only their assigned teams
- Dashboard stats fetch on component mount with loading states
- Week calculation starts from Sunday for deliveries count
- Month calculation starts from 1st of month for feedback count

---

## [2026-03-13] - Desktop Schedule and Messaging Integration

### Added
- Created reusable TargetingSelector component for admin targeting across multiple pages
- Integrated real events API into desktop Schedule page (replaced mock data)
- Added event creation/editing functionality to desktop Schedule
- Enhanced targeting system with individual player selection capability

### Changed
- Desktop Schedule now uses real Event data structure from events API
- Updated Announcements page to use new TargetingSelector component
- Desktop Schedule filters now match mobile (Training/Games/General)
- Event cards show real attendance counts and team information
- Send Reminder functionality uses real event data and team targeting

### Technical Notes
- TargetingSelector supports hierarchical selection: Roles → Team Types → Divisions → Age Groups → Teams → Individual Players
- Desktop Schedule maintains two-panel layout with enhanced functionality
- Event creation modal matches mobile Schedule functionality
- Real-time attendance tracking integrated into desktop view

---

## [2026-03-13] - Schedule Page Improvements

### Added
- **Event editing**: Coaches/managers/admins can now edit existing events via Edit button on event cards
- **Simplified time picker**: Dropdown with common times (8:00 AM - 7:30 PM, 30-min intervals) instead of free-form time input
- **Venue dropdown**: Common venues (Fred Taylor Park, Huapai Domain, etc.) with Custom option for free text
- **Field number for games**: Optional field number input for game events (e.g., "Huapai Domain No 5")
- **Auto-hide title for games**: Title field hidden for game events, auto-populated as "Game"
- **Automatic team notifications**: When event details change, whole team receives message listing all changes (date/time, location, opponent, title)
- **Color-coded event cards**: Training (blue), Games (green), General (purple) backgrounds at 20% opacity for easy visual distinction
- **Enhanced reminder system**: Larger modal, 6-row textarea, includes current RSVP count in message, pre-configured for whole team (no targeting options)

### Changed
- **Create Event modal**: Improved scrolling with pinned footer buttons, increased z-index to appear above mobile nav, team selection moved to top
- **Modal height**: Reduced from 90vh to 85vh for better mobile spacing

### Technical Notes
- Event edit uses existing `updateEvent` method in events-api
- Change notification compares old/new event data and generates change summary using `messagingApi.createMessage`
- Venue list currently hardcoded (admin configuration pending)
- ComposeForm enhanced with `hideTargetingOptions` and `prefillTargeting` props for streamlined reminders
- Event card colors match badge colors: blue (training), green (games), purple (general) at standard 20% opacity

## [2026-03-13] - Typography Standardization

### Changed
- **Removed inline font-family styles**: Removed all inline `style={{ fontFamily: ... }}` declarations — now rely on theme.css defaults (Inter for headings/body, Exo 2 for subtitles)
- **Standardized heading sizes**: Changed MainLayout header from `text-xl` to `text-2xl`, Landing announcement from `text-[30px]` to `text-2xl`
- **Consistent typography**: All page headings now use standard Tailwind classes without custom overrides

### Technical Notes
- theme.css defines default typography: Inter for headings (h1, h3), Exo 2 for subtitles (h2)
- Removed unnecessary font-family overrides from MainLayout, Landing, CompetitionsPage, LiteLandingPage, CaregiverApprovalPage
- Created TYPOGRAPHY-AUDIT.md documenting remaining inconsistencies and recommendations

## [2026-03-13] - User Role Management Feature

### Added
- **Dual role system**: Independent App_Role (users.role) and Team_Role (team_members.role) — a user can be coach app-wide but player on a specific team
- **Manager role**: Added 'manager' to team_members.role check constraint
- **User type tracking**: `user_type` column on users table ('full' or 'lite') for distinguishing temporary access
- **Competitions framework**: New `competitions` and `competition_teams` tables with WCR/Other types, date-based status, and "Close Now" admin action
- **Invite codes system**: New `invite_codes` table with 21-day expiry, team-scoped codes, expired code notification to inviter
- **Caregiver approval workflow**: New `caregiver_approvals` table with pending/approved/denied/escalated status and 7-day timeout escalation
- **Player-caregiver relationships**: New `player_caregivers` table linking caregivers to players
- **Privacy consent**: `privacy_consent_at` timestamp on users, consent checkbox on Lite Landing Page
- **Competitions Management page** (desktop): Create/edit/delete competitions, link teams, "Close Now", lite user cleanup
- **Lite Landing Page**: Public registration page for invite code redemption with privacy notice
- **Caregiver Approval Page**: In-app page for caregivers to approve/deny new caregiver requests
- **4 new API services**: roles-api.ts, competitions-api.ts, invites-api.ts, caregivers-api.ts (all extend ApiClient)
- **Team-level permissions**: `getTeamRole()`, `canManageTeamRoster()`, `canCreateTeamEvents()`, `canSendTeamMessages()` in usePermissions hook
- **Desktop Users page enhancements**: Multi-team assignment management, user_type filter, "Promote to Full" for lite users, inline team role editing

### Changed
- **AuthContext**: Now loads team data from `team_members` instead of empty `user_teams` table — fixes bug where users saw no teams
- **usePermissions**: Extended with team-level permission functions (independent of app-level)
- **Desktop navigation**: Added "Competitions" link in admin sidebar

### Technical Notes
- Migration 036 creates 5 new tables + modifies 2 existing tables
- RLS policies on all new tables (authenticated read, admin/coach/manager write)
- Invite code generation uses ambiguity-free alphanumeric charset (no I/O/0/1)
- Existing user collision check on invite redemption (skip account creation, just add to team)
- Lite-to-full promotion preserves all team memberships

## [2026-03-13] - Team Messaging Bug Fixes & UI Polish

### Fixed
- **RLS infinite recursion**: Migration 035 fixes all messaging table policies to use `team_members` instead of cross-referencing `messages ↔ message_recipients` (which caused infinite recursion)
- **Infinite spinner on Messages page**: MessagingContext now fetches team IDs from `team_members` (source of truth) instead of empty `user_teams` table
- **PostgREST self-join error**: Removed `messages!messages_parent_message_id_fkey` self-referential joins from `getThreads`, `getArchivedThreads`, `searchMessages` — reply counts now fetched in separate queries
- **ComposeForm teams**: Loaded from `team_members` instead of `user_teams`
- **Orange card bleed-through**: Added `bg-white` to swipeable card inner container so archive background only shows during swipe gesture
- **Compose form send button hidden**: Moved send/cancel buttons to pinned footer outside scroll area; adjusted compose view height to `calc(100vh - 5rem)` for proper nav clearance

### Changed
- **Compact message cards**: Tighter padding, single-line body preview, smaller icons, sender/reactions/read-count on one row
- **Slimmer bottom nav bar**: Reduced icon size (w-5→w-4), label size (10px→9px), padding (py-3→py-1.5), gap and rounding — applies to all mobile pages
- **Compose form**: More compact targeting buttons (icon + label only, no descriptions), reduced spacing, textarea rows 3→2
- **Compose FAB**: Repositioned from bottom-40 to bottom-32 to match slimmer nav

### Technical Notes
- Migration 035 must be run in Supabase SQL Editor (already done)
- Leftover RLS policies from intermediate 035 versions were manually dropped in Supabase

## [2026-03-13] - Team Messaging Feature

### Added
- **Team Messaging (Complete)**
  - Database migrations `033_team_messaging.sql` and `034_auto_unarchive_on_reply.sql`
  - Tables: `messages`, `message_recipients`, `message_read_receipts`, `message_reactions`, `message_archives`, `device_tokens`
  - RLS policies for all messaging tables
  - Auto-read receipt trigger for message senders
  - Auto-unarchive trigger when replies are added to archived threads
  - TypeScript interfaces for all messaging types in `database.ts`
  - `messaging-api.ts` API service extending ApiClient with full CRUD, reactions, archiving, search, and Realtime subscriptions
  - `MessagingContext.tsx` with Realtime subscriptions, polling fallback, and optimistic updates
  - UI components: MessageCard, ComposeForm, ThreadView, ReplyForm, ReadDetailModal, ReactionPicker, SearchBar, UnreadBadge
  - Mobile `Messaging.tsx` with thread list, search, compose, archive/unarchive, pull-to-refresh
  - Desktop `DesktopMessaging.tsx` with two-panel layout (thread list + thread detail)
  - "Send Reminder" button on Schedule event cards (mobile and desktop) pre-filling compose form with event details
  - Targeting types: individual, whole_team, management_team, club_admin
  - Read receipt tracking with X/Y read count indicators
  - Emoji reactions with toggle behaviour
  - Thread archiving with swipe gesture (mobile) and context menu (desktop)
  - Debounced search across message titles, bodies, and sender names

## [2026-03-12] - Game Day Subs Feature & Bug Fixes

### Added
- **Game Day Subs Feature (Complete)**
  - Database migration `031_game_day_subs.sql`: `event_attendance`, `game_times`, `substitution_events` tables
  - Added `game_players` and `half_duration` columns to `teams` table with age-group defaults
  - RLS policies for all new tables (admin full access, coach/manager read/write, player read own)
  - TypeScript types: `EventAttendance`, `GameTime`, `SubstitutionEvent`, `SquadMember`
  - Pure logic modules: `rotation-engine.ts`, `attendance-utils.ts`, `game-time-utils.ts`, `lineup-utils.ts`, `substitution-state.ts`
  - API services: `attendance-api.ts`, `subs-api.ts`, `teams-api.ts`
  - UI Components: `AttendanceView`, `LineupSelector`, `SubstitutionManager`, `RandomStrategy`, `CoachStrategy`, `PlayingTimeBar`
  - `SubsPage.tsx` with full integration at `/games/:eventId/subs`
  - "Subs" button on game cards in `Games.tsx`
  - Team config fields (game_players, half_duration) in `TeamsManagement.tsx`
  - Route registered in `src/routes/index.tsx`
  - Live count-up timer on Substitutions section (MM:SS, ticks every second, shows 1st/2nd Half label)
  - Recorded kick-off and 2nd half start times shown in small grey text below buttons
  - Substitution alert system: orange flashing "⚽ SUBSTITUTION TIME ⚽" banner + three-beep audio alert via Web Audio API when rotation window minute is reached
  - Rotation window cards pulse with stronger orange highlight when due

### Fixed
- **Schedule X/Y attendee count**: Shows "X/Y attending" where Y = total team members (coaches + managers + players, not caregivers)
- **Subs attendance showing all team members**: Changed from only RSVP'd users to ALL team members with RSVP status merged (default `no_response`)
- **Coaches excluded from game day squad**: Added `.eq('role', 'player')` filter so only players appear in attendance/squad on Subs page
- **Attendance upsert failing**: Migration `032_fix_attendance_unique_constraint.sql` adds proper UNIQUE constraint on `(event_id, user_id)` — partial unique index didn't work with PostgREST upsert `onConflict`

### Technical Notes
- `users.role` = app-level permission (admin, coach, manager, player, caregiver)
- `team_members.role` = team-level role (coach, manager, player) — independent of app role
- Attendance on Subs page is players-only; coaches/managers don't appear
- Game Day Squad = players marked present + guest players
- Discovered: when adding users to teams, `team_members.role` must be set correctly (currently defaults to 'player' regardless of `users.role`)

### Known Issue — User Role Management
- `team_members.role` is set independently from `users.role`
- No UI currently exists to manage team-level roles
- Users page only manages app-level role
- Teams Management page doesn't expose team_members.role for editing
- **Needs scoping**: Add team-level role management to admin UI

### Files Created
- `supabase/migrations/031_game_day_subs.sql`
- `supabase/migrations/032_fix_attendance_unique_constraint.sql`
- `src/lib/rotation-engine.ts`, `src/lib/attendance-utils.ts`, `src/lib/game-time-utils.ts`
- `src/lib/lineup-utils.ts`, `src/lib/substitution-state.ts`
- `src/lib/attendance-api.ts`, `src/lib/subs-api.ts`, `src/lib/teams-api.ts`
- `src/components/subs/AttendanceView.tsx`, `src/components/subs/LineupSelector.tsx`
- `src/components/subs/SubstitutionManager.tsx`, `src/components/subs/RandomStrategy.tsx`
- `src/components/subs/CoachStrategy.tsx`, `src/components/subs/PlayingTimeBar.tsx`
- `src/pages/SubsPage.tsx`

### Files Modified
- `src/pages/Games.tsx` — Added Subs button to game cards
- `src/pages/Schedule.tsx` — X/Y attendee count display
- `src/pages/desktop/TeamsManagement.tsx` — Team config fields
- `src/routes/index.tsx` — Subs route
- `src/types/database.ts` — New types + Team extension
- `src/lib/events-api.ts` — `getTotalMemberCounts()` method

## [2026-03-11] - Bailey Academy Lesson Import: Analysis, Schema & Image Mapping

### Added
- **Bailey Lesson Analysis Documents**
  - `BAILEY-LESSON-ANALYSIS.md` — Full deduplication, field mapping, gap analysis, schema changes, decisions
  - `BAILEY-HEADER-TO-SCRAPE-MAPPING.md` — Maps 61 slide headers to scraped content, identifies 13 missing slides
  - `BAILEY-LESSON-MAPPING-TASK.md` — Original task description and field mapping table
  - `bailey-slide-headers.md` — Raw slide headers with metadata (team type, date, player count)

- **Schema Migration 027: Division and Team Type**
  - Added `division` column to lessons table (`Community` / `Academy`)
  - Added `team_type` column (`First Kicks`, `Fun Football`, `Junior Football`, `Youth Football`, `Senior`)
  - Updated existing 16 U9 lessons to `Community` / `Junior Football`
  - Indexes for filtering

- **First Academy Lesson (Migration 028: Shielding)**
  - Converted Bailey's Slide 1 to full framework format
  - 4 sessions: Ball Mastery & Juggling (15min), Shark Attack (10min), 1v1 Shielding (15min), Game (20min)
  - Bailey's coaching points, objectives, focus, durations preserved exactly
  - Generated missing fields: organisation, equipment, steps, pitch layout

- **Image-to-Session Mapping from .pptx Export**
  - Parsed all 61 slide XML files to map `imageN.png` to session positions (1-4)
  - `BAILEY-IMAGE-MAPPING.md` — Complete mapping table for all 47 unique slides
  - `scripts/parse-slide-images.cjs` — Extracts image references from slide rels files
  - `scripts/map-images-to-sessions.cjs` — Maps images to session columns by x-coordinate
  - Identified 82 unique content images, 1 template logo (excluded)
  - Discovered heavy image reuse: `image5.png` (warmup) on 28 slides, `image43.png` (game) on 22 slides

### Decisions Made
- **Option C chosen**: Focus on Junior Academy lessons first, park general/U11-U12/Summer for later
- **Bailey's content is ground truth**: His coaching points, objectives, focus, durations preserved exactly
- **Existing 16 U9 lessons = Community programme; Bailey's = Academy programme**
- **Skill categorisation TBD**: Wait for Bailey to review before assigning categories
- **Bailey's durations preserved**: Not standardised to 20/15/15/15

### Files Created
- `supabase/migrations/027_add_division_and_team_type.sql`
- `supabase/migrations/028_academy-shielding-lesson-01.sql`
- `scripts/parse-slide-images.cjs`
- `scripts/map-images-to-sessions.cjs`
- `BAILEY-IMAGE-MAPPING.md`
- `BAILEY-HEADER-TO-SCRAPE-MAPPING.md`
- `BAILEY-LESSON-MAPPING-TASK.md`

## [2026-03-11] - Mobile UI Polish and RSVP System

### Added
- **RSVP Decline Reasons and Response Tracking**
  - Migration 026: Added `responded_at` timestamp and `decline_reason` to `event_rsvps` table
  - Decline reason options: Late, Sick, Injured, Holiday, Other
  - Modal popup when selecting "Can't Go" to capture reason
  - `responded_at` recorded on first response for time-to-respond reporting
  - Decline reason cleared when changing to Going/Maybe

- **Attendee Count on Schedule Cards**
  - Added `getAttendeeCounts` method to events-api (bulk query for "going" RSVPs)
  - Users icon + "X attendees" line on each event card
  - Count updates locally on RSVP for instant feedback

- **Schedule Page Improvements**
  - Added "Team Events" subtitle under Schedule heading
  - Light cyan background on event cards: `rgba(6, 182, 212, 0.2)`
  - Fixed modal scrolling: full overlay now scrollable so form is accessible

- **Coaching Page Lesson List Redesign**
  - 20% green background shading on "Past Lessons" and "Next Lesson" section headers
  - Two-line lesson rows: title on line 1, date/checkbox + skill badge on line 2
  - Consistent skill badge sizing (`text-[10px]` rounded pill)
  - Reduced row padding for compact display

- **Lesson Detail Page Improvements**
  - Removed "Session Plan" heading
  - Restructured session block headers: grey subtitle + bold black session title
  - Green glow border on session blocks: `rgba(34, 197, 94, 0.2)` bg + `rgba(34, 197, 94, 0.4)` border
  - Reduced lesson title from `text-2xl` to `text-lg`
  - Removed non-functional favourite/star icon

### Changed
- **Resources Page Navigation**
  - Nav labels changed: "Rules, Field Setup, Coach Support, General" → "Rules, Pitch, Guides, General"
  - Nav layout changed from `flex overflow-x-auto` to `grid grid-cols-4` for even mobile fit
  - Added `categoryMapping` to translate display names back to DB values
  - Subtitle changed to "Guides for Coaches and Managers"
  - Rule section header background fixed: inline `rgba(139, 92, 246, 0.2)` instead of Tailwind `bg-opacity`

- **RSVP Button Styling**
  - Going: bright green with white text + tick icon
  - Can't Go: bright red with cross icon
  - Maybe: grey with question mark icon

- **Games Page Card Styling**
  - Added 20% orange background: `rgba(234, 120, 0, 0.2)`
  - Compact card design: title + badges on one line, date/time/location on single row
  - Score displays prominently on card when recorded
  - Score recording reduced to slim single-line row

- **Schedule Event Title Format**
  - Fixed `getEventTitle` to use `${team.age_group} ${team.name}` (e.g., "U9 Lithium")

- **Steering Document Updated**
  - Added complete colour reference table with hex + rgba values
  - Added font families (Inter/Aktiv Grotesk Corp for headings, Exo 2 for body)
  - Added card/section shading standard: always use 20% opacity via inline `rgba()`
  - Strengthened team name display rule

### Removed
- **Sync Status Indicator** removed from both mobile and desktop headers (was placeholder for unimplemented offline sync)

### Fixed
- Resources page loads at top on mount (`window.scrollTo(0, 0)`)
- Schedule page missing `</div>` causing build failure (commit ba8747b)

### Files Created
- `supabase/migrations/026_add_rsvp_response_tracking.sql`

### Files Modified
- `src/pages/Resources.tsx` - Nav labels, layout, section headers, subtitle
- `src/pages/Schedule.tsx` - RSVP system, decline modal, attendee counts, event cards
- `src/pages/Games.tsx` - Compact card, orange shading, score display
- `src/pages/Coaching.tsx` - Compact lesson lists, green section headers
- `src/pages/LessonDetail.tsx` - Session block redesign, green glow borders
- `src/layouts/MainLayout.tsx` - Removed sync status indicator
- `src/layouts/DesktopLayout.tsx` - Removed sync status indicator
- `src/lib/events-api.ts` - Attendee counts, RSVP decline reasons
- `src/types/database.ts` - EventRsvp type with responded_at and decline_reason
- `.kiro/steering/project-standards.md` - Colours, fonts, shading standards

## [2026-03-10] - Games Page Integration with Events System

### Added
- **Games Page Connected to Events System**
  - Games page now queries `events` table instead of `games` table
  - Filters for `event_type = 'game'` and past dates only
  - Displays games with navigation arrows (left = older, right = newer)
  - Shows "Game X of Y" counter when multiple games exist
  - Team names display as "Age Group + Name" format (e.g., "U9 Lithium")

- **Score Recording to Events**
  - Migration 024: Added `team_score` and `opponent_score` fields to events table
  - Created `updateEventScore` method in events API
  - Score validation allows empty fields (defaults to 0)
  - Scores persist and display when navigating between games

- **Enhanced Feedback System**
  - Feedback form clears after saving, ready for next entry
  - Resets to "Team" selection after save
  - Loads existing feedback when selecting same team/player
  - Shows "Update Feedback" button when editing existing feedback
  - Allows appending to or editing existing feedback
  - Player dropdown filters out coaches (players only)

- **Database Fixes**
  - Migration 025: Updated `game_feedback` foreign key to reference `events` table
  - Fixed constraint to allow feedback on game events

### Changed
- **Games Page UI Improvements**
  - Removed dropdown game selector
  - Added left/right navigation arrows on game card
  - Cleaner, more intuitive navigation between past games
  - Arrow buttons disabled at first/last game

- **Events API Extended**
  - Added `updateEventScore` method for saving game scores
  - Event type now includes optional score fields

### Fixed
- **Score Saving Issues**
  - Fixed "Cannot coerce to single JSON object" error
  - Fixed validation to handle empty score inputs
  - Scores now save correctly to events table

- **Player Selection**
  - Fixed player dropdown to exclude coaches
  - Added double filter (team_members.role and users.role)
  - Only actual players appear in feedback dropdown

### Technical Notes
- Games are events with `event_type = 'game'`
- Scores stored directly in events table (team_score, opponent_score)
- Feedback references event IDs via game_id field
- Navigation uses array index for efficient game switching

### Files Created
- `supabase/migrations/024_add_scores_to_events.sql`
- `supabase/migrations/025_fix_game_feedback_for_events.sql`

### Files Modified
- `src/pages/Games.tsx` - Complete rebuild with events integration and navigation
- `src/lib/events-api.ts` - Added updateEventScore method
- `src/lib/games-api.ts` - Fixed getTeamPlayers to filter coaches
- `src/types/database.ts` - Added score fields to Event type

### Next Steps
1. Test full workflow with multiple games
2. Add ability to delete feedback
3. Consider adding game notes/summary field
4. Build Schedule page event creation UI (already has basic version)

### Deployment Issue Resolved
- **Problem**: Code pushed but Netlify not deploying
- **Root Cause**: Pushing to wrong repository (`coaching-app-prototype` instead of `.kiro`)
- **Solution**: 
  - Added `kiro` remote: `git remote add kiro https://github.com/Mikebrooke65/.kiro.git`
  - Set as default push remote: `git config --local remote.pushDefault kiro`
  - Created `DEPLOYMENT-GUIDE.md` with full deployment workflow
  - Created `.kiro/steering/project-standards.md` for automatic context inclusion
- **Standard Practice**: Always push to BOTH remotes: `git push kiro prototype && git push origin prototype`

## [2026-03-10] - Games and Schedule System Foundation

### Added
- **Games Feedback System (Migration 022)**
  - Created `games` table for match details (opponent, venue, home/away, scores)
  - Created `game_feedback` table for team and player-specific feedback
  - RLS policies for role-based access (Admin/Coach/Manager)
  - Game API service with CRUD operations
  - Score recording functionality
  - Team and player feedback with text input
  - Feedback history display

- **Events/Schedule System (Migration 023)**
  - Created `events` table for schedule management
  - Event types: game, training, general
  - Game events include opponent and home/away fields
  - Flexible targeting system (teams, roles, divisions, age groups)
  - Created `event_rsvps` table for attendance tracking
  - RLS policies for event visibility and management
  - Coaches/Managers can only create events for their teams
  - Admins have full targeting capabilities

- **Games Page UI**
  - Team selection (loads from team_members table)
  - Game list display (ready for data)
  - Score recording section
  - Team/Player feedback toggle
  - Player roster dropdown
  - Feedback textarea and save functionality
  - Previous feedback display

### Changed
- **Database Types Updated**
  - Added `TeamMember`, `Game`, `GameFeedbackRecord` types
  - Added `Event`, `EventRsvp` types
  - Updated to use `team_members` table consistently

### Fixed
- **Games Page Team Loading**
  - Fixed to use `team_members` table (same as Teams Management)
  - Was incorrectly using `user_teams` initially
  - Team now displays correctly when assigned
  - Added debug logging for troubleshooting

- **Events Migration Type Casting**
  - Fixed `user_role` enum comparison with text arrays
  - Added `::text` casts to all role comparisons in RLS policies

### Technical Notes
- Games table stores match-specific data (opponent, scores, home/away)
- Events table is base for all schedule items
- Game events can be linked to games table for extended functionality
- RLS policies enforce that coaches/managers can only manage their team's events
- Event targeting uses array fields for flexible filtering

### Known Limitations
- Games page UI sections only show when a game is selected
- Need to populate events/games data to test full workflow
- Schedule page still uses mock data (needs connection to events table)

### Files Created
- `supabase/migrations/022_create_games_and_feedback.sql`
- `supabase/migrations/023_create_events.sql`
- `src/lib/games-api.ts`
- `GAMES-FEATURE-SUMMARY.md`
- `SESSION-SUMMARY-2026-03-10.md`
- `supabase/seed_games.sql`
- `supabase/seed_games_test.sql`

### Files Modified
- `src/pages/Games.tsx` - Complete rebuild with real data integration
- `src/types/database.ts` - Added Game, Event, and RSVP types

### Next Steps
1. Build Schedule page with event creation UI
2. Connect Games page to events (type='game')
3. Add "New Event" button to Schedule
4. Implement event creation modal with targeting
5. Test full workflow: Create game event → View in Games → Record score → Add feedback

## [2026-03-10] - User Management Automation Complete

### Added
- **Automated User Creation via Netlify Functions**
  - Created Netlify Function `create-user` for single user creation
  - Handles Supabase Auth + users table creation atomically
  - Admin permission verification
  - Random password generation if not provided
  - Team assignment support
  - Automatic rollback on failures

- **Frontend Integration**
  - Updated UserManagement.tsx to call Netlify Function
  - Password field added to user creation form (optional)
  - Better error handling and user feedback
  - CSV bulk import ready (function created but not yet integrated)

### Changed
- **Switched from Supabase Edge Functions to Netlify Functions**
  - Edge Functions had persistent JWT validation issues at infrastructure level
  - Netlify Functions more reliable for this use case
  - Service role key properly secured in Netlify environment variables

### Fixed
- **Environment Variable Configuration**
  - Added SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY to Netlify
  - Fixed typo in variable name (ROLY → ROLE)
  - Functions now properly access all required credentials

### Technical Notes
- Netlify Functions use TypeScript with @netlify/functions
- Authentication flow: User JWT → Verify with anon key client → Check admin role → Use service key for creation
- Service role key never exposed to client
- Atomic operations with rollback on failure
- Ready to scale to 200+ users

### Deployment
- Function deployed to: `/.netlify/functions/create-user`
- Environment variables configured in Netlify dashboard
- Successfully tested user creation in production

### Next Steps
1. Integrate bulk CSV import with Netlify Function
2. Test with larger user batches
3. Document user import process for admins

## [2026-03-10] - User Management Edge Functions Deployment and Debugging

### Added
- **Edge Function Deployment Process**
  - Successfully deployed both edge functions to Supabase
  - Used `npx supabase` commands (no global installation needed)
  - Deployment process: login → link project → deploy functions
  - Both functions deployed successfully to production

### Changed
- **Edge Function Authentication Fix**
  - Fixed 401 Unauthorized errors in edge functions
  - Changed from using admin client to verify tokens to using regular client
  - Now creates two Supabase clients:
    - Regular client with user's token for authentication verification
    - Admin client for privileged operations (creating users)
  - Added better error handling and logging in UserManagement component
  - Added session validation before calling edge functions

### Fixed
- **Token Verification Issue**
  - Edge functions were trying to verify user tokens with admin client (incorrect)
  - Now use anon key client with user's authorization header
  - Properly extracts and validates access token from session
  - Added console logging to debug token issues

### In Progress
- **Testing Edge Functions**
  - Functions deployed successfully
  - Authentication fix implemented
  - Waiting for Netlify to redeploy with latest code
  - Need to test user creation after deployment completes

### Technical Notes
- Edge functions require SUPABASE_ANON_KEY for user token verification
- SUPABASE_SERVICE_ROLE_KEY only used for admin operations
- Token must be passed in Authorization header as `Bearer {token}`
- Session must be active and valid when calling edge functions

### Deployment Commands Used
```bash
npx supabase login
npx supabase link --project-ref pikrxkxpizdezazlwxhb
npx supabase functions deploy create-user
npx supabase functions deploy bulk-create-users
```

### Next Steps
1. Wait for Netlify deployment to complete
2. Test user creation in production
3. Test CSV bulk import
4. Verify users created in both Auth and users table
5. Document any remaining issues

## [2026-03-10] - User Management Automation with Edge Functions

### Added
- **Automated User Creation System**
  - Created Supabase Edge Function `create-user` for single user creation
  - Created Supabase Edge Function `bulk-create-users` for CSV batch import
  - Both functions handle Supabase Auth + users table creation atomically
  - Automatic team assignment based on team name or ID
  - Random password generation if not provided
  - Admin permission verification for security

- **Updated User Management Page**
  - Individual user creation via form now fully automated
  - CSV bulk import now processes via edge function
  - Password field added to user creation form (optional)
  - Email field disabled when editing (cannot change after creation)
  - Detailed success/failure reporting for bulk imports
  - Error handling with rollback on failures

- **Documentation**
  - Created `USER-MANAGEMENT-SOLUTION.md` - Complete solution overview
  - Created `DEPLOY-EDGE-FUNCTIONS.md` - Step-by-step deployment guide
  - Created `supabase/functions/README.md` - Technical function documentation
  - CSV format examples and troubleshooting guides

### Changed
- User creation no longer requires manual two-step process
- CSV import now creates users in Supabase Auth automatically
- Service role key operations moved to secure server-side functions

### Fixed
- Eliminated manual UUID copying requirement
- Solved scalability issue for 200+ user imports
- Atomic operations prevent orphaned auth users or table records

### Technical Notes
- Edge functions use Deno runtime
- Service role key only used server-side (never exposed to client)
- Functions verify admin role before allowing user creation
- Failed creations automatically rolled back
- Team assignment supports partial name matching

### Deployment Required
To use this feature, admin must deploy edge functions:
```bash
supabase functions deploy create-user
supabase functions deploy bulk-create-users
```

See `DEPLOY-EDGE-FUNCTIONS.md` for complete instructions.

## [2026-03-09] - Session Builder Desktop Page Restructure

### Changed
- **Session Builder Desktop Page**
  - Restructured layout from two-panel (left: library, right: form) to vertical layout
  - Top section: Vertical scrollable list of all sessions (fixed height 320px)
  - Bottom section: Form for creating/editing sessions
  - Clicking a session from the list populates the form with all session data
  - Added "New Session" button to clear form for new session creation
  - Improved filters: Search, Session Type, Age Group
  - Session count display shows filtered vs total sessions
  - Form fields properly mapped to database schema:
    - session_name, title, session_type, duration, age_group
    - organisation, equipment, coaching_points, steps, key_objectives
    - pitch_layout_description
  - Ready for future filter button additions

### Technical Notes
- Vertical list handles hundreds of sessions efficiently with scrolling
- Session selection highlights selected session with blue border
- Form auto-populates when session clicked
- "Clear Form" button resets to new session creation mode
- Save functionality placeholder ready for database integration

## [2026-03-09] - U9 Lesson Generation (Ball Striking and 1v1)

### Added
- **U9 Ball Striking Lessons (2 lessons, 8 sessions)**
  - Migration 018: `018_ball-striking-u9-lessons-01-02.sql`
  - Lesson 01: "Strike It Right: Introduction to Ball Striking"
    - Session 1: Striking Technique (20 min warmup)
    - Session 2: Shooting Accuracy (15 min skill intro)
    - Session 3: Shooting Under Pressure (15 min progressive)
    - Session 4: Shooting Game (15 min game)
  - Lesson 02: "Strike It Clean: Advanced Ball Striking"
    - Session 1: First Time Striking (20 min warmup)
    - Session 2: Power and Placement (15 min skill intro)
    - Session 3: Shooting from Angles (15 min progressive)
    - Session 4: Volleys and Half-Volleys (15 min game)
  - Image prompts: `U9-BALL-STRIKING-LESSON-01-IMAGE-PROMPTS.md` and `U9-BALL-STRIKING-LESSON-02-IMAGE-PROMPTS.md`

- **U9 1v1 Lessons (2 lessons, 8 sessions)**
  - Migration 019: `019_1v1-u9-lessons-01-02.sql`
  - Lesson 01: "Take Them On: Introduction to 1v1"
    - Session 1: 1v1 Basics (20 min warmup)
    - Session 2: 1v1 Moves (15 min skill intro) - Step-over, Drag-back, Chop
    - Session 3: 1v1 Under Pressure (15 min progressive)
    - Session 4: 1v1 Game (15 min game)
  - Lesson 02: "Master the Moves: Advanced 1v1"
    - Session 1: 1v1 Space Creation (20 min warmup)
    - Session 2: 1v1 Advanced Moves (15 min skill intro) - Scissors, Cruyff turn, Elastico
    - Session 3: 1v1 Combination Play (15 min progressive)
    - Session 4: 1v1 Tournament (15 min game)
  - Image prompts: `U9-1V1-LESSON-01-IMAGE-PROMPTS.md` and `U9-1V1-LESSON-02-IMAGE-PROMPTS.md`

### Progress Update
- **Completed**: 12 of 32 lessons (37.5%)
  - U9 Defending: Tackling (2), Marking (2), Pressing (2), Intercepting (2) ✅
  - U9 Attacking: Dribbling (2), Ball Striking (2), 1v1 (2) ✅
- **Remaining**: 20 lessons
  - U9 Attacking: Passing/Receiving (2)
  - U10 All Skills: 8 skills × 2 lessons = 16 lessons

### Technical Notes
- All lessons follow LESSON-CREATION-GUIDE.md format
- All image prompts follow IMAGE-PROMPT-GUIDELINES.md standards
- Each lesson has exactly 4 sessions (warmup, skill_intro, progressive, game)
- Total duration: 65 minutes per lesson
- All lessons are Beginner level for U9
- Metric measurements used throughout (meters, not yards)
- "football (soccer ball)" terminology consistently applied
- Ball possession clearly specified in all pitch layouts

## [2026-03-09] - Lesson System Architecture Refactor

### Added
- **Lesson System Architecture Documentation**
  - Created comprehensive `LESSON-SYSTEM-ARCHITECTURE.md` specification
  - Documented core principles: sessions as globally reusable assets
  - Defined correct database schema with lessons referencing sessions
  - Established session naming conventions
  - Documented media storage structure and requirements
  - Created bulk load process documentation
  - Defined admin UI workflow for future development

- **First Complete Lesson: U9 Tackling Lesson 01**
  - Created `lessons/U9-Tackling-Lesson-01.md` with full content
  - Lesson: "Win It Safely: Block & Poke" (65 minutes total)
  - 4 complete sessions:
    1. Mirror Jockey (20 min) - Warmup
    2. Block Tackle Introduction (15 min) - Skill Intro
    3. 1v1 Tackle Under Pressure (15 min) - Progressive
    4. Tackle Game Application (15 min) - Game
  - Each session includes:
    - Organisation/how it runs
    - Equipment lists
    - Coaching points (5-6 per session)
    - Step-by-step instructions (5-6 steps)
    - Key learning objectives (3 per session)
    - Pitch layout descriptions
    - Media file naming
    - Image generation prompts for pitch diagrams

- **Testing Documentation**
  - Created `TESTING-LESSON-SYSTEM.md` with detailed testing instructions
  - Created `LESSON-TESTING-CHECKLIST.md` with step-by-step checklist
  - Created `LESSON-SYSTEM-SUMMARY.md` with overview of all work
  - Included troubleshooting guides and SQL queries for verification

- **Updated App Component**
  - Created `src/pages/LessonDetail-NEW.tsx` for new schema
  - Fetches lesson with all 4 sessions via JOIN queries
  - Displays all new fields: organisation, steps, key_objectives
  - Shows pitch diagrams if URLs are set
  - Handles session type labels
  - Improved layout with expandable session cards

### Changed
- **Database Schema Refactored (Migration 010)**
  - Sessions are now standalone with unique names as natural identifiers
  - Lessons reference 4 sessions (session_1_id through session_4_id)
  - Sessions can be reused across multiple lessons
  - Deleting a lesson no longer deletes its sessions
  - Added session_type field: warmup, skill_intro, progressive, game
  - Added comprehensive session fields:
    - organisation (how it runs)
    - steps (step-by-step instructions)
    - key_objectives (player learning objectives)
    - pitch_layout_description
    - diagram_url and video_url
  - Lessons now have coaching_focus array
  - Foreign key constraints use ON DELETE RESTRICT for sessions

- **Session Naming Convention**
  - Format: `session-<descriptive-name>-<age-group>`
  - Examples: `session-mirror-jockey-u9`, `session-block-tackle-intro-u9`
  - Must be globally unique
  - Never include lesson numbers
  - Never include session slot numbers

- **Media Storage Structure**
  - Bucket: `lesson-media` (public)
  - Path: `/media/pitch-diagrams/{age-group}/{skill}/{session-name}.png`
  - Videos: `/media/videos/{age-group}/{skill}/{session-name}.mp4`
  - Specs: PNG, 4:5 or 1:1 aspect ratio, 800px min resolution

### Fixed
- Corrected fundamental architecture flaw in original schema
- Sessions were incorrectly tied to lessons (lesson_id FK)
- Now sessions are independent and lessons reference them
- Enables session reusability as originally intended

### Technical Notes
- Migration 010 drops and recreates all lesson/session tables
- Sample data includes complete U9 Tackling Lesson 01
- 4 sessions created with unique names
- 1 lesson created referencing those 4 sessions
- Ready for bulk generation of remaining 31 lessons
- Architecture supports admin UI for Session Builder and Lesson Builder

### Documentation Files Created
- `LESSON-SYSTEM-ARCHITECTURE.md` - Complete architecture spec
- `TESTING-LESSON-SYSTEM.md` - Testing instructions
- `LESSON-TESTING-CHECKLIST.md` - Step-by-step checklist
- `LESSON-SYSTEM-SUMMARY.md` - Overview and summary
- `lessons/U9-Tackling-Lesson-01.md` - First complete lesson

### Next Steps
1. Test migration and verify data
2. Upload pitch diagram images
3. Test lesson display in app
4. Generate remaining 31 lessons (2 per skill × 8 skills × 2 age groups)
5. Build Session Builder UI (admin creates sessions)
6. Build Lesson Builder UI (admin selects 4 sessions)

## [2026-03-08] - Announcement Rich Text Editor Implementation

### Changed
- **Announcements System - Rich Text Editor**
  - Replaced markdown syntax with WYSIWYG rich text editor (React Quill)
  - Admin announcement form now has visual formatting toolbar:
    - Bold, italic, underline buttons
    - Heading 2 and Heading 3 options (H1 removed - reserved for title)
    - Bullet and numbered lists
    - Link insertion
    - Clean formatting button
  - Increased editor height to 300px for better usability
  - Mobile Landing page now renders HTML content with proper styling
  - Removed react-markdown dependency
  
- **Typography Hierarchy**
  - Announcement title: H1 (30px, Inter/Aktiv Grotesk Corp, bold)
  - Content H2: 18px (Exo 2, weight 600)
  - Content H3: 16px (Exo 2, weight 600)
  - Body text: Exo 2
  - Added custom CSS for announcement content styling
  - Enforced font families per brand guidelines (Aktiv Grotesk Corp for headings, Exo 2 for body)

### Fixed
- Fixed announcement content display in admin table (now renders HTML instead of showing raw code)
- Fixed react-markdown className prop error (removed unsupported prop)
- Added `!important` flags to content heading styles to override Quill defaults

### Technical Notes
- Users can now format announcements visually without knowing markdown syntax
- Rich text content stored as HTML in database
- Mobile Landing page uses `dangerouslySetInnerHTML` to render formatted content
- Desktop admin page shows formatted preview in announcement list table

## [2026-03-08] - Resources and Announcements Systems

### Added
- **Resources Management System**
  - Desktop admin page for uploading and managing resource files
  - 4 categories: Rules, Field Setup, Coach Support, General
  - File upload with Supabase Storage integration
  - Mobile Resources page with category filtering
  - Special Rules section with dropdown selector for 4 age-group rule sets:
    - First Kicks (4-6 years)
    - Fun Football (7-8 years)
    - Mini Football (9-10 years)
    - Mini Football (11-12 years)
  - Database migration for resources table and storage bucket

- **Announcements Management System**
  - Desktop admin page for creating and managing announcements
  - Flexible targeting system:
    - User roles (Coach, Manager, Admin, Player, Caregiver)
    - Team types (First Kicks, Fun Football, Junior, Youth, Senior)
    - Divisions (Community, Academy)
    - Age groups (U4-U17)
    - Specific teams
  - Optional image upload for announcements
  - "Ongoing" flag to prevent 7-day auto-expiry
  - Automatic expiry after 7 days for non-ongoing announcements
  - Mobile Landing page displays targeted announcements
  - Database migration for announcements table and storage bucket

- **Lessons and Sessions Database**
  - Created lessons table with 8 sample lessons
  - Created sessions table (4 sessions per lesson)
  - Created lesson_deliveries and session_deliveries tables
  - Lesson template file for bulk lesson creation
  - Seed file for adding lessons via SQL

### Changed
- Updated mobile Landing page to show real data:
  - Users count from database
  - Teams count from database
  - Announcements fetched with targeting logic
- Updated Coaching page to fetch real lessons from database
- Fixed lesson selection behavior (navigate to detail on second click)
- Improved Rules page styling with better visual hierarchy

### Fixed
- Fixed lesson navigation route (changed from `/lesson/:id` to `/lessons/:id`)
- Fixed duplicate stats variable declaration in Landing page
- Fixed bullet point alignment in Rules sections

## [2026-03-06] - Desktop UI Alignment with Figma

### Added
- Colored page headings to Session Builder and Lesson Builder pages
  - Session Builder: Green heading (#22c55e) with description
  - Lesson Builder: Green heading (#22c55e) with description
  - Matches Figma design specifications for coaching tools section

### Fixed
- Session Builder and Lesson Builder pages now have consistent heading style with other desktop pages
- All desktop pages now properly aligned with Figma design specifications

## [2026-03-05] - Desktop Admin Pages Implementation

### Added
- Implemented all 12 desktop admin pages with full functionality:
  1. **Landing Page** - Desktop version of landing page
  2. **Coaching Hub** - Desktop coaching interface
  3. **Games Management** - Desktop games view
  4. **Resources Library** - Desktop resources interface
  5. **Schedule** - Desktop calendar view
  6. **Messaging** - Desktop messaging interface
  7. **Session Builder** - Split-panel layout with sessions library (left) and build form (right)
     - Filter by age group, session type, duration, skill focus
     - Create/edit sessions with objectives, equipment, setup, coaching points, variations
     - Save/publish/draft functionality
     - Mock data with 3 sample sessions
  8. **Lesson Builder** - Split-panel layout with lessons library (left) and 4-block builder (right)
     - 4 FIXED session blocks: Warm-Up & Technical, Skill Introduction, Progressive Development, Game Application
     - Session selection dropdowns filtered by age group and block type
     - Auto-calculated total duration
     - Mock data with 1 sample lesson and 8 available sessions
  9. **Teams Management** - Full CRUD operations for team management
     - Table view with search and filters (Age Group, Division)
     - Add/edit/delete teams with modal forms
     - Coach assignment functionality
     - Mock data with 3 teams and 4 coaches
  10. **User Management** - Complete user administration
      - User table with role management (Player, Caregiver, Coach, Manager, Admin)
      - Status toggle (Active/Inactive)
      - CSV import functionality with example format
      - Add/edit/delete users with modal forms
      - Team assignment
      - Mock data with 5 users
  11. **Reporting Dashboard** - Analytics and metrics
      - Key metrics cards: Active Users, Training Attendance, Lesson Views, Messages Sent
      - Attendance trend chart (6-week bar chart)
      - User engagement by role (progress bars)
      - Most popular lessons table (top 5)
      - Summary stats cards: Total Sessions Created, Total Lessons Built, Active Teams
      - Date range filtering (Last 7/30/90 Days, This Year)
      - Export functionality (PDF, Excel)
  12. **Announcements Management** - Landing page announcement system
      - Create/edit/delete announcements
      - Priority levels (Normal, High)
      - Audience targeting (All Users, Coaches Only, Players Only, Caregivers Only)
      - Pin to top functionality
      - Publish date tracking
      - Mock data with 2 sample announcements
- Updated desktop navigation with correct structure:
  - Main section (1-6): Landing, Coaching, Games, Resources, Schedule, Messaging
  - Admin section (7-12): Session Builder, Lesson Builder, Teams, Users, Reporting, Announcements
- Mobile pages implemented:
  - Landing Page with blue gradient header, quick access cards, announcements
  - Coaching Hub with links to Lessons and AI Coach
  - Lessons page with search, filters, and lesson cards
  - Lesson Detail page with 4 session blocks, objectives, equipment, coaching points
- All pages use brand colors (#0091f3 blue, #ea7800 orange, #545859 dark grey)
- All pages use mock data for prototype demonstration

### Fixed
- Repository push configuration - now pushing to correct repository (coaching-app-prototype)
- Build syntax errors in AuthContext.tsx (missing closing braces, removed timeout reference)
- Build syntax errors in Reporting.tsx (className typos, variable name typo)
- Session persistence issue - simplified auth initialization logic
- Removed complex timeout recovery mechanism that was causing "navigating..." hang
- **Desktop navigation not working** - Added `key={location.pathname}` to `<Outlet />` in DesktopLayout to force re-render on route changes
  - Pages were accessible via direct URL but not via navigation links
  - React Router wasn't re-rendering the Outlet component when route changed
  - Solution forces React to treat each route as a new component instance

### Known Issues
- **Session Persistence Not Working** - User gets logged out on page refresh
  - Session IS being saved to localStorage (`sb-pikrxkxpizdezazlwxhb-auth-token` key exists)
  - `supabase.auth.getSession()` was timing out (3 seconds) when trying to read session
  - Implemented simplified auth initialization without timeout recovery
  - Issue may be related to Supabase project configuration or network latency
  - **WORKAROUND**: User must log in again after page refresh
  - **TODO**: Debug why getSession() hangs even though session exists in localStorage
  - **TODO**: Consider alternative session management approach or check Supabase project auth settings

### Technical Notes
- All admin pages follow consistent split-panel or table-based layouts
- CRUD operations working in-memory (not yet connected to Supabase database)
- CSV import uses simple parsing (headers: email, first_name, last_name, role, status, team, cellphone)
- Reporting charts use simple HTML/CSS bar charts (no charting library yet)
- All forms include validation and user feedback
- Modal dialogs for add/edit operations across all management pages

### Deployment
- Successfully deployed to Netlify: https://wcrfootball.netlify.app
- Build passing after syntax error fixes
- All 12 admin pages accessible to admin users on desktop

### Added
- Created technical-foundation spec using design-first workflow
  - Completed comprehensive design document covering architecture, database schema, API layer, state management, offline sync, routing, layouts, error handling, testing, security, and deployment
  - Created requirements document with 27 requirements derived from the technical design
  - Mapped all 17 correctness properties to specific requirements for validation
  - Established 12-week implementation roadmap
- Set up Supabase project and database
  - Created Supabase account and project (pikrxkxpizdezazlwxhb.supabase.co)
  - Added environment configuration files (.env.development, .env.production)
  - Created database migration files (001_initial_schema.sql, 002_rls_policies.sql)
  - Database schema includes 13 tables with relationships, indexes, and initial data
  - Row-Level Security policies enforce role-based access control
  - Executed migration files in Supabase SQL Editor to create complete database schema
  - All tables, indexes, RLS policies, and initial skill categories now live in production database
- Implemented Phase 1: Core Infrastructure
  - Installed and configured Supabase JavaScript client (@supabase/supabase-js)
  - Created base API client with type-safe CRUD operations (src/lib/api-client.ts)
  - Defined complete TypeScript type definitions for all database models (src/types/database.ts)
  - Implemented authentication system with AuthContext and AuthProvider
  - Created login page with password reset functionality
  - Built ProtectedRoute component with role-based access control
  - Created usePermissions hook for permission checking throughout app
  - Implemented state management with Zustand (3 stores: app, offline, content)
  - Created online/offline status monitoring hook
  - Created responsive layout detection hook
  - Built sync status indicator component
  - Configured React Router with role-based protected routes
  - Created MainLayout for mobile with bottom navigation (full and lite versions)
  - Created DesktopLayout for admin with collapsible sidebar
  - Created placeholder pages for all routes (mobile and desktop)
  - Integrated all components in App.tsx with AuthProvider
  - Updated main.tsx entry point
  - ✅ Phase 1 complete and tested - authentication working, app rendering
- Created CLUB-QUESTIONS.md document for requirements gathering
- Added 10 question sections covering:
  - Skills terminology and structure
  - Team structure and tagging system
  - Friendly Manager API integration
  - Data synchronization and edit management
  - Player and team feedback management
  - Feedback model and framework
  - AI-powered session builder
  - AI session adaptation and rewriting
  - Adding caregivers and players user management
  - Game scheduling and communication
- Documented team classification structure with Type, Technical Level, Gender, Age Group, and Team Name attributes
- Added casual competition scenario with proposed "Lite" user model (CoachLite, ManagerLite, PlayerLite, CaregiverLite)
- Proposed email-based invitation system for self-managed teams
- Created PROJECT-ROLLOUT.md document outlining phased rollout strategy
- Documented Version 1.0 trial plan: 10-week trial with <20 Junior Community teams
- Defined success criteria for all user roles and features
- Outlined post-trial decision points and risk management strategy
- Created KIRO_HANDOVER.md from Figma export with complete UI/UX specifications
- Created ALIGNMENT-ANALYSIS.md comparing requirements vs Figma handover
- Added Requirement 22: Admin Reporting Dashboard to requirements document
  - Usage statistics by role and feature
  - Lesson delivery tracking and trends
  - Coach activity reports
  - Player/team participation metrics
  - Feedback summaries and ratings
  - Filtering and export capabilities

### Updated
- Question 2 (Team Structure & Tagging System) marked as ANSWERED with complete classification details
- Team types defined: First Kicks (U4-U6), Fun Football (U7-U8), Junior Football (U9-U12), Youth Football (U13-U17), Senior Football
- Technical levels: Community and Academy/Development
- Gender categories: Mixed and Female
- Unique team identifier established as Age Group + Team Name combination
- Clarified that sessions/lessons are tagged with Type, Technical Level, Gender, Age Group (NOT specific Team Names)
- Sessions/lessons support multiple tags for flexibility
- Question 10 (Game Scheduling & Communication) marked as PARTIALLY ANSWERED with current Sporty system workflow
- Documented Friday midday lockoff process and manual distribution workflow
- Identified automation opportunity with home field allocation check requirement
- Documented field allocation issue: Sporty defaults to Field #1, requires manual reallocation
- Proposed automated workflow: Pull from Sporty → Manual review/edit → Post button → Targeted messaging
- Added Requirement 22 (Admin Reporting Dashboard) to requirements document with comprehensive metrics and filtering

### Fixed
- Figma asset import paths (changed from figma:asset URLs to actual file paths)
- Netlify SPA routing (added _redirects file)
- RLS policy circular dependencies (migration 003 and 004)
  - Removed recursive policy checks that caused 500 errors
  - Simplified to allow all authenticated users to view users table
  - Fixed user profile fetching after authentication
- Supabase client multiple instance issue
  - Implemented singleton pattern to prevent lock timeouts
  - Added PKCE flow type and explicit storage configuration
  - Resolved "Lock was not released within 5000ms" errors
  - Login now works reliably in browser environment

## [2026-03-02] - Netlify Deployment Setup

### Changed
- Updated `vite.config.ts`: Changed base path from `/coaching-app-prototype/` to `/` for Netlify compatibility
- Updated `index.html`: Replaced hard-coded built asset references with source entry point `/src/main.tsx`

### Fixed
- Fixed Vite build failures on Netlify caused by GitHub Pages configuration
- Fixed asset resolution issues during production build

### Deployment
- Successfully deployed to Netlify
- Repository: https://github.com/Mikebrooke65/coaching-app-prototype
- Branch: main
- Build command: `npm run build`
- Publish directory: `dist`

---

## Instructions for Maintaining This File

When making updates:
1. Add new entries under `[Unreleased]` section
2. When deploying, move unreleased items to a new dated section
3. Use categories: Added, Changed, Deprecated, Removed, Fixed, Security
4. Include commit hashes when relevant
