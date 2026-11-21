'use client';

// Originally extracted verbatim from app/dashboard/page.tsx. The data layer has since moved to the
// server: the table renders one page at a time, and the cohort filter, content type, status filter
// and search box are all query parameters rather than array operations over a full in-memory set.
// The KPI strip and the compose panel's segment counts come back from the API alongside the page,
// because both describe the whole set and cannot be recomputed from the rows on screen.

import { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Download, Loader2, MoreHorizontal, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { reportExportCSV } from '@/lib/dashboard-export';
import { IsStaffContext } from '@/components/dashboard/context';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { MenuSelect } from '@/components/MenuSelect';
import { Kpis, PageHeader } from '@/components/dashboard/content/kit';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { FIELD, inputStyle } from '@/components/dashboard/subscriptions/Modal';
import { Bar, Card, CardHead, Empty, Pill, btnClass, btnSmClass, btnStyle, palette, type Tone } from '@/components/dashboard/subscriptions/ui';
import { Hint, Label } from '@/components/create/EditorKit';

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  not_started: { label: 'Not started', tone: 'mute' },
  in_progress: { label: 'In progress', tone: 'mute' },
  stalled:     { label: 'Stalled',     tone: 'warn' },
  failed:      { label: 'Failed',      tone: 'bad' },
  completed:   { label: 'Completed',   tone: 'good' },
};

const TYPE_CHIPS: [string, string][] = [['all', 'All'], ['course', 'Courses'], ['virtual_experience', 'Experiences'], ['assignment', 'Assignments']];
const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'stalled', label: 'Stalled (7+ days)' },
  { value: 'failed', label: 'Failed' },
  { value: 'completed', label: 'Completed' },
  { value: 'at_risk', label: 'At risk' },
];
const SEGMENTS = [
  { key: 'not_started', label: 'Not started' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'stalled',     label: 'Stalled' },
  { key: 'failed',      label: 'Failed' },
  { key: 'completed',   label: 'Completed' },
  { key: 'all',         label: 'Everyone' },
] as const;

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

const ZERO_STATS    = { total: 0, not_started: 0, in_progress: 0, stalled: 0, failed: 0, completed: 0, at_risk: 0 };
const ZERO_SEGMENTS = { all: 0, not_started: 0, in_progress: 0, stalled: 0, failed: 0, completed: 0 };

const lastActiveLabel = (row: any) => row.lastActive
  ? row.daysSinceActivity === 0 ? 'Today'
    : row.daysSinceActivity === 1 ? 'Yesterday'
    : `${row.daysSinceActivity}d ago`
  : '--';

