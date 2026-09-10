import { Outlet, NavLink, useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { useAppStore } from '../stores/appStore';
import { LogoutButton } from '../components/LogoutButton';
import { desktopFeatures } from '../config/desktopFeatures';
import gannetLogo from '../assets/cdb7544de20d133944374bb8948c71879fef34b4.png';

interface NavItem {
  to: string;
  label: string;
  color: string;
  d: string;
  end?: boolean;
}

// V1.8: desktop is admin-only, so there's no "Main/Admin" split — one flat list
// ordered by the domain hierarchy (People -> Teams -> Competitions, then the
// standalone Coaching/Progress Notes, then supporting pages). Games, the
// standalone Session/Lesson Builder tabs (reached via the Coaching hub), the
// standalone Tournaments tab (reached under a Club Event), and Caregiver Reviews
// (folded under Users) have been removed. Reporting stays gated/hidden (V2.8).
// Accent colours are applied via inline style, not Tailwind arbitrary classes,
// because runtime-built class names (`text-[${color}]`) are purged by the JIT.
const NAV_ITEMS: NavItem[] = [
  { to: '/desktop', end: true, label: 'Landing', color: '#0091f3', d: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/desktop/users', label: 'Users', color: '#4f46e5', d: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { to: '/desktop/teams', label: 'Teams', color: '#4f46e5', d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { to: '/desktop/competitions', label: 'Competitions', color: '#4f46e5', d: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { to: '/desktop/coaching', label: 'Coaching', color: '#22c55e', d: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { to: '/desktop/progress-notes', label: 'Progress Notes', color: '#d97706', d: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  { to: '/desktop/resources', label: 'Resources', color: '#8b5cf6', d: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { to: '/desktop/schedule', label: 'Schedule', color: '#06b6d4', d: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { to: '/desktop/messaging', label: 'Messaging', color: '#545859', d: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
  { to: '/desktop/announcements', label: 'Announcements', color: '#4f46e5', d: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
  // Data Retention & Privacy Assurance report (V1.R Part 2, Piece C): plain,
  // unconditional entry — no desktopFeatures gate, unlike Reporting below.
  { to: '/desktop/data-retention', label: 'Data Retention', color: '#dc2626', d: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  // Reporting: hidden for the V1 launch trial (deferred to V2.8). Gated on the
  // desktopFeatures flag — flip it back on to re-list.
  ...(desktopFeatures.reporting
    ? [{ to: '/desktop/reporting', label: 'Reporting', color: '#4f46e5', d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' } as NavItem]
    : []),
];

export function DesktopLayout() {
  const { user } = useAuth();
  const { isSidebarOpen, setSidebarOpen } = useAppStore();
  const location = useLocation();

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside
        className={`${
          isSidebarOpen ? 'w-64' : 'w-20'
        } bg-white border-r border-gray-200 transition-all duration-300 flex flex-col`}
      >
        {/* Sidebar header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            {isSidebarOpen ? (
              <div className="flex items-center gap-2">
                <img src={gannetLogo} alt="WCRF" className="h-8 w-auto" />
                <h2 className="text-lg font-bold text-gray-900">WCRF Admin</h2>
              </div>
            ) : (
              <img src={gannetLogo} alt="WCRF" className="h-8 w-auto mx-auto" />
            )}
            {isSidebarOpen && (
              <button
                onClick={() => setSidebarOpen(!isSidebarOpen)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Navigation — single flat list (desktop is admin-only) */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => (isActive ? { color: item.color } : undefined)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors relative ${
                  isActive ? 'bg-gray-50' : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
                      style={{ backgroundColor: item.color }}
                    ></div>
                  )}
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.d} />
                  </svg>
                  {isSidebarOpen && <span>{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar footer */}
        <div className="p-4 border-t border-gray-200">
          {isSidebarOpen && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-1">Logged in as</p>
              <p className="text-sm font-medium text-gray-900">
                {user?.first_name} {user?.last_name}
              </p>
              <p className="text-xs text-gray-500">{user?.role}</p>
            </div>
          )}
          <LogoutButton
            className={`w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg ${
              !isSidebarOpen && 'flex justify-center'
            }`}
          />
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="bg-[#0091f3] px-6 py-4 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <img
              src={gannetLogo}
              alt=""
              className="h-full w-auto object-contain ml-auto"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </div>
          <div className="relative flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">Urrah</h1>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet key={location.pathname} />
        </main>
      </div>
    </div>
  );
}
