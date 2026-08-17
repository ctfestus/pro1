// Single source of truth for the course / form content contract.
//
// Every authoring, persistence, and runtime surface (create page, FormEditor, CourseTaker,
// the forms API, sync/import routes) must use THESE types and THESE transforms so the shape
// can never drift between where content is written and where it is read.
//
// Canonical fields: `courseTimer` and `pointsSystem`. Legacy aliases (`timer`, `pointsEnabled`,
// `pointsBase`, and snake_case DB columns) are accepted ONLY on ingest, via normalizeFormConfig,
// and collapsed into the canonical shape. Never read the aliases downstream.

import type { ThemeColor, ThemeMode } from '@/lib/theme-types';
import type { LessonDoc } from '@/lib/lesson-doc';

export type { ThemeColor, ThemeMode };
export type { LessonDoc };

// --- Types ---

export type FieldType =
  | 'text' | 'email' | 'textarea' | 'number' | 'select' | 'phone' | 'company' | 'social' | 'description';

export interface FormField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  socialPlatforms?: string[];
  description?: string;
}

export type QuestionType =
  | 'multiple_choice' | 'fill_blank' | 'arrange' | 'image' | 'image_choice' | 'code'
  | 'code_review' | 'excel_review' | 'dashboard_critique' | 'sql_exercise' | 'document_review'
  | 'python_exercise' | 'written_response';

export interface DownloadItem {
  id: string;
  title: string;
  description?: string;
  fileUrl?: string;
  fileName?: string;
  linkUrl?: string;
  type: 'file' | 'link';
  pdfPages?: number;   // set when the uploaded file is a PDF, enables inline carousel
}

