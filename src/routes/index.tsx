import { createBrowserRouter, Navigate } from 'react-router';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { UserRole } from '../types/database';

// Layouts
import { MainLayout } from '../layouts/MainLayout';
import { DesktopLayout } from '../layouts/DesktopLayout';

// Auth pages
import { Login } from '../pages/Login';
import { ResetPassword } from '../pages/ResetPassword';

// Mobile pages
import { Landing } from '../pages/Landing';
import { Coaching } from '../pages/Coaching';
import { TeamPage } from '../pages/TeamPage';
import { Lessons } from '../pages/Lessons';
import { LessonDetail } from '../pages/LessonDetail';
import { Games } from '../pages/Games';
import { Resources } from '../pages/Resources';
import { Schedule } from '../pages/Schedule';
import { Messaging } from '../pages/Messaging';
import { GantPendingQueue } from '../pages/GantPendingQueue';
import { SubsPage } from '../pages/SubsPage';
import { TournamentPage } from '../pages/TournamentPage';

// Desktop admin pages
import { DesktopLanding } from '../pages/desktop/DesktopLanding';
import { DesktopCoaching } from '../pages/desktop/DesktopCoaching';
import { DesktopResources } from '../pages/desktop/DesktopResources';
import { DesktopSchedule } from '../pages/desktop/DesktopSchedule';
import { DesktopMessaging } from '../pages/desktop/DesktopMessaging';
import { TeamsManagement } from '../pages/desktop/TeamsManagement';
import { UserManagement } from '../pages/desktop/UserManagement';
import { Announcements } from '../pages/desktop/Announcements';
import { LessonBuilder } from '../pages/desktop/LessonBuilder';
import { SessionBuilder } from '../pages/desktop/SessionBuilder';
import { CompetitionsPage } from '../pages/desktop/CompetitionsPage';
import { DesktopTournamentPage } from '../pages/desktop/DesktopTournamentPage';
import { ProgressNotesSettings } from '../pages/desktop/ProgressNotesSettings';
import { DataRetentionReport } from '../pages/desktop/DataRetentionReport';
import { desktopFeatures } from '../config/desktopFeatures';

// Reporting pages
import { DesktopReporting } from '../pages/desktop/DesktopReporting';
import { LessonDeliveryReport } from '../pages/desktop/LessonDeliveryReport';
import { CoachActivityReport } from '../pages/desktop/CoachActivityReport';
import { TeamTrainingReport } from '../pages/desktop/TeamTrainingReport';
import { LessonEffectivenessReport } from '../pages/desktop/LessonEffectivenessReport';
import { SessionRatingsReport } from '../pages/desktop/SessionRatingsReport';
import { GameFeedbackReport } from '../pages/desktop/GameFeedbackReport';

// Public pages
import { LiteLandingPage } from '../pages/LiteLandingPage';
import { DeviceAccessLandingPage } from '../pages/DeviceAccessLandingPage';

// In-app pages
// CaregiverApprovalPage itself is retired as a destination (streamlined-
// invites-and-child-access, Decision 1 — the caregiver consent decision now
// lives inline on the Team roster row) but the file is left in place,
// unimported, rather than deleted — no code path renders it any more.

