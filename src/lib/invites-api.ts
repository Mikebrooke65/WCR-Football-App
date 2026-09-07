import { ApiClient, ApiError } from './api-client';
import { emailApi } from './email-api';
import { formatTeamLabel } from './success-screen-logic';
import type { RedeemInviteResult } from './success-screen-logic';
import type {
  InviteCode,
  InviteCodeValidation,
  LiteRegistrationData,
  InvitePlayerData,
  Team,
} from '../types/database';

// The Success Screen and this wrapper share one result shape. It lives in
// `success-screen-logic` (where its pure consumers are tested); re-exported here
// so callers can import it alongside `invitesApi` without redefining it.
export type { RedeemInviteResult };

/** Generate a random alphanumeric code */
function generateCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

class InvitesApi extends ApiClient {
  /**
   * Generate a new invite code for a team, optionally linked to a competition.
   *
   * `intendedRole` records the role the invite is created for (Requirement 6.1/6.7).
   * It is persisted on the `invite_codes` row and honoured by `redeem-invite`,
   * which defaults a null/absent value to `player` server-side. `admin` is not a
   * valid intended role and is excluded by the DB CHECK constraint. `'caregiver'`
   * was added to the valid set by `.kiro/specs/add-player-and-dob-age-model/`
   * Requirement 5.1 (migration 053).
   *
   * `subjectUserId` (Requirement 4.3/7.2) is populated only for a Caregiver
   * invite — the child `users.id` the invited caregiver will be linked to once
   * they redeem it. Left `undefined`/`null` for every other invite type.
   *
   * `recipientFirstName`/`recipientLastName` (migration 054) capture the name
   * the inviter already typed (Add Player, or the caregiver name on the
   * Junior path) so the registration page can prefill — editable, never
   * locked — those fields instead of making the invitee retype a name that's
   * already known. Deliberately no equivalent exists for date of birth: see
   * migration 054's comment for why that must stay a fresh, self-declared
   * value every time.
   *
   * `subjectFirstName`/`subjectLastName` (migration 059, streamlined-invites-
   * and-child-access Decision 2) are the CHILD's name on a Caregiver
   * invite — distinct from `recipientFirstName`/`recipientLastName` above,
   * which are the caregiver's own name. Lets the registration page prefill
   * the child-name fields too, reversing this feature's original "must be
   * freshly, independently typed" design after live testing found it just
   * left the caregiver typing a name into a blank field with nothing to
   * check it against; a required confirmation checkbox on submit is the new
   * safeguard instead of relying on independent retyping alone.
   */
  async generateInviteCode(
    teamId: string,
    recipientEmail: string,
    recipientPhone?: string,
    competitionId?: string,
    intendedRole?: 'player' | 'coach' | 'manager' | 'caregiver',
    subjectUserId?: string,
    recipientFirstName?: string,
    recipientLastName?: string,
    subjectFirstName?: string,
    subjectLastName?: string
  ): Promise<InviteCode> {
    const { data: { user: authUser } } = await this.supabase.auth.getUser();
    if (!authUser) throw new ApiError('Not authenticated');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000); // 21 days

    const { data, error } = await this.supabase
      .from('invite_codes')
      .insert({
        code: generateCode(),
        team_id: teamId,
        competition_id: competitionId || null,
        created_by: authUser.id,
        recipient_email: recipientEmail,
        recipient_phone: recipientPhone || null,
        expires_at: expiresAt.toISOString(),
        intended_role: intendedRole ?? null,
        subject_user_id: subjectUserId ?? null,
        recipient_first_name: recipientFirstName ?? null,
        recipient_last_name: recipientLastName ?? null,
        subject_first_name: subjectFirstName ?? null,
        subject_last_name: subjectLastName ?? null,
      })
      .select()
      .single();