export interface CourseQuestion {
  id: string;
  type?: QuestionType;
  question: string;
  options: string[];          // MC: option text; arrange: items in correct order; fill_blank: []; image: ['0','1','2',...]
  correctAnswer: string;      // MC: option text; fill_blank: pipe-separated; arrange: options.join('|||'); image: index string
  explanation?: string;
  optionImages?: string[];    // image type only -- one base64 per option, same length as options
  imageUrl?: string;          // image_choice: a single prompt image shown above the text options
  skillAreaId?: string;       // certifications: maps this question to a CertificationConfig.skillAreas entry
  scenarioId?: string;        // certifications: attaches this question to a CertificationConfig.scenarios case study (shared stimulus)
  multiSelect?: boolean;      // multiple_choice/image_choice: more than one correct option (correctAnswer is '|||'-joined, order-independent)
  section?: 'technical' | 'practical';  // certifications: which exam section this question belongs to (Technical vs Practical/Case study)
  hint?: string;
  codeSnippet?: string;
  codeLanguage?: string;
  lessonOnly?: boolean;
  lockUntilPrevious?: boolean;
  isSection?: boolean;
  sectionTitle?: string;
  sectionDescription?: string;
  isDownloads?: boolean;
  downloadsTitle?: string;
  downloadsDescription?: string;
  downloadItems?: DownloadItem[];
  // LinkedIn share slide: the student pastes the URL of the post where they shared their work.
  // Non-graded (excluded from scoring like isSection/isDownloads) but earns bonus XP, awarded
  // server-side in /api/course complete-attempt only against a live claim in linkedin_shares.
  isLinkedInShare?: boolean;
  linkedInShareTitle?: string;
  linkedInShareDescription?: string;   // sanitized HTML
  linkedInSharePrompt?: string;        // suggested post text, offered to the student to copy
  linkedInSharePoints?: number;        // bonus XP; DEFAULT_LINKEDIN_SHARE_POINTS when unset
  // Only an explicit `true` gates the course. Absent/unset means optional, so a share slide added
  // without touching the toggle -- or written by any path that does not set the field -- cannot
  // strand a student who has no LinkedIn account behind a wall with no exemption path.
  linkedInShareRequired?: boolean;
  lesson?: {
    title?: string;
    body?: string;          // sanitized HTML; canonical for legacy lessons, lossy fallback when `doc` is present
    doc?: LessonDoc;        // canonical interactive-lesson content (TipTap/ProseMirror JSON); see lib/lesson-doc.ts
    imageUrl?: string;
    videoUrl?: string;
    pdfUrl?: string;
    pdfName?: string;
    pdfPages?: number;
    audioUrl?: string;      // standard media attachment: uploaded (Cloudinary) or a direct audio URL
    audioName?: string;
  };
  // AI review fields (code_review | excel_review | dashboard_critique | document_review | written_response)
  rubric?: string[];
  schema?: string;
  context?: string;
  minScore?: number;
  reviewLanguage?: string;
  documentReviewMode?: 'ai_only' | 'manual' | 'hybrid';
  // written_response: the student types a free-text answer and the AI grades it against `rubric`.
  // `expectedAnswer` is grounding for the reviewer (a model answer), never rendered to the student.
  expectedAnswer?: string;
  writtenMaxWords?: number;   // word ceiling on the answer; 0/unset = no limit
  sqlTables?: { id?: string; tableName: string; fileName?: string; fileUrl?: string; csvUrl?: string; seedSql?: string }[];
  sqlStarterCode?: string;
  sqlSolution?: string;
  sqlExpectedResult?: { columns: string[]; rows: unknown[][] };
  sqlHints?: string[];
  sqlResultOrdered?: boolean;
  sqlNumericTolerance?: number;
  sqlRequiredPatterns?: string[];
  // python_exercise fields
  pythonDatasets?: { id: string; variableName: string; fileName?: string; fileUrl?: string; csvUrl?: string }[];
  pythonStarterCode?: string;
  pythonSolution?: string;
  pythonExpectedOutput?: string;
  pythonHasExpectedOutput?: boolean;
  pythonSetupCode?: string;
  pythonHints?: string[];
  // Optional NON-GRADED runnable playground attached to any question (a SQL/Python scratchpad the
  // student runs to work out the answer). Carries no answer key, so it is safe to send to the client.
  playground?: {
    language?: 'sql' | 'python';
    setupSql?: string;        // SQL: seed tables (CREATE/INSERT) the student can query
    setupPython?: string;     // Python: code run once before the student's code
    starterCode?: string;     // initial code in the editor
    // SQL: uploaded CSV tables loaded into DuckDB (same shape as sql_exercise sqlTables)
    sqlTables?: { id?: string; tableName: string; fileName?: string; fileUrl?: string; csvUrl?: string; seedSql?: string }[];
    // Python: uploaded CSVs loaded into pandas DataFrames named by variableName
    pythonDatasets?: { id?: string; variableName: string; fileName?: string; fileUrl?: string; csvUrl?: string }[];
    // Certifications only: also load the certification's shared playground data (CertificationConfig.playgroundData).
    // Defaults to true when shared data exists; set false to give this question a clean, question-only environment.
    useSharedData?: boolean;
  };
}

// Reusable runnable-playground data: uploaded SQL tables and/or Python DataFrames plus optional setup
// code. Used both per-question (above) and as certification-wide shared data (below), so a dataset only
// needs to be defined once and every question's playground can reuse it.
export interface PlaygroundData {
  sqlTables?: { id?: string; tableName: string; fileName?: string; fileUrl?: string; csvUrl?: string; seedSql?: string }[];
  pythonDatasets?: { id?: string; variableName: string; fileName?: string; fileUrl?: string; csvUrl?: string }[];
  setupSql?: string;
  setupPython?: string;
}

export interface Speaker {
  id: string;
  name: string;
  title?: string;
  bio?: string;
  avatar_url?: string;
  linkedin_url?: string;
}

export interface EventDetails {
  isEvent: boolean;
  date?: string;
  time?: string;
  location?: string;
  timezone?: string;
  isPrivate?: boolean;
  capacity?: number;
  eventType?: 'in-person' | 'virtual';
  meetingLink?: string;
  speakers?: Speaker[];
  recurrence?: 'once' | 'daily' | 'weekly';
  recurrenceEndDate?: string;
  recurrenceDays?: number[];
}

