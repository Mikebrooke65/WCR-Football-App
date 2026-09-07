// Pure logic for the mobile Team Page roster.
//
// Spec: `.kiro/specs/post-registration-welcome-and-team-page/` (task 3.1)
//
// These helpers are deliberately free of React and Supabase so the roster's
// age-band derivation, caregiver-contact selection, role merging, grouping/
// ordering, and team-selection state can be unit- and property-tested in
// isolation (design "Team Page" component interface).
//
// Source-of-truth rules honoured here:
//   - Roster membership comes from `team_members` (Req 3.10).
//   - Age band is derived from `teams.age_group` ONLY, never a per-player DOB
//     (Req 3.9). U17/Open => adult; U16-and-below => child.
//   - Team names render everywhere as `{age_group} {name}` (Req 3.3).

import type { TeamRole, TeamMemberWithTeam } from '../types/database';

/** Contact-display / login category derived from the team's age group. */
export type AgeBand = 'adult' | 'child';

/**
 * How a roster member's contact is presented (design "ContactDisplay").
 *
 * - `self` — U17/Open band: the player's own cellphone (Req 3.7).
 * - `caregiver` — U16-and-below band: the linked caregiver's name + cellphone
 *   (Req 3.8).
 * - `missing` — U16-and-below band with no linked caregiver (Req 3.11).
 */
export type ContactDisplay =
  | { kind: 'self'; cellphone: string }
  | { kind: 'caregiver'; name: string; cellphone: string }
  | { kind: 'missing' };

/**
 * A caregiver link for a child player, as needed to choose the contact of
 * record. `isPrimary` flags the designated primary caregiver; `linkedAt` is the
 * ISO timestamp the link was created, used to break ties by "most recently
 * linked" when none is primary (Req 3.8).
 */
export interface CaregiverLink {
  name: string;
  cellphone: string;
  isPrimary: boolean;
  linkedAt: string;
}

/**
 * A single `team_members`-derived roster row before merging. One user may
 * appear in several rows when they hold more than one role on the team.
 */
export interface RosterMember {
  userId: string;
  displayName: string;
  role: TeamRole;
  active: boolean;
  contact: ContactDisplay;
  /**
   * This person's OWN age band (DOB-derived, team `age_group` only as
   * fallback — `deriveAgeBandForPerson`). Drives per-person caregiver
   * visibility (Add / Manage Caregivers), which must follow the individual,
   * not the team: a real child registered on an Open/adult team is still a
   * child. Never use `RosterData.ageBand` (the team summary) for that.
   */
  ageBand: AgeBand;
  /** Child awaiting caregiver consent — greyed + non-selectable (Req 5.10). */
  pending?: boolean;
  /**
   * Only set on a pending row: the `caregiver_approvals.id` of the
   * `add_child` request awaiting a decision. Lets the roster row itself
   * drive Approve/Deny (streamlined-invites-and-child-access, Decision 1)
   * instead of a separate Approvals page — the caller passes this straight
   * to `respond-junior-approval` without a second lookup.
   */
  pendingApprovalId?: string;
  /**
   * Only set on a pending row: the caregiver's editable confirm-or-correct
   * seed for the child's name/DOB, exactly what `CaregiverApprovalPage.tsx`
   * used to show on its own separate page. Undefined for any non-pending
   * row, and for a pending row with no recorded DOB yet.
   */
  pendingChildDetails?: { firstName: string; lastName: string; dateOfBirth: string };
}

/**
 * A merged, display-ready roster row: one per user with every held role listed
 * together (design "RosterEntry", Req 3.5).
 */
export interface RosterEntry {
  userId: string;
  displayName: string;
  roles: TeamRole[];
  active: boolean;
  contact: ContactDisplay;
  /** See `RosterMember.ageBand` — this person's own band, not the team's. */
  ageBand: AgeBand;
  pending?: boolean;
  /** See `RosterMember.pendingApprovalId`. */
  pendingApprovalId?: string;
  /** See `RosterMember.pendingChildDetails`. */
  pendingChildDetails?: { firstName: string; lastName: string; dateOfBirth: string };
}

