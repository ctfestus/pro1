'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect } from 'react';
import { TrendingUp, Trophy, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { LIGHT_C , cardStyle } from '@/lib/theme';

const HERO_LB = 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)';

export function LeaderboardSection({ C }: { C: typeof LIGHT_C }) {
  const [cohorts, setCohorts]       = useState<any[]>([]);
  const [rankingsByCohort, setRankingsByCohort] = useState<Record<string, any[]>>({});
  const [loading, setLoading]       = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cohortFilter, setCohortFilter] = useState('all');
  const { theme } = useTheme();

  // Load cohorts + each cohort's rankings (service-role API bypasses RLS)
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: cohortData } = await supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('created_at', { ascending: false });
      const list = cohortData ?? [];
      setCohorts(list);
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
      const entries = await Promise.all(list.map(async (c: any) => {
        try {
          const res = await fetch(`/api/leaderboard?cohort_id=${c.id}`, { headers });
          if (!res.ok) return [c.id, []] as const;
          const { rankings } = await res.json();
          return [c.id, rankings ?? []] as const;
        } catch { return [c.id, []] as const; }
      }));
      setRankingsByCohort(Object.fromEntries(entries));
      setLoading(false);
    })();
  }, [refreshKey]);

  const allRankings   = Object.values(rankingsByCohort).flat() as any[];
  const totalStudents = allRankings.length;
  const totalXP       = allRankings.reduce((s, r) => s + r.xp, 0);
  const avgXP         = totalStudents ? Math.round(totalXP / totalStudents) : 0;

  if (loading) return (
    <div className="space-y-4">
      <div className="rounded-2xl px-5 py-4 h-16" style={{ background: HERO_LB }}/>
      <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: i < 5 ? `1px solid ${C.divider}` : 'none', opacity: 1 - i * 0.12 }}>
            <div className="w-6 h-4 rounded" style={{ background: C.skeleton }}/>
            <div className="flex-1 h-4 rounded" style={{ background: C.skeleton }}/>
            <div className="w-16 h-4 rounded" style={{ background: C.skeleton }}/>
          </div>
        ))}
      </div>
    </div>
  );

  if (!cohorts.length) return (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: C.pill }}>
        <Trophy className="w-7 h-7" style={{ color: C.faint }}/>
      </div>
      <h2 className="text-base font-semibold mb-1" style={{ color: C.text }}>No cohorts yet</h2>
      <p className="text-sm max-w-xs" style={{ color: C.faint }}>Create a cohort and assign students to see the leaderboard.</p>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* Hero */}
      <div className="rounded-2xl px-5 py-4" style={{ background: HERO_LB }}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.12)' }}>
            <Trophy className="w-5 h-5" style={{ color: '#fbbf24' }}/>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black leading-tight" style={{ color: '#ffffff' }}>Leaderboard</h2>
            <p className="text-xs" style={{ color: 'rgba(197,210,255,0.8)' }}>
              Student rankings by cohort &middot; total XP earned
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <p className="text-base font-black tabular-nums leading-tight" style={{ color: '#fbbf24' }}>{totalStudents}</p>
              <p className="text-[10px]" style={{ color: 'rgba(197,210,255,0.7)' }}>Students</p>
            </div>
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.15)' }}/>
            <div className="text-right">
              <p className="text-base font-black tabular-nums leading-tight" style={{ color: '#ffffff' }}>{avgXP.toLocaleString()}</p>
              <p className="text-[10px]" style={{ color: 'rgba(197,210,255,0.7)' }}>Avg XP</p>
            </div>
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.15)' }}/>
            <div className="text-right">
              <p className="text-base font-black tabular-nums leading-tight" style={{ color: '#ffffff' }}>{totalXP.toLocaleString()}</p>
              <p className="text-[10px]" style={{ color: 'rgba(197,210,255,0.7)' }}>Total XP</p>
            </div>
            <button onClick={() => setRefreshKey(k => k + 1)} aria-label="Refresh"
              className="ml-1 w-8 h-8 rounded-full grid place-items-center flex-shrink-0 transition-opacity hover:opacity-80"
              style={{ background: 'rgba(255,255,255,0.12)', color: '#ffffff' }}>
              <TrendingUp className="w-4 h-4"/>
            </button>
          </div>
        </div>
      </div>

      {/* Cohorts stacked vertically -- one section each */}
      <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
        {/* Filter bar */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <h3 className="text-sm font-bold leading-none" style={{ color: C.text }}>Rankings</h3>
          <select value={cohortFilter} onChange={e => setCohortFilter(e.target.value)}
            className="text-sm px-3 py-2 rounded-lg outline-none cursor-pointer"
            style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}>
            <option value="all">All Cohorts</option>
            {cohorts.filter(c => (rankingsByCohort[c.id] ?? []).length > 0).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="p-5 sm:p-6 space-y-9">
          {(() => {
            const visible = cohorts.filter(c => (rankingsByCohort[c.id] ?? []).length > 0 && (cohortFilter === 'all' || c.id === cohortFilter));
            if (visible.length === 0) return (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Users className="w-8 h-8 mb-3" style={{ color: C.faint }}/>
                <p className="text-sm font-medium" style={{ color: C.muted }}>No ranked students yet</p>
                <p className="text-xs mt-1" style={{ color: C.faint }}>Assign students to cohorts to see rankings</p>
              </div>
            );
            return visible.map(c => {
              const ranks = rankingsByCohort[c.id] ?? [];
              return (
                <div key={c.id}>
                  {/* Cohort section header */}
                  <div className="pb-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
                    <h3 className="text-sm font-bold leading-none" style={{ color: C.text }}>{c.name}</h3>
                  </div>
                  {/* Rankings */}
                  {ranks.map((r: any, idx: number) => (
                    <div key={r.id ?? r.rank} className="flex items-center gap-3 py-3.5"
                      style={{ borderBottom: idx < ranks.length - 1 ? `1px solid ${C.divider}` : 'none' }}>
                      {/* Rank */}
                      <span className="w-7 text-sm font-bold tabular-nums flex-shrink-0" style={{ color: r.rank <= 3 ? '#f59e0b' : C.faint }}>{r.rank}</span>
                      {/* Name + email */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{r.name}</p>
                        <p className="text-[11px] truncate" style={{ color: C.faint }}>{r.email}</p>
                      </div>
                      {/* XP */}
                      <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: C.text }}>{r.xp.toLocaleString()} XP</span>
                    </div>
                  ))}
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
