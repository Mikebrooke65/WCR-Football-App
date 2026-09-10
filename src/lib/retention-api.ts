import { ApiClient, ApiError } from './api-client';
import type { AdminActionItem } from '../types/database';

/**
 * Client data access for the Desktop "Data Retention & Privacy Assurance"
 * report (Piece C, `.kiro/specs/data-retention-privacy/`, design.md C.2,
 * tasks.md C2). All three methods read/write `admin_action_items` rows of
 * `kind = 'retention_candidate'`, the same table `caregivers-api.ts`'s
 * `getPendingAdminActionItems`/`dismissAdminActionItem` already use for a
 * different `kind` — same table, same admin-only RLS (migration 055), same
 * error-handling convention (`ApiError`).
 *
 * Name/role resolution against `users` is deliberately left to the page
 * component, mirroring `AdminActionItems.tsx`'s own `fetchNames` pattern,
 * rather than joined here.
 */
class RetentionApi extends ApiClient {
  /**
   * Every open (`pending`) retention candidate, oldest scrub date first
   * (C3). Sorted client-side rather than via a `detail->>` PostgREST order
   * clause — the row count here is small (a club-sized admin queue, not a
   * paginated table) and a plain client-side sort avoids relying on jsonb
   * path ordering syntax nothing else in this codebase uses yet.
   */
  async listRetentionCandidates(): Promise<AdminActionItem[]> {
    const { data, error } = await this.supabase
      .from('admin_action_items')
      .select('*')
      .eq('kind', 'retention_candidate')
      .eq('status', 'pending');

    if (error) throw new ApiError(error.message);
    const rows = (data ?? []) as AdminActionItem[];
    return rows.sort((a, b) => {
      const aAt = typeof a.detail?.scheduled_scrub_at === 'string' ? a.detail.scheduled_scrub_at : '';
      const bAt = typeof b.detail?.scheduled_scrub_at === 'string' ? b.detail.scheduled_scrub_at : '';
      return aAt.localeCompare(bAt);
    });
  }

  /**
   * Exempt a candidate for this cycle (C4). Per design.md B.4, this is
   * itself just an `admin_action_items` update — `status: 'actioned'`,
   * `actioned_by` set to the acting admin, `detail.outcome: 'exempted'`.
   * Because `listRetentionCandidates`/the monthly scan's Step 3/4 only ever
   * look for an existing *pending* row before opening a new one, an
   * exempted (now `actioned`) row doesn't block a fresh candidate next
   * month if the person is still eligible then — the "one-cycle snooze"
   * behaviour, with no extra status value needed.
   *
   * Takes the full row (not just an id) so the existing `detail` fields
   * (`clock`, `role_ended_at`, `scheduled_scrub_at`) are preserved rather
   * than clobbered by the update.
   */
  async exemptCandidate(item: AdminActionItem): Promise<void> {
    const {
      data: { user: authUser },
    } = await this.supabase.auth.getUser();
    if (!authUser) throw new ApiError('Not authenticated');

    const { error } = await this.supabase
      .from('admin_action_items')
      .update({
        status: 'actioned',
        actioned_by: authUser.id,
        actioned_at: new Date().toISOString(),
        detail: { ...(item.detail ?? {}), outcome: 'exempted' },
      })
      .eq('id', item.id);

    if (error) throw new ApiError(error.message);
  }

  /**
   * Reverse an exemption made moments ago in the same session (C5) —
   * puts the row back to `pending` with the same `detail` it had before
   * (minus the `outcome` key an exempt just added), so it looks exactly
   * like it did before the accidental click and next month's scan logic
   * treats it as still-open, not as a second exemption of an already-
   * exempted row.
   */
  async unexemptCandidate(item: AdminActionItem): Promise<void> {
    const { outcome: _outcome, ...detailWithoutOutcome } = item.detail ?? {};

    const { error } = await this.supabase
      .from('admin_action_items')
      .update({
        status: 'pending',
        actioned_by: null,
        actioned_at: null,
        detail: detailWithoutOutcome,
      })
      .eq('id', item.id);

    if (error) throw new ApiError(error.message);
  }

  /**
   * Recently-resolved candidates (C6) — auto-scrubbed, exempted, or found
   * no-longer-eligible on re-check, newest first. Gives the report an
   * assurance half ("here's what actually happened"), not just a to-do
   * list of what's still pending.
   */
  async listRecentlyActioned(limit = 20): Promise<AdminActionItem[]> {
    const { data, error } = await this.supabase
      .from('admin_action_items')
      .select('*')
      .eq('kind', 'retention_candidate')
      .eq('status', 'actioned')
      .order('actioned_at', { ascending: false })
      .limit(limit);

    if (error) throw new ApiError(error.message);
    return (data ?? []) as AdminActionItem[];
  }
}

export const retentionApi = new RetentionApi();
