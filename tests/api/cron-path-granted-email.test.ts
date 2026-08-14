import { describe, it, expect, vi, beforeEach } from 'vitest';

// Assigning content to a cohort writes a cohort_assignments row; assigning a learning path writes
// nothing for the items inside it, because access is granted at read time by checking the path.
// The scheduled jobs decided who to email by reading cohort_assignments, so a cohort taught only
// through a path was invisible to them and received no automated mail at all -- the same blind spot
// the dashboard had. These fix the shape of that bug in the job that sends inactivity nudges.

const { batchSend } = vi.hoisted(() => ({ batchSend: vi.fn((_batch: any[]) => Promise.resolve({ data: null, error: null })) }));
vi.mock('resend', () => ({ Resend: class { batch = { send: batchSend }; emails = { send: vi.fn() }; } }));
vi.mock('@/lib/qstash', () => ({ verifyQStashRequest: vi.fn().mockResolvedValue({ valid: true }) }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({
    appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test',
    logoUrl: '', emailBannerUrl: '', teamName: 'Team',
  }),
}));

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: adminClientMock }));

import { POST } from '@/app/api/cron/progress-nudges/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const STALLED_AT = new Date(Date.now() - 20 * 86400000).toISOString();

/**
 * One student, one course, one stalled attempt. `cohortAssignments` is what varies: empty means the
 * course reaches the cohort only through the learning path.
 */
function db(opts: { cohortAssignments?: any[]; learningPaths?: any[] } = {}) {
  return makeSupabaseStub({
    course_attempts: { data: [{ student_id: 's1', course_id: 'c1', updated_at: STALLED_AT }], error: null },
    guided_project_attempts: { data: [], error: null },
    courses: { data: [{ id: 'c1', title: 'SQL Basics', slug: 'sql-basics', cover_image: null, status: 'published' }], error: null },
    virtual_experiences: { data: [], error: null },
    students: { data: [{ id: 's1', email: 'ama@example.com', full_name: 'Ama Mensah', cohort_id: 'co1' }], error: null },
    cohort_assignments: { data: opts.cohortAssignments ?? [], error: null },
    learning_paths: { data: opts.learningPaths ?? [], error: null },
    assignments: { data: [], error: null },
    sent_nudges: { data: [], error: null },
  });
}

function post() {
  return POST(new Request('http://localhost/api/cron/progress-nudges', { method: 'POST' }) as any);
}

beforeEach(() => {
  batchSend.mockClear();
  adminClientMock.mockReset();
  process.env.RESEND_API_KEY = 'test-key';
});

describe('POST /api/cron/progress-nudges cohort reachability', () => {
  it('nudges a student whose cohort reaches the course only through a learning path', async () => {
    adminClientMock.mockReturnValue(db({
      cohortAssignments: [],
      learningPaths: [{ item_ids: ['c1'], cohort_ids: ['co1'] }],
    }));
    const json = await (await post()).json();
    expect(json.sent).toBe(1);
    expect(json.excludedUnassigned).toBe(0);
    expect(batchSend).toHaveBeenCalledTimes(1);
    expect(batchSend.mock.calls[0][0][0].to).toBe('ama@example.com');
  });

  it('still nudges on a direct cohort assignment, with no learning path involved', async () => {
    adminClientMock.mockReturnValue(db({
      cohortAssignments: [{ content_id: 'c1', cohort_id: 'co1' }],
      learningPaths: [],
    }));
    const json = await (await post()).json();
    expect(json.sent).toBe(1);
  });

  it('does not nudge when neither route reaches the cohort', async () => {
    adminClientMock.mockReturnValue(db({ cohortAssignments: [], learningPaths: [] }));
    const json = await (await post()).json();
    expect(json.sent).toBe(0);
    expect(json.excludedUnassigned).toBe(1);
    expect(batchSend).not.toHaveBeenCalled();
  });

  it('does not nudge when the path is assigned to a different cohort', async () => {
    adminClientMock.mockReturnValue(db({
      cohortAssignments: [],
      learningPaths: [{ item_ids: ['c1'], cohort_ids: ['co-other'] }],
    }));
    const json = await (await post()).json();
    expect(json.sent).toBe(0);
    expect(json.excludedUnassigned).toBe(1);
  });

  it('does not nudge when the path contains a different course', async () => {
    adminClientMock.mockReturnValue(db({
      cohortAssignments: [],
      learningPaths: [{ item_ids: ['c-other'], cohort_ids: ['co1'] }],
    }));
    const json = await (await post()).json();
    expect(json.sent).toBe(0);
  });

  it('sends one nudge when a course is reachable both ways', async () => {
    adminClientMock.mockReturnValue(db({
      cohortAssignments: [{ content_id: 'c1', cohort_id: 'co1' }],
      learningPaths: [{ item_ids: ['c1'], cohort_ids: ['co1'] }],
    }));
    const json = await (await post()).json();
    expect(json.sent).toBe(1);
    expect(batchSend.mock.calls[0][0]).toHaveLength(1);
  });
});
