import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { normalizeFormConfig, validateFormConfig } from '@/lib/course-schema';
import {
  canAccessAssignedVirtualExperience,
  excelReviewSaveErrorMessage,
  normalizeAssignmentReviewSheetNames,
  normalizeCourseReviewSheetNames,
  normalizeExperienceReviewSheetNames,
  normalizeReviewSheetNames,
} from '@/lib/excel-review-config';

describe('Excel review worksheet configuration', () => {
  it('trims, removes blanks, and deduplicates names case-insensitively', () => {
    expect(normalizeReviewSheetNames([' Summary ', '', 'summary', 'Forecast']).names)
      .toEqual(['Summary', 'Forecast']);
  });

  it('rejects more than twenty unique names and names longer than 31 characters', () => {
    expect(normalizeReviewSheetNames(Array.from({ length: 21 }, (_, index) => `Sheet ${index}`)).error)
      .toContain('20');
    expect(normalizeReviewSheetNames(['x'.repeat(32)]).error).toContain('31');
  });

  it('keeps invalid course input visible to persistence validation', () => {
    const config = normalizeFormConfig({
      isCourse: true,
      questions: [{ id: 'excel-1', type: 'excel_review', reviewSheetNames: ['x'.repeat(32)] }],
    });

    expect(validateFormConfig(config)).toEqual({
      ok: false,
      error: 'Worksheet names must be 31 characters or fewer.',
    });
  });

  it('cleans worksheet lists on the import paths that skip the editor', () => {
    expect(normalizeAssignmentReviewSheetNames('excel_review', { reviewSheetNames: [' Summary ', '', 'summary'] }))
      .toEqual({ config: { reviewSheetNames: ['Summary'] } });

    expect(normalizeAssignmentReviewSheetNames('standard', {
      scenarios: [{ tasks: [
        { id: 't1', type: 'excel_review', reviewSheetNames: ['Forecast', 'forecast', ' '] },
        { id: 't2', type: 'mcq' },
      ] }],
    })).toEqual({
      config: { scenarios: [{ tasks: [
        { id: 't1', type: 'excel_review', reviewSheetNames: ['Forecast'] },
        { id: 't2', type: 'mcq' },
      ] }] },
    });
  });

  it('refuses an import it cannot clean instead of quietly changing it', () => {
    // A list that breaks a rule must never be silently emptied or shortened: that would delete the
    // instructor's worksheet choice and send the review back to reading the first sheets instead.
    const tooMany = { reviewSheetNames: Array.from({ length: 21 }, (_, i) => `Sheet ${i}`) };
    expect(normalizeAssignmentReviewSheetNames('excel_review', tooMany))
      .toEqual({ config: tooMany, error: expect.stringContaining('20') });

    const notAList = { reviewSheetNames: 'Summary' };
    expect(normalizeAssignmentReviewSheetNames('excel_review', notAList))
      .toEqual({ config: notAList, error: expect.stringContaining('list of text values') });

    const overlong = {
      scenarios: [{ tasks: [{ id: 't1', type: 'excel_review', reviewSheetNames: ['x'.repeat(32), 'Summary'] }] }],
    };
    const result = normalizeAssignmentReviewSheetNames('standard', overlong);
    expect(result.error).toContain('31');
    // Untouched, so the name that came after the overlong one is not lost.
    expect(result.config).toBe(overlong);
  });

  it('reports the worksheet rule rather than the database wording', () => {
    const dbError = { message: 'new row for relation "assignments" violates check constraint "assignments_excel_review_sheet_names_valid"' };
    expect(excelReviewSaveErrorMessage(dbError, 'fallback')).toContain('up to 20 names');
    expect(excelReviewSaveErrorMessage({ message: 'network down' }, 'fallback')).toBe('network down');
    expect(excelReviewSaveErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('applies the same rules to imported courses and experiences', () => {
    expect(normalizeCourseReviewSheetNames([
      { id: 'q1', type: 'excel_review', reviewSheetNames: [' Summary ', 'summary'] },
      { id: 'q2', type: 'mcq' },
    ])).toEqual({ questions: [
      { id: 'q1', type: 'excel_review', reviewSheetNames: ['Summary'] },
      { id: 'q2', type: 'mcq' },
    ] });

    const badCourse = [{ id: 'q1', type: 'excel_review', reviewSheetNames: ['x'.repeat(32)] }];
    expect(normalizeCourseReviewSheetNames(badCourse)).toEqual({ questions: badCourse, error: expect.stringContaining('31') });

    const modules = [{ lessons: [{ requirements: [
      { id: 'r1', type: 'excel_review', reviewSheetNames: ['Forecast', 'forecast'] },
      { id: 'r2', type: 'text' },
    ] }] }];
    expect(normalizeExperienceReviewSheetNames(modules)).toEqual({ modules: [{ lessons: [{ requirements: [
      { id: 'r1', type: 'excel_review', reviewSheetNames: ['Forecast'] },
      { id: 'r2', type: 'text' },
    ] }] }] });

    const badModules = [{ lessons: [{ requirements: [
      { id: 'r1', type: 'excel_review', reviewSheetNames: Array.from({ length: 21 }, (_, i) => `Sheet ${i}`) },
    ] }] }];
    const result = normalizeExperienceReviewSheetNames(badModules);
    expect(result.error).toContain('20');
    expect(result.modules).toBe(badModules);
  });

  it('keeps assignment database enforcement in the migration and fresh schema', () => {
    const migration = readFileSync(join(process.cwd(), 'migrations/213_assignment_excel_review_sheet_validation.sql'), 'utf8');
    const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');

    for (const source of [migration, schema]) {
      expect(source).toContain('assignment_excel_review_sheets_valid');
      expect(source).toContain('assignments_excel_review_sheet_names_valid');
      expect(source).toContain('jsonb_array_length(sheet_names) > 20');
      expect(source).toContain("length(value #>> '{}') > 31");
    }
  });

  it('limits the VE assignment fallback to owners, admins, and targeted learners', () => {
    const base = {
      userId: 'u1',
      callerRole: 'student',
      callerCohortId: 'c-9',
      callerGroupIds: ['g-9'],
      experienceOwnerId: 'owner-1',
      assignmentOwnerId: 'owner-1',
      assignmentCohortIds: ['c-1'],
      assignmentGroupIds: ['g-1'],
    };

    expect(canAccessAssignedVirtualExperience(base)).toBe(false);
    expect(canAccessAssignedVirtualExperience({ ...base, callerRole: 'instructor' })).toBe(false);
    expect(canAccessAssignedVirtualExperience({ ...base, callerRole: 'admin' })).toBe(true);
    expect(canAccessAssignedVirtualExperience({ ...base, experienceOwnerId: 'u1' })).toBe(true);
    expect(canAccessAssignedVirtualExperience({ ...base, assignmentOwnerId: 'u1' })).toBe(true);
    expect(canAccessAssignedVirtualExperience({ ...base, assignmentCohortIds: ['c-9'] })).toBe(true);
    expect(canAccessAssignedVirtualExperience({ ...base, assignmentGroupIds: ['g-9'] })).toBe(true);
  });
});
