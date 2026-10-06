import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { newApplicationFormConfig, validateApplicationForm } from '@/lib/application-forms';
import {
  MAX_IMPORTED_QUESTIONS,
  QUESTION_IMPORT_TEMPLATE_ROWS,
  parseApplicationQuestionRows,
  questionImportTemplateCsv,
} from '@/lib/application-question-import';

let counter = 0;
const makeId = () => `q-test-${++counter}`;
const parse = (rows: string[][]) => parseApplicationQuestionRows(rows, makeId);

describe('parseApplicationQuestionRows', () => {
  it('turns the template into questions the form accepts when saved', () => {
    const { questions, issues } = parse(QUESTION_IMPORT_TEMPLATE_ROWS);
    expect(issues).toEqual([]);
    expect(questions.map(question => [question.label, question.type, question.required])).toEqual([
      ['Full name', 'short_text', true],
      ['Phone number', 'phone', true],
      ['Highest level of education', 'dropdown', true],
      ['Which skills do you already have?', 'multiple_choice', false],
      ['Are you currently employed?', 'yes_no', true],
      ['Why do you want to join this programme?', 'long_text', true],
      ['Upload your CV', 'file', false],
    ]);
    expect(questions[1].helpText).toBe('Include your country code.');
    // "Other (please specify)" becomes the built-in Other option, not a plain option.
    expect(questions[2]).toMatchObject({ options: ['Secondary school', 'Diploma', "Bachelor's degree", "Master's degree"], allowOther: true });

    const config = { ...newApplicationFormConfig(), questions };
    expect(validateApplicationForm(config)).toEqual([]);
  });

  it('reads the downloaded template CSV back unchanged', () => {
    const rows = Papa.parse<string[]>(questionImportTemplateCsv()).data;
    expect(parse(rows).questions).toHaveLength(QUESTION_IMPORT_TEMPLATE_ROWS.length - 1);
  });

  it('finds columns by heading in any order and ignores extra columns', () => {
    const { questions, issues } = parse([
      ['Notes', 'Choices', 'Mandatory', 'Title', 'Question type'],
      ['ignore me', 'Online | In person', 'y', 'Preferred format', 'Radio'],
    ]);
    expect(issues).toEqual([]);
    expect(questions[0]).toMatchObject({ label: 'Preferred format', type: 'single_choice', required: true, options: ['Online', 'In person'] });
  });

  it('accepts Google Forms type names and guesses a missing type', () => {
    const { questions } = parse([
      ['Question', 'Type', 'Options'],
      ['A', 'Multiple choice', 'One; Two'],
      ['B', 'Checkboxes', 'One; Two'],
      ['C', 'Drop-down', 'One; Two'],
      ['D', 'Yes/No', ''],
      ['E', 'Short answer', ''],
      ['F', '', 'Red; Blue'],
      ['G', '', ''],
    ]);
    expect(questions.map(question => question.type)).toEqual(['single_choice', 'multiple_choice', 'dropdown', 'yes_no', 'short_text', 'single_choice', 'short_text']);
  });

  it('splits options on semicolons, pipes and new lines, dropping bullets and repeats', () => {
    const { questions } = parse([['Question', 'Options'], ['Pick', '- Excel\n- SQL; sql | 1. Python']]);
    expect(questions[0].options).toEqual(['Excel', 'SQL', 'Python']);
  });

  it('skips rows it cannot use and says why, keeping the rest', () => {
    const { questions, issues } = parse([
      ['Question', 'Type', 'Options'],
      ['Good', 'Paragraph', ''],
      ['Rate us', 'Linear scale', ''],
      ['Pick one', 'Dropdown', 'Only one'],
      ['', 'Short answer', ''],
      ['', '', ''],
      ['Email', 'Email', 'a; b'],
    ]);
    expect(questions.map(question => question.label)).toEqual(['Good', 'Email']);
    expect(issues).toEqual([
      { row: 3, level: 'error', message: 'Unknown question type "Linear scale". Use one of the types in the template.' },
      { row: 4, level: 'error', message: 'A choice question needs at least two options, separated by semicolons.' },
      { row: 5, level: 'error', message: 'The question is empty.' },
      { row: 7, level: 'warning', message: 'Options were ignored because this question type does not use them.' },
    ]);
  });

  it('keeps one Other: the specify option replaces a plain Other', () => {
    const { questions } = parse([['Question', 'Options'], ['Source', 'Friend; Social media; Other; Other (please specify)']]);
    expect(questions[0]).toMatchObject({ options: ['Friend', 'Social media'], allowOther: true });
    expect(parse([['Question', 'Options'], ['Source', 'Friend; Other (please specify)']]).issues[0]?.message)
      .toBe('A choice question needs at least two options, separated by semicolons.');
  });

  it('builds a text block from the help text, escaped', () => {
    const { questions } = parse([['Question', 'Type', 'Help text'], ['Before you start', 'Text block', 'Have your <CV> ready & a photo']]);
    expect(questions[0]).toMatchObject({ type: 'text_block', required: false, richText: '<p>Have your &lt;CV&gt; ready &amp; a photo</p>' });
    expect(questions[0].helpText).toBeUndefined();
  });

  it('needs a heading row with a Question column', () => {
    expect(parse([['Full name', 'Short answer']]).issues[0].message).toContain('Question column');
    expect(parse([]).issues[0].message).toBe('The file is empty.');
    expect(parse([['Question']]).issues[0].message).toBe('No questions were found below the heading row.');
  });

  it(`imports at most ${MAX_IMPORTED_QUESTIONS} questions`, () => {
    const rows = [['Question'], ...Array.from({ length: MAX_IMPORTED_QUESTIONS + 5 }, (_, index) => [`Q${index}`])];
    const { questions, issues } = parse(rows);
    expect(questions).toHaveLength(MAX_IMPORTED_QUESTIONS);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(`first ${MAX_IMPORTED_QUESTIONS}`);
  });

  it('gives every question its own id', () => {
    const { questions } = parseApplicationQuestionRows([['Question'], ['A'], ['B']]);
    expect(new Set(questions.map(question => question.id)).size).toBe(2);
    expect(questions[0].id).toMatch(/^q-/);
  });
});
