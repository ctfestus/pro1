'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  CheckCircle2, Circle, ChevronRight, ChevronLeft, ChevronDown,
  X, Loader2, Trophy, BookOpen, Download, Award, Star, FileText,
  Link as LinkIcon, Eye, SkipForward, MessageSquare,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAiReviewEntitlement } from '@/lib/use-ai-review-entitlement';
import { sanitizeRichText } from '@/lib/sanitize';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { preflightLinkedInPostUrl } from '@/lib/linkedin-post-url';
import { saveMyLinkedInProfileUrl, shareClaimErrorMessage } from '@/lib/linkedin-profile';
import { veCompletionCounts, lessonCompletionPct, isVeComplete, reqCountsForCompletion } from '@/lib/ve-completion';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { LessonRenderer } from '@/components/lesson/LessonRenderer';
import VeInstructorReview, { hasInstructorReview } from '@/components/VeInstructorReview';
import { safeVeUploadName, validateVeSubmissionFile, veSubmissionFolder } from '@/lib/ve-upload';
import {
  Person, PersonAvatar, ArrivalIndicator, arrivalKindFor, companyDomain, personEmail, workStamp, workplaceSoundOn, setWorkplaceSound,
} from '@/components/ve/workplace';
import { WorkplaceTopBar } from '@/components/ve/WorkplaceTopBar';
import { ProjectPlan } from '@/components/ve/ProjectPlan';
import { MissionTodo, todoSource, jumpToRequirement, type TodoItem } from '@/components/ve/MissionTodo';
import { lessonPlainText } from '@/lib/lesson-doc';
import { toPlainText } from '@/lib/plain-text';
import { channelFor } from '@/components/ve/ChatCard';
import { RequirementItem } from '@/components/ve/requirements/RequirementItem';
import type {
  Requirement, Lesson, Module, ProjectConfig, Progress, AiFeedbackEntry, VeRequirementContext,
} from '@/components/ve/requirements/types';

// Player type: Google Sans for text, Space Grotesk for headings (loaded in app/layout.tsx).
const VE_BODY_FONT = "'Google Sans', 'Google Sans Text', var(--font-sans), sans-serif";
const VE_DISPLAY_FONT = "var(--font-display), 'Google Sans', sans-serif";

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

