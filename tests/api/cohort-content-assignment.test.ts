import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ requireUser: vi.fn() }));
const notifications = vi.hoisted(() => ({ send: vi.fn(), sendPath: vi.fn() }));

vi.mock('@/lib/api-auth', () => ({
  requireUser: authState.requireUser,
  isAuthError: () => false,
}));
vi.mock('@/lib/send-assignment-notification', () => ({ sendAssignmentNotifications: notifications.send }));
vi.mock('@/lib/send-path-notification', () => ({ sendPathNotification: notifications.sendPath }));

import { POST } from '@/app/api/cohort-content-assignment/route';

type CourseState = {
  id: string;
  title: string;
  slug: string;
  status: string;
  cohort_ids: string[];
  available_to_everyone: boolean;
  user_id: string;
};

function makeDb(course: CourseState) {
  const updates: Array<Record<string, unknown>> = [];
  let courseReads = 0;

  const from = vi.fn((table: string) => {
    let mutationResult = { error: null as null | { message: string } };
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => {
        if (table === 'cohorts') return { data: { id: 'cohort-a' }, error: null };
        if (table === 'courses') {
          courseReads += 1;
          return { data: { ...course, cohort_ids: [...course.cohort_ids] }, error: null };
        }
        return { data: null, error: null };
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        if (table === 'courses') Object.assign(course, payload);
        return chain;
      }),
      upsert: vi.fn(async () => ({ error: null })),
      then: (resolve: (value: typeof mutationResult) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(mutationResult).then(resolve, reject),
    };
    return chain;
  });

  return { db: { from }, updates, get courseReads() { return courseReads; } };
}

const request = (confirmRestriction = false) => new NextRequest('http://localhost/api/cohort-content-assignment', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    contentId: 'course-1',
    contentTable: 'courses',
    cohortId: 'cohort-a',
    confirmRestriction,
  }),
});

describe('cohort content assignment access confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 409 without changing an Everyone course', async () => {
    const state: CourseState = {
      id: 'course-1', title: 'Open course', slug: 'open-course', status: 'published',
      cohort_ids: [], available_to_everyone: true, user_id: 'owner-1',
    };
    const recorder = makeDb(state);
    authState.requireUser.mockResolvedValue({ user: { id: 'owner-1' }, supabase: recorder.db });

    const response = await POST(request());
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({ requiresConfirmation: true });
    expect(recorder.updates).toEqual([]);
    expect(state.available_to_everyone).toBe(true);
  });

  it('re-reads current state and narrows access on the confirmed retry', async () => {
    const state: CourseState = {
      id: 'course-1', title: 'Open course', slug: 'open-course', status: 'published',
      cohort_ids: [], available_to_everyone: true, user_id: 'owner-1',
    };
    const recorder = makeDb(state);
    authState.requireUser.mockResolvedValue({ user: { id: 'owner-1' }, supabase: recorder.db });

    const warning = await POST(request());
    expect(warning.status).toBe(409);

    // Simulate another admin adding a different cohort before confirmation.
    state.cohort_ids = ['cohort-other'];
    const confirmed = await POST(request(true));

    expect(confirmed.status).toBe(200);
    expect(recorder.courseReads).toBe(2);
    expect(recorder.updates).toContainEqual({
      cohort_ids: ['cohort-other', 'cohort-a'],
      available_to_everyone: false,
    });
    expect(state.available_to_everyone).toBe(false);
    expect(state.cohort_ids).toEqual(['cohort-other', 'cohort-a']);
  });
});
