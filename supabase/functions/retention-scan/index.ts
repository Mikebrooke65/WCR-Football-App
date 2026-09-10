// Edge Function: retention-scan
//
// Spec: `.kiro/specs/data-retention-privacy/` (V1.R Part 2, Piece A + Piece
// B, design.md A.2/B.2, tasks.md A3/A4/B1). One monthly run does both
// halves of the job: closing out last cycle's due candidates (and actually
// scrubbing the ones nobody exempted) and opening this cycle's new ones.
//
// SECURITY — why `scrubUser` is a plain internal function here and NOT its
// own `Deno.serve` endpoint (design.md's "Review pass (2026-09-10)",
// finding 1): the original draft of this spec had `scrub-user` as a
// separately deployed, separately callable function taking an arbitrary
// `userId`. This project's Edge Functions rely on Supabase's default
// `verify_jwt` — which accepts *any* validly-signed JWT, not specifically
// the service role's (see `create-user/config.toml`, the one function that
// opts out of this, and `send-rsvp-reminders`, which accepts the same
// default and is judged tolerable there — worst case, an early,
// de-duplicated push). That tradeoff is NOT tolerable for a function that
// forces a real PII scrub: any signed-in user could have called
// `scrub-user` directly on *anyone's* account, no admin involved. Folding
// the logic into `retentionScan()` as a plain function with no second HTTP
// endpoint removes that attack surface by construction — there is no
// legitimate caller of `scrubUser` other than this file's own
// `retentionScan()`. `retentionScan()` itself keeps the same default
// `verify_jwt` as `send-rsvp-reminders`, for the same reason it's
// acceptable there: it takes no request body naming a specific person, so
// the worst case of an early/out-of-turn call is an early scan tick, not a
// targeted scrub of anyone in particular. If a future "scrub this specific
// person right now" admin action is ever added to Piece C, THAT would need
// its own function with an explicit admin-role check on the caller — out
// of scope today (Piece C is view + exempt only, no manual trigger).
//
// AUTH-SIDE WARNING — never call `admin.auth.admin.deleteUser()` anywhere
// in this file. `auth.users -> public.users` is `ON DELETE CASCADE`
// (migration 001), so deleting the auth user would cascade into deleting
// the `public.users` row, which immediately hits every FK violation this
// whole mechanism exists to avoid (`messages.sender_id`,
// `game_feedback.created_by`/`player_id`, substitution columns, etc.). The
// only sanctioned way to make a scrubbed person's real email/phone
// available again is `updateUserById`, which is what `scrubUser` below
// does. No login ban either (decided 2026-09-10, design.md "Key finding")
// — a scrubbed person can sign back in / re-register immediately; a rejoin
// naturally lands on a brand-new auth.users/public.users row anyway, since
// the real email/phone freed up by the scrub are what a rejoin signs up
// with.
//
// Requires (set via `supabase secrets set`; SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected automatically):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// DEPLOYMENT: Edge Functions do NOT ship with `git push`. This call fails
// until `supabase functions deploy retention-scan` has been run. Migration
// 081's `pg_cron` job then invokes it monthly (04:00 UTC on the 1st) via
// `pg_net`, the same direct-`pg_net` pattern migration 078 uses for
// `send-rsvp-reminders` — reusing the same Vault `service_role_key` secret,
// no new manual step if 042/078 has already been applied.

import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Edge Functions in this project have no shared/`_shared` directory
// (confirmed elsewhere in this codebase, e.g. `send-rsvp-reminders`'s own
// header), so `admin` below is left loosely typed rather than importing
// the full generated Database type — matches this project's existing
// convention (see `send-rsvp-reminders`'s `processEvent(supabase: any, ...)`).
// deno-lint-ignore no-explicit-any
type AdminClient = any;

interface ScrubResult {
  scrubbed?: true;
  skipped?: 'not-found' | 'admin' | 'already-retired';
}

