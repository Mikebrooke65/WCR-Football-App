# V1.7 — RSVP / Availability — Requirements

**Status:** scoped + locked for build (2026-09-08). Handoff spec — intended to be
executed by an AI session (Claude) on the repo owner's other laptop.

**Context:** the RSVP feature is *mostly built already* — Going / Maybe / Can't-Go
on every event card (with a decline-reason picker for Can't-Go), an "X/Y attending"
counter that opens a by-status list, optimistic updates, and a past/upcoming split.
This spec covers only the **two remaining pieces**, which are independent of each
other and can ship separately:

- **Piece A — Caregiver multi-child RSVP** (client + one migration)
- **Piece B — RSVP reminder push notifications** (Edge Function + schedule)

**Reads with:** `design.md`, `tasks.md` (this folder). Existing code:
`src/pages/Schedule.tsx`, `src/lib/events-api.ts`, `event_rsvps` (migration 023),
`device_tokens` + `send-message-push` Edge Function, `pg_cron` precedent
(migration 058).

---

## Piece A — Caregiver multi-child RSVP

### Problem
`event_rsvps` has a `unique(event_id, user_id)` constraint, so one logged-in user
can hold exactly one RSVP per event. A caregiver with two children on a team (e.g.
John Smith, caregiver of Johnny and Jenny, and possibly also a coach on that team)
cannot RSVP separately for each child. They need to respond *per person*.

### Requirements
- **A1. Identity resolution.** For a given event, the number of "identities" a
  logged-in user has = their own (if they are a player or coach on the event's
  target team) **plus** one per child linked to them via `player_caregivers` who
  is a player on that event's target team.
- **A2. Single identity ⇒ unchanged.** If the user has exactly one identity,
  RSVP behaves *exactly as today*: tapping Going / Maybe / Can't-Go submits one
  RSVP immediately, with the existing decline-reason flow for Can't-Go.
- **A3. Multiple identities ⇒ per-identity modal.** If the user has two or more
  identities, tapping any of Going / Maybe / Can't-Go opens a modal listing each
  identity (e.g. "John Smith — Coach", "Johnny Smith", "Jenny Smith"), each with
  its **own independent** Going / Maybe / Can't-Go control **and** its own
  decline-reason flow for Can't-Go.
- **A4. Independent + immediate.** Each identity's RSVP is fully independent —
  no requirement to set your own before a child's, or vice versa — and each
  **saves immediately on tap**, same as a normal RSVP does today.
- **A5. Data model.** A new `subject_user_id` column on `event_rsvps` records who
  the RSVP is *about*: equal to `user_id` for a normal self-RSVP; set to the
  child's `users.id` when a caregiver responds on their behalf. `user_id` stays
  as "who actually submitted this" (audit). The uniqueness constraint moves from
  `(event_id, user_id)` to `(event_id, subject_user_id)` so one login can hold
  several RSVP rows for one event.
- **A6. No regression to the counter.** The "X/Y attending" counter and the
  by-status attendee list must keep working — they count RSVP rows, which is
  unaffected. (They should read/attribute by `subject_user_id`, see design.)
- **A7. Security.** A caregiver may only submit an RSVP whose `subject_user_id`
  is themselves or a child they are actually linked to (verified server-side,
  not just client-gated).

### Out of scope for A
- Coaches/managers RSVP-ing on behalf of arbitrary roster members (only self +
  own linked children).
- Any change to how events are created or targeted.

---

## Piece B — RSVP reminder push notifications

### Problem
There is no automated nudge reminding people to RSVP to an upcoming event. Every
parent expects "is my kid at training this week?" — without a reminder, RSVPs go
stale.

### Requirements
- **B1. Scheduled reminder.** A scheduled job runs regularly (e.g. hourly) and,
  for each upcoming event, notifies the people who **have not yet responded**
  (no `event_rsvps` row, or `status = 'no_response'`), a defined window before the
  event (PROPOSED DEFAULT: **24 hours before**, ± the schedule granularity —
  confirm/lock in design D-B1).
- **B2. Reuse existing push plumbing.** Send via the existing device-token +
  push path (`device_tokens` table, `send-message-push` Edge Function pattern /
  FCM) — no new push stack.
- **B3. Recipients = roster who owe a response.** For an event's target team(s),
  a person "owes a response" if they hold a player/coach/manager membership and
  have no `going`/`maybe`/`not_going` RSVP for it. Caregiver handling: a caregiver
  is nudged if any of their linked children on that event still owes a response
  (PROPOSED DEFAULT: one push to the caregiver naming the event; confirm in D-B2).
- **B4. Don't double-notify.** A person/event should not be reminded more than
  once for the same reminder window (track sent reminders, or key off the
  window so a re-run doesn't re-send).
- **B5. Deep link.** Tapping the notification opens the app at the event /
  Schedule so the person can RSVP in one step (reuse the existing push
  data-payload → route pattern).

### Out of scope for B
- Multiple escalating reminders (V1 = a single reminder per event). A second
  "last call" nudge can be a later addition.
- In-app notification centre (push only).

---

## Decisions — ✅ LOCKED 2026-09-08 (repo owner confirmed)
- **D-B1** — reminder lead time **24h before** the event; scheduler runs
  **hourly**, targeting events starting in the (24h, 25h] window so each is
  caught once.
- **D-B2** — **one push per caregiver** naming the event (tap in to RSVP each
  child), not one push per un-responded child.
- **D-B3** — scheduling via **`pg_cron` + `pg_net`** calling the Edge Function
  (mirrors migration 058's cron precedent). Supabase scheduled function is the
  only fallback if `pg_net` can't be enabled.
