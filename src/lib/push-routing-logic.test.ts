/**
 * Tests for `resolvePushRoute` (Requirement B5/B6, `v1.7-rsvp-availability`
 * Piece B).
 *
 * Run: npm test  (vitest --run, never watch mode)
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { resolvePushRoute } from './push-routing-logic';

describe('resolvePushRoute', () => {
  it('routes an event_rsvp payload to that event on the Schedule page', () => {
    expect(resolvePushRoute({ type: 'event_rsvp', eventId: 'evt-123' })).toBe(
      '/schedule?event=evt-123'
    );
  });

  it('URL-encodes the event id', () => {
    expect(resolvePushRoute({ type: 'event_rsvp', eventId: 'a b/c' })).toBe(
      '/schedule?event=a%20b%2Fc'
    );
  });

  it('routes a message payload to Messaging', () => {
    expect(resolvePushRoute({ type: 'message' })).toBe('/messaging');
  });

  it('falls back to Messaging with no payload at all (undefined)', () => {
    expect(resolvePushRoute(undefined)).toBe('/messaging');
  });

  it('falls back to Messaging with a null payload', () => {
    expect(resolvePushRoute(null)).toBe('/messaging');
  });

  it('falls back to Messaging for an unrecognized type', () => {
    expect(resolvePushRoute({ type: 'something_new' } as any)).toBe('/messaging');
  });

  it('falls back to Messaging for event_rsvp with a missing eventId', () => {
    expect(resolvePushRoute({ type: 'event_rsvp' } as any)).toBe('/messaging');
  });

  it('falls back to Messaging for event_rsvp with an empty-string eventId', () => {
    expect(resolvePushRoute({ type: 'event_rsvp', eventId: '' })).toBe('/messaging');
  });

  it('falls back to Messaging for event_rsvp with a non-string eventId', () => {
    expect(resolvePushRoute({ type: 'event_rsvp', eventId: 123 } as any)).toBe('/messaging');
  });

  it('Property: any non-event_rsvp-shaped object always falls back to /messaging', () => {
    fc.assert(
      fc.property(
        fc.record({
          type: fc.constantFrom('message', 'other', 'unknown'),
        }),
        (data) => {
          expect(resolvePushRoute(data as any)).toBe('/messaging');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property: any non-empty string eventId with type event_rsvp always routes to /schedule', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (eventId) => {
        const route = resolvePushRoute({ type: 'event_rsvp', eventId });
        expect(route.startsWith('/schedule?event=')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
