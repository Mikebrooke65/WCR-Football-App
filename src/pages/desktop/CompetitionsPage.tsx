import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { competitionsApi } from '../../lib/competitions-api';
import { invitesApi } from '../../lib/invites-api';
import { emailApi } from '../../lib/email-api';
import type { Competition, CompetitionTeam, Team, InviteCode } from '../../types/database';

export function CompetitionsPage() {
  const navigate = useNavigate();
  // V1.8: split competitions by who runs them.
  const [compTab, setCompTab] = useState<'external_league' | 'club_tournament'>('external_league');
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedComp, setSelectedComp] = useState<Competition | null>(null);
  const [compTeams, setCompTeams] = useState<(CompetitionTeam & { team?: Team })[]>([]);
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', competition_type: 'external_league' as 'external_league' | 'club_tournament', start_date: '', end_date: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  
  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteTeamId, setInviteTeamId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  // Add Tournament Team modal state
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamAgeGroup, setNewTeamAgeGroup] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [addTeamLoading, setAddTeamLoading] = useState(false);
  const [addTeamResult, setAddTeamResult] = useState<{ teamName: string; email: string; code: string; existingAccount: boolean } | null>(null);

  // Invite email state - tracked per invite code so each row can show its
  // own Sending/Sent state without a single global spinner.
  const [sendingCode, setSendingCode] = useState<string | null>(null);
  const [sentCodes, setSentCodes] = useState<string[]>([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [comps, allTeams] = await Promise.all([
        competitionsApi.getCompetitions(),
        competitionsApi.query<Team>('teams'),
      ]);
      setCompetitions(comps);
      setTeams(allTeams);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCompTeams = async (compId: string) => {
    const ct = await competitionsApi.getCompetitionTeams(compId);
    setCompTeams(ct);
  };

  const loadInvites = async (compId: string) => {
    try {
      const inv = await invitesApi.getAllInvitesForCompetition(compId);
      setInvites(inv);
    } catch (e) {
      console.error('Failed to load invites:', e);
      setInvites([]);
    }
  };

  const selectComp = (comp: Competition) => {
    setSelectedComp(comp);
    loadCompTeams(comp.id);
    if (comp.competition_type === 'club_tournament') {
      loadInvites(comp.id);
    } else {
      setInvites([]);
    }
  };

  const handleSave = async () => {
    setError('');
    try {
      if (editingId) {
        // Whether this competition is Active/Upcoming/Ended/Closed is now
        // purely date-driven (isCompetitionActive/isCompetitionClosed) -
        // no manual status field to update here.
        await competitionsApi.updateCompetition(editingId, formData);
      } else {
        await competitionsApi.createCompetition(formData);
      }
      setShowForm(false);
      setEditingId(null);
      setFormData({ name: '', competition_type: 'external_league', start_date: '', end_date: '' });
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleEdit = (comp: Competition) => {
    setFormData({ name: comp.name, competition_type: comp.competition_type, start_date: comp.start_date, end_date: comp.end_date });
    setEditingId(comp.id);
    setShowForm(true);
  };

  const handleClose = async (comp: Competition) => {
    if (!confirm(`End "${comp.name}" now? This sets the end date to today.`)) return;
    const today = new Date().toISOString().split('T')[0];
    await competitionsApi.updateCompetition(comp.id, { end_date: today });
    await loadData();
    if (selectedComp?.id === comp.id) setSelectedComp({ ...comp, end_date: today });
  };

  const handleDelete = async (comp: Competition) => {
    if (!confirm(`Delete "${comp.name}"? This cannot be undone.`)) return;
    await competitionsApi.deleteCompetition(comp.id);
    if (selectedComp?.id === comp.id) { setSelectedComp(null); setCompTeams([]); setInvites([]); }
    await loadData();
  };

  const handleLinkTeam = async (teamId: string) => {
    if (!selectedComp) return;
    try {
      await competitionsApi.linkTeam(selectedComp.id, teamId);
      await loadCompTeams(selectedComp.id);
    } catch (e: any) {
      setError(e.message || 'Failed to link team');
    }
  };

  const handleUnlinkTeam = async (teamId: string) => {
    if (!selectedComp) return;
    try {
      await competitionsApi.unlinkTeam(selectedComp.id, teamId);
      await loadCompTeams(selectedComp.id);
    } catch (e: any) {
      setError(e.message || 'Failed to unlink team');
    }
  };

  const handleCleanup = async () => {
    if (!selectedComp) return;
    if (!confirm('Remove all lite users from this competition\'s teams?')) return;
    const result = await competitionsApi.cleanupLiteUsers(selectedComp.id);
    alert(`Cleanup complete: ${result.removed} lite users removed, ${result.retained} full users retained.`);
  };

  const openInviteModal = (teamId: string) => {
    setInviteTeamId(teamId);
    setInviteEmail('');
    setInvitePhone('');
    setGeneratedCode(null);
    setShowInviteModal(true);
  };

  const handleGenerateInvite = async () => {
    if (!selectedComp || !inviteTeamId || !inviteEmail) return;
    setInviteLoading(true);
    try {
      const invite = await invitesApi.generateInviteCode(
        inviteTeamId,
        inviteEmail,
        invitePhone || undefined,
        selectedComp.id
      );
      setGeneratedCode(invite.code);
      await loadInvites(selectedComp.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setInviteLoading(false);
    }
  };

  const copyInviteLink = (code: string) => {
    const link = `${window.location.origin}/invite/${code}`;
    navigator.clipboard.writeText(link);
    alert('Invite link copied to clipboard!');
  };

  /** Team display name per project standard: "{age_group} {name}" */
  const teamLabel = (teamId: string) => {
    const t = teams.find(x => x.id === teamId);
    return t ? `${t.age_group || ''} ${t.name}`.trim() : 'your team';
  };

  /**
   * Email the invite link directly, instead of the admin copying it into
   * their own mail client. Club branding in the email (club name, colour,
   * from-address, and the app URL the link is built from) all comes from
   * the send-email Edge Function's env vars - nothing is passed from here.
   */
  const sendInviteLink = async (opts: { code: string; email: string; teamName: string }) => {
    setError('');
    setSendingCode(opts.code);
    try {
      await emailApi.sendTeamInvite({
        to: opts.email,
        teamName: opts.teamName,
        competitionName: selectedComp?.name,
        inviteCode: opts.code,
      });
      setSentCodes(prev => (prev.includes(opts.code) ? prev : [...prev, opts.code]));
    } catch (e: any) {
      setError(`Couldn't email ${opts.email}: ${e.message}. Use Copy Link and send it manually.`);
    } finally {
      setSendingCode(null);
    }
  };

  const sendLabel = (code: string) =>
    sendingCode === code ? 'Sending...' : sentCodes.includes(code) ? 'Resend Link' : 'Send Link';

  const handleAddTournamentTeam = async () => {
    if (!selectedComp || !newTeamName || !managerEmail) return;
    setAddTeamLoading(true);
    setError('');
    try {
      // 1. Create lightweight team (only name and age group required)
      const team = await competitionsApi.insert<Team>('teams', {
        name: newTeamName,
        age_group: newTeamAgeGroup || 'Open',
        training_ground: '',
        training_time: '',
      } as any);

      // 2. Link team to competition
      await competitionsApi.linkTeam(selectedComp.id, team.id);

      // 3. Generate invite code for the manager — records intended_role so the
      //    registrant is granted the Manager role on redemption (Requirement 6.7).
      const invite = await invitesApi.generateInviteCode(
        team.id,
        managerEmail,
        managerPhone || undefined,
        selectedComp.id,
        'manager'
      );

      // 2026-08-31 — Requirement 2.4's existing-user bypass, call site #3
      // (Task 12 item 6): if managerEmail already belongs to a real
      // account, an Admin naming them here as this brand-new team's
      // Manager is authority enough on its own — there's nothing left for
      // them to agree to. Same mechanism as `AddPlayerModal`'s adult route
      // (2026-08-31): `checkInviteRecipient` gates it, `joinExistingAccount`
      // completes it immediately via `redeem-invite`'s own existing-profile
      // branch, which creates nothing and never touches their real
      // password. Falls through to the ordinary invite-link path below on
      // any failure — the invite row already exists either way.
      let existingAccount = false;
      try {
        existingAccount = await invitesApi.checkInviteRecipient(invite.code);
        if (existingAccount) {
          await invitesApi.joinExistingAccount(invite.code, managerEmail);
        }
      } catch (err) {
        console.warn('Existing-account auto-join failed, falling back to invite link:', err);
        existingAccount = false;
      }

      setAddTeamResult({
        teamName: `${newTeamAgeGroup || 'Open'} ${newTeamName}`.trim(),
        email: managerEmail,
        code: invite.code,
        existingAccount,
      });

      // Refresh data
      await loadData();
      await loadCompTeams(selectedComp.id);
      await loadInvites(selectedComp.id);
    } catch (e: any) {
      setError(e.message || 'Failed to add tournament team');
    } finally {
      setAddTeamLoading(false);
    }
  };

  const openAddTeamModal = () => {
    setNewTeamName('');
    setNewTeamAgeGroup('');
    setManagerEmail('');
    setManagerPhone('');
    setAddTeamResult(null);
    setShowAddTeamModal(true);
  };

  const linkedTeamIds = compTeams.map((ct: any) => ct.team_id);
  const availableTeams = teams.filter(t => !linkedTeamIds.includes(t.id));
  const visibleComps = competitions.filter((c) => c.competition_type === compTab);
  const isActive = (comp: Competition) => competitionsApi.isCompetitionActive(comp);
  const isClosed = (comp: Competition) => competitionsApi.isCompetitionClosed(comp);
  const isUpcoming = (comp: Competition) => new Date().toISOString().split('T')[0] < comp.start_date;
  // Invites should be open as soon as a competition exists (Upcoming), not
  // just once it's Active - teams/managers need to be onboarded ahead of
  // the start date, not only from the day it kicks off.
  const canInvite = (comp: Competition) => isUpcoming(comp) || isActive(comp);
  const isClubTournament = selectedComp?.competition_type === 'club_tournament';

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const getStatusLabel = (comp: Competition): { label: string; className: string } => {
    if (isUpcoming(comp)) return { label: 'Upcoming', className: 'bg-blue-100 text-blue-700' };
    if (isActive(comp)) return { label: 'Active', className: 'bg-green-100 text-green-700' };
    if (isClosed(comp)) return { label: 'Closed', className: 'bg-gray-100 text-gray-600' };
    return { label: 'Ended', className: 'bg-orange-100 text-orange-700' };
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading competitions...</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Competitions</h1>
        <button onClick={() => { setShowForm(true); setEditingId(null); setFormData({ name: '', competition_type: compTab, start_date: '', end_date: '' }); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + New {compTab === 'external_league' ? 'League' : 'Club Event'}
        </button>
      </div>

      {/* V1.8: External Leagues (externally run) vs Club Events (internally run) */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {([
          ['external_league', 'External Leagues'],
          ['club_tournament', 'Club Events'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => { setCompTab(value); setSelectedComp(null); setCompTeams([]); setInvites([]); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              compTab === value ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {/* Create/Edit Form */}
      {showForm && (
        <div className="mb-6 p-4 bg-white rounded-lg shadow border">
          <h2 className="font-semibold mb-3">{editingId ? 'Edit' : 'New'} Competition</h2>
          <div className="grid grid-cols-2 gap-4">
            <input placeholder="Competition name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="border rounded-lg px-3 py-2" />
            <select value={formData.competition_type} onChange={e => setFormData({ ...formData, competition_type: e.target.value as 'external_league' | 'club_tournament' })}
              className="border rounded-lg px-3 py-2">
              <option value="external_league">External League</option>
              <option value="club_tournament">Club Tournament</option>
            </select>
            <div>
              <input type="date" value={formData.start_date} onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full border rounded-lg px-3 py-2" placeholder="Start date" />
              {formData.start_date && (
                <p className="text-xs text-gray-500 mt-1">{formatDate(formData.start_date)}</p>
              )}
            </div>
            <div>
              <input type="date" value={formData.end_date} onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full border rounded-lg px-3 py-2" placeholder="End date" />
              {formData.end_date && (
                <p className="text-xs text-gray-500 mt-1">{formatDate(formData.end_date)}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Save</button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-6">
        {/* Competition List */}
        <div className="col-span-3">
          <table className="w-full bg-white rounded-lg shadow table-auto">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="p-3 whitespace-nowrap">Name</th>
                <th className="p-3 whitespace-nowrap">Type</th>
                <th className="p-3 whitespace-nowrap">Status</th>
                <th className="p-3 whitespace-nowrap">Dates</th>
                <th className="p-3 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleComps.map(comp => (
                <tr key={comp.id} className={`border-b hover:bg-gray-50 cursor-pointer ${selectedComp?.id === comp.id ? 'bg-blue-50' : ''}`}
                  onClick={() => selectComp(comp)}>
                  <td className="p-3 text-sm font-medium whitespace-nowrap">{comp.name}</td>
                  <td className="p-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${comp.competition_type === 'external_league' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {comp.competition_type === 'external_league' ? 'External League' : 'Club Tournament'}
                    </span>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${getStatusLabel(comp).className}`}>
                      {getStatusLabel(comp).label}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-600 whitespace-nowrap">{formatDate(comp.start_date)} → {formatDate(comp.end_date)}</td>
                  <td className="p-3 whitespace-nowrap">
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleEdit(comp)} className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200">Edit</button>
                      {isActive(comp) && (
                        <button onClick={() => handleClose(comp)} className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">End Now</button>
                      )}
                      <button onClick={() => handleDelete(comp)} className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleComps.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-gray-400">
                  No {compTab === 'external_league' ? 'external leagues' : 'club events'} yet
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Right Panel - Teams & Invites */}
        <div className="space-y-4">
          {/* Team Linking Panel */}
          <div className="bg-white rounded-lg shadow p-4">
            {selectedComp ? (
              <>
                <h3 className="font-semibold mb-3">Teams in "{selectedComp.name}"</h3>
                <div className="space-y-2 mb-4">
                  {compTeams.map((ct: any) => (
                    <div key={ct.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                      <button
                        onClick={() => navigate(`/desktop/teams?team=${ct.team_id}`)}
                        className="text-sm text-left text-[#0091f3] hover:underline"
                        title="View this team and its roster"
                      >
                        {ct.team?.age_group} {ct.team?.name}
                      </button>
                      <div className="flex gap-2">
                        {isClubTournament && canInvite(selectedComp) && (
                          <button onClick={() => openInviteModal(ct.team_id)}
                            className="text-xs text-blue-600 hover:underline">Reinvite</button>
                        )}
                        <button onClick={() => handleUnlinkTeam(ct.team_id)} 
                          className="text-xs text-red-600 hover:underline">Remove</button>
                      </div>
                    </div>
                  ))}
                  {compTeams.length === 0 && <p className="text-sm text-gray-400">No teams linked</p>}
                </div>
                {availableTeams.length > 0 && (
                  <select onChange={e => { if (e.target.value) handleLinkTeam(e.target.value); e.target.value = ''; }}
                    className="w-full border rounded-lg px-3 py-2 text-sm" defaultValue="">
                    <option value="" disabled>+ Add team...</option>
                    {availableTeams.map(t => (
                      <option key={t.id} value={t.id}>{t.age_group} {t.name}</option>
                    ))}
                  </select>
                )}
                {isClubTournament && isClosed(selectedComp) && (
                  <button onClick={handleCleanup} className="mt-4 w-full px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm hover:bg-orange-200">
                    Cleanup Lite Users
                  </button>
                )}
                {isClubTournament && canInvite(selectedComp) && (
                  <button onClick={openAddTeamModal} className="mt-3 w-full px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200">
                    + Add Tournament Team
                  </button>
                )}
                {isClubTournament && (
                  <button
                    onClick={() => navigate(`/desktop/tournaments?comp=${selectedComp.id}`)}
                    className="mt-3 w-full px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm hover:bg-orange-200"
                  >
                    Fixtures &amp; standings
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">Select a competition to manage teams</p>
            )}
          </div>

          {/* Invites Panel - Only for Club Tournaments */}
          {selectedComp && isClubTournament && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">Invites</h3>
              {invites.length === 0 ? (
                <p className="text-sm text-gray-400">No invites sent yet</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {invites.map((inv: any) => (
                    <div key={inv.id} className="p-2 bg-gray-50 rounded text-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">{inv.recipient_email}</p>
                          <p className="text-xs text-gray-500">{inv.team?.age_group} {inv.team?.name}</p>
                        </div>
                        <div className="text-right">
                          {inv.redeemed_by ? (
                            <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">Redeemed</span>
                          ) : new Date(inv.expires_at) < new Date() ? (
                            <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">Expired</span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">Pending</span>
                          )}
                        </div>
                      </div>
                      {!inv.redeemed_by && new Date(inv.expires_at) >= new Date() && (
                        <div className="mt-1 flex items-center gap-3">
                          <button
                            onClick={() => sendInviteLink({
                              code: inv.code,
                              email: inv.recipient_email,
                              teamName: `${inv.team?.age_group || ''} ${inv.team?.name || ''}`.trim(),
                            })}
                            disabled={sendingCode === inv.code}
                            className="text-xs font-medium text-green-700 hover:underline disabled:opacity-50">
                            {sendLabel(inv.code)}
                          </button>
                          <button onClick={() => copyInviteLink(inv.code)}
                            className="text-xs text-blue-600 hover:underline">
                            Copy Link
                          </button>
                          {sentCodes.includes(inv.code) && (
                            <span className="text-xs text-green-600">Sent</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowInviteModal(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Invite Player</h2>
            
            {generatedCode ? (
              <div className="text-center">
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">Invite code generated!</p>
                  <p className="text-2xl font-mono font-bold text-blue-600">{generatedCode}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <p className="text-xs text-gray-500 mb-1">Share this link:</p>
                  <p className="text-sm font-mono break-all">{window.location.origin}/invite/{generatedCode}</p>
                </div>
                {sentCodes.includes(generatedCode) && (
                  <p className="text-sm text-green-700 mb-3">Invite emailed to {inviteEmail}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => sendInviteLink({
                      code: generatedCode,
                      email: inviteEmail,
                      teamName: teamLabel(inviteTeamId),
                    })}
                    disabled={sendingCode === generatedCode}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                    {sendLabel(generatedCode)}
                  </button>
                  <button onClick={() => copyInviteLink(generatedCode)} 
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Copy Link
                  </button>
                  <button onClick={() => { setShowInviteModal(false); setGeneratedCode(null); }} 
                    className="flex-1 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
                    <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                      placeholder="player@example.com"
                      className="w-full border rounded-lg px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number (optional)</label>
                    <input type="tel" value={invitePhone} onChange={e => setInvitePhone(e.target.value)}
                      placeholder="021 123 4567"
                      className="w-full border rounded-lg px-3 py-2" />
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 mt-4 text-sm text-blue-700">
                  <p>An invite code will be generated. You can then email the link straight to the player, or copy it and send it yourself.</p>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={handleGenerateInvite} disabled={!inviteEmail || inviteLoading}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                    {inviteLoading ? 'Generating...' : 'Generate Invite'}
                  </button>
                  <button onClick={() => setShowInviteModal(false)} 
                    className="flex-1 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Tournament Team Modal */}
      {showAddTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowAddTeamModal(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Add Tournament Team</h2>
            
            {addTeamResult ? (
              <div className="text-center">
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-2">Team "{addTeamResult.teamName}" created and linked!</p>
                </div>
                {addTeamResult.existingAccount ? (
                  // 2026-08-31 — existing-user bypass (Requirement 2.4, call
                  // site #3): managerEmail already had an account, so they
                  // were added as this team's Manager immediately — no
                  // invite code, no link, nothing left to send.
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                    <p className="text-sm text-green-800">
                      {addTeamResult.email} already has an account — they've been added as this
                      team's Manager directly. Nothing more to send.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 mb-2">Manager invite code:</p>
                      <p className="text-2xl font-mono font-bold text-blue-600">{addTeamResult.code}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 mb-4">
                      <p className="text-xs text-gray-500 mb-1">Share this link with the team manager:</p>
                      <p className="text-sm font-mono break-all">{window.location.origin}/invite/{addTeamResult.code}</p>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">
                      The manager registers via this link, then they can share it with their players to onboard them.
                    </p>
                    {sentCodes.includes(addTeamResult.code) && (
                      <p className="text-sm text-green-700 mb-3">Invite emailed to {addTeamResult.email}</p>
                    )}
                  </>
                )}
                <div className="flex gap-2">
                  {!addTeamResult.existingAccount && (
                    <>
                      <button
                        onClick={() => sendInviteLink({
                          code: addTeamResult.code,
                          email: addTeamResult.email,
                          teamName: addTeamResult.teamName,
                        })}
                        disabled={sendingCode === addTeamResult.code}
                        className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                        {sendLabel(addTeamResult.code)}
                      </button>
                      <button onClick={() => copyInviteLink(addTeamResult.code)}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        Copy Link
                      </button>
                    </>
                  )}
                  <button onClick={() => { setShowAddTeamModal(false); setAddTeamResult(null); }}
                    className="flex-1 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Team Name *</label>
                    <input type="text" value={newTeamName} onChange={e => setNewTeamName(e.target.value)}
                      placeholder="e.g. Eastern Suburbs FC"
                      className="w-full border rounded-lg px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Age Group</label>
                    <select value={newTeamAgeGroup} onChange={e => setNewTeamAgeGroup(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2">
                      <option value="">Select age group</option>
                      {['U4','U5','U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','Open'].map(ag => (
                        <option key={ag} value={ag}>{ag}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Manager Email *</label>
                    <input type="email" value={managerEmail} onChange={e => setManagerEmail(e.target.value)}
                      placeholder="manager@example.com"
                      className="w-full border rounded-lg px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Manager Phone (optional)</label>
                    <input type="tel" value={managerPhone} onChange={e => setManagerPhone(e.target.value)}
                      placeholder="021 123 4567"
                      className="w-full border rounded-lg px-3 py-2" />
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 mt-4 text-sm text-blue-700">
                  <p>This creates the team, links it to the tournament, and generates an invite code for the manager. You can then email the invite straight to them, or copy the link and send it yourself.</p>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={handleAddTournamentTeam} disabled={!newTeamName || !managerEmail || addTeamLoading}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                    {addTeamLoading ? 'Creating...' : 'Create Team & Invite'}
                  </button>
                  <button onClick={() => setShowAddTeamModal(false)} 
                    className="flex-1 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
