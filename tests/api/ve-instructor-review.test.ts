import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';

// Instructor reports on files uploaded to a standalone VE:
// - the AI draft route (who may draft, which files it will open, size limits, and when a draft
//   spends the hourly allowance), and
// - saving reports through the review action of guided-project-progress.
// The "draft lands on the wrong student" guard lives in the dashboard UI, which this node-only
// harness does not render.

const SUPABASE = 'https://proj.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>();
  return { ...actual, requireRole: vi.fn(), requireUser: vi.fn() };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedis: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({ spendRateLimit: vi.fn() }));
vi.mock('@/lib/ai-feature-gate', () => ({ refundAiFeature: vi.fn() }));
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send: mockSend }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({ getTenantSettings: async () => ({ senderName: 'Team', supportEmail: 'help@example.com', appUrl: 'https://app.example.com' }) }));
vi.mock('@/lib/ai', () => ({ generateJSON: vi.fn(), generateVisionJSON: vi.fn() }));

import { requireRole, requireUser } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/admin-client';
import { spendRateLimit } from '@/lib/rate-limit';
import { refundAiFeature } from '@/lib/ai-feature-gate';
import { generateJSON, generateVisionJSON } from '@/lib/ai';
import { POST as draftPOST } from '@/app/api/ve-instructor-review/draft/route';
import { POST as progressPOST } from '@/app/api/guided-project-progress/route';

const mockRequireRole = vi.mocked(requireRole);
const mockRequireUser = vi.mocked(requireUser);
const mockBump = vi.mocked(spendRateLimit);
const mockRefund = vi.mocked(refundAiFeature);
const mockGenerateJSON = vi.mocked(generateJSON);
const mockGenerateVision = vi.mocked(generateVisionJSON);

const MODULES = [{ title: 'M1', lessons: [{ title: 'Mission', requirements: [
  { id: 'u1', type: 'upload', label: 'Upload your deck', description: '<p>Build the deck</p>' },
  { id: 't1', type: 'text', label: 'Reflect' },
] }] }];
const fileUrl = (name: string, ve = 've1') => `${SUPABASE}/storage/v1/object/public/form-assets/submissions/${ve}/s%40x.com/u1-1-${name}`;

const AI_REPORT = {
  score: 72, summary: 'Good start.',
  findings: [{ location: 'Slide 2', severity: 'critical', title: 'Wrong total', detail: 'd', fix: 'f' }],
  categories: [
    { name: 'Accuracy', score: 60, summary: 's', strengths: ['a'], gaps: ['g'] },
    { name: 'Analysis', score: 70, summary: 's', strengths: [], gaps: [] },
    { name: 'Communication', score: 80, summary: 's', strengths: [], gaps: [] },
  ],
  recommendations: ['one', 'two', 'three'],
};

// Chainable read-only stub: every table query resolves to the configured row.
function readStub(rows: Record<string, any>) {
  return {
    from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, single: async () => ({ data: rows[table] ?? null, error: null }) };
      return q;
    },
  };
}

// The file URL the attempt holds after setupDraft; the panel sends it with each draft request.
let panelFileUrl = '';

function setupDraft({ ownerId = 'inst1', role = 'instructor', file = 'deck.txt', ve = 've1', modules = MODULES }: { ownerId?: string; role?: string; file?: string; ve?: string; modules?: any[] } = {}) {
  mockRequireRole.mockResolvedValue({ user: { id: 'inst1' }, role } as any);
  panelFileUrl = fileUrl(file, ve);
  vi.mocked(adminClient).mockReturnValue(readStub({
    guided_project_attempts: { ve_id: 've1', progress: { u1: { fileUrl: fileUrl(file, ve), completed: true } } },
    virtual_experiences: { user_id: ownerId, title: 'Market Entry', modules, company: 'Acme', role: 'Analyst' },
  }) as any);
}

