import { describe, expect, it } from 'vitest';
import {
  individualLearnerWelcomeEmail,
  subscriptionActivatedEmail,
  subscriptionExpiringEmail,
} from '@/lib/email-templates';

// These render the real HTML. Every other test in this area asserts on subjects or call
// counts, so the content rules -- no payment details in the access notice, no timezone
// shift on a date-only deadline -- were held only by review.
const branding = { appName: 'Test', appUrl: 'https://test.example', teamName: 'Test' };

describe('subscription email templates', () => {
  const activated = subscriptionActivatedEmail({
    name: 'Ada', planName: 'Pro', durationMonths: 3,
    periodStart: '2026-08-10T00:00:00Z', periodEnd: '2026-11-10T00:00:00Z',
    isActivation: true, dashboardUrl: 'https://test.example', branding,
  });

  it('keeps payment details out of the access notice', () => {
    for (const forbidden of ['Amount', 'amount', 'GHS', 'Reference', 'reference', 'Payment method']) {
      expect(activated).not.toContain(forbidden);
    }
  });

  it('states the access window rather than "starts today"', () => {
    expect(activated).toContain('10 August 2026');
    expect(activated).toContain('10 November 2026');
    expect(activated).not.toContain('starts today');
  });

  it('sends the learner to their dashboard, not the public homepage', () => {
    expect(activated).toContain('https://test.example/student');
  });

  it('reads as an extension when it is not a first activation', () => {
    const renewed = subscriptionActivatedEmail({
      name: 'Ada', planName: 'Pro', durationMonths: 3,
      periodStart: '2026-08-10T00:00:00Z', periodEnd: '2026-11-10T00:00:00Z',
      isActivation: false, dashboardUrl: 'https://test.example', branding,
    });
    expect(renewed).toContain('has been extended');
    expect(renewed).not.toContain('is now active');
  });

  // due_date is a `date` column, so it arrives as "2026-09-01". A bare new Date() parses
  // that as UTC midnight, which formats as the previous day anywhere west of UTC; the
  // template anchors it at noon instead, matching the two existing guards in this file.
  // Note this assertion only discriminates when the test process is NOT on UTC -- on a UTC
  // runner both forms render the same day, so it documents the rule more than it proves it.
  it('does not shift a date-only payment deadline backwards', () => {
    const welcome = individualLearnerWelcomeEmail({
      name: 'Ada', planName: 'Pro', durationMonths: 3, setupUrl: 'https://test.example/setup',
      isRenewal: false,
      access: { kind: 'awaiting_payment', amount: 300, currency: 'GHS', dueDate: '2026-09-01' },
      branding,
    });
    expect(welcome).toContain('1 September 2026');
    expect(welcome).not.toContain('31 August 2026');
  });

  it('shows what is owed only while payment is outstanding', () => {
    const paid = individualLearnerWelcomeEmail({
      name: 'Ada', planName: 'Pro', durationMonths: 3, setupUrl: 'https://test.example/setup',
      isRenewal: false,
      access: { kind: 'active', periodStart: '2026-08-10T00:00:00Z', periodEnd: '2026-11-10T00:00:00Z' },
      branding,
    });
    expect(paid).not.toContain('Amount due');
    expect(paid).not.toContain('GHS');

    const owing = individualLearnerWelcomeEmail({
      name: 'Ada', planName: 'Pro', durationMonths: 3, setupUrl: 'https://test.example/setup',
      isRenewal: false,
      access: { kind: 'awaiting_payment', amount: 300, currency: 'GHS', dueDate: '2026-09-01' },
      branding,
    });
    expect(owing).toContain('Amount due');
    expect(owing).toContain('GHS 300.00');
  });

  it('does not greet a renewing learner as a brand-new account', () => {
    const renewal = individualLearnerWelcomeEmail({
      name: 'Ada', planName: 'Pro', durationMonths: 3, setupUrl: 'https://test.example/setup',
      isRenewal: true,
      access: { kind: 'active', periodStart: '2026-08-10T00:00:00Z', periodEnd: '2026-11-10T00:00:00Z' },
      branding,
    });
    expect(renewal).toContain('has been extended');
    expect(renewal).not.toContain('Your account is ready');
  });

  it('escapes learner and plan names', () => {
    const html = subscriptionActivatedEmail({
      name: '<script>alert(1)</script>', planName: 'Pro & "Plus"', durationMonths: 1,
      periodStart: '2026-08-10T00:00:00Z', periodEnd: '2026-09-10T00:00:00Z',
      isActivation: true, dashboardUrl: 'https://test.example', branding,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('tells an expiring learner when access ends', () => {
    const expiring = subscriptionExpiringEmail({
      name: 'Ada', planName: 'Pro', periodEnd: '2026-11-10T00:00:00Z', daysLeft: 7,
      dashboardUrl: 'https://test.example', branding,
    });
    expect(expiring).toContain('7 days');
    expect(expiring).toContain('10 November 2026');
    expect(expiring).toContain('https://test.example/student');
  });
});
