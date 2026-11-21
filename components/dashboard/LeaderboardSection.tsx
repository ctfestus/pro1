'use client';

// The admin Leaderboard: learners ranked by XP, one table per cohort.

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { MenuSelect } from '@/components/MenuSelect';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { Kpis, PageHeader } from '@/components/dashboard/content/kit';
import { Card, CardHead, Empty, btnClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';

export function LeaderboardSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const [cohorts, setCohorts]       = useState<any[]>([]);
  const [rankingsByCohort, setRankingsByCohort] = useState<Record<string, any[]>>({});
  const [loading, setLoading]       = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cohortFilter, setCohortFilter] = useState('all');

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

  const ranked   = cohorts.filter(c => (rankingsByCohort[c.id] ?? []).length > 0);
  const visible  = ranked.filter(c => cohortFilter === 'all' || c.id === cohortFilter);
  const shown    = visible.flatMap(c => rankingsByCohort[c.id] ?? []);
  const totalXP  = shown.reduce((s, r) => s + r.xp, 0);
  const avgXP    = shown.length ? Math.round(totalXP / shown.length) : 0;
  const scope    = cohortFilter === 'all' ? 'Across all cohorts' : 'In this cohort';

  const header = (
    <PageHeader C={C} title="Leaderboard" sub="Learners ranked by the XP they have earned, per cohort."
      actions={cohorts.length > 0 && (
        <button type="button" onClick={() => setRefreshKey(k => k + 1)} disabled={loading} className={btnClass} style={btnStyle('sec', C)}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      )} />
  );

  if (loading) return (
    <div className="space-y-5 pb-12">
      {header}
      <div className="grid sm:grid-cols-3 gap-3">
        {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: C.card }} />)}
      </div>
      <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.card }} />
    </div>
  );

  if (!cohorts.length) return (
    <div className="space-y-5 pb-12">
      {header}
      <Card C={C}><Empty C={C} title="No cohorts yet" sub="Create a cohort and assign students to see the leaderboard." /></Card>
    </div>
  );

  return (
    <div className="space-y-5 pb-12">
      {header}

      {ranked.length > 0 && (
        <MenuSelect fixed searchable label="Filter by cohort" value={cohortFilter} onChange={setCohortFilter} C={C}
          options={[{ value: 'all', label: 'All cohorts' }, ...ranked.map(c => ({ value: c.id as string, label: c.name as string }))]} />
      )}

      <Kpis C={C} items={[
        { label: 'Learners', n: shown.length, sub: scope, color: C.text },
        { label: 'Average XP', n: avgXP.toLocaleString(), sub: 'Per learner', color: C.text },
        { label: 'Total XP', n: totalXP.toLocaleString(), sub: 'Earned so far', color: C.text },
      ]} />

      {visible.length === 0 ? (
        <Card C={C}><Empty C={C} title="No ranked students yet" sub="Assign students to cohorts to see rankings." /></Card>
      ) : visible.map(c => {
        const ranks = rankingsByCohort[c.id] ?? [];
        return (
          <Card key={c.id} C={C} className="overflow-hidden">
            <CardHead C={C} title={c.name} sub={plural(ranks.length, 'learner')} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr>{['Rank', 'Learner', 'XP', 'Completed'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {ranks.map((r: any) => (
                    <tr key={r.id ?? r.rank} style={{ borderTop: `1px solid ${C.divider}` }}>
                      <td className="px-4 py-3 w-20">
                        <span className="w-7 h-7 rounded-full inline-grid place-items-center text-xs font-semibold tabular-nums"
                          style={r.rank === 1 ? { background: P.sel, color: P.onSel } : { background: C.pill, color: C.muted }}>{r.rank}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold truncate" style={{ color: C.text }}>{r.name}</p>
                        <p className="text-xs truncate" style={{ color: C.muted }}>{r.email}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums whitespace-nowrap" style={{ color: C.text }}>{r.xp.toLocaleString()}</td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: C.muted }}>{r.completions ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
