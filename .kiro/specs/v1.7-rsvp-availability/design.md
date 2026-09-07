# V1.7 — RSVP / Availability — Design

**Reads with:** `requirements.md`, `tasks.md`. Grounded against the current code
(2026-09-08): `event_rsvps` (migration 023), `src/lib/events-api.ts`,
`src/pages/Schedule.tsx`, `device_tokens` + `send-message-push`, migration 058's
`pg_cron` precedent.

---

## Piece A — Caregiver multi-child RSVP

### A.1 Migration (new — next free number, e.g. `077`)
Current: `event_rsvps` has an inline `unique(event_id, user_id)` (Postgres
auto-names it `event_rsvps_event_id_user_id_key`).

```sql
-- Add the "who is this RSVP about" column, default to the submitter.
ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS subject_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;

-- Backfill existing rows: every current RSVP is a self-RSVP.
UPDATE public.event_rsvps SET subject_user_id = user_id WHERE subject_user_id IS NULL;

-- Now enforce NOT NULL.
ALTER TABLE public.event_rsvps ALTER COLUMN subject_user_id SET NOT NULL;

-- Move uniqueness from (event_id, user_id) to (event_id, subject_user_id).
ALTER TABLE public.event_rsvps DROP CONSTRAINT IF EXISTS event_rsvps_event_id_user_id_key;
ALTER TABLE public.event_rsvps
  ADD CONSTRAINT event_rsvps_event_subject_key UNIQUE (event_id, subject_user_id);

CREATE INDEX IF NOT EXISTS event_rsvps_subject_user_id_idx
  ON public.event_rsvps(subject_user_id);
```

**RLS:** the existing "Users can manage their own RSVPs" policy keys on
`user_id = auth.uid()`. That stays correct — the *submitter* is always the
logged-in user, so a caregiver writing a child's RSVP still passes (`user_id` =
caregiver = `auth.uid()`). **But that alone would let a caregiver write ANY
`subject_user_id`.** Add a server-side guard (Requirement A7): either
- tighten the INSERT/UPDATE policy so `subject_user_id` must equal `auth.uid()`
  OR be a child linked to `auth.uid()` via `player_caregivers`, or
- route the write through a `SECURITY DEFINER` function / Edge Function that
  checks the caregiver link.

Recommended (simplest, no new function): a `WITH CHECK` on the manage policy:
```sql
-- replace the existing manage policy's WITH CHECK (keep USING for read/update match)
WITH CHECK (
  user_id = auth.uid() AND (
    subject_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.player_caregivers pc
               WHERE pc.caregiver_id = auth.uid() AND pc.player_id = subject_user_id)
  )
)
```
(Confirm the current policy's exact name/definition before altering; migration
023 created it as "Users can manage their own RSVPs" `FOR ALL`.)

### A.2 Pure logic module (new — `src/lib/rsvp-identities.ts` + test)
A pure function, unit-tested (matches this repo's `*-logic.ts` + fast-check
convention — see `roster-logic.ts`, `permissions-logic.ts`):

```
resolveRsvpIdentities(input: {
  currentUserId: string;
  currentUserName: string;
  currentUserTeamRoles: TeamRole[];      // this user's roles on the event's team
  linkedChildrenOnTeam: { id: string; name: string }[]; // caregiver's children who are players here
}): RsvpIdentity[]
```
- Returns the self identity **iff** the user holds player OR coach (OR manager)
  on the team, labelled with the role; plus one identity per linked child.
- `RsvpIdentity = { subjectUserId: string; label: string; isSelf: boolean }`.
- Order: self first, then children in name order.
- Zero identities is possible (a pure caregiver with no children on this team) —
  the caller shows no RSVP controls in that case (unchanged from today for a
  non-member).

