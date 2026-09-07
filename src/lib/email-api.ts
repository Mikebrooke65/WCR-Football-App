import { ApiClient, ApiError } from './api-client';

/**
 * Client wrapper for the `send-email` Edge Function.
 *
 * CLUB-AGNOSTIC BY DESIGN: this client sends only *data* (team name,
 * competition name, invite code, recipient). Every piece of club branding
 * in the resulting email — club name, header colour, app URL used to build
 * the invite link — is resolved server-side by the Edge Function from the
 * `club_settings` table (the same single source of truth the app's
 * `useClubBranding` hook reads), with the `CLUB_NAME` / `CLUB_COLOR` /
 * `APP_URL` env secrets and hardcoded defaults as fallback; from-address
 * and reply-to come from `EMAIL_FROM` / `EMAIL_REPLY_TO`. Nothing
 * club-specific is hardcoded here or passed from the browser.
 *
 * The HTML itself is also built server-side, so a compromised client
 * can't push arbitrary content through the sending domain.
 */

export interface CaregiverApprovalRequestEmailParams {
  /** Caregiver's real, deliverable email address. */
  to: string;
  /** Optional caregiver first name for the greeting. */
  recipientName?: string;
  /** Child's display name, e.g. "Sam Jones". */
  childName: string;
  /** Display name, e.g. "U9 Lithium" (age group + name, per project standard). */
  teamName: string;
}

export interface TeamInviteEmailParams {
  /** Recipient email address */
  to: string;
  /** Optional first name for the greeting */
  recipientName?: string;
  /** Display name, e.g. "U9 Lithium" (age group + name, per project standard) */
  teamName: string;
  /** Optional competition name for context, e.g. "Summer Football" */
  competitionName?: string;
  /** The invite code — the function builds the link as `${APP_URL}/invite/{code}` */
  inviteCode: string;
}

/**
 * Data for the matching-address welcome email (Req 2.1). Sent when a registrant
 * used the invited address and the account is already confirmed — a pure
 * welcome, no confirmation action required.
 *
 * DATA ONLY: like every method here, this carries no branding. Club name,
 * colour, and app URL come from the `send-email` function's env vars. The
 * `teamName` must already be formatted `{age_group} {name}` by the caller.
 */
export interface WelcomeEmailParams {
  /** Recipient email address — the exact address the registrant submitted */
  to: string;
  /** Optional first name for the greeting */
  recipientName?: string;
  /** Display name, e.g. "U9 Lithium" (age group + name, per project standard) */
  teamName: string;
  /** Optional competition name for context, e.g. "Summer Football" */
  competitionName?: string;
}

/**
 * Data for a caregiver invite (2026-08-28 addition) — sent to a caregiver
 * with NO existing account, naming the child they're being asked to create
 * one for. Previously this branch reused `sendTeamInvite`'s generic
 * team-invite copy ("add your own players if you're managing the team"),
 * which never mentioned a child or the word "caregiver" — found during live
 * testing of the add-a-junior flow.
 */
export interface CaregiverInviteEmailParams {
  /** Caregiver's real, deliverable email address. */
  to: string;
  /** Optional caregiver first name for the greeting. */
  recipientName?: string;
  /** Child's display name, e.g. "Sam Jones". */
  childName: string;
  /** Display name, e.g. "U9 Lithium" (age group + name, per project standard). */
  teamName: string;
  /** The invite code — the function builds the link as `${APP_URL}/invite/{code}` */
  inviteCode: string;
}

class EmailApi extends ApiClient {
  /** Send a team invite email. Resolves on success, throws ApiError otherwise. */
  async sendTeamInvite(params: TeamInviteEmailParams): Promise<{ id?: string }> {
    const { to, ...data } = params;

    const { data: result, error } = await this.supabase.functions.invoke('send-email', {
      body: { type: 'team_invite', to, data },
    });

    if (error) {
      throw new ApiError(await extractFunctionError(error));
    }

    if (result?.error) {
      throw new ApiError(result.error);
    }

    return { id: result?.id };
  }

  /**
   * Send the matching-address welcome email (Req 2.1). Resolves on success,
   * throws ApiError otherwise.
   *
   * The caller decides whether a failure matters. On the registration path it
   * is fire-and-forget: a failed welcome must never roll back the completed
   * registration (Req 2.10), so `invites-api` calls this without awaiting and
   * logs any rejection.
   */
  async sendWelcome(params: WelcomeEmailParams): Promise<{ id?: string }> {
    const { to, ...data } = params;

    const { data: result, error } = await this.supabase.functions.invoke('send-email', {
      body: { type: 'welcome', to, data },
    });

    if (error) {
      throw new ApiError(await extractFunctionError(error));
    }

    if (result?.error) {
      throw new ApiError(result.error);
    }

    return { id: result?.id };
  }

  /**
   * Send the add-a-junior approval request to a caregiver (Req 5.9).
   *
   * Like every other email here, this sends only *data* (child name, team name,
   * recipient) — all club branding is applied server-side from the Edge
   * Function's env vars. Resolves on success, throws ApiError otherwise.
   */
  async sendCaregiverApprovalRequest(
    params: CaregiverApprovalRequestEmailParams
  ): Promise<{ id?: string }> {
    const { to, ...data } = params;

    const { data: result, error } = await this.supabase.functions.invoke('send-email', {
      body: { type: 'caregiver_approval_request', to, data },
    });

    if (error) {
      throw new ApiError(await extractFunctionError(error));
    }

    if (result?.error) {
      throw new ApiError(result.error);
    }

    return { id: result?.id };
  }

  /**
   * Send a caregiver invite email (2026-08-28 addition) — for a caregiver
   * with no existing account, naming the specific child. Resolves on
   * success, throws ApiError otherwise. See `CaregiverInviteEmailParams`'s
   * doc comment for why this exists as its own type/method rather than
   * reusing `sendTeamInvite`.
   */
  async sendCaregiverInvite(params: CaregiverInviteEmailParams): Promise<{ id?: string }> {
    const { to, ...data } = params;

    const { data: result, error } = await this.supabase.functions.invoke('send-email', {
      body: { type: 'caregiver_invite', to, data },
    });

    if (error) {
      throw new ApiError(await extractFunctionError(error));
    }

    if (result?.error) {
      throw new ApiError(result.error);
    }

    return { id: result?.id };
  }
}

/**
 * `functions.invoke` surfaces non-2xx responses as an opaque error — the
 * useful message is in the response body, which has to be read off
 * `error.context`. Without this, every failure reads "Edge Function
 * returned a non-2xx status code", which is not actionable.
 */
async function extractFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json();
      if (body?.error) {
        return typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      }
    } catch {
      // Body wasn't JSON — fall through to the generic message.
    }
  }
  return error instanceof Error ? error.message : 'Failed to send email';
}

export const emailApi = new EmailApi();