    if (error) throw new ApiError(error.message);
    return data as InviteCode;
  }

  /** Validate an invite code — returns status and details */
  async validateInviteCode(code: string): Promise<InviteCodeValidation> {
    // No embeds here. 2026-09-08: the `team:teams(*)` embed returns empty for an
    // ANONYMOUS invite visitor (confirmed via the raw response), even though a
    // DIRECT read of the team succeeds for anon (proven with `SET ROLE anon`:
    // team_visible = 1). The competition read has the same requirement and works
    // as a plain direct query — so the team is fetched the exact same way, and
    // both are pulled by id below rather than relying on PostgREST embedding
    // (which misbehaves for anon on the teams table specifically).
    const { data, error } = await this.supabase
      .from('invite_codes')
      .select('*')
      .eq('code', code)
      .single();

    if (error || !data) {
      return { valid: false, error: 'invalid' };
    }

    if (data.redeemed_by) {
      return { valid: false, error: 'redeemed', invite: data };
    }

    if (new Date(data.expires_at) < new Date()) {
      // Notify the inviter about expired code usage
      await this.notifyExpiredCodeUsage(data);
      return { valid: false, error: 'expired', invite: data };
    }

    // Team via a plain direct query by id — the same mechanism the competition
    // read uses, proven to work for an anonymous visitor (migration 045 grants
    // the read; PostgREST embedding was the only thing failing).
    let team: Team | null = null;
    if (data.team_id) {
      const { data: t } = await this.supabase
        .from('teams')
        .select('*')
        .eq('id', data.team_id)
        .maybeSingle();
      if (t) team = t as Team;
    }

    // Competition name (V1.6) via a separate, anon-readable query (migration
    // 076) — only when the invite names one. Best-effort: a failure just omits
    // the competition context, never blocks validation.
    let competition: { name: string } | null = null;
    if (data.competition_id) {
      const { data: comp } = await this.supabase
        .from('competitions')
        .select('name')
        .eq('id', data.competition_id)
        .maybeSingle();
      if (comp?.name) competition = { name: comp.name };
    }

    return { valid: true, invite: data, team, competition };
  }

  /**
   * Requirement 2.1/2.2 — does the address this invite was sent to already
   * belong to a real account? `LiteLandingPage` calls this once,
   * immediately after `validateInviteCode` succeeds, and shows the short
   * "you already have an account — join {team}?" confirmation instead of
   * the full registration form when this resolves `true`.
   *
   * A thin wrapper over the `check-invite-recipient` Edge Function — see its
   * own header comment for why this has to be server-side (the client can
   * never itself answer "does this email have an account") and why it is
   * scoped to one already-known invite `code` rather than a bare email
   * (closes the enumeration risk, requirements.md Section 2).
   *
   * Fails closed to `false` on any error — a transport failure, a missing
   * deployment, an unexpected response shape — because the safe fallback is
   * always "show the full registration form", never blocking registration
   * on this check succeeding.
   *
   * DEPLOYMENT: Edge Functions do NOT ship with `git push`. This call
   * silently falls back to `false` (not an error) until
   * `supabase functions deploy check-invite-recipient` has been run.
   */
  async checkInviteRecipient(code: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.functions.invoke('check-invite-recipient', {
        body: { code },
      });
      if (error) {
        console.warn('checkInviteRecipient failed (falling back to full form):', error);
        return false;
      }
      return data?.recipientExists === true;
    } catch (error) {
      console.warn('checkInviteRecipient failed (falling back to full form):', error);
      return false;
    }
  }

  /**
   * Redeem an invite code — creates a lite user or adds an existing user to the team.
   *
   * Spec: `.kiro/specs/lite-user-registration-fix/` (task 3.3)
   *
   * This is a thin wrapper over the `redeem-invite` Edge Function. The whole
   * transaction (auth user, `users` row, `team_members` row, redemption) now runs
   * server-side under `service_role`, because `supabase.auth.signUp()` returns no
   * session while email confirmation is enabled — so the browser was still `anon`
   * when it tried to insert into `users`, and migration 044's `id = auth.uid()`
   * check could never pass (2.1, 2.6). The client-side `signUp()` / insert /
   * update sequence is deliberately gone: nothing here needs a session.
   *
   * DEPLOYMENT: Edge Functions do NOT ship with `git push`. This call fails until
   * `supabase functions deploy redeem-invite` has been run.
   */
  async redeemInviteCode(
    code: string,
    userData: LiteRegistrationData
  ): Promise<RedeemInviteResult> {
    // Only data the person typed, plus the code from the link. `role`,
    // `user_type`, `team_id` and `active` are decided server-side — sending them
    // from here would be ignored anyway.
    const { data: result, error } = await this.supabase.functions.invoke('redeem-invite', {
      body: {
        code,
        email: userData.email,
        password: userData.password,
        first_name: userData.first_name,
        last_name: userData.last_name,
        privacy_consent: userData.privacy_consent === true,
        // Self-declared at redemption (Req 3.4); absent/undefined for a
        // Caregiver invite, which `redeem-invite` never asks for one.
        date_of_birth: userData.date_of_birth,
        // Caregiver-invite redemption only (Requirement 5.2/5.3); absent for
        // every other intended role, which `redeem-invite` never asks for
        // these. `undefined` fields are dropped, not sent as `null`.
        subject_first_name: userData.subject_first_name,
        subject_last_name: userData.subject_last_name,
        subject_date_of_birth: userData.subject_date_of_birth,
      },
    });

    if (error) {
      const extracted = await extractFunctionError(error);
      throw new ApiError(extracted.message, extracted.reason);
    }

    // A 2xx response carrying an `error` field — shouldn't happen, but the
    // message is already safe to show if it does.
    if (result?.error) {
      throw new ApiError(
        typeof result.error === 'string' ? result.error : REGISTRATION_FALLBACK_MESSAGE,
        typeof result.reason === 'string' ? result.reason : undefined
      );
    }

    if (!result?.user) {
      throw new ApiError(REGISTRATION_FALLBACK_MESSAGE);
    }

    // Shape the raw Edge Function response into the typed result the Success
    // Screen consumes. Every field beyond `user` is optional: the two paths and
    // the generic fallback each populate a different subset.
    const typed: RedeemInviteResult = {
      success: result.success,
      user: result.user,
      team: result.team ?? null,
      email_confirmed: result.email_confirmed,
      email_confirmation_required: result.email_confirmation_required,
      confirmation_email_sent: result.confirmation_email_sent,
      competition_name: result.competition_name ?? null,
      // add-player-and-dob-age-model Requirement 8.2 — was previously missing
      // from this mapping (the Edge Function has always returned it; the
      // Success Screen's `resolvePrimaryActionHref` has always read it — this
      // is the copy step that lets it actually arrive), fixed in passing
      // while wiring `converted_from_caregiver` alongside it below.
      has_pending_approval: result.has_pending_approval,
      // streamlined-invites-and-child-access Requirement 6.2.
      converted_from_caregiver: result.converted_from_caregiver,
    };

    // Matching-address path (Req 2.1): the account is already confirmed, so send
    // a welcome to the EXACT address the registrant submitted. Fire-and-forget —
    // the registration is already committed server-side and a welcome-email
    // failure must never block or roll it back (Req 2.10).
    if (typed.email_confirmed === true) {
      this.triggerWelcomeEmail(userData.email, typed);
    }

    return typed;
  }

  /**
   * Requirement 2.2's "join {team} as {role}?" single action — the whole
   * point of the existing-user bypass is that this call shows the person no
   * name/password/DOB fields at all, so there is nothing on the form to
   * collect them from. Still goes through the exact same `redeem-invite`
   * endpoint as a full registration (design.md, Component 2: "never touches
   * the server-side redemption logic" beyond what Requirement 2.2 itself
   * needed there — see `redeem-invite/index.ts` step 2a/2b for the one
   * change: the DOB/tick gate is skipped for an account that already has a
   * profile, which is exactly this path).
   *
   * `first_name`/`last_name`/`password` are placeholders `redeem-invite`
   * requires on every request but never uses for an existing profile (its
   * `profileAlreadyExisted` branch neither reads nor writes them — see that
   * file). Reusing the invite's own prefill (`recipientFirstName`/
   * `recipientLastName`, migration 054) rather than a hardcoded string keeps
   * a stray log line looking like a name instead of a sentinel; `email` is
   * always the invite's own recipient address, never user-entered, since
   * this path shows no editable email field either. No `date_of_birth` or
   * `subject_*` fields are sent — none are required for this path (step 2a's
   * gate), and for a caregiver invite sending them would incorrectly try to
   * overwrite the child's already-recorded details (see the guard on that
   * update in `redeem-invite/index.ts`).
   */
  async joinExistingAccount(
    code: string,
    recipientEmail: string,
    recipientName?: { firstName?: string | null; lastName?: string | null }
  ): Promise<RedeemInviteResult> {
    return this.redeemInviteCode(code, {
      first_name: recipientName?.firstName?.trim() || 'Existing',
      last_name: recipientName?.lastName?.trim() || 'Member',
      email: recipientEmail,
      // Never shown, never usable to sign in as anyone — this account
      // already has its own real password, which this call never touches.
      password: generateCode(24),
      privacy_consent: true,
    });
  }

  /**
   * Trigger the matching-path welcome email without awaiting it (Req 2.1/2.10).
   *
   * The team name is rendered as `{age_group} {name}` from the redemption
   * result's server-supplied team data — the client never invents branding or a
   * team name. If no team data is present there is nothing to welcome the
   * registrant to, so the send is skipped rather than sending an empty label.
   *
   * Any rejection is logged and swallowed: the registration has already
   * completed and must not be affected by an email failure.
   */
  private triggerWelcomeEmail(to: string, result: RedeemInviteResult): void {
    const teamLabel = formatTeamLabel(
      result.team ? { age_group: result.team.age_group, name: result.team.name } : null
    );
    if (!teamLabel) return;

    void emailApi
      .sendWelcome({
        to,
        recipientName: result.user?.first_name || undefined,
        teamName: teamLabel,
        competitionName: result.competition_name || undefined,
      })
      .catch((err) => {
        // Fire-and-forget: never rethrow. The registration stands regardless.
        console.warn('Welcome email send failed (registration unaffected):', err);
      });
  }

  /** Get all pending (unredeemed, unexpired) invite codes */
  async getPendingInvites(): Promise<InviteCode[]> {
    const { data, error } = await this.supabase
      .from('invite_codes')
      .select('*, team:teams(*)')
      .is('redeemed_by', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message);
    return data as InviteCode[];
  }

  /** Get pending invites for a specific competition */
  async getPendingInvitesForCompetition(competitionId: string): Promise<InviteCode[]> {
    const { data, error } = await this.supabase
      .from('invite_codes')
      .select('*, team:teams(*)')
      .eq('competition_id', competitionId)
      .is('redeemed_by', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message);
    return data as InviteCode[];
  }

  /** Get all invites (pending and redeemed) for a specific competition */
  async getAllInvitesForCompetition(competitionId: string): Promise<InviteCode[]> {
    const { data, error } = await this.supabase
      .from('invite_codes')
      .select('*, team:teams(*)')
      .eq('competition_id', competitionId)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(error.message);
    return data as InviteCode[];
  }

  /** Invite a mid-season player to a WCR team */
  async inviteMidSeasonPlayer(teamId: string, playerData: InvitePlayerData): Promise<InviteCode> {
    // Check if user already exists
    const { data: existingUser } = await this.supabase
      .from('users')
      .select('id')
      .eq('email', playerData.email)
      .single();

    if (existingUser) {
      // Add existing user to team directly
      const { data: existingMember } = await this.supabase
        .from('team_members')
        .select('id')
        .eq('team_id', teamId)
        .eq('user_id', existingUser.id)
        .single();

      if (!existingMember) {
        await this.supabase
          .from('team_members')
          .insert({ team_id: teamId, user_id: existingUser.id, role: 'player' });
      }
    }

    // Generate invite code regardless (for tracking)
    return this.generateInviteCode(teamId, playerData.email, playerData.phone);
  }

  /** Notify the inviter that an expired code was used */
  private async notifyExpiredCodeUsage(invite: InviteCode): Promise<void> {
    // Use in-app messaging to notify the creator
    // For MVP: we'll create a system message to the inviter
    try {
      const { data: creator } = await this.supabase
        .from('users')
        .select('first_name, last_name')
        .eq('id', invite.created_by)
        .single();

      if (creator) {
        console.log(
          `Expired invite code ${invite.code} was used. Notifying ${creator.first_name} ${creator.last_name}.`
        );
        // TODO: Send in-app message to invite.created_by when messaging integration is wired
      }
    } catch {
      // Non-critical — log and continue
      console.warn('Failed to notify inviter about expired code');
    }
  }
}

