// Pure logic for routing a tapped/received push notification to an in-app
// path (V1.7 Piece B, Requirement B5/B6, design.md B.4).
//
// Gap this fixes: every push notification today (foreground toast and
// background tap, see `usePushNotifications.ts`) hardcodes navigation to
// `/messaging` regardless of content — there is no data-payload -> route
// pattern to "reuse" as design.md originally assumed. This module is the
// first version of that pattern, kept pure/tested per this repo's
// `*-logic.ts` convention so `usePushNotifications.ts` itself stays a thin
// Capacitor listener wrapper.

/** The shape FCM's `data` payload takes for each push type this app sends. */
export type PushData =
  | { type: 'event_rsvp'; eventId: string }
  | { type: 'message' }
  | Record<string, unknown>
  | null
  | undefined;

/**
 * Resolve where tapping (or receiving, for the foreground toast's "View"
 * action) a push notification should navigate to.
 *
 * - `{ type: 'event_rsvp', eventId }` (the RSVP reminder push,
 *   `send-rsvp-reminders`) routes to that event on the Schedule page.
 * - Everything else — no data payload, `{ type: 'message' }`
 *   (`send-message-push`), or an unrecognized/malformed payload — falls
 *   back to `/messaging`, matching this app's behaviour before this
 *   payload existed at all. FCM data payloads are always plain
 *   string-valued objects, so a malformed `eventId` (missing, empty, or
 *   not a string) is treated the same as no payload rather than thrown on.
 */
export function resolvePushRoute(data: PushData): string {
  if (
    data &&
    typeof data === 'object' &&
    (data as { type?: unknown }).type === 'event_rsvp' &&
    typeof (data as { eventId?: unknown }).eventId === 'string' &&
    (data as { eventId: string }).eventId.length > 0
  ) {
    return `/schedule?event=${encodeURIComponent((data as { eventId: string }).eventId)}`;
  }

  return '/messaging';
}
