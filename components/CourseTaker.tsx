'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { safeEmbedUrl as getVideoEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { HtmlEmbedFrame } from '@/components/HtmlEmbedFrame';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, XCircle, Loader2, ChevronRight, RotateCcw,
  Clock, EyeOff, AlertTriangle, ShieldAlert, GripVertical,
  ChevronLeft, BookOpen, X, ExternalLink, ArrowRight, MoreHorizontal, Zap,
  ArrowLeftToLine, ArrowRightFromLine, Download, ArrowDownToLine, Lock,
  Check, Play, FileText, FlaskConical, ListChecks, Copy,
  ArrowUp, ArrowDown, PenLine, Link2, Image as ImageIcon, Lightbulb,
} from 'lucide-react';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { XpBadgeStack } from '@/components/XpBadge';
import { AnimatedField } from '@/components/AnimatedField';
import { useTheme } from '@/components/ThemeProvider';
import type { QuestionType, DownloadItem, CourseQuestion } from '@/lib/course-schema';
import { linkedInSharePointsFor } from '@/lib/course-schema';
import { courseProgressCounts, answeredScorableCount } from '@/lib/course-progress';
import { preflightLinkedInPostUrl } from '@/lib/linkedin-post-url';
import { saveMyLinkedInProfileUrl, shareClaimErrorMessage } from '@/lib/linkedin-profile';
import { sanitizeRichText } from '@/lib/sanitize';
import { LessonRenderer } from '@/components/lesson/LessonRenderer';
import { LessonAudioPlayer } from '@/components/lesson/LessonAudioPlayer';
import { supabase } from '@/lib/supabase';
import { getFontById, loadGoogleFont } from '@/lib/fonts';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { ScoreGauge } from '@/components/ScoreGauge';
import DashboardCritiquePlayer from '@/components/DashboardCritiquePlayer';
import CodeReviewPlayer from '@/components/CodeReviewPlayer';
import ExcelReviewPlayer from '@/components/ExcelReviewPlayer';
import DocumentReviewPlayer from '@/components/DocumentReviewPlayer';
import PdfCarousel from '@/components/PdfCarousel';
import { pdfDownloadUrl } from '@/lib/cloudinary-pdf';
import dynamic from 'next/dynamic';
import { initSQLRuntime, SQLRuntime } from '@/lib/sql-engine';

const SQLExercisePlayer = dynamic(() => import('@/components/sql-course/SQLExercisePlayer'), { ssr: false });
const PythonExercisePlayer = dynamic(() => import('@/components/sql-course/PythonExercisePlayer'), { ssr: false });

// Hamburger -- slightly tighter line spacing than lucide's Menu (lines at 7/12/17 vs 6/12/18)
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" className={className}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

type ShowAnswers = 'per_question' | 'after_quiz' | 'none';

// QuestionType / DownloadItem / CourseQuestion come from the canonical contract in lib/course-schema.
const REVIEW_TYPES: QuestionType[] = ['code_review', 'excel_review', 'dashboard_critique', 'document_review'];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]!));
}

