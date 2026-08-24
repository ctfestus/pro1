import { beforeEach, describe, expect, it, vi } from 'vitest';

// Certifications inside a published learning path must be accessible (and gradable) for the
// path's cohorts even when the certification's own cohort list does not include them -- the
// same rule the course route applies (commit 3ef650d). These tests pin that rule across the
// access helper (get-exam), the student catalog (list), and completion -> path progress.

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>();
  const requireUser = vi.fn();
  // The route resolves the learner via requireStudentUser; with no Student Mode header it
  // behaves exactly like requireUser, so both share one stub in these tests.
  return { ...actual, requireUser, requireStudentUser: requireUser };
});

// lib/admin-client builds its singleton at import time, so mock the module itself and hand
// out the per-test stub through a hoisted holder.
const h = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('@/lib/admin-client', () => ({ adminClient: () => h.db }));

// The route schedules path-progress work via next/server after(), which throws outside a real
// Next request scope. Run the scheduled task inline so the completion test can observe it.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (task: any) => { if (typeof task === 'function') task(); } };
});

vi.mock('@/lib/learning-path-progress', () => ({ updateLearningPathProgress: vi.fn() }));
vi.mock('@/lib/issue-certificate', () => ({
  ensureCertificate: vi.fn().mockResolvedValue({ certId: 'issued1', isNew: false }),
  awardContentBadge: vi.fn(),
  sendCertificateEmailOnce: vi.fn(),
}));

import { requireUser } from '@/lib/api-auth';
import { updateLearningPathProgress } from '@/lib/learning-path-progress';
import { POST } from '@/app/api/certification-attempt/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireUser = vi.mocked(requireUser);
const mockPathProgress = vi.mocked(updateLearningPathProgress);

async function post(body: Record<string, unknown>): Promise<Response> {
  const res = await POST(new Request('http://localhost/api/certification-attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  }) as any);
  return res as unknown as Response;
}

function authed(serviceDb: any) {
  mockRequireUser.mockResolvedValue({
    user: { id: 'student1', email: 'student@example.com' },
    serviceDb,
    token: 'test-token',
  } as any);
  h.db = serviceDb;
}

// Published cert assigned to a cohort the student is NOT in; access must come from the path.
const pathOnlyCert = {
  id: 'cert1',
  slug: 'cert1',
  user_id: 'owner1',
  status: 'published',
  cohort_ids: ['direct-cohort'],
  questions: [],
  practice_questions: [],
  skill_areas: [],
  scenarios: [],
  prep_items: [],
  playground_data: {},
  passmark: 70,
  time_limit: 0,
  max_attempts: 0,
  retake_cooldown_hours: 0,
  exam_protection: true,
};

beforeEach(() => {
  mockRequireUser.mockReset();
  mockPathProgress.mockReset();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('POST /api/certification-attempt learning-path access', () => {
  it('grants get-exam when a published learning path assigns the certification to the student cohort', async () => {
    authed(makeSupabaseStub({
      certifications: { data: pathOnlyCert, error: null },
      students: { data: { role: 'student', cohort_id: 'path-cohort' }, error: null },
      learning_paths: { data: { id: 'lp1' }, error: null },
    }));

    const res = await post({ action: 'get-exam', certification_id: 'cert1' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.certification.id).toBe('cert1');
  });

  it('still returns 403 when no learning path grants the certification', async () => {
    authed(makeSupabaseStub({
      certifications: { data: pathOnlyCert, error: null },
      students: { data: { role: 'student', cohort_id: 'path-cohort' }, error: null },
      learning_paths: { data: null, error: null },
    }));

    const res = await post({ action: 'get-exam', certification_id: 'cert1' });

    expect(res.status).toBe(403);
  });

  it('lists path-granted certifications only after a first attempt, like path courses', async () => {
    authed(makeSupabaseStub({
      students: { data: { role: 'student', cohort_id: 'path-cohort' }, error: null },
      certifications: {
        data: [
          { available_to_everyone: false, id: 'cert1', title: 'Path-granted, attempted', cohort_ids: ['direct-cohort'] },
          { id: 'cert2', title: 'Open to everyone', cohort_ids: [], available_to_everyone: true },
          { available_to_everyone: false, id: 'cert3', title: 'Path-granted, not attempted yet', cohort_ids: ['direct-cohort'] },
          { available_to_everyone: false, id: 'cert4', title: 'Different cohort, no path', cohort_ids: ['direct-cohort'] },
        ],
        error: null,
      },
      learning_paths: { data: [{ item_ids: ['cert1', 'cert3'] }], error: null },
      certification_attempts: { data: [{ certification_id: 'cert1' }], error: null },
    }));

    const res = await post({ action: 'list' });

    expect(res.status).toBe(200);
    const { certifications } = await res.json();
    const ids = certifications.map((c: any) => c.id);
    expect(ids).toContain('cert1');
    expect(ids).toContain('cert2');
    expect(ids).not.toContain('cert3');
    expect(ids).not.toContain('cert4');
    // cohort_ids must never reach the client
    expect(certifications.every((c: any) => c.cohort_ids === undefined)).toBe(true);
  });

  it('updates learning-path progress when a path-granted attempt is completed with a pass', async () => {
    authed(makeSupabaseStub({
      certifications: { data: pathOnlyCert, error: null },
      students: [
        { data: { role: 'student', cohort_id: 'path-cohort' }, error: null },
        { data: { full_name: 'Student One' }, error: null },
      ],
      learning_paths: { data: { id: 'lp1' }, error: null },
      certification_attempts: [
        { data: { id: 'att1', answers: {}, started_at: null, question_ids: [] }, error: null },
        { data: null, error: null },
      ],
    }));

    const res = await post({ action: 'complete-attempt', certification_id: 'cert1', final_answers: {} });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(true);
    expect(mockPathProgress).toHaveBeenCalledWith(h.db, 'student1', 'cert1');
  });
});
