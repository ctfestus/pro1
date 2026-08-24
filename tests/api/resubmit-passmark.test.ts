import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// The resubmit route lets a student reset a FAILED graded submission back to draft. "Failed" is judged
// against the assignment's configured passing score (config.passingScore, via passMarkOf, default 85),
// NOT a fixed 85. These tests prove a non-default threshold actually changes the outcome.

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireUser: vi.fn(),
}));
vi.mock('@/lib/admin-client', () => ({ adminClient: vi.fn() }));

import { requireUser } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { POST } from '@/app/api/assignments/resubmit/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireUser = vi.mocked(requireUser);
const mockAdminClient = vi.mocked(adminClient);

function post(submissionId = 'sub1') {
  return POST(new Request('http://localhost/api/assignments/resubmit', {
    method: 'POST', body: JSON.stringify({ submissionId }), headers: { 'Content-Type': 'application/json' },
  }) as any);
}

// A graded, owned submission scoring `score`, on an assignment whose config is `config`.
function sub(score: number, config: any) {
  return { id: 'sub1', student_id: 'stu1', group_id: null, status: 'graded', score, assignment: { config } };
}

beforeEach(() => {
  mockRequireUser.mockReset();
  mockAdminClient.mockReset();
  mockRequireUser.mockResolvedValue({ user: { id: 'stu1' }, serviceDb: {}, token: 't' } as any);
});

describe('POST /api/assignments/resubmit - passing-score threshold', () => {
  it('80 counts as PASSED (resubmit refused) when the assignment passes at 70', async () => {
    mockAdminClient.mockReturnValue(makeSupabaseStub({
      assignment_submissions: { data: sub(80, { passingScore: 70 }), error: null },
    }) as any);
    const res = await post();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already passed/i);
  });

  it('80 counts as FAILED (resubmit allowed) when the assignment passes at 90', async () => {
    mockAdminClient.mockReturnValue(makeSupabaseStub({
      // first call = fetch, second call = the reset UPDATE
      assignment_submissions: [
        { data: sub(80, { passingScore: 90 }), error: null },
        { data: null, error: null },
      ],
    }) as any);
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('an out-of-range passingScore falls back to 85 (88 refused)', async () => {
    mockAdminClient.mockReturnValue(makeSupabaseStub({
      assignment_submissions: { data: sub(88, { passingScore: 0 }), error: null },
    }) as any);
    const res = await post();
    expect(res.status).toBe(400); // 88 >= 85 default -> already passed
  });

  it('defaults to 85 when no passingScore is set (80 allowed to resubmit)', async () => {
    mockAdminClient.mockReturnValue(makeSupabaseStub({
      assignment_submissions: [
        { data: sub(80, {}), error: null },
        { data: null, error: null },
      ],
    }) as any);
    const res = await post();
    expect(res.status).toBe(200); // 80 < 85 default -> failed -> reset allowed
  });

  // Keep the anonymous guard covered so the mock does not accidentally pass everything.
  it('401 for an unauthenticated caller', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as any);
    mockAdminClient.mockReturnValue(makeSupabaseStub({}) as any);
    expect((await post()).status).toBe(401);
  });
});
