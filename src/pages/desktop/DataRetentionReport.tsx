import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { retentionApi } from '../../lib/retention-api';
import { ApiError } from '../../lib/api-client';
import type { AdminActionItem } from '../../types/database';

/**
 * Desktop "Data Retention & Privacy Assurance" report (Piece C,
 * `.kiro/specs/data-retention-privacy/`, design.md C.1-C.4, tasks.md
 * C1-C5). Ships independently of `desktopFeatures.reporting` (C1) — see
 * this file's route registration in `routes/index.tsx` and its nav entry
 * in `DesktopLayout.tsx`, both plain/unconditional, unlike the gated
 * Reporting suite they sit near.
 *
 * Follows `AdminActionItems.tsx`'s existing shape for a page reading
 * `admin_action_items` (loading/error state, a separate name-resolution
 * pass against `users` after the initial fetch, Tailwind classes matching
 * the rest of `/desktop`) rather than inventing a new structure.
 *
 * Two sections (C3): a Pending review table with an inline Exempt action
 * (C4), and a Recent history list underneath (C6) — the assurance half of
 * "privacy assurance," not just a to-do list of what's still open. An
 * exemption made in this page session can be undone (C5) via an inline
 * Undo action on that row in Recent history; the mechanism itself doesn't
 * care how old an exemption is, but this page only offers Undo on the
 * ones it exempted itself this session, to avoid an admin reopening a
 * months-old decision by surprise.
 */

interface DisplayInfo {
  name: string;
  role: string | null;
}

const EMPTY_DISPLAY: DisplayInfo = { name: 'Unknown person', role: null };

const CLOCK_LABEL: Record<string, string> = {
  standard: 'No active role (12 months)',
  orphaned_child: 'Orphaned pending child (90 days)',
};

const OUTCOME_LABEL: Record<string, string> = {
  auto_scrubbed: 'Auto-scrubbed',
  exempted: 'Exempted',
  no_longer_eligible: 'No longer eligible (rejoined)',
};

