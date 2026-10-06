// Turns spreadsheet rows (from a CSV or the first sheet of an Excel file) into application form
// questions. Pure: reading the file happens in the builder, so this can be tested on plain rows.
//
// The sheet has a heading row; columns are found by name, so they can be in any order and extra
// columns are ignored. Rows that cannot become a valid question are skipped and reported, so one
// bad row never blocks the rest.

import {
  APPLICATION_OTHER_OPTION,
  isPlainApplicationOtherOption,
  type ApplicationQuestion,
  type ApplicationQuestionType,
} from '@/lib/application-forms';

export const MAX_IMPORTED_QUESTIONS = 200;
const MAX_LABEL = 500;
const MAX_HELP_TEXT = 1000;
const MAX_OPTIONS = 100;
const MAX_OPTION = 200;

export interface QuestionImportIssue {
  /** Spreadsheet row number, as the instructor sees it (the heading row is 1). 0 = the whole file. */
  row: number;
  message: string;
  /** Errors skip the row; warnings import it with the noted change. */
  level: 'error' | 'warning';
}

export interface QuestionImportResult {
  questions: ApplicationQuestion[];
  issues: QuestionImportIssue[];
}

type Column = 'question' | 'type' | 'required' | 'options' | 'help';

const HEADINGS: Record<Column, string[]> = {
  question: ['question', 'questions', 'label', 'title', 'question text'],
  type: ['type', 'question type', 'answer type', 'field type'],
  required: ['required', 'mandatory', 'compulsory'],
  options: ['options', 'choices', 'answers', 'answer options'],
  help: ['help text', 'help', 'description', 'hint', 'supporting text', 'instructions'],
};

/** Accepted type names, matched after lowercasing and removing everything but letters. */
const TYPE_NAMES: Record<string, ApplicationQuestionType> = {
  shortanswer: 'short_text', shorttext: 'short_text', short: 'short_text', text: 'short_text', textbox: 'short_text',
  paragraph: 'long_text', longanswer: 'long_text', longtext: 'long_text', long: 'long_text',
  email: 'email', emailaddress: 'email',
  phone: 'phone', phonenumber: 'phone', telephone: 'phone',
  number: 'number', numeric: 'number',
  date: 'date',
  multiplechoice: 'single_choice', singlechoice: 'single_choice', radio: 'single_choice', choice: 'single_choice',
  checkboxes: 'multiple_choice', checkbox: 'multiple_choice', multiselect: 'multiple_choice', selectall: 'multiple_choice',
  dropdown: 'dropdown', select: 'dropdown', list: 'dropdown',
  yesno: 'yes_no', yesorno: 'yes_no', boolean: 'yes_no',
  fileupload: 'file', file: 'file', upload: 'file',
  consent: 'consent', agreement: 'consent',
  textblock: 'text_block', information: 'text_block', info: 'text_block',
};

const CHOICE_TYPES: ApplicationQuestionType[] = ['single_choice', 'multiple_choice', 'dropdown'];
const TRUE_VALUES = new Set(['yes', 'y', 'true', '1', 'required', 'x']);
const FALSE_VALUES = new Set(['', 'no', 'n', 'false', '0', 'optional']);

/** The downloadable template, also the documentation of the format. */
export const QUESTION_IMPORT_TEMPLATE_ROWS: string[][] = [
  ['Question', 'Type', 'Required', 'Options', 'Help text'],
  ['Full name', 'Short answer', 'Yes', '', ''],
  ['Phone number', 'Phone', 'Yes', '', 'Include your country code.'],
  ['Highest level of education', 'Dropdown', 'Yes', `Secondary school; Diploma; Bachelor's degree; Master's degree; ${APPLICATION_OTHER_OPTION}`, ''],
  ['Which skills do you already have?', 'Checkboxes', 'No', 'Excel; SQL; Power BI; Python', 'Select all that apply.'],
  ['Are you currently employed?', 'Yes or no', 'Yes', '', ''],
  ['Why do you want to join this programme?', 'Paragraph', 'Yes', '', 'A few sentences is enough.'],
  ['Upload your CV', 'File upload', 'No', '', ''],
];

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Options from one cell. Long options are shortened before repeats are removed, so two options
 * that only differ after the limit do not both survive as identical entries. */
function splitOptions(value: string): { options: string[]; shortened: boolean } {
  const options: string[] = [];
  const seen = new Set<string>();
  let shortened = false;
  for (const part of value.split(/\r?\n|;|\|/)) {
    let option = part.trim().replace(/^(?:[-*\u2022]\s+|\d+[.)]\s+)/, '').trim();
    if (option.length > MAX_OPTION) { option = option.slice(0, MAX_OPTION).trim(); shortened = true; }
    const key = option.toLocaleLowerCase();
    if (!option || seen.has(key)) continue;
    seen.add(key);
    options.push(option);
  }
  return { options, shortened };
}

