-- Migration 079: caregivers can see the events of teams their children play on
--
-- Found live 2026-09-08 while testing V1.7 Piece A: Daddy Pig (caregiver of
-- George Pig, who is an active player on Open Riverhead Frogs) saw "No
-- upcoming events" on the Schedule page, while George himself — same club,
-- same event — saw both upcoming events fine.
--
-- Root cause: migration 023's `events` SELECT policy ("Users can view events
-- targeted to them") resolves team targeting as
--
--   exists (select 1 from public.team_members
--            where team_members.user_id = auth.uid()
--              and team_members.team_id = any(target_teams))
--
-- — i.e. it requires the REQUESTING user to have their own `team_members`
-- row on a target team. A caregiver never has one; only their linked child
-- does. So every event scoped to a team is invisible to a pure caregiver.
--
-- This is exactly the bug migration 060 fixed for the `teams` table on
-- 2026-08-28 (a caregiver seeing "You are not a member of any team yet"),
-- caused by the same membership-only shape. `events` was never given the
-- matching treatment, and nobody noticed because every caregiver tested
-- until now ALSO held a coach/manager row on the team, which satisfied the
-- existing clause and masked the gap.
--
-- Why this matters beyond one screen: V1.7 Piece A exists so that a
-- caregiver can RSVP on behalf of each of their children. Its identity
-- resolution explicitly supports "a pure caregiver with no membership on
-- this team gets one identity per child, no self" (`rsvp-identities.ts`,
-- and a unit test for that exact case) — but that path was unreachable in
-- the live app, because the event was hidden before any of that logic ran.
-- Piece A's primary use case, a parent who is not also a coach, did not
-- work at all.
--
-- APPROACH — additive, not a rewrite. The existing policy has several OR
-- branches (admin, untargeted, target_roles, target_teams, divisions, age
-- groups). Rather than DROP and recreate it — which risks silently losing
-- a branch, and this database's policies have drifted from the committed
-- migrations before (see 060's own header, and 057) — this adds a SECOND
-- permissive SELECT policy. Postgres ORs permissive policies for the same
-- command, so the existing policy is untouched and access can only widen.
--
-- Deliberately a plain EXISTS rather than a SECURITY DEFINER helper: this
-- is the identical shape migration 060 has been running in production
-- since August, which proves `player_caregivers` and `team_members` are
-- both readable from inside a policy's USING clause by the caregiver. No
-- recursion risk either — this policy is on `events` and touches neither
-- `events` nor itself.
--
-- NOT NEEDED (verified 2026-09-08, listed so nobody re-adds them):
--   * `event_rsvps` SELECT — migration 023's "Users can view RSVPs for
--     visible events" is `exists (select 1 from public.events where
--     events.id = event_rsvps.event_id)`, and that inner select is itself
--     subject to the events policy. So the moment the event becomes
--     visible here, the caregiver can read every RSVP row on it —
--     including their child's, whoever submitted it.
--   * `event_rsvps` INSERT/UPDATE — migration 077 already permits a
--     caregiver to write a row whose `subject_user_id` is a linked child.
--   * `team_members` SELECT — already open ("Allow authenticated users to
--     read team members"), so roster lookups already work for caregivers.
--
-- Run manually in the Supabase SQL Editor.

CREATE POLICY "Caregivers can view events for their children's teams"
  ON public.events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_members tm
      JOIN public.player_caregivers pc ON pc.player_id = tm.user_id
      WHERE tm.team_id = ANY(events.target_teams)
        AND pc.caregiver_id = auth.uid()
    )
  );

COMMENT ON POLICY "Caregivers can view events for their children's teams" ON public.events IS
  'Additive to migration 023''s "Users can view events targeted to them", which only matches a user''s OWN team_members row and so hid every team event from a caregiver. Mirrors migration 060''s fix for the teams table. Required for V1.7 Piece A (caregiver multi-child RSVP) to work for a caregiver who is not also a coach/manager.';
