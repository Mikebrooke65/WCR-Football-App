import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Calendar, Clock, MapPin, CheckCircle, XCircle, HelpCircle, Plus, Users, Bell, X } from 'lucide-react';
import { eventsApi } from '../lib/events-api';
import type { EventAttendeeDetails } from '../lib/events-api';
import { messagingApi } from '../lib/messaging-api';
import { caregiversApi } from '../lib/caregivers-api';
import { resolveRsvpIdentities } from '../lib/rsvp-identities';
import type { RsvpIdentity } from '../lib/rsvp-identities';
import { useAuth } from '../contexts/AuthContext';
import { MessagingProvider } from '../contexts/MessagingContext';
import { ComposeForm } from '../components/messaging/ComposeForm';
import type { Event, EventRsvp, Team, TeamRole } from '../types/database';

const REQUIRED_FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  event_date: 'Date',
  event_time: 'Time',
  location: 'Venue',
  opponent: 'Opponent',
  target_teams: 'Team',
};

export function Schedule() {
  const { user } = useAuth();
  // V1.7 Piece B (Requirement B5/B6): an RSVP reminder push deep-links here
  // as `/schedule?event=<id>` (see push-routing-logic.ts). Once events have
  // loaded, scroll that card into view and briefly highlight it so the tap
  // actually lands the person on the thing they were reminded about,
  // instead of just opening the page and leaving them to scroll and find it.
  const [searchParams] = useSearchParams();
  const highlightedEventId = searchParams.get('event');
  const [events, setEvents] = useState<Event[]>([]);
  // V1.7 Piece A: keyed by event id, then by subject_user_id — a caregiver
  // can hold more than one RSVP per event, one per linked child (plus their
  // own if they're also a member of the team). See rsvp-identities.ts.
  const [rsvps, setRsvps] = useState<Record<string, Record<string, EventRsvp>>>({});
  const [linkedChildren, setLinkedChildren] = useState<{ id: string; name: string; teamIds: string[] }[]>([]);
  const [attendeeCounts, setAttendeeCounts] = useState<Record<string, number>>({});
  const [totalMemberCounts, setTotalMemberCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<'all' | 'game' | 'training' | 'general'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [userTeams, setUserTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);

  // Create/Edit Event modal — validation error shown *inside* the modal
  // (the page-level `error` banner above renders behind the modal overlay,
  // so a validation failure there looked like "nothing happens")
  const [modalError, setModalError] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<Set<string>>(new Set());

  // Send Reminder modal state
  const [reminderEvent, setReminderEvent] = useState<Event | null>(null);

  // Attendee list modal state — the "X/Y attending" counter previously had
  // no way to see who's behind the number
  const [attendeeModalEvent, setAttendeeModalEvent] = useState<Event | null>(null);
  const [attendeeDetails, setAttendeeDetails] = useState<EventAttendeeDetails | null>(null);
  const [attendeeLoading, setAttendeeLoading] = useState(false);

  // Decline reason modal state
  const [declineModalOpen, setDeclineModalOpen] = useState(false);
  const [declineEventId, setDeclineEventId] = useState<string | null>(null);
  const [declineSubjectUserId, setDeclineSubjectUserId] = useState<string | undefined>(undefined);
  const [declineReason, setDeclineReason] = useState<'late' | 'sick' | 'injured' | 'holiday' | 'other'>('sick');

  // Multi-identity RSVP modal — shown when a caregiver (or a coach/manager
  // who is also a caregiver) has more than one identity they can RSVP as
  // for a given event (Requirement A5/A6, `rsvp-identities.ts`).
  const [rsvpModalEvent, setRsvpModalEvent] = useState<Event | null>(null);
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    event_type: 'training' as 'game' | 'training' | 'general',
    event_date: '',
    event_time: '',
    location: '',
    opponent: '',
    home_away: 'home' as 'home' | 'away',
    target_teams: [] as string[],
  });

  useEffect(() => {
    loadEvents();
    loadTeams();
  }, []);

  useEffect(() => {
    if (!highlightedEventId || loading) return;
    const el = document.getElementById(`event-${highlightedEventId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedEventId, loading, events]);

  // V1.7 Piece A (Requirement A1-A4): the set of identities a caregiver can
  // RSVP as for each event — themselves (if they hold a role on the
  // event's target team) plus one per linked child who plays there. An
  // event with no target_teams is visible to everyone, so every role/child
  // the user has anywhere counts for it.
  const identitiesByEvent = useMemo(() => {
    const map: Record<string, RsvpIdentity[]> = {};
    if (!user) return map;

    for (const event of events) {
      const scoped = event.target_teams && event.target_teams.length > 0;

      const rolesOnTeam: TeamRole[] = [];
      for (const membership of user.teamMemberships || []) {
        if (scoped && !event.target_teams.includes(membership.team_id)) continue;
        rolesOnTeam.push(membership.role);
        if (membership.is_coach && !rolesOnTeam.includes('coach')) rolesOnTeam.push('coach');
      }

      const childrenOnTeam = linkedChildren
        .filter((child) => !scoped || child.teamIds.some((tid) => event.target_teams.includes(tid)))
        .map((child) => ({ id: child.id, name: child.name }));

      map[event.id] = resolveRsvpIdentities({
        currentUserId: user.id,
        currentUserName: `${user.first_name} ${user.last_name}`.trim(),
        currentUserTeamRoles: rolesOnTeam,
        linkedChildrenOnTeam: childrenOnTeam,
      });
    }

    return map;
  }, [events, user, linkedChildren]);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const data = await eventsApi.getEvents();
      setEvents(data);

      // Linked children (V1.7 Piece A) are best-effort, same reasoning as
      // teams-api.ts's getMyTeams: a lookup failure here should cost the
      // caregiver their multi-child RSVP identities, not the whole page.
      let children: { id: string; name: string; teamIds: string[] }[] = [];
      if (user?.id) {
        try {
          children = await caregiversApi.getCaregiverChildrenWithTeamIds(user.id);
        } catch (err) {
          console.error('Failed to load linked children:', err);
        }
      }
      setLinkedChildren(children);

      // These three don't depend on each other's results — only on `data`
      // — so run them together instead of one-after-another. Each is a
      // separate network round trip; awaiting them in sequence was adding
      // their latencies up instead of overlapping them, which is most of
      // why the page took several seconds to appear.
      const [rsvpMap, counts, totals] = await Promise.all([
        eventsApi.getUserRsvps(data.map(e => e.id), children.map((c) => c.id)),
        eventsApi.getAttendeeCounts(data.map(e => e.id)),
        eventsApi.getTotalMemberCounts(data),
      ]);
      setRsvps(rsvpMap);
      setAttendeeCounts(counts);
      setTotalMemberCounts(totals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  const loadTeams = async () => {
    try {
      const teams = await eventsApi.getUserTeams();
      setUserTeams(teams);

      // If admin, also load all teams
      if (user?.role === 'admin') {
        const all = await eventsApi.getAllTeams();
        setAllTeams(all);
      }
    } catch (err) {
      console.error('Failed to load teams:', err);
    }
  };

  const handleCreateEvent = async () => {
    try {
      setModalError(null);
      setMissingFields(new Set());

      // Validation — collect every missing field so the message and the
      // highlighted inputs both name exactly what's wrong, instead of one
      // generic "fill in required fields" that didn't say which one.
      const missing = new Set<string>();
      if (formData.event_type !== 'game' && !formData.title) missing.add('title');
      if (!formData.event_date) missing.add('event_date');
      if (!formData.event_time) missing.add('event_time');
      if (!formData.location) missing.add('location');
      if (formData.event_type === 'game' && !formData.opponent) missing.add('opponent');
      if (formData.event_type === 'game' && formData.target_teams.length !== 1) missing.add('target_teams');

      if (missing.size > 0) {
        const labels = Array.from(missing).map((f) => REQUIRED_FIELD_LABELS[f] || f);
        setMissingFields(missing);
        setModalError(
          formData.event_type === 'game' && missing.has('target_teams') && missing.size === 1
            ? 'Game events must be assigned to exactly one team'
            : `Please complete: ${labels.join(', ')}`
        );
        return;
      }

      // Combine date and time
      const eventDateTime = new Date(`${formData.event_date}T${formData.event_time}`).toISOString();

      if (editingEventId) {
        // Update existing event
        const oldEvent = events.find(e => e.id === editingEventId);
        const updatedEvent = await eventsApi.updateEvent(editingEventId, {
          title: formData.title,
          event_type: formData.event_type,
          event_date: eventDateTime,
          location: formData.location,
          opponent: formData.event_type === 'game' ? formData.opponent : undefined,
          home_away: formData.event_type === 'game' ? formData.home_away : undefined,
          target_teams: formData.target_teams,
        });

        setEvents(events.map(e => e.id === editingEventId ? updatedEvent : e));

        // Send change notification if event details changed
        if (oldEvent && formData.target_teams.length > 0) {
          await sendChangeNotification(oldEvent, updatedEvent, formData.target_teams[0]);
        }
      } else {
        // Create new event
        const newEvent = await eventsApi.createEvent({
          title: formData.title,
          event_type: formData.event_type,
          event_date: eventDateTime,
          location: formData.location,
          opponent: formData.event_type === 'game' ? formData.opponent : undefined,
          home_away: formData.event_type === 'game' ? formData.home_away : undefined,
          target_teams: formData.target_teams,
          target_roles: [],
          target_divisions: [],
          target_age_groups: [],
        });

        setEvents([...events, newEvent]);
      }

      setIsModalOpen(false);
      setEditingEventId(null);
      setModalError(null);
      setMissingFields(new Set());
      resetForm();
    } catch (err) {
      // Server-side failure (e.g. RLS) — still shown inside the modal, same
      // reasoning as the validation errors above: a banner behind the modal
      // overlay is invisible until the modal is closed.
      setModalError(err instanceof Error ? err.message : 'Failed to save event');
    }
  };

  const handleEditEvent = (event: Event) => {
    // Extract time from ISO date
    const eventDate = new Date(event.event_date);
    const dateStr = eventDate.toISOString().split('T')[0];
    const timeStr = eventDate.toTimeString().slice(0, 5);

    setFormData({
      title: event.title,
      event_type: event.event_type,
      event_date: dateStr,
      event_time: timeStr,
      location: event.location,
      opponent: event.opponent || '',
      home_away: event.home_away || 'home',
      target_teams: event.target_teams || [],
    });
    setEditingEventId(event.id);
    setModalError(null);
    setMissingFields(new Set());
    setIsModalOpen(true);
  };

  const sendChangeNotification = async (oldEvent: Event, newEvent: Event, teamId: string) => {
    const changes: string[] = [];
    
    if (oldEvent.title !== newEvent.title) changes.push(`Title: ${oldEvent.title} → ${newEvent.title}`);
    if (oldEvent.event_date !== newEvent.event_date) {
      const oldDate = new Date(oldEvent.event_date);
      const newDate = new Date(newEvent.event_date);
      changes.push(`Date/Time: ${formatDate(oldDate.toISOString())} ${formatTime(oldDate.toISOString())} → ${formatDate(newDate.toISOString())} ${formatTime(newDate.toISOString())}`);
    }
    if (oldEvent.location !== newEvent.location) changes.push(`Location: ${oldEvent.location} → ${newEvent.location}`);
    if (oldEvent.opponent !== newEvent.opponent) changes.push(`Opponent: ${oldEvent.opponent} → ${newEvent.opponent}`);

    if (changes.length === 0) return;

    try {
      await messagingApi.createMessage({
        title: `Event Updated: ${newEvent.title}`,
        body: `The following details have changed:\n\n${changes.join('\n')}`,
        team_id: teamId,
        targeting_type: 'whole_team',
        recipient_user_ids: [],
      });
    } catch (err) {
      console.error('Failed to send change notification:', err);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      event_type: 'training',
      event_date: '',
      event_time: '',
      location: '',
      opponent: '',
      home_away: 'home',
      target_teams: [],
    });
  };

  // Optimistic RSVP updates: reflect the tap on screen immediately instead
  // of waiting for the network round trip, then reconcile with what the
  // server actually saved (or roll back on failure). This is most of what
  // made RSVP feel slow — the button used to sit unchanged until the whole
  // request finished, on top of setRsvp itself now being a single upsert
  // instead of two sequential calls (see events-api.ts).
  const handleRsvp = async (
    eventId: string,
    status: 'going' | 'not_going' | 'maybe',
    subjectUserId?: string
  ) => {
    const targetId = subjectUserId || user?.id || '';

    if (status === 'not_going') {
      setDeclineEventId(eventId);
      setDeclineSubjectUserId(subjectUserId);
      setDeclineReason('sick');
      setDeclineModalOpen(true);
      return;
    }

    const previousRsvp = rsvps[eventId]?.[targetId];
    const previousCount = attendeeCounts[eventId] || 0;
    const oldStatus = previousRsvp?.status;

    const optimisticRsvp: EventRsvp = {
      id: previousRsvp?.id || `optimistic-${eventId}-${targetId}`,
      event_id: eventId,
      user_id: user?.id || '',
      subject_user_id: targetId,
      status,
      responded_at: new Date().toISOString(),
      decline_reason: null,
      created_at: previousRsvp?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setRsvps((prev) => ({ ...prev, [eventId]: { ...prev[eventId], [targetId]: optimisticRsvp } }));
    let optimisticCount = previousCount;
    if (oldStatus === 'going' && status !== 'going') optimisticCount--;
    if (oldStatus !== 'going' && status === 'going') optimisticCount++;
    setAttendeeCounts((prev) => ({ ...prev, [eventId]: Math.max(0, optimisticCount) }));

    try {
      const rsvp = await eventsApi.setRsvp(eventId, status, undefined, subjectUserId);
      setRsvps((prev) => ({ ...prev, [eventId]: { ...prev[eventId], [targetId]: rsvp } }));
    } catch (err) {
      setRsvps((prev) => {
        const next = { ...prev, [eventId]: { ...prev[eventId] } };
        if (previousRsvp) next[eventId][targetId] = previousRsvp; else delete next[eventId][targetId];
        return next;
      });
      setAttendeeCounts((prev) => ({ ...prev, [eventId]: previousCount }));
      setError(err instanceof Error ? err.message : 'Failed to update RSVP');
    }
  };

  const handleDeclineConfirm = async () => {
    if (!declineEventId) return;
    const eventId = declineEventId;
    const subjectUserId = declineSubjectUserId;
    const targetId = subjectUserId || user?.id || '';
    const reason = declineReason;
    const previousRsvp = rsvps[eventId]?.[targetId];
    const previousCount = attendeeCounts[eventId] || 0;
    const oldStatus = previousRsvp?.status;

    const optimisticRsvp: EventRsvp = {
      id: previousRsvp?.id || `optimistic-${eventId}-${targetId}`,
      event_id: eventId,
      user_id: user?.id || '',
      subject_user_id: targetId,
      status: 'not_going',
      responded_at: new Date().toISOString(),
      decline_reason: reason,
      created_at: previousRsvp?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setRsvps((prev) => ({ ...prev, [eventId]: { ...prev[eventId], [targetId]: optimisticRsvp } }));
    if (oldStatus === 'going') {
      setAttendeeCounts((prev) => ({ ...prev, [eventId]: Math.max(0, previousCount - 1) }));
    }
    setDeclineModalOpen(false);
    setDeclineEventId(null);
    setDeclineSubjectUserId(undefined);
    // Deliberately NOT closing rsvpModalEvent here: when the decline modal
    // was opened from inside the multi-identity modal, confirming should
    // return the caregiver to that modal with the updated identity list,
    // not drop them back to the plain event card.

    try {
      const rsvp = await eventsApi.setRsvp(eventId, 'not_going', reason, subjectUserId);
      setRsvps((prev) => ({ ...prev, [eventId]: { ...prev[eventId], [targetId]: rsvp } }));
    } catch (err) {
      setRsvps((prev) => {
        const next = { ...prev, [eventId]: { ...prev[eventId] } };
        if (previousRsvp) next[eventId][targetId] = previousRsvp; else delete next[eventId][targetId];
        return next;
      });
      setAttendeeCounts((prev) => ({ ...prev, [eventId]: previousCount }));
      setError(err instanceof Error ? err.message : 'Failed to update RSVP');
    }
  };

  const filteredEvents = events.filter((event) => {
    if (filter === 'all') return true;
    return event.event_type === filter;
  });

  // Split into upcoming (soonest first, RSVP still open) and past (greyed
  // out, RSVP locked — most-recent-first so the last thing that happened is
  // closest to today). Previously everything sorted into one ascending list
  // forever, so old test events buried any newly-created future event at
  // the bottom instead of it landing near the top where it's useful.
  const isPastEvent = (event: Event) => new Date(event.event_date).getTime() < Date.now();

  const upcomingEvents = filteredEvents
    .filter((event) => !isPastEvent(event))
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  const pastEvents = filteredEvents
    .filter((event) => isPastEvent(event))
    .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric'
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'training':
        return 'bg-blue-100 text-blue-700';
      case 'game':
        return 'bg-green-100 text-green-700';
      case 'general':
        return 'bg-purple-100 text-purple-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getCardBackgroundColor = (type: string, isPast = false) => {
    if (isPast) return 'rgba(156, 163, 175, 0.15)'; // flat grey for past events, regardless of type
    switch (type) {
      case 'training':
        return 'rgba(59, 130, 246, 0.2)'; // Blue at 20%
      case 'game':
        return 'rgba(34, 197, 94, 0.2)'; // Green at 20%
      case 'general':
        return 'rgba(168, 85, 247, 0.2)'; // Purple at 20%
      default:
        return 'rgba(156, 163, 175, 0.2)'; // Gray at 20%
    }
  };

  const getRsvpIcon = (eventId: string) => {
    const rsvp = rsvps[eventId]?.[user?.id || ''];
    const status = rsvp?.status || 'no_response';
    
    switch (status) {
      case 'going':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'not_going':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'maybe':
        return <HelpCircle className="w-5 h-5 text-yellow-600" />;
      default:
        return <HelpCircle className="w-5 h-5 text-gray-400" />;
    }
  };

  const getEventTitle = (event: Event) => {
    if (event.event_type !== 'game' || !event.opponent) {
      return event.title;
    }

    // Get team name from target_teams
    const teamId = event.target_teams[0];
    const team = userTeams.find(t => t.id === teamId) || allTeams.find(t => t.id === teamId);
    const teamName = team ? `${team.age_group} ${team.name}` : 'Your Team';

    if (event.home_away === 'home') {
      return `${teamName} vs ${event.opponent}`;
    } else {
      return `${event.opponent} vs ${teamName}`;
    }
  };

  const openAttendeeModal = async (event: Event) => {
    setAttendeeModalEvent(event);
    setAttendeeDetails(null);
    setAttendeeLoading(true);
    try {
      const details = await eventsApi.getEventAttendeeDetails(event);
      setAttendeeDetails(details);
    } catch (err) {
      console.error('Failed to load attendee details:', err);
    } finally {
      setAttendeeLoading(false);
    }
  };

  const renderEventCard = (event: Event, isPast: boolean) => (
    <div
      key={event.id}
      id={`event-${event.id}`}
      className={`rounded-lg shadow-sm px-3 py-2 border ${isPast ? 'opacity-60' : ''} ${
        highlightedEventId === event.id ? 'border-[#06b6d4] ring-2 ring-[#06b6d4]' : 'border-gray-200'
      }`}
      style={{ backgroundColor: getCardBackgroundColor(event.event_type, isPast) }}
    >
      {/* Title row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm truncate">{getEventTitle(event)}</h3>
          <span className={`px-1.5 py-0 rounded text-[10px] font-medium capitalize flex-shrink-0 ${getTypeColor(event.event_type)}`}>
            {event.event_type}
          </span>
        </div>
        {getRsvpIcon(event.id)}
      </div>

      {/* Details row - single line */}
      <div className="flex items-center gap-3 text-xs text-gray-500 mb-1.5">
        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(event.event_date)}</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(event.event_date)}</span>
        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{event.location}</span>
      </div>

      {/* Attendees row — tap to see who's behind the count */}
      <button
        type="button"
        onClick={() => openAttendeeModal(event)}
        className="flex items-center gap-1 text-xs text-gray-500 mb-2 underline decoration-dotted hover:text-gray-700"
      >
        <Users className="w-3 h-3" />
        <span>{attendeeCounts[event.id] || 0}/{totalMemberCounts[event.id] || '?'} attending</span>
      </button>

      {/* RSVP Buttons - compact. Locked for past events, current response
          is still visible via the status icon in the title row above. */}
      {isPast ? (
        <p className="text-xs text-gray-500 italic">Event has passed — RSVP closed</p>
      ) : (
        <div className="flex gap-1.5">
          {(() => {
            const identities = identitiesByEvent[event.id] || [];
            const multiIdentity = identities.length >= 2;
            const selfStatus = rsvps[event.id]?.[user?.id || '']?.status;
            const onTap = (status: 'going' | 'not_going' | 'maybe') =>
              multiIdentity ? setRsvpModalEvent(event) : handleRsvp(event.id, status);
            return (
              <>
                <button
                  onClick={() => onTap('going')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    !multiIdentity && selfStatus === 'going'
                      ? 'bg-green-500 text-white'
                      : 'bg-white/70 text-gray-600 border border-gray-200 hover:bg-green-50'
                  }`}
                >
                  <CheckCircle className="w-3 h-3" />
                  Going
                </button>
                <button
                  onClick={() => onTap('maybe')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    !multiIdentity && selfStatus === 'maybe'
                      ? 'bg-gray-500 text-white'
                      : 'bg-white/70 text-gray-600 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <HelpCircle className="w-3 h-3" />
                  Maybe
                </button>
                <button
                  onClick={() => onTap('not_going')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    !multiIdentity && selfStatus === 'not_going'
                      ? 'bg-red-500 text-white'
                      : 'bg-white/70 text-gray-600 border border-gray-200 hover:bg-red-50'
                  }`}
                >
                  <XCircle className="w-3 h-3" />
                  Can't Go
                </button>
              </>
            );
          })()}
        </div>
      )}

      {/* Send Reminder / Edit — visible to coach/manager/admin. Send
          Reminder is hidden for past events (nothing to remind anyone of);
          Edit stays available so a past event can still be corrected
          (e.g. marked cancelled, or its date fixed if it was moved). */}
      {(user?.role === 'coach' || user?.role === 'manager' || user?.role === 'admin') && (
        <div className="flex gap-1.5 mt-1.5">
          {!isPast && (
            <button
              onClick={() => setReminderEvent(event)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[#06b6d4]/20 text-[#06b6d4] border border-[#06b6d4]/30 hover:bg-[#06b6d4]/30 transition-colors"
            >
              <Bell className="w-3 h-3" />
              Send Reminder
            </button>
          )}
          <button
            onClick={() => handleEditEvent(event)}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200 transition-colors"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0091f3] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-4">
        <div className="border-l-8 border-[#06b6d4] pl-4">
          <h1 className="text-2xl font-bold text-gray-900">Schedule</h1>
          <p className="text-gray-600 text-sm">Team Events</p>
        </div>
        
        {/* New Event Button */}
        {(user?.role === 'admin' || user?.role === 'coach' || user?.role === 'manager') && (
          <button
            onClick={() => {
              setModalError(null);
              setMissingFields(new Set());
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#0091f3] text-white rounded-lg hover:bg-[#0077cc] transition-colors"
          >
            <Plus className="w-5 h-5" />
            New
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            filter === 'all'
              ? 'bg-[#0091f3] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('training')}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            filter === 'training'
              ? 'bg-[#0091f3] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Training
        </button>
        <button
          onClick={() => setFilter('game')}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            filter === 'game'
              ? 'bg-[#0091f3] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Games
        </button>
        <button
          onClick={() => setFilter('general')}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            filter === 'general'
              ? 'bg-[#0091f3] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          General
        </button>
      </div>

      {/* Upcoming Events */}
      <div className="space-y-2">
        {upcomingEvents.map((event) => renderEventCard(event, false))}
      </div>

      {upcomingEvents.length === 0 && pastEvents.length === 0 && (
        <div className="text-center py-12">
          <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">No events scheduled</p>
        </div>
      )}

      {upcomingEvents.length === 0 && pastEvents.length > 0 && (
        <div className="text-center py-8">
          <Calendar className="w-10 h-10 text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600 text-sm">No upcoming events</p>
        </div>
      )}

      {/* Past Events - greyed out, RSVP locked, still editable by coach/manager/admin */}
      {pastEvents.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-2 px-1">Past Events</h2>
          <div className="space-y-2">
            {pastEvents.map((event) => renderEventCard(event, true))}
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="p-6 pb-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">{editingEventId ? 'Edit Event' : 'Create Event'}</h2>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Validation / server error — shown here, inside the modal,
                  since a banner above the page renders behind this overlay
                  and is invisible while the modal is open. */}
              {modalError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {modalError}
                </div>
              )}
              <div className="space-y-4">
                {/* Team Selection - FIRST */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Team{formData.event_type === 'game' ? ' *' : ' (optional)'}
                  </label>
                  <select
                    value={formData.target_teams[0] || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      target_teams: e.target.value ? [e.target.value] : []
                    })}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] ${
                      missingFields.has('target_teams') ? 'border-red-400' : 'border-gray-300'
                    }`}
                  >
                    <option value="">All teams</option>
                    {(user?.role === 'admin' ? allTeams : userTeams).map(team => (
                      <option key={team.id} value={team.id}>
                        {team.age_group} {team.name}
                      </option>
                    ))}
                  </select>
                  {formData.event_type === 'game' && (
                    <p className="text-xs text-gray-500 mt-1">
                      Game events must be assigned to exactly one team
                    </p>
                  )}
                </div>

                {/* Event Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Event Type *
                  </label>
                  <select
                    value={formData.event_type}
                    onChange={(e) => {
                      const newType = e.target.value as any;
                      setFormData({ 
                        ...formData, 
                        event_type: newType,
                        title: newType === 'game' ? 'Game' : formData.title
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                  >
                    <option value="training">Training</option>
                    <option value="game">Game</option>
                    <option value="general">General</option>
                  </select>
                </div>

                {/* Title - only show for non-game events */}
                {formData.event_type !== 'game' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Title *
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] ${
                        missingFields.has('title') ? 'border-red-400' : 'border-gray-300'
                      }`}
                      placeholder="e.g., Team Training Session"
                    />
                  </div>
                )}

                {/* Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={formData.event_date}
                    onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] ${
                      missingFields.has('event_date') ? 'border-red-400' : 'border-gray-300'
                    }`}
                  />
                </div>

                {/* Time */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Time *
                  </label>
                  <select
                    value={formData.event_time}
                    onChange={(e) => setFormData({ ...formData, event_time: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] ${
                      missingFields.has('event_time') ? 'border-red-400' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select time</option>
                    <option value="08:00">8:00 AM</option>
                    <option value="08:30">8:30 AM</option>
                    <option value="09:00">9:00 AM</option>
                    <option value="09:30">9:30 AM</option>
                    <option value="10:00">10:00 AM</option>
                    <option value="10:30">10:30 AM</option>
                    <option value="11:00">11:00 AM</option>
                    <option value="11:30">11:30 AM</option>
                    <option value="12:00">12:00 PM</option>
                    <option value="12:30">12:30 PM</option>
                    <option value="13:00">1:00 PM</option>
                    <option value="13:30">1:30 PM</option>
                    <option value="14:00">2:00 PM</option>
                    <option value="14:30">2:30 PM</option>
                    <option value="15:00">3:00 PM</option>
                    <option value="15:30">3:30 PM</option>
                    <option value="16:00">4:00 PM</option>
                    <option value="16:30">4:30 PM</option>
                    <option value="17:00">5:00 PM</option>
                    <option value="17:30">5:30 PM</option>
                    <option value="18:00">6:00 PM</option>
                    <option value="18:30">6:30 PM</option>
                    <option value="19:00">7:00 PM</option>
                    <option value="19:30">7:30 PM</option>
                  </select>
                </div>

                {/* Location */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Venue *
                  </label>
                  <select
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] ${
                      missingFields.has('location') ? 'border-red-400' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select venue</option>
                    <option value="Fred Taylor Park">Fred Taylor Park</option>
                    <option value="Huapai Domain">Huapai Domain</option>
                    <option value="Massey Park">Massey Park</option>
                    <option value="Rosebank Park">Rosebank Park</option>
                    <option value="Waitakere Stadium">Waitakere Stadium</option>
                    <option value="Henderson Park">Henderson Park</option>
                    <option value="Ranui Domain">Ranui Domain</option>
                    <option value="Custom">Custom (enter below)</option>
                  </select>
                  {formData.location === 'Custom' && (
                    <input
                      type="text"
                      placeholder="Enter custom venue"
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] mt-2"
                    />
                  )}
                </div>

                {/* Field Number - for games only */}
                {formData.event_type === 'game' && formData.location && formData.location !== 'Custom' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Field Number (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., No 5"
                      onChange={(e) => {
                        const fieldNum = e.target.value;
                        const baseVenue = formData.location.split(' No')[0];
                        setFormData({ 
                          ...formData, 
                          location: fieldNum ? `${baseVenue} No ${fieldNum}` : baseVenue
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                    />
                  </div>
                )}

                {/* Game-specific fields */}
                {formData.event_type === 'game' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Opponent *
                      </label>
                      <input
                        type="text"
                        value={formData.opponent}
                        onChange={(e) => setFormData({ ...formData, opponent: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] ${
                          missingFields.has('opponent') ? 'border-red-400' : 'border-gray-300'
                        }`}
                        placeholder="e.g., City FC"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Home or Away *
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, home_away: 'home' })}
                          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            formData.home_away === 'home'
                              ? 'bg-[#0091f3] text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          Home
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, home_away: 'away' })}
                          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            formData.home_away === 'away'
                              ? 'bg-[#0091f3] text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          Away
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Pinned Footer with Buttons */}
            <div className="p-6 pt-4 border-t border-gray-200 bg-white rounded-b-lg">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingEventId(null);
                    setModalError(null);
                    setMissingFields(new Set());
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateEvent}
                  className="flex-1 px-4 py-2 bg-[#0091f3] text-white rounded-lg hover:bg-[#0077cc] transition-colors"
                >
                  {editingEventId ? 'Update Event' : 'Create Event'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multi-identity RSVP Modal — shown when the caregiver (optionally
          also a player/coach/manager themselves) has more than one identity
          they can RSVP as for this event (V1.7 Piece A, Requirement A5/A6).
          Rendered before the Decline Reason Modal below so that when
          "Can't Go" is tapped for one identity here, the decline modal
          (same z-50) paints on top of this one. */}
      {rsvpModalEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4 py-8">
            <div className="bg-white rounded-lg max-w-md w-full max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{getEventTitle(rsvpModalEvent)}</h3>
                  <p className="text-xs text-gray-500">
                    {formatDate(rsvpModalEvent.event_date)} — RSVP for each person below
                  </p>
                </div>
                <button
                  onClick={() => setRsvpModalEvent(null)}
                  className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                {(identitiesByEvent[rsvpModalEvent.id] || []).map((identity) => {
                  const status = rsvps[rsvpModalEvent.id]?.[identity.subjectUserId]?.status;
                  const declineReasonForIdentity =
                    status === 'not_going' ? rsvps[rsvpModalEvent.id]?.[identity.subjectUserId]?.decline_reason : null;
                  return (
                    <div key={identity.subjectUserId} className="border border-gray-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-gray-900 mb-2">
                        {identity.label}
                        {declineReasonForIdentity && (
                          <span className="text-xs text-gray-400 font-normal capitalize"> — {declineReasonForIdentity}</span>
                        )}
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleRsvp(rsvpModalEvent.id, 'going', identity.subjectUserId)}
                          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                            status === 'going'
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-green-50'
                          }`}
                        >
                          <CheckCircle className="w-3 h-3" />
                          Going
                        </button>
                        <button
                          onClick={() => handleRsvp(rsvpModalEvent.id, 'maybe', identity.subjectUserId)}
                          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                            status === 'maybe'
                              ? 'bg-gray-500 text-white'
                              : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          <HelpCircle className="w-3 h-3" />
                          Maybe
                        </button>
                        <button
                          onClick={() => handleRsvp(rsvpModalEvent.id, 'not_going', identity.subjectUserId)}
                          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                            status === 'not_going'
                              ? 'bg-red-500 text-white'
                              : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-red-50'
                          }`}
                        >
                          <XCircle className="w-3 h-3" />
                          Can't Go
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Decline Reason Modal */}
      {declineModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-sm w-full p-5">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Can't make it?</h3>
            <p className="text-sm text-gray-500 mb-4">Please select a reason:</p>
            <div className="space-y-2 mb-5">
              {(['late', 'sick', 'injured', 'holiday', 'other'] as const).map((reason) => (
                <button
                  key={reason}
                  onClick={() => setDeclineReason(reason)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    declineReason === reason
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {reason.charAt(0).toUpperCase() + reason.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setDeclineModalOpen(false); setDeclineEventId(null); setDeclineSubjectUserId(undefined); }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeclineConfirm}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Reminder Modal */}
      {reminderEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4 py-8">
            <div className="max-w-lg w-full">
              <MessagingProvider>
                <ComposeForm
                  prefillTitle={`Reminder: ${getEventTitle(reminderEvent)}`}
                  prefillBody={`Hi team,\n\nWe've only had ${attendeeCounts[reminderEvent.id] || 0} replies so far. Please get your response in!\n\nThis is a reminder about ${getEventTitle(reminderEvent)} on ${formatDate(reminderEvent.event_date)} at ${formatTime(reminderEvent.event_date)}.\n\nLocation: ${reminderEvent.location}\n\nPlease update your RSVP if you haven't already.`}
                  prefillTeamId={reminderEvent.target_teams[0]}
                  prefillTargeting="whole_team"
                  hideTargetingOptions={true}
                  onClose={() => setReminderEvent(null)}
                  onSent={() => setReminderEvent(null)}
                />
              </MessagingProvider>
            </div>
          </div>
        </div>
      )}

      {/* Attendee List Modal - who's going/maybe/can't go/hasn't responded */}
      {attendeeModalEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4 py-8">
            <div className="bg-white rounded-lg max-w-md w-full max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{getEventTitle(attendeeModalEvent)}</h3>
                  <p className="text-xs text-gray-500">{formatDate(attendeeModalEvent.event_date)}</p>
                </div>
                <button
                  onClick={() => { setAttendeeModalEvent(null); setAttendeeDetails(null); }}
                  className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4">
                {attendeeLoading && (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0091f3] mx-auto"></div>
                  </div>
                )}

                {!attendeeLoading && attendeeDetails && (
                  <div className="space-y-4">
                    {([
                      { key: 'going', label: 'Going', icon: CheckCircle, color: 'text-green-600' },
                      { key: 'maybe', label: 'Maybe', icon: HelpCircle, color: 'text-gray-600' },
                      { key: 'not_going', label: "Can't Go", icon: XCircle, color: 'text-red-600' },
                      { key: 'no_response', label: 'No Response', icon: Users, color: 'text-gray-400' },
                    ] as const).map(({ key, label, icon: Icon, color }) => (
                      <div key={key}>
                        <div className={`flex items-center gap-1.5 text-sm font-semibold mb-1.5 ${color}`}>
                          <Icon className="w-4 h-4" />
                          {label} ({attendeeDetails[key].length})
                        </div>
                        {attendeeDetails[key].length === 0 ? (
                          <p className="text-xs text-gray-400 pl-5">None</p>
                        ) : (
                          <ul className="pl-5 space-y-1">
                            {attendeeDetails[key].map((a) => (
                              <li key={a.user_id} className="text-sm text-gray-700">
                                {a.name}
                                {a.status === 'not_going' && a.decline_reason && (
                                  <span className="text-xs text-gray-400 capitalize"> — {a.decline_reason}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
