-- Migration 080: a caregiver must be able to CHANGE a child's existing RSVP
--                (and a child must be able to change one made for them)
--
-- Found live 2026-09-08, immediately after 079 opened up event visibility:
-- George Pig answered "Can't Go" himself, then Daddy Pig (his caregiver)
-- tried to change it to "Going" and got
--
--   new row violates row-level security policy (USING expression)
--   for table "event_rsvps"
--
-- Cause — migration 077's policy, which this replaces:
--
--   USING      (user_id = auth.uid())
--   WITH CHECK (user_id = auth.uid() AND (subject_user_id = auth.uid()
--               OR <caregiver linked to subject_user_id>))
--
-- The WITH CHECK is right: it decides what you may WRITE, and correctly
-- permits a caregiver to write a row about their linked child. But USING
-- decides which EXISTING rows you may see and modify, and it only ever
-- matched rows you submitted yourself. `setRsvp` upserts on
-- (event_id, subject_user_id), so changing an answer is an UPDATE of
-- whatever row already exists for that person — and that row belongs to
-- whoever answered first.
--
-- So the RSVP effectively became owned by whoever got there first:
--   * child answers first  -> caregiver can never change it  (the live error)
--   * caregiver answers first -> CHILD can never change their own answer
--
-- That second case is the mirror image and was equally broken, just not
-- hit tonight. Both are fixed here.
--
-- The new USING matches a row if ANY of these hold:
--   1. you submitted it            (unchanged from 077)
--   2. it is ABOUT you             (so a child can always manage their own
--                                   RSVP, even one a caregiver created)
--   3. it is about a child linked to you via player_caregivers
--
-- WITH CHECK is deliberately UNCHANGED from 077. It is the clause that
-- actually constrains what can be written, and it is already correct:
-- `user_id` must be the caller (so the audit trail cannot be forged) and
-- the subject must be the caller or one of their linked children. Widening
-- USING does not widen what anyone can write — only which existing rows
-- they may act on, and every branch above is a row they are legitimately
-- party to.
--
-- Verified on a local Postgres 16 instance reproducing both policies and
-- the real data shape (see the session notes): before, a caregiver updating
-- a child-created row fails with the exact error above and a child updating
-- a caregiver-created row fails likewise; after, both succeed, while an
-- unrelated user still cannot see or touch either row.
--
-- Run manually in the Supabase SQL Editor.

DROP POLICY IF EXISTS "Users can manage their own or their children's RSVPs"
  ON public.event_rsvps;

CREATE POLICY "Users can manage their own or their children's RSVPs"
  ON public.event_rsvps
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    OR subject_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.player_caregivers pc
      WHERE pc.caregiver_id = auth.uid()
        AND pc.player_id = subject_user_id
    )
  )
  WITH CHECK (
    user_id = auth.uid() AND (
      subject_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.player_caregivers pc
        WHERE pc.caregiver_id = auth.uid()
          AND pc.player_id = subject_user_id
      )
    )
  );

COMMENT ON POLICY "Users can manage their own or their children's RSVPs" ON public.event_rsvps IS
  'Replaces migration 077''s version, whose USING clause only matched rows the caller submitted — so whoever answered first owned the RSVP and nobody else could change it (a caregiver could not update a child-created row, and vice versa). USING now also matches rows ABOUT the caller or about a linked child. WITH CHECK is unchanged: user_id must still be the caller, and the subject must be the caller or their linked child.';
