'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2, ArrowLeft, Download, CheckCircle2, XCircle, Users, Trophy,
  TrendingUp, BarChart2, BarChart3, Settings, MoreHorizontal,
  Copy, Check, ExternalLink, Code2, GitFork, QrCode, Edit2,
  AlignLeft, HelpCircle, CalendarDays, Share2, Mail, Send, Bell,
  Award, Upload, Trash2, RefreshCw, Link as LinkIcon, Sun, Moon, Sparkles, X,
  ChevronDown,
} from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import FormEditor from '@/components/FormEditor';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { veProgressPct, veCompletionCounts } from '@/lib/ve-completion';
import { courseProgressCounts, courseProgressPct } from '@/lib/course-progress';
import { ReviewReportView, LegacyReviewSummary, REVIEW_TYPES, REVIEW_LABELS } from '@/components/ReviewReportView';
import { parseReviewNotes } from '@/lib/reviewRecord';
import { pointsSystemFromCourseRow } from '@/lib/course-schema';

// -- Lazy charts ---
const ResponsesOverTimeChart = dynamic(
  () => import('@/components/InsightCharts').then(m => ({ default: m.ResponsesOverTimeChart })),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center"><Loader2 className="w-5 h-5 text-zinc-600 animate-spin" /></div> }
);

const PAGE_SIZE = 50;

