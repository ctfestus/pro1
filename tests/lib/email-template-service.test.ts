import { describe, expect, it } from 'vitest';
import { customBodyForCompositionMode, formatEmailDate, preserveSystemEmailContent, renderEmailTemplatePreview, validateEmailTemplateDraft } from '@/lib/email-template-service';
import { EMAIL_TEMPLATE_DEFINITIONS } from '@/lib/email-template-registry';
import { buildEmailTemplateSample } from '@/lib/email-template-preview';
import { weeklyDigestEmail } from '@/lib/email-templates';

describe('email template validation', () => {
  const branding = { appName: 'Academy', appUrl: 'https://academy.test', teamName: 'Academy Learning Team' };

  it('builds a complete standard sample for every registered template', () => {
    for (const definition of EMAIL_TEMPLATE_DEFINITIONS) {
      const sample = buildEmailTemplateSample(definition.key, branding);
      expect(sample.subject, definition.key).toBeTruthy();
      expect(sample.html, definition.key).toBeTruthy();

      const rendered = renderEmailTemplatePreview({
        key: definition.key,
        subject: '',
        body: '',
        fallbackSubject: sample.subject,
        fallbackHtml: sample.html,
        variables: sample.variables,
        branding,
      });
      expect(rendered, definition.key).toHaveProperty('html');
      if (!('html' in rendered)) continue;
      expect(rendered.subject, definition.key).toBe(sample.subject);
      expect(rendered.html, definition.key).not.toMatch(/<a\b/i);
      expect(rendered.html, definition.key).not.toMatch(/\shref\s*=/i);
    }
  });

  it('rejects unknown templates and merge tags', () => {
    expect(validateEmailTemplateDraft('missing', 'Hello', '<p>Hello</p>')).toEqual({ error: 'Unknown email template.' });
    expect(validateEmailTemplateDraft('weekly_digest', 'Hello {{password}}', '<p>Hi {{student_name}}</p>')).toEqual({ error: 'Unknown merge tag: {{password}}.' });
  });

  it('allows either field to be optional while rejecting an empty customization', () => {
    expect(validateEmailTemplateDraft('payment_request', 'Payment request', '')).not.toHaveProperty('error');
    expect(validateEmailTemplateDraft('payment_request', '', '<p>Please pay soon.</p>')).not.toHaveProperty('error');
    expect(validateEmailTemplateDraft('payment_request', '', '')).toEqual({ error: 'Add a custom subject or message before saving.' });
  });

  it('treats editor-only markup and non-breaking spaces as an empty message', () => {
    const subjectOnly = validateEmailTemplateDraft('weekly_digest', 'Weekly update', '<p>&nbsp;<br></p>');
    expect(subjectOnly).not.toHaveProperty('error');
    if ('error' in subjectOnly) return;
    expect(subjectOnly.body).toBe('');

    expect(validateEmailTemplateDraft('weekly_digest', '', '<p>&#160;<br></p>')).toEqual({
      error: 'Add a custom subject or message before saving.',
    });
  });

  it('blocks author-controlled links because the platform supplies the secure action button', () => {
    expect(validateEmailTemplateDraft(
      'account_setup',
      'Your account',
      '<p>Hi {{student_name}}</p><p><a href="https://lookalike.example">Set your password</a></p>',
    )).toEqual({ error: 'Custom links are not allowed. Existing secure buttons remain in the system email.' });
  });

  it('removes subject header injection and unsafe HTML', () => {
    const checked = validateEmailTemplateDraft(
      'account_setup',
      'Ready\r\nBcc: attacker@example.com {{app_name}}',
      '<p>Hi {{student_name}}</p><script>alert(1)</script><img src="javascript:alert(1)">',
    );
    expect('error' in checked).toBe(false);
    if ('error' in checked) return;
    expect(checked.subject).toBe('Ready Bcc: attacker@example.com {{app_name}}');
    expect(checked.body).not.toContain('<script');
    expect(checked.body).not.toContain('<img');
  });

  it('escapes merge values and produces a sandbox-safe preview document', () => {
    const fallback = buildEmailTemplateSample('account_setup', branding);
    const rendered = renderEmailTemplatePreview({
      key: 'account_setup',
      subject: 'Hello {{student_name}}',
      body: '<p>Hi {{student_name}}</p>',
      fallbackSubject: fallback.subject,
      fallbackHtml: fallback.html,
      variables: { student_name: '<img src=x onerror=alert(1)>' },
      branding,
    });
    expect('html' in rendered).toBe(true);
    if (!('html' in rendered)) return;
    expect(rendered.subject).toBe('Hello');
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img');
    expect(rendered.html).not.toContain('href=');
  });

  it('renders the full standard email with sample data and disables its links', () => {
    const fallback = buildEmailTemplateSample('payment_receipt', branding);
    const rendered = renderEmailTemplatePreview({
      key: 'payment_receipt', subject: 'Receipt', body: '<p>Payment received.</p>',
      fallbackSubject: fallback.subject,
      fallbackHtml: fallback.html,
      variables: fallback.variables,
      branding,
    });
    expect('html' in rendered).toBe(true);
    if (!('html' in rendered)) return;
    expect(rendered.html).toContain('Message from your learning team');
    expect(rendered.html).toContain('Payment received.');
    expect(rendered.html).toContain('PAY-1024');
    expect(rendered.html).toContain('Mobile Money');
    expect(rendered.html).not.toMatch(/<a\b/i);
    expect(rendered.html).not.toMatch(/\shref\s*=/i);
    expect(formatEmailDate('2026-11-04T00:00:00+00:00')).toBe('4 November 2026');
  });

  it('adds a custom message without removing rich system content or real links', () => {
    const fallback = weeklyDigestEmail({
      name: 'Ama',
      completed: [{ title: 'Excel Fundamentals', contentType: 'course', score: 91 }],
      inProgress: [{ title: 'Advanced Excel', contentType: 'course' }],
      notStarted: [{ title: 'Business Intelligence', contentType: 'virtual_experience' }],
      missedDeadlines: [{ title: 'Churn Analysis', contentType: 'course', daysOverdue: 2 }],
      dashboardUrl: 'https://academy.test/student',
      branding: { appName: 'Academy', appUrl: 'https://academy.test' },
    });

    const rendered = preserveSystemEmailContent(
      fallback,
      '<p>Focus on completing one item this week.</p>',
      { appName: 'Academy', appUrl: 'https://academy.test' },
    );

    expect(rendered).toContain('Message from your learning team');
    expect(rendered).toContain('Focus on completing one item this week.');
    expect(rendered).toContain('Excel Fundamentals');
    expect(rendered).toContain('Score: 91%');
    expect(rendered).toContain('Advanced Excel');
    expect(rendered).toContain('Business Intelligence');
    expect(rendered).toContain('Churn Analysis');
    expect(rendered).toContain('2 days overdue');
    expect(rendered).toContain('href="https://academy.test/student"');
  });

  it('preserves full-document and raw-fragment fallbacks', () => {
    const documentFallback = '<!DOCTYPE html><html><body><table><tr><td>System details</td></tr></table><a href="https://academy.test/secure">Continue</a></body></html>';
    const documentResult = preserveSystemEmailContent(
      documentFallback,
      '<p>Custom note</p>',
      { appName: 'Academy', appUrl: 'https://academy.test' },
    );
    expect(documentResult).toContain('<body><div data-custom-email-message="true"');
    expect(documentResult).toContain('System details');
    expect(documentResult).toContain('href="https://academy.test/secure"');

    const fragmentFallback = '<p>Checkout details</p><a href="https://academy.test/student#payments">Finish payment</a>';
    const fragmentResult = preserveSystemEmailContent(
      fragmentFallback,
      '<p>Custom note</p>',
      { appName: 'Academy', appUrl: 'https://academy.test' },
    );
    expect(fragmentResult).toContain('Custom note');
    expect(fragmentResult).toContain('Checkout details');
    expect(fragmentResult).toContain('href="https://academy.test/student#payments"');
  });

  it('does not reinterpret legacy replacement bodies as additive messages', () => {
    const fallback = '<html><body><p>Current system email</p></body></html>';
    const legacyBody = customBodyForCompositionMode('legacy_replace', '<p>Old replacement email</p>');
    expect(preserveSystemEmailContent(fallback, legacyBody, {})).toBe(fallback);
    expect(customBodyForCompositionMode('additive', '<p>New message</p>')).toBe('<p>New message</p>');
  });

  it('does not insert an empty custom message box', () => {
    const fallback = '<html><body><p>Current system email</p></body></html>';
    expect(preserveSystemEmailContent(fallback, '<p>&nbsp;<br></p>', branding)).toBe(fallback);
  });
});
