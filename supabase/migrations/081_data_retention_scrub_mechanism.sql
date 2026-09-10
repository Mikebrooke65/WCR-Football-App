-- Migration 081: Data Retention & Privacy Assurance (V1.R Part 2) — schema
--
-- Spec: `.kiro/specs/data-retention-privacy/` (design.md A.1/A.2/A.3/B.1/B.3,
-- tasks.md A1/B3). Everything Piece A and Piece B need in one file, per
-- design.md's own note that A.1 and B.1 are "the same migration."
--
-- Four things:
--   1. `users.retired_at` / `users.role_ended_at` — the scrub marker and the
--      "currently roleless since" clock (A.1).
--   2. `player_caregivers.inactive_at` — lets a scrubbed child's caregiver
--      link be marked inactive in place rather than deleted, since the
--      table's own `ON DELETE CASCADE` never fires under this mechanism
--      (nothing is ever actually deleted) — see design.md A.2's caregiver
--      detail, option 1.
--   3. `user_holds_active_role()` — one SECURITY DEFINER function reused by
--      both Piece A's caregiver-link step and Piece B's monthly eligibility
--      scan (design.md A.3). Fixes a real gap in requirements.md's B2: a
--      pure caregiver structurally never has a `team_members` row (V1.R
--      Part 1), so a bare `team_members` check alone would treat every
--      caregiver of a still-active child as instantly roleless. This
--      function also counts a caregiver as role-holding for as long as at
--      least one linked, non-inactive child is still on a team.
--   4. `admin_action_items_kind_status_idx` — supports Piece B's scan
--      queries and Piece C's report queries, both of which filter on
--      `(kind, status)` (design.md B.1).
--   5. `pg_cron` scheduling for the monthly `retention-scan` Edge Function
--      (design.md B.3), mirroring migration 078's `send-rsvp-reminders`
--      pattern exactly (`trigger_send_rsvp_reminders` -> here
--      `trigger_retention_scan`), reusing the same Vault `service_role_key`
--      secret migrations 042/078 already require — no new manual Vault step
--      if either of those has been applied.
--
-- MANUAL STEP (only if neither 042 nor 078 has been applied / the Vault
-- secret doesn't exist yet): store the service role key in Vault via the
-- SQL Editor, with YOUR_SERVICE_ROLE_KEY replaced with the real value
-- (Project Settings > API):
--
--   SELECT vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
--
-- MANUAL STEP (always required, this migration specifically): deploy the
-- `retention-scan` Edge Function itself before — or immediately after —
-- running this migration; the cron job will error on each tick until it
-- exists:
--
--   supabase functions deploy retention-scan
--
-- Run manually in the Supabase SQL Editor, not `supabase db push`.

-- ---------------------------------------------------------------------------
-- 1. users — the scrub marker and the role-ended clock.
-- ---------------------------------------------------------------------------

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS role_ended_at timestamptz;

COMMENT ON COLUMN public.users.retired_at IS
  'Set once this row''s PII has been scrubbed by the retention job (Piece A, data-retention-privacy spec). NULL = never retired. Distinct from `active`, which has other, older meanings.';
COMMENT ON COLUMN public.users.role_ended_at IS
  'When this user was last observed holding zero active roles (see Piece B''s monthly recompute in the retention-scan Edge Function). NULL = currently holds a role. Cleared back to NULL the moment they hold one again. The retention job''s 12-month clock is measured from this timestamp, not from any single team_members row.';

-- ---------------------------------------------------------------------------
-- 2. player_caregivers — mark a link inactive rather than deleting it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.player_caregivers
  ADD COLUMN IF NOT EXISTS inactive_at timestamptz;

COMMENT ON COLUMN public.player_caregivers.inactive_at IS
  'Set when the linked player is scrubbed by the retention job (Piece A), in the same pass as the player''s own users row is scrubbed. NULL = link still active. Keeps an audit trail of who used to care for whom rather than deleting the row — player_caregivers.ON DELETE CASCADE never fires under this mechanism, since nothing is ever hard-deleted.';

-- ---------------------------------------------------------------------------
-- 3. user_holds_active_role() — shared "does this person hold a role" check.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_holds_active_role(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members WHERE user_id = p_user_id
  ) OR EXISTS (
    -- A caregiver "holds a role" for as long as at least one child they
    -- care for is themselves still on a team. Without this, a pure
    -- caregiver (no team_members row of their own, by design) would look
    -- instantly roleless the moment Piece B's scan runs, even while
    -- actively caring for a rostered child.
    SELECT 1 FROM public.player_caregivers pc
    JOIN public.team_members tm ON tm.user_id = pc.player_id
    WHERE pc.caregiver_id = p_user_id AND pc.inactive_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.user_holds_active_role(uuid) IS
  'True if p_user_id has any team_members row of their own, or is the non-inactive caregiver of at least one player who has a team_members row. Shared by Piece A (caregiver-link clearing) and Piece B (monthly eligibility scan) of the data-retention-privacy spec — the actual eligibility test used, not a raw team_members count.';

-- This is a read-only helper meant to be called from other SECURITY
-- DEFINER functions and Edge Functions under the service role, not
-- queried directly as an RPC by ordinary users. It exposes no data beyond
-- a boolean and only ever reads team_members/player_caregivers (already
-- broadly readable per those tables' own RLS), so there is no privilege-
-- escalation concern in leaving the default PUBLIC execute grant here —
-- unlike 058's expire_stale_child_consents() or 078's
-- trigger_send_rsvp_reminders(), this function has no side effects to
-- protect against being called early/out of turn.

-- ---------------------------------------------------------------------------
-- 4. admin_action_items — index for Piece B's scan and Piece C's report.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS admin_action_items_kind_status_idx
  ON public.admin_action_items(kind, status);

-- ---------------------------------------------------------------------------
-- 5. Schedule retention-scan monthly via pg_cron + pg_net.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.trigger_retention_scan()
RETURNS void AS $$
DECLARE
  project_url TEXT := 'https://pikrxkxpizdezazlwxhb.supabase.co';
  service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF service_key IS NULL THEN
    RAISE WARNING 'service_role_key not found in Vault - retention-scan not invoked this tick';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/retention-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, net;

-- Maintenance function invoked only by the cron schedule below, not by app
-- users — close off the default PUBLIC execute grant PostgREST/Supabase
-- would otherwise expose as an RPC endpoint (same reasoning as 058's
-- expire_stale_child_consents() and 078's trigger_send_rsvp_reminders()).
-- This one matters even more than those two: it's what ultimately causes
-- real PII scrubs, so nothing should be able to invoke it early.
REVOKE EXECUTE ON FUNCTION public.trigger_retention_scan() FROM PUBLIC;

-- Idempotent: unschedule any existing job of this name first, so re-running
-- this migration (or a future migration that changes the schedule) doesn't
-- error or leave duplicate jobs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention-scan') THEN
    PERFORM cron.unschedule('retention-scan');
  END IF;
END $$;

-- Monthly, 04:00 UTC on the 1st — outside any club's typical evening hours
-- in any timezone this club operates in, matching migration 058's reasoning
-- for its own off-hours slot. Design.md B.1/B.3: the review-and-grace
-- window (30 days) is itself month-scale, so one monthly tick can both
-- close out last cycle's due candidates and open this cycle's new ones —
-- no separate "process expirations" job is needed.
SELECT cron.schedule(
  'retention-scan',
  '0 4 1 * *',
  $$SELECT public.trigger_retention_scan();$$
);

COMMENT ON FUNCTION public.trigger_retention_scan() IS 'Calls the retention-scan Edge Function via pg_net directly (same pattern as migration 078''s trigger_send_rsvp_reminders), scheduled monthly by pg_cron. Service role key read from Vault, not hardcoded.';
