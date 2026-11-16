import { describe, it, expect } from 'vitest';

import { courseIssues, itemIssues, questionNumbers } from '@/lib/course-validation';

const mc = (o: any = {}) => ({ id: 'q', type: 'multiple_choice', question: 'Which tool?', options: ['A', 'B'], correctAnswer: 'A', ...o });

describe('course validation', () => {
  it('numbers only graded items, in course order, as learners see them', () => {
    const qs = [{ id: 's', isSection: true }, { id: 'l', lessonOnly: true }, mc({ id: 'a' }), { id: 'd', isDownloads: true }, mc({ id: 'b' })];
    expect(questionNumbers(qs)).toEqual([0, 0, 1, 0, 2]);
  });

  it('flags a lesson without a title and a module without a name', () => {
    expect(itemIssues({ id: 'l', lessonOnly: true, lesson: { title: ' ' } })[0].flag).toBe('Needs a title');
    expect(itemIssues({ id: 'l', lessonOnly: true, lesson: { title: 'Why clean data' } })).toEqual([]);
    expect(itemIssues({ id: 's', isSection: true, sectionTitle: '' })[0].flag).toBe('Needs a name');
  });

  it('never treats a blank option as the correct answer', () => {
    // A blank correct answer used to match blank options in the editor.
    const flags = itemIssues(mc({ options: ['Region', 'Revenue', '', ''], correctAnswer: '' }), 4).map(i => i.flag);
    expect(flags).toContain('No correct answer');
    expect(flags).toContain('Empty option');
    expect(itemIssues(mc({ correctAnswer: 'Not an option' }), 1).map(i => i.flag)).toContain('No correct answer');
    expect(itemIssues(mc(), 1)).toEqual([]);
  });

  it('names the question by its learner number in the readiness message', () => {
    expect(itemIssues(mc({ correctAnswer: '' }), 4)[0].message).toBe('Q4 has no correct answer');
  });

  it('checks fill in the blank, ordering and AI review questions', () => {
    expect(itemIssues({ id: 'f', type: 'fill_blank', question: 'x ___', correctAnswer: '' })[0].flag).toBe('No accepted answer');
    expect(itemIssues({ id: 'r', type: 'arrange', question: 'Order', options: ['a', ''] }).map(i => i.flag)).toEqual(['Needs two items', 'Empty item']);
    expect(itemIssues({ id: 'w', type: 'written_response', question: 'Explain', rubric: [''] })[0].flag).toBe('No rubric');
    expect(itemIssues({ id: 'w', type: 'written_response', question: 'Explain', rubric: ['Clear'] })).toEqual([]);
  });

  it('lists one line per item, with its module, for the readiness list', () => {
    const issues = courseIssues({ title: 'Excel', questions: [
      { id: 's1', isSection: true, sectionTitle: 'Cleaning' }, mc({ id: 'a' }),
      { id: 's2', isSection: true, sectionTitle: 'Summarising' }, { id: 'l', lessonOnly: true, lesson: { title: '' } },
      mc({ id: 'b', options: ['Region', 'Revenue', ''], correctAnswer: '' }),
    ] }).map(i => i.message);
    expect(issues).toEqual(['Module 2: a lesson has no title', 'Module 2: Q2 has no correct answer']);
  });

  it('flags a downloads page with no files, an unnamed item or a missing file', () => {
    expect(itemIssues({ id: 'd', isDownloads: true, downloadItems: [] })[0].flag).toBe('No files');
    expect(itemIssues({ id: 'd', isDownloads: true, downloadItems: [{ id: 'f', type: 'file', title: '' }] })[0].flag).toBe('Item needs a name');
    expect(itemIssues({ id: 'd', isDownloads: true, downloadItems: [{ id: 'f', type: 'link', title: 'Guide', linkUrl: '' }] })[0].flag).toBe('Missing a file');
    expect(itemIssues({ id: 'd', isDownloads: true, downloadItems: [{ id: 'f', type: 'file', title: 'Data', fileUrl: 'https://x/a.csv' }] })).toEqual([]);
  });

  it('treats an untouched draft name and an empty course as not ready', () => {
    const issues = courseIssues({ title: 'Untitled course', questions: [] }).map(i => i.message);
    expect(issues).toEqual(['The course needs a title', 'Add at least one lesson or question']);
    expect(courseIssues({ title: 'Excel basics', questions: [mc()] })).toEqual([]);
  });
});
