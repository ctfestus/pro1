'use client';

import { PublicRegistrationsCard } from '@/components/dashboard/PublicRegistrationsCard';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { exportContent } from '@/lib/dashboard-export';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2, ArrowLeft, Download, CheckCircle2, XCircle, Users, Trophy, TrendingUp, BarChart3, Settings, Copy, Check, AlignLeft, Mail, Send, Bell, Sun, Moon, X, ChevronDown, ChevronRight, Eye,
  ExternalLink, Pencil,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { Bar as SharedBar, Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette, type Tone } from '@/components/dashboard/subscriptions/ui';
import { Kpis } from '@/components/dashboard/content/kit';
import { MenuSelect } from '@/components/MenuSelect';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import FormEditor from '@/components/FormEditor';
import { useTheme } from '@/components/ThemeProvider';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { veProgressPct, veCompletionCounts } from '@/lib/ve-completion';
import { courseProgressCounts, courseProgressPct } from '@/lib/course-progress';
import { ReviewReportView, LegacyReviewSummary, REVIEW_TYPES, REVIEW_LABELS } from '@/components/ReviewReportView';
import { parseReviewNotes } from '@/lib/reviewRecord';
import VeFileReportEditor from '@/components/dashboard/VeFileReportEditor';
import { repairVeSubmissionUrl } from '@/lib/ve-upload';
import { sameReportContent, type InstructorReportDraft } from '@/lib/ve-instructor-report';
import { pointsSystemFromCourseRow } from '@/lib/course-schema';
import { contentPath } from '@/lib/content-link';
import { RichTextEditor } from '@/components/RichTextEditor';
import { IMG_EMAIL_BANNER, resolveImageUrl } from '@/lib/cloudinary-url';

// -- Lazy charts ---
const ResponsesOverTimeChart = dynamic(
  () => import('@/components/InsightCharts').then(m => ({ default: m.ResponsesOverTimeChart })),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center"><Loader2 className="w-5 h-5 text-zinc-600 animate-spin" /></div> }
);

const PAGE_SIZE = 50;


type TabId = 'responses' | 'settings' | 'more' | 'email' | 'leaderboard';

const TABS: { id: TabId; label: string; Icon: any; courseOnly?: boolean }[] = [
  { id: 'settings',     label: 'Settings',     Icon: Settings                       },
  { id: 'responses',    label: 'Responses',    Icon: BarChart3                      },
  { id: 'leaderboard',  label: 'Leaderboard',  Icon: Trophy,   courseOnly: true     },
  { id: 'email',        label: 'Email',        Icon: Mail                           },
  { id: 'more',         label: 'Publish',      Icon: Send                           },
];

function getFormType(config: any): 'course' | 'event' | 'form' | 'virtual_experience' {
  if (config?.isVirtualExperience || config?.isGuidedProject) return 'virtual_experience';
  if (config?.isCourse) return 'course';
  if (config?.eventDetails?.isEvent) return 'event';
  return 'form';
}


const COURSE_THEME_ACCENTS: Record<string, string> = {
  forest: '#00bf63',
  lime: '#ADEE66',
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  ocean: '#3E93FF',
};

// -- Helpers ---
function useCopy(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), timeout);
  }, [timeout]);
  return { copied, copy };
}

