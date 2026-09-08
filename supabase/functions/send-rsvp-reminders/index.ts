// Edge Function: send-rsvp-reminders
//
// Spec: `.kiro/specs/v1.7-rsvp-availability/` (Piece B, Requirement B1-B5,
// design.md B.1-B.4, tasks.md B2-B6). Locked decisions (D-B1/D-B2/D-B3,
// confirmed 2026-09-08): 24h lead time, hourly cadence targeting events in
// the (24h, 25h] window so each event is caught exactly once; one push per
// caregiver naming the event (not one per un-responded child); scheduled
// via `pg_cron` + `pg_net` (migration 078, mirrors migration 042's direct
// `net.http_post` pattern — this project's dashboard Database Webhooks
// feature doesn't work here, confirmed in 042's own header comment).
//
// Invoked with no request body: on each hourly tick it finds every event
// starting in the target window itself, rather than being told which event
// to check (unlike send-message-push, which is triggered per-row).
//
// For each such event:
//   1. Resolve the roster (player/coach/manager `team_members`) of its
//      target team(s) — every team if `target_teams` is empty (an event
//      visible to everyone), matching how Schedule.tsx resolves RSVP
//      identities for such an event.
//   2. Work out who still owes a response, keyed by `subject_user_id`
//      (Piece A attribution) so a child whose caregiver already responded
//      is correctly excluded even though the caregiver submitted the row.
//   3. Map owed roster members to recipients: an owed adult is nudged
//      directly; an owed child is nudged via each linked caregiver
//      instead, de-duped so a caregiver of two owed children gets one push.
//   4. Skip anyone already reminded for this event + window (migration
//      078's `rsvp_reminders_sent`, checked before sending and recorded
//      after — Requirement B4).
//   5. Send via the same FCM path `send-message-push` uses. Edge Functions
//      in this project have no shared/`_shared` directory (confirmed
//      elsewhere in this codebase), so the FCM-sending helpers below are a
//      deliberate duplicate of `send-message-push/index.ts`'s
//      `getFcmAccessToken`/`pemToArrayBuffer`/`sendFcmNotification` — keep
//      them in sync by hand if either changes.
//
// The pure "who owes a response" / "who gets notified" logic below is also
// a deliberate duplicate of `src/lib/rsvp-reminders-logic.ts` for the same
// reason (no shared module between the Vite app and Deno Edge Functions) —
// that file is the one covered by `rsvp-reminders-logic.test.ts`; keep this
// copy behaviourally identical to it.
//
// Requires these secrets (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// injected automatically; FCM_SERVICE_ACCOUNT_JSON must already be set from
// `send-message-push`'s setup — same Firebase project, reused here):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FCM_SERVICE_ACCOUNT_JSON
//
// Deploy manually — NOT on git push:
//   supabase functions deploy send-rsvp-reminders
// Then run migration 078 in the SQL Editor to schedule the hourly pg_cron
// job that invokes it (needs the Vault `service_role_key` secret that
// migration 042 already required — re-use it, no new manual step if 042 is
// already applied).

import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Pure logic — duplicated from src/lib/rsvp-reminders-logic.ts (see header).
// ---------------------------------------------------------------------------

type RsvpStatus = 'going' | 'not_going' | 'maybe' | 'no_response';

interface RosterMember {
  userId: string;
  isChild: boolean;
}

function resolveOwedResponses(
  roster: RosterMember[],
  statusBySubjectUserId: Record<string, RsvpStatus>
): string[] {
  return roster
    .filter((member) => {
      const status = statusBySubjectUserId[member.userId];
      return !status || status === 'no_response';
    })
    .map((member) => member.userId);
}

function resolveReminderRecipients(
  owedUserIds: string[],
  isChildByUserId: Record<string, boolean>,
  caregiverIdsByChildId: Record<string, string[]>
): string[] {
  const recipients = new Set<string>();
  for (const userId of owedUserIds) {
    if (isChildByUserId[userId]) {
      for (const caregiverId of caregiverIdsByChildId[userId] || []) {
        recipients.add(caregiverId);
      }
    } else {
      recipients.add(userId);
    }
  }
  return Array.from(recipients);
}

