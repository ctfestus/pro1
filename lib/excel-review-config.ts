export const MAX_REVIEW_SHEET_NAMES = 20;
export const MAX_REVIEW_SHEET_NAME_LENGTH = 31;

/**
 * The database CHECK that backs the same rules `normalizeReviewSheetNames` enforces, named here so
 * a save path that skipped the editor's own cleanup reports the rule rather than Postgres's wording.
 */
const SHEET_NAMES_CONSTRAINT = 'assignments_excel_review_sheet_names_valid';

export const REVIEW_SHEET_NAMES_CONSTRAINT_MESSAGE =
  `Check the worksheets to evaluate: up to ${MAX_REVIEW_SHEET_NAMES} names, each ${MAX_REVIEW_SHEET_NAME_LENGTH} characters or fewer, with no blank or repeated entries.`;

/** The message to show for a failed write, mapping the worksheet CHECK onto the editor's wording. */
export function excelReviewSaveErrorMessage(err: unknown, fallback: string): string {
  const raw = typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message;
  const message = typeof raw === 'string' ? raw : '';
  if (message.includes(SHEET_NAMES_CONSTRAINT)) return REVIEW_SHEET_NAMES_CONSTRAINT_MESSAGE;
  return message || fallback;
}

export type ExcelReviewTarget =
  | { source: 'course'; contentId: string; itemId: string }
  | { source: 'virtual_experience'; contentId: string; itemId: string; assignmentId?: string }
  | { source: 'assignment'; contentId: string; itemId?: string };

export interface ExcelReviewConfig {
  context: string;
  rubric: string[];
  minScore?: number;
  reviewSheetNames: string[];
}

export interface SheetNameNormalization {
  names: string[];
  error?: string;
}

interface VirtualExperienceAssignmentAccess {
  userId: string;
  callerRole?: string | null;
  callerCohortId?: string | null;
  callerGroupIds: Iterable<string>;
  experienceOwnerId?: string | null;
  assignmentOwnerId?: string | null;
  assignmentCohortIds?: string[] | null;
  assignmentGroupIds?: string[] | null;
}

export function canAccessAssignedVirtualExperience(access: VirtualExperienceAssignmentAccess): boolean {
  const callerGroups = new Set(access.callerGroupIds);
  return access.experienceOwnerId === access.userId
    || access.assignmentOwnerId === access.userId
    || access.callerRole === 'admin'
    || !!(access.callerCohortId && (access.assignmentCohortIds ?? []).includes(access.callerCohortId))
    || (access.assignmentGroupIds ?? []).some(groupId => callerGroups.has(groupId));
}

export function normalizeReviewSheetNames(value: unknown): SheetNameNormalization {
  if (value == null) return { names: [] };
  if (!Array.isArray(value) || value.some(name => typeof name !== 'string')) {
    return { names: [], error: 'Worksheet names must be a list of text values.' };
  }

  const unique = new Map<string, string>();
  for (const rawName of value as string[]) {
    const name = rawName.trim();
    if (!name) continue;
    if (name.length > MAX_REVIEW_SHEET_NAME_LENGTH) {
      return { names: [...unique.values()], error: `Worksheet names must be ${MAX_REVIEW_SHEET_NAME_LENGTH} characters or fewer.` };
    }
    const key = name.toLowerCase();
    if (!unique.has(key)) unique.set(key, name);
  }

  const names = [...unique.values()];
  if (names.length > MAX_REVIEW_SHEET_NAMES) {
    return { names, error: `Choose no more than ${MAX_REVIEW_SHEET_NAMES} worksheets.` };
  }
  return { names };
}

/**
 * Clean the worksheet lists inside an assignment config before it is written.
 *
 * The editor already does this on its own state, so this is for the paths that do not go through
 * it -- sync and content import, which forward a config authored somewhere else. Without it the
 * database CHECK refuses the whole row over a stray blank line, and an import fails for a reason
 * the caller cannot act on.
 *
 * Cleanup only covers what is safe to fix silently: trimming, blanks and duplicates. Anything the
 * rules REFUSE comes back as an error for the caller to act on, and the config is returned
 * untouched. Quietly dropping a list that broke a rule would delete the instructor's worksheet
 * choice and send the review back to reading the first few sheets, with nobody told.
 */
/** The same treatment for a course's questions: clean what is safe, refuse what is not. */
export function normalizeCourseReviewSheetNames(questions: any): { questions: any; error?: string } {
  if (!Array.isArray(questions)) return { questions };

  let error: string | undefined;
  const next = questions.map((question: any) => {
    if (question?.type !== 'excel_review' || question.reviewSheetNames === undefined) return question;
    const normalized = normalizeReviewSheetNames(question.reviewSheetNames);
    if (normalized.error) { error ??= normalized.error; return question; }
    return { ...question, reviewSheetNames: normalized.names };
  });

  return error ? { questions, error } : { questions: next };
}

