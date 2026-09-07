-- Migration 076: Let an anonymous invite visitor read club branding and the
-- name of the competition their invite points at
--
-- Spec: V1.6 "Invite Landing Page — Branding & Context" (NEXT-SESSION-NOTES).
--
-- WHY
-- The invite landing page (`LiteLandingPage.tsx`) renders for an anonymous
-- visitor BEFORE they register — they've only clicked a link. V1.6 wants that
-- page to show the club's logo/name/colour and the competition they're joining,
-- so it looks legitimate and orients the person. But:
--   1. `club_settings` (migration 046) is `authenticated`-only — so
--      `useClubBranding()` returns nothing for an anon visitor and the page
--      shows no branding at all.
--   2. `competitions` has no anon policy, so the `competition:competitions(name)`
--      embed in `validateInviteCode()` comes back NULL for an anon visitor.
--
-- This mirrors migration 045, which had to do the same for `teams` so the team
-- name would render on this very page.
--
-- WHAT
-- 1. Anon SELECT on `club_settings`. Unscoped, because it is a single-row table
--    holding only inherently public-facing branding (club name, colour, logo,
--    app URL) — the values a club shows the world. Nothing sensitive; the
--    existing authenticated read + admin-only write policies (migration 046)
--    are untouched.
-- 2. Anon SELECT on `competitions`, NARROWED (like migration 045's teams policy)
--    to only competitions referenced by a live (unredeemed, unexpired) invite
--    code. So an anonymous visitor can read a competition row only while a live
--    invitation naming it exists, and never the rest of the club's competitions.
--
-- SAFE BECAUSE
-- - SELECT only — no INSERT/UPDATE/DELETE for anon on either table.
-- - club_settings is public-facing branding by definition.
-- - competitions is restricted by EXISTS to those with a live invite, i.e. it
--   reveals only the name of a competition the visitor was already invited to.
-- - Existing authenticated/admin policies are left in place.
--
-- Run manually in the Supabase SQL Editor.

-- 1. Public-facing club branding, readable by anyone (incl. anon invite pages).
CREATE POLICY "Allow anon users to read club branding"
  ON public.club_settings
  FOR SELECT
  TO anon
  USING (true);

-- 2. The ONE competition an invite points at, readable only while a live
--    invite referencing it exists (mirrors migration 045's teams policy).
CREATE POLICY "Allow anon users to read competitions with a live invite"
  ON public.competitions
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.invite_codes ic
      WHERE ic.competition_id = competitions.id
        AND ic.redeemed_by IS NULL
        AND ic.expires_at > now()
    )
  );

-- Keeps the EXISTS check above cheap.
CREATE INDEX IF NOT EXISTS invite_codes_competition_id_idx
  ON public.invite_codes(competition_id);
