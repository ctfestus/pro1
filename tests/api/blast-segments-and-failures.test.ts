// Course broadcasts: each audience gets exactly its own students ("Failed" used to email everyone),
// and a send the email service rejects is reported as failed, not as sent.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { batchSend } = vi.hoisted(() => ({ batchSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { batch = { send: batchSend }; emails = { send: vi.fn() }; } }));
vi.mock('@/lib/vector', () => ({ getVectorIndex: vi.fn(), buildCourseEmbedText: vi.fn() }));
vi.mock('@/lib/email-template-service', () => ({ applyEmailTemplate: async (o: any) => ({ subject: o.fallbackSubject, html: o.fallbackHtml }) }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({ appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test', logoUrl: '', emailBannerUrl: '', teamName: 'Team' }),
}));
vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: 'owner' } }),
  requireRole: vi.fn().mockResolvedValue({ user: { id: 'owner' } }),
  isAuthError: (a: any) => !!a?.error,
}));
vi.mock('@/lib/cohort-roster', () => ({ studentsStillInCohorts: vi.fn(async (_db: any, ids: string[]) => new Set(ids)) }));

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, upserts: [] as any[] }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const filters: [string, any][] = [];
      const rows = () => (state.tables[table] ?? []).filter(r => filters.every(([k, v]) => !(k in r) || r[k] === v));
      const chain: any = {
        select: () => chain, eq: (k: string, v: any) => { filters.push([k, v]); return chain; }, order: () => chain, in: () => chain, range: () => chain,
        upsert: (row: any) => { state.upserts.push({ table, row }); return chain; },
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then: (ok: any, bad: any) => Promise.resolve({ data: rows(), count: rows().length, error: null }).then(ok, bad),
      };
      return chain;
    },
  }),
}));

import { POST } from '@/app/api/email/route';

const blast = (segment: string) => POST(new NextRequest('http://localhost/api/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
  body: JSON.stringify({ type: 'blast', data: { formId: 'c1', subject: 'Update', body: '<p>Hi {{name}}</p>', formTitle: 'SQL', formUrl: 'https://app.test/sql', segment } }),
}));
const recipients = () => batchSend.mock.calls.flatMap(c => c[0]).map((p: any) => p.to).sort();

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'k');
  batchSend.mockReset();
  batchSend.mockResolvedValue({ data: { data: [] }, error: null });
  state.upserts = [];
  state.tables = {
    courses: [{ id: 'c1', user_id: 'owner', cohort_ids: ['k1'] }],
    students: [
      { id: 'new', full_name: 'New', email: 'new@x.test', role: 'student' },
      { id: 'mid', full_name: 'Mid', email: 'mid@x.test', role: 'student' },
      { id: 'pass', full_name: 'Pass', email: 'pass@x.test', role: 'student' },
      { id: 'fail', full_name: 'Fail', email: 'fail@x.test', role: 'student' },
    ],
    course_attempts: [
      { course_id: 'c1', student_id: 'mid', completed_at: null, passed: null },
      { course_id: 'c1', student_id: 'pass', completed_at: '2026-11-01', passed: true },
      { course_id: 'c1', student_id: 'fail', completed_at: '2026-11-01', passed: false },
    ],
    blast_quotas: [],
  };
});

describe('course broadcast audiences', () => {
  it.each([
    ['failed', ['fail@x.test']],
    ['completed', ['pass@x.test']],
    ['in_progress', ['mid@x.test']],
    ['not_started', ['new@x.test']],
    ['all', ['fail@x.test', 'mid@x.test', 'new@x.test', 'pass@x.test']],
  ])('%s reaches only its students', async (segment, expected) => {
    expect(await (await blast(segment)).json()).toMatchObject({ success: true, count: expected.length });
    expect(recipients()).toEqual(expected);
  });

  it('refuses an unknown audience instead of emailing everyone', async () => {
    expect((await blast('everyone-ish')).status).toBe(400);
    expect(batchSend).not.toHaveBeenCalled();
  });
});

describe('send results', () => {
  it('reports a rejected send as failed and does not use the daily limit', async () => {
    batchSend.mockResolvedValue({ data: null, error: { message: 'daily quota exceeded' } });
    const res = await blast('all');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('Nothing was sent');
    expect(state.upserts.filter(u => u.table === 'blast_quotas')).toHaveLength(0);
  });

  it('sends each batch with a key from its content, so a repeat send is not delivered twice', async () => {
    await blast('all');
    await blast('all');
    const keys = batchSend.mock.calls.map(c => c[1]?.idempotencyKey);
    expect(keys[0]).toMatch(/^blast-[0-9a-f]{48}$/);
    expect(keys[1]).toBe(keys[0]);
  });
});
