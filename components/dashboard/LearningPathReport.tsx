'use client';

// Learning path report: how every learner who can reach a path is progressing through it,
// whether they came in through a bootcamp cohort or a subscription plan.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Award, ChevronDown, ChevronRight, Download, Loader2, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cardStyle, type LIGHT_C } from '@/lib/theme';
import { reportExportCSV } from '@/lib/dashboard-export';
import type {
  EnrollmentSource, PathItemKind, PathItemStatus, PathLearnerStatus, PathReport, PathReportLearner,
} from '@/lib/learning-path-report';

type Theme = typeof LIGHT_C;

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

const KIND_LABEL: Record<PathItemKind, string> = { course: 'Course', virtual_experience: 'VE', certification: 'Cert' };

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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

function statusColors(C: Theme, status: PathLearnerStatus | PathItemStatus) {
  if (status === 'completed') return { bg: C.successBg, fg: C.successText };
  if (status === 'in_progress') return { bg: `${C.accent}18`, fg: C.accent };
  if (status === 'failed') return { bg: C.errorBg, fg: C.errorText };
  return { bg: C.pill, fg: C.faint };
}

function Bar({ C, pct, color }: { C: Theme; pct: number; color?: string }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden flex-1" style={{ background: C.pill }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color ?? C.green }}/>
    </div>
  );
}