export interface PostSubmission {
  type: 'default' | 'redirect' | 'button' | 'events' | 'notice';
  redirectUrl?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  relatedEventIds?: string[];
  noticeTitle?: string;
  noticeBody?: string;
}

export interface PointsMilestone {
  id: string;
  points: number;
  label: string;
  description: string;
  rewardUrl?: string;
}

export interface PointsSystem {
  enabled: boolean;
  basePoints: number;
  timeBonusEnabled: boolean;
  timeBonusSeconds: number;
  timeBonusMultiplier: number;
  streakEnabled: boolean;
  streakCount: number;
  streakBonus: number;
  hintPenalty: number;
  solutionPenalty: number;
  milestones: PointsMilestone[];
}

export interface FormConfig {
  title: string;
  description: string;
  coverImage: string;
  theme: ThemeColor;
  customAccent?: string;
  mode: ThemeMode;
  font: string;
  fields: FormField[];
  eventDetails?: EventDetails;
  isCourse?: boolean;
  questions?: CourseQuestion[];
  learnOutcomes?: string[];
  showAnswers?: 'per_question' | 'after_quiz' | 'none';
  lessonTiming?: 'before' | 'after';
  enableAiTutor?: boolean;        // opt-in AI tutor on lesson slides (column: courses.ai_tutor_enabled)
  passmark?: number;
  courseTimer?: number;           // canonical (legacy alias: `timer`)
  maxAttempts?: number;
  postSubmission?: PostSubmission;
  pointsSystem?: PointsSystem;    // canonical (legacy aliases: `pointsEnabled` + `pointsBase`)
  deadline_days?: number | null;
  category?: string | null;
  partnerId?: string | null;
  badgeImageUrl?: string | null;
}

// --- Certifications ---
//
// Certifications are a separate first-class content type (their own table + player + overview),
// but they reuse the CourseQuestion shape so authoring and grading stay consistent with courses.
// Exam types only: multiple_choice | fill_blank | arrange | image | code | sql_exercise | python_exercise.
// Certification classification, used to group certifications on the certifications page.
export type CertificationType = 'career' | 'technology';

export interface CertificationConfig {
  title: string;
  description?: string;
  certType?: CertificationType;      // 'career' | 'technology'; groups the certifications listing
  coverImage?: string;
  badgeImageUrl?: string | null;
  questions: CourseQuestion[];
  practiceQuestions?: CourseQuestion[]; // separate practice-only bank; reveals feedback (never the real exam)
  passmark: number;
  timeLimit?: number | null;   // minutes; null/0 = untimed
  maxAttempts: number;         // 0 = unlimited
  retakeCooldownHours?: number; // min hours between attempts after a fail; 0 = no wait (default 24)
  examProtection: boolean;
  deadline_days?: number | null;
  learnOutcomes?: string[];
  // Foundation assets
  skillAreas?: SkillArea[];          // defined skill areas; questions map to one via CourseQuestion.skillAreaId
  scenarios?: CertificationScenario[]; // case studies: a shared stimulus shown with each question that references it via scenarioId
  studyGuideUrl?: string;            // uploaded PDF (Cloudinary)
  studyGuideName?: string;
  studyGuidePublished?: boolean;     // learners see the study guide only when published
  posterUrl?: string;                // uploaded poster image (Cloudinary)
  posterPublished?: boolean;         // learners see the poster only when published
  practiceTestUrl?: string;          // link to the practice test
  prepItems?: CertificationPrepItem[]; // published courses / learning paths to complete before the exam (overview "Complete courses" step)
  playgroundData?: PlaygroundData;   // shared runnable-playground data reused across question playgrounds (define once)
  // Exam integrity
  randomizeQuestions?: boolean;      // shuffle question order per attempt
  shuffleOptions?: boolean;          // shuffle answer options per attempt (text-option types)
  questionPoolSize?: number | null;  // draw N questions at random from the bank; null/0 = use all
  theme?: ThemeColor;
  mode?: ThemeMode;
  font?: string;
  customAccent?: string;
}

