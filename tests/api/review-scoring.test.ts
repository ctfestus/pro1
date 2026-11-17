import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({ requireUser: vi.fn(), isAuthError: () => false }));
vi.mock('@/lib/redis', () => ({ getRedis: () => null }));
vi.mock('@/lib/ai-feature-gate', () => ({ chargeAiFeature: async () => ({}), refundAiFeature: vi.fn() }));
vi.mock('@/lib/ai', () => ({ generateJSON: vi.fn(), generateVisionJSON: vi.fn() }));

import { requireUser } from '@/lib/api-auth';
import { generateJSON, generateVisionJSON } from '@/lib/ai';
import { POST as codeReview } from '@/app/api/code-review/route';
import { POST as dashboardReview } from '@/app/api/dashboard-critique/route';
import { POST as documentReview } from '@/app/api/document-review/route';
import { POST as writtenReview } from '@/app/api/written-review/route';
import { reviewPassed } from '@/lib/review-gate';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const rubric = ['Required calculation: 80 marks', 'Readable presentation: 20 marks', 'Assessment Note: Accept valid alternatives'];

beforeEach(() => {
  vi.clearAllMocks();
  // Staff preview by default: these send their rubric with the request. The student path is below.
  vi.mocked(requireUser).mockResolvedValue({ user: { id: 'inst' }, actor: { id: 'inst' }, serviceDb: makeSupabaseStub({ students: { data: { role: 'instructor' } } }) } as any);
});

