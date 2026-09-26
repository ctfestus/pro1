import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: async () => ({
    appName: 'Test Platform', appUrl: 'https://stale.example', senderName: 'Test Team',
    supportEmail: 'support@example.com', logoUrl: 'https://cdn.example/logo.png',
    emailBannerUrl: 'https://cdn.example/email-banner.png', teamName: 'Test Team', brandColor: '#123456',
  }),
}));

import { sendApplicationConfirmationEmail, sendApplicationDecisionEmail } from '@/lib/application-email';

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key';
  send.mockReset();
  send.mockResolvedValue({ error: null });
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe('application emails', () => {
  it('uses the configured email banner and the working request origin for status links', async () => {
    await sendApplicationConfirmationEmail({
      email: 'applicant@example.com', formTitle: 'Data Bootcamp', reference: 'APP-1',
      token: 'secure-token', confirmationMessage: 'Thank you.', baseUrl: 'https://live.example',
    });

    const message = send.mock.calls[0][0];
    expect(message.html).toContain('https://cdn.example/email-banner.png');
    expect(message.html).toContain('https://live.example/applications/secure-token');
    expect(message.html).not.toContain('https://stale.example/applications/secure-token');
    expect(message.html).toContain('background:#123456');
  });

  it('uses the same working status link in staff decision messages', async () => {
    await sendApplicationDecisionEmail({
      email: 'applicant@example.com', subject: 'Interview', body: 'Please choose a time.',
      token: 'decision-token', messageId: 'message-1', baseUrl: 'https://live.example',
    });

    const message = send.mock.calls[0][0];
    expect(message.html).toContain('https://live.example/applications/decision-token');
    expect(message.html).toContain('https://cdn.example/email-banner.png');
  });
});
