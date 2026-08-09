'use client';

// Chromeless, anti-copy-protected exam player for the `certifications` content type. "Full screen"
// here means the platform UI fills the viewport with no nav/sidebar/outline -- NOT the browser's
// Fullscreen API. Distinct from CourseTaker: no points/gamification, an enforced countdown that
// auto-submits, and a document-level protection layer (block copy/cut/paste/right-click + text
// selection, log tab-switch / blur). Reuses the CourseQuestion shape and the SQL/Python players.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Clock, Loader2, CheckCircle2, XCircle, ShieldAlert, Award, AlertTriangle, Circle, Check, ListChecks, Sparkle, ChevronRight, FileText, ExternalLink, BarChart3, Image as ImageIcon, BookOpen, BookOpenCheck, FileCheck2, Play, LogOut } from 'lucide-react';
import { initSQLRuntime, SQLRuntime } from '@/lib/sql-engine';
import SQLExercisePlayer from '@/components/sql-course/SQLExercisePlayer';
import PythonExercisePlayer from '@/components/sql-course/PythonExercisePlayer';
import { CertificationPlayground } from '@/components/CertificationPlayground';
import { ScoreGauge } from '@/components/ScoreGauge';
import { HoverPreviewCard } from '@/components/student/shared';
import { useTenant } from '@/components/TenantProvider';
import { supabase } from '@/lib/supabase';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { sanitizeQuestionContent } from '@/lib/sanitize';
import { setImmersive } from '@/lib/immersive';
import type { CourseQuestion, CertificationPrepItem, PlaygroundData } from '@/lib/course-schema';

type Phase = 'loading' | 'intro' | 'exam' | 'review' | 'result' | 'blocked';
type Proctor = { hidden: number; blur: number };

interface Props {
  certificationId: string;
  slug?: string;
  config: any;
  studentName: string;
  studentEmail: string;
  sessionToken?: string;
  isDark: boolean;
  accentColor: string;
  logoUrl?: string;
  logoDarkUrl?: string;
  onExit: () => void;
}

const isExerciseType = (t?: string) => t === 'sql_exercise' || t === 'python_exercise';

// Plain-text, truncated question text for the review summary list.
function shortText(html: string): string {
  const txt = String(html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return txt.length > 90 ? `${txt.slice(0, 90)}...` : txt;
}

// A code exercise counts as answered only when its stored payload says it passed.
function exercisePassed(raw?: string): boolean {
  if (!raw) return false;
  try { const p = JSON.parse(raw); return !!p?.passed && !p?.skipped && !p?.solutionViewed; } catch { return false; }
}

export function CertificationResultSummary({ result, passmark, isPreview = false, theme, accentColor, compact = false }: {
  result: { score: number; passed: boolean; passmark?: number; correctQuestions?: number; totalQuestions?: number; skills?: { id: string; name: string; correct: number; total: number; pct: number }[]; practice?: boolean };
  passmark: number;
  isPreview?: boolean;
  theme: { card: string; border: string; text: string; muted: string; track: string };
  accentColor: string;
  compact?: boolean;
}) {
  const skills = result.skills ?? [];
  const strengths = skills.filter(s => s.pct >= passmark);
  const gaps = skills.filter(s => s.pct < passmark);
  const hasBreakdown = !isPreview && skills.length > 0;
  const SkillBar = (s: { id: string; name: string; correct: number; total: number; pct: number }) => (
    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <span style={{ flex: '0 0 130px', fontSize: 13, color: theme.text, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
      <div style={{ flex: 1, maxWidth: 240, position: 'relative', height: 7, borderRadius: 999, background: theme.track }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${s.pct}%`, minWidth: s.pct > 0 ? 7 : 0, background: '#16a34a', borderRadius: 999 }} />
        <div title={`Pass mark ${passmark}%`} style={{ position: 'absolute', left: `${passmark}%`, top: -3, bottom: -3, width: 2, marginLeft: -1, background: theme.text, borderRadius: 2 }} />
      </div>
      <span style={{ flex: '0 0 auto', fontSize: 12.5, color: theme.muted, fontVariantNumeric: 'tabular-nums' }}>{s.pct}%</span>
    </div>
  );

  return (
    <>
      {result.passed || isPreview
        ? <CheckCircle2 className={`${compact ? 'w-9 h-9' : 'w-14 h-14'} mx-auto mb-4`} style={{ color: accentColor }} />
        : <XCircle className={`${compact ? 'w-9 h-9' : 'w-14 h-14'} mx-auto mb-4`} style={{ color: '#f43f5e' }} />}
      <h1 style={{ fontSize: compact ? 19 : 24, fontWeight: 800, marginBottom: 6 }}>{isPreview ? 'Preview complete' : result.practice ? 'Practice complete' : result.passed ? 'Certification passed' : 'Not passed yet'}</h1>
      {result.practice && <p style={{ fontSize: 13, color: theme.muted, marginBottom: 10 }}>Practice run. Not graded, no certificate issued.</p>}
      {isPreview ? (
        <p style={{ fontSize: 15, color: theme.muted, marginBottom: 24 }}>This was a preview. Attempts taken here are not scored or recorded.</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
            <ScoreGauge score={result.score} passmark={passmark} passed={result.passed} track={theme.track} scoreColor={theme.text} mutedColor={theme.muted} tickColor={theme.text} width={compact ? 150 : 200} />
          </div>
          <p style={{ fontSize: 14, color: theme.muted, marginTop: 4, marginBottom: hasBreakdown ? 20 : 24 }}>
            {result.correctQuestions != null && result.totalQuestions != null
              ? <>Scored <span style={{ color: theme.text, fontWeight: 700 }}>{result.correctQuestions} of {result.totalQuestions}</span> correct. Pass mark {passmark}%.</>
              : <>Your score: <span style={{ color: theme.text, fontWeight: 700 }}>{result.score}%</span> (pass mark {passmark}%)</>}
          </p>
        </>
      )}
      {hasBreakdown && (
        <div style={{ textAlign: 'left', marginBottom: compact ? 8 : 24, display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? 190 : 240}px, 1fr))`, gap: compact ? 14 : 24 }}>
          {strengths.length > 0 && <div><div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Strengths</div>{strengths.map(SkillBar)}</div>}
          {gaps.length > 0 && <div><div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Areas to improve</div>{gaps.map(SkillBar)}</div>}
        </div>
      )}
    </>
  );
}

