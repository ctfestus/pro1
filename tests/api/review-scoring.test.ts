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

const rubric = ['Required calculation: 80 marks', 'Readable presentation: 20 marks', 'Assessment Note: Accept valid alternatives'];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ user: { id: 'student' }, actor: { id: 'student' } } as any);
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
    expect(result.overallScore).toBe(99);
    expect(result.rubricScore).toBe(20);
    expect(reviewPassed(result, 80)).toBe(false);
    expect(result.rubricGrades[0].passed).toBe(false);
  });

  it('passes at 80 even with low quality and an ungraded assessment note', async () => {
    const result = await run({ overallScore: 58, rubricGrades: [{ id: 1, passed: true, comment: 'Correct' }] });
    expect(result.overallScore).toBe(58);
    expect(result.rubricScore).toBe(80);
    expect(reviewPassed(result, 80)).toBe(true);
  });

  it('leaves the quality gate unchanged when no rubric is supplied', async () => {
    const result = await run({ overallScore: 79 }, []);
    expect(result.rubricScore).toBeUndefined();
    expect(reviewPassed(result, 80)).toBe(false);
  });
});