export interface SkillArea {
  id: string;
  name: string;
}

// A case study: a shared stimulus (scenario, dataset description, context) that several exam questions
// reference via CourseQuestion.scenarioId. Shown alongside each of its questions in the taker.
export interface CertificationScenario {
  id: string;
  title: string;
  content: string;   // the stimulus text shown to the student
}

export interface CertificationPrepItem {
  id: string;              // published course or learning-path id
  type: 'course' | 'path';
}

// --- Defaults ---

/** Bonus XP a LinkedIn share slide awards when the author does not set an amount. */
export const DEFAULT_LINKEDIN_SHARE_POINTS = 50;

/** Highest bonus a single share slide may award, however the course config was authored. */
export const MAX_LINKEDIN_SHARE_POINTS = 200;

export function clampLinkedInSharePoints(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_LINKEDIN_SHARE_POINTS);
}

/**
 * The bonus a share slide actually awards.
 *
 * The distinction that matters: an UNSET amount means "use the default", but an explicit **0** means
 * zero. Treating both as falsy made the landing page advertise 50 XP for a slide the server awarded
 * nothing for. Every surface that needs this number -- the award, the ceiling, the advertised total --
 * must go through here.
 */
export function linkedInSharePointsFor(question: { linkedInSharePoints?: unknown } | null | undefined): number {
  const raw = question?.linkedInSharePoints;
  if (raw == null || raw === '') return DEFAULT_LINKEDIN_SHARE_POINTS;
  return clampLinkedInSharePoints(raw);
}

/**
 * A fresh LinkedIn share slide. Shared by the create page and FormEditor -- courses have two
 * separate editors, and a slide built inline in each would drift.
 */
export function newLinkedInShareSlide(id: string): CourseQuestion {
  return {
    id,
    isLinkedInShare: true,
    linkedInShareTitle: 'Share your work on LinkedIn',
    linkedInShareDescription: '',
    linkedInSharePrompt: '',
    linkedInSharePoints: DEFAULT_LINKEDIN_SHARE_POINTS,
    linkedInShareRequired: false,
    question: '',
    options: [],
    correctAnswer: '',
  };
}

export const DEFAULT_POINTS_SYSTEM: PointsSystem = {
  enabled: true,
  basePoints: 50,
  timeBonusEnabled: false,
  timeBonusSeconds: 0,
  timeBonusMultiplier: 1,
  streakEnabled: false,
  streakCount: 0,
  streakBonus: 0,
  hintPenalty: 20,
  solutionPenalty: 30,
  milestones: [],
};

export const LEGACY_RUNTIME_POINTS_SYSTEM: PointsSystem = {
  enabled: false,
  basePoints: 100,
  timeBonusEnabled: true,
  timeBonusSeconds: 10,
  timeBonusMultiplier: 1.5,
  streakEnabled: true,
  streakCount: 3,
  streakBonus: 0,
  hintPenalty: 20,
  solutionPenalty: 30,
  milestones: [],
};

