import type React from 'react';
import type { LessonDoc } from '@/lib/lesson-doc';
import type { useAiReviewEntitlement } from '@/lib/use-ai-review-entitlement';
import type { Person } from '@/components/ve/workplace';

// Player-side shapes of a virtual experience, shared by VirtualExperienceTaker and the
// per-type requirement renderers in this folder.

export interface Requirement {
  id: string;
  label: string;
  description: string;
  descriptionFormat?: 'rich';
  descriptionDoc?: LessonDoc;
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
  // code_review: the language the instructor fixed for this task. Unset = the learner chooses.
  reviewLanguage?: string;
  context?: string;
  reviewSheetNames?: string[];
  minScore?: number;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
  aiReview?: boolean;
  emailFrame?: boolean;
  emailBody?: string;
  attachments?: Array<{ name: string; url: string; mimeType?: string }>;
  accentColor?: string;   // task/deliverable: own color; unset uses the player's accent
}
export interface Lesson {
  id: string;
  title: string;
  body: string;
  doc?: LessonDoc;
  videoUrl?: string;
  requirements: Requirement[];
}
export interface Module {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
  solutionVideo?: string;
}
export interface Dataset {
  filename: string;
  description: string;
  csvContent?: string;
  url?: string;
}
export interface ProjectConfig {
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

export type Progress = Record<string, { completed: boolean; notes?: string; selectedAnswer?: string; fileUrl?: string; linkUrl?: string; aiPassed?: boolean; aiFeedback?: string; aiScore?: number; aiErrored?: boolean }>;

// `errored: true` marks a review that never actually ran (validation / rate-limit / server /
// network) - it is shown as a neutral "could not review" state, never a pass/fail grade.
export type AiFeedbackEntry = { passed: boolean; feedback: string; score: number; errored?: boolean; upgradeUrl?: string } | null;

export const REQ_META: Record<string, { label: string; color: string; bg: string }> = {
  reflection:  { label: 'Reflection',  color: '#00b95c', bg: 'rgba(0,185,92,0.12)' },
  briefing:    { label: 'Manager Brief', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  scenario_update: { label: 'Scenario Update', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  decision:    { label: 'Decision', color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)' },
  debrief:     { label: 'Debrief', color: '#14b8a6', bg: 'rgba(20,184,166,0.12)' },
  linkedin_share: { label: 'LinkedIn Share', color: '#0A66C2', bg: 'rgba(10,102,194,0.12)' },
};

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

/**
 * Everything a requirement renderer reads from or does to the player. The player builds this once
 * per render and passes it down unchanged, so each renderer behaves exactly as it did when it was
 * inline in VirtualExperienceTaker.
 */
export interface VeRequirementContext {
  isDark: boolean;
  accentColor: string;
  fieldBg: string;
  fieldBorder: string;
  fieldShadow: string;
  config: ProjectConfig;
  manager: Person;
  meEmail: string;
  studentName: string;
  teamChannel: string;
  formId: string;
  authHeader: Record<string, string>;
  flatIdx: number;
  currentLes: Lesson | undefined;
  currentModId: string;
  currentLesId: string;
  reviewMode: boolean;
  entitlement: ReturnType<typeof useAiReviewEntitlement>;

  progress: Progress;
  setProgress: SetState<Progress>;
  saveProgress: (prog: Progress, modId: string, lesId: string, completedAt?: string) => void;
  noteValues: Record<string, string>;
  setNoteValues: SetState<Record<string, string>>;
  setNote: (reqId: string, notes: string) => void;
  toggleReq: (reqId: string) => void;
  downloadDataset: () => void;

  handleFileUpload: (reqId: string, file: File, noComplete?: boolean) => Promise<void>;
  setUploadLink: (reqId: string, linkUrl: string) => void;
  uploadingReq: string | null;
  uploadErrors: Record<string, string>;

  typingAcks: Set<string>;
  setTypingAcks: SetState<Set<string>>;
  typingDecisions: Set<string>;
  setTypingDecisions: SetState<Set<string>>;
  openReplies: Set<string>;
  setOpenReplies: SetState<Set<string>>;
  askOpen: Set<string>;
  setAskOpen: SetState<Set<string>>;
  askSeen: Set<string>;
  setAskSeen: SetState<Set<string>>;

  efReviewing: Record<string, boolean>;
  setEfReviewing: SetState<Record<string, boolean>>;
  efTyping: Record<string, boolean>;
  setEfTyping: SetState<Record<string, boolean>>;
  efRounds: Record<string, Array<{ me: string; feedback: string; passed: boolean }>>;
  setEfRounds: SetState<Record<string, Array<{ me: string; feedback: string; passed: boolean }>>>;
  efPending: Record<string, string>;
  setEfPending: SetState<Record<string, string>>;
  aiReviewing: Record<string, boolean>;
  setAiReviewing: SetState<Record<string, boolean>>;
  aiFeedback: Record<string, AiFeedbackEntry>;
  setAiFeedback: SetState<Record<string, AiFeedbackEntry>>;

  shareDrafts: Record<string, string>;
  setShareDrafts: SetState<Record<string, string>>;
  shareSaving: string | null;
  shareErrors: Record<string, string>;
  setShareErrors: SetState<Record<string, string>>;
  shareCopied: string | null;
  setShareCopied: SetState<string | null>;
  submitShareLink: (reqId: string) => Promise<void>;
  needsProfile: string | null;
  profileDraft: string;
  setProfileDraft: SetState<string>;
  profileSaving: boolean;
  profileError: string;
  setProfileError: SetState<string>;
  saveProfileAndRetry: (reqId: string) => Promise<void>;
}

export interface RequirementProps {
  req: Requirement;
  /** Position of the requirement in its mission; drives the simulated message time. */
  qi: number;
  /** Row container style the player picks from the requirement's surface. */
  rowStyle: React.CSSProperties;
  ctx: VeRequirementContext;
}