export function LearningPathReport({ C, pathId, onBack }: { C: Theme; pathId: string; onBack?: () => void }) {
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
  const itemTitle = (id: string | null) => (id ? items.find(i => i.id === id)?.title ?? '-' : '-');

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
    const headers = ['Name', 'Email', 'Enrollment', 'Cohort or plan', 'Subscription status', 'Subscription ends', 'Enrolled', 'Status',
      'Items completed', 'Total items', 'Progress %', 'Current step', 'Last active', 'Completed on', 'Certificate',
      ...items.map(i => `${i.title} (${KIND_LABEL[i.kind]})`)];
    const rows = filtered.map(l => [
      l.name, l.email, SOURCE_LABEL[l.source], enrollmentLabel(l), l.subscription_status ?? '', l.subscription_ends_at ? fmtDate(l.subscription_ends_at) : '',
      l.enrolled_at ? fmtDate(l.enrolled_at) : '', STATUS_LABEL[l.status], l.completed_count, l.total_items, l.progress_pct,
      l.current_item_id ? itemTitle(l.current_item_id) : '', l.last_active_at ? fmtDate(l.last_active_at) : '',
      l.completed_at ? fmtDate(l.completed_at) : '', l.certificate_issued ? 'Yes' : 'No',
      ...items.map(i => {
        const p = l.items[i.id];
        if (!p) return '';
        const score = p.score !== null ? ` (${p.score}%)` : '';
        return p.status === 'in_progress' ? `In progress ${p.progress_pct}%` : `${ITEM_STATUS_LABEL[p.status]}${score}`;
      }),
    ]);
    reportExportCSV(headers, rows, `${report.path.title.replace(/[^a-z0-9]+/gi, '_')}_path_report.csv`);
  };

  const selectStyle = { background: C.card, color: C.text, border: `1px solid ${C.divider}` };

  if (loading && !report) {
    return (
      <div className="rounded-2xl p-12 grid place-items-center" style={{ ...cardStyle(C) }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="rounded-2xl p-8 text-center space-y-4" style={{ ...cardStyle(C) }}>
        <p className="text-sm" style={{ color: C.muted }}>{error}</p>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold" style={{ background: C.cta, color: C.ctaText }}>
          <RefreshCw className="w-4 h-4"/> Try again
        </button>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {onBack && (
            <button onClick={onBack} aria-label="Back to learning paths"
              className="w-10 h-10 flex-shrink-0 rounded-xl grid place-items-center transition-opacity hover:opacity-70"
              style={{ background: C.card, color: C.muted }}>
              <ArrowLeft className="w-4 h-4"/>
            </button>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.faint }}>Path report</p>
            <h2 className="text-xl font-bold tracking-tight truncate" style={{ color: C.text }}>{report.path.title}</h2>
            <p className="text-xs mt-0.5" style={{ color: C.faint }}>
              {items.length} item{items.length === 1 ? '' : 's'} - {learners.length} learner{learners.length === 1 ? '' : 's'}
              {report.path.available_to_everyone ? ' - open to everyone' : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} aria-label="Refresh report"
            className="w-10 h-10 rounded-xl grid place-items-center transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ background: C.card, color: C.muted }}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}/>
          </button>
          <button onClick={exportCsv} disabled={!filtered.length}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-80 transition-opacity disabled:opacity-50"
            style={{ background: C.cta, color: C.ctaText }}>
            <Download className="w-4 h-4"/> Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div role="status" className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm" style={{ background: C.errorBg, color: C.errorText }}>
          <span>Refresh failed. These results are from the last successful load.</span>
          <button onClick={load} disabled={loading} className="font-bold flex-shrink-0 disabled:opacity-50">Try again</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Learners', value: kpi.total },
          { label: 'Not started', value: kpi.notStarted },
          { label: 'In progress', value: kpi.inProgress },
          { label: 'Completed', value: kpi.completed },
          { label: 'Completion rate', value: `${kpi.rate}%` },
          { label: 'Avg progress', value: `${kpi.avg}%` },
        ].map(k => (
          <div key={k.label} className="rounded-2xl p-4" style={{ ...cardStyle(C) }}>
            <p className="text-[11px] font-semibold" style={{ color: C.faint }}>{k.label}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: C.text }}>{k.value}</p>
          </div>
        ))}
      </div>

      {learners.length === 0 ? (
        <div className="rounded-2xl p-10 text-center" style={{ ...cardStyle(C) }}>
          <p className="font-semibold" style={{ color: C.text }}>No learners yet</p>
          <p className="text-sm mt-1" style={{ color: C.faint }}>Assign this path to a cohort or add it to a subscription plan, and enrolled learners will show up here.</p>
        </div>
      ) : (
        <>
          {/* Enrollment breakdown: one row, one card per way in */}
          <section className="rounded-2xl p-5" style={{ ...cardStyle(C) }}>
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h3 className="text-sm font-bold" style={{ color: C.text }}>By enrollment</h3>
              <p className="text-xs" style={{ color: C.faint }}>Click one to filter the report</p>
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {sourcesPresent.map(source => {
                const s = summarize(learners.filter(l => l.source === source));
                const active = sourceFilter === source;
                return (
                  <button key={source} onClick={() => { setSourceFilter(active ? 'all' : source); setCohortFilter('all'); }}
                    className="text-left rounded-xl p-4 transition-colors"
                    style={{ background: active ? `${C.green}10` : C.page, boxShadow: active ? `inset 0 0 0 1.5px ${C.green}` : 'none' }}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold" style={{ color: C.text }}>{SOURCE_LABEL[source]}</span>
                      <span className="text-xl font-bold" style={{ color: C.text }}>{s.total}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                      <Bar C={C} pct={s.avg}/>
                      <span className="text-xs font-semibold" style={{ color: C.muted }}>{s.avg}% avg</span>
                    </div>
                    <p className="text-[11px] mt-2" style={{ color: C.faint }}>{s.completed} completed - {s.inProgress} in progress - {s.notStarted} not started</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Content breakdown: each item, and who is where on it */}
          <section className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-sm font-bold" style={{ color: C.text }}>Content breakdown</h3>
              <p className="text-xs mt-0.5" style={{ color: C.faint }}>Completion for each course, experience and certification. Click one to see its learners.</p>
            </div>
            {items.length === 0 ? (
              <p className="text-sm px-5 pb-5" style={{ color: C.faint }}>This path has no content yet.</p>
            ) : items.map((item, idx) => {
              const byStatus = (st: PathItemStatus) => scoped
                .filter(l => (l.items[item.id]?.status ?? 'not_started') === st)
                .sort((a, b) => a.name.localeCompare(b.name));
              const done = byStatus('completed');
              const working = byStatus('in_progress');
              const notPassed = byStatus('failed');
              const notStarted = byStatus('not_started');
              const pct = scoped.length ? Math.round((done.length / scoped.length) * 100) : 0;
              const open = expandedItem === item.id;
              const groups: { status: PathItemStatus; label: string; rows: PathReportLearner[] }[] = [
                { status: 'completed', label: 'Completed', rows: done },
                { status: 'in_progress', label: 'In progress', rows: working },
                ...(notPassed.length ? [{ status: 'failed' as const, label: 'Not passed', rows: notPassed }] : []),
                { status: 'not_started', label: 'Not started', rows: notStarted },
              ];
              return (
                <div key={item.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                  <button onClick={() => setExpandedItem(open ? null : item.id)} aria-expanded={open}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors"
                    style={{ background: open ? `${C.green}08` : 'transparent' }}>
                    {open ? <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: C.faint }}/> : <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: C.faint }}/>}
                    <span className="text-[11px] font-bold w-6 h-6 rounded-full grid place-items-center flex-shrink-0" style={{ color: C.green, background: `${C.green}16` }}>{idx + 1}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: C.pill, color: C.muted }}>{KIND_LABEL[item.kind]}</span>
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold" style={{ color: C.text }}>{item.title}</span>
                    <span className="hidden sm:flex items-center gap-3 w-56 flex-shrink-0"><Bar C={C} pct={pct}/><span className="text-xs font-semibold w-9 text-right" style={{ color: C.muted }}>{pct}%</span></span>
                    <span className="text-xs flex-shrink-0 w-28 text-right" style={{ color: C.faint }}>{done.length} of {scoped.length} done</span>
                  </button>
                  {open && (
                    <div className="px-5 pb-5 pt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {groups.map(g => {
                        const gc = statusColors(C, g.status);
                        return (
                          <div key={g.status} className="rounded-xl p-3" style={{ background: C.page }}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: gc.bg, color: gc.fg }}>{g.label}</span>
                              <span className="text-xs font-bold" style={{ color: C.text }}>{g.rows.length}</span>
                            </div>
                            {g.rows.length === 0 ? (
                              <p className="text-xs py-1" style={{ color: C.faint }}>No one</p>
                            ) : (
                              <ul className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                                {g.rows.map(l => {
                                  const p = l.items[item.id];
                                  const detail = g.status === 'in_progress' ? `${p?.progress_pct ?? 0}%` : p?.score !== null && p?.score !== undefined ? `${p.score}%` : '';
                                  return (
                                    <li key={l.student_id} className="flex items-center justify-between gap-2 text-xs">
                                      <span className="truncate" style={{ color: C.text }} title={l.email}>{l.name}</span>
                                      {detail && <span className="flex-shrink-0 font-semibold" style={{ color: C.muted }}>{detail}</span>}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faint }}/>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email"
                className="w-full pl-10 pr-3 py-2.5 rounded-xl text-sm outline-none" style={selectStyle}/>
            </div>
            <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value as any); setCohortFilter('all'); }}
              className="px-3 py-2.5 rounded-xl text-sm outline-none" style={selectStyle} aria-label="Filter by enrollment">
              <option value="all">All enrollments</option>
              {sourcesPresent.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
            <select value={cohortFilter} onChange={e => setCohortFilter(e.target.value)}
              className="px-3 py-2.5 rounded-xl text-sm outline-none" style={selectStyle} aria-label="Filter by cohort or plan">
              <option value="all">All cohorts and plans</option>
              {report.cohorts.filter(c => sourceFilter === 'all' || c.source === sourceFilter
                // Lapsed learners are filed under the plan they held.
                || (sourceFilter === 'former' && learners.some(l => l.source === 'former' && l.former_plan_cohort_id === c.id))).map(c => (
                <option key={c.id} value={c.id}>{c.source === 'subscriber' ? `Plan: ${c.name}` : c.name}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
              className="px-3 py-2.5 rounded-xl text-sm outline-none" style={selectStyle} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {(Object.keys(STATUS_LABEL) as PathLearnerStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>

          {/* Learner table */}
          <section className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.divider}` }}>
                    {['Learner', 'Enrollment', 'Progress', 'Status', 'Current step', 'Last active'].map(h => (
                      <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wider px-4 py-3 whitespace-nowrap" style={{ color: C.faint }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, visible).map(l => {
                    const open = expanded === l.student_id;
                    const sc = statusColors(C, l.status);
                    return (
                      <Fragment key={l.student_id}>
                        <tr onClick={() => setExpanded(open ? null : l.student_id)} className="cursor-pointer transition-colors"
                          style={{ borderBottom: `1px solid ${C.divider}`, background: open ? `${C.green}08` : 'transparent' }}>
                          <td className="px-4 py-3 min-w-[200px]">
                            <div className="flex items-center gap-2">
                              {open ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>}
                              <div className="min-w-0">
                                <p className="font-semibold truncate" style={{ color: C.text }}>{l.name}</p>
                                <p className="text-xs truncate" style={{ color: C.faint }}>{l.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 min-w-[170px]">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: C.pill, color: C.muted }}>{SOURCE_LABEL[l.source]}</span>
                            <p className="text-xs mt-1 truncate" style={{ color: C.muted }}>{enrollmentLabel(l) || '-'}</p>
                            {l.subscription_status && (l.source === 'subscriber' || l.source === 'former') && (
                              <p className="text-[11px]" style={{ color: C.faint }}>
                                {l.subscription_status === 'active' ? `Paid through ${fmtDate(l.subscription_ends_at)}` : `Subscription ${l.subscription_status}`}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 min-w-[170px]">
                            <div className="flex items-center gap-2">
                              <Bar C={C} pct={l.progress_pct}/>
                              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: C.muted }}>{l.completed_count}/{l.total_items}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-[11px] font-bold px-2 py-1 rounded-full inline-flex items-center gap-1" style={{ background: sc.bg, color: sc.fg }}>
                              {l.certificate_issued && <Award className="w-3 h-3"/>}{STATUS_LABEL[l.status]}
                            </span>
                            {l.account_status !== 'active' && <p className="text-[11px] mt-1 capitalize" style={{ color: C.faint }}>Account {l.account_status}</p>}
                          </td>
                          <td className="px-4 py-3 min-w-[160px]">
                            <p className="text-xs truncate max-w-[220px]" style={{ color: C.muted }}>
                              {l.status === 'completed' ? `Finished ${fmtDate(l.completed_at)}` : itemTitle(l.current_item_id)}
                            </p>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: C.muted }}>{daysAgo(l.last_active_at)}</td>
                        </tr>
                        {open && (
                          <tr style={{ borderBottom: `1px solid ${C.divider}` }}>
                            <td colSpan={6} className="px-4 pb-5 pt-1">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-3 pl-6" style={{ color: C.faint }}>
                                <span>Enrolled {fmtDate(l.enrolled_at)}</span>
                                <span>{l.completed_count} of {l.total_items} completed</span>
                                {l.certificate_issued && <span className="inline-flex items-center gap-1" style={{ color: C.successText }}><Award className="w-3 h-3"/>Certificate issued</span>}
                              </div>
                              <div className="grid gap-2 pl-6 sm:grid-cols-2 xl:grid-cols-3 max-w-5xl">
                                {items.map((item, idx) => {
                                  const p = l.items[item.id];
                                  const st = p?.status ?? 'not_started';
                                  const ic = statusColors(C, st);
                                  return (
                                    <div key={item.id} className="rounded-xl p-3" style={{ background: ic.bg }}>
                                      <div className="flex items-center gap-2 text-[11px]" style={{ color: C.faint }}>
                                        <span className="font-bold">{idx + 1}</span>
                                        <span>{KIND_LABEL[item.kind]}</span>
                                        <span className="ml-auto font-bold" style={{ color: ic.fg }}>{ITEM_STATUS_LABEL[st]}</span>
                                      </div>
                                      <p className="text-sm font-semibold mt-1 line-clamp-2" style={{ color: C.text }}>{item.title}</p>
                                      <div className="flex items-center gap-2 mt-2">
                                        <Bar C={C} pct={p?.progress_pct ?? 0} color={ic.fg}/>
                                        <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: C.muted }}>
                                          {p?.score !== null && p?.score !== undefined ? `Score ${p.score}%` : `${p?.progress_pct ?? 0}%`}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <p className="text-sm text-center py-10" style={{ color: C.faint }}>No learners match these filters.</p>
            )}
            {filtered.length > visible && (
              <div className="p-4 text-center" style={{ borderTop: `1px solid ${C.divider}` }}>
                <button onClick={() => setVisible(v => v + PAGE_SIZE)} className="text-sm font-semibold" style={{ color: C.green }}>
                  Show more ({filtered.length - visible} remaining)
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}