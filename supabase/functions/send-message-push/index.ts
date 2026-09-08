// Edge Function: send-message-push
//
// Triggered by a Supabase Database Webhook on INSERT into message_recipients
// (configure this in the Supabase dashboard: Database > Webhooks). Looks up
// the message, resolves the recipient list, finds their registered device
// tokens, and sends a push notification via Firebase Cloud Messaging (FCM
// HTTP v1 API). Marks message_recipients.notification_pending = false once
// sent, so we never double-notify if the webhook retries.
//
// Requires these secrets set via `supabase secrets set`:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (usually already present)
//   FCM_SERVICE_ACCOUNT_JSON — the Firebase service account key JSON,
//     as a single-line string (see docs/deployment for setup instructions)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: {
    id: string;
    message_id: string;
    targeting_type: string;
    recipient_user_ids: string[];
    notification_pending: boolean;
  };
}

// Caches the FCM OAuth access token for the lifetime of this function
// instance, since Deno Edge Functions can be reused across invocations.
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

  // Build and sign a JWT to exchange for an OAuth access token
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
  // V1.7 Piece B (Requirement B5/B6): FCM data payloads are always flat
  // string-valued objects. `usePushNotifications.ts`'s `resolvePushRoute`
  // (src/lib/push-routing-logic.ts) reads this to deep-link the tap;
  // omitting it (as every push here did before V1.7) falls back to
  // Messaging, unchanged from prior behaviour.
  data?: Record<string, string>
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
          ...(data ? { data } : {}),
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const FCM_PROJECT_ID = 'club-football-app';

    const payload: WebhookPayload = await req.json();

    if (payload.table !== 'message_recipients' || payload.type !== 'INSERT') {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { id: recipientRowId, message_id, recipient_user_ids } = payload.record;

    // Fetch the message content
    const messageRes = await fetch(
      `${SUPABASE_URL}/rest/v1/messages?id=eq.${message_id}&select=title,body`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } }
    );
    const messages = await messageRes.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error(`Message ${message_id} not found`);
    }
    const { title, body } = messages[0];

    // Fetch device tokens for all recipients
    const userIdsFilter = recipient_user_ids.join(',');
    const tokensRes = await fetch(
      `${SUPABASE_URL}/rest/v1/device_tokens?user_id=in.(${userIdsFilter})&select=device_token,platform`,
      { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } }
    );
    const deviceTokens: { device_token: string; platform: string }[] = await tokensRes.json();

    let sentCount = 0;
    if (deviceTokens.length > 0) {
      const accessToken = await getFcmAccessToken();

      const results = await Promise.all(
        deviceTokens.map((dt) =>
          sendFcmNotification(FCM_PROJECT_ID, accessToken, dt.device_token, title, body)
        )
      );
      sentCount = results.filter(Boolean).length;
    }

    // Mark as no longer pending regardless of send outcome — avoids retry
    // storms on a permanently-invalid token; failures are logged above
    await fetch(
      `${SUPABASE_URL}/rest/v1/message_recipients?id=eq.${recipientRowId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ notification_pending: false }),
      }
    );

    return new Response(
      JSON.stringify({ success: true, devicesFound: deviceTokens.length, sent: sentCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('send-message-push error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