export const router = createBrowserRouter([
  // Public routes
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/reset-password',
    element: <ResetPassword />,
  },
  {
    path: '/invite/:code',
    element: <LiteLandingPage />,
  },
  {
    // Requirement 7.4.4 — a child's device-code redemption. Public/anon,
    // same as `/invite/:code`, for the same reason: no session exists yet.
    path: '/device/:code',
    element: <DeviceAccessLandingPage />,
  },

  // Mobile routes (all authenticated users)
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <Landing />,
      },
      {
        path: 'coaching',
        element: (
          <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.COACH]}>
            <Coaching />
          </ProtectedRoute>
        ),
      },
      {
        path: 'lessons',
        element: (
          <ProtectedRoute
            allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.COACH]}
          >
            <Lessons />
          </ProtectedRoute>
        ),
      },
      {
        path: 'lessons/:id',
        element: (
          <ProtectedRoute
            allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.COACH]}
          >
            <LessonDetail />
          </ProtectedRoute>
        ),
      },
      {
        path: 'games',
        element: (
          <ProtectedRoute
            allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.COACH]}
          >
            <Games />
          </ProtectedRoute>
        ),
      },
      {
        path: 'games/:eventId/subs',
        element: (
          <ProtectedRoute
            allowedRoles={[UserRole.ADMIN, UserRole.MANAGER, UserRole.COACH]}
          >
            <SubsPage />
          </ProtectedRoute>
        ),
      },
      {
        // Resources is accessible to every role (reached from a Home card, not
        // a bottom tab). No role gate beyond authentication.
        path: 'resources',
        element: <Resources />,
      },
      {
        path: 'team',
        element: <TeamPage />,
      },
      {
        path: 'schedule',
        element: <Schedule />,
      },
      {
        path: 'messaging',
        element: <Messaging />,
      },
      {
        // streamlined-invites-and-child-access, Decision 1 — this used to be
        // a dedicated Approvals page; the consent decision now lives inline
        // on the Team roster row instead (TeamPage.tsx's RosterRow). This
        // route is kept alive as a redirect, not removed, so an old
        // bookmarked/emailed link (including tonight's own test emails)
        // still lands somewhere useful rather than 404ing.
        path: 'caregiver-approvals',
        element: <Navigate to="/team" replace />,
      },
      {
        // Progress Notes pending queue (internal name "Gant") — replaces the
        // old AICoach stub. Same route so the existing "Ask AI Coach" link
        // (Coaching.tsx) keeps working without a change there.
        // gant-ai-feedback-assistant, Requirement 1.2/6.2: gated on the same
        // coach-authority rule as the Coaching tab and game_feedback's write
        // access — a plain Manager without coach authority is NOT included.
        path: 'ai-coach',
        element: (
          <ProtectedRoute allowedRoles={[UserRole.ADMIN, UserRole.COACH]}>
            <GantPendingQueue />
          </ProtectedRoute>
        ),
      },
      {
        path: 'tournaments',
        element: <TournamentPage />,
      },
    ],
  },

  // Desktop routes (admin only)
  {
    path: '/desktop',
    element: (
      <ProtectedRoute allowedRoles={[UserRole.ADMIN]} requireDesktop>
        <DesktopLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <DesktopLanding />,
      },
      {
        path: 'coaching',
        element: <DesktopCoaching />,
      },

      {
        path: 'resources',
        element: <DesktopResources />,
      },
      {
        path: 'schedule',
        element: <DesktopSchedule />,
      },
      {
        path: 'messaging',
        element: <DesktopMessaging />,
      },
      {
        path: 'teams',
        element: <TeamsManagement />,
      },
      {
        path: 'users',
        element: <UserManagement />,
      },
      // Data Retention & Privacy Assurance report (V1.R Part 2, Piece C) —
      // deliberately NOT inside the desktopFeatures.reporting spread below.
      // Ships independently of the deferred 6-page Reporting suite.
      {
        path: 'data-retention',
        element: <DataRetentionReport />,
      },

      // Reporting hidden for the V1 launch trial (V1.8 / deferred to V2.8) —
      // routes are only registered when the flag is on, so the pages can't be
      // reached by URL either. Components stay imported for a one-line re-enable.
      ...(desktopFeatures.reporting
        ? [
            { path: 'reporting', element: <DesktopReporting /> },
            { path: 'reporting/lesson-deliveries', element: <LessonDeliveryReport /> },
            { path: 'reporting/coach-activity', element: <CoachActivityReport /> },
            { path: 'reporting/team-training', element: <TeamTrainingReport /> },
            { path: 'reporting/lesson-effectiveness', element: <LessonEffectivenessReport /> },
            { path: 'reporting/session-ratings', element: <SessionRatingsReport /> },
            { path: 'reporting/game-feedback', element: <GameFeedbackReport /> },
          ]
        : []),
      {
        path: 'announcements',
        element: <Announcements />,
      },
      {
        path: 'progress-notes',
        element: <ProgressNotesSettings />,
      },
      {
        path: 'lesson-builder',
        element: <LessonBuilder />,
      },
      {
        path: 'session-builder',
        element: <SessionBuilder />,
      },
      {
        path: 'competitions',
        element: <CompetitionsPage />,
      },
      {
        path: 'tournaments',
        element: <DesktopTournamentPage />,
      },
    ],
  },

  // Catch all - redirect to home
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