/**
 * Scrub-in-place mechanism (Piece A, design.md A.2, tasks.md A3). Called
 * only from `resolveDueCandidates` below — see the SECURITY note at the
 * top of this file for why this is not its own endpoint. Idempotent (A4):
 * re-running this on an already-retired or admin row is a safe no-op.
 */
async function scrubUser(admin: AdminClient, userId: string): Promise<ScrubResult> {
  const { data: user, error: userError } = await admin
    .from('users')
    .select('id, role, retired_at')
    .eq('id', userId)
    .maybeSingle();
  if (userError) throw userError;
  if (!user) return { skipped: 'not-found' };
  if (user.role === 'admin') return { skipped: 'admin' }; // A7
  if (user.retired_at) return { skipped: 'already-retired' }; // A4

  // A5 — clear this person's caregiver links FIRST, while their player_id
  // still resolves to a real row (order matters — do this before the
  // `users` UPDATE below, not after). The `inactive_at IS NULL` guard is
  // what makes a second pass over an already-cleared link a no-op (A4).
  const { error: linkError } = await admin
    .from('player_caregivers')
    .update({ inactive_at: new Date().toISOString() })
    .eq('player_id', userId)
    .is('inactive_at', null);
  if (linkError) throw linkError;

  // A1-A3 — scrub the public.users row. The placeholder email is
  // collision-proof by construction (keyed on the row's own id), so it
  // satisfies `users.email`'s UNIQUE NOT NULL constraint without ever
  // colliding with a real signup or a different retired row (A3).
  const placeholderEmail = `retired-${userId}@deleted.invalid`;
  const { error: scrubError } = await admin
    .from('users')
    .update({
      first_name: 'Former',
      last_name: 'Member',
      email: placeholderEmail,
      cellphone: null,
      date_of_birth: null,
      active: false, // matches migration 058's convention on auto-deny
      retired_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (scrubError) throw scrubError;

  // Auth-side (see file header) — service-role only, which is why this
  // step has to live here rather than in a SQL function.
  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: placeholderEmail,
    phone: null,
    user_metadata: {},
  });
  if (authError) throw authError;

  return { scrubbed: true };
}

/**
 * Step 1 (design.md B.2): resolve every `retention_candidate` whose grace
 * window has closed. A defensive re-check of `user_holds_active_role`
 * covers "they rejoined during the grace window" with no separate
 * cancellation path needed (B7) — if they're still eligible, scrub; if
 * not, mark `no_longer_eligible` and move on. A per-row failure is logged
 * and the row is left `pending` rather than aborting the whole batch — a
 * later tick (or a manually retriggered one) will pick it up again (B7).
 */
async function resolveDueCandidates(admin: AdminClient) {
  const now = Date.now();
  const { data: due, error } = await admin
    .from('admin_action_items')
    .select('id, player_id, detail')
    .eq('kind', 'retention_candidate')
    .eq('status', 'pending');
  if (error) throw error;

  let scrubbed = 0;
  let noLongerEligible = 0;
  let errors = 0;
  let notYetDue = 0;

  for (const row of (due || []) as { id: string; player_id: string | null; detail: Record<string, unknown> | null }[]) {
    const scheduledScrubAtRaw = row.detail?.scheduled_scrub_at;
    const scheduledScrubAt = typeof scheduledScrubAtRaw === 'string' ? new Date(scheduledScrubAtRaw) : null;
    if (!scheduledScrubAt || Number.isNaN(scheduledScrubAt.getTime()) || scheduledScrubAt.getTime() > now) {
      notYetDue++;
      continue;
    }
    if (!row.player_id) continue; // defensive — shouldn't happen for this kind

    try {
      const { data: holdsRole, error: rpcError } = await admin.rpc('user_holds_active_role', {
        p_user_id: row.player_id,
      });
      if (rpcError) throw rpcError;

      if (holdsRole) {
        const { error: updateError } = await admin
          .from('admin_action_items')
          .update({
            status: 'actioned',
            actioned_at: new Date().toISOString(),
            actioned_by: null,
            detail: { ...(row.detail || {}), outcome: 'no_longer_eligible' },
          })
          .eq('id', row.id);
        if (updateError) throw updateError;
        noLongerEligible++;
        continue;
      }

      const result = await scrubUser(admin, row.player_id);
      const { error: updateError } = await admin
        .from('admin_action_items')
        .update({
          status: 'actioned',
          // NULL actioned_by = system-actioned, distinguishing an
          // automatic scrub from an admin's own exemption (B4/B8).
          actioned_by: null,
          actioned_at: new Date().toISOString(),
          detail: {
            ...(row.detail || {}),
            outcome: result.scrubbed ? 'auto_scrubbed' : `skipped_${result.skipped}`,
          },
        })
        .eq('id', row.id);
      if (updateError) throw updateError;
      scrubbed++;
    } catch (err) {
      console.error(`retention-scan: failed to resolve candidate ${row.id} (player ${row.player_id})`, err);
      errors++;
    }
  }

  return { checked: (due || []).length, scrubbed, noLongerEligible, notYetDue, errors };
}

