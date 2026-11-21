export interface VirtualExperienceIssue {
  message: string;
  section: 'overview' | 'brief' | 'curriculum' | 'branding' | 'delivery';
}

const plainText = (value: unknown) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
  : '';

const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

// A link learners open (dataset, solution video) is empty or a web address, never another scheme.
const webLinkOrEmpty = (value: unknown) => !nonEmpty(value) || /^https?:\/\//i.test((value as string).trim());

/**
 * Shared publish boundary for Virtual Experiences. Drafts intentionally remain permissive,
 * but published experiences must contain enough structure for the learner player to render
 * and complete them without encountering an empty or impossible mission.
 */
export function validateVirtualExperienceForPublish(config: any): VirtualExperienceIssue[] {
  const issues: VirtualExperienceIssue[] = [];
  const modules = Array.isArray(config?.modules) ? config.modules : [];

  if (!nonEmpty(config?.company)) issues.push({ section: 'overview', message: 'Add the company or organization name.' });
  if (!nonEmpty(config?.role)) issues.push({ section: 'overview', message: 'Add the learner role.' });
  if (!nonEmpty(config?.tagline)) issues.push({ section: 'overview', message: 'Add a short experience tagline.' });
  if (!webLinkOrEmpty(config?.dataset?.url)) issues.push({ section: 'overview', message: 'The dataset link must be a web address (https://...).' });
  if (!modules.length) {
    issues.push({ section: 'curriculum', message: 'Add at least one module.' });
    return issues;
  }

  modules.forEach((module: any, moduleIndex: number) => {
    const moduleLabel = `Module ${moduleIndex + 1}`;
    if (!nonEmpty(module?.title)) issues.push({ section: 'curriculum', message: `${moduleLabel} needs a title.` });
    if (!webLinkOrEmpty(module?.solutionVideo)) issues.push({ section: 'curriculum', message: `${moduleLabel}'s solution link must be a web address (https://...).` });
    const lessons = Array.isArray(module?.lessons) ? module.lessons : [];
    if (!lessons.length) {
      issues.push({ section: 'curriculum', message: `${moduleLabel} needs at least one mission.` });
      return;
    }

    lessons.forEach((lesson: any, lessonIndex: number) => {
      const lessonLabel = `${moduleLabel}, mission ${lessonIndex + 1}`;
      if (!nonEmpty(lesson?.title)) issues.push({ section: 'curriculum', message: `${lessonLabel} needs a title.` });
      const requirements = Array.isArray(lesson?.requirements) ? lesson.requirements : [];
      const hasContent = plainText(lesson?.body).length > 0 || !!lesson?.doc || nonEmpty(lesson?.videoUrl);
      if (!hasContent && !requirements.length) {
        issues.push({ section: 'curriculum', message: `${lessonLabel} needs content or at least one task.` });
      }

      requirements.forEach((req: any, reqIndex: number) => {
        const taskLabel = `${lessonLabel}, task ${reqIndex + 1}`;
        if (!nonEmpty(req?.label)) issues.push({ section: 'curriculum', message: `${taskLabel} needs a title.` });

        if (req?.type === 'mcq') {
          const options = Array.isArray(req.options) ? req.options.filter(nonEmpty) : [];
          if (options.length < 2) issues.push({ section: 'curriculum', message: `${taskLabel} needs at least two answer options.` });
          if (!nonEmpty(req.correctAnswer) || !options.includes(req.correctAnswer)) {
            issues.push({ section: 'curriculum', message: `${taskLabel} needs a valid correct answer.` });
          }
        }

        if (req?.type === 'decision') {
          const options = Array.isArray(req.options) ? req.options.filter(nonEmpty) : [];
          if (options.length < 2) issues.push({ section: 'curriculum', message: `${taskLabel} needs at least two decision options.` });
          if (!nonEmpty(req.correctAnswer) || !options.includes(req.correctAnswer)) {
            issues.push({ section: 'curriculum', message: `${taskLabel} needs a recommended path.` });
          }
        }

        if (['dashboard_critique', 'code_review', 'excel_review', 'document_review'].includes(req?.type)) {
          const minScore = req?.minScore;
          // Every AI review scores 0-100 (lib/review-target reviewMinScore), so the pass mark does too.
          if (minScore !== undefined && minScore !== null && minScore !== '' && (!Number.isFinite(Number(minScore)) || Number(minScore) < 0 || Number(minScore) > 100)) {
            issues.push({ section: 'curriculum', message: `${taskLabel} has an invalid minimum score.` });
          }
        }
      });
    });
  });

  return issues;
}
