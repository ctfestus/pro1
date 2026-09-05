'use client';

import { useState, useCallback, useRef } from 'react';
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, ChevronRight, ChevronLeft,
  Loader2, Lock, Upload as UploadIcon, Link as LinkIcon, CheckCircle, Download, Eye,
  Paperclip, Send, Reply, X, AlertTriangle, Check, SkipForward,
} from 'lucide-react';
import { XpBadgeStack } from '@/components/XpBadge';
import { clampLinkedInSharePoints } from '@/lib/course-schema';
import { supabase } from '@/lib/supabase';
import { sanitizeRichText, sanitizeEmailContent } from '@/lib/sanitize';
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
import {
  Person, AttachmentCard, ArrivalIndicator, arrivalKindFor, companyDomain, personEmail, firstNameOf,
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

// -- Types ---

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
  company?: string;
  role?: string;
  industry?: string;
  modules: Module[];
  dataset?: Dataset;
  [key: string]: any;
}
type Progress = Record<string, { completed: boolean; notes?: string; selectedAnswer?: string; fileUrl?: string; linkUrl?: string; aiPassed?: boolean; aiFeedback?: string; aiScore?: number; aiErrored?: boolean }>;

interface Props {
  formId: string;
  config: ProjectConfig;
  userId: string;
  studentName: string;
  studentEmail: string;
  sessionToken: string;
  assignmentId?: string;
  initialProgress?: Progress;
  isDark?: boolean;
  onComplete: (submission?: any) => void;
  previewMode?: boolean;
  groupId?: string;
  participants?: string[];
  canSubmit?: boolean;
  graded?: boolean;
  submitted?: boolean;
}

// -- Helpers ---

// Lesson percentage comes from the shared rule so the player, the progress route and the
// assignment-completion route cannot disagree about what "done" means.
function lessonPct(lesson: Lesson, progress: Progress): number {
  return lessonCompletionPct(lesson, progress);
}

