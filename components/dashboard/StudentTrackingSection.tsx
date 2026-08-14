'use client';

// Originally extracted verbatim from app/dashboard/page.tsx. The data layer has since moved to the
// server: the table renders one page at a time, and the cohort filter, content type, status filter
// and search box are all query parameters rather than array operations over a full in-memory set.
// The KPI strip and the compose panel's segment counts come back from the API alongside the page,
// because both describe the whole set and cannot be recomputed from the rows on screen.

import { useState, useEffect, useCallback, useContext } from 'react';
import { AlertTriangle, Check, CheckCircle, ChevronLeft, ChevronRight, Clock, Download, Loader2, MinusCircle, Search, Send, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { reportExportCSV } from '@/lib/dashboard-export';
import { IsStaffContext } from '@/components/dashboard/context';
import { LIGHT_C, cardStyle } from '@/lib/theme';

const STATUS_META = {
  not_started: { label: 'Not Started', color: '#6b7280', bg: 'rgba(107,114,128,0.12)', Icon: MinusCircle },
  in_progress:  { label: 'In Progress', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  Icon: Clock },
  stalled:      { label: 'Stalled',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   Icon: AlertTriangle },
  failed:       { label: 'Failed',      color: '#dc2626', bg: 'rgba(220,38,38,0.12)',   Icon: XCircle },
  completed:    { label: 'Completed',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   Icon: CheckCircle },
} as const;

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

const ZERO_STATS    = { total: 0, not_started: 0, in_progress: 0, stalled: 0, failed: 0, completed: 0, at_risk: 0 };
const ZERO_SEGMENTS = { all: 0, not_started: 0, in_progress: 0, stalled: 0, failed: 0, completed: 0 };

const lastActiveLabel = (row: any) => row.lastActive
  ? row.daysSinceActivity === 0 ? 'Today'
    : row.daysSinceActivity === 1 ? 'Yesterday'
    : `${row.daysSinceActivity}d ago`
  : '--';

export function StudentTrackingSection({ C }: { C: typeof LIGHT_C }) {
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

  const sel = { fontSize: 13, padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.cardBorder}`, background: C.input, color: C.text, outline: 'none', cursor: 'pointer' } as React.CSSProperties;
  const pageBtn = (disabled: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 4, padding: '7px 12px', borderRadius: 8, border: 'none',
    background: C.pill, color: disabled ? C.faint : C.text, fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, minHeight: 36,
  } as React.CSSProperties);

  return (
    <div style={{ padding: '0 0 40px' }}>
      <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '16px 20px', borderBottom: `1px solid ${C.divider}` }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>Student Tracking</h2>
          <p style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Monitor student progress across all your content. Flag stalled or inactive learners.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={exportCsv}
            disabled={exporting}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 'none', background: C.pill, color: C.text, fontSize: 13, fontWeight: 600, cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1, transition: 'all 0.15s' }}>
            {exporting
              ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
              : <Download style={{ width: 14, height: 14 }} />}
            {exporting ? 'Preparing...' : 'Export CSV'}
          </button>
          {!isStaff && (
          <button
            onClick={() => { setComposing(v => !v); setMsgResult(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 'none', background: composing ? C.cta : C.pill, color: composing ? C.ctaText : C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
            <Send style={{ width: 14, height: 14 }} />
            Message Segment
          </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 24 }}>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" style={{ marginBottom: 24 }}>
        {([
          { key: 'total',       label: 'Total',       value: stats.total,       color: C.text    },
          { key: 'not_started', label: 'Not Started', value: stats.not_started, color: '#6b7280' },
          { key: 'in_progress', label: 'In Progress', value: stats.in_progress, color: '#f59e0b' },
          { key: 'stalled',     label: 'Stalled',     value: stats.stalled,     color: '#ef4444' },
          { key: 'completed',   label: 'Completed',   value: stats.completed,   color: '#22c55e' },
          { key: 'at_risk',     label: 'At Risk',     value: stats.at_risk,     color: '#dc2626' },
        ] as const).map(s => {
          // Total is not a status -- it clears the filter rather than selecting one. Sending
          // status=total would have asked the API for a status no row can hold, emptying the table.
          const isClearAll = s.key === 'total';
          const active = !isClearAll && statusFilter === s.key;
          return (
            <button key={s.key}
              onClick={() => applyFilter(() => setStatusFilter(isClearAll || active ? 'all' : s.key))}
              className="text-left"
              style={{
                borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.15s',
                border: 'none',
                background: active ? `${s.color}1f` : C.pill,
              }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{s.label}</div>
            </button>
          );
        })}
      </div>

      {/* Compose panel */}
      {composing && (
        <div style={{ background: C.pill, border: 'none', borderRadius: 16, padding: 24, marginBottom: 24 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>Compose Message</p>

          {/* Cohort + Content filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            <div style={{ flex: '1 1 180px' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cohort</p>
              <select value={msgCohort} onChange={e => { setMsgCohort(e.target.value); setMsgFormId('all'); }} style={{ ...sel, width: '100%' }}>
                <option value="all">All Cohorts</option>
                {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Course / Content</p>
              <select value={msgFormId} onChange={e => setMsgFormId(e.target.value)} style={{ ...sel, width: '100%' }}>
                <option value="all">All Content</option>
                {composeForms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
            </div>
          </div>

          {/* Segment selector */}
          <p style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Send to</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {([
              { key: 'not_started', label: 'Not Started', color: '#6b7280' },
              { key: 'in_progress', label: 'In Progress', color: '#f59e0b' },
              { key: 'stalled',     label: 'Stalled',     color: '#ef4444' },
              { key: 'failed',      label: 'Failed',      color: '#dc2626' },
              { key: 'completed',   label: 'Completed',   color: '#22c55e' },
              { key: 'all',         label: 'Everyone',    color: C.cta    },
            ] as const).map(s => {
              const count = segmentCount(s.key);
              const active = msgSegment === s.key;
              return (
                <button key={s.key} onClick={() => setMsgSegment(s.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, border: `1px solid ${active ? s.color : C.cardBorder}`, background: active ? `${s.color}18` : 'transparent', color: active ? s.color : C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {s.label}
                  <span style={{ fontSize: 11, background: active ? s.color : C.divider, color: active ? '#fff' : C.faint, borderRadius: 10, padding: '1px 6px' }}>{segLoading ? '--' : count}</span>
                </button>
              );
            })}
          </div>

          {/* Subject */}
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subject</p>
            <input
              value={msgSubject} onChange={e => setMsgSubject(e.target.value)}
              placeholder="e.g. A message from the team"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input, color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const }}
            />
          </div>

          {/* Body */}
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Message <span style={{ fontWeight: 400, textTransform: 'none' }}>-- use {'{{name}}'} for personalisation</span></p>
            <textarea
              value={msgBody} onChange={e => setMsgBody(e.target.value)}
              rows={5}
              placeholder="Hi {{name}}, ..."
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input, color: C.text, fontSize: 14, outline: 'none', resize: 'vertical', boxSizing: 'border-box' as const, lineHeight: 1.6 }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={sendBulkMessage}
              disabled={msgSending || !msgSubject.trim() || !msgBody.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 10, background: C.cta, color: C.ctaText, fontSize: 14, fontWeight: 700, border: 'none', cursor: msgSending || !msgSubject.trim() || !msgBody.trim() ? 'not-allowed' : 'pointer', opacity: msgSending || !msgSubject.trim() || !msgBody.trim() ? 0.6 : 1 }}>
              {msgSending || segLoading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Send style={{ width: 14, height: 14 }} />}
              {msgSending ? 'Sending...' : segLoading ? 'Send message' : `Send to ${segmentCount(msgSegment)} student${segmentCount(msgSegment) !== 1 ? 's' : ''}`}
            </button>
            <button onClick={() => { setComposing(false); setMsgResult(null); }} style={{ fontSize: 13, color: C.muted, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
            {msgResult && (
              <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>
                <Check style={{ width: 13, height: 13, display: 'inline', marginRight: 4 }} />
                {msgResult.sent} email{msgResult.sent !== 1 ? 's' : ''} sent
              </span>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: C.faint }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search student or content…"
            style={{ ...sel, paddingLeft: 30, width: '100%', boxSizing: 'border-box' as const }}
          />
        </div>
        <select value={cohortFilter} onChange={e => applyFilter(() => setCohortFilter(e.target.value))} style={sel}>
          <option value="all">All Cohorts</option>
          {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={typeFilter} onChange={e => applyFilter(() => setTypeFilter(e.target.value))} style={sel}>
          <option value="all">All Types</option>
          <option value="course">Courses</option>
          <option value="virtual_experience">Virtual Experiences</option>
          <option value="assignment">Assignments</option>
        </select>
        <select value={statusFilter} onChange={e => applyFilter(() => setStatusFilter(e.target.value))} style={sel}>
          <option value="all">All Statuses</option>
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="stalled">Stalled (7+ days)</option>
          <option value="failed">Failed</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {/* Table */}
      <div>
        {/* Table header */}
        <div className="grid grid-cols-[1fr_110px_90px] sm:grid-cols-[1fr_1fr_70px_110px_110px_90px]"
          style={{ gap: 0, padding: '14px 4px', borderBottom: `1px solid ${C.divider}` }}>
          {['Student', 'Content', 'Progress', 'Status', 'Last Active', ''].map((h, i) => (
            <div key={i} className={[1, 2, 4].includes(i) ? 'hidden sm:block' : ''} style={{ fontSize: 10, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Loader2 style={{ width: 24, height: 24, color: C.faint, margin: '0 auto' }} className="animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: C.muted, fontSize: 14 }}>
            {stats.total === 0 ? 'No students assigned to your content yet.' : 'No results match your filters.'}
          </div>
        ) : (
          rows.map((row, i) => {
            const meta = STATUS_META[row.status as keyof typeof STATUS_META];
            const nudgeKey = `${row.studentEmail}|${row.formId}`;
            const isNudged = nudged.has(nudgeKey);
            const canNudge = row.status === 'not_started' || row.status === 'stalled' || row.status === 'in_progress' || row.status === 'failed';
            return (
              <div key={nudgeKey}
                className="grid grid-cols-[1fr_110px_90px] sm:grid-cols-[1fr_1fr_70px_110px_110px_90px]"
                style={{ gap: 0, padding: '14px 4px', borderBottom: i < rows.length - 1 ? `1px solid ${C.divider}` : 'none', alignItems: 'center' }}>
                {/* Student */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.studentName || '--'}</div>
                  <div style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.studentEmail}</div>
                </div>
                {/* Content */}
                <div className="hidden sm:block" style={{ fontSize: 13, color: C.text, paddingRight: 8, wordBreak: 'break-word' }}>{row.formTitle}</div>
                {/* Progress % */}
                <div className="hidden sm:block">
                  <span style={{ fontSize: 13, fontWeight: 700, color: row.status === 'failed' ? '#dc2626' : row.progressPct === 100 ? C.green : row.progressPct > 0 ? '#f59e0b' : C.faint }}>
                    {row.progressPct}%
                  </span>
                </div>
                {/* Status */}
                <div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: meta.bg, color: meta.color, whiteSpace: 'nowrap' }}>
                    <meta.Icon style={{ width: 11, height: 11 }} />
                    {meta.label}
                  </span>
                </div>
                {/* Last Active */}
                <div className="hidden sm:block">
                  <div style={{ fontSize: 12, color: C.faint }}>{lastActiveLabel(row)}</div>
                  {row.deadline && row.status !== 'completed' && (
                    <div style={{ marginTop: 3 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: row.isAtRisk ? (row.daysUntilDeadline < 0 ? '#fef2f2' : '#fffbeb') : C.pill,
                        color: row.isAtRisk ? (row.daysUntilDeadline < 0 ? '#dc2626' : '#b45309') : C.faint,
                        whiteSpace: 'nowrap',
                      }}>
                        {row.daysUntilDeadline < 0 ? '⚠ Overdue'
                          : row.daysUntilDeadline === 0 ? '⚠ Due today'
                          : `${row.daysUntilDeadline}d left`}
                      </span>
                    </div>
                  )}
                </div>
                {/* Nudge */}
                <div>
                  {canNudge && (
                    <button
                      onClick={() => sendNudge(row)}
                      disabled={nudging === nudgeKey || isNudged}
                      title={isNudged ? 'Nudge sent' : row.status === 'not_started' ? 'Encourage to start' : 'Encourage to continue'}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 6, border: `1px solid ${isNudged ? 'rgba(34,197,94,0.3)' : C.cardBorder}`, background: 'transparent', color: isNudged ? '#22c55e' : C.muted, cursor: nudging === nudgeKey || isNudged ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                      {nudging === nudgeKey
                        ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
                        : isNudged
                          ? <Check style={{ width: 11, height: 11 }} />
                          : <Send style={{ width: 11, height: 11 }} />}
                      {isNudged ? 'Sent' : 'Nudge'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {total > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <div style={{ fontSize: 12, color: C.faint }}>
            Showing {firstShown}-{lastShown} of {total} record{total !== 1 ? 's' : ''}
          </div>
          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                style={pageBtn(page <= 1 || loading)}>
                <ChevronLeft style={{ width: 14, height: 14 }} />
                Previous
              </button>
              <span style={{ fontSize: 12, color: C.muted, minWidth: 90, textAlign: 'center' }}>Page {page} of {pageCount}</span>
              <button
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount || loading}
                style={pageBtn(page >= pageCount || loading)}>
                Next
                <ChevronRight style={{ width: 14, height: 14 }} />
              </button>
            </div>
          )}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