// -- Responses Tab ---
function ResponsesTab({
  form, responses, totalCount, page, pageLoading,
  onExport, onPageChange, courseProgress, cohortStudents, linkedInShares = [],
}: {
  form: any; responses: any[]; totalCount: number; page: number; pageLoading: boolean;
  onExport: () => void; onPageChange: (p: number) => void; courseProgress: any[]; cohortStudents: any[];
  linkedInShares?: any[];
}) {
  const { theme } = useTheme();
  const isDark = theme !== 'light';
  // Public registrations (migration 244) take seats too; PublicRegistrationsCard reports how many.
  const [publicCount, setPublicCount] = useState(0);
  const card = isDark ? 'bg-zinc-900/35 border-zinc-800/60' : 'bg-white border-[rgba(0,0,0,0.07)]';
  const cardHeader = isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]';
  const dividerCls = isDark ? 'divide-zinc-800/50' : 'divide-[rgba(0,0,0,0.05)]';
  const textPrim = isDark ? 'text-white' : 'text-[#111]';
  const textMut = isDark ? 'text-zinc-500' : 'text-[#888]';
  const textSub = isDark ? 'text-zinc-300' : 'text-[#555]';
  const tableHead = isDark ? 'bg-zinc-950 text-zinc-400 border-zinc-800' : 'bg-[#f5f6f7] text-[#888] border-[rgba(0,0,0,0.06)]';
  const tableRow = isDark ? 'hover:bg-zinc-800/20' : 'hover:bg-[#f5f6f7]';
  const isCourse = form.config?.isCourse;
  const isEvent = form.config?.eventDetails?.isEvent;
  const courseAccent = form.config?.customAccent || COURSE_THEME_ACCENTS[form.config?.theme] || '#00bf63';
  const [selectedResponse, setSelectedResponse] = useState<any | null>(null);
  const [eventAttendance, setEventAttendance] = useState<any[]>([]);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [reviewStudent, setReviewStudent] = useState<any | null>(null);
  const [learnerFilter, setLearnerFilter] = useState<'all' | 'passed' | 'failed' | 'in_progress' | 'not_started'>('all');
  const [learnerSearch, setLearnerSearch] = useState('');
  const [shares, setShares] = useState<any[]>(linkedInShares);
  useEffect(() => { setShares(linkedInShares); }, [linkedInShares]);

  useEffect(() => {
    if (!isEvent || !form.id) return;
    supabase
      .from('live_attendance')
      .select('student_id, session_date, joined_at, student:students(full_name, email)')
      .eq('event_id', form.id)
      .order('session_date', { ascending: false })
      .then(({ data }) => setEventAttendance(data ?? []));
  }, [isEvent, form.id]);

  const configuredFields = form.config?.fields ?? [];
  const resolveResponseValue = (response: any, matcher: (key: string, field: any) => boolean) => {
    const data = response?.data || {};
    for (const [key, value] of Object.entries(data)) {
      const field = configuredFields.find((f: any) => f?.name === key || f?.id === key);
      if (matcher(String(key), field) && value !== null && value !== undefined && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return '';
  };
  const getResponseName = (response: any) => {
    const fullName =
      resolveResponseValue(response, (key, field) => {
        const normalizedKey = key.toLowerCase();
        const label = String(field?.label || '').toLowerCase();
        return (
          normalizedKey === 'name' ||
          normalizedKey === 'full_name' ||
          normalizedKey === 'fullname' ||
          label === 'name' ||
          label === 'full name'
        );
      }) ||
      resolveResponseValue(response, (key, field) => {
        const normalizedKey = key.toLowerCase();
        const label = String(field?.label || '').toLowerCase();
        return (
          (normalizedKey.includes('full') && normalizedKey.includes('name')) ||
          (label.includes('full') && label.includes('name'))
        );
      });

    if (fullName) return fullName;

    return (
      resolveResponseValue(response, (key, field) => {
        const normalizedKey = key.toLowerCase();
        const label = String(field?.label || '').toLowerCase();
        return (
          normalizedKey === 'first_name' ||
          normalizedKey === 'firstname' ||
          label === 'first name' ||
          (label.includes('first') && label.includes('name'))
        );
      }) ||
      'Anonymous'
    );
  };
  const getResponseEmail = (response: any) =>
    resolveResponseValue(response, (key, field) => {
      const normalizedKey = key.toLowerCase();
      const label = String(field?.label || '').toLowerCase();
      return normalizedKey === 'email' || normalizedKey.includes('email') || label === 'email' || label.includes('email');
    }) || '--';

  const formatFieldLabel = (key: string) =>
    key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, char => char.toUpperCase());

  if (isCourse) {
    const questions = form.config?.questions || [];
    const reviewQuestions = questions.filter((q: any) => REVIEW_TYPES.includes(q.type));
    const hasReview = reviewQuestions.length > 0;
    const completedAttempts = courseProgress.filter((p: any) => p.completed);
    const passedAttempts = completedAttempts.filter((p: any) => p.passed);
    const passRate = completedAttempts.length ? Math.round((passedAttempts.length / completedAttempts.length) * 100) : 0;
    const avgScore = completedAttempts.length
      ? Math.round(completedAttempts.reduce((sum: number, p: any) => sum + (p.score ?? 0), 0) / completedAttempts.length)
      : null;
    const topScore = completedAttempts.length ? Math.max(...completedAttempts.map((p: any) => p.score ?? 0)) : 0;

    // Learners: finished (best attempt), in progress, and cohort members who have not started.
    const completedByEmail = new Map<string, any>();
    for (const p of completedAttempts) {
      const key = (p.student_email || '').trim().toLowerCase();
      if (key) completedByEmail.set(key, p);
    }
    const inProgressStudents = courseProgress.filter(p => {
      const key = (p.student_email || '').trim().toLowerCase();
      return key && !p.completed && !completedByEmail.has(key);
    });
    const inProgressEmails = new Set(inProgressStudents.map((p: any) => (p.student_email || '').trim().toLowerCase()));
    const notStartedStudents = (cohortStudents || []).filter(s => {
      const key = (s.email || '').trim().toLowerCase();
      return key && !completedByEmail.has(key) && !inProgressEmails.has(key);
    });
    const startedCount = completedByEmail.size + inProgressStudents.length;

    type LearnerStatus = 'passed' | 'failed' | 'in_progress' | 'not_started';
    const learners: { key: string; name: string; email: string; status: LearnerStatus; pct: number; detail: string; updatedAt?: string; progress?: any }[] = [
      ...[...completedByEmail.values()].map((p: any) => ({
        key: `cp_${p.student_email}`, name: p.student_name, email: p.student_email, status: (p.passed ? 'passed' : 'failed') as LearnerStatus,
        pct: p.score ?? 0, detail: `${p.score ?? 0}%`, updatedAt: p.updated_at, progress: p,
      })).sort((a, b) => (a.status === b.status ? b.pct - a.pct : a.status === 'passed' ? -1 : 1)),
      ...inProgressStudents.map((p: any) => {
        // Shared rule: counts what this learner has done, ignoring module headings.
        const counts = courseProgressCounts(questions, p.answers ?? {});
        return { key: `ip_${p.student_email}`, name: p.student_name, email: p.student_email, status: 'in_progress' as LearnerStatus,
          pct: courseProgressPct(questions, p.answers ?? {}), detail: `Item ${counts.done} of ${counts.total}`, updatedAt: p.updated_at, progress: p };
      }),
      ...notStartedStudents.map((s: any) => ({ key: `ns_${s.id}`, name: s.full_name, email: s.email, status: 'not_started' as LearnerStatus, pct: 0, detail: 'Not started' })),
    ];
    const counts: Record<LearnerStatus, number> = { passed: 0, failed: 0, in_progress: 0, not_started: 0 };
    for (const l of learners) counts[l.status] += 1;

    // The dashboard colours (with the shared blue) for the tiles, pills and chips.
    const PC = isDark ? DARK_C : { ...LIGHT_C, cta: DARK_C.cta };
    const P = palette(PC);
    const statusLook: Record<LearnerStatus, { label: string; tone: Tone; color: string }> = {
      passed: { label: 'Passed', tone: 'good', color: P.good }, failed: { label: 'Failed', tone: 'bad', color: P.bad },
      in_progress: { label: 'In progress', tone: 'warn', color: P.warn }, not_started: { label: 'Not started', tone: 'mute', color: PC.faint },
    };
    const term = learnerSearch.trim().toLowerCase();
    const shown = (learnerFilter === 'all' ? learners : learners.filter(l => l.status === learnerFilter))
      .filter(l => !term || `${l.name ?? ''} ${l.email ?? ''}`.toLowerCase().includes(term));
    const best = completedAttempts.length ? completedAttempts.reduce((a: any, b: any) => ((b.score ?? 0) > (a.score ?? 0) ? b : a)) : null;
    const none = 'No finished attempts yet';
    const lastActive = (d?: string) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

    return (
      <div className="space-y-4">
        <Kpis C={PC} items={[
          { label: 'Learners', n: learners.length, color: PC.text,
            sub: startedCount ? `${startedCount} started, ${counts.not_started} not started` : 'None started yet' },
          { label: 'Average score', n: `${avgScore ?? 0}%`, color: PC.text, sub: completedAttempts.length ? 'Across finished attempts' : none },
          { label: 'Pass rate', n: `${completedAttempts.length ? passRate : 0}%`, color: PC.text,
            sub: completedAttempts.length ? `${passedAttempts.length} of ${completedAttempts.length} finished passed` : none },
          { label: 'Top score', n: `${completedAttempts.length ? topScore : 0}%`, color: completedAttempts.length ? P.good : PC.text,
            sub: best ? (best.student_name || best.student_email || '') : none },
        ]} />

        {/* LinkedIn shares -- post URLs are only pattern-checked, so spot-check them by hand. */}
        {shares.length > 0 && (
          <Card C={PC} className="overflow-hidden">
            <div className="px-5 py-4" style={{ borderBottom: `1px solid ${PC.divider}` }}>
              <h3 className="flex items-center gap-2 text-base font-semibold" style={{ color: PC.text }}>
                <LinkedInIcon className="w-4 h-4" style={{ color: '#0A66C2' }} /> LinkedIn shares
              </h3>
              <p className="mt-1 text-xs" style={{ color: PC.muted }}>
                Each link was checked when submitted: a real LinkedIn post URL, naming the profile saved
                on that student&apos;s account, and not already claimed. That is a consistency check and a
                deterrent, not proof the LinkedIn account belongs to them, and it says nothing about
                whether the post is still live.
              </p>
            </div>
            {shares.map((s: any, i: number) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3" style={i ? { borderTop: `1px solid ${PC.divider}` } : undefined}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" style={{ color: PC.text }}>{s.studentName || s.studentEmail || 'Unknown'}</p>
                  <a href={s.postUrl} target="_blank" rel="noreferrer" className="break-all text-xs hover:underline" style={{ color: PC.muted }}>{s.postUrl}</a>
                </div>
                <span className="flex-shrink-0 text-xs font-semibold" style={{ color: PC.muted }}>{s.points > 0 ? `${s.points} XP` : 'Recorded'}</span>
              </div>
            ))}
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <h3 className="text-base font-semibold" style={{ color: PC.text }}>Learners</h3>
          <button type="button" onClick={onExport} className={btnSmClass} style={btnStyle('sec', PC)}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
        {learners.length > 0 && (
          <>
            <div className="flex"><SearchBox value={learnerSearch} onChange={setLearnerSearch} placeholder="Search learners" C={PC} /></div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter learners">
              {([['all', 'All', learners.length], ['passed', 'Passed', counts.passed], ['failed', 'Failed', counts.failed],
                 ['in_progress', 'In progress', counts.in_progress], ['not_started', 'Not started', counts.not_started]] as const).map(([key, label, n]) => {
                const on = learnerFilter === key;
                return (
                  <button key={key} type="button" onClick={() => setLearnerFilter(key)} aria-pressed={on} className="h-8 px-3 rounded-full text-xs font-semibold"
                    style={on ? { background: P.sel, color: P.onSel } : { background: PC.card, color: PC.muted, boxShadow: `inset 0 0 0 1px ${PC.divider}` }}>
                    {label} {n}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <Card C={PC} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed text-left text-sm">
              <colgroup><col style={{ width: hasReview ? '30%' : '34%' }} /><col style={{ width: '18%' }} /><col style={{ width: hasReview ? '26%' : '30%' }} /><col style={{ width: '14%' }} />{hasReview && <col style={{ width: '12%' }} />}</colgroup>
              <thead>
                <tr className="text-xs" style={{ color: PC.faint }}>
                  <th className="px-4 py-3 font-semibold">Learner</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Score or progress</th>
                  <th className="px-4 py-3 font-semibold">Last active</th>
                  {hasReview && <th className="px-4 py-3 font-semibold">Reviews</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map(l => {
                  const look = statusLook[l.status];
                  const submittedDocs = l.progress ? reviewQuestions.filter((q: any) => {
                    const ans = l.progress.answers?.[q.id];
                    return ans === 'completed' || ans === 'failed';
                  }) : [];
                  return (
                    <tr key={l.key} style={{ borderTop: `1px solid ${PC.divider}` }}>
                      <td className="px-4 py-3">
                        <p className="truncate font-semibold" style={{ color: PC.text }}>{l.name || 'Unknown'}</p>
                        <p className="truncate text-xs" style={{ color: PC.muted }}>{l.email || ''}</p>
                      </td>
                      <td className="px-4 py-3"><Pill tone={look.tone} dot={l.status !== 'not_started'} C={PC}>{look.label}</Pill></td>
                      <td className="px-4 py-3">
                        <p className="mb-1.5 text-xs" style={{ color: PC.text }}>{l.detail}</p>
                        <SharedBar parts={[{ pct: l.pct, color: look.color }]} C={PC} />
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: PC.muted }}>{lastActive(l.updatedAt)}</td>
                      {hasReview && (
                        <td className="px-4 py-3">
                          {submittedDocs.length > 0 && (
                            <button type="button" onClick={() => setReviewStudent({ ...l.progress, reviewQs: reviewQuestions })} className={btnSmClass} style={btnStyle('sec', PC)}>
                              View {submittedDocs.length}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={hasReview ? 5 : 4} className="px-4 py-10 text-center text-sm" style={{ color: PC.muted, borderTop: `1px solid ${PC.divider}` }}>
                    {learners.length === 0 ? 'No learners yet. Share the course link to get started.' : term ? 'No learners match.' : 'No learners in this group.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

      {/* Document review modal */}
      {reviewStudent && (() => {
        const s = reviewStudent;
        const docQs: any[] = s.reviewQs ?? [];
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setReviewStudent(null)}>
            <div className={`rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-[rgba(0,0,0,0.08)]'}`} onClick={e => e.stopPropagation()}>
              <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]'}`}>
                <div>
                  <h3 className={`text-base font-semibold ${textPrim}`}>{s.student_name || s.student_email || 'Student'}</h3>
                  {s.student_name && <p className={`text-xs mt-0.5 ${textMut}`}>{s.student_email}</p>}
                </div>
                <button onClick={() => setReviewStudent(null)} className={textMut}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                {docQs.map((q: any) => {
                  const ans = s.answers?.[q.id];
                  if (ans !== 'completed' && ans !== 'failed') return null;
                  let rec: any = null;
                  try { rec = JSON.parse(s.answers?.[`__review_${q.id}`] ?? ''); } catch {}
                  const mode = rec?.documentReviewMode ?? q.documentReviewMode ?? 'ai_only';
                  return (
                    <div key={q.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className={`text-sm font-semibold ${textPrim}`}>{q.question || REVIEW_LABELS[q.type] || 'AI Review'}</p>
                        {ans === 'failed' && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>Below minimum</span>
                        )}
                      </div>
                      {rec?.report
                        ? <ReviewReportView rec={{ ...rec, type: rec.type ?? q.type }} isDark={isDark} />
                        : mode === 'manual'
                          ? <div className={`rounded-xl px-4 py-3 border ${isDark ? 'border-zinc-700 bg-zinc-800/50' : 'border-[rgba(0,0,0,0.06)] bg-[#f8f8f5]'}`}><span className={`text-xs ${textMut}`}>Submitted for instructor review.</span></div>
                          : <LegacyReviewSummary lean={rec} isDark={isDark} textPrim={textPrim} textMut={textMut} />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      </div>
    );
  }

  // Event responses
  if (isEvent) {
    const capacity = Number(form.config?.eventDetails?.capacity) || 0;
    const isPublicEvent = form.public_registration === true;
    const seatsTaken = totalCount + (isPublicEvent ? publicCount : 0);
    const fillPercent = capacity > 0 ? Math.min(100, Math.round((seatsTaken / capacity) * 100)) : 100;
    const progressWidth = seatsTaken > 0 ? Math.max(fillPercent, 8) : 0;
    const participantRows = responses.map((r: any) => ({
      ...r,
      participantName: getResponseName(r),
      participantEmail: getResponseEmail(r),
      submittedDate: new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      submittedDateFull: new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
    }));
    const responseEntries = selectedResponse
      ? Object.entries(selectedResponse.data || {}).filter(([key, value]) => key !== 'email' && value !== null && value !== undefined && value !== '')
      : [];
    const spotsLeft = capacity > 0 ? Math.max(capacity - seatsTaken, 0) : null;
    const attendedCount = new Set(eventAttendance.map((a: any) => String(a.student_id))).size;

    return (
      <>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`text-sm ${textSub}`}>{capacity > 0 ? `${seatsTaken} registered of ${capacity} places` : `${seatsTaken} registered`}</p>
            <button onClick={onExport} className={`inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-70 ${textPrim}`}
              style={{ background: isDark ? 'rgba(255,255,255,0.055)' : '#F4F6F9' }}>
              <Download className="w-3.5 h-3.5" /> Export participants
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Registered', value: seatsTaken },
              { label: 'Capacity',   value: capacity > 0 ? capacity : 'No limit' },
              { label: 'Remaining',  value: spotsLeft !== null ? spotsLeft : '--' },
              { label: 'Attended',   value: attendedCount },
            ].map(t => (
              <div key={t.label} className="rounded-xl p-4" style={{ background: isDark ? 'rgba(255,255,255,0.055)' : '#F4F6F9' }}>
                <p className={`text-xs font-medium ${textMut}`}>{t.label}</p>
                <p className={`mt-2 text-2xl font-bold tabular-nums ${textPrim}`}>{t.value}</p>
              </div>
            ))}
          </div>
          {capacity > 0 && (
            <div className="h-2 overflow-hidden rounded-full" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#ebe7de' }}>
              <div className="h-full rounded-full" style={{ width: `${progressWidth}%`, background: 'linear-gradient(90deg, #10b981 0%, #34d399 45%, #6ee7b7 100%)' }} />
            </div>
          )}

          <div className={`rounded-[28px] border ${card}`}>
            <div className={`flex items-center justify-between gap-3 border-b px-6 py-5 ${cardHeader}`}>
              <div>
                <h3 className={`text-base font-semibold ${textPrim}`}>{isPublicEvent ? 'Cohort participants' : 'Participants'}</h3>
                <p className={`mt-1 text-sm ${textMut}`}>{isPublicEvent ? 'Students registered through their cohort.' : 'Who registered and when. Open a row for their full registration.'}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-[#f1f2f3] text-[#555]'}`}>
                {totalCount} total
              </span>
            </div>
            <div className={`transition-opacity ${pageLoading ? 'opacity-40' : ''}`}>
              {participantRows.length > 0 ? (
                <div className="divide-y divide-black/5 dark:divide-white/5">
                  {participantRows.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedResponse(r)}
                      className={`flex w-full items-center gap-3 px-4 sm:px-6 py-4 text-left transition-colors ${tableRow}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-semibold ${textPrim}`}>{r.participantName}</p>
                        <p className={`mt-0.5 text-xs truncate ${textMut}`}>{r.participantEmail}</p>
                      </div>
                      <p className={`text-right text-xs font-medium flex-shrink-0 ${textMut}`}>{r.submittedDate}</p>
                      <ChevronRight className={`h-4 w-4 flex-shrink-0 ${textMut}`} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className={`px-6 py-16 text-center ${textMut}`}>No participants yet. Share your event to start collecting registrations.</div>
              )}
            </div>
            <Pagination totalCount={totalCount} page={page} pageLoading={pageLoading} onPageChange={onPageChange} isDark={isDark} />
          </div>

          {isPublicEvent && (
            <PublicRegistrationsCard eventId={form.id} slug={form.slug} title={form.title ?? form.config?.title ?? ''} isDark={isDark} onCount={setPublicCount} />
          )}

          {/* Session Attendance */}
          {(() => {
            const byDate = new Map<string, any[]>();
            for (const row of eventAttendance) {
              if (!byDate.has(row.session_date)) byDate.set(row.session_date, []);
              byDate.get(row.session_date)!.push(row);
            }
            const sessionDates = [...byDate.keys()].sort().reverse();
            return (
              <div className={`rounded-[28px] border ${card}`}>
                <div className={`flex items-center justify-between gap-3 border-b px-6 py-5 ${cardHeader}`}>
                  <div>
                    <h3 className={`text-base font-semibold ${textPrim}`}>Session attendance</h3>
                    <p className={`mt-1 text-sm ${textMut}`}>Recorded each time a student clicks the Join button.</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-[#f1f2f3] text-[#555]'}`}>
                    {sessionDates.length} {sessionDates.length === 1 ? 'session' : 'sessions'}
                  </span>
                </div>
                {sessionDates.length === 0 ? (
                  <div className={`px-6 py-16 text-center text-sm ${textMut}`}>
                    No attendance recorded yet. Students are tracked automatically when they click Join.
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
                    {sessionDates.map(date => {
                      const attendees = byDate.get(date) ?? [];
                      const attended = attendees.length;
                      const pct = totalCount > 0 ? Math.round((attended / totalCount) * 100) : 0;
                      const isOpen = expandedSession === date;
                      const label = (() => {
                        const d = new Date(date + 'T12:00:00');
                        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                      })();
                      return (
                        <div key={date}>
                          <button
                            onClick={() => setExpandedSession(isOpen ? null : date)}
                            className={`w-full flex items-center justify-between px-6 py-4 text-left transition-colors ${tableRow}`}
                          >
                            <div>
                              <p className={`text-sm font-semibold ${textPrim}`}>{label}</p>
                              <p className={`mt-0.5 text-xs ${textMut}`}>{attended} of {totalCount} registered students joined</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${pct >= 75 ? (isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-700') : (isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-[#f1f2f3] text-[#666]')}`}>
                                {pct}%
                              </span>
                              <ChevronDown className={`w-4 h-4 transition-transform ${textMut} ${isOpen ? 'rotate-180' : ''}`} />
                            </div>
                          </button>
                          {isOpen && (
                            <div className={`px-6 pb-4 ${isDark ? 'bg-zinc-900/30' : 'bg-[#fafafa]'}`}>
                              {attendees.length === 0 ? (
                                <p className={`text-sm py-4 ${textMut}`}>No joins recorded for this session.</p>
                              ) : (
                                <div className="divide-y" style={{ borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                                  {attendees.map((a: any) => (
                                    <div key={a.student_id} className="flex items-center justify-between py-3">
                                      <div>
                                        <p className={`text-sm font-medium ${textPrim}`}>{(a.student as any)?.full_name || 'Unknown'}</p>
                                        <p className={`text-xs ${textMut}`}>{(a.student as any)?.email || ''}</p>
                                      </div>
                                      <span className={`text-xs ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                                        Joined {new Date(a.joined_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <AnimatePresence>
          {selectedResponse && (() => {
            const pName = getResponseName(selectedResponse);
            const pEmail = getResponseEmail(selectedResponse);
            const initials = (() => {
              const parts = pName.trim().split(/\s+/).filter(Boolean);
              if (parts.length === 0) return '?';
              if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
              return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            })();
            const AVATAR_GRADIENTS = [
              'linear-gradient(135deg,#6366f1,#8b5cf6)',
              'linear-gradient(135deg,#ec4899,#f43f5e)',
              'linear-gradient(135deg,#f59e0b,#ef4444)',
              'linear-gradient(135deg,#10b981,#059669)',
              'linear-gradient(135deg,#3b82f6,#6366f1)',
              'linear-gradient(135deg,#14b8a6,#3b82f6)',
              'linear-gradient(135deg,#f97316,#f59e0b)',
              'linear-gradient(135deg,#8b5cf6,#ec4899)',
            ];
            const avatarGradient = AVATAR_GRADIENTS[(pName.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length];
            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center sm:p-4"
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setSelectedResponse(null)} />
                <motion.div
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 30 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="relative z-[91] w-full max-w-md overflow-hidden rounded-t-[32px] sm:rounded-[28px] shadow-2xl"
                  style={{ background: isDark ? '#111113' : '#ffffff' }}
                >
                  {/* Header */}
                  <div
                    className="relative overflow-hidden px-6 pt-6 pb-5"
                    style={{ background: isDark ? 'linear-gradient(160deg,#1c1c1f 0%,#111113 100%)' : 'linear-gradient(160deg,#f5f5f7 0%,#ffffff 100%)' }}
                  >
                    {/* Glow blob behind avatar */}
                    <div
                      className="pointer-events-none absolute -top-8 -right-8 h-40 w-40 rounded-full opacity-20 blur-3xl"
                      style={{ background: avatarGradient }}
                    />

                    {/* Close button */}
                    <button
                      onClick={() => setSelectedResponse(null)}
                      className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                      style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
                    >
                      <X className="h-4 w-4" style={{ color: isDark ? '#a1a1aa' : '#71717a' }} />
                    </button>

                    {/* Avatar + identity */}
                    <div className="flex items-center gap-4">
                      <div
                        className="relative flex h-11 w-11 flex-shrink-0 items-end justify-center overflow-hidden rounded-full shadow-lg"
                        style={{ background: avatarGradient }}
                      >
                        <img
                          src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(pName)}&backgroundColor=transparent`}
                          alt={pName}
                          className="h-[90%] w-[90%] object-contain object-bottom"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            (e.currentTarget.previousSibling as HTMLElement | null)?.removeAttribute('style');
                          }}
                        />
                        <span
                          className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-white"
                          style={{ display: 'none' }}
                        >
                          {initials}
                        </span>
                      </div>
                      <div className="min-w-0 pr-8">
                        <h3 className={`truncate text-[22px] font-bold leading-tight ${textPrim}`}>{pName}</h3>
                        <p className={`mt-0.5 truncate text-sm ${textMut}`}>{pEmail === '--' ? 'No email provided' : pEmail}</p>
                        <span
                          className="mt-2 inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-[11px] font-semibold"
                          style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
                        >
                          <CheckCircle2 className="h-3 w-3" /> Registered
                        </span>
                      </div>
                    </div>

                    {/* Stat pills */}
                    <div className="mt-5 grid grid-cols-3 gap-2">
                      {[
                        { label: 'Registered', value: selectedResponse.submittedDateFull },
                        { label: 'Response ID', value: selectedResponse.id.slice(0, 8).toUpperCase() },
                        { label: 'Fields', value: String(responseEntries.length) },
                      ].map(({ label, value }) => (
                        <div
                          key={label}
                          className="rounded-2xl px-3 py-3 text-center"
                          style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
                        >
                          <p className={`text-[11px] font-semibold uppercase tracking-widest ${textMut}`}>{label}</p>
                          <p className={`mt-1 text-xs font-bold leading-tight ${textPrim}`}>{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }} />

                  {/* Fields */}
                  <div className="max-h-[52vh] overflow-y-auto p-5 space-y-2">
                    {responseEntries.length > 0 ? responseEntries.map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-2xl px-4 py-4"
                        style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}
                      >
                        <p className={`text-[11px] font-semibold uppercase tracking-widest ${textMut}`}>{formatFieldLabel(String(key))}</p>
                        <p className={`mt-2 text-sm font-medium leading-relaxed break-words ${textPrim}`}>
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </p>
                      </div>
                    )) : (
                      <p className={`py-6 text-center text-sm ${textMut}`}>No additional fields for this participant.</p>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </>
    );
  }

  // Regular form responses
  const dailyData = responses.reduce((acc: any, r: any) => {
    const date = new Date(r.created_at).toLocaleDateString();
    acc[date] = (acc[date] || 0) + 1;
    return acc;
  }, {});
  const chartData = Object.keys(dailyData).map(date => ({ date, count: dailyData[date] })).reverse();
  const fields = (form.config?.fields ?? []).filter((f: any) => f.type !== 'description');

  return (
    <div className="space-y-6">
      {/* Stat */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className={`border rounded-2xl p-5 ${card}`}>
          <div className="flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-emerald-500" /><span className={`text-xs uppercase tracking-wide font-medium ${textMut}`}>Total Responses</span></div>
          <p className={`text-[28px] font-bold ${textPrim} leading-9`}>{totalCount}</p>
        </div>
        <div className={`border rounded-2xl p-5 ${card}`}>
          <div className="flex items-center gap-2 mb-3"><AlignLeft className="w-4 h-4 text-blue-500" /><span className={`text-xs uppercase tracking-wide font-medium ${textMut}`}>Fields</span></div>
          <p className={`text-[28px] font-bold ${textPrim} leading-9`}>{fields.length}</p>
        </div>
        <div className={`border rounded-2xl p-5 col-span-2 md:col-span-1 ${card}`}>
          <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-amber-500" /><span className={`text-xs uppercase tracking-wide font-medium ${textMut}`}>Latest</span></div>
          <p className={`text-sm font-medium ${textPrim}`}>
            {responses[0] ? new Date(responses[0].created_at).toLocaleDateString() : '--'}
          </p>
        </div>
      </div>

      {responses.length > 0 && (
        <div className={`p-6 rounded-3xl border h-[280px] ${card}`}>
          <h3 className={`text-base font-semibold mb-4 ${textPrim}`}>Responses Over Time</h3>
          <ResponsesOverTimeChart data={chartData} />
        </div>
      )}

      <div className={`rounded-3xl border overflow-hidden ${card}`}>
        <div className={`px-6 py-4 border-b flex items-center justify-between ${cardHeader}`}>
          <h3 className={`text-base font-semibold ${textPrim}`}>All Submissions</h3>
          <button onClick={onExport} className={`flex items-center gap-2 text-xs transition-colors hover:opacity-60 ${textMut}`}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={`border-b ${tableHead}`}>
              <tr>
                <th className="px-3 sm:px-6 py-3 sm:py-4 font-medium">Date</th>
                {fields.map((f: any) => <th key={f.id} className="px-3 sm:px-6 py-3 sm:py-4 font-medium">{f.label}</th>)}
              </tr>
            </thead>
            <tbody className={`transition-opacity ${pageLoading ? 'opacity-40' : ''} divide-y ${dividerCls}`}>
              {responses.map((r: any) => (
                <tr key={r.id} className={`transition-colors ${tableRow}`}>
                  <td className={`px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs ${textMut}`}>{new Date(r.created_at).toLocaleString()}</td>
                  {fields.map((f: any) => <td key={f.id} className={`px-3 sm:px-6 py-3 sm:py-4 max-w-[160px] sm:max-w-[200px] truncate ${textSub}`}>{r.data?.[f.name] || '--'}</td>)}
                </tr>
              ))}
              {responses.length === 0 && (
                <tr><td colSpan={fields.length + 1} className={`px-6 py-12 text-center ${textMut}`}>No responses yet. Share your form to get started!</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination totalCount={totalCount} page={page} pageLoading={pageLoading} onPageChange={onPageChange} isDark={isDark} />
      </div>
    </div>
  );
}

function Pagination({ totalCount, page, pageLoading, onPageChange, isDark = true }: { totalCount: number; page: number; pageLoading: boolean; onPageChange: (p: number) => void; isDark?: boolean }) {
  if (totalCount <= PAGE_SIZE) return null;
  const btnStyle = isDark ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-[#f5f6f7] hover:bg-[#eaecef] text-[#555] border border-[rgba(0,0,0,0.07)]';
  const textStyle = isDark ? 'text-zinc-500' : 'text-[#888]';
  const borderStyle = isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]';
  return (
    <div className={`flex items-center justify-between px-6 py-4 border-t ${borderStyle}`}>
      <span className={`text-xs ${textStyle}`}>{page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => onPageChange(page - 1)} disabled={page === 0 || pageLoading} className={`px-3 py-2 rounded-lg text-xs disabled:opacity-30 transition-colors ${btnStyle}`}>Previous</button>
        <button onClick={() => onPageChange(page + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCount || pageLoading} className={`px-3 py-2 rounded-lg text-xs disabled:opacity-30 transition-colors ${btnStyle}`}>Next</button>
      </div>
    </div>
  );
}

// Social share icon SVGs (inline to avoid extra packages)
function TwitterXIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// -- Email Tab ---
/**
 * The cover as an email banner: its direct image link, sized for email. Not a link to this site
 * (from a local copy that is localhost, which no inbox can load). No usable link, no banner.
 */
function emailBannerFor(cover: unknown): string | undefined {
  const url = typeof cover === 'string' ? resolveImageUrl(cover, IMG_EMAIL_BANNER) : '';
  return /^https:\/\//i.test(url) ? url : undefined;
}

/** The AI writer's plain-text draft as editor paragraphs (escaped, blank lines split paragraphs). */
function plainTextToEditorHtml(text: string): string {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function EmailTab({ form, formUrl, courseProgress = [], cohortStudents = [], formCohorts = [] }: {
  form: any; formUrl: string; courseProgress?: any[]; cohortStudents?: any[]; formCohorts?: { id: string; name: string }[];
}) {
  const cfg = form.config ?? {};
  const isEvent = cfg.eventDetails?.isEvent === true;
  const isCourse  = cfg.isCourse === true;
  const isVE      = cfg.isVirtualExperience === true;
  const { theme } = useTheme();
  const isDark = theme !== 'light';
  const courseAccent = cfg.customAccent || COURSE_THEME_ACCENTS[cfg.theme] || '#00bf63';

  // Segment counts for VEs (fetched on mount); courses derive from props
  const [veAttempts, setVeAttempts] = useState<any[]>([]);
  useEffect(() => {
    if (!isVE) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/guided-project-progress?formId=${form.id}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setVeAttempts(json.attempts || []);
      }
    })();
  }, [form.id, isVE]);

  // Segment + cohort filter (courses and VEs only) -- must be declared before segmentCounts
  const [blastSegment, setBlastSegment]         = useState<'all' | 'not_started' | 'in_progress' | 'completed' | 'failed'>('all');
  const [selectedCohortId, setSelectedCohortId] = useState<string>('all');

  const segmentCounts = (() => {
    if (isCourse) {
      const filtered     = selectedCohortId === 'all' ? cohortStudents : cohortStudents.filter((s: any) => s.cohort_id === selectedCohortId);
      const startedIds   = new Set(courseProgress.map((p: any) => String(p.student_id)));
      const completedIds = new Set(courseProgress.filter((p: any) => p.completed && p.passed !== false).map((p: any) => String(p.student_id)));
      const failedIds    = new Set(courseProgress.filter((p: any) => p.completed && p.passed === false).map((p: any) => String(p.student_id)));
      return {
        all:         filtered.length,
        not_started: filtered.filter((s: any) => !startedIds.has(String(s.id))).length,
        in_progress: filtered.filter((s: any) => startedIds.has(String(s.id)) && !completedIds.has(String(s.id)) && !failedIds.has(String(s.id))).length,
        completed:   filtered.filter((s: any) => completedIds.has(String(s.id))).length,
        failed:      filtered.filter((s: any) => failedIds.has(String(s.id))).length,
      };
    }
    if (isVE) {
      // The report also includes direct-access learners who started an open VE without cohort
      // assignment. Broadcast email deliberately remains cohort-only, so its button count must use
      // the same audience as /api/email rather than every visible report row.
      const enrolledAttempts = veAttempts.filter((attempt: any) => !attempt.activity_only);
      const filtered = selectedCohortId === 'all'
        ? enrolledAttempts
        : enrolledAttempts.filter((attempt: any) => attempt.cohort_id === selectedCohortId);
      return {
        all:         filtered.length,
        not_started: filtered.filter((a: any) => !a.started_at && !a.completed_at).length,
        in_progress: filtered.filter((a: any) => !!a.started_at && !a.completed_at).length,
        completed:   filtered.filter((a: any) => !!a.completed_at).length,
        failed:      0,
      };
    }
    return null;
  })();

  // Quick send state
  const [quickTo, setQuickTo]           = useState('');
  const [quickType, setQuickType]       = useState<'confirmation' | 'reminder' | 'course-result'>('confirmation');
  const [quickSending, setQuickSending] = useState(false);
  const [quickResult, setQuickResult]   = useState<{ ok: boolean; msg: string } | null>(null);

  // Blast state
  const [blastSubject, setBlastSubject] = useState('');
  const [blastBody, setBlastBody]       = useState('');
  // The message is editor HTML: it counts as written once it has text or an image, button or video.
  const blastHasBody = /<(img|a)\b|class="yt-embed"/i.test(blastBody)
    || blastBody.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
  const [blasting, setBlasting]         = useState(false);
  const [blastResult, setBlastResult]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [blastTone, setBlastTone]       = useState<'friendly' | 'professional' | 'casual'>('friendly');
  const blastPurpose = isEvent ? 'event update' : isVE ? 'experience update' : 'course update';
  const [blastPrompt, setBlastPrompt]   = useState('');
  const [blastAiLoading, setBlastAiLoading] = useState(false);
  const [blastAiResult, setBlastAiResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Reminder state (events only)
  const [reminderType, setReminderType] = useState<'24hr' | '1hr'>('24hr');
  const [reminding, setReminding]       = useState(false);
  const [reminderResult, setReminderResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // Fetch all participant emails

  const handleQuickSend = async () => {
    if (!isValidEmail(quickTo)) { setQuickResult({ ok: false, msg: 'Enter a valid email address.' }); return; }
    setQuickSending(true);
    setQuickResult(null);
    try {
      const eventBannerUrl = emailBannerFor(cfg.coverImage);
      let payload: any = { type: quickType, to: quickTo, data: { formUrl } };
      if (isCourse || isVE) {
        // Course / VE: send a test blast to this single address
        if (!blastSubject.trim() || !blastHasBody) {
          setQuickResult({ ok: false, msg: 'Fill in the subject and message above first, then test here.' });
          setQuickSending(false);
          return;
        }
        payload = {
          type: 'blast',
          to: quickTo,
          data: {
            formId: form.id,
            subject: blastSubject,
            body: blastBody,
            buttonColor: courseAccent,
            formTitle: cfg.title || form.title,
            eventTitle: cfg.title || form.title,
            formUrl,
          },
        };
      } else if (quickType === 'confirmation') {
        payload.data = {
          eventTitle: cfg.title,
          eventDate: cfg.eventDetails?.date,
          eventTime: cfg.eventDetails?.time,
          eventLocation: cfg.eventDetails?.location,
          eventTimezone: cfg.eventDetails?.timezone,
          customTitle: cfg.postSubmission?.noticeTitle,
          customBody: cfg.postSubmission?.noticeBody,
          meetingLink: cfg.eventDetails?.eventType === 'virtual' ? cfg.eventDetails?.meetingLink : undefined,
          bannerUrl: eventBannerUrl,
          formUrl,
        };
      } else if (quickType === 'reminder') {
        payload.data = {
          formId: form.id,
          eventTitle: cfg.title,
          eventDate: cfg.eventDetails?.date,
          eventTime: cfg.eventDetails?.time,
          eventLocation: cfg.eventDetails?.location,
          eventTimezone: cfg.eventDetails?.timezone,
          meetingLink: cfg.eventDetails?.eventType === 'virtual' ? cfg.eventDetails?.meetingLink : undefined,
          bannerUrl: eventBannerUrl,
          formUrl,
          isOneHour: reminderType === '1hr',
        };
      }
      const { data: { session: quickSession } } = await supabase.auth.getSession();
      const quickHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (quickSession?.access_token) quickHeaders['Authorization'] = `Bearer ${quickSession.access_token}`;
      const res = await fetch('/api/email', { method: 'POST', headers: quickHeaders, body: JSON.stringify(payload) });
      if (res.ok) setQuickResult({ ok: true, msg: `Email sent to ${quickTo}.` });
      else { const err = await res.json().catch(() => ({})); setQuickResult({ ok: false, msg: err.error || 'Send failed.' }); }
    } catch { setQuickResult({ ok: false, msg: 'Network error.' }); }
    setQuickSending(false);
  };

  /** The broadcast as the email route takes it; preview and test send use the same, so they match. */
  const blastData = () => {
    const eventBannerUrl = emailBannerFor(cfg.coverImage);
    return {
            formId: form.id,
            subject: blastSubject,
            body: blastBody,
            buttonColor: courseAccent,
            formTitle: cfg.title || form.title,
            eventTitle: cfg.title || form.title,
            eventDate: cfg.eventDetails?.date,
            eventTime: cfg.eventDetails?.time,
            eventTimezone: cfg.eventDetails?.timezone,
            eventLocation: cfg.eventDetails?.location,
            meetingLink: cfg.eventDetails?.meetingLink,
            bannerUrl: eventBannerUrl,
            formUrl,
            ...((isCourse || isVE) ? { segment: blastSegment } : {}),
            ...((isCourse || isVE) && selectedCohortId !== 'all' ? { cohortId: selectedCohortId } : {}),
    };
  };

  const postBlast = async (extra: { to?: string; preview?: boolean } = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    const { to, preview } = extra;
    return fetch('/api/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ type: 'blast', ...(to ? { to } : {}), data: { ...blastData(), ...(preview ? { preview: true } : {}) } }),
    });
  };

  // Preview and test send, from the Broadcast Email card itself.
  const [blastPreview, setBlastPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'phone'>('desktop');
  const [previewing, setPreviewing] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testSending, setTestSending] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) setTestTo(prev => prev || session.user.email!);
    });
  }, []);

  const handlePreview = async () => {
    if (!blastSubject.trim() || !blastHasBody) { setBlastResult({ ok: false, msg: 'Write a subject and message to preview.' }); return; }
    setPreviewing(true);
    setBlastResult(null);
    try {
      const res = await postBlast({ preview: true });
      const json = await res.json().catch(() => ({}));
      if (res.ok && typeof json.html === 'string') setBlastPreview({ subject: json.subject || blastSubject, html: json.html });
      else setBlastResult({ ok: false, msg: json.error || 'Could not build the preview.' });
    } catch { setBlastResult({ ok: false, msg: 'Network error. Please try again.' }); }
    setPreviewing(false);
  };

  const handleTestSend = async () => {
    if (!isValidEmail(testTo.trim())) { setBlastResult({ ok: false, msg: 'Enter a valid email address for the test.' }); return; }
    if (!blastSubject.trim() || !blastHasBody) { setBlastResult({ ok: false, msg: 'Write a subject and message first.' }); return; }
    setTestSending(true);
    setBlastResult(null);
    try {
      const res = await postBlast({ to: testTo.trim() });
      const json = await res.json().catch(() => ({}));
      setBlastResult(res.ok ? { ok: true, msg: `Test sent to ${testTo.trim()}. Nobody else got it.` } : { ok: false, msg: json.error || 'Test send failed.' });
    } catch { setBlastResult({ ok: false, msg: 'Network error. Please try again.' }); }
    setTestSending(false);
  };

  const handleBlast = async () => {
    if (!blastSubject.trim() || !blastHasBody) {
      setBlastResult({ ok: false, msg: 'Subject and body are required.' });
      return;
    }
    setBlasting(true);
    setBlastResult(null);
    try {
      const res = await postBlast();
      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        const count = result.count ?? 0;
        setBlastResult({ ok: true, msg: `Sent to ${count} recipient${count !== 1 ? 's' : ''}.` });
        setBlastSubject('');
        setBlastBody('');
      } else {
        const err = await res.json().catch(() => ({}));
        setBlastResult({ ok: false, msg: err.error || 'Send failed.' });
      }
    } catch { setBlastResult({ ok: false, msg: 'Network error. Please try again.' }); }
    setBlasting(false);
  };

  const handleGenerateBroadcastEmail = async () => {
    setBlastAiLoading(true);
    setBlastAiResult(null);
    try {
      const { data: { session: aiSession } } = await supabase.auth.getSession();
      const res = await fetch('/api/ai-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiSession?.access_token ?? ''}` },
        body: JSON.stringify({
          action: 'generate_broadcast_email',
          formTitle: cfg.title || form.title,
          description: cfg.description,
          audience: isEvent ? 'registrants' : (isCourse || isVE) ? 'enrolled students' : 'respondents',
          tone: blastTone,
          purpose: blastPurpose.trim() || 'event update',
          prompt: blastPrompt.trim(),
          eventDetails: cfg.eventDetails,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'AI request failed');
      setBlastSubject(data.subject || '');
      setBlastBody(plainTextToEditorHtml(data.body || ''));
      setBlastAiResult({ ok: true, msg: 'Broadcast email draft generated.' });
      setBlastResult(null);
    } catch (e: any) {
      setBlastAiResult({ ok: false, msg: e?.message || 'Failed to generate broadcast email.' });
    }
    setBlastAiLoading(false);
  };

  const handleReminder = async () => {
    setReminding(true);
    setReminderResult(null);
    try {
      const eventBannerUrl = emailBannerFor(cfg.coverImage);
      const { data: { session: reminderSession } } = await supabase.auth.getSession();
      const res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(reminderSession?.access_token ? { 'Authorization': `Bearer ${reminderSession.access_token}` } : {}) },
        body: JSON.stringify({
          type: 'reminder',
          data: {
            formId: form.id,
            eventTitle: cfg.title,
            eventDate: cfg.eventDetails?.date,
            eventTime: cfg.eventDetails?.time,
            eventLocation: cfg.eventDetails?.location,
            eventTimezone: cfg.eventDetails?.timezone,
            meetingLink: cfg.eventDetails?.eventType === 'virtual' ? cfg.eventDetails?.meetingLink : undefined,
            bannerUrl: eventBannerUrl,
            formUrl,
            isOneHour: reminderType === '1hr'
          },
        }),
      });
      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        const count = result.count ?? 0;
        setReminderResult({ ok: true, msg: `Reminder sent to ${count} registrant${count !== 1 ? 's' : ''}.` });
      } else { const err = await res.json().catch(() => ({})); setReminderResult({ ok: false, msg: err.error || 'Send failed.' }); }
    } catch { setReminderResult({ ok: false, msg: 'Network error. Please try again.' }); }
    setReminding(false);
  };

  const quickTypes = [
    ...(isEvent ? [{ value: 'confirmation', label: 'Registration Confirmation' }, { value: 'reminder', label: 'Event Reminder' }] : []),
    ...(!isEvent && !isCourse && !isVE ? [{ value: 'confirmation', label: 'Confirmation' }] : []),
  ] as { value: typeof quickType; label: string }[];

  // -- Shared style tokens --
  // The dashboard colours with the shared blue, for chips, buttons and switches.
  const PC = isDark ? DARK_C : { ...LIGHT_C, cta: DARK_C.cta };
  const P = palette(PC);
  const chipStyle = (on: boolean) => (on ? { background: P.sel, color: P.onSel } : { background: PC.card, color: PC.muted, boxShadow: `inset 0 0 0 1px ${PC.divider}` });
  // Each part of the tab is a flat section of the page's white card, with a divider line above it.
  const sectionCls = 'space-y-4 border-t pt-5';
  const sectionStyle = { borderColor: PC.divider };
  const sectionTitle = 'text-base font-semibold';
  const fieldStyle = { background: PC.input, border: `1px solid ${PC.inputBorder}`, color: PC.text };
  const card = isDark ? 'border-t border-white/[0.08] pt-5' : 'border-t border-black/[0.07] pt-5';

  const cardHeader = 'flex items-center gap-3 pb-4';

  const cardTitle = isDark ? 'text-sm font-semibold text-white' : 'text-sm font-semibold text-gray-900';
  const cardSub   = isDark ? 'text-xs text-zinc-500 mt-0.5' : 'text-xs text-gray-400 mt-0.5';

  const label = isDark
    ? 'block text-xs font-medium text-zinc-400 mb-2'
    : 'block text-xs font-semibold text-gray-500 mb-2';

  // One soft field style, no border, green ring on focus (as the experience editor).
  // The shared field look (as the dropdowns): the dashboard's field colour with a hairline border.
  const input = 'field-focus w-full rounded-[10px] px-3.5 py-3 text-sm outline-none';
  const chipBg = isDark ? 'rgba(255,255,255,0.055)' : '#F4F6F9';
  const softBtn = `${btnClass} flex-shrink-0`;


  // Faded until it can send.
  const primaryBtn = 'w-full h-11 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-45 disabled:cursor-not-allowed';

  const feedback = (ok: boolean) => ok
    ? (isDark
        ? 'flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
        : 'flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-emerald-50 border border-emerald-200 text-emerald-700')
    : (isDark
        ? 'flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-rose-500/10 border border-rose-500/20 text-rose-400'
        : 'flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-600');

  const sectionIconBg = 'p-2 rounded-lg';

  return (
    <div className="w-full space-y-4 py-2">
      <div className="pb-2">
        <h2 className={isDark ? 'text-[18px] font-semibold text-white' : 'text-[18px] font-semibold text-gray-900'}>{isEvent ? 'Email attendees' : 'Email learners'}</h2>
        <p className={isDark ? 'mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500' : 'mt-1 max-w-2xl text-sm leading-relaxed text-gray-400'}>{isEvent ? 'Send an update to everyone registered, and test it before sending.' : 'Send an update to everyone, or only to learners at one stage, and test it before sending.'}</p>
      </div>

      {/* -- Broadcast: who, an optional AI draft, the message, then test and send -- */}
      <div className="space-y-5">
          {(isCourse || isVE) && formCohorts.length > 0 && (
            <div>
              <span className={label}>Cohort</span>
              <div className="flex flex-wrap gap-2">
                {[{ id: 'all', name: 'All cohorts' }, ...formCohorts].map(c => {
                  const on = selectedCohortId === c.id;
                  return (
                    <button key={c.id} type="button" aria-pressed={on} onClick={() => { setSelectedCohortId(c.id); setBlastResult(null); }}
                      className="h-8 rounded-full px-3 text-xs font-semibold transition-colors" style={chipStyle(on)}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(isCourse || isVE) && (
            <div>
              <span className={label}>Send to</span>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: 'all',         label: 'Everyone'    },
                  { value: 'not_started', label: 'Not started' },
                  { value: 'in_progress', label: 'In progress' },
                  { value: 'completed',   label: 'Completed'   },
                  { value: 'failed',      label: 'Failed'      },
                ] as const).filter(seg => !(isVE && seg.value === 'failed')).map(seg => {
                  const count = segmentCounts?.[seg.value];
                  const on = blastSegment === seg.value;
                  return (
                    <button key={seg.value} type="button" aria-pressed={on} onClick={() => { setBlastSegment(seg.value); setBlastResult(null); }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors" style={chipStyle(on)}>
                      {seg.label}
                      {count !== undefined && <span className="tabular-nums" style={{ opacity: 0.7 }}>{count}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional AI draft: tone and what it is about; the purpose stays the content's default. */}
          <div className={sectionCls} style={sectionStyle}>
            <div className="flex items-center justify-between gap-3">
              <h3 className={sectionTitle} style={{ color: PC.text }}>Draft with AI</h3>
              <span className="text-xs" style={{ color: PC.muted }}>Optional</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div>
                <span className={label}>Tone</span>
                <MenuSelect label="Tone" field value={blastTone} onChange={setBlastTone} C={PC}
                  options={[{ value: 'friendly', label: 'Friendly' }, { value: 'professional', label: 'Professional' }, { value: 'casual', label: 'Casual' }] as const} />
              </div>
              <div>
                <label className={label} htmlFor="blast-about">What is it about?</label>
                <input id="blast-about" type="text" value={blastPrompt} onChange={e => setBlastPrompt(e.target.value)} className={input} style={fieldStyle}
                  placeholder={isEvent ? 'e.g. The venue has changed; doors open at 6pm' : isVE ? 'e.g. Week 2 starts Monday; the board pack is due Friday' : 'e.g. A new module is open; finish it by Friday'} />
              </div>
            </div>
            {blastAiResult && (
              <div className={feedback(blastAiResult.ok)}>
                {blastAiResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                <span>{blastAiResult.msg}</span>
              </div>
            )}
            <button type="button" onClick={handleGenerateBroadcastEmail} disabled={blastAiLoading} className={btnSmClass} style={btnStyle('sec', PC)}>
              {blastAiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" style={{ color: PC.muted }} />}
              Draft the email
            </button>
          </div>

          <div className={sectionCls} style={sectionStyle}>
          <h3 className={sectionTitle} style={{ color: PC.text }}>Message</h3>
          <div>
            <label className={label} htmlFor="blast-subject">Subject</label>
            <input id="blast-subject" type="text" value={blastSubject} onChange={e => { setBlastSubject(e.target.value); setBlastResult(null); }}
              placeholder={isEvent ? 'e.g. Important update about your registration' : isVE ? 'e.g. Week 2 starts Monday' : 'e.g. A new module is open'}
              className={input} style={fieldStyle} />
          </div>
          <div>
            <span className={label}>Message</span>
            <RichTextEditor
              value={blastBody}
              onChange={html => { setBlastBody(html); setBlastResult(null); }}
              placeholder="Write your message here. Add images, a button, or a video."
              enableVideoEmbed
              anyVideoLink
              enableButton
              buttonColor={courseAccent}
              imageFolder="email-images"
              imageWidth="100%"
            />
            <p className={isDark ? 'mt-2 text-xs text-zinc-500' : 'mt-2 text-xs text-gray-400'}>Click an image to change its size. Sign off in your own words: nothing is added under your message.</p>
          </div>
          <div className={isDark ? 'flex flex-wrap items-center gap-2 text-xs text-zinc-500' : 'flex flex-wrap items-center gap-2 text-xs text-gray-500'}>
            <span>Personalise with</span>
            {['{{name}}', '{{email}}', '{{form_title}}', '{{form_url}}', ...(isEvent ? ['{{event_title}}', '{{event_date}}', '{{event_time}}', '{{event_timezone}}', '{{event_location}}', '{{meeting_link}}'] : [])].map(tag => (
              <code key={tag} className="rounded-md px-2 py-0.5 text-[12px]" style={{ background: chipBg, color: isDark ? '#e4e4e7' : '#111' }}>{tag}</code>
            ))}
            {isEvent && <span className="basis-full">A button can link to <code>{'{{meeting_link}}'}</code> to give each registrant their own join link.</span>}
          </div>
          </div>
          <div className={sectionCls} style={sectionStyle}>
          <h3 className={sectionTitle} style={{ color: PC.text }}>Test and send</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handlePreview} disabled={previewing || !blastSubject.trim() || !blastHasBody}
              className={softBtn} style={btnStyle('sec', PC)}>
              {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Preview
            </button>
            <input type="email" value={testTo} onChange={e => { setTestTo(e.target.value); setBlastResult(null); }}
              placeholder="you@example.com" aria-label="Send a test to" className={`${input} min-w-[160px] flex-1`} style={fieldStyle} />
            <button type="button" onClick={handleTestSend} disabled={testSending || !testTo.trim() || !blastSubject.trim() || !blastHasBody}
              className={softBtn} style={btnStyle('sec', PC)}>
              {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send test
            </button>
          </div>
          {blastResult && (
            <div className={feedback(blastResult.ok)}>
              {blastResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
              <span>{blastResult.msg}</span>
            </div>
          )}
          <button onClick={handleBlast} disabled={blasting || !blastSubject.trim() || !blastHasBody}
            className={primaryBtn} style={{ background: PC.cta }}>
            {blasting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Send className="w-4 h-4" /> Send to {(isCourse || isVE) && segmentCounts ? `${segmentCounts[blastSegment]} ${isEvent ? 'attendee' : 'learner'}${segmentCounts[blastSegment] !== 1 ? 's' : ''}` : 'all'}</>}
          </button>
          <p className={isDark ? 'text-xs text-zinc-500' : 'text-xs text-gray-500'}>
            {(blastSubject.trim() && blastHasBody) ? ((isCourse || isVE) ? 'Only enrolled learners with an email address will receive this.' : 'Only recipients who gave an email address will receive this.') : 'Add a subject and a message to send.'}
          </p>
          </div>
      </div>

      {blastPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBlastPreview(null)}>
          <div role="dialog" aria-modal="true" aria-label="Email preview" onClick={e => e.stopPropagation()}
            className={`flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl ${isDark ? 'bg-zinc-900' : 'bg-white'}`}>
            <div className="flex items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className={isDark ? 'text-xs text-zinc-500' : 'text-xs text-gray-400'}>Subject</p>
                <p className={`truncate text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{blastPreview.subject}</p>
              </div>
              <div className={`flex rounded-lg p-0.5 ${isDark ? 'bg-zinc-800' : 'bg-[#f1f2f4]'}`}>
                {(['desktop', 'phone'] as const).map(w => (
                  <button key={w} type="button" onClick={() => setPreviewWidth(w)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold ${previewWidth === w ? (isDark ? 'bg-zinc-700 text-white' : 'bg-white text-gray-900') : (isDark ? 'text-zinc-400' : 'text-gray-500')}`}>
                    {w === 'desktop' ? 'Desktop' : 'Phone'}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setBlastPreview(null)} aria-label="Close preview" className={`rounded-lg p-2 ${isDark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-gray-500 hover:bg-gray-100'}`}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={`flex-1 overflow-auto p-4 ${isDark ? 'bg-zinc-950' : 'bg-[#f1f2f4]'}`}>
              {/* Scripts never run in the preview; links open in a new tab. */}
              <iframe title="Email preview" srcDoc={blastPreview.html} sandbox="allow-popups allow-popups-to-escape-sandbox"
                className="mx-auto block h-[70vh] rounded-lg bg-white transition-[width]"
                style={{ width: previewWidth === 'phone' ? 375 : '100%', maxWidth: '100%' }} />
            </div>
            <p className={`px-5 py-3 text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
              Shown with the sample name &quot;there&quot;. Each recipient sees their own name and links.
            </p>
          </div>
        </div>
      )}

      {/* -- Event Reminder (bulk) -- */}
      {isEvent && (
        <div className={card}>
          <div className={cardHeader}>
            <div className={sectionIconBg} style={{ background: PC.pill }}>
              <Bell className="w-4 h-4" style={{ color: PC.muted }} />
            </div>
            <div>
              <p className={cardTitle}>Event Reminder</p>
              <p className={cardSub}>Notify all registrants about the upcoming event</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['24hr', '1hr'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setReminderType(t)}
                  aria-pressed={reminderType === t}
                  className="h-10 rounded-xl text-sm font-semibold transition-colors"
                  style={chipStyle(reminderType === t)}
                >
                  {t === '24hr' ? '24 Hours Before' : '1 Hour Before'}
                </button>
              ))}
            </div>
            {reminderResult && (
              <div className={feedback(reminderResult.ok)}>
                {reminderResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                <span>{reminderResult.msg}</span>
              </div>
            )}
            <button
              onClick={handleReminder}
              disabled={reminding}
              className={primaryBtn}
              style={{ background: PC.cta }}
            >
              {reminding ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send {reminderType === '1hr' ? '1-Hour' : '24-Hour'} Reminder</>}
            </button>
          </div>
        </div>
      )}

      {/* -- Send Now (Quick Send): for events and forms it also sends confirmations and follow-ups.
          For courses and experiences it only repeated the Send test beside Preview, so it is not shown. -- */}
      {!(isCourse || isVE) && (
      <div className={card}>
        <div className={cardHeader}>
          <div className={sectionIconBg} style={{ background: PC.pill }}>
            <Send className="w-4 h-4" style={{ color: PC.muted }} />
          </div>
          <div>
            <p className={cardTitle}>Test Send</p>
            <p className={cardSub}>
              {(isCourse || isVE)
                ? 'Send a preview of your email to a single address to check how it looks.'
                : 'Send an email instantly to a single address. Useful for testing or follow-ups.'}
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className={label}>Recipient Email</label>
            <input
              type="email"
              value={quickTo}
              onChange={e => { setQuickTo(e.target.value); setQuickResult(null); }}
              placeholder="recipient@example.com"
              className={input} style={fieldStyle}
            />
          </div>
          {quickTypes.length > 1 && (
            <div>
              <label className={label}>Email Type</label>
              <div className="grid grid-cols-2 gap-2">
                {quickTypes.map(t => (
                  <button
                    key={t.value}
                    onClick={() => { setQuickType(t.value); setQuickResult(null); }}
                    aria-pressed={quickType === t.value}
                    className="h-10 px-3 rounded-xl text-xs font-semibold transition-colors text-left"
                    style={chipStyle(quickType === t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {quickResult && (
            <div className={feedback(quickResult.ok)}>
              {quickResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
              <span>{quickResult.msg}</span>
            </div>
          )}
          <button
            onClick={handleQuickSend}
            disabled={quickSending || !quickTo.trim()}
            className={primaryBtn}
            style={{ background: PC.cta }}
          >
            {quickSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send Email</>}
          </button>
          {(isCourse || isVE) && (
            <p className={isDark ? 'text-xs text-zinc-600 text-center' : 'text-xs text-gray-400 text-center'}>
              Sends a preview using the subject and message above
            </p>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// -- Leaderboard Tab ---
function LeaderboardTab({ courseProgress }: { courseProgress: any[] }) {
  const { theme } = useTheme();
  const isDark = theme !== 'light';
  const PC = isDark ? DARK_C : { ...LIGHT_C, cta: DARK_C.cta };
  const P = palette(PC);
  // Gold, silver and bronze for the top three ranks.
  const medal = isDark ? ['#f2c14e', '#b8c0cc', '#e0955a'] : ['#c98a04', '#8a94a3', '#b0632a'];

  // Learners who finished, by score, with XP breaking ties.
  const rows = courseProgress
    .filter(p => p.completed)
    .map(p => ({ ...p, pct: p.score ?? 0 }))
    .sort((a, b) => b.pct - a.pct || (b.points ?? 0) - (a.points ?? 0));
  const grid = 'grid grid-cols-[36px_minmax(0,1fr)_70px] sm:grid-cols-[44px_minmax(0,1fr)_minmax(120px,220px)_90px] items-center gap-x-3.5 gap-y-2';

  return (
    <Card C={PC} className="overflow-hidden">
      <div className="px-5 py-4 flex flex-wrap items-baseline justify-between gap-3" style={{ borderBottom: `1px solid ${PC.divider}` }}>
        <h3 className="text-base font-semibold" style={{ color: PC.text }}>Leaderboard</h3>
        <span className="text-xs" style={{ color: PC.muted }}>{rows.length ? `${rows.length} finished. ` : ''}Ranked by score; XP breaks ties.</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <Trophy className="mx-auto h-6 w-6" style={{ color: PC.muted }} />
          <p className="mt-3 text-sm font-semibold" style={{ color: PC.text }}>No one has finished yet</p>
          <p className="mt-1 text-sm" style={{ color: PC.muted }}>Learners appear here, ranked by score, once they finish the course.</p>
        </div>
      ) : (
        <>
          <div className={`${grid} hidden sm:grid px-5 py-2.5 text-xs font-semibold`} style={{ color: PC.faint }}>
            <span>Rank</span><span>Learner</span><span>Score</span><span className="text-right">XP</span>
          </div>
          {rows.map((r, i) => {
            const tint = medal[i];
            const pts = r.points ?? 0;
            return (
              <div key={`${r.student_id}_${i}`} className={`${grid} px-5 py-3`} style={{ borderTop: `1px solid ${PC.divider}` }}>
                <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold tabular-nums"
                  style={tint ? { background: `color-mix(in srgb, ${tint} 20%, transparent)`, color: tint } : { background: PC.pill, color: PC.muted }}>
                  {i + 1}
                </span>
                <span className="min-w-0 truncate text-sm font-semibold" style={{ color: PC.text }}>{r.student_name || 'Unknown'}</span>
                <div className="col-span-2 row-start-2 col-start-2 sm:col-span-1 sm:row-start-auto sm:col-start-auto">
                  <p className="mb-1.5 text-xs" style={{ color: PC.text }}>{r.pct}%</p>
                  <SharedBar parts={[{ pct: r.pct, color: r.passed ? P.good : P.bad }]} C={PC} />
                </div>
                <span className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto text-right text-sm font-semibold tabular-nums" style={{ color: PC.text }}>
                  {pts.toLocaleString('en-GB')} <span className="text-xs font-normal" style={{ color: PC.muted }}>XP</span>
                </span>
              </div>
            );
          })}
        </>
      )}
    </Card>
  );
}


// -- More Tab ---
// Draft or Published, with the switch. Shared by the Publish tab (events, forms, experiences)
// and the course editor's Publish step, where `ready`/`unsaved` hold Publish back until the
// course passes its checks and is saved (the server runs the same checks).
function StatusCard({ form, kind, onStatusChange, ready = true, unsaved = false }: {
  form: any; kind: string; onStatusChange?: (status: 'draft' | 'published') => void; ready?: boolean; unsaved?: boolean;
}) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusWarning, setStatusWarning] = useState('');
  const [currentStatus, setCurrentStatus] = useState<'draft' | 'published'>(form?.status ?? 'published');
  const pageC = isLight ? { ...LIGHT_C, cta: DARK_C.cta } : DARK_C;
  const textPrim = pageC.text;
  const textMut  = pageC.muted;
  const published = currentStatus === 'published';
  const blocked = !published && (!ready || unsaved);

  const handleStatusToggle = async (newStatus: 'draft' | 'published') => {
    if (newStatus === currentStatus || statusUpdating) return;
    setStatusUpdating(true);
    setStatusWarning('');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/forms', {
      method:  'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ formId: form.id, status: newStatus }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setCurrentStatus(newStatus);
      onStatusChange?.(newStatus);
      if (json.registrationWarning) setStatusWarning(json.registrationWarning);
    } else {
      // e.g. a course with an untitled lesson or a question without a correct answer
      setStatusWarning(json.error || 'Could not change the status. Please try again.');
    }
    setStatusUpdating(false);
  };

  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold" style={{ color: textPrim }}>Status</h3>
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <div className="min-w-0">
          {published ? <Pill tone="good" dot C={pageC}>Published</Pill> : <Pill tone="warn" C={pageC}>Draft</Pill>}
          <p className="mt-1.5 text-sm" style={{ color: textMut }}>
            {published ? `Learners it is assigned to can open this ${kind}.`
              : unsaved ? 'Save your changes, then publish.'
              : !ready ? 'Fix the items below, then publish.'
              : `Learners cannot see this ${kind} yet.`}
          </p>
        </div>
        <button onClick={() => handleStatusToggle(published ? 'draft' : 'published')} disabled={statusUpdating || blocked}
          className={btnClass} style={btnStyle(published ? 'sec' : 'pri', pageC)}>
          {statusUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : published ? 'Move to draft' : 'Publish'}
        </button>
      </div>
      {statusWarning && <p className="text-xs" style={{ color: '#b45309' }}>{statusWarning}</p>}
    </div>
  );
}

// "Makes a draft copy you can change."
function DuplicateRow({ kind, onClone }: { kind: string; onClone: () => Promise<void> }) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState(false);
  const handleClone = async () => {
    setCloning(true);
    await onClone();
    setCloning(false);
    setCloned(true);
    setTimeout(() => setCloned(false), 3000);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[14px] font-semibold" style={{ color: isLight ? '#111' : '#fff' }}>Duplicate</p>
        <p className="text-xs" style={{ color: isLight ? '#555' : '#71717a' }}>Makes a draft copy you can change.</p>
      </div>
      <button onClick={handleClone} disabled={cloning || cloned}
        className={btnClass} style={btnStyle('sec', isLight ? { ...LIGHT_C, cta: DARK_C.cta } : DARK_C)}>
        {cloning ? <Loader2 className="w-4 h-4 animate-spin" /> : cloned ? 'Copy made' : `Duplicate ${kind}`}
      </button>
    </div>
  );
}

// Share buttons, embed code and QR code: events and forms are shared widely. Shown in the
// Publish tab (forms) and in the event editor's Publish step.
function ShareKit({ form, formUrl, kind }: { form: any; formUrl: string; kind: string }) {
  const { copied: embedCopied, copy: copyEmbed } = useCopy();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const textPrim = isLight ? '#111' : '#fff';
  const textMut  = isLight ? '#555' : '#71717a';
  const soft = isLight ? '#F4F6F9' : 'rgba(255,255,255,0.055)';
  const btn = 'inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60 flex-shrink-0';
  const ghost = { background: soft, color: textPrim };
  const contentLabel = kind;
  const embedCode = `<iframe
  src="${formUrl}"
  width="600"
  height="700"
  frameborder="0"
  style="border: 1px solid #bfcbda88; border-radius: 4px;"
  allow="fullscreen; payment"
  aria-hidden="false"
  tabindex="0"
></iframe>`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(formUrl)}&margin=12&color=ffffff&bgcolor=18181b&qzone=1`;

  const shareText = encodeURIComponent(`Check out this ${contentLabel}: ${form.title}`);
  const shareUrl = encodeURIComponent(formUrl);

  const socialLinks = [
    {
      label: 'X (Twitter)',
      href: `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`,
      Icon: TwitterXIcon,
      color: '#1DA1F2',
      bg: 'rgba(29,161,242,0.1)',
      border: 'rgba(29,161,242,0.25)',
    },
    {
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`,
      Icon: LinkedInIcon,
      color: '#0A66C2',
      bg: 'rgba(10,102,194,0.1)',
      border: 'rgba(10,102,194,0.25)',
    },
    {
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`,
      Icon: FacebookIcon,
      color: '#1877F2',
      bg: 'rgba(24,119,242,0.1)',
      border: 'rgba(24,119,242,0.25)',
    },
    {
      label: 'WhatsApp',
      href: `https://wa.me/?text=${shareText}%20${shareUrl}`,
      Icon: WhatsAppIcon,
      color: '#25D366',
      bg: 'rgba(37,211,102,0.1)',
      border: 'rgba(37,211,102,0.25)',
    },
  ];


  return (
    <div className="space-y-5" style={{ color: textPrim }}>
      <div className="space-y-3">
        <p className="text-[14px] font-semibold">Share</p>
        <div className="flex flex-wrap gap-2">
          {socialLinks.map(({ label, href, Icon }) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" className={btn} style={ghost}>
              <Icon className="w-4 h-4 flex-shrink-0" /> {label}
            </a>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold">Embed</p>
            <p className="text-xs" style={{ color: textMut }}>Paste this code into any web page.</p>
          </div>
          <button onClick={() => copyEmbed(embedCode)} className={btn} style={ghost}>
            {embedCopied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy embed code</>}
          </button>
        </div>
        <pre className="overflow-x-auto whitespace-pre rounded-[10px] px-4 py-3 font-mono text-xs leading-relaxed" style={{ background: soft, color: textMut }}>{embedCode}</pre>
      </div>
      <div className="space-y-3">
        <p className="text-[14px] font-semibold">QR code</p>
        <div className="flex flex-wrap items-start gap-5">
          <img src={qrUrl} alt={`QR code for this ${kind}`} className="h-32 w-32 flex-shrink-0 rounded-xl" />
          <div className="space-y-2 pt-1">
            <p className="text-sm" style={{ color: textMut }}>{kind === 'event' ? 'Print or show it at your event so people can scan and open it.' : `Scan to open the ${kind}.`}</p>
            <a href={qrUrl} download={`qr-${form.slug || form.id}.png`} className={btn} style={ghost}>
              <Download className="w-4 h-4" /> Download QR code
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function MoreTab({ form, formUrl, onClone, onStatusChange }: { form: any; formUrl: string; onClone: () => Promise<void>; onStatusChange?: (status: 'draft' | 'published') => void }) {
  const { copied: linkCopied, copy: copyLink } = useCopy();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isCourse = form.config?.isCourse === true;
  const textPrim  = isLight ? '#111'              : '#fff';
  const textMut   = isLight ? '#555'              : '#71717a';
  const divider   = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(63,63,70,0.6)';

  // What this content is called, and whether it gets the wider sharing kit. Courses and virtual
  // experiences sit behind a login, so the link is all they need: pasted anywhere, it shows the
  // cover, title and description. Events and forms are shared widely and keep the social buttons,
  // the embed code and the QR code.
  const isEvent = !!form.config?.eventDetails?.isEvent;
  const isExperience = !!(form.config?.isVirtualExperience || form.config?.isGuidedProject);
  const kind = isExperience ? 'experience' : isCourse ? 'course' : isEvent ? 'event' : 'form';
  const linkOnly = isExperience || isCourse;
  const soft = isLight ? '#F4F6F9' : 'rgba(255,255,255,0.055)';
  const btn = 'inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60 flex-shrink-0';
  const ghost = { background: soft, color: textPrim };
  const group = 'space-y-3 pt-5';
  const groupLine = { borderTop: `1px solid ${divider}` };

  return (
    <div className="w-full max-w-3xl space-y-5" style={{ color: textPrim }}>

      {/* Status first: it is the main thing on this tab */}
      <StatusCard form={form} kind={kind} onStatusChange={onStatusChange} />

      {/* Link */}
      <div className={group} style={groupLine}>
        <p className="text-[14px] font-semibold">Link</p>
        <div className="flex flex-wrap gap-2">
          <input readOnly value={formUrl} aria-label={`Link to this ${kind}`} onFocus={e => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-[10px] px-3 py-2 font-mono text-xs outline-none"
            style={{ background: soft, color: textMut, border: 'none' }} />
          <button onClick={() => copyLink(formUrl)} className={btn} style={ghost}>
            {linkCopied ? 'Copied' : 'Copy'}
          </button>
          <a href={formUrl} target="_blank" rel="noreferrer" className={btn} style={ghost}>
            Open live page
          </a>
        </div>
        {linkOnly && (
          <p className="text-xs" style={{ color: textMut }}>
            Pasted into WhatsApp, LinkedIn or X, the link shows the cover image, title and description.
          </p>
        )}
      </div>

      {/* Events and forms: share buttons, embed code and a QR code for printing */}
      {!linkOnly && (
        <div className={group} style={groupLine}>
          <ShareKit form={form} formUrl={formUrl} kind={kind} />
        </div>
      )}

      {/* Duplicate */}
      <div className={group} style={groupLine}>
        <DuplicateRow kind={kind} onClone={onClone} />
      </div>
    </div>
  );
}

// -- Virtual Experience Report Tab ---
function VirtualExperienceReportTab({ form, onCount }: { form: any; onCount?: (n: number) => void }) {
  const { theme } = useTheme();
  const isDark = theme !== 'light';
  const divider    = isDark ? 'divide-zinc-800/50' : 'divide-[rgba(0,0,0,0.05)]';
  const textPrim   = isDark ? 'text-white' : 'text-[#111]';
  const textMut    = isDark ? 'text-zinc-500' : 'text-[#888]';
  const tableRow   = isDark ? 'hover:bg-zinc-800/20' : 'hover:bg-[#f5f6f7]';

  const cfg     = form.config || {};
  const modules = cfg.modules || [];
  // No raw requirement total here on purpose: per-student counts come from veCompletionCounts, which
  // excludes a skipped optional LinkedIn share. A shared denominator cannot express that, because
  // whether a share counts depends on whether THAT student claimed it.
  // AI review steps count too: their saved reports are only reachable from the Review panel, so an
  // experience whose only reviewed work is, say, a code review still needs the Review column.
  const needsReview = modules.some((m: any) =>
    (m.lessons || []).some((l: any) =>
      (l.requirements || []).some((r: any) => r.type === 'text' || r.type === 'upload' || (r.type === 'deliverable' && r.emailFrame)
        || REVIEW_TYPES.includes(r.type))));
  // A learner has something to review once any task an instructor reviews (written answers, uploads,
  // deliverables, LinkedIn shares, AI reviews) holds their work, or once a review already exists.
  const reviewedTaskIds: string[] = modules.flatMap((m: any) => (m.lessons || []).flatMap((l: any) => (l.requirements || [])
    .filter((r: any) => ['text', 'upload', 'deliverable', 'linkedin_share'].includes(r.type) || REVIEW_TYPES.includes(r.type))
    .map((r: any) => r.id)));
  const hasWorkToReview = (a: any) => !!a.review || reviewedTaskIds.some(id => {
    const p = a.progress?.[id];
    return !!p && (p.completed || !!p.fileUrl || !!p.linkUrl || !!String(p.notes ?? '').trim());
  });

  const [attempts,    setAttempts]    = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [reviewing,   setReviewing]   = useState<any | null>(null);
  const [revScore,    setRevScore]    = useState('');
  const [revFeedback, setRevFeedback] = useState('');
  const [revSaving,   setRevSaving]   = useState(false);
  const [revReports,  setRevReports]  = useState<Record<string, InstructorReportDraft>>({});
  const [revError,    setRevError]    = useState('');
  // Each opening of the panel is a session. An AI draft can finish after the panel was closed,
  // switched to another student, or reopened for the same one; its result and its busy signal are
  // dropped unless they belong to the session still open, so a stale draft never lands on newer work.
  const revSessionRef = useRef(0);
  const [revSession,  setRevSession]  = useState(0);
  const [draftingReqs, setDraftingReqs] = useState<Set<string>>(() => new Set());
  const endReviewSession = () => { revSessionRef.current += 1; };

  const [revRefreshing, setRevRefreshing] = useState(false);

  const fetchAttempts = useCallback(async (): Promise<any[] | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/guided-project-progress?formId=${form.id}`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json.attempts || [];
  }, [form.id]);

  // The list is loaded once, but a student can upload a new file at any time. Reload this student's
  // attempt so the panel shows the files they have now. keepEdits leaves the scores, feedback and
  // reports being written alone: used after a "file replaced" refusal, so nothing typed is lost.
  const refreshReviewing = async (attemptId: string, session: number, keepEdits: boolean) => {
    // A failed reload keeps what the panel already shows rather than leaving it stuck loading.
    const list = await fetchAttempts().catch(() => null);
    if (revSessionRef.current !== session) return;
    const fresh = list?.find(x => x.id === attemptId);
    if (list) setAttempts(list);
    if (fresh) {
      setReviewing(fresh);
      if (!keepEdits) {
        setRevScore(fresh.review?.score ?? '');
        setRevFeedback(fresh.review?.feedback ?? '');
        setRevReports(fresh.review?.reports ?? {});
      }
    }
    setRevRefreshing(false);
  };

  const openReview = (a: any) => {
    revSessionRef.current += 1;
    setRevSession(revSessionRef.current);
    setRevSaving(false);
    setDraftingReqs(new Set());
    setReviewing(a);
    setRevScore(a.review?.score ?? '');
    setRevFeedback(a.review?.feedback ?? '');
    setRevReports(a.review?.reports ?? {});
    setRevError('');
    setRevRefreshing(true);
    void refreshReviewing(a.id, revSessionRef.current, false);
  };

  // After the server says a file was replaced: show the new file, keep what was typed.
  const showLatestFiles = (session: number) => {
    if (!reviewing || revSessionRef.current !== session) return;
    setRevRefreshing(true);
    void refreshReviewing(reviewing.id, session, true);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const list = await fetchAttempts();
      if (list) { setAttempts(list); onCount?.(list.length); }
      setLoading(false);
    };
    load();
  }, [fetchAttempts, onCount]);

  // Reports can take a while to write, so do not drop them on a stray click without asking.
  const closeReview = () => {
    // The save response owns this panel until it finishes. Closing it would let that response land
    // on a later review session, or hide a failure and make the instructor think their work saved.
    if (revSaving) return;
    // The server finishes a running draft (and counts it) whether or not anyone is waiting for it.
    if (draftingReqs.size > 0) {
      if (!window.confirm('An AI draft is still being written. If you close now it will be lost, and it still counts toward your hourly draft limit. Close anyway?')) return;
    } else {
      // Key-order-insensitive: a reloaded review comes back from jsonb with its keys reordered.
      const saved = reviewing?.review;
      const dirty = String(revScore) !== String(saved?.score ?? '')
        || revFeedback !== (saved?.feedback ?? '')
        || !sameReportContent(revReports, saved?.reports ?? {});
      if (dirty && !window.confirm('Discard your unsaved review changes?')) return;
    }
    endReviewSession();
    setReviewing(null);
  };

  const submitReview = async () => {
    if (!reviewing || revSaving) return;
    // Submitting now would save the report as it was before the draft and then discard the draft.
    if (draftingReqs.size > 0 || revRefreshing) return;
    // Number('') is 0, so a blank box would be saved and emailed as 0/100.
    if (String(revScore).trim() === '') {
      setRevError('Enter an overall score (0 to 100).');
      return;
    }
    const overall = Number(revScore);
    if (!Number.isFinite(overall) || overall < 0 || overall > 100) {
      setRevError('The overall score must be between 0 and 100.');
      return;
    }
    // The server drops a report without a score; refuse here so nothing vanishes silently.
    if (Object.values(revReports).some(r => r.score === null)) {
      setRevError('Give every file report a score (0 to 100), or remove it.');
      return;
    }
    const saveSession = revSessionRef.current;
    const attemptId = reviewing.id;
    setRevSaving(true);
    setRevError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (revSessionRef.current !== saveSession) return;
      const res = await fetch('/api/guided-project-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'review', attemptId, score: Number(revScore), feedback: revFeedback, reports: revReports }),
      });
      // A route change or another review session may have replaced this panel while the request was
      // in flight. The save still reached the server, but its result must not touch the newer panel.
      if (revSessionRef.current !== saveSession) return;
      // Keep the panel open on failure so the reports being written are not lost.
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        if (revSessionRef.current !== saveSession) return;
        setRevError(json.error || 'Failed to save. Please try again.');
        if (res.status === 409) showLatestFiles(saveSession);
        return;
      }
      // Keep what the server stored (scores clamped, text trimmed to its limits), not the local copy,
      // so reopening shows exactly what the student sees.
      const json = await res.json().catch(() => ({}));
      if (revSessionRef.current !== saveSession) return;
      setAttempts(prev => prev.map(a => a.id === attemptId ? { ...a, review: json.review ?? { score: Number(revScore), feedback: revFeedback, reports: revReports } } : a));
      setRevSaving(false);
      endReviewSession();
      setReviewing(null);
      setRevScore('');
      setRevFeedback('');
      setRevReports({});
    } catch {
      if (revSessionRef.current === saveSession) {
        setRevError('Network error. Please check your connection and try again.');
      }
    } finally {
      if (revSessionRef.current === saveSession) setRevSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  const completed  = attempts.filter(a => !!a.completed_at).length;
  const inProgress = attempts.filter(a => !!a.started_at && !a.completed_at).length;
  const notStarted = attempts.filter(a => !a.started_at).length;

  const exportCSV = () => {
    const headers = ['Name', 'Email', 'Status', 'Requirements Done', 'Score', 'Last Active'];
    const rows = attempts.map(a => {
      const counts = veCompletionCounts(modules, a.progress ?? {});
      const status = !a.started_at ? 'Not Started' : a.completed_at ? 'Completed' : 'In Progress';
      const score = a.review?.score !== undefined ? `${a.review.score}/100` : '';
      const lastActive = a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '';
      return [a.student_name || '', a.student_email || '', status, `${counts.doneReqs}/${counts.totalReqs}`, score, lastActive];
    });
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${form.title || 've'}-students.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
                    <h2 className={`text-[18px] font-semibold ${textPrim}`}>Learner progress</h2>
          <p className={`mt-1 text-sm ${textMut}`}>Follow progress and review submitted work.</p>
        </div>
        <button onClick={exportCSV}
          className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80 ${isDark ? 'bg-zinc-800 text-zinc-200' : 'bg-[#f3f5f4] text-[#44504a]'}`}>
          Export CSV
        </button>
      </div>
      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Learners',    value: attempts.length },
          { label: 'Not started', value: notStarted },
          { label: 'In progress', value: inProgress },
          { label: 'Completed',   value: completed },
        ].map(s => (
          <div key={s.label} className="rounded-xl px-4 py-3" style={{ background: isDark ? 'rgba(255,255,255,0.055)' : '#F4F6F9' }}>
            <p className={`text-xs font-semibold ${textMut}`}>{s.label}</p>
            <p className={`text-[24px] font-semibold tabular-nums ${textPrim}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={`border-b ${isDark ? 'border-zinc-800' : 'border-[rgba(15,23,42,0.08)]'}`}>
              <tr className={`text-xs ${textMut}`}>
                <th className="px-3 py-2 font-semibold">Learner</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="hidden sm:table-cell px-3 py-2 font-semibold">Tasks</th>
                {needsReview && <th className="hidden sm:table-cell px-3 py-2 font-semibold">Score</th>}
                <th className="hidden sm:table-cell px-3 py-2 font-semibold">Last active</th>
                {needsReview && <th className="px-3 py-2 font-semibold">Review</th>}
              </tr>
            </thead>
            <tbody className={`divide-y ${divider}`}>
              {attempts.map((a, i) => {
                // Shared rule, so a skipped optional LinkedIn share is not reported as outstanding work.
                const counts      = veCompletionCounts(modules, a.progress ?? {});
                const doneReqs    = counts.doneReqs;
                const pct         = veProgressPct(modules, a.progress ?? {});
                const isCompleted = !!a.completed_at;
                const isStarted   = !!a.started_at;
                return (
                  <tr key={a.id ?? `unenrolled-${i}`} className={`transition-colors ${tableRow}`}>
                    <td className="px-3 py-3">
                      <p className={`font-semibold ${textPrim}`}>{a.student_name || a.student_email || 'Unnamed learner'}</p>
                      {a.student_name && a.student_email && <p className={`text-xs ${textMut}`}>{a.student_email}</p>}
                    </td>
                    <td className="px-3 py-3">
                      {isCompleted
                        ? <span className={`inline-flex items-center gap-1 text-xs font-semibold px-3 py-0.5 rounded-full ${isDark ? 'text-emerald-300 ring-1 ring-emerald-400/60' : 'bg-white text-emerald-700 ring-1 ring-emerald-500'}`}><CheckCircle2 className="w-3 h-3" /> Completed</span>
                        : isStarted
                        ? <span className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-0.5 rounded-full ${isDark ? 'text-zinc-300 ring-1 ring-zinc-600' : 'bg-white text-zinc-600 ring-1 ring-zinc-300'}`}><span className="w-1.5 h-1.5 rounded-full bg-current" /> In progress</span>
                        : <span className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-0.5 rounded-full ${isDark ? 'text-zinc-400 ring-1 ring-zinc-700' : 'bg-white text-zinc-500 ring-1 ring-zinc-200'}`}><span className="w-1.5 h-1.5 rounded-full bg-current" /> Not started</span>}
                    </td>
                    <td className="hidden sm:table-cell px-3 py-3">
                      {isStarted ? (
                        <div className="flex items-center gap-2">
                          <div className={`h-1.5 w-20 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#00bf63' }} />
                          </div>
                          <span className={`whitespace-nowrap text-xs tabular-nums ${textMut}`}>{doneReqs} of {counts.totalReqs}</span>
                        </div>
                      ) : (
                        <span className={`text-xs ${textMut}`}>--</span>
                      )}
                    </td>
                    {needsReview && (
                      <td className={`hidden sm:table-cell px-3 py-3 ${textMut}`}>
                        {a.review?.score !== undefined ? <span className="font-bold" style={{ color: '#00873f' }}>{a.review.score}</span> : '-'}
                      </td>
                    )}
                    <td className={`hidden sm:table-cell px-3 py-3 text-sm ${textMut}`}>
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                    </td>
                    {needsReview && (
                      <td className="px-3 py-3">
                        {hasWorkToReview(a) ? (
                          <button onClick={() => openReview(a)}
                            className={`text-sm font-bold transition-opacity hover:opacity-70 ${isDark ? 'text-emerald-300' : 'text-[#00873f]'}`}>
                            {a.review ? 'Edit review' : 'Review'}
                          </button>
                        ) : (
                          <span className={`text-sm ${textMut}`}>{isStarted ? 'Nothing to review yet' : '-'}</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {attempts.length === 0 && (
                <tr><td colSpan={needsReview ? 6 : 4} className={`px-6 py-12 text-center ${textMut}`}>No assigned students or learner activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review modal */}
      {reviewing && (() => {
        const reviewableReqs: { moduleTitle: string; lessonTitle: string; label: string; type: string; reqId: string; rubric?: string[] }[] = [];
        const aiReviewReqs: { moduleTitle: string; lessonTitle: string; label: string; type: string; reqId: string }[] = [];
        modules.forEach((m: any) => {
          (m.lessons || []).forEach((l: any) => {
            (l.requirements || []).forEach((r: any) => {
              // Deliverables are listed too: the older email-style ones let students attach a file.
              if (r.type === 'text' || r.type === 'upload' || r.type === 'deliverable' || r.type === 'linkedin_share') {
                reviewableReqs.push({ moduleTitle: m.title, lessonTitle: l.title, label: r.label || r.description || `Untitled task (${({ text: 'Short answer', upload: 'File upload', deliverable: 'Deliverable', linkedin_share: 'LinkedIn share' } as Record<string, string>)[r.type] || 'task'})`, type: r.type, reqId: r.id, rubric: Array.isArray(r.rubric) ? r.rubric : undefined });
              } else if (REVIEW_TYPES.includes(r.type)) {
                aiReviewReqs.push({ moduleTitle: m.title, lessonTitle: l.title, label: r.label || r.description || REVIEW_LABELS[r.type] || 'AI Review', type: r.type, reqId: r.id });
              }
            });
          });
        });
        // A deliverable only counts as a submission for this student if they attached something, or
        // already has a report that may need removing.
        const visibleReqs = reviewableReqs.filter(r => r.type !== 'deliverable'
          || !!reviewing.progress?.[r.reqId]?.fileUrl || !!reviewing.progress?.[r.reqId]?.linkUrl || !!revReports[r.reqId]);
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className={`rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-[rgba(0,0,0,0.08)]'}`}>
              {/* Header */}
              <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]'}`}>
                <div>
                  <h3 className={`text-base font-semibold ${textPrim}`}>{reviewing.student_name || reviewing.student_email || 'Student'}</h3>
                  {reviewing.student_name && <p className={`text-xs mt-0.5 ${textMut}`}>{reviewing.student_email}</p>}
                </div>
                <button onClick={closeReview} disabled={revSaving}
                  className={`${textMut} disabled:opacity-40 disabled:cursor-not-allowed`} aria-label="Close"><X className="w-4 h-4" /></button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                {revRefreshing && (
                  <p className={`flex items-center gap-2 text-xs ${textMut}`}><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the latest submission</p>
                )}

                {/* Locked while the latest submission loads: the reload replaces the score, feedback and
                    reports, so anything entered (or drafted) before it lands would be silently lost. */}
                <fieldset disabled={revRefreshing || revSaving} className="min-w-0 space-y-5 disabled:opacity-60">
                {/* Student submissions */}
                {visibleReqs.length > 0 && (
                  <div className="space-y-3">
                    <p className={`text-xs font-semibold ${textMut}`}>Submitted work</p>
                    {visibleReqs.map(req => {
                      const entry = reviewing.progress?.[req.reqId];
                      const fileUrl = entry?.fileUrl;
                      const textResponse = entry?.notes;
                      return (
                        <div key={req.reqId} className={`rounded-xl p-4 ${isDark ? 'bg-zinc-800' : 'bg-[#f8f8f5]'}`}>
                          <p className={`text-[12px] mb-0.5 ${textMut}`}>{req.moduleTitle}, {req.lessonTitle}</p>
                          <p className={`text-sm font-medium mb-2 ${textPrim}`}>{req.label}</p>
                          {req.type === 'linkedin_share' ? (
                            entry?.linkUrl
                              ? <a href={entry.linkUrl} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg break-all"
                                  style={{ background: 'rgba(10,102,194,0.1)', color: '#0A66C2' }}>
                                  Open LinkedIn post
                                </a>
                              : <p className={`text-xs italic ${textMut}`}>No post submitted</p>
                          ) : req.type === 'upload' || req.type === 'deliverable' ? (<>
                            {entry?.linkUrl && (
                              <div className="mb-2 space-y-1">
                                <a href={entry.linkUrl} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg break-all"
                                  style={{ background: '#10b98115', color: '#10b981' }}>
                                  Open submitted link
                                </a>
                                {!fileUrl && <p className={`text-xs ${textMut}`}>The student pasted a link instead of uploading a file. File reports need an uploaded file, so give your feedback in the overall review below.</p>}
                              </div>
                            )}
                            {!fileUrl && revReports[req.reqId] && (
                              <div className={`rounded-lg px-3 py-2 text-xs space-y-2 ${isDark ? 'bg-amber-500/10 text-amber-200' : 'bg-amber-50 text-amber-800'}`}>
                                <p>A report was saved for a file this student has since removed. The student can still see it.</p>
                                <button onClick={() => { if (window.confirm('Remove this report?')) setRevReports(prev => { const next = { ...prev }; delete next[req.reqId]; return next; }); }}
                                  className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-current">
                                  Remove report
                                </button>
                              </div>
                            )}
                            {fileUrl
                              ? <>
                                  <a href={repairVeSubmissionUrl(fileUrl)} target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg"
                                    style={{ background: '#10b98115', color: '#10b981' }}>
                                    View uploaded file
                                  </a>
                                  <VeFileReportEditor key={`${revSession}:${req.reqId}`} attemptId={reviewing.id} reqId={req.reqId} fileUrl={fileUrl} title={req.label} rubric={req.rubric} isDark={isDark}
                                    report={revReports[req.reqId] ?? null}
                                    onChange={report => revSessionRef.current === revSession && setRevReports(prev => {
                                      const next = { ...prev };
                                      if (report) next[req.reqId] = report; else delete next[req.reqId];
                                      return next;
                                    })}
                                    onDraftingChange={busy => revSessionRef.current === revSession && setDraftingReqs(prev => {
                                      const next = new Set(prev);
                                      if (busy) next.add(req.reqId); else next.delete(req.reqId);
                                      return next;
                                    })}
                                    onFileReplaced={() => showLatestFiles(revSession)} />
                                </>
                              : !entry?.linkUrl && !revReports[req.reqId] && <p className={`text-xs italic ${textMut}`}>No file submitted</p>}
                          </>) : (
                            textResponse
                              ? <p className={`text-sm leading-relaxed ${textPrim}`}>{textResponse}</p>
                              : <p className={`text-xs italic ${textMut}`}>No response submitted</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* AI review reports */}
                {aiReviewReqs.length > 0 && (
                  <div className="space-y-4">
                    <p className={`text-xs font-semibold ${textMut}`}>AI review reports</p>
                    {aiReviewReqs.map(req => {
                      const entry = reviewing.progress?.[req.reqId];
                      const rec = parseReviewNotes(entry?.notes);
                      return (
                        <div key={req.reqId} className="space-y-2">
                          <p className={`text-[12px] ${textMut}`}>{req.moduleTitle}, {req.lessonTitle}</p>
                          <p className={`text-sm font-medium ${textPrim}`}>{req.label}</p>
                          {rec
                            ? <ReviewReportView rec={{ ...rec, type: rec.type ?? req.type }} isDark={isDark} />
                            : <p className={`text-xs italic ${textMut}`}>No AI review submitted</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Score */}
                <div>
                  <label className={`block text-xs font-semibold mb-2 ${textMut}`}>Score (0 - 100)</label>
                  <input type="number" min={0} max={100} value={revScore} onChange={e => setRevScore(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-[#f8f8f5] border-[rgba(0,0,0,0.1)] text-[#111]'}`} />
                </div>

                {/* Feedback */}
                <div>
                  <label className={`block text-xs font-semibold mb-2 ${textMut}`}>Feedback for student</label>
                  <textarea value={revFeedback} onChange={e => setRevFeedback(e.target.value)} rows={4}
                    placeholder="Write your feedback for the student…"
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none resize-none ${isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-[#f8f8f5] border-[rgba(0,0,0,0.1)] text-[#111]'}`} />
                </div>
                </fieldset>
              </div>

              {/* Footer */}
              {revError && <p role="alert" className="px-6 pt-3 text-xs text-red-500">{revError}</p>}
              <div className={`flex gap-2 px-6 py-4 border-t ${isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]'}`}>
                <button onClick={closeReview} disabled={revSaving}
                  className={`flex-1 py-3 rounded-xl text-sm border disabled:opacity-40 disabled:cursor-not-allowed ${isDark ? 'border-zinc-700 text-zinc-400' : 'border-[rgba(0,0,0,0.1)] text-[#888]'}`}>Cancel</button>
                <button onClick={submitReview} disabled={revSaving || draftingReqs.size > 0 || revRefreshing}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-60"
                  style={{ background: '#00b95c', color: '#ffffff' }}>
                  {revSaving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : draftingReqs.size > 0 ? 'Waiting for AI draft' : 'Save review'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// -- Main Page ---
export default function FormDetailPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [form, setForm] = useState<any>(null);
  const [responses, setResponses] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [courseProgress, setCourseProgress] = useState<any[]>([]);
  const [linkedInShares, setLinkedInShares] = useState<any[]>([]);
  const [cohortStudents, setCohortStudents] = useState<any[]>([]);
  const [formCohorts, setFormCohorts]       = useState<{ id: string; name: string }[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const initialTab = (searchParams.get('tab') as TabId) || 'settings';
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  // Learners on an experience, shown on its Report tab once the report has loaded them.
  const [veLearnerCount, setVeLearnerCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { window.location.href = '/auth'; return; }

      const [{ data: { user } }, { data: profile }, [{ data: courseRow }, { data: eventRow }, { data: veRow }]] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('students').select('role').eq('id', session.user.id).single(),
        Promise.all([
          supabase.from('courses').select('*').eq('id', id as string).maybeSingle(),
          supabase.from('events').select('*').eq('id', id as string).maybeSingle(),
          supabase.from('virtual_experiences').select('*').eq('id', id as string).maybeSingle(),
        ]),
      ]);

      const isEventContent = !!eventRow;
      if (profile?.role === 'staff') {
        setIsStaff(true);
        if (!isEventContent) {
          router.replace('/dashboard#events');
          return;
        }
        if (activeTab !== 'settings') setActiveTab('settings');
      }
      let responseData: any[] | null = null;
      let count: number | null = null;

      if (isEventContent) {
        const { data: regData, count: regCount } = await supabase
          .from('event_registrations')
          .select('*, student:students(id, full_name, email)', { count: 'exact' })
          .eq('event_id', id as string)
          .order('registered_at', { ascending: false })
          .range(0, PAGE_SIZE - 1);
        responseData = (regData ?? []).map((r: any) => ({
          id: r.id,
          created_at: r.registered_at,
          data: {
            name: r.student?.full_name ?? '',
            email: r.student?.email ?? '',
            registered_at: r.registered_at ?? '',
            ...(r.responses ?? {}),
          },
          student: r.student,
        }));
        count = regCount;
      } else {
        const { data: rData, count: rCount } = await supabase
          .from('responses').select('*', { count: 'exact' }).eq('form_id', id as string)
          .order('created_at', { ascending: false }).range(0, PAGE_SIZE - 1);
        responseData = rData;
        count = rCount;
      }

      // Reconstruct form-compatible object with config shape
      let formData: any = null;
      if (courseRow) {
        formData = { ...courseRow, content_type: 'course', config: {
          isCourse: true, title: courseRow.title, description: courseRow.description,
          questions: courseRow.questions ?? [], fields: courseRow.fields ?? [],
          passmark: courseRow.passmark, courseTimer: courseRow.course_timer,
          learnOutcomes: courseRow.learn_outcomes,
          // Partial by design: see app/[id]/page.tsx -- normalizing to a full
          pointsSystem: pointsSystemFromCourseRow(courseRow),
          postSubmission: courseRow.post_submission,
          coverImage: courseRow.cover_image, deadline_days: courseRow.deadline_days,
          theme: courseRow.theme, mode: courseRow.mode, font: courseRow.font, customAccent: courseRow.custom_accent,
        }};
      } else if (eventRow) {
        formData = { ...eventRow, content_type: 'event', config: {
          title: eventRow.title, description: eventRow.description, fields: eventRow.fields ?? [],
          eventDetails: { isEvent: true, date: eventRow.event_date, time: eventRow.event_time,
            timezone: eventRow.timezone, location: eventRow.location, eventType: eventRow.event_type,
            capacity: eventRow.capacity, meetingLink: eventRow.meeting_link, isPrivate: eventRow.is_private,
            speakers: eventRow.speakers ?? [] },
          postSubmission: eventRow.post_submission, coverImage: eventRow.cover_image,
          deadline_days: eventRow.deadline_days, theme: eventRow.theme, mode: eventRow.mode,
          font: eventRow.font, customAccent: eventRow.custom_accent,
        }};
      } else if (veRow) {
        formData = { ...veRow, content_type: 'virtual_experience', config: {
          isVirtualExperience: true, title: veRow.title, description: veRow.description,
          modules: veRow.modules ?? [], industry: veRow.industry, difficulty: veRow.difficulty,
          role: veRow.role, company: veRow.company, duration: veRow.duration, tools: veRow.tools, toolLogos: veRow.tool_logos ?? {},
          tagline: veRow.tagline, background: veRow.background, learnOutcomes: veRow.learn_outcomes,
          managerName: veRow.manager_name, managerTitle: veRow.manager_title,
          guideId: veRow.guide_id, guideSnapshot: veRow.guide_snapshot, dataset: veRow.dataset,
          coverImage: veRow.cover_image, deadline_days: veRow.deadline_days,
          theme: veRow.theme, mode: veRow.mode, font: veRow.font, customAccent: veRow.custom_accent,
          badgeImageUrl: veRow.badge_image_url,
        }};
      }
      if (!user) { window.location.href = '/auth'; return; }
      if (formData) setForm(formData);
      if (responseData) setResponses(responseData);
      setTotalCount(count ?? 0);

      // For courses/VEs: fetch cohort students + cohort names
      const contentCohortIds: string[] = Array.isArray(formData?.cohort_ids) ? formData.cohort_ids : [];
      const isCourseLike = formData?.config?.isCourse || formData?.config?.isVirtualExperience;
      if (isCourseLike && contentCohortIds.length > 0) {
        const [{ data: cohortStudentData }, { data: cohortData }] = await Promise.all([
          supabase
            .from('students')
            .select('id, full_name, email, cohort_id')
            .in('cohort_id', contentCohortIds)
            .eq('role', 'student'),
          supabase
            .from('cohorts')
            .select('id, name')
            .in('id', contentCohortIds),
        ]);
        if (cohortStudentData) setCohortStudents(cohortStudentData);
        if (cohortData) setFormCohorts(cohortData);
      }

      if (formData?.config?.isCourse) {
        const progressRes = await fetch(`/api/course-progress?formId=${encodeURIComponent(id as string)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (progressRes.ok) {
          const progressJson = await progressRes.json();
          setCourseProgress(progressJson.progress ?? []);
        }

        // LinkedIn share claims, only when this course actually has a share slide.
        if ((formData.config.questions ?? []).some((q: any) => q?.isLinkedInShare)) {
          const shareRes = await fetch(`/api/linkedin-share?contentId=${encodeURIComponent(id as string)}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (shareRes.ok) {
            const shareJson = await shareRes.json();
            setLinkedInShares(shareJson.shares ?? []);
          }
        }
      }

      setLoading(false);
    };
    fetchData();
  }, [activeTab, id, router]);

  const fetchPage = async (newPage: number) => {
    setPageLoading(true);
    const from = newPage * PAGE_SIZE;
    const isEventContent = form?.content_type === 'event';
    if (isEventContent) {
      const { data } = await supabase
        .from('event_registrations')
        .select('*, student:students(id, full_name, email)')
        .eq('event_id', id as string)
        .order('registered_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (data) setResponses((data as any[]).map((r: any) => ({
        id: r.id,
        created_at: r.registered_at,
        data: {
          name: r.student?.full_name ?? '',
          email: r.student?.email ?? '',
          registered_at: r.registered_at ?? '',
          ...(r.responses ?? {}),
        },
        student: r.student,
      })));
    } else {
      const { data } = await supabase.from('responses').select('*')
        .eq('form_id', id as string)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (data) setResponses(data);
    }
    setPage(newPage);
    setPageLoading(false);
  };

  const handleExport = () => {
    if (!responses.length || !form) return;
    const allKeys = Array.from(responses.reduce((keys: Set<string>, r: any) => {
      Object.keys(r.data ?? {}).forEach((k: string) => keys.add(k));
      return keys;
    }, new Set<string>()));
    const escape = (val: unknown) => {
      const str = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `"${str.replace(/"/g, '""')}"`;
    };
    const csv = [allKeys.map(escape).join(','), ...responses.map((r: any) => allKeys.map((k: string) => escape((r.data ?? {})[k])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${form.title || 'responses'}.csv`;
    a.click();
  };

  const handleClone = async () => {
    if (!form) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const baseSlug = (form.slug || form.title || 'form')
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 48);
    const uniqueSlug = `${baseSlug}-${Date.now().toString(36)}`;
    // Route clone through the API to hit the correct table
    const { data: { session: cloneSession } } = await supabase.auth.getSession();
    const cloneRes = await fetch('/api/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cloneSession?.access_token}` },
      body: JSON.stringify({
        title: `${form.title} (Copy)`,
        description: form.description,
        config: { ...form.config, title: `${form.config?.title || form.title} (Copy)` },
        slug: uniqueSlug,
        content_type: form.content_type,
        cohort_ids: [],
        status: 'draft',
      }),
    });
    const cloneData = await cloneRes.json();
    if (cloneRes.ok && cloneData?.id) {
      router.push(`/dashboard/${cloneData.id}`);
    } else {
      alert('Clone failed. Please try again.');
    }
  };

  const { theme, toggle: toggleTheme } = useTheme();
  const isLight = theme === 'light';

  const formPath = contentPath({ ...form, slug: form?.slug || (id as string) });
  const formUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${formPath}`
    : formPath;

  const bg       = isLight ? '#F2F5FA' : '#17181E';
  const navBord  = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
  const textPrim = isLight ? '#111' : '#fff';
  const textMut  = isLight ? '#555' : '#71717a';
  const green    = '#00bf63';

  // The dashboard colours, with the shared blue, for the heading's pill and buttons.
  const pageC = isLight ? { ...LIGHT_C, cta: DARK_C.cta } : DARK_C;
  const hdrTextPrim = textPrim;
  const hdrTextMut  = textMut;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}><Loader2 className="w-8 h-8 animate-spin" style={{ color: green }} /></div>;
  }
  if (!form) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: bg, color: textPrim }}><p>Form not found or you don&apos;t have access.</p></div>;
  }

  const type = getFormType(form.config);

  return (
    <main className="min-h-screen font-sans" style={{ background: bg, color: textPrim }}>
      {/* The course editor provides its own focused studio header and actions. */}

      {/* -- Top tab navigation with a full-width content workspace -- */}
      <div className="px-3 sm:px-6 pt-5 pb-10">
        {(() => {
          // Experiences have no Settings tab (they are edited in the experience editor), so a link
          // that lands on the default opens their Report instead of an empty panel.
          // Courses publish from the editor's Publish step, so an old Publish-tab link opens the editor.
          const shownTab: TabId = type === 'virtual_experience' && activeTab === 'settings' ? 'responses'
            : (type === 'course' || type === 'event') && activeTab === 'more' ? 'settings' : activeTab;
          const visibleTabs = TABS.filter(tab => (!isStaff || tab.id === 'settings') && (!tab.courseOnly || type === 'course') && !(tab.id === 'settings' && type === 'virtual_experience') && !(tab.id === 'more' && (type === 'course' || type === 'event')));
          const tabLabel = (tab: typeof TABS[number]) => tab.id === 'responses' && (type === 'course' || type === 'virtual_experience') ? 'Report'
            : tab.id === 'responses' && type === 'event' ? 'Registrations'
            : tab.id === 'settings' && (type === 'course' || type === 'event') ? 'Edit' : tab.label;
          return (
            <div className="max-w-6xl mx-auto flex flex-col">
              {/* The page heading as on the other admin pages: back to the list, the name, its status and
                  key facts, then the buttons. The editor puts its save status and button in the two slots. */}
              <Link href={`/dashboard#${type === 'course' ? 'courses' : type === 'event' ? 'events' : 'virtual_experiences'}`}
                className="inline-flex w-fit items-center gap-2 text-[13px] font-semibold mb-3 no-underline hover:opacity-80" style={{ color: hdrTextMut }}>
                <ArrowLeft className="w-4 h-4" />
                {type === 'course' ? 'All courses' : type === 'event' ? 'All events' : type === 'virtual_experience' ? 'All virtual experiences' : 'Dashboard'}
              </Link>
              {/* Buttons stay at the top right; a long name wraps instead of pushing them down. Phones stack. */}
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 md:flex-1">
                  <h1 className="text-[28px] leading-9 font-semibold break-words" style={{ color: hdrTextPrim, fontFamily: DISPLAY_FONT }}>{form.title}</h1>
                  <div className="mt-2">
                    {form.status === 'published' ? <Pill tone="good" dot C={pageC}>Published</Pill> : <Pill tone="warn" C={pageC}>Draft</Pill>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:flex-shrink-0">
                  {shownTab === 'settings' && (type === 'course' || type === 'event') && <span id="editor-save-status" className="contents" />}
                  {type === 'virtual_experience' ? (
                    <Link href={`/create/guided-project?id=${form.id}`} className={`${btnClass} no-underline`} style={btnStyle('sec', pageC)}>
                      <Pencil className="w-4 h-4" />Edit
                    </Link>
                  ) : type === 'course' || type === 'event' ? null : (
                    <button type="button" onClick={() => setActiveTab('settings')} className={btnClass} style={btnStyle('sec', pageC)}>
                      <Pencil className="w-4 h-4" />Edit
                    </button>
                  )}
                  <a href={formUrl} target="_blank" rel="noreferrer" className={`${btnClass} no-underline`} style={btnStyle('sec', pageC)}>
                    <ExternalLink className="w-4 h-4" />View
                  </a>
                  {!isStaff && (
                    <button type="button" onClick={() => exportContent(form)} className={btnClass} style={btnStyle('sec', pageC)} title="Download this as a file you can import into another workspace">
                      <Download className="w-4 h-4" />Export
                    </button>
                  )}
                  {shownTab === 'settings' && (type === 'course' || type === 'event') && <span id="editor-save-button" className="contents" />}
                  <button type="button" onClick={toggleTheme} aria-label="Switch light or dark" title="Switch light or dark"
                    className="grid h-10 w-10 place-items-center rounded-xl transition-opacity hover:opacity-80" style={{ color: hdrTextMut }}>
                    {isLight ? <Moon className="w-4 h-4"/> : <Sun className="w-4 h-4"/>}
                  </button>
                </div>
              </div>
              <nav className="flex items-center gap-6 overflow-x-auto mt-5" aria-label="Content dashboard sections" style={{ scrollbarWidth: 'none', borderBottom: `1px solid ${navBord}` }}>
                {visibleTabs.map(tab => {
                  const isActive = shownTab === tab.id;
                  const count = tab.id === 'responses' ? (type === 'virtual_experience' ? veLearnerCount : totalCount) : 0;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className="flex items-center gap-2 whitespace-nowrap pb-3 text-left text-sm transition-colors"
                      style={{ color: isActive ? hdrTextPrim : hdrTextMut, fontWeight: 600, borderBottom: `2px solid ${isActive ? DARK_C.cta : 'transparent'}`, marginBottom: -1 }}
                    >
                      <span>{tabLabel(tab)}</span>
                      {count > 0 && (
                        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold" style={{ background: pageC.pill, color: hdrTextMut }}>{count}</span>
                      )}
                    </button>
                  );
                })}
              </nav>
              <div className="w-full min-w-0">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={shownTab}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                  {shownTab === 'settings' && type !== 'virtual_experience' ? (
                    <FormEditor formId={id as string} contentType={type === 'course' ? 'course' : 'event'}
                      {...(!isStaff && (type === 'course' || type === 'event') ? {
                        // Publishing lives in the editor's Publish step (staff never had the Publish tab).
                        publishControls: ({ ready, unsaved }) => (
                          <StatusCard form={form} kind={type} ready={ready} unsaved={unsaved}
                            onStatusChange={(status) => setForm((f: any) => ({ ...f, status }))} />
                        ),
                        publishShare: type === 'event' ? <ShareKit form={form} formUrl={formUrl} kind="event" /> : undefined,
                        publishFooter: <DuplicateRow kind={type} onClone={handleClone} />,
                      } : {})} />
                  ) : (
                    <div className={(shownTab === 'responses' && type === 'course') || shownTab === 'leaderboard' ? 'mt-4 w-full' : 'mt-4 rounded-2xl px-4 sm:px-6 py-6 sm:py-8 w-full'}
                      style={(shownTab === 'responses' && type === 'course') || shownTab === 'leaderboard' ? undefined : { background: isLight ? '#ffffff' : '#1E1F26' }}>
                      {shownTab === 'responses' && type !== 'virtual_experience' && (
                        <ResponsesTab
                          form={form}
                          responses={responses}
                          totalCount={totalCount}
                          page={page}
                          pageLoading={pageLoading}
                          onExport={handleExport}
                          onPageChange={fetchPage}
                          courseProgress={courseProgress}
                          cohortStudents={cohortStudents}
                          linkedInShares={linkedInShares}
                        />
                      )}
                      {shownTab === 'responses' && type === 'virtual_experience' && (
                        <VirtualExperienceReportTab form={form} onCount={setVeLearnerCount} />
                      )}
                      {shownTab === 'leaderboard' && (
                        <LeaderboardTab courseProgress={courseProgress} />
                      )}
                      {shownTab === 'email' && (
                        <EmailTab form={form} formUrl={formUrl} courseProgress={courseProgress} cohortStudents={cohortStudents} formCohorts={formCohorts} />
                      )}
                      {shownTab === 'more' && (
                        <MoreTab
                          form={form}
                          formUrl={formUrl}
                          onClone={handleClone}
                          onStatusChange={(status) => setForm((f: any) => ({ ...f, status }))}
                        />
                      )}
                    </div>
                  )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          );
        })()}
      </div>
    </main>
  );
}
