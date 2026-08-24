import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// requireUser + in-handler access control. Proves a logged-in user who is NOT targeted by
// any assignment embedding the VE is rejected (the bug this route was rewritten to fix),
// and that a properly-targeted student / the owner get through with the owner id stripped.

vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  requireUser: vi.fn(),
}));

import { requireUser } from '@/lib/api-auth';
import { GET } from '@/app/api/ve-for-assignment/route';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const mockRequireUser = vi.mocked(requireUser);

function get(veId = 've1') {
  return GET(new Request(`http://localhost/api/ve-for-assignment?veId=${veId}`) as any);
}
function authed(userId: string, serviceDb: any) {
  mockRequireUser.mockResolvedValue({ user: { id: userId }, serviceDb, token: 't' } as any);
}

const VE_ROW = {
  id: 've1', title: 'VE', slug: 've', modules: [], company: 'X', role: 'Analyst',
  industry: 'Tech', tagline: '', cover_image: '', manager_name: '', manager_title: '',
  dataset: null, background: '', user_id: 'owner1',
};

beforeEach(() => mockRequireUser.mockReset());

describe('GET /api/ve-for-assignment', () => {
  it('401 for an anonymous caller', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await get()).status).toBe(401);
  });

  it('403 for a logged-in student not targeted by any assignment', async () => {
    authed('student1', makeSupabaseStub({
      virtual_experiences: { data: VE_ROW, error: null },
      students: { data: { role: 'student', cohort_id: 'coX' }, error: null },
      assignments: { data: [{ cohort_ids: ['coOTHER'], group_ids: [] }], error: null },
      group_members: { data: [], error: null },
    }));
    expect((await get()).status).toBe(403);
  });

  it('200 for a student whose cohort a published assignment targets', async () => {
    authed('student1', makeSupabaseStub({
      virtual_experiences: { data: VE_ROW, error: null },
      students: { data: { role: 'student', cohort_id: 'coX' }, error: null },
      assignments: { data: [{ cohort_ids: ['coX'], group_ids: [] }], error: null },
      group_members: { data: [], error: null },
    }));
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ve.id).toBe('ve1');
    expect(body.ve).not.toHaveProperty('user_id'); // owner id stripped
  });

  it('200 for the VE owner without needing an assignment', async () => {
    authed('owner1', makeSupabaseStub({ virtual_experiences: { data: VE_ROW, error: null } }));
    expect((await get()).status).toBe(200);
  });

  it('404 when the VE does not exist', async () => {
    authed('student1', makeSupabaseStub({ virtual_experiences: { data: null, error: null } }));
    expect((await get()).status).toBe(404);
  });
});