export default function CertificationTaker({
  certificationId, slug, config, studentName, studentEmail, sessionToken,
  isDark, accentColor, logoUrl, logoDarkUrl, onExit,
}: Props) {
  // Platform branding colours, used for the OVERVIEW only (the exam keeps the content `accentColor`):
  // - tenantBrand = Brand Colour (`brand_color`) -> the hero band. The OVERVIEW uses the BRAND color
  // (NOT primary/ocean -- that convention is only for the instructor editor, which mirrors courses).
  const { brandColor: tenantBrand, primaryColor: tenantPrimary } = useTenant();
  // This is a chromeless full-screen surface -- hide global chrome (e.g. the PWA
  // install prompt) for as long as the taker is mounted.
  useEffect(() => {
    setImmersive(true);
    return () => setImmersive(false);
  }, []);
  // Primary tenant colour for confirmation-popup borders (falls back to the content accent).
  const dialogBorder = tenantPrimary || tenantBrand || accentColor;
  // Questions are NOT in config -- they are delivered by start-attempt (when the clock starts), so a
  // student cannot read them before the timer begins. config carries only metadata + questionCount.
  const questionCount: number = Number(config?.questionCount) || 0;
  const practiceCount: number = Number(config?.practiceCount) || 0;
  const timeLimitMin: number = Number(config?.timeLimit) || 0;
  const maxAttempts: number = Number(config?.maxAttempts) || 0;
  const retakeCooldownHours: number = Number(config?.retakeCooldownHours) || 0;
  const protect: boolean = config?.examProtection !== false;
  // Foundation assets shown on the intro screen.
  const skillAreas: { id: string; name: string }[] = Array.isArray(config?.skillAreas) ? config.skillAreas : [];
  const studyGuide: { url: string; name: string } | null = config?.studyGuide?.url ? config.studyGuide : null;
  const posterUrl: string = config?.poster || '';
  const practiceTestUrl: string = config?.practiceTestUrl || '';
  const prepItems: CertificationPrepItem[] = Array.isArray(config?.prepItems) ? config.prepItems : [];
  // Shared runnable-playground data (tables/DataFrames) reused across question playgrounds.
  const sharedPlayground: PlaygroundData = (config?.playgroundData && typeof config.playgroundData === 'object' && !Array.isArray(config.playgroundData)) ? config.playgroundData : {};
  const sections: string[] = Array.isArray(config?.sections) ? config.sections : [];

  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<CourseQuestion[]>([]);
  const total = questions.length;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  // Practice mode: an ungraded, untimed, unprotected dry run. No attempt is recorded, no certificate
  // is issued, and no answer key is revealed -- just a score + per-skill breakdown at the end.
  const [isPractice, setIsPractice] = useState(false);
  const [canResume, setCanResume] = useState(false);
  // True when the student jumped from the review page to answer a still-unanswered question; after
  // saving they go straight back to review (they cannot wander into already-answered questions).
  const [returnToReview, setReturnToReview] = useState(false);
  const [result, setResult] = useState<{ score: number; passed: boolean; certId?: string; passmark?: number; correctQuestions?: number; totalQuestions?: number; skills?: { id: string; name: string; correct: number; total: number; pct: number }[]; practice?: boolean; review?: { id: string; question: string; correct: boolean; correctAnswer: string; explanation: string }[] } | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  // ISO time a fresh attempt becomes allowed again (retake cooldown); null when startable now.
  const [retakeAt, setRetakeAt] = useState<string | null>(null);
  // Set when starting is blocked because the student is enrolled in another unpassed certification;
  // confirming switches (abandons the other) and starts this one.
  const [switchPrompt, setSwitchPrompt] = useState<{ title: string } | null>(null);
  const [showNoAttempts, setShowNoAttempts] = useState(false);
  const [warning, setWarning] = useState('');
  const [journeyAnswer, setJourneyAnswer] = useState('');

  // Mobile layout switch. The component is styled inline, so responsive tweaks use this flag
  // instead of CSS breakpoints (640px matches Tailwind's sm).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const answersRef = useRef<Record<string, string>>({});
  const proctorRef = useRef<Proctor>({ hidden: 0, blur: 0 });
  const indexRef = useRef(0);
  const submittedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Measured horizontal bounds of the progress bar track, so the question content can line up exactly
  // with the bar (which is inset by the exit button + timer).
  const barRef = useRef<HTMLDivElement>(null);
  const [contentPad, setContentPad] = useState<{ left: number; right: number }>({ left: 56, right: 56 });
  // Server-computed seconds left on a resumed attempt (from started_at + time_limit). Seeds the
  // countdown so a refresh cannot regain time; null on a fresh start (uses the full limit).
  const resumeRemainingRef = useRef<number | null>(null);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { indexRef.current = index; }, [index]);

  const t = isDark
    ? { bg: '#17181E', card: '#1E1F26', cardHover: '#23242c', border: 'rgba(255,255,255,0.10)', text: '#f0f0f0', muted: '#8a8a93', track: 'rgba(255,255,255,0.08)' }
    : { bg: '#0f1117', card: '#1b1d26', cardHover: '#22242e', border: 'rgba(255,255,255,0.10)', text: '#f4f4f5', muted: '#9aa0aa', track: 'rgba(255,255,255,0.10)' };
  // The exam chrome is intentionally dark in both modes (focused, distraction-free, like a proctored exam).

  // Retake cooldown, for the intro CTA: blocked until `retakeAt`, with a friendly local time.
  const retakeBlocked = !!retakeAt && Date.parse(retakeAt) > Date.now();
  const retakeWhen = retakeAt ? new Date(retakeAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

  const api = useCallback((action: string, extra: Record<string, any> = {}) =>
    fetch('/api/certification-attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
      body: JSON.stringify({ action, certification_id: certificationId, ...extra }),
    }), [certificationId, sessionToken]);

  // -- Initial load: resume / blocked / already-passed --
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api('get-progress');
        const d = await res.json();
        if (cancelled) return;
        if (d.hasPassed || d.cert?.id) {
          setResult({ score: d.passingAttempt?.score ?? 100, passed: true, certId: d.cert?.id });
          setPhase('result');
          return;
        }
        const completed = Number(d.attemptCount ?? 0);
        // An in-progress attempt means "resume" -- but the actual questions/answers/clock are loaded
        // by start-attempt when the student clicks Resume, not here.
        if (d.progress) {
          setCanResume(true);
          setAttemptsLeft(maxAttempts > 0 ? Math.max(0, maxAttempts - completed) : null);
          setPhase('intro');
          return;
        }
        if (maxAttempts > 0 && completed >= maxAttempts) {
          // Attempt eligibility does not remove access to the certification
          // overview. The start action will explain the limit when requested.
          setAttemptsLeft(0);
          setPhase('intro');
          return;
        }
        if (d.retakeAt) setRetakeAt(d.retakeAt);
        setAttemptsLeft(maxAttempts > 0 ? Math.max(0, maxAttempts - completed) : null);
        setPhase('intro');
      } catch {
        if (!cancelled) setPhase('intro');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- SQL runtime preparation (mirrors CourseTaker) --
  const [sqlRuntime, setSqlRuntime] = useState<SQLRuntime | null>(null);
  const [sqlPreparing, setSqlPreparing] = useState(false);
  const [sqlPrepareError, setSqlPrepareError] = useState('');
  const sqlRuntimeRef = useRef<SQLRuntime | null>(null);
  const sqlInitStartedRef = useRef(false);
  const sqlTables = useMemo(() => {
    const byKey = new Map<string, any>();
    for (const q of questions) {
      if ((q as any)?.type !== 'sql_exercise') continue;
      for (const table of ((q as any).sqlTables ?? [])) {
        const key = `${table.tableName}|${table.fileUrl || table.csvUrl || table.seedSql || ''}`;
        if (table.tableName && !byKey.has(key)) byKey.set(key, table);
      }
    }
    return Array.from(byKey.values());
  }, [questions]);

  const currentQuestion = questions[index];
  const qType = (currentQuestion as any)?.type ?? 'multiple_choice';

  useEffect(() => {
    if (phase !== 'exam' || qType !== 'sql_exercise' || sqlRuntimeRef.current || sqlInitStartedRef.current || sqlTables.length === 0) return;
    let cancelled = false;
    sqlInitStartedRef.current = true;
    setSqlPreparing(true);
    setSqlPrepareError('');
    initSQLRuntime(sqlTables)
      .then(rt => { if (cancelled) { rt.close(); return; } sqlRuntimeRef.current = rt; setSqlRuntime(rt); })
      .catch(err => { if (!cancelled) setSqlPrepareError(err?.message || 'Could not prepare the SQL environment.'); })
      .finally(() => { if (!cancelled) setSqlPreparing(false); if (!sqlRuntimeRef.current) sqlInitStartedRef.current = false; });
    return () => { cancelled = true; };
  }, [phase, qType, sqlTables]);

  useEffect(() => () => { sqlRuntimeRef.current?.close(); sqlRuntimeRef.current = null; }, []);

  // -- Submit (server re-scores) --
  const submit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    // Practice: grade statelessly (no attempt, no certificate); reveals only a score + skill breakdown.
    if (isPractice) {
      setSubmitting(true);
      setSubmitError('');
      try {
        const res = await api('grade-practice', { answers: answersRef.current, questionIds: questions.map(qq => qq.id) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Failed to grade practice.');
        setResult({ score: d.score ?? 0, passed: !!d.passed, passmark: d.passmark, correctQuestions: d.correctQuestions, totalQuestions: d.totalQuestions, skills: Array.isArray(d.skills) ? d.skills : [], review: Array.isArray(d.review) ? d.review : [], practice: true });
        setPhase('result');
      } catch (err: any) {
        submittedRef.current = false;
        setSubmitError(err?.message || 'Could not grade your practice run.');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    // Preview (owner/admin/instructor/staff) has no attempt and is never scored.
    if (isPreview) {
      setResult({ score: 0, passed: false });
      setPhase('result');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await api('complete-attempt', {
        current_question_index: total,
        final_answers: answersRef.current,
        proctor: proctorRef.current,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to submit.');
      setResult({ score: d.score ?? 0, passed: !!d.passed, certId: d.certId, passmark: d.passmark, correctQuestions: d.correctQuestions, totalQuestions: d.totalQuestions, skills: Array.isArray(d.skills) ? d.skills : [] });
      setPhase('result');
    } catch (err: any) {
      submittedRef.current = false;
      setSubmitError(err?.message || 'Could not submit your exam. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }, [api, total, isPreview, isPractice, questions]);

  // -- Enforced timer --
  useEffect(() => {
    if ((phase !== 'exam' && phase !== 'review') || !timeLimitMin || isPractice) return;
    // Resume uses the server-computed remaining seconds; a fresh start uses the full limit.
    setTimeLeft(prev => (prev === null ? (resumeRemainingRef.current ?? timeLimitMin * 60) : prev));
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          submit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLimitMin]);

  const flashWarning = useCallback((msg: string) => {
    setWarning(msg);
    if (warnTimer.current) clearTimeout(warnTimer.current);
    warnTimer.current = setTimeout(() => setWarning(''), 3200);
  }, []);

  // -- Protection layer: active only during the exam (never in practice) --
  useEffect(() => {
    if ((phase !== 'exam' && phase !== 'review') || !protect || isPractice) return;
    const block = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onVisibility = () => { if (document.hidden) { proctorRef.current.hidden++; flashWarning('Leaving the exam is recorded.'); } };
    const onBlur = () => { proctorRef.current.blur++; };
    document.addEventListener('copy', block, true);
    document.addEventListener('cut', block, true);
    document.addEventListener('paste', block, true);
    document.addEventListener('contextmenu', block, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('copy', block, true);
      document.removeEventListener('cut', block, true);
      document.removeEventListener('paste', block, true);
      document.removeEventListener('contextmenu', block, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, [phase, protect, isPractice, flashWarning]);

  const timerMounted = timeLeft !== null;

  // Match the question content's left/right to the progress bar track. The timer mounts just after the
  // exam starts, so observe the bar instead of relying only on the phase transition measurement.
  useEffect(() => {
    if (phase !== 'exam' && phase !== 'review') return;
    const measure = () => {
      // Use clientWidth (excludes the vertical scrollbar) so the right edge lines up with the bar,
      // which as a fixed element is laid out against the scrollbar-excluded viewport.
      const viewportWidth = document.documentElement.clientWidth;
      // On phones the bar is squeezed between the exit/timer/quit controls; aligning content to it
      // would leave a sliver of usable width. Use a plain fixed gutter instead.
      if (viewportWidth <= 640) { setContentPad({ left: 20, right: 20 }); return; }
      const r = barRef.current?.getBoundingClientRect();
      if (r) {
        const contentWidth = Math.min(r.width, 1000);
        const left = r.left + (r.width - contentWidth) / 2;
        setContentPad({ left: Math.round(left), right: Math.round(viewportWidth - left - contentWidth) });
      }
    };
    measure();
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver !== 'undefined' && barRef.current ? new ResizeObserver(measure) : null;
    if (barRef.current) observer?.observe(barRef.current);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [phase, timerMounted]);

  const saveProgress = useCallback((nextAnswers: Record<string, string>, nextIndex: number) => {
    if (isPractice) return; // practice is not persisted
    api('save-progress', { current_question_index: nextIndex, answers: nextAnswers, proctor: proctorRef.current })
      .catch(() => {});
  }, [api, isPractice]);

  const doStart = useCallback(async (doSwitch: boolean) => {
    setStartError('');
    if (!doSwitch && maxAttempts > 0 && attemptsLeft === 0) {
      setShowNoAttempts(true);
      return;
    }
    setStarting(true);
    try {
      // start-attempt is the ONLY place the attempt (and its started_at) is created and where the
      // questions are delivered -- so the clock starts exactly when the student gets the questions.
      const res = await api('start-attempt', doSwitch ? { switch: true } : {});
      const d = await res.json();
      if (!res.ok) {
        if (res.status === 403 && d.reason === 'no_attempts') {
          setAttemptsLeft(0);
          setShowNoAttempts(true);
          return;
        }
        if (res.status === 403) { setPhase('blocked'); return; }
        if (res.status === 409 && d.reason === 'already_passed') { setResult({ score: 100, passed: true }); setPhase('result'); return; }
        if (res.status === 429 && d.reason === 'cooldown') { setRetakeAt(d.retakeAt || null); setStartError(d.error || 'Retake is not available yet.'); return; }
        // Blocked: enrolled in another certification not yet passed. Offer to switch (abandon it).
        if (res.status === 409 && d.reason === 'other_unpassed') { setSwitchPrompt({ title: d.otherCertTitle || 'another certification' }); return; }
        setStartError(d.error || 'Could not start the exam.');
        return;
      }
      setSwitchPrompt(null);
      const loaded = Array.isArray(d.questions) ? d.questions : [];
      setQuestions(loaded);
      const savedAnswers = d.answers && typeof d.answers === 'object' ? d.answers : {};
      setAnswers(savedAnswers);
      answersRef.current = savedAnswers;
      const startIndex = Math.min(Number(d.currentIndex ?? 0), Math.max(0, loaded.length - 1));
      setIndex(startIndex);
      indexRef.current = startIndex;
      if (d.proctor && typeof d.proctor === 'object') proctorRef.current = { hidden: 0, blur: 0, ...d.proctor };
      resumeRemainingRef.current = typeof d.remainingSeconds === 'number' ? d.remainingSeconds : null;
      setIsPreview(!!d.preview);
      setTimeLeft(null); // re-seed from resumeRemainingRef in the timer effect
      submittedRef.current = false;
      setPhase('exam');
    } catch {
      setStartError('Could not start the exam. Check your connection and try again.');
    } finally {
      setStarting(false);
    }
  }, [api, attemptsLeft, maxAttempts]);
  // Buttons call this (no args); the switch-confirm modal calls doStart(true).
  const startExam = useCallback(() => doStart(false), [doStart]);

  // Quit an in-progress exam: costs one attempt and discards progress (confirmed via the modal below),
  // then leave. Frees the student to start over or take a different certification.
  const [showQuit, setShowQuit] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const abandonExam = useCallback(async () => {
    setQuitting(true);
    try { await api('abandon-attempt'); } catch { /* leave regardless */ }
    onExit();
  }, [api, onExit]);

  // Practice: fetch a pooled/shuffled set (no attempt, no timer, no protection) and run it as a dry run.
  const startPractice = useCallback(async () => {
    setStartError('');
    setStarting(true);
    try {
      const res = await api('practice-questions');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not start practice.');
      const loaded = Array.isArray(d.questions) ? d.questions : [];
      if (!loaded.length) throw new Error('No questions available to practice yet.');
      setIsPractice(true);
      setQuestions(loaded);
      setAnswers({}); answersRef.current = {};
      setIndex(0); indexRef.current = 0;
      setResult(null);
      setTimeLeft(null);
      submittedRef.current = false;
      setReturnToReview(false);
      setPhase('exam');
    } catch (err: any) {
      setStartError(err?.message || 'Could not start practice.');
    } finally {
      setStarting(false);
    }
  }, [api]);

  // Leave practice and return to the overview (practice records nothing).
  const exitPractice = useCallback(() => {
    submittedRef.current = false;
    setIsPractice(false);
    setQuestions([]);
    setAnswers({}); answersRef.current = {};
    setIndex(0); indexRef.current = 0;
    setResult(null);
    setReturnToReview(false);
    setPhase('intro');
  }, []);

  const setAnswer = useCallback((qid: string, value: string) => {
    setAnswers(prev => ({ ...prev, [qid]: value }));
  }, []);

  // Advance from a non-exercise question via the Continue button.
  const advance = useCallback(() => {
    // Fixing skipped questions from the review: move to the NEXT still-unanswered question, and only
    // go back to review once none remain (don't bounce back to review after every single one).
    if (returnToReview) {
      saveProgress(answersRef.current, indexRef.current);
      const nextUnanswered = questions.findIndex(qq =>
        !(isExerciseType((qq as any).type) ? exercisePassed(answersRef.current[qq.id]) : !!answersRef.current[qq.id]));
      if (nextUnanswered >= 0 && nextUnanswered !== indexRef.current) { setIndex(nextUnanswered); return; }
      setReturnToReview(false);
      setPhase('review');
      return;
    }
    const next = indexRef.current + 1;
    // After the last question, go to the review/summary page (not straight to submit).
    if (next >= total) { saveProgress(answersRef.current, indexRef.current); setPhase('review'); return; }
    setIndex(next);
    saveProgress(answersRef.current, next);
  }, [total, saveProgress, returnToReview, questions]);

  // Exercise players record their own result then drive navigation through onNext.
  const recordExercise = useCallback((qid: string, payload: any) => {
    setAnswers(prev => {
      const updated = { ...prev, [qid]: JSON.stringify(payload) };
      answersRef.current = updated;
      return updated;
    });
    saveProgress({ ...answersRef.current, [qid]: JSON.stringify(payload) }, indexRef.current);
  }, [saveProgress]);

  // --- Render ---

  if (phase === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="w-7 h-7 animate-spin" style={{ color: accentColor }} />
      </div>
    );
  }

  const protectStyle = protect ? (
    <style>{`.cert-noselect{user-select:none;-webkit-user-select:none;}
.cert-noselect input,.cert-noselect textarea,.cert-noselect [contenteditable],.cert-noselect .cm-editor,.cert-noselect .cm-content{user-select:text;-webkit-user-select:text;}`}</style>
  ) : null;

  if (phase === 'blocked') {
    return (
      <div style={{ minHeight: '100vh', background: t.bg, color: t.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460, width: '100%', textAlign: 'center', background: t.card, borderRadius: 24, padding: 32, border: `1px solid ${t.border}`, boxShadow: '0 24px 70px rgba(0,0,0,0.16)' }}>
          <AlertTriangle className="w-12 h-12 mx-auto mb-4" style={{ color: '#f59e0b' }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No attempts remaining</h1>
          <p style={{ fontSize: 14, color: t.muted, marginBottom: 20 }}>You have used all {maxAttempts} attempt{maxAttempts === 1 ? '' : 's'} for this certification.</p>
          <button onClick={onExit} style={{ background: accentColor, color: '#06281a', fontWeight: 600, fontSize: 14, padding: '10px 22px', borderRadius: 10 }}>Back</button>
        </div>
      </div>
    );
  }

  if (phase === 'result' && result) {
    const certUrl = result.certId ? `/certificate/${result.certId}` : null;
    const reportUrl = result.certId ? `/cert-report/${result.certId}` : null;
    const pm = result.passmark ?? config?.passmark ?? 70;
    const skills = result.skills ?? [];
    const hasBreakdown = !isPreview && skills.length > 0;
    return (
      <div style={{ minHeight: '100vh', background: t.bg, color: t.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} style={{ maxWidth: hasBreakdown || (result.practice && (result.review?.length ?? 0) > 0) ? 720 : 520, width: '100%', textAlign: 'center', background: t.card, borderRadius: 28, padding: 'clamp(24px, 5vw, 44px)', border: `1px solid ${t.border}`, boxShadow: '0 28px 80px rgba(0,0,0,0.18)' }}>
          <CertificationResultSummary result={result} passmark={pm} isPreview={isPreview} theme={t} accentColor={accentColor} />

          {result.passed && certUrl && (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <a href={certUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: accentColor, color: '#06281a', fontWeight: 700, fontSize: 14, padding: '11px 24px', borderRadius: 10 }}>
                <Award className="w-4 h-4" /> View certificate
              </a>
              {reportUrl && (
                <a href={reportUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: t.card, color: t.text, fontWeight: 700, fontSize: 14, padding: '11px 24px', borderRadius: 10, border: `1px solid ${t.border}` }}>
                  <BarChart3 className="w-4 h-4" /> View report
                </a>
              )}
            </div>
          )}
          {result.practice && (result.review?.length ?? 0) > 0 && (
            <div style={{ textAlign: 'left', marginTop: 8, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Review</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.review!.map((r, i) => (
                  <div key={r.id} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      {r.correct
                        ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#16a34a', marginTop: 2 }} />
                        : <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#f43f5e', marginTop: 2 }} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>{i + 1}. {r.question}</div>
                        {!r.correct && r.correctAnswer && <div style={{ fontSize: 12.5, color: t.muted, marginTop: 4 }}>Correct answer: <span style={{ color: t.text }}>{r.correctAnswer}</span></div>}
                        {r.explanation && <div style={{ fontSize: 12.5, color: t.muted, marginTop: 4, lineHeight: 1.5 }}>{r.explanation}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.practice ? (
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <button onClick={startPractice} disabled={starting} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: accentColor, color: '#06281a', fontWeight: 700, fontSize: 14, padding: '11px 24px', borderRadius: 10 }}>
                {starting && <Loader2 className="w-4 h-4 animate-spin" />} Practice again
              </button>
              <button onClick={exitPractice} style={{ background: t.card, color: t.text, fontWeight: 700, fontSize: 14, padding: '11px 24px', borderRadius: 10, border: `1px solid ${t.border}` }}>Back to overview</button>
            </div>
          ) : (
            <div>
              <button onClick={onExit} style={{ marginTop: 12, color: t.muted, fontSize: 13, textDecoration: 'underline' }}>Back to certifications</button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  if (phase === 'intro') {
    // Follow the learner's selected theme while keeping the branded hero immersive.
    const ov = isDark
      ? { bg: '#17181E', card: '#1E1F26', surface: '#23242c', surfaceAlt: '#2a2b34', border: 'rgba(255,255,255,0.07)', text: '#f4f6f8', muted: '#a8b0bc' }
      : { bg: '#ffffff', card: '#ffffff', surface: '#f5f7fa', surfaceAlt: '#eef2f6', border: 'rgba(15,23,42,0.08)', text: '#10131a', muted: '#5a616b' };
    // Dark mode intentionally uses the calmer certification green instead of a
    // potentially bright tenant/ocean blue. Light mode retains tenant branding.
    const brandColor = isDark ? accentColor : (tenantBrand || accentColor);
    // Keep brand colour for actions, but use a calm semantic green for
    // informational icons, labels, progress and credential cues.
    const signalColor = '#00bf63';
    // Brand tint that works for any hex color (falls back to a neutral wash for non-hex values).
    const tint = (a: number) => {
      const h = String(signalColor).replace('#', '');
      if (h.length === 6) { const n = parseInt(h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
      return isDark ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    };
    const logo = isDark ? (logoDarkUrl || logoUrl) : (logoUrl || logoDarkUrl);
    // Hero uses the cover image; the poster is a separate resource shown below.
    const heroVisual = config?.coverImage || '';
    const title = config?.title || 'Certification';
    const ctaLabel = canResume ? 'Resume exam' : 'Start exam';
    const facts = [
      { icon: ListChecks, label: 'Questions', value: `${questionCount}` },
      { icon: Clock, label: 'Time limit', value: timeLimitMin ? `${timeLimitMin} min` : 'Untimed' },
      { icon: Award, label: 'Pass mark', value: `${config?.passmark ?? 70}%` },
      { icon: CheckCircle2, label: 'Attempts', value: maxAttempts > 0 ? `${attemptsLeft ?? maxAttempts} of ${maxAttempts}` : 'Unlimited' },
    ];
    const howSteps = [
      { Icon: BookOpenCheck, title: 'Prepare with confidence', desc: 'Use the study resources, courses, learning paths, and practice questions provided for your certification.' },
      { Icon: FileCheck2, title: 'Pass the assessment', desc: 'Complete the practical exam and meet the required pass mark within the available attempts.' },
      { Icon: Award, title: 'Receive your credential', desc: 'Unlock your result, certificate, and badge, ready to view and share.' },
    ];
    const journeyTheme = isDark
      ? { bg: '#17181E', card: '#1E1F26', cardHover: '#23242c', border: 'rgba(255,255,255,0.10)', text: '#f0f0f0', muted: '#8a8a93', track: 'rgba(255,255,255,0.08)' }
      : { bg: '#ffffff', card: '#ffffff', cardHover: '#f8fafc', border: 'rgba(15,23,42,0.09)', text: '#111827', muted: '#667085', track: '#e9eef5' };
    const journeyQuestion = { id: 'cert-journey-preview', type: 'multiple_choice', question: 'Which approach best validates a model before deployment?', options: ['Test against representative data', 'Use only training accuracy', 'Skip edge-case testing'], correctAnswer: 'Test against representative data' };
    const resources = [
      studyGuide ? { icon: FileText, title: 'Study guide', desc: 'View or download the PDF.', href: studyGuide.url } : null,
      practiceTestUrl ? { icon: ExternalLink, title: 'Practice test', desc: 'Warm up before the real exam.', href: practiceTestUrl } : null,
      posterUrl ? { icon: ImageIcon, title: 'Poster', desc: 'View the certification poster.', href: posterUrl } : null,
    ].filter(Boolean) as { icon: any; title: string; desc: string; href: string }[];

    // Small section labels use a dark ~90% tone (not blue/primary, per design).
    const eyebrow = { fontSize: 12.5, fontWeight: 800 as const, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: ov.text, marginBottom: 12 };
    const h2 = { fontSize: 26, fontWeight: 800 as const, marginBottom: 8, color: ov.text };
    const sub = { fontSize: 15, color: ov.muted, lineHeight: 1.6, marginBottom: 24, maxWidth: 640 };
    const card = { background: ov.card, borderRadius: 18, padding: 20, border: 'none' };
    const sectionStyle = { padding: isMobile ? '36px 0' : '48px 0' };
    const ctaPrimary = { background: brandColor, color: '#ffffff', fontWeight: 700 as const, fontSize: 15, padding: '13px 30px', borderRadius: 12, opacity: starting ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer' };
    // Hero sits on a full-width primary-color band, so its text is white and its CTA is a white
    // button (an accent button would vanish on the accent background).
    const heroEyebrow = { display: 'inline-flex' as const, alignItems: 'center' as const, gap: 7, fontSize: 12.5, fontWeight: 700 as const, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: signalColor, marginBottom: 14 };

    return (
      <div style={{ minHeight: '100vh', background: ov.bg, color: ov.text, overflowY: 'auto' }}>
        {protectStyle}
        <style>{`
          @keyframes cert-signal-pulse {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0 4px ${tint(0.11)}; }
            50% { transform: scale(1.22); box-shadow: 0 0 0 8px ${tint(0.035)}; }
          }
          .cert-credential-dot { animation: cert-signal-pulse 2.2s ease-in-out infinite; transform-origin: center; }
          .cert-card { box-shadow: ${isDark ? 'none' : '0 6px 22px rgba(15,23,42,0.065), 0 2px 8px rgba(15,23,42,0.035)'}; transition: transform .2s ease, box-shadow .2s ease; }
          .cert-card:hover { transform: translateY(-4px); box-shadow: ${isDark ? 'none' : '0 12px 34px rgba(15,23,42,0.11)'}; }
          .cert-cta { transition: transform .16s ease, box-shadow .16s ease; }
          .cert-cta:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(16,19,26,0.22); }
          .cert-cta:active { transform: translateY(0); }
          .cert-prep-card { transition: transform .18s ease; }
          .cert-prep-card:hover { transform: translateY(-3px); }
          .cert-required-track { display: flex; gap: 14px; overflow-x: auto; padding: 6px 4px 28px; margin: -2px -4px -12px; scroll-snap-type: x proximity; scrollbar-width: none; }
          .cert-required-track::-webkit-scrollbar { display: none; }
          .cert-required-item { flex: 0 0 min(300px, 82vw); scroll-snap-align: start; transition: transform .2s ease, box-shadow .2s ease; }
          .cert-required-item:hover { transform: translateY(-4px); }
          @media (prefers-reduced-motion: reduce) {
            .cert-credential-dot { animation: none; }
            .cert-card, .cert-cta, .cert-prep-card, .cert-required-item { transition: none; }
            .cert-card:hover, .cert-cta:hover, .cert-prep-card:hover, .cert-required-item:hover { transform: none; }
          }
          @media (prefers-reduced-motion: no-preference) {
            @supports ((animation-timeline: view()) and (animation-range: entry)) {
              @keyframes cert-reveal { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: translateY(0); } }
              .cert-reveal { animation: cert-reveal linear both; animation-timeline: view(); animation-range: entry 0% cover 30%; }
            }
          }
        `}</style>
        {/* Top bar */}
        <div style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: isMobile ? '12px 16px' : '14px 24px', background: ov.bg }}>
          {logo ? <img src={logo} alt="" style={{ height: 26, maxWidth: '40vw', objectFit: 'contain' }} /> : <span style={{ fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <button onClick={onExit} style={{ color: ov.muted, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><X className="w-4 h-4" /> Exit</button>
            <button onClick={startExam} disabled={starting || retakeBlocked} className="cert-cta" style={{ ...ctaPrimary, padding: '9px 18px', fontSize: 13.5, whiteSpace: 'nowrap', ...(retakeBlocked ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}>{starting && <Loader2 className="w-4 h-4 animate-spin" />}{retakeBlocked ? 'Retake unavailable' : ctaLabel}</button>
          </div>
        </div>

        {/* Switch-certification confirmation (blocked because enrolled in another unpassed cert) */}
        {switchPrompt && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: ov.bg, color: ov.text, maxWidth: 440, width: '100%', borderRadius: 16, padding: 28, border: `2px solid ${dialogBorder}`, boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
              <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 10 }}>Switch certification?</h3>
              <p style={{ fontSize: 14.5, color: ov.muted, lineHeight: 1.6, marginBottom: 22 }}>
                You are enrolled in <strong style={{ color: ov.text }}>{switchPrompt.title}</strong>, which you have not passed yet. You can work on only one certification at a time. Switching discards your progress there and starts <strong style={{ color: ov.text }}>{title}</strong> fresh.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button onClick={() => setSwitchPrompt(null)} style={{ background: ov.surface, color: ov.text, fontWeight: 600, fontSize: 14, padding: '10px 18px', borderRadius: 10, border: `1px solid ${ov.border}` }}>Cancel</button>
                <button onClick={() => { setSwitchPrompt(null); doStart(true); }} disabled={starting} className="cert-cta" style={{ ...ctaPrimary, padding: '10px 20px' }}>{starting && <Loader2 className="w-4 h-4 animate-spin" />}Switch and start</button>
              </div>
            </div>
          </div>
        )}

        {/* Attempt limits block starting the exam, not access to this overview. */}
        {showNoAttempts && (
          <div role="dialog" aria-modal="true" aria-labelledby="no-attempts-title" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: ov.card, color: ov.text, maxWidth: 440, width: '100%', borderRadius: 20, padding: isMobile ? 24 : 30, border: isDark ? `1px solid ${ov.border}` : 'none', boxShadow: '0 24px 70px rgba(0,0,0,0.28)', textAlign: 'center' }}>
              <span style={{ width: 58, height: 58, margin: '0 auto 18px', borderRadius: 17, display: 'grid', placeItems: 'center', background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}><AlertTriangle style={{ width: 29, height: 29 }} /></span>
              <h3 id="no-attempts-title" style={{ fontSize: 20, fontWeight: 700, marginBottom: 9 }}>No attempts remaining</h3>
              <p style={{ fontSize: 14.5, color: ov.muted, lineHeight: 1.6, marginBottom: 22 }}>You have used all {maxAttempts} attempt{maxAttempts === 1 ? '' : 's'} for this certification. You can still review its preparation, required learning, and exam information.</p>
              <button autoFocus onClick={() => setShowNoAttempts(false)} style={{ background: brandColor, color: '#ffffff', fontWeight: 700, fontSize: 14, padding: '11px 24px', borderRadius: 11 }}>Return to certification</button>
            </div>
          </div>
        )}

        {/* Credential hero -- page-integrated like the certification hub, with the visual elevated separately. */}
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: isMobile ? 32 : 56, alignItems: 'center', padding: isMobile ? '46px 20px 34px' : '72px 24px 52px' }}>
          <div style={{ flex: '1 1 440px', minWidth: 0 }}>
            <div style={heroEyebrow}><span className="cert-credential-dot" style={{ width: 8, height: 8, borderRadius: 999, background: signalColor }} /> Professional credential</div>
            <h1 style={{ fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 650, lineHeight: 1.1, marginBottom: 18, letterSpacing: '-0.022em', color: ov.text }}>{title}</h1>
            {config?.description && <p style={{ fontSize: isMobile ? 16 : 18, color: ov.muted, lineHeight: 1.65, marginBottom: 28, maxWidth: 640 }}>{config.description}</p>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={startExam} disabled={starting || retakeBlocked} className="cert-cta" style={{ ...ctaPrimary, ...(retakeBlocked ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}>{starting && <Loader2 className="w-4 h-4 animate-spin" />}{retakeBlocked ? 'Retake not available yet' : ctaLabel}<ChevronRight className="w-4 h-4" /></button>
              {practiceCount > 0 && <button onClick={startPractice} disabled={starting} className="cert-cta" style={{ background: ov.surface, color: ov.text, fontWeight: 650, fontSize: 15, padding: '13px 24px', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 8 }}>Practice run</button>}
              {practiceTestUrl && <a href={practiceTestUrl} target="_blank" rel="noreferrer" className="cert-cta" style={{ background: ov.surface, color: ov.text, fontWeight: 650, fontSize: 15, padding: '13px 24px', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>Practice test</a>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', marginTop: 24, color: ov.muted, fontSize: 13 }}>
              {['Official credential', 'Shareable certificate', 'Publicly verifiable'].map(label => <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><CheckCircle2 style={{ width: 15, height: 15, color: signalColor }} />{label}</span>)}
            </div>
            {(startError || retakeBlocked) && <p style={{ marginTop: 14, fontSize: 13, color: '#ef4444' }}>{startError || `You can retake this certification on ${retakeWhen}.`}</p>}
          </div>
          <div className="cert-card" style={{ flex: '0 1 410px', minHeight: isMobile ? 300 : 390, borderRadius: 28, padding: 22, background: isDark ? ov.card : '#ffffff', display: 'grid', placeItems: 'center', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 72% 18%, ${tint(0.18)}, transparent 42%)`, pointerEvents: 'none' }} />
            {heroVisual
              ? <img src={heroVisual} alt="" style={{ position: 'relative', width: '100%', height: '100%', maxHeight: 390, objectFit: 'contain', display: 'block' }} />
              : <div style={{ position: 'relative', width: isMobile ? 190 : 230, height: isMobile ? 190 : 230, borderRadius: '50%', display: 'grid', placeItems: 'center', background: tint(0.09), border: `2px dotted ${tint(0.42)}` }}>
                  <div style={{ width: '68%', height: '68%', borderRadius: '50%', display: 'grid', placeItems: 'center', border: `2px solid ${signalColor}`, color: signalColor }}><Award style={{ width: '48%', height: '48%' }} /></div>
                  <span style={{ position: 'absolute', bottom: '13%', borderRadius: 999, padding: '6px 13px', background: signalColor, color: '#fff', fontSize: 10, fontWeight: 850, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Certified</span>
                </div>}
          </div>
        </motion.section>

        <div style={{ maxWidth: 1120, margin: '0 auto', padding: isMobile ? '20px 20px 56px' : '28px 24px 72px' }}>
          {/* Facts strip -- the 140px min keeps two columns on phones instead of a single tall stack */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
            {facts.map((f, i) => (
              <div key={i} className="cert-card" style={{ ...card, padding: 18 }}>
                <f.icon className="w-5 h-5" style={{ color: signalColor, marginBottom: 10 }} />
                <div style={{ fontSize: 22, fontWeight: 800 }}>{f.value}</div>
                <div style={{ fontSize: 12.5, color: ov.muted, marginTop: 2 }}>{f.label}</div>
              </div>
            ))}
          </div>

          {/* What to expect */}
          <section style={sectionStyle}>
            <div style={eyebrow}>The exam</div>
            <h2 style={h2}>What to expect</h2>
            <p style={sub}>
              {timeLimitMin ? `A ${timeLimitMin}-minute timed exam` : 'An untimed exam'} of {questionCount} question{questionCount === 1 ? '' : 's'}. You need {config?.passmark ?? 70}% to pass{maxAttempts > 0 ? `, with ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'} allowed.` : '.'}
              {retakeCooldownHours > 0 && maxAttempts !== 1 ? ` If you don't pass, you can retake after ${retakeCooldownHours} hour${retakeCooldownHours === 1 ? '' : 's'}.` : ''}
            </p>
            {sections.length > 0 && (
              <p style={sub}>
                {sections.length === 2
                  ? 'It has two sections: a Technical section and a Practical / Case study section.'
                  : sections[0] === 'practical'
                    ? 'This is a Practical / Case study exam.'
                    : 'This is a Technical exam.'}
              </p>
            )}
            {protect && (
              <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'rgba(245,158,11,0.12)' }}>
                <ShieldAlert className="w-5 h-5 flex-shrink-0" style={{ color: '#f59e0b' }} />
                <p style={{ fontSize: 13, color: ov.muted, lineHeight: 1.55 }}>Protected exam: copying, pasting and right-click are disabled, leaving the tab is recorded, and the timer cannot be paused.</p>
              </div>
            )}
          </section>

          {/* Skills */}
          {skillAreas.length > 0 && (
            <section className="cert-reveal" style={sectionStyle}>
              <div style={eyebrow}>Skills</div>
              <h2 style={h2}>Skills you will prove</h2>
              <p style={sub}>This certification assesses your ability across the following areas.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                {skillAreas.map(s => (
                  <div key={s.id} className="cert-card" style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: signalColor }} />
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{s.name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* The same three-card journey used on the certification landing page. */}
          <section className="cert-reveal" style={sectionStyle}>
            <div style={eyebrow}>Your certification journey</div>
            <h2 style={h2}>From preparation to credential in three steps</h2>
            <p style={sub}>Build confidence, demonstrate your skills, and unlock a credential you can carry forward.</p>
            <div style={{ display: 'grid', gap: 18, marginTop: 8 }}>
              {howSteps.map(({ Icon, title: stepTitle, desc }, i) => (
                <div key={stepTitle} className="cert-card" style={{ ...card, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(240px, 0.32fr) minmax(0, 0.68fr)', gap: isMobile ? 24 : 34, padding: isMobile ? 22 : 28, alignItems: 'start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
                      <span style={{ width: 44, height: 44, borderRadius: 12, background: tint(0.12), color: signalColor, display: 'grid', placeItems: 'center' }}><Icon style={{ width: 20, height: 20 }} /></span>
                      <span style={{ fontSize: 30, fontWeight: 750, color: tint(isDark ? 0.24 : 0.18) }}>0{i + 1}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 18, marginBottom: 6 }}>{stepTitle}</div>
                    <div style={{ fontSize: 13.5, color: ov.muted, lineHeight: 1.55 }}>{desc}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {i === 0 && <CertPrepCourses prepItems={prepItems} brandColor={signalColor} actionColor={brandColor} ov={ov} embedded />}
                    {i === 1 && (
                      <div style={{ maxWidth: 680, margin: '0 auto', overflow: 'hidden', borderRadius: 16, background: journeyTheme.bg, boxShadow: isDark ? 'none' : '0 14px 40px rgba(15,23,42,0.10)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '32px minmax(0,1fr) 72px', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                          <span style={{ width: 28, height: 28, borderRadius: 999, background: journeyTheme.track, color: journeyTheme.muted, display: 'grid', placeItems: 'center' }}><X style={{ width: 14, height: 14 }} /></span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 9, fontWeight: 700, color: journeyTheme.muted }}><span>Question 2 of 10</span><span>20%</span></div>
                            <div style={{ height: 6, borderRadius: 999, overflow: 'hidden', background: journeyTheme.track }}><div style={{ width: '20%', height: '100%', borderRadius: 999, background: signalColor }} /></div>
                          </div>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, fontSize: 10, fontWeight: 700, color: journeyTheme.muted }}><Clock style={{ width: 14, height: 14 }} />04:18</span>
                        </div>
                        <div style={{ maxWidth: 580, margin: '0 auto', padding: isMobile ? 16 : 20 }}>
                          <CertificationQuestionView q={journeyQuestion} qType="multiple_choice" value={journeyAnswer} onChange={setJourneyAnswer} t={journeyTheme} accentColor={signalColor} sharedPlayground={{}} />
                        </div>
                      </div>
                    )}
                    {i === 2 && (
                      <div style={{ maxWidth: 580, margin: '0 auto', borderRadius: 16, padding: isMobile ? 16 : 20, textAlign: 'center', background: journeyTheme.bg, color: journeyTheme.text, boxShadow: isDark ? 'none' : '0 14px 40px rgba(15,23,42,0.10)' }}>
                        <CertificationResultSummary compact result={{ score: 86, passed: true, correctQuestions: 17, totalQuestions: 20, skills: [{ id: 'analysis', name: 'Analysis', correct: 11, total: 12, pct: 92 }, { id: 'application', name: 'Application', correct: 5, total: 6, pct: 83 }, { id: 'judgement', name: 'Judgement', correct: 1, total: 2, pct: 50 }] }} passmark={config?.passmark ?? 70} theme={journeyTheme} accentColor={signalColor} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Prepare / resources */}
          {resources.length > 0 && (
            <section className="cert-reveal" style={sectionStyle}>
              <div style={eyebrow}>Resources</div>
              <h2 style={h2}>Exam resources</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginTop: 8 }}>
                {resources.map((r, i) => (
                  <a key={i} href={r.href} target="_blank" rel="noreferrer" className="cert-card" style={{ ...card, display: 'flex', alignItems: 'flex-start', gap: 12, textDecoration: 'none', color: ov.text }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: tint(0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <r.icon className="w-5 h-5" style={{ color: signalColor }} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>{r.title} <ChevronRight className="w-3.5 h-3.5" style={{ color: ov.muted }} /></div>
                      <div style={{ fontSize: 13, color: ov.muted, marginTop: 2 }}>{r.desc}</div>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

        </div>
      </div>
    );
  }

  // -- Exam / review phase --
  const answeredCount = questions.filter(qq => isExerciseType((qq as any).type) ? exercisePassed(answers[qq.id]) : !!answers[qq.id]).length;
  const progress = phase === 'review' ? 100 : total > 0 ? (index / total) * 100 : 0;
  const timeWarn = timeLeft !== null && timeLeft <= 60;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const answered = currentQuestion ? (isExerciseType(qType) ? exercisePassed(answers[currentQuestion.id]) : !!answers[currentQuestion.id]) : false;

  return (
    <div className={protect ? 'cert-noselect' : undefined} style={{ minHeight: '100vh', background: t.bg, color: t.text }}>
      {protectStyle}

      {/* Top bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 56, zIndex: 60, display: 'flex', alignItems: 'center', gap: isMobile ? 14 : 28, padding: isMobile ? '0 16px' : '0 56px', background: t.bg }}>
        <button onClick={() => { if (isPractice) { exitPractice(); } else if (!isPreview && timeLimitMin > 0) { setShowExit(true); } else { onExit(); } }} title={isPractice ? 'Exit practice' : 'Exit (progress saved, resume later)'} style={{ color: t.muted }}><X className="w-5 h-5" /></button>
        <div ref={barRef} style={{ flex: '1 1 0%', width: '100%', maxWidth: 1200, minWidth: 0, margin: '0 auto', height: 9, borderRadius: 999, background: t.track }}>
          <div style={{ height: '100%', width: `${progress}%`, minWidth: progress > 0 ? 9 : 0, background: accentColor, borderRadius: 999, transition: 'width 240ms ease' }} />
        </div>
        {timeLeft !== null && (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: isMobile ? 56 : 70, flexShrink: 0, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: timeWarn ? '#f43f5e' : t.muted }}>
            <Clock className="w-4 h-4" /> {fmt(timeLeft)}
          </span>
        )}
        {!isPractice && !isPreview && (
          <button onClick={() => setShowQuit(true)} title="Quit exam" style={{ color: t.muted, display: 'inline-flex', flexShrink: 0 }}><LogOut className="w-5 h-5" /></button>
        )}
      </div>

      {/* Exit warning: the timer keeps running while away */}
      {showExit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: t.card, color: t.text, maxWidth: 420, width: '100%', borderRadius: 16, padding: 28, border: `2px solid ${dialogBorder}`, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
            <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 10 }}>Exit exam?</h3>
            <p style={{ fontSize: 14.5, color: t.muted, lineHeight: 1.6, marginBottom: 22 }}>The timer keeps running while you are away and cannot be paused. It will continue until the time is up. You can resume before it ends, but any time that passes counts against you.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => setShowExit(false)} style={{ background: t.cardHover, color: t.text, fontWeight: 600, fontSize: 14, padding: '10px 18px', borderRadius: 10 }}>Cancel</button>
              <button onClick={onExit} style={{ background: accentColor, color: '#06281a', fontWeight: 700, fontSize: 14, padding: '10px 20px', borderRadius: 10 }}>Exit exam</button>
            </div>
          </div>
        </div>
      )}

      {/* Quit confirmation */}
      {showQuit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: t.card, color: t.text, maxWidth: 420, width: '100%', borderRadius: 16, padding: 28, border: `2px solid ${dialogBorder}`, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
            <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 10 }}>Quit Exam?</h3>
            <p style={{ fontSize: 14.5, color: t.muted, lineHeight: 1.6, marginBottom: 22 }}>Are you sure you want to quit the exam? You will lose one attempt and progress.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => setShowQuit(false)} disabled={quitting} style={{ background: t.cardHover, color: t.text, fontWeight: 600, fontSize: 14, padding: '10px 18px', borderRadius: 10 }}>Cancel</button>
              <button onClick={abandonExam} disabled={quitting} style={{ background: '#f43f5e', color: '#ffffff', fontWeight: 700, fontSize: 14, padding: '10px 20px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{quitting && <Loader2 className="w-4 h-4 animate-spin" />}Quit exam</button>
            </div>
          </div>
        </div>
      )}

      {/* Recorded-action warning */}
      <AnimatePresence>
        {warning && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 70, maxWidth: 'calc(100vw - 24px)', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: 12.5, fontWeight: 600 }}>
            <ShieldAlert className="w-4 h-4" /> {warning}
          </motion.div>
        )}
      </AnimatePresence>

      {/* SQL / Python exercises render as their own full-screen overlay below the top bar */}
      {phase === 'exam' && currentQuestion && qType === 'sql_exercise' && (
        <SQLExercisePlayer
          key={currentQuestion.id}
          question={currentQuestion}
          runtime={sqlRuntime}
          isPreparing={sqlPreparing}
          prepareError={sqlPrepareError}
          isDark
          accentColor={accentColor}
          savedAnswer={answers[currentQuestion.id]}
          completed={exercisePassed(answers[currentQuestion.id])}
          topOffset={56}
          leftOffset={0}
          sessionToken={sessionToken}
          examMode
          onComplete={(payload) => recordExercise(currentQuestion.id, payload)}
          onHintUsed={() => {}}
          onNext={advance}
          isLastQuestion={index >= total - 1}
        />
      )}
      {phase === 'exam' && currentQuestion && qType === 'python_exercise' && (
        <PythonExercisePlayer
          key={currentQuestion.id}
          question={currentQuestion}
          isDark
          accentColor={accentColor}
          savedAnswer={answers[currentQuestion.id]}
          completed={exercisePassed(answers[currentQuestion.id])}
          topOffset={56}
          leftOffset={contentPad.left}
          rightOffset={contentPad.right}
          sessionToken={sessionToken}
          examMode
          onComplete={(payload) => recordExercise(currentQuestion.id, payload)}
          onHintUsed={() => {}}
          onCheckAnswer={async (questionId, _code, output) => {
            const res = await api('check-python-answer', { question_id: questionId, output });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Failed to check answer.');
            return { passed: !!d.passed, message: d.message || (d.passed ? 'Output matches.' : 'Output does not match the expected result.'), proof: d.proof };
          }}
          onNext={advance}
          isLastQuestion={index >= total - 1}
        />
      )}

      {/* Non-exercise questions -- content left/right match the progress bar track exactly */}
      {phase === 'exam' && currentQuestion && !isExerciseType(qType) && (
        <div style={{ paddingTop: 96, paddingBottom: 140, paddingLeft: contentPad.left, paddingRight: contentPad.right }}>
          <AnimatePresence mode="wait">
            <motion.div key={currentQuestion.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.22 }}>
              <CertificationQuestionView q={currentQuestion} qType={qType} value={answers[currentQuestion.id] ?? ''} onChange={(v) => setAnswer(currentQuestion.id, v)} t={t} accentColor={accentColor} sharedPlayground={sharedPlayground} />
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {/* Continue (non-exercise only; exercises navigate via their own Next) */}
      {phase === 'exam' && currentQuestion && !isExerciseType(qType) && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 88, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '0 16px' : '0 28px', background: `linear-gradient(to top, ${t.bg}, transparent)` }}>
          {returnToReview
            ? <button onClick={() => { setReturnToReview(false); setPhase('review'); }} style={{ color: t.muted, fontSize: 13, fontWeight: 600, background: 'transparent' }}>Back to review</button>
            : <span />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {submitError && <span style={{ color: '#f43f5e', fontSize: 12.5 }}>{submitError}</span>}
            <button
              onClick={advance}
              disabled={returnToReview && !answered}
              style={{ background: answered ? accentColor : t.card, color: answered ? '#06281a' : t.muted, fontWeight: 700, fontSize: 14, padding: '11px 30px', borderRadius: 12, cursor: (returnToReview && !answered) ? 'not-allowed' : 'pointer', opacity: (returnToReview && !answered) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {returnToReview ? 'Continue' : answered ? (index >= total - 1 ? 'Review answers' : 'Continue') : 'Skip'}
            </button>
          </div>
        </div>
      )}

      {/* Final review / summary page -- reached after the last question; the bar is full here. */}
      {phase === 'review' && (
        <div style={{ maxWidth: 720, margin: '0 auto', padding: isMobile ? '76px 16px 56px' : '80px 24px 64px' }}>
          {/* Animated checkmark with a burst of star sparkles */}
          <div style={{ position: 'relative', width: 132, height: 132, margin: '0 auto 16px' }}>
            <motion.div
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              style={{ position: 'absolute', inset: 22, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15, type: 'spring', stiffness: 320, damping: 16 }}>
                <Check className="w-11 h-11" strokeWidth={3} style={{ color: '#fff' }} />
              </motion.span>
            </motion.div>
            {[
              { top: 6, left: 30, size: 16 }, { top: 14, right: 20, size: 22 },
              { bottom: 10, left: 24, size: 20 }, { bottom: 18, right: 30, size: 15 },
              { top: '46%', left: -2, size: 13 },
            ].map((s, i) => (
              <motion.span key={i}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0.75, 1.2, 0.75], opacity: [0.45, 1, 0.45], rotate: [0, 25, 0] }}
                transition={{ duration: 1.8, delay: 0.3 + i * 0.16, repeat: Infinity, ease: 'easeInOut' }}
                style={{ position: 'absolute', top: s.top as any, left: s.left as any, right: s.right as any, bottom: s.bottom as any, lineHeight: 0 }}>
                <Sparkle style={{ width: s.size, height: s.size, color: '#fbbf24' }} fill="#fbbf24" />
              </motion.span>
            ))}
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 800, textAlign: 'center', marginBottom: 6 }}>Review your answers</h2>
          <p style={{ textAlign: 'center', fontSize: 14.5, color: t.muted, marginBottom: 28 }}>Answered questions are final. You can still answer the ones you skipped, then submit.</p>

          {/* Summary */}
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: isMobile ? 24 : 44, marginBottom: 30 }}>
            <Stat t={t} Icon={ListChecks} label="Questions" value={total} color={t.muted} />
            <Stat t={t} Icon={CheckCircle2} label="Answered" value={answeredCount} color={accentColor} />
            <Stat t={t} Icon={Circle} label="Not answered" value={total - answeredCount} color={total - answeredCount > 0 ? '#f43f5e' : t.muted} />
          </div>

          {/* minmax(0,1fr) pins the track to the container; a plain auto track sizes to the widest
              row's max-content and overflows on long question text (worst on phones). */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
            {questions.map((qq, i) => {
              const ok = isExerciseType((qq as any).type) ? exercisePassed(answers[qq.id]) : !!answers[qq.id];
              // Unanswered questions stay editable while time remains; answered ones are final.
              const canAnswerThis = !ok && (timeLeft === null || timeLeft > 0);
              const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 12, background: t.card, color: t.text } as const;
              const inner = (
                <>
                  {ok
                    ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: accentColor }} />
                    : <Circle className="w-5 h-5 flex-shrink-0" style={{ color: t.muted }} />}
                  <span style={{ color: t.muted, fontWeight: 700, fontSize: 13, width: 22, flexShrink: 0 }}>{i + 1}</span>
                  <span className="truncate" style={{ fontSize: 14, flex: 1, minWidth: 0, color: ok ? t.text : t.muted }}>
                    {shortText((qq as any).question) || `Question ${i + 1}`}
                  </span>
                  {canAnswerThis && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 12, fontWeight: 600, color: accentColor }}>
                      Answer <ChevronRight className="w-4 h-4" />
                    </span>
                  )}
                </>
              );
              return canAnswerThis
                ? <button key={qq.id} onClick={() => { setReturnToReview(true); setIndex(i); setPhase('exam'); }} style={{ ...rowStyle, textAlign: 'left', cursor: 'pointer' }}>{inner}</button>
                : <div key={qq.id} style={rowStyle}>{inner}</div>;
            })}
          </div>

          {submitError && <p style={{ color: '#f43f5e', fontSize: 13, textAlign: 'center', marginTop: 16 }}>{submitError}</p>}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
            <button onClick={submit} disabled={submitting}
              style={{ background: accentColor, color: '#06281a', fontWeight: 700, fontSize: 14, padding: '11px 36px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, opacity: submitting ? 0.7 : 1 }}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Submit exam
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ t, Icon, label, value, color }: { t: any; Icon: any; label: string; value: number; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Icon className="w-5 h-5" style={{ color }} />
        <span style={{ fontSize: 24, fontWeight: 800, color: t.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      <div style={{ fontSize: 12, color: t.muted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

// Merge the certification's shared playground data into a question's playground, so a dataset defined
// once is available in every question. Shared tables/datasets load first, then any question-specific
// ones; skipped when the question opts out (useSharedData === false).
function mergeSharedPlayground(pg: NonNullable<CourseQuestion['playground']>, shared: PlaygroundData) {
  if (pg.useSharedData === false) return pg;
  const joinSetup = (a?: string, b?: string) => [a, b].map(s => (s ?? '').trim()).filter(Boolean).join('\n') || undefined;
  if ((pg.language ?? 'sql') === 'sql') {
    return { ...pg, sqlTables: [...(shared.sqlTables ?? []), ...(pg.sqlTables ?? [])], setupSql: joinSetup(shared.setupSql, pg.setupSql) };
  }
  return { ...pg, pythonDatasets: [...(shared.pythonDatasets ?? []), ...(pg.pythonDatasets ?? [])], setupPython: joinSetup(shared.setupPython, pg.setupPython) };
}

// One non-exercise question (multiple_choice | image | code | fill_blank | arrange), optionally with
// a non-graded runnable playground the student uses to work out the answer.
export function CertificationQuestionView({ q, qType, value, onChange, t, accentColor, sharedPlayground }: {
  q: any; qType: string; value: string; onChange: (v: string) => void; t: any; accentColor: string; sharedPlayground: PlaygroundData;
}) {
  const options: string[] = Array.isArray(q.options) ? q.options : [];
  const [hovered, setHovered] = useState<number | null>(null);
  const hoverProps = (i: number) => ({ onMouseEnter: () => setHovered(i), onMouseLeave: () => setHovered(null) });

  // The answer body for this question type (no title -- the title renders once on top).
  let body: React.ReactNode;

  if (qType === 'image') {
    const images: string[] = Array.isArray(q.optionImages) ? q.optionImages : [];
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {options.map((opt, i) => {
          const selected = value === String(i);
          const hover = hovered === i && !selected;
          // The image is the answer; only show a label if the instructor set a real one (hide the
          // auto-seeded "Option 1"/"Option 2" placeholders).
          const showLabel = !!opt && !/^option\s*\d+$/i.test(opt.trim());
          return (
            <button key={i} onClick={() => onChange(String(i))} {...hoverProps(i)}
              style={{ background: '#fff', borderRadius: 16, padding: 18, border: `2px solid ${selected ? accentColor : hover ? `${accentColor}80` : 'transparent'}`, boxShadow: selected ? `0 0 0 4px ${accentColor}33` : hover ? '0 6px 18px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.3)', transform: hover ? 'translateY(-2px)' : 'none', transition: 'all 140ms ease', textAlign: 'center', cursor: 'pointer' }}>
              {images[i] && <img src={images[i]} alt="" style={{ width: '100%', height: 300, objectFit: 'contain', marginBottom: showLabel ? 10 : 0 }} />}
              {showLabel && <span style={{ color: '#111', fontSize: 14, fontWeight: 600 }}>{opt}</span>}
            </button>
          );
        })}
      </div>
    );
  } else if (qType === 'multiple_choice' || qType === 'code' || qType === 'image_choice') {
    // Multiple-answer mode: the value is the selected option texts '|||'-joined (in option order).
    const multi = !!q.multiSelect;
    const selectedList = value ? value.split('|||') : [];
    const isSel = (opt: string) => multi ? selectedList.includes(opt) : value === opt;
    const choose = (opt: string) => {
      if (!multi) { onChange(opt); return; }
      const set = new Set(selectedList);
      set.has(opt) ? set.delete(opt) : set.add(opt);
      onChange(options.filter(o => set.has(o)).join('|||'));
    };
    body = (
      <>
        {qType === 'code' && q.codeSnippet && (
          <pre style={{ background: '#0c0d12', border: `1px solid ${t.border}`, borderRadius: 12, padding: 16, width: '100%', margin: '0 0 22px', overflowX: 'auto', fontSize: 13, lineHeight: 1.6, color: '#e4e4e7' }}><code>{q.codeSnippet}</code></pre>
        )}
        {multi && <p style={{ fontSize: 13, color: t.muted, margin: '0 0 14px' }}>Select all that apply.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, width: '100%' }}>
          {options.map((opt, i) => {
            const selected = isSel(opt);
            const hover = hovered === i && !selected;
            return (
              <button key={i} onClick={() => choose(opt)} {...hoverProps(i)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, textAlign: 'left', padding: '18px 22px', borderRadius: 14, background: selected ? `${accentColor}1f` : hover ? t.cardHover : t.card, border: `1.5px solid ${selected ? accentColor : hover ? `${accentColor}80` : t.border}`, color: t.text, fontSize: 15.5, transform: hover ? 'translateY(-1px)' : 'none', transition: 'all 130ms ease', cursor: 'pointer' }}>
                <span>{opt}</span>
                {multi
                  ? <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${selected ? accentColor : t.muted}`, background: selected ? accentColor : 'transparent' }}>{selected && <Check className="w-3.5 h-3.5" style={{ color: '#06281a' }} />}</span>
                  : <span style={{ fontSize: 13, color: selected || hover ? accentColor : t.muted, fontWeight: 600 }}>{i + 1}</span>}
              </button>
            );
          })}
        </div>
      </>
    );
  } else if (qType === 'fill_blank') {
    const snippet: string = q.codeSnippet ?? '';
    const segments = snippet.split(/_{3,}/);          // '___' (3+ underscores) marks each blank
    const blankCount = segments.length - 1;
    if (blankCount >= 1) {
      const vals = value ? value.split('|||') : [];
      const setBlank = (i: number, v: string) => {
        const next = Array.from({ length: blankCount }, (_, k) => (k === i ? v : (vals[k] ?? '')));
        onChange(next.join('|||'));
      };
      body = (
        <>
          <style>{`.cert-blank:focus{border-color:${accentColor};box-shadow:0 0 0 2px ${accentColor}40;}`}</style>
          <div style={{ width: '100%', background: '#0c0d12', border: `1px solid ${t.border}`, borderRadius: 12, padding: 18, overflowX: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 14, lineHeight: 2.1, color: '#e4e4e7', whiteSpace: 'pre-wrap' }}>
            {segments.map((seg, i) => (
              <span key={i}>
                {seg}
                {i < blankCount && (
                  <input
                    className="cert-blank"
                    value={vals[i] ?? ''}
                    onChange={(e) => setBlank(i, e.target.value)}
                    placeholder="write code here"
                    spellCheck={false}
                    autoComplete="off"
                    size={Math.max(12, (vals[i] ?? '').length + 2)}
                    style={{ display: 'inline-block', margin: '0 4px', padding: '2px 10px', background: 'rgba(255,255,255,0.06)', border: `1px solid ${t.border}`, borderRadius: 6, color: t.text, fontFamily: 'inherit', fontSize: 'inherit', outline: 'none', transition: 'border-color 120ms ease, box-shadow 120ms ease' }}
                  />
                )}
              </span>
            ))}
          </div>
        </>
      );
    } else {
      body = (
        <>
          {snippet && (
            <pre style={{ background: '#0c0d12', border: `1px solid ${t.border}`, borderRadius: 12, padding: 16, width: '100%', margin: '0 0 18px', overflowX: 'auto', fontSize: 13, lineHeight: 1.6, color: '#e4e4e7' }}><code>{snippet}</code></pre>
          )}
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your answer"
            spellCheck={false}
            autoComplete="off"
            style={{ width: '100%', display: 'block', background: t.card, border: `1.5px solid ${t.border}`, borderRadius: 12, padding: '14px 18px', color: t.text, fontSize: 16, fontFamily: snippet ? 'ui-monospace, monospace' : undefined }}
          />
        </>
      );
    }
  } else if (qType === 'arrange') {
    const order = value ? value.split('|||') : [];
    const toggle = (opt: string) => {
      const next = order.includes(opt) ? order.filter(o => o !== opt) : [...order, opt];
      onChange(next.join('|||'));
    };
    body = (
      <>
        <p style={{ textAlign: 'center', fontSize: 13, color: t.muted, marginBottom: 18 }}>Click the options in the correct order.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, width: '100%' }}>
          {options.map((opt, i) => {
            const pos = order.indexOf(opt);
            const selected = pos >= 0;
            const hover = hovered === i && !selected;
            return (
              <button key={i} onClick={() => toggle(opt)} {...hoverProps(i)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, textAlign: 'left', padding: '16px 20px', borderRadius: 12, background: selected ? `${accentColor}1f` : hover ? t.cardHover : t.card, border: `1.5px solid ${selected ? accentColor : hover ? `${accentColor}80` : t.border}`, color: t.text, fontSize: 15, transform: hover ? 'translateY(-1px)' : 'none', transition: 'all 130ms ease', cursor: 'pointer' }}>
                <span>{opt}</span>
                {selected && <span style={{ width: 24, height: 24, borderRadius: 999, background: accentColor, color: '#06281a', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{pos + 1}</span>}
              </button>
            );
          })}
        </div>
      </>
    );
  } else {
    body = <p style={{ textAlign: 'center', color: t.muted }}>Unsupported question type.</p>;
  }

  const pg = q.playground;
  const playground = pg ? mergeSharedPlayground(pg, sharedPlayground) : null;
  const hasPlayground = !!playground && !!((playground.starterCode ?? '').trim() || (playground.setupSql ?? '').trim() || (playground.setupPython ?? '').trim() || playground.sqlTables?.length || playground.pythonDatasets?.length || playground.language);
  // Left panel (rendered beside the answer): a runnable playground, or an image-question's prompt image.
  const leftPanel = hasPlayground
    ? <CertificationPlayground playground={playground!} accentColor={accentColor} />
    : (qType === 'image_choice' && q.imageUrl)
      ? <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          <img src={q.imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: 440, borderRadius: 12, objectFit: 'contain' }} />
        </div>
      : null;
  // Rich-text questions (authored via the rich editor) carry HTML -- render them sanitized and
  // left-aligned with proper typography. Plain legacy questions keep the centered heading.
  const isRich = /<[a-z][\s\S]*>/i.test(String(q.question ?? ''));
  const heading = isRich ? (
    <>
      <style>{`
        .cert-q-rich { font-size: 18px; line-height: 1.65; text-align: left; }
        .cert-q-rich > :first-child { margin-top: 0; }
        .cert-q-rich p { margin: 0 0 12px; }
        .cert-q-rich strong { font-weight: 700; }
        .cert-q-rich ul, .cert-q-rich ol { margin: 0 0 12px; padding-left: 22px; }
        .cert-q-rich li { margin: 4px 0; }
        .cert-q-rich a { color: ${accentColor}; text-decoration: underline; }
        .cert-q-rich code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 5px; font-family: ui-monospace, monospace; font-size: 0.92em; }
        .cert-q-rich pre { background: #0c0d12; border: 1px solid ${t.border}; border-radius: 10px; padding: 14px; overflow-x: auto; margin: 0 0 12px; }
        .cert-q-rich pre code { background: none; padding: 0; }
        .cert-q-rich img { max-width: 100%; border-radius: 10px; margin: 6px 0; }
        .cert-q-rich table { border-collapse: collapse; width: 100%; margin: 0 0 12px; }
        .cert-q-rich th, .cert-q-rich td { border: 1px solid ${t.border}; padding: 8px 10px; text-align: left; }
        .cert-q-rich h2, .cert-q-rich h3 { font-weight: 700; margin: 0 0 10px; }
      `}</style>
      <div className="cert-q-rich" style={{ marginBottom: leftPanel ? 20 : 26, color: t.text }} dangerouslySetInnerHTML={{ __html: sanitizeQuestionContent(q.question) }} />
    </>
  ) : (
    <h2 style={{ fontSize: 22, fontWeight: 700, textAlign: 'center', marginBottom: leftPanel ? 22 : 28, lineHeight: 1.4, color: t.text }}>{q.question}</h2>
  );
  const sectionName = q.section === 'practical' ? 'Practical / Case study' : q.section === 'technical' ? 'Technical' : '';
  const Title = (
    <>
      {sectionName && <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: accentColor, marginBottom: 8, textAlign: isRich ? 'left' : 'center' }}>{sectionName} section</div>}
      {heading}
    </>
  );

  // Case-study stimulus, delivered inline on the question when it belongs to a scenario. Shown above
  // the question so several questions can build on one shared context.
  const scenario = q.scenario as { title?: string; content?: string } | undefined;
  const Scenario = scenario && (scenario.title || scenario.content) ? (
    <div style={{ background: t.card, borderRadius: 12, padding: '16px 20px', marginBottom: 20, textAlign: 'left' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: accentColor, marginBottom: 6 }}>Case study</div>
      {scenario.title && <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: t.text }}>{scenario.title}</div>}
      {scenario.content && (
        <>
          <style>{`
            .cert-scenario-rich { font-size: 14.5px; line-height: 1.65; color: ${t.muted}; }
            .cert-scenario-rich > :first-child { margin-top: 0; }
            .cert-scenario-rich > :last-child { margin-bottom: 0; }
            .cert-scenario-rich p { margin: 0 0 10px; }
            .cert-scenario-rich strong { font-weight: 700; color: ${t.text}; }
            .cert-scenario-rich ul, .cert-scenario-rich ol { margin: 0 0 10px; padding-left: 22px; }
            .cert-scenario-rich li { margin: 4px 0; }
            .cert-scenario-rich a { color: ${accentColor}; text-decoration: underline; }
            .cert-scenario-rich blockquote { margin: 0 0 10px; padding: 6px 16px; border-left: 3px solid ${accentColor}; color: ${t.text}; }
            .cert-scenario-rich code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 5px; font-family: ui-monospace, monospace; font-size: 0.92em; }
            .cert-scenario-rich pre { background: #0c0d12; border: 1px solid ${t.border}; border-radius: 10px; padding: 14px; overflow-x: auto; margin: 0 0 10px; }
            .cert-scenario-rich pre code { background: none; padding: 0; }
            .cert-scenario-rich img { max-width: 100%; border-radius: 10px; margin: 6px 0; }
            .cert-scenario-rich table { border-collapse: collapse; width: 100%; margin: 0 0 10px; }
            .cert-scenario-rich th, .cert-scenario-rich td { border: 1px solid ${t.border}; padding: 8px 10px; text-align: left; }
            .cert-scenario-rich h2, .cert-scenario-rich h3 { font-weight: 700; margin: 0 0 8px; color: ${t.text}; }
          `}</style>
          <div className="cert-scenario-rich" dangerouslySetInnerHTML={{ __html: sanitizeQuestionContent(scenario.content) }} />
        </>
      )}
    </div>
  ) : null;

  if (leftPanel) {
    // Question on top, image/playground on the left, the answer options on the right.
    return (
      <div>
        {Scenario}
        {Title}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
          {leftPanel}
          <div>{body}</div>
        </div>
      </div>
    );
  }
  return <div>{Scenario}{Title}{body}</div>;
}

// --- Overview "Complete courses" cards ---
//
// The courses / learning paths a learner should finish before the exam. Resolved fresh from the
// public published_* views (the same source the marketing landing page reads) and shown as
// landing-page-style cards with a grow-on-hover preview. Always light, to match the overview.
type PrepDetail = {
  id: string; type: 'course' | 'path'; title: string; description: string; imageUrl: string; slug: string;
  pathCourses?: { id: string; title: string; imageUrl: string }[];
};

// No-cover fallback matches the learning path page (components/student CoverThumbnail):
// a soft green tint with a green icon, rather than the landing page's per-type gradients.
const PREP_FALLBACK_BG = 'rgba(34,197,94,0.10)';
const PREP_ICON = '#16a34a';

// Courses open at their public slug; a learning path opens in the student dashboard.
const prepHref = (item: PrepDetail) => (item.type === 'course' ? `/${item.slug}` : '/student');

function CertPrepCourses({ prepItems, brandColor, actionColor = brandColor, ov, embedded = false }: {
  prepItems: CertificationPrepItem[];
  brandColor: string;
  actionColor?: string;
  ov: { bg: string; card: string; surface: string; surfaceAlt: string; border: string; text: string; muted: string };
  embedded?: boolean;
}) {
  const [details, setDetails] = useState<PrepDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ item: PrepDetail; left: number; top: number; originX: number; originY: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 120); };

  useEffect(() => {
    let cancelled = false;
    const courseIds = prepItems.filter(p => p.type === 'course').map(p => p.id);
    const pathIds = prepItems.filter(p => p.type === 'path').map(p => p.id);
    (async () => {
      const [cRes, pRes] = await Promise.all([
        courseIds.length ? supabase.from('published_courses').select('id,title,description,cover_image,slug').in('id', courseIds) : Promise.resolve({ data: [] as any[] }),
        pathIds.length ? supabase.from('published_learning_paths').select('id,title,description,cover_image').in('id', pathIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const pathItemMap: Record<string, { id: string; title: string; imageUrl: string }[]> = {};
      if (pathIds.length) {
        const { data: pi } = await supabase.from('published_path_items').select('path_id,id,title,cover_image,position').in('path_id', pathIds).order('position');
        (pi ?? []).forEach((r: any) => { (pathItemMap[r.path_id] ||= []).push({ id: r.id, title: r.title, imageUrl: resolveCoverUrl(r.cover_image) }); });
      }
      const courseMap: Record<string, PrepDetail> = {};
      (cRes.data ?? []).forEach((r: any) => { courseMap[r.id] = { id: r.id, type: 'course', title: r.title, description: r.description ?? '', imageUrl: resolveCoverUrl(r.cover_image), slug: r.slug }; });
      const pathMap: Record<string, PrepDetail> = {};
      (pRes.data ?? []).forEach((r: any) => { pathMap[r.id] = { id: r.id, type: 'path', title: r.title, description: r.description ?? '', imageUrl: resolveCoverUrl(r.cover_image), slug: '', pathCourses: pathItemMap[r.id] ?? [] }; });
      // Keep the instructor's chosen order; drop any id that is no longer published.
      const ordered = prepItems.map(p => (p.type === 'course' ? courseMap[p.id] : pathMap[p.id])).filter(Boolean) as PrepDetail[];
      if (!cancelled) { setDetails(ordered); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [prepItems]);

  useEffect(() => () => cancelClose(), []);

  if (details.length === 0) return embedded ? (
    <div style={{ minHeight: 150, borderRadius: 16, padding: 22, display: 'grid', placeItems: 'center', textAlign: 'center', background: ov.surface, color: ov.muted, fontSize: 13.5 }}>
      {loading ? 'Loading required learning…' : prepItems.length > 0 ? 'The configured learning is not currently published.' : 'No required course or learning path has been configured for this certification.'}
    </div>
  ) : null;

  const openHover = (item: PrepDetail, el: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = item.type === 'path' ? Math.min(640, Math.max(360, (item.pathCourses?.length ?? 0) * 120 + 32)) : 320;
    const H = 460;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const top = Math.max(12, Math.min(r.top - 20, window.innerHeight - H - 12));
    const originX = Math.max(0, Math.min(r.left + r.width / 2 - left, W));
    const originY = Math.max(0, Math.min(r.top + r.height / 2 - top, H));
    setHover({ item, left, top, originX, originY });
  };
  const isDarkRequired = ov.bg === '#17181E';

  return (
    <div style={{ marginTop: embedded ? 0 : 32, borderRadius: embedded ? 18 : undefined, padding: embedded ? 18 : undefined, background: embedded ? ov.surface : undefined, boxShadow: embedded && !isDarkRequired ? '0 14px 38px rgba(15,23,42,0.08)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 17 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
          <span style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 13, display: 'grid', placeItems: 'center', background: `${brandColor}14`, color: brandColor }}><BookOpenCheck style={{ width: 20, height: 20 }} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase', color: brandColor, marginBottom: 3 }}>Required preparation</div>
            <div style={{ fontSize: embedded ? 18 : 20, fontWeight: 700, color: ov.text, lineHeight: 1.25 }}>Learning selected for this certification</div>
            <p style={{ fontSize: 12.5, color: ov.muted, lineHeight: 1.5, marginTop: 5 }}>Complete these before starting the assessment.</p>
          </div>
        </div>
        <span style={{ flexShrink: 0, borderRadius: 999, padding: '6px 10px', background: ov.card, color: ov.muted, fontSize: 11, fontWeight: 700 }}>{details.length} item{details.length === 1 ? '' : 's'}</span>
      </div>
      <div className="cert-required-track">
        {details.map(item => (
          <article key={`${item.type}:${item.id}`} className="cert-required-item" style={{ overflow: 'hidden', background: ov.card, borderRadius: 17, boxShadow: 'none' }} onMouseEnter={e => openHover(item, e.currentTarget)} onMouseLeave={scheduleClose}>
            <a href={prepHref(item)} className="cert-prep-card" style={{ textDecoration: 'none', color: 'inherit', display: 'block', padding: 10, paddingBottom: 0 }}>
              <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', width: '100%', aspectRatio: '16/9', background: item.imageUrl ? '#0b0b0d' : ov.surface }}>
                {item.imageUrl
                  ? <img src={item.imageUrl} alt={item.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: PREP_FALLBACK_BG }}><BookOpen style={{ width: 30, height: 30, color: PREP_ICON }} /></div>}
                <span style={{ position: 'absolute', left: 9, top: 9, borderRadius: 999, padding: '5px 9px', background: brandColor, color: '#fff', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', boxShadow: '0 4px 12px rgba(0,0,0,0.18)' }}>{item.type === 'path' ? 'Learning path' : 'Course'}</span>
              </div>
              <div style={{ padding: '12px 4px 11px' }}>
                <p style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.35, color: ov.text, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.title}</p>
                {item.description && <p style={{ fontSize: 12.5, color: ov.muted, lineHeight: 1.48, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description.replace(/<[^>]*>/g, ' ')}</p>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, fontSize: 11.5 }}>
                  <span style={{ color: ov.muted }}>{item.type === 'path' ? `${item.pathCourses?.length ?? 0} included item${(item.pathCourses?.length ?? 0) === 1 ? '' : 's'}` : 'Complete before assessment'}</span>
                </div>
              </div>
            </a>
          </article>
        ))}
      </div>
      {typeof document !== 'undefined' && hover && createPortal(
        <HoverPreviewCard key={`${hover.item.type}:${hover.item.id}`} left={hover.left} top={hover.top} originX={hover.originX} originY={hover.originY} onEnter={cancelClose} onLeave={scheduleClose}>
          <PrepPreview item={hover.item} brandColor={brandColor} actionColor={actionColor} ov={ov} />
        </HoverPreviewCard>,
        document.body,
      )}
    </div>
  );
}

// Hover popup content -- mirrors the landing page's course/path preview in the active theme.
function PrepPreview({ item, brandColor, actionColor, ov }: { item: PrepDetail; brandColor: string; actionColor: string; ov: { bg: string; card: string; surface: string; surfaceAlt: string; border: string; text: string; muted: string } }) {
  const desc = item.description.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const href = prepHref(item);
  const isDarkPreview = ov.bg === '#17181E';
  const clamp = (lines: number) => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' });
  const cta = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, padding: '10px 16px', borderRadius: 12, background: actionColor, color: 'white', textDecoration: 'none' };

  if (item.type === 'path') {
    const courses = item.pathCourses ?? [];
    const popupW = Math.min(640, Math.max(360, courses.length * 120 + 32));
    return (
      <div style={{ width: popupW, borderRadius: 16, overflow: 'hidden', background: ov.card, boxShadow: isDarkPreview ? '0 18px 55px rgba(0,0,0,0.38)' : '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ padding: '16px 16px 0' }}>
          <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, marginBottom: 8, background: PREP_ICON, color: 'white' }}>Learning Path</span>
          <h3 style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 6, color: ov.text, ...clamp(2) }}>{item.title}</h3>
          {desc && <p style={{ fontSize: 14, lineHeight: 1.5, color: ov.muted, ...clamp(2) }}>{desc}</p>}
        </div>
        <div style={{ padding: 16 }}>
          {courses.length > 0 ? (
            <>
              <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12, color: ov.muted }}>{courses.length} item{courses.length !== 1 ? 's' : ''} in this path</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {courses.map(c => (
                  <div key={c.id} style={{ flexShrink: 0, width: 110 }}>
                    <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 6, aspectRatio: '16/9', background: c.imageUrl ? '#0b0b0d' : ov.surface }}>
                      {c.imageUrl
                        ? <img src={c.imageUrl} alt={c.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><BookOpen style={{ width: 18, height: 18, color: '#9CA3AF' }} /></div>}
                    </div>
                    <p style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.3, color: ov.text, ...clamp(2) }}>{c.title}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (desc && <p style={{ fontSize: 14, lineHeight: 1.5, color: ov.muted }}>{desc}</p>)}
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...cta, marginTop: 16 }}><Play style={{ width: 14, height: 14 }} /> Start path</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: 320, borderRadius: 16, overflow: 'hidden', background: ov.card, boxShadow: isDarkPreview ? '0 18px 55px rgba(0,0,0,0.38)' : '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)' }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: item.imageUrl ? '#0b0b0d' : 'transparent' }}>
        {item.imageUrl
          ? <img src={item.imageUrl} alt={item.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: PREP_FALLBACK_BG }}><BookOpen style={{ width: 40, height: 40, color: PREP_ICON }} /></div>}
        <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: PREP_ICON, color: 'white' }}>Course</span>
      </div>
      <div style={{ padding: 20 }}>
        <p style={{ fontSize: 12, marginBottom: 4, color: ov.muted }}>Course</p>
        <h3 style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3, marginBottom: 8, color: ov.text, ...clamp(2) }}>{item.title}</h3>
        {desc && <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 12, color: ov.muted, ...clamp(3) }}>{desc}</p>}
        <a href={href} target="_blank" rel="noopener noreferrer" style={cta}><Play style={{ width: 14, height: 14 }} /> Start learning</a>
      </div>
    </div>
  );
}