function respondWith(body: BodyInit, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn(async () => new Response(body, { status: 200, headers }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const draft = (body: Record<string, unknown> = { attemptId: 'a1', reqId: 'u1', fileUrl: panelFileUrl }) =>
  draftPOST(new Request('http://localhost/api/ve-instructor-review/draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any);

beforeEach(() => {
  vi.clearAllMocks();
  mockBump.mockResolvedValue({ allowed: true, ttlSeconds: 3600 });
  mockRefund.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('AI draft route', () => {
  it('drafts a report from a text file and spends one allowance', async () => {
    setupDraft();
    respondWith('Revenue grew 12 percent.');
    mockGenerateJSON.mockResolvedValue(AI_REPORT);

    const res = await draft();
    expect(res.status).toBe(200);
    const { report } = await res.json();
    expect(report.findings[0].severity).toBe('error');
    expect(report.aiDrafted).toBe(true);
    expect(mockBump).toHaveBeenCalledTimes(1);
    expect(mockRefund).not.toHaveBeenCalled();
    expect(String(mockGenerateJSON.mock.calls[0][0])).toContain('Revenue grew 12 percent.');
  });

  it('records the reviewed file on the draft', async () => {
    setupDraft();
    respondWith('text');
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    const { report } = await (await draft()).json();
    expect(report.fileUrl).toBe(panelFileUrl);
  });

  it('refuses to draft when the student replaced the file after the panel loaded', async () => {
    setupDraft();
    const fetchMock = respondWith('text');
    const res = await draft({ attemptId: 'a1', reqId: 'u1', fileUrl: fileUrl('older-version.txt') });
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockBump).not.toHaveBeenCalled();
  });

  it('refuses an instructor who does not own the VE', async () => {
    setupDraft({ ownerId: 'someone-else' });
    const fetchMock = respondWith('x');
    expect((await draft()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets an admin draft on a VE they do not own', async () => {
    setupDraft({ ownerId: 'someone-else', role: 'admin' });
    respondWith('text');
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    expect((await draft()).status).toBe(200);
  });

  it('refuses a step that does not collect a file', async () => {
    setupDraft();
    expect((await draft({ attemptId: 'a1', reqId: 't1' })).status).toBe(400);
  });

  // The assignment player (AssignmentExperiencePlayer) writes into the same attempt, but stores files
  // as ve-submissions/<veId>/<userId>/<reqId>/<time>-<name>.
  function setupAssignmentUpload(veFolder: string) {
    setupDraft();
    panelFileUrl = `${SUPABASE}/storage/v1/object/public/form-assets/ve-submissions/${veFolder}/user1/u1/1-deck.txt`;
    vi.mocked(adminClient).mockReturnValue(readStub({
      guided_project_attempts: { ve_id: 've1', progress: { u1: { fileUrl: panelFileUrl, completed: true } } },
      virtual_experiences: { user_id: 'inst1', title: 'Market Entry', modules: MODULES, company: 'Acme', role: 'Analyst' },
    }) as any);
  }

  it('drafts a file uploaded through the assignment VE player', async () => {
    setupAssignmentUpload('ve1');
    respondWith('text');
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    expect((await draft()).status).toBe(200);
  });

  it('opens an older double-escaped link by its repaired form, and records the saved link', async () => {
    setupDraft();
    // What the standalone player saved before uploads moved to the account-id folder.
    panelFileUrl = `${SUPABASE}/storage/v1/object/public/form-assets/submissions/ve1/s%2540x.com/u1-1-deck.txt`;
    vi.mocked(adminClient).mockReturnValue(readStub({
      guided_project_attempts: { ve_id: 've1', progress: { u1: { fileUrl: panelFileUrl, completed: true } } },
      virtual_experiences: { user_id: 'inst1', title: 'Market Entry', modules: MODULES, company: 'Acme', role: 'Analyst' },
    }) as any);
    const fetchMock = respondWith('text');
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    const res = await draft();
    expect(res.status).toBe(200);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${SUPABASE}/storage/v1/object/public/form-assets/submissions/ve1/s%40x.com/u1-1-deck.txt`);
    expect((await res.json()).report.fileUrl).toBe(panelFileUrl);
  });

  it('will not fetch an assignment upload filed under another VE', async () => {
    setupAssignmentUpload('other-ve');
    const fetchMock = respondWith('text');
    expect((await draft()).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('will not fetch a file outside this VE\'s submissions folder', async () => {
    setupDraft({ ve: 'other-ve' });
    const fetchMock = respondWith('x');
    expect((await draft()).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type before downloading or spending', async () => {
    setupDraft({ file: 'work.zip' });
    const fetchMock = respondWith('x');
    expect((await draft()).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockBump).not.toHaveBeenCalled();
  });

  it('rejects a file over 10 MB by its declared size without reading it', async () => {
    setupDraft({ file: 'scan.pdf' });
    respondWith('small', { 'content-length': String(11 * 1024 * 1024) });
    expect((await draft()).status).toBe(413);
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockGenerateVision).not.toHaveBeenCalled();
  });

  it('stops reading a body that passes 10 MB when no size is declared', async () => {
    setupDraft({ file: 'scan.pdf' });
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 12) controller.enqueue(chunk); else controller.close();
      },
    });
    respondWith(stream);
    expect((await draft()).status).toBe(413);
    expect(sent).toBeLessThanOrEqual(12);
    expect(mockRefund).toHaveBeenCalledTimes(1);
  });

  it('gives the allowance back for a file it cannot read', async () => {
    setupDraft({ file: 'broken.docx' });
    respondWith('this is not a zip');
    expect((await draft()).status).toBe(422);
    expect(mockBump).toHaveBeenCalledTimes(1);
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('returns 429 at the hourly limit without downloading the file or calling the model', async () => {
    setupDraft();
    const fetchMock = respondWith('text');
    mockBump.mockResolvedValue({ allowed: false, ttlSeconds: 0 });
    expect((await draft()).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockGenerateJSON).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('gives the allowance back to the window it was charged in when the model fails', async () => {
    setupDraft();
    respondWith('text');
    mockBump.mockResolvedValue({ allowed: true, ttlSeconds: 120 });
    mockGenerateJSON.mockRejectedValue(new Error('quota'));
    const before = Date.now();
    expect((await draft()).status).toBe(503);
    expect(mockRefund).toHaveBeenCalledTimes(1);
    const receipt = mockRefund.mock.calls[0][0] as any;
    expect(receipt.counterKey).toBe('rate:ve-instructor-review:inst1');
    expect(receipt.windowEndsAt).toBeGreaterThanOrEqual(before + 120_000);
    expect(receipt.windowEndsAt).toBeLessThan(before + 125_000);
  });

  it('refuses, and refunds, a draft missing the promised dimensions or next steps', async () => {
    setupDraft();
    respondWith('text');
    mockGenerateJSON.mockResolvedValue({ ...AI_REPORT, categories: AI_REPORT.categories.slice(0, 1) });
    expect((await draft()).status).toBe(502);
    mockGenerateJSON.mockResolvedValue({ ...AI_REPORT, recommendations: ['only one'] });
    expect((await draft()).status).toBe(502);
    expect(mockRefund).toHaveBeenCalledTimes(2);
  });

  it('trims a draft to at most 5 dimensions and exactly 3 next steps', async () => {
    setupDraft();
    respondWith('text');
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `D${i}`, score: 50, summary: 's', strengths: [], gaps: [] }));
    mockGenerateJSON.mockResolvedValue({ ...AI_REPORT, categories: many, recommendations: ['a', 'b', 'c', 'd'] });
    const { report } = await (await draft()).json();
    expect(report.categories).toHaveLength(5);
    expect(report.recommendations).toEqual(['a', 'b', 'c']);
  });

  it('gives the allowance back when the model returns an empty draft', async () => {
    setupDraft();
    respondWith('text');
    mockGenerateJSON.mockResolvedValue({ score: 50, summary: '', findings: [], categories: [], recommendations: [] });
    expect((await draft()).status).toBe(502);
    expect(mockRefund).toHaveBeenCalledTimes(1);
  });
});

describe('AI draft route: the brief sent to the model', () => {
  const prompt = () => String(mockGenerateJSON.mock.calls[0][0]);

  it('uses the email the student saw on an email-style step, plus the mission content', async () => {
    setupDraft({ modules: [{ title: 'M1', lessons: [{ title: 'Mission', body: '<p>Use the Q3 sales data only.</p>', requirements: [
      { id: 'u1', type: 'upload', label: 'Send the deck', emailFrame: true, emailBody: 'Hi {{first_name}}, include a churn slide.', description: 'old text' },
    ] }] }] });
    respondWith('text');
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    await draft();
    expect(prompt()).toContain('include a churn slide');
    expect(prompt()).not.toContain('old text');
    expect(prompt()).toContain('Use the Q3 sales data only.');
  });

  it('drafts for a file attached to an older email-style deliverable', async () => {
    setupDraft({ modules: [{ title: 'M1', lessons: [{ title: 'Mission', requirements: [
      { id: 'u1', type: 'deliverable', label: 'Final memo', emailFrame: true, emailBody: 'Write the memo.' },
    ] }] }] });
    respondWith('text');
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    expect((await draft()).status).toBe(200);
    expect(prompt()).toContain('Write the memo.');
  });
});

describe('AI draft route: Excel worksheets', () => {
  async function workbook(names: string[]): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook();
    for (const name of names) wb.addWorksheet(name).getCell('A1').value = `marker-${name}`;
    return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  }
  const withSheets = (reviewSheetNames?: string[]) => [{ title: 'M1', lessons: [{ title: 'Mission', requirements: [
    { id: 'u1', type: 'upload', label: 'Upload your model', ...(reviewSheetNames ? { reviewSheetNames } : {}) },
  ] }] }];
  const prompt = () => String(mockGenerateJSON.mock.calls[0][0]);

  it('reads only the worksheets listed on the File Upload step', async () => {
    setupDraft({ file: 'model.xlsx', modules: withSheets(['Summary']) });
    respondWith(await workbook(['Data', 'Calc', 'Summary']));
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    const res = await draft();
    expect(res.status).toBe(200);
    expect(prompt()).toContain('marker-Summary');
    expect(prompt()).not.toContain('marker-Data');
    expect(prompt()).toContain('Review only these worksheets: Summary.');
    expect((await res.json()).notices).toEqual([]);
  });

  it('tells the model and the instructor which listed worksheets are missing', async () => {
    setupDraft({ file: 'model.xlsx', modules: withSheets(['Summary', 'Forecast']) });
    respondWith(await workbook(['Summary']));
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    const res = await draft();
    expect(prompt()).toContain('missing from the workbook: Forecast');
    expect((await res.json()).notices).toEqual(['Worksheets not found in the file: Forecast.']);
  });

  it('refuses, and refunds, when none of the listed worksheets exist', async () => {
    setupDraft({ file: 'model.xlsx', modules: withSheets(['Forecast']) });
    respondWith(await workbook(['Data', 'Summary']));
    const res = await draft();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('This workbook has: Data, Summary');
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockGenerateJSON).not.toHaveBeenCalled();
  });

  it('with no list, reads the first five and says which were skipped', async () => {
    setupDraft({ file: 'model.xlsx', modules: withSheets() });
    const names = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
    respondWith(await workbook(names));
    mockGenerateJSON.mockResolvedValue(AI_REPORT);
    const res = await draft();
    expect(prompt()).toContain('These were not read: S6, S7');
    expect(prompt()).not.toContain('marker-S6');
    expect((await res.json()).notices[0]).toContain('Not read: S6, S7');
  });
});

describe('saving reports with a review', () => {
  // Captures the row written to guided_project_attempts.
  const CURRENT = fileUrl('v2.pdf');
  const OLDER = fileUrl('v1.pdf');

  function setupSave(existingReview: any = null, modules: any[] = MODULES) {
    const writes: any[] = [];
    const rows: Record<string, any> = {
      guided_project_attempts: { ve_id: 've1', student_id: 'stu1', review: existingReview, progress: { u1: { fileUrl: CURRENT }, u2: { fileUrl: CURRENT } } },
      virtual_experiences: { user_id: 'inst1', title: 'Market Entry', modules },
      students: { role: 'instructor', email: 'stu@example.com', full_name: 'Stu' },
    };
    const client = {
      from: (table: string) => {
        const q: any = {
          select: () => q, eq: () => q,
          single: async () => ({ data: rows[table] ?? null, error: null }),
          update: (payload: any) => { writes.push(payload); return { eq: async () => ({ error: null }) }; },
        };
        return q;
      },
    };
    vi.mocked(createClient).mockReturnValue(client as any);
    mockRequireUser.mockResolvedValue({ user: { id: 'inst1' } } as any);
    return writes;
  }

  const save = (body: Record<string, unknown>) =>
    progressPOST(new Request('http://localhost/api/guided-project-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'review', attemptId: 'a1', score: 80, feedback: 'Nice', ...body }),
    }) as any);

  it('stores normalized reports for upload steps only', async () => {
    const writes = setupSave();
    const res = await save({ reports: { u1: { ...AI_REPORT, findings: [...AI_REPORT.findings, { title: '' }] }, t1: { summary: 'x' } } });
    expect(res.status).toBe(200);
    const reports = writes[0].review.reports;
    expect(Object.keys(reports)).toEqual(['u1']);
    expect(reports.u1.findings).toHaveLength(1);
  });

  it('clamps the overall score to 0-100', async () => {
    const writes = setupSave();
    await save({ score: 150 });
    expect(writes[0].review.score).toBe(100);
    await save({ score: -10 });
    expect(writes[1].review.score).toBe(0);
  });

  it('returns the review as stored, so the dashboard shows what the student sees', async () => {
    setupSave();
    const long = 'x'.repeat(5000);
    const res = await save({ reports: { u1: { score: 50, summary: '  ' + long } } });
    const { review } = await res.json();
    expect(review.reports.u1.summary).toHaveLength(2000);
  });

  it('keeps a score-only report, including a score of 0', async () => {
    const writes = setupSave();
    await save({ reports: { u1: { score: 0, summary: '', findings: [], categories: [], recommendations: [] } } });
    expect(writes[0].review.reports.u1.score).toBe(0);
  });

  it('drops a report with no score', async () => {
    const writes = setupSave();
    await save({ reports: { u1: { score: null, summary: 'text but no score' } } });
    expect(writes[0].review.reports).toEqual({});
  });

  describe('when the student is emailed', () => {
    // The saved report as it comes back from a jsonb column: same content, keys in another order.
    const savedReport = { fileUrl: CURRENT, summary: 'ok', score: 60, findings: [], categories: [], recommendations: [] };
    const sentReport = { score: 60, summary: 'ok', findings: [], categories: [], recommendations: [], fileUrl: CURRENT };

    async function emailsFor(existingReview: any, body: Record<string, unknown>, modules: any[] = MODULES) {
      process.env.RESEND_API_KEY = 'test';
      setupSave(existingReview, modules);
      mockSend.mockResolvedValue({ data: { id: 'e1' }, error: null });
      try {
        expect((await save(body)).status).toBe(200);
        return mockSend.mock.calls.length;
      } finally {
        delete process.env.RESEND_API_KEY;
      }
    }

    it('on the first review', async () => {
      expect(await emailsFor(null, { score: 70, reports: {} })).toBe(1);
    });

    it('not when only the feedback wording changes, even with reports read back in another key order', async () => {
      const existing = { score: 70, feedback: 'Nice', reports: { u1: savedReport } };
      expect(await emailsFor(existing, { score: 70, feedback: 'Nice work', reports: { u1: sentReport } })).toBe(0);
    });

    it('when the score changes', async () => {
      expect(await emailsFor({ score: 70, reports: {} }, { score: 80, reports: {} })).toBe(1);
    });

    it('when a file report is rewritten, telling the student how many reports there are in total', async () => {
      const twoUploads = [{ title: 'M1', lessons: [{ title: 'Mission', requirements: [{ id: 'u1', type: 'upload' }, { id: 'u2', type: 'upload' }] }] }];
      const existing = { score: 70, reports: { u1: savedReport, u2: { ...savedReport, fileUrl: CURRENT } } };
      expect(await emailsFor(existing, { score: 70, reports: { u1: { ...sentReport, summary: 'rewritten' }, u2: sentReport } }, twoUploads)).toBe(1);
      expect(String(mockSend.mock.calls[0][0].html)).toContain('detailed reports on 2 of your uploaded files');
    });
  });

  it('logs an email failure that Resend returns instead of throwing, and still saves', async () => {
    process.env.RESEND_API_KEY = 'test';
    const writes = setupSave();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'bad from' } });
    try {
      const res = await save({ reports: {} });
      expect(res.status).toBe(200);
      expect(writes).toHaveLength(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls.some(c => String(c[0]).includes('review email error'))).toBe(true);
    } finally {
      errorSpy.mockRestore();
      delete process.env.RESEND_API_KEY;
    }
  });

  it('stamps a report without a file with the current upload', async () => {
    const writes = setupSave();
    await save({ reports: { u1: { score: 40 } } });
    expect(writes[0].review.reports.u1.fileUrl).toBe(CURRENT);
  });

  it('refuses a new report written for a file the student has since replaced', async () => {
    const writes = setupSave();
    const res = await save({ reports: { u1: { score: 40, summary: 'about v1', fileUrl: OLDER } } });
    expect(res.status).toBe(409);
    expect(writes).toHaveLength(0);
  });

  it('keeps an already-saved report for an older file when the review is saved again', async () => {
    const writes = setupSave({ score: 70, reports: { u1: { score: 60, summary: 'about v1', fileUrl: OLDER } } });
    const res = await save({ score: 75, reports: { u1: { score: 60, summary: 'about v1', fileUrl: OLDER } } });
    expect(res.status).toBe(200);
    expect(writes[0].review.reports.u1.fileUrl).toBe(OLDER);
  });

  it('keeps the saved reports when an older client sends none', async () => {
    const writes = setupSave({ score: 70, reports: { u1: { score: 70, summary: 'kept' } } });
    await save({});
    expect(writes[0].review.reports.u1.summary).toBe('kept');
  });

  it('refuses an instructor who does not own the VE', async () => {
    const writes = setupSave();
    mockRequireUser.mockResolvedValue({ user: { id: 'intruder' } } as any);
    expect((await save({ reports: {} })).status).toBe(403);
    expect(writes).toHaveLength(0);
  });
});
