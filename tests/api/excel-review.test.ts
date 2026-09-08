import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(),
  isAuthError: (value: any) => !!value?.error,
}));

vi.mock('@/lib/redis', () => ({ getRedis: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({ bumpRateLimit: vi.fn(async () => false) }));
vi.mock('@/lib/ai', () => ({ generateJSON: vi.fn() }));

import { requireUser } from '@/lib/api-auth';
import { generateJSON } from '@/lib/ai';
import { POST } from '@/app/api/excel-review/route';

const mockRequireUser = vi.mocked(requireUser);
const mockGenerateJSON = vi.mocked(generateJSON);

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

async function review(rubric?: string[]): Promise<any> {
  const body = new FormData();
  body.append('file', await workbook());
  body.append('context', 'Gross margin must be calculated.');
  if (rubric) body.append('rubric', JSON.stringify(rubric));
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
  mockRequireUser.mockResolvedValue({ user: { id: 'u1' } } as any);
});

describe('POST /api/excel-review - rubric gating', () => {
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