/** The same treatment for a virtual experience's requirements. */
export function normalizeExperienceReviewSheetNames(modules: any): { modules: any; error?: string } {
  if (!Array.isArray(modules)) return { modules };

  let error: string | undefined;
  const next = modules.map((experienceModule: any) => {
    if (!Array.isArray(experienceModule?.lessons)) return experienceModule;
    return {
      ...experienceModule,
      lessons: experienceModule.lessons.map((lesson: any) => {
        if (!Array.isArray(lesson?.requirements)) return lesson;
        return {
          ...lesson,
          requirements: lesson.requirements.map((requirement: any) => {
            if (requirement?.type !== 'excel_review' || requirement.reviewSheetNames === undefined) return requirement;
            const normalized = normalizeReviewSheetNames(requirement.reviewSheetNames);
            if (normalized.error) { error ??= normalized.error; return requirement; }
            return { ...requirement, reviewSheetNames: normalized.names };
          }),
        };
      }),
    };
  });

  return error ? { modules, error } : { modules: next };
}

export function normalizeAssignmentReviewSheetNames(
  type: string | null | undefined,
  config: any,
): { config: any; error?: string } {
  if (!config || typeof config !== 'object') return { config };

  if (type === 'excel_review') {
    if (config.reviewSheetNames === undefined) return { config };
    const normalized = normalizeReviewSheetNames(config.reviewSheetNames);
    if (normalized.error) return { config, error: normalized.error };
    return { config: { ...config, reviewSheetNames: normalized.names } };
  }

  if (type !== 'standard' || !Array.isArray(config.scenarios)) return { config };

  let error: string | undefined;
  const scenarios = config.scenarios.map((scenario: any) => (
    Array.isArray(scenario?.tasks)
      ? {
          ...scenario,
          tasks: scenario.tasks.map((task: any) => {
            if (task?.type !== 'excel_review' || task.reviewSheetNames === undefined) return task;
            const normalized = normalizeReviewSheetNames(task.reviewSheetNames);
            if (normalized.error) { error ??= normalized.error; return task; }
            return { ...task, reviewSheetNames: normalized.names };
          }),
        }
      : scenario
  ));

  return error ? { config, error } : { config: { ...config, scenarios } };
}

export function normalizeExcelReviewConfig(value: any): ExcelReviewConfig & { sheetNameError?: string } {
  const normalizedSheets = normalizeReviewSheetNames(value?.reviewSheetNames);
  const rubric = Array.isArray(value?.rubric)
    ? value.rubric.filter((criterion: unknown): criterion is string => typeof criterion === 'string').map((criterion: string) => criterion.trim()).filter(Boolean)
    : [];
  const rawMinScore = Number(value?.minScore);
  const minScore = Number.isFinite(rawMinScore) && rawMinScore >= 0 && rawMinScore <= 100
    ? rawMinScore
    : undefined;

  return {
    context: typeof value?.context === 'string' ? value.context.trim() : '',
    rubric,
    minScore,
    reviewSheetNames: normalizedSheets.names,
    ...(normalizedSheets.error ? { sheetNameError: normalizedSheets.error } : {}),
  };
}

export function parseExcelReviewTarget(value: unknown): ExcelReviewTarget | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const source = raw.source;
  const contentId = typeof raw.contentId === 'string' ? raw.contentId.trim() : '';
  const itemId = typeof raw.itemId === 'string' ? raw.itemId.trim() : '';
  const assignmentId = typeof raw.assignmentId === 'string' ? raw.assignmentId.trim() : '';
  if (!contentId) return null;

  if (source === 'course' && itemId) return { source, contentId, itemId };
  if (source === 'virtual_experience' && itemId) {
    return { source, contentId, itemId, ...(assignmentId ? { assignmentId } : {}) };
  }
  if (source === 'assignment') return { source, contentId, ...(itemId ? { itemId } : {}) };
  return null;
}

export function findExcelReviewItem(target: ExcelReviewTarget, stored: any): any | null {
  if (target.source === 'course') {
    return (Array.isArray(stored?.questions) ? stored.questions : [])
      .find((question: any) => question?.id === target.itemId && question?.type === 'excel_review') ?? null;
  }

  if (target.source === 'virtual_experience') {
    for (const experienceModule of (Array.isArray(stored?.modules) ? stored.modules : [])) {
      for (const lesson of (Array.isArray(experienceModule?.lessons) ? experienceModule.lessons : [])) {
        const requirement = (Array.isArray(lesson?.requirements) ? lesson.requirements : [])
          .find((item: any) => item?.id === target.itemId && item?.type === 'excel_review');
        if (requirement) return requirement;
      }
    }
    return null;
  }

  if (!target.itemId) return stored?.type === 'excel_review' ? stored?.config ?? null : null;
  for (const scenario of (Array.isArray(stored?.config?.scenarios) ? stored.config.scenarios : [])) {
    const task = (Array.isArray(scenario?.tasks) ? scenario.tasks : [])
      .find((item: any) => item?.id === target.itemId && item?.type === 'excel_review');
    if (task) return task;
  }
  return null;
}
