// Feature: post-registration-welcome-and-team-page (task 12.1)
//
// Mobile Team Page. Renders a team selector, a grouped roster (Coach → Manager
// → Player), age-band contact display, role/team-type-gated action controls,
// and the loading / empty / multi-team / error-with-retry states. Routed at
// `/team` inside the authenticated MainLayout (see src/routes/index.tsx).
//
// Pure logic (selection, grouping, contact, capabilities) lives in
// `roster-logic.ts` and `permissions-logic.ts`; this component only wires those
// helpers to Supabase reads/writes and React state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, UserPlus, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { teamsApi } from '../lib/teams-api';
import { rolesApi } from '../lib/roles-api';
import { UserRole } from '../types/database';
import type { TeamRole, TeamType, TeamMemberWithUser } from '../types/database';
import {
  buildTeamSelection,
  canSelfRemoveCaregiver,
  contactFor,
  deriveAgeBand,
  deriveAgeBandForPerson,
  groupAndSortRoster,
  selectCaregiverContact,
  type AgeBand,
  type CaregiverLink,
  type ContactDisplay,
  type RosterEntry,
  type RosterMember,
  type TeamSelectionState,
} from '../lib/roster-logic';
import {
  resolveCapabilities,
  canAddCaregiver,
  canDemoteFromManager,
  canIssueDeviceAccess,
  canRemoveCoachFlag,
  canRemoveTeamMember,
  type ActionCapabilities,
  type PermissionRole,
} from '../lib/permissions-logic';
import { AddPlayerModal, type AddPlayerOutcome } from '../components/team/AddPlayerModal';
import { AddCaregiverModal } from '../components/team/AddCaregiverModal';
import { RemoveMyCaregiverModal } from '../components/team/RemoveMyCaregiverModal';
import { RemoveTeamMemberModal } from '../components/team/RemoveTeamMemberModal';
import { GantPersonDetailModal } from '../components/GantPersonDetailModal';
import { GantNotesPanel } from '../components/GantNotesPanel';
import { caregiversApi } from '../lib/caregivers-api';
import { ApiError } from '../lib/api-client';
import {
  validateChildEdit,
  type ChildEdit,
  type ChildEditErrors,
} from '../lib/add-junior-logic';

/** How long a roster fetch may run before the error state shows (Req 3.15). */
const ROSTER_TIMEOUT_MS = 10_000;

/**
 * `yyyy-mm-dd` -> `dd/mm/yyyy` for the read-only pending-consent summary
 * (2026-08-29). Falls back to the raw value for anything unparseable rather
 * than showing nothing — this is a display nicety, not validation (that
 * already happened before this value ever reached the database).
 */
function formatDob(dateOfBirth: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth ?? '');
  if (!match) return dateOfBirth ?? '';
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** Everything one roster fetch resolves, ready to drive the render. */
interface RosterData {
  entries: RosterEntry[];
  ageBand: AgeBand;
  teamType: TeamType;
  managerCount: number;
  /** Roles the current user holds on this team (for capability resolution). */
  currentUserRoles: PermissionRole[];
  /** team_members row id of each user's player membership (for promotion). */
  playerMembershipIdByUser: Record<string, string>;
  /**
   * 2026-08-31 — every `team_members` row (id + role) each user holds on
   * this team, keyed by user id. Unlike `playerMembershipIdByUser` above
   * (player-only, for promotion), this covers every role a person might
   * simultaneously hold on the SAME team (e.g. a Coach who is also a
   * Player), because the new "Remove" action deletes exactly one
   * (person, role, team) association — it needs the specific row id for
   * whichever role's Remove control was clicked, not just "this user
   * somewhere on this team". See `canRemoveTeamMember` (`permissions-
   * logic.ts`) and `remove-team-member` (Edge Function).
   *
   * In practice this array has at most one entry per user for a given team
   * — `team_members` has `UNIQUE(team_id, user_id)` (migration 021), so one
   * person can hold only one `role` per team. `is_coach` (migration 064,
   * V1.R Part 1) is carried on that same row: it's how a person can be
   * `role: 'manager'` AND have Coach authority on the very same team
   * without a second row.
   */
  membershipsByUser: Record<string, Array<{ id: string; role: TeamRole; is_coach: boolean }>>;
  /**
   * The `team_members.id` of this team's first Manager (earliest row with
   * `role = 'manager'`, by `created_at`) — `null` if the team has no
   * Manager yet. Only meaningful for `club_tournament` teams; an External
   * League team never shows Remove at all, so this is never consulted
   * there. "First Manager" isn't stored anywhere as its own flag, so it's
   * derived here from the same `memberRows` fetch already in hand, rather
   * than a second round-trip.
   */
  firstManagerMembershipId: string | null;
  /**
   * Requirement 7.4.1 — child user ids the CURRENT viewer is a linked
   * caregiver for (`player_caregivers`), independent of this team's own
   * roster/caregiver-contact data. Drives whether "Issue Device Access"
   * shows on a given row — a Manager/Coach viewing the same roster is never
   * a linked caregiver of these children, so they never see it.
   */
  myLinkedChildIds: Set<string>;
  /**
   * Requirement 7.5 (Task 9) — how many caregivers each child-band player
   * currently has linked, keyed by user id. Drives `canAddCaregiver`: a
   * Coach/Manager may add a child's FIRST caregiver only; an admin-only
   * gate applies once this count is 1 or more (enforced again at the data
   * layer regardless — this is only what decides whether the UI offers the
   * action). Absent/zero for an adult-band row, which never has caregivers.
   */
  caregiverCountByPlayer: Record<string, number>;
  /**
   * 2026-08-30, Task 12 item 4 follow-up — whether the CURRENT viewer (not
   * any other row) may remove their own linked caregiver(s): true only once
   * their own age band is 'adult' (16+) and they actually have at least one
   * caregiver linked. See `roster-logic.ts`'s `canSelfRemoveCaregiver` for
   * why this exists instead of the "convert in place" attempt Section 6.2
   * originally tried at invite-redemption time.
   */
  canSelfRemoveCaregiver: boolean;
  /**
   * The caregiver(s) `canSelfRemoveCaregiver` above would remove — only
   * used to populate `RemoveMyCaregiverModal`'s confirmation copy. Empty
   * unless `canSelfRemoveCaregiver` is true.
   */
  ownCaregivers: Array<{ id: string; name: string }>;
}

/** One caregiver, as shown in the "manage caregivers" expandable list (Task 9). */
interface CaregiverManageEntry {
  id: string;
  name: string;
  email: string;
}

/**
 * State of one child row's "manage caregivers" disclosure (Requirement 7.5,
 * Task 9) — collapsed by default; loaded on demand the first time an admin
 * expands it, not fetched for every child-band row up front.
 */
interface CaregiverManagementState {
  expanded: boolean;
  loading: boolean;
  removingId: string | null;
  caregivers: CaregiverManageEntry[] | null;
  error: string | null;
}

const COLLAPSED_CAREGIVER_MANAGEMENT: CaregiverManagementState = {
  expanded: false,
  loading: false,
  removingId: null,
  caregivers: null,
  error: null,
};

