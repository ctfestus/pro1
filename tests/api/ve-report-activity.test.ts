import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireUser: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn() }; } }));

import { createClient } from '@supabase/supabase-js';
import { requireUser } from '@/lib/api-auth';
import { GET } from '@/app/api/guided-project-progress/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireUser = vi.mocked(requireUser);
const mockCreateClient = vi.mocked(createClient);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ user: { id: 'owner-1' } } as any);
});

describe('GET /api/guided-project-progress instructor report', () => {
  it('keeps an activity row when the learner is not in an assigned cohort', async () => {
    mockCreateClient.mockReturnValue(makeSupabaseStub({
      virtual_experiences: [
        { data: { id: 've-1', user_id: 'owner-1', status: 'published', cohort_ids: [], available_to_everyone: true }, error: null },
      ],
      students: [
        { data: { role: 'instructor' }, error: null },
        { data: [{ id: 'student-1', full_name: 'Free Learner', email: 'free@example.com', cohort_id: null }], error: null },
      ],
      guided_project_attempts: { data: [{
        id: 'attempt-1', student_id: 'student-1', progress: {}, completed_at: null,
        started_at: '2026-10-08T10:00:00.000Z', updated_at: '2026-10-08T10:00:00.000Z', review: null,
      }], error: null },
    }) as any);

    const response = await GET(new Request('http://localhost/api/guided-project-progress?formId=ve-1') as any);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.attempts).toHaveLength(1);
    expect(json.attempts[0]).toMatchObject({
      id: 'attempt-1',
      student_id: 'student-1',
      student_name: 'Free Learner',
      student_email: 'free@example.com',
      cohort_id: null,
      activity_only: true,
    });
  });

  it('excludes a learner whose VE access comes only from an assignment', async () => {
    mockCreateClient.mockReturnValue(makeSupabaseStub({
      virtual_experiences: { data: { id: 've-1', user_id: 'owner-1', status: 'published', cohort_ids: [], available_to_everyone: false }, error: null },
      students: [
        { data: { role: 'instructor' }, error: null },
        { data: [{ id: 'student-1', full_name: 'Assignment Learner', email: 'assignment@example.com', cohort_id: 'assignment-cohort' }], error: null },
      ],
      guided_project_attempts: { data: [{
        id: 'attempt-1', student_id: 'student-1', progress: {}, completed_at: null,
        started_at: '2026-10-08T10:00:00.000Z', updated_at: '2026-10-08T10:00:00.000Z', review: null,
      }], error: null },
      learning_paths: { data: [], error: null },
      bootcamp_enrollments: { data: [], error: null },
      individual_subscriptions: { data: [], error: null },
    }) as any);

    const response = await GET(new Request('http://localhost/api/guided-project-progress?formId=ve-1') as any);
    expect((await response.json()).attempts).toEqual([]);
  });

  it('keeps cohort attempts visible after the VE is unpublished', async () => {
    mockCreateClient.mockReturnValue(makeSupabaseStub({
      virtual_experiences: { data: { id: 've-1', user_id: 'owner-1', status: 'draft', cohort_ids: ['cohort-1'], available_to_everyone: false }, error: null },
      students: [
        { data: { role: 'instructor' }, error: null },
        { data: [{ id: 'student-1', full_name: 'Cohort Learner', email: 'cohort@example.com', cohort_id: 'cohort-1' }], error: null },
      ],
      guided_project_attempts: { data: [{
        id: 'attempt-1', student_id: 'student-1', progress: { task: { completed: true } }, completed_at: '2026-10-08T12:00:00.000Z',
        started_at: '2026-10-08T10:00:00.000Z', updated_at: '2026-10-08T12:00:00.000Z', review: null,
      }], error: null },
      learning_paths: { data: [], error: null },
    }) as any);

    const response = await GET(new Request('http://localhost/api/guided-project-progress?formId=ve-1') as any);
    const json = await response.json();
    expect(json.attempts).toHaveLength(1);
    expect(json.attempts[0]).toMatchObject({
      id: 'attempt-1',
      student_id: 'student-1',
      completed_at: '2026-10-08T12:00:00.000Z',
      activity_only: false,
    });
  });

  it('keeps work from a learner who previously belonged to the VE cohort', async () => {
    mockCreateClient.mockReturnValue(makeSupabaseStub({
      virtual_experiences: { data: { id: 've-1', user_id: 'owner-1', status: 'published', cohort_ids: ['former-cohort'], available_to_everyone: false }, error: null },
      students: [
        { data: { role: 'instructor' }, error: null },
        { data: [], error: null },
        { data: [{ id: 'student-1', full_name: 'Former Learner', email: 'former@example.com', cohort_id: 'new-cohort' }], error: null },
      ],
      guided_project_attempts: { data: [{
        id: 'attempt-1', student_id: 'student-1', progress: {}, completed_at: '2026-10-08T12:00:00.000Z',
        started_at: '2026-10-08T10:00:00.000Z', updated_at: '2026-10-08T12:00:00.000Z', review: null,
      }], error: null },
      learning_paths: { data: [], error: null },
      bootcamp_enrollments: { data: [{ student_id: 'student-1', cohort_id: 'former-cohort', released_at: '2026-10-09T00:00:00.000Z' }], error: null },
      individual_subscriptions: { data: [], error: null },
    }) as any);

    const response = await GET(new Request('http://localhost/api/guided-project-progress?formId=ve-1') as any);
    const json = await response.json();
    expect(json.attempts).toHaveLength(1);
    expect(json.attempts[0]).toMatchObject({
      id: 'attempt-1',
      student_id: 'student-1',
      cohort_id: 'new-cohort',
      activity_only: true,
    });
  });

  it('keeps work after an individual subscription expires', async () => {
    mockCreateClient.mockReturnValue(makeSupabaseStub({
      virtual_experiences: { data: { id: 've-1', user_id: 'owner-1', status: 'published', cohort_ids: ['plan-cohort'], available_to_everyone: false }, error: null },
      students: [
        { data: { role: 'instructor' }, error: null },
        { data: [], error: null },
        { data: [{ id: 'student-1', full_name: 'Expired Subscriber', email: 'expired@example.com', cohort_id: null }], error: null },
      ],
      guided_project_attempts: { data: [{
        id: 'attempt-1', student_id: 'student-1', progress: {}, completed_at: null,
        started_at: '2026-10-08T10:00:00.000Z', updated_at: '2026-10-08T11:00:00.000Z', review: null,
      }], error: null },
      learning_paths: { data: [], error: null },
      bootcamp_enrollments: { data: [], error: null },
      individual_subscriptions: { data: [{ student_id: 'student-1', cohort_id: 'plan-cohort', status: 'expired' }], error: null },
    }) as any);

    const response = await GET(new Request('http://localhost/api/guided-project-progress?formId=ve-1') as any);
    const json = await response.json();
    expect(json.attempts).toHaveLength(1);
    expect(json.attempts[0]).toMatchObject({
      id: 'attempt-1',
      student_id: 'student-1',
      cohort_id: null,
      activity_only: true,
    });
  });

  it('does not recreate a blank row when an attempt has no student profile', async () => {
    mockCreateClient.mockReturnValue(makeSupabaseStub({
      virtual_experiences: { data: { id: 've-1', user_id: 'owner-1', status: 'published', cohort_ids: [], available_to_everyone: true }, error: null },
      students: [
        { data: { role: 'instructor' }, error: null },
        { data: [], error: null },
      ],
      guided_project_attempts: { data: [{
        id: 'attempt-1', student_id: 'non-student-1', progress: {}, completed_at: null,
        started_at: '2026-10-08T10:00:00.000Z', updated_at: '2026-10-08T10:00:00.000Z', review: null,
      }], error: null },
    }) as any);

    const response = await GET(new Request('http://localhost/api/guided-project-progress?formId=ve-1') as any);
    expect((await response.json()).attempts).toEqual([]);
  });
});
