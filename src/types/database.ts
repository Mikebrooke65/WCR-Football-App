// User roles enum
export enum UserRole {
  PLAYER = 'player',
  CAREGIVER = 'caregiver',
  COACH = 'coach',
  MANAGER = 'manager',
  ADMIN = 'admin',
}

// Team-level role (independent of App_Role)
export type TeamRole = 'player' | 'coach' | 'manager';

// User type (full club member vs temporary lite access)
export type UserType = 'full' | 'lite';

// Team classification (migration 1.2). Drives editability + consent path.
export type TeamType = 'club_tournament' | 'external_league';

// Where a child record originated (migration 1.5).
export type ChildProvenance = 'club_tournament' | 'external_league';

// User model
export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  cellphone: string;
  role: UserRole;
  user_type: UserType;
  active: boolean;
  created_at: string;
  last_login?: string;
  privacy_consent_at?: string;
  /** true for a Model-A child row (synthetic email, never signs in). */
  is_child?: boolean;
  /** Origin of a child record; null/undefined for ordinary users. */
  child_provenance?: ChildProvenance | null;
  /**
   * ISO `yyyy-mm-dd`. Self-declared (adult, at invite redemption) or
   * Manager-entered (junior, via Add Player). `null`/undefined for every
   * user added before `.kiro/specs/add-player-and-dob-age-model/` shipped —
   * never backfilled (Requirement 2.3/2.4).
   */
  date_of_birth?: string | null;
}

// Team model
export interface Team {
  id: string;
  name: string;
  age_group: string;
  division?: string;
  training_ground: string;
  training_time: string;
  game_players?: number;
  half_duration?: number;
  created_at: string;
  /** Club Tournament (editable, in-app consent) vs External League (read-only). */
  team_type: TeamType;
}

// User team assignment
export interface UserTeam {
  id: string;
  user_id: string;
  team_id: string;
  is_default: boolean;
  created_at: string;
}

// User profile with team assignments (uses team_members as source of truth)
export interface UserProfile extends User {
  teams: (UserTeam & { team: Team })[]; // legacy — kept for backward compat during migration
  teamMemberships: (TeamMember & { team: Team })[];
  defaultTeam?: Team;
}

// Skill category
export interface Skill {
  id: string;
  name: string;
  description: string;
  display_order: number;
}

// Session types enum
export enum SessionType {
  TECHNICAL_DRILL = 'technical_drill',
  SKILL_INTRODUCTION = 'skill_introduction',
  SKILL_DEVELOPMENT = 'skill_development',
  GAME = 'game',
}

// Session tags
export interface SessionTags {
  ageGroups: string[];
  technicalLevel: 'beginner' | 'intermediate' | 'advanced';
  funLevel: number;
  duration: number;
}

// Session model
export interface Session {
  id: string;
  name: string;
  skill_id: string;
  session_type: SessionType;
  description: string;
  setup_instructions: string;
  setup_image_url?: string;
  video_url?: string;
  learning_objectives: string[];
  tags: SessionTags;
  created_at: string;
  updated_at: string;
}

// Lesson slot types
export enum LessonSlotType {
  WARMUP_TECHNICAL = 'warmup_technical',
  SKILL_INTRODUCTION = 'skill_introduction',
  PROGRESSIVE_DEVELOPMENT = 'progressive_development',
  GAME_APPLICATION = 'game_application',
}

// Lesson tags
export interface LessonTags {
  ageGroups: string[];
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  focusAreas: string[];
}

// Lesson model
export interface Lesson {
  id: string;
  name: string;
  skill_id: string;
  version: number;
  tags: LessonTags;
  total_duration: number;
  created_at: string;
  updated_at: string;
}

// Lesson session slot
export interface LessonSession {
  id: string;
  lesson_id: string;
  session_id: string;
  slot_number: number;
  slot_type: LessonSlotType;
}

