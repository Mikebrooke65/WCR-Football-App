/**
 * Tests for the RSVP reminder pure logic (Requirement B1-B3, `v1.7-rsvp-
 * availability` Piece B).
 *
 * Run: npm test  (vitest --run, never watch mode)
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  resolveOwedResponses,
  resolveReminderRecipients,
  buildRsvpReminderMessage,
  type RosterMember,
  type RsvpStatus,
} from './rsvp-reminders-logic';

describe('resolveOwedResponses (Requirement B1, B3)', () => {
  it('a roster member with no RSVP row owes a response', () => {
    const owed = resolveOwedResponses({
      roster: [{ userId: 'u1', isChild: false }],
      statusBySubjectUserId: {},
    });
    expect(owed).toEqual(['u1']);
  });

  it('a roster member with an explicit no_response row owes a response', () => {
    const owed = resolveOwedResponses({
      roster: [{ userId: 'u1', isChild: false }],
      statusBySubjectUserId: { u1: 'no_response' },
    });
    expect(owed).toEqual(['u1']);
  });

  it('going, maybe, and not_going all count as having responded', () => {
    const owed = resolveOwedResponses({
      roster: [
        { userId: 'going-u', isChild: false },
        { userId: 'maybe-u', isChild: false },
        { userId: 'declined-u', isChild: false },
      ],
      statusBySubjectUserId: {
        'going-u': 'going',
        'maybe-u': 'maybe',
        'declined-u': 'not_going',
      },
    });
    expect(owed).toEqual([]);
  });

  it('a caregiver-submitted child RSVP is attributed to the child, excluding them from owed', () => {
    // subject_user_id is the child's id even though the caregiver submitted it.
    const owed = resolveOwedResponses({
      roster: [{ userId: 'johnny', isChild: true }],
      statusBySubjectUserId: { johnny: 'going' },
    });
    expect(owed).toEqual([]);
  });

  it('mixed roster: only the members who still owe are returned, in roster order', () => {
    const owed = resolveOwedResponses({
      roster: [
        { userId: 'a', isChild: false },
        { userId: 'b', isChild: false },
        { userId: 'c', isChild: true },
      ],
      statusBySubjectUserId: { a: 'going' },
    });
    expect(owed).toEqual(['b', 'c']);
  });
});

describe('resolveReminderRecipients (Requirement B3, D-B2)', () => {
  it('an adult who owes a response is nudged directly', () => {
    const recipients = resolveReminderRecipients({
      owedUserIds: ['coach-1'],
      isChildByUserId: {},
      caregiverIdsByChildId: {},
    });
    expect(recipients).toEqual(['coach-1']);
  });

  it("a child who owes a response is nudged via their linked caregiver, not the child", () => {
    const recipients = resolveReminderRecipients({
      owedUserIds: ['johnny'],
      isChildByUserId: { johnny: true },
      caregiverIdsByChildId: { johnny: ['dad-1'] },
    });
    expect(recipients).toEqual(['dad-1']);
  });

  it('a caregiver of two owed children gets exactly one recipient entry (D-B2: one push per caregiver)', () => {
    const recipients = resolveReminderRecipients({
      owedUserIds: ['johnny', 'jenny'],
      isChildByUserId: { johnny: true, jenny: true },
      caregiverIdsByChildId: { johnny: ['dad-1'], jenny: ['dad-1'] },
    });
    expect(recipients).toEqual(['dad-1']);
  });

  it('a child with multiple caregivers nudges each of them', () => {
    const recipients = resolveReminderRecipients({
      owedUserIds: ['johnny'],
      isChildByUserId: { johnny: true },
      caregiverIdsByChildId: { johnny: ['dad-1', 'mum-1'] },
    });
    expect(recipients.sort()).toEqual(['dad-1', 'mum-1']);
  });

  it('a child with no linked caregiver on record contributes no recipient', () => {
    const recipients = resolveReminderRecipients({
      owedUserIds: ['orphan-record'],
      isChildByUserId: { 'orphan-record': true },
      caregiverIdsByChildId: {},
    });
    expect(recipients).toEqual([]);
  });

  it('a mixed roster (adult coach + two owed children of the same caregiver) de-dupes correctly', () => {
    const recipients = resolveReminderRecipients({
      owedUserIds: ['coach-1', 'johnny', 'jenny'],
      isChildByUserId: { johnny: true, jenny: true },
      caregiverIdsByChildId: { johnny: ['dad-1'], jenny: ['dad-1'] },
    });
    expect(recipients.sort()).toEqual(['coach-1', 'dad-1']);
  });
});

describe('buildRsvpReminderMessage (Requirement D-B2)', () => {
  it('includes the event title and team label', () => {
    const message = buildRsvpReminderMessage('Training', 'U10 Sharks');
    expect(message.body).toBe('Reminder: RSVP for Training — U10 Sharks');
  });

  it('falls back gracefully with no team label (event visible to all teams)', () => {
    const message = buildRsvpReminderMessage('Club Fun Day');
    expect(message.body).toBe('Reminder: RSVP for Club Fun Day');
  });
});

describe('property tests', () => {
  const idArb = fc.uuid();
  const statusArb = fc.constantFrom<RsvpStatus>('going', 'not_going', 'maybe', 'no_response');

  it('Property: resolveOwedResponses never returns a roster member whose status is going/maybe/not_going', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(idArb, { maxLength: 8 }),
        (userIds) => {
          const roster: RosterMember[] = userIds.map((id) => ({ userId: id, isChild: false }));
          const statusBySubjectUserId: Record<string, RsvpStatus> = {};
          userIds.forEach((id, i) => {
            // Deterministically assign every other user a "responded" status,
            // leave the rest with no row at all.
            if (i % 2 === 0) statusBySubjectUserId[id] = 'going';
          });
          const owed = resolveOwedResponses({ roster, statusBySubjectUserId });
          for (const id of owed) {
            expect(statusBySubjectUserId[id]).not.toBe('going');
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property: resolveReminderRecipients never contains a duplicate', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(idArb, { maxLength: 6 }),
        fc.uniqueArray(idArb, { maxLength: 3 }),
        (childIds, caregiverIds) => {
          if (caregiverIds.length === 0) return;
          const isChildByUserId: Record<string, boolean> = {};
          const caregiverIdsByChildId: Record<string, string[]> = {};
          childIds.forEach((childId, i) => {
            isChildByUserId[childId] = true;
            // Every child shares the same caregiver pool, to exercise de-dup.
            caregiverIdsByChildId[childId] = [caregiverIds[i % caregiverIds.length]];
          });
          const recipients = resolveReminderRecipients({
            owedUserIds: childIds,
            isChildByUserId,
            caregiverIdsByChildId,
          });
          expect(new Set(recipients).size).toBe(recipients.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property: every distinct status in the input is exhaustively either owed or not, never both', () => {
    fc.assert(
      fc.property(fc.uniqueArray(idArb, { maxLength: 8 }), fc.array(statusArb, { maxLength: 8 }), (userIds, statuses) => {
        const roster: RosterMember[] = userIds.map((id) => ({ userId: id, isChild: false }));
        const statusBySubjectUserId: Record<string, RsvpStatus> = {};
        userIds.forEach((id, i) => {
          if (statuses[i]) statusBySubjectUserId[id] = statuses[i];
        });
        const owed = resolveOwedResponses({ roster, statusBySubjectUserId });
        const owedSet = new Set(owed);
        for (const id of userIds) {
          const status = statusBySubjectUserId[id];
          const shouldOwe = !status || status === 'no_response';
          expect(owedSet.has(id)).toBe(shouldOwe);
        }
      }),
      { numRuns: 200 }
    );
  });
});