function formatDate(value: unknown): string {
  if (typeof value !== 'string') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function DataRetentionReport() {
  const [items, setItems] = useState<AdminActionItem[]>([]);
  const [recentlyActioned, setRecentlyActioned] = useState<AdminActionItem[]>([]);
  const [names, setNames] = useState<Record<string, DisplayInfo>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [undoableIds, setUndoableIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      setCurrentUserId(authUser?.id ?? null);

      const [pending, recent] = await Promise.all([
        retentionApi.listRetentionCandidates(),
        retentionApi.listRecentlyActioned(20),
      ]);
      setItems(pending);
      setRecentlyActioned(recent);
      await fetchNames([...pending, ...recent]);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load the retention report.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNames = async (rows: AdminActionItem[]) => {
    const playerIds = rows.map((r) => r.player_id).filter((id): id is string => !!id);
    const adminIds = rows.map((r) => r.actioned_by).filter((id): id is string => !!id);
    const userIds = Array.from(new Set([...playerIds, ...adminIds]));
    if (userIds.length === 0) return;

    const { data } = await supabase.from('users').select('id, first_name, last_name, role').in('id', userIds);

    const next: Record<string, DisplayInfo> = {};
    for (const u of data ?? []) {
      next[u.id] = { name: `${u.first_name} ${u.last_name}`, role: u.role ?? null };
    }
    setNames((prev) => ({ ...prev, ...next }));
  };

  const handleExempt = async (item: AdminActionItem) => {
    setActionError(null);
    setActioningId(item.id);
    try {
      await retentionApi.exemptCandidate(item);
      const exempted: AdminActionItem = {
        ...item,
        status: 'actioned',
        actioned_by: currentUserId,
        actioned_at: new Date().toISOString(),
        detail: { ...(item.detail ?? {}), outcome: 'exempted' },
      };
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setRecentlyActioned((prev) => [exempted, ...prev]);
      setUndoableIds((prev) => new Set(prev).add(item.id));
      // The acting admin may not already be in `names` (they're only added
      // there when they appear as a player_id or a past actioned_by) — fetch
      // their name so "Exempted by <name>" shows immediately, not blank.
      if (currentUserId && !names[currentUserId]) {
        const { data: adminRow } = await supabase
          .from('users')
          .select('id, first_name, last_name, role')
          .eq('id', currentUserId)
          .maybeSingle();
        if (adminRow) {
          setNames((prev) => ({
            ...prev,
            [adminRow.id]: { name: `${adminRow.first_name} ${adminRow.last_name}`, role: adminRow.role ?? null },
          }));
        }
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not exempt this candidate.');
    } finally {
      setActioningId(null);
    }
  };

  const handleUndo = async (item: AdminActionItem) => {
    setActionError(null);
    setActioningId(item.id);
    try {
      await retentionApi.unexemptCandidate(item);
      const { outcome: _outcome, ...detailWithoutOutcome } = item.detail ?? {};
      const restored: AdminActionItem = {
        ...item,
        status: 'pending',
        actioned_by: null,
        actioned_at: null,
        detail: detailWithoutOutcome,
      };
      setRecentlyActioned((prev) => prev.filter((i) => i.id !== item.id));
      setUndoableIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      setItems((prev) =>
        [...prev, restored].sort((a, b) => {
          const aAt = typeof a.detail?.scheduled_scrub_at === 'string' ? a.detail.scheduled_scrub_at : '';
          const bAt = typeof b.detail?.scheduled_scrub_at === 'string' ? b.detail.scheduled_scrub_at : '';
          return aAt.localeCompare(bAt);
        })
      );
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not undo this exemption.');
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Data Retention & Privacy Assurance</h1>
        <p className="text-gray-600 mt-1">
          People queued for the monthly retention scrub, and what's actually happened in past cycles.
        </p>
      </div>

      {actionError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-800">{actionError}</p>
        </div>
      )}

      {/* Pending review (C3/C4) */}
      <div className="bg-white rounded-lg shadow overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Pending review</h2>
        </div>
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : loadError ? (
          <div className="text-center py-12">
            <p className="text-red-600">{loadError}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">Nothing scheduled this cycle.</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role held</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Clock</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role ended</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheduled scrub</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => {
                const display = (item.player_id && names[item.player_id]) || EMPTY_DISPLAY;
                const clock = typeof item.detail?.clock === 'string' ? item.detail.clock : null;
                const isBusy = actioningId === item.id;
                return (
                  <tr key={item.id}>
                    <td className="px-6 py-4 text-sm text-gray-900">{display.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 capitalize">{display.role ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{(clock && CLOCK_LABEL[clock]) || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{formatDate(item.detail?.role_ended_at)}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{formatDate(item.detail?.scheduled_scrub_at)}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleExempt(item)}
                        disabled={isBusy}
                        className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isBusy ? 'Working...' : 'Exempt'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent history (C6) */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent history</h2>
        </div>
        {isLoading ? null : recentlyActioned.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No retention decisions yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {recentlyActioned.map((item) => {
              const display = (item.player_id && names[item.player_id]) || EMPTY_DISPLAY;
              const outcome = typeof item.detail?.outcome === 'string' ? item.detail.outcome : null;
              const adminName = item.actioned_by ? names[item.actioned_by]?.name : null;
              const canUndo = outcome === 'exempted' && undoableIds.has(item.id);
              const isBusy = actioningId === item.id;
              return (
                <li key={item.id} className="px-6 py-3 flex items-center justify-between gap-4">
                  <p className="text-sm text-gray-900">
                    <span className="font-medium">{display.name}</span> —{' '}
                    {(outcome && OUTCOME_LABEL[outcome]) || outcome || 'actioned'}
                    {outcome === 'exempted' && adminName ? ` by ${adminName}` : ''}
                    {item.actioned_at ? ` — ${formatDate(item.actioned_at)}` : ''}
                  </p>
                  {canUndo && (
                    <button
                      onClick={() => handleUndo(item)}
                      disabled={isBusy}
                      className="px-3 py-1 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 flex-shrink-0"
                    >
                      {isBusy ? 'Working...' : 'Undo'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