export function StudentTrackingSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const isStaff = useContext(IsStaffContext);
  const [rows, setRows]           = useState<any[]>([]);
  const [total, setTotal]         = useState(0);
  const [stats, setStats]         = useState(ZERO_STATS);
  const [cohorts, setCohorts]     = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading]     = useState(true);
  const [page, setPage]           = useState(1);
  const [cohortFilter, setCohortFilter]   = useState('all');
  const [typeFilter, setTypeFilter]       = useState('all');
  const [statusFilter, setStatusFilter]   = useState('all');
  const [search, setSearch]               = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [exporting, setExporting]         = useState(false);
  const [nudging, setNudging]             = useState<string | null>(null);
  const [nudged, setNudged]               = useState<Set<string>>(new Set());
  const [menu, setMenu]                   = useState<{ row: any; position: MenuPosition } | null>(null);

  // Bulk message compose state
  const [composing, setComposing]         = useState(false);
  const [msgSegment, setMsgSegment]       = useState<string>('not_started');
  const [msgCohort, setMsgCohort]         = useState('all');
  const [msgFormId, setMsgFormId]         = useState('all');
  const [msgSubject, setMsgSubject]       = useState('');
  const [msgBody, setMsgBody]             = useState('');
  const [msgSending, setMsgSending]       = useState(false);
  const [msgResult, setMsgResult]         = useState<{ sent: number } | null>(null);
  const [segCounts, setSegCounts]         = useState(ZERO_SEGMENTS);
  const [segLoading, setSegLoading]       = useState(false);
  const [composeForms, setComposeForms]   = useState<{ id: string; title: string }[]>([]);

  const authHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}` };
  }, []);

  // Query params shared by the table fetch and the CSV export, so an export always matches
  // exactly what the filters are showing.
  const filterParams = useCallback(() => ({
    cohortId:    cohortFilter,
    contentType: typeFilter,
    status:      statusFilter,
    search:      appliedSearch,
  }), [cohortFilter, typeFilter, statusFilter, appliedSearch]);

  // Typing must not fire a request per keystroke. Applying the term also returns to page 1,
  // in the same update, so the narrowed set is never read at a page that no longer exists.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      if (next === appliedSearch) return;
      setAppliedSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams({ ...filterParams(), page: String(page), pageSize: String(PAGE_SIZE) });
      const res = await fetch(`/api/tracking?${params}`, { headers: await authHeaders() });
      if (cancelled) return;
      if (res.ok) {
        const json = await res.json();
        setRows(json.rows ?? []);
        setTotal(json.total ?? 0);
        setStats(json.stats ?? ZERO_STATS);
        setCohorts(json.cohorts ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [filterParams, page, authHeaders]);

  // Segment counts and the content dropdown describe the whole cohort, not the page on screen, so
  // the panel asks the server for them when it opens or its own filters change. It asks the route
  // that does the sending, so the number on the button is produced by the same content scope and
  // status rules as the send itself -- which is not true of the tracking table above it (that view
  // shows admins all published content, while sending stays owner-scoped).
  useEffect(() => {
    if (!composing) return;
    let cancelled = false;
    (async () => {
      setSegLoading(true);
      const params = new URLSearchParams({ cohortId: msgCohort, formId: msgFormId });
      const res = await fetch(`/api/bulk-message?${params}`, { headers: await authHeaders() });
      if (cancelled) return;
      if (res.ok) {
        const json = await res.json();
        setSegCounts(json.counts ?? ZERO_SEGMENTS);
        setComposeForms(json.forms ?? []);
      }
      setSegLoading(false);
    })();
    return () => { cancelled = true; };
  }, [composing, msgCohort, msgFormId, authHeaders]);

  const pageCount  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown  = Math.min(page * PAGE_SIZE, total);

  // A filter can shrink the set under the current page (or content can change between loads).
  useEffect(() => {
    if (!loading && page > pageCount) setPage(pageCount);
  }, [loading, page, pageCount]);

  const applyFilter = (apply: () => void) => { apply(); setPage(1); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ ...filterParams(), all: '1' });
      const res = await fetch(`/api/tracking?${params}`, { headers: await authHeaders() });
      if (!res.ok) { alert('Could not prepare the export. Please try again.'); return; }
      const json = await res.json();
      reportExportCSV(
        ['Student', 'Email', 'Cohort', 'Content', 'Type', 'Progress %', 'Status', 'Last Active', 'Score'],
        (json.rows ?? []).map((r: any) => [
          r.studentName, r.studentEmail, r.cohortName, r.formTitle, r.contentType,
          `${r.progressPct}%`, r.status, lastActiveLabel(r), r.score ?? '--',
        ]),
        'student_tracking.csv'
      );
    } catch {
      alert('Could not prepare the export. Please check your connection.');
    } finally {
      setExporting(false);
    }
  };

  const sendNudge = async (row: any) => {
    const nudgeKey = `${row.studentEmail}|${row.formId}`;
    setNudging(nudgeKey);
    try {
      const res = await fetch('/api/nudge-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        // The server resolves the recipient's name from their record; it does not take one here.
        body: JSON.stringify({
          studentEmail: row.studentEmail,
          formId:       row.formId,
          status:       row.status,
        }),
      });
      if (res.ok) {
        setNudged(prev => new Set([...prev, nudgeKey]));
      } else {
        const json = await res.json().catch(() => ({}));
        alert(json.error || 'Failed to send nudge. Please try again.');
      }
    } catch {
      alert('Failed to send nudge. Please check your connection.');
    } finally {
      setNudging(null);
    }
  };

  const sendBulkMessage = async () => {
    if (!msgSubject.trim() || !msgBody.trim()) return;
    setMsgSending(true);
    setMsgResult(null);
    try {
      const res = await fetch('/api/bulk-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          segment:     msgSegment,
          cohortId:    msgCohort,
          formId:      msgFormId !== 'all' ? msgFormId : undefined,
          subject:     msgSubject,
          messageBody: msgBody,
        }),
      });
      const json = await res.json();
      setMsgResult({ sent: json.sent ?? 0 });
      if (json.sent > 0) { setMsgSubject(''); setMsgBody(''); }
    } finally {
      setMsgSending(false);
    }
  };

  const segmentCount = (seg: string) => (segCounts as any)[seg] ?? 0;

  const chip = (on: boolean) => on ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` };
  const keyOf = (row: any) => `${row.studentEmail}|${row.formId}`;
  // Activity-only rows are visible for reporting, but the content was not assigned to
  // their cohort. Keep the existing messaging boundary: viewing activity does not opt a
  // learner into cohort nudges or bulk communication.
  const canNudge = (row: any) => !row.activityOnly && (row.status === 'not_started' || row.status === 'stalled' || row.status === 'in_progress' || row.status === 'failed');
  const cohortOptions = [{ value: 'all', label: 'All cohorts' }, ...cohorts.map(c => ({ value: c.id, label: c.name }))];

  const kpis = [
    { label: 'Records',     n: stats.total,       sub: 'One per learner and content',  color: C.text },
    { label: 'Not started', n: stats.not_started, sub: 'Assigned, nothing opened',     color: C.text },
    { label: 'In progress', n: stats.in_progress, sub: 'Active in the last 7 days',    color: C.text },
    { label: 'Stalled',     n: stats.stalled,     sub: 'No activity for 7 days',       color: stats.stalled ? P.warn : C.text },
    { label: 'Completed',   n: stats.completed,   sub: 'Finished the content',         color: stats.completed ? P.good : C.text },
    { label: 'At risk',     n: stats.at_risk,     sub: 'Failed, or due within 3 days', color: stats.at_risk ? P.bad : C.text },
  ];

  const deadlineTag = (row: any) => {
    if (!row.deadline || row.status === 'completed') return null;
    const text = row.daysUntilDeadline < 0 ? 'Overdue' : row.daysUntilDeadline === 0 ? 'Due today' : `${row.daysUntilDeadline}d left`;
    return <Pill tone={row.isAtRisk ? (row.daysUntilDeadline < 0 ? 'bad' : 'warn') : 'mute'} C={C}>{text}</Pill>;
  };

  const rowMenu = (row: any) => {
    if (!canNudge(row)) return null;
    const key = keyOf(row);
    const open = menu !== null && keyOf(menu.row) === key;
    return (
      <button type="button" aria-label={`Actions for ${row.studentName || row.studentEmail}`} disabled={nudging === key}
        onClick={(e) => setMenu(open ? null : { row, position: menuPosition(e.currentTarget, 90) })}
        className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
        style={open ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
        {nudging === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
      </button>
    );
  };

  return (
    <div className="space-y-5 pb-12">
      <PageHeader C={C} title="Tracking" sub="How every learner is getting on across your courses, experiences and assignments."
        actions={<>
          <button type="button" onClick={exportCsv} disabled={exporting} className={btnClass} style={btnStyle('sec', C)}>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? 'Preparing...' : 'Export CSV'}
          </button>
          {!isStaff && (
            <button type="button" aria-pressed={composing} onClick={() => { setComposing(v => !v); setMsgResult(null); }} className={btnClass} style={btnStyle('pri', C)}>
              <Send className="w-4 h-4" /> Message learners
            </button>
          )}
        </>} />

      <Kpis C={C} items={kpis} />

      {composing && (
        <Card C={C}>
          <CardHead C={C} title="Message learners" sub="An email to every learner in the group you pick." />
          <div className="p-5 grid gap-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label C={C}>Cohort</Label>
                <MenuSelect field searchable label="Cohort" value={msgCohort} options={cohortOptions} onChange={v => { setMsgCohort(v); setMsgFormId('all'); }} C={C} />
              </div>
              <div>
                <Label C={C}>Content</Label>
                <MenuSelect field searchable label="Content" value={msgFormId} onChange={setMsgFormId} C={C}
                  options={[{ value: 'all', label: 'All content' }, ...composeForms.map(f => ({ value: f.id, label: f.title }))]} />
              </div>
            </div>

            <div>
              <Label C={C}>Send to</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Send to">
                {SEGMENTS.map(s => (
                  <button key={s.key} type="button" aria-pressed={msgSegment === s.key} onClick={() => setMsgSegment(s.key)}
                    className="h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-2" style={chip(msgSegment === s.key)}>
                    {s.label}
                    <span className="tabular-nums" style={{ opacity: 0.8 }}>{segLoading ? '--' : segmentCount(s.key)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label C={C}>Subject</Label>
              <input value={msgSubject} onChange={e => setMsgSubject(e.target.value)} placeholder="For example, A message from the team" className={FIELD} style={inputStyle(C)} />
            </div>

            <div>
              <Label C={C}>Message</Label>
              <textarea value={msgBody} onChange={e => setMsgBody(e.target.value)} rows={5} placeholder="Hi {{name}}, ..." className={`${FIELD} resize-y leading-relaxed`} style={inputStyle(C)} />
              <Hint C={C}>Use {'{{name}}'} to add each learner&apos;s name.</Hint>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={sendBulkMessage} disabled={msgSending || !msgSubject.trim() || !msgBody.trim()} className={btnClass} style={btnStyle('pri', C)}>
                {msgSending || segLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {msgSending ? 'Sending...' : segLoading ? 'Send message' : `Send to ${segmentCount(msgSegment)} student${segmentCount(msgSegment) !== 1 ? 's' : ''}`}
              </button>
              <button type="button" onClick={() => { setComposing(false); setMsgResult(null); }} className={btnClass} style={btnStyle('sec', C)}>Cancel</button>
              {msgResult && (
                <span role="status" className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: P.good }}>
                  <CheckCircle2 className="w-4 h-4" />
                  {msgResult.sent} email{msgResult.sent !== 1 ? 's' : ''} sent
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search learner or content" C={C} />
        <MenuSelect fixed searchable label="Filter by cohort" value={cohortFilter} options={cohortOptions} onChange={v => applyFilter(() => setCohortFilter(v))} C={C} />
        <MenuSelect fixed label="Filter by status" value={statusFilter} options={STATUS_OPTIONS} onChange={v => applyFilter(() => setStatusFilter(v))} C={C} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by content type">
          {TYPE_CHIPS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={typeFilter === id} onClick={() => applyFilter(() => setTypeFilter(id))} className="h-8 px-3 rounded-full text-xs font-semibold" style={chip(typeFilter === id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card C={C} className="overflow-hidden">
        {loading ? (
          <div className="py-12 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }} /></div>
        ) : rows.length === 0 ? (
          <Empty C={C} title={stats.total === 0 ? 'No students assigned to your content yet.' : 'No results match your filters.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr>{['Learner', 'Content', 'Progress', 'Status', 'Last active', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const meta = STATUS_META[row.status] ?? STATUS_META.not_started;
                  return (
                    <tr key={keyOf(row)} style={{ borderTop: `1px solid ${C.divider}` }}>
                      <td className="px-4 py-3 max-w-[260px]">
                        <p className="font-semibold truncate" style={{ color: C.text }}>{row.studentName || '--'}</p>
                        <p className="text-xs truncate" style={{ color: C.muted }}>{row.studentEmail}{row.cohortName ? ` - ${row.cohortName}` : ''}</p>
                      </td>
                      <td className="px-4 py-3 break-words" style={{ color: C.text }}>{row.formTitle}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24"><Bar parts={[{ pct: row.progressPct, color: row.status === 'failed' ? P.bad : P.good }]} C={C} /></div>
                          <span className="text-xs tabular-nums" style={{ color: C.muted }}>{row.progressPct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Pill tone={meta.tone} dot={row.status === 'completed'} C={C}>{meta.label}</Pill></td>
                      <td className="px-4 py-3">
                        <div className="grid gap-1 justify-items-start">
                          <span className="text-xs whitespace-nowrap" style={{ color: C.muted }}>{lastActiveLabel(row)}</span>
                          {deadlineTag(row)}
                        </div>
                      </td>
                      <td className="pl-2 pr-5 py-3 text-right whitespace-nowrap">
                        {nudged.has(keyOf(row))
                          ? <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: P.good }}><Check className="w-3.5 h-3.5" /> Nudged</span>
                          : rowMenu(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs" style={{ color: C.muted }}>Showing {firstShown}-{lastShown} of {total} record{total !== 1 ? 's' : ''}</p>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className={btnSmClass} style={btnStyle('sec', C)}>
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <span className="text-xs min-w-[90px] text-center" style={{ color: C.muted }}>Page {page} of {pageCount}</span>
              <button type="button" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount || loading} className={btnSmClass} style={btnStyle('sec', C)}>
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {menu && (
        <FloatingMenu position={menu.position} label="learner actions" onClose={() => setMenu(null)} C={C}
          items={[{
            label: 'Nudge',
            sub: menu.row.status === 'not_started' ? 'Encourage them to start' : 'Encourage them to continue',
            icon: Send,
            onClick: () => { const row = menu.row; setMenu(null); sendNudge(row); },
          }]} />
      )}
    </div>
  );
}