/** A selectable team option for the Team Page dropdown. */
export interface TeamOption {
  teamId: string;
  /** `{age_group} {name}` (Req 3.3). */
  label: string;
}

/**
 * The resolved state of the team selector (design "Selection behaviour").
 *
 * - exactly one team  => `selectedTeamId` set, no prompt, not empty (Req 3.2)
 * - two or more teams => `selectedTeamId` null, `prompt` true (Req 3.13)
 * - zero teams        => empty options, `empty` true (Req 3.14)
 */
export interface TeamSelectionState {
  options: TeamOption[];
  selectedTeamId: string | null;
  /** Show a "select a team" prompt with no roster (2+ teams, Req 3.13). */
  prompt: boolean;
  /** User belongs to no team — show empty state (Req 3.14). */
  empty: boolean;
}

// Canonical group/sort priority for roster roles: Coach, then Manager, then
// Player (Req 3.4). Lower rank sorts first.
const ROLE_RANK: Record<TeamRole, number> = {
  coach: 0,
  manager: 1,
  player: 2,
};

/**
 * Derive the age band from a team's `age_group` string alone (Req 3.9).
 *
 * Rule (Req 3.7 / 3.8): U17 or Open => `adult`; U16 and below => `child`.
 * The string is matched case-insensitively. "Open" (any age band named open)
 * is adult; a `U<n>` value is adult when n >= 17 and child otherwise.
 *
 * Unrecognised values default to `child`, the privacy-protective choice: a
 * child contact routes through a caregiver rather than exposing a would-be
 * minor's own number.
 */
export function deriveAgeBand(ageGroup: string): AgeBand {
  const value = (ageGroup ?? '').trim().toLowerCase();
  if (value === '') return 'child';
  if (value.includes('open')) return 'adult';

  const match = value.match(/(\d+)/);
  if (match) {
    const age = Number.parseInt(match[1], 10);
    return age >= 17 ? 'adult' : 'child';
  }

  return 'child';
}

/**
 * Derive the age band from a person's own date of birth, falling back to the
 * team-`age_group` rule when they have none recorded.
 *
 * Spec: `.kiro/specs/add-player-and-dob-age-model/` Requirement 2.1-2.3, 2.5 —
 * classification moves from an approximation (the team someone plays for) to
 * the person's own DOB, but only where one is recorded: an existing roster
 * member added before this feature shipped has no `date_of_birth` and is
 * unaffected (Req 2.3/2.4), so a single roster can legitimately mix
 * DOB-derived and `age_group`-derived bands person by person (Req 2.5) — this
 * function is what `TeamPage.tsx` calls per roster row, never once per team.
 *
 * The 16-year threshold here matches `routeAddPlayer`
 * (`src/lib/add-player-logic.ts`) and `isAdult`
 * (`supabase/functions/redeem-invite/logic.ts`) exactly. It is intentionally
 * NOT the same line as `deriveAgeBand`'s existing U17-grade threshold — see
 * this spec's design.md Data Models section ("Accepted, not resolved here")
 * for why that discrepancy is left visible rather than silently reconciled.
 *
 * An unparseable date of birth is treated as "not recorded" (falls back to
 * `deriveAgeBand`), the same safe-fallback direction `isAdult` and
 * `routeAddPlayer` take on malformed input.
 */
export function deriveAgeBandForPerson(
  dateOfBirth: string | null | undefined,
  ageGroup: string
): AgeBand {
  const age = ageFromDateOfBirth(dateOfBirth);
  if (age !== null) return age >= PERSONAL_ADULT_AGE_THRESHOLD ? 'adult' : 'child';
  return deriveAgeBand(ageGroup);
}

/** Matches `add-player-logic.ts`'s `ADULT_AGE_THRESHOLD` / `isAdult`'s threshold. */
const PERSONAL_ADULT_AGE_THRESHOLD = 16;

