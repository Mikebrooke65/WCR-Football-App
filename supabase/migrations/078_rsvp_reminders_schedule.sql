-- Migration 078: RSVP reminder push notifications — schedule + send-tracking
--
-- Spec: `.kiro/specs/v1.7-rsvp-availability/` (Piece B, Requirement B1-B5,
-- design.md B.1/B.3, tasks.md B4/B5). Locked decisions (confirmed
-- 2026-09-08): D-B1 24h lead time / hourly cadence targeting events in the
-- (24h, 25h] window; D-B3 `pg_cron` + `pg_net` invoking the
-- `send-rsvp-reminders` Edge Function.
--
-- This is Piece B's ONLY migration (078; Piece A's `subject_user_id` work
-- is 077, applied first and required — the "owes a response" logic here
-- depends on RSVP rows being attributed by `subject_user_id`, not
-- `user_id`). It does two things:
--   1. `rsvp_reminders_sent` — Requirement B4 (don't double-notify). One row
--      per (event, recipient, reminder window); the Edge Function checks
--      this before sending and inserts after. `reminder_window` is a text
--      value (not implicit) so a future second "last call" reminder
--      (V1.7's Deferred list) can share this table with its own window
--      value instead of colliding with today's single `'T-24h'` window.
--   2. The `pg_cron` schedule itself, calling `send-rsvp-reminders` via
--      `pg_net.http_post` — the exact same direct-pg_net pattern migration
--      042 already established for `send-message-push` (that migration's
--      header explains why: this project's dashboard Database Webhooks
--      feature doesn't work here). Reuses the same Vault `service_role_key`
--      secret 042 already required — if 042 has been applied, no new
--      manual step is needed here.
--
-- MANUAL STEP (only if migration 042 has NOT already been applied / the
-- Vault secret doesn't exist yet): store the service role key in Vault via
-- the SQL Editor, with YOUR_SERVICE_ROLE_KEY replaced with the real value
-- (Project Settings > API):
--
--   SELECT vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
--
-- MANUAL STEP (always required, this migration specifically): deploy the
-- Edge Function itself before — or immediately after — running this
-- migration; the cron job will error on each tick until it exists:
--
--   supabase functions deploy send-rsvp-reminders

-- ---------------------------------------------------------------------------
-- 1. rsvp_reminders_sent — Requirement B4
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rsvp_reminders_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reminder_window text NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),

  UNIQUE (event_id, user_id, reminder_window)
);

CREATE INDEX IF NOT EXISTS rsvp_reminders_sent_event_id_idx
  ON public.rsvp_reminders_sent(event_id);

-- This table is written and read only by send-rsvp-reminders under the
-- service role, which bypasses RLS entirely — enabling it with no policies
-- simply ensures nothing else (an authenticated app user, or `anon`) can
-- read or write it, matching this project's default-deny posture for
-- internal/operational tables.
ALTER TABLE public.rsvp_reminders_sent ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.rsvp_reminders_sent IS
  'Tracks which recipients have already been sent an RSVP reminder push for a given event + reminder window, so send-rsvp-reminders never double-notifies (Requirement B4). Written only by that Edge Function under the service role.';

-- ---------------------------------------------------------------------------
-- 2. Schedule send-rsvp-reminders hourly via pg_cron + pg_net.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.trigger_send_rsvp_reminders()
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
    RAISE WARNING 'service_role_key not found in Vault - send-rsvp-reminders not invoked this tick';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := project_url || '/functions/v1/send-rsvp-reminders',
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
-- expire_stale_child_consents()).
REVOKE EXECUTE ON FUNCTION public.trigger_send_rsvp_reminders() FROM PUBLIC;

-- Idempotent: unschedule any existing job of this name first, so re-running
-- this migration (or a future migration that changes the schedule) doesn't
-- error or leave duplicate jobs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-rsvp-reminders') THEN
    PERFORM cron.unschedule('send-rsvp-reminders');
  END IF;
END $$;

-- Hourly, on the hour. D-B1: this catches every event starting in the
-- (24h, 25h] window exactly once, since the window itself is 1 hour wide
-- and the schedule steps forward by the same 1 hour each tick.
SELECT cron.schedule(
  'send-rsvp-reminders',
  '0 * * * *',
  $$SELECT public.trigger_send_rsvp_reminders();$$
);

COMMENT ON FUNCTION public.trigger_send_rsvp_reminders() IS 'Calls the send-rsvp-reminders Edge Function via pg_net directly (same pattern as migration 042''s trigger_send_message_push), scheduled hourly by pg_cron. Service role key read from Vault, not hardcoded.';
