import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { tournamentApi } from '../../lib/tournament-api';
import type { TournamentConfig as TournamentConfigType, GenerateFixturesParams, StandingsRowWithName } from '../../lib/tournament-api';
import type { Competition, Event } from '../../types/database';
import { StandingsTable } from '../../components/tournament/StandingsTable';
import { FixtureList } from '../../components/tournament/FixtureList';
import { TournamentConfig } from '../../components/tournament/TournamentConfig';

export function DesktopTournamentPage() {
  const [searchParams] = useSearchParams();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedComp, setSelectedComp] = useState<Competition | null>(null);
  const [fixtures, setFixtures] = useState<Event[]>([]);
  const [standings, setStandings] = useState<StandingsRowWithName[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    loadCompetitions();
  }, []);

  const loadCompetitions = async () => {
    try {
      setLoading(true);
      setError('');
      // Fetch all competitions and filter to club_tournament
      const allComps = await tournamentApi.query<Competition>('competitions');
      const tournamentComps = allComps.filter(c => c.competition_type === 'club_tournament');
      setCompetitions(tournamentComps);
    } catch (e: any) {
      setError(e.message || 'Failed to load competitions');
    } finally {
      setLoading(false);
    }
  };

  const loadCompetitionData = useCallback(async (comp: Competition) => {
    try {
      setDataLoading(true);
      setError('');
      const [fixtureData, standingsData] = await Promise.all([
        tournamentApi.getFixtures(comp.id),
        tournamentApi.getStandings(comp.id),
      ]);
      setFixtures(fixtureData);
      setStandings(standingsData);
    } catch (e: any) {
      setError(e.message || 'Failed to load tournament data');
    } finally {
      setDataLoading(false);
    }
  }, []);

  // V1.8: deep link from a Club Event ("Fixtures & standings" → ?comp=<id>).
  // Auto-select that competition once the list has loaded.
  useEffect(() => {
    const compId = searchParams.get('comp');
    if (compId && !selectedComp) {
      const comp = competitions.find((c) => c.id === compId);
      if (comp) {
        setSelectedComp(comp);
        loadCompetitionData(comp);
      }
    }
  }, [competitions, searchParams, selectedComp, loadCompetitionData]);

  const handleSelectCompetition = (compId: string) => {
    const comp = competitions.find(c => c.id === compId) ?? null;
    setSelectedComp(comp);
    setFixtures([]);
    setStandings([]);
    setSuccessMsg('');
    if (comp) {
      loadCompetitionData(comp);
    }
  };

  const handleSaveConfig = async (config: Partial<TournamentConfigType>) => {
    if (!selectedComp) return;
    try {
      setError('');
      const updated = await tournamentApi.updateTournamentConfig(selectedComp.id, config);
      setSelectedComp(updated);
      setSuccessMsg('Tournament config saved');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e: any) {
      setError(e.message || 'Failed to save config');
    }
  };

  const handleGenerateFixtures = async (params: GenerateFixturesParams) => {
    if (!selectedComp) return;
    try {
      setError('');
      const result = await tournamentApi.generateFixtures(params);
      setSuccessMsg(`Generated ${result.fixtureCount} fixtures`);
      setTimeout(() => setSuccessMsg(''), 3000);
      await loadCompetitionData(selectedComp);
    } catch (e: any) {
      setError(e.message || 'Failed to generate fixtures');
    }
  };

  const handleRecalculateStandings = async () => {
    if (!selectedComp) return;
    try {
      setError('');
      const updated = await tournamentApi.recalculateStandings(selectedComp.id);
      setStandings(updated);
      setSuccessMsg('Standings recalculated');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e: any) {
      setError(e.message || 'Failed to recalculate standings');
    }
  };

  if (loading) {
    return <div className="p-6 max-w-7xl mx-auto text-center text-gray-500">Loading tournaments...</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Tournament Management</h1>
        <button
          onClick={handleRecalculateStandings}
          disabled={!selectedComp}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Recalculate Standings
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg">{successMsg}</div>}

      {/* Competition Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">Select Tournament</label>
        <select
          value={selectedComp?.id ?? ''}
          onChange={(e) => handleSelectCompetition(e.target.value)}
          className="w-full max-w-md border rounded-lg px-3 py-2 text-sm"
        >
          <option value="" disabled>Choose a club tournament...</option>
          {competitions.map(comp => (
            <option key={comp.id} value={comp.id}>
              {comp.name} ({comp.status})
            </option>
          ))}
        </select>
        {competitions.length === 0 && (
          <p className="mt-2 text-sm text-gray-400">No club tournament competitions found</p>
        )}
      </div>

      {selectedComp && (
        <div className="space-y-8">
          {/* Tournament Config */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Configuration</h2>
            <TournamentConfig
              competition={selectedComp}
              onSave={handleSaveConfig}
              onGenerateFixtures={handleGenerateFixtures}
              fixturesExist={fixtures.length > 0}
            />
          </section>

          {/* Standings */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Standings</h2>
            <StandingsTable standings={standings} loading={dataLoading} />
          </section>

          {/* Fixtures */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Fixtures</h2>
            {dataLoading ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading fixtures...</div>
            ) : (
              <FixtureList fixtures={fixtures} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
