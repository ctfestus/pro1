'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, Circle, ChevronRight, ChevronLeft, ChevronDown,
  X, Loader2, Trophy, BookOpen, Lock, Download, Award, Star, Clock,
  Link as LinkIcon, Upload as UploadIcon, Paperclip, Send, Reply, AlertTriangle, Eye, Check,
  SkipForward,
} from 'lucide-react';
import { XpBadgeStack } from '@/components/XpBadge';
import { clampLinkedInSharePoints } from '@/lib/course-schema';
import { supabase } from '@/lib/supabase';
import { sanitizeRichText, sanitizeEmailContent } from '@/lib/sanitize';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { applyNameTags } from '@/lib/merge-tags';
import { preflightLinkedInPostUrl } from '@/lib/linkedin-post-url';
import { saveMyLinkedInProfileUrl, shareClaimErrorMessage } from '@/lib/linkedin-profile';
import { veCompletionCounts, lessonCompletionPct, isVeComplete, reqCountsForCompletion } from '@/lib/ve-completion';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { LessonRenderer } from '@/components/lesson/LessonRenderer';
import type { LessonDoc } from '@/lib/lesson-doc';
import DashboardCritiquePlayer from '@/components/DashboardCritiquePlayer';
import CodeReviewPlayer from '@/components/CodeReviewPlayer';
import ExcelReviewPlayer from '@/components/ExcelReviewPlayer';
import DocumentReviewPlayer from '@/components/DocumentReviewPlayer';
import { buildReviewNotes, parseReviewNotes, isFullReport } from '@/lib/reviewRecord';
import { safeVeUploadName, validateVeSubmissionFile, VE_SUBMISSION_ACCEPT } from '@/lib/ve-upload';
import AiReviewDisclaimer from '@/components/AiReviewDisclaimer';
import {
  Person, Chip, AttachmentCard, ArrivalIndicator, arrivalKindFor, companyDomain, personEmail, firstNameOf,
  workStamp, startTypingSound, anchorZone, quoteSnippet, colleaguesFor, hashStr,
} from '@/components/ve/workplace';
import {
  MailCard, MailThreadMsg, MailTypingRow, MailComposer, MailStatusChip, SmartReplies,
  type MailAttachment,
} from '@/components/ve/MailCard';
import {
  ChatCard, ChatMsg, ChatTypingMsg, ChatReaction, ChatThread, ChatDecisionButtons, channelFor,
} from '@/components/ve/ChatCard';
import { BriefAskThread } from '@/components/ve/BriefAskThread';

// Hamburger -- matches the course player (tighter line spacing than lucide's Menu).
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" className={className}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

// Types
interface Requirement {
  id: string;
  label: string;
  description: string;
  type: 'task' | 'deliverable' | 'reflection' | 'mcq' | 'text' | 'upload' | 'briefing' | 'scenario_update' | 'decision' | 'debrief' | 'dashboard_critique' | 'code_review' | 'excel_review' | 'document_review' | 'linkedin_share';
  sharePrompt?: string;   // linkedin_share: suggested post text the student can copy
  // linkedin_share: only an explicit `true` gates the lesson. Absent/false = optional, never blocks.
  shareRequired?: boolean;
  // linkedin_share: bonus XP, clamped server-side to 0..MAX_LINKEDIN_SHARE_POINTS. ABSENT MEANS 0,
  // not the default amount -- requirements authored before VE shares paid XP must stay at zero
  // rather than silently start offering a bonus nobody chose. The editor writes the default
  // explicitly for newly created share requirements.
  sharePoints?: number;
  options?: string[];
  optionFeedback?: string[];
  correctAnswer?: string;
  expectedAnswer?: string;
  rubric?: string[];
  schema?: string;
  context?: string;
  minScore?: number;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
  aiReview?: boolean;
  emailFrame?: boolean;
  emailBody?: string;
  attachments?: Array<{ name: string; url: string; mimeType?: string }>;
}
interface Lesson {
  id: string;
  title: string;
  body: string;
  doc?: LessonDoc;
  videoUrl?: string;
  requirements: Requirement[];
}
interface Module {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
  solutionVideo?: string;
}
interface Dataset {
  filename: string;
  description: string;
  csvContent?: string;
  url?: string;
}
interface ProjectConfig {
  isVirtualExperience: true;
  title?: string;
  industry: string;
  difficulty: string;
  role: string;
  company: string;
  managerName?: string;
  managerTitle?: string;
  guideSnapshot?: {
    fullName: string;
    professionalTitle?: string;
    company?: string;
    profilePhotoUrl?: string;
    bio?: string;
    linkedinUrl?: string;
    expertise?: string[];
  } | null;
  duration: string;
  tools: string[];
  tagline: string;
  description: string;
  background: string;
  coverImage: string;
  learnOutcomes: string[];
  modules: Module[];
  dataset?: Dataset;
}

type Progress = Record<string, { completed: boolean; notes?: string; selectedAnswer?: string; fileUrl?: string; linkUrl?: string; aiPassed?: boolean; aiFeedback?: string; aiScore?: number; aiErrored?: boolean }>;

interface Props {
  formId: string;
  formSlug: string;
  config: ProjectConfig;
  studentName: string;
  studentEmail: string;
  userId: string;
  sessionToken: string;
  initialProgress?: Progress;
  initialModuleId?: string;
  initialLessonId?: string;
  isDark?: boolean;
  accentColor?: string;
  shortCourse?: boolean;
  logoUrl?: string;
  logoDarkUrl?: string;
  previewMode?: boolean;
}

