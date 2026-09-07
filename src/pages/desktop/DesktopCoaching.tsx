import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { supabase } from '../../lib/supabase';

interface CoachingCounts {
  lessons: number | null;
  sessions: number | null;
  coaches: number | null;
}

export function DesktopCoaching() {
  const [counts, setCounts] = useState<CoachingCounts>({ lessons: null, sessions: null, coaches: null });

  useEffect(() => {
    let cancelled = false;

    async function loadCounts() {
      // Real counts (head:true = count only, no rows) — mirrors DesktopLanding.
      // Best-effort: a failed count simply leaves that stat blank ("—").
      //
      // "Active Coaches" = distinct active users holding coach AUTHORITY on any
      // team, not the strict global `users.role = 'coach'` (which undercounts —
      // a per-team-promoted coach or a Manager with `is_coach` never gets the
      // global role). Coach authority = a `team_members` row with role='coach'
      // OR the additive `is_coach` flag (V1.R Part 1). Counted in JS because one
      // person can hold it on several teams (and via both signals at once), so a
      // head:true row count would double-count them.
      const [lessonsRes, sessionsRes, coachAuthRes] = await Promise.all([
        supabase.from('lessons').select('*', { count: 'exact', head: true }),
        supabase.from('sessions').select('*', { count: 'exact', head: true }),
        supabase
          .from('team_members')
          .select('user_id, user:users!inner(active)')
          .or('role.eq.coach,is_coach.eq.true'),
      ]);
      if (cancelled) return;

      let coaches: number | null = null;
      if (!coachAuthRes.error && coachAuthRes.data) {
        const distinct = new Set<string>();
        for (const row of coachAuthRes.data as Array<{
          user_id: string;
          // supabase types a to-one embed as object; guard array defensively.
          user: { active: boolean } | { active: boolean }[] | null;
        }>) {
          const u = Array.isArray(row.user) ? row.user[0] : row.user;
          if (u?.active !== false) distinct.add(row.user_id);
        }
        coaches = distinct.size;
      }

      setCounts({
        lessons: lessonsRes.count ?? null,
        sessions: sessionsRes.count ?? null,
        coaches,
      });
    }

    loadCounts();
    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = (n: number | null) => (n == null ? '—' : String(n));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[#22c55e]">Coaching Hub</h1>
        <p className="text-gray-600 mt-1">Build and manage lesson plans and training sessions</p>
      </div>

      {/* Builders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Link
          to="/desktop/lesson-builder"
          className="block bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6"
        >
          <div className="flex items-center">
            <div className="w-16 h-16 rounded-full bg-[#0091f3] bg-opacity-10 flex items-center justify-center mr-4">
              <svg className="w-8 h-8 text-[#0091f3]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-xl mb-1">Lesson Builder</h3>
              <p className="text-sm text-gray-600">Create and manage lesson plans</p>
            </div>
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>

        <Link
          to="/desktop/session-builder"
          className="block bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6"
        >
          <div className="flex items-center">
            <div className="w-16 h-16 rounded-full bg-[#ea7800] bg-opacity-10 flex items-center justify-center mr-4">
              <svg className="w-8 h-8 text-[#ea7800]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-xl mb-1">Session Builder</h3>
              <p className="text-sm text-gray-600">Build individual training sessions</p>
            </div>
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>
      </div>

      {/* Counts + quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Coaching Content</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Total Lessons</span>
              <span className="text-2xl font-bold text-[#0091f3]">{fmt(counts.lessons)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Total Sessions</span>
              <span className="text-2xl font-bold text-[#0091f3]">{fmt(counts.sessions)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Active Coaches</span>
              <span className="text-2xl font-bold text-[#0091f3]">{fmt(counts.coaches)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link
              to="/desktop/session-builder"
              className="block w-full px-4 py-2 text-sm text-center bg-[#0091f3] text-white rounded-lg hover:bg-[#0077cc]"
            >
              New Session
            </Link>
            <Link
              to="/desktop/lesson-builder"
              className="block w-full px-4 py-2 text-sm text-center border border-[#0091f3] text-[#0091f3] rounded-lg hover:bg-[#0091f3] hover:bg-opacity-5"
            >
              New Lesson
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