export function normalizePointsSystem(
  value: Partial<PointsSystem> | null | undefined,
  fallback: PointsSystem = DEFAULT_POINTS_SYSTEM,
): PointsSystem {
  const raw = value && typeof value === 'object' ? value : {};
  const num = (v: unknown, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  return {
    enabled:             typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    basePoints:          num(raw.basePoints, fallback.basePoints),
    timeBonusEnabled:    typeof raw.timeBonusEnabled === 'boolean' ? raw.timeBonusEnabled : fallback.timeBonusEnabled,
    timeBonusSeconds:    num(raw.timeBonusSeconds, fallback.timeBonusSeconds),
    timeBonusMultiplier: num(raw.timeBonusMultiplier, fallback.timeBonusMultiplier),
    streakEnabled:       typeof raw.streakEnabled === 'boolean' ? raw.streakEnabled : fallback.streakEnabled,
    streakCount:         num(raw.streakCount, fallback.streakCount),
    streakBonus:         num(raw.streakBonus, fallback.streakBonus),
    hintPenalty:         num(raw.hintPenalty, fallback.hintPenalty),
    solutionPenalty:     num(raw.solutionPenalty, fallback.solutionPenalty),
    milestones:          Array.isArray(raw.milestones) ? raw.milestones : fallback.milestones,
  };
}

export function pointsSystemFromCourseRow(row: any): PointsSystem {
  const legacy = normalizePointsSystem({
    ...LEGACY_RUNTIME_POINTS_SYSTEM,
    enabled:    row?.points_enabled ?? LEGACY_RUNTIME_POINTS_SYSTEM.enabled,
    basePoints: row?.points_base ?? LEGACY_RUNTIME_POINTS_SYSTEM.basePoints,
  }, LEGACY_RUNTIME_POINTS_SYSTEM);
  return normalizePointsSystem(row?.points_system, legacy);
}

// --- Normalize (ingest) ---

function newId(): string {
  // Universal across Node 19+ and browsers; ids are opaque (only uniqueness matters).
  const c = (globalThis as any).crypto;
  return c?.randomUUID ? c.randomUUID() : `q-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

/**
 * Ensure every question has a stable id and a string `correctAnswer`.
 * Some producers (MCP / AI generation) send `correct` as a 0-based option index;
 * CourseTaker reads `correctAnswer` as the option string, so we reconcile here.
 */
export function normalizeQuestions(questions: any[] | undefined): CourseQuestion[] {
  return (questions ?? []).map((q: any) => {
    const normalized: any = { ...q, id: q?.id || newId() };
    if (!normalized.correctAnswer && typeof normalized.correct === 'number' && Array.isArray(normalized.options)) {
      normalized.correctAnswer = normalized.options[normalized.correct] ?? '';
    }
    return normalized as CourseQuestion;
  });
}

/**
 * Collapse any inbound config (client POST, AI generation, or a DB row) into the canonical
 * FormConfig shape. Legacy aliases are read here and ONLY here:
 *   - courseTimer  <- courseTimer | timer | course_timer
 *   - pointsSystem <- pointsSystem | { pointsEnabled|points_enabled, pointsBase|points_base }
 * After this, downstream code reads only `courseTimer` and `pointsSystem`.
 */
export function normalizeFormConfig(raw: any): FormConfig {
  const {
    // strip legacy aliases out of the spread so the canonical shape stays clean
    timer, course_timer,
    pointsEnabled, points_enabled, pointsBase, points_base, points_system,
    ...rest
  } = raw ?? {};

  const courseTimer = rest.courseTimer ?? timer ?? course_timer ?? undefined;

  let pointsSystem: PointsSystem | undefined = rest.pointsSystem ?? points_system;
  if (pointsSystem) {
    pointsSystem = normalizePointsSystem(pointsSystem, LEGACY_RUNTIME_POINTS_SYSTEM);
  } else {
    const enabled = pointsEnabled ?? points_enabled;
    const basePoints = pointsBase ?? points_base;
    if (enabled != null || basePoints != null) {
      pointsSystem = normalizePointsSystem({
        ...LEGACY_RUNTIME_POINTS_SYSTEM,
        enabled: enabled ?? LEGACY_RUNTIME_POINTS_SYSTEM.enabled,
        basePoints: basePoints ?? LEGACY_RUNTIME_POINTS_SYSTEM.basePoints,
      }, LEGACY_RUNTIME_POINTS_SYSTEM);
    }
  }

  return {
    ...rest,
    courseTimer,
    pointsSystem,
    questions: rest.questions !== undefined ? normalizeQuestions(rest.questions) : rest.questions,
  } as FormConfig;
}

// --- Validate ---

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Shape-level validation enforced at the persistence boundary. */
export function validateFormConfig(config: FormConfig | null | undefined): ValidationResult {
  if (!config) return { ok: false, error: 'config is required' };
  const isCourse = Boolean(config.isCourse);
  const isEvent = Boolean(config.eventDetails?.isEvent);
  if (!isCourse && !isEvent) {
    return { ok: false, error: 'config must set isCourse or eventDetails.isEvent' };
  }
  return { ok: true };
}