// Delivery record
export interface DeliveryRecord {
  id: string;
  coach_id: string;
  coach_name: string;
  team_id: string;
  team_name: string;
  lesson_id: string;
  lesson_version: number;
  delivery_date: string;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
  deleted_by?: string;
  deleted_at?: string;
}

// Session feedback
export interface SessionFeedback {
  id: string;
  coach_id: string;
  coach_name: string;
  session_id: string;
  lesson_id: string;
  team_id: string;
  delivery_date: string;
  rating: number;
  comments?: string;
  created_at: string;
}

// Lesson feedback
export interface LessonFeedback {
  id: string;
  coach_id: string;
  coach_name: string;
  lesson_id: string;
  team_id: string;
  delivery_date: string;
  rating: number;
  comments?: string;
  created_at: string;
}

// Game feedback moment
export interface MomentFeedback {
  www: string;
  ebi: string;
}

// Four moments structure
export interface FourMoments {
  attacking: MomentFeedback;
  transitionAttackDefend: MomentFeedback;
  defending: MomentFeedback;
  transitionDefendAttack: MomentFeedback;
}

// Announcement enums
export enum AnnouncementPriority {
  HIGH = 'high',
  NORMAL = 'normal',
}

export enum AnnouncementAudience {
  ALL = 'all',
  COACHES = 'coaches',
  MANAGERS = 'managers',
  PLAYERS = 'players',
  CAREGIVERS = 'caregivers',
}

export enum AnnouncementStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

// Announcement model
export interface Announcement {
  id: string;
  title: string;
  content: string;
  author_id: string;
  priority: AnnouncementPriority;
  audience: AnnouncementAudience;
  target_teams?: string[];
  target_age_groups?: string[];
  publish_date: string;
  expiration_date?: string;
  is_pinned: boolean;
  status: AnnouncementStatus;
  created_at: string;
}

// Player-Caregiver relationship
export interface PlayerCaregiver {
  id: string;
  player_id: string;
  caregiver_id: string;
  created_at: string;
}

/**
 * Caregiver-issued, single-use code that establishes a session for a
 * child's existing synthetic-email auth user.
 * `.kiro/specs/streamlined-invites-and-child-access/` Requirement 7.4
 * (migration 055). Generating a new code for a child must invalidate any
 * prior session for that child — enforced in the `redeem-device-code`
 * Edge Function, not by this table.
 */
export interface ChildDeviceCode {
  id: string;
  code: string;
  child_user_id: string;
  created_by: string;
  expires_at: string;
  redeemed_at: string | null;
  created_at: string;
}

/**
 * Generic admin-review queue. First use: `kind: 'caregiver_removed_review'`
 * — created when a caregiver is removed from a child's link, so an admin
 * can decide whether to revoke the child's device access (never automatic).
 * `.kiro/specs/streamlined-invites-and-child-access/` Requirement 7.5
 * (migration 055).
 */
export interface AdminActionItem {
  id: string;
  kind: string;
  team_id: string | null;
  player_id: string | null;
  detail: Record<string, unknown> | null;
  status: 'pending' | 'actioned';
  created_at: string;
  actioned_by: string | null;
  actioned_at: string | null;
}

// Team member (source of truth for team assignments)
export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  /**
   * Additive Coach-authority flag (migration 064, V1.R Part 1), independent
   * of `role`. Lets one person hold e.g. `role: 'manager'` AND Coach
   * authority on the same team without a second `team_members` row. Does
   * NOT replace `role: 'coach'`, which keeps its existing meaning.
   */
  is_coach: boolean;
  created_at: string;
  updated_at: string;
}

// Joined types for API responses
export interface TeamMemberWithUser extends TeamMember {
  user: User;
}

export interface TeamMemberWithTeam extends TeamMember {
  team: Team;
}

// Tournament format type
export type TournamentFormat = 'single_round_robin' | 'double_round_robin';

