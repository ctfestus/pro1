// The virtual experience editor's content shapes and option lists, shared by the page and its
// step and task components.

import { type ThemeColor } from '@/lib/theme-types';
import type { LessonDoc } from '@/lib/lesson-doc';
import type { CoverVideo } from '@/lib/course-schema';

// Types
export interface ReqAttachment { name: string; url: string; mimeType?: string; }
export interface Requirement {
  id: string;
  label: string;
  description: string;
  descriptionFormat?: 'rich';
  descriptionDoc?: LessonDoc;
  type: 'task' | 'deliverable' | 'reflection' | 'mcq' | 'text' | 'upload' | 'briefing' | 'scenario_update' | 'decision' | 'debrief' | 'dashboard_critique' | 'code_review' | 'excel_review' | 'document_review' | 'linkedin_share';
  options?: string[];
  optionFeedback?: string[];
  correctAnswer?: string;
  expectedAnswer?: string;
  rubric?: string[];
  schema?: string;
  reviewLanguage?: string;   // code_review: fixed language; unset = the learner chooses
  context?: string;
  reviewSheetNames?: string[];
  minScore?: number;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
  aiReview?: boolean;
  emailFrame?: boolean;
  emailBody?: string;
  attachments?: ReqAttachment[];
  accentColor?: string;   // task/deliverable: own color; unset follows the experience accent
  sharePrompt?: string;   // linkedin_share: suggested post text the student can copy
  // linkedin_share: only an explicit `true` gates the lesson. Absent/false = optional, never blocks.
  shareRequired?: boolean;
  // linkedin_share: bonus XP, clamped server-side to 0..MAX_LINKEDIN_SHARE_POINTS. ABSENT MEANS 0,
  // not the default amount -- requirements authored before VE shares paid XP must stay at zero
  // rather than silently start offering a bonus nobody chose. The editor writes the default
  // explicitly for newly created share requirements.
  sharePoints?: number;
}
export interface Lesson {
  id: string;
  title: string;
  body: string;           // sanitized HTML; lossy fallback when `doc` is present
  doc?: LessonDoc;        // canonical interactive-lesson content (TipTap/ProseMirror JSON)
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
export interface ProjectConfig {
  isVirtualExperience: true;
  // The experience's accent, as a course has one: a theme colour, or a custom colour that wins.
  theme?: ThemeColor;
  customAccent?: string;
  industry: string;
  difficulty: string;
  role: string;
  company: string;
  duration: string;
  tools: string[];
  /** Topics the experience covers (migration 248), shown on cards and the hover preview. */
  tags?: string[];
  // Legacy per-experience logo map. Nothing renders or edits it any more -- logos resolve by
  // name through the shared tool-icon registry, as a course's category does. It is still loaded
  // and saved so that saving an experience does not blank a column other tenants may still hold
  // data in; a later migration can drop it once that is confirmed everywhere.
  toolLogos?: Record<string, string>;
  tagline: string;
  description: string;
  background: string;
  coverImage: string;
  coverVideo?: CoverVideo | null;
  learnOutcomes: string[];
  modules: Module[];
  managerName?: string;
  managerTitle?: string;
  guideId?: string | null;
  guideSnapshot?: {
    fullName: string;
    professionalTitle?: string;
    company?: string;
    profilePhotoUrl?: string;
    linkedUserId?: string;
    sourceType?: 'external' | 'instructor';
    consentStatus?: 'pending' | 'confirmed' | 'not_required';
    bio?: string;
    linkedinUrl?: string;
    expertise?: string[];
  } | null;
  badgeImageUrl?: string | null;
  dataset?: { filename: string; description: string; csvContent?: string; url?: string };
}

export const INDUSTRIES = [
  { id: 'fintech',    label: 'Fintech' },
  { id: 'marketing',  label: 'Marketing' },
  { id: 'hr',         label: 'HR' },
  { id: 'finance',    label: 'Finance' },
  { id: 'edtech',     label: 'EdTech' },
  { id: 'healthcare', label: 'Healthcare' },
  { id: 'ecommerce',  label: 'E-commerce' },
  { id: 'consulting', label: 'Consulting' },
];

// Carousel sections for the step-2 editor
export const VE_SECTIONS = [
  // 'overview' is the Details tab: the experience card, then industry, duration and level, then
  // the cover image and badge. They were three tabs (Overview, Setup, Branding) for one subject.
  { id: 'overview',   label: 'Details' },
  { id: 'brief',      label: 'Brief' },
  { id: 'curriculum', label: 'Curriculum' },
  { id: 'delivery',   label: 'Publish' },
] as const;


export function uid() { return Math.random().toString(36).slice(2, 10); }

// The task types an author can pick, in the order the picker lists them. The older
// 'deliverable' type is offered only on a task that still has it.
export const TASK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'mcq', label: 'Multiple choice' }, { value: 'text', label: 'Short answer' }, { value: 'reflection', label: 'Reflection' },
  { value: 'upload', label: 'File upload' }, { value: 'task', label: 'Deliverable' }, { value: 'deliverable', label: 'Deliverable (older)' },
  { value: 'linkedin_share', label: 'LinkedIn share' }, { value: 'briefing', label: 'Manager email' }, { value: 'debrief', label: 'Email reply to manager' },
  { value: 'scenario_update', label: 'Team chat update' }, { value: 'decision', label: 'Team chat decision' },
  { value: 'dashboard_critique', label: 'AI review: dashboard' }, { value: 'code_review', label: 'AI review: code' },
  { value: 'excel_review', label: 'AI review: Excel' }, { value: 'document_review', label: 'AI review: document' },
];

// What each task type is called in the editor, matching the type list.
export const REQ_TYPE_NAMES: Record<string, string> = {
  mcq: 'Multiple choice', text: 'Short answer', reflection: 'Reflection', upload: 'File upload',
  task: 'Deliverable', deliverable: 'Deliverable', linkedin_share: 'LinkedIn share',
  briefing: 'Manager email', debrief: 'Email reply to manager', scenario_update: 'Team chat update',
  decision: 'Team chat decision', dashboard_critique: 'AI review: dashboard', code_review: 'AI review: code',
  excel_review: 'AI review: Excel', document_review: 'AI review: document',
};

// Quick picks under "Skills you will use", mirroring COURSE_CATEGORIES in the course editor.
// These are only shortcuts: any name can be typed, and its logo resolves through the shared
// tool-icon registry if one has been uploaded for it.
export const VE_TOOL_SUGGESTIONS = ['Excel', 'Power BI', 'SQL', 'Tableau', 'Python', 'PowerPoint'] as const;

/**
 * Skill names are free text typed inline, so a rename can leave a blank or a duplicate of another
 * row -- `addTool` guards against both, renaming cannot. Harmless in the editor, not on the
 * experience page: a blank renders an empty chip, and two rows sharing a name collide because the
 * chips are keyed by it. Trim, drop blanks, and dedupe case-insensitively, keeping the spelling
 * that appears first. Applied when a field loses focus and again on save, so nothing reaches the
 * database unnormalized even if focus never moved.
 */
export function normalizeToolList(tools: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tools ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