/**
 * Step 2 (design.md B.2): recompute `role_ended_at` for every non-admin,
 * non-retired user. No triggers on `team_members`/`player_caregivers` —
 * recomputing fresh each month is simpler and robust to every existing
 * removal code path without needing each one updated to also maintain a
 * timestamp. Both directions are guarded on `retired_at IS NULL` (review
 * pass finding 3) even though a retired row shouldn't organically regain a
 * `team_members` row.
 */
async function recomputeRoleEndedAt(admin: AdminClient) {
  const { data: candidates, error } = await admin
    .from('users')
    .select('id, role_ended_at')
    .neq('role', 'admin')
    .is('retired_at', null);
  if (error) throw error;

  const toSet: string[] = [];
  const toClear: string[] = [];

  for (const u of (candidates || []) as { id: string; role_ended_at: string | null }[]) {
    const { data: holdsRole, error: rpcError } = await admin.rpc('user_holds_active_role', {
      p_user_id: u.id,
    });
    if (rpcError) throw rpcError;

    if (!holdsRole && u.role_ended_at === null) {
      toSet.push(u.id);
    } else if (holdsRole && u.role_ended_at !== null) {
      toClear.push(u.id);
    }
  }

  if (toSet.length > 0) {
    const { error: setError } = await admin
      .from('users')
      .update({ role_ended_at: new Date().toISOString() })
      .in('id', toSet)
      .is('retired_at', null);
    if (setError) throw setError;
  }
  if (toClear.length > 0) {
    const { error: clearError } = await admin
      .from('users')
      .update({ role_ended_at: null })
      .in('id', toClear)
      .is('retired_at', null);
    if (clearError) throw clearError;
  }

  return { set: toSet.length, cleared: toClear.length };
}

/** ISO timestamp `days` days from now. */
function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** ISO timestamp `days` days ago. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Step 3 (design.md B.2): open new candidates for the standard population
 * — zero active roles for 12 months. Excludes anyone with an existing
 * *pending* candidate row only (not `pending` or `actioned`) — this is
 * what makes an admin's exemption a one-cycle snooze rather than
 * permanent (B4), for free, with no extra status value needed.
 */
async function openStandardCandidates(admin: AdminClient): Promise<number> {
  const cutoff = daysAgoIso(365); // "12 months" per design.md B.2 — a fixed day-count, same as B.2's own interval literal

  const { data: pending, error: pendingError } = await admin
    .from('admin_action_items')
    .select('player_id')
    .eq('kind', 'retention_candidate')
    .eq('status', 'pending');
  if (pendingError) throw pendingError;
  const alreadyPending = new Set((pending || []).map((r: { player_id: string | null }) => r.player_id));

  const { data: eligible, error: eligibleError } = await admin
    .from('users')
    .select('id, role_ended_at')
    .neq('role', 'admin')
    .is('retired_at', null)
    .not('role_ended_at', 'is', null)
    .lte('role_ended_at', cutoff);
  if (eligibleError) throw eligibleError;

  const newCandidates = ((eligible || []) as { id: string; role_ended_at: string }[]).filter(
    (u) => !alreadyPending.has(u.id)
  );
  if (newCandidates.length === 0) return 0;

  const scheduledScrubAt = daysFromNowIso(30);
  const rows = newCandidates.map((u) => ({
    kind: 'retention_candidate',
    player_id: u.id,
    status: 'pending',
    detail: {
      clock: 'standard',
      role_ended_at: u.role_ended_at,
      scheduled_scrub_at: scheduledScrubAt,
    },
  }));

  const { error: insertError } = await admin.from('admin_action_items').insert(rows);
  if (insertError) throw insertError;
  return rows.length;
}

