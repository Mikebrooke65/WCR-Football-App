// Pure logic for the RSVP reminder push (V1.7 Piece B, Requirement B1-B3).
//
// Spec: `.kiro/specs/v1.7-rsvp-availability/` (design.md B.2, tasks.md B2).
//
// This module is deliberately free of Deno/Supabase specifics so it can be
// unit- and property-tested in isolation (this repo's `*-logic.ts` +
// fast-check convention — see `roster-logic.ts`, `permissions-logic.ts`,
// `rsvp-identities.ts`). The Edge Function `send-rsvp-reminders` does the
// actual DB queries and FCM send, then calls these functions to decide who
// owes a response and who should be notified.

/** The status an `event_rsvps` row can hold — mirrors migration 023's CHECK. */
export type RsvpStatus = 'going' | 'not_going' | 'maybe' | 'no_response';

/** One player/coach/manager on an event's target team roster. */
export interface RosterMember {
  userId: string;
  /** True for a Model-A child account (`users.is_child`) — see database.ts. */
  isChild: boolean;
}

export interface ResolveOwedResponsesInput {
  roster: RosterMember[];
  /**
   * Existing RSVP status per roster member, keyed by `subject_user_id`
   * (Piece A attribution — NOT `user_id`, so a child whose caregiver
   * already responded is correctly excluded even though the caregiver
   * submitted the row). A roster member with no entry here has no
   * `event_rsvps` row at all, which owes a response the same as an
   * explicit `'no_response'` row (Requirement B1/B3).
   */
  statusBySubjectUserId: Record<string, RsvpStatus>;
}

/**
 * Requirement B3: a roster member "owes a response" if they have no RSVP
 * row for the event, or their row's status is explicitly `'no_response'`.
 * `going` / `maybe` / `not_going` all count as having responded — a
 * decline is still a response.
 */
export function resolveOwedResponses(input: ResolveOwedResponsesInput): string[] {
  return input.roster
    .filter((member) => {
      const status = input.statusBySubjectUserId[member.userId];
      return !status || status === 'no_response';
    })
    .map((member) => member.userId);
}

export interface ResolveReminderRecipientsInput {
  /** Roster member user ids who owe a response (output of resolveOwedResponses). */
  owedUserIds: string[];
  /** True for a Model-A child account, false/undefined for an adult. */
  isChildByUserId: Record<string, boolean>;
  /** Linked caregiver user ids for each child user id (`player_caregivers`). */
  caregiverIdsByChildId: Record<string, string[]>;
}

/**
 * Requirement B3/D-B2: map owed-response roster members to the person who
 * should actually be pushed. An adult who owes a response is nudged
 * directly; a child who owes one is nudged via each linked caregiver
 * instead (a child account never holds a device token of its own). A
 * caregiver linked to more than one owed child is de-duped to a single
 * entry — D-B2 locks "one push per caregiver naming the event", not one
 * per un-responded child.
 *
 * A child with no linked caregiver on record contributes no recipient —
 * there is nobody to nudge, and that's a data gap outside this function's
 * concern, not an error here.
 */
export function resolveReminderRecipients(input: ResolveReminderRecipientsInput): string[] {
  const recipients = new Set<string>();

  for (const userId of input.owedUserIds) {
    if (input.isChildByUserId[userId]) {
      for (const caregiverId of input.caregiverIdsByChildId[userId] || []) {
        recipients.add(caregiverId);
      }
    } else {
      recipients.add(userId);
    }
  }

  return Array.from(recipients);
}

/**
 * Requirement D-B2: a single push per caregiver naming the event, not the
 * per-child detail — tapping it opens the event where each child can be
 * RSVP'd individually. `teamLabel` is e.g. "U10 Sharks"; pass `undefined`
 * for an event with no single target team (falls back to a team-less
 * phrasing).
 */
export function buildRsvpReminderMessage(
  eventTitle: string,
  teamLabel?: string
): { title: string; body: string } {
  return {
    title: 'RSVP reminder',
    body: teamLabel
      ? `Reminder: RSVP for ${eventTitle} — ${teamLabel}`
      : `Reminder: RSVP for ${eventTitle}`,
  };
}
