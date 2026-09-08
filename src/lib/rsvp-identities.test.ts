/**
 * Tests for `resolveRsvpIdentities` (Requirement A1-A4, `v1.7-rsvp-
 * availability` Piece A).
 *
 * Run: npm test  (vitest --run, never watch mode)
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { resolveRsvpIdentities, type RsvpIdentity } from './rsvp-identities';
import type { TeamRole } from '../types/database';

describe('resolveRsvpIdentities — self-only (Requirement A2)', () => {
  it('a plain player with no linked children gets exactly one self identity', () => {
    const identities = resolveRsvpIdentities({
      currentUserId: 'u1',
      currentUserName: 'Hewie Duck',
      currentUserTeamRoles: ['player'],
      linkedChildrenOnTeam: [],
    });
    expect(identities).toEqual([{ subjectUserId: 'u1', label: 'Hewie Duck — Player', isSelf: true }]);
  });

  it('a coach with no linked children gets exactly one self identity, labelled Coach', () => {
    const identities = resolveRsvpIdentities({
      currentUserId: 'u1',
      currentUserName: 'Mortimer Mouse',
      currentUserTeamRoles: ['coach'],
      linkedChildrenOnTeam: [],
    });
    expect(identities).toEqual([{ subjectUserId: 'u1', label: 'Mortimer Mouse — Coach', isSelf: true }]);
  });
});

describe('resolveRsvpIdentities — caregiver with children (Requirement A3)', () => {
  it('a pure caregiver (no membership on this team) gets one identity per child, no self', () => {
    const identities = resolveRsvpIdentities({
      currentUserId: 'caregiver-1',
      currentUserName: 'John Smith',
      currentUserTeamRoles: [],
      linkedChildrenOnTeam: [
        { id: 'jenny', name: 'Jenny Smith' },
        { id: 'johnny', name: 'Johnny Smith' },
      ],
    });
    expect(identities).toEqual([
      { subjectUserId: 'jenny', label: 'Jenny Smith', isSelf: false },
      { subjectUserId: 'johnny', label: 'Johnny Smith', isSelf: false },
    ]);
  });

  it('children are always ordered by name, regardless of input order', () => {
    const identities = resolveRsvpIdentities({
      currentUserId: 'caregiver-1',
      currentUserName: 'John Smith',
      currentUserTeamRoles: [],
      linkedChildrenOnTeam: [
        { id: 'zoe', name: 'Zoe Smith' },
        { id: 'amy', name: 'Amy Smith' },
      ],
    });
    expect(identities.map((i) => i.label)).toEqual(['Amy Smith', 'Zoe Smith']);
  });
});

describe('resolveRsvpIdentities — mixed coach + caregiver (Requirement A3, A4)', () => {
  it('a coach who is also caregiver of a player on the same team gets self first, then children', () => {
    const identities = resolveRsvpIdentities({
      currentUserId: 'u1',
      currentUserName: 'John Smith',
      currentUserTeamRoles: ['coach'],
      linkedChildrenOnTeam: [{ id: 'johnny', name: 'Johnny Smith' }],
    });
    expect(identities).toEqual([
      { subjectUserId: 'u1', label: 'John Smith — Coach', isSelf: true },
      { subjectUserId: 'johnny', label: 'Johnny Smith', isSelf: false },
    ]);
  });

  it('manager label takes precedence over coach when a person holds both roles', () => {
    const identities = resolveRsvpIdentities({
      currentUserId: 'u1',
      currentUserName: 'George Pig',
      currentUserTeamRoles: ['manager', 'coach'],
      linkedChildrenOnTeam: [],
    });
    expect(identities[0].label).toBe('George Pig — Manager');
  });
});

describe('resolveRsvpIdentities — zero identities', () => {
  it('a caregiver with no membership and no children on this team gets nothing', () => {
    const identities = resolveRsvpIdentities({
      currentUserId: 'caregiver-1',
      currentUserName: 'Someone Else',
      currentUserTeamRoles: [],
      linkedChildrenOnTeam: [],
    });
    expect(identities).toEqual([]);
  });
});

describe('resolveRsvpIdentities — property tests', () => {
  const roleArb = fc.constantFrom<TeamRole>('player', 'coach', 'manager');

  it('Property: identity count is always (0 or 1 for self) + linked children count', () => {
    fc.assert(
      fc.property(
        fc.array(roleArb, { maxLength: 3 }),
        fc.array(
          fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 20 }) }),
          { maxLength: 5 }
        ),
        (roles, children) => {
          const identities = resolveRsvpIdentities({
            currentUserId: 'u1',
            currentUserName: 'Test User',
            currentUserTeamRoles: roles,
            linkedChildrenOnTeam: children,
          });
          const expectedSelfCount = roles.length > 0 ? 1 : 0;
          expect(identities.length).toBe(expectedSelfCount + children.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property: self identity, when present, is always first and isSelf=true; every other identity has isSelf=false', () => {
    fc.assert(
      fc.property(
        fc.array(roleArb, { minLength: 1, maxLength: 3 }),
        fc.array(
          fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 20 }) }),
          { maxLength: 5 }
        ),
        (roles, children) => {
          const identities = resolveRsvpIdentities({
            currentUserId: 'u1',
            currentUserName: 'Test User',
            currentUserTeamRoles: roles,
            linkedChildrenOnTeam: children,
          });
          expect(identities[0]?.isSelf).toBe(true);
          expect(identities[0]?.subjectUserId).toBe('u1');
          identities.slice(1).forEach((i: RsvpIdentity) => expect(i.isSelf).toBe(false));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property: every subjectUserId in the result is unique', () => {
    fc.assert(
      fc.property(
        fc.array(roleArb, { maxLength: 3 }),
        fc.uniqueArray(
          fc.record({ id: fc.uuid(), name: fc.string({ minLength: 1, maxLength: 20 }) }),
          { maxLength: 5, selector: (c) => c.id }
        ),
        (roles, children) => {
          const identities = resolveRsvpIdentities({
            currentUserId: 'u1',
            currentUserName: 'Test User',
            currentUserTeamRoles: roles,
            linkedChildrenOnTeam: children,
          });
          const ids = identities.map((i) => i.subjectUserId);
          expect(new Set(ids).size).toBe(ids.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});
