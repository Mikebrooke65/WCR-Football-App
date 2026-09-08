import { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, Users, Plus, Search, CheckCircle, XCircle, HelpCircle, Bell } from 'lucide-react';
import { MessagingProvider } from '../../contexts/MessagingContext';
import { ComposeForm } from '../../components/messaging/ComposeForm';
import { TargetingSelector, type TargetingData } from '../../components/shared/TargetingSelector';
import { eventsApi } from '../../lib/events-api';
import { useAuth } from '../../contexts/AuthContext';
import type { Event, EventRsvp, Team } from '../../types/database';

export function DesktopSchedule() {
  const { user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  // V1.7 Piece A: getUserRsvps now returns event_id -> subject_user_id ->
  // EventRsvp (a caregiver can hold more than one RSVP per event, one per
  // child) — this state is fetched but not currently rendered anywhere on
  // this admin screen, so the shape change has no visible effect here.
  const [rsvps, setRsvps] = useState<Record<string, Record<string, EventRsvp>>>({});
  const [attendeeCounts, setAttendeeCounts] = useState<Record<string, number>>({});
  const [totalMemberCounts, setTotalMemberCounts] = useState<Record<string, number>>({});
  const [userTeams, setUserTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [filter, setFilter] = useState<'all' | 'training' | 'match' | 'meeting'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [reminderEvent, setReminderEvent] = useState<Event | null>(null);

  useEffect(() => {
    loadEvents();
    loadTeams();
  }, []);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const data = await eventsApi.getEvents();
      setEvents(data);

      // These three don't depend on each other's results — only on `data`
      // — so run them together instead of one-after-another. Each is a
      // separate network round trip; awaiting them in sequence was adding
      // their latencies up instead of overlapping them, which is most of
      // why the page took several seconds to appear.
      const [rsvpMap, counts, totals] = await Promise.all([
        eventsApi.getUserRsvps(data.map(e => e.id)),
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

  // Form state for event creation/editing
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
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

  // Enhanced targeting for admin users
  const [targetingData, setTargetingData] = useState<TargetingData>({
    target_roles: [],
    target_team_types: [],
    target_divisions: [],
    target_age_groups: [],
    target_team_ids: [],
    target_user_ids: [],
  });

  const handleCreateEvent = async () => {
    try {
      setError(null);

      // Validation
      if (!formData.title || !formData.event_date || !formData.event_time || !formData.location) {
        setError('Please fill in all required fields');
        return;
      }

      if (formData.event_type === 'game' && !formData.opponent) {
        setError('Please enter opponent name for game events');
        return;
      }

      if (formData.event_type === 'game' && targetingData.target_team_ids.length !== 1) {
        setError('Game events must be assigned to exactly one team');
        return;
      }

      // Combine date and time
      const eventDateTime = new Date(`${formData.event_date}T${formData.event_time}`).toISOString();

      // Use enhanced targeting if admin, otherwise use simple team selection
      const eventPayload = {
        title: formData.title,
        event_type: formData.event_type,
        event_date: eventDateTime,
        location: formData.location,
        opponent: formData.event_type === 'game' ? formData.opponent : undefined,
        home_away: formData.event_type === 'game' ? formData.home_away : undefined,
        target_teams: user?.role === 'admin' ? targetingData.target_team_ids : formData.target_teams,
        target_roles: user?.role === 'admin' ? (targetingData.target_roles.length > 0 ? targetingData.target_roles : []) : [],
        target_divisions: user?.role === 'admin' ? (targetingData.target_divisions.length > 0 ? targetingData.target_divisions : []) : [],
        target_age_groups: user?.role === 'admin' ? (targetingData.target_age_groups.length > 0 ? targetingData.target_age_groups : []) : [],
      };

      if (editingEventId) {
        // Update existing event
        const updatedEvent = await eventsApi.updateEvent(editingEventId, eventPayload);
        setEvents(events.map(e => e.id === editingEventId ? updatedEvent : e));
      } else {
        // Create new event
        const newEvent = await eventsApi.createEvent(eventPayload);
        setEvents([...events, newEvent]);
      }

      setShowCreateForm(false);
      setEditingEventId(null);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event');
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
    
    // Set targeting data for admin users
    if (user?.role === 'admin') {
      setTargetingData({
        target_roles: event.target_roles || [],
        target_team_types: event.target_team_types || [],
        target_divisions: event.target_divisions || [],
        target_age_groups: event.target_age_groups || [],
        target_team_ids: event.target_teams || [],
        target_user_ids: [],
      });
    }
    
    setEditingEventId(event.id);
    setShowCreateForm(true);
    setSelectedEvent(null);
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
    setTargetingData({
      target_roles: [],
      target_team_types: [],
      target_divisions: [],
      target_age_groups: [],
      target_team_ids: [],
      target_user_ids: [],
    });
  };

  const filteredEvents = events.filter((event) => {
    const matchesFilter = filter === 'all' || event.event_type === filter;
    const matchesSearch =
      searchTerm === '' ||
      event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getEventTeamName(event)?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // Split into upcoming (soonest first) and past (most-recent first, greyed
  // out below), matching what the mobile Schedule page already does. This
  // list previously sorted everything ascending into one run, so a newly
  // created future event landed at the very bottom under months of history
  // — it looked like the event hadn't been created at all.
  const isPastEvent = (event: Event) => new Date(event.event_date).getTime() < Date.now();

  const upcomingEvents = [...filteredEvents]
    .filter((event) => !isPastEvent(event))
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  const pastEvents = [...filteredEvents]
    .filter((event) => isPastEvent(event))
    .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
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

  // One card in the left-hand list. `isPast` greys it out; past events stay
  // clickable so an admin can still open and edit them (a past event may
  // need its date corrected, or marking as cancelled).
  const renderEventListCard = (event: Event, isPast: boolean) => (
    <div
      key={event.id}
      onClick={() => {
        setSelectedEvent(event);
        setShowCreateForm(false);
      }}
      className={`p-3 border rounded-lg cursor-pointer transition-all ${isPast ? 'opacity-60' : ''} ${
        selectedEvent?.id === event.id
          ? 'border-[#0091f3] bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
      style={{
        backgroundColor:
          selectedEvent?.id === event.id
            ? undefined
            : getCardBackgroundColor(event.event_type, isPast),
      }}
    >
      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <h3 className="font-medium text-gray-900 text-sm truncate">{getEventTitle(event)}</h3>
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize flex-shrink-0 ${getTypeColor(event.event_type)}`}>
              {event.event_type}
            </span>
          </div>
          {getEventTeamName(event) && (
            <p className="text-xs text-gray-600 truncate">{getEventTeamName(event)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-600 mb-1">
        <div className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span>{new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{formatTime(event.event_date)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-600">
        <div className="flex items-center gap-1">
          <CheckCircle className="w-3 h-3 text-green-600" />
          <span>{attendeeCounts[event.id] || 0}</span>
        </div>
        <div className="flex items-center gap-1">
          <Users className="w-3 h-3 text-gray-400" />
          <span>{totalMemberCounts[event.id] || 0}</span>
        </div>
      </div>
    </div>
  );

  const getEventTeamName = (event: Event) => {
    if (!event.target_teams || event.target_teams.length === 0) return null;
    const teamId = event.target_teams[0];
    const team = userTeams.find(t => t.id === teamId) || allTeams.find(t => t.id === teamId);
    return team ? `${team.age_group} ${team.name}` : null;
  };

  const getEventTitle = (event: Event) => {
    if (event.event_type !== 'game' || !event.opponent) {
      return event.title;
    }

    const teamName = getEventTeamName(event) || 'Your Team';

    if (event.home_away === 'home') {
      return `${teamName} vs ${event.opponent}`;
    } else {
      return `${event.opponent} vs ${teamName}`;
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#06b6d4] mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading events...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-[#06b6d4]">Schedule Management</h1>
        {(user?.role === 'admin' || user?.role === 'coach' || user?.role === 'manager') && (
          <button 
            onClick={() => {
              setShowCreateForm(true);
              setSelectedEvent(null);
              resetForm();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#0091f3] text-white rounded-lg hover:bg-[#0081d9] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Event
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left Panel - Events List (Narrower) */}
        <div className="w-1/3 flex flex-col bg-white rounded-lg shadow">
          <div className="p-3 border-b border-gray-200">
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search events..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3] text-sm"
              />
            </div>
            
            <div className="flex gap-1">
              <button
                onClick={() => setFilter('all')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-[#0091f3] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('training')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  filter === 'training'
                    ? 'bg-[#0091f3] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Training
              </button>
              <button
                onClick={() => setFilter('match')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  filter === 'match'
                    ? 'bg-[#0091f3] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Games
              </button>
              <button
                onClick={() => setFilter('meeting')}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  filter === 'meeting'
                    ? 'bg-[#0091f3] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                General
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {upcomingEvents.map((event) => renderEventListCard(event, false))}

            {upcomingEvents.length === 0 && pastEvents.length === 0 && (
              <div className="text-center py-10">
                <Calendar className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600 text-sm">No events scheduled</p>
              </div>
            )}

            {upcomingEvents.length === 0 && pastEvents.length > 0 && (
              <div className="text-center py-6">
                <Calendar className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600 text-sm">No upcoming events</p>
              </div>
            )}

            {/* Past events — greyed out below the upcoming ones, still
                clickable so an admin can open and edit them. */}
            {pastEvents.length > 0 && (
              <div className="pt-3">
                <h3 className="text-xs font-semibold text-gray-500 mb-2 px-1">Past Events</h3>
                <div className="space-y-2">
                  {pastEvents.map((event) => renderEventListCard(event, true))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Event Details or Create Form (Wider) */}
        <div className="w-2/3 bg-white rounded-lg shadow p-6">
          {showCreateForm ? (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">
                  {editingEventId ? 'Edit Event' : 'Create New Event'}
                </h2>
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setEditingEventId(null);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
                {/* Enhanced Targeting for Admin Users */}
                {user?.role === 'admin' && (
                  <TargetingSelector
                    value={targetingData}
                    onChange={setTargetingData}
                    enableIndividualSelection={false}
                    title="Event Targeting"
                    description="leave empty to show to all users"
                  />
                )}

                {/* Simple Team Selection for Non-Admin Users */}
                {user?.role !== 'admin' && (
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                    >
                      <option value="">All teams</option>
                      {userTeams.map(team => (
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
                )}

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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                      placeholder="e.g., Team Training Session"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {/* Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Date *
                    </label>
                    <input
                      type="date"
                      value={formData.event_date}
                      onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
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
                </div>

                {/* Location */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Venue *
                  </label>
                  <select
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0091f3]"
                        placeholder="e.g., City FC"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Home/Away
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

              {/* Form Actions */}
              <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setEditingEventId(null);
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
          ) : selectedEvent ? (
            <div>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    {getEventTitle(selectedEvent)}
                  </h2>
                  {getEventTeamName(selectedEvent) && (
                    <p className="text-gray-600">{getEventTeamName(selectedEvent)}</p>
                  )}
                </div>
                {(user?.role === 'admin' || user?.role === 'coach' || user?.role === 'manager') && (
                  <button 
                    onClick={() => handleEditEvent(selectedEvent)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Edit
                  </button>
                )}
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Event Details</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-gray-600">
                      <Calendar className="w-5 h-5" />
                      <span>{formatDate(selectedEvent.event_date)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-600">
                      <Clock className="w-5 h-5" />
                      <span>{formatTime(selectedEvent.event_date)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-600">
                      <MapPin className="w-5 h-5" />
                      <span>{selectedEvent.location}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getTypeColor(selectedEvent.event_type)}`}>
                        {selectedEvent.event_type}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedEvent.description && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">Description</h3>
                    <p className="text-gray-600">{selectedEvent.description}</p>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Attendance</h3>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-green-600">{attendeeCounts[selectedEvent.id] || 0}</p>
                        <p className="text-xs text-gray-600 mt-1">Going</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-gray-900">{totalMemberCounts[selectedEvent.id] || 0}</p>
                        <p className="text-xs text-gray-600 mt-1">Total Members</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-200 space-y-3">
                  <button
                    onClick={() => setReminderEvent(selectedEvent)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[#06b6d4]/10 text-[#06b6d4] border border-[#06b6d4]/30 hover:bg-[#06b6d4]/20 transition-colors"
                  >
                    <Bell className="w-4 h-4" />
                    Send Reminder
                  </button>
                  <button className="w-full px-4 py-2 bg-[#0091f3] text-white rounded-lg hover:bg-[#0081d9] transition-colors">
                    View Attendee List
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <Calendar className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="mb-4">Select an event to view details</p>
                {(user?.role === 'admin' || user?.role === 'coach' || user?.role === 'manager') && (
                  <button
                    onClick={() => {
                      setShowCreateForm(true);
                      setSelectedEvent(null);
                      resetForm();
                    }}
                    className="px-4 py-2 bg-[#0091f3] text-white rounded-lg hover:bg-[#0081d9] transition-colors"
                  >
                    Create New Event
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Send Reminder Modal */}
      {reminderEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 overflow-y-auto">
          <div className="min-h-full flex items-start justify-center p-4 py-8">
            <div className="max-w-lg w-full">
              <MessagingProvider>
                <ComposeForm
                  prefillTitle={`Reminder: ${getEventTitle(reminderEvent)}`}
                  prefillBody={`Hi team,\n\nWe've only had ${attendeeCounts[reminderEvent.id] || 0} replies so far. Please get your response in!\n\nThis is a reminder about ${getEventTitle(reminderEvent)} on ${formatDate(reminderEvent.event_date)} at ${formatTime(reminderEvent.event_date)}.\n\nLocation: ${reminderEvent.location}\n\nPlease update your RSVP if you haven't already.`}
                  prefillTeamId={reminderEvent.target_teams?.[0]}
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
    </div>
  );
}
