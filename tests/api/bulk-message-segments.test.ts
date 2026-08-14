import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// The regression this file guards: the compose panel used to take its counts from /api/tracking
// while the send took its recipients from /api/bulk-message, and the two classified virtual
// experiences differently. guided_project_attempts has no `passed` column, so bulk messaging's
// hardcoded passed:false turned every completed VE into "failed" -- counted under Completed on
// screen, emailed under Failed. Both now run through lib/tracking-report, and GET here is what the
// panel reads, so the number on the button is produced by the code that picks the recipients.

// vi.hoisted, because the route builds its Resend client at module load -- earlier than a plain
// const in this file would be initialised.
const { batchSend } = vi.hoisted(() => ({ batchSend: vi.fn(() => Promise.resolve({ data: null, error: null })) }));
vi.mock('resend', () => ({ Resend: class { batch = { send: batchSend }; emails = { send: vi.fn() }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({
    appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test',
    logoUrl: '', emailBannerUrl: '', teamName: 'Team',
  }),
}));
vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireRole: vi.fn(),
}));

import { requireRole } from '@/lib/api-auth';
import { GET, POST } from '@/app/api/bulk-message/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireRole = vi.mocked(requireRole);

function authed(db: any, role = 'instructor') {
  mockRequireRole.mockResolvedValue({ user: { id: 'u1' }, supabase: db, role, token: 't' } as any);
}

function get(qs = '') {
  return GET(new Request(`http://localhost/api/bulk-message${qs}`) as any);
}

/** One VE, one student, and a finished VE attempt -- the shape that used to be misread as failed. */
function veCompletedDb() {
  return makeSupabaseStub({
    courses: { data: [], error: null },
    virtual_experiences: { data: [{ id: 've1', title: 'Data Sprint', slug: 'data-sprint', cohort_ids: ['co1'], deadline_days: null, status: 'published' }], error: null },
    assignments: { data: [], error: null },
    learning_paths: { data: [], error: null },
    students: { data: [{ id: 's1', email: 'ama@example.com', full_name: 'Ama Mensah', cohort_id: 'co1' }], error: null },
    guided_project_attempts: { data: [{ student_id: 's1', ve_id: 've1', completed_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }], error: null },
    cohort_assignments: { data: [], error: null },
  });
}

/** An assignment with a graded submission -- content the send route used to ignore entirely. */
function assignmentDb() {
  return makeSupabaseStub({
    courses: { data: [], error: null },
    virtual_experiences: { data: [], error: null },
    assignments: { data: [{ id: 'a1', title: 'Case Study', cohort_ids: ['co1'], deadline_date: null, type: 'standard', config: {}, status: 'published' }], error: null },
    learning_paths: { data: [], error: null },
    students: { data: [{ id: 's1', email: 'ama@example.com', full_name: 'Ama Mensah', cohort_id: 'co1' }], error: null },
    assignment_submissions: { data: [{ student_id: 's1', assignment_id: 'a1', status: 'graded', score: 80, updated_at: '2026-08-01T00:00:00Z', submitted_at: '2026-08-01T00:00:00Z', graded_at: '2026-08-02T00:00:00Z' }], error: null },
    cohort_assignments: { data: [], error: null },
  });
}

beforeEach(() => {
  mockRequireRole.mockReset();
  batchSend.mockClear();
  process.env.RESEND_API_KEY = 'test-key';
});

describe('GET /api/bulk-message', () => {
  it('401 for an anonymous caller', async () => {
    mockRequireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
  });

  it('counts a completed virtual experience as completed, never failed', async () => {
    authed(veCompletedDb());
    const json = await (await get()).json();
    expect(json.counts.completed).toBe(1);
    expect(json.counts.failed).toBe(0);
    expect(json.counts.all).toBe(1);
  });

  it('includes assignments in scope, so a count cannot promise what the send refuses', async () => {
    authed(assignmentDb());
    const json = await (await get()).json();
    expect(json.forms).toEqual([{ id: 'a1', title: 'Case Study' }]);
    expect(json.counts.completed).toBe(1);
  });

  it('narrowing to one piece of content does not shrink the content list', async () => {
    authed(veCompletedDb());
    const json = await (await get('?formId=ve1')).json();
    expect(json.forms).toHaveLength(1);
  });
});

describe('POST /api/bulk-message', () => {
  const body = (segment: string) => new Request('http://localhost/api/bulk-message', {
    method: 'POST',
    body: JSON.stringify({ segment, cohortId: 'all', subject: 'Hello', messageBody: 'Hi {{name}}' }),
  }) as any;

  it('emails the completed segment for a finished virtual experience', async () => {
    authed(veCompletedDb());
    const res = await POST(body('completed'));
    expect(await res.json()).toMatchObject({ sent: 1 });
    expect(batchSend).toHaveBeenCalledTimes(1);
  });

  it('does not email a VE completer as a failure', async () => {
    authed(veCompletedDb());
    const json = await (await POST(body('failed'))).json();
    expect(json.sent).toBe(0);
    expect(batchSend).not.toHaveBeenCalled();
  });

  it('rejects an unknown segment', async () => {
    authed(veCompletedDb());
    expect((await POST(body('nonsense'))).status).toBe(400);
  });
});
