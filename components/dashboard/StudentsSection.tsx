'use client';

// The admin Students page: the roster, account setup and progress. The details panel and the
// Add student pop-up live in components/dashboard/students/.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, MoreHorizontal, Plus, Search, XCircle } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { supabase } from '@/lib/supabase';
import { reportExportCSV } from '@/lib/dashboard-export';
import { fetchAllRows } from '@/lib/fetch-all-rows';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { getJson } from '@/components/dashboard/subscriptions/api';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Bar, Card, DISPLAY_FONT, Pill, btnClass, btnStyle, learnerName, palette, shortDate } from '@/components/dashboard/subscriptions/ui';
import { AddStudentModal } from '@/components/dashboard/students/AddStudentModal';
import { StudentDrawer } from '@/components/dashboard/students/StudentDrawer';
import { accountStatus, bootcampOf, dateTime, type SetupBucket } from '@/components/dashboard/students/shared';

const CHIPS: ['all' | SetupBucket, string][] = [['all', 'All'], ['signed_in', 'Signed in'], ['setting_up', 'Setting up'], ['not_invited', 'Not invited']];

export function StudentsSection({ C: theme }: { C: ThemeColors }) {
  // As on Subscriptions and Payments: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const [students, setStudents] = useState<any[]>([]);
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [stats, setStats] = useState<{ completedCount: Record<string, number>; cohortContentCount: Record<string, number>; studentContentCount: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Course totals come from the stats route. When it fails the totals are unknown, not zero.
  const [statsError, setStatsError] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [setupFilter, setSetupFilter] = useState<'all' | SetupBucket>('all');
  const [menu, setMenu] = useState<{ student: any; position: MenuPosition } | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [roster, cohortRows, statsData] = await Promise.all([
        // Paged. The roster grows with the tenant, and PostgREST caps a single response at the
        // project's row limit, which truncates SILENTLY. Ordered by (full_name, id) because page
        // boundaries are only stable under a total order, and names are not unique.
        fetchAllRows<any>((from, to) => supabase
          .from('students')
          .select('id, full_name, email, cohort_id, enrollment_model, onboarding_done, account_provisioned_at, setup_email_sent_at, password_setup_started_at, password_set_at, onboarding_completed_at, last_login_at', { count: 'exact' })
          .eq('role', 'student')
          .order('full_name')
          .order('id')
          .range(from, to)),
        supabase.from('cohorts').select('id, name, cohort_kind').then(({ data, error }) => { if (error) throw error; return data ?? []; }),
        getJson('/api/admin/students-stats', 'Failed to load course counts').catch(() => null),
      ]);
      setStudents(roster);
      setCohorts(cohortRows);
      setStats(statsData);
      setStatsError(!statsData);
    } catch (err: any) {
      // Not an empty roster: say it failed, so nobody reads it as a school with no students.
      setLoadError(err?.message || 'Could not load the students.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cohortsById = useMemo(() => new Map(cohorts.map((c) => [c.id, c])), [cohorts]);
  const bootcampName = (s: any) => bootcampOf(s, cohortsById)?.name ?? null;
  const term = search.trim().toLowerCase();
  const visible = students.filter((s) =>
    (!term || `${s.full_name ?? ''} ${s.email ?? ''}`.toLowerCase().includes(term))
    && (cohortFilter === 'all' || (cohortFilter === 'none' ? !bootcampOf(s, cohortsById) : s.cohort_id === cohortFilter))
    && (setupFilter === 'all' || accountStatus(s).bucket === setupFilter));

  const inCohorts = students.filter((s) => bootcampOf(s, cohortsById));
  const cohortCount = new Set(inCohorts.map((s) => s.cohort_id)).size;
  const counts = students.reduce<Record<string, number>>((acc, s) => { const b = accountStatus(s).bucket; acc[b] = (acc[b] ?? 0) + 1; return acc; }, {});
  const signedIn = counts.signed_in ?? 0;

  /** Content done and, for a cohort learner, the total in their cohort (or their own track). */
  const progress = (s: any) => {
    if (!stats) return null;
    const done = stats.completedCount?.[s.id] ?? 0;
    const total = bootcampOf(s, cohortsById) ? stats.studentContentCount?.[s.id] ?? stats.cohortContentCount?.[s.cohort_id] ?? 0 : null;
    return { done, total };
  };

  const exportCsv = () => reportExportCSV(
    ['Name', 'Email', 'Cohort', 'Access Status', 'Account Created', 'Setup Email Sent', 'Setup Link Opened', 'Password Set', 'Onboarding Complete', 'Last Login', 'Content in Cohort', 'Completed'],
    visible.map((s) => {
      const p = progress(s);
      return [
        s.full_name || '', s.email || '', bootcampName(s) ?? 'On their own', accountStatus(s).label,
        dateTime(s.account_provisioned_at) ?? '', dateTime(s.setup_email_sent_at) ?? '', dateTime(s.password_setup_started_at) ?? '',
        dateTime(s.password_set_at) ?? '', dateTime(s.onboarding_completed_at) ?? '', dateTime(s.last_login_at) ?? '',
        p?.total ?? '', p ? p.done : '',
      ];
    }),
    'students.csv',
  );

  const kpis = [
    { label: 'Students', n: students.length, sub: `${inCohorts.length} in ${cohortCount} cohort${cohortCount === 1 ? '' : 's'}, ${students.length - inCohorts.length} on their own`, color: C.text },
    { label: 'Signed in', n: signedIn, sub: students.length ? `${Math.round((signedIn / students.length) * 100)}% have used their account` : 'Nobody yet', color: signedIn ? P.good : C.text, bar: students.length ? (signedIn / students.length) * 100 : 0 },
    { label: 'Still setting up', n: counts.setting_up ?? 0, sub: 'Invited, not signed in yet', color: counts.setting_up ? P.warn : C.text },
    { label: 'Not invited', n: counts.not_invited ?? 0, sub: 'Account made, no setup email yet', color: C.text },
  ];

  const openMenu = (e: React.MouseEvent<HTMLElement>, s: any) => {
    e.stopPropagation();
    setMenu(menu?.student.id === s.id ? null : { student: s, position: menuPosition(e.currentTarget, 150) });
  };
  const kebab = (s: any) => (
    <button type="button" onClick={(e) => openMenu(e, s)} aria-label={`Actions for ${learnerName(s)}`} className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
      style={menu?.student.id === s.id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );
  const progressCell = (s: any) => {
    const p = progress(s);
    if (!p) return <span className="text-xs" style={{ color: C.muted }}>--</span>;
    if (p.total == null) return <span className="text-xs" style={{ color: p.done ? C.text : C.muted }}>{p.done ? `${p.done} done` : '--'}</span>;
    return (
      <div className="grid gap-2">
        <span className="text-xs whitespace-nowrap" style={{ color: C.text }}>{p.done} of {p.total} done</span>
        <Bar parts={[{ pct: p.total ? (p.done / p.total) * 100 : 0, color: P.good }]} C={C} />
      </div>
    );
  };
  const cohortCell = (s: any) => {
    const name = bootcampName(s);
    return name
      ? <span className="text-sm line-clamp-2" style={{ color: C.text }} title={name}>{name}</span>
      : <Pill tone="mute" C={C}>On their own</Pill>;
  };

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The dashboard hides its own section title here, so this is the page heading. */}
          <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Students</h1>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Every learner, their cohort and how far they have got.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} disabled={!visible.length} className={btnClass} style={btnStyle('sec', C)}>
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button type="button" onClick={() => setAdding(true)} className={btnClass} style={btnStyle('pri', C)}>
            <Plus className="w-4 h-4" />
            Add student
          </button>
        </div>
      </div>

      {message && (
        <div role="status" className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {message}
        </div>
      )}
      {(loadError || statsError) && !loading && (
        <div role="alert" className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          <XCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{loadError || 'Could not load course counts, so progress is not shown.'}</span>
          <button type="button" onClick={() => { setLoading(true); load(); }} className="text-xs font-semibold underline underline-offset-2">Try again</button>
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: C.card }} />)}
        </div>
      ) : loadError ? null : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {kpis.map((k) => (
              <Card key={k.label} C={C} className="p-4 grid gap-2 content-start">
                <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 tabular-nums" style={{ color: k.color, fontFamily: DISPLAY_FONT }}>{k.n}</p>
                <p className="text-sm font-semibold" style={{ color: C.text }}>{k.label}</p>
                <p className="text-xs" style={{ color: C.muted }}>{k.sub}</p>
                {k.bar != null && <Bar parts={[{ pct: k.bar, color: P.good }]} C={C} />}
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="field-shell flex items-center gap-2 h-10 px-3 rounded-xl flex-1 min-w-[220px]" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}>
              <Search className="w-4 h-4 flex-shrink-0" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className="bg-transparent outline-none text-sm w-full" style={{ color: C.text }} />
            </label>
            <MenuSelect
              searchable
              fixed
              label="Filter by cohort"
              value={cohortFilter}
              options={[
                { value: 'all', label: 'All cohorts' },
                { value: 'none', label: 'On their own' },
                ...cohorts.filter((c) => bootcampOf({ cohort_id: c.id }, cohortsById)).map((c) => ({ value: c.id as string, label: c.name as string })),
              ]}
              onChange={setCohortFilter}
              C={C}
            />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by account setup">
              {CHIPS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={setupFilter === id}
                  onClick={() => setSetupFilter(id)}
                  className="h-8 px-3 rounded-full text-xs font-semibold"
                  style={setupFilter === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Card C={C} className="overflow-hidden">
            {visible.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>{students.length ? 'No students match these filters.' : 'No students yet. Add one, or admit applicants into a cohort.'}</p>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm table-fixed">
                    <colgroup><col style={{ width: '31%' }} /><col style={{ width: '24%' }} /><col style={{ width: '17%' }} /><col style={{ width: '15%' }} /><col style={{ width: '13%' }} /><col style={{ width: 72 }} /></colgroup>
                    <thead>
                      <tr>{['Learner', 'Cohort', 'Account', 'Progress', 'Last sign-in', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {visible.map((s) => {
                        const status = accountStatus(s);
                        return (
                          <tr key={s.id} onClick={() => setSelected(s)} className="cursor-pointer" style={{ borderTop: `1px solid ${C.divider}` }}>
                            <td className="px-4 py-3">
                              <div className="min-w-0">
                                <p className="font-semibold truncate" style={{ color: C.text }}>{s.full_name || 'No name'}</p>
                                <p className="text-xs truncate" style={{ color: C.muted }}>{s.email}</p>
                              </div>
                            </td>
                            <td className="px-4 py-3">{cohortCell(s)}</td>
                            <td className="px-4 py-3"><Pill tone={status.tone} dot C={C}>{status.label}</Pill></td>
                            <td className="px-4 py-3">{progressCell(s)}</td>
                            <td className="px-4 py-3 text-xs" style={{ color: s.last_login_at ? C.text : C.muted }}>{s.last_login_at ? shortDate(s.last_login_at) : 'Never'}</td>
                            <td className="pl-2 pr-5 py-3 text-right">{kebab(s)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden">
                  {visible.map((s, i) => {
                    const status = accountStatus(s);
                    return (
                      <div key={s.id} onClick={() => setSelected(s)} className="grid gap-3 px-4 py-4 cursor-pointer" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{s.full_name || 'No name'}</p>
                            <p className="text-xs truncate" style={{ color: C.muted }}>{bootcampName(s) ?? 'On their own'}</p>
                          </div>
                          {kebab(s)}
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <Pill tone={status.tone} dot C={C}>{status.label}</Pill>
                          <span className="text-xs" style={{ color: C.muted }}>{s.last_login_at ? `Signed in ${shortDate(s.last_login_at)}` : 'Never signed in'}</span>
                        </div>
                        {(progress(s)?.total != null || (progress(s)?.done ?? 0) > 0) && progressCell(s)}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>
          {visible.length > 0 && (
            <p className="text-xs" style={{ color: C.muted }}>
              {visible.length} student{visible.length === 1 ? '' : 's'}{visible.length !== students.length ? `, filtered from ${students.length}` : ''}. Click a row to see their details.
            </p>
          )}
        </>
      )}

      {menu && (
        <FloatingMenu
          position={menu.position}
          label="student actions"
          onClose={() => setMenu(null)}
          C={C}
          items={[
            { label: 'View details', sub: 'Progress, account setup and subscription', icon: Search, onClick: () => { setSelected(menu.student); setMenu(null); } },
            { label: 'View as student', sub: 'Opens their dashboard in a new tab', icon: ExternalLink, onClick: () => { window.open(`/student?viewAs=${menu.student.id}`, '_blank', 'noopener'); setMenu(null); } },
          ]}
        />
      )}
      {selected && <StudentDrawer key={selected.id} student={selected} cohortName={bootcampName(selected)} onClose={() => setSelected(null)} C={C} />}
      {adding && <AddStudentModal C={C} onClose={() => setAdding(false)} onCreated={(text) => { setAdding(false); setMessage(text); load(); }} />}
    </div>
  );
}
