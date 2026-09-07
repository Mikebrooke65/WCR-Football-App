# V1.7 — RSVP / Availability — Tasks

**Reads with:** `requirements.md`, `design.md`. Build **Piece A before Piece B**
(B depends on A's `subject_user_id`). Verify each slice: `npm run build` + scoped
`tsc`; `npx vitest --run` (baseline 254 passing / 2 env-gated). Commit in sensible
batches (Netlify rebuilds on push — batch to limit them).

**Deploy reminders:** migrations run manually in the Supabase SQL Editor; Edge
Functions deploy manually via `supabase functions deploy <name>` (NOT on git
push).

---

## Piece A — Caregiver multi-child RSVP

- [ ] A1. **Migration** (`077_event_rsvps_subject_user_id.sql`): add
  `subject_user_id` (FK users, ON DELETE CASCADE), backfill = `user_id`, set NOT
  NULL, drop `event_rsvps_event_id_user_id_key`, add UNIQUE
  `(event_id, subject_user_id)`, add index. See design A.1 for exact SQL.
- [ ] A2. **RLS guard** (same migration): update the "Users can manage their own
  RSVPs" policy's `WITH CHECK` so `subject_user_id` must be `auth.uid()` or a
  child linked via `player_caregivers` (Requirement A7 / design A.1). Confirm the
  policy's current exact definition first.
- [ ] A3. **Types**: add `subject_user_id: string` to `EventRsvp`
  (`src/types/database.ts`).
- [ ] A4. **Pure logic** (`src/lib/rsvp-identities.ts` + `.test.ts`):
  `resolveRsvpIdentities(...)` per design A.2, with fast-check property + example
  tests (self-only, caregiver+children, mixed coach+caregiver, zero identities).
- [ ] A5. **events-api** (`src/lib/events-api.ts`):
  - `setRsvp(eventId, status, declineReason?, subjectUserId = self)` — write
    `user_id` (submitter) + `subject_user_id`; upsert `onConflict:
    'event_id,subject_user_id'`.
  - `getUserRsvps` — key results by `event_id` + `subject_user_id` across the
    user's identity set (design A.3).
  - `getEventAttendeeDetails` — attribute rows by `subject_user_id` not
    `user_id`.
- [ ] A6. **Schedule.tsx**: batch-resolve identities per event (self roles +
  linked children on the target team); 1 identity → existing buttons unchanged;
  2+ → new `RsvpIdentitiesModal` with per-identity Going/Maybe/Can't-Go +
  decline-reason, each saving immediately (design A.4).
- [ ] A7. **Verify A**: build + scoped tsc clean; new unit tests pass; vitest
  baseline holds; live-test a 2-children caregiver (modal, independent per-child
  persistence) and a single-identity user (no change). Confirm the "X/Y
  attending" counter + attendee list still correct.

## Piece B — RSVP reminder push notifications

- [x] B1. **Decisions locked 2026-09-08** (design B.1): 24h lead, hourly cadence,
  one push per caregiver, `pg_cron` + `pg_net` → Edge Function. No further
  sign-off needed — build to these.
- [ ] B2. **"Owes a response" logic** (`src/lib/rsvp-reminders-logic.ts` + test,
  or shared server logic): given a roster + RSVP rows (by `subject_user_id`),
  return who still owes a response. Pure + tested.
- [ ] B3. **Edge Function** `supabase/functions/send-rsvp-reminders`: resolve
  events in the (24h, 25h] window, compute owed responses, map to recipients
  (self, or caregiver via `player_caregivers`), de-dupe, look up `device_tokens`,
  send via the shared FCM path (extract the send helper from
  `send-message-push`). Record sends for B4.
- [ ] B4. **Don't double-notify** (migration): `rsvp_reminders_sent(event_id,
  user_id, reminder_window)` with a unique constraint; the function checks it
  before sending and inserts after.
- [ ] B5. **Schedule** (migration, `pg_cron` + `pg_net`): hourly job invoking the
  function with the service key (mirror migration 058). Enable `pg_net` if
  needed, or fall back to a Supabase scheduled function.
- [ ] B6. **Deep link**: payload carries the event id; tap routes to Schedule
  focused on that event (reuse existing push tap handling).
- [ ] B7. **Deploy + verify B**: `supabase functions deploy send-rsvp-reminders`;
  run the cron migration; live-test an event ~24h out with an un-responded roster
  member + device token — one push arrives, tap opens the event, a second run
  does not re-send.

## Verification checkpoint

- [ ] Full `npm run build` + `npx vitest --run` clean on head (254 baseline).
- [ ] Update `CHANGELOG.md` (user-facing: "RSVP per child" + "RSVP reminders")
  and `NEXT-SESSION-NOTES.md` (flip V1.7 to done; note migrations + the
  `send-rsvp-reminders` deploy owed until run).

## Deferred (not this spec)

- Escalating / multiple reminders (a second "last call" nudge).
- In-app notification centre.
- Coaches/managers RSVP-ing for arbitrary roster members (only self + own
  children here).