// Competition
export interface Competition {
  id: string;
  name: string;
  competition_type: 'external_league' | 'club_tournament';
  status: 'active' | 'closed';
  start_date: string;
  end_date: string;
  format?: TournamentFormat;
  points_for_win?: number;
  points_for_draw?: number;
  points_for_loss?: number;
  tiebreaker_rules?: string[];
  created_at: string;
  updated_at: string;
}

// Competition standing (materialized standings row)
export interface CompetitionStanding {
  id: string;
  competition_id: string;
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
}

// Competition-Team link
export interface CompetitionTeam {
  id: string;
  competition_id: string;
  team_id: string;
  created_at: string;
}

// Invite code
export interface InviteCode {
  id: string;
  code: string;
  team_id: string;
  competition_id: string | null;
  created_by: string;
  recipient_email: string;
  recipient_phone: string | null;
  redeemed_by: string | null;
  redeemed_at: string | null;
  expires_at: string;
  created_at: string;
  /**
   * Role granted on redemption. NULL defaults to 'player' server-side;
   * 'admin' is excluded by design. 'caregiver' added by
   * `.kiro/specs/add-player-and-dob-age-model/` Requirement 5.1 (migration 053).
   */
  intended_role: 'player' | 'coach' | 'manager' | 'caregiver' | null;
  /**
   * The child `users.id` a Caregiver invite (`intended_role: 'caregiver'`)
   * links to on redemption. NULL for every other invite type.
   * `.kiro/specs/add-player-and-dob-age-model/` Requirement 4.3/7.2 (migration 053).
   */
  subject_user_id: string | null;
  /**
   * First/last name the Manager entered for this invitee in Add Player
   * (Requirement 1.2), captured so the registration page can prefill —
   * editable, never locked — these fields instead of making the invitee
   * retype a name that's already known. NULL for invites created before
   * migration 054, and for any invite path that doesn't collect a name
   * up front.
   */
  recipient_first_name: string | null;
  recipient_last_name: string | null;
  /**
   * For a caregiver-intended invite only: the child's name, captured so
   * `LiteLandingPage.tsx`'s caregiver registration form can prefill (never
   * lock) the "child's name" fields instead of asking the caregiver to type
   * them into a blank field with nothing to check against. NULL for invites
   * created before migration 059, and for every other invite type.
   * `.kiro/specs/streamlined-invites-and-child-access/` Decision 2.
   */
  subject_first_name?: string | null;
  subject_last_name?: string | null;
}

// Invite code validation result
export interface InviteCodeValidation {
  valid: boolean;
  error?: 'invalid' | 'expired' | 'redeemed' | 'already_member';
  invite?: InviteCode;
  team?: Team;
  // The competition the invite points at, when it names one (invite_codes
  // .competition_id). Only the name is needed, for the invite landing page's
  // "Join the {competition}" context (V1.6). Anon visitors can read it via
  // migration 076's scoped policy. Null/absent when the invite has no
  // competition or the lookup returned nothing.
  competition?: { name: string } | null;
}

// Lite user registration data
export interface LiteRegistrationData {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  privacy_consent: boolean;
  /**
   * ISO `yyyy-mm-dd`, self-declared by the invitee at redemption. Required by
   * `redeem-invite` for every intended role except `caregiver`.
   * `.kiro/specs/add-player-and-dob-age-model/` Requirement 3.4.
   */
  date_of_birth?: string;
  /**
   * Caregiver-invite redemption only (Requirement 5.2/5.3): the child's
   * name and date of birth, as entered by the caregiver at redemption —
   * never the Manager's Add Player guess. Omitted for every other intended
   * role; `redeem-invite` never asks for these outside the caregiver path.
   * `.kiro/specs/streamlined-invites-and-child-access/` Requirement 5.
   */
  subject_first_name?: string;
  subject_last_name?: string;
  subject_date_of_birth?: string;
}

// Invite player data (mid-season)
export interface InvitePlayerData {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
}