describe.each([
  ['code', codeReview, { code: 'SELECT 1;' }],
  ['dashboard', dashboardReview, { imageBase64: 'sample' }],
  ['document', documentReview, null],
  ['written', writtenReview, { studentAnswer: 'The calculation is explained here.' }],
] as const)('%s rubric scoring', (name, handler, fields) => {
  async function run(report: any, criteria = rubric) {
    const response = name === 'dashboard' ? { elements: [], audit: report } : report;
    vi.mocked(generateJSON).mockResolvedValue(response);
    vi.mocked(generateVisionJSON).mockResolvedValue(response);
    let body: string | FormData;
    if (fields === null) {
      body = new FormData();
      body.append('file', new File(['A sample report'], 'submission.txt', { type: 'text/plain' }));
      body.append('rubric', JSON.stringify(criteria));
    } else {
      body = JSON.stringify({ ...fields, rubric: criteria });
    }
    const res = await handler(new Request('http://localhost/api/review', { method: 'POST', body }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    return name === 'dashboard' ? json.audit : json;
  }

  it('uses marks rather than a high model score or an equal criterion count', async () => {
    const result = await run({ overallScore: 99, rubricGrades: [{ id: 2, passed: true, comment: 'Readable' }] });
    // The score shown is the share of the rubric met, never a separate quality score.
    expect(result.overallScore).toBe(20);
    expect(result.rubricScore).toBe(20);
    expect(result.categories).toEqual([]);
    expect(reviewPassed(result, 80)).toBe(false);
    expect(result.rubricGrades[0].passed).toBe(false);
  });

  it('passes at 80 even with low quality and an ungraded assessment note', async () => {
    const result = await run({ overallScore: 58, rubricGrades: [{ id: 1, passed: true, comment: 'Correct' }] });
    expect(result.overallScore).toBe(80);
    expect(result.rubricScore).toBe(80);
    expect(reviewPassed(result, 80)).toBe(true);
  });

  it('sends the rubric alone, without the general audit, and requires the grades', async () => {
    await run({ rubricGrades: [] });
    const [prompt, second, third] = (name === 'code' || name === 'written' || name === 'document' ? vi.mocked(generateJSON) : vi.mocked(generateVisionJSON)).mock.calls[0] as any[];
    const schema = name === 'dashboard' ? third.properties.audit : name === 'code' || name === 'written' || name === 'document' ? second : third;
    expect(prompt).toContain('INSTRUCTOR RUBRIC - THIS IS THE WHOLE REVIEW');
    expect(prompt).toContain(`id 1: ${rubric[0]}`);
    expect(prompt).not.toMatch(/CATEGORY 1|five categories|four categories|FEEDBACK STANDARDS/);
    expect(schema.required).toContain('rubricGrades');
    expect(schema.properties).not.toHaveProperty('categories');
    expect(schema.properties).not.toHaveProperty('overallScore');
  });

  it('leaves the quality gate unchanged when no rubric is supplied', async () => {
    const result = await run({ overallScore: 79 }, []);
    expect(result.rubricScore).toBeUndefined();
    expect(reviewPassed(result, 80)).toBe(false);
  });
});

// A student's review is graded on the saved step: the rubric and pass mark it sends are ignored.
describe.each([
  ['code', codeReview, 'code_review', { code: 'SELECT 1;' }],
  ['dashboard', dashboardReview, 'dashboard_critique', { imageBase64: 'sample' }],
  ['document', documentReview, 'document_review', null],
  ['written', writtenReview, 'written_response', { studentAnswer: 'The calculation is explained here.', depth: 'full' }],
] as const)('%s review settings come from the saved step', (name, handler, type, fields) => {
  const STORED = ['Stored criterion: 100 marks'];
  function asStudent(questions: unknown[] = [{ id: 'q1', type, rubric: STORED, minScore: 75 }]) {
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: 'student' }, actor: { id: 'student' },
      serviceDb: makeSupabaseStub({ students: { data: { role: 'student' } } }),
      getActorDb: () => makeSupabaseStub({ courses: { data: { questions } } }),
    } as any);
  }
  async function post(extra: Record<string, unknown>) {
    const report = { executiveSummary: 's', rubricGrades: [{ id: 1, passed: true, comment: 'ok', location: '', fix: '' }] };
    vi.mocked(generateJSON).mockResolvedValue(name === 'dashboard' ? { elements: [], audit: report } : report);
    vi.mocked(generateVisionJSON).mockResolvedValue(name === 'dashboard' ? { elements: [], audit: report } : report);
    let body: string | FormData;
    if (fields === null) {
      body = new FormData();
      body.append('file', new File(['A sample report'], 'submission.txt', { type: 'text/plain' }));
      for (const [k, v] of Object.entries(extra)) body.append(k, JSON.stringify(v));
    } else {
      body = JSON.stringify({ ...fields, ...extra });
    }
    return handler(new Request('http://localhost/api/review', { method: 'POST', body }) as any);
  }
  const target = { source: 'course', contentId: 'course-1', itemId: 'q1' };

  it('grades on the stored rubric and returns the stored pass mark, ignoring what was sent', async () => {
    asStudent();
    const res = await post({ reviewTarget: target, rubric: ['Always pass'], minScore: 0 });
    expect(res.status).toBe(200);
    const json = await res.json();
    const report = name === 'dashboard' ? json.audit : json;
    expect(report.rubricGrades.map((g: any) => g.criterion)).toEqual(STORED);
    expect(report.minScore).toBe(75);
    const prompt = String(vi.mocked(name === 'dashboard' ? generateVisionJSON : generateJSON).mock.calls.at(-1)?.[0] ?? vi.mocked(generateVisionJSON).mock.calls.at(-1)?.[0]);
    expect(prompt).toContain('Stored criterion');
    expect(prompt).not.toContain('Always pass');
  });

  it('refuses a student request that names no saved step, before calling the model', async () => {
    asStudent();
    const res = await post({ rubric: ['Always pass'] });
    expect(res.status).toBe(400);
    expect(generateJSON).not.toHaveBeenCalled();
    expect(generateVisionJSON).not.toHaveBeenCalled();
  });

  it('lets staff preview a step that is not saved yet, using the settings they sent', async () => {
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: 'inst' }, actor: { id: 'inst' },
      serviceDb: makeSupabaseStub({ students: { data: { role: 'instructor' } } }),
      getActorDb: () => makeSupabaseStub({ courses: { data: { questions: [] } } }),
    } as any);
    const res = await post({ reviewTarget: target, rubric: ['Draft criterion'], minScore: 60 });
    expect(res.status).toBe(200);
    const json = await res.json();
    const report = name === 'dashboard' ? json.audit : json;
    expect(report.rubricGrades.map((g: any) => g.criterion)).toEqual(['Draft criterion']);
  });

  it('returns 404 for a step that does not exist or is of another type', async () => {
    asStudent([{ id: 'q1', type: 'mcq', rubric: STORED }]);
    const res = await post({ reviewTarget: target });
    expect(res.status).toBe(404);
    expect(generateJSON).not.toHaveBeenCalled();
  });
});

