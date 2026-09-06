import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { caregiversApi } from '../../lib/caregivers-api';
import { ApiError } from '../../lib/api-client';
import type { AdminActionItem } from '../../types/database';

/**
 * Small admin screen listing pending `admin_action_items` rows (design.md,
 * Task 9, Requirement 7.5). Today the only `kind` ever produced is
 * `caregiver_removed_review` (migration 056's `on_player_caregiver_removed`
 * trigger, fired whenever a caregiver is unlinked from a child) — this page
 * renders that kind specifically, but reads `getPendingAdminActionItems()`
 * generically so a future `kind` shows up (with a generic fallback render)
 * rather than silently vanishing.
 *
 * Each row offers exactly the two decisions design.md documents an admin can
 * make on a removal: "no, leave it" (dismiss, no side effect) or "revoke
 * this child's device access" (calls the `revoke-child-device-access` Edge
 * Function, which also marks the item actioned server-side in the same
 * call). Neither action is automatic — removing a caregiver itself never
 * revokes anything (Correctness Property 5) — an admin must always decide.
 */

interface DisplayNames {
  playerName: string;
  teamName: string | null;
  caregiverName: string | null;
}

const EMPTY_NAMES: DisplayNames = { playerName: 'Unknown player', teamName: null, caregiverName: null };

interface AdminActionItemsProps {
  /** When embedded under the Users page's "Caregiver Reviews" tab (V1.8), the
   *  page-level heading is suppressed (the tab supplies the context). */
  embedded?: boolean;
  /** Fired with the current pending count on load and after each action, so a
   *  host (the Users tab) can show a live badge. */
  onCountChange?: (count: number) => void;
}

export function AdminActionItems({ embedded = false, onCountChange }: AdminActionItemsProps = {}) {
  const [items, setItems] = useState<AdminActionItem[]>([]);
  const [names, setNames] = useState<Record<string, DisplayNames>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchItems();
  }, []);

  // Report the pending count to a host (e.g. the Users tab badge) on load and
  // after any dismiss/revoke changes the list.
  useEffect(() => {
    if (!isLoading) onCountChange?.(items.length);
  }, [items, isLoading, onCountChange]);

  const fetchItems = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const pending = await caregiversApi.getPendingAdminActionItems();
      setItems(pending);
      await fetchNames(pending);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load pending items.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNames = async (pending: AdminActionItem[]) => {
    const playerIds = Array.from(new Set(pending.map((i) => i.player_id).filter(Boolean))) as string[];
    const teamIds = Array.from(new Set(pending.map((i) => i.team_id).filter(Boolean))) as string[];
    const caregiverIds = Array.from(
      new Set(
        pending
          .map((i) => (typeof i.detail?.removed_caregiver_id === 'string' ? i.detail.removed_caregiver_id : null))
          .filter(Boolean)
      )
    ) as string[];
    const userIds = Array.from(new Set([...playerIds, ...caregiverIds]));

    const [usersResult, teamsResult] = await Promise.all([
      userIds.length > 0
        ? supabase.from('users').select('id, first_name, last_name').in('id', userIds)
        : Promise.resolve({ data: [], error: null }),
      teamIds.length > 0
        ? supabase.from('teams').select('id, name, age_group').in('id', teamIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const userNameById = new Map<string, string>();
    for (const u of usersResult.data ?? []) {
      userNameById.set(u.id, `${u.first_name} ${u.last_name}`);
    }
    const teamNameById = new Map<string, string>();
    for (const t of teamsResult.data ?? []) {
      teamNameById.set(t.id, [t.age_group, t.name].filter(Boolean).join(' '));
    }

    const next: Record<string, DisplayNames> = {};
    for (const item of pending) {
      const caregiverId =
        typeof item.detail?.removed_caregiver_id === 'string' ? item.detail.removed_caregiver_id : null;
      next[item.id] = {
        playerName: (item.player_id && userNameById.get(item.player_id)) || EMPTY_NAMES.playerName,
        teamName: (item.team_id && teamNameById.get(item.team_id)) || null,
        caregiverName: (caregiverId && userNameById.get(caregiverId)) || null,
      };
    }
    setNames(next);
  };

  const handleDismiss = async (item: AdminActionItem) => {
    if (!confirm('Dismiss this review with no action? The removal stands and nothing else changes.')) return;
    setActionError(null);
    setActioningId(item.id);
    try {
      await caregiversApi.dismissAdminActionItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not dismiss this item.');
    } finally {
      setActioningId(null);
    }
  };

  const handleRevoke = async (item: AdminActionItem) => {
    if (!item.player_id) return;
    const displayName = names[item.id]?.playerName ?? 'this child';
    if (
      !confirm(
        `Revoke ${displayName}'s device access? Their current device sign-in will stop working immediately. This does not add a replacement code.`
      )
    ) {
      return;
    }
    setActionError(null);
    setActioningId(item.id);
    try {
      await caregiversApi.revokeChildDeviceAccess(item.player_id, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not revoke device access.');
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {!embedded && (
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Caregiver Removal Reviews</h1>
          <p className="text-gray-600 mt-1">
            A caregiver was unlinked from a child. Decide whether to also revoke that child's device access, or leave
            it as-is.
          </p>
        </div>
      )}
      {embedded && (
        <p className="text-sm text-gray-600 mb-4">
          A caregiver was unlinked from a child. Decide whether to also revoke that child's device access, or leave
          it as-is.
        </p>
      )}

      {actionError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-800">{actionError}</p>
        </div>
      )}

      <div className="flex-1 bg-white rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : loadError ? (
          <div className="text-center py-12">
            <p className="text-red-600">{loadError}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">Nothing pending — every caregiver removal has been reviewed.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {items.map((item) => {
              const display = names[item.id] ?? EMPTY_NAMES;
              const removedAt =
                typeof item.detail?.removed_at === 'string' ? new Date(item.detail.removed_at) : null;
              const isBusy = actioningId === item.id;
              return (
                <li key={item.id} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div>
                    {item.kind === 'caregiver_removed_review' ? (
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{display.caregiverName ?? 'A caregiver'}</span> was removed
                        from <span className="font-medium">{display.playerName}</span>
                        {display.teamName ? ` (${display.teamName})` : ''}
                        {removedAt ? ` — ${removedAt.toLocaleString()}` : ''}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-900">
                        {item.kind} — {display.playerName}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleDismiss(item)}
                      disabled={isBusy}
                      className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                    >
                      No, leave it
                    </button>
                    <button
                      onClick={() => handleRevoke(item)}
                      disabled={isBusy || !item.player_id}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      {isBusy ? 'Working...' : 'Revoke device access'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
