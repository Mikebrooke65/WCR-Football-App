// Pure logic for caregiver multi-child RSVP identity resolution.
//
// Spec: `.kiro/specs/v1.7-rsvp-availability/` (Piece A, Requirement A1-A4,
// design.md A.2)
//
// A logged-in user can hold more than one "identity" on a given event's
// target team: themselves (if they're a player/coach/manager there) plus
// one per linked child who plays there. `event_rsvps.subject_user_id`
// (migration 077) records which identity an RSVP row is about. This module
// is deliberately free of React/Supabase so it can be unit- and
// property-tested in isolation, matching this repo's `*-logic.ts` +
// fast-check convention (see `roster-logic.ts`, `permissions-logic.ts`).

import type { TeamRole } from '../types/database';

/** One person a logged-in user can submit an RSVP as, for one event. */
export interface RsvpIdentity {
  subjectUserId: string;
  label: string;
  isSelf: boolean;
}

export interface ResolveRsvpIdentitiesInput {
  currentUserId: string;
  currentUserName: string;
  /** This user's own roles on the event's target team (empty if not a member there). */
  currentUserTeamRoles: TeamRole[];
  /** The caregiver's children who are players on the event's target team. */
  linkedChildrenOnTeam: { id: string; name: string }[];
}

/**
 * Resolve the set of identities a logged-in user can RSVP as for one event.
 *
 * - The self identity is included **iff** the user holds a role
 *   (player/coach/manager) on the event's target team — a pure caregiver
 *   with no membership there gets no self identity, only their children's.
 * - One identity per linked child on that team, in name order.
 * - Self, when present, always sorts first.
 * - An empty result (e.g. a caregiver with no children on this team, and no
 *   membership of their own) is valid — the caller shows no RSVP controls,
 *   same as a non-member sees today.
 */
export function resolveRsvpIdentities(
  input: ResolveRsvpIdentitiesInput
): RsvpIdentity[] {
  const identities: RsvpIdentity[] = [];

  if (input.currentUserTeamRoles.length > 0) {
    const roleLabel = describeRoles(input.currentUserTeamRoles);
    identities.push({
      subjectUserId: input.currentUserId,
      label: roleLabel ? `${input.currentUserName} — ${roleLabel}` : input.currentUserName,
      isSelf: true,
    });
  }

  const children = [...input.linkedChildrenOnTeam].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const child of children) {
    identities.push({ subjectUserId: child.id, label: child.name, isSelf: false });
  }

  return identities;
}

/** Highest-precedence role label for display — manager > coach > player. */
function describeRoles(roles: TeamRole[]): string {
  if (roles.includes('manager')) return 'Manager';
  if (roles.includes('coach')) return 'Coach';
  if (roles.includes('player')) return 'Player';
  return '';
}
