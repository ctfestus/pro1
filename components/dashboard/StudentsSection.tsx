'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect } from 'react';
import { Download, ExternalLink, Eye, MoreVertical, Search, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { reportExportCSV } from '@/lib/dashboard-export';
import { LIGHT_C, DARK_C, cardStyle } from '@/lib/theme';
import { isIndividualCohort } from '@/lib/cohort-kind';

async function dashboardAuthFetch(url: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${session?.access_token}` } });
}

function StudentSubscriptionSummary({ studentId, C }: { studentId: string; C: typeof LIGHT_C }) {
  const [subscription, setSubscription] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dashboardAuthFetch(`/api/payments?action=subscription-status&studentId=${studentId}`)
      .then(async res => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => { if (!ok) throw new Error(data.error || 'Failed to load subscription'); setSubscription(data.subscription ?? null); })
      .catch(err => setError(err.message));
  }, [studentId]);

  return <div className="rounded-xl p-3 mb-5" style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Individual subscription</p>{error ? <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{error}</p> : subscription ? <><p className="text-sm font-semibold mt-1" style={{ color: C.text }}>{subscription.subscription_plans?.name || 'Subscription plan'}</p><p className="text-xs capitalize" style={{ color: C.muted }}>{subscription.status} - expires {fullDate(subscription.current_period_end)}</p></> : <p className="text-sm mt-1" style={{ color: C.muted }}>No subscription</p>}</div><button onClick={() => { window.location.hash = 'subscriptions'; }} className="text-xs font-semibold" style={{ color: C.cta }}>Manage subscriptions</button></div>
  </div>;
}

function CreateIndividualStudent({ onCreated, C }: { onCreated: () => void; C: typeof LIGHT_C }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true); setError('');
    try {
      const res = await dashboardAuthFetch('/api/admissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create-individual-student', fullName, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create student');
      setFullName(''); setEmail(''); setOpen(false); onCreated();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <>
    <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: C.cta, color: C.ctaText }}><UserPlus className="w-3.5 h-3.5"/>Individual student</button>
    {open && <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="w-full max-w-md rounded-xl p-5 space-y-3" style={{ background: C.card }}>
        <div className="flex justify-between"><div><p className="font-semibold" style={{ color: C.text }}>Create individual student</p><p className="text-xs" style={{ color: C.muted }}>No bootcamp cohort is required.</p></div><button onClick={() => setOpen(false)}><X className="w-4 h-4" style={{ color: C.muted }}/></button></div>
        <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: C.input, color: C.text }}/>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: C.input, color: C.text }}/>
        {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}
        <button onClick={create} disabled={busy || !email.trim()} className="w-full py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy ? 'Creating...' : 'Create and send setup email'}</button>
      </div>
    </div>}
  </>;
}

function shortDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Never';
}

function fullDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function accessInfo(student: any, C: typeof LIGHT_C) {
  if (student.last_login_at) {
    return { label: 'Signed in', at: student.last_login_at, color: C.green, bg: `${C.green}18` };
  }
  if (student.onboarding_done) {
    return { label: 'Onboarded', at: student.onboarding_completed_at, color: '#2563eb', bg: 'rgba(37,99,235,0.12)' };
  }
  if (student.password_set_at) {
    return { label: 'Password set', at: student.password_set_at, color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' };
  }
  if (student.password_setup_started_at) {
    return { label: 'Link opened', at: student.password_setup_started_at, color: '#d97706', bg: 'rgba(245,158,11,0.16)' };
  }
  if (student.setup_email_sent_at) {
    return { label: 'Email sent', at: student.setup_email_sent_at, color: '#0284c7', bg: 'rgba(14,165,233,0.14)' };
  }
  if (student.account_provisioned_at) {
    return { label: 'Created', at: student.account_provisioned_at, color: C.muted, bg: C.pill };
  }
  return { label: 'Not started', at: null, color: C.faint, bg: C.pill };
}

function StudentDetailPanel({ student, cohortName, detail, loading, onClose, C }: {
  student: any; cohortName: string; detail: any; loading: boolean; onClose: () => void; C: typeof LIGHT_C;
}) {
  const statusColor = (s: string) => s === 'completed' ? C.green : s === 'in_progress' ? '#f59e0b' : C.faint;
  const statusLabel = (s: string) => s === 'completed' ? 'Completed' : s === 'in_progress' ? 'In Progress' : 'Not Started';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg h-full overflow-y-auto flex flex-col"
        style={{ background: C.card, boxShadow: '-4px 0 32px rgba(0,0,0,0.22)' }}>
        <div className="p-5 flex items-start justify-between" style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
          <div>
            <p className="text-base font-bold" style={{ color: C.text }}>{student.full_name || 'No name'}</p>
            <p className="text-sm" style={{ color: C.muted }}>{student.email}</p>
            <p className="text-xs mt-0.5" style={{ color: C.faint }}>Cohort: {cohortName || 'None'}</p>
          </div>
          <button onClick={onClose} style={{ color: C.faint }}><X className="w-5 h-5"/></button>
        </div>

        <div className="p-5">
          <a href={`/student?viewAs=${student.id}`} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full text-sm font-semibold py-2.5 rounded-lg mb-5"
            style={{ background: C.cta, color: C.ctaText }}>
            <ExternalLink className="w-4 h-4"/>
            Open Student Dashboard
          </a>

          <StudentSubscriptionSummary studentId={student.id} C={C} />

          <div className="rounded-xl p-3 mb-5" style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Account setup</p>
            {[
              ['Account created', student.account_provisioned_at],
              ['Setup email sent', student.setup_email_sent_at],
              ['Setup link opened', student.password_setup_started_at],
              ['Password set', student.password_set_at],
              ['Onboarding complete', student.onboarding_completed_at],
              ['Last login', student.last_login_at],
            ].map(([label, value]) => (
              <div key={label as string} className="flex items-center justify-between gap-3 py-1">
                <span className="text-xs" style={{ color: C.muted }}>{label}</span>
                <span className="text-xs font-medium text-right" style={{ color: value ? C.text : C.faint }}>{fullDate(value as string | null)}</span>
              </div>
            ))}
          </div>

          {loading && <p className="text-sm text-center py-8" style={{ color: C.muted }}>Loading...</p>}

          {!loading && detail && (
            <div className="space-y-5">
              {/* Courses */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
                  Courses ({detail.courses?.length ?? 0})
                </p>
                {(detail.courses ?? []).length === 0 && (
                  <p className="text-sm" style={{ color: C.muted }}>No courses in cohort</p>
                )}
                {(detail.courses ?? []).map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between py-2"
                    style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: C.text }}>{c.title}</p>
                      {c.score != null && (
                        <p className="text-xs" style={{ color: C.faint }}>Score: {c.score}%</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      {c.hasCert && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: `${C.green}18`, color: C.green }}>Cert</span>
                      )}
                      <span className="text-xs font-semibold" style={{ color: statusColor(c.status) }}>
                        {statusLabel(c.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Assignments */}
              {(detail.assignments ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
                    Assignments ({detail.assignments.length})
                  </p>
                  {detail.assignments.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between py-2"
                      style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                      <p className="text-sm font-medium truncate min-w-0" style={{ color: C.text }}>{a.title}</p>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        {a.score != null && (
                          <span className="text-xs" style={{ color: C.faint }}>{a.score}%</span>
                        )}
                        <span className="text-xs font-semibold" style={{ color: statusColor(a.status === 'submitted' || a.status === 'graded' ? 'completed' : a.status) }}>
                          {a.status === 'not_started' ? 'Not Started' : a.status === 'draft' ? 'Draft' : a.status === 'submitted' ? 'Submitted' : 'Graded'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Virtual Experiences */}
              {(detail.ves ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
                    Virtual Experiences ({detail.ves.length})
                  </p>
                  {detail.ves.map((v: any) => (
                    <div key={v.id} className="flex items-center justify-between py-2"
                      style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
                      <p className="text-sm font-medium truncate min-w-0" style={{ color: C.text }}>{v.title}</p>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        <span className="text-xs tabular-nums" style={{ color: C.faint }}>{v.progressPct}%</span>
                        <span className="text-xs font-semibold" style={{ color: statusColor(v.status) }}>
                          {statusLabel(v.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function StudentsSection({ C }: { C: typeof LIGHT_C }) {
  const isDark = C === DARK_C;
  const [students,        setStudents]        = useState<any[]>([]);
  const [cohorts,         setCohorts]         = useState<any[]>([]);
  const [courseCounts,    setCourseCounts]    = useState<Record<string, number>>({});
  const [completedCounts, setCompletedCounts] = useState<Record<string, number>>({});
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filterCohort, setFilterCohort] = useState('');
  const [selected,     setSelected]     = useState<any>(null);
  const [detail,       setDetail]       = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [menuRow,      setMenuRow]      = useState<any | null>(null);
  const [menuPos,      setMenuPos]      = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const [{ data: stu }, { data: coh }, statsRes] = await Promise.all([
      supabase
        .from('students')
        .select('id, full_name, email, cohort_id, enrollment_model, onboarding_done, account_provisioned_at, setup_email_sent_at, password_setup_started_at, password_set_at, onboarding_completed_at, last_login_at')
        .eq('role', 'student')
        .order('full_name'),
      supabase.from('cohorts').select('id, name, cohort_kind'),
      fetch('/api/admin/students-stats', { headers: { Authorization: `Bearer ${session?.access_token}` } }),
    ]);
    const stats = statsRes.ok ? await statsRes.json() : { completedCount: {}, cohortContentCount: {} };
    setStudents(stu ?? []);
    setCohorts(coh ?? []);
    setCourseCounts(stats.cohortContentCount ?? {});
    setCompletedCounts(stats.completedCount ?? {});
    setLoading(false);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const cohortMap = Object.fromEntries(cohorts.map(c => [c.id, c.name]));

  const visible = students.filter(s => {
    const q = search.toLowerCase();
    return (!q || (s.full_name ?? '').toLowerCase().includes(q) || (s.email ?? '').toLowerCase().includes(q))
      && (!filterCohort || s.cohort_id === filterCohort);
  });

  async function openDetail(student: any) {
    setSelected(student);
    setDetail(null);
    setDetailLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const res = await fetch(`/api/admin/student-detail?studentId=${student.id}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) setDetail(await res.json());
    } catch { /* ignore */ }
    setDetailLoading(false);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <div>
            <h2 className="text-lg font-bold leading-none" style={{ color: C.text }}>Students</h2>
            <p className="text-xs mt-1.5" style={{ color: C.muted }}>
              {students.length} student{students.length !== 1 ? 's' : ''} across {cohorts.filter(cohort => !isIndividualCohort(cohort.cohort_kind)).length} bootcamp cohort{cohorts.filter(cohort => !isIndividualCohort(cohort.cohort_kind)).length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
          <CreateIndividualStudent onCreated={load} C={C}/>
          <button
            onClick={() => reportExportCSV(
              ['Name', 'Email', 'Cohort', 'Access Status', 'Account Created', 'Setup Email Sent', 'Setup Link Opened', 'Password Set', 'Onboarding Complete', 'Last Login', 'Content in Cohort', 'Completed'],
              visible.map(s => {
                const access = accessInfo(s, C);
                return [
                  s.full_name || '',
                  s.email || '',
                  cohortMap[s.cohort_id] || '',
                  access.label,
                  fullDate(s.account_provisioned_at),
                  fullDate(s.setup_email_sent_at),
                  fullDate(s.password_setup_started_at),
                  fullDate(s.password_set_at),
                  fullDate(s.onboarding_completed_at),
                  fullDate(s.last_login_at),
                  s.cohort_id ? (courseCounts[s.cohort_id] ?? 0) : '',
                  completedCounts[s.id] ?? 0,
                ];
              }),
              'students.csv',
            )}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold flex-shrink-0 transition-opacity hover:opacity-80"
            style={{ background: C.pill, color: C.text }}>
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: C.faint }}/>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search name or email..."
                className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
            </div>
            <select value={filterCohort} onChange={e => setFilterCohort(e.target.value)}
              className="px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}>
              <option value="">All Cohorts</option>
              {cohorts.filter(c => !isIndividualCohort(c.cohort_kind)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Clean table -- borderless, header divider + row hairlines */}
          <div className="overflow-x-auto">
            <div className="grid gap-3 px-4 py-3.5 text-[10px] font-semibold uppercase tracking-[0.07em] grid-cols-[1fr_auto] sm:grid-cols-[2fr_1.3fr_110px_80px_90px_90px_48px]"
              style={{ color: C.faint, borderBottom: `1px solid ${C.divider}` }}>
              <span>Student</span>
              <span className="hidden sm:inline">Cohort</span>
              <span className="hidden sm:inline">Access</span>
              <span className="hidden sm:block text-center">In Cohort</span>
              <span className="hidden sm:block text-center">Completed</span>
              <span className="hidden sm:inline">Last Login</span>
              <span></span>
            </div>

            {loading ? (
              <div className="py-12 text-center text-sm" style={{ color: C.muted }}>Loading students...</div>
            ) : visible.length === 0 ? (
              <div className="py-12 text-center text-sm" style={{ color: C.muted }}>No students found</div>
            ) : visible.map((s, i) => {
              const access = accessInfo(s, C);
              return (
                <div key={s.id} className="grid gap-3 px-4 py-3.5 items-center grid-cols-[1fr_auto] sm:grid-cols-[2fr_1.3fr_110px_80px_90px_90px_48px]"
                  style={{ borderBottom: i < visible.length - 1 ? `1px solid ${C.divider}` : 'none' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{s.full_name || 'No name'}</p>
                    <p className="text-xs truncate" style={{ color: C.muted }}>{s.email}</p>
                  </div>
                  <span className="hidden sm:block text-sm truncate" style={{ color: C.muted }}>{cohortMap[s.cohort_id] || '--'}</span>
                  <span className="hidden sm:flex flex-col items-start gap-0.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: access.bg, color: access.color }}>{access.label}</span>
                    <span className="text-[10px]" style={{ color: C.faint }}>{access.at ? shortDate(access.at) : ''}</span>
                  </span>
                  <span className="hidden sm:block text-sm tabular-nums text-center" style={{ color: C.text }}>{s.cohort_id ? (courseCounts[s.cohort_id] ?? 0) : '--'}</span>
                  <span className="hidden sm:block text-sm tabular-nums font-semibold text-center" style={{ color: C.green }}>{completedCounts[s.id] ?? 0}</span>
                  <span className="hidden sm:block text-xs" style={{ color: C.faint }}>{shortDate(s.last_login_at)}</span>
                  <div className="flex justify-end">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (menuRow?.id === s.id) { setMenuRow(null); setMenuPos(null); }
                        else {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const right = Math.max(8, window.innerWidth - rect.right);
                          if (window.innerHeight - rect.bottom >= 130) setMenuPos({ top: rect.bottom + 4, right });
                          else setMenuPos({ bottom: window.innerHeight - rect.top + 4, right });
                          setMenuRow(s);
                        }
                      }}
                      className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
                      style={{ color: C.muted, background: menuRow?.id === s.id ? C.pill : 'transparent' }}>
                      <MoreVertical className="w-4 h-4"/>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row action menu */}
      {menuRow && menuPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setMenuRow(null); setMenuPos(null); }}/>
          <div className="fixed z-50 w-44 rounded-lg py-1.5"
            style={{ top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.35)' : '0 12px 32px rgba(0,0,0,0.16)' }}
            onClick={e => e.stopPropagation()}>
            <button onClick={() => { const st = menuRow; setMenuRow(null); setMenuPos(null); openDetail(st); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70" style={{ color: C.text }}>
              <Eye className="w-3.5 h-3.5 flex-shrink-0"/> View details
            </button>
            <a href={`/student?viewAs=${menuRow.id}`} target="_blank" rel="noreferrer"
              onClick={() => { setMenuRow(null); setMenuPos(null); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70" style={{ color: C.text }}>
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0"/> Login as student
            </a>
          </div>
        </>
      )}

      {selected && (
        <StudentDetailPanel
          student={selected}
          cohortName={cohortMap[selected.cohort_id] || ''}
          detail={detail}
          loading={detailLoading}
          onClose={() => setSelected(null)}
          C={C}
        />
      )}
    </div>
  );
}
