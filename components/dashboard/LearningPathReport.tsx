'use client';

// Learning path report: how every learner who can reach a path is progressing through it,
// whether they came in through a bootcamp cohort or a subscription plan.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Award, Download, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';
import { reportExportCSV } from '@/lib/dashboard-export';
import { MenuSelect } from '@/components/MenuSelect';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { Bar, Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, dateLabel, palette, plural, type Tone } from '@/components/dashboard/subscriptions/ui';
import type {
  EnrollmentSource, PathItemKind, PathItemStatus, PathLearnerStatus, PathReport, PathReportItemProgress, PathReportLearner,
} from '@/lib/learning-path-report';

type Theme = ThemeColors;

const PAGE_SIZE = 50;

const SOURCE_LABEL: Record<EnrollmentSource, string> = {
  cohort: 'Cohort',
  subscriber: 'Subscriber',
  individual: 'Individual',
  open: 'Open access',
  former: 'No current access',
};
const SOURCE_ORDER: EnrollmentSource[] = ['cohort', 'subscriber', 'individual', 'open', 'former'];

const STATUS_LABEL: Record<PathLearnerStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

const ITEM_STATUS_LABEL: Record<PathItemStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  failed: 'Not passed',
  completed: 'Completed',
};

const KIND_LABEL: Record<PathItemKind, string> = { course: 'Course', virtual_experience: 'Virtual experience', certification: 'Certification' };

const TONE: Record<PathItemStatus, Tone> = { completed: 'good', in_progress: 'warn', failed: 'bad', not_started: 'mute' };

/** A card's heading row: title on the left, a short note on the right. */
export function SectionHead({ title, aside, C }: { title: string; aside: string; C: Theme }) {
  return (
    <div className="px-5 py-4 flex items-baseline justify-between gap-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
      <h3 className="text-base font-semibold" style={{ color: C.text }}>{title}</h3>
      <span className="text-xs" style={{ color: C.muted }}>{aside}</span>
    </div>
  );
}

function daysAgo(iso: string | null | undefined): string {
  if (!iso) return 'No activity';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return 'No activity';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// A lapsed subscriber has no cohort any more, so a plan filter matches them on the plan they held.
function matchesCohort(l: PathReportLearner, cohortFilter: string): boolean {
  return cohortFilter === 'all' || l.cohort_id === cohortFilter || l.former_plan_cohort_id === cohortFilter;
}

// Where the learner sits: their cohort or current plan, else the plan they held.
function enrollmentLabel(l: PathReportLearner): string {
  return l.cohort_name ?? (l.plan_name ? `Plan: ${l.plan_name}` : '');
}

const STATUS_RANK: Record<PathItemStatus, number> = { completed: 0, in_progress: 1, failed: 2, not_started: 3 };

const EMPTY_PROGRESS: PathReportItemProgress = { status: 'not_started', score: null, progress_pct: 0, last_active_at: null };

// One column layout for both drill-downs (learners on an item, items for a learner) so they read the same.
// Small screens keep the name and status; progress, score and last active join as space allows.
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_110px_minmax(140px,240px)_70px] lg:grid-cols-[minmax(0,1fr)_110px_minmax(140px,260px)_70px_100px] items-center gap-x-4';
// Without the status column the progress bar carries status (by colour), so it shows at every width.
const ROW_GRID_NO_STATUS = 'grid grid-cols-[minmax(0,1fr)_minmax(110px,160px)] sm:grid-cols-[minmax(0,1fr)_minmax(140px,280px)_70px] lg:grid-cols-[minmax(0,1fr)_minmax(140px,300px)_70px_100px] items-center gap-x-4';