### A.3 events-api changes (`src/lib/events-api.ts`)
- **`setRsvp`** gains a `subjectUserId?: string` param (defaults to the current
  user's id). Upsert `onConflict: 'event_id,subject_user_id'`, and write both
  `user_id` (submitter) and `subject_user_id`.
- **Reads** must key on `subject_user_id`, not `user_id`:
  - `getUserRsvps(eventIds)` currently returns one RSVP per event keyed by
    `event_id` (WHERE `user_id = me`). Change to fetch every RSVP whose
    `subject_user_id` is in the current user's identity set for those events, and
    return a map keyed by `event_id` → `{ [subjectUserId]: EventRsvp }` (or a
    flat `Map<\`${eventId}:${subjectUserId}\`, EventRsvp>`). The single-identity
    call site reads `[eventId][currentUserId]`.
  - `getEventAttendeeDetails` already attributes rows to people; switch its
    `rsvpByUser` keying from `user_id` to `subject_user_id` so a caregiver-
    submitted child RSVP is attributed to the **child**, not the caregiver.
- `EventRsvp` type (`types/database.ts`) gains `subject_user_id: string`.

### A.4 Schedule.tsx UI
- Compute each event's identities: the current user's roles on the event's
  target team (already available via team membership) + linked children on that
  team (`player_caregivers` → `team_members` for the target team). A batched
  lookup per page load, mirroring how `getUserRsvps` is batched today.
- **1 identity:** render the existing three buttons exactly as now (their taps
  call `setRsvp(eventId, status, reason)` — subjectUserId defaults to self).
- **2+ identities:** the three buttons open a **modal** (`RsvpIdentitiesModal`)
  listing each identity with its own Going / Maybe / Can't-Go + decline-reason;
  each control calls `setRsvp(eventId, status, reason, identity.subjectUserId)`
  and reflects optimistically, same pattern as the current single RSVP.
- Reuse the existing decline-reason picker component/flow per identity.

### A.5 Verification (A)
- `npm run build` clean; scoped `tsc` on changed files.
- Unit tests for `resolveRsvpIdentities` (fast-check property + examples).
- `npx vitest --run` — baseline 254 passing / 2 env-gated must hold.
- Live: a caregiver-with-two-children-on-a-team account (e.g. the George/Daddy
  Pig or Smith-family style test data) sees the modal, sets different statuses
  per child, and each persists independently; a single-identity user sees no
  behaviour change.

---

## Piece B — RSVP reminder push notifications

### B.1 Locked decisions (✅ confirmed by repo owner 2026-09-08)
- **D-B1:** lead time **24h before** the event; scheduler runs **hourly** and
  targets events starting in the (24h, 25h] window so each event is caught once.
- **D-B2:** **one push per caregiver** (not one per child) — "Reminder: RSVP for
  {event} — {team}" — tapping opens the event where they can RSVP each child.
- **D-B3:** **`pg_cron` + `pg_net`** invoking a new Edge Function
  `send-rsvp-reminders` (mirrors migration 058's cron precedent; keeps the FCM
  send in an Edge Function alongside `send-message-push`). Supabase scheduled
  function only if `pg_net` can't be enabled.

### B.2 New Edge Function — `supabase/functions/send-rsvp-reminders`
Invoked on schedule (service role). For each event starting in the target window:
1. Resolve the roster of the event's target team(s) (players/coaches/managers via
   `team_members`).
2. Compute who **owes a response**: a roster member with no `event_rsvps` row for
   the event, or `status = 'no_response'`. Attribute by `subject_user_id`
   (Piece A) so a child whose caregiver already responded is excluded.
3. Map owed-responses to **recipients**: the person themselves if they're an adult
   account with a device token; for a child, their linked caregiver(s) via
   `player_caregivers`. De-dupe so a caregiver owing responses for two children
   gets one push.
4. Look up `device_tokens` for each recipient and send via the same FCM path
   `send-message-push` uses (extract/share the send helper).
5. Record what was sent to satisfy **B4** (don't double-notify) — e.g. a small
   `rsvp_reminders_sent(event_id, user_id, reminder_window)` table with a unique
   constraint, checked before sending.

### B.3 Scheduling (migration, new number after A's)
`pg_cron` job (hourly) calling the function via `pg_net.http_post` with the
service key, mirroring how migration 058 scheduled its consent-timeout sweep.
Include the function URL + auth. (If `pg_net` isn't enabled, enable it, or use a
Supabase scheduled function instead — D-B3 fallback.)

### B.4 Deep link
Reuse the existing push data-payload → in-app route handling (`usePushNotifications`
/ the app's notification tap handler). Payload carries the event id; tap routes to
Schedule focused on that event.

### B.5 Verification (B)
- Deploy the function (`supabase functions deploy send-rsvp-reminders`) — **does
  not deploy via git push.**
- Run the cron migration in the Supabase SQL Editor.
- Manual: create an event ~24h out with a roster member who hasn't responded and
  a device token; confirm one push arrives, tapping opens the event, and a second
  scheduler run does NOT re-send (B4).

---

## Notes for the builder
- **Do A before B** — B's "owes a response" logic depends on A's `subject_user_id`
  attribution being in place.
- Keep the pure logic (identity resolution, owes-a-response) in testable
  `*-logic.ts` modules per repo convention; keep React/Deno specifics thin.
- **Gotcha from V1.6 (2026-09-08), applies if any invite/anon path is touched:**
  PostgREST resource embeds return empty for the `anon` role on some tables even
  when grants+RLS+direct-read are fine — prefer direct queries for anon-facing
  reads. (Not expected to bite RSVP, which is all authenticated, but noted.)
- Migration numbering: check the highest existing migration at build time (075 +
  V1.6's 076 are used; A's migration is likely `077`, B's `078`).