function stripWrappingBackticks(value: string): string {
  return value.trim()
    .replace(/^(?:`|&#96;|&grave;)/i, '')
    .replace(/(?:`|&#96;|&grave;)$/i, '');
}

function renderBody(html: string): string {
  const normalizedCode = html.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, code: string) =>
    `<code>${escapeHtml(stripWrappingBackticks(code).replace(/`|&#96;|&grave;/gi, ''))}</code>`
  );
  return sanitizeRichText(
    normalizedCode
      .replace(/``([^`]+)``/g, (_, code: string) => `<code>${escapeHtml(code)}</code>`)
      .replace(/`([^`]+)`/g, (_, code: string) => `<code>${escapeHtml(code)}</code>`)
  );
}

const INLINE_CODE_BADGE_CLASSES =
  '[&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:bg-emerald-50 [&_:not(pre)>code]:text-emerald-700 dark:[&_:not(pre)>code]:bg-emerald-500/15 dark:[&_:not(pre)>code]:text-emerald-400 [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none';

// -- Confetti burst --
function burstConfetti(canvas: HTMLCanvasElement, accent: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = [accent, '#10b981', '#f59e0b', '#ec4899', '#60a5fa', '#a78bfa', '#fff'];
  const particles: {
    x: number; y: number; vx: number; vy: number;
    color: string; size: number; rot: number; rv: number; alpha: number;
  }[] = [];

  for (let i = 0; i < 120; i++) {
    const angle = (Math.random() * Math.PI * 2);
    const speed = 4 + Math.random() * 10;
    particles.push({
      x: canvas.width / 2,
      y: canvas.height * 0.45,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI * 2,
      rv: (Math.random() - 0.5) * 0.2,
      alpha: 1,
    });
  }

  let frame = 0;
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35; // gravity
      p.vx *= 0.99;
      p.rot += p.rv;
      p.alpha = Math.max(0, p.alpha - 0.018);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    });
    frame++;
    if (frame < 90) requestAnimationFrame(animate);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  animate();
}

/**
 * True for slides that carry a gradeable answer. Section dividers, lesson-only slides, downloads
 * blocks and LinkedIn share slides all render as slides but must never count toward the score or
 * the percentage. The server applies the same filter in /api/course complete-attempt.
 */
function isScorableSlide(q: any): boolean {
  return !q?.lessonOnly && !q?.isSection && !q?.isDownloads && !q?.isLinkedInShare;
}

/** Slides whose "completion" is just having been seen, so Next stamps them 'viewed'. */
function isViewedOnlySlide(q: any): boolean {
  return !!(q?.lessonOnly || q?.isDownloads);
}

/**
 * complete-attempt refused because a required LinkedIn share has no claim. Carries the slide ids so
 * the student can be sent straight to them rather than shown a dead-end error.
 */
class ShareRequiredError extends Error {
  missingIds: string[];
  constructor(missingIds: string[]) {
    super('share_required');
    this.name = 'ShareRequiredError';
    this.missingIds = missingIds;
  }
}

// -- Sortable item for arrange questions --
function SortableItem({ id, label, idx, count, accent, isDark, isChecking, onMove }: {
  id: string; label: string; idx: number; count: number; accent: string; isDark: boolean; isChecking: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 px-3 py-3 rounded-xl border transition-all duration-150 ${
        isDark ? 'border-white/[0.07] bg-white/[0.035] text-[#ACB8C5]' : 'border-black/[0.06] bg-zinc-50 text-[#111111]'
      } ${isChecking ? 'pointer-events-none' : ''}`}
    >
      <span
        className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[11px] font-bold"
        style={{ background: `${accent}18`, color: accent }}
      >
        {idx + 1}
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {!isChecking && (
        <span className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => onMove(-1)} disabled={idx === 0} aria-label={`Move ${label} up`}
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-20"
            style={{ color: isDark ? '#8b98a5' : '#71717a', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)' }}>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={idx === count - 1} aria-label={`Move ${label} down`}
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-20"
            style={{ color: isDark ? '#8b98a5' : '#71717a', background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)' }}>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <span
            className="w-7 h-7 inline-flex items-center justify-center rounded-lg cursor-grab active:cursor-grabbing text-zinc-500 transition-colors"
            style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)' }}
            aria-label={`Drag ${label} to reorder`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </span>
        </span>
      )}
    </div>
  );
}

export function CourseTaker({
  config,
  isSubmitting,
  onSubmit,
  isSuccess,
  onReset,
  onRetake,
  onClose,
  isSharedView,
  collectStudentInfo = false,
  formId,
  inlineMode = false,
  postSubmission,
  relatedForms = [],
  certificateId = null,
  initialStudentName = '',
  initialStudentEmail = '',
  relatedAssignment = null,
  logoUrl = '',
  logoDarkUrl = '',
}: any) {
  const [phase, setPhase] = useState<'info' | 'course' | 'complete'>(
    collectStudentInfo || !!initialStudentName ? 'info' : 'course'
  );
  const [reviewMode, setReviewMode] = useState(false); // true when student has already earned a cert -- no XP/saves
  const [studentName, setStudentName] = useState(initialStudentName);
  const [studentEmail, setStudentEmail] = useState(initialStudentEmail);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [fillBlankAnswer, setFillBlankAnswer] = useState('');
  const [arrangeOrder, setArrangeOrder] = useState<string[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // AI review questions -- tracks which have been completed
  const [reviewCompleted, setReviewCompleted] = useState<Set<string>>(new Set());
  // Stores the full latest AI report per completed review question (persisted via the __review_ shadow key)
  const [reviewSummaries, setReviewSummaries] = useState<Record<string, any>>({});
  // Attempt count per review question (drives the per-question review limit)
  const [reviewCounts, setReviewCounts] = useState<Record<string, number>>({});
  const reviewCountsRef = useRef<Record<string, number>>({});

  // Feature 3: hint system
  const [hintsUsed, setHintsUsed] = useState<Set<string>>(new Set());
  const [hintVisible, setHintVisible] = useState(false);

  // Feature 4: 'auto' appearance mode follows the app theme the viewer selected.
  const { theme: appTheme } = useTheme();

  // Lesson sheet
  const [lessonOpen, setLessonOpen] = useState(false);
  const lessonOpenRef = useRef(false);
  useEffect(() => { lessonOpenRef.current = lessonOpen; }, [lessonOpen]);
  useEffect(() => { scoringLockRef.current = false; }, [currentQuestionIndex]);
  // Reset the content scroll to the top whenever the slide changes, so a new
  // lesson always starts at its title rather than the previous scroll position.
  const contentScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentScrollRef.current?.scrollTo({ top: 0 }); }, [currentQuestionIndex]);

  // Points system state
  const [totalPoints, setTotalPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const [floatingPoints, setFloatingPoints] = useState<{ id: number; text: string; x: number; y: number } | null>(null);
  const [displayedPoints, setDisplayedPoints] = useState(0);

  // Chapters drawer
  const [showChapters, setShowChapters] = useState(false);

  // Sidebar (persistent panel, non-inline mode only) -- closed by default on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

  // 3-dot menu + XP badge
  const [showMenu, setShowMenu] = useState(false);
  const [xpNotify, setXpNotify] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Anti-cheat state
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [attemptError, setAttemptError] = useState('');
  const [submitError, setSubmitError]   = useState('');
  const [submitSaving, setSubmitSaving] = useState(false);
  const [serverResult, setServerResult] = useState<{ score: number; passed: boolean; points: number } | null>(null);
  const [checkingAttempts, setCheckingAttempts] = useState(!!initialStudentName);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confettiRef   = useRef<HTMLCanvasElement | null>(null);
  const touchStartX   = useRef(0);
  const touchStartY   = useRef(0);

  // Progress save/resume state
  const [savedProgress, setSavedProgress] = useState<any>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);

  const sessionTokenRef = useRef<string | null>(null);
  // Prevents double-scoring when Check/Next is clicked twice before React state settles
  const scoringLockRef = useRef(false);
  // Always-current snapshot of progress -- used by the visibilitychange flush
  const progressRef = useRef({ answers: {} as Record<string, string>, index: 0, score: 0, points: 0, streak: 0, hintsUsed: new Set<string>() });
  const maxIdxRef   = useRef(0);
  // Synchronously-updated mirror of answers -- avoids stale closure when user navigates rapidly
  const answersRef  = useRef<Record<string, string>>({});

  // Leaderboard rank context (shown on result screen)
  const [rankCtx, setRankCtx] = useState<{ above: any; me: any; below: any; rank: number; total: number } | null>(null);

  // Existing certificate (student already completed this course)
  const [existingCertId, setExistingCertId] = useState<string | null>(null);
  const [finishPending, setFinishPending] = useState<any[] | null>(null); // unanswered questions blocking finish
  // LinkedIn share slides: draft URL per slide id, plus the in-flight/error state of its claim.
  const [shareDrafts, setShareDrafts] = useState<Record<string, string>>({});
  const [shareSaving, setShareSaving] = useState<string | null>(null);
  const [shareErrors, setShareErrors] = useState<Record<string, string>>({});
  const [sharePromptCopied, setSharePromptCopied] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState<string | null>(null);
  // Set when the server has no LinkedIn profile to check a post's author against: the slide asks for
  // it inline rather than dead-ending the student.
  const [needsProfile, setNeedsProfile] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [streakToast, setStreakToast] = useState<string | null>(null);
  const [lockedToast, setLockedToast] = useState<string | null>(null);
  const questions = useMemo(() => config.questions || [], [config.questions]);
  const learningOutcomes: string[] = config.learnOutcomes || [];
  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.filter(isScorableSlide).length;
  const totalSlides = questions.length;
  const answerMetaKey = (id: string) => `__meta_${id}`;
  const buildAnswerMeta = () => JSON.stringify({
    answeredAt: new Date().toISOString(),
    elapsedSeconds: Math.max(0, (Date.now() - questionStartTime) / 1000),
  });
  // Current section: walk back from currentQuestionIndex to find the nearest section divider
  const currentSection = useMemo(() => {
    for (let i = currentQuestionIndex; i >= 0; i--) {
      if ((questions[i] as any)?.isSection) return questions[i] as any;
    }
    return null;
  }, [questions, currentQuestionIndex]);
  // Count how many section dividers appear up to and including currentQuestionIndex
  const currentSectionNumber = useMemo(() => {
    let n = 0;
    for (let i = 0; i <= currentQuestionIndex; i++) {
      if ((questions[i] as any)?.isSection) n++;
    }
    return n;
  }, [questions, currentQuestionIndex]);
  const totalSections = useMemo(() => questions.filter((q: any) => q.isSection).length, [questions]);

  // True when the current SQL/Python exercise is the first task using this lesson title
  const isFirstTaskForLesson = useMemo(() => {
    const qType = (currentQuestion as any)?.type;
    if (qType !== 'sql_exercise' && qType !== 'python_exercise') return true;
    const lessonTitle = (currentQuestion as any)?.lesson?.title;
    if (!lessonTitle) return true;
    for (let i = 0; i < currentQuestionIndex; i++) {
      const q = questions[i] as any;
      if ((q.type === 'sql_exercise' || q.type === 'python_exercise') && q.lesson?.title === lessonTitle) return false;
    }
    return true;
  }, [questions, currentQuestionIndex, currentQuestion]);

  // Group questions into sections for the chapters drawer
  const chapters = useMemo(() => {
    const groups: { sectionTitle: string; sectionIdx: number | null; slides: { q: CourseQuestion; idx: number }[] }[] = [];
    let cur: typeof groups[0] = { sectionTitle: 'Introduction', sectionIdx: null, slides: [] };
    questions.forEach((q: CourseQuestion, idx: number) => {
      if ((q as any).isSection) {
        if (cur.sectionIdx !== null || cur.slides.length) groups.push(cur);
        cur = { sectionTitle: (q as any).sectionTitle || 'New Section', sectionIdx: idx, slides: [] };
      } else {
        cur.slides.push({ q, idx });
      }
    });
    if (cur.sectionIdx !== null || cur.slides.length) groups.push(cur);
    return groups;
  }, [questions]);
  const showAnswers: ShowAnswers = config.showAnswers ?? 'per_question';
  const passmark = config.passmark ?? 50;
  const courseTimerMins: number = config.courseTimer ?? 0;
  const maxAttempts: number = config.maxAttempts ?? 0;
  const questionType: QuestionType = currentQuestion?.type ?? 'multiple_choice';
  // Saved AI-review state for the current question, derived at render so it is present on first mount
  // (after navigation/resume the players remount, and reviewSummaries state can lag a frame).
  // Source of truth is the persisted __review_<id> shadow snapshot in `answers`; the in-session
  // reviewSummaries entry is preferred when present (it also carries the dashboard screenshot).
  const reviewSaved = (() => {
    if (!currentQuestion || !REVIEW_TYPES.includes(questionType)) return null;
    const id = currentQuestion.id;
    let shadow: any = null;
    const raw = answers[`__review_${id}`];
    if (raw) { try { shadow = JSON.parse(raw); } catch {} }
    const inSession = reviewSummaries[id];
    const count = Math.max(reviewCounts[id] ?? 0, typeof shadow?.count === 'number' ? shadow.count : 0);
    if (questionType === 'dashboard_critique') {
      return { result: inSession?.result ?? shadow?.report ?? undefined, imageUrl: inSession?.imageUrl, count };
    }
    return { report: (inSession ?? shadow?.report) ?? undefined, count };
  })();
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

  const accentColors: Record<string, string> = {
    forest: '#00bf63', lime: '#ADEE66', emerald: '#10b981', rose: '#f43f5e', amber: '#f59e0b', ocean: '#3E93FF',
  };
  const accent = (config as any).customAccent ?? accentColors[config.theme] ?? '#00bf63';

  const fontOption = getFontById(config.font ?? 'google-sans-text');
  useEffect(() => { loadGoogleFont(fontOption); }, [fontOption]);

  useEffect(() => {
    if (questionType !== 'sql_exercise' || sqlRuntimeRef.current || sqlInitStartedRef.current || sqlTables.length === 0) return;
    let cancelled = false;
    sqlInitStartedRef.current = true;
    setSqlPreparing(true);
    setSqlPrepareError('');
    initSQLRuntime(sqlTables)
      .then(runtime => {
        if (cancelled) {
          runtime.close();
          return;
        }
        sqlRuntimeRef.current = runtime;
        setSqlRuntime(runtime);
      })
      .catch(err => {
        if (!cancelled) setSqlPrepareError(err?.message || 'Could not prepare the SQL environment.');
      })
      .finally(() => {
        if (!cancelled) setSqlPreparing(false);
        if (!sqlRuntimeRef.current) sqlInitStartedRef.current = false;
      });
    return () => { cancelled = true; };
  }, [questionType, sqlTables]);

  useEffect(() => {
    return () => {
      sqlRuntimeRef.current?.close();
      sqlRuntimeRef.current = null;
      sqlInitStartedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'complete') return;
    sqlRuntimeRef.current?.close();
    sqlRuntimeRef.current = null;
    sqlInitStartedRef.current = false;
    setSqlRuntime(null);
  }, [phase]);

  // Close 3-dot menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Auto-collapse sidebar when entering SQL/Python exercise questions to give the editor more space
  useEffect(() => {
    if (questionType === 'sql_exercise' || questionType === 'python_exercise') {
      setSidebarOpen(false);
    } else {
      if (typeof window !== 'undefined' && window.innerWidth >= 640) setSidebarOpen(true);
    }
  }, [questionType]);
  const fontStyle = { fontFamily: fontOption.cssFamily };
  const isDark = (config.mode ?? 'dark') === 'auto' ? appTheme === 'dark' : (config.mode ?? 'dark') !== 'light';
  const cardBg = isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200 shadow-sm';
  const textColor = isDark ? 'text-[#ACB8C5]' : 'text-[#111111]';
  const mutedColor = isDark ? 'text-[#A8B5C2]' : 'text-[#555555]';
  const faintColor = isDark ? 'text-[#6b7a89]' : 'text-[#888888]';
  // Text tones mirror the shared theme (DARK_C/LIGHT_C) so the player matches the dashboard.
  // Two forms of the same tones: textColor/mutedColor/faintColor (above) for className, and
  // txt/txtMuted/txtFaint (below) for inline style={{ color }}. Roles: headings/primary = text,
  // body/secondary = muted, labels/metadata = faint. Button text on colored backgrounds stays white.
  const txt      = isDark ? DARK_C.text  : LIGHT_C.text;
  const txtMuted = isDark ? DARK_C.muted : LIGHT_C.muted;
  const txtFaint = isDark ? DARK_C.faint : LIGHT_C.faint;

  // Shuffle helper
  const shuffle = (arr: string[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Initialize arrange order when question changes
  useEffect(() => {
    if (!currentQuestion) return;
    const prevAnswer = answers[currentQuestion.id];
    const qType = currentQuestion.type ?? 'multiple_choice';
    if (REVIEW_TYPES.includes(qType)) {
      // Review questions don't use isChecking -- just track completion
      setIsChecking(false);
      setIsCorrect(null);
      setHintVisible(false);
      setSelectedOption(null);
      setFillBlankAnswer('');
      // Rehydrate the saved report + attempt count from the __review_ shadow key (all review types)
      const shadowData = answers[`__review_${currentQuestion.id}`];
      if (shadowData) {
        try {
          const rec = JSON.parse(shadowData);
          if (rec) {
            if (typeof rec.count === 'number') setReviewCounts(prev => ({ ...prev, [currentQuestion.id]: rec.count }));
            const summary = qType === 'dashboard_critique'
              ? (rec.report ? { result: rec.report, imageUrl: rec.imageUrl } : null)
              : (rec.report ?? null);
            if (summary) setReviewSummaries(prev => ({ ...prev, [currentQuestion.id]: summary }));
          }
        } catch {}
      }
      if (prevAnswer) {
        // For document_review, a 'failed' answer means the student scored below minScore
        // and still has retry attempts available -- don't mark as completed so they see
        // the upload form again instead of being locked out of their retry.
        if (qType !== 'document_review' || prevAnswer === 'completed') {
          setReviewCompleted(prev => new Set(prev).add(currentQuestion.id));
        }
      }
    } else if (prevAnswer) {
      // Normal question already answered -- restore locked state, no re-answering allowed
      const wasCorrect = isAnswerCorrect(currentQuestion, prevAnswer);
      setIsChecking(true);
      setIsCorrect(wasCorrect);
      setHintVisible(false);
      if (qType === 'fill_blank') {
        setFillBlankAnswer(prevAnswer);
        setSelectedOption(null);
      } else if (qType === 'arrange') {
        setArrangeOrder(prevAnswer.split('|||'));
        setSelectedOption(null);
      } else {
        setSelectedOption(prevAnswer);
        setFillBlankAnswer('');
      }
    } else {
      // Fresh question
      setFillBlankAnswer('');
      setSelectedOption(null);
      setIsChecking(false);
      setIsCorrect(null);
      setHintVisible(false);
      setQuestionStartTime(Date.now());
      if (qType === 'arrange') {
        setArrangeOrder(shuffle(currentQuestion.options));
      }
    }
    // Auto-open lesson before question if timing is set to 'before' (only for unanswered questions)
    if ((config as any).lessonTiming === 'before' && (currentQuestion.lesson?.doc || currentQuestion.lesson?.body || currentQuestion.lesson?.videoUrl || currentQuestion.lesson?.imageUrl || currentQuestion.lesson?.pdfUrl || currentQuestion.lesson?.audioUrl) && !prevAnswer) {
      setLessonOpen(true);
    } else {
      setLessonOpen(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex]);

  // Initialize arrange order on first load
  useEffect(() => {
    if (currentQuestion && (currentQuestion.type ?? 'multiple_choice') === 'arrange') {
      setArrangeOrder(shuffle(currentQuestion.options));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setArrangeOrder(items => {
        const oldIdx = items.indexOf(active.id as string);
        const newIdx = items.indexOf(over.id as string);
        return arrayMove(items, oldIdx, newIdx);
      });
    }
  };

  const moveArrangeItem = (index: number, direction: -1 | 1) => {
    if (isChecking) return;
    const target = index + direction;
    if (target < 0 || target >= arrangeOrder.length) return;
    setArrangeOrder(items => arrayMove(items, index, target));
  };

  // -- Timer --
  useEffect(() => {
    if (phase !== 'course' || !courseTimerMins) return;

    // Clear any existing interval before starting a new one (prevents double-ticking)
    if (timerRef.current) clearInterval(timerRef.current);

    // Only set the initial countdown once -- if timeLeft already has a value
    // it means the effect re-ran (StrictMode double-invoke etc.) and we must
    // not reset the clock.
    setTimeLeft(prev => (prev === null ? courseTimerMins * 60 : prev));

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timerRef.current!);
          setPhase('complete');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);




  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // -- Shared: run attempt/cert/progress checks after email is verified --
  // All queries go through /api/course (service role) -- anon client has no access to these tables.
  const runCourseChecks = useCallback(async (_email: string) => {
    setCheckingAttempts(true);

    if (!formId) { setCheckingAttempts(false); setPhase('course'); return; }

    try {
      const res = await fetch('/api/course', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionTokenRef.current ? { Authorization: `Bearer ${sessionTokenRef.current}` } : {}),
        },
        body: JSON.stringify({ action: 'get-progress', course_id: formId }),
      });
      const d = await res.json();

      // Review check comes first -- a student who passed must always be able to review,
      // even if they have since used all their remaining attempts.
      if (d.cert?.id || d.hasPassed) {
        // Already passed -- enter review mode: no saves, no XP, no new attempt.
        // Restore the passing attempt's state so previously completed lessons and answers remain visible.
        const prev = d.passingAttempt;
        if (prev && questions.length > 0) {
          // Clamp to a valid slide index -- complete-attempt stores totalQuestions which can
          // equal totalSlides on pure-quiz courses, causing currentQuestion to be undefined.
          const storedIndex = prev.current_question_index ?? 0;
          const prevIdx = Math.max(0, Math.min(storedIndex, questions.length - 1));
          maxIdxRef.current = prevIdx;
          setCurrentQuestionIndex(prevIdx);
          // Fill in 'viewed' for any lessonOnly/isDownloads slides missing from the
          // stored answers (the last lesson was not saved before completion in older attempts).
          const restoredAnswers: Record<string, string> = { ...(prev.answers ?? {}) };
          for (const q of questions) {
            // Share slides are deliberately excluded: their answer is the claimed post URL, so a
            // 'viewed' stamp would make an unshared slide look complete.
            if (isViewedOnlySlide(q) && !restoredAnswers[q.id]) {
              restoredAnswers[q.id] = 'viewed';
            }
          }
          setAnswers(restoredAnswers);
          answersRef.current = restoredAnswers;
          setScore(prev.score ?? 0);
          setTotalPoints(prev.points ?? 0);
          setDisplayedPoints(prev.points ?? 0);
          setStreak(prev.streak ?? 0);
          setHintsUsed(new Set(prev.hints_used ?? []));
          // Restore review reports + counts immediately -- the useEffect that normally
          // does this only fires when currentQuestionIndex changes, but in review mode
          // the index may not change (e.g. single-question course at index 0), so the
          // effect never re-runs and the saved report stays undefined.
          const summaries: Record<string, any> = {};
          const counts: Record<string, number> = {};
          const completed: string[] = [];
          for (const q of questions) {
            const qt = (q as any).type;
            if (!REVIEW_TYPES.includes(qt)) continue;
            const shadowData = restoredAnswers[`__review_${q.id}`];
            if (shadowData) {
              try {
                const rec = JSON.parse(shadowData);
                if (rec) {
                  if (typeof rec.count === 'number') counts[q.id] = rec.count;
                  const summary = qt === 'dashboard_critique'
                    ? (rec.report ? { result: rec.report, imageUrl: rec.imageUrl } : null)
                    : (rec.report ?? null);
                  if (summary) summaries[q.id] = summary;
                }
              } catch {}
            }
            if (restoredAnswers[q.id] === 'completed') completed.push(q.id);
          }
          if (Object.keys(summaries).length > 0) setReviewSummaries(prev => ({ ...prev, ...summaries }));
          if (Object.keys(counts).length > 0) {
            setReviewCounts(prev => ({ ...prev, ...counts }));
            reviewCountsRef.current = { ...reviewCountsRef.current, ...counts };
          }
          if (completed.length > 0) setReviewCompleted(prev => { const s = new Set(prev); completed.forEach(id => s.add(id)); return s; });
        }
        setReviewMode(true);
        setCheckingAttempts(false);
        setPhase('course');
        return;
      }

      if (maxAttempts > 0 && d.attemptCount >= maxAttempts) {
        setAttemptError(
          `You have used all ${maxAttempts} attempt${maxAttempts > 1 ? 's' : ''} for this course.`
        );
        setCheckingAttempts(false);
        setPhase('info');
        return;
      }

      if (d.progress && d.progress.current_question_index > 0) {
        // In-progress -- auto-resume from where they left off
        maxIdxRef.current = d.progress.current_question_index;
        setCurrentQuestionIndex(d.progress.current_question_index);
        setAnswers(d.progress.answers ?? {});
        answersRef.current = d.progress.answers ?? {};
        setScore(d.progress.score ?? 0);
        setTotalPoints(d.progress.points ?? 0);
        setDisplayedPoints(d.progress.points ?? 0);
        setStreak(d.progress.streak ?? 0);
        setHintsUsed(new Set(d.progress.hints_used ?? []));
        setCheckingAttempts(false);
        setPhase('course');
        return;
      }
    } catch { /* allow on error */ }

    setCheckingAttempts(false);
    setPhase('course');
  }, [maxAttempts, formId, questions]);

  // -- Start course -- get Supabase session token then run checks --
  const handleStartCourse = useCallback(async () => {
    if (!studentName.trim() || !studentEmail.trim()) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(studentEmail.trim())) {
      setAttemptError('Please enter a valid email address.');
      return;
    }

    setAttemptError('');
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) sessionTokenRef.current = session.access_token;
    await runCourseChecks(studentEmail.trim().toLowerCase());
  }, [studentName, studentEmail, runCourseChecks]);

  // Keep sessionTokenRef in sync whenever Supabase refreshes the access token
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) sessionTokenRef.current = session.access_token;
    });
    return () => subscription.unsubscribe();
  }, []);

  // Keep progressRef in sync so the visibilitychange flush always has the latest values
  useEffect(() => {
    maxIdxRef.current = Math.max(maxIdxRef.current, currentQuestionIndex);
    answersRef.current = answers;
    progressRef.current = { answers, index: maxIdxRef.current, score, points: totalPoints, streak, hintsUsed };
  }, [answers, currentQuestionIndex, score, totalPoints, streak, hintsUsed]);

  // Keep the review-count ref in sync with restored/updated counts
  useEffect(() => { reviewCountsRef.current = reviewCounts; }, [reviewCounts]);

  // Flush progress when the student switches away from this tab (keepalive ensures delivery on unload)
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== 'hidden') return;
      if (!formId || !studentEmail.trim() || reviewMode) return;
      const { answers, index, score, points, streak, hintsUsed } = progressRef.current;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionTokenRef.current) headers['Authorization'] = `Bearer ${sessionTokenRef.current}`;
      fetch('/api/course', {
        method: 'POST',
        headers,
        keepalive: true,
        body: JSON.stringify({
          action: 'save-progress',
          course_id: formId,
          current_question_index: index,
          answers,
          score,
          points,
          streak,
          hints_used: [...hintsUsed],
        }),
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [formId, studentEmail, reviewMode]);

  // Auto-start when pre-filled info arrives from the page (logged-in student)
  const autoStarted = useRef(false);
  useEffect(() => {
    if (initialStudentName && initialStudentEmail && !autoStarted.current) {
      autoStarted.current = true;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) sessionTokenRef.current = session.access_token;
        runCourseChecks(initialStudentEmail.trim().toLowerCase());
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save current progress via server API (fire-and-forget)
  const saveProgress = useCallback((
    newAnswers: Record<string, string>,
    newIndex: number,
    newScore: number,
    newPoints: number,
    newStreak: number,
    newHintsUsed: Set<string>,
  ) => {
    if (!formId || !studentEmail.trim()) return;
    if (reviewMode) return; // review mode -- never write new attempts
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionTokenRef.current) headers['Authorization'] = `Bearer ${sessionTokenRef.current}`;
    fetch('/api/course', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action:                 'save-progress',
        course_id:              formId,
        student_email:          studentEmail.trim(),
        student_name:           studentName.trim(),
        current_question_index: newIndex,
        answers:                newAnswers,
        score:                  newScore,
        points:                 newPoints,
        streak:                 newStreak,
        hints_used:             [...newHintsUsed],
      }),
    }).catch(() => {});
  }, [formId, studentEmail, studentName, reviewMode]);

  /**
   * Claim a LinkedIn post for a share slide.
   *
   * Unlike saveProgress this awaits the response, because the server is the only thing that knows
   * whether the post is already claimed by someone else -- a fire-and-forget write could not report
   * that. The server writes the answer itself, so on success we mirror the canonical URL it returns
   * into local state rather than saving our own.
   */
  const submitLinkedInShare = useCallback(async (q: any) => {
    const draft = (shareDrafts[q.id] ?? '').trim();
    if (!draft || reviewMode) return;
    const pre = preflightLinkedInPostUrl(draft);
    if (!pre.ok) {
      setShareErrors(prev => ({ ...prev, [q.id]: shareClaimErrorMessage(pre.code) }));
      return;
    }
    setShareErrors(prev => { const next = { ...prev }; delete next[q.id]; return next; });
    setShareSaving(q.id);
    // Captured before the write below: a re-claim (student correcting their link) must not add the
    // bonus a second time.
    const wasAlreadyClaimed = !!answersRef.current[q.id];
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sessionTokenRef.current) headers['Authorization'] = `Bearer ${sessionTokenRef.current}`;
      const res = await fetch('/api/course', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'claim-linkedin-share', course_id: formId, question_id: q.id, post_url: draft }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        // No profile on file to check the author against -- ask for it inline instead of erroring.
        if (json?.error === 'no_profile') {
          setNeedsProfile(q.id);
                    setProfileError('');
          return;
        }
        setShareErrors(prev => ({ ...prev, [q.id]: shareClaimErrorMessage(json?.error) }));
        // Deliberately NOT offering to change the saved profile here. Letting a student edit it in
        // response to a mismatch turns the check into a formality: paste a stranger's post, enter that
        // stranger's profile as your own, retry. Setting a profile for the first time is fine (above);
        // changing one to match a post that just failed is not.
        return;
      }

      const savedUrl = typeof json.url === 'string' ? json.url : draft;
      const newAnswers = { ...answersRef.current, [q.id]: savedUrl };
      answersRef.current = newAnswers;
      setAnswers(newAnswers);
      setShareDrafts(prev => ({ ...prev, [q.id]: savedUrl }));
      // The claim route mirrors the URL into an ACTIVE attempt, but a student whose first action is
      // this slide has no attempt row yet. Saving here creates it so the link survives a reload
      // even if they never press Continue.
      saveProgress(newAnswers, currentQuestionIndex, score, totalPoints, streak, hintsUsed);
      // Optimistic bonus so the header counter moves now; complete-attempt recomputes the
      // authoritative total from the live claim. Read the flag off config rather than the
      // pointsEnabled const, which is declared further down this component.
      const shareXpOn = (config as any).pointsSystem?.enabled !== false;
      const earned = typeof json.points === 'number' ? json.points : 0;
      if (shareXpOn && !wasAlreadyClaimed && earned > 0) {
        setTotalPoints(p => p + earned);
        // Same reward language the course already uses for a correct answer, so sharing reads as a
        // real win rather than a form submission.
        setFloatingPoints({ id: Date.now(), text: `+${earned} XP`, x: 50, y: 60 });
        setTimeout(() => setFloatingPoints(null), 1400);
      }
      if (!wasAlreadyClaimed && confettiRef.current) burstConfetti(confettiRef.current, accent);
    } catch {
      setShareErrors(prev => ({ ...prev, [q.id]: 'Could not save your link. Please try again.' }));
    } finally {
      setShareSaving(null);
    }
  }, [shareDrafts, reviewMode, formId, config, saveProgress, accent,
      currentQuestionIndex, score, totalPoints, streak, hintsUsed]);

  /** Save the student's LinkedIn profile, then retry the claim it was blocking. */
  const saveProfileAndRetry = useCallback(async (q: any) => {
    setProfileSaving(true);
    setProfileError('');
    try {
      const result = await saveMyLinkedInProfileUrl(profileDraft);
      if (!result.ok) { setProfileError(result.error); return; }
      setNeedsProfile(null);
      await submitLinkedInShare(q);
    } finally {
      setProfileSaving(false);
    }
  }, [profileDraft, submitLinkedInShare]);

  // Persist a completed AI review: stores the full latest report (+ attempt count) under a
  // __review_<id> shadow key so it survives reload and is readable by instructors, and records
  // the pass/fail answer used for scoring. Manual document review has no report (report: null).
  function recordReview(
    q: any,
    report: any,
    passed: boolean,
    extra?: { imageUrl?: string; documentReviewMode?: string },
  ) {
    const id = q.id;
    const type = q.type;
    const isManualDoc = extra?.documentReviewMode === 'manual';
    const alreadyDone = reviewCompleted.has(id);
    // Advance from the highest known count -- the in-session ref or the persisted shadow snapshot --
    // so a 2nd attempt right after a resume (before the ref is rehydrated) still increments correctly.
    let shadowCount = 0;
    const prevRaw = answersRef.current[`__review_${id}`];
    if (prevRaw) { try { const pr = JSON.parse(prevRaw); if (typeof pr?.count === 'number') shadowCount = pr.count; } catch {} }
    const nextCount = Math.max(reviewCountsRef.current[id] ?? 0, shadowCount) + 1;
    reviewCountsRef.current = { ...reviewCountsRef.current, [id]: nextCount };

    setReviewCompleted(prev => new Set(prev).add(id));
    setReviewCounts(prev => ({ ...prev, [id]: nextCount }));
    setReviewSummaries(prev => ({
      ...prev,
      [id]: type === 'dashboard_critique' ? { result: report, imageUrl: extra?.imageUrl } : report,
    }));

    const answer = passed ? 'completed' : 'failed';
    // Note: the dashboard screenshot (base64) is intentionally NOT persisted -- it would bloat the
    // course_attempts.answers JSONB and slow saves. It stays in session memory (reviewSummaries) so the
    // interactive critique works within the session; on reload the report renders without the overlay.
    const snapshot = JSON.stringify({
      type,
      count: nextCount,
      passed,
      submittedAt: new Date().toISOString(),
      report: isManualDoc ? null : report,
      ...(extra?.documentReviewMode ? { documentReviewMode: extra.documentReviewMode } : {}),
    });
    const newAnswers = { ...answersRef.current, [id]: answer, [`__review_${id}`]: snapshot };
    answersRef.current = newAnswers;

    const countsAsScore = !isManualDoc && passed;
    if (!alreadyDone && countsAsScore && !reviewMode) setScore(s => s + 1);
    setAnswers(newAnswers);
    saveProgress(newAnswers, currentQuestionIndex + 1, score + (!alreadyDone && countsAsScore ? 1 : 0), totalPoints, streak, hintsUsed);
  }

  // Mark active attempt as completed via API.
  // Retries up to 2 times on failure before throwing.
  // Returns the server-confirmed score/passed/points on success.
  const clearProgress = useCallback(async (finalScore: number): Promise<{ score: number; passed: boolean; points: number } | null> => {
    if (!formId || !studentEmail.trim()) return null;
    if (reviewMode) return null;
    const scorePct = totalQuestions > 0 ? Math.round((Math.min(finalScore, totalQuestions) / totalQuestions) * 100) : 100;
    const passed   = totalQuestions === 0 ? true : scorePct >= passmark;
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
    const body = JSON.stringify({
      action:                 'complete-attempt',
      course_id:              formId,
      score:                  scorePct,
      passed,
      points:                 totalPoints,
      current_question_index: totalQuestions,
      final_answers:          answersRef.current,
    });

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
      try {
        const res = await fetch('/api/course', { method: 'POST', headers, body });
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          return {
            score:  typeof json.score  === 'number' ? json.score  : scorePct,
            passed: typeof json.passed === 'boolean' ? json.passed : passed,
            points: typeof json.points === 'number' ? json.points : totalPoints,
          };
        }
        // The server refuses to complete while a required share is outstanding. Not retryable --
        // nothing changes by asking again -- so surface it immediately.
        if (res.status === 409) {
          const json = await res.json().catch(() => ({}));
          if (json?.error === 'share_required') {
            throw new ShareRequiredError(Array.isArray(json.missing) ? json.missing.map(String) : []);
          }
        }
        lastErr = new Error(`complete-attempt failed: ${res.status}`);
      } catch (err) {
        if (err instanceof ShareRequiredError) throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }, [formId, studentEmail, totalQuestions, passmark, totalPoints, reviewMode]);

  const finishCourse = useCallback(async (finalScore: number) => {
    setSubmitError('');
    setSubmitSaving(true);
    try {
      const result = await clearProgress(finalScore);
      const confirmedScore  = result?.score  ?? (totalQuestions > 0 ? Math.round((Math.min(finalScore, totalQuestions) / totalQuestions) * 100) : 100);
      const confirmedPassed = result?.passed ?? (totalQuestions === 0 ? true : confirmedScore >= passmark);
      const confirmedPoints = result?.points ?? totalPoints;
      if (result) setServerResult(result);
      // Skip the intermediate "Submit & See Results" screen -- go straight to results
      // using the server-confirmed values so what the student sees matches what is stored.
      await (onSubmit({ preventDefault: () => {} } as any, {
        name:         studentName,
        email:        studentEmail,
        score:        finalScore,
        total:        totalQuestions,
        percentage:   confirmedScore,
        passed:       confirmedPassed,
        answers:      answersRef.current,
        points:       confirmedPoints,
        streak,
        studentToken: sessionTokenRef.current,
      }) as any);
      setPhase('complete'); // triggers SQL runtime cleanup via useEffect
    } catch (err) {
      // Server refused: a required share is outstanding. Send them to the slide instead of an error
      // they cannot act on. Normally unreachable -- the player already blocks this path -- so this
      // covers local state drifting from the server, e.g. a second tab or a slide made required
      // after this attempt was loaded.
      if (err instanceof ShareRequiredError) {
        const missing = questions.filter((q: any) =>
          err.missingIds.includes(String(q.id)) || (err.missingIds.length === 0 && q.isLinkedInShare));
        setFinishPending(missing.length > 0 ? missing : null);
        if (missing.length === 0) {
          setSubmitError('A required LinkedIn share is still outstanding. Please refresh and try again.');
        }
        return;
      }
      setSubmitError('Could not save your result. Please check your connection and try again.');
    } finally {
      setSubmitSaving(false);
    }
  }, [clearProgress, onSubmit, studentName, studentEmail, totalQuestions, passmark, totalPoints, streak, questions]);

  // Resume from saved progress
  const handleResume = useCallback(() => {
    if (!savedProgress) return;
    maxIdxRef.current = savedProgress.current_question_index ?? 0;
    setCurrentQuestionIndex(savedProgress.current_question_index);
    setAnswers(savedProgress.answers ?? {});
    answersRef.current = savedProgress.answers ?? {};
    setScore(savedProgress.score ?? 0);
    setTotalPoints(savedProgress.points ?? 0);
    setDisplayedPoints(savedProgress.points ?? 0);
    setStreak(savedProgress.streak ?? 0);
    setHintsUsed(new Set(savedProgress.hints_used ?? []));
    setSavedProgress(null);
    setShowResumePrompt(false);
    setPhase('course');
  }, [savedProgress]);

  // Discard saved progress and start fresh
  const handleStartFresh = useCallback(async () => {
    if (formId && studentEmail.trim()) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await fetch('/api/course', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ action: 'clear-progress', course_id: formId }),
        });
      } catch { /* ignore */ }
    }
    setSavedProgress(null);
    setShowResumePrompt(false);
    setPhase('course');
  }, [formId, studentEmail]);

  // -- Answer checking helpers --
  const checkFillBlank = (userAnswer: string, correctAnswer: string): boolean => {
    const accepted = correctAnswer.split('|').map(s => s.trim().toLowerCase());
    return accepted.includes(userAnswer.trim().toLowerCase());
  };

  const checkArrange = (order: string[], correctAnswer: string): boolean => {
    const correct = correctAnswer.split('|||');
    return order.join('|||') === correct.join('|||');
  };

  const getCurrentAnswer = () => {
    if (questionType === 'fill_blank') return fillBlankAnswer;
    if (questionType === 'arrange') return arrangeOrder.join('|||');
    return selectedOption ?? '';
  };

  const isAnswered = () => {
    if (questionType === 'sql_exercise' || questionType === 'python_exercise') {
      try {
        const parsed = JSON.parse(answers[currentQuestion.id] ?? '');
        if (questionType === 'python_exercise') return !!parsed?.passed && !!parsed?.proof;
        return !!parsed?.passed && !!parsed?.proof;
      } catch { return false; }
    }
    if (REVIEW_TYPES.includes(questionType)) return reviewCompleted.has(currentQuestion.id);
    if (questionType === 'fill_blank') return fillBlankAnswer.trim().length > 0;
    if (questionType === 'arrange') return arrangeOrder.length > 0;
    return selectedOption !== null; // covers multiple_choice, image, code
  };

  // -- Format answer for review display --
  const formatAnswer = (q: any, answer: string) => {
    if (!answer) return null;
    const qType: QuestionType = q.type ?? 'multiple_choice';
    if (qType === 'sql_exercise') {
      try {
        const parsed = JSON.parse(answer);
        return parsed?.passed ? 'SQL answer passed' : (parsed?.query || answer);
      } catch { return answer; }
    }
    if (qType === 'python_exercise') {
      try {
        const parsed = JSON.parse(answer);
        return parsed?.passed ? 'Python answer passed' : (parsed?.code || answer);
      } catch { return answer; }
    }
    if (qType === 'arrange') return answer.split('|||').join(' -> ');
    if (qType === 'image') {
      const idx = q.options.indexOf(answer);
      return idx >= 0 ? `Option ${String.fromCharCode(65 + idx)}` : answer;
    }
    return answer;
  };

  const isAnswerCorrect = (q: any, answer: string) => {
    const qType: QuestionType = q.type ?? 'multiple_choice';
    if (qType === 'sql_exercise' || qType === 'python_exercise') {
      try {
        const parsed = JSON.parse(answer);
        if (qType === 'python_exercise') return !!parsed?.passed && !!parsed?.proof;
        return !!parsed?.passed && !!parsed?.proof;
      } catch { return false; }
    }
    if (REVIEW_TYPES.includes(qType)) return answer === 'completed';
    if (qType === 'fill_blank') return checkFillBlank(answer, q.correctAnswer);
    if (qType === 'arrange') return answer === q.correctAnswer;
    return answer === q.correctAnswer;
  };

  const getSlideProgressStatus = useCallback((q: any) => {
    const rawAnswer = answers[q.id] ?? '';
    const answered = !!rawAnswer;
    if ((q.type ?? '') === 'sql_exercise' || (q.type ?? '') === 'python_exercise') {
      if (!answered) {
        return { answered: false, completed: false, skipped: false, failed: false };
      }
      try {
        const parsed = JSON.parse(rawAnswer);
        const passed = !!parsed?.passed && (q.type === 'sql_exercise' || q.type === 'python_exercise' ? !!parsed?.proof : true);
        const skipped = !!parsed?.skipped || !!parsed?.solutionViewed;
        return { answered, completed: answered, skipped, failed: !passed && !skipped };
      } catch {
        return { answered, completed: answered, skipped: false, failed: true };
      }
    }

    return {
      answered,
      completed: answered,
      skipped: false,
      failed: false,
    };
  }, [answers]);

  // A slide marked "lock until previous" stays locked until the nearest
  // preceding non-section slide is completed. First slide / review mode: never locked.
  const isSlideLocked = useCallback((idx: number) => {
    const q: any = questions[idx];
    if (!q?.lockUntilPrevious || reviewMode) return false;
    let prevIdx = idx - 1;
    while (prevIdx >= 0 && (questions[prevIdx] as any)?.isSection) prevIdx--;
    if (prevIdx < 0) return false;
    return !getSlideProgressStatus(questions[prevIdx]).completed;
  }, [questions, reviewMode, getSlideProgressStatus]);

  const notifyLocked = useCallback(() => {
    setLockedToast('Complete the previous lesson to unlock this.');
    setTimeout(() => setLockedToast(null), 2400);
  }, []);

  // -- Points system --
  const ps = (config as any).pointsSystem;
  const pointsEnabled = ps?.enabled !== false;

  // -- Animated points counter --
  useEffect(() => {
    if (displayedPoints === totalPoints) return;
    const diff = totalPoints - displayedPoints;
    const step = Math.ceil(Math.abs(diff) / 20);
    const timer = setTimeout(() => {
      setDisplayedPoints(prev => {
        const d = totalPoints - prev;
        if (Math.abs(d) <= step) return totalPoints;
        return prev + (d > 0 ? step : -step);
      });
    }, 16);
    return () => clearTimeout(timer);
  }, [totalPoints, displayedPoints]);

  // -- Fetch leaderboard rank when result appears --
  useEffect(() => {
    if (!isSuccess || !formId || !studentEmail) return;
    supabase
      .from('course_attempts')
      .select('student_id, score, points, passed, students(email, full_name)')
      .eq('course_id', formId)
      .not('completed_at', 'is', null)
      .then(({ data }) => {
        if (!data) return;
        // Keep best attempt per student
        const byEmail = new Map<string, any>();
        for (const r of data) {
          const email = ((r.students as any)?.email || '').toLowerCase();
          const name  = (r.students as any)?.full_name || email;
          const entry = { email, name, percentage: r.score ?? 0, points: r.points ?? 0, passed: r.passed };
          const existing = byEmail.get(email);
          if (!existing || (entry.percentage > existing.percentage)) {
            byEmail.set(email, entry);
          }
        }
        const sorted = Array.from(byEmail.values()).sort((a, b) => {
          const d = b.percentage - a.percentage;
          return d !== 0 ? d : (b.points ?? 0) - (a.points ?? 0);
        });
        const myKey = studentEmail.trim().toLowerCase();
        const idx   = sorted.findIndex(d => d.email === myKey);
        if (idx === -1) return;
        setRankCtx({
          rank:  idx + 1,
          total: sorted.length,
          above: idx > 0                  ? sorted[idx - 1] : null,
          me:    sorted[idx],
          below: idx < sorted.length - 1  ? sorted[idx + 1] : null,
        });
      });
  }, [isSuccess, formId, studentEmail]);

  // -- Smart course recommendations (fetch when student passes) --
  const [recommendations, setRecommendations] = useState<any[]>([]);
  useEffect(() => {
    if (!isSuccess || !formId) return;
    // Only fetch if the student passed
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      fetch('/api/vector/recommend', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body:    JSON.stringify({ completedFormId: formId }),
      })
        .then(r => r.ok ? r.json() : { recommendations: [] })
        .then(({ recommendations: recs }) => { if (recs?.length) setRecommendations(recs); })
        .catch(() => {});
    });
  }, [isSuccess, formId]);

  // -- Fetch public certificate metadata for LinkedIn sharing when cert is available --
  const [certInstitutionName, setCertInstitutionName] = useState('');
  const [certIssuedAt, setCertIssuedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!certificateId) return;
    fetch(`/api/certificate/${certificateId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.settings?.institutionName) setCertInstitutionName(data.settings.institutionName);
        if (data?.issuedAt) setCertIssuedAt(data.issuedAt);
      })
      .catch(() => {});
  }, [certificateId]);

  // -- All questions answered but student never hit Submit (e.g. closed tab) --
  // Detect on mount/resume and auto-transition to the completion screen.
  useEffect(() => {
    if (phase === 'course' && !reviewMode && totalSlides > 0 && currentQuestionIndex >= totalSlides) {
      finishCourse(score);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentQuestionIndex, totalSlides, reviewMode]);

  // -- Success screen (shown after submission) --
  if (isSuccess) {
    const submittedPct    = serverResult?.score  ?? (totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 100);
    const submittedPassed = serverResult?.passed ?? (totalQuestions === 0 ? true : submittedPct >= passmark);

    const buildLinkedInUrl = (name: string, certId: string, orgName?: string, issuedAt?: string | null) => {
      const issueDate = issuedAt ? new Date(issuedAt) : new Date();
      const certUrl = `${window.location.origin}/certificate/${certId}`;
      const params = new URLSearchParams({
        startTask: 'CERTIFICATION_NAME',
        name,
        issueYear: String(issueDate.getFullYear()),
        issueMonth: String(issueDate.getMonth() + 1),
        certId,
        certUrl,
      });
      if (orgName) params.set('organizationName', orgName);
      return `https://www.linkedin.com/profile/add?${params}`;
    };

    const LinkedInIcon = () => (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    );
    const isLessonOnly = totalQuestions === 0;
    // Derive the correct count from the confirmed percentage so that after a page
    // refresh (where the session score counter resets to 0) the display still shows
    // the right number rather than "0 / N correct".
    const correctCount = Math.round((submittedPct / 100) * totalQuestions);
    const scoreDisplay = String(correctCount);

    const resultColor = submittedPassed ? '#10b981' : '#f43f5e';

    return (
      <div className={`max-w-2xl mx-auto space-y-3 pt-8 px-4 sm:px-6`} style={fontStyle}>

        {/* -- Hero card -- */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-xl overflow-hidden ${cardBg}`}
        >
          {/* Accent top bar */}
          <div className="h-1 w-full" style={{ background: resultColor }} />

          <div className="p-7 sm:p-8 space-y-6">

            {/* Score -- half-dial gauge (mirrors the certification result) */}
            <div className="space-y-4">
              {isLessonOnly ? (
                <div className="flex flex-col items-center text-center gap-3 py-2">
                  {config.title && <p className={`text-xs font-semibold tracking-widest uppercase ${mutedColor}`}>{config.title}</p>}
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/10">
                    <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                  </div>
                  <p className="text-sm font-medium" style={{ color: txtMuted }}>You have completed all lessons in this course.</p>
                  <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-wider text-white" style={{ background: resultColor }}>COMPLETED</span>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {config.title && <p className={`text-center text-lg font-bold tracking-wide uppercase ${mutedColor}`}>{config.title}</p>}
                  {/* Left: gauge + PASSED + score. Right: XP earned. Stacks and centers on narrow screens. */}
                  <div className="flex flex-col sm:flex-row items-center sm:justify-between gap-6 w-full max-w-lg mx-auto">
                    <div className="flex flex-col items-center gap-2.5">
                      <ScoreGauge score={submittedPct} passmark={passmark} passed={submittedPassed} width={190}
                        track={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'}
                        scoreColor={isDark ? '#f4f4f5' : '#18181b'} mutedColor={txtMuted} tickColor={isDark ? '#f4f4f5' : '#18181b'} />
                      <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-wider text-white" style={{ background: resultColor }}>
                        {submittedPassed ? 'PASSED' : 'FAILED'}
                      </span>
                      <p className={`text-sm ${mutedColor}`}>
                        Scored <b className={textColor}>{scoreDisplay} of {totalQuestions}</b> correct. Pass mark {passmark}%.
                      </p>
                    </div>
                    {pointsEnabled && (
                      <div className="text-center sm:text-left flex-shrink-0">
                        <p className={`text-[11px] font-semibold tracking-widest uppercase ${mutedColor}`}>XP Earned</p>
                        <p className="text-6xl font-black leading-none mt-1" style={{ color: isDark ? '#facc15' : '#10b981' }}>
                          {displayedPoints.toLocaleString()}<span className="text-2xl font-bold ml-1.5">XP</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Certificate + share actions */}
            {submittedPassed && certificateId && (
              <div className="space-y-2">
                <a
                  href={`/certificate/${certificateId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2.5 w-full py-3 rounded-xl font-bold text-sm transition-all"
                  style={{ background: accent, color: '#ffffff' }}
                >
                  View Your Certificate
                </a>
                <a
                  href={buildLinkedInUrl(config.title || 'Course Certificate', certificateId, certInstitutionName || undefined, certIssuedAt)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
                  style={{ background: '#0A66C2', color: '#fff' }}
                >
                  <LinkedInIcon /> Add to LinkedIn Profile
                </a>
              </div>
            )}

            {/* Streak + milestones (XP earned now sits beside the gauge above) */}
            {pointsEnabled && (streak >= (ps?.streakCount ?? 3) || (ps?.milestones ?? []).length > 0) && (
              <div className={`rounded-xl ${isDark ? 'bg-zinc-800/40' : 'bg-zinc-50'}`}>

                {/* Streak */}
                {streak >= (ps?.streakCount ?? 3) && (
                  <div className="flex items-center justify-end px-4 py-3">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${isDark ? 'bg-orange-500/15 text-orange-400' : 'bg-orange-100 text-orange-600'}`}>
                      🔥 {streak} streak
                    </div>
                  </div>
                )}

                {/* Milestones */}
                {(ps?.milestones ?? []).length > 0 && (() => {
                  const sorted = [...(ps.milestones ?? [])].sort((a: any, b: any) => a.points - b.points);
                  const unlocked = sorted.filter((m: any) => totalPoints >= m.points);
                  const nextMilestone = sorted.find((m: any) => totalPoints < m.points);
                  return (
                    <div className="px-4 py-3 space-y-2">
                      {unlocked.map((m: any) => (
                        <div key={m.id} className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-emerald-50 border border-emerald-200'}`}>
                          <span className="text-base flex-shrink-0">🏆</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${textColor}`}>{m.label}</p>
                            {m.description && <p className={`text-xs mt-0.5 ${mutedColor}`}>{m.description}</p>}
                            {m.rewardUrl && (
                              <a href={m.rewardUrl} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500 mt-1 hover:opacity-75">
                                Claim reward <ArrowRight className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <span className="text-emerald-500 text-xs font-bold flex-shrink-0">{m.points} XP</span>
                        </div>
                      ))}
                      {nextMilestone && (
                        <div className={`flex items-center gap-3 p-3 rounded-xl ${isDark ? 'bg-zinc-900/60 border border-zinc-700/60' : 'bg-white border border-zinc-200'}`}>
                          <span className="text-base flex-shrink-0 opacity-40">🔒</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${mutedColor}`}>{nextMilestone.label}</p>
                            <p className="text-xs mt-0.5" style={{ color: accent }}>
                              {nextMilestone.points - totalPoints} XP to unlock -- retake to beat your score
                            </p>
                          </div>
                          <span className={`text-xs font-bold flex-shrink-0 ${mutedColor}`}>{nextMilestone.points} XP</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

          </div>

          {/* Footer */}
          <div className={`px-7 sm:px-8 py-4 flex items-center justify-end ${isDark ? 'bg-zinc-900/40' : 'bg-zinc-50/60'}`}>
            {!isSharedView && (
              <button onClick={onReset} className={`text-xs flex items-center gap-1.5 font-medium ${mutedColor} hover:opacity-70 transition-opacity`}>
                <RotateCcw className="w-3 h-3" /> Back to Editor
              </button>
            )}
            <p className={`text-xs ${mutedColor}`}>Results recorded</p>
          </div>
        </motion.div>

        {/* -- Leaderboard rank card -- */}
        {rankCtx && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={`rounded-2xl overflow-hidden ${isDark ? 'bg-zinc-900/80' : 'bg-white'}`}
            style={{ boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.06)' }}
          >
            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex items-center justify-between">
              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-widest ${mutedColor}`}>Leaderboard</p>
                <p className={`text-sm font-bold mt-0.5 ${textColor}`}>
                  You ranked <span style={{ color: accent }}>#{rankCtx.rank}</span> out of {rankCtx.total}
                </p>
              </div>
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black"
                style={{ background: `${accent}18`, color: accent }}
              >
                {rankCtx.rank === 1 ? '🥇' : rankCtx.rank === 2 ? '🥈' : rankCtx.rank === 3 ? '🥉' : `#${rankCtx.rank}`}
              </div>
            </div>

            {/* Rows */}
            <div className={`mx-4 mb-4 rounded-xl overflow-hidden ${isDark ? 'bg-zinc-800/40' : 'bg-zinc-50'}`}>
              {/* One above */}
              {rankCtx.above && (
                <div className={`flex items-center gap-3 px-4 py-3 ${isDark ? 'border-b border-zinc-700/40' : 'border-b border-zinc-200/60'}`}>
                  <span className={`text-[11px] font-bold w-5 tabular-nums text-right ${mutedColor}`}>{rankCtx.rank - 1}</span>
                  <span className={`text-sm flex-1 truncate ${mutedColor}`}>{rankCtx.above.name || 'Anonymous'}</span>
                  <span className={`text-xs font-semibold tabular-nums ${mutedColor}`}>{rankCtx.above.percentage ?? 0}%</span>
                </div>
              )}

              {/* Me */}
              <div
                className={`flex items-center gap-3 px-4 py-3.5 ${rankCtx.above && (isDark ? 'border-b border-zinc-700/40' : 'border-b border-zinc-200/60')}`}
                style={{ background: `${accent}14` }}
              >
                <span className="text-[11px] font-black w-5 tabular-nums text-right" style={{ color: accent }}>{rankCtx.rank}</span>
                <span className={`text-sm font-semibold flex-1 truncate ${textColor}`}>
                  {rankCtx.me.name || 'You'}
                  <span className={`ml-1.5 text-[10px] font-normal px-1.5 py-0.5 rounded-md ${isDark ? 'bg-zinc-700 text-[#A8B5C2]' : 'bg-zinc-200 text-[#555555]'}`}>you</span>
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: accent }}>{rankCtx.me.percentage ?? 0}%</span>
              </div>

              {/* One below */}
              {rankCtx.below && (
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className={`text-[11px] font-bold w-5 tabular-nums text-right ${mutedColor}`}>{rankCtx.rank + 1}</span>
                  <span className={`text-sm flex-1 truncate ${mutedColor}`}>{rankCtx.below.name || 'Anonymous'}</span>
                  <span className={`text-xs font-semibold tabular-nums ${mutedColor}`}>{rankCtx.below.percentage ?? 0}%</span>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* -- Answer review -- */}
        {showAnswers === 'after_quiz' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className={`border rounded-2xl overflow-hidden ${cardBg}`}
          >
            <div className={`px-5 py-3.5 border-b ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
              <h3 className={`text-sm font-semibold ${textColor}`}>Answer Review</h3>
              <p className={`text-xs mt-0.5 ${mutedColor}`}>See where you went right and wrong.</p>
            </div>
            <div>
              {questions.map((q: any, idx: number) => {
                const userAnswer = answers[q.id] ?? '';
                const correct = isAnswerCorrect(q, userAnswer);
                const qType: QuestionType = q.type ?? 'multiple_choice';
                const correctDisplay = qType === 'arrange'
                  ? q.correctAnswer.split('|||').join(' -> ')
                  : qType === 'fill_blank'
                    ? q.correctAnswer.split('|').map((s: string) => s.trim()).join(' / ')
                    : qType === 'image'
                      ? (() => { const i = q.options.indexOf(q.correctAnswer); return i >= 0 ? `Option ${String.fromCharCode(65 + i)}` : q.correctAnswer; })()
                      : q.correctAnswer;
                return (
                  <div
                    key={q.id}
                    className={`px-5 py-4 flex gap-3 ${idx < questions.length - 1 ? (isDark ? 'border-b border-zinc-800/60' : 'border-b border-zinc-100') : ''}`}
                  >
                    {/* Status dot */}
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${correct ? 'bg-emerald-500/15' : 'bg-rose-500/15'}`}>
                      {correct
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        : <XCircle className="w-3.5 h-3.5 text-rose-500" />}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className={`text-sm leading-snug ${textColor}`}>
                        <span className={`text-[11px] font-normal mr-1.5 ${mutedColor}`}>Q{idx + 1}</span>
                        {q.question}
                      </p>
                      {!correct && (
                        <div className="space-y-0.5 mt-1.5">
                          {userAnswer
                            ? <p className="text-xs text-rose-400">Your answer: <span className="font-medium">{formatAnswer(q, userAnswer)}</span></p>
                            : <p className={`text-xs italic ${mutedColor}`}>Not answered</p>}
                          <p className="text-xs text-emerald-400">Correct: <span className="font-medium">{correctDisplay}</span></p>
                        </div>
                      )}
                      {q.explanation && (
                        <p className={`text-xs leading-relaxed mt-2 ${mutedColor}`}>{q.explanation}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* -- Post-submission -- */}
        {postSubmission?.type && postSubmission.type !== 'default' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="space-y-3"
          >
            {postSubmission.type === 'button' && postSubmission.buttonUrl && (
              <a
                href={postSubmission.buttonUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: accent, color: 'white' }}
              >
                {postSubmission.buttonLabel || 'Continue'}
                <ExternalLink className="w-4 h-4" />
              </a>
            )}

            {postSubmission.type === 'notice' && (
              <div className={`p-5 rounded-2xl border ${isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-zinc-50 border-zinc-200'}`}>
                {postSubmission.noticeTitle && (
                  <h3 className={`font-semibold text-base mb-1.5 ${textColor}`}>{postSubmission.noticeTitle}</h3>
                )}
                {postSubmission.noticeBody && (
                  <p className={`text-sm leading-relaxed ${mutedColor}`}>{postSubmission.noticeBody}</p>
                )}
              </div>
            )}

            {postSubmission.type === 'redirect' && postSubmission.redirectUrl && (
              <div className={`flex items-center justify-center gap-2 p-4 rounded-2xl border ${isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-zinc-50 border-zinc-200'}`}>
                <Loader2 className={`w-4 h-4 animate-spin ${mutedColor}`} />
                <span className={`text-sm ${mutedColor}`}>Redirecting you…</span>
              </div>
            )}

            {postSubmission.type === 'events' && relatedForms.length > 0 && (
              <div className="space-y-2.5">
                <p className={`text-xs font-semibold tracking-widest uppercase px-1 ${mutedColor}`}>You might also like</p>
                {relatedForms.map((rf: any) => {
                  const rfConfig = rf.config || {};
                  const href = rf.slug ? `/${rf.slug}` : `/${rf.id}`;
                  return (
                    <a key={rf.id} href={href}
                      className={`flex rounded-2xl overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-zinc-100 shadow-sm'}`}>
                      {rfConfig.coverImage ? (
                        <div className="w-28 flex-shrink-0">
                          <img src={resolveCoverUrl(rfConfig.coverImage)} alt="" className="w-full h-full object-cover" style={{ minHeight: '100px' }} onError={e => (e.currentTarget.style.display = 'none')} />
                        </div>
                      ) : (
                        <div className={`w-28 flex-shrink-0 flex items-center justify-center text-2xl ${isDark ? 'bg-zinc-800' : 'bg-zinc-100'}`} style={{ minHeight: '100px' }}>🗓</div>
                      )}
                      <div className="flex-1 min-w-0 p-4 flex flex-col justify-between gap-2">
                        <div>
                          <p className={`font-semibold text-sm leading-snug ${textColor}`}>{rfConfig.title || rf.title}</p>
                          {rfConfig.description && (
                            <p className={`text-xs mt-1 line-clamp-2 leading-relaxed ${mutedColor}`} dangerouslySetInnerHTML={{ __html: sanitizeRichText(rfConfig.description) }} />
                          )}
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: accent }}>
                          Register now <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* -- Assignment Capstone -- */}
        {relatedAssignment && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className={`rounded-2xl overflow-hidden border ${isDark ? 'bg-zinc-900/80 border-zinc-800/60' : 'bg-white border-zinc-100'}`}
            style={{ boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.06)' }}
          >
            <div className="h-1 w-full" style={{ background: accent }} />
            <div className="px-5 py-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${accent}18` }}>
                <BookOpen className="w-5 h-5" style={{ color: accent }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${mutedColor}`}>Your Next Step</p>
                <p className={`text-sm font-bold leading-snug mb-1 ${textColor}`}>{relatedAssignment.title}</p>
                <p className={`text-xs leading-relaxed ${mutedColor}`}>
                  Apply what you just learned. Complete the assignment to reinforce your skills.
                </p>
              </div>
            </div>
            <div className={`px-5 pb-4`}>
              <a
                href={`/student?section=assignments`}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: accent, color: '#fff' }}
              >
                Start Assignment <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </motion.div>
        )}

        {/* -- AI-powered course recommendations -- */}
        {recommendations.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
          >
            <p className={`text-[10px] font-semibold uppercase tracking-widest mb-3 ${mutedColor}`}>
              What to take next
            </p>
            <div className="space-y-2">
              {recommendations.map((rec: any, i: number) => (
                <a
                  key={rec.formId}
                  href={`/${rec.slug}?go=1`}
                  className={`flex items-center gap-3 rounded-xl p-3 no-underline transition-all hover:opacity-80 border ${
                    isDark ? 'bg-zinc-900/60 border-zinc-800/60' : 'bg-white border-zinc-100'
                  }`}
                  style={{ boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)' }}
                >
                  <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden flex items-center justify-center"
                    style={{ background: `${accent}15` }}>
                    {rec.coverImage
                      ? <img src={resolveCoverUrl(rec.coverImage)} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                      : <BookOpen className="w-4 h-4" style={{ color: accent }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${textColor}`}>{rec.title}</p>
                    <p className={`text-[10px] mt-0.5 ${mutedColor}`}>Recommended for you</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accent }} />
                </a>
              ))}
            </div>
          </motion.div>
        )}

        {/* -- Retake button (failed only) -- */}
        {!submittedPassed && !isLessonOnly && onRetake && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <button
              onClick={onRetake}
              className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl font-semibold text-sm border transition-all hover:opacity-80 active:scale-[0.98]`}
              style={{ background: 'transparent', borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)', color: txtMuted }}
            >
              <RotateCcw className="w-4 h-4" /> Retake Course
            </button>
          </motion.div>
        )}
      </div>
    );
  }

  // -- Loading state while progress check runs silently --
  if (checkingAttempts && initialStudentName) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 16, ...fontStyle }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: accent, opacity: 0.6 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 340 }}>
          <div style={{ height: 12, borderRadius: 6, background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)', width: '70%' }} className="animate-pulse" />
          <div style={{ height: 12, borderRadius: 6, background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)', width: '50%' }} className="animate-pulse" />
        </div>
      </div>
    );
  }

  // -- Student info screen --
  if (phase === 'info') {
    // -- Auto-start mode (pre-filled from overview modal) -> render as portal popup --
    if (initialStudentName) {
      if (typeof document === 'undefined') return null;

      const overlayBg = isDark ? '#18181b' : '#ffffff';
      const overlayBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

      const popupContent = (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ background: overlayBg, border: `1px solid ${overlayBorder}`, borderRadius: 24, boxShadow: '0 32px 80px rgba(0,0,0,0.4)', width: '100%', maxWidth: 420, overflow: 'hidden', ...fontStyle }}
          >
            {/* Accent top bar */}
            <div style={{ height: 4, background: accent }} />

            <div style={{ padding: '24px 28px 28px' }}>
              {/* Attempt error */}
              {!checkingAttempts && attemptError && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <AlertTriangle className="w-5 h-5 text-rose-400" />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${textColor}`}>Attempts exhausted</p>
                      <p className={`text-xs mt-0.5 ${mutedColor}`}>{attemptError}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Existing certificate */}
              {!checkingAttempts && existingCertId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: `${accent}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 22 }}>
                      🎓
                    </div>
                    <div>
                      <p className={`text-base font-bold ${textColor}`}>Course completed!</p>
                      <p className={`text-xs mt-0.5 ${mutedColor}`}>Hi {studentName}. Your certificate is ready.</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <a
                      href={`/certificate/${existingCertId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px', borderRadius: 14, fontWeight: 700, fontSize: 14, color: 'white', background: accent, textDecoration: 'none' }}
                    >
                      View & Download Certificate <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => { setExistingCertId(null); setPhase('course'); }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px', borderRadius: 14, fontWeight: 500, fontSize: 13, background: 'transparent', border: `1px solid ${overlayBorder}`, cursor: 'pointer', color: txtMuted }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Retake course anyway
                    </button>
                  </div>
                </div>
              )}

              {/* Resume in-progress */}
              {!checkingAttempts && !existingCertId && showResumePrompt && savedProgress && (() => {
                const savedPct = totalSlides > 0 ? Math.round((savedProgress.current_question_index / totalSlides) * 100) : 0;
                return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: `${accent}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 22 }}>
                      📖
                    </div>
                    <div>
                      <p className={`text-base font-bold ${textColor}`}>Welcome back, {studentName.split(' ')[0]}!</p>
                      <p className={`text-xs mt-0.5 ${mutedColor}`}>
                        Slide {savedProgress.current_question_index + 1} of {totalSlides}
                        {savedProgress.points > 0 && <> · <span style={{ color: accent }}>{savedProgress.points} XP earned</span></>}
                      </p>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 6, borderRadius: 99, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, background: accent, width: `${savedPct}%`, transition: 'width 0.6s ease' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button
                      onClick={handleResume}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px', borderRadius: 14, fontWeight: 700, fontSize: 14, color: 'white', background: accent, border: 'none', cursor: 'pointer' }}
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleStartFresh}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px', borderRadius: 14, fontWeight: 500, fontSize: 13, background: 'transparent', border: `1px solid ${overlayBorder}`, cursor: 'pointer', color: txtMuted }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Start over
                    </button>
                  </div>
                </div>
                );
              })()}
            </div>
          </motion.div>
        </div>
      );

      // Only show the popup while something needs user attention; otherwise render nothing
      // (handleStartCourse will transition to 'course' phase when all clear)
      if (existingCertId || showResumePrompt || attemptError) {
        return createPortal(popupContent, document.body);
      }
      return null;
    }

    // -- Normal info form (no pre-filled info) --
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`max-w-xl mx-auto border rounded-2xl overflow-hidden ${cardBg}`}
        style={fontStyle}
      >
        <div className="p-8 space-y-6">
          <div>
            <h2 className={`text-xl font-semibold mb-1 ${textColor}`}>Before you begin</h2>
            <p className={`text-sm ${mutedColor}`}>Enter your details to record your attempt.</p>
          </div>

          {(courseTimerMins > 0 || maxAttempts > 0) && (
            <div className={`flex items-start gap-3 p-3 rounded-xl border text-xs ${isDark ? 'border-zinc-700 bg-zinc-800/40 text-[#A8B5C2]' : 'border-zinc-200 bg-zinc-50 text-[#555555]'}`}>
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
              <div className="space-y-0.5">
                {courseTimerMins > 0 && <p>Time limit: <span className="font-semibold text-amber-400">{courseTimerMins} minute{courseTimerMins > 1 ? 's' : ''}</span></p>}
                {maxAttempts > 0 && <p>Max attempts: <span className="font-semibold">{maxAttempts}</span> per email address</p>}
                <p className="mt-1">Do not switch tabs or windows during the course.</p>
              </div>
            </div>
          )}

          {learningOutcomes.length > 0 && (
            <div className={`p-4 rounded-xl border ${isDark ? 'border-zinc-700 bg-zinc-800/40' : 'border-zinc-200 bg-zinc-50'}`}>
              <p className={`text-xs font-semibold uppercase tracking-[0.14em] mb-2 ${mutedColor}`}>What you will learn</p>
              <div className="space-y-2">
                {learningOutcomes.map((outcome, idx) => (
                  <div key={`${idx}-${outcome}`} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }} />
                    <p className={`text-sm leading-relaxed ${textColor}`}>{outcome}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${mutedColor}`}>Full Name</label>
              <AnimatedField theme={config.theme || 'forest'} mode={config.mode || 'dark'}>
                <input
                  type="text"
                  value={studentName}
                  onChange={e => setStudentName(e.target.value)}
                  placeholder="Enter your full name..."
                  className={`w-full bg-transparent border-none outline-none px-4 py-3 text-sm ${isDark ? 'text-[#ACB8C5] placeholder:text-zinc-600' : 'text-[#111111] placeholder:text-zinc-400'}`}
                />
              </AnimatedField>
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${mutedColor}`}>Email Address</label>
              <AnimatedField theme={config.theme || 'forest'} mode={config.mode || 'dark'}>
                <input
                  type="email"
                  value={studentEmail}
                  onChange={e => { setStudentEmail(e.target.value); setAttemptError(''); }}
                  placeholder="you@example.com"
                  className={`w-full bg-transparent border-none outline-none px-4 py-3 text-sm ${isDark ? 'text-[#ACB8C5] placeholder:text-zinc-600' : 'text-[#111111] placeholder:text-zinc-400'}`}
                />
              </AnimatedField>
            </div>
          </div>

          {attemptError && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {attemptError}
            </div>
          )}

          {existingCertId ? (
            <div className={`rounded-2xl overflow-hidden ${isDark ? 'bg-zinc-800/50 border border-zinc-700/50' : 'bg-zinc-50 border border-zinc-200/80'}`}>
              <div className="h-0.5 w-full" style={{ background: accent }} />
              <div className="p-4 space-y-3">
                <div>
                  <p className={`text-sm font-semibold ${textColor}`}>You&apos;ve already completed this course</p>
                  <p className={`text-xs mt-0.5 ${mutedColor}`}>Your certificate is ready to view and share.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`/certificate/${existingCertId}`} target="_blank" rel="noreferrer"
                    className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 transition-all active:scale-[0.98] hover:opacity-90 whitespace-nowrap"
                    style={{ background: accent, color: 'white' }}>
                    🎓 View Certificate
                  </a>
                  <button onClick={() => { setExistingCertId(null); setPhase('course'); }}
                    className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-all active:scale-[0.98] whitespace-nowrap ${isDark ? 'text-[#A8B5C2] hover:text-[#ACB8C5] hover:bg-zinc-700/60' : 'text-[#555555] hover:text-[#111111] hover:bg-zinc-200/60'}`}>
                    <RotateCcw className="w-3.5 h-3.5" /> Retake anyway
                  </button>
                </div>
              </div>
            </div>
          ) : showResumePrompt && savedProgress ? (
            <div className={`rounded-2xl overflow-hidden ${isDark ? 'bg-zinc-800/50 border border-zinc-700/50' : 'bg-zinc-50 border border-zinc-200/80'}`}>
              {(() => {
                const savedPct = totalSlides > 0 ? Math.round((savedProgress.current_question_index / totalSlides) * 100) : 0;
                return (<>
              <div className={`h-0.5 w-full ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                <div className="h-full transition-all duration-700" style={{ width: `${savedPct}%`, background: accent }} />
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className={`text-sm font-semibold ${textColor}`}>Continue where you left off</p>
                    <p className={`text-xs mt-0.5 ${mutedColor}`}>
                      Slide {savedProgress.current_question_index + 1} of {totalSlides}
                      {savedProgress.points > 0 && <> &middot; <span style={{ color: accent }}>{savedProgress.points} XP earned</span></>}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold tabular-nums px-2 py-1 rounded-lg ${isDark ? 'bg-zinc-700 text-[#A8B5C2]' : 'bg-zinc-200 text-[#555555]'}`}>
                    {savedPct}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={handleResume} className="py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] hover:opacity-90" style={{ background: accent, color: 'white' }}>
                    Continue <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleStartFresh} className={`py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${isDark ? 'text-[#A8B5C2] hover:text-[#ACB8C5] hover:bg-zinc-700/60' : 'text-[#555555] hover:text-[#111111] hover:bg-zinc-200/60'}`}>
                    <RotateCcw className="w-3.5 h-3.5" /> Start over
                  </button>
                </div>
              </div>
              </>);
              })()}
            </div>
          ) : (
            <button
              onClick={handleStartCourse}
              disabled={!studentName.trim() || !studentEmail.trim() || checkingAttempts || !!attemptError}
              className="w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              style={{ background: accent }}
            >
              {checkingAttempts ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Continue <ChevronRight className="w-4 h-4" /></>}
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  // -- Complete screen --
  if (phase === 'complete') {
    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 100;
    const passed = totalQuestions === 0 ? true : percentage >= passmark;
    const unansweredCount = questions.filter((q: any) => isScorableSlide(q) && !answers[q.id]).length;

    const handleGoBack = (idx: number) => {
      setCurrentQuestionIndex(idx);
      setSelectedOption(null);
      setFillBlankAnswer('');
      setIsChecking(false);
      setIsCorrect(null);
      setPhase('course');
    };

    const completeCard = (
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={`w-full max-w-lg border rounded-2xl overflow-hidden ${cardBg}`}
        style={fontStyle}
      >
        <div className="p-8 text-center space-y-5">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mx-auto bg-zinc-500/10">
            <CheckCircle2 className="w-8 h-8 text-zinc-400" />
          </div>
          <div>
            <h2 className={`text-2xl font-bold ${textColor}`}>All Done!</h2>
            <p className={`text-sm mt-1 ${mutedColor}`}>
              {timeLeft === 0 ? "Time's up! " : ''}Submit your results to see your score.
            </p>
          </div>

          {/* Unanswered warning */}
          {unansweredCount > 0 && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-4 text-left space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-400">
                    {unansweredCount} question{unansweredCount > 1 ? 's' : ''} unanswered
                  </p>
                  <p className="text-xs text-red-400/70 mt-0.5">
                    Go back to answer them or submit anyway.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-6">
                {questions
                  .filter((q: any) => isScorableSlide(q) && !answers[q.id])
                  .map((q: any) => {
                    const idx = questions.findIndex((qq: any) => qq.id === q.id);
                    return (
                      <button
                        key={q.id}
                        onClick={() => handleGoBack(idx)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                      >
                        Q{idx + 1}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {totalQuestions > 0 && (
            <p className={`text-xs ${mutedColor}`}>
              You answered {answeredScorableCount(questions, answers)} of {totalQuestions} question{totalQuestions !== 1 ? 's' : ''}.
            </p>
          )}
          <button
            onClick={(e) => onSubmit(e, { name: studentName, email: studentEmail, score, total: totalQuestions, percentage, passed, answers, points: totalPoints, streak, studentToken: sessionTokenRef.current })}
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-xl font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-sm"
            style={{ background: accent }}
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : totalQuestions === 0 ? 'Complete Course' : 'Submit & See Results'}
          </button>
        </div>
      </motion.div>
    );

    if (inlineMode) return completeCard;
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)' }}>
        {completeCard}
      </div>,
      document.body
    );
  }


  const calcPoints = (hintUsed: boolean): { earned: number; label: string; isTimeBonus: boolean; isStreak: boolean } => {
    if (!pointsEnabled) return { earned: 0, label: '', isTimeBonus: false, isStreak: false };
    const base = ps?.basePoints ?? 50;
    const elapsed = (Date.now() - questionStartTime) / 1000;
    const timeBonusEnabled = ps?.timeBonusEnabled ?? true;
    const withinTimeBonus = timeBonusEnabled && elapsed <= (ps?.timeBonusSeconds ?? 10);
    const timeMultiplier = withinTimeBonus ? (ps?.timeBonusMultiplier ?? 1.5) : 1;
    const newStreak = streak + 1;
    const streakEnabled = ps?.streakEnabled ?? true;
    const isStreak = streakEnabled && newStreak >= (ps?.streakCount ?? 3);
    const streakBonus = ps?.streakBonus ?? 0;
    let earned = Math.round(base * timeMultiplier);
    if (isStreak) earned = streakBonus > 0 ? earned + streakBonus : Math.round(earned * 1.2);
    if (hintUsed) earned = Math.max(0, earned - (ps?.hintPenalty ?? 20));
    let label = `+${earned} XP`;
    if (withinTimeBonus && isStreak) label = `🔥⚡ +${earned} XP`;
    else if (isStreak) label = `🔥 +${earned} XP`;
    else if (withinTimeBonus) label = `⚡ +${earned} XP`;
    return { earned, label, isTimeBonus: withinTimeBonus, isStreak };
  };

  // -- Swipe navigation --
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;

    // Ignore if vertical scroll is dominant or swipe too short
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;

    // Never swipe on arrange (drag-and-drop) questions
    if ((currentQuestion?.type ?? 'multiple_choice') === 'arrange') return;

    if (deltaX < 0) {
      // Swipe left -> next
      if (isChecking) {
        // Feedback already shown -- advance
        handleNext();
      } else if (!isChecking && isAnswered() && showAnswers === 'none') {
        // Direct mode -- submit and advance
        handleNextDirect();
      }
    } else {
      // Swipe right -> previous (only when not locked in feedback)
      if (!isChecking && currentQuestionIndex > 0) {
        setCurrentQuestionIndex(prev => prev - 1);
      }
    }
  };

  // -- Quiz questions --
  if (!currentQuestion) return null;

  const handleCheck = (overrideAnswer?: string) => {
    if (overrideAnswer == null && !isAnswered()) return;
    if (answers[currentQuestion.id]) return; // already answered -- no re-awarding
    if (scoringLockRef.current) return; // prevent double-fire before state settles
    scoringLockRef.current = true;
    const userAnswer = overrideAnswer ?? getCurrentAnswer();
    let correct = false;
    if (questionType === 'fill_blank') {
      correct = checkFillBlank(userAnswer, currentQuestion.correctAnswer);
    } else if (questionType === 'arrange') {
      correct = checkArrange(arrangeOrder, currentQuestion.correctAnswer);
    } else {
      correct = userAnswer === currentQuestion.correctAnswer;
    }
    setIsCorrect(correct);
    setIsChecking(true);
    if (correct && !reviewMode) {
      // Feature 3: if hint was used for this question, award 0.9 instead of 1
      const hintWasUsed = hintsUsed.has(currentQuestion.id);
      setScore(s => s + (hintWasUsed ? 0.9 : 1));
      if (confettiRef.current) burstConfetti(confettiRef.current, accent);
      // Points system
      if (pointsEnabled && !reviewMode) {
        const { earned, label, isStreak } = calcPoints(hintVisible);
        setTotalPoints(prev => prev + earned);
        const newStreak = streak + 1;
        setStreak(newStreak);
        setFloatingPoints({ id: Date.now(), text: label, x: 50, y: 60 });
        setTimeout(() => setFloatingPoints(null), 1200);
        setXpNotify(true);
        setTimeout(() => setXpNotify(false), 2500);
        if (isStreak) {
          setStreakToast(`${newStreak} in a row! Streak bonus`);
          setTimeout(() => setStreakToast(null), 2200);
        }
      }
    } else {
      if (pointsEnabled && !reviewMode) {
        setStreak(0);
      }
    }
    const newAnswers = { ...answersRef.current, [currentQuestion.id]: userAnswer, [answerMetaKey(currentQuestion.id)]: buildAnswerMeta() };
    answersRef.current = newAnswers;
    setAnswers(newAnswers);
    // Compute updated score/points for saving (state updates are async)
    const hintWasUsed = hintsUsed.has(currentQuestion.id);
    const newScore  = score + (correct ? (hintWasUsed ? 0.9 : 1) : 0);
    const newPoints = correct && pointsEnabled ? totalPoints + calcPoints(hintVisible).earned : totalPoints;
    const newStreak = correct && pointsEnabled ? streak + 1 : (pointsEnabled ? 0 : streak);
    saveProgress(newAnswers, currentQuestionIndex + 1, newScore, newPoints, newStreak, hintsUsed);
  };

  const doFinish = (finalScore: number) => {
    const pending = questions.filter((q: any) => {
      if (getSlideProgressStatus(q).completed) return false;
      // A required share slide blocks finishing even though it is not scorable -- otherwise the
      // sidebar lets a student jump straight past it to the end. Mirrors the server's `=== true`
      // (complete-attempt): an unset flag is optional, so only a deliberate gate stops the finish.
      if (q.isLinkedInShare) return q.linkedInShareRequired === true;
      return isScorableSlide(q);
    });
    if (!reviewMode && pending.length > 0) {
      setFinishPending(pending);
    } else {
      finishCourse(finalScore);
    }
  };

  const handleNext = () => {
    setLessonOpen(false);
    setSelectedOption(null);
    setFillBlankAnswer('');
    setIsChecking(false);
    setIsCorrect(null);

    if (currentQuestionIndex < totalSlides - 1) {
      const nextIndex = currentQuestionIndex + 1;
      if (isViewedOnlySlide(currentQuestion)) {
        const newAnswers = { ...answersRef.current, [currentQuestion.id]: 'viewed' };
        answersRef.current = newAnswers;
        setAnswers(newAnswers);
        saveProgress(newAnswers, nextIndex, score, totalPoints, streak, hintsUsed);
      }
      setCurrentQuestionIndex(nextIndex);
      setSelectedOption(null);
      setFillBlankAnswer('');
      setIsChecking(false);
      setIsCorrect(null);
    } else {
      if (reviewMode) {
        setCurrentQuestionIndex(0);
        answersRef.current = {};
        setAnswers({});
        setSelectedOption(null);
        setFillBlankAnswer('');
        setIsChecking(false);
        setIsCorrect(null);
      } else {
        // Mark the last lessonOnly / isDownloads slide as viewed before finishing so
        // it shows as completed when the student later opens the course in review mode.
        if (isViewedOnlySlide(currentQuestion)) {
          const newAnswers = { ...answersRef.current, [currentQuestion.id]: 'viewed' };
          answersRef.current = newAnswers;
          setAnswers(newAnswers);
          saveProgress(newAnswers, totalSlides, score, totalPoints, streak, hintsUsed);
        }
        doFinish(score);
      }
    }
  };

  const handleBack = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(i => i - 1);
    }
  };


  const handleNextDirect = () => {
    setLessonOpen(false);
    let newAnswers = answersRef.current;
    let newScore   = score;
    let newPoints  = totalPoints;
    let newStreak  = streak;
    if (!reviewMode && isAnswered() && !answersRef.current[currentQuestion.id]) {
      if (scoringLockRef.current) return; // prevent double-fire before state settles
      scoringLockRef.current = true;
      const userAnswer = getCurrentAnswer();
      let correct = false;
      if (questionType === 'fill_blank') {
        correct = checkFillBlank(userAnswer, currentQuestion.correctAnswer);
      } else if (questionType === 'arrange') {
        correct = checkArrange(arrangeOrder, currentQuestion.correctAnswer);
      } else {
        correct = userAnswer === currentQuestion.correctAnswer;
      }
      if (correct) {
        const hintWasUsed = hintsUsed.has(currentQuestion.id);
        newScore = score + (hintWasUsed ? 0.9 : 1);
        setScore(newScore);
        if (pointsEnabled) {
          const { earned, label, isStreak } = calcPoints(hintWasUsed);
          newPoints = totalPoints + earned;
          newStreak = streak + 1;
          setTotalPoints(newPoints);
          setStreak(newStreak);
          setFloatingPoints({ id: Date.now(), text: label, x: 50, y: 60 });
          setTimeout(() => setFloatingPoints(null), 1200);
          if (isStreak) {
            setStreakToast(`${newStreak} in a row! Streak bonus`);
            setTimeout(() => setStreakToast(null), 2200);
          }
        }
      } else if (pointsEnabled) {
        newStreak = 0;
        setStreak(0);
      }
      newAnswers = { ...answersRef.current, [currentQuestion.id]: userAnswer, [answerMetaKey(currentQuestion.id)]: buildAnswerMeta() };
      answersRef.current = newAnswers;
      setAnswers(newAnswers);
    }
    if (currentQuestionIndex < totalSlides - 1) {
      const nextIndex = currentQuestionIndex + 1;
      saveProgress(newAnswers, nextIndex, newScore, newPoints, newStreak, hintsUsed);
      setCurrentQuestionIndex(nextIndex);
      setSelectedOption(null);
      setFillBlankAnswer('');
    } else {
      if (reviewMode) {
        // Review complete -- loop back to start, same as handleNext does
        setCurrentQuestionIndex(0);
        answersRef.current = {};
        setAnswers({});
        setSelectedOption(null);
        setFillBlankAnswer('');
        setIsChecking(false);
        setIsCorrect(null);
      } else {
        doFinish(newScore);
      }
    }
  };

  const handleSqlComplete = (payload: any) => {
    const alreadyAnswered = !!answersRef.current[currentQuestion.id];
    const previousCorrect = alreadyAnswered ? isAnswerCorrect(currentQuestion, answersRef.current[currentQuestion.id]) : false;
    const previousSolutionViewed = alreadyAnswered ? (() => { try { return !!JSON.parse(answersRef.current[currentQuestion.id])?.solutionViewed; } catch { return false; } })() : false;
    const countsAsPassed = !!payload.passed && !!payload.proof && !payload.skipped && !payload.solutionViewed;
    const answer = JSON.stringify({
      query: payload.query,
      passed: countsAsPassed,
      feedback: payload.feedback,
      skipped: !!payload.skipped,
      attempts: Number(payload.attempts ?? 0),
      solutionViewed: !!payload.solutionViewed,
      proof: payload.proof,
      elapsedSeconds: Math.max(0, (Date.now() - questionStartTime) / 1000),
      checkedAt: new Date().toISOString(),
    }, (_, v) => typeof v === 'bigint' ? Number(v) : v);
    const newAnswers = { ...answersRef.current, [currentQuestion.id]: answer };
    answersRef.current = newAnswers;
    setAnswers(newAnswers);
    const shouldAward = countsAsPassed && !previousCorrect && !reviewMode;
    const hintWasUsed = hintsUsed.has(currentQuestion.id);
    const newScore = shouldAward ? score + (hintWasUsed ? 0.9 : 1) : score;
    let newPoints = totalPoints;
    let newStreak = streak;
    if (shouldAward) {
      setScore(newScore);
      if (confettiRef.current) burstConfetti(confettiRef.current, accent);
      if (pointsEnabled) {
        const { earned, label, isStreak } = calcPoints(hintWasUsed);
        newPoints = totalPoints + earned;
        newStreak = streak + 1;
        setTotalPoints(newPoints);
        setStreak(newStreak);
        setFloatingPoints({ id: Date.now(), text: label, x: 50, y: 60 });
        setTimeout(() => setFloatingPoints(null), 1200);
        setXpNotify(true);
        setTimeout(() => setXpNotify(false), 2500);
        if (isStreak) {
          setStreakToast(`${newStreak} in a row! Streak bonus`);
          setTimeout(() => setStreakToast(null), 2200);
        }
      }
    } else if (pointsEnabled && !reviewMode) {
      setStreak(0);
      newStreak = 0;
      if (payload.solutionViewed && !previousCorrect && !previousSolutionViewed) {
        const penalty = ps?.solutionPenalty ?? 30;
        newPoints = Math.max(0, totalPoints - penalty);
        setTotalPoints(newPoints);
        setFloatingPoints({ id: Date.now(), text: `-${penalty} XP`, x: 50, y: 60 });
        setTimeout(() => setFloatingPoints(null), 1200);
      }
    }
    saveProgress(newAnswers, (countsAsPassed || payload.skipped) ? currentQuestionIndex + 1 : currentQuestionIndex, newScore, newPoints, newStreak, hintsUsed);
  };

  const handlePythonComplete = (payload: any) => {
    const alreadyAnswered = !!answersRef.current[currentQuestion.id];
    const previousCorrect = alreadyAnswered ? isAnswerCorrect(currentQuestion, answersRef.current[currentQuestion.id]) : false;
    const previousSolutionViewed = alreadyAnswered ? (() => { try { return !!JSON.parse(answersRef.current[currentQuestion.id])?.solutionViewed; } catch { return false; } })() : false;
    const countsAsPassed = !!payload.passed && !!payload.proof && !payload.skipped && !payload.solutionViewed;
    const answer = JSON.stringify({
      code: payload.code,
      output: payload.output,
      passed: countsAsPassed,
      skipped: !!payload.skipped,
      attempts: Number(payload.attempts ?? 0),
      solutionViewed: !!payload.solutionViewed,
      proof: payload.proof,
      elapsedSeconds: Math.max(0, (Date.now() - questionStartTime) / 1000),
      checkedAt: new Date().toISOString(),
    });
    const newAnswers = { ...answersRef.current, [currentQuestion.id]: answer };
    answersRef.current = newAnswers;
    setAnswers(newAnswers);
    const shouldAward = countsAsPassed && !previousCorrect && !reviewMode;
    const hintWasUsed = hintsUsed.has(currentQuestion.id);
    const newScore = shouldAward ? score + (hintWasUsed ? 0.9 : 1) : score;
    let newPoints = totalPoints;
    let newStreak = streak;
    if (shouldAward) {
      setScore(newScore);
      if (confettiRef.current) burstConfetti(confettiRef.current, accent);
      if (pointsEnabled) {
        const { earned, label, isStreak } = calcPoints(hintWasUsed);
        newPoints = totalPoints + earned;
        newStreak = streak + 1;
        setTotalPoints(newPoints);
        setStreak(newStreak);
        setFloatingPoints({ id: Date.now(), text: label, x: 50, y: 60 });
        setTimeout(() => setFloatingPoints(null), 1200);
        setXpNotify(true);
        setTimeout(() => setXpNotify(false), 2500);
        if (isStreak) {
          setStreakToast(`${newStreak} in a row! Streak bonus`);
          setTimeout(() => setStreakToast(null), 2200);
        }
      }
    } else if (pointsEnabled && !reviewMode) {
      setStreak(0);
      newStreak = 0;
      if (payload.solutionViewed && !previousCorrect && !previousSolutionViewed) {
        const penalty = ps?.solutionPenalty ?? 30;
        newPoints = Math.max(0, totalPoints - penalty);
        setTotalPoints(newPoints);
        setFloatingPoints({ id: Date.now(), text: `-${penalty} XP`, x: 50, y: 60 });
        setTimeout(() => setFloatingPoints(null), 1200);
      }
    }
    saveProgress(newAnswers, (countsAsPassed || payload.skipped) ? currentQuestionIndex + 1 : currentQuestionIndex, newScore, newPoints, newStreak, hintsUsed);
  };

  // Shared rule (lib/course-progress): an optional share the student has not claimed leaves the
  // denominator, so skipping it cannot hold the bar below 100%.
  const slideCounts = courseProgressCounts(questions, answers);
  const completedSlides = slideCounts.done;
  const progressPct = slideCounts.total > 0 ? (slideCounts.done / slideCounts.total) * 100
    : slideCounts.authored > 0 ? 100 : 0;
  const timerWarning = timeLeft !== null && timeLeft <= 60;

  // -- Correct answer display for after-check feedback --
  const correctAnswerDisplay = () => {
    if (questionType === 'fill_blank') {
      return currentQuestion.correctAnswer.split('|').map((s: string) => s.trim()).join(' / ');
    }
    if (questionType === 'arrange') {
      return currentQuestion.options.join(' -> ');
    }
    if (questionType === 'image') {
      const idx = currentQuestion.options.indexOf(currentQuestion.correctAnswer);
      return idx >= 0 ? `Option ${idx + 1}` : currentQuestion.correctAnswer;
    }
    return currentQuestion.correctAnswer;
  };


  // -- Section divider slide --
  if (currentQuestion.isSection) {
    const isLast = currentQuestionIndex >= totalSlides - 1;
    const coverImage = (config as any).coverImage as string | undefined;
    // How many non-section, non-lessonOnly slides follow this section before the next section
    const slidesInSection = (() => {
      let count = 0;
      for (let i = currentQuestionIndex + 1; i < questions.length; i++) {
        const q = questions[i] as any;
        if (q.isSection) break;
        if (!q.lessonOnly) count++;
      }
      return count;
    })();

    return (
      <>
      <div className="relative flex flex-col min-h-screen overflow-hidden" style={{ fontFamily: fontStyle.fontFamily }}>

        {/* Full-bleed background -- cover image with overlay, or gradient fallback */}
        {coverImage ? (
          <>
            <img src={resolveCoverUrl(coverImage)} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: 'brightness(0.35) saturate(1.2)' }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}55 0%, transparent 60%, rgba(0,0,0,0.6) 100%)` }} />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: isDark
            ? `linear-gradient(135deg, #0a0a0f 0%, ${accent}22 50%, #0a0a0f 100%)`
            : `linear-gradient(135deg, #0f0f1a 0%, ${accent}33 50%, #1a1a2e 100%)` }} />
        )}

        {/* Noise texture overlay for depth */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")` }} />

        {/* Glowing accent orb top-right */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full blur-[120px] opacity-30 pointer-events-none" style={{ background: accent }} />
        {/* Subtle orb bottom-left */}
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full blur-[100px] opacity-20 pointer-events-none" style={{ background: accent }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col min-h-screen items-center justify-center px-6 py-16">
          <div className="absolute top-4 left-4 flex items-center gap-2">
            {currentQuestionIndex > 0 && (
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:brightness-110"
                style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.2)' }}
                title="Previous"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
          </div>
          <motion.div
            key={`section-${currentQuestionIndex}`}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
            className="w-full max-w-lg text-center"
          >
            {/* Section pill */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.35 }}
              className="flex items-center justify-center mb-6"
            >
              <span
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase border"
                style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#ffffff' }}
              >
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: accent }} />
                Section {currentSectionNumber}{totalSections > 1 ? ` of ${totalSections}` : ''}
              </span>
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.4 }}
              className="text-4xl sm:text-5xl font-black leading-[1.1] tracking-tight mb-4"
              style={{ color: '#ffffff' }}
            >
              {currentQuestion.sectionTitle || 'New Section'}
            </motion.h2>

            {/* Description */}
            {currentQuestion.sectionDescription && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.28, duration: 0.4 }}
                className="text-sm sm:text-base leading-relaxed mb-6"
                style={{ color: 'rgba(255,255,255,0.7)' }}
              >
                {currentQuestion.sectionDescription}
              </motion.p>
            )}

            {/* Meta row */}
            {slidesInSection > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.35 }}
                className="flex items-center justify-center gap-2 mb-8"
              >
                <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.15)' }}>
                  <BookOpen className="w-3 h-3" /> {slidesInSection} question{slidesInSection !== 1 ? 's' : ''}
                </span>
              </motion.div>
            )}

            {/* CTA button */}
            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.38, duration: 0.35 }}
              onClick={handleNext}
              className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.97] hover:brightness-110 shadow-2xl"
              style={{ background: accent, color: '#ffffff', boxShadow: `0 8px 40px ${accent}55` }}
            >
              {isLast ? 'Finish Course' : 'Begin Section'}
              <ChevronRight className="w-5 h-5" />
            </motion.button>
          </motion.div>
        </div>

        {/* Bottom progress strip */}
        <div className="relative z-10 px-6 pb-8 flex items-center gap-2 justify-center">
          {questions.map((q: any, i: number) => {
            if (q.isSection) {
              return (
                <div key={q.id} className="h-1 rounded-full transition-all duration-300"
                  style={{ width: i === currentQuestionIndex ? 24 : 8, background: i <= currentQuestionIndex ? accent : 'rgba(255,255,255,0.2)' }} />
              );
            }
            return (
              <div key={q.id} className="h-1 w-1.5 rounded-full"
                style={{ background: answers[q.id] ? accent : 'rgba(255,255,255,0.15)' }} />
            );
          })}
        </div>
      </div>

      </>
    );
  }


  // -- Unanswered questions confirmation modal --
  if (finishPending) {
    const goToQuestion = (idx: number) => {
      setFinishPending(null);
      setCurrentQuestionIndex(idx);
      setSelectedOption(null);
      setFillBlankAnswer('');
      setIsChecking(false);
      setIsCorrect(null);
    };
    // A required share slide is a hard gate, so it must not be escapable via "Submit anyway".
    const pendingShares = finishPending.filter((q: any) => q.isLinkedInShare);
    const pendingQuestions = finishPending.length - pendingShares.length;
    const modal = (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
        <div className={`w-full max-w-sm rounded-2xl p-6 space-y-4 ${isDark ? 'bg-zinc-900 border border-zinc-800' : 'bg-white border border-zinc-200'}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`font-semibold ${textColor}`}>
                {pendingShares.length > 0 && pendingQuestions === 0
                  ? `${pendingShares.length} LinkedIn share${pendingShares.length > 1 ? 's' : ''} outstanding`
                  : `${finishPending.length} item${finishPending.length > 1 ? 's' : ''} outstanding`}
              </p>
              <p className={`text-sm mt-0.5 ${mutedColor}`}>
                {pendingShares.length > 0
                  ? 'Submit your post link to finish this course.'
                  : 'Go back to answer them or submit anyway.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {finishPending.map((q: any) => {
              const idx = questions.findIndex((qq: any) => qq.id === q.id);
              return (
                <button
                  key={q.id}
                  onClick={() => goToQuestion(idx)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
                  style={{ borderColor: accent, color: accent, background: `${accent}15` }}
                >
                  {q.isLinkedInShare ? 'Share' : `Q${idx + 1}`}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 pt-1">
            {pendingShares.length === 0 && (
            <button
              onClick={() => { setFinishPending(null); finishCourse(score); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${isDark ? 'bg-zinc-800 text-[#A8B5C2] hover:bg-zinc-700' : 'bg-zinc-100 text-[#555555] hover:bg-zinc-200'}`}
            >
              Submit anyway
            </button>
            )}
            <button
              onClick={() => setFinishPending(null)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: accent }}
            >
              Keep answering
            </button>
          </div>
        </div>
      </div>
    );
    if (typeof document === 'undefined') return null;
    return createPortal(modal, document.body);
  }

  const quizUI = (
    <>
      {/* -- Confetti canvas -- */}
      <canvas
        ref={confettiRef}
        className="fixed inset-0 pointer-events-none z-[9998]"
        style={{ width: '100vw', height: '100vh' }}
      />

      {/* -- Streak toast -- */}
      <AnimatePresence>
        {streakToast && (
          <motion.div
            key="streak-toast"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none"
          >
            <span className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-semibold text-white shadow-lg"
              style={{ background: '#10b981' }}>
              🔥 {streakToast.replace(/^🔥\s*/, '')}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Locked-slide toast -- */}
      <AnimatePresence>
        {lockedToast && (
          <motion.div
            key="locked-toast"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none"
          >
            <span className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-semibold shadow-lg"
              style={{ background: isDark ? '#27272a' : '#111', color: '#fff' }}>
              <Lock className="w-3.5 h-3.5" /> {lockedToast}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Saving banner -- */}
      <AnimatePresence>
        {submitSaving && !submitError && (
          <motion.div
            key="submit-saving"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl"
            style={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', maxWidth: 420, width: 'calc(100vw - 32px)' }}
          >
            <Loader2 className="w-4 h-4 text-zinc-400 flex-shrink-0 animate-spin" />
            <p className="flex-1 text-xs text-[#A8B5C2]">Saving your result...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Submit error banner -- */}
      <AnimatePresence>
        {submitError && (
          <motion.div
            key="submit-error"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl"
            style={{ background: '#18181b', border: '1px solid rgba(239,68,68,0.4)', maxWidth: 420, width: 'calc(100vw - 32px)' }}
          >
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <p className="flex-1 text-xs text-[#A8B5C2]">{submitError}</p>
            <button
              onClick={() => finishCourse(score)}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: '#ef4444' }}
            >
              Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* -- Main container (split layout for full-screen, single column for inline) -- */}
      <div
        className={inlineMode
          ? `relative flex flex-col rounded-xl overflow-hidden min-h-[500px] ${isDark ? 'bg-black' : 'bg-white'}`
          : 'fixed inset-0 z-[200] overflow-hidden flex flex-col'
        }
        style={{ color: isDark ? '#ffffff' : '#18181b', ...fontStyle }}
      >

        {/* Nav bar -- full width */}
        <div
          className={`flex-shrink-0 flex items-center px-4 sm:px-6 ${(questionType === 'sql_exercise' || questionType === 'python_exercise') ? 'gap-4' : 'justify-between py-2'}`}
          style={{
            background: isDark ? '#17181E' : '#F2F5FA',
            minHeight: 44,
          }}
        >
          {(questionType === 'sql_exercise' || questionType === 'python_exercise') ? (
            <>
              {/* SQL/Python nav -- left: outline toggle (mobile) + logo */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {!sidebarOpen && (
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className={`sm:hidden p-1.5 rounded-lg transition-colors flex-shrink-0 ${isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'}`}
                    title="Open course outline"
                  >
                    <MenuIcon className="w-5 h-5" />
                  </button>
                )}
                {(isDark ? (logoDarkUrl || logoUrl) : logoUrl) && (
                  <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <img src={(isDark ? (logoDarkUrl || logoUrl) : logoUrl) || undefined} alt="" style={{ height: 30, width: 'auto', objectFit: 'contain' }} />
                  </Link>
                )}
              </div>

              {/* SQL nav -- right: XP + menu */}
              <div className="flex items-center gap-2 flex-1 justify-end">
                {pointsEnabled && (
                  <div
                    className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                    style={{ background: isDark ? '#1E1F26' : '#ffffff', marginTop: 6 }}
                  >
                    <span className="text-[14px]">🏆</span>
                    <span className="text-[11px] font-medium" style={{ color: txtFaint }}>XP</span>
                    <span className="text-[13px] font-bold tabular-nums" style={{ color: accent }}>
                      {displayedPoints.toLocaleString()}
                    </span>
                    {streak >= 2 && <span className="text-[12px] text-orange-400">🔥{streak}</span>}
                  </div>
                )}
                {timeLeft !== null && (
                  <span className={`flex items-center gap-1 text-xs font-semibold tabular-nums ${timerWarning ? 'text-rose-400' : mutedColor}`}>
                    <Clock className="w-3 h-3" />
                    {formatTime(timeLeft)}
                  </span>
                )}
                {reviewMode && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: txtMuted }}>
                    Review Mode
                  </span>
                )}
                <div ref={menuRef} className="relative">
                  <button
                    onClick={() => setShowMenu(v => !v)}
                    className={`relative p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'}`}
                    title="Course info"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                    {xpNotify && (
                      <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    )}
                  </button>
                  <AnimatePresence>
                    {showMenu && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.12 }}
                        className={`absolute right-0 top-9 z-50 w-52 rounded-xl shadow-xl border overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'}`}
                        onMouseLeave={() => setShowMenu(false)}
                      >
                        <div className={`px-4 py-3 border-b ${isDark ? 'border-zinc-800' : 'border-zinc-100'}`}>
                          <p className={`text-[10px] font-semibold uppercase tracking-widest ${mutedColor}`}>Course Progress</p>
                        </div>
                        <div className="px-4 py-3 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className={`text-xs ${mutedColor}`}>Current</span>
                            <span className="text-xs font-semibold" style={{ color: accent }}>{currentQuestionIndex + 1} of {totalSlides}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className={`text-xs ${mutedColor}`}>Total slides</span>
                            <span className="text-xs font-semibold" style={{ color: isDark ? '#fff' : '#18181b' }}>{totalSlides}</span>
                          </div>
                          {pointsEnabled && (
                            <div className="flex justify-between items-center">
                              <span className={`text-xs ${mutedColor}`}>XP earned</span>
                              <span className="text-xs font-bold tabular-nums flex items-center gap-1" style={{ color: isDark ? '#facc15' : '#10b981' }}>
                                ⭐ {displayedPoints.toLocaleString()}
                                {streak >= 2 && <span className="text-orange-400">🔥{streak}</span>}
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Default nav -- left: outline toggle (mobile) + logo */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!sidebarOpen && (
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className={`sm:hidden p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'}`}
                    title="Open course outline"
                  >
                    <MenuIcon className="w-5 h-5" />
                  </button>
                )}
                {(isDark ? (logoDarkUrl || logoUrl) : logoUrl) && (
                  <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center' }}>
                    <img src={(isDark ? (logoDarkUrl || logoUrl) : logoUrl) || undefined} alt="" style={{ height: 30, width: 'auto', objectFit: 'contain' }} />
                  </Link>
                )}
              </div>
              {/* Default nav -- right: controls */}
              <div className="flex items-center gap-1">
                {timeLeft !== null && (
                  <span className={`flex items-center gap-1 text-xs font-semibold tabular-nums mr-2 ${timerWarning ? 'text-rose-400' : mutedColor}`}>
                    <Clock className="w-3 h-3" />
                    {formatTime(timeLeft)}
                  </span>
                )}
                {reviewMode && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full mr-2"
                    style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: txtMuted }}>
                    Review Mode
                  </span>
                )}
                <div ref={menuRef} className="relative">
                  <button
                    onClick={() => setShowMenu(v => !v)}
                    className={`relative p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'}`}
                    title="Course info"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                    {xpNotify && (
                      <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    )}
                  </button>
                  <AnimatePresence>
                    {showMenu && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.12 }}
                        className={`absolute right-0 top-9 z-50 w-52 rounded-xl shadow-xl border overflow-hidden ${isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'}`}
                        onMouseLeave={() => setShowMenu(false)}
                      >
                        <div className={`px-4 py-3 border-b ${isDark ? 'border-zinc-800' : 'border-zinc-100'}`}>
                          <p className={`text-[10px] font-semibold uppercase tracking-widest ${mutedColor}`}>Course Progress</p>
                        </div>
                        <div className="px-4 py-3 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className={`text-xs ${mutedColor}`}>Current</span>
                            <span className="text-xs font-semibold" style={{ color: accent }}>{currentQuestionIndex + 1} of {totalSlides}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className={`text-xs ${mutedColor}`}>Total slides</span>
                            <span className="text-xs font-semibold" style={{ color: isDark ? '#fff' : '#18181b' }}>{totalSlides}</span>
                          </div>
                          {pointsEnabled && (
                            <div className="flex justify-between items-center">
                              <span className={`text-xs ${mutedColor}`}>XP earned</span>
                              <span className="text-xs font-bold tabular-nums flex items-center gap-1" style={{ color: isDark ? '#facc15' : '#10b981' }}>
                                ⭐ {displayedPoints.toLocaleString()}
                                {streak >= 2 && <span className="text-orange-400">🔥{streak}</span>}
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Body row: sidebar + content */}
        <div className="relative flex flex-1 overflow-hidden" style={{ background: isDark ? '#17181E' : '#F2F5FA' }}>

        {/* -- SIDEBAR (non-inline only) -- */}
        {!inlineMode && (
          <>
            {/* Mobile backdrop -- above the SQL player overlay (z-40) so the outline drawer is usable during exercises */}
            {sidebarOpen && (
              <div
                className="fixed inset-0 bg-black/60 z-[55] sm:hidden"
                onClick={() => setSidebarOpen(false)}
              />
            )}


            <aside
              className={`absolute inset-y-0 left-0 z-[56] rounded-r-2xl sm:relative sm:inset-auto sm:z-40 flex-shrink-0 flex flex-col transition-all duration-300 sm:my-3 sm:ml-3 sm:rounded-2xl ${!sidebarOpen ? '-translate-x-full sm:translate-x-0' : 'translate-x-0'}`}
              style={{
                width: sidebarOpen ? 'min(100vw, 360px)' : 48,
                minWidth: sidebarOpen ? 'min(100vw, 360px)' : 48,
                background: isDark ? '#1E1F26' : '#ffffff',
                overflow: sidebarOpen ? 'hidden' : 'visible',
              }}
            >
              {/* Header row -- course title + close (open), or centered hamburger (collapsed) */}
              <div className={`${sidebarOpen ? 'flex items-start justify-between gap-2 px-4' : 'hidden sm:flex justify-center px-0'} pt-3 pb-1 flex-shrink-0`}>
                {sidebarOpen && config.title && (
                  <p className="text-xl font-bold leading-snug pt-1 min-w-0" style={{ color: isDark ? '#ACB8C5' : '#111' }}>
                    {config.title}
                  </p>
                )}
                <div className="relative group flex-shrink-0">
                  <button
                    onClick={() => setSidebarOpen(v => !v)}
                    className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'}`}
                  >
                    {sidebarOpen
                      ? <X className="w-4 h-4" strokeWidth={2.5} />
                      : <MenuIcon className="w-5 h-5" />}
                  </button>
                  {/* Tooltip below when open (aside has overflow:hidden, left side is clipped). Tooltip to the right when collapsed (44px rail, no space on left). */}
                  <span className={`pointer-events-none absolute px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 ${isDark ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-900 text-white'} ${sidebarOpen ? 'top-full mt-1 right-0' : 'left-full ml-2 top-1/2 -translate-y-1/2'}`}>
                    {sidebarOpen ? 'Collapse outline' : 'Expand outline'}
                  </span>
                </div>
              </div>

              {/* Body -- kept mounted; fades with the width animation instead of hard-unmounting */}
              <div
                className="flex-1 flex flex-col min-h-0 transition-opacity duration-200"
                style={{ opacity: sidebarOpen ? 1 : 0, pointerEvents: sidebarOpen ? 'auto' : 'none', overflow: 'hidden' }}
                aria-hidden={!sidebarOpen}
              >
              {/* Overall progress */}
              <div
                className="px-4 py-3 border-b flex-shrink-0"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)' }}
              >
                <div className="flex justify-between text-[12px] mb-1.5" style={{ color: isDark ? '#555' : '#999' }}>
                  <span>Progress</span>
                  <span style={{ color: accent }}>{Math.round(progressPct)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%`, background: accent }}
                  />
                </div>
                {pointsEnabled && totalPoints > 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="text-[12px]" style={{ color: isDark ? '#555' : '#999' }}>XP</span>
                    <span className="text-[13px] font-bold tabular-nums" style={{ color: isDark ? '#facc15' : accent }}>
                      {displayedPoints.toLocaleString()}
                    </span>
                    {streak >= 2 && <span className="text-[12px] text-orange-400">🔥 {streak}</span>}
                  </div>
                )}
              </div>

              {/* Questions / chapters list */}
              <nav className="flex-1 py-1 overflow-y-auto">
                {chapters.map((group, gi) => {
                  const isCollapsed = collapsedSections.has(gi);
                  const groupLocked = group.slides.length > 0 && group.slides.every(({ idx }) => isSlideLocked(idx));
                  const toggleCollapse = () => setCollapsedSections(prev => {
                    const next = new Set(prev);
                    next.has(gi) ? next.delete(gi) : next.add(gi);
                    return next;
                  });
                  return (
                    <div
                      key={gi}
                      className="border-b last:border-b-0"
                      style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}
                    >
                      {/* Module header */}
                      <button
                        onClick={toggleCollapse}
                        className="w-full flex items-center justify-between gap-2 px-4 py-3.5 text-left transition-opacity hover:opacity-80"
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="text-[11px] font-bold mb-0.5" style={{ color: accent }}>
                            Module {gi + 1}
                          </span>
                          <span className="text-[15px] font-bold leading-snug"
                            style={{ color: isDark ? '#ACB8C5' : '#1a1a1a' }}>
                            {group.sectionTitle}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {groupLocked && <Lock className="w-3.5 h-3.5" style={{ color: isDark ? '#777' : '#9aa5b1' }} />}
                          <ChevronRight
                            className="w-4 h-4 transition-transform duration-200"
                            style={{
                              color: txtFaint,
                              transform: isCollapsed ? 'rotate(90deg)' : 'rotate(-90deg)',
                            }}
                          />
                        </div>
                      </button>

                      {/* Lessons */}
                      {!isCollapsed && (
                        <div className="px-2 pb-3 space-y-0.5">
                          {group.slides.map(({ q, idx }) => {
                            const progressStatus = getSlideProgressStatus(q);
                            const isDoneQ = progressStatus.completed;
                            const isCurrent = idx === currentQuestionIndex;
                            const locked = isSlideLocked(idx);

                            const title = (q as any).isLinkedInShare
                              ? ((q as any).linkedInShareTitle || 'LinkedIn Share')
                              : (q as any).isDownloads
                              ? ((q as any).downloadsTitle || 'Downloads')
                              : (q as any).lessonOnly
                                ? ((q as any).lesson?.title || 'Lesson Content')
                                : REVIEW_TYPES.includes(q.type as QuestionType)
                                  ? ((q as any).question || 'Project')
                                  : q.type === 'sql_exercise'
                                    ? ((q as any).lesson?.title || (q as any).question || 'SQL Exercise')
                                    : q.type === 'python_exercise'
                                      ? ((q as any).lesson?.title || (q as any).question || 'Python Exercise')
                                      : 'Test Your Knowledge';

                            let kind = 'Quiz';
                            // Widened past the lucide type so the LinkedIn brand mark can be used here too.
                            let KindIcon: React.ComponentType<{ className?: string }> = ListChecks;
                            if ((q as any).isLinkedInShare) { kind = 'Share'; KindIcon = LinkedInIcon; }
                            else if ((q as any).isDownloads) { kind = 'Downloads'; KindIcon = Download; }
                            else if ((q as any).lessonOnly) {
                              if ((q as any).lesson?.videoUrl) { kind = 'Video'; KindIcon = Play; }
                              else { kind = 'Reading'; KindIcon = FileText; }
                            } else if (REVIEW_TYPES.includes(q.type as QuestionType)) { kind = 'Project'; KindIcon = FlaskConical; }
                            else if (q.type === 'sql_exercise' || q.type === 'python_exercise') { kind = 'Lab'; KindIcon = FlaskConical; }

                            return (
                              <button
                                key={q.id}
                                onClick={() => {
                                  if (locked) { notifyLocked(); return; }
                                  setCurrentQuestionIndex(idx);
                                  if (typeof window !== 'undefined' && window.innerWidth < 640) setSidebarOpen(false);
                                }}
                                className={`w-full flex items-start gap-3 text-left rounded-xl px-2.5 py-2.5 transition-colors ${isCurrent ? '' : locked ? '' : isDark ? 'hover:bg-white/[0.06]' : 'hover:bg-black/[0.04]'}`}
                                style={{
                                  background: isCurrent ? `${accent}14` : undefined,
                                  opacity: locked ? 0.6 : 1,
                                  cursor: locked ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {/* Status circle */}
                                <span
                                  className="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                                  style={{
                                    background: isDoneQ ? accent : isDark ? 'rgba(255,255,255,0.06)' : '#eef1f5',
                                    border: isDoneQ
                                      ? 'none'
                                      : isCurrent
                                        ? `2px solid ${accent}`
                                        : `2px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#dce1e8'}`,
                                  }}
                                >
                                  {isDoneQ ? (
                                    <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                                  ) : locked ? (
                                    <Lock className="w-3 h-3" style={{ color: isDark ? '#888' : '#9aa5b1' }} />
                                  ) : isCurrent ? (
                                    <span className="w-2 h-2 rounded-full" style={{ background: accent }} />
                                  ) : null}
                                </span>

                                {/* Text */}
                                <span className="flex-1 min-w-0">
                                  <span className={`block text-[14px] leading-snug line-clamp-2 ${isCurrent ? 'font-semibold' : 'font-normal'}`}
                                    style={{ color: isDark ? '#ACB8C5' : isCurrent ? '#111' : '#1f2937' }}>
                                    {title}
                                  </span>
                                  <span className="flex items-center gap-1.5 mt-0.5 text-[12px]"
                                    style={{ color: txtFaint }}>
                                    <KindIcon className="w-3 h-3 flex-shrink-0" />
                                    {kind}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
              </div>
            </aside>
          </>
        )}

        {/* -- MAIN CONTENT COLUMN -- */}
        <div
          className={inlineMode ? 'flex-1 flex flex-col' : 'flex-1 overflow-hidden flex flex-col'}
          style={{ background: isDark ? '#17181E' : '#F2F5FA' }}
        >

          {/* SQL exercise player -- rendered outside AnimatePresence so CSS transforms from motion.div don't break its fixed positioning during slide transitions */}
          {questionType === 'sql_exercise' && (
            <SQLExercisePlayer
              key={currentQuestion.id}
              question={currentQuestion}
              runtime={sqlRuntime}
              isPreparing={sqlPreparing}
              prepareError={sqlPrepareError}
              isDark={isDark}
              accentColor={accent}
              savedAnswer={answers[currentQuestion.id]}
              completed={isAnswerCorrect(currentQuestion, answers[currentQuestion.id] ?? '')}
              topOffset={44}
              leftOffset={!inlineMode && typeof window !== 'undefined' && window.innerWidth >= 640 ? (sidebarOpen ? 372 : 60) : 0}
              sessionToken={sessionTokenRef.current ?? undefined}
              onComplete={handleSqlComplete}
              onCheckAnswer={async (questionId, query, result) => {
                const res = await fetch('/api/course', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(sessionTokenRef.current ? { Authorization: `Bearer ${sessionTokenRef.current}` } : {}),
                  },
                  body: JSON.stringify({ action: 'check-sql-answer', course_id: formId, question_id: questionId, query, result }),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Failed to check SQL answer.');
                return d;
              }}
              hintPenalty={pointsEnabled ? (ps?.hintPenalty ?? 20) : undefined}
              solutionPenalty={pointsEnabled ? (ps?.solutionPenalty ?? 30) : undefined}
              onHintUsed={() => setHintsUsed(prev => new Set(prev).add(currentQuestion.id))}
              onRevealSolution={async (questionId, attempts) => {
                const res = await fetch('/api/course', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(sessionTokenRef.current ? { Authorization: `Bearer ${sessionTokenRef.current}` } : {}),
                  },
                  body: JSON.stringify({ action: 'get-sql-solution', course_id: formId, question_id: questionId, attempts }),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Failed to load solution.');
                return d.solution ?? '';
              }}
              onNext={handleNext}
              isLastQuestion={currentQuestionIndex >= totalSlides - 1}
              isFirstTaskForLesson={isFirstTaskForLesson}
            />
          )}

          {/* Python exercise player -- same pattern as SQL: outside AnimatePresence, fixed overlay */}
          {questionType === 'python_exercise' && (
            <PythonExercisePlayer
              key={currentQuestion.id}
              question={currentQuestion}
              isDark={isDark}
              accentColor={accent}
              savedAnswer={answers[currentQuestion.id]}
              completed={isAnswerCorrect(currentQuestion, answers[currentQuestion.id] ?? '')}
              topOffset={44}
              leftOffset={!inlineMode && typeof window !== 'undefined' && window.innerWidth >= 640 ? (sidebarOpen ? 372 : 60) : 0}
              sessionToken={sessionTokenRef.current ?? undefined}
              onComplete={handlePythonComplete}
              hintPenalty={pointsEnabled ? (ps?.hintPenalty ?? 20) : undefined}
              solutionPenalty={pointsEnabled ? (ps?.solutionPenalty ?? 30) : undefined}
              onHintUsed={() => setHintsUsed(prev => new Set(prev).add(currentQuestion.id))}
              onCheckAnswer={async (questionId, code, output) => {
                const res = await fetch('/api/course', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(sessionTokenRef.current ? { Authorization: `Bearer ${sessionTokenRef.current}` } : {}),
                  },
                  body: JSON.stringify({ action: 'check-python-answer', course_id: formId, question_id: questionId, code, output }),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Failed to check answer.');
                return {
                  passed: !!d.passed,
                  message: d.message || (d.passed ? 'Output matches.' : 'Output does not match the expected result.'),
                  proof: d.proof,
                };
              }}
              onRevealSolution={async (questionId, attempts) => {
                const res = await fetch('/api/course', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(sessionTokenRef.current ? { Authorization: `Bearer ${sessionTokenRef.current}` } : {}),
                  },
                  body: JSON.stringify({ action: 'get-python-solution', course_id: formId, question_id: questionId, attempts }),
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error || 'Failed to load solution.');
                return d.solution ?? '';
              }}
              onNext={handleNext}
              isLastQuestion={currentQuestionIndex >= totalSlides - 1}
              isFirstTaskForLesson={isFirstTaskForLesson}
            />
          )}

          {/* Question content - scrollable */}
          <div
            ref={contentScrollRef}
            className={`flex-1 overflow-y-auto px-2 sm:px-4 pt-4 sm:pt-3 pb-4 sm:pb-6 w-full ${isDark ? 'course-scroll' : 'course-scroll course-scroll-light'}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="max-w-4xl mx-auto w-full">
                <div key={currentQuestionIndex}>
                  {/* -- LinkedIn share slide -- */}
                  {(currentQuestion as any).isLinkedInShare ? (() => {
                    const q: any = currentQuestion;
                    const isLast = currentQuestionIndex >= totalSlides - 1;
                    const required = q.linkedInShareRequired === true;
                    const claimed = answers[q.id] || '';
                    const draft = shareDrafts[q.id] ?? claimed;
                    const saving = shareSaving === q.id;
                    const error = shareErrors[q.id];
                    // Resolved through the same helper the AWARD uses (lib/attempt-points) and the
                    // advertised course total uses (lib/course-progress), so the three cannot disagree.
                    // Reading the raw field meant a config carrying 999999 -- imported, synced or
                    // hand-edited -- advertised 999,999 XP for a claim the server would clamp to 200,
                    // and a fractional 49.9 rendered as "49.9 XP" where the award floors it to 49.
                    const bonus = linkedInSharePointsFor(q);
                    // Deep link to LinkedIn's composer, prefilled with this course's public page --
                    // same share-offsite pattern the certificate and badge pages use. app/[id]
                    // resolves either a slug or an id, so formId is enough.
                    const composeUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
                      typeof window !== 'undefined' ? `${window.location.origin}/${formId}` : '',
                    )}`;

                    return (
                      <div className="rounded-xl overflow-hidden" style={{ background: isDark ? '#1E1F26' : '#ffffff' }}>
                        {/* Header: brand mark, title, and the reward as something to win rather than
                            a line of fine print. Once claimed the same slot becomes the receipt. */}
                        <div className="px-4 sm:px-8 pt-5 sm:pt-8 pb-4 sm:pb-5" style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#F2F5FA'}` }}>
                          <div className="flex items-start gap-3.5">
                            <span className="flex-shrink-0 flex items-center justify-center rounded-xl"
                              style={{ width: 44, height: 44, background: '#0A66C2' }}>
                              <LinkedInIcon className="w-6 h-6" style={{ color: '#fff' }} />
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: txtFaint }}>
                                Build your profile
                              </p>
                              <h1 className="text-xl font-bold leading-snug" style={{ color: isDark ? '#ACB8C5' : '#111' }}>
                                {q.linkedInShareTitle || 'Share your work on LinkedIn'}
                              </h1>
                            </div>
                          </div>

                          {pointsEnabled && bonus > 0 && (
                            <div className="mt-4 flex items-center gap-3 rounded-xl px-3.5 py-3"
                              style={{ background: claimed ? 'rgba(16,185,129,0.10)' : `${accent}12` }}>
                              <XpBadgeStack size={60} className="flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[15px] font-bold leading-tight flex items-center gap-1.5"
                                  style={{ color: claimed ? '#10b981' : accent }}>
                                  {claimed && <Check className="w-4 h-4 flex-shrink-0" strokeWidth={3} />}
                                  {claimed ? `${bonus} XP earned` : `${bonus} XP up for grabs`}
                                </p>
                                <p className="text-[12px] leading-snug mt-0.5" style={{ color: txtMuted }}>
                                  {claimed
                                    ? 'Your work is out in front of your network. That is how opportunities find you.'
                                    : 'Post about what you built, then paste the link below to claim it.'}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        {q.linkedInShareDescription && (
                          <div className="px-4 sm:px-8 pt-4 pb-1">
                            <div
                              className={`prose prose-sm max-w-none ${isDark ? '[&_*]:!text-[#A8B5C2] [&_strong]:!text-[#ACB8C5] [&_b]:!text-[#ACB8C5]' : '[&_*]:!text-[#555555]'}`}
                              style={{ color: txtMuted }}
                              dangerouslySetInnerHTML={{ __html: sanitizeRichText(q.linkedInShareDescription) }}
                            />
                          </div>
                        )}

                        {/* Suggested caption, copyable */}
                        {q.linkedInSharePrompt && (
                          <div className="px-4 sm:px-8 pt-4">
                            <div className="rounded-xl p-4" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#F7F9FC', border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}` }}>
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: txtFaint }}>Suggested post</p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(q.linkedInSharePrompt).then(() => {
                                      setSharePromptCopied(q.id);
                                      setTimeout(() => setSharePromptCopied(null), 1800);
                                    }).catch(() => {});
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all active:scale-[0.97]"
                                  style={{ background: isDark ? 'rgba(255,255,255,0.07)' : '#fff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)'}`, color: txt }}
                                >
                                  {sharePromptCopied === q.id ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                                </button>
                              </div>
                              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ color: txtMuted }}>
                                {q.linkedInSharePrompt}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Compose, then paste the resulting post link back */}
                        <div className="px-4 sm:px-8 pt-4 space-y-3">
                          <a
                            href={composeUrl} target="_blank" rel="noopener noreferrer"
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3.5 sm:py-3 rounded-xl text-[14px] font-semibold transition-all active:scale-[0.98] hover:opacity-90"
                            style={{ background: '#0A66C2', color: '#fff' }}
                          >
                            <LinkedInIcon className="w-[18px] h-[18px]" /> Write my post
                          </a>

                          <div className="space-y-2">
                            <label className="block text-[12.5px] font-semibold" style={{ color: txt }}>
                              Paste the link to your post
                            </label>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                type="url"
                                inputMode="url"
                                value={draft}
                                readOnly={reviewMode}
                                onChange={e => {
                                  setShareDrafts(prev => ({ ...prev, [q.id]: e.target.value }));
                                  if (shareErrors[q.id]) setShareErrors(prev => { const n = { ...prev }; delete n[q.id]; return n; });
                                }}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitLinkedInShare(q); } }}
                                placeholder="https://www.linkedin.com/posts/..."
                                className="flex-1 min-w-0 px-4 py-3 rounded-xl text-[13.5px] outline-none"
                                style={{
                                  background: isDark ? 'rgba(255,255,255,0.04)' : '#fff',
                                  border: `1px solid ${error ? '#f43f5e' : claimed ? `${accent}60` : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                                  color: txt,
                                }}
                              />
                              {!reviewMode && (
                                <button
                                  type="button"
                                  onClick={() => submitLinkedInShare(q)}
                                  disabled={saving || !draft.trim() || draft.trim() === claimed}
                                  className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13.5px] font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
                                  style={{ background: accent, color: '#fff' }}
                                >
                                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : claimed ? 'Update link' : 'Submit link'}
                                </button>
                              )}
                            </div>

                            {/* Asked for once, when there is no profile to check the post's author
                                against. Saving it retries the claim straight away. */}
                            {needsProfile === q.id && (
                              <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#F7F9FC' }}>
                                <p className="text-[12.5px] font-semibold" style={{ color: txt }}>
                                  First, add your LinkedIn profile
                                </p>
                                <p className="text-[12px] leading-relaxed" style={{ color: txtMuted }}>
                                  We check that the post you paste was written by you, so we need to know which profile is yours. This is saved to your profile once.
                                </p>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <input
                                    type="url" inputMode="url" value={profileDraft}
                                    onChange={e => { setProfileDraft(e.target.value); if (profileError) setProfileError(''); }}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveProfileAndRetry(q); } }}
                                    placeholder="linkedin.com/in/your-name"
                                    className="flex-1 min-w-0 px-4 py-3 rounded-xl text-[13.5px] outline-none"
                                    style={{
                                      background: isDark ? 'rgba(255,255,255,0.05)' : '#fff',
                                      border: `1px solid ${profileError ? '#f43f5e' : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                                      color: txt,
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => saveProfileAndRetry(q)}
                                    disabled={profileSaving || !profileDraft.trim()}
                                    className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13.5px] font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
                                    style={{ background: accent, color: '#fff' }}
                                  >
                                    {profileSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save and submit'}
                                  </button>
                                </div>
                                {profileError && (
                                  <p className="text-[12.5px] font-medium flex items-start gap-1.5" style={{ color: '#f43f5e' }}>
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {profileError}
                                  </p>
                                )}
                              </div>
                            )}

                            {error && (
                              <p className="text-[12.5px] font-medium flex items-start gap-1.5" style={{ color: '#f43f5e' }}>
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
                              </p>
                            )}
                            {!error && claimed && (
                              <a href={claimed} target="_blank" rel="noopener noreferrer"
                                className="text-[12.5px] font-semibold flex items-center gap-1.5 hover:underline" style={{ color: '#10b981' }}>
                                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> Verified. View your post
                              </a>
                            )}
                            {!error && !claimed && (
                              <p className="text-[12px] leading-relaxed" style={{ color: txtFaint }}>
                                Open your post on LinkedIn, copy its full address from the browser bar, and paste it
                                here. Shortened lnkd.in links cannot be checked.
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="px-4 sm:px-8 pb-5 sm:pb-7 pt-5">
                          <button
                            onClick={handleNext}
                            disabled={required && !claimed && !reviewMode}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 sm:py-3 rounded-xl text-[14px] font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
                            style={{ background: accent, color: 'white' }}
                          >
                            {required || claimed
                              ? (isLast ? 'Finish Course' : 'Continue')
                              : (isLast ? 'Skip and finish' : 'Skip for now')}
                            <ChevronRight className="w-4 h-4" />
                          </button>
                          {required && !claimed && !reviewMode && (
                            <p className="text-[12px] mt-2" style={{ color: txtFaint }}>
                              Submit your post link to continue.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })() :
                  /* -- Downloads slide -- */
                  (currentQuestion as any).isDownloads ? (() => {
                    const dlItems: DownloadItem[] = (currentQuestion as any).downloadItems || [];
                    const isLast = currentQuestionIndex >= totalSlides - 1;
                    return (
                      <div className="rounded-xl overflow-hidden" style={{ background: isDark ? '#1E1F26' : '#ffffff' }}>
                        <div className="px-4 sm:px-8 pt-5 sm:pt-8 pb-4 sm:pb-5" style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#F2F5FA'}` }}>
                          <div className="flex items-center gap-3">
                            <span className="inline-flex w-10 h-10 flex-shrink-0 items-center justify-center rounded-xl" style={{ color: accent, background: `${accent}18` }}><Download className="w-5 h-5" /></span>
                            <div><p className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: accent }}>Resources</p>
                            <h1 className="text-xl font-bold leading-snug" style={{ color: isDark ? '#ACB8C5' : '#111' }}>
                              {(currentQuestion as any).downloadsTitle || 'Downloads'}
                            </h1></div>
                          </div>
                        </div>
                        {(currentQuestion as any).downloadsDescription && (
                          <div className="px-4 sm:px-8 pt-4 pb-2">
                            <div
                              className={`prose prose-sm max-w-none ${isDark ? '[&_*]:!text-[#A8B5C2] [&_strong]:!text-[#ACB8C5] [&_b]:!text-[#ACB8C5]' : '[&_*]:!text-[#555555]'}`}
                              style={{ color: txtMuted }}
                              dangerouslySetInnerHTML={{ __html: sanitizeRichText((currentQuestion as any).downloadsDescription) }}
                            />
                          </div>
                        )}
                        <div className="px-4 sm:px-8 pt-4 pb-2 space-y-3">
                          {dlItems.length === 0 ? (
                            <div className="flex items-center gap-3 rounded-2xl px-4 py-4" style={{ background: isDark ? 'rgba(255,255,255,0.035)' : '#f7f7f8', color: txtMuted }}>
                              <span className="inline-flex w-10 h-10 items-center justify-center rounded-xl" style={{ color: accent, background: `${accent}18` }}><Download className="w-5 h-5" /></span>
                              <div><p className="text-sm font-semibold" style={{ color: txt }}>Resources coming soon</p><p className="text-xs mt-0.5">Your instructor has not added a file or link yet.</p></div>
                            </div>
                          ) : dlItems.map((item) => {
                            const isPdfEmbed = item.type === 'file' && !!item.fileUrl && !!item.pdfPages;
                            const href = item.type === 'file' ? (isPdfEmbed ? pdfDownloadUrl(item.fileUrl!) : item.fileUrl) : item.linkUrl;
                            const extension = item.type === 'link'
                              ? 'LINK'
                              : (item.fileName?.split('.').pop()?.toUpperCase() || (isPdfEmbed ? 'PDF' : 'FILE'));
                            return (
                              <article key={item.id} className="overflow-hidden rounded-2xl" style={{ background: isDark ? 'rgba(255,255,255,0.035)' : '#f7f7f8', border: `1px solid ${isDark ? 'rgba(255,255,255,0.065)' : 'rgba(0,0,0,0.05)'}` }}>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                                  <span className="inline-flex w-11 h-11 flex-shrink-0 items-center justify-center rounded-xl" style={{ color: accent, background: `${accent}18` }}>
                                    {item.type === 'file' ? <FileText className="w-5 h-5" /> : <Link2 className="w-5 h-5" />}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <h3 className="truncate text-[15px] font-bold" style={{ color: txt }}>{item.title || (item.type === 'file' ? 'Download file' : 'Open resource')}</h3>
                                      <span className="rounded-md px-1.5 py-0.5 text-[8px] font-extrabold tracking-wider" style={{ color: accent, background: `${accent}14` }}>{extension}</span>
                                    </div>
                                    {item.description ? (
                                      <div className={`mt-1 text-xs leading-relaxed prose prose-sm max-w-none ${isDark ? '[&_*]:!text-[#A8B5C2]' : '[&_*]:!text-[#666]'}`} dangerouslySetInnerHTML={{ __html: sanitizeRichText(item.description) }} />
                                    ) : <p className="mt-1 text-xs" style={{ color: txtMuted }}>{item.type === 'file' ? 'Ready to download' : 'External learning resource'}</p>}
                                  </div>
                                  {href ? (
                                    <a href={href} target="_blank" rel="noopener noreferrer" download={item.type === 'file' ? (item.fileName || true) : undefined}
                                      className="inline-flex min-h-10 flex-shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition-all hover:opacity-85 active:scale-[0.97]"
                                      style={{ background: accent, color: '#fff' }}>
                                      {item.type === 'file' ? <><ArrowDownToLine className="w-4 h-4" /> Download</> : <><ExternalLink className="w-4 h-4" /> Open</>}
                                    </a>
                                  ) : <span className="text-[10px] font-semibold" style={{ color: txtFaint }}>Not available</span>}
                                </div>
                                {isPdfEmbed && item.fileUrl && (
                                  <div className="px-3 pb-3 sm:px-4 sm:pb-4">
                                    <PdfCarousel url={item.fileUrl} pages={item.pdfPages || 1} fileName={item.fileName} accent={accent} isDark={isDark} />
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                        <div className="px-4 sm:px-8 pb-5 sm:pb-7 pt-4">
                          <button onClick={handleNext}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 sm:py-3 rounded-xl text-[14px] font-semibold transition-all active:scale-[0.98]"
                            style={{ background: accent, color: 'white' }}>
                            {isLast ? 'Finish Course' : 'Continue'}
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })() : /* -- Lesson-only slide: render as unified card like VirtualExperienceTaker -- */
                  currentQuestion.lessonOnly ? (() => {
                    const lesson = currentQuestion.lesson || {} as any;
                    const embedUrl = lesson.videoUrl ? getVideoEmbedUrl(lesson.videoUrl) : null;
                    const isLast = currentQuestionIndex >= totalSlides - 1;
                    return (
                      <div
                        className="rounded-xl overflow-hidden"
                        style={{
                          background: isDark ? '#1E1F26' : '#ffffff',
                        }}
                      >
                        {/* Lesson header */}
                        <div
                          className="px-4 sm:px-8 pt-5 sm:pt-8 pb-4 sm:pb-5"
                          style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#F2F5FA'}` }}
                        >
                          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: accent }}>Lesson</p>
                          <h1 className="text-xl font-bold leading-snug" style={{ color: isDark ? '#ACB8C5' : '#111' }}>
                            {lesson.title || 'Lesson Content'}
                          </h1>
                        </div>

                        {/* Video */}
                        {embedUrl && (
                          <div className="px-3 sm:px-8 pt-4 sm:pt-7 pb-2">
                            {isHtmlEmbedUrl(embedUrl) ? (
                              <div className="rounded-lg overflow-hidden">
                                <HtmlEmbedFrame src={embedUrl} />
                              </div>
                            ) : (
                              <div className="rounded-lg overflow-hidden" style={embedUrl.includes('canva.com') ? { height: '80vh' } : { aspectRatio: '16/9' }}>
                                <iframe
                                  src={embedUrl}
                                  className="w-full h-full border-0"
                                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                                  allowFullScreen
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Image */}
                        {lesson.imageUrl && (
                          <div className="px-3 sm:px-8 pt-4 pb-2">
                            <div className="rounded-lg overflow-hidden">
                              <img src={lesson.imageUrl} alt="Lesson illustration" className="w-full object-cover" />
                            </div>
                          </div>
                        )}

                        {/* PDF */}
                        {lesson.pdfUrl && (
                          <div className="px-3 sm:px-8 pt-4 pb-2">
                            <PdfCarousel url={lesson.pdfUrl} pages={lesson.pdfPages || 1} fileName={lesson.pdfName} accent={accent} isDark={isDark} />
                          </div>
                        )}

                        {/* Audio */}
                        {lesson.audioUrl && (
                          <div className="px-3 sm:px-8 pt-4 pb-2">
                            <LessonAudioPlayer src={lesson.audioUrl} isDark={isDark} />
                          </div>
                        )}

                        {/* Body */}
                        {(lesson.doc || lesson.body) && (
                          <div className="px-4 sm:px-8 pt-4 sm:pt-6 pb-5 sm:pb-6">
                            {lesson.doc ? (
                              <LessonRenderer key={currentQuestion.id} doc={lesson.doc} isDark={isDark} accentColor={accent} />
                            ) : (
                              <div
                                className={`prose prose-sm max-w-none [font-size:15.5px] ve-lesson-body ${INLINE_CODE_BADGE_CLASSES} ${isDark ? 'dark' : ''} ${isDark
                                  ? 'prose-invert prose-p:text-[#A8B5C2] prose-p:leading-[1.6] prose-headings:text-[#ACB8C5] prose-headings:font-semibold prose-strong:text-[#ACB8C5] prose-a:text-blue-400 prose-li:text-[#A8B5C2] prose-li:leading-[1.6] prose-hr:border-zinc-800 prose-blockquote:border-l-4 prose-blockquote:border-[#3E93FF] prose-blockquote:text-[#6b7a89] prose-blockquote:not-italic [&_pre]:bg-[#0f1120] [&_pre]:border [&_pre]:border-[#2e2e33] [&_pre]:rounded-lg [&_pre_code]:text-[#c9d1d9]'
                                  : 'prose-p:text-[#555555] prose-p:leading-[1.6] prose-headings:text-[#111] prose-headings:font-semibold prose-strong:text-[#111] prose-li:text-[#555555] prose-li:leading-[1.6] prose-a:text-blue-600 prose-hr:border-zinc-200 prose-blockquote:border-l-4 prose-blockquote:border-[#00bf63] prose-blockquote:text-[#888888] prose-blockquote:not-italic [&_pre]:bg-[#f6f8fa] [&_pre]:border [&_pre]:border-[#d0d7de] [&_pre]:rounded-lg [&_pre_code]:text-[#1f2328]'
                                }`}
                                style={{ color: isDark ? '#A8B5C2' : '#555555', ...fontStyle }}
                                dangerouslySetInnerHTML={{ __html: renderBody(lesson.body) }}
                              />
                            )}
                          </div>
                        )}

                        {/* Continue button inside card */}
                        <div className="px-4 sm:px-8 pb-5 sm:pb-7 pt-2">
                          <button
                            onClick={handleNext}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 sm:py-3 rounded-xl text-[14px] font-semibold transition-all active:scale-[0.98]"
                            style={{ background: accent, color: 'white' }}
                          >
                            {isLast ? 'Finish Course' : 'Mark complete & continue'}
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })() : <div
                    className="rounded-xl overflow-hidden"
                    style={{
                      background: isDark ? '#1E1F26' : '#ffffff',
                    }}
                  >
                  <div className="px-4 sm:px-8 pt-5 sm:pt-8 pb-5 sm:pb-8">
                  {/* Hint button -- hidden for review types */}
                  {currentQuestion.hint && !hintsUsed.has(currentQuestion.id) && !isChecking && !REVIEW_TYPES.includes(questionType) && (
                    <div className="flex items-center mb-5">
                      <button
                        onClick={() => {
                          setHintVisible(true);
                          setHintsUsed(prev => new Set(prev).add(currentQuestion.id));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
                        style={{ color: isDark ? '#fbbf24' : '#a16207', background: isDark ? 'rgba(245,158,11,0.09)' : '#fffbeb' }}
                      >
                        <Lightbulb className="w-3.5 h-3.5" /> Hint
                      </button>
                    </div>
                  )}

                  {/* Hint display */}
                  {hintVisible && currentQuestion.hint && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-5 flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
                      style={{ color: isDark ? '#fcd34d' : '#92400e', background: isDark ? 'rgba(245,158,11,0.09)' : '#fffbeb' }}
                    >
                      <Lightbulb className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span className="flex-1 leading-relaxed">{currentQuestion.hint}</span>
                      <span className="text-[10px] opacity-60 whitespace-nowrap">Score x0.9</span>
                    </motion.div>
                  )}

                  <h2 className={`text-lg sm:text-2xl font-semibold leading-snug mb-5 sm:mb-8 ${textColor}`}>
                    {questionType === 'fill_blank' && currentQuestion.question.includes('___')
                      ? currentQuestion.question.split('___').map((part: string, partIdx: number, parts: string[]) => (
                        <span key={`${partIdx}-${part}`}>
                          {part}
                          {partIdx < parts.length - 1 && <span className="mx-1 inline-block min-w-20 border-b-2 align-baseline" style={{ borderColor: accent, color: accent }} aria-label="blank">&nbsp;</span>}
                        </span>
                      ))
                      : currentQuestion.question}
                  </h2>


                  {/* -- Fill in the blank -- */}
                  {questionType === 'fill_blank' && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 px-0.5">
                          <span className="inline-flex w-7 h-7 items-center justify-center rounded-lg" style={{ color: accent, background: `${accent}18` }}>
                            <PenLine className="w-3.5 h-3.5" />
                          </span>
                          <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: txtMuted }}>Your answer</span>
                          {isChecking && (
                            <span className="ml-auto">
                              {isCorrect ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-rose-500" />}
                            </span>
                          )}
                        </div>
                        <div
                          className="rounded-xl overflow-hidden px-4 py-3.5 transition-all focus-within:ring-2"
                          style={{
                            background: isDark ? 'rgba(255,255,255,0.07)' : '#f4f5f7',
                            border: `1.5px solid ${isChecking ? (isCorrect ? '#10b98188' : '#f43f5e88') : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)')}`,
                            '--tw-ring-color': `${accent}42`,
                          } as React.CSSProperties}
                        >
                          <input
                            type="text"
                            value={fillBlankAnswer}
                            onChange={e => { if (!isChecking) setFillBlankAnswer(e.target.value); }}
                            onKeyDown={e => { if (e.key === 'Enter' && !isChecking && fillBlankAnswer.trim()) handleCheck(); }}
                            placeholder="Type your answer here…"
                            disabled={isChecking}
                            aria-label="Fill in the blank answer"
                            autoComplete="off"
                            className={`w-full bg-transparent border-none outline-none focus-visible:!outline-none focus-visible:!shadow-none px-0 py-0.5 text-base font-semibold caret-current ${isDark ? 'text-[#F1F5F9] placeholder:text-[#7F8996]' : 'text-[#111111] placeholder:text-[#747A84]'} disabled:opacity-70`}
                            style={{ caretColor: accent, borderRadius: 0 }}
                          />
                        </div>
                      </div>
                      {isChecking && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`mt-3 px-4 py-3 rounded-xl border text-sm flex items-center gap-2 ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}
                        >
                          {isCorrect ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                          <span>
                            {isCorrect ? 'Correct!' : (
                              <>Incorrect. Accepted: <span className="font-semibold">{currentQuestion.correctAnswer.split('|').map((s: string) => s.trim()).join(' / ')}</span></>
                            )}
                          </span>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* -- Arrange in order -- */}
                  {questionType === 'arrange' && (
                    <div>
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-xs ${mutedColor}`}>Put the items in the correct sequence.</p>
                        <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: txtFaint }}>Use arrows or drag</span>
                      </div>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={arrangeOrder} strategy={verticalListSortingStrategy}>
                          <div className="space-y-2">
                            {arrangeOrder.map((item, idx) => (
                              <SortableItem
                                key={item}
                                id={item}
                                label={item}
                                idx={idx}
                                count={arrangeOrder.length}
                                accent={accent}
                                isDark={isDark}
                                isChecking={isChecking}
                                onMove={(direction) => moveArrangeItem(idx, direction)}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                      {isChecking && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`mt-3 px-4 py-3 rounded-xl border text-sm ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}
                        >
                          {isCorrect ? (
                            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Correct order!</span>
                          ) : (
                            <div className="space-y-1">
                              <span className="flex items-center gap-2"><XCircle className="w-4 h-4" /> Incorrect order.</span>
                              <p className="text-xs opacity-80">Correct: {currentQuestion.options.join(' -> ')}</p>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* -- Image options -- */}
                  {questionType === 'image' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      {currentQuestion.options.map((option: string, idx: number) => {
                        const imgSrc = (currentQuestion.optionImages || [])[idx] || '';
                        const isSelected = selectedOption === option;
                        const showCorrect = isChecking && option === currentQuestion.correctAnswer;
                        const showWrong = isChecking && isSelected && !isCorrect;
                        const stateColor = showCorrect ? '#10b981' : showWrong ? '#f43f5e' : isSelected ? accent : undefined;
                        return (
                          <button
                            key={idx}
                            disabled={isChecking}
                            onClick={() => { setSelectedOption(option); if (showAnswers === 'per_question' && !isChecking && !answers[currentQuestion.id]) handleCheck(option); }}
                            aria-pressed={isSelected}
                            className="relative rounded-2xl overflow-hidden text-left transition-all duration-200 active:scale-[0.985] disabled:cursor-not-allowed group focus-visible:outline-none focus-visible:ring-2"
                            style={{
                              background: isDark ? 'rgba(255,255,255,0.035)' : '#f7f7f8',
                              border: `${stateColor ? 3 : 1.5}px solid ${stateColor || (isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)')}`,
                              boxShadow: stateColor ? `0 0 0 3px ${stateColor}16` : 'none',
                              '--tw-ring-color': `${accent}38`,
                            } as React.CSSProperties}
                          >
                            <div className="aspect-[16/10] overflow-hidden" style={{ background: isDark ? '#17181e' : '#eef0f3' }}>
                              {imgSrc ? (
                                <img src={imgSrc} alt={`Option ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-[1.025] transition-transform duration-300" />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-sm" style={{ color: txtFaint }}>
                                  <ImageIcon className="w-6 h-6" /> No image
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* -- Lesson content for review questions -- */}
                  {REVIEW_TYPES.includes(questionType) && currentQuestion.lesson && (currentQuestion.lesson.doc || currentQuestion.lesson.body || currentQuestion.lesson.videoUrl || currentQuestion.lesson.imageUrl || currentQuestion.lesson.pdfUrl || currentQuestion.lesson.audioUrl) && (
                    <>
                      {currentQuestion.lesson.videoUrl && getVideoEmbedUrl(currentQuestion.lesson.videoUrl) && (
                        isHtmlEmbedUrl(currentQuestion.lesson.videoUrl) ? (
                          <div className="mb-4 rounded-lg overflow-hidden">
                            <HtmlEmbedFrame src={getVideoEmbedUrl(currentQuestion.lesson.videoUrl)!} />
                          </div>
                        ) : (
                          <div className="mb-4 rounded-lg overflow-hidden" style={getVideoEmbedUrl(currentQuestion.lesson.videoUrl)!.includes('canva.com') ? { height: '80vh' } : { aspectRatio: '16/9' }}>
                            <iframe
                              src={getVideoEmbedUrl(currentQuestion.lesson.videoUrl)!}
                              className="w-full h-full border-0"
                              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                              allowFullScreen
                            />
                          </div>
                        )
                      )}
                      {currentQuestion.lesson.imageUrl && (
                        <div className="mb-4 rounded-lg overflow-hidden">
                          <img src={currentQuestion.lesson.imageUrl} alt="Lesson illustration" className="w-full object-cover" />
                        </div>
                      )}
                      {currentQuestion.lesson.pdfUrl && (
                        <div className="mb-4">
                          <PdfCarousel url={currentQuestion.lesson.pdfUrl} pages={currentQuestion.lesson.pdfPages || 1} fileName={currentQuestion.lesson.pdfName} accent={accent} isDark={isDark} />
                        </div>
                      )}
                      {currentQuestion.lesson.audioUrl && (
                        <div className="mb-4">
                          <LessonAudioPlayer src={currentQuestion.lesson.audioUrl} isDark={isDark} />
                        </div>
                      )}
                      {(currentQuestion.lesson.doc || currentQuestion.lesson.body) && (
                        currentQuestion.lesson.doc ? (
                          <div className="mb-6">
                            <LessonRenderer key={currentQuestion.id} doc={currentQuestion.lesson.doc} isDark={isDark} accentColor={accent} />
                          </div>
                        ) : (
                          <div
                            className={`mb-6 prose prose-sm max-w-none [font-size:15.5px] ve-lesson-body ${INLINE_CODE_BADGE_CLASSES} ${isDark ? 'dark' : ''} ${isDark
                              ? 'prose-invert prose-p:text-[#A8B5C2] prose-p:leading-[1.6] prose-headings:text-[#ACB8C5] prose-headings:font-semibold prose-strong:text-[#ACB8C5] prose-a:text-blue-400 prose-li:text-[#A8B5C2] prose-li:leading-[1.6] prose-hr:border-zinc-800 prose-blockquote:border-l-4 prose-blockquote:border-[#3E93FF] prose-blockquote:text-[#6b7a89] prose-blockquote:not-italic [&_pre]:bg-[#0f1120] [&_pre]:border [&_pre]:border-[#2e2e33] [&_pre]:rounded-lg [&_pre_code]:text-[#c9d1d9]'
                              : 'prose-p:text-[#555555] prose-p:leading-[1.6] prose-headings:text-[#111] prose-headings:font-semibold prose-strong:text-[#111] prose-li:text-[#555555] prose-li:leading-[1.6] prose-a:text-blue-600 prose-hr:border-zinc-200 prose-blockquote:border-l-4 prose-blockquote:border-[#00bf63] prose-blockquote:text-[#888888] prose-blockquote:not-italic [&_pre]:bg-[#f6f8fa] [&_pre]:border [&_pre]:border-[#d0d7de] [&_pre]:rounded-lg [&_pre_code]:text-[#1f2328]'
                            }`}
                            style={{ color: isDark ? '#A8B5C2' : '#555555', ...fontStyle }}
                            dangerouslySetInnerHTML={{ __html: renderBody(currentQuestion.lesson.body) }}
                          />
                        )
                      )}
                    </>
                  )}

                  {/* -- AI Review players -- */}
                  {questionType === 'code_review' && (
                    <CodeReviewPlayer
                      reqId={currentQuestion.id}
                      isDark={isDark}
                      accentColor={accent}
                      completed={reviewCompleted.has(currentQuestion.id)}
                      savedResult={reviewSaved?.report}
                      reviewsUsed={reviewSaved?.count ?? 0}
                      rubric={currentQuestion.rubric}
                      schema={currentQuestion.schema}
                      minScore={currentQuestion.minScore}
                      reviewLanguage={currentQuestion.reviewLanguage}
                      maxReviews={2}
                      showAttemptCount
                      onComplete={(result, passed) => recordReview(currentQuestion, result, passed)}
                    />
                  )}
                  {questionType === 'excel_review' && (
                    <ExcelReviewPlayer
                      reqId={currentQuestion.id}
                      isDark={isDark}
                      accentColor={accent}
                      completed={reviewCompleted.has(currentQuestion.id)}
                      savedResult={reviewSaved?.report}
                      reviewsUsed={reviewSaved?.count ?? 0}
                      context={currentQuestion.context}
                      rubric={currentQuestion.rubric}
                      minScore={currentQuestion.minScore}
                      maxReviews={2}
                      showAttemptCount
                      onComplete={(result, passed) => recordReview(currentQuestion, result, passed)}
                    />
                  )}
                  {questionType === 'dashboard_critique' && (
                    <DashboardCritiquePlayer
                      reqId={currentQuestion.id}
                      isDark={isDark}
                      accentColor={accent}
                      completed={reviewCompleted.has(currentQuestion.id)}
                      savedResult={reviewSaved?.result}
                      savedImageUrl={reviewSaved?.imageUrl}
                      rubric={currentQuestion.rubric}
                      minScore={currentQuestion.minScore}
                      reviewsUsed={reviewSaved?.count ?? 0}
                      maxReviews={2}
                      showAttemptCount
                      onComplete={(result, imageDataUrl, passed) => recordReview(currentQuestion, result, passed, { imageUrl: imageDataUrl })}
                    />
                  )}
                  {questionType === 'document_review' && (
                    <DocumentReviewPlayer
                      reqId={currentQuestion.id}
                      isDark={isDark}
                      accentColor={accent}
                      completed={reviewCompleted.has(currentQuestion.id)}
                      savedResult={reviewSaved?.report}
                      reviewsUsed={reviewSaved?.count ?? 0}
                      context={currentQuestion.context}
                      rubric={currentQuestion.rubric}
                      minScore={(currentQuestion as any).documentReviewMode === 'manual' ? undefined : currentQuestion.minScore}
                      maxReviews={(currentQuestion as any).documentReviewMode === 'manual' ? 1 : 2}
                      showAttemptCount
                      documentReviewMode={(currentQuestion as any).documentReviewMode ?? 'ai_only'}
                      onComplete={(result, passed) => recordReview(currentQuestion, result, passed, { documentReviewMode: (currentQuestion as any).documentReviewMode ?? 'ai_only' })}
                    />
                  )}

                  {/* -- Code snippet -- */}
                  {questionType === 'code' && currentQuestion.codeSnippet && (
                    <div className="mb-7 rounded-2xl overflow-hidden" style={{
                      border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
                      background: isDark ? '#0d1117' : '#fbfcfe',
                      boxShadow: isDark ? 'none' : '0 8px 24px rgba(15,23,42,0.055)',
                    }}>
                      <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ background: isDark ? '#151a22' : '#f3f5f8', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)'}` }}>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1.5" aria-hidden="true">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                            <span className="relative w-2.5 h-2.5 rounded-full bg-[#28c840]">
                              <span className="absolute inset-0 rounded-full bg-[#28c840] animate-ping motion-reduce:animate-none opacity-35" />
                            </span>
                          </span>
                          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em]" style={{ color: isDark ? '#8b98a7' : '#64748b' }}>
                            {currentQuestion.codeLanguage || 'javascript'}
                          </span>
                        </div>
                        <button type="button" onClick={() => {
                          navigator.clipboard?.writeText(currentQuestion.codeSnippet || '').then(() => {
                            setCodeCopied(currentQuestion.id);
                            setTimeout(() => setCodeCopied(null), 1600);
                          }).catch(() => {});
                        }} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-75" style={{ color: codeCopied === currentQuestion.id ? (isDark ? '#34d399' : '#059669') : (isDark ? '#9ca3af' : '#475569'), background: isDark ? 'rgba(255,255,255,0.05)' : '#ffffff' }}>
                          {codeCopied === currentQuestion.id ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy code</>}
                        </button>
                      </div>
                      <SyntaxHighlighter
                        language={currentQuestion.codeLanguage || 'javascript'}
                        style={isDark ? atomOneDark : atomOneLight}
                        customStyle={{ margin: 0, borderRadius: 0, fontSize: '14px', lineHeight: '1.7', padding: '20px 24px', background: isDark ? '#0d1117' : '#fbfcfe' }}
                        lineNumberStyle={{ color: isDark ? '#4b5563' : '#a1aab8', minWidth: '2.5em' }}
                        showLineNumbers
                      >
                        {currentQuestion.codeSnippet}
                      </SyntaxHighlighter>
                    </div>
                  )}

                  {/* -- Multiple choice (also renders for code type) -- */}
                  {(questionType === 'multiple_choice' || questionType === 'code') && (
                    <div className="space-y-2">
                      {currentQuestion.options.map((option: string, idx: number) => {
                        const isSelected = selectedOption === option;
                        const showCorrect = isChecking && option === currentQuestion.correctAnswer;
                        const showWrong = isChecking && isSelected && !isCorrect;
                        const stateColor = showCorrect ? '#10b981' : showWrong ? '#f43f5e' : isSelected ? accent : undefined;
                        const optionBg = showCorrect
                          ? (isDark ? 'rgba(16,185,129,0.12)' : '#ecfdf5')
                          : showWrong
                            ? (isDark ? 'rgba(244,63,94,0.12)' : '#fff1f2')
                            : isSelected
                              ? `${accent}14`
                              : (isDark ? 'rgba(255,255,255,0.035)' : '#f7f7f8');
                        return (
                          <button
                            key={idx}
                            disabled={isChecking}
                            onClick={() => { setSelectedOption(option); if (showAnswers === 'per_question' && !isChecking && !answers[currentQuestion.id]) handleCheck(option); }}
                            aria-pressed={isSelected}
                            style={{ background: optionBg, border: `1.5px solid ${stateColor ? `${stateColor}88` : (isDark ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.045)')}`, color: (isSelected || showCorrect || showWrong) ? txt : txtMuted, '--tw-ring-color': `${accent}38` } as React.CSSProperties}
                            className="group w-full text-left px-3.5 py-3.5 rounded-2xl transition-all duration-150 flex items-center gap-3 hover:-translate-y-px disabled:cursor-not-allowed disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2"
                          >
                            <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center" style={{ color: stateColor || txtFaint }}>
                              {showCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                              {showWrong && <XCircle className="w-4 h-4 text-rose-500" />}
                              {!showCorrect && !showWrong && <span className="w-3.5 h-3.5 rounded-full border-2" style={{ borderColor: isSelected ? accent : (isDark ? '#52525b' : '#d4d4d8'), background: isSelected ? accent : 'transparent', boxShadow: isSelected ? `inset 0 0 0 3px ${isDark ? '#24252b' : '#fff'}` : 'none' }} />}
                            </span>
                            <span className="flex-1 text-[15px] font-medium leading-snug">{option}</span>
                            <span className="min-w-4 flex-shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: stateColor || txtFaint }}>
                              {idx + 1}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  </div>{/* end inner padding */}

                  {/* -- Card footer: action bar -- */}
                  {(() => {
                    if (questionType === 'sql_exercise' || questionType === 'python_exercise') {
                      // Footer handled inside the exercise player (full-screen overlay)
                      return null;
                    }
                    // Review type footer: just a Continue button enabled once the review is submitted
                    if (REVIEW_TYPES.includes(questionType)) {
                      const done = reviewCompleted.has(currentQuestion.id);
                      return (
                        <div className="px-4 sm:px-8 py-3 sm:py-4 flex justify-end" style={{ background: isDark ? '#1E1F26' : '#ffffff' }}>
                          <button
                            onClick={handleNext}
                            disabled={!done}
                            className="flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{ background: done ? accent : (isDark ? '#3f3f46' : '#d4d4d8'), color: 'white' }}
                          >
                            {currentQuestionIndex < totalSlides - 1 ? 'Continue' : 'Finish Course'}
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    }

                    const hasLesson = (currentQuestion?.lesson?.doc || currentQuestion?.lesson?.body || currentQuestion?.lesson?.videoUrl || currentQuestion?.lesson?.imageUrl || currentQuestion?.lesson?.pdfUrl || currentQuestion?.lesson?.audioUrl) && (config as any).lessonTiming !== 'before';
                    return (
                      <div className="px-4 sm:px-8 py-3 sm:py-4" style={{ background: isDark ? '#1E1F26' : '#ffffff', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.045)'}` }}>
                        {isChecking && currentQuestion?.explanation && (
                          <div className="mb-3 rounded-xl px-3.5 py-3 text-sm leading-relaxed" style={{ color: txtMuted, background: isDark ? 'rgba(255,255,255,0.035)' : '#f7f7f8' }}>
                            <span className="block mb-1 font-bold text-[10px] uppercase tracking-[0.12em]" style={{ color: txtFaint }}>Explanation</span>
                            <span>{currentQuestion.explanation}</span>
                          </div>
                        )}
                        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                          {isChecking ? (
                            <div
                              className="flex items-center gap-2 px-3 py-2 rounded-xl font-semibold text-sm flex-shrink-0"
                              style={{
                                background: isCorrect ? (isDark ? 'rgba(16,185,129,0.10)' : '#ecfdf5') : (isDark ? 'rgba(244,63,94,0.10)' : '#fff1f2'),
                                color: isCorrect
                                  ? (isDark ? '#34d399' : '#059669')
                                  : (isDark ? '#fca5a5' : '#dc2626'),
                              }}>
                              {isCorrect ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                              {isCorrect ? 'Correct!' : 'Incorrect!'}
                            </div>
                          ) : null}
                          <div className="flex items-center justify-end gap-2 sm:gap-3 sm:ml-auto">
                            {showAnswers === 'per_question' ? (
                              isChecking ? (
                                <>
                                  {hasLesson && (
                                    <button onClick={() => setLessonOpen(true)}
                                      className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${isCorrect ? (isDark ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-emerald-50 text-emerald-600') : (isDark ? 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25' : 'bg-rose-50 text-rose-600')}`}>
                                      <BookOpen className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                                      {isCorrect ? 'Review Lesson' : 'Why?'}
                                    </button>
                                  )}
                                  <button onClick={handleNext}
                                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95"
                                    style={{ background: isCorrect ? '#10b981' : '#DB585A', color: 'white' }}>
                                    {currentQuestionIndex < totalSlides - 1 ? 'Continue' : 'Finish'}
                                    <ChevronRight className="w-4 h-4" />
                                  </button>
                                </>
                              ) : (
                                (questionType === 'fill_blank' || questionType === 'arrange') && (
                                  <button onClick={() => handleCheck()} disabled={!isAnswered()}
                                    className="px-6 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                                    style={{ background: isAnswered() ? accent : (isDark ? '#27272a' : '#e4e4e7'), color: isAnswered() ? 'white' : txtFaint }}>
                                    Check Answer
                                  </button>
                                )
                              )
                            ) : (
                              <>
                                {relatedAssignment && currentQuestionIndex === totalQuestions - 1 && (
                                  <p className="text-xs hidden sm:block" style={{ color: txtMuted }}>
                                    Complete to unlock <span className="font-semibold" style={{ color: accent }}>{relatedAssignment.title}</span>
                                  </p>
                                )}
                                <button onClick={handleNextDirect} disabled={!isAnswered() && questionType !== 'arrange'}
                                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                                  style={{ background: (isAnswered() || questionType === 'arrange') ? accent : (isDark ? '#3f3f46' : '#d4d4d8'), color: 'white' }}>
                                  {currentQuestionIndex < totalSlides - 1 ? 'Continue' : 'Finish Course'}
                                  <ChevronRight className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  </div>}
                </div>
            </div>
          </div>
        </div>{/* end main column */}
        </div>{/* end body row */}
      </div>{/* end main container */}

      {/* Chapters drawer - inline mode only (full-screen mode uses persistent sidebar) */}
      {inlineMode && (
        <AnimatePresence>
          {showChapters && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[300] bg-black/50"
                onClick={() => setShowChapters(false)}
              />
              <motion.div
                initial={{ x: -310 }}
                animate={{ x: 0 }}
                exit={{ x: -310 }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                className="fixed left-0 top-0 bottom-0 z-[301] flex flex-col"
                style={{
                  width: 300,
                  background: isDark ? '#111' : '#fff',
                  borderRight: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
                  boxShadow: '4px 0 32px rgba(0,0,0,0.35)',
                }}
              >
                <div className={`flex items-center justify-between px-4 py-3.5 border-b flex-shrink-0 ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
                  <p className="text-sm font-bold" style={{ color: txt }}>Course Contents</p>
                  <button onClick={() => setShowChapters(false)} className={`p-1 rounded-lg transition-colors ${isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'}`}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                  {chapters.map((group, gi) => (
                    <div key={gi}>
                      <div className="px-4 pt-4 pb-1.5">
                        <button
                          onClick={() => { if (group.sectionIdx !== null) { setCurrentQuestionIndex(group.sectionIdx); setShowChapters(false); } }}
                          disabled={group.sectionIdx === null}
                          className="text-left w-full"
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wide leading-tight" style={{ color: accent }}>{group.sectionTitle}</span>
                        </button>
                      </div>
                      {group.slides.map(({ q, idx }) => {
                        const answered = !!answers[q.id];
                        const isCurrent = idx === currentQuestionIndex;
                        const locked = isSlideLocked(idx);
                        return (
                          <button key={q.id}
                            onClick={() => { if (locked) { notifyLocked(); return; } setCurrentQuestionIndex(idx); setShowChapters(false); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:opacity-80"
                            style={{ background: isCurrent ? (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)') : 'transparent', opacity: locked ? 0.55 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
                          >
                            <span className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                              style={{ background: isCurrent ? accent : answered ? `${accent}25` : isDark ? '#2a2a2a' : '#f0f0f0', color: isCurrent ? '#fff' : answered ? accent : txtFaint }}>
                              {answered ? '✓' : locked ? <Lock className="w-3 h-3" /> : (q as any).lessonOnly ? '◉' : idx + 1}
                            </span>
                            <span className="flex-1 text-[13px] leading-snug line-clamp-2" style={{ color: isCurrent ? txt : txtMuted }}>
                              {(q as any).isLinkedInShare
                                ? ((q as any).linkedInShareTitle || 'LinkedIn Share')
                                : (q as any).isDownloads
                                ? ((q as any).downloadsTitle || 'Downloads')
                                : (q as any).lessonOnly
                                  ? ((q as any).lesson?.title || 'Lesson Content')
                                  : REVIEW_TYPES.includes(q.type as QuestionType)
                                    ? ((q as any).question || 'Project')
                                    : q.type === 'sql_exercise'
                                      ? ((q as any).lesson?.title || (q as any).question || 'SQL Exercise')
                                      : q.type === 'python_exercise'
                                        ? ((q as any).lesson?.title || (q as any).question || 'Python Exercise')
                                        : 'Test Your Knowledge'}
                            </span>
                            {isCurrent && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}

      {/* Lesson sheet */}
      <AnimatePresence>
        {lessonOpen && currentQuestion?.lesson && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLessonOpen(false)}
              className="fixed inset-0 z-[9990]"
              style={{ background: 'rgba(0,0,0,0.5)' }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 z-[9991] rounded-t-3xl flex flex-col overflow-hidden"
              style={{
                background: isDark ? '#18181b' : '#ffffff',
                color: isDark ? '#ffffff' : '#18181b',
                maxHeight: '88vh',
              }}
            >
              {/* drag handle */}
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className={`w-10 h-1 rounded-full ${isDark ? 'bg-zinc-700' : 'bg-zinc-300'}`} />
              </div>

              {/* header row */}
              <div className="flex items-start justify-between px-5 sm:px-8 pt-4 sm:pt-5 pb-3 sm:pb-4 flex-shrink-0">
                <div>
                  <p className={`text-[11px] font-semibold tracking-widest uppercase mb-1 ${faintColor}`}>Lesson</p>
                  <h3 className={`text-lg sm:text-xl font-bold leading-snug ${textColor}`}>
                    {currentQuestion.lesson.title || 'Theory'}
                  </h3>
                </div>
                <button
                  onClick={() => setLessonOpen(false)}
                  className={`mt-1 p-2 rounded-lg transition-colors flex-shrink-0 ${isDark ? 'text-zinc-500 hover:text-white hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* scrollable content */}
              <div className="overflow-y-auto flex-1 overscroll-contain">
                <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-2 pb-5 sm:pt-3 sm:pb-7 space-y-5 sm:space-y-6">
                  {currentQuestion.lesson.videoUrl && getVideoEmbedUrl(currentQuestion.lesson.videoUrl) && (
                    isHtmlEmbedUrl(currentQuestion.lesson.videoUrl) ? (
                      <div className="rounded-xl overflow-hidden shadow-md">
                        <HtmlEmbedFrame src={getVideoEmbedUrl(currentQuestion.lesson.videoUrl)!} />
                      </div>
                    ) : (
                      <div className="rounded-xl overflow-hidden shadow-md" style={{ aspectRatio: '16/9' }}>
                        <iframe
                          src={getVideoEmbedUrl(currentQuestion.lesson.videoUrl)!}
                          className="w-full h-full border-0"
                          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                          allowFullScreen
                        />
                      </div>
                    )
                  )}
                  {currentQuestion.lesson.imageUrl && (
                    <div className="rounded-xl overflow-hidden shadow-sm">
                      <img src={currentQuestion.lesson.imageUrl} alt="Lesson illustration" className="w-full object-cover" />
                    </div>
                  )}
                  {currentQuestion.lesson.pdfUrl && (
                    <PdfCarousel url={currentQuestion.lesson.pdfUrl} pages={currentQuestion.lesson.pdfPages || 1} fileName={currentQuestion.lesson.pdfName} accent={accent} isDark={isDark} />
                  )}
                  {currentQuestion.lesson.audioUrl && (
                    <LessonAudioPlayer src={currentQuestion.lesson.audioUrl} isDark={isDark} />
                  )}
                  {(currentQuestion.lesson.doc || currentQuestion.lesson.body) && (
                    currentQuestion.lesson.doc ? (
                      <LessonRenderer key={currentQuestion.id} doc={currentQuestion.lesson.doc} isDark={isDark} accentColor={accent} />
                    ) : (
                      <div
                        className={`prose prose-base sm:prose-lg max-w-none ve-lesson-body ${INLINE_CODE_BADGE_CLASSES} ${isDark ? 'dark' : ''} ${isDark
                          ? 'prose-invert prose-p:text-[#A8B5C2] prose-p:leading-[1.65] prose-headings:text-[#ACB8C5] prose-strong:text-[#ACB8C5] prose-a:text-blue-400 prose-li:text-[#A8B5C2] prose-li:leading-[1.65] prose-hr:border-zinc-800 prose-blockquote:border-l-[#3E93FF] prose-blockquote:text-[#6b7a89] prose-blockquote:not-italic'
                          : 'prose-p:text-[#555555] prose-p:leading-[1.65] prose-headings:text-[#111111] prose-strong:text-[#111111] prose-li:text-[#555555] prose-li:leading-[1.65] prose-a:text-blue-600 prose-hr:border-zinc-200 prose-blockquote:border-l-[#00bf63] prose-blockquote:text-[#888888] prose-blockquote:not-italic'
                        }`}
                        style={{ color: isDark ? '#A8B5C2' : '#555555', ...fontStyle }}
                        dangerouslySetInnerHTML={{ __html: renderBody(currentQuestion.lesson.body) }}
                      />
                    )
                  )}
                  {(config as any).lessonTiming === 'before' && !isChecking ? (
                    <button
                      onClick={() => setLessonOpen(false)}
                      className="w-full py-4 rounded-xl text-[15px] font-semibold transition-all active:scale-[0.98]"
                      style={{ background: accent, color: 'white' }}
                    >
                      Start Question
                    </button>
                  ) : isChecking ? (
                    <button
                      onClick={() => { setLessonOpen(false); handleNext(); }}
                      className="w-full py-4 rounded-xl text-[15px] font-semibold transition-all active:scale-[0.98]"
                      style={{ background: isCorrect ? '#10b981' : '#DB585A', color: 'white' }}
                    >
                      Continue
                    </button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Floating XP */}
      <AnimatePresence>
        {floatingPoints && (
          <motion.div
            key={floatingPoints.id}
            initial={{ opacity: 1, y: 0, scale: 1 }}
            animate={{ opacity: 0, y: -80, scale: 1.3 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            className="fixed z-[9999] pointer-events-none font-black text-2xl"
            style={{ left: `${floatingPoints.x}%`, top: `${floatingPoints.y}%`, transform: 'translateX(-50%)', textShadow: isDark ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.15)', color: isDark ? '#facc15' : '#10b981' }}
          >
            {floatingPoints.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Print protection */}
      <style>{`@media print { body { display: none !important; } }`}</style>
    </>
  );

  if (inlineMode) return quizUI;
  if (typeof document === 'undefined') return null;
  return createPortal(quizUI, document.body);
}