import { safeEmbedUrl as getEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { HtmlEmbedFrame } from '@/components/HtmlEmbedFrame';

function normalize(s: string) { return s.toLowerCase().replace(/\s+/g, ' ').trim(); }


// -- Component ---

export default function AssignmentExperiencePlayer({
  formId, config, userId, studentName, studentEmail, sessionToken, assignmentId = '', initialProgress = {}, isDark = false, onComplete, previewMode = false, groupId, participants, canSubmit = true, graded = false, submitted = false,
}: Props) {
  const accent = '#00b95c';
  const modules = config.modules || [];

  // Simulated workplace identities for the mail/chat surfaces.
  const workDomain = companyDomain(config.company, config.title);
  const manager: Person = {
    name:  config.guideSnapshot?.fullName || config.managerName || 'Project Manager',
    title: config.guideSnapshot?.professionalTitle || config.managerTitle || 'Project Lead',
    email: personEmail(config.guideSnapshot?.fullName || config.managerName || 'Project Manager', workDomain),
    avatarUrl: config.guideSnapshot?.profilePhotoUrl,
    company: config.guideSnapshot?.company || config.company,
    bio: config.guideSnapshot?.bio,
    linkedinUrl: config.guideSnapshot?.linkedinUrl,
    expertise: config.guideSnapshot?.expertise,
    color: '#3b82f6',
  };
  const meEmail  = personEmail(studentName || 'me', workDomain);
  const teamChannel = channelFor(config.role);

  // Theme tokens
  const bg       = isDark ? '#1E1F26' : 'white';
  const border   = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
  const shadow   = isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.06)';
  const text     = isDark ? '#f0f0f0' : '#111';
  const muted    = isDark ? '#aaa' : '#555';
  const faint    = isDark ? '#666' : '#999';
  const subtle   = isDark ? '#2a2b34' : '#fafafa';
  const fieldBg = isDark ? 'rgba(255,255,255,0.055)' : '#ffffff';
  const fieldBorder = isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1';
  const fieldShadow = isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)';
  const barBg    = isDark ? 'rgba(255,255,255,0.08)' : '#eee';
  const divider  = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const optionBg = isDark ? '#2a2b34' : 'white';
  const prevBtnBg   = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const prevBtnText = isDark ? '#ccc' : '#333';

  const [progress,      setProgress]      = useState<Progress>(initialProgress ?? {});
  const [activeModule,  setActiveModule]  = useState(modules[0]?.id ?? '');
  const [activeLesson,  setActiveLesson]  = useState(modules[0]?.lessons[0]?.id ?? '');
  const [saving,        setSaving]        = useState(false);
  const [uploadingReq,  setUploadingReq]  = useState<string | null>(null);
  const [uploadErrors,   setUploadErrors]   = useState<Record<string, string>>({});
  // linkedin_share deliverables: draft URL per requirement, plus claim state.
  const [shareDrafts,   setShareDrafts]   = useState<Record<string, string>>({});
  const [shareSaving,   setShareSaving]   = useState<string | null>(null);
  const [shareErrors,   setShareErrors]   = useState<Record<string, string>>({});
  const [shareCopied,   setShareCopied]   = useState<string | null>(null);
  // Set when the server has no LinkedIn profile to check a post's author against.
  const [needsProfile,  setNeedsProfile]  = useState<string | null>(null);
  const [profileDraft,  setProfileDraft]  = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError,  setProfileError]  = useState('');
  // "done" means the assignment was actually SUBMITTED, not merely that all requirements are
  // locally complete. Deriving it from progress used to show a false "submitted" screen (and hide
  // the submit button) for students who finished the work but never clicked Complete.
  const [done,          setDone]          = useState(() => submitted);
  const [reviewBeforeSubmit, setReviewBeforeSubmit] = useState(false);
  const [reviewMode,    setReviewMode]    = useState(false);
  const [expandedMods,  setExpandedMods]  = useState<Set<string>>(new Set([modules[0]?.id]));
  // Mission content is read first, then a "Continue to Tasks" click reveals the
  // tasks/deliverables below (hidden until then). Once continued, the content
  // collapses into a re-readable toggle rather than disappearing.
  const [continuedLessons, setContinuedLessons] = useState<Set<string>>(new Set());
  const [contentExpanded,  setContentExpanded]  = useState<Set<string>>(new Set());
  // Review is read-only and exists only after grading. Pre-grading behaviour is unchanged.
  const readOnly = graded;
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
  const [aiReviewing,     setAiReviewing]     = useState<Record<string, boolean>>({});
  // `errored: true` marks a review that never actually ran (validation / rate-limit / server /
  // network) - shown as a neutral "could not review" state, never a pass/fail grade.
  const [aiFeedback,      setAiFeedback]      = useState<Record<string, { passed: boolean; feedback: string; score: number; errored?: boolean } | null>>({});
  async function getAuthHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // Same rule the server uses. Counting Object.values(progress) instead would include stale
  // entries for deleted requirements, and counting every requirement would let a skipped
  // optional share hold the bar below 100% and keep Complete disabled forever.
  const overallCounts = veCompletionCounts(modules, progress);
  const totalReqs = overallCounts.totalReqs;
  const doneReqs  = overallCounts.doneReqs;
  const overallPct = totalReqs ? Math.round((doneReqs / totalReqs) * 100) : 100;
  const canComplete = isVeComplete(overallCounts);

  const currentMod = modules.find(m => m.id === activeModule);
  const currentLes = currentMod?.lessons.find(l => l.id === activeLesson);
  const embedUrl   = currentLes?.videoUrl ? getEmbedUrl(currentLes.videoUrl) : null;

  const flatLessons = modules.flatMap(m => m.lessons.map(l => ({ modId: m.id, lesson: l })));
  const currentIdx  = flatLessons.findIndex(x => x.lesson.id === activeLesson);
  const prevEntry   = currentIdx > 0 ? flatLessons[currentIdx - 1] : null;
  const nextEntry   = currentIdx < flatLessons.length - 1 ? flatLessons[currentIdx + 1] : null;
  // Review and preview both move between missions freely; a student does not.
  const navUnlocked = reviewMode || previewMode;

  // The requirement the preview skip control acts on: the first one still owed, and only once it
  // has actually arrived on screen. While an earlier manager reply is still animating, the step
  // after it is hidden, so offering a skip then would let a click land on something never seen.
  // Mirrors the sequential-arrival test in the requirement list exactly.
  const nextBlockingReq = (() => {
    const reqs = currentLes?.requirements || [];
    const arrivedBy = (upto: number) => reqs.slice(0, upto).every(r =>
      (!reqCountsForCompletion(r, progress) || progress[r.id]?.completed)
      && !typingAcks.has(r.id) && !typingDecisions.has(r.id) && !efTyping[r.id]
    );
    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      if (!reqCountsForCompletion(r, progress) || progress[r.id]?.completed) continue;
      const busy = typingAcks.has(r.id) || typingDecisions.has(r.id) || !!efTyping[r.id];
      return arrivedBy(i) && !busy ? r : null;
    }
    return null;
  })();

  // Preview only: mark a requirement done in memory so the conversation moves on. Never persisted
  // -- saveProgress already returns early in preview, so nothing is written.
  const skipReqInPreview = (reqId: string) => {
    if (!previewMode) return;
    setProgress(prev => ({ ...prev, [reqId]: { ...prev[reqId], completed: true } }));
  };

  const lessonLocked = (lesson: Lesson, modId: string) => {
    if (navUnlocked) return false;
    const idx = flatLessons.findIndex(x => x.lesson.id === lesson.id);
    if (idx === 0) return false;
    const prev = flatLessons[idx - 1];
    return lessonPct(prev.lesson, progress) < 100;
  };

  const saveProgress = useCallback(async (prog: Progress) => {
    if (previewMode || readOnly || !formId || formId === 'preview' || !userId || userId === 'preview') return;
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch('/api/guided-project-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
          body: JSON.stringify({ formId, userId, progress: prog, currentModuleId: activeModule, currentLessonId: activeLesson, assignmentId: assignmentId || undefined }),
        });
        if (!res.ok) {
          let message = 'Progress was not saved. Please refresh and try again.';
          try {
            const json = await res.json();
            if (json?.error) message = json.error;
          } catch {}
          setSaveError(message);
        }
      } finally { setSaving(false); }
    }, 800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, userId, activeModule, activeLesson, sessionToken, readOnly, previewMode]);

  const updateProgress = useCallback((reqId: string, patch: Partial<Progress[string]>) => {
    setProgress(prev => {
      const next = { ...prev, [reqId]: { ...(prev[reqId] ?? { completed: false }), ...patch } };
      saveProgress(next);
      return next;
    });
  }, [saveProgress]);

  /**
   * Claim a LinkedIn post for a linkedin_share deliverable.
   *
   * Awaited rather than routed through the debounced saveProgress: only the server knows whether the
   * post is already claimed, and the requirement counts as complete only once it says so. The route
   * writes the progress entry itself, so we mirror its canonical URL.
   */
  async function submitShareLink(reqId: string) {
    const draft = (shareDrafts[reqId] ?? '').trim();
    if (!draft || readOnly || previewMode) return;
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
        headers: { 'Content-Type': 'application/json', ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
        body: JSON.stringify({
          action: 'claim-linkedin-share',
          veId: formId,
          requirementId: reqId,
          post_url: draft,
          assignmentId: assignmentId || undefined,
        }),
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
      setProgress(prev => ({ ...prev, [reqId]: { ...(prev[reqId] ?? { completed: false }), linkUrl: savedUrl, completed: true } }));
    } catch {
      setShareErrors(prev => ({ ...prev, [reqId]: 'Could not save your link. Please try again.' }));
    } finally {
      setShareSaving(null);
    }
  }

  /** Save the student's LinkedIn profile, then retry the claim it was blocking. */
  async function saveProfileAndRetry(reqId: string) {
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
  }

  // File upload for upload requirements
  async function handleFileUpload(reqId: string, file: File, noComplete?: boolean) {
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
      const path = `ve-submissions/${formId}/${userId}/${reqId}/${Date.now()}-${safeVeUploadName(file.name)}`;
      const { error } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
      updateProgress(reqId, { fileUrl: publicUrl, ...(noComplete ? {} : { completed: true }) });
    } catch (error: any) {
      setUploadErrors(prev => ({ ...prev, [reqId]: error?.message || 'Upload failed. Check your connection and try again.' }));
    } finally { setUploadingReq(null); }
  }

  function downloadDataset() {
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
  }

  function navigate(modId: string, lesId: string) {
    setActiveModule(modId);
    setActiveLesson(lesId);
    setExpandedMods(prev => new Set([...prev, modId]));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function continueToTasks(lessonId: string) {
    setContinuedLessons(prev => new Set([...prev, lessonId]));
  }

  function toggleContentExpanded(lessonId: string) {
    setContentExpanded(prev => {
      const next = new Set(prev);
      next.has(lessonId) ? next.delete(lessonId) : next.add(lessonId);
      return next;
    });
  }

  // The one place an assignment_submissions row gets created. Shared by the last-mission
  // "Complete" button and the all-missions-complete submit screen.
  async function submitAssignment() {
    if (previewMode) { setDone(true); onComplete(); return; }
    if (overallPct < 100) return;
    setCompleteError(null);
    clearTimeout(saveTimeout.current);
    setSaving(true);
    try {
      const res = await fetch('/api/assignments/complete-ve-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
        body: JSON.stringify({ assignmentId, progress, currentModuleId: activeModule, currentLessonId: activeLesson, groupId: groupId || undefined, participants: participants?.length ? participants : undefined }),
      });
      let json: any = {};
      try { json = await res.json(); } catch (_) {}
      if (!res.ok) {
        setCompleteError(json?.error || 'Failed to submit. Please try again.');
        return;
      }
      setDone(true);
      onComplete(json.submission);
    } catch (_) {
      setCompleteError('Failed to submit. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // After grading: read-only review only. The landing card offers a Review button;
  // entering review falls through to render the lessons read-only below.
  if (graded && !reviewMode) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(14,9,221,0.06)' }}>
        <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: accent }}/>
        <p className="text-base font-bold mb-1" style={{ color: accent }}>Experience Complete!</p>
        <p className="text-sm" style={{ color: muted }}>
          {canSubmit
            ? 'This submission has been graded.'
            : 'Your group submission has been graded.'}
        </p>
        <div className="flex items-center justify-center gap-2 mt-5">
          <button onClick={() => { setReviewMode(true); navigate(modules[0]?.id ?? '', modules[0]?.lessons[0]?.id ?? ''); }}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
            style={{ background: `${accent}12`, color: accent, border: 'none', cursor: 'pointer' }}>
            {canSubmit ? 'Review submission' : 'Review group submission'}
          </button>
        </div>
      </div>
    );
  }

  // Pre-grading behaviour -- unchanged.
  if (!graded && done) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(14,9,221,0.06)' }}>
        <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: accent }}/>
        <p className="text-base font-bold mb-1" style={{ color: accent }}>Experience Complete!</p>
        <p className="text-sm" style={{ color: muted }}>All missions finished. Your assignment has been submitted.</p>
      </div>
    );
  }

  if (!graded && !canSubmit && overallPct >= 100) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(14,9,221,0.06)' }}>
        <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: accent }}/>
        <p className="text-base font-bold mb-1" style={{ color: accent }}>Ready for Group Submission</p>
        <p className="text-sm" style={{ color: muted }}>You have completed your preparation. Your group leader will submit the final work.</p>
      </div>
    );
  }

  // All missions complete but not yet submitted (solo). Surface an explicit submit action so the
  // student can't get stuck thinking they are done -- group leaders keep the in-flow Complete button.
  if (!graded && canSubmit && !groupId && overallPct >= 100 && !reviewBeforeSubmit) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
        <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: accent }}/>
        <p className="text-base font-bold mb-1" style={{ color: text }}>All missions complete</p>
        <p className="text-sm mb-5" style={{ color: muted }}>Submit your assignment to send it to your instructor for grading.</p>
        {completeError && <p className="text-sm mb-3" style={{ color: '#ef4444' }}>{completeError}</p>}
        <div className="flex items-center justify-center gap-2">
          <button onClick={submitAssignment} disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: '#10b981', color: 'white', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle className="w-4 h-4"/>} Submit assignment
          </button>
          <button onClick={() => setReviewBeforeSubmit(true)} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-80 disabled:opacity-50"
            style={{ background: `${accent}12`, color: accent, border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>
            Review my missions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Review-mode banner */}
      {reviewMode && (
        <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: `${accent}10`, border: `1px solid ${accent}25` }}>
          <span className="text-xs font-semibold" style={{ color: accent }}>
            {canSubmit ? 'Reviewing your submission (read-only)' : 'Reviewing the group submission (read-only)'}
          </span>
          <button onClick={() => setReviewMode(false)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
            style={{ background: accent, color: 'white', border: 'none', cursor: 'pointer' }}>
            Exit review
          </button>
        </div>
      )}

      {/* Preview banner: staff walking the experience. Everything below renders exactly as a
          student sees it, so the only thing worth saying is what preview changes. */}
      {previewMode && !reviewMode && (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3" style={{ background: `${accent}10`, border: `1px solid ${accent}25` }}>
          <Eye className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accent }} />
          <span className="text-xs font-semibold" style={{ color: accent }}>
            Preview. This is the student view. Nothing is saved, every mission is open, and you can skip any step.
          </span>
        </div>
      )}

      {/* Progress bar */}
      <div className="rounded-2xl p-4" style={{ background: bg, border: `1px solid ${border}`, boxShadow: shadow }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: muted }}>Overall Progress</span>
          <div className="flex items-center gap-2">
            {saving && <span className="text-[11px]" style={{ color: faint }}>Saving...</span>}
            <span className="text-xs font-bold" style={{ color: accent }}>{overallPct}%</span>
          </div>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: barBg }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${overallPct}%`, background: accent }}/>
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: faint }}>{doneReqs} of {totalReqs} tasks complete</p>
        {config.dataset && (
          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${divider}` }}>
            <button onClick={downloadDataset}
              className="flex items-center gap-2 text-xs font-semibold py-2 px-3 rounded-xl transition-all hover:opacity-80"
              style={{ background: `${accent}12`, color: accent }}>
              <Download className="w-3.5 h-3.5 flex-shrink-0"/>
              <span className="truncate">{config.dataset.filename || 'Download dataset'}</span>
            </button>
            {config.dataset.description && (
              <p className="text-[11px] mt-1.5 px-1" style={{ color: faint }}>{config.dataset.description}</p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* Sidebar -- module/lesson accordion */}
        <div className="rounded-2xl overflow-hidden" style={{ background: bg, border: `1px solid ${border}`, boxShadow: shadow, alignSelf: 'start' }}>
          {modules.map((mod, mi) => {
            const expanded = expandedMods.has(mod.id);
            const modDone  = mod.lessons.every(l => lessonPct(l, progress) === 100);
            return (
              <div key={mod.id} style={{ borderBottom: mi < modules.length - 1 ? `1px solid ${divider}` : 'none' }}>
                {/* Module header */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  onClick={() => setExpandedMods(prev => {
                    const n = new Set(prev);
                    n.has(mod.id) ? n.delete(mod.id) : n.add(mod.id);
                    return n;
                  })}
                >
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: modDone ? `${accent}15` : isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)' }}>
                    {modDone ? <CheckCircle2 style={{ width: 14, height: 14, color: accent }}/> : <span className="text-[9px] font-bold" style={{ color: faint }}>{mi + 1}</span>}
                  </div>
                  <span className="flex-1 text-[13px] font-semibold leading-snug" style={{ color: text }}>{mod.title}</span>
                  {expanded ? <ChevronUp style={{ width: 14, height: 14, color: faint }}/> : <ChevronDown style={{ width: 14, height: 14, color: faint }}/>}
                </button>

                {/* Lessons */}
                {expanded && (
                  <div style={{ borderTop: `1px solid ${divider}` }}>
                    {mod.lessons.map((les, li) => {
                      const locked  = lessonLocked(les, mod.id);
                      const pct     = lessonPct(les, progress);
                      const isActive = les.id === activeLesson;
                      return (
                        <button key={les.id}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
                          disabled={locked}
                          style={{ background: isActive ? `${accent}08` : 'none', border: 'none', cursor: locked ? 'not-allowed' : 'pointer', borderLeft: isActive ? `2px solid ${accent}` : '2px solid transparent' }}
                          onClick={() => !locked && navigate(mod.id, les.id)}
                        >
                          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                            {locked
                              ? <Lock style={{ width: 11, height: 11, color: faint }}/>
                              : pct === 100
                              ? <CheckCircle2 style={{ width: 13, height: 13, color: accent }}/>
                              : <Circle style={{ width: 13, height: 13, color: isDark ? '#555' : '#ccc' }}/>}
                          </div>
                          <span className="flex-1 text-[12.5px] leading-snug truncate" style={{ color: locked ? faint : isActive ? accent : muted, fontWeight: isActive ? 600 : 400 }}>{les.title}</span>
                          {!locked && pct > 0 && pct < 100 && (
                            <span className="text-[10px] font-bold flex-shrink-0" style={{ color: accent }}>{pct}%</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Main content */}
        <div className="space-y-4">
          {currentLes ? (() => {
              // Mission content is read first; "Continue to Tasks" reveals the
              // tasks/deliverables below. Skipped for review/graded and for a
              // lesson that's already fully done, where everything shows. Preview
              // keeps it: it is part of what a student sees.
              const hasContent = !!(currentLes.doc || currentLes.body);
              const hasReqs = currentLes.requirements.length > 0;
              const lessonDone = lessonPct(currentLes, progress) === 100;
              const gateActive = !reviewMode && !readOnly && hasContent && hasReqs && !lessonDone;
              const hasContinued = continuedLessons.has(currentLes.id);
              const showGateButton = gateActive && !hasContinued;
              const isCollapsible = gateActive && hasContinued;
              const isContentExpanded = !isCollapsible || contentExpanded.has(currentLes.id);
              return (
            <div className="rounded-2xl overflow-hidden" style={{ background: bg, border: `1px solid ${border}`, boxShadow: shadow }}>
              {/* Lesson title */}
              <div className="px-6 py-5 border-b" style={{ borderColor: divider }}>
                <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: accent }}>{currentMod?.title}</p>
                <h2 className="text-base font-bold" style={{ color: text }}>{currentLes.title}</h2>
              </div>

              {/* Video */}
              {embedUrl && (
                <div className="px-6 pt-5">
                  {isHtmlEmbedUrl(embedUrl) ? (
                    <div className="rounded-xl overflow-hidden">
                      <HtmlEmbedFrame src={embedUrl} />
                    </div>
                  ) : (
                    <div className="rounded-xl overflow-hidden" style={embedUrl.includes('canva.com') ? { height: '80vh' } : { aspectRatio: '16/9', background: '#000' }}>
                      <iframe src={embedUrl} className="w-full h-full" allowFullScreen allow="autoplay; fullscreen"/>
                    </div>
                  )}
                </div>
              )}

              {/* Body */}
              {hasContent && (() => {
                const bodyContent = currentLes.doc ? (
                  <LessonRenderer key={currentLes.id} doc={currentLes.doc} isDark={isDark} accentColor={accent} />
                ) : (
                  <div className="rich-content text-sm leading-relaxed" style={{ color: isDark ? '#ccc' : '#333' }}
                    dangerouslySetInnerHTML={{ __html: sanitizeRichText(currentLes.body) }}/>
                );
                return isCollapsible ? (
                  <div style={{ borderTop: `1px solid ${divider}` }}>
                    <button onClick={() => toggleContentExpanded(currentLes.id)}
                      className="w-full flex items-center gap-2 px-6 py-3 text-left hover:opacity-70 transition-opacity">
                      {isContentExpanded ? <ChevronDown className="w-3.5 h-3.5" style={{ color: faint }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: faint }} />}
                      <span className="text-[11px] font-semibold" style={{ color: faint }}>
                        Mission content{!isContentExpanded ? ' (click to reread)' : ''}
                      </span>
                    </button>
                    {isContentExpanded && <div className="px-6 pb-5">{bodyContent}</div>}
                  </div>
                ) : (
                  <div className="px-6 py-5">{bodyContent}</div>
                );
              })()}

              {showGateButton && (
                <div className="px-6 pb-6 flex justify-center" style={{ borderTop: `1px solid ${divider}` }}>
                  <button onClick={() => continueToTasks(currentLes.id)}
                    className="flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-[14px] transition-all hover:opacity-90"
                    style={{ background: accent, color: 'white' }}>
                    Continue to Tasks <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Requirements */}
              {currentLes.requirements.length > 0 && !showGateButton && (
                <div style={{ borderTop: `1px solid ${divider}` }}>
                  <div className="px-6 py-4">
                    <p className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: faint }}>Tasks</p>
                    <div className="space-y-6">
                      {currentLes.requirements.map((req, qi) => {
                        const prog    = progress[req.id];
                        const isDone  = prog?.completed ?? false;
                        const stamp   = workStamp(currentIdx, qi, req.id);

                        // Messages arrive sequentially: a requirement only appears once
                        // everything before it is done AND the manager has finished
                        // replying (review shows the whole conversation at once; preview
                        // sequences like a student and offers a skip instead).
                        // An optional, unclaimed share must not hold back the requirements after it.
                        if (!readOnly && qi > 0 && !currentLes.requirements.slice(0, qi).every(r =>
                          (!reqCountsForCompletion(r, progress) || progress[r.id]?.completed)
                          && !typingAcks.has(r.id) && !typingDecisions.has(r.id) && !efTyping[r.id]
                        )) return null;

                        // Scenario update - team chat surface
                        if (req.type === 'scenario_update') {
                          const subject = req.label || 'Project update';
                          const acknowledge = () => {
                            updateProgress(req.id, { completed: true });
                            setTypingAcks(prev => new Set([...prev, req.id]));
                            startTypingSound(2200);
                            anchorZone(req.id);
                            setTimeout(() => {
                              setTypingAcks(prev => { const n = new Set(prev); n.delete(req.id); return n; });
                              anchorZone(req.id);
                            }, 2500);
                          };
                          return (
                            <div key={req.id}>
                              <ChatCard isDark={isDark} reqId={req.id} company={config.company} channel={teamChannel}
                                members={[manager]} unread={!isDone} muteArrival={readOnly}>
                                <ChatMsg isDark={isDark} author={manager} time={stamp.time}
                                  reactions={
                                    !isDone && !readOnly ? (
                                      <ChatReaction isDark={isDark} accent={accent} emoji={'👍'} onClick={acknowledge} />
                                    ) : isDone ? (
                                      <ChatReaction isDark={isDark} accent={accent} emoji={'👍'} count={1} active disabled />
                                    ) : null
                                  }>
                                  <p style={{ margin: 0 }}>{subject}</p>
                                  {req.description && <p style={{ margin: '4px 0 0', opacity: 0.75 }}>{req.description}</p>}
                                </ChatMsg>
                                {isDone && (
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

                        // Manager brief - full mail-client reader with smart replies
                        if (req.type === 'briefing') {
                          const subject = req.label || `${currentLes?.title || 'Mission'} brief`;
                          const briefAttachments: MailAttachment[] = [
                            ...(req.attachments || []).map(a => ({ name: a.name, url: a.url })),
                            ...(config.dataset ? [{ name: config.dataset.filename || 'dataset.csv', onClick: downloadDataset }] : []),
                          ];
                          const acknowledge = (text: string) => {
                            updateProgress(req.id, { completed: true, notes: text });
                            setTypingAcks(prev => new Set([...prev, req.id]));
                            anchorZone(req.id);
                            setTimeout(() => {
                              setTypingAcks(prev => { const n = new Set(prev); n.delete(req.id); return n; });
                              anchorZone(req.id);
                            }, 2500);
                          };
                          return (
                            <div key={req.id}>
                              <MailCard isDark={isDark} accent={accent} reqId={req.id} subject={subject}
                                sender={manager} toName={studentName} toEmail={meEmail} stamp={stamp}
                                bodyHtml={req.description ? sanitizeEmailContent(applyNameTags(req.description, studentName)) : undefined}
                                attachments={briefAttachments.length ? briefAttachments : undefined} company={config.company}
                                done={isDone} muteArrival={readOnly}
                                chatAction={!readOnly ? {
                                  label: `Chat with ${firstNameOf(manager.name)}`,
                                  onClick: () => { setAskOpen(new Set([req.id])); setAskSeen(prev => new Set([...prev, req.id])); },
                                  attention: !askSeen.has(req.id),
                                } : undefined}>
                                <div style={{ padding: '14px 22px 18px' }}>
                                  {!isDone && !readOnly ? (
                                    <SmartReplies isDark={isDark} accent={accent}
                                      options={['Got it, starting now', 'On it, will update you soon', 'Received, thank you']}
                                      onPick={acknowledge} />
                                  ) : isDone ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                      <MailThreadMsg isDark={isDark} from="me" meName={studentName}
                                        time={typingAcks.has(req.id) ? 'Sending...' : 'Just now'}
                                        receipt={typingAcks.has(req.id) ? undefined : `Seen by ${firstNameOf(manager.name)} just now`}
                                        quote={req.description ? `On ${stamp.full}, ${manager.name} wrote: ${quoteSnippet(applyNameTags(req.description, studentName))}` : undefined}>
                                        {prog?.notes || 'Got it, starting now'}
                                      </MailThreadMsg>
                                      <div><MailStatusChip accent={accent}>Brief acknowledged</MailStatusChip></div>
                                    </div>
                                  ) : null}
                                  {!readOnly && (
                                    <BriefAskThread isDark={isDark} accent={accent} manager={manager} studentName={studentName}
                                      veId={formId} reqId={req.id}
                                      open={askOpen.has(req.id)}
                                      onOpenChange={o => setAskOpen(o ? new Set([req.id]) : new Set())} />
                                  )}
                                </div>
                              </MailCard>
                            </div>
                          );
                        }

                        // Decision point - team chat with block-kit buttons
                        if (req.type === 'decision') {
                          const selected = prog?.selectedAnswer ?? '';
                          const selectedIdx = selected ? (req.options ?? []).findIndex(opt => opt === selected) : -1;
                          const feedback = selectedIdx >= 0 ? req.optionFeedback?.[selectedIdx] : '';
                          const colleague: Person = { name: colleaguesFor(config.company || teamChannel, 1)[0], color: '#E8912D' };
                          const colleagueLine = ['Good call.', '+1, agreed.', 'Nice - that unblocks us.', 'Makes sense to me.'][hashStr(req.id) % 4];
                          const chooseDecision = (opt: string) => {
                            updateProgress(req.id, { selectedAnswer: opt, completed: true });
                            setTypingDecisions(prev => new Set([...prev, req.id]));
                            startTypingSound(2800);
                            anchorZone(req.id);
                            setTimeout(() => {
                              setTypingDecisions(prev => { const n = new Set(prev); n.delete(req.id); return n; });
                              anchorZone(req.id);
                            }, 3000);
                          };
                          return (
                            <div key={req.id}>
                              <ChatCard isDark={isDark} reqId={req.id} company={config.company} channel={teamChannel}
                                members={[manager]} unread={!isDone} muteArrival={readOnly}>
                                <ChatMsg isDark={isDark} author={manager} time={stamp.time}>
                                  <p style={{ margin: 0 }}>{req.label}</p>
                                  {req.description && <p style={{ margin: '4px 0 0', opacity: 0.75 }}>{req.description}</p>}
                                  {!isDone && (
                                    <ChatDecisionButtons isDark={isDark} accent={accent}
                                      options={(req.options ?? []).filter(Boolean)}
                                      onPick={chooseDecision} disabled={readOnly} />
                                  )}
                                </ChatMsg>
                                {isDone && selected && (
                                  <ChatThread isDark={isDark}
                                    label={typingDecisions.has(req.id) ? '1 reply in thread' : '3 replies in thread'}>
                                    <ChatMsg isDark={isDark} author="me" meName={studentName} time="Just now">
                                      {selected}
                                    </ChatMsg>
                                    {typingDecisions.has(req.id) ? (
                                      <ChatTypingMsg isDark={isDark} author={manager} />
                                    ) : (
                                      <>
                                        <ChatMsg isDark={isDark} author={manager} time="Just now">
                                          {feedback || `Noted, ${firstNameOf(studentName)}. Keep moving forward.`}
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

                        // Mission debrief - mail thread with reply composer
                        if (req.type === 'debrief') {
                          const val = prog?.notes ?? '';
                          const debriefSubject = req.label || `Re: ${currentLes?.title || 'Mission'}`;
                          const hasContent = val.replace(/<[^>]*>/g, '').trim().length > 0;
                          const replyOpen = isDone || openReplies.has(req.id) || hasContent;
                          return (
                            <div key={req.id}>
                              <MailCard isDark={isDark} accent={accent} reqId={req.id} subject={debriefSubject}
                                sender={manager} toName={studentName} toEmail={meEmail} stamp={stamp}
                                bodyHtml={req.description ? sanitizeEmailContent(applyNameTags(req.description, studentName)) : undefined}
                                company={config.company} done={isDone} muteArrival={readOnly}>
                                {!isDone ? (
                                  !replyOpen ? (
                                    <div style={{ padding: '14px 22px' }}>
                                      {!readOnly && (
                                        <button
                                          onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 18, border: `1px solid ${border}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: text, cursor: 'pointer' }}>
                                          <Reply className="w-4 h-4" /> Reply
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <div style={{ padding: '14px 22px 18px' }}>
                                      <MailComposer isDark={isDark} accent={accent} to={manager} subject={debriefSubject}
                                        value={val} onChange={(html) => updateProgress(req.id, { notes: html })} canSend={hasContent}
                                        onSend={() => { if (!hasContent) return; updateProgress(req.id, { notes: val, completed: true }); anchorZone(req.id); }}
                                        onDiscard={() => { updateProgress(req.id, { notes: '' }); setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; }); }} />
                                    </div>
                                  )
                                ) : (
                                  <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    <MailThreadMsg isDark={isDark} from="me" meName={studentName}
                                      receipt={`Seen by ${firstNameOf(manager.name)} just now`}
                                      quote={req.description ? `On ${stamp.full}, ${manager.name} wrote: ${quoteSnippet(applyNameTags(req.description, studentName))}` : undefined}>
                                      <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(val) }} />
                                    </MailThreadMsg>
                                    <div><MailStatusChip accent={accent}>Reply sent to {manager.name}</MailStatusChip></div>
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
                          const efAttachments: MailAttachment[] = (req.attachments || []).map(a => ({ name: a.name, url: a.url }));
                          const efCard = (children: React.ReactNode) => (
                            <div key={req.id}>
                              <MailCard isDark={isDark} accent={accent} reqId={req.id} subject={efSubject}
                                sender={manager} toName={studentName} toEmail={meEmail} stamp={stamp}
                                bodyHtml={(req.emailBody || req.description) ? sanitizeEmailContent(applyNameTags(req.emailBody || req.description || '', studentName)) : undefined}
                                attachments={efAttachments.length ? efAttachments : undefined}
                                company={config.company} done={isDone} muteArrival={readOnly} signatureAfterChildren>
                                {children}
                              </MailCard>
                            </div>
                          );

                          // MCQ: options as reply choices
                          if (req.type === 'mcq') {
                            const selected = prog?.selectedAnswer ?? '';
                            const answered = !!selected;
                            const correct = answered && req.correctAnswer ? normalize(selected) === normalize(req.correctAnswer) : false;
                            const isWrong = answered && !correct;
                            return efCard(
                              !isDone ? (
                                <div style={{ padding: '16px 22px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: isDark ? '#6b7075' : '#9aa0a6', margin: '0 0 4px' }}>Reply with your answer</p>
                                  {(req.options || []).map((opt, oi) => {
                                    const letter = oi + 1;
                                    const isSelected = selected === opt;
                                    const isThisWrong = isSelected && isWrong;
                                    const bgCol = isThisWrong ? 'rgba(239,68,68,0.06)' : isSelected ? `${accent}08` : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)');
                                    return (
                                      <button key={oi}
                                        onClick={() => { if (readOnly || isDone) return; const c = opt === req.correctAnswer; updateProgress(req.id, { selectedAnswer: opt, completed: c }); anchorZone(req.id); }}
                                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, border: `1px solid ${isThisWrong ? 'rgba(239,68,68,0.4)' : isSelected ? `${accent}55` : 'transparent'}`, background: bgCol, textAlign: 'left', cursor: 'pointer', fontSize: 14, color: text, transition: 'all 0.15s', width: '100%' }}>
                                        <span style={{ flex: 1 }}>{opt}</span>
                                        <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: isThisWrong ? '#ef4444' : isSelected ? accent : faint }}>{letter}</span>
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
                                    {selected}
                                  </MailThreadMsg>
                                  <div><MailStatusChip accent={accent}>Correct</MailStatusChip></div>
                                </div>
                              )
                            );
                          }

                          // Text / Reflection: reply-composer thread with optional AI evaluation
                          if (req.type === 'text' || req.type === 'reflection') {
                            const val = prog?.notes ?? '';
                            const hasContent = val.replace(/<[^>]*>/g, '').trim().length > 0;
                            const rounds = efRounds[req.id] || [];
                            const replyOpen = isDone || openReplies.has(req.id) || hasContent || rounds.length > 0;
                            const needsEval = !!(req.aiReview || req.expectedAnswer);
                            // Evaluation always completes the requirement (pass or fail is never a
                            // gate), so `isDone` alone can't tell us whether to show the verdict or
                            // a fresh composer. This flag lets a student who clicked "Reply" after
                            // seeing feedback bypass the permanently-true `isDone` state.
                            const wantsNewReply = needsEval && openReplies.has(req.id);
                            const isTyping = efTyping[req.id];
                            const isReviewing = efReviewing[req.id];
                            // AI verdict is persisted (aiPassed/aiFeedback/aiScore) so a reload can
                            // rebuild the feedback block and its Reply button - without this, a
                            // refreshed page only knows "completed", not what the manager said.
                            const persistedFeedback = prog?.aiErrored
                              ? { passed: false, feedback: prog?.aiFeedback || 'We could not complete an AI review of your response. Please try again.', score: 0, errored: true }
                              : prog?.aiFeedback
                              ? { passed: !!prog?.aiPassed, feedback: prog.aiFeedback, score: prog?.aiScore ?? 0 }
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
                            const sentText = efPending[req.id] || prog?.notes || '';
                            const efMeReply = (
                              <div style={{ marginBottom: 18 }}>
                                <MailThreadMsg isDark={isDark} from="me" meName={studentName}>
                                  <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(sentText) }} />
                                </MailThreadMsg>
                              </div>
                            );
                            const handleSend = async () => {
                              if (!hasContent) return;
                              if (!needsEval) {
                                updateProgress(req.id, { notes: val, completed: true });
                                anchorZone(req.id);
                                return;
                              }
                              const delay = 2000 + Math.floor(Math.random() * 2001);
                              setEfTyping(prev => ({ ...prev, [req.id]: true }));
                              setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; });
                              anchorZone(req.id);
                              if (req.aiReview) {
                                // AI evaluation path: always marks done (informational feedback)
                                setAiReviewing(prev => ({ ...prev, [req.id]: true }));
                                setAiFeedback(prev => ({ ...prev, [req.id]: null }));
                                const authH = await getAuthHeader();
                                fetch('/api/ve-answer-review', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', ...authH },
                                  body: JSON.stringify({ veId: formId, reqId: req.id, studentAnswer: val }),
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
                                    updateProgress(req.id, { notes: val, completed: true, aiErrored: undefined, aiPassed: passed, aiFeedback: fb, aiScore: score });
                                  } else {
                                    // The answer was never actually evaluated (validation / rate limit /
                                    // server error). Record a distinct error state - never a pass/fail grade.
                                    // Progression is intentionally NOT blocked (completed stays true); the
                                    // persisted error marker lets a reload rebuild "could not review" + Try again.
                                    const fb = json.error || 'We could not complete an AI review of your response right now. Please edit your answer if needed and try again.';
                                    setAiFeedback(prev => ({ ...prev, [req.id]: { passed: false, feedback: fb, score: 0, errored: true } }));
                                    updateProgress(req.id, { notes: val, completed: true, aiErrored: true, aiPassed: undefined, aiFeedback: fb, aiScore: undefined });
                                  }
                                })
                                .catch(() => {
                                  // Network/parse failure - same distinct error state; progression stays open.
                                  const fb = 'We could not complete an AI review of your response right now due to a temporary issue. Please try again.';
                                  setAiFeedback(prev => ({ ...prev, [req.id]: { passed: false, feedback: fb, score: 0, errored: true } }));
                                  updateProgress(req.id, { notes: val, completed: true, aiErrored: true, aiPassed: undefined, aiFeedback: fb, aiScore: undefined });
                                })
                                .finally(() => setAiReviewing(prev => ({ ...prev, [req.id]: false })));
                                setTimeout(() => {
                                  setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                  setEfReviewing(prev => ({ ...prev, [req.id]: true }));
                                  anchorZone(req.id);
                                }, delay);
                              } else {
                                // Manual comparison: no answer revealed. A wrong attempt stays in the
                                // thread as a sent reply + manager response, and a fresh empty composer
                                // opens below - never edit the old message.
                                const attempt = val;
                                const normalizeText = (s: string) => s.replace(/<[^>]*>/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
                                const studentNorm = normalizeText(attempt);
                                const expectedNorm = normalizeText(req.expectedAnswer || '');
                                const passed = studentNorm === expectedNorm || studentNorm.includes(expectedNorm) || expectedNorm.includes(studentNorm);
                                setEfPending(prev => ({ ...prev, [req.id]: attempt }));
                                updateProgress(req.id, { notes: '' });
                                setTimeout(() => {
                                  setEfTyping(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                  setEfPending(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                  if (passed) {
                                    setEfReviewing(prev => ({ ...prev, [req.id]: true }));
                                    setAiFeedback(prev => ({ ...prev, [req.id]: { passed: true, score: 100, feedback: `That is correct, ${firstNameOf(studentName)}. Well done.` } }));
                                    updateProgress(req.id, { notes: attempt, completed: true });
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
                              ) : (isReviewing || (isDone && needsEval && !wantsNewReply)) ? (
                                <div style={{ padding: '16px 22px 20px' }}>
                                  {efMeReply}
                                  <div style={{ marginBottom: feedback ? 18 : 0 }}>
                                    <MailThreadMsg isDark={isDark} from={manager}>
                                      <p style={{ margin: '0 0 10px' }}>Thanks for your response, {firstNameOf(studentName)}. Let me review what you have written.</p>
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: evaluating ? subtle : `${accent}12`, color: evaluating ? faint : accent, border: `1px solid ${evaluating ? 'transparent' : accent + '30'}`, fontSize: 12.5 }}>
                                        {evaluating ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ display: 'inline' }} /> : fbErrored ? <AlertTriangle className="w-3.5 h-3.5" style={{ display: 'inline' }} /> : <CheckCircle2 className="w-3.5 h-3.5" style={{ display: 'inline' }} />}
                                        {evaluating ? 'Reviewing your answer...' : fbErrored ? 'Could not review' : 'Reviewed'}
                                      </div>
                                    </MailThreadMsg>
                                  </div>
                                  {feedback && fbTone && (
                                    <div style={{ borderTop: `1px solid ${divider}`, paddingTop: 18 }}>
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
                                      {!evaluating && !readOnly && !feedback.passed && (
                                        <button
                                          onClick={() => {
                                            // A real wrong answer is archived as a graded round and its draft
                                            // cleared; an errored (never-reviewed) attempt is neither, so the
                                            // student keeps their draft to fix and resend.
                                            if (!fbErrored) {
                                              setEfRounds(prev => ({ ...prev, [req.id]: [...(prev[req.id] || []), { me: sentText, feedback: feedback.feedback, passed: feedback.passed }] }));
                                              updateProgress(req.id, { notes: '' });
                                            }
                                            setAiFeedback(prev => ({ ...prev, [req.id]: null }));
                                            setEfReviewing(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                            setEfPending(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                            setOpenReplies(prev => new Set([...prev, req.id]));
                                          }}
                                          style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 18, border: `1px solid ${border}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: text, cursor: 'pointer' }}>
                                          <Reply className="w-4 h-4" /> {fbErrored ? 'Try again' : 'Reply'}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (isDone && !wantsNewReply) ? (
                                <div style={{ padding: '16px 22px 20px' }}>
                                  {efMeReply}
                                  <MailStatusChip accent={accent}>Reply sent to {efManager}</MailStatusChip>
                                </div>
                              ) : !replyOpen ? (
                                <div style={{ padding: '14px 22px' }}>
                                  {!readOnly && (
                                    <button onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 18, border: `1px solid ${border}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: text, cursor: 'pointer' }}>
                                      <Reply className="w-4 h-4" /> Reply
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div style={{ padding: '14px 22px 18px' }}>
                                  <MailComposer isDark={isDark} accent={accent} to={manager} subject={efSubject}
                                    value={val} onChange={(html) => updateProgress(req.id, { notes: html })} canSend={hasContent} onSend={handleSend}
                                    placeholder={rounds.length ? 'Write a new reply...' : 'Write your reply...'}
                                    maxChars={req.aiReview ? 2000 : undefined}
                                    onDiscard={() => { updateProgress(req.id, { notes: '' }); setOpenReplies(prev => { const n = new Set(prev); n.delete(req.id); return n; }); }} />
                                </div>
                              )}
                              </>
                            );
                          }

                          // Upload / Task / Deliverable: Reply attachment thread
                          if (req.type === 'upload' || req.type === 'task' || req.type === 'deliverable') {
                            const fileUrl = prog?.fileUrl ?? '';
                            const linkUrl = prog?.linkUrl ?? '';
                            const uploaded = !!(fileUrl || linkUrl);
                            const replyOpen = isDone || openReplies.has(req.id) || uploaded;
                            const uploading = uploadingReq === req.id;
                            const isTask = req.type === 'task';
                            const isDeliverable = req.type === 'deliverable';
                            const efManagerReply = isTask
                              ? `Got it, ${firstNameOf(studentName)} - noted. I have recorded that you have completed this task.`
                              : isDeliverable
                              ? `Thanks, ${firstNameOf(studentName)}. I will review your deliverable and get back to you shortly.`
                              : `Thanks for the submission, ${firstNameOf(studentName)}. It is under review - I will get back to you shortly.`;
                            return efCard(
                              (() => {
                                const isTyping = efTyping[req.id];
                                const showReply = !isTyping && (efReviewing[req.id] || isDone);
                                const efMeThread = (
                                  <div style={{ marginBottom: 18 }}>
                                    <MailThreadMsg isDark={isDark} from="me" meName={studentName}
                                      receipt={showReply ? `Seen by ${firstNameOf(manager.name)} just now` : undefined}>
                                      {isTask
                                        ? <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: subtle, border: `1px solid ${border}`, fontSize: 12.5, color: text }}><CheckCircle2 className="w-3 h-3" /> Task marked as done</div>
                                        : (
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                            {fileUrl && (
                                              <AttachmentCard isDark={isDark} href={fileUrl}
                                                name={(() => { try { return decodeURIComponent(fileUrl.split('/').pop()?.split('?')[0] || ''); } catch { return ''; } })() || (isDeliverable ? 'Deliverable' : 'Attachment')} />
                                            )}
                                            {linkUrl && <a href={linkUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: subtle, border: `1px solid ${border}`, fontSize: 12.5, color: text, textDecoration: 'none' }}><LinkIcon className="w-3 h-3" /> {linkUrl.slice(0, 40)}{linkUrl.length > 40 ? '...' : ''}</a>}
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
                                    if (!readOnly) updateProgress(req.id, { completed: true });
                                    anchorZone(req.id);
                                  }, delay);
                                };
                                if (!isDone && !isTyping && !efReviewing[req.id]) return (
                                  isTask ? (
                                    // Task: single "I am done" button, no file upload
                                    <div style={{ padding: '14px 22px' }}>
                                      {!readOnly && (
                                        <button onClick={handleEfSend}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 20px', borderRadius: 6, border: `1px solid ${accent}`, background: `${accent}12`, fontSize: 13.5, fontWeight: 600, color: accent, cursor: 'pointer' }}>
                                          <CheckCircle2 className="w-4 h-4" /> I am done with this task
                                        </button>
                                      )}
                                    </div>
                                  ) : !replyOpen ? (
                                    // Upload / Deliverable: open-compose button
                                    <div style={{ padding: '14px 22px' }}>
                                      {!readOnly && (
                                        <button onClick={() => setOpenReplies(prev => new Set([...prev, req.id]))}
                                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 18px', borderRadius: 6, border: `1px solid ${border}`, background: 'transparent', fontSize: 13.5, fontWeight: 600, color: text, cursor: 'pointer' }}>
                                          <Paperclip className="w-4 h-4" /> {isDeliverable ? 'Submit deliverable' : 'Attach your work'}
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    // Compose: attach file / paste link
                                    <div style={{ padding: '14px 22px 18px' }}>
                                      <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
                                        <div style={{ padding: '8px 14px', background: subtle, borderBottom: `1px solid ${divider}`, fontSize: 12, color: faint }}>
                                          {isDeliverable ? 'Attach your deliverable' : 'Attach your file'}
                                        </div>
                                        <div style={{ padding: '14px 16px', background: bg, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 10, border: `1.5px dashed ${fileUrl ? `${accent}80` : fieldBorder}`, background: fileUrl ? `${accent}08` : fieldBg, boxShadow: fieldShadow, cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 13, color: fileUrl ? accent : muted }}>
                                            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                                            {uploading ? 'Uploading...' : (fileUrl ? 'Replace file' : 'Attach file')}
                                            <input type="file" accept={VE_SUBMISSION_ACCEPT} className="hidden" disabled={uploading} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; await handleFileUpload(req.id, file, true); e.target.value = ''; }} />
                                          </label>
                                          {uploadErrors[req.id] && <p role="alert" style={{ margin: '8px 0 0', color: '#ef4444', fontSize: 12 }}>{uploadErrors[req.id]}</p>}
                                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <input value={linkUrl} onChange={e => updateProgress(req.id, { linkUrl: e.target.value })}
                                              placeholder="Or paste a link..." style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1.5px solid ${fieldBorder}`, background: fieldBg, boxShadow: fieldShadow, color: text, fontSize: 13, outline: 'none' }} />
                                          </div>
                                          {(fileUrl || linkUrl) && (
                                            <button onClick={handleEfSend}
                                              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 20px', borderRadius: 6, background: accent, color: '#fff', fontSize: 13.5, fontWeight: 600, border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}>
                                              <Send className="w-3.5 h-3.5" /> {isDeliverable ? 'Submit deliverable' : 'Submit'}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                );
                                if (isTyping) return (
                                  <div style={{ padding: '16px 22px 20px' }}>
                                    {efMeThread}
                                    <MailTypingRow isDark={isDark} person={manager} />
                                  </div>
                                );
                                if (showReply) return (
                                  <div style={{ padding: '16px 22px 20px' }}>
                                    {efMeThread}
                                    <MailThreadMsg isDark={isDark} from={manager}>
                                      <p style={{ margin: '0 0 10px' }}>{efManagerReply}</p>
                                      <MailStatusChip accent={accent}>{isTask ? 'Noted' : 'Received'}</MailStatusChip>
                                    </MailThreadMsg>
                                  </div>
                                );
                                return null;
                              })()
                            );
                          }

                          // AI review types: full email thread
                          if (req.type === 'dashboard_critique' || req.type === 'code_review' || req.type === 'excel_review' || req.type === 'document_review') {
                            const saved = prog;
                            const savedReport = parseReviewNotes(saved?.notes)?.report;
                            const typeLabel = req.type === 'dashboard_critique' ? 'dashboard' : req.type === 'code_review' ? 'code' : req.type === 'excel_review' ? 'Excel file' : 'document';
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
                                {!isDone && !efTyping[req.id] && !efReviewing[req.id] && (
                                  <div style={{ padding: '14px 22px 18px' }}>
                                    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: isDark ? '#6b7075' : '#9aa0a6', margin: '0 0 10px' }}>
                                      {req.type === 'dashboard_critique' ? 'Attach your dashboard for review' : req.type === 'code_review' ? 'Paste or upload your code' : req.type === 'excel_review' ? 'Upload your Excel file' : 'Upload your document'}
                                    </p>
                                    {req.type === 'dashboard_critique' && (
                                      <DashboardCritiquePlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={false}
                                        savedResult={undefined} savedImageUrl={undefined} rubric={(req as any).rubric}
                                        onReviewStart={startReview} onReviewError={onReviewError}
                                        onComplete={(result) => { finishReview(); updateProgress(req.id, { completed: true, notes: buildReviewNotes('dashboard_critique', result, saved?.notes) }); }} />
                                    )}
                                    {req.type === 'code_review' && (
                                      <CodeReviewPlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={false}
                                        savedResult={undefined} rubric={req.rubric} schema={req.schema} minScore={req.minScore}
                                        onReviewStart={startReview} onReviewError={onReviewError}
                                        onComplete={(result, passed) => { finishReview(); updateProgress(req.id, { completed: passed, notes: buildReviewNotes('code_review', result, saved?.notes) }); }} />
                                    )}
                                    {req.type === 'excel_review' && (
                                      <ExcelReviewPlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={false}
                                        savedResult={undefined} context={req.context} rubric={req.rubric} minScore={req.minScore}
                                        onReviewStart={startReview} onReviewError={onReviewError}
                                        onComplete={(result, passed) => { finishReview(); updateProgress(req.id, { completed: passed, notes: buildReviewNotes('excel_review', result, saved?.notes) }); }} />
                                    )}
                                    {req.type === 'document_review' && (
                                      <DocumentReviewPlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={false}
                                        context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode}
                                        onComplete={(result, passed) => updateProgress(req.id, { completed: passed, notes: buildReviewNotes('document_review', result, saved?.notes) })} />
                                    )}
                                  </div>
                                )}
                                {/* Manager typing dots */}
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
                                {/* Received reply -- persists into done state so both replies stack */}
                                {!efTyping[req.id] && (efReviewing[req.id] || isDone) && (
                                  <div style={{ padding: '16px 22px 20px' }}>
                                    <div style={{ marginBottom: 18 }}>
                                      <MailThreadMsg isDark={isDark} from="me" meName={studentName} time="Earlier"
                                        receipt={`Seen by ${firstNameOf(manager.name)}`}>
                                        Submitted my {typeLabel} for review.
                                      </MailThreadMsg>
                                    </div>
                                    <MailThreadMsg isDark={isDark} from={manager}>
                                      <p style={{ margin: '0 0 10px' }}>Thanks, {firstNameOf(studentName)} - I have received your {typeLabel} and it is currently under review. I will get back to you shortly.</p>
                                      {!isDone && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, fontSize: 12.5 }}>
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: accent }} /> AI is reviewing your {typeLabel}...
                                        </div>
                                      )}
                                      {isDone && <MailStatusChip accent={accent}>Review complete</MailStatusChip>}
                                    </MailThreadMsg>
                                  </div>
                                )}
                                {/* Manager report -- separate section below, appears once AI finishes */}
                                {isDone && (
                                  <div style={{ padding: '16px 22px 20px', borderTop: `1px solid ${divider}` }}>
                                    <MailThreadMsg isDark={isDark} from={manager}>
                                      <p style={{ margin: '0 0 4px' }}>Hi {firstNameOf(studentName)},</p>
                                      <p style={{ margin: '0 0 18px' }}>Thanks for sending over your {typeLabel}. I have completed the review - please find my detailed feedback below.</p>
                                      <div style={{ background: subtle, borderRadius: 10, padding: 16, border: `1px solid ${border}` }}>
                                        {req.type === 'dashboard_critique' && savedReport && (
                                          <DashboardCritiquePlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={true}
                                            savedResult={savedReport as any} savedImageUrl={undefined} rubric={(req as any).rubric} onComplete={() => {}} />
                                        )}
                                        {req.type === 'code_review' && (() => { const r = isFullReport('code_review', savedReport) ? savedReport : undefined; return (
                                          <CodeReviewPlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={true}
                                            savedResult={r as any} rubric={req.rubric} schema={req.schema} minScore={req.minScore} onComplete={() => {}} />
                                        ); })()}
                                        {req.type === 'excel_review' && (() => { const r = isFullReport('excel_review', savedReport) ? savedReport : undefined; return (
                                          <ExcelReviewPlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={true}
                                            savedResult={r as any} context={req.context} rubric={req.rubric} minScore={req.minScore} onComplete={() => {}} />
                                        ); })()}
                                        {req.type === 'document_review' && (() => { const r = isFullReport('document_review', savedReport) ? savedReport : undefined; return (
                                          <DocumentReviewPlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={true}
                                            savedResult={r as any} context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode} onComplete={() => {}} />
                                        ); })()}
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

                        // MCQ
                        if (req.type === 'mcq') {
                          const selected = prog?.selectedAnswer ?? '';
                          const answered = !!selected;
                          const correct  = answered && req.correctAnswer ? normalize(selected) === normalize(req.correctAnswer) : false;
                          return (
                            <div key={req.id} className="space-y-3">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                  style={{ background: `${accent}12`, color: accent }}>MCQ</span>
                                <div>
                                  <p className="text-sm font-semibold" style={{ color: text }}>{req.label}</p>
                                  {req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}
                                </div>
                                {isDone && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 ml-auto" style={{ color: accent }}/>}
                              </div>
                              <div className="space-y-2">
                                {(req.options ?? []).map((opt, oi) => {
                                  const isSelected = selected === opt;
                                  const isCorrect  = req.correctAnswer && normalize(opt) === normalize(req.correctAnswer);
                                  const showResult = answered;
                                  return (
                                    <button key={`${req.id}-opt-${oi}`} disabled={isDone || readOnly}
                                      className="w-full text-left px-4 py-3 rounded-xl text-sm transition-all flex items-center gap-3"
                                      style={{
                                        border: 'none',
                                        background: showResult && isSelected ? (isCorrect ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.06)') : isSelected ? `${accent}08` : (isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'),
                                        color: showResult && isSelected ? (isCorrect ? '#10b981' : '#ef4444') : text,
                                        cursor: isDone || readOnly ? 'default' : 'pointer',
                                      }}
                                      onClick={() => {
                                        if (isDone || readOnly) return;
                                        const isC = req.correctAnswer ? normalize(opt) === normalize(req.correctAnswer) : false;
                                        updateProgress(req.id, { selectedAnswer: opt, completed: isC });
                                      }}
                                    >
                                      <span className="flex-1">{opt}</span>
                                      <span className="text-[13px] font-bold flex-shrink-0 tabular-nums" style={{ color: showResult && isSelected ? (isCorrect ? '#10b981' : '#ef4444') : isSelected ? accent : faint }}>{oi + 1}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              {answered && !isDone && (
                                <p className="text-xs" style={{ color: '#ef4444' }}>Incorrect -- try again.</p>
                              )}
                            </div>
                          );
                        }

                        // Text
                        if (req.type === 'text') {
                          const val = prog?.notes ?? '';
                          return (
                            <div key={req.id} className="space-y-2">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                  style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: muted }}>Answer</span>
                                <div className="flex-1">
                                  <p className="text-sm font-semibold" style={{ color: text }}>{req.label}</p>
                                  {req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}
                                </div>
                                {isDone && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }}/>}
                              </div>
                              <textarea
                                value={val}
                                readOnly={readOnly}
                                onChange={e => updateProgress(req.id, { notes: e.target.value, completed: !!e.target.value.trim() })}
                                placeholder="Type your answer here..."
                                rows={4}
                                className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
                                style={{ border: `1.5px solid ${isDone ? `${accent}80` : fieldBorder}`, background: isDone ? `${accent}08` : fieldBg, boxShadow: fieldShadow, color: text }}
                              />
                            </div>
                          );
                        }

                        // LinkedIn post share
                        if (req.type === 'linkedin_share') {
                          // Clamped with the server's own helper rather than rendered raw: an imported,
                          // synced or hand-edited VE can carry any number, and advertising 999,999 XP for a
                          // claim that will award 200 is a promise the server does not keep.
                          const bonus   = clampLinkedInSharePoints(req.sharePoints);
                          const claimed = prog?.linkUrl ?? '';
                          const draft   = shareDrafts[req.id] ?? claimed;
                          const saving  = shareSaving === req.id;
                          const error   = shareErrors[req.id];
                          return (
                            <div key={req.id} className="space-y-3">
                              <div className="flex items-start gap-2.5">
                                <span className="flex-shrink-0 flex items-center justify-center rounded-lg mt-0.5"
                                  style={{ width: 30, height: 30, background: '#0A66C2' }}>
                                  <LinkedInIcon className="w-4 h-4" style={{ color: '#fff' }} />
                                </span>
                                <div className="flex-1">
                                  <p className="text-sm font-semibold flex items-center gap-2" style={{ color: text }}>
                                    {req.label}
                                    {req.shareRequired !== true && (
                                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0"
                                        style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: muted }}>
                                        Optional
                                      </span>
                                    )}
                                  </p>
                                  {req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}
                                </div>
                                {isDone && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: accent }}/>}
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
                                    <p className="text-[12px] leading-snug mt-0.5" style={{ color: muted }}>
                                      Your work is out in front of your network. That is how opportunities find you.
                                    </p>
                                  </div>
                                </div>
                              ) : bonus > 0 ? (
                                <div className="flex items-center gap-3 rounded-xl px-3.5 py-3"
                                  style={{ background: `${accent}12` }}>
                                  <XpBadgeStack size={60} className="flex-shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-[15px] font-bold leading-tight" style={{ color: accent }}>
                                      {`${bonus.toLocaleString()} XP up for grabs`}
                                    </p>
                                    <p className="text-[12px] leading-snug mt-0.5" style={{ color: muted }}>
                                      Post about what you built, then paste the link below to claim it.
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                                  style={{ background: `${accent}10` }}>
                                  <Eye className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accent }}/>
                                  <p className="text-[12px] leading-snug" style={{ color: muted }}>
                                    Real work, shared publicly. This is the part hiring managers actually see.
                                  </p>
                                </div>
                              )}

                              {req.sharePrompt && (
                                <div className="rounded-xl p-3.5" style={{ background: subtle, border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}` }}>
                                  <div className="flex items-center justify-between gap-3 mb-1.5">
                                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: faint }}>Suggested post</p>
                                    <button type="button"
                                      onClick={() => {
                                        navigator.clipboard?.writeText(req.sharePrompt || '').then(() => {
                                          setShareCopied(req.id);
                                          setTimeout(() => setShareCopied(null), 1800);
                                        }).catch(() => {});
                                      }}
                                      className="px-2.5 py-1.5 rounded-md text-[11.5px] font-semibold transition-all active:scale-[0.97]"
                                      style={{ border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)'}`, color: text }}>
                                      {shareCopied === req.id ? 'Copied' : 'Copy'}
                                    </button>
                                  </div>
                                  <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: muted }}>{req.sharePrompt}</p>
                                </div>
                              )}

                              <a href="https://www.linkedin.com/feed/?shareActive=true" target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] hover:opacity-90"
                                style={{ background: '#0A66C2', color: '#fff' }}>
                                <LinkedInIcon className="w-4 h-4" /> Write my post
                              </a>

                              <div className="space-y-1.5">
                                <p className="text-xs font-medium" style={{ color: muted }}>Paste the link to your post</p>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  {/* Input owns the border and radius so the global focus ring (an outline on
                                      the input) follows its rounded corners instead of drawing a sharp
                                      rectangle inside a bordered wrapper. */}
                                  <div className="flex-1 min-w-0 relative">
                                    <LinkIcon className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: isDark ? '#8a8a8a' : '#64748b' }}/>
                                    <input type="url" inputMode="url" value={draft} readOnly={readOnly}
                                      placeholder="https://www.linkedin.com/posts/..."
                                      className="w-full min-w-0 pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none"
                                      style={{
                                        border: `1.5px solid ${error ? '#f43f5e' : claimed ? `${accent}80` : isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1'}`,
                                        background: isDark ? 'rgba(255,255,255,0.055)' : '#ffffff',
                                        boxShadow: isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)',
                                        color: text,
                                      }}
                                      onChange={e => {
                                        setShareDrafts(prev => ({ ...prev, [req.id]: e.target.value }));
                                        if (shareErrors[req.id]) setShareErrors(prev => { const n = { ...prev }; delete n[req.id]; return n; });
                                      }}
                                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitShareLink(req.id); } }}/>
                                  </div>
                                  {!readOnly && (
                                    <button type="button"
                                      onClick={() => submitShareLink(req.id)}
                                      disabled={saving || !draft.trim() || draft.trim() === claimed}
                                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
                                      style={{ background: accent, color: '#fff' }}>
                                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : claimed ? 'Update' : 'Submit'}
                                    </button>
                                  )}
                                </div>
                                {/* Asked for once, when there is no profile to check the post's author
                                    against. Saving it retries the claim straight away. */}
                                {needsProfile === req.id && (
                                  <div className="rounded-xl p-3 space-y-2" style={{ background: subtle }}>
                                    <p className="text-xs font-semibold" style={{ color: text }}>
                                      First, add your LinkedIn profile
                                    </p>
                                    <p className="text-[11px] leading-relaxed" style={{ color: muted }}>
                                      We check that the post you paste was written by you, so we need to know which profile is yours. This is saved to your profile once.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                      <input
                                        type="url" inputMode="url" value={profileDraft}
                                        onChange={e => { setProfileDraft(e.target.value); if (profileError) setProfileError(''); }}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveProfileAndRetry(req.id); } }}
                                        placeholder="linkedin.com/in/your-name"
                                        className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-sm outline-none"
                                        style={{ border: `1.5px solid ${profileError ? '#f43f5e' : fieldBorder}`, background: fieldBg, boxShadow: fieldShadow, color: text }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => saveProfileAndRetry(req.id)}
                                        disabled={profileSaving || !profileDraft.trim()}
                                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
                                        style={{ background: accent, color: '#fff' }}
                                      >
                                        {profileSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : 'Save and submit'}
                                      </button>
                                    </div>
                                    {profileError && (
                                      <p className="text-[11.5px] font-medium flex items-start gap-1.5" style={{ color: '#f43f5e' }}>
                                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"/> {profileError}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {error && (
                                  <p className="text-[11.5px] font-medium flex items-start gap-1.5" style={{ color: '#f43f5e' }}>
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"/> {error}
                                  </p>
                                )}
                                {!error && claimed && (
                                  <a href={claimed} target="_blank" rel="noreferrer"
                                    className="text-[11.5px] font-semibold flex items-center gap-1.5 hover:underline" style={{ color: '#10b981' }}>
                                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0"/> Verified. View your post
                                  </a>
                                )}
                                {!error && !claimed && (
                                  <p className="text-[11px] leading-relaxed" style={{ color: faint }}>
                                    Open your post on LinkedIn, copy its full address, and paste it here. Shortened
                                    lnkd.in links cannot be checked.
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        }

                        // Upload
                        if (req.type === 'upload') {
                          const fileUrl = prog?.fileUrl;
                          const linkUrl = prog?.linkUrl ?? '';
                          const uploading = uploadingReq === req.id;
                          return (
                            <div key={req.id} className="space-y-3">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                  style={{ background: 'rgba(14,9,221,0.08)', color: accent }}>Upload</span>
                                <div className="flex-1">
                                  <p className="text-sm font-semibold" style={{ color: text }}>{req.label}</p>
                                  {req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}
                                </div>
                                {isDone && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }}/>}
                              </div>
                              <label className="flex flex-col items-center gap-2 rounded-xl py-6 transition-all"
                                style={{ border: `1.5px dashed ${fileUrl ? `${accent}80` : fieldBorder}`, background: fileUrl ? `${accent}08` : fieldBg, boxShadow: fieldShadow, cursor: readOnly ? 'default' : 'pointer' }}>
                                {uploading
                                  ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: accent }}/>
                                  : fileUrl
                                  ? <CheckCircle2 className="w-5 h-5" style={{ color: accent }}/>
                                  : <UploadIcon className="w-5 h-5" style={{ color: faint }}/>}
                                <p className="text-xs font-medium text-center" style={{ color: fileUrl ? accent : muted }}>
                                  {uploading ? 'Uploading...' : fileUrl ? (readOnly ? 'Uploaded' : 'Uploaded. Click to replace.') : readOnly ? 'No file uploaded' : 'Click to upload your file'}
                                </p>
                                {fileUrl && <a href={fileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[11px] underline" style={{ color: accent }}>View file</a>}
                                <input type="file" accept={VE_SUBMISSION_ACCEPT} className="hidden" disabled={readOnly} onChange={async e => { const f = e.target.files?.[0]; if (f) await handleFileUpload(req.id, f); e.target.value = ''; }}/>
                              </label>
                              {uploadErrors[req.id] && <p role="alert" className="text-[12px] flex items-center gap-1.5" style={{ color: '#ef4444' }}><AlertTriangle className="w-3.5 h-3.5" />{uploadErrors[req.id]}</p>}
                              <div className="ve-field-shell flex items-center gap-2 px-3 py-2.5 rounded-xl"
                                style={{ border: `1.5px solid ${linkUrl ? `${accent}80` : fieldBorder}`, background: fieldBg, boxShadow: fieldShadow }}>
                                <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: faint }}/>
                                <input type="url" value={linkUrl} readOnly={readOnly} placeholder="Or paste a link..."
                                  className="flex-1 bg-transparent text-sm outline-none"
                                  style={{ color: text }}
                                  onChange={e => updateProgress(req.id, { linkUrl: e.target.value, completed: !!e.target.value.trim() })}/>
                              </div>
                            </div>
                          );
                        }

                        // Task / Deliverable / Reflection -- lightweight completion row
                        if (['task', 'deliverable', 'reflection'].includes(req.type)) {
                          return (
                            <button key={req.id}
                              disabled={readOnly}
                              className="flex items-start gap-3 w-full text-left"
                              style={{ cursor: readOnly ? 'default' : 'pointer' }}
                              onClick={() => { if (readOnly) return; updateProgress(req.id, { completed: !isDone }); }}>
                              <span className="flex-shrink-0 mt-0.5 pointer-events-none" aria-hidden="true">
                                {isDone
                                  ? <CheckCircle2 className="w-5 h-5" style={{ color: accent }}/>
                                  : <Circle className="w-5 h-5" style={{ color: accent, opacity: 0.55 }}/>
                                }
                              </span>
                              <div className="flex-1">
                                <p className="text-sm font-semibold" style={{ color: text }}>{req.label}</p>
                                {req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}
                                {!isDone && !readOnly && (
                                  <p className="text-[11.5px] mt-1 font-semibold" style={{ color: accent, opacity: 0.8 }}>Click to mark as done</p>
                                )}
                              </div>
                            </button>
                          );
                        }

                        // Dashboard Critique
                        if (req.type === 'dashboard_critique') {
                          const saved = progress[req.id];
                          return (
                            <div key={req.id} className="space-y-3">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                  style={{ background: `${accent}12`, color: accent }}>AI Critique</span>
                                <div className="flex-1">
                                  <p className="text-sm font-semibold" style={{ color: text }}>{req.label}</p>
                                  {req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}
                                </div>
                                {isDone && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }}/>}
                              </div>
                              <DashboardCritiquePlayer
                                reqId={req.id}
                                isDark={isDark}
                                accentColor={accent}
                                completed={isDone || readOnly}
                                savedResult={parseReviewNotes(saved?.notes)?.report}
                                rubric={req.rubric}
                                onComplete={(result) => updateProgress(req.id, { completed: true, notes: buildReviewNotes('dashboard_critique', result, saved?.notes) })}
                              />
                            </div>
                          );
                        }

                        // Code Review
                        if (req.type === 'code_review') {
                          const saved = progress[req.id];
                          const savedReport = parseReviewNotes(saved?.notes)?.report;
                          const savedResult = isFullReport('code_review', savedReport) ? savedReport : undefined;
                          return (
                            <div key={req.id} className="space-y-3">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                  style={{ background: `${accent}12`, color: accent }}>AI Code Review</span>
                                <div className="flex-1">
                                  <p className="text-sm font-semibold" style={{ color: text }}>{req.label}</p>
                                  {req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}
                                </div>
                                {isDone && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }}/>}
                              </div>
                              <CodeReviewPlayer
                                reqId={req.id}
                                isDark={isDark}
                                accentColor={accent}
                                completed={isDone || readOnly}
                                savedResult={savedResult}
                                rubric={req.rubric}
                                schema={req.schema}
                                minScore={req.minScore}
                                onComplete={(result, passed) => {
                                  updateProgress(req.id, { completed: passed, notes: buildReviewNotes('code_review', result, saved?.notes) });
                                }}
                              />
                            </div>
                          );
                        }

                        // Excel Review
                        if (req.type === 'excel_review') {
                          const saved = progress[req.id];
                          const savedReport = parseReviewNotes(saved?.notes)?.report;
                          const savedResult = isFullReport('excel_review', savedReport) ? savedReport : undefined;
                          return (
                            <div key={req.id} className="space-y-3">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                                  style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>AI Excel Review</span>
                                <div className="flex-1">
                                  <p className="text-sm font-semibold" style={{ color: text }}>{req.label}</p>
                                  {req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}
                                </div>
                                {isDone && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accent }}/>}
                              </div>
                              <ExcelReviewPlayer
                                reqId={req.id}
                                isDark={isDark}
                                accentColor={accent}
                                completed={isDone || readOnly}
                                savedResult={savedResult}
                                rubric={req.rubric}
                                context={req.context}
                                minScore={req.minScore}
                                onComplete={(result, passed) => {
                                  updateProgress(req.id, { completed: passed, notes: buildReviewNotes('excel_review', result, saved?.notes) });
                                }}
                              />
                            </div>
                          );
                        }

                        if (req.type === 'document_review') {
                          const saved = progress[req.id];
                          const savedReport = parseReviewNotes(saved?.notes)?.report;
                          return (
                            <div key={req.id} className="space-y-3">
                              <div className="flex items-start gap-2"><span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5" style={{ background: `${accent}12`, color: accent }}>AI Document Review</span><div className="flex-1"><p className="text-sm font-semibold" style={{ color: text }}>{req.label}</p>{req.description && <p className="text-xs mt-0.5" style={{ color: muted }}>{req.description}</p>}</div></div>
                              <DocumentReviewPlayer reqId={req.id} isDark={isDark} accentColor={accent} completed={isDone || readOnly}
                                savedResult={isFullReport('document_review', savedReport) ? savedReport as any : undefined} context={req.context} rubric={req.rubric} minScore={req.minScore} documentReviewMode={req.documentReviewMode}
                                onComplete={(result, passed) => updateProgress(req.id, { completed: passed, notes: buildReviewNotes('document_review', result, saved?.notes) })} />
                            </div>
                          );
                        }


                        return null;
                      })}

                      {/* Incoming-message indicator: the rest of the conversation arrives as work gets done */}
                      {!readOnly && (() => {
                        const reqs = currentLes.requirements;
                        const settled = (r: Requirement) => !!progress[r.id]?.completed && !typingAcks.has(r.id) && !typingDecisions.has(r.id) && !efTyping[r.id];
                        let visibleEnd = reqs.length;
                        for (let i = 1; i < reqs.length; i++) {
                          if (!reqs.slice(0, i).every(settled)) { visibleEnd = i; break; }
                        }
                        const hiddenCount = reqs.length - visibleEnd;
                        if (hiddenCount <= 0) return null;
                        return (
                          <ArrivalIndicator isDark={isDark} accent={accent} manager={manager}
                            hiddenCount={hiddenCount} nextKind={arrivalKindFor(reqs[visibleEnd])} />
                        );
                      })()}

                      {/* Preview only: step past work whose submit path needs a real attempt (a
                          file upload, an AI review, a LinkedIn claim). Without this the sequence
                          stalls and the rest of the mission stays hidden. In memory only. */}
                      {previewMode && !reviewMode && !readOnly && nextBlockingReq && (
                        <div className="flex items-center gap-3 flex-wrap pt-2">
                          <button onClick={() => skipReqInPreview(nextBlockingReq.id)}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12.5px] font-semibold transition-all hover:opacity-80"
                            style={{ background: `${accent}18`, color: accent, border: 'none', cursor: 'pointer' }}>
                            <SkipForward className="w-3.5 h-3.5" /> Skip this step
                          </button>
                          <span className="text-[12px]" style={{ color: muted }}>
                            Preview only. Skipping reveals what a student sees next and is not saved.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Prev / Next navigation */}
              {saveError && (
                <div className="mx-6 mb-0 mt-0 px-4 py-3 rounded-xl text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>
                  {saveError}
                </div>
              )}
              {completeError && (
                <div className="mx-6 mb-0 mt-0 px-4 py-3 rounded-xl text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>
                  {completeError}
                </div>
              )}
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderTop: `1px solid ${divider}` }}>
                <button
                  disabled={!prevEntry}
                  onClick={() => prevEntry && navigate(prevEntry.modId, prevEntry.lesson.id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-30"
                  style={{ background: prevBtnBg, color: prevBtnText, border: 'none', cursor: prevEntry ? 'pointer' : 'not-allowed' }}>
                  <ChevronLeft className="w-4 h-4"/> Previous
                </button>
                {nextEntry ? (
                  <button
                    disabled={!navUnlocked && lessonPct(currentLes, progress) < 100}
                    onClick={() => navigate(nextEntry.modId, nextEntry.lesson.id)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                    style={{ background: accent, color: 'white', border: 'none', cursor: !navUnlocked && lessonPct(currentLes, progress) < 100 ? 'not-allowed' : 'pointer' }}>
                    Next <ChevronRight className="w-4 h-4"/>
                  </button>
                ) : reviewMode ? (
                  <span/>
                ) : (
                  !canSubmit ? (
                  <button
                    disabled
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                    style={{ background: prevBtnBg, color: prevBtnText, border: 'none', cursor: 'not-allowed' }}>
                    Leader submits final work
                  </button>
                ) : (
                  <button
                    disabled={!canComplete || saving}
                    onClick={submitAssignment}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                    style={{ background: '#10b981', color: 'white', border: 'none', cursor: !canComplete || saving ? 'not-allowed' : 'pointer' }}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle className="w-4 h-4"/>} Complete
                  </button>
                  )
                )}
              </div>
            </div>
          );})() : (
            <div className="rounded-2xl p-8 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
              <p className="text-sm" style={{ color: faint }}>Select a lesson from the sidebar to begin.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