export function parseApplicationQuestionRows(
  rows: string[][],
  makeId: () => string = () => `q-${crypto.randomUUID()}`,
): QuestionImportResult {
  const issues: QuestionImportIssue[] = [];
  const questions: ApplicationQuestion[] = [];
  const headerIndex = rows.findIndex(row => row.some(cell => clean(cell)));
  if (headerIndex < 0) return { questions, issues: [{ row: 0, level: 'error', message: 'The file is empty.' }] };

  const columns: Partial<Record<Column, number>> = {};
  rows[headerIndex].forEach((cell, index) => {
    const heading = normalizeHeading(clean(cell));
    for (const [column, names] of Object.entries(HEADINGS) as [Column, string[]][]) {
      if (columns[column] === undefined && names.includes(heading)) columns[column] = index;
    }
  });
  if (columns.question === undefined) {
    return { questions, issues: [{ row: headerIndex + 1, level: 'error', message: 'The first row must contain the column headings, including a Question column. Download the template to see the format.' }] };
  }

  const cell = (row: string[], column: Column) => (columns[column] === undefined ? '' : clean(row[columns[column]!]));

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const rowNumber = index + 1;
    if (!row.some(value => clean(value))) continue;
    if (questions.length >= MAX_IMPORTED_QUESTIONS) {
      issues.push({ row: rowNumber, level: 'error', message: `Only the first ${MAX_IMPORTED_QUESTIONS} questions are imported. Split the rest into another file.` });
      break;
    }

    let label = cell(row, 'question');
    if (!label) { issues.push({ row: rowNumber, level: 'error', message: 'The question is empty.' }); continue; }
    if (label.length > MAX_LABEL) {
      label = label.slice(0, MAX_LABEL);
      issues.push({ row: rowNumber, level: 'warning', message: `The question was shortened to ${MAX_LABEL} characters.` });
    }

    const split = splitOptions(cell(row, 'options'));
    let options = split.options;
    const typeText = cell(row, 'type');
    const typeKey = typeText.toLowerCase().replace(/[^a-z]/g, '');
    let type: ApplicationQuestionType | undefined = typeKey ? TYPE_NAMES[typeKey] : undefined;
    if (typeKey && !type) {
      issues.push({ row: rowNumber, level: 'error', message: `Unknown question type "${typeText}". Use one of the types in the template.` });
      continue;
    }
    // No type given: a list of options means a choice question, otherwise a short answer.
    if (!type) type = options.length ? 'single_choice' : 'short_text';

    const question: ApplicationQuestion = { id: makeId(), label, type, required: false };
    const requiredText = cell(row, 'required').toLowerCase();
    if (type !== 'text_block') {
      question.required = TRUE_VALUES.has(requiredText);
      // Anything unrecognised is imported as optional, and said so, so a question meant to be
      // required is not quietly weakened.
      if (!question.required && !FALSE_VALUES.has(requiredText)) {
        issues.push({ row: rowNumber, level: 'warning', message: `Required value "${cell(row, 'required')}" was not recognised, so the question is optional. Use Yes or No.` });
      }
    }

    let help = cell(row, 'help');
    if (help.length > MAX_HELP_TEXT) {
      help = help.slice(0, MAX_HELP_TEXT);
      issues.push({ row: rowNumber, level: 'warning', message: `The help text was shortened to ${MAX_HELP_TEXT} characters.` });
    }

    if (type === 'text_block') {
      // A text block shows content, not a question: the help text is the content, or the
      // question text when there is no help text.
      question.richText = `<p>${escapeHtml(help || label)}</p>`;
    } else if (help) {
      question.helpText = help;
    }

    if (CHOICE_TYPES.includes(type)) {
      // "Other (please specify)" becomes the built-in Other option with its own answer box, which
      // replaces a plain "Other" as well.
      const otherKey = APPLICATION_OTHER_OPTION.toLocaleLowerCase();
      const wantsOther = options.some(option => option.toLocaleLowerCase() === otherKey);
      if (wantsOther) options = options.filter(option => option.toLocaleLowerCase() !== otherKey && !isPlainApplicationOtherOption(option));
      if (split.shortened) {
        issues.push({ row: rowNumber, level: 'warning', message: `Long options were shortened to ${MAX_OPTION} characters.` });
      }
      if (options.length > MAX_OPTIONS) {
        options = options.slice(0, MAX_OPTIONS);
        issues.push({ row: rowNumber, level: 'warning', message: `Only the first ${MAX_OPTIONS} options were kept.` });
      }
      if (options.length < 2) {
        issues.push({ row: rowNumber, level: 'error', message: 'A choice question needs at least two options, separated by semicolons.' });
        continue;
      }
      question.options = options;
      if (wantsOther) question.allowOther = true;
    } else if (type === 'yes_no' && options.length && !(options.length === 2 && options[0].toLowerCase() === 'yes' && options[1].toLowerCase() === 'no')) {
      issues.push({ row: rowNumber, level: 'warning', message: 'A Yes or no question only offers Yes and No, so the listed options were ignored. Use Multiple choice to keep them.' });
    } else if (options.length && type !== 'yes_no') {
      issues.push({ row: rowNumber, level: 'warning', message: 'Options were ignored because this question type does not use them.' });
    }

    questions.push(question);
  }

  if (!questions.length && !issues.some(issue => issue.level === 'error')) {
    issues.push({ row: 0, level: 'error', message: 'No questions were found below the heading row.' });
  }
  return { questions, issues };
}

/**
 * A message when a CSV file did not parse cleanly, or null. An unclosed quote makes the parser
 * swallow the following rows into one cell, which would otherwise import as a single odd question
 * with no warning. Papa reports a one-column file as an undetectable delimiter; that is harmless.
 */
export function csvParseProblem(errors: { code?: string; row?: number; message?: string }[]): string | null {
  const problem = errors.find(error => error.code !== 'UndetectableDelimiter');
  if (!problem) return null;
  const where = typeof problem.row === 'number' ? ` near row ${problem.row + 1}` : '';
  return `This CSV file could not be read${where}: ${problem.message || 'it is not valid CSV'}. Check for a missing closing quote mark, or save the file again from your spreadsheet app.`;
}

/** CSV text for the template download, with cells quoted where needed. */
export function questionImportTemplateCsv(): string {
  return QUESTION_IMPORT_TEMPLATE_ROWS.map(row => row.map(value => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(',')).join('\r\n');
}
