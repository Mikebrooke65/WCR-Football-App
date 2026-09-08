import { ApiClient, ApiError } from './api-client';
import type { Event, EventRsvp, Team } from '../types/database';

export interface EventAttendeeDetail {
  user_id: string;
  name: string;
  status: 'going' | 'not_going' | 'maybe' | 'no_response';
  decline_reason?: 'late' | 'sick' | 'injured' | 'holiday' | 'other' | null;
}

export interface EventAttendeeDetails {
  going: EventAttendeeDetail[];
  maybe: EventAttendeeDetail[];
  not_going: EventAttendeeDetail[];
  no_response: EventAttendeeDetail[];
}

export class EventsApi extends ApiClient {
  // Get events visible to current user
  async getEvents(): Promise<Event[]> {
    return this.query<Event>('events', {
      order: { column: 'event_date', ascending: true },
    });
  }

  // Get events by type
  async getEventsByType(eventType: 'game' | 'training' | 'general'): Promise<Event[]> {
    return this.query<Event>('events', {
      match: { event_type: eventType },
      order: { column: 'event_date', ascending: true },
    });
  }

  // Get a single event
  async getEvent(eventId: string): Promise<Event> {
    return this.queryOne<Event>('events', eventId);
  }

  // Create a new event
  async createEvent(event: Omit<Event, 'id' | 'created_at' | 'updated_at'>): Promise<Event> {
    const { data: { user } } = await this.supabase.auth.getUser();
    return this.insert<Event>('events', {
      ...event,
      created_by: user?.id,
    });
  }

  // Update an event
  async updateEvent(eventId: string, updates: Partial<Event>): Promise<Event> {
    const { data: { user } } = await this.supabase.auth.getUser();
    return this.update<Event>('events', eventId, {
      ...updates,
      updated_by: user?.id,
    });
  }

  // Delete an event
  async deleteEvent(eventId: string): Promise<void> {
    return this.delete('events', eventId);
  }

  // Get the current user's own RSVP for an event (self only — not a
  // linked child's). Unused by any current call site (superseded by the
  // batched getUserRsvps below) but kept working rather than left as a
  // landmine: since migration 077 moved uniqueness to
  // (event_id, subject_user_id), a caregiver can hold more than one RSVP
  // row sharing the same user_id (one per child) for the same event, so
  // filtering only by user_id here would break `.single()`. Filtering by
  // subject_user_id = self keeps this method's "my own RSVP" meaning exact.
  async getUserRsvp(eventId: string): Promise<EventRsvp | null> {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await this.supabase
      .from('event_rsvps')
      .select('*')
      .eq('event_id', eventId)
      .eq('subject_user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No RSVP found
      throw new ApiError(error.message);
    }
    return data as EventRsvp;
  }

  // Get RSVPs for a batch of events in one query, across every identity
  // (self + linked children, V1.7 Piece A) the current user can RSVP as.
  //
  // Schedule pages used to call getUserRsvp() once per event via
  // Promise.all — each call independently hit supabase.auth.getUser(),
  // which does a network round trip and takes an internal navigator lock
  // to guard session refresh. Firing N of those concurrently on page load
  // (one per event) contended for that lock and could surface as
  // "Lock was stolen by another request", plus made the page slower to
  // load, and left the auth client in a state where an immediately-following
  // getUser() call (e.g. from createEvent) could fail. This does exactly
  // one auth.getUser() call and one query for the whole page instead of N+N.
  //
  // Return shape changed for Piece A: a caregiver can hold more than one
  // RSVP per event (one per child, plus their own), so this can no longer
  // be a flat event_id -> EventRsvp map. Now event_id -> subject_user_id ->
  // EventRsvp. A single-identity call site reads `map[eventId]?.[userId]`.
  //
  // `additionalSubjectUserIds` is the caller's linked-children id set (from
  // resolveRsvpIdentities upstream) — self is always included automatically.
  async getUserRsvps(
    eventIds: string[],
    additionalSubjectUserIds: string[] = []
  ): Promise<Record<string, Record<string, EventRsvp>>> {
    if (eventIds.length === 0) return {};
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) return {};

    const subjectUserIds = Array.from(new Set([user.id, ...additionalSubjectUserIds]));

    const { data, error } = await this.supabase
      .from('event_rsvps')
      .select('*')
      .in('event_id', eventIds)
      .in('subject_user_id', subjectUserIds);

    if (error) throw new ApiError(error.message);