/** Whole-years age as of today from a strict `yyyy-mm-dd` string, or `null`. */
function ageFromDateOfBirth(dateOfBirth: string | null | undefined): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth ?? '');
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  const check = new Date(year, month - 1, day);
  const isValidCalendarDate =
    check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day;
  if (!isValidCalendarDate) return null;

  const now = new Date();
  let age = now.getFullYear() - year;
  const hasHadBirthdayThisYear =
    now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * Whether the current viewer may remove their own linked caregiver(s)
 * (2026-08-30, Task 12 item 4 follow-up — `.kiro/specs/streamlined-invites-
 * and-child-access/`).
 *
 * Origin: Section 6.2 ("Child ticked, actually an Adult") tried to solve
 * this at invite-redemption time by detecting a 16+ DOB on a Child-ticked
 * form and converting the *redeemer* into the player in place. Live-testing
 * found that broken for a genuinely separate caregiver (as opposed to a
 * 16-17 year old who self-invited using their own email as "the
 * caregiver"): the two cases are indistinguishable from the submitted form
 * data alone, and guessing wrong produces a player record built from the
 * wrong person's name/email. Resolution: stop guessing at redemption time.
 * A Child-ticked registration always proceeds as an ordinary pending child,
 * whatever DOB was entered — nothing wrong with a 16+ person still being
 * caregiver-linked, if that's how they came into the system. Instead, once
 * that person has their own login, THEY decide whether to end the
 * arrangement, via this self-service action.
 *
 * `ageBand` must be the viewer's own (`deriveAgeBandForPerson` on their own
 * date of birth) — never the team's, and never another row's. `'adult'`
 * matches this same file's/`add-player-logic.ts`'s 16-year threshold
 * exactly, so this lines up with every other adult/child boundary in the
 * app. Requires at least one linked caregiver — nothing to remove
 * otherwise.
 */
export function canSelfRemoveCaregiver(ageBand: AgeBand, linkedCaregiverCount: number): boolean {
  return ageBand === 'adult' && linkedCaregiverCount > 0;
}

/**
 * Contact of record for a roster member, by age band (Req 3.7, 3.8, 3.11).
 *
 * Moved here from `TeamPage.tsx` (`.kiro/specs/streamlined-invites-and-
 * child-access/`, Task 8) while confirming that spec's Requirement 7.2 —
 * a child's Team tab must expose no more than an existing Player already
 * does. That confirmation surfaced a documentation error worth recording
 * here directly on the function it's about: **there is no viewer-role gate
 * on contact details at all.** This function's only inputs are the target
 * row's own age band and team-role — never who is looking. Any team member
 * viewing the roster already sees every other member's contact (their own
 * cellphone, or their caregiver's) today, regardless of the viewer's own
 * role. `post-registration-welcome-and-team-page`'s requirements.md
 * confirms this was the original, intentional design ("As any member of a
 * team, I want to view the team roster... so that I can see who is on the
 * team and how to contact them") — visibility is gated by the *target's*
 * age band only, not a "Standard tier sees name/role only, Manager/Coach
 * tier additionally sees contact" split. No such split exists in this
 * codebase; `streamlined-invites-and-child-access/requirements.md`
 * Section 7.2 describes one that was never built.
 *
 * That correction doesn't change what Task 8 needs to do here, because the
 * requirement's actual conclusion still holds under the real mechanism: a
 * child's account uses `role: 'player'` — the exact same team-role a full
 * adult Player already has — so it runs through this exact function and
 * gets exactly the adult-Player-or-caregiver-routed contact any existing
 * Player already produces. No new gate is needed; this was already true
 * before this spec, and giving a child their own login changes nothing
 * about who can see what on the Team tab.
 */
export function contactFor(
  ageBand: AgeBand,
  role: TeamRole,
  cellphone: string,
  caregiverLinks: CaregiverLink[] | undefined
): ContactDisplay {
  // Adult band: everyone shows their own cellphone (Req 3.7).
  if (ageBand === 'adult') {
    return { kind: 'self', cellphone };
  }
  // Child band: players route through a caregiver (Req 3.8/3.11); coaches and
  // managers are adults and show their own number.
  if (role === 'player') {
    return selectCaregiverContact(caregiverLinks ?? []);
  }
  return { kind: 'self', cellphone };
}