// Caregiver approval
export interface CaregiverApproval {
  id: string;
  player_id: string;
  new_caregiver_email: string;
  new_caregiver_first_name: string;
  new_caregiver_last_name: string;
  requested_by: string;
  status: 'pending' | 'approved' | 'denied' | 'escalated';
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
  /**
   * Disambiguates the two uses of this table (migration 1.6):
   * - 'add_caregiver': legacy "add a caregiver to a player" flow.
   * - 'add_child': the add-a-junior consent record for a Club Tournament child.
   */
  request_kind: 'add_caregiver' | 'add_child';
  /** Team the add-child request belongs to; null for the legacy flow. */
  team_id: string | null;
}

// New caregiver data for approval request
export interface NewCaregiverData {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
}

// Lite user report row
export interface LiteUserReport {
  user: User;
  team_name: string;
  team_age_group: string;
  date_added: string;
  days_since_creation: number;
}

// Competition creation payload
export interface CreateCompetitionPayload {
  name: string;
  competition_type: 'external_league' | 'club_tournament';
  start_date: string;
  end_date: string;
}

// Game model
export interface Game {
  id: string;
  team_id: string;
  opponent: string;
  game_date: string;
  venue: string;
  home_away: 'home' | 'away';
  status: 'scheduled' | 'completed' | 'cancelled';
  team_score?: number;
  opponent_score?: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

// Game feedback model
export interface GameFeedbackRecord {
  id: string;
  game_id: string; // references events.id (any event_type, not just games)
  team_id: string;
  feedback_type: 'team' | 'player';
  player_id?: string;
  feedback_text: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by?: string;
  /** Migration 069 — Gant/Progress Notes capture context. Null for feedback predating this feature. */
  event_type?: 'game' | 'training' | 'video_review' | null;
  /** Migration 069 — phase-of-play tag(s) from Gant's refinement. */
  phase_tags?: string[];
  /**
   * Migration 069 — internal/admin-reporting marker only. NEVER surfaced to
   * players/caregivers — see gant-ai-feedback-assistant Requirement 6.4.
   */
  gant_assisted?: boolean;
  /** Migration 069 — how many "Work on" rounds this entry took before resolving. Null for non-Gant rows. */
  round_count?: number | null;
}

// --- Gant / Progress Notes (see .kiro/specs/gant-ai-feedback-assistant/) ---

/** One round of raw input in a gant_pending_entries.raw_text array. */
export interface GantRawRound {
  text: string;
  at: string; // ISO timestamp
}

/** Cached Edge Function response, stored on the pending entry (refine-on-open, not refine-on-capture). */
export interface GantResponse {
  kind: 'refined' | 'question';
  text: string;
  phaseTags?: string[];
}

// Migration 068 — the Progress Notes capture queue.
export interface GantPendingEntry {
  id: string;
  team_id: string;
  player_id?: string | null; // null = team-scoped entry
  event_type?: 'game' | 'training' | 'video_review' | null;
  event_id?: string | null;
  raw_text: GantRawRound[];
  last_gant_response?: GantResponse | null;
  round_count: number;
  captured_by: string;
  captured_at: string;
  updated_at: string;
}

/** A phase-of-play entry within an age band, per gant_guardrails.phases_of_play. */
export interface GantPhaseOfPlay {
  name: string;
  definition: string;
}

/** One age band's phase-of-play list, per gant_guardrails.phases_of_play. */
export interface GantPhaseBand {
  band: string;
  phases: GantPhaseOfPlay[];
}

// Migration 071 — the single-row, admin-editable guardrails document.
export interface GantGuardrails {
  id: true;
  phases_of_play: GantPhaseBand[];
  feedback_model: string;
  tone_guide: string;
  continuity_language: string;
  system_prompt_override?: string | null;
  updated_at: string;
}

// Migration 072 — append-only usage signal log, admin-exportable only (no in-app analytics UI).
export interface GantOutcome {
  id: string;
  team_id: string;
  player_id?: string | null;
  outcome: 'ticked' | 'crossed';
  round_count: number;
  resolved_by: string;
  resolved_at: string;
}

// Migration 073 — cached auto-summary, refreshed only when a new note is ticked (not on every view).
export interface GantPlayerSummary {
  player_id: string;
  summary_text: string;
  generated_at: string;
}

// Event model
export interface Event {
  id: string;
  title: string;
  event_type: 'game' | 'training' | 'general';
  event_date: string;
  location: string;
  opponent?: string;
  home_away?: 'home' | 'away';
  team_score?: number;
  opponent_score?: number;
  target_teams: string[];
  target_roles: string[];
  target_divisions: string[];
  target_age_groups: string[];
  competition_id?: string;
  round_number?: number;
  match_number?: number;
  pitch?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

// Event RSVP model
export interface EventRsvp {
  id: string;
  event_id: string;
  user_id: string;
  status: 'going' | 'not_going' | 'maybe' | 'no_response';
  responded_at: string | null;
  decline_reason: 'late' | 'sick' | 'injured' | 'holiday' | 'other' | null;
  created_at: string;
  updated_at: string;
}

// Event attendance record
export interface EventAttendance {
  id: string;
  event_id: string;
  user_id: string | null;
  guest_name: string | null;
  attended: boolean;
  recorded_at: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

// Game time record
export interface GameTime {
  id: string;
  event_id: string;
  kick_off_time: string | null;
  second_half_start_time: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

// Substitution event record
export interface SubstitutionEvent {
  id: string;
  event_id: string;
  player_off_id: string | null;
  player_off_guest_name: string | null;
  player_on_id: string | null;
  player_on_guest_name: string | null;
  game_minute: number;
  half: 1 | 2;
  strategy_used: 'random' | 'coach';
  recorded_at: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

// Squad member (joined view for Subs page)
export interface SquadMember {
  id: string;
  user_id: string | null;
  guest_name: string | null;
  display_name: string;
  attended: boolean;
  is_guest: boolean;
  rsvp_status?: 'going' | 'not_going' | 'maybe' | 'no_response';
}

// Messaging targeting types
export type MessageTargetingType = 'individual' | 'whole_team' | 'management_team' | 'club_admin';

export interface Message {
  id: string;
  sender_id: string;
  team_id: string | null; // null = a team-less "club admin" message (migration 075)
  parent_message_id: string | null;
  title: string;
  body: string;
  created_at: string;
}

export interface MessageRecipient {
  id: string;
  message_id: string;
  targeting_type: MessageTargetingType;
  recipient_user_ids: string[];
  notification_pending: boolean;
}

export interface MessageReadReceipt {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
}

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface MessageArchive {
  id: string;
  message_id: string;
  user_id: string;
  archived_at: string;
}

export interface DeviceToken {
  id: string;
  user_id: string;
  device_token: string;
  platform: 'web' | 'android' | 'ios';
  created_at: string;
}

// Composed view types for UI
export interface Thread {
  message: Message;
  sender: { first_name: string; last_name: string };
  recipient: MessageRecipient;
  reply_count: number;
  last_activity: string;
  read_count: number;
  total_recipients: number;
  is_read: boolean;
  is_archived: boolean;
  reactions: ReactionGroup[];
}

export interface ThreadDetail {
  thread: Thread;
  replies: (Message & { sender: { first_name: string; last_name: string }; reactions: ReactionGroup[] })[];
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  user_ids: string[];
}

export interface CreateMessagePayload {
  team_id: string | null; // null when targeting_type === 'club_admin' (migration 075)
  targeting_type: MessageTargetingType;
  title: string;
  body: string;
  individual_user_id?: string;
}

export interface CreateReplyPayload {
  body: string;
}

export interface SearchResult {
  thread: Thread;
  match_context: string;
  is_archived: boolean;
}