/**
 * Shown when the function fails without a usable message of its own. Plain
 * language, no database text (2.4).
 */
const REGISTRATION_FALLBACK_MESSAGE =
  "Something went wrong and we couldn't complete your registration. Please try again.";

/**
 * `functions.invoke` surfaces non-2xx responses as an opaque error — the useful
 * message is in the response body, which has to be read off `error.context`.
 * Without this, every failure reads "Edge Function returned a non-2xx status
 * code", which would defeat 2.4: the registrant would never see the plain-language
 * reason (expired code, already-used code, email already registered) that
 * `redeem-invite` took the trouble to produce.
 *
 * Same approach as `extractFunctionError` in `src/lib/email-api.ts`; kept local so
 * the fallback message suits registration rather than email sending.
 *
 * Also surfaces the response body's `reason` code (e.g. `redeem-invite`'s
 * `bounce_to_manager`), added for
 * `.kiro/specs/streamlined-invites-and-child-access/` Requirement 6.1 so the
 * caller can treat that specific outcome as first-class UI, not a generic
 * failure banner — without parsing message text. `reason` is `undefined`
 * whenever the body has none, which every pre-existing caller can keep
 * ignoring exactly as before.
 */
async function extractFunctionError(
  error: unknown
): Promise<{ message: string; reason?: string }> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      const reason = typeof body?.reason === 'string' ? body.reason : undefined;
      if (body?.error) {
        return {
          message: typeof body.error === 'string' ? body.error : REGISTRATION_FALLBACK_MESSAGE,
          reason,
        };
      }
    } catch {
      // Body wasn't JSON — fall through to the generic message.
    }
  }
  // Deliberately not `error.message`: that is either the opaque invoke text or a
  // transport error, neither of which is useful to the person registering.
  return { message: REGISTRATION_FALLBACK_MESSAGE };
}

export const invitesApi = new InvitesApi();
