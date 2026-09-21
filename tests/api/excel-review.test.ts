import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { makeSupabaseStub } from '../helpers/supabaseStub';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/ai-limits-server', async () => {
  const { AI_LIMIT_DEFAULTS } = await import('@/lib/ai-limits');
  return { getAiLimits: async () => AI_LIMIT_DEFAULTS, aiTierFor: async () => 'paid' };
});

vi.mock('@/lib/redis', () => ({ getRedis: () => ({ get: vi.fn(async () => 0), ttl: vi.fn(async () => -2) }) }));
vi.mock('@/lib/rate-limit', () => ({ bumpRateLimit: vi.fn(async () => false) }));
vi.mock('@/lib/ai', () => ({ generateJSON: vi.fn() }));

import { requireUser } from '@/lib/api-auth';
import { generateJSON } from '@/lib/ai';
import { bumpRateLimit } from '@/lib/rate-limit';
import { POST } from '@/app/api/excel-review/route';

const mockRequireUser = vi.mocked(requireUser);
const mockGenerateJSON = vi.mocked(generateJSON);
const mockBumpRateLimit = vi.mocked(bumpRateLimit);

// A workbook whose required total is typed in rather than calculated -- the submission shape the
// rubric gate exists for.
async function workbook(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Income Statements');
  ws.getCell('A10').value = 'Revenue';
  ws.getCell('B10').value = 62020;
  ws.getCell('A12').value = 'Gross margin';
  ws.getCell('B12').value = 42672;
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer as ArrayBuffer], 'student.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function workbookWithSheets(names: string[]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  names.forEach((name, index) => {
    const ws = wb.addWorksheet(name);
    ws.getCell('A1').value = `marker-${index + 1}`;
    ws.getCell('B1').value = { formula: `${index + 1}+1`, result: index + 2 };
  });
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer as ArrayBuffer], 'student.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function workbookWithManyFormulas(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Calculations');
  for (let row = 1; row <= 201; row++) ws.getCell(row, 1).value = { formula: `${row}+1`, result: row + 1 };
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer as ArrayBuffer], 'student.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function workbookWithOversizedFirstSheet(): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const first = wb.addWorksheet('Very Large');
  for (let row = 1; row <= 1_100; row++) first.getCell(row, 1).value = `${String(row).padStart(4, '0')}-${'x'.repeat(300)}`;
  const second = wb.addWorksheet('Summary');
  second.getCell('A1').value = 'required summary';
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer as ArrayBuffer], 'student.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function actorDbFor(item: Record<string, unknown> | null) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'courses' && item ? { questions: [{ id: 'excel-1', type: 'excel_review', ...item }] } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

interface ReviewOptions {
  accessible?: boolean;
  authOverride?: any;
  file?: File;
  reviewSheetNames?: string[];
  minScore?: number;
  context?: string;
  targetRaw?: string;
  clientFields?: Record<string, string>;
}

async function review(rubric?: string[], options: ReviewOptions = {}): Promise<any> {
  mockRequireUser.mockResolvedValue(options.authOverride ?? {
    user: { id: 'u1' },
    actor: { id: 'u1' },
    getActorDb: () => options.accessible === false
      ? actorDbFor(null)
      : actorDbFor({
          context: options.context ?? 'Gross margin must be calculated.',
          rubric: rubric ?? [],
          minScore: options.minScore,
          reviewSheetNames: options.reviewSheetNames ?? [],
        }),
    serviceDb: {},
  } as any);
  const body = new FormData();
  body.append('file', options?.file ?? await workbook());
  body.append('reviewTarget', options.targetRaw ?? JSON.stringify({ source: 'course', contentId: 'course-1', itemId: 'excel-1' }));
  for (const [key, value] of Object.entries(options.clientFields ?? {})) body.append(key, value);
  const res = await POST(new Request('http://localhost/api/excel-review', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
    body,
  }) as any) as unknown as Response;
  return { status: res.status, json: await res.json() };
}