    const map: Record<string, Record<string, EventRsvp>> = {};
    (data || []).forEach((rsvp: EventRsvp) => {
      if (!map[rsvp.event_id]) map[rsvp.event_id] = {};
      map[rsvp.event_id][rsvp.subject_user_id] = rsvp;
    });
    return map;
  }

  // Set an RSVP for an event, on behalf of a given identity (self by
  // default, or a linked child's user id — V1.7 Piece A, Requirement A4).
  // The submitter (`user_id`) is always whoever is actually logged in;
  // `subject_user_id` is who the RSVP is about. Security note: this method
  // itself does not verify `subjectUserId` is a real linked child — that's
  // enforced server-side by migration 077's RLS WITH CHECK (Requirement
  // A7), so a malicious/buggy client can't write an arbitrary child's RSVP.
  //
  // Single upsert on the (event_id, subject_user_id) unique constraint
  // (migration 077, previously (event_id, user_id) from migration 023)
  // instead of a SELECT-to-check-existence followed by an INSERT-or-UPDATE —
  // that used to be two sequential network round trips for every tap of
  // Going/Maybe/Can't Go, which is most of why RSVP felt slow to respond.
  // Trade-off: responded_at now reflects the *most recent* response instead
  // of only the first one. That's fine for what it's used for (knowing who
  // has vs. hasn't responded at all) and not worth a second round trip to
  // preserve.
  async setRsvp(
    eventId: string,
    status: 'going' | 'not_going' | 'maybe' | 'no_response',
    declineReason?: 'late' | 'sick' | 'injured' | 'holiday' | 'other',
    subjectUserId?: string
  ): Promise<EventRsvp> {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) throw new ApiError('User not authenticated');

    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('event_rsvps')
      .upsert(
        {
          event_id: eventId,
          user_id: user.id,
          subject_user_id: subjectUserId || user.id,
          status,
          decline_reason: status === 'not_going' ? (declineReason || null) : null,
          responded_at: status !== 'no_response' ? now : null,
        },
        { onConflict: 'event_id,subject_user_id' }
      )
      .select()
      .single();

    if (error) throw new ApiError(error.message);
    return data as EventRsvp;
  }

  // Get attendee counts (going) for multiple events
  /**
   * How many people have ANSWERED at all — going, maybe or can't-go — per
   * event. Distinct from `getAttendeeCounts`, which deliberately counts
   * only `going` because it feeds the "X/Y attending" counter.
   *
   * The Send Reminder message needs this one instead: a person who replied
   * "Can't Go" has responded, and telling the team "we've only had 1 reply"
   * when four people have answered (three of them declining) is simply
   * wrong, and undercounts exactly the people you are not chasing.
   */
  async getResponseCounts(eventIds: string[]): Promise<Record<string, number>> {
    if (eventIds.length === 0) return {};
    const { data, error } = await this.supabase
      .from('event_rsvps')
      .select('event_id')
      .in('event_id', eventIds)
      .neq('status', 'no_response');

    if (error) return {};

    const counts: Record<string, number> = {};
    (data || []).forEach((row: { event_id: string }) => {
      counts[row.event_id] = (counts[row.event_id] || 0) + 1;
    });
    return counts;
  }

  async getAttendeeCounts(eventIds: string[]): Promise<Record<string, number>> {
    if (eventIds.length === 0) return {};
    const { data, error } = await this.supabase
      .from('event_rsvps')
      .select('event_id')
      .in('event_id', eventIds)
      .eq('status', 'going');

    if (error) return {};
    
    const counts: Record<string, number> = {};
    (data || []).forEach((row: { event_id: string }) => {
      counts[row.event_id] = (counts[row.event_id] || 0) + 1;
    });
    return counts;
  }

  // Get total eligible member counts for events (coaches + players, not caregivers)
  // Returns { eventId: totalMembers } based on each event's target_teams
  async getTotalMemberCounts(events: Event[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    if (events.length === 0) return counts;

    // Collect all unique team IDs across events
    const allTeamIds = new Set<string>();
    for (const event of events) {
      if (event.target_teams) {
        for (const tid of event.target_teams) {
          allTeamIds.add(tid);
        }
      }
    }

    if (allTeamIds.size === 0) return counts;

    // Get member counts per team in one query
    const { data, error } = await this.supabase
      .from('team_members')
      .select('team_id')
      .in('team_id', Array.from(allTeamIds));

    if (error || !data) return counts;

    // Count members per team
    const teamCounts: Record<string, number> = {};
    for (const row of data) {
      teamCounts[row.team_id] = (teamCounts[row.team_id] || 0) + 1;
    }

    // Map to events — sum members across target_teams (usually just one team)
    for (const event of events) {
      let total = 0;
      if (event.target_teams) {
        for (const tid of event.target_teams) {
          total += teamCounts[tid] || 0;
        }
      }
      counts[event.id] = total;
    }

    return counts;
  }

  // Full breakdown of who's going / maybe / can't go (with reason) / hasn't
  // responded, for the "X/Y attending" counter on an event — that counter
  // only ever showed a number with no way to see the people behind it.
  // Roster comes from team_members for the event's target team(s) so
  // "no response" is derivable (team roster minus everyone with an RSVP
  // row), not just the people who happened to respond.
  async getEventAttendeeDetails(event: Event): Promise<EventAttendeeDetails> {
    const empty: EventAttendeeDetails = { going: [], maybe: [], not_going: [], no_response: [] };
    if (!event.target_teams || event.target_teams.length === 0) return empty;

    // Roster and RSVPs don't depend on each other — fetch them together
    // instead of one after another. This was the other half of the "why is
    // this modal slow to open" delay, same cause as the Schedule page load
    // above: independent queries were being awaited in sequence.
    const [
      { data: members, error: membersError },
      { data: rsvps, error: rsvpsError },
    ] = await Promise.all([
      this.supabase
        .from('team_members')
        .select('user_id, user:users(id, first_name, last_name)')
        .in('team_id', event.target_teams),
      this.supabase
        .from('event_rsvps')
        .select('subject_user_id, status, decline_reason')
        .eq('event_id', event.id),
    ]);

    if (membersError || !members) return empty;
    if (rsvpsError) return empty;

    // Keyed by subject_user_id (V1.7 Piece A), not user_id — a
    // caregiver-submitted RSVP for a child is attributed to the CHILD
    // (who's the actual roster member here), not whichever caregiver
    // happened to tap the button.
    const rsvpByUser = new Map<string, { status: string; decline_reason: string | null }>();
    (rsvps || []).forEach((r: any) => rsvpByUser.set(r.subject_user_id, r));

    const result: EventAttendeeDetails = { going: [], maybe: [], not_going: [], no_response: [] };

    // De-dupe in case a member sits on more than one of the event's target teams
    const seen = new Set<string>();
    for (const m of members as any[]) {
      if (!m.user || seen.has(m.user_id)) continue;
      seen.add(m.user_id);

      const rsvp = rsvpByUser.get(m.user_id);
      const status = (rsvp?.status as EventAttendeeDetail['status']) || 'no_response';
      result[status].push({
        user_id: m.user_id,
        name: `${m.user.first_name} ${m.user.last_name}`.trim(),
        status,
        decline_reason: rsvp?.decline_reason as EventAttendeeDetail['decline_reason'],
      });
    }

    // Anyone who actually RSVP'd but wasn't returned by the team_members
    // roster query above (most likely because they've since left the team,
    // or the event's target teams changed after they RSVP'd — the query
    // above has no role filter, so this is never about a role like
    // 'manager' being excluded) was previously dropped from the list
    // entirely: the loop above only walks the roster, so a real RSVP with
    // no matching roster row just vanished. Look up their name separately
    // and still show them, rather than silently discarding a response
    // someone actually gave.
    const missingUserIds = Array.from(rsvpByUser.keys()).filter((id) => !seen.has(id));
    if (missingUserIds.length > 0) {
      const { data: extraUsers } = await this.supabase
        .from('users')
        .select('id, first_name, last_name')
        .in('id', missingUserIds);

      const nameById = new Map<string, string>(
        (extraUsers || []).map((u: any) => [u.id, `${u.first_name} ${u.last_name}`.trim()])
      );

      for (const userId of missingUserIds) {
        const rsvp = rsvpByUser.get(userId)!;
        const status = (rsvp.status as EventAttendeeDetail['status']) || 'no_response';
        result[status].push({
          user_id: userId,
          name: nameById.get(userId) || 'Unknown',
          status,
          decline_reason: rsvp.decline_reason as EventAttendeeDetail['decline_reason'],
        });
      }
    }

    (Object.keys(result) as (keyof EventAttendeeDetails)[]).forEach((key) => {
      result[key].sort((a, b) => a.name.localeCompare(b.name));
    });

    return result;
  }

  // Get user's teams (for event creation targeting)
  async getUserTeams(): Promise<Team[]> {
    const { data: { user } } = await this.supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await this.supabase
      .from('team_members')
      .select('team:teams(*)')
      .eq('user_id', user.id);

    if (error) throw new ApiError(error.message);
    return data.map((tm: any) => tm.team).filter(Boolean);
  }

  // Get all teams (for admin)
  async getAllTeams(): Promise<Team[]> {
    return this.query<Team>('teams', {
      order: { column: 'name', ascending: true },
    });
  }

  // Get events for a specific competition
  async getEventsByCompetition(competitionId: string): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('competition_id', competitionId)
      .order('round_number', { ascending: true })
      .order('match_number', { ascending: true });

    if (error) throw new ApiError(error.message);
    return data as Event[];
  }

  // Update game event score
  async updateEventScore(
    eventId: string,
    teamScore: number,
    opponentScore: number
  ): Promise<Event> {
    const { data: { user } } = await this.supabase.auth.getUser();
    return this.update<Event>('events', eventId, {
      team_score: teamScore,
      opponent_score: opponentScore,
      updated_by: user?.id,
    });
  }
}

export const eventsApi = new EventsApi();
