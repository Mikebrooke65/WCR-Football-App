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

- [x] A1. **Migration** (`077_event_rsvps_subject_user_id.sql`): add
  `subject_user_id` (FK users, ON DELETE CASCADE), backfill = `user_id`, set NOT
  NULL, drop `event_rsvps_event_id_user_id_key`, add UNIQUE
  `(event_id, subject_user_id)`, add index. See design A.1 for exact SQL.
- [x] A2. **RLS guard** (same migration): update the "Users can manage their own
  RSVPs" policy's `WITH CHECK` so `subject_user_id` must be `auth.uid()` or a
  child linked via `player_caregivers` (Requirement A7 / design A.1). Confirm the
  policy's current exact definition first.
- [x] A3. **Types**: add `subject_user_id: string` to `EventRsvp`
  (`src/types/database.ts`).
- [x] A4. **Pure logic** (`src/lib/rsvp-identities.ts` + `.test.ts`):
  `resolveRsvpIdentities(...)` per design A.2, with fast-check property + example
  tests (self-only, caregiver+children, mixed coach+caregiver, zero identities).
- [x] A5. **events-api** (`src/lib/events-api.ts`):
  - `setRsvp(eventId, status, declineReason?, subjectUserId = self)` — write
    `user_id` (submitter) + `subject_user_id`; upsert `onConflict:
    'event_id,subject_user_id'`.
  - `getUserRsvps` — key results by `event_id` + `subject_user_id` across the
    user's identity set (design A.3).
  - `getEventAttendeeDetails` — attribute rows by `subject_user_id` not
    `user_id`.
- [x] A6. **Schedule.tsx**: batch-resolve identities per event (self roles +
  linked children on the target team); 1 identity → existing buttons unchanged;
  2+ → new `RsvpIdentitiesModal` with per-identity Going/Maybe/Can't-Go +
  decline-reason, each saving immediately (design A.4).
- [x] A7. **Verify A** — DONE 2026-09-08, live. Build + unit tests clean
  (300 passed | 2 skipped). Migrations 077, 079 and 080 all run and
  verified. Live evidence: single identity unchanged (Hewie Duck, George
  Pig); multi-identity modal correct for a PURE caregiver (Daddy Pig sees
  George + Peppa, no self row); independent per-child answers persisting
  (George `going`, Peppa `not_going / injured` at the same time); correct
  attribution in the data (two rows, `user_id` = Daddy Pig,
  `subject_user_id` = each child).

  **Three bugs found and fixed during this verification** — Piece A shipped
  non-functional for the exact users it was built for, and each bug was
  hidden behind the previous one:
  1. `079` — caregivers could not SEE team events at all (migration 023's
     events policy requires the viewer's own `team_members` row; a
     caregiver never has one). Same bug 060 fixed for `teams`.
  2. `8a58b8c` — the single-identity fast path assumed "one identity means
     me", so a caregiver's tap recorded THEMSELVES, not their child.
  3. `080` — `USING (user_id = auth.uid())` in 077 meant the RSVP was owned
     by whoever answered first, so a caregiver could not change a
     child-created row (and vice versa).

  Also added: the buttons now state whose answer they set ("RSVP for
  George Pig" / "RSVP for 2 people — tap to choose").

## Piece B — RSVP reminder push notifications

- [x] B1. **Decisions locked 2026-09-08** (design B.1): 24h lead, hourly cadence,
  one push per caregiver, `pg_cron` + `pg_net` → Edge Function. No further
  sign-off needed — build to these.
- [x] B2. **"Owes a response" logic** (`src/lib/rsvp-reminders-logic.ts` + test,
  or shared server logic): given a roster + RSVP rows (by `subject_user_id`),
  return who still owes a response. Pure + tested.
- [x] B3. **Edge Function** `supabase/functions/send-rsvp-reminders`: resolve
  events in the (24h, 25h] window, compute owed responses, map to recipients
  (self, or caregiver via `player_caregivers`), de-dupe, look up `device_tokens`,
  send via the shared FCM path (extract the send helper from
  `send-message-push`). Record sends for B4.
- [x] B4. **Don't double-notify** (migration): `rsvp_reminders_sent(event_id,
  user_id, reminder_window)` with a unique constraint; the function checks it
  before sending and inserts after.
- [x] B5. **Schedule** (migration, `pg_cron` + `pg_net`): hourly job invoking the
  function with the service key (mirror migration 058). Enable `pg_net` if
  needed, or fall back to a Supabase scheduled function.
- [x] B6. **Deep link**: payload carries the event id; tap routes to Schedule
  focused on that event (reuse existing push tap handling).
- [ ] B7. **Deploy + verify B** — SUBSTANTIALLY DONE 2026-09-08. Function
  deployed; migrations 077 + 078 run; hourly cron confirmed firing unprompted
  (200s at 01:00 and 02:00 UTC, `eventsChecked: 0`, correct quiet behaviour);
  a real event 24.5h out returned
  `{"eventsChecked":1,"remindersSent":1,"summary":[{"owed":5,"recipients":5,"sent":1}]}`
  and an immediate re-run returned `{"sent":0,"alreadyNotified":5}` — B4
  confirmed. **Two things outstanding:** (a) the deep-link tap, which needs
  the native app (a browser can never receive a push); (b) confirm the
  child→caregiver routing actually fired rather than silently no-opping —
  `recipients: 5` on a 5-person roster (3 adults + 2 children) is equally
  consistent with correct routing to off-team caregivers AND with
  `users.is_child` being unset so everyone mapped to themselves. Check that
  each child shows no reminder row while their caregiver does.

## Verification checkpoint

- [x] Full `npm run build` + `npx vitest --run` clean on head — 300 passed |
  2 skipped (baseline was 254 | 2; +46 across `rsvp-identities`,
  `rsvp-reminders-logic`, `push-routing-logic`, `reminder-message-logic`).
- [x] Update `CHANGELOG.md` and `NEXT-SESSION-NOTES.md` — done 2026-09-08,
  including the deploys (all run) and the backlog of unrelated gaps this
  testing turned up (duplicate team names, no empty-team warning, no
  delete-event UI, team deletion orphaning events, stale counts on a
  newly-created event).

## Deferred (not this spec)

- Escalating / multiple reminders (a second "last call" nudge).
- In-app notification centre. **Note the practical consequence, found
  2026-09-08:** because Piece B is push-only, it reaches nobody on the web
  app — so until the native app ships (V1.9) the automated reminder has
  effectively zero reach. The manual "Send Reminder" button is unaffected
  (it sends a real team message, so it hits the Messages inbox *and*
  pushes). Smallest fix if reach is wanted sooner: have
  `send-rsvp-reminders` also insert a `messages` row.
- Coaches/managers RSVP-ing for arbitrary roster members (only self + own
  children here).
- **Window-edge miss (found 2026-09-08):** an event created LESS than 25h
  before it starts can never be reminded. The scheduler runs hourly and
  matches the (24h, 25h] window; an event created inside that window
  between two ticks is never caught by either. Academic for a 24-hour
  reminder — but non-obvious enough to be baffling later, hence this note.
  A fix would be widening the window and relying on `rsvp_reminders_sent`
  for idempotency, rather than the window itself being the guard.
