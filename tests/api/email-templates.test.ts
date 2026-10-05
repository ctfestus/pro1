import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  renderPreview: vi.fn(),
  validateDraft: vi.fn(),
  send: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  requireRole: mocks.requireRole,
  isAuthError: (value: any) => Boolean(value?.error),
}));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({
    appName: 'Test Academy', appUrl: 'https://academy.test', senderName: 'Test Academy',
    supportEmail: 'support@academy.test',
  }),
}));
vi.mock('@/lib/email-template-service', () => ({
  getEmailTemplateOverrides: vi.fn().mockResolvedValue([]),
  validateEmailTemplateDraft: mocks.validateDraft,
  renderEmailTemplatePreview: mocks.renderPreview,
}));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { DELETE, GET, POST, PUT } from '@/app/api/email-templates/route';

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/email-templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

function mutation(method: 'PUT' | 'DELETE', body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/email-templates', {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_FROM_EMAIL = 'Test Academy <mail@academy.test>';
  mocks.requireRole.mockResolvedValue({
    actor: { id: 'staff-1', email: 'verified-instructor@academy.test' },
    serviceDb: {},
  });
  mocks.renderPreview.mockReturnValue({ subject: 'Preview subject', html: '<p>Safe preview</p>' });
  mocks.validateDraft.mockReturnValue({ subject: 'Saved subject', body: '<p>Saved body</p>' });
  mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
});

describe('email template API security', () => {
  it('requires an admin or instructor for reads', async () => {
    mocks.requireRole.mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET(new NextRequest('http://localhost/api/email-templates'));

    expect(response.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'instructor']);
  });

  it('previews without delivering an email', async () => {
    const response = await POST(post({ action: 'preview', key: 'weekly_digest', subject: 'Hi', body: '<p>Hello</p>' }));

    expect(response.status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('sends tests only to the authenticated staff account', async () => {
    const response = await POST(post({
      action: 'test', key: 'weekly_digest', subject: 'Hi', body: '<p>Hello</p>',
      to: 'attacker-controlled@example.com',
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sentTo).toBe('verified-instructor@academy.test');
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'verified-instructor@academy.test',
      subject: '[Custom message sample] Preview subject',
    }));
  });

  it('requires staff authorization before save or reset', async () => {
    mocks.requireRole.mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

    const saveResponse = await PUT(mutation('PUT', { key: 'weekly_digest', subject: 'Hi', body: '<p>Hi</p>' }));
    const resetResponse = await DELETE(mutation('DELETE', { key: 'weekly_digest' }));

    expect(saveResponse.status).toBe(403);
    expect(resetResponse.status).toBe(403);
  });

  it('saves through the atomic RPC and invalidates the sender cache', async () => {
    const query: any = {
      select: vi.fn(() => query), eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const rpc = vi.fn().mockResolvedValue({
      data: { status: 'ok', template: { template_key: 'weekly_digest', updated_at: '2026-10-04T12:00:00Z' } },
      error: null,
    });
    mocks.requireRole.mockResolvedValue({
      actor: { id: 'staff-1', email: 'verified-instructor@academy.test' },
      serviceDb: { from: vi.fn(() => query), rpc },
    });

    const response = await PUT(mutation('PUT', {
      key: 'weekly_digest', subject: 'Hi', body: '<p>Hi</p>', expectedUpdatedAt: null,
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('save_email_template_override', expect.objectContaining({
      p_template_key: 'weekly_digest', p_actor_id: 'staff-1', p_reset: false,
    }));
    expect(mocks.revalidateTag).toHaveBeenCalledWith('email-template-overrides');
  });
});