function downloadJSON(data: any, name: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(name || 'export').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportContent(form: any) {
  downloadJSON({
    exportVersion: 1,
    type: form.content_type,
    title: form.title,
    exportedAt: new Date().toISOString(),
    config: form.config,
  }, form.title);
}

type TabId = 'responses' | 'settings' | 'more' | 'email' | 'leaderboard';

const TABS: { id: TabId; label: string; Icon: any; courseOnly?: boolean }[] = [
  { id: 'settings',     label: 'Settings',     Icon: Settings                       },
  { id: 'responses',    label: 'Responses',    Icon: BarChart3                      },
  { id: 'leaderboard',  label: 'Leaderboard',  Icon: Trophy,   courseOnly: true     },
  { id: 'email',        label: 'Email',        Icon: Mail                           },
  { id: 'more',         label: 'More',         Icon: MoreHorizontal                 },
];

function getFormType(config: any): 'course' | 'event' | 'form' | 'virtual_experience' {
  if (config?.isVirtualExperience || config?.isGuidedProject) return 'virtual_experience';
  if (config?.isCourse) return 'course';
  if (config?.eventDetails?.isEvent) return 'event';
  return 'form';
}

const TYPE_META = {
  course:          { label: 'Course',          Icon: HelpCircle,  color: '#f59e0b', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  event:           { label: 'Event',           Icon: CalendarDays, color: '#1f1bc3', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20'   },
  form:            { label: 'Form',            Icon: AlignLeft,   color: '#10b981', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  virtual_experience:  { label: 'Virtual Experience',  Icon: Award,       color: '#6366f1', badge: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' },
};

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
    const passmark = form.config?.passmark ?? 50;
    const completedAttempts = courseProgress.filter((p: any) => p.completed);
    const passedAttempts = completedAttempts.filter((p: any) => p.passed);
    const passRate = completedAttempts.length ? Math.round((passedAttempts.length / completedAttempts.length) * 100) : 0;
    const avgScore = completedAttempts.length
      ? Math.round(completedAttempts.reduce((sum: number, p: any) => sum + (p.score ?? 0), 0) / completedAttempts.length)
      : null;
    const topScore = completedAttempts.length ? Math.max(...completedAttempts.map((p: any) => p.score ?? 0)) : 0;

    // Share slides carry a post URL, not an answer, so they would always read as 0% correct.
    const questionStats = questions.filter((q: any) => !q.isLinkedInShare).map((q: any) => {
      const answered = completedAttempts.filter((p: any) => p.answers?.[q.id]);
      const correct = answered.filter((p: any) => {
        const answer = p.answers?.[q.id];
        if ((q.type ?? '') === 'sql_exercise') {
          try {
            const parsed = typeof answer === 'string' ? JSON.parse(answer) : answer;
            return !!parsed?.passed && !parsed?.skipped && !parsed?.solutionViewed;
          } catch {
            return false;
          }
        }
        if ((q.type ?? '') === 'python_exercise') {
          try {
            const parsed = typeof answer === 'string' ? JSON.parse(answer) : answer;
            return !!parsed?.passed && !!parsed?.proof && !parsed?.skipped && !parsed?.solutionViewed;
          } catch {
            return false;
          }
        }
        if (q.type === 'document_review') {
          try { const p = JSON.parse(answer); return p?.completed === true; } catch { return answer === 'completed'; }
        }
        if (['code_review', 'excel_review', 'dashboard_critique', 'written_response'].includes(q.type)) return answer === 'completed';
        if (q.type === 'fill_blank') {
          const accepted = (q.correctAnswer ?? '').split('|').map((s: string) => s.trim().toLowerCase());
          return accepted.includes(String(answer).trim().toLowerCase());
        }
        return answer === q.correctAnswer;
      }).length;
      const label = q.question || q.title || q.lesson?.title || 'Lesson';
      return {
        question: label.length > 30 ? `${label.slice(0, 30)}...` : label,
        fullQuestion: label,
        correct, incorrect: answered.length - correct, total: answered.length,
        pct: answered.length ? Math.round((correct / answered.length) * 100) : 0,
      };
    });

    // Build enrolled student list: combine completed + in-progress (courseProgress) + not started (cohorts)
    const completedByEmail = new Map<string, any>();
    for (const p of courseProgress.filter(p => p.completed)) {
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
    const totalEnrolled = completedByEmail.size + inProgressStudents.length + notStartedStudents.length;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: courseAccent }}>Course insights</p>
            <h2 className={`mt-1 text-xl font-bold sm:text-2xl ${textPrim}`}>Learning performance</h2>
            <p className={`mt-1 max-w-2xl text-sm leading-relaxed ${textMut}`}>Track participation, scores, question performance, and learner progress in one place.</p>
          </div>
          <button onClick={onExport} className={`flex min-h-10 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-opacity hover:opacity-70 ${textSub}`} style={{ background: isDark ? 'rgba(255,255,255,0.05)' : '#f5f6f7' }}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Started',    value: totalEnrolled || '--',                                Icon: Users,      color: '#8b5cf6' },
            { label: 'Avg Score',  value: avgScore !== null ? `${avgScore}%` : '--',             Icon: BarChart2,   color: '#00a4ef' },
            { label: 'Pass Rate',  value: completedAttempts.length ? `${passRate}%` : '--',      Icon: TrendingUp,  color: '#10b981' },
            { label: 'Top Score',  value: completedAttempts.length ? `${topScore}%` : '--',      Icon: Trophy,      color: '#f59e0b' },
          ].map(({ label, value, Icon, color }) => (
            <div key={label} className={`relative overflow-hidden border rounded-2xl p-5 ${card}`}>
              <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: color }} />
              <div className="flex items-center gap-2 mb-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${color}14` }}><Icon className="w-4 h-4" style={{ color }} /></span>
                <span className={`text-xs font-medium uppercase tracking-wide ${textMut}`}>{label}</span>
              </div>
              <p className={`text-3xl font-bold ${textPrim}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Per-question breakdown */}
        {completedAttempts.length > 0 && (
          <div className={`border rounded-3xl overflow-hidden ${card}`}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${cardHeader}`}>
              <h3 className={`text-base font-semibold ${textPrim}`}>Question Breakdown</h3>
              <span className={`text-[11px] font-medium ${textMut}`}>{questionStats.length} items</span>
            </div>
            <div className={`divide-y ${dividerCls}`}>
              {questionStats.map((q: any, i: number) => (
                <div key={i} className="px-3 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
                  <span className={`text-xs font-mono w-5 flex-shrink-0 ${textMut}`}>Q{i + 1}</span>
                  <p className={`flex-1 text-sm min-w-0 ${textSub}`}>{q.fullQuestion}</p>
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> {q.correct}</span>
                    <span className="flex items-center gap-1 text-xs text-rose-400"><XCircle className="w-3.5 h-3.5" /> {q.incorrect}</span>
                    <span className="text-xs font-semibold w-10 text-right" style={{ color: q.pct >= 50 ? '#10b981' : '#f43f5e' }}>{q.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LinkedIn shares -- post URLs are only pattern-checked, so spot-check them by hand. */}
        {shares.length > 0 && (
          <div className={`rounded-3xl border overflow-hidden ${card}`}>
            <div className={`px-6 py-4 border-b ${cardHeader}`}>
              <h3 className={`text-base font-semibold flex items-center gap-2 ${textPrim}`}>
                <LinkedInIcon className="w-4 h-4" style={{ color: '#0A66C2' }} /> LinkedIn Shares
              </h3>
              <p className={`text-xs mt-0.5 ${textMut}`}>
                Each link was checked when submitted: a real LinkedIn post URL, naming the profile saved
                on that student&apos;s account, and not already claimed. That is a consistency check and a
                deterrent, not proof the LinkedIn account belongs to them -- and it says nothing about
                whether the post is still live.
              </p>
            </div>
            <div className={`divide-y ${dividerCls}`}>
              {shares.map((s: any) => (
                <div key={s.id} className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${textPrim}`}>
                      {s.studentName || s.studentEmail || 'Unknown'}
                    </p>
                    <a href={s.postUrl} target="_blank" rel="noreferrer"
                      className="text-xs break-all hover:underline" style={{ color: '#0A66C2' }}>
                      {s.postUrl}
                    </a>
                  </div>
                  <span className={`text-[11px] font-medium flex-shrink-0 ${textMut}`}>
                    {s.points > 0 ? `${s.points} XP` : 'Recorded'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submissions table */}
        <div className={`rounded-3xl border overflow-hidden ${card}`}>
          <div className={`px-6 py-4 border-b ${cardHeader}`}>
            <h3 className={`text-base font-semibold ${textPrim}`}>Student Submissions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className={`border-b ${tableHead}`}>
                <tr>
                  <th className="px-3 sm:px-6 py-3 font-medium">Student</th>
                  <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Email</th>
                  <th className="px-3 sm:px-6 py-3 font-medium">Score</th>
                  <th className="px-3 sm:px-6 py-3 font-medium">Result</th>
                  <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${dividerCls}`}>
                {(() => {
                  return completedAttempts.map((p: any) => {
                    const pct = p.score ?? 0;
                    const pass = p.passed ?? pct >= passmark;
                    return (
                      <tr key={`${p.student_id}_${p.attempt_number}`} className={`transition-colors ${tableRow}`}>
                        <td className={`px-3 sm:px-6 py-3 font-medium ${textPrim}`}>{p.student_name || <span className={`italic ${textMut}`}>Unknown</span>}</td>
                        <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 ${textMut}`}>{p.student_email || '--'}</td>
                        <td className="px-3 sm:px-6 py-3">
                          <span className={`font-semibold ${textPrim}`}>{pct}%</span>
                        </td>
                        <td className="px-3 sm:px-6 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${pass ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                            {pass ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {pass ? 'Passed' : 'Failed'}
                          </span>
                        </td>
                        <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 whitespace-nowrap text-xs ${textMut}`}>{p.updated_at ? new Date(p.updated_at).toLocaleString() : '--'}</td>
                      </tr>
                    );
                  });
                })()}
                {completedAttempts.length === 0 && (
                  <tr><td colSpan={5} className={`px-6 py-12 text-center ${textMut}`}>No completed attempts yet. Share the course link to get started!</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Enrolled Students */}
        {(totalEnrolled > 0 || courseProgress.length > 0 || notStartedStudents.length > 0) && (
          <div className={`rounded-3xl border overflow-hidden ${card}`}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${cardHeader}`}>
              <div>
                <h3 className={`text-base font-semibold ${textPrim}`}>Students</h3>
                <p className={`text-xs mt-0.5 ${textMut}`}>{notStartedStudents.length} not started · {inProgressStudents.length} in progress · {completedByEmail.size} completed</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-[#f1f2f3] text-[#555]'}`}>
                {totalEnrolled} total
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className={`border-b ${tableHead}`}>
                  <tr>
                    <th className="px-3 sm:px-6 py-3 font-medium">Student</th>
                    <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Email</th>
                    <th className="px-3 sm:px-6 py-3 font-medium">Status</th>
                    <th className="px-3 sm:px-6 py-3 font-medium">Progress</th>
                    <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Last Active</th>
                    {hasReview && <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Reports</th>}
                  </tr>
                </thead>
                <tbody className={`divide-y ${dividerCls}`}>
                  {/* Not started students (assigned via cohort but haven't begun) */}
                  {notStartedStudents.map((s: any) => (
                    <tr key={`ns_${s.id}`} className={`transition-colors ${tableRow}`}>
                      <td className={`px-3 sm:px-6 py-3 font-medium ${textPrim}`}>{s.full_name || <span className={`italic ${textMut}`}>Unknown</span>}</td>
                      <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 ${textMut}`}>{s.email || '--'}</td>
                      <td className="px-3 sm:px-6 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${isDark ? 'bg-zinc-700/60 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                          Not Started
                        </span>
                      </td>
                      <td className="px-3 sm:px-6 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`h-1.5 w-16 sm:w-20 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                            <div className="h-full rounded-full bg-zinc-400" style={{ width: '0%' }} />
                          </div>
                          <span className={`text-xs ${textMut}`}>0/{questions.length || 0}</span>
                        </div>
                      </td>
                      <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 whitespace-nowrap text-xs ${textMut}`}>--</td>
                      {hasReview && <td className="hidden sm:table-cell px-3 sm:px-6 py-3">--</td>}
                    </tr>
                  ))}
                  {/* In-progress students */}
                  {inProgressStudents.map((p: any) => {
                    // Shared rule: slide-index over raw length both ignored section dividers and
                    // counted an optional share this student may have skipped.
                    const progressCounts = courseProgressCounts(questions, p.answers ?? {});
                    const progressPct = courseProgressPct(questions, p.answers ?? {});
                    const submittedDocs = reviewQuestions.filter((q: any) => {
                      const ans = p.answers?.[q.id];
                      if (!ans) return false;
                      return ans === 'completed' || ans === 'failed';
                    });
                    return (
                      <tr key={`ip_${p.student_email}`} className={`transition-colors ${tableRow}`}>
                        <td className={`px-3 sm:px-6 py-3 font-medium ${textPrim}`}>{p.student_name || <span className={`italic ${textMut}`}>Unknown</span>}</td>
                        <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 ${textMut}`}>{p.student_email || '--'}</td>
                        <td className="px-3 sm:px-6 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${isDark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            In Progress
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`h-1.5 w-16 sm:w-20 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                              <div className="h-full rounded-full bg-amber-400" style={{ width: `${progressPct}%` }} />
                            </div>
                            <span className={`text-xs ${textMut}`}>{progressCounts.done}/{progressCounts.total}</span>
                          </div>
                        </td>
                        <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 whitespace-nowrap text-xs ${textMut}`}>
                          {p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
                        </td>
                        {hasReview && (
                          <td className="hidden sm:table-cell px-3 sm:px-6 py-3">
                            {submittedDocs.length > 0
                              ? <button onClick={() => setReviewStudent({ ...p, reviewQs: reviewQuestions })} className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                                  View {submittedDocs.length}
                                </button>
                              : <span className={`text-xs ${textMut}`}>--</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {/* Completed students */}
                  {[...completedByEmail.values()].map((p: any) => {
                    const pct = p.score ?? 0;
                    const pass = p.passed ?? false;
                    const submittedDocs = reviewQuestions.filter((q: any) => {
                      const ans = p.answers?.[q.id];
                      if (!ans) return false;
                      return ans === 'completed' || ans === 'failed';
                    });
                    return (
                      <tr key={`cp_${p.student_email}`} className={`transition-colors ${tableRow}`}>
                        <td className={`px-3 sm:px-6 py-3 font-medium ${textPrim}`}>{p.student_name || <span className={`italic ${textMut}`}>Unknown</span>}</td>
                        <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 ${textMut}`}>{p.student_email || '--'}</td>
                        <td className="px-3 sm:px-6 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${pass ? (isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700') : (isDark ? 'bg-rose-500/15 text-rose-300' : 'bg-rose-50 text-rose-700')}`}>
                            {pass ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {pass ? 'Passed' : 'Failed'}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`h-1.5 w-16 sm:w-20 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pass ? '#10b981' : '#f43f5e' }} />
                            </div>
                            <span className={`text-xs ${textMut}`}>{pct}%</span>
                          </div>
                        </td>
                        <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 whitespace-nowrap text-xs ${textMut}`}>
                          {p.updated_at ? new Date(p.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
                        </td>
                        {hasReview && (
                          <td className="hidden sm:table-cell px-3 sm:px-6 py-3">
                            {submittedDocs.length > 0
                              ? <button onClick={() => setReviewStudent({ ...p, reviewQs: reviewQuestions })} className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                                  View {submittedDocs.length}
                                </button>
                              : <span className={`text-xs ${textMut}`}>--</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {totalEnrolled === 0 && (
                    <tr><td colSpan={hasReview ? 6 : 5} className={`px-6 py-12 text-center ${textMut}`}>No students enrolled yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>Below minimum</span>
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
    const fillPercent = capacity > 0 ? Math.min(100, Math.round((totalCount / capacity) * 100)) : 100;
    const progressWidth = totalCount > 0 ? Math.max(fillPercent, 8) : 0;
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
    const spotsLeft = capacity > 0 ? Math.max(capacity - totalCount, 0) : null;

    return (
      <>
        <div className="space-y-6">
          <div className={`overflow-hidden rounded-[28px] border ${card}`}>
            <div className={isDark ? 'bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_40%),linear-gradient(180deg,rgba(24,24,27,0.98),rgba(24,24,27,0.9))] p-6 sm:p-7' : 'bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_40%),linear-gradient(180deg,#ffffff,#f8fafc)] p-6 sm:p-7'}>
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${isDark ? 'bg-emerald-500/12 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}>
                      Event responses
                    </span>
                    <div>
                      <p className={`text-4xl font-semibold tracking-tight ${textPrim}`}>{totalCount}</p>
                      <p className={`mt-1 text-sm ${textMut}`}>
                        {capacity > 0 ? `${fillPercent}% of capacity claimed` : 'Registered participants'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:min-w-[280px]">
                    <div className={`rounded-2xl px-4 py-3 ${isDark ? 'bg-white/5' : 'bg-white/85 shadow-sm'}`}>
                      <p className={`text-[11px] font-medium uppercase tracking-[0.18em] ${textMut}`}>Capacity</p>
                      <p className={`mt-2 text-xl font-semibold ${textPrim}`}>{capacity > 0 ? capacity : 'Open'}</p>
                    </div>
                    <div className={`rounded-2xl px-4 py-3 ${isDark ? 'bg-white/5' : 'bg-white/85 shadow-sm'}`}>
                      <p className={`text-[11px] font-medium uppercase tracking-[0.18em] ${textMut}`}>Remaining</p>
                      <p className={`mt-2 text-xl font-semibold ${textPrim}`}>{spotsLeft !== null ? spotsLeft : '--'}</p>
                    </div>
                  </div>
                </div>

                <div className="max-w-2xl">
                  <div className={`relative h-2.5 overflow-hidden rounded-full ${isDark ? 'bg-white/8' : 'bg-[#ebe7de]'}`}>
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${progressWidth}%`,
                        background: 'linear-gradient(90deg, #10b981 0%, #34d399 45%, #6ee7b7 100%)',
                      }}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className={`text-sm ${textMut}`}>Participant occupancy</p>
                    <p className={`text-sm font-medium ${textPrim}`}>
                      {capacity > 0 ? `${totalCount} / ${capacity}` : `${totalCount} registered`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={onExport}
                    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition-colors ${isDark ? 'bg-white/6 text-white hover:bg-white/10' : 'bg-white text-[#111] shadow-sm hover:bg-[#f5f6f7] border border-[rgba(0,0,0,0.07)]'}`}
                  >
                    <Download className="w-4 h-4" /> Export participants
                  </button>
                  <p className={`text-sm ${textMut}`}>Select a participant to see the full registration response.</p>
                </div>
              </div>
            </div>
          </div>

          <div className={`rounded-[28px] border ${card}`}>
            <div className={`flex items-center justify-between gap-3 border-b px-6 py-5 ${cardHeader}`}>
              <div>
                <h3 className={`text-base font-semibold ${textPrim}`}>Participants</h3>
                <p className={`mt-1 text-sm ${textMut}`}>A focused view of who registered and when they joined.</p>
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
                        <p className={`mt-0.5 text-xs truncate sm:hidden ${textMut}`}>{r.participantEmail}</p>
                        <p className={`mt-1 text-xs ${textMut}`}>Open response details</p>
                      </div>
                      <p className={`hidden sm:block truncate text-sm min-w-0 flex-1 ${textSub}`}>{r.participantEmail}</p>
                      <p className={`text-right text-xs font-medium flex-shrink-0 ${textMut}`}>{r.submittedDate}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className={`px-6 py-16 text-center ${textMut}`}>No participants yet. Share your event to start collecting registrations.</div>
              )}
            </div>
            <Pagination totalCount={totalCount} page={page} pageLoading={pageLoading} onPageChange={onPageChange} isDark={isDark} />
          </div>

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
                    <h3 className={`text-base font-semibold ${textPrim}`}>Session Attendance</h3>
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
                              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${pct >= 75 ? (isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-700') : (isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-[#f1f2f3] text-[#666]')}`}>
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
                        <h3 className={`truncate text-xl font-bold leading-tight ${textPrim}`}>{pName}</h3>
                        <p className={`mt-0.5 truncate text-sm ${textMut}`}>{pEmail === '--' ? 'No email provided' : pEmail}</p>
                        <span
                          className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
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
                          className="rounded-2xl px-3 py-2.5 text-center"
                          style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }}
                        >
                          <p className={`text-[10px] font-semibold uppercase tracking-widest ${textMut}`}>{label}</p>
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
                        className="rounded-2xl px-4 py-3.5"
                        style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}
                      >
                        <p className={`text-[10px] font-semibold uppercase tracking-widest ${textMut}`}>{formatFieldLabel(String(key))}</p>
                        <p className={`mt-1.5 text-sm font-medium leading-relaxed break-words ${textPrim}`}>
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
          <p className={`text-3xl font-bold ${textPrim}`}>{totalCount}</p>
        </div>
        <div className={`border rounded-2xl p-5 ${card}`}>
          <div className="flex items-center gap-2 mb-3"><AlignLeft className="w-4 h-4 text-blue-500" /><span className={`text-xs uppercase tracking-wide font-medium ${textMut}`}>Fields</span></div>
          <p className={`text-3xl font-bold ${textPrim}`}>{fields.length}</p>
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
          <button onClick={onExport} className={`flex items-center gap-1.5 text-xs transition-colors hover:opacity-60 ${textMut}`}>
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
        <button onClick={() => onPageChange(page - 1)} disabled={page === 0 || pageLoading} className={`px-3 py-1.5 rounded-lg text-xs disabled:opacity-30 transition-colors ${btnStyle}`}>Previous</button>
        <button onClick={() => onPageChange(page + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCount || pageLoading} className={`px-3 py-1.5 rounded-lg text-xs disabled:opacity-30 transition-colors ${btnStyle}`}>Next</button>
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
      const filtered = selectedCohortId === 'all' ? veAttempts : veAttempts.filter((a: any) => a.cohort_id === selectedCohortId);
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
  const [blasting, setBlasting]         = useState(false);
  const [blastResult, setBlastResult]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [blastTone, setBlastTone]       = useState<'friendly' | 'professional' | 'casual'>('friendly');
  const [blastPurpose, setBlastPurpose] = useState(isEvent ? 'event update' : 'course update');
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
      const eventBannerUrl = cfg.coverImage
        ? (/^https?:\/\//i.test(cfg.coverImage)
            ? cfg.coverImage
            : `${window.location.origin}/api/og/${form.id}`)
        : undefined;
      let payload: any = { type: quickType, to: quickTo, data: { formUrl } };
      if (isCourse || isVE) {
        // Course / VE: send a test blast to this single address
        if (!blastSubject.trim() || !blastBody.trim()) {
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

  const handleBlast = async () => {
    if (!blastSubject.trim() || !blastBody.trim()) {
      setBlastResult({ ok: false, msg: 'Subject and body are required.' });
      return;
    }
    setBlasting(true);
    setBlastResult(null);
    try {
      const eventBannerUrl = cfg.coverImage
        ? (/^https?:\/\//i.test(cfg.coverImage)
            ? cfg.coverImage
            : `${window.location.origin}/api/og/${form.id}`)
        : undefined;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({
          type: 'blast',
          data: {
            formId: form.id,
            subject: blastSubject,
            body: blastBody,
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
          },
        }),
      });
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
      setBlastBody(data.body || '');
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
      const eventBannerUrl = cfg.coverImage
        ? (/^https?:\/\//i.test(cfg.coverImage)
            ? cfg.coverImage
            : `${window.location.origin}/api/og/${form.id}`)
        : undefined;
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
  const card = isDark
    ? 'overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/35'
    : 'overflow-hidden rounded-2xl border border-[rgba(0,0,0,0.07)] bg-white';

  const cardHeader = isDark
    ? 'px-6 py-4 border-b border-zinc-800 flex items-center gap-3'
    : 'px-6 py-4 border-b border-[rgba(0,0,0,0.06)] flex items-center gap-3';

  const cardTitle = isDark ? 'text-sm font-semibold text-white' : 'text-sm font-semibold text-gray-900';
  const cardSub   = isDark ? 'text-xs text-zinc-500 mt-0.5' : 'text-xs text-gray-400 mt-0.5';

  const label = isDark
    ? 'block text-xs font-medium text-zinc-400 mb-1.5'
    : 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';

  const input = isDark
    ? 'w-full bg-zinc-800/60 border border-zinc-700/60 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20 transition-all'
    : 'w-full bg-[#f5f6f7] border border-[rgba(0,0,0,0.07)] rounded-xl px-4 py-3 text-sm text-[#111] placeholder:text-[#aaa] focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/20 transition-all';

  const textarea = `${input} resize-none leading-relaxed`;

  const primaryBtn = 'w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed';

  const feedback = (ok: boolean) => ok
    ? (isDark
        ? 'flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
        : 'flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm bg-emerald-50 border border-emerald-200 text-emerald-700')
    : (isDark
        ? 'flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm bg-rose-500/10 border border-rose-500/20 text-rose-400'
        : 'flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-600');

  const sectionIconBg = 'p-2 rounded-lg';

  return (
    <div className="w-full space-y-4 py-2">
      <div className="pb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: courseAccent }}>Communication</p>
        <h2 className={isDark ? 'mt-1 text-xl font-bold text-white sm:text-2xl' : 'mt-1 text-xl font-bold text-gray-900 sm:text-2xl'}>Email studio</h2>
        <p className={isDark ? 'mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500' : 'mt-1 max-w-2xl text-sm leading-relaxed text-gray-400'}>Compose updates, target learners by progress, and test every message before sending.</p>
      </div>

      {/* -- Blast Email -- */}
      <div className={card}>
        <div className={cardHeader}>
          <div className={sectionIconBg} style={{ background: `${courseAccent}14` }}>
            <Mail className="w-4 h-4" style={{ color: courseAccent }} />
          </div>
          <div>
            <p className={cardTitle}>Broadcast Email</p>
            <p className={cardSub}>
              {isEvent
                ? 'Send a message to all registrants with an email address'
                : (isCourse || isVE)
                  ? 'Send a message to enrolled students filtered by their progress'
                  : 'Send a message to all respondents with an email address'}
            </p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {(isCourse || isVE) && formCohorts.length > 0 && (
            <div>
              <label className={label}>Cohort</label>
              <div className="flex flex-wrap gap-2">
                {[{ id: 'all', name: 'All Cohorts' }, ...formCohorts].map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedCohortId(c.id); setBlastResult(null); }}
                    className="rounded-xl border px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-75"
                    style={{
                      borderColor: selectedCohortId === c.id ? `${courseAccent}55` : isDark ? 'rgba(63,63,70,0.6)' : 'rgba(0,0,0,0.07)',
                      background: selectedCohortId === c.id ? `${courseAccent}12` : 'transparent',
                      color: selectedCohortId === c.id ? courseAccent : isDark ? '#71717a' : '#888',
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(isCourse || isVE) && (
            <div>
              <label className={label}>Audience</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {([
                  { value: 'all',         label: 'All Enrolled'  },
                  { value: 'not_started', label: 'Not Started'   },
                  { value: 'in_progress', label: 'In Progress'   },
                  { value: 'completed',   label: 'Completed'     },
                  { value: 'failed',      label: 'Failed'        },
                ] as const).map(seg => {
                  const count = segmentCounts?.[seg.value];
                  const active = blastSegment === seg.value;
                  return (
                    <button
                      key={seg.value}
                      onClick={() => { setBlastSegment(seg.value); setBlastResult(null); }}
                      className="flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 text-xs font-semibold transition-opacity hover:opacity-75"
                      style={{
                        borderColor: active ? `${courseAccent}55` : isDark ? 'rgba(63,63,70,0.6)' : 'rgba(0,0,0,0.07)',
                        background: active ? `${courseAccent}12` : 'transparent',
                        color: active ? courseAccent : isDark ? '#71717a' : '#888',
                      }}
                    >
                      {count !== undefined && (
                        <span className={`text-base font-bold leading-none ${active ? '' : isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                          {count}
                        </span>
                      )}
                      <span>{seg.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className={isDark ? 'rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-3' : 'rounded-xl border border-[rgba(0,0,0,0.07)] bg-[#f5f6f7] p-4 space-y-3'}>
            <div className="flex items-start gap-3">
              <div className={sectionIconBg} style={{ background: `${courseAccent}14` }}>
                <Sparkles className="w-4 h-4" style={{ color: courseAccent }} />
              </div>
              <div className="min-w-0">
                <p className={cardTitle}>AI Draft</p>
                <p className={cardSub}>Generate the subject and message for your broadcast email.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Tone</label>
                <select
                  value={blastTone}
                  onChange={e => setBlastTone(e.target.value as 'friendly' | 'professional' | 'casual')}
                  className={input}
                >
                  <option value="friendly">Friendly</option>
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                </select>
              </div>
              <div>
                <label className={label}>Purpose</label>
                <input
                  type="text"
                  value={blastPurpose}
                  onChange={e => setBlastPurpose(e.target.value)}
                  placeholder="e.g. reminder, venue change, last call"
                  className={input}
                />
              </div>
            </div>
            <div>
              <label className={label}>Extra instructions</label>
              <textarea
                value={blastPrompt}
                onChange={e => setBlastPrompt(e.target.value)}
                placeholder="Optional: mention urgency, promo angle, what attendees should do next, or any details to emphasize."
                rows={3}
                className={textarea}
              />
            </div>
            {blastAiResult && (
              <div className={feedback(blastAiResult.ok)}>
                {blastAiResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                <span>{blastAiResult.msg}</span>
              </div>
            )}
            <button
              onClick={handleGenerateBroadcastEmail}
              disabled={blastAiLoading}
              className={primaryBtn}
              style={{ background: courseAccent }}
            >
              {blastAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Generate Broadcast Email</>}
            </button>
          </div>

          <div>
            <label className={label}>Subject</label>
            <input
              type="text"
              value={blastSubject}
              onChange={e => { setBlastSubject(e.target.value); setBlastResult(null); }}
              placeholder="e.g. Important update about your registration"
              className={input}
            />
          </div>
          <div>
            <label className={label}>Message</label>
            <textarea
              value={blastBody}
              onChange={e => { setBlastBody(e.target.value); setBlastResult(null); }}
              placeholder="Write your message here..."
              rows={5}
              className={textarea}
            />
          </div>
          <div className={isDark ? 'rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-xs text-zinc-500' : 'rounded-xl border border-[rgba(0,0,0,0.07)] bg-[#f5f6f7] px-4 py-3 text-xs text-[#888]'}>
            Available tags: <code>{'{{name}}'}</code>, <code>{'{{email}}'}</code>, <code>{'{{form_title}}'}</code>, <code>{'{{event_title}}'}</code>, <code>{'{{event_date}}'}</code>, <code>{'{{event_time}}'}</code>, <code>{'{{event_timezone}}'}</code>, <code>{'{{event_location}}'}</code>, <code>{'{{meeting_link}}'}</code>, <code>{'{{form_url}}'}</code>
          </div>
          {blastResult && (
            <div className={feedback(blastResult.ok)}>
              {blastResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
              <span>{blastResult.msg}</span>
            </div>
          )}
          <button
            onClick={handleBlast}
            disabled={blasting || !blastSubject.trim() || !blastBody.trim()}
            className={primaryBtn}
            style={{ background: courseAccent }}
          >
            {blasting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Send className="w-4 h-4" /> Send to {(isCourse || isVE) && segmentCounts ? `${segmentCounts[blastSegment]} student${segmentCounts[blastSegment] !== 1 ? 's' : ''}` : 'all'}</>}
          </button>
          <p className={isDark ? 'text-xs text-zinc-600 text-center' : 'text-xs text-gray-400 text-center'}>
            {(isCourse || isVE)
              ? 'Only enrolled students with an email address will receive this.'
              : 'Only recipients who provided an email address will receive this.'}
          </p>
        </div>
      </div>

      {/* -- Event Reminder (bulk) -- */}
      {isEvent && (
        <div className={card}>
          <div className={cardHeader}>
            <div className={sectionIconBg} style={{ background: `${courseAccent}14` }}>
              <Bell className="w-4 h-4" style={{ color: courseAccent }} />
            </div>
            <div>
              <p className={cardTitle}>Event Reminder</p>
              <p className={cardSub}>Notify all registrants about the upcoming event</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['24hr', '1hr'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setReminderType(t)}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    reminderType === t
                      ? isDark
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : isDark
                        ? 'border-zinc-700/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400'
                        : 'border-[rgba(0,0,0,0.07)] text-[#888] hover:border-[rgba(0,0,0,0.14)] hover:text-[#555] bg-white'
                  }`}
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
              style={{ background: courseAccent }}
            >
              {reminding ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send {reminderType === '1hr' ? '1-Hour' : '24-Hour'} Reminder</>}
            </button>
          </div>
        </div>
      )}

      {/* -- Send Now (Quick Send) -- */}
      <div className={card}>
        <div className={cardHeader}>
          <div className={sectionIconBg} style={{ background: `${courseAccent}14` }}>
            <Send className="w-4 h-4" style={{ color: courseAccent }} />
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
        <div className="p-6 space-y-4">
          <div>
            <label className={label}>Recipient Email</label>
            <input
              type="email"
              value={quickTo}
              onChange={e => { setQuickTo(e.target.value); setQuickResult(null); }}
              placeholder="recipient@example.com"
              className={input}
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
                    className={`py-2.5 px-3 rounded-xl text-xs font-medium border transition-all text-left ${
                      quickType === t.value
                        ? isDark
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : isDark
                          ? 'border-zinc-700/60 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400'
                          : 'border-[rgba(0,0,0,0.07)] text-[#888] hover:border-[rgba(0,0,0,0.14)] hover:text-[#555] bg-white'
                    }`}
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
            style={{ background: courseAccent }}
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
    </div>
  );
}

// -- Leaderboard Tab ---
function LeaderboardTab({ form, courseProgress }: { form: any; courseProgress: any[] }) {
  const { theme } = useTheme();
  const isDark = theme !== 'light';
  const courseAccent = form.config?.customAccent || COURSE_THEME_ACCENTS[form.config?.theme] || '#00bf63';

  const passmark = form.config?.passmark ?? 50;
  const totalQ   = form.config?.questions?.length ?? 1;

  // Only show completed attempts, sorted by score desc then points desc
  const rows = courseProgress
    .filter(p => p.completed)
    .map(p => ({ ...p, pct: p.score ?? 0 }))
    .sort((a, b) => b.pct - a.pct || (b.points ?? 0) - (a.points ?? 0));

  const passCount = rows.filter(r => r.passed).length;
  const avgPct    = rows.length ? Math.round(rows.reduce((s, r) => s + r.pct, 0) / rows.length) : 0;

  const rankStyle = (rank: number) => {
    if (rank === 1) return { color: '#f59e0b', glow: '0 0 12px rgba(245,158,11,0.4)' };
    if (rank === 2) return { color: '#cbd5e1', glow: '0 0 8px rgba(203,213,225,0.3)' };
    if (rank === 3) return { color: '#cd7c3b', glow: '0 0 8px rgba(205,124,59,0.3)' };
    return { color: isDark ? '#52525b' : '#a1a1aa', glow: 'none' };
  };

  const bg   = isDark ? 'bg-zinc-900/35' : 'bg-white';
  const bdr  = isDark ? 'border-zinc-800/60' : 'border-zinc-200';
  const txt  = isDark ? 'text-white'         : 'text-zinc-900';
  const muted = isDark ? 'text-zinc-500'     : 'text-zinc-400';

  if (rows.length === 0) return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: courseAccent }}>Achievement</p>
        <h2 className={`mt-1 text-xl font-bold sm:text-2xl ${txt}`}>Course leaderboard</h2>
        <p className={`mt-1 max-w-2xl text-sm leading-relaxed ${muted}`}>Celebrate completed attempts and compare scores and earned XP.</p>
      </div>
      <div className={`rounded-2xl border p-16 text-center ${bg} ${bdr}`}>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl" style={{ background: `${courseAccent}12`, color: courseAccent }}><Trophy className="h-5 w-5" /></span>
        <p className={`mt-4 font-semibold ${txt}`}>No completions yet</p>
        <p className={`text-sm mt-1 ${muted}`}>The leaderboard will populate once students complete the course.</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: courseAccent }}>Achievement</p>
        <h2 className={`mt-1 text-xl font-bold sm:text-2xl ${txt}`}>Course leaderboard</h2>
        <p className={`mt-1 max-w-2xl text-sm leading-relaxed ${muted}`}>Celebrate completed attempts and compare scores and earned XP.</p>
      </div>

      {/* -- Stats bar -- */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Completions', value: rows.length, color: '#6366f1' },
          { label: 'Avg Score', value: `${avgPct}%`, color: '#10b981' },
          { label: 'Pass Rate', value: rows.length ? `${Math.round((passCount / rows.length) * 100)}%` : '--', color: '#f59e0b' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`relative overflow-hidden rounded-2xl border px-5 py-4 ${bg} ${bdr}`}>
            <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: color }} />
            <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color }}>{label}</p>
            <p className={`text-2xl font-black mt-1 ${txt}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* -- Table -- */}
      <div className={`rounded-2xl border overflow-hidden ${bg} ${bdr}`}>

        {/* Header */}
        <div className={`grid items-center px-3 sm:px-5 py-3 border-b grid-cols-[36px_1fr_80px] sm:grid-cols-[44px_1fr_120px_88px] ${bdr}`}>
          <span className={`text-[11px] font-semibold uppercase tracking-widest ${muted}`}>Rank</span>
          <span className={`text-[11px] font-semibold uppercase tracking-widest ${muted}`}>Student</span>
          <span className={`text-[11px] font-semibold uppercase tracking-widest ${muted}`}>Score</span>
          <span className={`hidden sm:block text-[11px] font-semibold uppercase tracking-widest ${muted}`}>XP</span>
        </div>

        {rows.map((r, i) => {
          const rank   = i + 1;
          const name   = r.student_name || 'Unknown';
          const pct    = r.pct;
          const pts    = r.points ?? 0;
          const passed = r.passed ?? false;
          const rs     = rankStyle(rank);
          const isTop  = rank <= 3;

          return (
            <div
              key={i}
              className={`grid items-center px-3 sm:px-5 py-3 sm:py-4 border-b last:border-0 transition-all duration-150 group grid-cols-[36px_1fr_80px] sm:grid-cols-[44px_1fr_120px_88px] ${isDark ? 'border-zinc-800/40 hover:bg-zinc-900/80' : 'border-zinc-100 hover:bg-zinc-50'} ${rank === 1 ? (isDark ? 'bg-amber-500/[0.04]' : 'bg-amber-50/60') : ''}`}
            >
              {/* Rank */}
              <div className="flex items-center justify-start">
                <span
                  className="text-sm font-black tabular-nums"
                  style={{ color: rs.color, textShadow: rs.glow }}
                >
                  {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
                </span>
              </div>

              {/* Student */}
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-black"
                  style={{
                    background: isTop ? `${rs.color}22` : isDark ? '#27272a' : '#f4f4f5',
                    color: isTop ? rs.color : isDark ? '#71717a' : '#a1a1aa',
                    boxShadow: isTop ? `0 0 0 1.5px ${rs.color}44` : 'none',
                  }}
                >
                  {name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${txt}`}>{name}</p>
                </div>
              </div>

              {/* Score + bar */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-bold tabular-nums ${passed ? 'text-emerald-400' : muted}`}>{pct}%</span>
                </div>
                <div className={`h-1 rounded-full overflow-hidden ${isDark ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: passed ? '#10b981' : '#f43f5e' }}
                  />
                </div>
              </div>

              {/* XP */}
              <div className="hidden sm:block">
                {pts > 0 ? (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${isDark ? 'bg-yellow-500/10 text-yellow-400' : 'bg-yellow-50 text-yellow-600'}`}>
                    ⭐ {pts.toLocaleString()}
                  </span>
                ) : (
                  <span className={`text-xs ${muted}`}>--</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// -- More Tab ---
function MoreTab({ form, formUrl, onClone, onStatusChange }: { form: any; formUrl: string; onClone: () => Promise<void>; onStatusChange?: (status: 'draft' | 'published') => void }) {
  const { copied: linkCopied, copy: copyLink } = useCopy();
  const { copied: embedCopied, copy: copyEmbed } = useCopy();
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusWarning, setStatusWarning] = useState('');
  const [currentStatus, setCurrentStatus] = useState<'draft' | 'published'>(form?.status ?? 'published');
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isCourse = form.config?.isCourse === true;
  const contentLabel = isCourse ? 'course' : 'form';
  const courseAccent = form.config?.customAccent || COURSE_THEME_ACCENTS[form.config?.theme] || '#00bf63';
  const textPrim  = isLight ? '#111'              : '#fff';
  const textMut   = isLight ? '#555'              : '#71717a';
  const divider   = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(63,63,70,0.6)';
  const inputBg   = isLight ? '#f0fdf4'           : '#18181b';
  const inputBord = isLight ? '#d1d5db'           : '#3f3f46';
  const btnBg     = isLight ? '#f3f4f6'           : '#27272a';
  const btnBord   = isLight ? 'rgba(0,0,0,0.10)'  : '#3f3f46';
  const codeBg    = isLight ? '#f3f4f6'           : '#18181b';
  const panelStyle = { background: isLight ? '#ffffff' : 'rgba(24,24,27,0.48)', border: `1px solid ${divider}` };

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
    }
    setStatusUpdating(false);
  };

  const handleClone = async () => {
    setCloning(true);
    await onClone();
    setCloning(false);
    setCloned(true);
    setTimeout(() => setCloned(false), 3000);
  };

  return (
    <div className="w-full space-y-4" style={{ color: textPrim }}>
      <div className="pb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: courseAccent }}>Course tools</p>
        <h2 className="mt-1 text-xl font-bold sm:text-2xl" style={{ color: textPrim }}>Manage &amp; distribute</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: textMut }}>Control publishing, duplicate the course, and access every sharing format.</p>
      </div>
      {/* Publish status */}
      <div className="flex items-center justify-between gap-4 rounded-2xl p-5 sm:p-6" style={panelStyle}>
        <div className="flex items-center gap-3">
          {currentStatus === 'published'
            ? <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            : <AlignLeft className="w-5 h-5 text-amber-400 flex-shrink-0" />}
          <div>
            <p className="text-base font-semibold" style={{ color: textPrim }}>
              {currentStatus === 'published' ? 'Published' : 'Draft'}
            </p>
            <p className="text-sm mt-0.5" style={{ color: textMut }}>
              {currentStatus === 'published'
                ? 'Visible to assigned students'
                : 'Hidden from students -- publish when ready'}
            </p>
          </div>
        </div>
        <button
          onClick={() => handleStatusToggle(currentStatus === 'published' ? 'draft' : 'published')}
          disabled={statusUpdating}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all border disabled:opacity-60 flex-shrink-0"
          style={currentStatus === 'published'
            ? { borderColor: 'rgba(251,191,36,0.3)', color: '#fbbf24' }
            : { borderColor: 'rgba(52,211,153,0.3)', color: '#34d399' }}
        >
          {statusUpdating
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : currentStatus === 'published'
              ? 'Move to Draft'
              : 'Publish'}
        </button>
      </div>
      {statusWarning && (
        <p className="text-xs px-1 pt-2 pb-1" style={{ color: '#f59e0b' }}>{statusWarning}</p>
      )}

      {/* Clone */}
      <div className="flex items-center justify-between gap-4 rounded-2xl p-5 sm:p-6" style={panelStyle}>
        <div className="flex items-center gap-3">
          <GitFork className="w-5 h-5 text-violet-400 flex-shrink-0" />
          <div>
            <p className="text-base font-semibold" style={{ color: textPrim }}>Clone {isCourse ? 'Course' : 'Form'}</p>
            <p className="text-sm mt-0.5" style={{ color: textMut }}>Duplicate this {contentLabel} as a new draft</p>
          </div>
        </div>
        <button
          onClick={handleClone}
          disabled={cloning || cloned}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all border disabled:opacity-60 flex-shrink-0"
          style={cloned ? { borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' } : { borderColor: 'rgba(139,92,246,0.3)', color: '#a78bfa' }}
        >
          {cloning ? <Loader2 className="w-4 h-4 animate-spin" /> : cloned ? <><Check className="w-4 h-4" /> Cloned!</> : <><GitFork className="w-4 h-4" /> Clone</>}
        </button>
      </div>

      {/* Share link */}
      <div className="space-y-3 rounded-2xl p-5 sm:p-6" style={panelStyle}>
        <div className="flex items-center gap-3 mb-3">
          <Share2 className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <div>
            <p className="text-base font-semibold" style={{ color: textPrim }}>Share Link</p>
            <p className="text-sm mt-0.5" style={{ color: textMut }}>Copy the direct URL</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl overflow-hidden" style={{ background: inputBg, border: `1px solid ${inputBord}` }}>
          <span className="flex-1 text-sm px-3 py-2.5 truncate font-mono" style={{ color: textMut }}>{formUrl}</span>
          <button
            onClick={() => copyLink(formUrl)}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors flex-shrink-0 hover:opacity-80"
            style={{ background: btnBg, color: textPrim, borderLeft: `1px solid ${inputBord}` }}
          >
            {linkCopied ? <><Check className="w-4 h-4 text-emerald-400" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy</>}
          </button>
        </div>
      </div>

      {/* Social share */}
      <div className="space-y-3 rounded-2xl p-5 sm:p-6" style={panelStyle}>
        <div className="flex items-center gap-3">
          <Share2 className="w-5 h-5 text-pink-400 flex-shrink-0" />
          <div>
            <p className="text-base font-semibold" style={{ color: textPrim }}>Share on Social</p>
            <p className="text-sm mt-0.5" style={{ color: textMut }}>Spread the word on your favourite platforms</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {socialLinks.map(({ label, href, Icon, color, bg, border }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold border transition-all hover:opacity-90 active:scale-[0.97]"
              style={{ background: bg, borderColor: border, color }}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </a>
          ))}
        </div>
      </div>

      {/* HTML Embed */}
      <div className="space-y-3 rounded-2xl p-5 sm:p-6" style={panelStyle}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Code2 className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-base font-semibold" style={{ color: textPrim }}>HTML Embed</p>
              <p className="text-sm mt-0.5" style={{ color: textMut }}>Drop this snippet into any webpage</p>
            </div>
          </div>
          <button
            onClick={() => copyEmbed(embedCode)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex-shrink-0 hover:opacity-80"
            style={{ border: `1px solid ${btnBord}`, background: btnBg, color: textMut }}
          >
            {embedCopied ? <><Check className="w-4 h-4 text-emerald-400" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy</>}
          </button>
        </div>
        <pre className="rounded-xl px-4 py-3.5 text-sm font-mono overflow-x-auto whitespace-pre leading-relaxed"
          style={{ background: codeBg, border: `1px solid ${inputBord}`, color: textMut }}>
          {embedCode}
        </pre>
      </div>

      {/* QR Code */}
      <div className="space-y-3 rounded-2xl p-5 sm:p-6" style={panelStyle}>
        <div className="flex items-center gap-3">
          <QrCode className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-base font-semibold" style={{ color: textPrim }}>QR Code</p>
            <p className="text-sm mt-0.5" style={{ color: textMut }}>Scan to open the {contentLabel}</p>
          </div>
        </div>
        <div className="flex items-start gap-5">
          <img src={qrUrl} alt="QR Code" className="w-32 h-32 rounded-xl flex-shrink-0" style={{ border: `1px solid ${inputBord}` }} />
          <div className="space-y-2 pt-1">
            <p className="text-sm leading-relaxed" style={{ color: textMut }}>Print or display at your event. Attendees scan to open instantly.</p>
            <a href={qrUrl} download={`qr-${form.slug || form.id}.png`} className="inline-flex items-center gap-1.5 text-sm transition-colors hover:opacity-70" style={{ color: textMut }}>
              <Download className="w-4 h-4" /> Download QR
            </a>
          </div>
        </div>
      </div>

      {/* Open live */}
      <div className="flex items-center justify-between gap-4 rounded-2xl p-5 sm:p-6" style={panelStyle}>
        <div className="flex items-center gap-3">
          <ExternalLink className="w-5 h-5 flex-shrink-0" style={{ color: textMut }} />
          <div>
            <p className="text-base font-semibold" style={{ color: textPrim }}>Open Live Page</p>
            <p className="text-sm mt-0.5" style={{ color: textMut }}>View as respondents see it</p>
          </div>
        </div>
        <a
          href={formUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex-shrink-0 hover:opacity-80"
          style={{ border: `1px solid ${btnBord}`, background: btnBg, color: textPrim }}
        >
          <ExternalLink className="w-4 h-4" /> Open
        </a>
      </div>
    </div>
  );
}

// -- Virtual Experience Report Tab ---
function VirtualExperienceReportTab({ form }: { form: any }) {
  const { theme } = useTheme();
  const isDark = theme !== 'light';
  const card       = isDark ? 'bg-zinc-900/50 border-zinc-800/50' : 'bg-white border-[rgba(0,0,0,0.07)]';
  const cardHeader = isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]';
  const divider    = isDark ? 'divide-zinc-800/50' : 'divide-[rgba(0,0,0,0.05)]';
  const textPrim   = isDark ? 'text-white' : 'text-[#111]';
  const textMut    = isDark ? 'text-zinc-500' : 'text-[#888]';
  const tableHead  = isDark ? 'bg-zinc-950 text-zinc-400 border-zinc-800' : 'bg-[#f5f6f7] text-[#888] border-[rgba(0,0,0,0.06)]';
  const tableRow   = isDark ? 'hover:bg-zinc-800/20' : 'hover:bg-[#f5f6f7]';

  const cfg     = form.config || {};
  const modules = cfg.modules || [];
  // No raw requirement total here on purpose: per-student counts come from veCompletionCounts, which
  // excludes a skipped optional LinkedIn share. A shared denominator cannot express that, because
  // whether a share counts depends on whether THAT student claimed it.
  const needsReview = modules.some((m: any) =>
    (m.lessons || []).some((l: any) =>
      (l.requirements || []).some((r: any) => r.type === 'text' || r.type === 'upload')));

  const [attempts,    setAttempts]    = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [reviewing,   setReviewing]   = useState<any | null>(null);
  const [revScore,    setRevScore]    = useState('');
  const [revFeedback, setRevFeedback] = useState('');
  const [revSaving,   setRevSaving]   = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/guided-project-progress?formId=${form.id}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setAttempts(json.attempts || []);
      }
      setLoading(false);
    };
    load();
  }, [form.id]);

  const submitReview = async () => {
    if (!reviewing) return;
    setRevSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    await fetch('/api/guided-project-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'review', attemptId: reviewing.id, score: Number(revScore), feedback: revFeedback }),
    });
    setAttempts(prev => prev.map(a => a.id === reviewing.id ? { ...a, review: { score: Number(revScore), feedback: revFeedback } } : a));
    setReviewing(null);
    setRevScore('');
    setRevFeedback('');
    setRevSaving(false);
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
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-20" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-500">Experience report</p>
          </div>
          <h2 className={`mt-1 text-xl font-bold ${textPrim}`}>Learner progress</h2>
          <p className={`mt-1 text-sm ${textMut}`}>Track progress, review submitted work, and provide feedback.</p>
        </div>
        <button onClick={exportCSV}
          className={`flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-opacity hover:opacity-80 ${isDark ? 'bg-zinc-800 text-zinc-200' : 'bg-[#f3f5f4] text-[#44504a]'}`}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>
      {/* Stats */}
      <div className={`grid grid-cols-2 overflow-hidden rounded-2xl border sm:grid-cols-4 ${card}`}>
        {[
          { label: 'Total Enrolled', value: attempts.length, color: '#00b95c' },
          { label: 'Not Started',    value: notStarted,       color: '#6b7280' },
          { label: 'In Progress',    value: inProgress,       color: '#f59e0b' },
          { label: 'Completed',      value: completed,        color: '#10b981' },
        ].map(s => (
          <div key={s.label} className={`p-4 sm:p-5 [&:not(:last-child)]:border-r ${isDark ? 'border-zinc-800/70' : 'border-[rgba(0,0,0,0.06)]'}`}>
            <p className={`text-xs font-medium uppercase tracking-wide mb-3 ${textMut}`}>{s.label}</p>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className={`rounded-2xl border overflow-hidden ${card}`}>
        <div className={`px-6 py-4 border-b flex items-center justify-between ${cardHeader}`}>
          <h3 className={`text-base font-semibold ${textPrim}`}>Student Progress</h3>
          <span className={`text-xs ${textMut}`}>{attempts.length} learner{attempts.length === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={`border-b ${tableHead}`}>
              <tr>
                <th className="px-3 sm:px-6 py-3 font-medium">Student</th>
                <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Email</th>
                <th className="px-3 sm:px-6 py-3 font-medium">Status</th>
                <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Requirements</th>
                {needsReview && <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Score</th>}
                <th className="hidden sm:table-cell px-3 sm:px-6 py-3 font-medium">Last Active</th>
                {needsReview && <th className="px-3 sm:px-6 py-3 font-medium">Review</th>}
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
                    <td className={`px-3 sm:px-6 py-3 font-medium ${textPrim}`}>{a.student_name || '--'}</td>
                    <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 ${textMut}`}>{a.student_email || '--'}</td>
                    <td className="px-3 sm:px-6 py-3">
                      {isCompleted
                        ? <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}><CheckCircle2 className="w-3 h-3" /> Completed</span>
                        : isStarted
                        ? <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${isDark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-50 text-amber-700'}`}><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> In Progress</span>
                        : <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}><span className="w-1.5 h-1.5 rounded-full bg-zinc-400" /> Not Started</span>}
                    </td>
                    <td className="hidden sm:table-cell px-3 sm:px-6 py-3">
                      {isStarted ? (
                        <div className="flex items-center gap-2">
                          <div className={`h-1.5 w-20 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#10b981' }} />
                          </div>
                          <span className={`text-xs ${textMut}`}>{doneReqs}/{counts.totalReqs}</span>
                        </div>
                      ) : (
                        <span className={`text-xs ${textMut}`}>--</span>
                      )}
                    </td>
                    {needsReview && (
                      <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 ${textMut}`}>
                        {a.review?.score !== undefined ? <span className="font-semibold" style={{ color: '#10b981' }}>{a.review.score}/100</span> : '--'}
                      </td>
                    )}
                    <td className={`hidden sm:table-cell px-3 sm:px-6 py-3 text-xs ${textMut}`}>
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}
                    </td>
                    {needsReview && (
                      <td className="px-3 sm:px-6 py-3">
                        {isStarted ? (
                          <button onClick={() => { setReviewing(a); setRevScore(a.review?.score ?? ''); setRevFeedback(a.review?.feedback ?? ''); }}
                            className={`text-xs font-medium px-3 py-1.5 rounded-xl transition-all hover:opacity-80 ${isDark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}>
                            {a.review ? 'Edit Review' : 'Review'}
                          </button>
                        ) : (
                          <span className={`text-xs ${textMut}`}>--</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {attempts.length === 0 && (
                <tr><td colSpan={needsReview ? 7 : 5} className={`px-6 py-12 text-center ${textMut}`}>No students enrolled in this virtual experience yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review modal */}
      {reviewing && (() => {
        const reviewableReqs: { moduleTitle: string; lessonTitle: string; label: string; type: string; reqId: string }[] = [];
        const aiReviewReqs: { moduleTitle: string; lessonTitle: string; label: string; type: string; reqId: string }[] = [];
        modules.forEach((m: any) => {
          (m.lessons || []).forEach((l: any) => {
            (l.requirements || []).forEach((r: any) => {
              if (r.type === 'text' || r.type === 'upload' || r.type === 'linkedin_share') {
                reviewableReqs.push({ moduleTitle: m.title, lessonTitle: l.title, label: r.label || r.description || 'Requirement', type: r.type, reqId: r.id });
              } else if (REVIEW_TYPES.includes(r.type)) {
                aiReviewReqs.push({ moduleTitle: m.title, lessonTitle: l.title, label: r.label || r.description || REVIEW_LABELS[r.type] || 'AI Review', type: r.type, reqId: r.id });
              }
            });
          });
        });
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className={`rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-[rgba(0,0,0,0.08)]'}`}>
              {/* Header */}
              <div className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]'}`}>
                <div>
                  <h3 className={`text-base font-semibold ${textPrim}`}>{reviewing.student_name || reviewing.student_email || 'Student'}</h3>
                  {reviewing.student_name && <p className={`text-xs mt-0.5 ${textMut}`}>{reviewing.student_email}</p>}
                </div>
                <button onClick={() => setReviewing(null)} className={textMut}><X className="w-4 h-4" /></button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

                {/* Student submissions */}
                {reviewableReqs.length > 0 && (
                  <div className="space-y-3">
                    <p className={`text-[11px] font-bold uppercase tracking-widest ${textMut}`}>Student Submissions</p>
                    {reviewableReqs.map(req => {
                      const entry = reviewing.progress?.[req.reqId];
                      const fileUrl = entry?.fileUrl;
                      const textResponse = entry?.notes;
                      return (
                        <div key={req.reqId} className={`rounded-xl p-4 ${isDark ? 'bg-zinc-800' : 'bg-[#f8f8f5]'}`}>
                          <p className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${textMut}`}>{req.moduleTitle} - {req.lessonTitle}</p>
                          <p className={`text-sm font-medium mb-2 ${textPrim}`}>{req.label}</p>
                          {req.type === 'linkedin_share' ? (
                            entry?.linkUrl
                              ? <a href={entry.linkUrl} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg break-all"
                                  style={{ background: 'rgba(10,102,194,0.1)', color: '#0A66C2' }}>
                                  Open LinkedIn post
                                </a>
                              : <p className={`text-xs italic ${textMut}`}>No post submitted</p>
                          ) : req.type === 'upload' ? (
                            fileUrl
                              ? <a href={fileUrl} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
                                  style={{ background: '#10b98115', color: '#10b981' }}>
                                  View uploaded file
                                </a>
                              : <p className={`text-xs italic ${textMut}`}>No file submitted</p>
                          ) : (
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
                    <p className={`text-[11px] font-bold uppercase tracking-widest ${textMut}`}>AI Review Reports</p>
                    {aiReviewReqs.map(req => {
                      const entry = reviewing.progress?.[req.reqId];
                      const rec = parseReviewNotes(entry?.notes);
                      return (
                        <div key={req.reqId} className="space-y-2">
                          <p className={`text-[11px] font-semibold uppercase tracking-wide ${textMut}`}>{req.moduleTitle} - {req.lessonTitle}</p>
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
                  <label className={`block text-xs font-semibold mb-1.5 ${textMut}`}>Score (0 - 100)</label>
                  <input type="number" min={0} max={100} value={revScore} onChange={e => setRevScore(e.target.value)}
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none ${isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-[#f8f8f5] border-[rgba(0,0,0,0.1)] text-[#111]'}`} />
                </div>

                {/* Feedback */}
                <div>
                  <label className={`block text-xs font-semibold mb-1.5 ${textMut}`}>Feedback for student</label>
                  <textarea value={revFeedback} onChange={e => setRevFeedback(e.target.value)} rows={4}
                    placeholder="Write your feedback for the student…"
                    className={`w-full px-3 py-2 rounded-xl border text-sm outline-none resize-none ${isDark ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-[#f8f8f5] border-[rgba(0,0,0,0.1)] text-[#111]'}`} />
                </div>
              </div>

              {/* Footer */}
              <div className={`flex gap-2 px-6 py-4 border-t ${isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]'}`}>
                <button onClick={() => setReviewing(null)} className={`flex-1 py-2.5 rounded-xl text-sm border ${isDark ? 'border-zinc-700 text-zinc-400' : 'border-[rgba(0,0,0,0.1)] text-[#888]'}`}>Cancel</button>
                <button onClick={submitReview} disabled={revSaving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-80"
                  style={{ background: '#00b95c' }}>
                  {revSaving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Submit Review'}
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
  const { logoUrl, logoDarkUrl } = useTenant();
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
          isShortCourse: !!veRow.is_short_course, badgeImageUrl: veRow.badge_image_url,
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

  const formUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${form?.slug || id}`
    : `/${form?.slug || id}`;

  const bg       = isLight ? '#F2F5FA' : '#17181E';
  const navBg    = bg;
  const navBord  = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
  const textPrim = isLight ? '#111' : '#fff';
  const textMut  = isLight ? '#555' : '#71717a';
  const btnBg    = isLight ? '#f5f6f7' : '#27272a';
  const btnBord  = isLight ? 'rgba(0,0,0,0.09)' : '#3f3f46';
  const green    = '#00bf63';
  const lime     = '#ADEE66';

  const hdrTextPrim = textPrim;
  const hdrTextMut  = textMut;
  const hdrBtnBg    = btnBg;
  const hdrBtnBord  = btnBord;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: bg }}><Loader2 className="w-8 h-8 animate-spin" style={{ color: green }} /></div>;
  }
  if (!form) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: bg, color: textPrim }}><p>Form not found or you don&apos;t have access.</p></div>;
  }

  const type = getFormType(form.config);
  const meta = TYPE_META[type];
  const tabAccent = form.config?.customAccent || COURSE_THEME_ACCENTS[form.config?.theme] || green;

  const lightBadge: Record<string, string> = {
    course: 'bg-amber-50 text-amber-700 border-amber-200',
    event:  'bg-blue-50 text-blue-700 border-blue-200',
    form:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  };

  return (
    <main className="min-h-screen font-sans" style={{ background: bg, color: textPrim }}>
      {/* The course editor provides its own focused studio header and actions. */}
      {type !== 'course' && <header className="sticky top-0 z-20 backdrop-blur-md" style={{ background: navBg }}>
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 sm:gap-4">
          <Link href="/dashboard" className="transition-colors flex-shrink-0 hover:opacity-60" style={{ color: hdrTextMut }}>
            <ArrowLeft className="w-5 h-5" />
          </Link>

          {/* Logo + Breadcrumb */}
          <div className="flex items-center gap-2.5 min-w-0">
            <Link href="/dashboard" className="flex items-center gap-1.5 hover:opacity-70 transition-opacity flex-shrink-0">
              <img src={(isLight ? logoUrl : logoDarkUrl || logoUrl) || undefined} alt="" className="h-6 w-auto" />
            </Link>
            <span className="font-semibold truncate" style={{ color: hdrTextPrim }}>{form.title}</span>
          </div>

          {/* Right actions */}
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {type === 'virtual_experience' ? (
              <Link href={`/create/guided-project?id=${form.id}`} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-70" style={{ background: hdrBtnBg, border: `1px solid ${hdrBtnBord}`, color: hdrTextMut }}>
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </Link>
            ) : (
              <button onClick={() => setActiveTab('settings')} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-70" style={{ background: hdrBtnBg, border: `1px solid ${hdrBtnBord}`, color: hdrTextMut }}>
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            <a href={formUrl} target="_blank" rel="noreferrer" className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-70" style={{ background: hdrBtnBg, border: `1px solid ${hdrBtnBord}`, color: hdrTextMut }}>
              <ExternalLink className="w-3.5 h-3.5" /> View
            </a>
            {!isStaff && <button onClick={() => exportContent(form)} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-70" style={{ background: hdrBtnBg, border: `1px solid ${hdrBtnBord}`, color: hdrTextMut }} title="Export">
              <Download className="w-3.5 h-3.5" /> Export
            </button>}
            <button onClick={toggleTheme} className="p-2 rounded-lg transition-colors ff-hover" title="Toggle theme" style={{ color: hdrTextMut }}>
              {isLight ? <Moon className="w-4 h-4"/> : <Sun className="w-4 h-4"/>}
            </button>
          </div>
        </div>

      </header>}

      {/* -- Top tab navigation with a full-width content workspace -- */}
      <div className="px-3 sm:px-6 pt-5 pb-10">
        {(() => {
          const visibleTabs = TABS.filter(tab => (!isStaff || tab.id === 'settings') && (!tab.courseOnly || type === 'course') && !(tab.id === 'settings' && type === 'virtual_experience'));
          const tabLabel = (tab: typeof TABS[number]) => tab.id === 'responses' && (type === 'course' || type === 'virtual_experience') ? 'Report' : tab.label;
          return (
            <div className="max-w-6xl mx-auto flex flex-col gap-4">
              {/* Top: tabs stay reachable and scroll horizontally on narrow screens. */}
              <div className={`${type === 'course' ? 'sticky top-0' : 'sticky top-12 sm:top-14'} z-10 -mx-1 px-1 py-1.5`} style={{ background: bg }}>
              <nav className="flex items-center gap-1 overflow-x-auto rounded-xl p-1" aria-label="Content dashboard sections" style={{ scrollbarWidth: 'none', background: isLight ? 'rgba(255,255,255,0.68)' : 'rgba(255,255,255,0.035)', backdropFilter: 'blur(14px)' }}>
                {visibleTabs.map(tab => {
                  const isActive = activeTab === tab.id;
                  const hoverBg = isLight ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.055)';
                  const activeBg = `color-mix(in oklab, ${tabAccent} ${isLight ? '10%' : '14%'}, transparent)`;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = hoverBg; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                      aria-current={isActive ? 'page' : undefined}
                      className="flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-left text-sm transition-colors"
                      style={{ color: isActive ? tabAccent : hdrTextMut, fontWeight: isActive ? 700 : 550, background: isActive ? activeBg : 'transparent' }}
                    >
                      <tab.Icon className="h-4 w-4 flex-shrink-0" />
                      <span>{tabLabel(tab)}</span>
                      {tab.id === 'responses' && totalCount > 0 && (
                        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold" style={{ background: isActive ? `color-mix(in oklab, ${tabAccent} 18%, transparent)` : (isLight ? 'rgba(0,0,0,0.06)' : '#3f3f46'), color: isActive ? tabAccent : hdrTextMut }}>
                          {totalCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
              </div>

              {/* Full-width content workspace. */}
              <div className="w-full min-w-0 rounded-2xl overflow-hidden" style={{ background: isLight ? '#ffffff' : '#1E1F26', border: isLight ? `1px solid ${navBord}` : '1px solid transparent', boxShadow: 'none' }}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                  {activeTab === 'settings' && type !== 'virtual_experience' ? (
                    <FormEditor formId={id as string} contentType={type === 'course' ? 'course' : 'event'} />
                  ) : (
                    <div className="px-4 sm:px-6 py-6 sm:py-8 w-full">
                      {activeTab === 'responses' && type !== 'virtual_experience' && (
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
                      {activeTab === 'responses' && type === 'virtual_experience' && (
                        <VirtualExperienceReportTab form={form} />
                      )}
                      {activeTab === 'leaderboard' && (
                        <LeaderboardTab form={form} courseProgress={courseProgress} />
                      )}
                      {activeTab === 'email' && (
                        <EmailTab form={form} formUrl={formUrl} courseProgress={courseProgress} cohortStudents={cohortStudents} formCohorts={formCohorts} />
                      )}
                      {activeTab === 'more' && (
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
