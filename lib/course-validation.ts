// What still needs fixing in a course before learners can take it. Shared by the course editor
// (amber flags on each outline row, the publish readiness list) and the dashboard's Publish
// switch, so a course is judged the same way wherever it is published.
//
// Drafts may be incomplete; these checks decide only whether a course is ready to publish.

export interface CourseIssue {
  /** The outline item the issue belongs to. */
  id: string;
  /** Short flag for the outline row, e.g. "Needs a title". */
  flag: string;
  /** Full sentence for the readiness list, e.g. "Q4 has no correct answer". */
  message: string;
}

const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

const CHOICE_TYPES = ['multiple_choice', 'image_choice', 'code'];
const REVIEW_TYPES = ['code_review', 'excel_review', 'dashboard_critique', 'document_review', 'written_response'];

/** Items that are graded, in course order: these are numbered Q1, Q2 ... for learners. */
export function isNumberedQuestion(q: any): boolean {
  return !!q && !q.lessonOnly && !q.isSection && !q.isDownloads && !q.isLinkedInShare;
}

/** Q-number for every item (0 for items that are not questions), matching the learner's numbering. */
export function questionNumbers(questions: any[]): number[] {
  let n = 0;
  return (questions || []).map(q => (isNumberedQuestion(q) ? ++n : 0));
}

/** Issues for one outline item. `qNo` is its Q-number (0 when it is not a question). */
export function itemIssues(q: any, qNo = 0): CourseIssue[] {
  const id = String(q?.id ?? '');
  const out: CourseIssue[] = [];
  const add = (flag: string, message: string) => out.push({ id, flag, message });

  if (q?.isSection) {
    if (!nonEmpty(q.sectionTitle)) add('Needs a name', 'A module has no name');
    return out;
  }
  if (q?.lessonOnly) {
    if (!nonEmpty(q.lesson?.title)) add('Needs a title', 'A lesson has no title');
    return out;
  }
  if (q?.isDownloads) {
    const items: any[] = Array.isArray(q.downloadItems) ? q.downloadItems : [];
    if (!items.length) add('No files', 'A downloads page has no files');
    else if (items.some(i => !nonEmpty(i?.title))) add('Item needs a name', 'A downloads item has no name');
    else if (items.some(i => (i?.type === 'link' ? !nonEmpty(i?.linkUrl) : !nonEmpty(i?.fileUrl)))) add('Missing a file', 'A downloads item has no file or link');
    return out;
  }
  if (q?.isLinkedInShare) return out;

  const type = q?.type ?? 'multiple_choice';
  const name = qNo > 0 ? `Q${qNo}` : 'A question';
  if (!nonEmpty(q?.question)) add('No question text', `${name} has no question text`);

  if (CHOICE_TYPES.includes(type)) {
    const options: unknown[] = Array.isArray(q.options) ? q.options : [];
    const filled = options.filter(nonEmpty);
    // Most important first: the row shows only the first flag.
    if (!nonEmpty(q.correctAnswer) || !filled.includes(q.correctAnswer)) add('No correct answer', `${name} has no correct answer`);
    if (filled.length < 2) add('Needs two options', `${name} needs at least two answer options`);
    if (options.length > filled.length) add('Empty option', `${name} has an empty answer option`);
  } else if (type === 'fill_blank') {
    if (!nonEmpty(q.correctAnswer)) add('No accepted answer', `${name} has no accepted answer`);
  } else if (type === 'arrange') {
    const items: unknown[] = Array.isArray(q.options) ? q.options : [];
    if (items.filter(nonEmpty).length < 2) add('Needs two items', `${name} needs at least two items to order`);
    if (items.some(i => !nonEmpty(i))) add('Empty item', `${name} has an empty item`);
  } else if (type === 'image') {
    const images: unknown[] = Array.isArray(q.optionImages) ? q.optionImages : [];
    if (images.filter(nonEmpty).length < 2) add('Needs two images', `${name} needs at least two images`);
  } else if (REVIEW_TYPES.includes(type)) {
    const rubric: unknown[] = Array.isArray(q.rubric) ? q.rubric : [];
    if (!rubric.some(nonEmpty)) add('No rubric', `${name} has no rubric for the AI review`);
  }
  return out;
}

/** Every issue in a course, in outline order. Empty means it is ready to publish. */
export function courseIssues(config: any): CourseIssue[] {
  const out: CourseIssue[] = [];
  if (!nonEmpty(config?.title) || /^untitled (course|event|webinar|survey)$/i.test(String(config?.title).trim())) {
    out.push({ id: '', flag: 'Needs a title', message: 'The course needs a title' });
  }
  const questions: any[] = Array.isArray(config?.questions) ? config.questions : [];
  if (!questions.some(q => !q?.isSection)) out.push({ id: '', flag: 'No content', message: 'Add at least one lesson or question' });
  const nums = questionNumbers(questions);
  let moduleNo = 0;
  questions.forEach((q, i) => {
    if (q?.isSection) moduleNo += 1;
    // One line per item (its most important issue); fixing it reveals the next, as on its row.
    const first = itemIssues(q, nums[i])[0];
    if (!first) return;
    const where = moduleNo > 0 && !q?.isSection ? `Module ${moduleNo}: ` : '';
    out.push({ ...first, message: where ? `${where}${first.message.replace(/^A /, 'a ')}` : first.message });
  });
  return out;
}
