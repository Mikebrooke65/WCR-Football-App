import { ApiClient, ApiError } from './api-client';
import type { Team, TeamMemberWithTeam } from '../types/database';

export class TeamsApi extends ApiClient {
  // Get a single team by ID
  async getTeam(teamId: string): Promise<Team> {
    return this.queryOne<Team>('teams', teamId);
  }

  // Update team game configuration (game_players and half_duration)
  async updateTeamConfig(
    teamId: string,
    gamePlayers: number,
    halfDuration: number
  ): Promise<Team> {
    return this.update<Team>('teams', teamId, {
      game_players: gamePlayers,
      half_duration: halfDuration,
    });
  }

  // Count of DISTINCT teams the given user belongs to, read from team_members
  // (the roster source of truth) rather than a club-wide `teams` count that RLS
  // reduces to zero for player-role users. Returns 0 when the user has no
  // memberships. A user with multiple roles on one team is counted once.
  // Req 7.1, 7.2, 7.3, 7.5, 7.6
  async getMyTeamCount(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId);

    if (error) throw new ApiError(error.message);

    const distinctTeamIds = new Set(
      (data ?? []).map((row: { team_id: string }) => row.team_id)
    );
    return distinctTeamIds.size;
  }

  // Source-of-truth roster/team read: a team_members -> teams join keyed on the
  // current user's id so the result set equals the user's membership and is not
  // reduced to zero by the `teams` SELECT policy for a player-role user.
  // Req 3.10, 7.4
  //
  // streamlined-invites-and-child-access, 2026-08-28 fix: a caregiver never
  // has their own `team_members` row (only their linked child does), so a
  // caregiver querying only by their own `user_id` always got back an empty
  // list — the Team page showed "You are not a member of any team yet" even
  // for a caregiver whose child was actively on a roster, and the same gap
  // silently blocked their Messages tab too (`MessagingContext` derives its
  // team scope from this same relationship). Fixed the same way `Requirement
  // 6.3`'s `unionTeamAndCaregiverRecipients` already fixed the equivalent
  // problem for message-send recipients: union in every team their linked
  // child(ren) belong to, via `player_caregivers`, rather than relying on
  // `team_members` alone. Additive only — a non-caregiver's result is
  // unchanged, since `player_caregivers` never has a row for them as a
  // caregiver in the first place.
  /**
   * The teams the user can WRITE Progress Notes / coaching feedback for —
   * i.e. teams where they hold genuine coaching authority via their OWN
   * `team_members` row (role coach/manager, or `is_coach = true`).
   *
   * Deliberately NARROWER than `getMyTeams` below, and deliberately does NOT
   * union in caregiver-linked teams: `getMyTeams` mixes in the teams a
   * user's linked child plays on so a caregiver can BROWSE that roster
   * read-only (the Team page), but that is not write authority. Found live
   * 2026-09-03: the Progress Notes queue's team picker reused `getMyTeams`
   * and so offered a caregiver a team they could capture + refine a note
   * against, right up until the `game_feedback` INSERT — which correctly
   * failed RLS (migration 022 requires the writer's own coach/manager
   * membership on that team, which a caregiver-only relationship never
   * gives). The database was right to refuse; the picker was wrong to offer
   * it. This method is that picker's correct source.
   *
   * A player-only membership (role = 'player', no is_coach) is also excluded
   * — being on a team as a player is not authority to write feedback about
   * others on it.
   *
   * Note on admins: a club admin CAN write `game_feedback` for any team
   * (migration 022's admin-all policy), but this method still only returns
   * teams they have a real coaching/manager membership on — showing every
   * team in the club here would be impractical and isn't the common case.
   * A pure-admin-with-no-memberships wanting to add notes for an arbitrary
   * team is an accepted edge case, noted rather than solved here.
   */
  async getMyCoachingTeams(userId: string): Promise<TeamMemberWithTeam[]> {
    const { data, error } = await this.supabase
      .from('team_members')
      .select('*, team:teams(*)')
      .eq('user_id', userId)
      .or('role.in.(coach,manager),is_coach.eq.true');

    if (error) throw new ApiError(error.message);
    return (data ?? []) as unknown as TeamMemberWithTeam[];
  }

  async getMyTeams(userId: string): Promise<TeamMemberWithTeam[]> {
    const { data, error } = await this.supabase
      .from('team_members')
      .select('*, team:teams(*)')
      .eq('user_id', userId);

    if (error) throw new ApiError(error.message);
    const ownMemberships = (data ?? []) as unknown as TeamMemberWithTeam[];

    const { data: links, error: linksError } = await this.supabase
      .from('player_caregivers')
      .select('player_id')
      .eq('caregiver_id', userId);

    if (linksError) {
      // Best-effort, same discipline as `resolveRecipients`'s own caregiver
      // lookup: a caregiver temporarily missing their child's team is
      // preferable to failing the whole Team page load.
      console.error('getMyTeams: player_caregivers lookup failed, caregiver-linked teams omitted', linksError);
      return ownMemberships;
    }

    const childIds = (links ?? []).map((row: { player_id: string }) => row.player_id);
    if (childIds.length === 0) return ownMemberships;

    const { data: childMemberships, error: childError } = await this.supabase
      .from('team_members')
      .select('*, team:teams(*)')
      .in('user_id', childIds);

    if (childError) {
      console.error('getMyTeams: linked child team_members lookup failed, caregiver-linked teams omitted', childError);
      return ownMemberships;
    }

    const activeChildMemberships = (childMemberships ?? []) as unknown as TeamMemberWithTeam[];

    // 2026-08-28 follow-up fix: a linked child still awaiting caregiver
    // consent has no `team_members` row at all yet -- `TeamPage.tsx`'s
    // `fetchRoster` reads a pending child from `caregiver_approvals`, never
    // `team_members` (see its own comment on this: "Pending children
    // awaiting caregiver consent are not yet team_members"). Left as it was
    // above, a caregiver whose ONLY linked child is still pending got zero
    // rows from every query here and saw "not a member of any team" -- with
    // no way to ever reach the roster's inline Accept/Deny row, since
    // reaching it requires selecting the team first. This is a genuine
    // chicken-and-egg gap introduced by retiring the old dedicated
    // Approvals page (which read pending requests directly, independent of
    // team membership) in favour of approving inline on the roster. Found
    // live-testing a fresh child/caregiver pair (George Pig / Daddy Pig)
    // immediately after the migration-060 RLS fix above -- Mortimer/Micky
    // didn't hit this because Micky was already approved and active by the
    // time that fix was verified.
    //
    // Fix: union in the team of every pending `add_child` approval for a
    // linked child not already covered by an active membership, so the
    // caregiver can at least open the team and act on the pending request.
    const activeChildIds = new Set(activeChildMemberships.map((m) => m.user_id));
    const pendingChildIds = childIds.filter((id) => !activeChildIds.has(id));

    if (pendingChildIds.length === 0) {
      return [...ownMemberships, ...activeChildMemberships];
    }

    const { data: pendingApprovals, error: pendingError } = await this.supabase
      .from('caregiver_approvals')
      .select('player_id, team_id')
      .in('player_id', pendingChildIds)
      .eq('request_kind', 'add_child')
      .eq('status', 'pending');

    if (pendingError) {
      console.error('getMyTeams: pending caregiver_approvals lookup failed, pending-child teams omitted', pendingError);
      return [...ownMemberships, ...activeChildMemberships];
    }

    const alreadyCoveredTeamIds = new Set([
      ...ownMemberships.map((m) => m.team_id),
      ...activeChildMemberships.map((m) => m.team_id),
    ]);
    const pendingTeamIds = Array.from(
      new Set(
        (pendingApprovals ?? [])
          .map((row: { team_id: string | null }) => row.team_id)
          .filter((teamId): teamId is string => Boolean(teamId) && !alreadyCoveredTeamIds.has(teamId as string))
      )
    );

    if (pendingTeamIds.length === 0) {
      return [...ownMemberships, ...activeChildMemberships];
    }

    // Requires migration 061 (a caregiver has no `team_members` row on a
    // pending child's team, so migration 060's policy alone doesn't cover
    // this read -- a separate policy keyed off `caregiver_approvals`).
    const { data: pendingTeams, error: pendingTeamsError } = await this.supabase
      .from('teams')
      .select('*')
      .in('id', pendingTeamIds);

    if (pendingTeamsError) {
      console.error('getMyTeams: pending-child team lookup failed, pending-child teams omitted', pendingTeamsError);
      return [...ownMemberships, ...activeChildMemberships];
    }

    // Synthetic membership rows -- there is no real `team_members` row for
    // these yet, so only the fields `buildTeamSelection` actually reads
    // (`team_id`, `team`) are meaningful; the rest are placeholders never
    // shown anywhere.
    const pendingMemberships: TeamMemberWithTeam[] = (pendingTeams ?? []).map((team) => ({
      id: `pending-${team.id}`,
      team_id: team.id,
      user_id: userId,
      role: 'player',
      is_coach: false,
      created_at: '',
      updated_at: '',
      team: team as Team,
    }));

    return [...ownMemberships, ...activeChildMemberships, ...pendingMemberships];
  }
}


export const teamsApi = new TeamsApi();