function ProgressList({ C, heading, rows, showStatus = true }: {
  C: Theme;
  heading: string;
  showStatus?: boolean;
  rows: { key: string; title: string; sub?: string; progress: PathReportItemProgress }[];
}) {
  const grid = showStatus ? ROW_GRID : ROW_GRID_NO_STATUS;
  return (
    <div role="table" className="text-sm">
      <div role="row" className={`${grid} py-2 text-xs font-semibold`} style={{ color: C.faint, borderBottom: `1px solid ${C.divider}` }}>
        <span role="columnheader">{heading}</span>
        {showStatus && <span role="columnheader">Status</span>}
        <span role="columnheader" className={showStatus ? 'hidden sm:block' : ''}>Progress</span>
        <span role="columnheader" className="hidden sm:block text-right">Score</span>
        <span role="columnheader" className="hidden lg:block text-right">Last active</span>
      </div>
      {rows.map(({ key, title, sub, progress: p }) => {
        const P = palette(C);
        const color = { good: P.good, warn: P.warn, bad: P.bad }[TONE[p.status] as 'good' | 'warn' | 'bad'] ?? C.faint;
        return (
          <div role="row" key={key} className={`${grid} py-3`} style={{ borderBottom: `1px solid ${C.divider}` }}>
            <div role="cell" className="min-w-0">
              <p className="font-semibold truncate" style={{ color: C.text }}>{title}</p>
              {sub && <p className="text-xs truncate" style={{ color: C.muted }}>{sub}</p>}
            </div>
            {showStatus && (
              <div role="cell">
                <Pill tone={TONE[p.status]} C={C}>{ITEM_STATUS_LABEL[p.status]}</Pill>
              </div>
            )}
            <div role="cell" className={`${showStatus ? 'hidden sm:flex' : 'flex'} items-center gap-2`}>
              <div className="flex-1"><Bar parts={[{ pct: p.progress_pct, color }]} C={C}/></div>
              <span className="text-xs font-semibold w-9 text-right" style={{ color: C.muted }}>{p.progress_pct}%</span>
            </div>
            <div role="cell" className="hidden sm:block text-right text-xs font-semibold" style={{ color: p.score !== null ? C.text : C.faint }}>
              {p.score !== null ? `${p.score}%` : '--'}
            </div>
            <div role="cell" className="hidden lg:block text-right text-xs whitespace-nowrap" style={{ color: C.muted }}>
              {p.last_active_at ? daysAgo(p.last_active_at) : '--'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The report for one path. `header` draws the editor's header and tabs around the report's own buttons. */
export function LearningPathReport({ C, pathId, header }: { C: Theme; pathId: string; header: (actions: ReactNode) => ReactNode }) {
  const P = palette(C);
  const [report, setReport] = useState<PathReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | EnrollmentSource>('all');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | PathLearnerStatus>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/learning-paths/report?pathId=${encodeURIComponent(pathId)}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) { setError("Couldn't load this report right now. Try again."); return; }
      setReport(await res.json());
    } catch {
      setError("Couldn't load this report. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [pathId]); // eslint-disable-line react-hooks/exhaustive-deps

  const learners = useMemo(() => report?.learners ?? [], [report]);
  const items = useMemo(() => report?.items ?? [], [report]);
  const itemTitle = (id: string | null) => (id ? items.find(i => i.id === id)?.title ?? '' : '');

  const sourcesPresent = useMemo(
    () => SOURCE_ORDER.filter(s => learners.some(l => l.source === s)),
    [learners],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return learners
      .filter(l => sourceFilter === 'all' || l.source === sourceFilter)
      .filter(l => matchesCohort(l, cohortFilter))
      .filter(l => statusFilter === 'all' || l.status === statusFilter)
      .filter(l => !q || l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q))
      // Furthest along first, then most recently active, so the table opens on the people worth a look.
      .sort((a, b) => b.progress_pct - a.progress_pct || (b.last_active_at ?? '').localeCompare(a.last_active_at ?? '') || a.name.localeCompare(b.name));
  }, [learners, search, sourceFilter, cohortFilter, statusFilter]);

  useEffect(() => { setVisible(PAGE_SIZE); }, [search, sourceFilter, cohortFilter, statusFilter]);

  const summarize = (rows: PathReportLearner[]) => {
    const total = rows.length;
    const completed = rows.filter(l => l.status === 'completed').length;
    const inProgress = rows.filter(l => l.status === 'in_progress').length;
    return {
      total,
      completed,
      inProgress,
      notStarted: total - completed - inProgress,
      avg: total ? Math.round(rows.reduce((s, l) => s + l.progress_pct, 0) / total) : 0,
      rate: total ? Math.round((completed / total) * 100) : 0,
    };
  };
  // KPIs and the item funnel follow the source and cohort filters so a cohort can be read on its own.
  const scoped = useMemo(
    () => learners.filter(l => (sourceFilter === 'all' || l.source === sourceFilter) && matchesCohort(l, cohortFilter)),
    [learners, sourceFilter, cohortFilter],
  );
  const kpi = summarize(scoped);

  const exportCsv = () => {
    if (!report) return;
    const headers = ['Name', 'Email', 'Enrollment', 'Cohort or plan', 'Subscription status', 'Subscription ends', 'Enrolled', 'Track', 'Status',
      'Items completed', 'Total items', 'Progress %', 'Current step', 'Last active', 'Completed on', 'Certificate',
      ...items.map(i => `${i.title} (${KIND_LABEL[i.kind]})`)];
    const rows = filtered.map(l => [
      l.name, l.email, SOURCE_LABEL[l.source], enrollmentLabel(l), l.subscription_status ?? '', l.subscription_ends_at ? dateLabel(l.subscription_ends_at) : '',
      l.enrolled_at ? dateLabel(l.enrolled_at) : '', l.track_name ?? '', STATUS_LABEL[l.status], l.completed_count, l.total_items, l.progress_pct,
      l.current_item_id ? itemTitle(l.current_item_id) : '', l.last_active_at ? dateLabel(l.last_active_at) : '',
      l.completed_at ? dateLabel(l.completed_at) : '', l.certificate_issued ? 'Yes' : 'No',
      ...items.map(i => {
        const p = l.items[i.id];
        if (!p) return '';
        const score = p.score !== null ? ` (${p.score}%)` : '';
        return p.status === 'in_progress' ? `In progress ${p.progress_pct}%` : `${ITEM_STATUS_LABEL[p.status]}${score}`;
      }),
    ]);
    reportExportCSV(headers, rows, `${report.path.title.replace(/[^a-z0-9]+/gi, '_')}_path_report.csv`);
  };

  const actions = (
    <>
      <button type="button" onClick={load} disabled={loading} className={btnClass} style={btnStyle('sec', C)}>
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}/>Refresh
      </button>
      <button type="button" onClick={exportCsv} disabled={!filtered.length} className={btnClass} style={btnStyle('sec', C)}>
        <Download className="w-4 h-4"/>Export CSV
      </button>
    </>
  );

  if (!report) {
    return (
      <div className="space-y-4">
        {header(actions)}
        <Card C={C} className="p-12 grid place-items-center text-center gap-4">
          {loading ? <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/> : (
            <>
              <p className="text-sm" style={{ color: C.muted }}>{error}</p>
              <button type="button" onClick={load} className={btnClass} style={btnStyle('pri', C)}><RefreshCw className="w-4 h-4"/>Try again</button>
            </>
          )}
        </Card>
      </div>
    );
  }

  const cohortOptions = [
    { value: 'all', label: 'All cohorts and plans' },
    ...report.cohorts.filter(c => sourceFilter === 'all' || c.source === sourceFilter
      // Lapsed learners are filed under the plan they held.
      || (sourceFilter === 'former' && learners.some(l => l.source === 'former' && l.former_plan_cohort_id === c.id)))
      .map(c => ({ value: c.id, label: c.source === 'subscriber' ? `Plan: ${c.name}` : c.name })),
  ];
  const chip = (on: boolean) => (on ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` });
  const tiles: [string, ReactNode, string?][] = [
    ['Learners', kpi.total], ['Not started', kpi.notStarted], ['In progress', kpi.inProgress],
    ['Completed', kpi.completed, P.good], ['Completion rate', `${kpi.rate}%`], ['Average progress', `${kpi.avg}%`],
  ];

  return (
    <div className="space-y-4">
      {header(actions)}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl text-sm" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          <span>Refresh failed. These results are from the last successful load.</span>
          <button type="button" onClick={load} disabled={loading} className="font-semibold flex-shrink-0 disabled:opacity-50">Try again</button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map(([label, n, color]) => (
          <Card key={label} C={C} className="p-4 grid gap-2 content-start">
            <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 font-semibold tabular-nums" style={{ color: color ?? C.text, fontFamily: DISPLAY_FONT }}>{n}</p>
            <p className="text-sm font-semibold" style={{ color: C.text }}>{label}</p>
          </Card>
        ))}
      </div>

      {learners.length === 0 ? (
        <Card C={C} className="px-5 py-12 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No learners yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Assign this path to a cohort or add it to a subscription plan, and enrolled learners show up here.</p>
        </Card>
      ) : (
        <>
          {/* One row per way in; clicking one filters the whole report to it. */}
          <Card C={C} className="overflow-hidden">
            <SectionHead title="By enrolment" aside="Click one to filter" C={C}/>
            {sourcesPresent.map((source, i) => {
              const s = summarize(learners.filter(l => l.source === source));
              const active = sourceFilter === source;
              return (
                <button key={source} type="button" aria-pressed={active} onClick={() => { setSourceFilter(active ? 'all' : source); setCohortFilter('all'); }}
                  className="w-full flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left"
                  style={{ borderTop: i ? `1px solid ${C.divider}` : undefined, background: active ? C.pill : undefined }}>
                  <span className="min-w-0 flex-1 basis-[220px]">
                    <span className="block text-sm font-semibold" style={{ color: C.text }}>{SOURCE_LABEL[source]}, {plural(s.total, 'learner')}</span>
                    <span className="block text-xs" style={{ color: C.muted }}>{s.completed} completed, {s.inProgress} in progress, {s.notStarted} not started</span>
                  </span>
                  <span className="w-full sm:w-[200px] flex-shrink-0"><Bar parts={[{ pct: s.avg, color: P.good }]} C={C}/></span>
                  <span className="text-xs sm:w-[100px] sm:text-right flex-shrink-0" style={{ color: C.muted }}>{s.avg}% average</span>
                </button>
              );
            })}
          </Card>

          {/* Each item, and who is where on it. */}
          <Card C={C} className="overflow-hidden">
            <SectionHead title="Content breakdown" aside="Click one to see its learners" C={C}/>
            {items.length === 0 ? (
              <p className="text-sm px-5 py-6" style={{ color: C.muted }}>This path has no content yet.</p>
            ) : items.map((item, idx) => {
              // On a path with tracks a track item only belongs to its own learners, whose items
              // map is exactly what they are required to take.
              const rows = scoped
                .filter(l => !!l.items[item.id])
                .map(l => ({ l, p: l.items[item.id] ?? EMPTY_PROGRESS }))
                .sort((a, b) => STATUS_RANK[a.p.status] - STATUS_RANK[b.p.status] || b.p.progress_pct - a.p.progress_pct || a.l.name.localeCompare(b.l.name));
              const counts: Record<PathItemStatus, number> = { completed: 0, in_progress: 0, failed: 0, not_started: 0 };
              for (const r of rows) counts[r.p.status] += 1;
              const pct = rows.length ? Math.round((counts.completed / rows.length) * 100) : 0;
              const open = expandedItem === item.id;
              return (
                <div key={item.id} style={{ borderTop: idx ? `1px solid ${C.divider}` : undefined }}>
                  <button type="button" onClick={() => setExpandedItem(open ? null : item.id)} aria-expanded={open}
                    className="w-full flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left" style={{ background: open ? C.pill : undefined }}>
                    <span className="w-7 h-7 rounded-lg grid place-items-center text-xs font-bold flex-shrink-0" style={{ background: open ? C.card : C.pill, color: C.muted }}>{idx + 1}</span>
                    <span className="min-w-0 flex-1 basis-[180px]">
                      <span className="block text-sm font-semibold truncate" style={{ color: C.text }}>{item.title}</span>
                      <span className="block text-xs" style={{ color: C.muted }}>{KIND_LABEL[item.kind]}</span>
                    </span>
                    <span className="w-full sm:w-[200px] flex-shrink-0"><Bar parts={[{ pct, color: P.good }]} C={C}/></span>
                    <span className="text-xs sm:w-[100px] sm:text-right flex-shrink-0" style={{ color: C.muted }}>{counts.completed} of {rows.length} done</span>
                  </button>
                  {open && (
                    <div className="px-5 pb-4 pt-2 sm:pl-16">
                      <div className="flex flex-wrap gap-2 mb-2">
                        {(['completed', 'in_progress', 'failed', 'not_started'] as PathItemStatus[]).filter(st => st !== 'failed' || counts.failed > 0).map(st => (
                          <Pill key={st} tone={TONE[st]} C={C}>{counts[st]} {ITEM_STATUS_LABEL[st].toLowerCase()}</Pill>
                        ))}
                      </div>
                      <div className="max-h-[480px] overflow-y-auto">
                        <ProgressList C={C} heading="Learner" rows={rows.map(r => ({ key: r.l.student_id, title: r.l.name, sub: r.l.email, progress: r.p }))}/>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search by name or email" C={C}/>
            <MenuSelect label="Enrolment" fixed value={sourceFilter} C={C} onChange={v => { setSourceFilter(v); setCohortFilter('all'); }}
              options={[{ value: 'all' as const, label: 'All enrolments' }, ...sourcesPresent.map(s => ({ value: s, label: SOURCE_LABEL[s] }))]}/>
            <MenuSelect label="Cohort or plan" fixed searchable value={cohortFilter} C={C} onChange={setCohortFilter} options={cohortOptions}/>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {(['all', ...Object.keys(STATUS_LABEL)] as ('all' | PathLearnerStatus)[]).map(s => (
              <button key={s} type="button" aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)} className="h-8 px-3 rounded-full text-xs font-semibold" style={chip(statusFilter === s)}>
                {s === 'all' ? 'All' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <Card C={C} className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm table-fixed">
                <colgroup><col style={{ width: '24%' }}/><col style={{ width: '26%' }}/><col style={{ width: '18%' }}/><col style={{ width: '14%' }}/><col style={{ width: '18%' }}/></colgroup>
                <thead>
                  <tr>{['Learner', 'Enrolment', 'Progress', 'Status', 'Current step'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold px-4 py-3 whitespace-nowrap" style={{ color: C.faint }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {filtered.slice(0, visible).map(l => {
                    const open = expanded === l.student_id;
                    const where = l.cohort_name ?? l.plan_name;
                    const plan = l.subscription_status && (l.source === 'subscriber' || l.source === 'former')
                      ? l.subscription_status === 'active' ? (l.subscription_ends_at ? `paid through ${dateLabel(l.subscription_ends_at)}` : '') : `subscription ${l.subscription_status}`
                      : '';
                    return (
                      <Fragment key={l.student_id}>
                        <tr onClick={() => setExpanded(open ? null : l.student_id)} aria-expanded={open} className="cursor-pointer align-top"
                          style={{ borderTop: `1px solid ${C.divider}`, background: open ? C.pill : undefined }}>
                          <td className="px-4 py-3">
                            <p className="font-semibold truncate" style={{ color: C.text }}>{l.name}</p>
                            <p className="text-xs truncate" style={{ color: C.muted }}>{l.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="truncate" style={{ color: C.text }}>{where ?? SOURCE_LABEL[l.source]}</p>
                            <p className="text-xs truncate" style={{ color: C.muted }}>{[where ? SOURCE_LABEL[l.source] : '', plan].filter(Boolean).join(', ')}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs mb-1.5" style={{ color: C.text }}>{l.completed_count} of {l.total_items} done</p>
                            <Bar parts={[{ pct: l.progress_pct, color: P.good }]} C={C}/>
                            {report.path.has_tracks && (
                              <p className="text-xs mt-1.5 truncate" style={{ color: C.muted }}>{l.track_name === 'Core only' ? 'Core only' : l.track_name ? `${l.track_name} track` : 'No track chosen'}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Pill tone={TONE[l.status]} dot={l.status !== 'not_started'} C={C}>{l.certificate_issued && <Award className="w-3 h-3"/>}{STATUS_LABEL[l.status]}</Pill>
                            {l.account_status !== 'active' && <p className="text-xs mt-1" style={{ color: C.muted }}>Account {l.account_status}</p>}
                          </td>
                          <td className="px-4 py-3">
                            {l.status === 'completed'
                              ? <p className="truncate" style={{ color: C.text }}>{l.completed_at ? `Finished ${dateLabel(l.completed_at)}` : 'Finished'}</p>
                              : l.current_item_id && <p className="truncate" style={{ color: C.text }}>{itemTitle(l.current_item_id)}</p>}
                            <p className="text-xs" style={{ color: C.muted }}>{l.last_active_at ? `Active ${daysAgo(l.last_active_at).toLowerCase()}` : 'No activity yet'}</p>
                          </td>
                        </tr>
                        {open && (
                          <tr style={{ background: C.pill }}>
                            <td colSpan={5} className="px-4 pb-4 pt-1">
                              <ProgressList C={C} heading="Content" showStatus={false} rows={Object.keys(l.items)
                                // The learner's own order (core, then their track), as the server built l.items.
                                .map(id => items.find(item => item.id === id))
                                .filter((item): item is NonNullable<typeof item> => !!item)
                                .map((item, idx) => ({ key: item.id, title: `${idx + 1}. ${item.title}`, progress: l.items[item.id] ?? EMPTY_PROGRESS }))}/>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && <p className="text-sm text-center py-10" style={{ color: C.muted }}>No learners match these filters.</p>}
            {filtered.length > visible && (
              <div className="p-4 text-center" style={{ borderTop: `1px solid ${C.divider}` }}>
                <button type="button" onClick={() => setVisible(v => v + PAGE_SIZE)} className={btnSmClass} style={btnStyle('sec', C)}>Show more ({filtered.length - visible} remaining)</button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