/**
 * Choose the caregiver contact of record for a child player (Req 3.8 / 3.11).
 *
 * Selection order:
 *   1. the caregiver flagged primary (first one if several are flagged);
 *   2. otherwise the most recently linked caregiver (latest `linkedAt`);
 *   3. when there are no caregivers, a `missing` indication (Req 3.11).
 */
export function selectCaregiverContact(caregivers: CaregiverLink[]): ContactDisplay {
  if (!caregivers || caregivers.length === 0) {
    return { kind: 'missing' };
  }

  const primary = caregivers.find((c) => c.isPrimary);
  const chosen =
    primary ??
    caregivers.reduce((latest, current) =>
      current.linkedAt > latest.linkedAt ? current : latest,
    );

  return { kind: 'caregiver', name: chosen.name, cellphone: chosen.cellphone };
}

/**
 * Collapse many `team_members` rows into one row per user, combining all held
 * roles (Req 3.5). Roles are de-duplicated and ordered Coach, Manager, Player.
 * A user is active if any of their memberships is active, and pending if any is
 * pending; the first-seen display name and contact are retained. Input order of
 * distinct users is preserved.
 */
export function mergeRoles(members: RosterMember[]): RosterEntry[] {
  const byUser = new Map<string, RosterEntry>();

  for (const member of members) {
    const existing = byUser.get(member.userId);
    if (!existing) {
      byUser.set(member.userId, {
        userId: member.userId,
        displayName: member.displayName,
        roles: [member.role],
        active: member.active,
        contact: member.contact,
        ageBand: member.ageBand,
        pending: member.pending,
        pendingApprovalId: member.pendingApprovalId,
        pendingChildDetails: member.pendingChildDetails,
      });
      continue;
    }

    if (!existing.roles.includes(member.role)) {
      existing.roles.push(member.role);
    }
    existing.active = existing.active || member.active;
    existing.pending = existing.pending || member.pending;
  }

  for (const entry of byUser.values()) {
    entry.roles.sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
  }

  return Array.from(byUser.values());
}

/**
 * Produce the display-ready roster: one row per user (via `mergeRoles`) ordered
 * by group Coach -> Manager -> Player, and within each group all active members
 * before any inactive member (Req 3.4 / 3.6).
 *
 * A user's group is their highest-priority role (Coach outranks Manager
 * outranks Player), so a coach who is also a player appears in the Coach group.
 * Sorting is stable, so members that tie on group and active status keep their
 * merged order.
 */
export function groupAndSortRoster(members: RosterMember[]): RosterEntry[] {
  const merged = mergeRoles(members);

  return merged
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const groupA = groupRank(a.entry.roles);
      const groupB = groupRank(b.entry.roles);
      if (groupA !== groupB) return groupA - groupB;

      // Active members sort above inactive within the group (Req 3.6).
      if (a.entry.active !== b.entry.active) return a.entry.active ? -1 : 1;

      // Stable fallback preserves merged order.
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

// The group a merged entry belongs to = the highest-priority role it holds.
function groupRank(roles: TeamRole[]): number {
  return roles.reduce(
    (best, role) => Math.min(best, ROLE_RANK[role]),
    ROLE_RANK.player,
  );
}

/**
 * Map a user's `team_members` set to selector options plus auto-selection state
 * (Req 3.1, 3.2, 3.13, 3.14).
 *
 * Duplicate memberships for the same team (a user holding several roles) are
 * collapsed to a single option keyed on `team_id`, so "exactly one team" is
 * judged on distinct teams. Options are labelled `{age_group} {name}` (Req 3.3)
 * in the order teams first appear.
 */
export function buildTeamSelection(teams: TeamMemberWithTeam[]): TeamSelectionState {
  const options: TeamOption[] = [];
  const seen = new Set<string>();

  for (const membership of teams ?? []) {
    const team = membership.team;
    if (!team || seen.has(team.id)) continue;
    seen.add(team.id);
    options.push({ teamId: team.id, label: `${team.age_group} ${team.name}` });
  }

  if (options.length === 0) {
    return { options, selectedTeamId: null, prompt: false, empty: true };
  }

  if (options.length === 1) {
    return { options, selectedTeamId: options[0].teamId, prompt: false, empty: false };
  }

  return { options, selectedTeamId: null, prompt: true, empty: false };
}