// Helpers
const REQ_META: Record<string, { label: string; color: string; bg: string }> = {
  task:        { label: 'Deliverable', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  deliverable: { label: 'Deliverable', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  reflection:  { label: 'Reflection',  color: '#00b95c', bg: 'rgba(0,185,92,0.12)' },
  briefing:    { label: 'Manager Brief', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  scenario_update: { label: 'Scenario Update', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  decision:    { label: 'Decision', color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)' },
  debrief:     { label: 'Debrief', color: '#14b8a6', bg: 'rgba(20,184,166,0.12)' },
  linkedin_share: { label: 'LinkedIn Share', color: '#0A66C2', bg: 'rgba(10,102,194,0.12)' },
};

import { safeEmbedUrl as getVideoEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { HtmlEmbedFrame } from '@/components/HtmlEmbedFrame';

// Lesson percentage comes from the shared rule so the player, the progress route and the
// assignment-completion route cannot disagree about what "done" means.
function lessonProgress(lesson: Lesson, progress: Progress): number {
  return lessonCompletionPct(lesson, progress);
}

function isAnswerCorrect(studentAnswer: string, expectedAnswer: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalize(studentAnswer) === normalize(expectedAnswer);
}

function allLessons(modules: Module[]): { moduleId: string; lesson: Lesson }[] {
  return modules.flatMap(m => m.lessons.map(l => ({ moduleId: m.id, lesson: l })));
}

function CompanyAvatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.25,
      background: `${color}22`, border: `1.5px solid ${color}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 800, color, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function DifficultyDots({ difficulty, color }: { difficulty: string; color: string }) {
  const level = difficulty === 'advanced' ? 3 : difficulty === 'intermediate' ? 2 : 1;
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full inline-block"
          style={{ background: i <= level ? color : 'currentColor', opacity: i <= level ? 1 : 0.2 }} />
      ))}
    </span>
  );
}


// Component
export default function VirtualExperienceTaker({
  formId, formSlug, config, studentName, studentEmail, userId, sessionToken,
  initialProgress = {}, initialModuleId, initialLessonId,
  isDark = true, accentColor = '#00b95c', shortCourse = false,
  logoUrl = '', logoDarkUrl = '', previewMode = false,
}: Props) {
  const authHeader = useMemo(
    () => sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {} as Record<string, string>,
    [sessionToken],
  );
  const bg      = isDark ? '#0f0f0f' : '#F2F5FA';
  const surface = isDark ? '#1a1a1a' : '#ffffff';
  const border  = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const text     = isDark ? '#f0f0f0' : '#111';
  const muted    = isDark ? '#888' : '#666';
  const subtle   = isDark ? '#262626' : '#f0f0ec';
  const fieldBg = isDark ? 'rgba(255,255,255,0.055)' : '#ffffff';
  const fieldBorder = isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1';
  const fieldShadow = isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)';

  const navText    = isDark ? text : '#111';
  const navMuted   = isDark ? muted : '#666';

  const modules = config.modules || [];
  const flat    = allLessons(modules);

  // Simulated workplace identities: everyone gets a company address so the
  // mail/chat surfaces read like a real workplace.
  const workDomain = companyDomain(config.company, config.title);
  const manager: Person = {
    name:  config.guideSnapshot?.fullName || config.managerName || 'Your Manager',
    title: config.guideSnapshot?.professionalTitle || config.managerTitle || 'Project Lead',
    email: personEmail(config.guideSnapshot?.fullName || config.managerName || 'Your Manager', workDomain),
    avatarUrl: config.guideSnapshot?.profilePhotoUrl,
    company: config.guideSnapshot?.company || config.company,
    bio: config.guideSnapshot?.bio,
    linkedinUrl: config.guideSnapshot?.linkedinUrl,
    expertise: config.guideSnapshot?.expertise,
    color: '#3b82f6',
  };
  const meEmail  = personEmail(studentName || 'me', workDomain);
  const teamChannel = channelFor(config.role);

  const startModule = initialModuleId || modules[0]?.id || '';
  const startLesson = initialLessonId || modules[0]?.lessons[0]?.id || '';

  const [progress,     setProgress]     = useState<Progress>(initialProgress);
  const [currentModId, setCurrentModId] = useState(startModule);
  const [currentLesId, setCurrentLesId] = useState(startLesson);
  const [sidebarOpen,  setSidebarOpen]  = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true
  );
  const [noteValues,   setNoteValues]   = useState<Record<string, string>>({});
  // Mission content is read first, then a "Continue to Tasks" click reveals the
  // tasks/deliverables below (hidden until then). Once continued, the content
  // collapses into a re-readable toggle rather than disappearing.
  const [continuedLessons, setContinuedLessons] = useState<Set<string>>(new Set());
  const [contentExpanded,  setContentExpanded]  = useState<Set<string>>(new Set());
  const [saving,       setSaving]       = useState(false);
  const [completed,    setCompleted]    = useState(false);
  const [reviewMode,   setReviewMode]   = useState(false);
  const [review,       setReview]       = useState<any>(null);
  const [certId,            setCertId]            = useState<string | null>(null);
  const [certInstitutionName, setCertInstitutionName] = useState('');
  const [certIssuedAt, setCertIssuedAt] = useState<string | null>(null);
  const [certLoading,  setCertLoading]  = useState(false);
  const [certError,    setCertError]    = useState<string | null>(null);
  const [uploadingReq, setUploadingReq] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  // linkedin_share deliverables: draft URL per requirement, plus claim state.
  const [shareDrafts, setShareDrafts] = useState<Record<string, string>>({});
  const [shareSaving, setShareSaving] = useState<string | null>(null);
  const [shareErrors, setShareErrors] = useState<Record<string, string>>({});
  const [shareCopied, setShareCopied] = useState<string | null>(null);
  // Set when the server has no LinkedIn profile to check a post's author against.
  const [needsProfile, setNeedsProfile] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [aiReviewing,  setAiReviewing]  = useState<Record<string, boolean>>({});
  // `errored: true` marks a review that never actually ran (validation / rate-limit / server /
  // network) - it is shown as a neutral "could not review" state, never a pass/fail grade.
  const [aiFeedback,   setAiFeedback]   = useState<Record<string, { passed: boolean; feedback: string; score: number; errored?: boolean } | null>>({});
  const [saveError,    setSaveError]    = useState<string | null>(null);
  const saveTimeout  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const [typingDecisions, setTypingDecisions] = useState<Set<string>>(new Set());
  const [typingAcks,      setTypingAcks]      = useState<Set<string>>(new Set());
  const [openReplies,     setOpenReplies]     = useState<Set<string>>(new Set());
  // Floating brief chat: one panel open at a time; seen stops the attention pulse.
  const [askOpen,         setAskOpen]         = useState<Set<string>>(new Set());
  const [askSeen,         setAskSeen]         = useState<Set<string>>(new Set());
  const [efReviewing,     setEfReviewing]     = useState<Record<string, boolean>>({});
  const [efTyping,        setEfTyping]        = useState<Record<string, boolean>>({});
  // Thread-based retries for email-framed short answers: each wrong attempt
  // stays in the thread as a sent reply + manager response (session-only).
  const [efRounds,        setEfRounds]        = useState<Record<string, Array<{ me: string; feedback: string; passed: boolean }>>>({});
  const [efPending,       setEfPending]       = useState<Record<string, string>>({});

  const currentMod = modules.find(m => m.id === currentModId);
  const currentLes = currentMod?.lessons.find(l => l.id === currentLesId);
  const embedUrl   = currentLes?.videoUrl ? getVideoEmbedUrl(currentLes.videoUrl) : null;

  // Same rule the server uses. Counting Object.values(progress) instead would include stale
  // entries for deleted requirements, and counting every requirement would let a skipped
  // optional share hold the bar below 100% and keep Complete disabled forever.
  const overallCounts = veCompletionCounts(modules, progress);
  const totalReqs  = overallCounts.totalReqs;
  const doneReqs   = overallCounts.doneReqs;
  const overallPct = totalReqs ? Math.round((doneReqs / totalReqs) * 100) : 100;
  const canComplete = isVeComplete(overallCounts);

  const flatIdx = flat.findIndex(f => f.lesson.id === currentLesId);
  const hasPrev = flatIdx > 0;
  const hasNext = flatIdx < flat.length - 1;

  // Review and preview both move between missions freely; a student does not. Preview needs it
  // because an instructor cannot finish work whose submit path needs a real attempt behind it.
  const navUnlocked = reviewMode || previewMode;

  // A lesson is unlocked only if all previous lessons are 100% complete.
  const isUnlocked = (idx: number) => {
    if (navUnlocked || idx === 0) return true;
    return lessonProgress(flat[idx - 1].lesson, progress) === 100;
  };

  const currentLesPct  = currentLes ? lessonProgress(currentLes, progress) : 0;
  const allCurrentDone = currentLesPct === 100;
  const remainingCount = currentLes ? currentLes.requirements.filter(r => !progress[r.id]?.completed).length : 0;
  const canPersistProgress = !previewMode && !reviewMode && !!formId && formId !== 'preview' && !!userId && userId !== 'preview';

  /**
   * One rule for when a requirement stops holding back the ones after it, used by all three
   * places that need it: the requirement list's sequential-arrival gate, the arriving-messages
   * indicator, and the preview skip target. They were three near-copies, and the indicator's
   * copy demanded `completed` from every predecessor -- so an optional, unclaimed LinkedIn share
   * (which owes nothing and does not block) made it announce hidden messages that were in fact
   * already on screen.
   *
   * `reqOwesWork` is the share-aware "still to do" test; `reqAnimating` covers the manager's
   * reply still typing, during which the next message has not arrived yet.
   */
  const reqOwesWork  = (r: Requirement) => reqCountsForCompletion(r, progress) && !progress[r.id]?.completed;
  const reqAnimating = (r: Requirement) => typingAcks.has(r.id) || typingDecisions.has(r.id) || !!efTyping[r.id];
  const reqSettled   = (r: Requirement) => !reqOwesWork(r) && !reqAnimating(r);

  // The requirement the preview skip control acts on: the first one still owed, and only once it
  // has actually arrived on screen. While an earlier manager reply is still animating, the step
  // after it is hidden, so offering a skip then would let a click land on something never seen.
  const nextBlockingReq = (() => {
    const reqs = currentLes?.requirements || [];
    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      if (!reqOwesWork(r)) continue;
      return reqs.slice(0, i).every(reqSettled) && !reqAnimating(r) ? r : null;
    }
    return null;
  })();

  // Preview only: mark a requirement done in memory so the conversation moves on. Never persisted
  // -- canPersistProgress is already false in preview, so saveProgress is not called at all.
  const skipReqInPreview = (reqId: string) => {
    if (!previewMode) return;
    setProgress(prev => ({ ...prev, [reqId]: { ...prev[reqId], completed: true } }));
  };

  // Load existing review / completion state
  useEffect(() => {
    if (!canPersistProgress) return;
    fetch(`/api/guided-project-progress?formId=${formId}&studentId=${userId}`, { headers: authHeader })
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        const attempt = data?.attempt;
        if (attempt?.review) setReview(attempt.review);
        if (attempt?.completed_at) setCompleted(true);
      })
      .catch(() => {});
  }, [formId, authHeader, userId, canPersistProgress]);

  // Save progress (debounced 800ms): skipped in review mode and preview mode
  const saveProgress = useCallback((prog: Progress, modId: string, lesId: string, completedAt?: string) => {
    if (!canPersistProgress) return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch('/api/guided-project-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({
            formId, studentEmail, studentName,
            progress: prog,
            currentModuleId: modId,
            currentLessonId: lesId,
            completedAt: completedAt || null,
          }),
        });
        if (!res.ok) {
          let message = 'Progress was not saved. Please refresh and try again.';
          try {
            const json = await res.json();
            if (json?.error) message = json.error;
          } catch {}
          setSaveError(message);
        }
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [formId, studentEmail, studentName, authHeader, canPersistProgress]);

  const toggleReq = (reqId: string) => {
    setProgress(prev => {
      const next = { ...prev, [reqId]: { ...prev[reqId], completed: !prev[reqId]?.completed } };
      saveProgress(next, currentModId, currentLesId);
      return next;
    });
  };

  const setNote = (reqId: string, notes: string) => {
    setNoteValues(prev => ({ ...prev, [reqId]: notes }));
    setProgress(prev => {
      const next = { ...prev, [reqId]: { ...prev[reqId], notes } };
      saveProgress(next, currentModId, currentLesId);
      return next;
    });
  };

  const handleFileUpload = async (reqId: string, file: File, noComplete?: boolean) => {
    // Preview writes nothing anywhere. The upload is the one action that would reach storage even
    // though no attempt is being recorded, leaving a submission file nobody owns behind.
    if (previewMode) {
      setUploadErrors(prev => ({ ...prev, [reqId]: 'Preview does not upload files. Use Skip this step to move on.' }));
      return;
    }
    const validationError = validateVeSubmissionFile(file);
    if (validationError) { setUploadErrors(prev => ({ ...prev, [reqId]: validationError })); return; }
    setUploadErrors(prev => ({ ...prev, [reqId]: '' }));
    setUploadingReq(reqId);
    try {
      const ext  = file.name.split('.').pop();
      const path = `submissions/${formId}/${encodeURIComponent(studentEmail)}/${reqId}-${Date.now()}-${safeVeUploadName(file.name)}`;
      const { error } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
      setProgress(prev => {
        const next = { ...prev, [reqId]: { ...prev[reqId], fileUrl: publicUrl, ...(noComplete ? {} : { completed: true }) } };
        saveProgress(next, currentModId, currentLesId);
        return next;
      });
    } catch (e: any) {
      setUploadErrors(prev => ({ ...prev, [reqId]: e?.message || 'Upload failed. Check your connection and try again.' }));
    } finally {
      setUploadingReq(null);
    }
  };

  const setUploadLink = (reqId: string, linkUrl: string) => {
    setProgress(prev => {
      const next = { ...prev, [reqId]: { ...prev[reqId], linkUrl, completed: !!linkUrl.trim() } };
      saveProgress(next, currentModId, currentLesId);
      return next;
    });
  };

  /**
   * Claim a LinkedIn post for a linkedin_share deliverable.
   *
   * Awaited rather than debounced through saveProgress: only the server knows whether the post is
   * already claimed, and the requirement only counts as complete once it says so. The route writes
   * the progress entry itself, so we mirror its canonical URL instead of saving our own.
   */
  const submitShareLink = async (reqId: string) => {
    const draft = (shareDrafts[reqId] ?? '').trim();
    if (!draft || !canPersistProgress) return;
    const pre = preflightLinkedInPostUrl(draft);
    if (!pre.ok) {
      setShareErrors(prev => ({ ...prev, [reqId]: shareClaimErrorMessage(pre.code) }));
      return;
    }
    setShareErrors(prev => { const n = { ...prev }; delete n[reqId]; return n; });
    setShareSaving(reqId);
    try {
      const res = await fetch('/api/guided-project-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'claim-linkedin-share', veId: formId, requirementId: reqId, post_url: draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // No profile on file to check the author against -- ask for it inline instead of erroring.
        if (json?.error === 'no_profile') {
          setNeedsProfile(reqId); setProfileError(''); return;
        }
        setShareErrors(prev => ({ ...prev, [reqId]: shareClaimErrorMessage(json?.error) }));
        // Deliberately NOT offering to change the saved profile here. Letting a student edit it in
        // response to a mismatch turns the check into a formality: paste a stranger's post, enter that
        // stranger's profile as your own, retry. Setting a profile for the first time is fine (above);
        // changing one to match a post that just failed is not.
        return;
      }
      const savedUrl = typeof json.url === 'string' ? json.url : draft;
      setShareDrafts(prev => ({ ...prev, [reqId]: savedUrl }));
      setProgress(prev => ({ ...prev, [reqId]: { ...prev[reqId], linkUrl: savedUrl, completed: true } }));
    } catch {
      setShareErrors(prev => ({ ...prev, [reqId]: 'Could not save your link. Please try again.' }));
    } finally {
      setShareSaving(null);
    }
  };

  /** Save the student's LinkedIn profile, then retry the claim it was blocking. */
  const saveProfileAndRetry = async (reqId: string) => {
    setProfileSaving(true);
    setProfileError('');
    try {
      const result = await saveMyLinkedInProfileUrl(profileDraft);
      if (!result.ok) { setProfileError(result.error); return; }
      setNeedsProfile(null);
      await submitShareLink(reqId);
    } finally {
      setProfileSaving(false);
    }
  };

  const navigate = (modId: string, lesId: string, idx: number) => {
    if (!isUnlocked(idx)) return;
    setCurrentModId(modId);
    setCurrentLesId(lesId);
    saveProgress(progress, modId, lesId);
  };

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentLesId]);

  const continueToTasks = (lessonId: string) => {
    setContinuedLessons(prev => new Set([...prev, lessonId]));
  };

  const toggleContentExpanded = (lessonId: string) => {
    setContentExpanded(prev => {
      const next = new Set(prev);
      next.has(lessonId) ? next.delete(lessonId) : next.add(lessonId);
      return next;
    });
  };

  const goNext = () => {
    if (!hasNext || (!navUnlocked && !allCurrentDone)) return;
    const { moduleId, lesson } = flat[flatIdx + 1];
    navigate(moduleId, lesson.id, flatIdx + 1);
  };

  const goPrev = () => {
    if (!hasPrev) return;
    const { moduleId, lesson } = flat[flatIdx - 1];
    navigate(moduleId, lesson.id, flatIdx - 1);
  };

  const handleComplete = async () => {
    if (!canPersistProgress) { setCompleted(true); return; }
    const now = new Date().toISOString();
    setSaving(true);
    try {
      const res = await fetch('/api/guided-project-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          formId, studentEmail, studentName,
          progress, currentModuleId: currentModId,
          currentLessonId: currentLesId, completedAt: now,
        }),
      });
      if (!res.ok) throw new Error(`complete failed: ${res.status}`);
      setCompleted(true);
    } catch (err) {
      alert('Could not save your completion. Please check your connection and try again.');
      console.error('[VE complete]', err);
    } finally {
      setSaving(false);
    }
  };

  const handleGetCertificate = async () => {
    if (!canPersistProgress) return;
    setCertLoading(true);
    setCertError(null);
    try {
      const res = await fetch('/api/guided-project-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'issue-certificate', veId: formId, studentEmail, studentName }),
      });
      const json = await res.json();
      if (json.certId) {
        setCertId(json.certId);
        fetch(`/api/certificate/${json.certId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.settings?.institutionName) setCertInstitutionName(data.settings.institutionName);
            if (data?.issuedAt) setCertIssuedAt(data.issuedAt);
          })
          .catch(() => {});
      } else {
        setCertError(json.error || 'Something went wrong. Please try again.');
        console.error('[VE cert]', json);
      }
    } catch (err) {
      setCertError('Network error. Please try again.');
      console.error('[VE cert]', err);
    } finally {
      setCertLoading(false);
    }
  };

  const downloadDataset = () => {
    if (!config.dataset) return;
    if (config.dataset.csvContent) {
      const blob = new Blob([config.dataset.csvContent], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = config.dataset.filename;
      a.click(); URL.revokeObjectURL(url);
    } else if (config.dataset.url) {
      window.open(config.dataset.url, '_blank', 'noopener,noreferrer');
    }
  };

  // Completion screen
  if (completed && !reviewMode) {
    const totalLessons  = modules.reduce((a, m) => a + m.lessons.length, 0);
    const totalModules  = modules.length;

    const buildLinkedInUrl = (name: string, id: string, orgName?: string, issuedAt?: string | null) => {
      const issueDate = issuedAt ? new Date(issuedAt) : new Date();
      const certUrl = `${window.location.origin}/certificate/${id}`;
      const params = new URLSearchParams({
        startTask: 'CERTIFICATION_NAME',
        name,
        issueYear: String(issueDate.getFullYear()),
        issueMonth: String(issueDate.getMonth() + 1),
        certId: id,
        certUrl,
      });
      if (orgName) params.set('organizationName', orgName);
      return `https://www.linkedin.com/profile/add?${params}`;
    };

    return (
      <div className="min-h-screen flex flex-col font-sans" style={{ background: isDark ? '#0e0e0e' : '#F3F4F2', color: text, fontFamily: "'Google Sans', 'Inter', sans-serif" }}>

        {/* This screen is an early return, so the preview banner from the main layout is not on
            it. Repeat it here rather than let a congratulations page read as a real completion. */}
        {previewMode && (
          <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold flex-shrink-0"
            style={{ background: `${accentColor}18`, color: accentColor, borderBottom: `1px solid ${accentColor}30` }}>
            <Eye className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Preview. This is the completion screen a student sees. Nothing was recorded and no certificate is issued.</span>
          </div>
        )}

        {/* Hero banner */}
        <div className="relative overflow-hidden flex-shrink-0" style={{ minHeight: 300 }}>
          {/* Cover image or solid blue fallback */}
          {config.coverImage ? (
            <img src={resolveCoverUrl(config.coverImage)} alt="cover"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => (e.currentTarget.style.display = 'none')} />
          ) : (
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}99)` }} />
          )}
          {/* Dark overlay for readability */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0.25) 100%)' }} />
          <div className="relative z-10 flex flex-col items-center justify-end text-center px-6 pb-12 pt-16 space-y-3" style={{ minHeight: 300 }}>
            {/* Badge */}
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-widest"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', backdropFilter: 'blur(6px)' }}>
              <Trophy className="w-3.5 h-3.5" /> {shortCourse ? 'Course Complete' : 'Virtual Experience Complete'}
            </div>
            {/* Name */}
            <h1 className="text-4xl sm:text-5xl font-black leading-tight" style={{ color: '#fff' }}>
              Well done, {studentName.split(' ')[0]}!
            </h1>
            {/* Company + role (VE only) */}
            {!shortCourse && (
              <p className="text-[15px] max-w-xl" style={{ color: 'rgba(255,255,255,0.75)' }}>
                You completed the <span style={{ color: '#fff', fontWeight: 600 }}>{config.role}</span> experience at{' '}
                <span style={{ color: '#fff', fontWeight: 700 }}>{config.company}</span>.
              </p>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">

          {/* Stats row */}
          <div className="grid grid-cols-3 overflow-hidden rounded-2xl"
            style={{ background: isDark ? '#1c1c1c' : '#fff', boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.06)' : '0 10px 28px rgba(15,23,42,0.06)' }}>
            {[
              { label: 'Milestones', value: totalModules },
              { label: 'Missions',   value: totalLessons },
              { label: 'Score',      value: '100%' },
            ].map(s => (
              <div key={s.label} className="p-4 text-center [&:not(:last-child)]:border-r"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
                <p className="text-2xl font-black" style={{ color: accentColor }}>{s.value}</p>
                <p className="text-[12px] mt-0.5" style={{ color: muted }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Skills demonstrated */}
          {(config.learnOutcomes || []).length > 0 && (
            <div className="rounded-2xl overflow-hidden"
              style={{ background: isDark ? '#1c1c1c' : '#fff', boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.06)' : '0 10px 28px rgba(15,23,42,0.06)' }}>
              <div className="px-5 py-4 border-b flex items-center gap-2"
                style={{ borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
                <Star className="w-4 h-4" style={{ color: accentColor }} fill={accentColor} />
                <p className="text-[13px] font-bold" style={{ color: text }}>Skills Demonstrated</p>
              </div>
              <div className="px-5 py-4 space-y-3">
                {(config.learnOutcomes || []).map((o, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: `${accentColor}18` }}>
                      <CheckCircle2 className="w-3 h-3" style={{ color: accentColor }} />
                    </div>
                    <p className="text-[14px] leading-snug" style={{ color: isDark ? '#ccc' : '#333' }}>{o}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instructor feedback */}
          {review && (
            <div className="rounded-2xl overflow-hidden"
              style={{ background: isDark ? '#1c1c1c' : '#fff', border: `1px solid ${accentColor}30` }}>
              <div className="px-5 py-4 border-b flex items-center justify-between"
                style={{ borderColor: `${accentColor}20`, background: `${accentColor}08` }}>
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4" style={{ color: accentColor }} />
                  <p className="text-[13px] font-bold" style={{ color: accentColor }}>Instructor Feedback</p>
                </div>
                {review.score !== undefined && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black" style={{ color: accentColor }}>{review.score}</span>
                    <span className="text-[12px]" style={{ color: muted }}>/100</span>
                  </div>
                )}
              </div>
              {review.feedback && (
                <p className="px-5 py-4 text-[14px] leading-relaxed" style={{ color: isDark ? '#ccc' : '#444' }}>{review.feedback}</p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2 pt-2">
            {certId ? (
              <div className="space-y-2">
                <a
                  href={buildLinkedInUrl(
                    config.title || config.role || 'Virtual Experience Certificate',
                    certId,
                    certInstitutionName || config.company || undefined,
                    certIssuedAt
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-[15px] transition-all hover:opacity-90"
                  style={{ background: '#0A66C2', color: '#fff' }}
                >
                  <LinkedInIcon className="w-5 h-5" /> Add to LinkedIn Profile
                </a>
                <a
                  href={`/certificate/${certId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-[14px] border transition-all hover:opacity-70"
                  style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'}`, color: muted, background: 'transparent' }}
                >
                  <Award className="w-4 h-4" /> View Certificate
                </a>
              </div>
            ) : previewMode ? (
              // No certificate is issued in preview, so do not offer a button whose handler
              // returns straight away. Say what a student would get here instead.
              <div className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-[13.5px] font-semibold"
                style={{ background: `${accentColor}12`, color: accentColor }}>
                <Eye className="w-4 h-4 flex-shrink-0" />
                A student claims their certificate here. Preview issues none.
              </div>
            ) : (
              <>
                <button onClick={handleGetCertificate} disabled={certLoading}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-[15px] transition-all hover:opacity-90 disabled:opacity-60"
                  style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>
                  {certLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Award className="w-5 h-5" />}
                  {certLoading ? 'Generating Certificate…' : 'Get Certificate'}
                </button>
                {certError && (
                  <p className="text-center text-[13px] px-2" style={{ color: '#f87171' }}>{certError}</p>
                )}
              </>
            )}
            <button onClick={() => { setReviewMode(true); setCurrentModId(modules[0]?.id || ''); setCurrentLesId(modules[0]?.lessons[0]?.id || ''); }}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-[14px] border transition-all hover:opacity-70"
              style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'}`, color: muted, background: 'transparent' }}>
              <BookOpen className="w-4 h-4" /> Review Experience
            </button>
            <a href={`/${formSlug}`}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-medium text-[13px] transition-all hover:opacity-70"
              style={{ color: muted }}>
              Back to Overview
            </a>
          </div>

        </div>
      </div>
    );
  }

  // Main layout
  return (
    <div className="relative flex flex-col h-screen overflow-hidden font-sans" style={{ background: bg, color: text }}>

      {/* Compact workplace bar */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5"
        style={{ background: isDark ? '#141414' : '#F2F5FA', minHeight: 52 }}>
        {/* Left: hamburger (mobile, only when sidebar closed) + logo */}
        <div className="flex items-center gap-2.5 min-w-0">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)}
              className={`sm:hidden p-1.5 rounded-lg transition-colors flex-shrink-0 ${isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'}`}
              title="Open course outline">
              <MenuIcon className="w-5 h-5" />
            </button>
          )}
          {(isDark ? (logoDarkUrl || logoUrl) : logoUrl) && (
            <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center' }}>
              <img src={(isDark ? (logoDarkUrl || logoUrl) : logoUrl) || undefined} alt="" style={{ height: 24, width: 'auto', objectFit: 'contain' }} />
            </Link>
          )}
          <div className="hidden sm:block min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-20" style={{ background: accentColor }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: accentColor }} />
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: accentColor }}>Workplace</span>
            </div>
            <p className="max-w-[320px] truncate text-[13px] font-semibold" style={{ color: navText }}>{config.title || config.company || 'Virtual Experience'}</p>
          </div>
        </div>
        <div className="flex-1" />
        {/* Right: controls */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: navMuted }} />}
          {config.dataset && (
            <button onClick={downloadDataset} title={`Download ${config.dataset.filename}`}
              className="sm:hidden flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg"
              style={{ background: isDark ? `${accentColor}18` : 'rgba(255,255,255,0.15)', color: isDark ? accentColor : '#fff' }}>
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums" style={{ color: accentColor, background: `${accentColor}12` }}>{overallPct}% complete</span>
        </div>
      </div>

      {/* Body row */}
      <div className="relative flex flex-1 overflow-hidden" style={{ background: isDark ? '#141414' : '#F2F5FA' }}>

      {/* Mobile backdrop: tap to close sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-[55] sm:hidden" onClick={() => setSidebarOpen(false)} />
      )}


      {/* Sidebar: absolute overlay on mobile, in-flow on sm+ -- rounded card to match the course player */}
      <aside className={`absolute inset-y-0 left-0 z-[56] rounded-r-2xl sm:relative sm:inset-auto sm:z-40 flex-shrink-0 flex flex-col transition-all duration-300 sm:my-3 sm:ml-3 sm:rounded-2xl ${!sidebarOpen ? '-translate-x-full sm:translate-x-0' : 'translate-x-0'}`}
        style={{
          width: sidebarOpen ? 'min(100vw, 324px)' : 48, minWidth: sidebarOpen ? 'min(100vw, 324px)' : 48,
          background: surface,
          overflow: sidebarOpen ? 'hidden' : 'visible',
        }}>

        {/* Toggle + title header */}
        <div className={`flex pt-3 pb-1 flex-shrink-0 ${sidebarOpen ? 'items-start px-4' : 'items-center justify-center'}`}>
          {sidebarOpen ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: accentColor }}>Mission outline</p>
                <p className="text-[15px] font-bold leading-snug pt-1 truncate" style={{ color: text }}>{config.role || config.title || 'Virtual Experience'}</p>
              </div>
              <div className="relative group ml-2 flex-shrink-0">
                <button onClick={() => setSidebarOpen(false)} style={{ color: muted }} className="hover:opacity-60 p-1">
                  <X className="w-4 h-4" strokeWidth={2.5} />
                </button>
                {/* Tooltip below: aside has overflow:hidden so left direction is clipped */}
                <span className="pointer-events-none absolute top-full mt-1 right-0 z-50 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900 text-white">
                  Collapse outline
                </span>
              </div>
            </>
          ) : (
            <div className="relative group hidden sm:flex">
              <button onClick={() => setSidebarOpen(true)} style={{ color: muted }} className="hover:opacity-60 p-1">
                <MenuIcon className="w-5 h-5" />
              </button>
              <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900 text-white">
                Expand outline
              </span>
            </div>
          )}
        </div>

        {sidebarOpen && (<>
        {/* Overall progress */}
        <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: border }}>
          <div className="flex justify-between text-xs mb-1.5" style={{ color: muted }}>
            <span>Overall progress</span><span>{overallPct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: subtle }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${overallPct}%`, background: accentColor }} />
          </div>
        </div>

        {/* Dataset download */}
        {config.dataset && (
          <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: border }}>
            <button onClick={downloadDataset}
              className="w-full flex items-center gap-2 text-xs font-semibold py-2 px-3 rounded-xl transition-all hover:opacity-80"
              style={{ background: `${accentColor}18`, color: accentColor }}>
              <Download className="w-3.5 h-3.5" />
              <span className="truncate">{config.dataset.filename || 'Download file'}</span>
            </button>
            <p className="text-[11px] mt-1.5 px-1" style={{ color: muted }}>{config.dataset.description}</p>
          </div>
        )}

        {/* Forage-style vertical timeline */}
        <nav className="flex-1 py-3 overflow-y-auto">
          <div className="px-4">
            {flat.map(({ moduleId, lesson }, idx) => {
              const lesPct   = lessonProgress(lesson, progress);
              const isCurr   = lesson.id === currentLesId;
              const locked   = !isUnlocked(idx);
              const isIntro  = idx === 0;
              const isLast   = idx === flat.length - 1;
              const taskNum  = idx;
              const reqCount = lesson.requirements?.length || 0;
              const estTime  = reqCount <= 2 ? '15-30 mins' : reqCount <= 4 ? '30-60 mins' : '45-90 mins';
              const lessonDiff = isIntro ? null : idx === 1 ? 'beginner' : config.difficulty;
              const circleColor = locked ? muted : isCurr || lesPct === 100 ? accentColor : muted;

              return (
                <button key={lesson.id}
                  onClick={() => !locked && navigate(moduleId, lesson.id, idx)}
                  disabled={locked}
                  className="w-full flex items-start gap-3 text-left transition-all disabled:cursor-not-allowed"
                  style={{ opacity: locked ? 0.5 : 1 }}>

                  {/* Left column: circle + dashed connector */}
                  <div className="flex flex-col items-center flex-shrink-0">
                    {/* Circle */}
                    {isIntro ? (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          background: accentColor,
                          border: `2px solid ${accentColor}`,
                        }}>
                        <Star className="w-4 h-4" style={{ color: 'white' }} fill="white" />
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          background: lesPct === 100 ? accentColor : surface,
                          border: `2px solid ${circleColor}`,
                        }}>
                        {locked
                          ? <Lock className="w-3.5 h-3.5" style={{ color: muted }} />
                          : lesPct === 100
                            ? <span className="text-xs font-bold" style={{ color: 'white' }}>✓</span>
                            : <span className="text-xs font-bold" style={{ color: circleColor }}>{taskNum}</span>
                        }
                      </div>
                    )}
                    {/* Dashed connector (between circles, not inside them) */}
                    {!isLast && (
                      <div style={{
                        width: 0,
                        minHeight: 28,
                        flex: 1,
                        borderLeft: `2px dashed ${border}`,
                        marginTop: 4,
                        marginBottom: 4,
                      }} />
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0 pt-1.5" style={{ paddingBottom: isLast ? 8 : 20 }}>
                    <p className="text-sm font-semibold leading-snug truncate"
                      style={{ color: isCurr ? accentColor : text }}>
                      {lesson.title}
                    </p>
                    {lessonDiff && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <DifficultyDots difficulty={lessonDiff} color={isCurr ? accentColor : muted} />
                        <span className="text-[11px] capitalize" style={{ color: muted }}>{lessonDiff}</span>
                        <span className="text-[11px]" style={{ color: muted }}>·</span>
                        <Clock className="w-3 h-3 flex-shrink-0" style={{ color: muted }} />
                        <span className="text-[11px]" style={{ color: muted }}>{estTime}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </nav>
        </>)}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Review mode banner. A preview run reaches review through the completion screen, and
            there is no saved progress behind it to reassure anyone about. */}
        {reviewMode && (
          <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs font-semibold flex-shrink-0"
            style={{ background: `${accentColor}18`, color: accentColor, borderBottom: `1px solid ${accentColor}30` }}>
            <span className="flex items-center gap-2">
              {previewMode && <Eye className="w-3.5 h-3.5 flex-shrink-0" />}
              {previewMode
                ? 'Reviewing the preview. Nothing here was saved.'
                : 'Review Mode. Your progress is saved and will not be changed'}
            </span>
            <button onClick={() => setReviewMode(false)}
              className="underline opacity-70 hover:opacity-100 flex-shrink-0">Exit Review</button>
          </div>
        )}

        {/* Preview banner: staff walking the experience. Everything below renders exactly as a
            student sees it, so the only thing worth saying is what preview changes. */}
        {previewMode && !reviewMode && (
          <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold flex-shrink-0"
            style={{ background: `${accentColor}18`, color: accentColor, borderBottom: `1px solid ${accentColor}30` }}>
            <Eye className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Preview. This is the student view. Nothing is saved, every mission is open, and you can skip any step.</span>
          </div>
        )}

        {/* Lesson content: subtle grey background, single white card */}
        <div ref={mainScrollRef} className="flex-1 overflow-y-auto" style={{ background: isDark ? '#141414' : '#F2F5FA' }}>
          <div className={`${embedUrl && isHtmlEmbedUrl(embedUrl) ? 'max-w-6xl' : 'max-w-4xl'} mx-auto w-full px-2 sm:px-4 pt-4 sm:pt-3 pb-4 sm:pb-6 space-y-4`}>
          {!currentLes && modules.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <BookOpen className="w-10 h-10 mb-3 opacity-20" style={{ color: muted }} />
              <p className="text-sm font-medium" style={{ color: muted }}>No content yet</p>
              <p className="text-xs mt-1 opacity-60" style={{ color: muted }}>This virtual experience has no modules.</p>
            </div>
          )}
          {!currentLes && modules.length > 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <BookOpen className="w-10 h-10 mb-3 opacity-20" style={{ color: muted }} />
              <p className="text-sm font-medium" style={{ color: muted }}>Select a mission from the sidebar</p>
            </div>
          )}
          {currentLes ? (() => {
              // Mission content is read first; "Continue to Tasks" reveals the
              // tasks/deliverables below. Skipped for review and for a lesson
              // that's already fully done, where everything just shows. Preview
              // keeps it: it is part of what a student sees.
              const hasContent = !!(currentLes.doc || currentLes.body);
              const hasReqs = currentLes.requirements.length > 0;
              const gateActive = !reviewMode && hasContent && hasReqs && !allCurrentDone;
              const hasContinued = continuedLessons.has(currentLes.id);
              const showGateButton = gateActive && !hasContinued;
              const isCollapsible = gateActive && hasContinued;
              const isContentExpanded = !isCollapsible || contentExpanded.has(currentLes.id);
              return (
            <>
              {/* Single unified card: title + body + video + questions */}
              <div className="rounded-xl overflow-hidden"
                style={{
                  background: isDark ? '#1e1e1e' : '#ffffff',
                }}>

                {/* Lesson header inside card */}
                <div className="px-4 sm:px-8 pt-5 sm:pt-8 pb-5"
                  style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#F2F5FA'}` }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: accentColor }}>{currentMod?.title}</p>
                  <h1 className="text-xl font-bold leading-snug" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{currentLes.title}</h1>
                </div>

                {/* Lesson body */}
                {/* Video: above body, padded + rounded */}
                {embedUrl && (
                  <div className="px-4 sm:px-8 pt-5 sm:pt-7 pb-2">
                    {isHtmlEmbedUrl(embedUrl) ? (
                      <div className="rounded-lg overflow-hidden">
                        <HtmlEmbedFrame src={embedUrl} />
                      </div>
                    ) : (
                      <div className="rounded-lg overflow-hidden" style={embedUrl.includes('canva.com') ? { height: '80vh' } : { aspectRatio: '16/9' }}>
                        <iframe src={embedUrl} className="w-full h-full border-0"
                          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                          allowFullScreen />
                      </div>
                    )}
                  </div>
                )}

                {/* Lesson body: read first, then "Continue to Tasks" reveals the
                    tasks/deliverables below. Skipped for review/preview and for a
                    lesson that's already fully done, where everything just shows. */}
                {(() => {
                  const isExpanded = isContentExpanded;

                  const lessonBodyContent = currentLes.doc ? (
                    <LessonRenderer key={currentLes.id} doc={currentLes.doc} isDark={isDark} accentColor={accentColor} />
                  ) : (
                    <div
                      className={`prose prose-sm max-w-none [font-size:14.5px] ve-lesson-body ${isDark ? 'dark' : ''} ${isDark
                        ? 'prose-invert prose-p:text-zinc-300 prose-p:leading-[1.6] prose-headings:text-white prose-headings:font-semibold prose-strong:text-white prose-a:text-blue-400 prose-li:text-zinc-300 prose-li:leading-[1.6] prose-hr:border-zinc-800 prose-blockquote:border-l-4 prose-blockquote:border-indigo-500 prose-blockquote:text-zinc-400 prose-blockquote:not-italic prose-code:text-emerald-400 [&_pre]:bg-[#0f1120] [&_pre]:border [&_pre]:border-[#2e2e33] [&_pre]:rounded-lg [&_pre_code]:text-[#c9d1d9] prose-table:w-full prose-thead:border-b prose-thead:border-zinc-700 prose-th:text-zinc-300 prose-th:font-semibold prose-th:py-2 prose-th:px-3 prose-td:text-zinc-400 prose-td:py-2 prose-td:px-3 prose-tr:border-b prose-tr:border-zinc-800'
                        : 'prose-p:text-[#111] prose-p:leading-[1.6] prose-headings:text-[#111] prose-headings:font-semibold prose-strong:text-[#111] prose-li:text-[#111] prose-li:leading-[1.6] prose-a:text-blue-600 prose-hr:border-zinc-200 prose-blockquote:border-l-4 prose-blockquote:border-indigo-400 prose-blockquote:text-zinc-600 prose-blockquote:not-italic prose-code:text-emerald-700 [&_pre]:bg-[#f6f8fa] [&_pre]:border [&_pre]:border-[#d0d7de] [&_pre]:rounded-lg [&_pre_code]:text-[#1f2328] prose-table:w-full prose-thead:border-b prose-thead:border-zinc-200 prose-th:text-zinc-700 prose-th:font-semibold prose-th:py-2 prose-th:px-3 prose-td:text-zinc-600 prose-td:py-2 prose-td:px-3 prose-tr:border-b prose-tr:border-zinc-100'
                      }`}
                      dangerouslySetInnerHTML={{ __html: sanitizeRichText(currentLes.body) }}
                    />
                  );

                  return (<>
                    {hasContent && (
                      isCollapsible ? (
                        <div style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#F2F5FA'}` }}>
                          <button onClick={() => toggleContentExpanded(currentLes.id)}
                            className="w-full flex items-center gap-2 px-4 sm:px-8 py-3 text-left hover:opacity-70 transition-opacity">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" style={{ color: muted }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: muted }} />}
                            <span className="text-[12.5px] font-semibold" style={{ color: muted }}>
                              Mission content{!isExpanded ? ' (click to reread)' : ''}
                            </span>
                          </button>
                          {isExpanded && <div className="px-4 sm:px-8 pb-6">{lessonBodyContent}</div>}
                        </div>
                      ) : (
                        <div className="px-4 sm:px-8 pt-5 sm:pt-6 pb-6">{lessonBodyContent}</div>
                      )
                    )}

                    {showGateButton && (
                      <div className="px-4 sm:px-8 pb-8 flex justify-center"
                        style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#F2F5FA'}` }}>
                        <button onClick={() => continueToTasks(currentLes.id)}
                          className="flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-[14px] transition-all hover:opacity-90"
                          style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>
                          Continue to Tasks <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </>);
                })()}

                {/* Questions section */}
                {currentLes.requirements.length > 0 && !showGateButton && (
                  <>
                    {/* Divider + label */}
                    {(() => {
                      const reqs = currentLes.requirements;
                      const allTask = reqs.every(r => r.type === 'task');
                      const allMcq  = reqs.every(r => r.type === 'mcq');
                      const sectionLabel = allTask ? 'Tasks' : allMcq ? 'Questions' : 'Tasks & Questions';
                      const doneCount = reqs.filter(r => progress[r.id]?.completed).length;
                      return (
                        <div className="px-4 sm:px-8 pt-4 pb-3 space-y-2"
                          style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: isDark ? '#666' : '#999' }}>{sectionLabel}</span>
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                              style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', color: isDark ? '#777' : '#777' }}>
                              {doneCount} / {reqs.length} done
                            </span>
                          </div>
                          {!allCurrentDone && !reviewMode && (
                            <p className="text-[12.5px] font-semibold" style={{ color: accentColor }}>
                              {doneCount === 0
                                ? `Complete all ${reqs.length} ${sectionLabel.toLowerCase()} below to unlock the next step`
                                : `${reqs.length - doneCount} remaining. Mark them as done to continue.`}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {currentLes.requirements.map((req, qi) => {
                      const done           = !!progress[req.id]?.completed;
                      const selectedAnswer = progress[req.id]?.selectedAnswer;
                      const isMcq          = req.type === 'mcq' && req.options?.length;

                      // Messages arrive sequentially: a requirement only appears once
                      // everything before it is settled -- done (or owing nothing, as an
                      // optional unclaimed share does) AND the manager has finished
                      // replying. Review shows the whole conversation at once; preview
                      // sequences like a student and offers a skip instead.
                      if (!reviewMode && qi > 0 && !currentLes.requirements.slice(0, qi).every(reqSettled)) return null;

                      const workplaceSurface = req.emailFrame || ['briefing', 'scenario_update', 'decision', 'debrief'].includes(req.type);
                      const classicActionSurface = ['task', 'deliverable', 'linkedin_share'].includes(req.type);
                      const rowStyle: React.CSSProperties = workplaceSurface ? {
                        background: 'transparent',
                      } : classicActionSurface ? {
                        borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                        borderLeft: done ? `3px solid ${accentColor}` : `3px solid ${accentColor}30`,
                        background: done ? (isDark ? `${accentColor}08` : `${accentColor}05`) : 'transparent',
                        transition: 'background 0.2s, border-left-color 0.2s',
                      } : {
                        margin: '10px clamp(12px, 3vw, 24px) 16px',
                        borderRadius: 16,
                        background: done
                          ? (isDark ? `${accentColor}0d` : `${accentColor}08`)
                          : (isDark ? 'rgba(255,255,255,0.035)' : '#f7f8f7'),
                        boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.055)' : '0 0 0 1px rgba(15,23,42,0.055)',
                        overflow: 'hidden',
                        transition: 'background 0.2s, box-shadow 0.2s',
                      };

                      if (req.type === 'briefing' || req.type === 'scenario_update') {
                        const isUpdate = req.type === 'scenario_update';
                        const subject = req.label || (isUpdate ? 'Project update' : `${currentLes?.title || 'Mission'} brief`);
                        const stamp = workStamp(flatIdx, qi, req.id);
                        const acknowledge = (text?: string) => {
                          if (reviewMode || done) return;
                          setProgress(prev => {
                            const next = { ...prev, [req.id]: { ...prev[req.id], completed: true, ...(text ? { notes: text } : {}) } };
                            saveProgress(next, currentModId, currentLesId);
                            return next;
                          });
                          setTypingAcks(prev => new Set([...prev, req.id]));
                          if (isUpdate) startTypingSound(2200);
                          anchorZone(req.id);
                          setTimeout(() => {
                            setTypingAcks(prev => { const n = new Set(prev); n.delete(req.id); return n; });
                            anchorZone(req.id);
                          }, 2500);
                        };

                        if (isUpdate) {
                          return (
                            <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5">
                              <ChatCard isDark={isDark} reqId={req.id} company={config.company} channel={teamChannel}
                                members={[manager]} unread={!done} muteArrival={reviewMode}>
                                <ChatMsg isDark={isDark} author={manager} time={stamp.time}
                                  reactions={
                                    !done && !reviewMode ? (
                                      <ChatReaction isDark={isDark} accent={accentColor} emoji={'👍'} onClick={() => acknowledge()} />
                                    ) : done ? (
                                      <ChatReaction isDark={isDark} accent={accentColor} emoji={'👍'} count={1} active disabled />
                                    ) : null
                                  }>
                                  <p style={{ margin: 0 }}>{subject}</p>
                                  {req.description && <p style={{ margin: '4px 0 0', opacity: 0.75 }}>{req.description}</p>}
                                </ChatMsg>
                                {done && (
                                  <ChatThread isDark={isDark} label="1 reply in thread">
                                    {typingAcks.has(req.id)
                                      ? <ChatTypingMsg isDark={isDark} author="me" meName={studentName} />
                                      : (
                                        <ChatMsg isDark={isDark} author="me" meName={studentName} time="Just now">
                                          {'Got it, on it. 👍'}
                                        </ChatMsg>
                                      )}
                                  </ChatThread>
                                )}
                              </ChatCard>
                            </div>
                          );
                        }

                        // Email brief: full mail-client reader with smart replies
                        const briefAttachments: MailAttachment[] = [
                          ...(req.attachments || []).map(a => ({ name: a.name, url: a.url })),
                          ...(config.dataset ? [{ name: config.dataset.filename || 'dataset.csv', onClick: downloadDataset }] : []),
                        ];
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5">
                            <MailCard isDark={isDark} accent={accentColor} reqId={req.id} subject={subject}
                              sender={manager} toName={studentName} toEmail={meEmail} stamp={stamp}
                              bodyHtml={req.description ? sanitizeEmailContent(applyNameTags(req.description, studentName)) : undefined}
                              attachments={briefAttachments} company={config.company}
                              done={done} muteArrival={reviewMode}
                              chatAction={!reviewMode ? {
                                label: `Chat with ${firstNameOf(manager.name)}`,
                                onClick: () => { setAskOpen(new Set([req.id])); setAskSeen(prev => new Set([...prev, req.id])); },
                                attention: !askSeen.has(req.id),
                              } : undefined}>
                              <div style={{ padding: '14px 22px 18px' }}>
                                {(config.tools || []).length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                                    {(config.tools || []).slice(0, 3).map(tool => <Chip key={tool} isDark={isDark}>{tool}</Chip>)}
                                  </div>
                                )}
                                {!done && !reviewMode ? (
                                  <SmartReplies isDark={isDark} accent={accentColor}
                                    options={['Got it, starting now', 'On it, will update you soon', 'Received, thank you']}
                                    onPick={text => acknowledge(text)} />
                                ) : done ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    <MailThreadMsg isDark={isDark} from="me" meName={studentName}
                                      time={typingAcks.has(req.id) ? 'Sending...' : 'Just now'}
                                      receipt={typingAcks.has(req.id) ? undefined : `Seen by ${firstNameOf(manager.name)} just now`}
                                      quote={req.description ? `On ${stamp.full}, ${manager.name} wrote: ${quoteSnippet(applyNameTags(req.description, studentName))}` : undefined}>
                                      {progress[req.id]?.notes || 'Got it, starting now'}
                                    </MailThreadMsg>
                                    <div><MailStatusChip accent={accentColor}>Brief acknowledged</MailStatusChip></div>
                                  </div>
                                ) : null}
                                {!reviewMode && (
                                  <BriefAskThread isDark={!!isDark} accent={accentColor} manager={manager} studentName={studentName}
                                    veId={formId} reqId={req.id}
                                    open={askOpen.has(req.id)}
                                    onOpenChange={o => setAskOpen(o ? new Set([req.id]) : new Set())} />
                                )}
                              </div>
                            </MailCard>
                          </div>
                        );
                      }

                      if (req.type === 'decision') {
                        const options = (req.options || []).filter(Boolean);
                        const selectedIdx = selectedAnswer ? (req.options || []).findIndex(opt => opt === selectedAnswer) : -1;
                        const selectedFeedback = selectedIdx >= 0 ? req.optionFeedback?.[selectedIdx] : '';
                        const stamp = workStamp(flatIdx, qi, req.id);
                        const colleague: Person = { name: colleaguesFor(config.company || teamChannel, 1)[0], color: '#E8912D' };
                        const colleagueLine = ['Good call.', '+1, agreed.', 'Nice - that unblocks us.', 'Makes sense to me.'][hashStr(req.id) % 4];
                        const chooseDecision = (opt: string) => {
                          if (reviewMode || done) return;
                          setProgress(prev => {
                            const next = { ...prev, [req.id]: { ...prev[req.id], selectedAnswer: opt, completed: true } };
                            saveProgress(next, currentModId, currentLesId);
                            return next;
                          });
                          setTypingDecisions(prev => new Set([...prev, req.id]));
                          startTypingSound(2800);
                          anchorZone(req.id);
                          setTimeout(() => {
                            setTypingDecisions(prev => { const n = new Set(prev); n.delete(req.id); return n; });
                            anchorZone(req.id);
                          }, 3000);
                        };
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5">
                            <ChatCard isDark={isDark} reqId={req.id} company={config.company} channel={teamChannel}
                              members={[manager]} unread={!done} muteArrival={reviewMode}>
                              <ChatMsg isDark={isDark} author={manager} time={stamp.time}>
                                <p style={{ margin: 0 }}>{req.label}</p>
                                {req.description && <p style={{ margin: '4px 0 0', opacity: 0.75 }}>{req.description}</p>}
                                {!done && (
                                  <ChatDecisionButtons isDark={isDark} accent={accentColor} options={options}
                                    onPick={chooseDecision} disabled={reviewMode} />
                                )}
                              </ChatMsg>
                              {done && selectedAnswer && (
                                <ChatThread isDark={isDark}
                                  label={typingDecisions.has(req.id) ? '1 reply in thread' : '3 replies in thread'}>
                                  <ChatMsg isDark={isDark} author="me" meName={studentName} time="Just now">
                                    {selectedAnswer}
                                  </ChatMsg>
                                  {typingDecisions.has(req.id) ? (
                                    <ChatTypingMsg isDark={isDark} author={manager} />
                                  ) : (
                                    <>
                                      <ChatMsg isDark={isDark} author={manager} time="Just now">
                                        {selectedFeedback || `Noted, ${firstNameOf(studentName)}. Keep moving forward.`}
                                      </ChatMsg>
                                      <ChatMsg isDark={isDark} author={colleague} time="Just now">
                                        {colleagueLine}
                                      </ChatMsg>
                                    </>
                                  )}
                                </ChatThread>
                              )}
                            </ChatCard>
                          </div>
                        );
                      }

                      if (req.type === 'debrief') {
                        const noteVal = noteValues[req.id] ?? (progress[req.id]?.notes || '');
                        const debriefSubject = req.label || `Re: ${currentLes?.title || 'Mission'}`;
                        const hasContent = noteVal.replace(/<[^>]*>/g, '').trim().length > 0;
                        const replyOpen = done || openReplies.has(req.id) || hasContent;
                        const stamp = workStamp(flatIdx, qi, req.id);
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5">
                            <MailCard isDark={isDark} accent={accentColor} reqId={req.id} subject={debriefSubject}
                              sender={manager} toName={studentName} toEmail={meEmail} stamp={stamp}
                              bodyHtml={req.description ? sanitizeEmailContent(applyNameTags(req.description, studentName)) : undefined}
                              company={config.company} done={done} muteArrival={reviewMode}>
                              {!done ? (
                                !replyOpen ? (
                                  <div style={{ padding: '14px 22px' }}>
                                    {!reviewMode && (
                                      <button
                                        onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 18, border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: isDark ? '#ddd' : '#444', cursor: 'pointer' }}>
                                        <Reply className="w-4 h-4" /> Reply
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div style={{ padding: '14px 22px 18px' }}>
                                    <MailComposer isDark={isDark} accent={accentColor} to={manager} subject={debriefSubject}
                                      value={noteVal} onChange={(html) => setNote(req.id, html)} canSend={hasContent}
                                      onSend={() => {
                                        if (!hasContent) return;
                                        setProgress(prev => {
                                          const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true } };
                                          saveProgress(next, currentModId, currentLesId);
                                          return next;
                                        });
                                        anchorZone(req.id);
                                      }}
                                      onDiscard={() => { setNote(req.id, ''); setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; }); }} />
                                  </div>
                                )
                              ) : (
                                <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                                  <MailThreadMsg isDark={isDark} from="me" meName={studentName}
                                    receipt={`Seen by ${firstNameOf(manager.name)} just now`}
                                    quote={req.description ? `On ${stamp.full}, ${manager.name} wrote: ${quoteSnippet(applyNameTags(req.description, studentName))}` : undefined}>
                                    <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(noteVal) }} />
                                  </MailThreadMsg>
                                  <div><MailStatusChip accent={accentColor}>Reply sent to {manager.name}</MailStatusChip></div>
                                </div>
                              )}
                            </MailCard>
                          </div>
                        );
                      }

                      // Email frame wrapper for assessment types
                      if (req.emailFrame) {
                        const efManager = manager.name;
                        const efSubject = req.label || 'Task Assignment';
                        const efStamp = workStamp(flatIdx, qi, req.id);
                        const efAttachments: MailAttachment[] = (req.attachments || []).map(a => ({ name: a.name, url: a.url }));
                        const efCard = (children: React.ReactNode) => (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5">
                            <MailCard isDark={isDark} accent={accentColor} reqId={req.id} subject={efSubject}
                              sender={manager} toName={studentName} toEmail={meEmail} stamp={efStamp}
                              bodyHtml={(req.emailBody || req.description) ? sanitizeEmailContent(applyNameTags(req.emailBody || req.description || '', studentName)) : undefined}
                              attachments={efAttachments.length ? efAttachments : undefined}
                              company={config.company} done={done} muteArrival={reviewMode} signatureAfterChildren>
                              {children}
                            </MailCard>
                          </div>
                        );

                        // MCQ: options as reply choices
                        if (isMcq) {
                          const isWrong = !!selectedAnswer && selectedAnswer !== req.correctAnswer;
                          return efCard(
                            !done ? (
                              <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: isDark ? '#6b7075' : '#9aa0a6', margin: '0 0 4px' }}>Reply with your answer</p>
                                {(req.options || []).map((opt, oi) => {
                                  const letter = oi + 1;
                                  const isSelected = selectedAnswer === opt;
                                  const isThisWrong = isSelected && isWrong;
                                  const bgCol = isThisWrong ? 'rgba(239,68,68,0.06)' : isSelected ? `${accentColor}08` : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)');
                                  return (
                                    <button key={oi}
                                      onClick={() => {
                                        if (done) return;
                                        const correct = opt === req.correctAnswer;
                                        setProgress(prev => {
                                          const next = { ...prev, [req.id]: { ...prev[req.id], selectedAnswer: opt, completed: correct } };
                                          if (correct) saveProgress(next, currentModId, currentLesId);
                                          return next;
                                        });
                                        anchorZone(req.id);
                                      }}
                                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, border: `1px solid ${isThisWrong ? 'rgba(239,68,68,0.4)' : isSelected ? `${accentColor}55` : 'transparent'}`, background: bgCol, textAlign: 'left', cursor: 'pointer', fontSize: 14, color: isDark ? '#e0e0e0' : '#1f1f1f', transition: 'all 0.15s', width: '100%' }}>
                                      <span style={{ flex: 1 }}>{opt}</span>
                                      <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: isThisWrong ? '#ef4444' : isSelected ? accentColor : (isDark ? '#888' : '#999') }}>{letter}</span>
                                    </button>
                                  );
                                })}
                                {isWrong && (
                                  <p style={{ fontSize: 12.5, color: '#ef4444', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <X className="w-3.5 h-3.5" /> That is not the right answer. Try again.
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <MailThreadMsg isDark={isDark} from="me" meName={studentName}
                                  receipt={`Seen by ${firstNameOf(manager.name)} just now`}>
                                  {selectedAnswer}
                                </MailThreadMsg>
                                <div><MailStatusChip accent={accentColor}>Correct</MailStatusChip></div>
                              </div>
                            )
                          );
                        }

                        // Text / Reflection: reply-composer thread with optional AI evaluation
                        if (req.type === 'text' || req.type === 'reflection') {
                          const noteVal = noteValues[req.id] ?? (progress[req.id]?.notes || '');
                          const hasContent = noteVal.replace(/<[^>]*>/g, '').trim().length > 0;
                          const rounds = efRounds[req.id] || [];
                          const replyOpen = done || openReplies.has(req.id) || hasContent || rounds.length > 0;
                          const needsEval = !!(req.aiReview || req.expectedAnswer);
                          // Evaluation always completes the requirement (pass or fail is never a
                          // gate), so `done` alone can't tell us whether to show the verdict or a
                          // fresh composer. This flag lets a student who clicked "Reply" after
                          // seeing feedback bypass the permanently-true `done` state.
                          const wantsNewReply = needsEval && openReplies.has(req.id);
                          const isTyping = efTyping[req.id];
                          const isReviewing = efReviewing[req.id];
                          // AI verdict is persisted (aiPassed/aiFeedback/aiScore) so a reload can
                          // rebuild the feedback block and its Reply button - without this, a
                          // refreshed page only knows "completed", not what the manager said.
                          const persistedFeedback = progress[req.id]?.aiErrored
                            ? { passed: false, feedback: progress[req.id]?.aiFeedback || 'We could not complete an AI review of your response. Please try again.', score: 0, errored: true }
                            : progress[req.id]?.aiFeedback
                            ? { passed: !!progress[req.id]?.aiPassed, feedback: progress[req.id]!.aiFeedback!, score: progress[req.id]?.aiScore ?? 0 }
                            : null;
                          const feedback = aiFeedback[req.id] !== undefined ? aiFeedback[req.id] : persistedFeedback;
                          const fbErrored = !!feedback?.errored;
                          // Neutral tone for a review that never ran; green/amber only for a real verdict.
                          const fbTone = !feedback ? null : fbErrored
                            ? { bg: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.12)', border: isDark ? 'rgba(148,163,184,0.30)' : 'rgba(148,163,184,0.40)', color: isDark ? '#cbd5e1' : '#64748b', label: 'Review unavailable' }
                            : feedback.passed
                            ? { bg: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.25)', color: '#10b981', label: 'Correct' }
                            : { bg: isDark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.25)', color: '#f59e0b', label: 'Incorrect' };
                          const evaluating = !!aiReviewing[req.id];
                          // What the thread shows as "sent": the in-flight attempt first, then saved notes
                          const sentText = efPending[req.id] || progress[req.id]?.notes || noteValues[req.id] || '';
                          const efMeReply = (
                            <div style={{ marginBottom: 18 }}>
                              <MailThreadMsg isDark={isDark} from="me" meName={studentName}>
                                <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(sentText) }} />
                              </MailThreadMsg>
                            </div>
                          );
                          const handleSend = () => {
                            if (!hasContent) return;
                            if (!needsEval) {
                              setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true } }; saveProgress(next, currentModId, currentLesId); return next; });
                              anchorZone(req.id);
                              return;
                            }
                            const delay = 2000 + Math.floor(Math.random() * 2001);
                            setEfTyping(prev => ({ ...prev, [req.id]: true }));
                            setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; });
                            anchorZone(req.id);
                            if (req.aiReview) {
                              // AI evaluation path: always marks done (informational feedback)
                              // Save note immediately so the thread shows the sent text during the delay
                              setProgress(prev => ({ ...prev, [req.id]: { ...prev[req.id], notes: noteVal } }));
                              setAiReviewing(prev => ({ ...prev, [req.id]: true }));
                              setAiFeedback(prev => ({ ...prev, [req.id]: null }));
                              fetch('/api/ve-answer-review', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...authHeader },
                                body: JSON.stringify({ veId: formId, reqId: req.id, studentAnswer: noteVal }),
                              })
                              .then(async r => ({ ok: r.ok, json: await r.json().catch(() => ({})) }))
                              .then(({ ok, json }) => {
                                if (ok) {
                                  // A real verdict from the model - record it (pass or fail) and clear
                                  // any prior error marker.
                                  const passed = json.passed ?? false;
                                  const fb = json.feedback || '';
                                  const score = json.score ?? 0;
                                  setAiFeedback(prev => ({ ...prev, [req.id]: { passed, feedback: fb, score } }));
                                  setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: undefined, aiPassed: passed, aiFeedback: fb, aiScore: score } }; saveProgress(next, currentModId, currentLesId); return next; });
                                } else {
                                  // The answer was never actually evaluated (validation / rate limit /
                                  // server error). Record a distinct error state - never a pass/fail grade.
                                  // Progression is intentionally NOT blocked (completed stays true); the
                                  // persisted error marker lets a reload rebuild "could not review" + Try again.
                                  const fb = json.error || 'We could not complete an AI review of your response right now. Please edit your answer if needed and try again.';
                                  setAiFeedback(prev => ({ ...prev, [req.id]: { passed: false, feedback: fb, score: 0, errored: true } }));
                                  setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: true, aiPassed: undefined, aiFeedback: fb, aiScore: undefined } }; saveProgress(next, currentModId, currentLesId); return next; });
                                }
                              })
                              .catch(() => {
                                // Network/parse failure - same distinct error state; progression stays open.
                                const fb = 'We could not complete an AI review of your response right now due to a temporary issue. Please try again.';
                                setAiFeedback(prev => ({ ...prev, [req.id]: { passed: false, feedback: fb, score: 0, errored: true } }));
                                setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: true, aiPassed: undefined, aiFeedback: fb, aiScore: undefined } }; saveProgress(next, currentModId, currentLesId); return next; });
                              })
                              .finally(() => setAiReviewing(prev => ({ ...prev, [req.id]: false })));
                              setTimeout(() => {
                                setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                setEfReviewing(prev => ({ ...prev, [req.id]: true }));
                                anchorZone(req.id);
                              }, delay);
                            } else {
                              // Manual comparison: compare against expectedAnswer locally, no answer revealed.
                              // A wrong attempt stays in the thread as a sent reply + manager response,
                              // and a fresh empty composer opens below - never edit the old message.
                              const attempt = noteVal;
                              const normalize = (s: string) => s.replace(/<[^>]*>/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
                              const studentNorm = normalize(attempt);
                              const expectedNorm = normalize(req.expectedAnswer || '');
                              const passed = studentNorm === expectedNorm || studentNorm.includes(expectedNorm) || expectedNorm.includes(studentNorm);
                              setEfPending(prev => ({ ...prev, [req.id]: attempt }));
                              setNote(req.id, '');
                              setTimeout(() => {
                                setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                setEfPending(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                if (passed) {
                                  setEfReviewing(prev => ({ ...prev, [req.id]: true }));
                                  setAiFeedback(prev => ({ ...prev, [req.id]: { passed: true, score: 100, feedback: `That is correct, ${firstNameOf(studentName)}. Well done.` } }));
                                  setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], notes: attempt, completed: true } }; saveProgress(next, currentModId, currentLesId); return next; });
                                } else {
                                  setEfRounds(prev => ({ ...prev, [req.id]: [...(prev[req.id] || []), { me: attempt, feedback: `That is not quite right, ${firstNameOf(studentName)}. Take another look at the question and send me a new reply.`, passed: false }] }));
                                }
                                anchorZone(req.id);
                              }, delay);
                            }
                          };
                          const efHistory = rounds.length > 0 ? (
                            <div style={{ padding: '16px 22px 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
                              {rounds.map((r, ri) => (
                                <div key={ri} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                                  <MailThreadMsg isDark={isDark} from="me" meName={studentName} time="Earlier">
                                    <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(r.me) }} />
                                  </MailThreadMsg>
                                  <MailThreadMsg isDark={isDark} from={manager} time="Earlier">
                                    <div style={{ borderRadius: 10, padding: '12px 16px', background: r.passed ? (isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)') : (isDark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)'), border: `1px solid ${r.passed ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}` }}>
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: r.passed ? '#10b981' : '#f59e0b', marginBottom: 8 }}>
                                        {r.passed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                                        {r.passed ? 'Correct' : 'Incorrect'}
                                      </div>
                                      <p style={{ fontSize: 13.5, color: isDark ? '#ddd' : '#333', margin: 0, lineHeight: 1.6 }}>{r.feedback}</p>
                                    </div>
                                  </MailThreadMsg>
                                </div>
                              ))}
                            </div>
                          ) : null;
                          return efCard(
                            <>
                            {efHistory}
                            {isTyping ? (
                              <div style={{ padding: '16px 22px 20px' }}>
                                {efMeReply}
                                <MailTypingRow isDark={isDark} person={manager} />
                              </div>
                            ) : (isReviewing || (done && needsEval && !wantsNewReply)) ? (
                              <div style={{ padding: '16px 22px 20px' }}>
                                {efMeReply}
                                {/* Manager: received */}
                                <div style={{ marginBottom: feedback ? 18 : 0 }}>
                                  <MailThreadMsg isDark={isDark} from={manager}>
                                    <p style={{ margin: '0 0 10px' }}>Thanks for your response, {firstNameOf(studentName)}. Let me review what you have written.</p>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: evaluating ? (isDark ? '#2a2a2a' : '#f0f0f0') : `${accentColor}12`, color: evaluating ? (isDark ? '#888' : '#666') : accentColor, border: `1px solid ${evaluating ? 'transparent' : accentColor + '30'}`, fontSize: 12.5 }}>
                                      {evaluating ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ display: 'inline' }} /> : fbErrored ? <AlertTriangle className="w-3.5 h-3.5" style={{ display: 'inline' }} /> : <CheckCircle2 className="w-3.5 h-3.5" style={{ display: 'inline' }} />}
                                      {evaluating ? 'Reviewing your answer...' : fbErrored ? 'Could not review' : 'Reviewed'}
                                    </div>
                                  </MailThreadMsg>
                                </div>
                                {/* Manager: feedback reply */}
                                {feedback && fbTone && (
                                  <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`, paddingTop: 18 }}>
                                    <MailThreadMsg isDark={isDark} from={manager}>
                                      <p style={{ margin: '0 0 12px' }}>{fbErrored ? 'I could not review your response just now:' : 'Hi, here is my feedback on your response:'}</p>
                                      <div style={{ borderRadius: 10, padding: '12px 16px', background: fbTone.bg, border: `1px solid ${fbTone.border}` }}>
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: fbTone.color, marginBottom: 8 }}>
                                          {fbErrored ? <AlertTriangle className="w-4 h-4" /> : feedback.passed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                                          {fbTone.label}
                                        </div>
                                        <p style={{ fontSize: 13.5, color: isDark ? '#ddd' : '#333', margin: 0, lineHeight: 1.6 }}>{feedback.feedback}</p>
                                      </div>
                                    </MailThreadMsg>
                                    {/* A wrong answer or a failed review both get a way back to the composer;
                                        only a real pass moves the mission on. */}
                                    {!evaluating && !reviewMode && !feedback.passed && (
                                      <button
                                        onClick={() => {
                                          // A real wrong answer is archived into the thread as a graded round
                                          // and its text cleared; an errored (never-reviewed) attempt is neither,
                                          // so the student keeps their draft to fix and resend.
                                          if (!fbErrored) {
                                            setEfRounds(prev => ({ ...prev, [req.id]: [...(prev[req.id] || []), { me: sentText, feedback: feedback.feedback, passed: feedback.passed }] }));
                                            setNoteValues(prev => ({ ...prev, [req.id]: '' }));
                                          }
                                          setAiFeedback(prev => ({ ...prev, [req.id]: null }));
                                          // Reset the "received/reviewing" state too - otherwise the render
                                          // stays locked on the Reviewed chip and the composer never opens.
                                          setEfReviewing(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                          setEfPending(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                          setOpenReplies(prev => new Set([...prev, req.id]));
                                        }}
                                        style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 18, border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: isDark ? '#ddd' : '#444', cursor: 'pointer' }}>
                                        <Reply className="w-4 h-4" /> {fbErrored ? 'Try again' : 'Reply'}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (done && !wantsNewReply) ? (
                              // Simple done (no evaluation)
                              <div style={{ padding: '16px 22px 20px' }}>
                                {efMeReply}
                                <MailStatusChip accent={accentColor}>Reply sent to {efManager}</MailStatusChip>
                              </div>
                            ) : !replyOpen ? (
                              <div style={{ padding: '14px 22px' }}>
                                {!reviewMode && (
                                  <button onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 18, border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: isDark ? '#ddd' : '#444', cursor: 'pointer' }}>
                                    <Reply className="w-4 h-4" /> Reply
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div style={{ padding: '14px 22px 18px' }}>
                                <MailComposer isDark={isDark} accent={accentColor} to={manager} subject={efSubject}
                                  value={noteVal} onChange={(html) => setNote(req.id, html)} canSend={hasContent} onSend={handleSend}
                                  placeholder={rounds.length ? 'Write a new reply...' : 'Write your reply...'}
                                  maxChars={req.aiReview ? 2000 : undefined}
                                  onDiscard={() => { setNote(req.id, ''); setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; }); }} />
                              </div>
                            )}
                            </>
                          );
                        }

                        // Upload / Task / Deliverable: Reply attachment thread
                        if (req.type === 'upload' || req.type === 'task' || req.type === 'deliverable') {
                          const fileUrl = progress[req.id]?.fileUrl || '';
                          const linkUrl = progress[req.id]?.linkUrl || '';
                          const uploaded = !!(fileUrl || linkUrl);
                          const replyOpen = openReplies.has(req.id) || uploaded;
                          const uploading = uploadingReq === req.id;
                          const isTyping = efTyping[req.id];
                          const showReply = !isTyping && (efReviewing[req.id] || done);
                          const isTask = req.type === 'task';
                          const isDeliverable = req.type === 'deliverable';
                          const efManagerReply = isTask
                            ? `Got it, ${firstNameOf(studentName)} - noted. I have recorded that you have completed this task.`
                            : isDeliverable
                            ? `Thanks, ${firstNameOf(studentName)}. I will review your deliverable and get back to you shortly.`
                            : `Thanks for the submission, ${firstNameOf(studentName)}. It is under review - I will get back to you shortly.`;
                          const efMeThread = (
                            <div style={{ marginBottom: 18 }}>
                              <MailThreadMsg isDark={isDark} from="me" meName={studentName}
                                receipt={showReply ? `Seen by ${firstNameOf(manager.name)} just now` : undefined}>
                                {isTask
                                  ? <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', border: `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'}`, fontSize: 12.5, color: isDark ? '#ddd' : '#334155' }}><CheckCircle2 className="w-3 h-3" /> Task marked as done</div>
                                  : (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                      {fileUrl && (
                                        <AttachmentCard isDark={isDark} href={fileUrl}
                                          name={(() => { try { return decodeURIComponent(fileUrl.split('/').pop()?.split('?')[0] || ''); } catch { return ''; } })() || (isDeliverable ? 'Deliverable' : 'Attachment')} />
                                      )}
                                      {linkUrl && <a href={linkUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: isDark ? 'rgba(255,255,255,0.06)' : '#f1f5f9', border: `1px solid ${isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)'}`, fontSize: 12.5, color: isDark ? '#ddd' : '#334155', textDecoration: 'none' }}><LinkIcon className="w-3 h-3" /> {linkUrl.slice(0, 40)}{linkUrl.length > 40 ? '...' : ''}</a>}
                                    </div>
                                  )
                                }
                              </MailThreadMsg>
                            </div>
                          );
                          const handleEfSend = () => {
                            setEfTyping(prev => ({ ...prev, [req.id]: true }));
                            anchorZone(req.id);
                            const delay = 2000 + Math.floor(Math.random() * 2001);
                            setTimeout(() => {
                              setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                              setEfReviewing(prev => ({ ...prev, [req.id]: true }));
                              if (!reviewMode) setProgress(prev => { const next = { ...prev, [req.id]: { ...prev[req.id], completed: true } }; saveProgress(next, currentModId, currentLesId); return next; });
                              anchorZone(req.id);
                            }, delay);
                          };
                          return efCard(
                            !done && !isTyping && !efReviewing[req.id] ? (
                              // Task: single "I am done" button -- no attachment needed
                              isTask ? (
                                <div style={{ padding: '14px 22px' }}>
                                  {!reviewMode && (
                                    <button onClick={handleEfSend}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 20px', borderRadius: 6, border: `1px solid ${accentColor}`, background: `${accentColor}12`, fontSize: 13.5, fontWeight: 600, color: accentColor, cursor: 'pointer' }}>
                                      <CheckCircle2 className="w-4 h-4" /> I am done with this task
                                    </button>
                                  )}
                                </div>
                              ) : !replyOpen ? (
                                // Upload / Deliverable: show open-compose button
                                <div style={{ padding: '14px 22px' }}>
                                  {!reviewMode && (
                                    <button onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 6, border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: isDark ? '#ddd' : '#444', cursor: 'pointer' }}>
                                      <Paperclip className="w-4 h-4" /> {isDeliverable ? 'Submit deliverable' : 'Attach your work'}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                // Compose: attach file / paste link
                                <div style={{ padding: '14px 22px 18px' }}>
                                  <div style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 10, overflow: 'hidden' }}>
                                    <div style={{ padding: '8px 14px', background: isDark ? '#222' : '#f8f8f8', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`, fontSize: 12, color: isDark ? '#888' : '#999' }}>
                                      {isDeliverable ? 'Attach your deliverable' : 'Attach your file'}
                                    </div>
                                    <div style={{ padding: '14px 16px', background: isDark ? '#1a1a1a' : '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10, border: `1.5px dashed ${fileUrl ? `${accentColor}80` : fieldBorder}`, background: fileUrl ? `${accentColor}08` : fieldBg, boxShadow: fieldShadow, cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 13, color: fileUrl ? accentColor : isDark ? '#c3c3c3' : '#475569' }}>
                                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                                        {uploading ? 'Uploading...' : (fileUrl ? 'Replace file' : 'Attach file')}
                                        <input type="file" accept={VE_SUBMISSION_ACCEPT} className="hidden" disabled={uploading} onChange={async e => {
                                          const file = e.target.files?.[0]; if (!file) return;
                                          await handleFileUpload(req.id, file, true);
                                          e.target.value = '';
                                        }} />
                                      </label>
                                      {uploadErrors[req.id] && <p role="alert" style={{ margin: '8px 0 0', color: '#ef4444', fontSize: 12 }}>{uploadErrors[req.id]}</p>}
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <input value={linkUrl} onChange={e => setProgress(prev => ({ ...prev, [req.id]: { ...prev[req.id], linkUrl: e.target.value } }))}
                                          placeholder="Or paste a link..." style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${fieldBorder}`, background: fieldBg, boxShadow: fieldShadow, color: isDark ? '#ddd' : '#333', fontSize: 13, outline: 'none' }} />
                                      </div>
                                      {(fileUrl || linkUrl) && (
                                        <button onClick={handleEfSend}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 20px', borderRadius: 6, background: accentColor, color: '#fff', fontSize: 13.5, fontWeight: 600, border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}>
                                          <Send className="w-3.5 h-3.5" /> {isDeliverable ? 'Submit deliverable' : 'Submit'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            ) : isTyping ? (
                              <div style={{ padding: '16px 22px 20px' }}>
                                {efMeThread}
                                <MailTypingRow isDark={isDark} person={manager} />
                              </div>
                            ) : showReply ? (
                              <div style={{ padding: '16px 22px 20px' }}>
                                {efMeThread}
                                <MailThreadMsg isDark={isDark} from={manager}>
                                  <p style={{ margin: '0 0 10px' }}>{efManagerReply}</p>
                                  <MailStatusChip accent={accentColor}>{isTask ? 'Noted' : 'Received'}</MailStatusChip>
                                </MailThreadMsg>
                              </div>
                            ) : null
                          );
                        }

                        // AI review types: full email thread -- compose reviewing manager report
                        if (req.type === 'dashboard_critique' || req.type === 'code_review' || req.type === 'excel_review' || req.type === 'document_review') {
                          const saved = progress[req.id];
                          const savedReport = parseReviewNotes(saved?.notes)?.report;
                          const reviewing = efReviewing[req.id] && !done;
                          const typeLabel = req.type === 'dashboard_critique' ? 'dashboard' : req.type === 'code_review' ? 'code' : req.type === 'excel_review' ? 'Excel file' : 'document';
                          const markDone = (notes: string, completed: boolean) => setProgress(prev => { const next = { ...prev, [req.id]: { completed, notes } }; saveProgress(next, currentModId, currentLesId); return next; });
                          const startReview = () => {
                            setEfTyping(prev => ({ ...prev, [req.id]: true }));
                            anchorZone(req.id);
                            const delay = 2000 + Math.floor(Math.random() * 2001);
                            setTimeout(() => {
                              setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                              setEfReviewing(prev => ({ ...prev, [req.id]: true }));
                              anchorZone(req.id);
                            }, delay);
                          };
                          const finishReview = () => {};
                          const onReviewError = () => {
                            setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                            setEfReviewing(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                          };
                          return efCard(
                            <>
                              {/* Compose: hidden once typing/reviewing starts */}
                              {!done && !efTyping[req.id] && !efReviewing[req.id] && (
                                <div style={{ padding: '14px 22px 18px' }}>
                                  <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: isDark ? '#6b7075' : '#9aa0a6', margin: '0 0 10px' }}>
                                    {req.type === 'dashboard_critique' ? 'Attach your dashboard for review' : req.type === 'code_review' ? 'Paste or upload your code' : req.type === 'excel_review' ? 'Upload your Excel file' : 'Upload your document'}
                                  </p>
                                  {req.type === 'dashboard_critique' && (
                                    <DashboardCritiquePlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={false}
                                      savedResult={undefined} savedImageUrl={undefined} rubric={req.rubric}
                                      onReviewStart={startReview} onReviewError={onReviewError}
                                      onComplete={(result) => { finishReview(); markDone(buildReviewNotes('dashboard_critique', result, saved?.notes), true); }} />
                                  )}
                                  {req.type === 'code_review' && (
                                    <CodeReviewPlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={false}
                                      savedResult={undefined} rubric={req.rubric} schema={req.schema} minScore={req.minScore}
                                      onReviewStart={startReview} onReviewError={onReviewError}
                                      onComplete={(result, passed) => { finishReview(); markDone(buildReviewNotes('code_review', result, saved?.notes), passed); }} />
                                  )}
                                  {req.type === 'excel_review' && (
                                    <ExcelReviewPlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={false}
                                      savedResult={undefined} context={req.context} rubric={req.rubric} minScore={req.minScore}
                                      onReviewStart={startReview} onReviewError={onReviewError}
                                      onComplete={(result, passed) => { finishReview(); markDone(buildReviewNotes('excel_review', result, saved?.notes), passed); }} />
                                  )}
                                  {req.type === 'document_review' && (
                                    <DocumentReviewPlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={false}
                                      context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode}
                                      onComplete={(result, passed) => markDone(buildReviewNotes('document_review', result, saved?.notes), passed)} />
                                  )}
                                </div>
                              )}
                              {/* Manager typing dots -- shows for 2-4s after student submits */}
                              {efTyping[req.id] && (
                                <div style={{ padding: '16px 22px 20px' }}>
                                  <div style={{ marginBottom: 18 }}>
                                    <MailThreadMsg isDark={isDark} from="me" meName={studentName}>
                                      Submitted my {typeLabel} for review.
                                    </MailThreadMsg>
                                  </div>
                                  <MailTypingRow isDark={isDark} person={manager} />
                                </div>
                              )}
                              {/* Manager "received + reviewing" reply -- persists when done so both replies stay in thread */}
                              {!efTyping[req.id] && (efReviewing[req.id] || done) && (
                                <div style={{ padding: '16px 22px 20px' }}>
                                  <div style={{ marginBottom: 18 }}>
                                    <MailThreadMsg isDark={isDark} from="me" meName={studentName} time="Earlier"
                                      receipt={`Seen by ${firstNameOf(manager.name)}`}>
                                      Submitted my {typeLabel} for review.
                                    </MailThreadMsg>
                                  </div>
                                  <MailThreadMsg isDark={isDark} from={manager}>
                                    <p style={{ margin: '0 0 10px' }}>Thanks, {firstNameOf(studentName)} - I have received your {typeLabel} and it is currently under review. I will get back to you shortly.</p>
                                    {!done && (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: isDark ? '#888' : '#999', fontSize: 12.5 }}>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accentColor }} /> AI is reviewing your {typeLabel}...
                                      </div>
                                    )}
                                    {done && <MailStatusChip accent={accentColor}>Review complete</MailStatusChip>}
                                  </MailThreadMsg>
                                </div>
                              )}
                              {/* Manager report -- appears below the received reply once AI finishes */}
                              {done && (
                                <div style={{ padding: '16px 22px 20px', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                                  <MailThreadMsg isDark={isDark} from={manager}>
                                    <p style={{ margin: '0 0 4px' }}>Hi {firstNameOf(studentName)},</p>
                                    <p style={{ margin: '0 0 18px' }}>Thanks for sending over your {typeLabel}. I have completed the review - please find my detailed feedback below.</p>
                                    <div style={{ background: isDark ? '#111' : '#f8fafc', borderRadius: 10, padding: 16, border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}>
                                      {req.type === 'dashboard_critique' && savedReport && (
                                        <DashboardCritiquePlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={true}
                                          savedResult={savedReport as any} savedImageUrl={undefined} rubric={req.rubric} onComplete={() => {}} />
                                      )}
                                      {req.type === 'code_review' && savedReport && (
                                        <CodeReviewPlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={true}
                                          savedResult={isFullReport('code_review', savedReport) ? savedReport as any : undefined}
                                          rubric={req.rubric} schema={req.schema} minScore={req.minScore} onComplete={() => {}} />
                                      )}
                                      {req.type === 'excel_review' && savedReport && (
                                        <ExcelReviewPlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={true}
                                          savedResult={isFullReport('excel_review', savedReport) ? savedReport as any : undefined}
                                          context={req.context} rubric={req.rubric} minScore={req.minScore} onComplete={() => {}} />
                                      )}
                                      {req.type === 'document_review' && savedReport && (
                                        <DocumentReviewPlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={true}
                                          savedResult={isFullReport('document_review', savedReport) ? savedReport as any : undefined}
                                          context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode} onComplete={() => {}} />
                                      )}
                                    </div>
                                    <p style={{ margin: '18px 0 0' }}>Let me know if anything is unclear.</p>
                                    <p style={{ margin: '4px 0 0' }}>Best,<br />{firstNameOf(manager.name)}</p>
                                  </MailThreadMsg>
                                </div>
                              )}
                            </>
                          );
                        }
                      }

                      if (isMcq) {
                        return (
                          <div key={req.id} style={rowStyle} className="px-3 sm:px-8 py-4 sm:py-5 space-y-3">
                            {/* Question header */}
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                style={{ background: `${accentColor}15`, color: accentColor }}>Q{qi + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[14.5px] font-semibold leading-snug" style={{ color: isDark ? '#f0f0f0' : '#111' }}>
                                  {req.label}
                                </p>
                                {req.description && (
                                  <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>
                                )}
                              </div>
                              {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
                            </div>

                            {/* Options */}
                            <div className="space-y-1.5">
                              {(req.options || []).map((opt, oi) => {
                                const letter      = oi + 1;
                                const isSelected  = selectedAnswer === opt;
                                const isCorrect   = opt === req.correctAnswer;
                                const showCorrect = done && isCorrect;
                                const showWrong   = isSelected && !done && !isCorrect;

                                return (
                                  <button key={oi}
                                    onClick={() => {
                                      if (done) return;
                                      const correct = opt === req.correctAnswer;
                                      setProgress(prev => {
                                        const next = { ...prev, [req.id]: { ...prev[req.id], selectedAnswer: opt, completed: correct } };
                                        if (correct) saveProgress(next, currentModId, currentLesId);
                                        return next;
                                      });
                                    }}
                                    disabled={done}
                                    className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-left text-[14px] transition-all disabled:cursor-default"
                                    style={{
                                      background: showCorrect
                                        ? `${accentColor}12`
                                        : showWrong
                                          ? 'rgba(239,68,68,0.07)'
                                          : isSelected
                                            ? `${accentColor}08`
                                            : isDark ? 'rgba(255,255,255,0.055)' : '#ffffff',
                                      border: 'none',
                                      color: showCorrect ? accentColor : showWrong ? '#ef4444' : isDark ? '#e0e0e0' : '#222',
                                    }}>
                                    <span className="flex-1 text-[14.5px]">{opt}</span>
                                    {showCorrect && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />}
                                    {showWrong && <span className="text-[12.5px] flex-shrink-0" style={{ color: '#ef4444' }}>Try again</span>}
                                    <span className="text-[13px] font-bold flex-shrink-0 tabular-nums" style={{ color: showCorrect ? accentColor : showWrong ? '#ef4444' : isSelected ? accentColor : (isDark ? '#888' : '#999') }}>{letter}</span>
                                  </button>
                                );
                              })}
                            </div>

                            {done && (
                              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg w-fit"
                                style={{ background: `${accentColor}10`, color: accentColor }}>
                                <CheckCircle2 className="w-3 h-3"/> Correct. Well done!
                              </div>
                            )}
                          </div>
                        );
                      }

                      // File Upload question
                      if (req.type === 'linkedin_share') {
                        // Clamped with the server's own helper rather than rendered raw: an imported,
                        // synced or hand-edited VE can carry any number, and advertising 999,999 XP for a
                        // claim that will award 200 is a promise the server does not keep.
                        const bonus   = clampLinkedInSharePoints(req.sharePoints);
                        const claimed = progress[req.id]?.linkUrl || '';
                        const draft   = shareDrafts[req.id] ?? claimed;
                        const saving  = shareSaving === req.id;
                        const error   = shareErrors[req.id];
                        const meta    = REQ_META.linkedin_share;
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
                            <div className="flex items-start gap-2.5">
                              <span className="flex-shrink-0 flex items-center justify-center rounded-lg mt-0.5"
                                style={{ width: 30, height: 30, background: '#0A66C2' }}>
                                <LinkedInIcon className="w-4 h-4" style={{ color: '#fff' }} />
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[14.5px] font-semibold flex items-center gap-2" style={{ color: isDark ? '#f0f0f0' : '#111' }}>
                                  {req.label}
                                  {req.shareRequired !== true && (
                                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0"
                                      style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: isDark ? '#888' : '#666' }}>
                                      Optional
                                    </span>
                                  )}
                                </p>
                                {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
                              </div>
                              {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: accentColor }} />}
                            </div>

                            {/* Three states, and the claimed one deliberately names NO amount.
                                What a claim actually paid is the snapshot on linkedin_shares.points,
                                frozen when it was made; `bonus` is the CURRENT offer. Once an
                                instructor edits the bonus the two diverge, so rendering `bonus` here
                                would tell a student who earned 50 that they earned 100 -- and, when
                                the offer is set to 0, erase the banner of somebody who really did
                                earn XP. The player has no access to the snapshot, so it states the
                                fact it can stand behind and leaves the number to the XP total. */}
                            {claimed ? (
                              <div className="flex items-center gap-3 rounded-xl px-3.5 py-3"
                                style={{ background: 'rgba(16,185,129,0.10)' }}>
                                <XpBadgeStack size={60} className="flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-[15px] font-bold leading-tight flex items-center gap-1.5"
                                    style={{ color: '#10b981' }}>
                                    <Check className="w-4 h-4 flex-shrink-0" strokeWidth={3} />
                                    LinkedIn share verified
                                  </p>
                                  <p className="text-[12px] leading-snug mt-0.5" style={{ color: isDark ? '#aaa' : '#555' }}>
                                    Your work is out in front of your network. That is how opportunities find you.
                                  </p>
                                </div>
                              </div>
                            ) : bonus > 0 ? (
                              <div className="flex items-center gap-3 rounded-xl px-3.5 py-3"
                                style={{ background: `${accentColor}12` }}>
                                <XpBadgeStack size={60} className="flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-[15px] font-bold leading-tight" style={{ color: accentColor }}>
                                    {`${bonus.toLocaleString()} XP up for grabs`}
                                  </p>
                                  <p className="text-[12px] leading-snug mt-0.5" style={{ color: isDark ? '#aaa' : '#555' }}>
                                    Post about what you built, then paste the link below to claim it.
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 rounded-lg px-3 py-2.5"
                                style={{ background: `${accentColor}10` }}>
                                <Eye className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
                                <p className="text-[12px] leading-snug" style={{ color: isDark ? '#aaa' : '#555' }}>
                                  Real work, shared publicly. This is the part hiring managers actually see.
                                </p>
                              </div>
                            )}

                            {req.sharePrompt && (
                              <div className="rounded-lg p-3.5" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#F8F8F8', border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}>
                                <div className="flex items-center justify-between gap-3 mb-1.5">
                                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: isDark ? '#666' : '#aaa' }}>Suggested post</p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard?.writeText(req.sharePrompt || '').then(() => {
                                        setShareCopied(req.id);
                                        setTimeout(() => setShareCopied(null), 1800);
                                      }).catch(() => {});
                                    }}
                                    className="px-2.5 py-1.5 rounded-md text-[11.5px] font-semibold transition-all active:scale-[0.97]"
                                    style={{ background: isDark ? 'rgba(255,255,255,0.07)' : '#fff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)'}`, color: isDark ? '#ddd' : '#333' }}
                                  >
                                    {shareCopied === req.id ? 'Copied' : 'Copy'}
                                  </button>
                                </div>
                                <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: isDark ? '#aaa' : '#555' }}>{req.sharePrompt}</p>
                              </div>
                            )}

                            <a
                              href="https://www.linkedin.com/feed/?shareActive=true"
                              target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all active:scale-[0.98] hover:opacity-90"
                              style={{ background: '#0A66C2', color: '#fff' }}
                            >
                              <LinkedInIcon className="w-4 h-4" /> Write my post
                            </a>

                            <div className="space-y-1.5">
                              <p className="text-[12.5px] font-medium" style={{ color: isDark ? '#888' : '#666' }}>Paste the link to your post</p>
                              <div className="flex flex-col sm:flex-row gap-2">
                                {/* The input carries the border and radius itself, rather than sitting bare
                                    inside a bordered wrapper: the global focus ring in globals.css is an
                                    outline on the INPUT, and an outline follows that element's own radius --
                                    so a bare field would ring as a sharp rectangle inside the rounded box. */}
                                <div className="flex-1 min-w-0 relative">
                                  <LinkIcon className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                                    style={{ color: isDark ? '#8a8a8a' : '#64748b' }} />
                                  <input
                                    type="url" inputMode="url" value={draft} readOnly={reviewMode}
                                    onChange={e => {
                                      setShareDrafts(prev => ({ ...prev, [req.id]: e.target.value }));
                                      if (shareErrors[req.id]) setShareErrors(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                    }}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitShareLink(req.id); } }}
                                    placeholder="https://www.linkedin.com/posts/..."
                                    className="w-full min-w-0 pl-8 pr-3 py-2.5 rounded-lg text-[12.5px] outline-none"
                                    style={{
                                      background: isDark ? 'rgba(255,255,255,0.055)' : '#ffffff',
                                      border: `1.5px solid ${error ? '#f43f5e' : claimed ? `${accentColor}80` : isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1'}`,
                                      boxShadow: isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)',
                                      color: isDark ? '#f0f0f0' : '#111',
                                    }}
                                  />
                                </div>
                                {!reviewMode && (
                                  <button
                                    type="button"
                                    onClick={() => submitShareLink(req.id)}
                                    disabled={saving || !draft.trim() || draft.trim() === claimed}
                                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
                                    style={{ background: accentColor, color: '#fff' }}
                                  >
                                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : claimed ? 'Update' : 'Submit'}
                                  </button>
                                )}
                              </div>
                              {/* Asked for once, when there is no profile to check the post's author
                                  against. Saving it retries the claim straight away. */}
                              {needsProfile === req.id && (
                                <div className="rounded-lg p-3 space-y-2" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#F8F8F8' }}>
                                  <p className="text-[12.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>
                                    First, add your LinkedIn profile
                                  </p>
                                  <p className="text-[11.5px] leading-relaxed" style={{ color: isDark ? '#888' : '#666' }}>
                                    We check that the post you paste was written by you, so we need to know which profile is yours. This is saved to your profile once.
                                  </p>
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                      type="url" inputMode="url" value={profileDraft}
                                      onChange={e => { setProfileDraft(e.target.value); if (profileError) setProfileError(''); }}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveProfileAndRetry(req.id); } }}
                                      placeholder="linkedin.com/in/your-name"
                                      className="flex-1 min-w-0 px-3 py-2.5 rounded-lg text-[12.5px] outline-none"
                                      style={{
                                        background: fieldBg,
                                        border: `1.5px solid ${profileError ? '#f43f5e' : fieldBorder}`,
                                        boxShadow: fieldShadow,
                                        color: isDark ? '#f0f0f0' : '#111',
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => saveProfileAndRetry(req.id)}
                                      disabled={profileSaving || !profileDraft.trim()}
                                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
                                      style={{ background: accentColor, color: '#fff' }}
                                    >
                                      {profileSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save and submit'}
                                    </button>
                                  </div>
                                  {profileError && (
                                    <p className="text-[12px] font-medium flex items-start gap-1.5" style={{ color: '#f43f5e' }}>
                                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {profileError}
                                    </p>
                                  )}
                                </div>
                              )}

                              {error && (
                                <p className="text-[12px] font-medium flex items-start gap-1.5" style={{ color: '#f43f5e' }}>
                                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
                                </p>
                              )}
                              {!error && claimed && (
                                <a href={claimed} target="_blank" rel="noreferrer"
                                  className="text-[12px] font-semibold flex items-center gap-1.5 hover:underline" style={{ color: '#10b981' }}>
                                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> Verified. View your post
                                </a>
                              )}
                              {!error && !claimed && (
                                <p className="text-[11.5px] leading-relaxed" style={{ color: isDark ? '#666' : '#999' }}>
                                  Open your post on LinkedIn, copy its full address, and paste it here. Shortened
                                  lnkd.in links cannot be checked.
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      }

                      if (req.type === 'upload') {
                        const fileUrl  = progress[req.id]?.fileUrl || '';
                        const linkUrl  = progress[req.id]?.linkUrl || '';
                        const uploading = uploadingReq === req.id;
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>Upload</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
                                {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
                              </div>
                              {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
                            </div>

                            <label className="block cursor-pointer">
                              <div className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 py-5 px-4 transition-all hover:opacity-80"
                                style={{
                                  borderColor: fileUrl ? accentColor : fieldBorder,
                                  background: fileUrl ? `${accentColor}0d` : fieldBg,
                                  boxShadow: fieldShadow,
                                }}>
                                {uploading
                                  ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: accentColor }} />
                                  : fileUrl
                                    ? <CheckCircle2 className="w-4 h-4" style={{ color: accentColor }} />
                                    : <UploadIcon className="w-4 h-4" style={{ color: isDark ? '#666' : '#aaa' }} />}
                                <p className="text-[12.5px] font-medium text-center" style={{ color: fileUrl ? accentColor : isDark ? '#666' : '#aaa' }}>
                                  {fileUrl ? 'File uploaded. Click to replace.' : 'Click to upload your file'}
                                </p>
                                {fileUrl && (
                                  <a href={fileUrl} target="_blank" rel="noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="text-[11px] underline" style={{ color: accentColor }}>
                                    View uploaded file
                                  </a>
                                )}
                              </div>
                              <input type="file" accept={VE_SUBMISSION_ACCEPT} className="hidden"
                                onChange={async e => { const f = e.target.files?.[0]; if (f) await handleFileUpload(req.id, f); e.target.value = ''; }} />
                            </label>
                            {uploadErrors[req.id] && <p role="alert" className="text-[12px] mt-2 flex items-center gap-1.5" style={{ color: '#ef4444' }}><AlertTriangle className="w-3.5 h-3.5" />{uploadErrors[req.id]}</p>}

                            <div className="space-y-1">
                              <p className="text-[12.5px] font-medium" style={{ color: isDark ? '#888' : '#666' }}>Or share a link</p>
                              <div className="ve-field-shell flex items-center gap-2 px-3 py-2 rounded-lg"
                                style={{
                                  background: fieldBg,
                                  border: `1.5px solid ${linkUrl ? `${accentColor}80` : fieldBorder}`,
                                  boxShadow: fieldShadow,
                                }}>
                                <LinkIcon className="w-3 h-3 flex-shrink-0" style={{ color: isDark ? '#666' : '#aaa' }} />
                                <input type="url" value={linkUrl} onChange={e => setUploadLink(req.id, e.target.value)}
                                  placeholder="https://docs.google.com/… or GitHub link…"
                                  className="flex-1 bg-transparent text-[12.5px] outline-none"
                                  style={{ color: isDark ? '#f0f0f0' : '#111' }} />
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Dashboard Critique
                      if (req.type === 'dashboard_critique') {
                        const saved = progress[req.id];
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                style={{ background: `${accentColor}18`, color: accentColor }}>AI Critique</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
                                {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
                              </div>
                              {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
                            </div>
                            <DashboardCritiquePlayer
                              reqId={req.id}
                              isDark={isDark ?? false}
                              accentColor={accentColor}
                              completed={done}
                              savedResult={parseReviewNotes(saved?.notes)?.report}
                              savedImageUrl={undefined}
                              rubric={(req as any).rubric}
                              onComplete={(result, _imageDataUrl) => {
                                setProgress(prev => {
                                  // Store only the analysis JSON in notes (not the base64 image: too large for DB)
                                  const next = { ...prev, [req.id]: { completed: true, notes: buildReviewNotes('dashboard_critique', result, prev[req.id]?.notes) } };
                                  saveProgress(next, currentModId, currentLesId);
                                  return next;
                                });
                              }}
                            />
                          </div>
                        );
                      }

                      // Code Review
                      if (req.type === 'code_review') {
                        const saved = progress[req.id];
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                style={{ background: `${accentColor}18`, color: accentColor }}>AI Code Review</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
                                {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
                              </div>
                              {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
                            </div>
                            <CodeReviewPlayer
                              reqId={req.id}
                              isDark={isDark ?? false}
                              accentColor={accentColor}
                              completed={done}
                              savedResult={(() => { const rep = parseReviewNotes(saved?.notes)?.report; return isFullReport('code_review', rep) ? rep : undefined; })()}
                              rubric={req.rubric}
                              schema={req.schema}
                              minScore={req.minScore}
                              onComplete={(result, passed) => {
                                setProgress(prev => {
                                  const next = { ...prev, [req.id]: { completed: passed, notes: buildReviewNotes('code_review', result, prev[req.id]?.notes) } };
                                  saveProgress(next, currentModId, currentLesId);
                                  return next;
                                });
                              }}
                            />
                          </div>
                        );
                      }

                      // Excel Review
                      if (req.type === 'excel_review') {
                        const saved = progress[req.id];
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                style={{ background: `rgba(34,197,94,0.12)`, color: '#22c55e' }}>AI Excel Review</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
                                {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
                              </div>
                              {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
                            </div>
                            <ExcelReviewPlayer
                              reqId={req.id}
                              isDark={isDark ?? false}
                              accentColor={accentColor}
                              completed={done}
                              savedResult={(() => { const rep = parseReviewNotes(saved?.notes)?.report; return isFullReport('excel_review', rep) ? rep : undefined; })()}
                              context={req.context}
                              rubric={req.rubric}
                              minScore={req.minScore}
                              onComplete={(result, passed) => {
                                setProgress(prev => {
                                  const next = { ...prev, [req.id]: { completed: passed, notes: buildReviewNotes('excel_review', result, prev[req.id]?.notes) } };
                                  saveProgress(next, currentModId, currentLesId);
                                  return next;
                                });
                              }}
                            />
                          </div>
                        );
                      }

                      if (req.type === 'document_review') {
                        const saved = progress[req.id];
                        const report = parseReviewNotes(saved?.notes)?.report;
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-4">
                            <div className="flex items-start gap-2"><span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5" style={{ background: `${accentColor}18`, color: accentColor }}>AI Document Review</span><div className="flex-1"><p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>{req.description && <p className="text-[12.5px] mt-0.5" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}</div></div>
                            <DocumentReviewPlayer reqId={req.id} isDark={isDark ?? false} accentColor={accentColor} completed={done}
                              savedResult={isFullReport('document_review', report) ? report as any : undefined} context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode}
                              onComplete={(result, passed) => setProgress(prev => { const next = { ...prev, [req.id]: { completed: passed, notes: buildReviewNotes('document_review', result, prev[req.id]?.notes) } }; saveProgress(next, currentModId, currentLesId); return next; })} />
                          </div>
                        );
                      }

                      // Short Answer / Text question
                      if (req.type === 'text') {
                        const noteVal   = noteValues[req.id] ?? (progress[req.id]?.notes || '');
                        const reviewing = !!aiReviewing[req.id];
                        // Fall back to a persisted error marker so a reload rebuilds the "could not
                        // review" state (with retry) rather than silently showing the answer as done.
                        const feedback  = aiFeedback[req.id] !== undefined
                          ? aiFeedback[req.id]
                          : (progress[req.id]?.aiErrored
                            ? { passed: false, feedback: progress[req.id]?.aiFeedback || 'We could not complete an AI review of your response. Please try again.', score: 0, errored: true }
                            : null);
                        const fbErrored = !!feedback?.errored;
                        // The box stays editable/retryable whenever the LAST review errored - keyed off the
                        // PERSISTED marker, not the transient banner. The banner clears on the first keystroke
                        // (fbErrored -> false); if the editable/"done" look were keyed off it, that first edit
                        // would re-lock the field. Progression is never blocked (completed stays true); this
                        // only governs the editable/"done" presentation, which a successful resubmit restores.
                        const showDone  = done && !progress[req.id]?.aiErrored;

                        if (req.aiReview) {
                          // --- AI Review path ---
                          const handleSubmitAi = async () => {
                            if (!noteVal.trim() || reviewing || showDone) return;
                            setAiReviewing(prev => ({ ...prev, [req.id]: true }));
                            setAiFeedback(prev => ({ ...prev, [req.id]: null }));
                            // Record an error state that is never a grade, but keep progression open
                            // (completed stays true) so a flaky reviewer can never trap a student.
                            const saveErrored = (msg: string) => {
                              setAiFeedback(prev => ({ ...prev, [req.id]: { passed: false, feedback: msg, score: 0, errored: true } }));
                              setProgress(prev => {
                                const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: true, aiFeedback: msg } };
                                saveProgress(next, currentModId, currentLesId);
                                return next;
                              });
                            };
                            try {
                              const res = await fetch('/api/ve-answer-review', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...authHeader },
                                body: JSON.stringify({ veId: formId, reqId: req.id, studentAnswer: noteVal }),
                              });
                              const json = await res.json().catch(() => ({}));
                              if (!res.ok) {
                                saveErrored(json.error || 'We could not complete an AI review right now. Please try again.');
                              } else {
                                setAiFeedback(prev => ({ ...prev, [req.id]: { passed: json.passed, feedback: json.feedback, score: json.score } }));
                                setProgress(prev => {
                                  const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: true, aiErrored: undefined, aiFeedback: undefined } };
                                  saveProgress(next, currentModId, currentLesId);
                                  return next;
                                });
                              }
                            } catch {
                              saveErrored('Network error. Please check your connection and try again.');
                            } finally {
                              setAiReviewing(prev => ({ ...prev, [req.id]: false }));
                            }
                          };

                          return (
                            <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-2.5">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                  style={{ background: 'rgba(0,185,92,0.12)', color: '#00b95c' }}>AI Review</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
                                  {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
                                </div>
                                {showDone && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
                              </div>
                              <AiReviewDisclaimer isDark={isDark ?? false} />
                              <textarea
                                value={noteVal}
                                onChange={e => {
                                  if (e.target.value.length > 2000) return;
                                  setNoteValues(prev => ({ ...prev, [req.id]: e.target.value }));
                                  if (feedback && !showDone) setAiFeedback(prev => ({ ...prev, [req.id]: null }));
                                }}
                                disabled={showDone && !reviewMode}
                                placeholder="Type your answer here (2000 characters max)..."
                                rows={4}
                                className="w-full text-[14px] rounded-xl p-3.5 outline-none resize-none"
                                style={{
                                  background: fieldBg,
                                  color: isDark ? '#f0f0f0' : '#111',
                                  border: `1.5px solid ${showDone ? accentColor : fieldBorder}`,
                                  boxShadow: fieldShadow,
                                  lineHeight: 1.6,
                                  opacity: showDone && !reviewMode ? 0.7 : 1,
                                }}
                              />
                              {!showDone && (
                                <p className="text-[11px] text-right" style={{ color: noteVal.length >= 1920 ? '#ef4444' : isDark ? '#555' : '#aaa' }}>
                                  {noteVal.length} / 2000
                                </p>
                              )}
                              {!showDone && (
                                <button
                                  onClick={handleSubmitAi}
                                  disabled={noteVal.trim().length === 0 || reviewing}
                                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                  style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>
                                  {reviewing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                  {reviewing ? 'AI is reviewing...' : 'Submit for AI Review'}
                                </button>
                              )}
                              {/* Distinct error state: the review never ran, so no pass/fail, no score. */}
                              {feedback && fbErrored && (
                                <div className="rounded-xl p-3 flex items-start gap-2"
                                  style={{ background: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.12)', border: `1px solid ${isDark ? 'rgba(148,163,184,0.30)' : 'rgba(148,163,184,0.40)'}` }}>
                                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: isDark ? '#cbd5e1' : '#64748b' }} />
                                  <div className="min-w-0">
                                    <p className="text-[13px] font-bold" style={{ color: isDark ? '#cbd5e1' : '#64748b' }}>Review unavailable</p>
                                    <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: isDark ? '#ccc' : '#444' }}>{feedback.feedback}</p>
                                  </div>
                                </div>
                              )}
                              {/* AI feedback panel */}
                              {feedback && !fbErrored && (
                                <div className="rounded-xl p-4 space-y-2"
                                  style={{
                                    background: feedback.passed ? 'rgba(16,185,129,0.07)' : 'rgba(245,158,11,0.07)',
                                    border: `1px solid ${feedback.passed ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
                                  }}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      {feedback.passed
                                        ? <CheckCircle2 className="w-4 h-4" style={{ color: '#10b981' }} />
                                        : <Circle className="w-4 h-4" style={{ color: '#f59e0b' }} />}
                                      <span className="text-[13px] font-bold" style={{ color: feedback.passed ? '#10b981' : '#f59e0b' }}>
                                        {feedback.passed ? 'Passed' : 'Not quite there yet'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[12px] font-bold tabular-nums px-2 py-0.5 rounded-full"
                                        style={{ background: feedback.passed ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: feedback.passed ? '#10b981' : '#f59e0b' }}>
                                        {feedback.score}/100
                                      </span>
                                      <button
                                        onClick={async () => {
                                          const { jsPDF } = await import('jspdf');
                                          const doc = new jsPDF({ unit: 'pt', format: 'a4' });
                                          const margin = 48;
                                          const pageW  = doc.internal.pageSize.getWidth();
                                          const maxW   = pageW - margin * 2;
                                          let y = margin;

                                          const addText = (text: string, size: number, bold: boolean, color: [number, number, number], gap: number) => {
                                            doc.setFontSize(size);
                                            doc.setFont('helvetica', bold ? 'bold' : 'normal');
                                            doc.setTextColor(...color);
                                            const lines = doc.splitTextToSize(text, maxW);
                                            doc.text(lines, margin, y);
                                            y += lines.length * (size * 1.4) + gap;
                                          };

                                          const ve   = [config.company, config.role].filter(Boolean).join(' - ');
                                          const task = req.label || req.description || 'Task';

                                          if (ve) addText(ve, 10, false, [120, 120, 120], 4);
                                          addText('AI Review Feedback', 18, true, [17, 24, 39], 20);
                                          addText(task, 13, true, [55, 65, 81], 6);
                                          if (currentLes?.title) addText(currentLes.title, 10, false, [120, 120, 120], 16);

                                          addText('Your Answer', 11, true, [100, 100, 100], 6);
                                          addText(noteVal, 12, false, [55, 65, 81], 20);

                                          addText(`Score: ${feedback.score}/100  |  ${feedback.passed ? 'Passed' : 'Not yet passed'}`, 11, true, feedback.passed ? [16, 185, 129] : [245, 158, 11], 8);
                                          addText(feedback.feedback, 12, false, [55, 65, 81], 0);

                                          const slug = (task).replace(/\s+/g, '-').toLowerCase().slice(0, 40);
                                          doc.save(`ai-review-${slug}.pdf`);
                                        }}
                                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80"
                                        style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: isDark ? '#aaa' : '#666' }}>
                                        <Download className="w-3 h-3" /> PDF
                                      </button>
                                    </div>
                                  </div>
                                  <p className="text-[13px] leading-relaxed" style={{ color: isDark ? '#ccc' : '#444' }}>{feedback.feedback}</p>
                                </div>
                              )}
                              {showDone && !feedback && (
                                <div className="rounded-lg p-3 flex items-center gap-2"
                                  style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
                                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#10b981' }} />
                                  <p className="text-[13px] font-semibold" style={{ color: '#10b981' }}>Answer accepted. Well done!</p>
                                </div>
                              )}
                            </div>
                          );
                        }

                        // --- Exact match path (original behaviour) ---
                        const submitted   = !!progress[req.id]?.notes;
                        const isCorrect   = submitted && req.expectedAnswer
                          ? isAnswerCorrect(progress[req.id]?.notes || '', req.expectedAnswer)
                          : submitted && !req.expectedAnswer;
                        const wrongAnswer = submitted && req.expectedAnswer && !isCorrect;
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-2.5">
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                style={{ background: 'rgba(0,185,92,0.12)', color: '#00b95c' }}>Short Answer</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
                                {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
                              </div>
                              {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
                            </div>
                            <textarea
                              value={noteVal}
                              onChange={e => {
                                setNoteValues(prev => ({ ...prev, [req.id]: e.target.value }));
                                if (submitted && !done) {
                                  setProgress(prev => {
                                    const next = { ...prev, [req.id]: { ...prev[req.id], notes: '', completed: false } };
                                    return next;
                                  });
                                }
                              }}
                              disabled={done && !reviewMode}
                              placeholder="Type your answer here…"
                              rows={3}
                              className="w-full text-[14px] rounded-xl p-3.5 outline-none resize-none"
                              style={{
                                background: fieldBg,
                                color: isDark ? '#f0f0f0' : '#111',
                                border: `1.5px solid ${
                                  wrongAnswer ? '#ef4444' :
                                  done ? accentColor :
                                  fieldBorder
                                }`,
                                boxShadow: fieldShadow,
                                lineHeight: 1.6,
                                opacity: done && !reviewMode ? 0.7 : 1,
                              }}
                            />
                            {!done && (
                              <button
                                onClick={() => {
                                  if (noteVal.trim().length === 0) return;
                                  const correct = req.expectedAnswer
                                    ? isAnswerCorrect(noteVal, req.expectedAnswer)
                                    : true;
                                  setProgress(prev => {
                                    const next = { ...prev, [req.id]: { ...prev[req.id], notes: noteVal, completed: correct } };
                                    saveProgress(next, currentModId, currentLesId);
                                    return next;
                                  });
                                }}
                                disabled={noteVal.trim().length === 0}
                                className="px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>
                                Submit Answer
                              </button>
                            )}
                            {wrongAnswer && (
                              <div className="rounded-lg p-3 flex items-start gap-2"
                                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                                <span className="text-[13px]" style={{ color: '#ef4444' }}>✕</span>
                                <p className="text-[13px]" style={{ color: '#ef4444' }}>Incorrect. Try again.</p>
                              </div>
                            )}
                            {done && (
                              <div className="rounded-lg p-3 flex items-start gap-2"
                                style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
                                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#10b981' }} />
                                <p className="text-[13px] font-semibold" style={{ color: '#10b981' }}>Correct. Well done!</p>
                              </div>
                            )}
                          </div>
                        );
                      }

                      //: Default fallback (task / deliverable / reflection) -
                      const meta    = REQ_META[req.type] || REQ_META.task;
                      const noteVal = noteValues[req.id] ?? (progress[req.id]?.notes || '');

                      // Simple completion items: a clear status circle without an extra response field.
                      if (req.type === 'task' || req.type === 'deliverable') {
                        return (
                          <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-4">
                            <button onClick={() => !reviewMode && toggleReq(req.id)}
                              className="flex items-start gap-3 w-full text-left"
                              disabled={reviewMode}>
                              <div className="flex-shrink-0 mt-0.5">
                                {done
                                  ? <CheckCircle2 className="w-4 h-4" style={{ color: accentColor }} />
                                  : <Circle className="w-5 h-5" style={{ color: accentColor, opacity: 0.5 }} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</span>
                                {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
                                {!done && !reviewMode && (
                                  <p className="text-[11.5px] mt-1 font-semibold" style={{ color: accentColor, opacity: 0.75 }}>Click to mark as done</p>
                                )}
                              </div>
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div key={req.id} style={rowStyle} className="px-4 sm:px-8 py-5 space-y-2.5">
                          <div className="flex items-start gap-3">
                            <button onClick={() => toggleReq(req.id)} className="flex-shrink-0 mt-0.5">
                              {done
                                ? <CheckCircle2 className="w-4 h-4" style={{ color: accentColor }} />
                                : <Circle className="w-5 h-5" style={{ color: accentColor, opacity: 0.5 }} />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                  style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                                <span className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</span>
                              </div>
                              <p className="text-[12.5px] leading-snug" style={{ color: isDark ? '#888' : '#555' }}>{req.description}</p>
                              {!done && !reviewMode && (
                                <p className="text-[11.5px] mt-1.5 font-semibold" style={{ color: accentColor, opacity: 0.75 }}>
                                  Add your notes, then click the circle to mark as done
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="pl-0 sm:pl-7">
                            <textarea value={noteVal} onChange={e => setNote(req.id, e.target.value)}
                              placeholder="Add your notes or work summary…" rows={2}
                              className="w-full text-[14px] rounded-xl p-3.5 outline-none resize-none"
                              style={{
                                background: fieldBg,
                                color: isDark ? '#f0f0f0' : '#111',
                                border: `1.5px solid ${fieldBorder}`,
                                boxShadow: fieldShadow,
                                lineHeight: 1.6,
                              }} />
                          </div>
                        </div>
                      );
                    })}

                    {/* Incoming-message indicator: the rest of the conversation arrives as work gets done */}
                    {!reviewMode && (() => {
                      const reqs = currentLes.requirements;
                      let visibleEnd = reqs.length;
                      for (let i = 1; i < reqs.length; i++) {
                        if (!reqs.slice(0, i).every(reqSettled)) { visibleEnd = i; break; }
                      }
                      const hiddenCount = reqs.length - visibleEnd;
                      if (hiddenCount <= 0) return null;
                      return (
                        <div className="px-4 sm:px-8 py-4"
                          style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                          <ArrivalIndicator isDark={isDark} accent={accentColor} manager={manager}
                            hiddenCount={hiddenCount} nextKind={arrivalKindFor(reqs[visibleEnd])} />
                        </div>
                      );
                    })()}

                    {/* Preview only: step past work whose submit path needs a real attempt (a file
                        upload, an AI review, a LinkedIn claim). Without this the sequence stalls
                        and the rest of the mission stays hidden. Marks progress in memory only. */}
                    {previewMode && !reviewMode && nextBlockingReq && (
                      <div className="px-4 sm:px-8 py-4 flex items-center gap-3 flex-wrap"
                        style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
                        <button onClick={() => skipReqInPreview(nextBlockingReq.id)}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12.5px] font-semibold transition-all hover:opacity-80"
                          style={{ background: `${accentColor}18`, color: accentColor }}>
                          <SkipForward className="w-3.5 h-3.5" /> Skip this step
                        </button>
                        <span className="text-[12px]" style={{ color: muted }}>
                          Preview only. Skipping reveals what a student sees next and is not saved.
                        </span>
                      </div>
                    )}
                  </>
                )}

              </div>{/* end unified card */}

              {/* Module solution: video or file link, shown when all lessons in module are complete */}
              {(() => {
                const modLessons = currentMod?.lessons || [];
                const modAllDone = modLessons.length > 0 && modLessons.every(l => lessonProgress(l, progress) === 100);
                const solUrl = currentMod?.solutionVideo;
                if (!solUrl || !modAllDone) return null;
                const solEmbedUrl = getVideoEmbedUrl(solUrl);
                const isFile = !solEmbedUrl;
                return (
                  <div className="rounded-xl overflow-hidden"
                    style={{
                      background: isDark ? '#1e1e1e' : '#ffffff',
                      border: `1px solid ${accentColor}40`,
                    }}>
                    <div className="px-6 py-4 flex items-center gap-2"
                      style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: accentColor }} />
                      <p className="text-[13px] font-bold" style={{ color: accentColor }}>
                        {isFile ? 'Milestone Solution File' : 'Milestone Solution Video'}
                      </p>
                      <p className="text-[12px] ml-auto" style={{ color: isDark ? '#666' : '#999' }}>Unlocked: milestone complete</p>
                    </div>
                    {isFile ? (
                      <div className="px-6 py-5 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: `${accentColor}18` }}>
                          <Download className="w-5 h-5" style={{ color: accentColor }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: isDark ? '#f0f0f0' : '#111' }}>
                            {solUrl.split('/').pop()?.split('?')[0] || 'Solution File'}
                          </p>
                          <p className="text-[12px] truncate" style={{ color: isDark ? '#666' : '#999' }}>{solUrl}</p>
                        </div>
                        <a href={solUrl} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold flex-shrink-0 transition-all hover:opacity-80"
                          style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>
                          <LinkIcon className="w-3.5 h-3.5" /> Open
                        </a>
                      </div>
                    ) : (
                      <div style={{ aspectRatio: '16/9', background: '#000' }}>
                        <iframe src={solEmbedUrl!} className="w-full h-full border-0"
                          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                          allowFullScreen />
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Navigation */}
              {!reviewMode && !allCurrentDone && hasNext && (
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl"
                  style={{ background: `${accentColor}12`, border: `1px solid ${accentColor}30` }}>
                  <Circle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
                  <p className="text-[12.5px] font-semibold" style={{ color: accentColor }}>
                    {remainingCount === 1 ? '1 item remaining.' : `${remainingCount} items remaining.`} Complete {remainingCount === 1 ? 'it' : 'them'} to move forward.
                  </p>
                </div>
              )}
              {saveError && (
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl"
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <p className="text-[12.5px] font-semibold" style={{ color: '#f59e0b' }}>{saveError}</p>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 pb-16 gap-2">
                <button onClick={goPrev} disabled={!hasPrev}
                  className="flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-medium border transition-all hover:opacity-70 disabled:opacity-30 flex-shrink-0"
                  style={{ border: `1px solid ${border}`, color: muted, background: surface }}>
                  <ChevronLeft className="w-4 h-4" /> <span className="hidden xs:inline">Previous</span>
                </button>

                <div className="hidden sm:flex items-center gap-2">
                  {flat.slice(Math.max(0, flatIdx - 2), flatIdx + 3).map((f) => {
                    const isCurr = f.lesson.id === currentLesId;
                    const pct    = lessonProgress(f.lesson, progress);
                    return (
                      <div key={f.lesson.id} className="rounded-full transition-all"
                        style={{
                          width: isCurr ? 24 : 8, height: 8,
                          background: isCurr ? accentColor : pct === 100 ? `${accentColor}80` : border,
                        }} />
                    );
                  })}
                </div>

                {hasNext ? (
                  <button onClick={goNext} disabled={!navUnlocked && !allCurrentDone}
                    title={!navUnlocked && !allCurrentDone ? 'Complete all tasks to continue' : ''}
                    className="flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                    style={{ background: navUnlocked || allCurrentDone ? accentColor : border, color: navUnlocked || allCurrentDone ? (isDark ? '#111' : '#fff') : muted }}>
                    <span className="hidden xs:inline">Next</span> <ChevronRight className="w-4 h-4" />
                  </button>
                ) : reviewMode ? (
                  <button onClick={() => setReviewMode(false)}
                    className="flex items-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition-all hover:opacity-80 flex-shrink-0"
                    style={{ background: `${accentColor}18`, color: accentColor }}>
                    <Trophy className="w-4 h-4" /> <span className="hidden xs:inline">Summary</span>
                  </button>
                ) : (
                  <button onClick={handleComplete} disabled={saving || !canComplete}
                    className="flex items-center gap-1.5 px-3 sm:px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition-all hover:opacity-80 flex-shrink-0"
                    style={{ background: canComplete ? accentColor : border, color: canComplete ? (isDark ? '#111' : '#fff') : muted }}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
                    <span className="hidden xs:inline">Complete</span>
                  </button>
                )}
              </div>
            </>
          );})() : null}
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}