/**
 * Step 4 (design.md B.2): open new candidates for orphaned pending
 * children — an add-a-junior invite migration 058 auto-denied (its own
 * 30-day threshold) and nobody has responded to in a further 90 days
 * (design's confirmed Option A clock, measured from migration 058's
 * auto-deny via `responded_at`, not the original invite — ~120 days total
 * from the original unanswered invite to the scrub).
 *
 * **Review pass finding 2**: excludes only an existing *pending* row,
 * matching Step 3 exactly. requirements.md's original draft excluded
 * pending/actioned both, which would have made an admin's exemption of an
 * orphaned child accidentally permanent — unlike every other population's
 * one-cycle-snooze behaviour (B4). Fixed here.
 */
async function openOrphanedChildCandidates(admin: AdminClient): Promise<number> {
  const cutoff = daysAgoIso(90);

  const { data: orphaned, error: orphanedError } = await admin
    .from('caregiver_approvals')
    .select('player_id, responded_at')
    .eq('request_kind', 'add_child')
    .eq('status', 'denied')
    .is('responded_by', null) // distinguishes migration 058's auto-deny from a human's explicit decline
    .not('responded_at', 'is', null)
    .lte('responded_at', cutoff);
  if (orphanedError) throw orphanedError;
  if (!orphaned || orphaned.length === 0) return 0;

  const { data: pending, error: pendingError } = await admin
    .from('admin_action_items')
    .select('player_id')
    .eq('kind', 'retention_candidate')
    .eq('status', 'pending');
  if (pendingError) throw pendingError;
  const alreadyPending = new Set((pending || []).map((r: { player_id: string | null }) => r.player_id));

  const scheduledScrubAt = daysFromNowIso(30);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>(); // defensive dedupe — a child could in principle have >1 stale denied add_child row

  for (const row of orphaned as { player_id: string; responded_at: string }[]) {
    if (!row.player_id || alreadyPending.has(row.player_id) || seen.has(row.player_id)) continue;

    // Re-check in case they were added to a different team since (B.2 Step 4).
    const { data: holdsRole, error: rpcError } = await admin.rpc('user_holds_active_role', {
      p_user_id: row.player_id,
    });
    if (rpcError) throw rpcError;
    if (holdsRole) continue;

    seen.add(row.player_id);
    rows.push({
      kind: 'retention_candidate',
      player_id: row.player_id,
      status: 'pending',
      detail: {
        clock: 'orphaned_child',
        // No `role_ended_at` on this population in the same sense as the
        // standard clock — `responded_at` (migration 058's auto-deny) is
        // the equivalent "when the clock started" value for display.
        role_ended_at: row.responded_at,
        scheduled_scrub_at: scheduledScrubAt,
      },
    });
  }

  if (rows.length === 0) return 0;
  const { error: insertError } = await admin.from('admin_action_items').insert(rows);
  if (insertError) throw insertError;
  return rows.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const dueResolution = await resolveDueCandidates(admin);
    const recompute = await recomputeRoleEndedAt(admin);
    const newStandardCandidates = await openStandardCandidates(admin);
    const newOrphanedCandidates = await openOrphanedChildCandidates(admin);

    return json({
      success: true,
      dueResolution,
      recompute,
      newStandardCandidates,
      newOrphanedCandidates,
    });
  } catch (error) {
    console.error('retention-scan error:', error);
    return json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500);
  }
});