function buildRsvpReminderMessage(
  eventTitle: string,
  teamLabel?: string
): { title: string; body: string } {
  return {
    title: 'RSVP reminder',
    body: teamLabel
      ? `Reminder: RSVP for ${eventTitle} — ${teamLabel}`
      : `Reminder: RSVP for ${eventTitle}`,
  };
}

/** Mirrors Schedule.tsx's `getEventTitle` for a game event's display name. */
function eventDisplayTitle(
  event: { title: string; event_type: string; opponent: string | null; home_away: string | null },
  teamLabel?: string
): string {
  if (event.event_type !== 'game' || !event.opponent) return event.title;
  const label = teamLabel || 'Your Team';
  return event.home_away === 'home' ? `${label} vs ${event.opponent}` : `${event.opponent} vs ${label}`;
}

// ---------------------------------------------------------------------------
// FCM send helpers — duplicated from send-message-push/index.ts (see header).
// ---------------------------------------------------------------------------

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!serviceAccountJson) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON secret is not set');
  }
  const serviceAccount = JSON.parse(serviceAccountJson);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const unsignedToken = `${encode(header)}.${encode(claims)}`;

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${unsignedToken}.${encodedSignature}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Failed to get FCM access token: ${err}`);
  }

  const tokenData = await tokenResponse.json();
  cachedAccessToken = {
    token: tokenData.access_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
  };
  return cachedAccessToken.token;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function sendFcmNotification(
  projectId: string,
  accessToken: string,
  deviceToken: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<boolean> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title, body },
          data,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error(`FCM send failed for token ${deviceToken.slice(0, 12)}...: ${err}`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// The only reminder window this spec builds (D-B1: 24h before). Kept as an
// explicit value — not implicit in the table shape — so a future second
// "last call" reminder (V1.7's Deferred list) can share
// `rsvp_reminders_sent` with its own window value instead of colliding with
// this one.
const REMINDER_WINDOW = 'T-24h';

interface EventRow {
  id: string;
  title: string;
  event_type: string;
  event_date: string;
  opponent: string | null;
  home_away: string | null;
  target_teams: string[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FCM_PROJECT_ID = 'club-football-app';
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const now = Date.now();
    const windowStart = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now + 25 * 60 * 60 * 1000).toISOString();

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, title, event_type, event_date, opponent, home_away, target_teams')
      .gt('event_date', windowStart)
      .lte('event_date', windowEnd);

    if (eventsError) throw eventsError;

    const typedEvents = (events || []) as EventRow[];
    let totalSent = 0;
    const summary: Record<string, unknown>[] = [];

    for (const event of typedEvents) {
      const result = await processEvent(supabase, event, FCM_PROJECT_ID);
      totalSent += result.sent;
      summary.push({ eventId: event.id, ...result });
    }

    return jsonResponse({
      success: true,
      eventsChecked: typedEvents.length,
      remindersSent: totalSent,
      summary,
    });
  } catch (error) {
    console.error('send-rsvp-reminders error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      500
    );
  }
});

async function processEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  event: EventRow,
  fcmProjectId: string
): Promise<{ sent: number; owed: number; recipients?: number; alreadyNotified?: number }> {
  const scoped = event.target_teams && event.target_teams.length > 0;

  let teamMembersQuery = supabase.from('team_members').select('user_id');
  if (scoped) {
    teamMembersQuery = teamMembersQuery.in('team_id', event.target_teams);
  }
  const { data: members, error: membersError } = await teamMembersQuery;
  if (membersError) throw membersError;

  const rosterUserIds = Array.from(new Set((members || []).map((m: { user_id: string }) => m.user_id)));
  if (rosterUserIds.length === 0) return { sent: 0, owed: 0 };

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, is_child')
    .in('id', rosterUserIds);
  if (usersError) throw usersError;

  const isChildByUserId: Record<string, boolean> = {};
  (users || []).forEach((u: { id: string; is_child: boolean | null }) => {
    isChildByUserId[u.id] = !!u.is_child;
  });

  const roster: RosterMember[] = rosterUserIds.map((id) => ({
    userId: id as string,
    isChild: !!isChildByUserId[id as string],
  }));

  const { data: rsvps, error: rsvpsError } = await supabase
    .from('event_rsvps')
    .select('subject_user_id, status')
    .eq('event_id', event.id);
  if (rsvpsError) throw rsvpsError;

  const statusBySubjectUserId: Record<string, RsvpStatus> = {};
  (rsvps || []).forEach((r: { subject_user_id: string; status: RsvpStatus }) => {
    statusBySubjectUserId[r.subject_user_id] = r.status;
  });

  const owedUserIds = resolveOwedResponses(roster, statusBySubjectUserId);
  if (owedUserIds.length === 0) return { sent: 0, owed: 0 };

  const owedChildIds = owedUserIds.filter((id) => isChildByUserId[id]);
  const caregiverIdsByChildId: Record<string, string[]> = {};
  if (owedChildIds.length > 0) {
    const { data: links, error: linksError } = await supabase
      .from('player_caregivers')
      .select('player_id, caregiver_id')
      .in('player_id', owedChildIds);
    if (linksError) throw linksError;
    (links || []).forEach((l: { player_id: string; caregiver_id: string }) => {
      if (!caregiverIdsByChildId[l.player_id]) caregiverIdsByChildId[l.player_id] = [];
      caregiverIdsByChildId[l.player_id].push(l.caregiver_id);
    });
  }

  const recipientUserIds = resolveReminderRecipients(owedUserIds, isChildByUserId, caregiverIdsByChildId);
  if (recipientUserIds.length === 0) return { sent: 0, owed: owedUserIds.length, recipients: 0 };

  // Requirement B4: skip anyone already reminded for this event + window.
  const { data: alreadySent, error: sentError } = await supabase
    .from('rsvp_reminders_sent')
    .select('user_id')
    .eq('event_id', event.id)
    .eq('reminder_window', REMINDER_WINDOW)
    .in('user_id', recipientUserIds);
  if (sentError) throw sentError;

  const alreadySentSet = new Set((alreadySent || []).map((r: { user_id: string }) => r.user_id));
  const freshRecipientIds = recipientUserIds.filter((id) => !alreadySentSet.has(id));
  if (freshRecipientIds.length === 0) {
    return { sent: 0, owed: owedUserIds.length, recipients: recipientUserIds.length, alreadyNotified: recipientUserIds.length };
  }

  let teamLabel: string | undefined;
  if (scoped && event.target_teams.length === 1) {
    const { data: team } = await supabase
      .from('teams')
      .select('name, age_group')
      .eq('id', event.target_teams[0])
      .maybeSingle();
    if (team) teamLabel = `${team.age_group} ${team.name}`.trim();
  }

  const displayTitle = eventDisplayTitle(event, teamLabel);
  const { title, body } = buildRsvpReminderMessage(displayTitle, teamLabel);

  const { data: deviceTokens, error: tokensError } = await supabase
    .from('device_tokens')
    .select('user_id, device_token')
    .in('user_id', freshRecipientIds);
  if (tokensError) throw tokensError;

  let sentCount = 0;
  if (deviceTokens && deviceTokens.length > 0) {
    const accessToken = await getFcmAccessToken();
    const results = await Promise.all(
      deviceTokens.map((dt: { device_token: string }) =>
        sendFcmNotification(fcmProjectId, accessToken, dt.device_token, title, body, {
          type: 'event_rsvp',
          eventId: event.id,
        })
      )
    );
    sentCount = results.filter(Boolean).length;
  }

  // Record every fresh recipient as notified regardless of individual FCM
  // send outcome — same reasoning as send-message-push marking
  // notification_pending false unconditionally: a permanently-invalid
  // token shouldn't cause a retry storm on next hour's run.
  const rows = freshRecipientIds.map((userId) => ({
    event_id: event.id,
    user_id: userId,
    reminder_window: REMINDER_WINDOW,
  }));
  const { error: insertError } = await supabase
    .from('rsvp_reminders_sent')
    .upsert(rows, { onConflict: 'event_id,user_id,reminder_window', ignoreDuplicates: true });
  if (insertError) {
    console.error(`Failed to record rsvp_reminders_sent for event ${event.id}:`, insertError);
  }

  return {
    sent: sentCount,
    owed: owedUserIds.length,
    recipients: freshRecipientIds.length,
  };
}
