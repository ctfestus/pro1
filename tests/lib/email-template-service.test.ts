import { describe, expect, it } from 'vitest';
import { formatEmailDate, renderEmailTemplatePreview, validateEmailTemplateDraft } from '@/lib/email-template-service';
import { EMAIL_TEMPLATE_DEFINITIONS } from '@/lib/email-template-registry';

describe('email template validation', () => {
  it('keeps every built-in custom-template starter valid', () => {
    for (const definition of EMAIL_TEMPLATE_DEFINITIONS) {
      expect(validateEmailTemplateDraft(definition.key, definition.defaultSubject, definition.defaultBody)).not.toHaveProperty('error');
    }
  });

  it('rejects unknown templates and merge tags', () => {
    expect(validateEmailTemplateDraft('missing', 'Hello', '<p>Hello</p>')).toEqual({ error: 'Unknown email template.' });
    expect(validateEmailTemplateDraft('weekly_digest', 'Hello {{password}}', '<p>Hi {{student_name}}</p>')).toEqual({ error: 'Unknown merge tag: {{password}}.' });
  });

  it('requires protected learner facts', () => {
    expect(validateEmailTemplateDraft('payment_request', 'Payment request', '<p>Please pay soon.</p>')).toEqual({ error: 'Required merge tag is missing: {{plan_name}}.' });
    expect(validateEmailTemplateDraft(
      'payment_request',
      'Payment request',
      '<table><tr><td colspan="{{plan_name}}">Pay {{currency}} {{amount}}</td></tr></table>',
    )).toEqual({ error: 'Required merge tag is missing: {{plan_name}}.' });
  });

  it('blocks author-controlled links because the platform supplies the secure action button', () => {
    expect(validateEmailTemplateDraft(
      'account_setup',
      'Your account',
      '<p>Hi {{student_name}}</p><p><a href="https://lookalike.example">Set your password</a></p>',
    )).toEqual({ error: 'Custom links are not allowed. The secure action button is added automatically.' });
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
    const rendered = renderEmailTemplatePreview({
      key: 'account_setup',
      subject: 'Hello {{student_name}}',
      body: '<p>Hi {{student_name}}</p>',
      variables: { student_name: '<img src=x onerror=alert(1)>' },
      branding: { appName: 'Academy', appUrl: 'https://academy.test' },
    });
    expect('html' in rendered).toBe(true);
    if (!('html' in rendered)) return;
    expect(rendered.subject).toBe('Hello');
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img');
  });

  it('renders protected details safely and formats system dates for learners', () => {
    const rendered = renderEmailTemplatePreview({
      key: 'payment_receipt', subject: 'Receipt', body: '<p>Payment received.</p>',
      variables: {}, branding: { appName: 'Academy', appUrl: 'https://academy.test' },
      fixedDetails: [{ label: 'Reference', value: '<script>alert(1)</script>' }],
    });
    expect('html' in rendered).toBe(true);
    if (!('html' in rendered)) return;
    expect(rendered.html).toContain('Details');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).not.toContain('<script>alert');
    expect(formatEmailDate('2026-11-04T00:00:00+00:00')).toBe('4 November 2026');
  });
});
