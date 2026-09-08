/**
 * Tests for the manual Send Reminder message builder.
 *
 * Run: npm test  (vitest --run, never watch mode)
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { buildReminderPrefill } from './reminder-message-logic';

const base = {
  eventTitle: 'team sgm',
  dateLabel: 'Wed, Sep 9',
  timeLabel: '3:00 PM',
  location: 'Huapai Domain',
  replied: 3,
  total: 5,
};

describe('buildReminderPrefill', () => {
  it('titles the message with the event name', () => {
    expect(buildReminderPrefill(base).title).toBe('Reminder: team sgm');
  });

  it('counts every kind of reply, against the roster total', () => {
    expect(buildReminderPrefill(base).body).toContain("We've had 3 of 5 replies so far.");
  });

  it('says "reply" not "replies" when exactly one person has answered', () => {
    const body = buildReminderPrefill({ ...base, replied: 1 }).body;
    expect(body).toContain("We've had 1 of 5 reply so far.");
    expect(body).not.toContain('1 of 5 replies');
  });

  it('reads naturally when nobody has replied', () => {
    const body = buildReminderPrefill({ ...base, replied: 0 }).body;
    expect(body).toContain("We haven't had any replies yet");
    expect(body).not.toContain('0 of 5');
  });

  it('does not nag when everyone has already replied', () => {
    const body = buildReminderPrefill({ ...base, replied: 5 }).body;
    expect(body).toContain('Everyone has replied');
    expect(body).not.toContain('get your response in');
  });

  it('omits the denominator when the roster size is unknown', () => {
    const body = buildReminderPrefill({ ...base, replied: 2, total: 0 }).body;
    expect(body).toContain("We've had 2 replies so far.");
    expect(body).not.toContain('of 0');
  });

  it('includes the event details and location', () => {
    const body = buildReminderPrefill(base).body;
    expect(body).toContain('This is a reminder about team sgm on Wed, Sep 9 at 3:00 PM.');
    expect(body).toContain('Location: Huapai Domain');
  });
});

describe('buildReminderPrefill — property tests', () => {
  it('Property: never says "0" replies, and never mismatches reply/replies', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
        (replied, total) => {
          const body = buildReminderPrefill({ ...base, replied, total }).body;

          // "0 replies" is always the wrong way to say it.
          expect(body).not.toContain('had 0 ');

          // Singular/plural must agree with the number actually printed.
          if (replied === 1 && total > 1) {
            expect(body).toContain('1 of ' + total + ' reply');
          }
          if (replied > 1 && total > replied) {
            expect(body).toContain(`${replied} of ${total} replies`);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('Property: the body always names the event, date, time and location', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), (replied) => {
        const body = buildReminderPrefill({ ...base, replied }).body;
        expect(body).toContain(base.eventTitle);
        expect(body).toContain(base.dateLabel);
        expect(body).toContain(base.timeLabel);
        expect(body).toContain(base.location);
      }),
      { numRuns: 100 }
    );
  });
});