// Helpers
import { safeEmbedUrl as getVideoEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { HtmlEmbedFrame } from '@/components/HtmlEmbedFrame';

// Lesson percentage comes from the shared rule so the player, the progress route and the
// assignment-completion route cannot disagree about what "done" means.
function lessonProgress(lesson: Lesson, progress: Progress): number {
  return lessonCompletionPct(lesson, progress);
}

// Reading time of a mission's content at 200 words a minute, never less than a minute.
function readMinutes(lesson: Lesson): number {
  const text = lesson.doc ? lessonPlainText(lesson.doc, 200000) : toPlainText(lesson.body);
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
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
  // The instructor's review pop-up. A review usually lands after the student has left, often before
  // they have finished, so it is reachable from every mission, not only the completion screen.
  const [reviewOpen,   setReviewOpen]   = useState(false);
  // The review banner can be closed. Remembered per review (keyed by when it was submitted), so a
  // new or updated review brings the banner back. Starts hidden until storage has been read.
  const [bannerHidden, setBannerHidden] = useState(true);
  const bannerKey = `ve-review-banner-closed:${formId}:${review?.reviewed_at ?? ''}`;
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
  const [aiFeedback,   setAiFeedback]   = useState<Record<string, AiFeedbackEntry>>({});
  const entitlement = useAiReviewEntitlement('veAnswers');
  const [saveError,    setSaveError]    = useState<string | null>(null);
  // Chimes and typing sounds. The choice lives in workplace.tsx so every surface that plays a sound
  // respects it; this mirrors it for the button. Read after mount: storage is browser-only.
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => { setSoundOn(workplaceSoundOn()); }, []);
  const toggleSound = () => {
    setWorkplaceSound(!soundOn);
    setSoundOn(!soundOn);
  };
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
  // How many of this mission's requirements have arrived: they appear one at a time, each once
  // everything before it is settled. Review shows them all.
  const arrivedCount = (() => {
    const reqs = currentLes?.requirements || [];
    if (reviewMode) return reqs.length;
    for (let i = 1; i < reqs.length; i++) {
      if (!reqs.slice(0, i).every(reqSettled)) return i;
    }
    return reqs.length;
  })();

  // The ask-your-manager chat is tied to a brief. Offer it from the top bar once this mission's
  // brief has arrived; the chat itself lives in the brief's email.
  // Not while the mission content still hides the tasks behind "Continue to Tasks".
  const tasksHidden = !!currentLes && !!(currentLes.doc || currentLes.body) && currentLes.requirements.length > 0
    && !allCurrentDone && !continuedLessons.has(currentLes.id);
  // The work clock shows the time of the newest message in this mission, taken from the same
  // workStamp the messages use, so the clock and the message times always agree. Before the
  // tasks show, it is the time the brief was shared (9:00 AM, as the brief says).
  const clockSeq = Math.max(0, arrivedCount - 1);
  const missionDay = Math.max(0, flatIdx);
  const clockStamp = workStamp(missionDay, clockSeq, currentLes?.requirements[clockSeq]?.id);
  const workClock = {
    day: clockStamp.day, time: tasksHidden ? '9:00 AM' : clockStamp.time,
    dayIdx: missionDay % 5, dayNumber: missionDay + 1,
  };

  const askableBrief = reviewMode || tasksHidden ? undefined
    : (currentLes?.requirements || []).slice(0, arrivedCount).find(r => r.type === 'briefing');

  // The mission's to-do list: what has arrived so far and counts towards finishing it, plus how
  // many more are still to come. Not shown before the tasks are revealed, nor in review.
  const showTodo = !!currentLes && !reviewMode && !tasksHidden && currentLes.requirements.length > 0;
  const todoItems: TodoItem[] = !showTodo ? [] : currentLes!.requirements.slice(0, arrivedCount)
    .filter(r => reqCountsForCompletion(r, progress))
    .map(r => ({ id: r.id, label: (r.label || '').trim() || todoSource(r), source: todoSource(r), done: !!progress[r.id]?.completed }));
  const todoPending = !showTodo ? 0 : currentLes!.requirements.slice(arrivedCount)
    .filter(r => reqCountsForCompletion(r, progress)).length;
  const jumpTo = (reqId: string) => jumpToRequirement(reqId, accentColor);

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

  useEffect(() => {
    if (!hasInstructorReview(review)) return;
    let closed = false;
    try { closed = !!localStorage.getItem(bannerKey); } catch { /* storage unavailable: show it */ }
    setBannerHidden(closed);
  }, [review, bannerKey]);

  const closeBanner = () => {
    setBannerHidden(true);
    try { localStorage.setItem(bannerKey, '1'); } catch { /* hidden for this visit only */ }
  };

  // Show a new review once, unprompted. Keyed by when it was submitted, so an updated review shows
  // again. On the completion screen it is already shown in full, so that counts as seen.
  useEffect(() => {
    if (previewMode || !hasInstructorReview(review)) return;
    const key = `ve-review-seen:${formId}:${review.reviewed_at ?? ''}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch { /* storage unavailable: the banner still shows */ }
    if (!completed || reviewMode) setReviewOpen(true);
  }, [review, completed, reviewMode, previewMode, formId]);

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
      const path = `${veSubmissionFolder(formId, userId)}/${reqId}-${Date.now()}-${safeVeUploadName(file.name)}`;
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
    if (config.dataset.url) {
      window.open(config.dataset.url, '_blank', 'noopener,noreferrer');
    } else if (config.dataset.csvContent) {
      const blob = new Blob([config.dataset.csvContent], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = config.dataset.filename;
      a.click(); URL.revokeObjectURL(url);
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
      <div className="min-h-screen flex flex-col" style={{ background: isDark ? '#0e0e0e' : '#F3F4F2', color: text, fontFamily: VE_BODY_FONT }}>

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
            <h1 className="text-4xl sm:text-5xl font-bold leading-tight" style={{ color: '#fff', fontFamily: VE_DISPLAY_FONT }}>
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

          {/* The instructor's review: score, feedback and a report on each uploaded file. */}
          {hasInstructorReview(review) && (
            <div className="rounded-2xl px-5 py-5"
              style={{ background: isDark ? '#1c1c1c' : '#fff', boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.06)' : '0 10px 28px rgba(15,23,42,0.06)' }}>
              <VeInstructorReview review={review} modules={modules} progress={progress}
                accentColor={accentColor} isDark={isDark} colors={{ text, muted, faint: muted }} />
            </div>
          )}

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

  // Everything the per-type requirement renderers in components/ve/requirements read or change.
  const reqCtx: VeRequirementContext = {
    isDark, accentColor, fieldBg, fieldBorder, fieldShadow,
    config, manager, meEmail, studentName, teamChannel, formId, authHeader,
    flatIdx, currentLes, currentModId, currentLesId, reviewMode, entitlement,
    progress, setProgress, saveProgress, noteValues, setNoteValues, setNote, toggleReq, downloadDataset,
    handleFileUpload, setUploadLink, uploadingReq, uploadErrors,
    typingAcks, setTypingAcks, typingDecisions, setTypingDecisions, openReplies, setOpenReplies,
    askOpen, setAskOpen, askSeen, setAskSeen,
    efReviewing, setEfReviewing, efTyping, setEfTyping, efRounds, setEfRounds, efPending, setEfPending,
    aiReviewing, setAiReviewing, aiFeedback, setAiFeedback,
    shareDrafts, setShareDrafts, shareSaving, shareErrors, setShareErrors, shareCopied, setShareCopied,
    submitShareLink, needsProfile, profileDraft, setProfileDraft, profileSaving, profileError, setProfileError,
    saveProfileAndRetry,
  };

  // Main layout
  return (
    <div className="relative flex flex-col h-screen overflow-hidden"
      style={{ background: bg, color: text, fontFamily: VE_BODY_FONT, ['--ve-accent' as string]: accentColor }}>

      <WorkplaceTopBar
        isDark={isDark} accentColor={accentColor} text={navText} muted={navMuted}
        logoUrl={(isDark ? (logoDarkUrl || logoUrl) : logoUrl) || undefined}
        showMenu={!sidebarOpen} onOpenMenu={() => setSidebarOpen(true)}
        company={config.company}
        clock={workClock} manager={manager}
        onAsk={askableBrief ? () => {
          setAskOpen(new Set([askableBrief.id]));
          setAskSeen(prev => new Set([...prev, askableBrief.id]));
        } : undefined}
        soundOn={soundOn} onToggleSound={toggleSound}
        pct={overallPct} saving={saving}
        onDownloadDataset={config.dataset ? downloadDataset : undefined} datasetName={config.dataset?.filename} />

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

        {sidebarOpen ? (
          <ProjectPlan
            isDark={isDark} accentColor={accentColor} text={text} muted={muted} border={border}
            role={config.role} heading={shortCourse ? 'Course' : 'Virtual Experience'} modules={modules} progress={progress} currentLesId={currentLesId}
            isUnlocked={isUnlocked} onOpen={navigate}
            dataset={config.dataset} onDownloadDataset={downloadDataset}
            onCollapse={() => setSidebarOpen(false)} />
        ) : (
          <div className="flex pt-3 pb-1 flex-shrink-0 items-center justify-center">
            <div className="relative group hidden sm:flex">
              <button onClick={() => setSidebarOpen(true)} style={{ color: muted }} className="hover:opacity-60 p-1" aria-label="Expand mission list">
                <MenuIcon className="w-5 h-5" />
              </button>
              <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900 text-white">
                Expand mission list
              </span>
            </div>
          </div>
        )}
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

        {/* The instructor's review, reachable from any mission whether or not the VE is finished. */}
        {!previewMode && hasInstructorReview(review) && !bannerHidden && (
          <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0"
            style={{ background: `${accentColor}12`, borderBottom: `1px solid ${accentColor}25` }}>
            <MessageSquare className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
            <span className="flex-1 min-w-0 text-[13px] font-medium truncate" style={{ color: text }}>
              Your instructor reviewed your work{review.score !== undefined ? ` - ${review.score}/100` : ''}
            </span>
            <button onClick={() => setReviewOpen(true)}
              className="flex-shrink-0 text-[13px] font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-85"
              style={{ background: accentColor }}>
              View review
            </button>
            <button onClick={closeBanner} aria-label="Close review banner" title="Close"
              className="flex-shrink-0 p-1.5 -mr-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: muted }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {reviewOpen && hasInstructorReview(review) && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
            onClick={() => setReviewOpen(false)} role="dialog" aria-modal="true" aria-label="Your instructor's review">
            <div className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl px-5 pb-5"
              style={{ background: isDark ? '#1c1c1c' : '#fff' }} onClick={e => e.stopPropagation()}>
              {/* Pinned, so the way out is always visible however far the review is scrolled. */}
              <div className="sticky top-0 z-10 flex justify-end pt-3 pb-1 -mr-2" style={{ background: isDark ? '#1c1c1c' : '#fff' }}>
                <button onClick={() => setReviewOpen(false)} aria-label="Close" className="p-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: muted }}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <VeInstructorReview review={review} modules={modules} progress={progress}
                accentColor={accentColor} isDark={isDark} colors={{ text, muted, faint: muted }} focus scrollOnFocus={false} />
            </div>
          </div>
        )}

        {/* Lesson content: subtle grey background, single white card */}
        <div ref={mainScrollRef} className="flex-1 overflow-y-auto" style={{ background: isDark ? '#141414' : '#F2F5FA' }}>
          <div className="flex justify-center gap-4 w-full px-2 sm:px-4">
          <div className={`${embedUrl && isHtmlEmbedUrl(embedUrl) ? 'max-w-6xl' : 'max-w-4xl'} w-full min-w-0 pt-4 sm:pt-3 pb-4 sm:pb-6 space-y-4`}>
          {showTodo && todoItems.length > 0 && (
            <div className="2xl:hidden sticky top-2 z-20">
              <MissionTodo variant="pill" items={todoItems} pendingCount={todoPending} isDark={isDark}
                accentColor={accentColor} text={text} muted={muted} onJump={jumpTo} />
            </div>
          )}
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

                {/* A mission with content reads as a brief the manager shared: document strip first. */}
                {hasContent && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-8 py-3"
                    style={{ background: isDark ? 'rgba(255,255,255,0.03)' : '#F8FAFC', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#EEF2F7'}` }}>
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: muted }}>
                      <FileText className="w-3.5 h-3.5" /> Mission brief
                    </span>
                    <span className="inline-flex items-center gap-2 text-[12.5px] min-w-0" style={{ color: muted }}>
                      <PersonAvatar {...manager} size={22} isDark={isDark} />
                      <span className="truncate">From <b className="font-semibold" style={{ color: text }}>{manager.name}</b>{manager.title ? `, ${manager.title}` : ''}</span>
                    </span>
                    <span className="sm:ml-auto text-[12px] tabular-nums" style={{ color: muted }}>
                      {workClock.day} 9:00 AM &middot; {readMinutes(currentLes)} min read
                    </span>
                  </div>
                )}

                {/* Lesson header inside card */}
                <div className="px-4 sm:px-8 pt-5 sm:pt-7 pb-5"
                  style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#F2F5FA'}` }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: accentColor }}>{currentMod?.title}</p>
                  <h1 className="text-[22px] font-semibold leading-snug" style={{ color: isDark ? '#f0f0f0' : '#111', fontFamily: VE_DISPLAY_FONT }}>{currentLes.title}</h1>
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
                        ? 'prose-invert prose-p:text-zinc-300 prose-p:leading-[1.6] prose-headings:text-white prose-headings:font-semibold prose-strong:text-white prose-a:text-blue-400 prose-li:text-zinc-300 prose-li:leading-[1.6] prose-hr:border-zinc-800 prose-blockquote:border-l-4 prose-blockquote:border-[color:var(--ve-accent)] prose-blockquote:text-zinc-400 prose-blockquote:not-italic prose-code:text-emerald-400 [&_pre]:bg-[#0f1120] [&_pre]:border [&_pre]:border-[#2e2e33] [&_pre]:rounded-lg [&_pre_code]:text-[#c9d1d9] prose-table:w-full prose-thead:border-b prose-thead:border-zinc-700 prose-th:text-zinc-300 prose-th:font-semibold prose-th:py-2 prose-th:px-3 prose-td:text-zinc-400 prose-td:py-2 prose-td:px-3 prose-tr:border-b prose-tr:border-zinc-800'
                        : 'prose-p:text-[#111] prose-p:leading-[1.6] prose-headings:text-[#111] prose-headings:font-semibold prose-strong:text-[#111] prose-li:text-[#111] prose-li:leading-[1.6] prose-a:text-blue-600 prose-hr:border-zinc-200 prose-blockquote:border-l-4 prose-blockquote:border-[color:var(--ve-accent)] prose-blockquote:text-zinc-600 prose-blockquote:not-italic prose-code:text-emerald-700 [&_pre]:bg-[#f6f8fa] [&_pre]:border [&_pre]:border-[#d0d7de] [&_pre]:rounded-lg [&_pre_code]:text-[#1f2328] prose-table:w-full prose-thead:border-b prose-thead:border-zinc-200 prose-th:text-zinc-700 prose-th:font-semibold prose-th:py-2 prose-th:px-3 prose-td:text-zinc-600 prose-td:py-2 prose-td:px-3 prose-tr:border-b prose-tr:border-zinc-100'
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
                            <span className="text-[12.5px] font-semibold" style={{ color: accentColor }}>
                              {isExpanded ? 'Hide the brief' : 'Read the brief again'}
                            </span>
                          </button>
                          {isExpanded && <div className="px-4 sm:px-8 pb-6">{lessonBodyContent}</div>}
                        </div>
                      ) : (
                        <div className="px-4 sm:px-8 pt-5 sm:pt-6 pb-6">{lessonBodyContent}</div>
                      )
                    )}

                    {showGateButton && (
                      <div className="px-4 sm:px-8 pb-8 flex flex-col items-center gap-2"
                        style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : '#F2F5FA'}` }}>
                        <button onClick={() => continueToTasks(currentLes.id)}
                          className="flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-[14px] transition-all hover:opacity-90"
                          style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>
                          Start the work <ChevronRight className="w-4 h-4" />
                        </button>
                        <span className="text-[12px]" style={{ color: muted }}>Your tasks arrive below once you start.</span>
                      </div>
                    )}
                  </>);
                })()}

                {/* Questions section */}
                {currentLes.requirements.length > 0 && !showGateButton && (
                  <>
                    <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }} />

                    {currentLes.requirements.map((req, qi) => {
                      // Messages arrive sequentially: a requirement only appears once
                      // everything before it is settled -- done (or owing nothing, as an
                      // optional unclaimed share does) AND the manager has finished
                      // replying. Review shows the whole conversation at once; preview
                      // sequences like a student and offers a skip instead.
                      if (!reviewMode && qi > 0 && !currentLes.requirements.slice(0, qi).every(reqSettled)) return null;
                      return (
                        <div key={req.id} id={`ve-req-${req.id}`} className="scroll-mt-20" style={{ borderRadius: 16 }}>
                          <RequirementItem req={req} qi={qi} ctx={reqCtx} />
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
          {/* Wide screens: the to-do list sits beside the mission and stays in view while scrolling. */}
          {showTodo && todoItems.length > 0 && (
            <div className="hidden 2xl:block w-64 flex-shrink-0 self-start sticky top-3 pt-3">
              <MissionTodo variant="rail" items={todoItems} pendingCount={todoPending} isDark={isDark}
                accentColor={accentColor} text={text} muted={muted} onJump={jumpTo} />
            </div>
          )}
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}
