-- Migration 077: caregiver multi-child RSVP — subject_user_id
--
-- Spec: `.kiro/specs/v1.7-rsvp-availability/` (Piece A, Requirement A5/A7,
-- design.md A.1)
--
-- Run manually in the Supabase SQL Editor.
--
-- `event_rsvps` currently has `unique(event_id, user_id)` (migration 023),
-- so one logged-in user can hold exactly one RSVP per event. A caregiver
-- with two children on a team can't RSVP separately for each child — they
-- need to respond per person, not per login.
--
-- `subject_user_id` records who the RSVP is ABOUT: equal to `user_id` for a
-- normal self-RSVP, or the child's `users.id` when a caregiver responds on
-- their behalf. `user_id` keeps its existing meaning — "who actually
-- submitted this" — for audit. Uniqueness moves from (event_id, user_id) to
-- (event_id, subject_user_id), so one caregiver login can hold several RSVP
-- rows for one event (one per child, plus their own if they're also a
-- player/coach on that team).

-- 1. Add the column, default every existing row to a self-RSVP (the only
--    kind that existed before this migration), then lock it down.
ALTER TABLE public.event_rsvps
  ADD COLUMN IF NOT EXISTS subject_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE;

UPDATE public.event_rsvps SET subject_user_id = user_id WHERE subject_user_id IS NULL;

ALTER TABLE public.event_rsvps ALTER COLUMN subject_user_id SET NOT NULL;

-- 2. Move uniqueness from (event_id, user_id) to (event_id, subject_user_id).
ALTER TABLE public.event_rsvps
  DROP CONSTRAINT IF EXISTS event_rsvps_event_id_user_id_key;

ALTER TABLE public.event_rsvps
  ADD CONSTRAINT event_rsvps_event_subject_key UNIQUE (event_id, subject_user_id);

CREATE INDEX IF NOT EXISTS event_rsvps_subject_user_id_idx
  ON public.event_rsvps(subject_user_id);

-- 3. RLS guard (Requirement A7): the existing "Users can manage their own
--    RSVPs" policy's WITH CHECK only verified `user_id = auth.uid()` — the
--    submitter — which stays true for a caregiver writing a child's RSVP
--    (they ARE the submitter), but on its own would let a caregiver write
--    ANY subject_user_id, not just their own linked children. Replace the
--    policy so subject_user_id must be either the submitter themselves, or
--    a child actually linked to them via player_caregivers, checked
--    server-side rather than only trusted from the client.
DROP POLICY IF EXISTS "Users can manage their own RSVPs" ON public.event_rsvps;

CREATE POLICY "Users can manage their own or their children's RSVPs"
  ON public.event_rsvps
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid() AND (
      subject_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.player_caregivers pc
        WHERE pc.caregiver_id = auth.uid() AND pc.player_id = subject_user_id
      )
    )
  );

COMMENT ON COLUMN public.event_rsvps.subject_user_id IS
  'Who this RSVP is ABOUT (self, or a linked child when a caregiver responds on their behalf). user_id stays "who submitted it," for audit. Added V1.7 Piece A — see .kiro/specs/v1.7-rsvp-availability/.';
