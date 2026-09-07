import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { getDefaultHalfDuration } from '../../lib/attendance-utils';
import { teamsApi } from '../../lib/teams-api';
import { rolesApi } from '../../lib/roles-api';
import { invitesApi } from '../../lib/invites-api';

interface Team {
  id: string;
  name: string;
  age_group: string;
  division: string;
  training_ground: string;
  training_time: string;
  game_players?: number;
  half_duration?: number;
  coach?: {
    id: string;
    first_name: string;
    last_name: string;
    role: string;
  };
  player_count?: number;
}

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    cellphone?: string;
  };
}

interface Coach {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
}

export function TeamsManagement() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [teams, setTeams] = useState<Team[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAge, setFilterAge] = useState('all');
  const [filterDivision, setFilterDivision] = useState('all');
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMember[]>>({});
  // V1.8: first manager name per team, and pending teams (invited manager not
  // yet joined) keyed to the invite's sent-date.
  const [managerByTeam, setManagerByTeam] = useState<Record<string, string>>({});
  const [pendingByTeam, setPendingByTeam] = useState<Record<string, string>>({});

  // V1.8 Assign Manager (edit modal). Cap is 2/team (migration 048 trigger).
  const [editManagers, setEditManagers] = useState<{ membershipId: string; name: string }[]>([]);
  const [managerSearch, setManagerSearch] = useState('');
  const [managerSearchResults, setManagerSearchResults] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [managerInviteEmail, setManagerInviteEmail] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    age_group: 'U9',
    division: 'Community',
    training_ground: '',
    training_time: '',
    coach_id: '',
    game_players: '' as string,
    half_duration: '' as string,
  });
  const [configErrors, setConfigErrors] = useState<{ game_players?: string; half_duration?: string }>({});

  // Fetch teams and coaches
  useEffect(() => {
    fetchTeams();
    fetchCoaches();
  }, []);

  // V1.8: deep link from Competitions ("click a team → view it here"). Once
  // teams have loaded, expand the requested team + load its members, then
  // clear the param.
  useEffect(() => {
    const teamId = searchParams.get('team');
    if (teamId && teams.some((t) => t.id === teamId)) {
      setExpandedTeamId(teamId);
      if (!teamMembers[teamId]) void fetchTeamMembers(teamId);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, searchParams]);

  const fetchTeams = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('teams')
        .select(`
          *,
          coach:users!teams_coach_id_fkey(id, first_name, last_name, role)
        `)
        .order('name');

      if (error) throw error;
      const teamList = data || [];
      setTeams(teamList);
      await loadManagersAndPending(teamList.map((t: any) => t.id as string));
    } catch (error) {
      console.error('Error fetching teams:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Managers (first per team) + pending status (V1.8). Pending rule (D1): a
   * team is "pending" when it has an unredeemed, unexpired MANAGER invite AND
   * no manager member has joined yet. `invite_codes` is authenticated-readable;
   * the shown date is the (most recent) outstanding invite's created_at.
   */
  const loadManagersAndPending = async (teamIds: string[]) => {
    if (teamIds.length === 0) {
      setManagerByTeam({});
      setPendingByTeam({});
      return;
    }
    const nowIso = new Date().toISOString();
    const [membersRes, invitesRes] = await Promise.all([
      supabase
        .from('team_members')
        .select('team_id, user:users(first_name, last_name)')
        .in('team_id', teamIds)
        .eq('role', 'manager'),
      supabase
        .from('invite_codes')
        .select('team_id, created_at')
        .in('team_id', teamIds)
        .eq('intended_role', 'manager')
        .is('redeemed_by', null)
        .gte('expires_at', nowIso),
    ]);

    const managers: Record<string, string> = {};
    const hasManager = new Set<string>();
    for (const row of (membersRes.data as any[]) ?? []) {
      hasManager.add(row.team_id);
      if (!managers[row.team_id] && row.user) {
        managers[row.team_id] = `${row.user.first_name} ${row.user.last_name}`.trim();
      }
    }

    const inviteDate: Record<string, string> = {};
    for (const row of (invitesRes.data as any[]) ?? []) {
      if (!inviteDate[row.team_id] || row.created_at > inviteDate[row.team_id]) {
        inviteDate[row.team_id] = row.created_at;
      }
    }

    const pending: Record<string, string> = {};
    for (const [teamId, date] of Object.entries(inviteDate)) {
      if (!hasManager.has(teamId)) pending[teamId] = date;
    }

    setManagerByTeam(managers);
    setPendingByTeam(pending);
  };

  // -- Assign Manager (V1.8) -------------------------------------------------

  const loadEditTeamManagers = async (teamId: string) => {
    const { data } = await supabase
      .from('team_members')
      .select('id, user:users(first_name, last_name)')
      .eq('team_id', teamId)
      .eq('role', 'manager');
    setEditManagers(
      ((data as any[]) ?? []).map((r) => ({
        membershipId: r.id,
        name: r.user ? `${r.user.first_name} ${r.user.last_name}`.trim() : 'Unknown',
      }))
    );
  };

  const resetAssignManager = () => {
    setManagerSearch('');
    setManagerSearchResults([]);
    setManagerInviteEmail('');
    setAssignMsg(null);
    setAssignError(null);
  };

  const handleManagerSearch = async (term: string) => {
    setManagerSearch(term);
    setAssignError(null);
    const q = term.trim();
    if (q.length < 2) {
      setManagerSearchResults([]);
      return;
    }
    const { data } = await supabase
      .from('users')
      .select('id, first_name, last_name')
      .eq('active', true)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      .order('last_name')
      .limit(8);
    setManagerSearchResults((data as any[]) ?? []);
  };

  const refreshAfterManagerChange = async (teamId: string) => {
    await loadEditTeamManagers(teamId);
    await loadManagersAndPending(teams.map((t) => t.id));
  };

  const handleAssignExistingManager = async (userId: string, displayName: string) => {
    if (!editingTeam) return;
    setAssignBusy(true);
    setAssignError(null);
    setAssignMsg(null);
    try {
      // The person may already be on this team in another role — promote that
      // membership rather than inserting a duplicate (UNIQUE(team_id,user_id)).
      const { data: existing } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', editingTeam.id)
        .eq('user_id', userId)
        .maybeSingle();
      if (existing?.id) {
        await rolesApi.updateTeamMemberRole(existing.id, 'manager');
      } else {
        await rolesApi.addTeamMember(editingTeam.id, userId, 'manager');
      }
      await refreshAfterManagerChange(editingTeam.id);
      setManagerSearch('');
      setManagerSearchResults([]);
      setAssignMsg(`${displayName} is now a manager of this team.`);
    } catch (e: any) {
      const msg = e?.message ?? '';
      setAssignError(
        msg.includes('manager_cap_reached')
          ? 'This team already has the maximum of 2 managers — remove one first.'
          : msg || 'Could not assign manager.'
      );
    } finally {
      setAssignBusy(false);
    }
  };

  const handleInviteManager = async () => {
    if (!editingTeam) return;
    const email = managerInviteEmail.trim();
    if (!email) return;
    setAssignBusy(true);
    setAssignError(null);
    setAssignMsg(null);
    try {
      const invite = await invitesApi.generateInviteCode(editingTeam.id, email, undefined, undefined, 'manager');
      // If they already have an account, complete the join immediately (same
      // path CompetitionsPage uses); otherwise the invite link is theirs to
      // redeem. Either way the team shows as pending until they join.
      let joined = false;
      try {
        if (await invitesApi.checkInviteRecipient(invite.code)) {
          await invitesApi.joinExistingAccount(invite.code, email);
          joined = true;
        }
      } catch {
        joined = false;
      }
      await refreshAfterManagerChange(editingTeam.id);
      setManagerInviteEmail('');
      setAssignMsg(
        joined
          ? `${email} already had an account and has been added as a manager.`
          : `Manager invite sent to ${email}. The team stays pending until they join.`
      );
    } catch (e: any) {
      const msg = e?.message ?? '';
      setAssignError(
        msg.includes('manager_cap_reached')
          ? 'This team already has the maximum of 2 managers — remove one first.'
          : msg || 'Could not send the manager invite.'
      );
    } finally {
      setAssignBusy(false);
    }
  };

  const fetchCoaches = async () => {
    try {
      // Fetch users with coach or admin role
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, role')
        .in('role', ['coach', 'admin'])
        .eq('active', true)
        .order('first_name');

      if (error) throw error;
      setCoaches(data || []);
    } catch (error) {
      console.error('Error fetching coaches:', error);
    }
  };

  const fetchTeamMembers = async (teamId: string) => {
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select(`
          id,
          user_id,
          role,
          user:users(id, first_name, last_name, email, cellphone)
        `)
        .eq('team_id', teamId)
        .order('role', { ascending: false });

      if (error) throw error;
      setTeamMembers(prev => ({ ...prev, [teamId]: data || [] }));
    } catch (error) {
      console.error('Error fetching team members:', error);
    }
  };

  const handleToggleTeam = async (teamId: string) => {
    if (expandedTeamId === teamId) {
      setExpandedTeamId(null);
    } else {
      setExpandedTeamId(teamId);
      if (!teamMembers[teamId]) {
        await fetchTeamMembers(teamId);
      }
    }
  };

  const filteredTeams = teams.filter((team) => {
    const matchesSearch = team.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesAge = filterAge === 'all' || team.age_group === filterAge;
    const matchesDivision = filterDivision === 'all' || team.division === filterDivision;
    return matchesSearch && matchesAge && matchesDivision;
  });

  const validateConfigFields = (gamePlayers: string, halfDuration: string) => {
    const errors: { game_players?: string; half_duration?: string } = {};
    if (gamePlayers !== '') {
      const val = Number(gamePlayers);
      if (!Number.isInteger(val) || val < 1) {
        errors.game_players = 'Must be a whole number ≥ 1';
      }
    }
    if (halfDuration !== '') {
      const val = Number(halfDuration);
      if (!Number.isInteger(val) || val < 1) {
        errors.half_duration = 'Must be a whole number ≥ 1';
      }
    }
    return errors;
  };

  const hasConfigErrors = Object.keys(configErrors).length > 0;

  const handleOpenModal = (team?: Team) => {
    if (team) {
      setEditingTeam(team);
      void loadEditTeamManagers(team.id);
      const defaultHalf = getDefaultHalfDuration(team.age_group);
      setFormData({
        name: team.name,
        age_group: team.age_group,
        division: team.division,
        training_ground: team.training_ground,
        training_time: team.training_time,
        coach_id: team.coach?.id || '',
        game_players: team.game_players != null ? String(team.game_players) : '',
        half_duration: team.half_duration != null ? String(team.half_duration) : String(defaultHalf),
      });
    } else {
      setEditingTeam(null);
      setEditManagers([]);
      setFormData({
        name: '',
        age_group: 'U9',
        division: 'Community',
        training_ground: '',
        training_time: '',
        coach_id: '',
        game_players: '',
        half_duration: String(getDefaultHalfDuration('U9')),
      });
    }
    setConfigErrors({});
    resetAssignManager();
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingTeam(null);
    setEditManagers([]);
    resetAssignManager();
  };

  const handleSave = async () => {
    // Validate config fields before saving
    const errors = validateConfigFields(formData.game_players, formData.half_duration);
    setConfigErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      if (editingTeam) {
        // Update existing team
        const { error } = await supabase
          .from('teams')
          .update({
            name: formData.name,
            age_group: formData.age_group,
            division: formData.division,
            training_ground: formData.training_ground,
            training_time: formData.training_time,
            coach_id: formData.coach_id || null,
          })
          .eq('id', editingTeam.id);

        if (error) throw error;

        // Save game config if values are provided
        const gp = formData.game_players !== '' ? Number(formData.game_players) : null;
        const hd = formData.half_duration !== '' ? Number(formData.half_duration) : null;
        if (gp != null && hd != null) {
          await teamsApi.updateTeamConfig(editingTeam.id, gp, hd);
        }
      } else {
        // Create new team
        const insertData: Record<string, unknown> = {
          name: formData.name,
          age_group: formData.age_group,
          division: formData.division,
          training_ground: formData.training_ground,
          training_time: formData.training_time,
          coach_id: formData.coach_id || null,
        };
        if (formData.game_players !== '') {
          insertData.game_players = Number(formData.game_players);
        }
        if (formData.half_duration !== '') {
          insertData.half_duration = Number(formData.half_duration);
        }

        const { error } = await supabase
          .from('teams')
          .insert(insertData);

        if (error) throw error;
      }

      // Refresh teams list
      await fetchTeams();
      handleCloseModal();
    } catch (error) {
      console.error('Error saving team:', error);
      alert('Failed to save team. Please try again.');
    }
  };

  const handleDelete = async (teamId: string) => {
    if (!confirm('Are you sure you want to delete this team?')) return;

    try {
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', teamId);

      if (error) throw error;

      // Refresh teams list
      await fetchTeams();
    } catch (error) {
      console.error('Error deleting team:', error);
      alert('Failed to delete team. Please try again.');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Teams Management</h1>
            <p className="text-gray-600 mt-1">Manage team rosters and assignments</p>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="px-4 py-2 bg-[#0091f3] text-white rounded-lg font-medium hover:bg-[#0077cc] flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Team
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Search teams or coaches..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
            />
            <svg
              className="absolute left-3 top-2.5 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          <select
            value={filterAge}
            onChange={(e) => setFilterAge(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
          >
            <option value="all">All Age Groups</option>
            <option value="U4">U4</option>
            <option value="U5">U5</option>
            <option value="U6">U6</option>
            <option value="U7">U7</option>
            <option value="U8">U8</option>
            <option value="U9">U9</option>
            <option value="U10">U10</option>
            <option value="U11">U11</option>
            <option value="U12">U12</option>
            <option value="U13">U13</option>
            <option value="U14">U14</option>
            <option value="U15">U15</option>
            <option value="U16">U16</option>
            <option value="U17">U17</option>
          </select>

          <select
            value={filterDivision}
            onChange={(e) => setFilterDivision(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
          >
            <option value="all">All Divisions</option>
            <option value="Community">Community</option>
            <option value="Academy">Academy</option>
          </select>
        </div>
      </div>

      {/* Teams Table */}
      <div className="flex-1 bg-white rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0091f3]"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Division
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Coach
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Manager
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Training Ground
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Training Time
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTeams.map((team) => (
                  <>
                    <tr key={team.id} className={pendingByTeam[team.id] ? 'bg-gray-50' : 'hover:bg-gray-50'}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleTeam(team.id)}
                            className="p-1 hover:bg-gray-200 rounded"
                          >
                            {expandedTeamId === team.id ? (
                              <ChevronDown className="w-4 h-4 text-gray-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-600" />
                            )}
                          </button>
                          <div className={`text-sm font-medium ${pendingByTeam[team.id] ? 'text-gray-400' : 'text-gray-900'}`}>
                            {team.age_group} {team.name}
                          </div>
                          {pendingByTeam[team.id] && (
                            <span className="ml-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 whitespace-nowrap">
                              Pending · invited{' '}
                              {new Date(pendingByTeam[team.id]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          team.division === 'Academy'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {team.division}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                        {team.coach ? `${team.coach.first_name} ${team.coach.last_name}` : '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                        {managerByTeam[team.id] || '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                        {team.training_ground}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">
                        {team.training_time}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => handleOpenModal(team)}
                          className="text-[#0091f3] hover:text-[#0077cc] mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(team.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {expandedTeamId === team.id && (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 bg-gray-50">
                          <div className="ml-8">
                            <h4 className="text-sm font-semibold text-gray-700 mb-3">Team Members</h4>
                            {teamMembers[team.id] && teamMembers[team.id].length > 0 ? (
                              <div className="bg-white rounded-lg border border-gray-200">
                                <table className="w-full">
                                  <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200">
                                    {teamMembers[team.id].map((member) => (
                                      <tr key={member.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 text-sm">
                                          <button
                            onClick={() => window.open(`/desktop/users?edit=${member.user_id}`, '_blank')}
                                            className="text-[#0091f3] hover:text-[#0077cc] hover:underline font-medium"
                                          >
                                            {member.user.first_name} {member.user.last_name}
                                          </button>
                                        </td>
                                        <td className="px-4 py-2 text-sm text-gray-600">{member.user.email}</td>
                                        <td className="px-4 py-2 text-sm text-gray-600">{member.user.cellphone || '-'}</td>
                                        <td className="px-4 py-2">
                                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                            member.role === 'coach' 
                                              ? 'bg-purple-100 text-purple-700' 
                                              : 'bg-blue-100 text-blue-700'
                                          }`}>
                                            {member.role}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500 italic">No members assigned to this team yet</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && filteredTeams.length === 0 && (
          <div className="text-center py-12">
            <svg
              className="w-12 h-12 text-gray-300 mx-auto mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p className="text-gray-500">No teams found</p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingTeam ? 'Edit Team' : 'Add New Team'}
              </h2>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Team Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                  placeholder="e.g., Rangers U10 Blue"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Age Group *
                  </label>
                  <select
                    value={formData.age_group}
                    onChange={(e) => {
                      const newAgeGroup = e.target.value;
                      const currentDefault = getDefaultHalfDuration(formData.age_group);
                      const newDefault = getDefaultHalfDuration(newAgeGroup);
                      // Auto-update half_duration if it matches the old default or is empty
                      const shouldUpdateHalf =
                        formData.half_duration === '' ||
                        formData.half_duration === String(currentDefault);
                      setFormData({
                        ...formData,
                        age_group: newAgeGroup,
                        half_duration: shouldUpdateHalf ? String(newDefault) : formData.half_duration,
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                  >
                    <option value="U4">U4</option>
                    <option value="U5">U5</option>
                    <option value="U6">U6</option>
                    <option value="U7">U7</option>
                    <option value="U8">U8</option>
                    <option value="U9">U9</option>
                    <option value="U10">U10</option>
                    <option value="U11">U11</option>
                    <option value="U12">U12</option>
                    <option value="U13">U13</option>
                    <option value="U14">U14</option>
                    <option value="U15">U15</option>
                    <option value="U16">U16</option>
                    <option value="U17">U17</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Division *
                  </label>
                  <select
                    value={formData.division}
                    onChange={(e) => setFormData({ ...formData, division: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                  >
                    <option value="Community">Community</option>
                    <option value="Academy">Academy/Development</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Training Ground *
                  </label>
                  <input
                    type="text"
                    value={formData.training_ground}
                    onChange={(e) => setFormData({ ...formData, training_ground: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                    placeholder="e.g., West Coast Stadium"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Training Time *
                  </label>
                  <input
                    type="text"
                    value={formData.training_time}
                    onChange={(e) => setFormData({ ...formData, training_time: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                    placeholder="e.g., Saturdays 9:00 AM"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign Coach (Optional)
                </label>
                <select
                  value={formData.coach_id}
                  onChange={(e) => setFormData({ ...formData, coach_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                >
                  <option value="">Unassigned</option>
                  {coaches.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.first_name} {coach.last_name} ({coach.role})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Both coaches and admins can be assigned to teams
                </p>
              </div>

              {/* Game Configuration */}
              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Game Configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Game Players
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={formData.game_players}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData({ ...formData, game_players: val });
                        setConfigErrors(validateConfigFields(val, formData.half_duration));
                      }}
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] ${
                        configErrors.game_players ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="e.g., 7 or 11"
                    />
                    {configErrors.game_players && (
                      <p className="mt-1 text-xs text-red-600">{configErrors.game_players}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Half Duration (mins)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={formData.half_duration}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData({ ...formData, half_duration: val });
                        setConfigErrors(validateConfigFields(formData.game_players, val));
                      }}
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] ${
                        configErrors.half_duration ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="e.g., 25"
                    />
                    {configErrors.half_duration && (
                      <p className="mt-1 text-xs text-red-600">{configErrors.half_duration}</p>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Used for substitution calculations on the Subs page
                </p>
              </div>

              {/* Assign Manager (V1.8) — edit mode only. Cap = 2/team. */}
              {editingTeam && (
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Managers</h3>

                  {editManagers.length > 0 ? (
                    <ul className="mb-3 space-y-1">
                      {editManagers.map((m) => (
                        <li key={m.membershipId} className="text-sm text-gray-800">
                          {m.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-3 text-sm text-gray-400">No manager assigned yet.</p>
                  )}

                  {editManagers.length >= 2 ? (
                    <p className="text-xs text-amber-700">
                      Maximum of 2 managers reached — remove one (from the person's Users record) before assigning
                      another.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {/* Assign an existing person */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Assign an existing person
                        </label>
                        <input
                          type="text"
                          value={managerSearch}
                          onChange={(e) => handleManagerSearch(e.target.value)}
                          placeholder="Search by name…"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                        />
                        {managerSearchResults.length > 0 && (
                          <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                            {managerSearchResults.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                disabled={assignBusy}
                                onClick={() => handleAssignExistingManager(u.id, `${u.first_name} ${u.last_name}`)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                              >
                                {u.first_name} {u.last_name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Or invite by email */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Or invite by email</label>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={managerInviteEmail}
                            onChange={(e) => setManagerInviteEmail(e.target.value)}
                            placeholder="manager@example.com"
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                          />
                          <button
                            type="button"
                            onClick={handleInviteManager}
                            disabled={assignBusy || !managerInviteEmail.trim()}
                            className="px-3 py-2 bg-[#0091f3] text-white rounded-lg text-sm font-medium hover:bg-[#0077cc] disabled:opacity-50"
                          >
                            Invite
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {assignMsg && <p className="mt-2 text-xs text-green-700">{assignMsg}</p>}
                  {assignError && <p className="mt-2 text-xs text-red-600">{assignError}</p>}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={hasConfigErrors}
                className={`px-4 py-2 rounded-lg font-medium ${
                  hasConfigErrors
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-[#0091f3] text-white hover:bg-[#0077cc]'
                }`}
              >
                {editingTeam ? 'Save Changes' : 'Create Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