const baseReview = {
  overallScore: 98,
  executiveSummary: 'Strong formulas throughout.',
  issues: [],
  categories: [],
  topRecommendations: [],
};

const CRITERIA = ['B12 contains a formula', 'B16 contains a formula', 'Values agree', 'Labels intact'];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/excel-review - rubric gating', () => {
  it('reviews multiple instructor-specified worksheets beyond the legacy first-five limit', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });
    const file = await workbookWithSheets(Array.from({ length: 10 }, (_, i) => `Sheet ${i + 1}`));

    const { status, json } = await review(undefined, {
      file,
      reviewSheetNames: ['Sheet 6', 'Sheet 10'],
    });

    expect(status).toBe(200);
    expect(json.reviewedSheetNames).toEqual(['Sheet 6', 'Sheet 10']);
    const prompt = String(mockGenerateJSON.mock.calls[0][0]);
    expect(prompt).toContain('Sheet: Sheet 6');
    expect(prompt).toContain('marker-6');
    expect(prompt).toContain('Sheet: Sheet 10');
    expect(prompt).toContain('marker-10');
    expect(prompt).not.toContain('Sheet: Sheet 1\n');
    expect(prompt).not.toContain('marker-1\n');
  });

  it('matches instructor-specified worksheet names without regard to letter case', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });

    const { status, json } = await review(undefined, {
      reviewSheetNames: ['income statements'],
    });

    expect(status).toBe(200);
    expect(json.reviewedSheetNames).toEqual(['Income Statements']);
  });

  it('rejects the review when any instructor-specified worksheet is missing', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });

    const { status, json } = await review(undefined, {
      reviewSheetNames: ['Income Statements', 'Forecast'],
    });

    expect(status).toBe(400);
    expect(json.missingSheetNames).toEqual(['Forecast']);
    expect(json.availableSheetNames).toEqual(['Income Statements']);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
    expect(mockBumpRateLimit).not.toHaveBeenCalled();
  });

  it('loads review configuration from storage and ignores client-supplied replacements', async () => {
    mockGenerateJSON.mockResolvedValue({
      ...baseReview,
      rubricGrades: CRITERIA.map((_, i) => ({ id: i + 1, passed: true, comment: 'checked' })),
    });

    const { json } = await review(CRITERIA, {
      context: 'Authoritative instructor context.',
      minScore: 80,
      clientFields: {
        context: 'Tampered context.',
        rubric: '[]',
        reviewSheetNames: 'not-json',
      },
    });

    const prompt = String(mockGenerateJSON.mock.calls[0][0]);
    expect(prompt).toContain('Authoritative instructor context.');
    expect(prompt).not.toContain('Tampered context.');
    expect(prompt).toContain(`id 4: ${CRITERIA[3]}`);
    expect(json.minScore).toBe(80);
    expect(json.passed).toBe(true);
  });

  it('does not expose review configuration the caller cannot access', async () => {
    const { status } = await review(undefined, { accessible: false });

    expect(status).toBe(404);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
    expect(mockBumpRateLimit).not.toHaveBeenCalled();
  });

  it('keeps the legacy first-five worksheet cap when no worksheets were configured', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });
    const file = await workbookWithSheets(Array.from({ length: 6 }, (_, i) => `Sheet ${i + 1}`));

    const { json } = await review(undefined, { file });

    expect(json.reviewedSheetNames).toEqual(['Sheet 1', 'Sheet 2', 'Sheet 3', 'Sheet 4', 'Sheet 5']);
    const prompt = String(mockGenerateJSON.mock.calls[0][0]);
    expect(prompt).not.toContain('Sheet: Sheet 6');
  });

  it('records worksheet extraction details in AI usage metadata', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });

    await review(undefined, { reviewSheetNames: ['Income Statements'] });

    const options = mockGenerateJSON.mock.calls[0][2] as any;
    expect(options.usageContext.metadata.reviewedSheetNames).toBe('["Income Statements"]');
    expect(options.usageContext.metadata.reviewedSheetCount).toBe(1);
    expect(options.usageContext.metadata.extractedChars).toBeGreaterThan(0);
    expect(options.usageContext.metadata.extractionTruncated).toBe(false);
  });

  it('caps formula listings without turning an ordinary formula-heavy sheet into a partial review', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });

    const { status, json } = await review(undefined, {
      file: await workbookWithManyFormulas(),
      reviewSheetNames: ['Calculations'],
      minScore: 70,
    });

    expect(status).toBe(200);
    expect(json.passed).toBe(true);
    expect(json.partiallyReviewedSheetNames).toEqual([]);
    expect(String(mockGenerateJSON.mock.calls[0][0])).toContain('formula listing capped at 200 formulas');
    expect(mockBumpRateLimit).toHaveBeenCalledTimes(1);
  });

  it('still decides a pass or fail when the byte budget cuts off a reached worksheet', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });

    const { status, json } = await review(undefined, {
      file: await workbookWithOversizedFirstSheet(),
      reviewSheetNames: ['Very Large'],
      minScore: 70,
    });

    expect(status).toBe(200);
    expect(json.passed).toBe(true);
    expect(json.extractionTruncated).toBe(true);
    expect(json.partiallyReviewedSheetNames).toEqual(['Very Large']);
    // The model is told what it could not see, and what to do about a criterion it cannot check.
    expect(String(mockGenerateJSON.mock.calls[0][0])).toContain('mark it as not passed');
    expect(mockBumpRateLimit).toHaveBeenCalledTimes(1);
  });

  it('loads an accessible virtual experience review configuration through actor RLS', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });
    const ve = {
      modules: [{ lessons: [{ requirements: [{ id: 'excel-ve', type: 'excel_review', context: 'VE context' }] }] }],
    };

    const { status } = await review(undefined, {
      targetRaw: JSON.stringify({ source: 'virtual_experience', contentId: 've-1', itemId: 'excel-ve' }),
      authOverride: {
        user: { id: 'u1' },
        actor: { id: 'u1' },
        getActorDb: () => makeSupabaseStub({ virtual_experiences: { data: ve } }),
        serviceDb: {},
      },
    });

    expect(status).toBe(200);
    expect(String(mockGenerateJSON.mock.calls[0][0])).toContain('VE context');
  });

  it('rejects a virtual experience assignment that does not target the caller', async () => {
    const ve = {
      id: 've-1',
      user_id: 'owner-1',
      modules: [{ lessons: [{ requirements: [{ id: 'excel-ve', type: 'excel_review' }] }] }],
    };
    const { status } = await review(undefined, {
      targetRaw: JSON.stringify({ source: 'virtual_experience', contentId: 've-1', itemId: 'excel-ve', assignmentId: 'assignment-1' }),
      authOverride: {
        user: { id: 'u1' },
        actor: { id: 'u1' },
        getActorDb: () => makeSupabaseStub({ virtual_experiences: { data: null } }),
        serviceDb: makeSupabaseStub({
          virtual_experiences: { data: ve },
          assignments: { data: { id: 'assignment-1', created_by: 'owner-1', status: 'published', config: { ve_form_id: 've-1' }, cohort_ids: ['c-1'], group_ids: [] } },
          students: { data: { role: 'student', cohort_id: 'c-9' } },
          group_members: { data: [] },
        }),
      },
    });

    expect(status).toBe(404);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
    expect(mockBumpRateLimit).not.toHaveBeenCalled();
  });

  it('allows a virtual experience assignment that targets the caller cohort', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });
    const ve = {
      id: 've-1',
      user_id: 'owner-1',
      modules: [{ lessons: [{ requirements: [{ id: 'excel-ve', type: 'excel_review', context: 'Assigned VE context' }] }] }],
    };
    const { status } = await review(undefined, {
      targetRaw: JSON.stringify({ source: 'virtual_experience', contentId: 've-1', itemId: 'excel-ve', assignmentId: 'assignment-1' }),
      authOverride: {
        user: { id: 'u1' },
        actor: { id: 'u1' },
        getActorDb: () => makeSupabaseStub({ virtual_experiences: { data: null } }),
        serviceDb: makeSupabaseStub({
          virtual_experiences: { data: ve },
          assignments: { data: { id: 'assignment-1', created_by: 'owner-1', status: 'published', config: { ve_form_id: 've-1' }, cohort_ids: ['c-9'], group_ids: [] } },
          students: { data: { role: 'student', cohort_id: 'c-9' } },
          group_members: { data: [] },
        }),
      },
    });

    expect(status).toBe(200);
    expect(String(mockGenerateJSON.mock.calls[0][0])).toContain('Assigned VE context');
  });

  it('reads a second required worksheet even when the first one is oversized', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });

    const { status, json } = await review(undefined, {
      file: await workbookWithOversizedFirstSheet(),
      reviewSheetNames: ['Very Large', 'Summary'],
      minScore: 70,
    });

    // Each worksheet gets its own share of the budget, so the oversized first one is cut short
    // rather than starving the second one the instructor also required.
    expect(status).toBe(200);
    expect(json.partiallyReviewedSheetNames).toEqual(['Very Large']);
    expect(json.reviewedSheetNames).toEqual(['Summary']);
    const prompt = String(mockGenerateJSON.mock.calls[0][0]);
    expect(prompt).toContain('Sheet: Summary');
    expect(prompt).toContain('required summary');
  });

  it('rejects malformed review targets without spending allowance', async () => {
    const { status } = await review(undefined, { targetRaw: 'not-json' });
    expect(status).toBe(400);
    expect(mockBumpRateLimit).not.toHaveBeenCalled();
  });

  it('rejects malformed stored worksheet lists', async () => {
    const { status, json } = await review(undefined, { reviewSheetNames: 'Income Statements' as any });
    expect(status).toBe(400);
    expect(json.error).toContain('Worksheet names must be a list');
    expect(mockBumpRateLimit).not.toHaveBeenCalled();
  });

  it('rejects more than twenty configured worksheets', async () => {
    const { status, json } = await review(undefined, {
      reviewSheetNames: Array.from({ length: 21 }, (_, i) => `Sheet ${i + 1}`),
    });
    expect(status).toBe(400);
    expect(json.error).toContain('no more than 20');
    expect(mockBumpRateLimit).not.toHaveBeenCalled();
  });

  it('rejects configured worksheet names longer than Excel allows', async () => {
    const { status, json } = await review(undefined, {
      reviewSheetNames: ['x'.repeat(32)],
    });
    expect(status).toBe(400);
    expect(json.error).toContain('31 characters or fewer');
    expect(mockBumpRateLimit).not.toHaveBeenCalled();
  });

  it('leaves the gate on the quality score when no rubric was set', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });
    const { status, json } = await review();
    expect(status).toBe(200);
    expect(json.rubricScore).toBeNull();
    expect(json.rubricCriteriaCount).toBeUndefined();
    expect(mockGenerateJSON).toHaveBeenCalledTimes(1);
  });

  it('scores the share of criteria met, not the quality score', async () => {
    mockGenerateJSON.mockResolvedValue({
      ...baseReview,
      rubricGrades: CRITERIA.map((_, i) => ({ id: i + 1, passed: i === 0, comment: 'checked' })),
    });
    const { json } = await review(CRITERIA);
    expect(json.rubricScore).toBe(25);
    expect(json.rubricCriteriaCount).toBe(4);
    expect(json.overallScore).toBe(98);
  });

  it('cannot be bypassed by a response that omits the grades entirely', async () => {
    mockGenerateJSON.mockResolvedValue({ ...baseReview });
    const { json } = await review(CRITERIA);
    // Null would send every consumer back to the 98, which is the bypass.
    expect(json.rubricScore).toBe(0);
    expect(json.rubricGrades).toHaveLength(4);
    expect(json.rubricGrades.every((g: any) => g.passed === false)).toBe(true);
    expect(json.rubricUngraded).toBe(4);
  });

  it('discards an invented id instead of letting it stand in for a real criterion', async () => {
    mockGenerateJSON.mockResolvedValue({
      ...baseReview,
      rubricGrades: [
        { id: 1, passed: true, comment: '' },
        { id: 2, passed: true, comment: '' },
        { id: 3, passed: true, comment: '' },
        { id: 9, passed: true, comment: 'a criterion the model made up' },
      ],
    });

    const { json } = await review(CRITERIA);

    expect(json.rubricUngraded).toBe(1);
    expect(json.rubricGrades).toHaveLength(4);
    expect(json.rubricGrades[3]).toMatchObject({ criterion: CRITERIA[3], passed: false });
    expect(json.rubricScore).toBe(75);
  });

  it('retries when a criterion is skipped even though the grade count matches', async () => {
    // Four grades, but criterion 1 was graded twice and criterion 4 not at all.
    const duplicated = [
      { id: 1, passed: true, comment: '' },
      { id: 1, passed: true, comment: '' },
      { id: 2, passed: true, comment: '' },
      { id: 3, passed: true, comment: '' },
    ];
    mockGenerateJSON.mockResolvedValue({ ...baseReview, rubricGrades: duplicated });

    const { json } = await review(CRITERIA);

    expect(mockGenerateJSON).toHaveBeenCalledTimes(2);
    expect(json.rubricUngraded).toBe(1);
    expect(json.rubricGrades[3]).toMatchObject({ criterion: CRITERIA[3], passed: false });
    expect(json.rubricScore).toBe(75);
  });

  it('keeps a retry that covers more criteria without covering them all', async () => {
    mockGenerateJSON
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [{ id: 1, passed: true, comment: '' }] })
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [
        { id: 1, passed: true, comment: '' },
        { id: 2, passed: true, comment: '' },
        { id: 3, passed: true, comment: '' },
      ] });

    const { json } = await review(CRITERIA);

    // The better partial answer is kept: 3 of 4 covered and passed, not the first attempt's 1.
    expect(json.rubricUngraded).toBe(1);
    expect(json.rubricScore).toBe(75);
  });

  it('merges a retry that graded different criteria rather than more of them', async () => {
    // Neither response covers more than the other, so picking one whole response would discard
    // half the rubric. Together they cover it.
    mockGenerateJSON
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [
        { id: 1, passed: true, comment: '' },
        { id: 2, passed: true, comment: '' },
      ] })
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [
        { id: 3, passed: true, comment: '' },
        { id: 4, passed: false, comment: '' },
      ] });

    const { json } = await review(CRITERIA);

    expect(json.rubricUngraded).toBe(0);
    expect(json.rubricGrades.map((g: any) => g.passed)).toEqual([true, true, true, false]);
    expect(json.rubricScore).toBe(75);
  });

  it('resolves a criterion graded by both attempts in favour of the first', async () => {
    mockGenerateJSON
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [{ id: 1, passed: false, comment: 'first attempt' }] })
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [
        { id: 1, passed: true, comment: 'second attempt' },
        { id: 2, passed: true, comment: '' },
      ] });

    const { json } = await review(CRITERIA);

    expect(json.rubricGrades[0]).toMatchObject({ passed: false, comment: 'first attempt' });
    expect(json.rubricGrades[1].passed).toBe(true);
    expect(json.rubricScore).toBe(25);
  });

  it('keeps the first attempt when the retry adds nothing', async () => {
    mockGenerateJSON
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [
        { id: 1, passed: true, comment: '' },
        { id: 2, passed: true, comment: '' },
        { id: 3, passed: true, comment: '' },
      ] })
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [{ id: 1, passed: false, comment: '' }] });

    const { json } = await review(CRITERIA);

    expect(json.rubricScore).toBe(75);
    expect(json.rubricUngraded).toBe(1);
    expect(json.rubricGrades[1].passed).toBe(true);
  });

  it('returns every criterion, including the ones the AI never graded', async () => {
    mockGenerateJSON.mockResolvedValue({
      ...baseReview,
      rubricGrades: [{ id: 1, passed: true, comment: 'checked B12' }],
    });

    const { json } = await review(CRITERIA);

    expect(json.rubricGrades).toHaveLength(4);
    expect(json.rubricGrades.map((g: any) => g.criterion)).toEqual(CRITERIA);
    expect(json.rubricUngraded).toBe(3);
    expect(json.rubricGrades[2].comment).toContain('did not grade this criterion');
  });

  it('retries once when the model grades fewer criteria than were set', async () => {
    mockGenerateJSON
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [{ id: 1, passed: true, comment: '' }] })
      .mockResolvedValueOnce({
        ...baseReview,
        rubricGrades: CRITERIA.map((_, i) => ({ id: i + 1, passed: i < 2, comment: '' })),
      });
    const { json } = await review(CRITERIA);
    expect(mockGenerateJSON).toHaveBeenCalledTimes(2);
    expect(json.rubricGrades).toHaveLength(4);
    expect(json.rubricScore).toBe(50);
  });

  it('counts still-ungraded criteria as not met when the retry also comes up short', async () => {
    mockGenerateJSON.mockResolvedValue({
      ...baseReview,
      rubricGrades: [
        { id: 1, passed: true, comment: '' },
        { id: 2, passed: true, comment: '' },
      ],
    });
    const { json } = await review(CRITERIA);
    expect(mockGenerateJSON).toHaveBeenCalledTimes(2);
    // Two of four, both passed. Scoring over graded criteria alone would read 100.
    expect(json.rubricScore).toBe(50);
  });

  it('keeps the review when the retry call itself fails', async () => {
    mockGenerateJSON
      .mockResolvedValueOnce({ ...baseReview, rubricGrades: [{ id: 1, passed: true, comment: '' }] })
      .mockRejectedValueOnce(new Error('503 UNAVAILABLE'));
    const { status, json } = await review(CRITERIA);
    expect(status).toBe(200);
    expect(json.rubricScore).toBe(25);
  });

  it('discards a grade with no id or no verdict rather than letting it pass by default', async () => {
    mockGenerateJSON.mockResolvedValue({
      ...baseReview,
      rubricGrades: [
        { id: 1, passed: true, comment: 'ok' },
        { criterion: CRITERIA[1], comment: 'unsure' },
        { criterion: CRITERIA[2], passed: 'yes', comment: 'wrong type' },
        { id: 4, passed: true, comment: 'ok' },
      ],
    });
    const { json } = await review(CRITERIA);
    // The two malformed grades are discarded, so their criteria come back as explicit failures.
    expect(json.rubricGrades).toHaveLength(4);
    expect(json.rubricGrades.filter((g: any) => g.passed)).toHaveLength(2);
    expect(json.rubricUngraded).toBe(2);
    expect(json.rubricScore).toBe(50);
  });

  it('numbers the criteria and states the omission policy in the prompt', async () => {
    mockGenerateJSON.mockResolvedValue({
      ...baseReview,
      rubricGrades: CRITERIA.map((_, i) => ({ id: i + 1, passed: true, comment: '' })),
    });
    await review(CRITERIA);
    const [prompt, schema] = mockGenerateJSON.mock.calls[0];
    expect(String(prompt)).toContain('GRADE EACH CRITERION BY ID');
    expect(String(prompt)).toContain('Grade every id exactly once');
    expect(String(prompt)).toContain('Ids you omit are marked as not met');
    expect(String(prompt)).toContain(`id 4: ${CRITERIA[3]}`);
    expect((schema as any).properties.rubricGrades.items.required).toEqual(['id', 'passed', 'comment']);
    expect(String(prompt)).toContain('Absence of evidence is a fail');
    expect(String(prompt)).toContain('typed constant');
    expect((schema as any).required).toContain('rubricGrades');
  });
});
