// Edge Function: send-email
//
// Generic transactional email sender, used for invite links and (later)
// RSVP reminders and announcements. Templates are built server-side —
// the client sends a `type` plus data, never raw HTML, so a compromised
// client can't send arbitrary content through the club's email domain.
//
// Requires this secret (set via `supabase secrets set`):
//   RESEND_API_KEY
//
// Optional secrets — all have fallbacks, and all exist to keep this
// function CLUB-AGNOSTIC so another club can deploy it unchanged:
//   EMAIL_FROM     e.g. "Club Football <noreply@yourclub.co.nz>"
//   CLUB_NAME      e.g. "West Coast Rangers"   (email header + copy)
//   CLUB_COLOR     e.g. "#0091f3"              (email header background)
//   EMAIL_REPLY_TO e.g. "admin@yourclub.co.nz" (see note below)
//   APP_URL        e.g. "https://clubfootball.app"
//
// BRANDING SOURCE (2026-09-09): club name / colour / app URL are read from the
// `club_settings` DB table FIRST (the same single source of truth the app's
// `useClubBranding` hook reads), so the email header matches in-app branding
// and works per-club with no per-deployment secrets to keep in sync. The
// CLUB_NAME / CLUB_COLOR / APP_URL secrets and the hardcoded DEFAULT_* values
// below are only a fallback for when a `club_settings` value is absent or the
// lookup fails. This is a server-side DB read, never client request data, so
// it still satisfies "branding never comes from the request body" (Req 2.6).
//
// SEND-ONLY BY DESIGN: this function never receives mail, so the sending
// domain needs no mailbox — "noreply@" is fine. But note that send-only
// still requires SPF/DKIM DNS records on whatever domain you send from,
// or messages will land in spam. Set EMAIL_REPLY_TO to a real monitored
// address if you want replies to reach a human; otherwise recipients
// replying will get a bounce.
//
// NOTE: Resend's test sender (onboarding@resend.dev) can ONLY deliver to
// the address the Resend account was registered with. Real recipients
// require a verified sending domain.

import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Resend's shared test sender — works with no domain setup, but only
// delivers to the Resend account owner's own email address.
const DEFAULT_FROM = 'Club Football <onboarding@resend.dev>';
const DEFAULT_CLUB_NAME = 'Club Football';
const DEFAULT_CLUB_COLOR = '#0091f3';
// The product domain, deliberately not a club-specific one - this is the
// right default for any club deploying this unchanged. Override with the
// APP_URL secret if a club serves the app from their own domain.
const DEFAULT_APP_URL = 'https://clubfootball.app';

interface TeamInviteData {
  recipientName?: string;
  teamName: string;
  competitionName?: string;
  inviteCode: string;
}

// Sent on the matching-address registration path (Req 2.1). The registrant's
// address matched the invited address, so the account is already confirmed —
// this is a pure welcome, no action required.
interface WelcomeData {
  recipientName?: string;
  teamName: string;
  competitionName?: string;
}

// Sent on the non-matching-address path (Req 2.3). The registrant used an
// address that differs from the invited one, so the account is gated behind
// a confirmation link generated server-side by redeem-invite. The one
// explanatory sentence required by Req 2.4 is built into the copy below.
interface ConfirmRegistrationData {
  recipientName?: string;
  teamName: string;
  confirmationLink: string;
}

// Sent when a Manager adds a junior on a Club Tournament team (Req 5.9). The
// linked caregiver is asked to approve (double opt-in) before the child's
// record is activated. Copy only — the approval action happens in-app.
interface CaregiverApprovalRequestData {
  recipientName?: string;
  childName: string;
  teamName: string;
}