/** Reject if the wrapped promise does not settle within `ms` (Req 3.15). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('roster_timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function TeamPage() {
  const { user } = useAuth();

  // Team-selector state derived from the user's team_members set.
  const [selection, setSelection] = useState<TeamSelectionState>({
    options: [],
    selectedTeamId: null,
    prompt: false,
    empty: false,
  });
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // Roster state for the currently selected team.
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [rosterStatus, setRosterStatus] = useState<LoadStatus>('idle');

  // Action feedback (e.g. manager-cap message, confirmation) and modal.
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);

  // Requirement 7.4.1/7.4.2 — the most recently generated device-code link,
  // shown inline (same pattern as CompetitionsPage's generated invite link)
  // until the caregiver dismisses it or generates another one.
  const [deviceCodeResult, setDeviceCodeResult] = useState<{
    childName: string;
    link: string;
  } | null>(null);
  const [issuingDeviceAccessFor, setIssuingDeviceAccessFor] = useState<string | null>(null);

  // Requirement 7.5 (Task 9) — "Add Caregiver" modal target, and the
  // per-child "manage caregivers" expandable-list state, keyed by child
  // user id so several rows could in principle be expanded independently
  // (though only one row's modal can be open at a time).
  const [addCaregiverFor, setAddCaregiverFor] = useState<RosterEntry | null>(null);
  const [caregiverManagement, setCaregiverManagement] = useState<
    Record<string, CaregiverManagementState>
  >({});

  // 2026-08-30, Task 12 item 4 follow-up — the self-service "Remove My
  // Caregiver" confirmation modal. Only one viewer's own row can ever
  // trigger this (there is exactly one "self" on any roster), so unlike
  // `addCaregiverFor`/`caregiverManagement` above this needs no per-row key
  // — just whether it's open.
  const [showRemoveMyCaregiver, setShowRemoveMyCaregiver] = useState(false);

  // 2026-08-31 — the roster page's new "Remove" action (replaces
  // Deactivate/Reactivate here; see `permissions-logic.ts`'s
  // `canRemoveTeamMember`). Set when a row's Remove control is clicked;
  // `null` while the confirmation modal is closed. Only one row/role can be
  // mid-confirmation at a time.
  const [removeTarget, setRemoveTarget] = useState<{
    membershipId: string;
    memberName: string;
    roleLabel: string;
    isOwnRow: boolean;
  } | null>(null);

  // gant-ai-feedback-assistant, Task 6/6b — the person-detail modal (Progress
  // Notes for whichever roster row was tapped) and the team-level notes
  // section's expand/collapse state (Requirement 6.5).
  const [gantDetailFor, setGantDetailFor] = useState<{
    playerId: string;
    playerName: string;
  } | null>(null);
  const [showTeamNotes, setShowTeamNotes] = useState(false);

  // streamlined-invites-and-child-access, Decision 1 — the caregiver's
  // confirm-or-correct copy of a pending child's name/DOB, and this row's
  // approve/deny state, keyed by `caregiver_approvals.id`. Folds what
  // `CaregiverApprovalPage.tsx` used to show on its own separate page
  // directly onto the roster row instead (that route now just redirects
  // here — see routes/index.tsx).
  const [respondEdits, setRespondEdits] = useState<Record<string, ChildEdit>>({});
  const [respondErrors, setRespondErrors] = useState<Record<string, ChildEditErrors>>({});
  const [respondingApprovalId, setRespondingApprovalId] = useState<string | null>(null);

  // Guards a roster response against a newer selection/retry superseding it.
  const loadTokenRef = useRef(0);

  const isClubAdmin = user?.role === UserRole.ADMIN;

  // ---- Load the user's teams once (Req 3.1, 3.2, 3.13, 3.14) ----------------
  const loadTeams = useCallback(async () => {
    if (!user) return;
    setTeamsLoading(true);
    setTeamsError(null);
    try {
      const memberships = await teamsApi.getMyTeams(user.id);
      setSelection(buildTeamSelection(memberships));
    } catch (err) {
      setTeamsError(err instanceof Error ? err.message : 'Could not load your teams.');
    } finally {
      setTeamsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // ---- Load the roster for the selected team (Req 3.4, 3.15) ----------------
  const loadRoster = useCallback(
    async (teamId: string) => {
      if (!user) return;
      const token = ++loadTokenRef.current;
      setRosterStatus('loading');
      setActionMessage(null);

      try {
        const data = await withTimeout(fetchRoster(teamId, user.id), ROSTER_TIMEOUT_MS);
        if (token !== loadTokenRef.current) return; // superseded
        setRoster(data);
        setRosterStatus('loaded');

        // Seed a confirm-or-correct edit for every pending child row THIS
        // viewer can act on — mirrors CaregiverApprovalPage.tsx's own seeding,
        // and likewise never clobbers an edit already in progress (a reload
        // shouldn't discard what the caregiver has half-typed).
        setRespondEdits((prev) => {
          const next = { ...prev };
          for (const entry of data.entries) {
            if (
              entry.pending &&
              entry.pendingApprovalId &&
              data.myLinkedChildIds.has(entry.userId) &&
              !next[entry.pendingApprovalId]
            ) {
              next[entry.pendingApprovalId] = {
                firstName: entry.pendingChildDetails?.firstName ?? '',
                lastName: entry.pendingChildDetails?.lastName ?? '',
                dateOfBirth: entry.pendingChildDetails?.dateOfBirth ?? '',
              };
            }
          }
          return next;
        });
      } catch (err) {
        if (token !== loadTokenRef.current) return; // superseded
        setRoster(null);
        setRosterStatus('error');
      }
    },
    [user]
  );

  // Auto-load whenever a team becomes selected (auto-select for single-team
  // users, or a manual pick for multi-team users). Clearing selection resets.
  useEffect(() => {
    if (selection.selectedTeamId) {
      loadRoster(selection.selectedTeamId);
    } else {
      setRoster(null);
      setRosterStatus('idle');
    }
  }, [selection.selectedTeamId, loadRoster]);

  const selectTeam = (teamId: string) => {
    setShowDropdown(false);
    setSelection((prev) => ({ ...prev, selectedTeamId: teamId, prompt: false }));
  };

  const selectedOption = selection.options.find(
    (o) => o.teamId === selection.selectedTeamId
  );

  // Capabilities for the current user on the selected team (Req 4.1–4.5, 4.11).
  const capabilities: ActionCapabilities | null = roster
    ? resolveCapabilities({
        isClubAdmin,
        teamRoles: roster.currentUserRoles,
        teamType: roster.teamType,
        managerCount: roster.managerCount,
      })
    : null;

  // ---- Roster actions -------------------------------------------------------

  const refreshRoster = () => {
    if (selection.selectedTeamId) loadRoster(selection.selectedTeamId);
  };

  /**
   * 2026-08-31 — opens the "Remove" confirmation for one role on one row.
   * Deactivate/Reactivate (whole-account `users.active`) are gone from this
   * page entirely — see `permissions-logic.ts`'s `canRemoveTeamMember` doc
   * comment for why they were too blunt for "undo a mistaken Add", and
   * `UserManagement.tsx` for where a genuine whole-account disable now
   * lives (Admin-only, a distinct purpose from Remove).
   */
  const handleOpenRemove = (
    membershipId: string,
    role: TeamRole,
    entry: RosterEntry,
    isOwnRow: boolean
  ) => {
    setActionMessage(null);
    setRemoveTarget({
      membershipId,
      memberName: entry.displayName,
      roleLabel: ROLE_LABELS[role],
      isOwnRow,
    });
  };

  const handleRemoveSuccess = (memberName: string, roleLabel: string, cascadedCaregiverRemoval: boolean) => {
    setActionMessage(
      cascadedCaregiverRemoval
        ? `Removed ${memberName} as ${roleLabel}. As that was their last team, their caregiver link was removed too.`
        : `Removed ${memberName} as ${roleLabel}.`
    );
    refreshRoster();
  };

  const handlePromoteToManager = async (entry: RosterEntry) => {
    setActionMessage(null);
    const membershipId = roster?.playerMembershipIdByUser[entry.userId];
    if (!membershipId) return;
    try {
      await rolesApi.updateTeamMemberRole(membershipId, 'manager');
      setActionMessage(`${entry.displayName} is now a Manager.`);
      refreshRoster();
    } catch (err) {
      // The data-layer trigger backstops the cap (Req 4.9/4.10): map its error
      // to the user-facing message and leave the role unchanged.
      const message = err instanceof Error ? err.message : '';
      if (message.includes('manager_cap_reached')) {
        setActionMessage('This team already has the maximum of two Managers.');
      } else {
        setActionMessage(message || 'Could not promote the member.');
      }
    }
  };

  /**
   * V1.R Part 1, item B — Demote a Manager or Coach's `role` back to Player.
   * Changes only `role`; never touches `is_coach` (see `handleStopBeingCoach`
   * for that). Gating is `canDemoteFromManager` (`permissions-logic.ts`),
   * evaluated per membership at the render site — this handler assumes the
   * caller already confirmed the action is allowed.
   */
  const handleDemoteToPlayer = async (entry: RosterEntry, membershipId: string) => {
    setActionMessage(null);
    try {
      await rolesApi.updateTeamMemberRole(membershipId, 'player');
      setActionMessage(`${entry.displayName} is now a Player.`);
      refreshRoster();
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Could not demote this member.');
    }
  };

  /**
   * V1.R Part 1, item C — "Make Coach": turn on `is_coach` for a member
   * whose `role` is something other than 'coach' (e.g. a Manager who also
   * wants Coach authority on this same team — the scenario that prompted
   * this whole feature, 2026-09-01: "the initial manager set up with a
   * team... first thing they do is select make coach"). Purely additive —
   * `role` itself is untouched. Uncapped (confirmed by the user 2026-09-01 —
   * no equivalent of the two-Manager cap for Coach).
   */
  const handleMakeCoach = async (entry: RosterEntry, membershipId: string) => {
    setActionMessage(null);
    try {
      await rolesApi.setCoachFlag(membershipId, true);
      setActionMessage(`${entry.displayName} is now also a Coach.`);
      refreshRoster();
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Could not make this member a Coach.');
    }
  };

  /**
   * V1.R Part 1, item C's inverse — turn `is_coach` back off. Never touches
   * `role`, so a Manager who stops coaching stays Manager. Gating is
   * `canRemoveCoachFlag` (`permissions-logic.ts`) — no first-Manager concept,
   * since `is_coach` isn't the `role` column.
   */
  const handleStopBeingCoach = async (entry: RosterEntry, membershipId: string) => {
    setActionMessage(null);
    try {
      await rolesApi.setCoachFlag(membershipId, false);
      setActionMessage(`${entry.displayName} is no longer a Coach.`);
      refreshRoster();
    } catch (err) {
      setActionMessage(err instanceof ApiError ? err.message : 'Could not update this member.');
    }
  };

  /**
   * Requirement 7.4.1/7.4.2 — a linked caregiver deliberately triggers "give
   * {child} their own access." Generates the code, then shows the shareable
   * link the same way `CompetitionsPage.tsx` shows a generated invite link —
   * this is the caregiver's one chance to see/copy it, so it stays visible
   * until dismissed rather than folding into the plain-text `actionMessage`
   * banner other actions use.
   */
  const handleIssueDeviceAccess = async (entry: RosterEntry) => {
    setActionMessage(null);
    setDeviceCodeResult(null);
    setIssuingDeviceAccessFor(entry.userId);
    try {
      const { code } = await caregiversApi.generateChildDeviceCode(entry.userId);
      setDeviceCodeResult({
        childName: entry.displayName,
        link: `${window.location.origin}/device/${code}`,
      });
    } catch (err) {
      setActionMessage(
        err instanceof ApiError ? err.message : 'Could not create a device code.'
      );
    } finally {
      setIssuingDeviceAccessFor(null);
    }
  };

  /**
   * Copy a generated device link to the clipboard — same pattern as
   * `CompetitionsPage.tsx`'s `copyInviteLink` (plain `navigator.clipboard`
   * + a confirmation `alert`), added 2026-08-31 per a captured UX polish
   * item on this screen (see `CHANGELOG.md`'s entry for the full list of
   * three items this touches).
   */
  const handleCopyDeviceLink = (link: string) => {
    navigator.clipboard.writeText(link);
    alert('Device link copied to clipboard!');
  };

  /**
   * Fetch (or re-fetch) a child's caregiver list for the "manage
   * caregivers" disclosure (Requirement 7.5, Task 9). Kept separate from
   * the toggle handler below so a post-removal refresh can reuse it without
   * re-deriving the open/closed decision.
   */
  const loadCaregiverManageList = async (childId: string) => {
    setCaregiverManagement((prev) => ({
      ...prev,
      [childId]: { ...COLLAPSED_CAREGIVER_MANAGEMENT, expanded: true, loading: true },
    }));
    try {
      const links = await caregiversApi.getPlayerCaregivers(childId);
      const caregivers: CaregiverManageEntry[] = links.map((link) => ({
        id: link.caregiver_id,
        name: `${link.caregiver?.first_name ?? ''} ${link.caregiver?.last_name ?? ''}`.trim() || 'Unknown',
        email: link.caregiver?.email ?? '',
      }));
      setCaregiverManagement((prev) => ({
        ...prev,
        [childId]: { expanded: true, loading: false, removingId: null, caregivers, error: null },
      }));
    } catch (err) {
      setCaregiverManagement((prev) => ({
        ...prev,
        [childId]: {
          expanded: true,
          loading: false,
          removingId: null,
          caregivers: null,
          error: err instanceof Error ? err.message : 'Could not load caregivers.',
        },
      }));
    }
  };

  const handleToggleManageCaregivers = (childId: string) => {
    const current = caregiverManagement[childId];
    if (current?.expanded) {
      setCaregiverManagement((prev) => ({ ...prev, [childId]: { ...current, expanded: false } }));
      return;
    }
    loadCaregiverManageList(childId);
  };

  /**
   * Requirement 7.5's last bullet — removing a caregiver does NOT itself
   * revoke the child's device access; it only queues an `admin_action_items`
   * row for an admin to review (migration 056's trigger, fired regardless of
   * which UI path calls this — nothing to do here beyond the removal
   * itself). `unlinkCaregiverFromPlayer` already existed in `caregivers-api`
   * but had no caller anywhere in the app before this — see tasks.md's own
   * note on the scope gap this closes.
   */
  const handleRemoveCaregiver = async (childId: string, caregiverId: string) => {
    setCaregiverManagement((prev) => ({
      ...prev,
      [childId]: { ...(prev[childId] ?? COLLAPSED_CAREGIVER_MANAGEMENT), removingId: caregiverId },
    }));
    try {
      await caregiversApi.unlinkCaregiverFromPlayer(caregiverId, childId);
      setActionMessage('Caregiver removed. An admin has been notified to review device access.');
      await loadCaregiverManageList(childId);
      refreshRoster(); // updates the row's own chosen contact + caregiver count
    } catch (err) {
      setCaregiverManagement((prev) => ({
        ...prev,
        [childId]: { ...(prev[childId] ?? COLLAPSED_CAREGIVER_MANAGEMENT), removingId: null },
      }));
      // V1.R item E's data-layer invariant (migration 067) backstops this:
      // deleting a Junior's last remaining caregiver is rejected at the DB
      // level. Map its error to a friendly message, same pattern as
      // handlePromoteToManager's manager_cap_reached handling above.
      const message = err instanceof ApiError ? err.message : '';
      if (message.includes('player_requires_a_caregiver')) {
        setActionMessage(
          "This is the child's only caregiver. Add a replacement caregiver before removing this one."
        );
      } else {
        setActionMessage(message || 'Could not remove this caregiver.');
      }
    }
  };

  /**
   * streamlined-invites-and-child-access, Decision 1 — the roster row's own
   * Accept/Deny action for a pending add-a-junior request, replacing the
   * dedicated Approvals page. Reuses `caregiversApi.approveJunior`/
   * `denyJunior`, which already wire to the (now correctly deployed)
   * `respond-junior-approval` Edge Function — nothing about that approval
   * logic changes here, only where the UI for it lives.
   */
  const updateRespondEdit = (approvalId: string, field: keyof ChildEdit, value: string) => {
    setRespondEdits((prev) => ({
      ...prev,
      [approvalId]: { ...prev[approvalId], [field]: value } as ChildEdit,
    }));
    setRespondErrors((prev) => {
      if (!prev[approvalId]?.[field]) return prev;
      const { [field]: _removed, ...rest } = prev[approvalId];
      return { ...prev, [approvalId]: rest };
    });
  };

  const handleRespondToJunior = async (entry: RosterEntry, decision: 'approve' | 'deny') => {
    const approvalId = entry.pendingApprovalId;
    if (!approvalId || !user) return;
    setActionMessage(null);

    // 2026-08-29 follow-up: a child registered through the normal Child
    // happy path already has their DOB confirmed once, via the checkbox on
    // the registration form itself (Decision 2) — re-showing editable
    // fields here just to re-confirm the exact same thing was pure friction
    // (flagged live-testing George Pig/Daddy Pig). So editing is only
    // offered — and only required before Accept goes through — when the
    // child's DOB isn't already on file, which happens on exactly one path:
    // an existing-caregiver-account bypass linking to a brand-new pending
    // child skips the registration form entirely (Requirement 2.2), so
    // nothing ever collects that child's DOB anywhere else. Only an
    // approval writes a correction; deny leaves the child's record
    // untouched, same as the page this replaces.
    let correction: { firstName: string; lastName: string; dateOfBirth: string } | undefined;
    if (decision === 'approve') {
      if (!entry.pendingChildDetails?.dateOfBirth) {
        const edit = respondEdits[approvalId];
        const errors = edit ? validateChildEdit(edit) : {};
        if (!edit || Object.keys(errors).length > 0) {
          setRespondErrors((prev) => ({ ...prev, [approvalId]: errors }));
          return;
        }
        correction = edit;
      }
      // Else: DOB already confirmed at registration — approve as-is, no
      // correction to send.
    }

    setRespondingApprovalId(approvalId);
    try {
      if (decision === 'approve') {
        await caregiversApi.approveJunior(approvalId, user.id, correction);
        setActionMessage(`${entry.displayName} is now active on the team.`);
      } else {
        await caregiversApi.denyJunior(approvalId, user.id);
        setActionMessage(`Declined the request for ${entry.displayName}.`);
      }
      refreshRoster();
    } catch (err) {
      setActionMessage(
        err instanceof ApiError ? err.message : 'Could not respond to this request.'
      );
    } finally {
      setRespondingApprovalId(null);
    }
  };

  const handleAddCaregiverSuccess = (childName: string, outcome: { invited: boolean }) => {
    setActionMessage(
      outcome.invited
        ? `Invited a caregiver for ${childName}.`
        : `Linked an existing account as a caregiver for ${childName}.`
    );
    refreshRoster();
  };

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="bg-gray-50 min-h-full pb-20">
      {/* Header */}
      <div className="p-4">
        <div className="border-l-8 border-[#0091f3] pl-4 mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="text-gray-600 text-sm">View your team roster and contact details</p>
        </div>
      </div>

      {/* Loading the user's teams */}
      {teamsLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#0091f3]" />
        </div>
      )}

      {/* Failed to load teams */}
      {!teamsLoading && teamsError && (
        <div className="px-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <p className="text-sm text-red-800">{teamsError}</p>
            <button
              onClick={loadTeams}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        </div>
      )}

      {/* No teams at all (Req 3.14) */}
      {!teamsLoading && !teamsError && selection.empty && (
        <div className="px-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <p className="text-gray-900 font-medium">You are not a member of any team yet.</p>
            <p className="text-gray-500 text-sm mt-1">
              When you're added to a team, its roster will appear here.
            </p>
          </div>
        </div>
      )}

      {/* Team selector + roster area */}
      {!teamsLoading && !teamsError && !selection.empty && (
        <>
          {/* Selector (Req 3.1, 3.3) */}
          <div className="px-4 mb-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
              <div className="p-4 flex items-center justify-between">
                <h2 className="font-bold text-lg text-gray-900">
                  {selectedOption ? selectedOption.label : 'Select a team'}
                </h2>
                {selection.options.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowDropdown((s) => !s)}
                      className="flex items-center gap-2 px-4 py-2 bg-[#0091f3] text-white rounded-lg text-sm font-medium hover:bg-[#0081d8] transition-colors"
                    >
                      {selectedOption ? 'Change Team' : 'Choose Team'}
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {showDropdown && (
                      <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
                        {selection.options.map((option) => (
                          <button
                            key={option.teamId}
                            onClick={() => selectTeam(option.teamId)}
                            className={`block w-full text-left px-4 py-3 text-sm hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                              option.teamId === selection.selectedTeamId
                                ? 'bg-blue-50 text-[#0091f3] font-medium'
                                : 'text-gray-700'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* gant-ai-feedback-assistant, Requirement 6.5 (decided 2026-09-03):
              team-scoped Progress Notes live HERE, on the roster page
              itself, not a separate screen — a "Notes" link below the team
              name/selector, same summary-card+feed pattern as the
              person-detail screen, just scoped to the team. */}
          {selection.selectedTeamId && (
            <div className="px-4 mb-4">
              <button
                onClick={() => setShowTeamNotes((s) => !s)}
                className="text-sm font-medium flex items-center gap-1"
                style={{ color: '#d97706' }}
              >
                {showTeamNotes ? 'Hide' : 'Show'} Team Progress Notes
                <ChevronDown className={`w-4 h-4 transition-transform ${showTeamNotes ? 'rotate-180' : ''}`} />
              </button>
              {showTeamNotes && (
                <div className="mt-2">
                  <GantNotesPanel scope="team" subjectId={selection.selectedTeamId} />
                </div>
              )}
            </div>
          )}

          {/* Prompt to select a team when 2+ teams and none chosen (Req 3.13) */}
          {selection.prompt && !selection.selectedTeamId && (
            <div className="px-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  You belong to more than one team. Select a team above to view its roster.
                </p>
              </div>
            </div>
          )}

          {/* Roster loading (Req 3.4) */}
          {selection.selectedTeamId && rosterStatus === 'loading' && (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#0091f3]" />
            </div>
          )}

          {/* Roster load error with retry preserving selection (Req 3.15) */}
          {selection.selectedTeamId && rosterStatus === 'error' && (
            <div className="px-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
                <p className="text-sm text-red-800">
                  The roster could not be loaded. Please try again.
                </p>
                <button
                  onClick={refreshRoster}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm"
                >
                  <RefreshCw className="w-4 h-4" /> Retry
                </button>
              </div>
            </div>
          )}

          {/* Loaded roster */}
          {selection.selectedTeamId && rosterStatus === 'loaded' && roster && capabilities && (
            <div className="px-4 space-y-4">
              {/* Add-player action (Req 1.1, replaces Add Junior) — gated by capability */}
              {capabilities.canAddUser && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowAddPlayer(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-[#22c55e] text-white rounded-lg text-sm font-medium hover:bg-[#1ea34d] transition-colors"
                  >
                    <UserPlus className="w-4 h-4" /> Add Player
                  </button>
                </div>
              )}

              {/* Action feedback / confirmations (Req 4.6, 4.7, 4.9) */}
              {actionMessage && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3" role="status">
                  <p className="text-sm text-blue-800">{actionMessage}</p>
                </div>
              )}

              {/* Requirement 7.4.2/7.4.3 — the generated device-code link,
                  shareable however suits the family (read aloud, copy-paste
                  into a message). Stays visible until dismissed or replaced
                  by generating another one, same pattern as
                  CompetitionsPage's generated invite link. */}
              {deviceCodeResult && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2" role="status">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-green-800">
                      Device link for <span className="font-medium">{deviceCodeResult.childName}</span> —
                      share this with them to open on their own device. It'll automatically sign
                      them in to the app on that device from then on.
                    </p>
                    <button
                      onClick={() => setDeviceCodeResult(null)}
                      className="text-green-700 text-xs flex-shrink-0"
                      aria-label="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-sm font-mono break-all bg-white rounded px-2 py-1 border border-green-200">
                    {deviceCodeResult.link}
                  </p>
                  <button
                    onClick={() => handleCopyDeviceLink(deviceCodeResult.link)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Copy Link
                  </button>
                </div>
              )}

              {roster.entries.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
                  <p className="text-gray-500 text-sm">This team has no members yet.</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100 overflow-hidden">
                  {roster.entries.map((entry) => {
                    // Requirement 7.5 (Task 9) — only a child-band player row
                    // ever has caregivers to add or manage; an adult-band
                    // player, or any coach/manager row, never does.
                    // Per-person age band (entry.ageBand), NOT the team summary
                    // (roster.ageBand) — a real child on an Open/adult team is
                    // still a child and must be manageable as one (2026-09-09
                    // fix; see roster-logic.ts RosterMember.ageBand).
                    const isChildBandPlayerRow =
                      entry.ageBand === 'child' && entry.roles.includes('player');
                    const existingCaregiverCount =
                      roster.caregiverCountByPlayer[entry.userId] ?? 0;

                    // streamlined-invites-and-child-access, Decision 1 — this
                    // viewer sees Accept/Deny on a pending row only when
                    // they're the linked caregiver being asked to decide
                    // (or, once linked at registration time, ANY caregiver
                    // linked to this child — matching respond-junior-
                    // approval's own authorization rule).
                    const canRespondToRequest =
                      !!entry.pending &&
                      !!entry.pendingApprovalId &&
                      roster.myLinkedChildIds.has(entry.userId);

                    // 2026-08-29 — see handleRespondToJunior's own comment.
                    // A DOB already on file means the caregiver already
                    // confirmed it once, at registration; only the one
                    // existing-caregiver-bypass path can reach here with no
                    // DOB recorded anywhere, and that's the only case that
                    // still needs editable fields.
                    const detailsAlreadyConfirmed = !!entry.pendingChildDetails?.dateOfBirth;

                    // 2026-08-30, Task 12 item 4 follow-up — only the
                    // viewer's OWN row can ever offer this; `roster.
                    // canSelfRemoveCaregiver` is already resolved for the
                    // current viewer specifically, never any other row.
                    const isOwnRow = entry.userId === user?.id;

                    // V1.R Part 1 — shared by Remove/Demote/Make Coach/Stop
                    // being Coach below: does the current viewer have team-
                    // wide edit authority (club Admin, or Coach/Manager/
                    // is_coach on THIS team)? `roster.currentUserRoles`
                    // already folds `is_coach` in as a synthetic 'coach'
                    // entry (see `fetchRoster`'s comment on that field).
                    const hasEditAuthority =
                      isClubAdmin ||
                      roster.currentUserRoles.includes('coach') ||
                      roster.currentUserRoles.includes('manager');

                    // `team_members` is UNIQUE(team_id, user_id) — at most
                    // one real membership row per user on this team (a
                    // second 'coach' role in `entry.roles` is only ever the
                    // synthetic is_coach one from `fetchRoster`).
                    const membership = (roster.membershipsByUser[entry.userId] ?? [])[0];

                    const canDemoteThisMembership =
                      !!membership &&
                      (membership.role === 'manager' || membership.role === 'coach') &&
                      canDemoteFromManager({
                        isOwnRow,
                        hasEditAuthority,
                        isFirstManager: membership.id === roster.firstManagerMembershipId,
                        teamType: roster.teamType,
                      });

                    const canMakeCoachThisMembership =
                      capabilities.canChangeRole &&
                      !!membership &&
                      membership.role !== 'coach' &&
                      !membership.is_coach;

                    const canStopBeingCoachThisMembership =
                      !!membership &&
                      membership.is_coach &&
                      canRemoveCoachFlag({ isOwnRow, hasEditAuthority, teamType: roster.teamType });

                    // gant-ai-feedback-assistant, Requirement 1.1/1.2: any
                    // player row (not coach/manager rows — Progress Notes
                    // are about players) can be opened for its Progress
                    // Notes, once it's a real, active membership (not a
                    // pending consent row). Write access inside that screen
                    // (Req 6.2) is narrower than general team-edit
                    // authority — coach/admin only, NOT a plain Manager —
                    // `currentUserRoles` already folds `is_coach` in as a
                    // synthetic 'coach' entry (see `fetchRoster`'s comment),
                    // so this correctly includes a coach-authority Manager
                    // without including an ordinary one.
                    const canOpenGantDetail = !entry.pending && entry.roles.includes('player');
                    const canAddGantNote = isClubAdmin || roster.currentUserRoles.includes('coach');

                    return (
                      <RosterRow
                        key={entry.userId}
                        entry={entry}
                        canOpenGantDetail={canOpenGantDetail}
                        onOpenGantDetail={() =>
                          setGantDetailFor({ playerId: entry.userId, playerName: entry.displayName })
                        }
                        capabilities={capabilities}
                        canRespondToRequest={canRespondToRequest}
                        canRemoveOwnCaregiver={isOwnRow && roster.canSelfRemoveCaregiver}
                        onRemoveOwnCaregiver={() => setShowRemoveMyCaregiver(true)}
                        detailsAlreadyConfirmed={detailsAlreadyConfirmed}
                        respondEdit={
                          entry.pendingApprovalId
                            ? respondEdits[entry.pendingApprovalId]
                            : undefined
                        }
                        respondErrors={
                          (entry.pendingApprovalId && respondErrors[entry.pendingApprovalId]) ||
                          {}
                        }
                        respondingThis={
                          !!entry.pendingApprovalId &&
                          respondingApprovalId === entry.pendingApprovalId
                        }
                        onUpdateRespondEdit={(field, value) =>
                          entry.pendingApprovalId &&
                          updateRespondEdit(entry.pendingApprovalId, field, value)
                        }
                        onRespond={(decision) => handleRespondToJunior(entry, decision)}
                        removableMemberships={(roster.membershipsByUser[entry.userId] ?? []).map(
                          (row) => ({
                            id: row.id,
                            role: row.role,
                            canRemove: canRemoveTeamMember({
                              isOwnRow,
                              hasEditAuthority,
                              isFirstManager: row.id === roster.firstManagerMembershipId,
                              teamType: roster.teamType,
                            }),
                          })
                        )}
                        onRemove={(membershipId, role) =>
                          handleOpenRemove(membershipId, role, entry, isOwnRow)
                        }
                        onPromote={() => handlePromoteToManager(entry)}
                        canPromoteThisMember={
                          !!roster.playerMembershipIdByUser[entry.userId] &&
                          entry.roles.includes('player') &&
                          !entry.roles.includes('manager')
                        }
                        canDemoteThisMember={canDemoteThisMembership}
                        onDemote={() => membership && handleDemoteToPlayer(entry, membership.id)}
                        canMakeCoachThisMember={canMakeCoachThisMembership}
                        onMakeCoach={() => membership && handleMakeCoach(entry, membership.id)}
                        canStopBeingCoachThisMember={canStopBeingCoachThisMembership}
                        onStopBeingCoach={() => membership && handleStopBeingCoach(entry, membership.id)}
                        canIssueDeviceAccess={canIssueDeviceAccess({
                          isClubAdmin,
                          teamRoles: roster.currentUserRoles,
                          teamType: roster.teamType,
                          isLinkedCaregiver: roster.myLinkedChildIds.has(entry.userId),
                        })}
                        issuingDeviceAccess={issuingDeviceAccessFor === entry.userId}
                        onIssueDeviceAccess={() => handleIssueDeviceAccess(entry)}
                        canAddCaregiver={
                          isChildBandPlayerRow &&
                          canAddCaregiver({
                            isClubAdmin,
                            teamRoles: roster.currentUserRoles,
                            teamType: roster.teamType,
                            existingCaregiverCount,
                          })
                        }
                        onAddCaregiver={() => setAddCaregiverFor(entry)}
                        canManageCaregivers={isChildBandPlayerRow && isClubAdmin}
                        caregiverManagement={
                          caregiverManagement[entry.userId] ?? COLLAPSED_CAREGIVER_MANAGEMENT
                        }
                        onToggleManageCaregivers={() => handleToggleManageCaregivers(entry.userId)}
                        onRemoveCaregiver={(caregiverId) =>
                          handleRemoveCaregiver(entry.userId, caregiverId)
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add Player modal — only reachable when canAddUser is true (Req 1.1) */}
      {selection.selectedTeamId && (
        <AddPlayerModal
          isOpen={showAddPlayer}
          onClose={() => setShowAddPlayer(false)}
          onSuccess={(outcome: AddPlayerOutcome) => {
            setActionMessage(addPlayerSuccessMessage(outcome));
            refreshRoster();
          }}
          teamId={selection.selectedTeamId}
          teamLabel={selectedOption?.label ?? 'this team'}
        />
      )}

      {/* Add Caregiver modal (Requirement 7.5, Task 9) — only reachable via
          a row's own "Add Caregiver" button, itself gated by canAddCaregiver
          above; the actual write is re-checked at the data layer regardless. */}
      {selection.selectedTeamId && addCaregiverFor && (
        <AddCaregiverModal
          teamId={selection.selectedTeamId}
          childId={addCaregiverFor.userId}
          childName={addCaregiverFor.displayName}
          onClose={() => setAddCaregiverFor(null)}
          onSuccess={(outcome) => handleAddCaregiverSuccess(addCaregiverFor.displayName, outcome)}
        />
      )}

      {/* 2026-08-30, Task 12 item 4 follow-up — reachable only via the
          viewer's own row's "Remove My Caregiver" button, itself gated by
          `roster.canSelfRemoveCaregiver` above; the actual delete is
          re-checked at the data layer regardless (migration 062). */}
      {showRemoveMyCaregiver && user?.id && roster && (
        <RemoveMyCaregiverModal
          playerId={user.id}
          caregivers={roster.ownCaregivers}
          onClose={() => setShowRemoveMyCaregiver(false)}
          onSuccess={() => {
            setActionMessage('Your caregiver has been removed.');
            refreshRoster();
          }}
        />
      )}

      {/* 2026-08-31 — the roster page's new "Remove" action, reachable only
          via a row's own Remove control, itself gated by `canRemoveTeamMember`
          above; the actual delete is re-checked at the data layer regardless
          (`remove-team-member` Edge Function). */}
      {removeTarget && (
        <RemoveTeamMemberModal
          membershipId={removeTarget.membershipId}
          memberName={removeTarget.memberName}
          roleLabel={removeTarget.roleLabel}
          isOwnRow={removeTarget.isOwnRow}
          onClose={() => setRemoveTarget(null)}
          onSuccess={(cascadedCaregiverRemoval) =>
            handleRemoveSuccess(removeTarget.memberName, removeTarget.roleLabel, cascadedCaregiverRemoval)
          }
        />
      )}

      {/* gant-ai-feedback-assistant, Task 6 — the person-detail Progress
          Notes screen, reachable via any real player row's tap target
          (`canOpenGantDetail`, resolved per-row in the roster map above). */}
      {gantDetailFor && selectedOption && (
        <GantPersonDetailModal
          playerId={gantDetailFor.playerId}
          playerName={gantDetailFor.playerName}
          teamId={selection.selectedTeamId!}
          teamName={selectedOption.label}
          canAddNote={isClubAdmin || (roster?.currentUserRoles.includes('coach') ?? false)}
          onClose={() => setGantDetailFor(null)}
        />
      )}
    </div>
  );
}

// ---- Roster row -------------------------------------------------------------

const ROLE_LABELS: Record<TeamRole, string> = {
  coach: 'Coach',
  manager: 'Manager',
  player: 'Player',
};

interface RosterRowProps {
  entry: RosterEntry;
  capabilities: ActionCapabilities;
  canPromoteThisMember: boolean;
  /**
   * 2026-08-31 — every `team_members` row this entry holds on this team,
   * each pre-resolved to whether the current viewer may Remove it
   * (`canRemoveTeamMember`, already evaluated by the parent). Replaces
   * `onDeactivate`/`onReactivate` here entirely — see `permissions-logic
   * .ts`'s `canRemoveTeamMember` doc comment for why.
   */
  removableMemberships: Array<{ id: string; role: TeamRole; canRemove: boolean }>;
  onRemove: (membershipId: string, role: TeamRole) => void;
  onPromote: () => void;
  /** V1.R Part 1, item B — see `canDemoteFromManager` (`permissions-logic.ts`)
   *  for the full rule; already resolved by the parent before this prop. */
  canDemoteThisMember: boolean;
  onDemote: () => void;
  /** V1.R Part 1, item C — "Make Coach": true only when this member's `role`
   *  isn't already 'coach' and `is_coach` isn't already set, and the viewer
   *  has team edit authority (same gate as Make Manager). */
  canMakeCoachThisMember: boolean;
  onMakeCoach: () => void;
  /** V1.R Part 1, item C's inverse — see `canRemoveCoachFlag`
   *  (`permissions-logic.ts`) for the full rule. */
  canStopBeingCoachThisMember: boolean;
  onStopBeingCoach: () => void;
  /** Requirement 7.4.1 — true when the current viewer is a linked caregiver
   *  of this row's child, regardless of any team-level capability. */
  canIssueDeviceAccess: boolean;
  issuingDeviceAccess: boolean;
  onIssueDeviceAccess: () => void;
  /** Requirement 7.5 (Task 9) — see `canAddCaregiver` (`permissions-logic.ts`)
   *  for the exact rule; already resolved by the parent before this prop. */
  canAddCaregiver: boolean;
  onAddCaregiver: () => void;
  /** Requirement 7.5 (Task 9) — only ever true for an admin on a child-band
   *  player row; unlike `canAddCaregiver`, a Coach/Manager never sees this,
   *  since removal (`player_caregivers` DELETE) is admin-only at the data
   *  layer regardless (migrations 002/036) — no point offering it otherwise. */
  canManageCaregivers: boolean;
  caregiverManagement: CaregiverManagementState;
  onToggleManageCaregivers: () => void;
  onRemoveCaregiver: (caregiverId: string) => void;
  /** 2026-08-30, Task 12 item 4 follow-up — true only on the viewer's OWN
   *  row, once their own age band is 'adult' (16+) and they have at least
   *  one caregiver linked. See `roster-logic.ts`'s `canSelfRemoveCaregiver`. */
  canRemoveOwnCaregiver: boolean;
  onRemoveOwnCaregiver: () => void;
  /** gant-ai-feedback-assistant, Requirement 1.1: true for any real (not
   *  pending) player row — opens that player's Progress Notes. */
  canOpenGantDetail: boolean;
  onOpenGantDetail: () => void;
  /** streamlined-invites-and-child-access, Decision 1 — see the call site's
   *  own comment for exactly who this is true for. */
  canRespondToRequest: boolean;
  /** 2026-08-29 — true when the child's DOB is already on file (confirmed
   *  once already at registration), so Accept/Deny render with no editable
   *  fields at all. False only for the one path that never collects a DOB
   *  anywhere else (an existing-caregiver-account bypass onto a brand-new
   *  pending child) — see `handleRespondToJunior`'s own comment. */
  detailsAlreadyConfirmed: boolean;
  respondEdit: ChildEdit | undefined;
  respondErrors: ChildEditErrors;
  respondingThis: boolean;
  onUpdateRespondEdit: (field: keyof ChildEdit, value: string) => void;
  onRespond: (decision: 'approve' | 'deny') => void;
}

function RosterRow({
  entry,
  capabilities,
  canPromoteThisMember,
  removableMemberships,
  onRemove,
  onPromote,
  canDemoteThisMember,
  onDemote,
  canMakeCoachThisMember,
  onMakeCoach,
  canStopBeingCoachThisMember,
  onStopBeingCoach,
  canIssueDeviceAccess,
  issuingDeviceAccess,
  onIssueDeviceAccess,
  canAddCaregiver,
  onAddCaregiver,
  canManageCaregivers,
  caregiverManagement,
  onToggleManageCaregivers,
  onRemoveCaregiver,
  canRemoveOwnCaregiver,
  onRemoveOwnCaregiver,
  canOpenGantDetail,
  onOpenGantDetail,
  canRespondToRequest,
  detailsAlreadyConfirmed,
  respondEdit,
  respondErrors,
  respondingThis,
  onUpdateRespondEdit,
  onRespond,
}: RosterRowProps) {
  // Inactive OR pending members are greyed (Req 3.6, 5.10).
  const greyed = !entry.active || entry.pending;
  // Pending children are non-selectable — no actions exposed (Req 5.10).
  const actionsAllowed = !entry.pending;

  return (
    <div className={`px-4 py-3 ${greyed ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        {/* gant-ai-feedback-assistant, Requirement 1.1: tapping a player row
            opens their Progress Notes — the single entry point, no separate
            dedicated page with its own pickers. Not a <button> wrapping the
            whole row, since the row's own action buttons (Make Manager,
            Remove, etc.) need independent click targets — the name/contact
            block itself is the tap target instead. */}
        <div
          className={`min-w-0 ${canOpenGantDetail ? 'cursor-pointer' : ''}`}
          onClick={canOpenGantDetail ? onOpenGantDetail : undefined}
          role={canOpenGantDetail ? 'button' : undefined}
          tabIndex={canOpenGantDetail ? 0 : undefined}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-gray-900 truncate">{entry.displayName}</p>
            {entry.roles.map((role) => (
              <span
                key={role}
                className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-700"
              >
                {ROLE_LABELS[role]}
              </span>
            ))}
            {entry.pending && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-800">
                Pending consent
              </span>
            )}
            {!entry.active && !entry.pending && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-200 text-gray-600">
                Inactive
              </span>
            )}
          </div>
          <ContactLine contact={entry.contact} />
        </div>

        {/* Action controls — gated by capability + member selectability */}
        {actionsAllowed && (
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {capabilities.canChangeRole && canPromoteThisMember && (
              <button
                onClick={onPromote}
                disabled={!capabilities.canPromoteToManager}
                title={
                  capabilities.canPromoteToManager
                    ? undefined
                    : 'This team already has the maximum of two Managers.'
                }
                className="text-xs px-2.5 py-1 rounded-md bg-[#0091f3] text-white disabled:opacity-40"
              >
                Make Manager
              </button>
            )}
            {/* V1.R Part 1, item C — additive Coach authority alongside this
                member's real `role` (e.g. a Manager who also coaches). Never
                shown for a `role: 'coach'` row, since that already has full
                Coach authority — nothing for this toggle to add there. */}
            {canMakeCoachThisMember && (
              <button
                onClick={onMakeCoach}
                className="text-xs px-2.5 py-1 rounded-md bg-[#0091f3] text-white"
              >
                Make Coach
              </button>
            )}
            {/* V1.R Part 1, item B — demotes this member's `role` back to
                Player. Gating (`canDemoteFromManager`) already mirrors
                Remove's own self-or-edit-authority + first-Manager rule. */}
            {canDemoteThisMember && (
              <button
                onClick={onDemote}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Demote to Player
              </button>
            )}
            {/* V1.R Part 1, item C's inverse — turns off `is_coach` without
                touching `role`. Only ever shown when `is_coach` is actually
                set, so a plain `role: 'coach'` member (no `is_coach`) never
                sees this — there is nothing additive to remove. */}
            {canStopBeingCoachThisMember && (
              <button
                onClick={onStopBeingCoach}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Stop being Coach
              </button>
            )}
            {/* 2026-08-31 — one Remove control per role this person holds on
                this team (usually just one). Each is independently gated by
                `canRemoveTeamMember`, already resolved by the parent — a
                row with two roles (e.g. Coach + Player) can show Remove for
                one and not the other (the first-Manager protection applies
                per membership row, not per person). */}
            {removableMemberships
              .filter((membership) => membership.canRemove)
              .map((membership) => (
                <button
                  key={membership.id}
                  onClick={() => onRemove(membership.id, membership.role)}
                  className="text-xs px-2.5 py-1 rounded-md border border-red-300 text-red-700 hover:bg-red-50"
                >
                  {removableMemberships.length > 1
                    ? `Remove as ${ROLE_LABELS[membership.role]}`
                    : 'Remove'}
                </button>
              ))}
            {/* Requirement 7.4.1 — a linked caregiver's own right over their
                child's record, independent of any team-level capability
                above (a caregiver need not be a Coach/Manager/Admin to see
                this on their own child's row). */}
            {canIssueDeviceAccess && (
              <button
                onClick={onIssueDeviceAccess}
                disabled={issuingDeviceAccess}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                {/* 2026-08-31 — "Issue Device Access" tested as too technical
                    ("token"/"device" language isn't how a caregiver thinks
                    about this). Deliberately not "Give your child app
                    access" — this button is also reachable by a Coach,
                    Manager, or Admin (2026-08-31's canIssueDeviceAccess
                    fix), for whom the player on this row isn't "their
                    child". */}
                {issuingDeviceAccess ? 'Setting up...' : 'Give App Access'}
              </button>
            )}
            {/* Requirement 7.5 (Task 9) — visibility already resolved by the
                parent via `canAddCaregiver`; a non-admin Coach/Manager only
                ever sees this for a child with zero caregivers today. */}
            {canAddCaregiver && (
              <button
                onClick={onAddCaregiver}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Add Caregiver
              </button>
            )}
            {canManageCaregivers && (
              <button
                onClick={onToggleManageCaregivers}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                {caregiverManagement.expanded ? 'Hide Caregivers' : 'Manage Caregivers'}
              </button>
            )}
            {/* 2026-08-30, Task 12 item 4 follow-up — a player's own
                self-service right over their own record, independent of
                any team-level capability above; only ever true on the
                viewer's own row (see `canRemoveOwnCaregiver`'s doc comment
                on `RosterRowProps`). */}
            {canRemoveOwnCaregiver && (
              <button
                onClick={onRemoveOwnCaregiver}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Remove My Caregiver
              </button>
            )}
          </div>
        )}
      </div>

      {/* streamlined-invites-and-child-access, Decision 1 — the linked
          caregiver's own Accept/Deny for THIS pending child, right on the
          roster row instead of a separate Approvals page/tab. Deliberately
          rendered outside the `actionsAllowed` gate above (Req 5.10 still
          hides every OTHER action on a pending row — Make Manager,
          Deactivate, etc. — from everyone, including this caregiver). */}
      {entry.pending && canRespondToRequest && (
        <div className="mt-2 pt-2 border-t border-amber-100 space-y-2">
          {detailsAlreadyConfirmed ? (
            // 2026-08-29 — the common case: this child registered through
            // the normal Child happy path, so their name and DOB were
            // already confirmed once, via the checkbox on the registration
            // form itself. Re-showing editable fields here to re-confirm
            // the exact same thing was pure friction — just show what's on
            // file and let Accept/Deny go straight through.
            <p className="text-xs text-gray-500">
              {entry.displayName} ({formatDob(entry.pendingChildDetails?.dateOfBirth)}) is
              waiting for your consent to join the team.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                You've been listed as a caregiver for {entry.displayName} joining the team.
                Confirm their details below and Accept to add them to the roster.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">First name</label>
                  <input
                    type="text"
                    value={respondEdit?.firstName ?? ''}
                    onChange={(e) => onUpdateRespondEdit('firstName', e.target.value)}
                    className={`w-full border rounded-md px-2 py-1.5 text-sm ${
                      respondErrors.firstName ? 'border-red-500 bg-red-50' : 'border-gray-300'
                    }`}
                  />
                  {respondErrors.firstName && (
                    <p className="mt-0.5 text-[10px] text-red-600">{respondErrors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Last name</label>
                  <input
                    type="text"
                    value={respondEdit?.lastName ?? ''}
                    onChange={(e) => onUpdateRespondEdit('lastName', e.target.value)}
                    className={`w-full border rounded-md px-2 py-1.5 text-sm ${
                      respondErrors.lastName ? 'border-red-500 bg-red-50' : 'border-gray-300'
                    }`}
                  />
                  {respondErrors.lastName && (
                    <p className="mt-0.5 text-[10px] text-red-600">{respondErrors.lastName}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-0.5">Date of birth</label>
                <input
                  type="date"
                  value={respondEdit?.dateOfBirth ?? ''}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => onUpdateRespondEdit('dateOfBirth', e.target.value)}
                  className={`w-full border rounded-md px-2 py-1.5 text-sm ${
                    respondErrors.dateOfBirth ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                />
                {respondErrors.dateOfBirth && (
                  <p className="mt-0.5 text-[10px] text-red-600">{respondErrors.dateOfBirth}</p>
                )}
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onRespond('approve')}
              disabled={respondingThis}
              className="flex-1 py-1.5 bg-green-600 text-white rounded-md text-xs font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {respondingThis ? '...' : 'Accept'}
            </button>
            <button
              onClick={() => onRespond('deny')}
              disabled={respondingThis}
              className="flex-1 py-1.5 bg-red-100 text-red-700 rounded-md text-xs font-medium hover:bg-red-200 disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Requirement 7.5 (Task 9) — admin-only expandable caregiver list.
          Removing one fires migration 056's trigger (an admin_action_items
          notification) regardless of who removes it — never an immediate
          device-access revocation, which stays a separate, explicit admin
          decision (the new admin screen). */}
      {canManageCaregivers && caregiverManagement.expanded && (
        <div className="mt-2 ml-0 pl-3 border-l-2 border-gray-100 space-y-1.5">
          {caregiverManagement.loading && (
            <p className="text-xs text-gray-400">Loading caregivers...</p>
          )}
          {caregiverManagement.error && (
            <p className="text-xs text-red-600">{caregiverManagement.error}</p>
          )}
          {caregiverManagement.caregivers?.length === 0 && (
            <p className="text-xs text-gray-400">No caregivers linked.</p>
          )}
          {caregiverManagement.caregivers?.map((caregiver) => (
            <div key={caregiver.id} className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-600 truncate">
                {caregiver.name}
                {caregiver.email ? ` · ${caregiver.email}` : ''}
              </p>
              <button
                onClick={() => onRemoveCaregiver(caregiver.id)}
                disabled={caregiverManagement.removingId === caregiver.id}
                className="text-xs text-red-600 hover:underline disabled:opacity-40 flex-shrink-0"
              >
                {caregiverManagement.removingId === caregiver.id ? 'Removing...' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactLine({ contact }: { contact: ContactDisplay }) {
  if (contact.kind === 'self') {
    return <p className="text-sm text-gray-500 mt-0.5">{contact.cellphone}</p>;
  }
  if (contact.kind === 'caregiver') {
    return (
      <p className="text-sm text-gray-500 mt-0.5">
        {contact.name} · {contact.cellphone}
        <span className="text-gray-400"> (caregiver)</span>
      </p>
    );
  }
  // Missing caregiver contact (Req 3.11).
  return (
    <p className="text-sm text-amber-600 mt-0.5">Caregiver contact details missing</p>
  );
}

// ---- Roster fetch (reads team_members, the source of truth — Req 3.10) ------

/**
 * Fetch and assemble the roster for a team: its members (with all roles merged
 * per user), the age-band-appropriate contact for each, any pending children
 * awaiting consent (Req 5.10), and the metadata needed for capability checks.
 *
 * Age band (`.kiro/specs/add-player-and-dob-age-model/` Requirement 2.1-2.5):
 * each roster row's band now prefers that PERSON's own `date_of_birth`,
 * falling back to the team's `age_group` only where they have none recorded
 * — so one roster can legitimately mix DOB-derived and age_group-derived
 * bands person by person (Req 2.5). `deriveAgeBand(team.age_group)` is kept
 * only as that fallback and as a team-level summary on the returned
 * `RosterData` (unused by this component's own render today).
 *
 * `date_of_birth` itself (Requirement 4.2 — visible only to that team's
 * Coach/Manager/Admin) never appears on `RosterMember`/`RosterEntry`: it is
 * read here only to compute the (non-sensitive) age band, then discarded —
 * the same way `team.age_group`-derived classification was never itself
 * treated as sensitive. No UI in this feature renders a raw date of birth;
 * if a future feature (e.g. birthday reminders, Req 2.6) needs to actually
 * display one, that display — not this fetch — is where real caller-role
 * gating belongs, since `users` RLS (migration 004) permits any
 * authenticated read and cannot enforce it at the column level.
 */
async function fetchRoster(teamId: string, currentUserId: string): Promise<RosterData> {
  // Team classification + age group drive editability and the fallback band.
  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('id, age_group, team_type')
    .eq('id', teamId)
    .single();
  if (teamError || !team) throw new Error(teamError?.message || 'Team not found');

  const teamAgeGroup = team.age_group as string;
  const ageBand = deriveAgeBand(teamAgeGroup); // team-level summary only — see doc comment above
  const teamType = (team.team_type as TeamType) ?? 'club_tournament';

  // Members (source of truth). Includes active + inactive.
  const memberRows = await rolesApi.getTeamMembers(teamId);
  const ageBandFor = (dateOfBirth: string | null | undefined) =>
    deriveAgeBandForPerson(dateOfBirth, teamAgeGroup);

  // Pending children awaiting caregiver consent are not yet team_members, so
  // they're read from their pending add-child approval records (Req 5.10).
  const { data: pendingApprovals, error: pendingError } = await supabase
    .from('caregiver_approvals')
    .select('id, player_id')
    .eq('team_id', teamId)
    .eq('request_kind', 'add_child')
    .eq('status', 'pending');
  if (pendingError) throw new Error(pendingError.message);

  const pendingChildIds = (pendingApprovals ?? []).map(
    (row: { player_id: string }) => row.player_id
  );

  // streamlined-invites-and-child-access, Decision 1 — the approval row id
  // each pending child's roster row needs to drive its own inline Accept/
  // Deny (`respond-junior-approval` is keyed on `approval_id`, not
  // `player_id`). A child could in principle have more than one pending
  // `add_child` row; last-one-wins here is fine in practice since only one
  // is ever created per child by the current Add Player flow.
  const approvalIdByChildId: Record<string, string> = {};
  for (const row of (pendingApprovals ?? []) as Array<{ id: string; player_id: string }>) {
    approvalIdByChildId[row.player_id] = row.id;
  }

  // Resolve pending child user rows (name, active flag, and their own DOB if
  // Add Player's Junior path recorded one — Req 4.1).
  let pendingChildren: Array<{
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
  }> = [];
  if (pendingChildIds.length > 0) {
    const { data: childUsers, error: childError } = await supabase
      .from('users')
      .select('id, first_name, last_name, date_of_birth')
      .in('id', pendingChildIds);
    if (childError) throw new Error(childError.message);
    pendingChildren = childUsers ?? [];
  }

  // Resolve every player's caregiver links so the contact of record can be
  // chosen (primary, else most recently linked) — per person now (Req 2.5),
  // not gated on a single team-wide band.
  const childCandidateIds = new Set<string>(pendingChildIds);
  for (const row of memberRows) {
    if (row.role === 'player' && ageBandFor(row.user?.date_of_birth) === 'child') {
      childCandidateIds.add(row.user_id);
    }
  }

  const caregiverLinksByPlayer = await fetchCaregiverLinks(Array.from(childCandidateIds));

  // Build the pre-merge roster rows from memberships. V1.R Part 1 (item C,
  // migration 064): a row with `is_coach = true` also synthesizes a SECOND
  // RosterMember with role 'coach' for the SAME user — `mergeRoles`
  // (roster-logic.ts) already handles a user appearing in more than one row
  // and unions them into one `RosterEntry.roles` array with no changes
  // needed there, so a Manager with is_coach=true displays as both
  // "Manager" and "Coach" badges, sorted Coach-first (Req 3.4's existing
  // ROLE_RANK).
  const members: RosterMember[] = memberRows.flatMap((row) => {
    const base: RosterMember = {
      userId: row.user_id,
      displayName: displayName(row),
      role: row.role,
      active: row.user?.active ?? true,
      ageBand: ageBandFor(row.user?.date_of_birth),
      contact: contactFor(
        ageBandFor(row.user?.date_of_birth),
        row.role,
        row.user?.cellphone ?? '',
        caregiverLinksByPlayer[row.user_id]
      ),
      pending: false,
    };
    if (row.is_coach && row.role !== 'coach') {
      return [base, { ...base, role: 'coach' as TeamRole }];
    }
    return [base];
  });

  // Append pending children (players, inactive, non-selectable — Req 5.10).
  for (const child of pendingChildren) {
    // Skip if the child already appears as a member (defensive).
    if (members.some((m) => m.userId === child.id)) continue;
    members.push({
      userId: child.id,
      displayName: `${child.first_name} ${child.last_name}`.trim(),
      role: 'player',
      active: false,
      ageBand: ageBandFor(child.date_of_birth),
      contact:
        ageBandFor(child.date_of_birth) === 'child'
          ? selectCaregiverContact(caregiverLinksByPlayer[child.id] ?? [])
          : { kind: 'self', cellphone: '' },
      pending: true,
      pendingApprovalId: approvalIdByChildId[child.id],
      pendingChildDetails: {
        firstName: child.first_name,
        lastName: child.last_name,
        dateOfBirth: child.date_of_birth ?? '',
      },
    });
  }

  const entries = groupAndSortRoster(members);

  // Manager count for the cap (Req 4.8/4.9) — distinct users holding manager.
  const managerCount = new Set(
    memberRows.filter((r) => r.role === 'manager').map((r) => r.user_id)
  ).size;

  // Roles the current user holds on this team (capability resolution, Req
  // 4.1). V1.R Part 1, item C: `is_coach = true` folds in a synthetic
  // 'coach' entry too, so every existing `currentUserRoles.includes('coach')`
  // check elsewhere on this page (hasEditAuthority for Remove/Demote/Stop-
  // being-Coach, `canAddCaregiver`, `canIssueDeviceAccess`,
  // `resolveCapabilities`) automatically recognises an is_coach holder as
  // having Coach-level edit authority with no changes needed at those call
  // sites.
  const currentUserRoles = memberRows
    .filter((r) => r.user_id === currentUserId)
    .flatMap((r) =>
      r.is_coach && r.role !== 'coach'
        ? [r.role as PermissionRole, 'coach' as PermissionRole]
        : [r.role as PermissionRole]
    );

  // Map each user's player membership id so promotion targets the right row.
  const playerMembershipIdByUser: Record<string, string> = {};
  for (const row of memberRows) {
    if (row.role === 'player') playerMembershipIdByUser[row.user_id] = row.id;
  }

  // 2026-08-31 — every membership row (id + role) each user holds on this
  // team, for the new "Remove" action (see the RosterData field's own doc
  // comment for why this needs to be per-role, not just per-user). Extended
  // 2026-09-01 (V1.R Part 1, item C) to also carry `is_coach`, so the roster
  // row can offer "Make Coach" / "Stop being Coach" alongside Remove.
  const membershipsByUser: Record<string, Array<{ id: string; role: TeamRole; is_coach: boolean }>> = {};
  for (const row of memberRows) {
    (membershipsByUser[row.user_id] ??= []).push({
      id: row.id,
      role: row.role,
      is_coach: row.is_coach,
    });
  }

  // First Manager (earliest `role = 'manager'` row, by `created_at`) — the
  // one membership the new Remove action protects from anyone but
  // themselves. `getTeamMembers` doesn't guarantee `created_at` ordering
  // (it orders by `role`), so this sorts explicitly rather than assuming
  // the fetch order already reflects it.
  const managerRowsByCreatedAt = memberRows
    .filter((row) => row.role === 'manager')
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const firstManagerMembershipId = managerRowsByCreatedAt[0]?.id ?? null;

  // Requirement 7.4.1 — independent of this team's roster data: which
  // children (on any team) is the current viewer a linked caregiver for.
  // Best-effort: a lookup failure here should never break loading the
  // roster itself, so it degrades to "show the button for nobody" rather
  // than failing the whole page.
  let myLinkedChildIds = new Set<string>();
  try {
    const myLinks = await caregiversApi.getCaregiverPlayers(currentUserId);
    myLinkedChildIds = new Set(myLinks.map((link) => link.player_id));
  } catch (err) {
    console.error('Could not load linked-caregiver children:', err);
  }

  // Requirement 7.5 (Task 9) — caregiver count per child, derived from the
  // same `caregiverLinksByPlayer` lookup already fetched above for contact
  // display. Only a count is kept here (not the links themselves) — this
  // just drives whether "Add Caregiver" shows, not who the caregivers are.
  const caregiverCountByPlayer: Record<string, number> = {};
  for (const childId of childCandidateIds) {
    caregiverCountByPlayer[childId] = (caregiverLinksByPlayer[childId] ?? []).length;
  }

  // 2026-08-30, Task 12 item 4 follow-up — the viewer's OWN caregiver
  // link(s), regardless of `childCandidateIds` above (which only ever
  // includes 'child'-band rows): the viewer might themselves be an
  // 'adult'-band player who still has a caregiver linked — exactly the
  // Section 6.2 scenario this follow-up addresses. Best-effort, same
  // reasoning as `myLinkedChildIds` above — a lookup failure here should
  // never break loading the roster; it just means the self-service button
  // doesn't show for this load.
  let ownCaregivers: Array<{ id: string; name: string }> = [];
  try {
    const ownLinks = await caregiversApi.getPlayerCaregivers(currentUserId);
    ownCaregivers = ownLinks.map((link) => ({
      id: link.caregiver_id,
      name: `${link.caregiver?.first_name ?? ''} ${link.caregiver?.last_name ?? ''}`.trim(),
    }));
  } catch (err) {
    console.error('Could not load own caregiver links:', err);
  }

  const selfMemberRow = memberRows.find((row) => row.user_id === currentUserId);
  const ownAgeBand = ageBandFor(selfMemberRow?.user?.date_of_birth);

  return {
    entries,
    ageBand,
    teamType,
    managerCount,
    currentUserRoles,
    playerMembershipIdByUser,
    membershipsByUser,
    firstManagerMembershipId,
    myLinkedChildIds,
    caregiverCountByPlayer,
    canSelfRemoveCaregiver: canSelfRemoveCaregiver(ownAgeBand, ownCaregivers.length),
    ownCaregivers,
  };
}

/** Group `player_caregivers` (with caregiver details) by player id. */
async function fetchCaregiverLinks(
  playerIds: string[]
): Promise<Record<string, CaregiverLink[]>> {
  const byPlayer: Record<string, CaregiverLink[]> = {};
  if (playerIds.length === 0) return byPlayer;

  const { data, error } = await supabase
    .from('player_caregivers')
    .select(
      'player_id, created_at, caregiver:users!player_caregivers_caregiver_id_fkey(first_name, last_name, cellphone)'
    )
    .in('player_id', playerIds);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as any[]) {
    const caregiver = row.caregiver;
    if (!caregiver) continue;
    const link: CaregiverLink = {
      name: `${caregiver.first_name ?? ''} ${caregiver.last_name ?? ''}`.trim(),
      cellphone: caregiver.cellphone ?? '',
      isPrimary: false, // no primary flag exists yet; ties break on linkedAt
      linkedAt: row.created_at ?? '',
    };
    (byPlayer[row.player_id] ??= []).push(link);
  }

  return byPlayer;
}

/** Feedback text for the roster page's action banner after Add Player succeeds. */
function addPlayerSuccessMessage(outcome: AddPlayerOutcome): string {
  if (outcome.route === 'adult') {
    // 2026-08-31 — Requirement 2.4's existing-user bypass: this email
    // already had an account, so they were added directly with no invite
    // sent at all (see AddPlayerModal's adult-route comment).
    if (outcome.existingAccount) {
      return 'They already had an account — added to the team directly, no invite needed.';
    }
    return outcome.emailFailed
      ? "Adult invite created, but the invite email couldn't be sent — let them know directly."
      : 'Adult self-registration invite sent.';
  }
  return outcome.caregiverInvited
    ? 'Caregiver invited to create an account and confirm.'
    : 'Add-player request sent to the caregiver for approval.';
}

function displayName(row: TeamMemberWithUser): string {
  const first = row.user?.first_name ?? '';
  const last = row.user?.last_name ?? '';
  const name = `${first} ${last}`.trim();
  return name || 'Unknown member';
}

// contactFor moved to roster-logic.ts (streamlined-invites-and-child-access,
// Task 8) so it can be unit-tested — see that file for the full docstring,
// including the documentation correction it prompted.