// Sent to a caregiver who has NO existing account yet, naming the specific
// child they're being asked to create one for — added 2026-08-28 after live
// testing found this path was reusing `team_invite`'s generic copy
// ("add your own players if you're managing the team"), which never
// mentioned a child or the word "caregiver" at all. Distinct from
// `caregiver_approval_request` above: that one notifies an EXISTING
// caregiver account that a decision is waiting in-app; this one is the very
// first contact for someone who doesn't have an account to log into yet,
// so — like `team_invite` — it carries the invite link itself.
interface CaregiverInviteData {
  recipientName?: string;
  childName: string;
  teamName: string;
  inviteCode: string;
}

// The union of everything this function can send. Adding a member here forces
// a matching branch in the send switch, so no type can be sent without copy.
type EmailRequest =
  | { type: 'team_invite'; to: string; data: TeamInviteData }
  | { type: 'welcome'; to: string; data: WelcomeData }
  | { type: 'confirm_registration'; to: string; data: ConfirmRegistrationData }
  | { type: 'caregiver_approval_request'; to: string; data: CaregiverApprovalRequestData }
  | { type: 'caregiver_invite'; to: string; data: CaregiverInviteData };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Branding {
  clubName: string;
  clubColor: string;
  appUrl: string;
}

function buildTeamInvite(
  data: TeamInviteData,
  branding: Branding
): { subject: string; html: string; text: string } {
  // Raw values are used for the subject line and the plain-text part.
  // Neither is HTML, so escaping there would leak entities into what the
  // recipient actually reads - a team called "Mike's Team" would arrive
  // as "Mike&#39;s Team".
  const rawTeam = data.teamName;
  const rawCompetition = data.competitionName || null;
  const rawGreeting = data.recipientName || null;
  const inviteUrl = `${branding.appUrl}/invite/${encodeURIComponent(data.inviteCode)}`;

  const teamName = escapeHtml(rawTeam);
  const competitionName = rawCompetition ? escapeHtml(rawCompetition) : null;
  const greetingName = rawGreeting ? escapeHtml(rawGreeting) : null;
  const clubName = escapeHtml(branding.clubName);
  const clubColor = escapeHtml(branding.clubColor);

  const subject = rawCompetition
    ? `You're invited to join ${rawTeam} for ${rawCompetition}`
    : `You're invited to join ${rawTeam}`;

  // A plain-text alternative alongside the HTML. Sending HTML only is a
  // recognised spam signal, and some clients render the text part anyway.
  const text = [
    rawGreeting ? `Hi ${rawGreeting},` : 'Hi,',
    '',
    rawCompetition
      ? `You've been invited to join ${rawTeam} for ${rawCompetition}.`
      : `You've been invited to join ${rawTeam}.`,
    '',
    'Set up your account here:',
    inviteUrl,
    '',
    "Once you're in, you'll be able to see your schedule, get team messages,",
    "and add your own players if you're managing the team.",
    '',
    "If you weren't expecting this invitation, you can safely ignore this email.",
    '',
    branding.clubName,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${clubColor};padding:20px 24px;">
                <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${clubName}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:16px;color:#111827;">
                  ${greetingName ? `Hi ${greetingName},` : 'Hi,'}
                </p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#374151;">
                  You've been invited to join <strong>${teamName}</strong>${
                    competitionName ? ` for <strong>${competitionName}</strong>` : ''
                  }.
                </p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#374151;">
                  Tap the button below to set up your account. Once you're in, you'll be
                  able to see your schedule, get team messages, and add your own players
                  if you're managing the team.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                  <tr>
                    <td style="background:${clubColor};border-radius:8px;">
                      <a href="${inviteUrl}"
                         style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">
                        Join ${teamName}
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 20px;font-size:13px;word-break:break-all;">
                  <a href="${inviteUrl}" style="color:${clubColor};">${inviteUrl}</a>
                </p>
                <p style="margin:0;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
                  If you weren't expecting this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

// A caregiver invite (2026-08-28 addition) — names the specific child and
// says "caregiver", unlike `buildTeamInvite`'s copy which this deliberately
// does NOT reuse (that copy is written for someone joining a team
// themselves, not for someone being asked to confirm a child's place on
// one). Shares `buildTeamInvite`'s invite-link/button structure, since the
// underlying action — redeem this code to create an account — is identical.
function buildCaregiverInvite(
  data: CaregiverInviteData,
  branding: Branding
): { subject: string; html: string; text: string } {
  const rawChild = data.childName;
  const rawTeam = data.teamName;
  const rawGreeting = data.recipientName || null;
  const inviteUrl = `${branding.appUrl}/invite/${encodeURIComponent(data.inviteCode)}`;

  const childName = escapeHtml(rawChild);
  const teamName = escapeHtml(rawTeam);
  const greetingName = rawGreeting ? escapeHtml(rawGreeting) : null;
  const clubName = escapeHtml(branding.clubName);
  const clubColor = escapeHtml(branding.clubColor);

  const subject = `You've been listed as a caregiver for ${rawChild}`;

  const text = [
    rawGreeting ? `Hi ${rawGreeting},` : 'Hi,',
    '',
    `${rawChild} has been added to ${rawTeam} and listed you as their caregiver.`,
    '',
    'Set up your account here:',
    inviteUrl,
    '',
    `Once you're in, you'll be able to review ${rawChild}'s details and approve`,
    "their place on the team, see the team's schedule, and get team messages.",
    '',
    "If you weren't expecting this invitation, you can safely ignore this email.",
    '',
    branding.clubName,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${clubColor};padding:20px 24px;">
                <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${clubName}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:16px;color:#111827;">
                  ${greetingName ? `Hi ${greetingName},` : 'Hi,'}
                </p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#374151;">
                  <strong>${childName}</strong> has been added to <strong>${teamName}</strong> and
                  listed you as their caregiver.
                </p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#374151;">
                  Tap the button below to set up your account. Once you're in, you'll be able to
                  review ${childName}'s details and approve their place on the team, see the
                  team's schedule, and get team messages.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                  <tr>
                    <td style="background:${clubColor};border-radius:8px;">
                      <a href="${inviteUrl}"
                         style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">
                        Get Started
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 20px;font-size:13px;word-break:break-all;">
                  <a href="${inviteUrl}" style="color:${clubColor};">${inviteUrl}</a>
                </p>
                <p style="margin:0;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
                  If you weren't expecting this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Onboarding emails (welcome + confirmation) share ONE build implementation.
//
// Req 2.8 requires the matching-address welcome and the non-matching-address
// confirmation email to share one link-generation and Resend-sending path,
// differing only in copy. `buildOnboardingEmail` is that single path: it owns
// the greeting, the branded HTML shell, the plain-text alternative, and the
// optional call-to-action button/link. The two builders below supply nothing
// but copy — subject line, body paragraphs, and (for confirmation) the link.
//
// Branding (club name, colour, app URL) comes only from `branding`, which the
// handler populates from the `club_settings` DB table (env vars / defaults as
// fallback) — never from the request body (Req 2.6).
// Team names arrive already formatted as `{age_group} {name}` from server-side
// callers; this function renders the value verbatim and accepts no branding or
// team-name overrides from the client (Req 2.7).
// ---------------------------------------------------------------------------

interface OnboardingCopy {
  subject: string;
  // Raw (unescaped) recipient name for the greeting, or null for a generic one.
  greetingName: string | null;
  // Raw (unescaped) body paragraphs. Rendered as-is into the text part and
  // HTML-escaped for the HTML part.
  paragraphs: string[];
  // Optional call-to-action rendered as a button (HTML) and a labelled URL
  // (text). Used by the confirmation email for the confirmation link.
  cta?: { label: string; url: string };
}

function buildOnboardingEmail(
  copy: OnboardingCopy,
  branding: Branding
): { subject: string; html: string; text: string } {
  const clubName = escapeHtml(branding.clubName);
  const clubColor = escapeHtml(branding.clubColor);
  const greetingRaw = copy.greetingName;
  const greetingHtml = greetingRaw ? escapeHtml(greetingRaw) : null;

  // Plain-text alternative — raw values, no escaping (see buildTeamInvite).
  const textLines: string[] = [greetingRaw ? `Hi ${greetingRaw},` : 'Hi,', ''];
  for (const p of copy.paragraphs) {
    textLines.push(p, '');
  }
  if (copy.cta) {
    textLines.push(copy.cta.label + ':', copy.cta.url, '');
  }
  textLines.push(branding.clubName);
  const text = textLines.join('\n');

  const paragraphsHtml = copy.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#374151;">${escapeHtml(
          p
        )}</p>`
    )
    .join('\n                ');

  const ctaHtml = copy.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                  <tr>
                    <td style="background:${clubColor};border-radius:8px;">
                      <a href="${copy.cta.url}"
                         style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">
                        ${escapeHtml(copy.cta.label)}
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 20px;font-size:13px;word-break:break-all;">
                  <a href="${copy.cta.url}" style="color:${clubColor};">${escapeHtml(
        copy.cta.url
      )}</a>
                </p>`
    : '';

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${clubColor};padding:20px 24px;">
                <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${clubName}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:16px;color:#111827;">
                  ${greetingHtml ? `Hi ${greetingHtml},` : 'Hi,'}
                </p>
                ${paragraphsHtml}
                ${ctaHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: copy.subject, html, text };
}

// Matching-address welcome (Req 2.1). Copy only — no link/action needed.
function buildWelcome(
  data: WelcomeData,
  branding: Branding
): { subject: string; html: string; text: string } {
  const rawTeam = data.teamName;
  const rawCompetition = data.competitionName || null;

  const subject = rawCompetition
    ? `Welcome to ${rawTeam} for ${rawCompetition}`
    : `Welcome to ${rawTeam}`;

  const paragraphs = [
    rawCompetition
      ? `You're all set — your account is confirmed and you've joined ${rawTeam} for ${rawCompetition}.`
      : `You're all set — your account is confirmed and you've joined ${rawTeam}.`,
    "On your Team page you'll see the teams you can manage, you can add players, " +
      'and you can promote one more player to Manager (up to two Managers per team).',
    "If you weren't expecting this, you can safely ignore this email.",
  ];

  return buildOnboardingEmail(
    { subject, greetingName: data.recipientName || null, paragraphs },
    branding
  );
}

// Non-matching-address confirmation (Req 2.3/2.4). Copy only, plus the
// server-generated confirmation link rendered through the shared CTA path.
function buildConfirmRegistration(
  data: ConfirmRegistrationData,
  branding: Branding
): { subject: string; html: string; text: string } {
  const rawTeam = data.teamName;

  const subject = `Confirm your registration for ${rawTeam}`;

  const paragraphs = [
    `You registered to join ${rawTeam} using an email address that's different from the one your invitation was sent to — if that was intentional, tap the button below to confirm and complete your registration; if it was a mistake, you can ignore this email and register again using the invited address.`,
    'Confirming just verifies this email address belongs to you.',
  ];

  return buildOnboardingEmail(
    {
      subject,
      greetingName: data.recipientName || null,
      paragraphs,
      cta: { label: 'Confirm my registration', url: data.confirmationLink },
    },
    branding
  );
}

// Add-a-junior approval request (Req 5.9). Copy only — the caregiver approves
// or declines inside the app, so no link/CTA is generated here.
function buildCaregiverApprovalRequest(
  data: CaregiverApprovalRequestData,
  branding: Branding
): { subject: string; html: string; text: string } {
  const rawChild = data.childName;
  const rawTeam = data.teamName;

  const subject = `Please confirm adding ${rawChild} to ${rawTeam}`;

  const paragraphs = [
    `${rawChild} has been added to ${rawTeam} and listed you as their caregiver.`,
    'Before their place is confirmed we need your approval. Open the app to review the request and approve or decline it.',
    "If you weren't expecting this, you can decline the request in the app or simply ignore this email.",
  ];

  return buildOnboardingEmail(
    { subject, greetingName: data.recipientName || null, paragraphs },
    branding
  );
}

// Resolve club branding, DB-first (single source of truth, same as the app's
// `useClubBranding`), with the CLUB_* env secrets and hardcoded DEFAULT_*
// values as a last-resort fallback. Never throws: any misconfiguration or DB
// failure degrades to the fallback so email sending is never blocked by a
// branding lookup.
async function resolveBranding(): Promise<Branding> {
  const fallback: Branding = {
    clubName: Deno.env.get('CLUB_NAME') || DEFAULT_CLUB_NAME,
    clubColor: Deno.env.get('CLUB_COLOR') || DEFAULT_CLUB_COLOR,
    appUrl: Deno.env.get('APP_URL') || DEFAULT_APP_URL,
  };

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return fallback;

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Single-row table (migration 046): id is a boolean PK fixed to true.
    const { data, error } = await admin
      .from('club_settings')
      .select('club_name, primary_color, app_url')
      .eq('id', true)
      .maybeSingle();

    if (error || !data) return fallback;

    return {
      clubName: data.club_name?.trim() || fallback.clubName,
      clubColor: data.primary_color?.trim() || fallback.clubColor,
      appUrl: data.app_url?.trim() || fallback.appUrl,
    };
  } catch (err) {
    console.warn('send-email: club_settings branding lookup failed, using env/default fallback', err);
    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY secret is not set');
    }
    const from = Deno.env.get('EMAIL_FROM') || DEFAULT_FROM;
    const replyTo = Deno.env.get('EMAIL_REPLY_TO') || undefined;
    const branding = await resolveBranding();

    // Require a caller to be authenticated — this function sends mail on
    // behalf of the club, so it shouldn't be open to anonymous callers.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: EmailRequest = await req.json();

    if (!body?.to || !body?.type) {
      return new Response(JSON.stringify({ error: '`to` and `type` are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let subject: string;
    let html: string;
    let text: string;

    switch (body.type) {
      case 'team_invite': {
        if (!body.data?.teamName || !body.data?.inviteCode) {
          return new Response(
            JSON.stringify({ error: 'team_invite requires data.teamName and data.inviteCode' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        ({ subject, html, text } = buildTeamInvite(body.data, branding));
        break;
      }
      case 'welcome': {
        if (!body.data?.teamName) {
          return new Response(
            JSON.stringify({ error: 'welcome requires data.teamName' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        ({ subject, html, text } = buildWelcome(body.data, branding));
        break;
      }
      case 'confirm_registration': {
        if (!body.data?.teamName || !body.data?.confirmationLink) {
          return new Response(
            JSON.stringify({
              error: 'confirm_registration requires data.teamName and data.confirmationLink',
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        ({ subject, html, text } = buildConfirmRegistration(body.data, branding));
        break;
      }
      case 'caregiver_approval_request': {
        if (!body.data?.childName || !body.data?.teamName) {
          return new Response(
            JSON.stringify({
              error: 'caregiver_approval_request requires data.childName and data.teamName',
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        ({ subject, html, text } = buildCaregiverApprovalRequest(body.data, branding));
        break;
      }
      case 'caregiver_invite': {
        if (!body.data?.childName || !body.data?.teamName || !body.data?.inviteCode) {
          return new Response(
            JSON.stringify({
              error: 'caregiver_invite requires data.childName, data.teamName and data.inviteCode',
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        ({ subject, html, text } = buildCaregiverInvite(body.data, branding));
        break;
      }
      default:
        return new Response(JSON.stringify({ error: `Unknown email type: ${body.type}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [body.to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    const result = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend send failed:', result);
      return new Response(
        JSON.stringify({ error: result?.message || 'Failed to send email', detail: result }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ success: true, id: result?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('send-email error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
