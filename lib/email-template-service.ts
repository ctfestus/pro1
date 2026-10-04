import { unstable_cache } from 'next/cache';
import { adminClient } from '@/lib/admin-client';
import { sanitizePlainText, sanitizeRichText } from '@/lib/sanitize';
import { getEmailTemplateDefinition, type EmailTemplateKey } from '@/lib/email-template-registry';

export type EmailTemplateOverride = {
  template_key: string;
  subject_template: string;
  body_template: string;
  updated_at: string;
  updated_by: string | null;
};

export type EmailTemplateVariables = Record<string, string | number | null | undefined>;

export type EmailBrandingInput = {
  logoUrl?: string;
  emailBannerUrl?: string;
  teamName?: string;
  appName?: string;
  appUrl?: string;
};

const loadOverrides = unstable_cache(async (): Promise<EmailTemplateOverride[]> => {
  const { data, error } = await adminClient()
    .from('email_template_overrides')
    .select('template_key, subject_template, body_template, updated_at, updated_by');
  if (error) throw error;
  return (data ?? []) as EmailTemplateOverride[];
}, ['email-template-overrides'], { revalidate: 60, tags: ['email-template-overrides'] });

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHttpUrl(value: string | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

export function templateTags(value: string) {
  return [...value.matchAll(/{{\s*([a-z0-9_]+)\s*}}/gi)].map(match => match[1].toLowerCase());
}

export function validateEmailTemplateDraft(key: string, subject: unknown, body: unknown) {
  const definition = getEmailTemplateDefinition(key);
  if (!definition) return { error: 'Unknown email template.' } as const;
  if (typeof subject !== 'string' || typeof body !== 'string') return { error: 'Subject and body are required.' } as const;
  const safeSubject = sanitizePlainText(subject).replace(/[\r\n]+/g, ' ').trim();
  const safeBody = sanitizeRichText(body).trim();
  if (!safeSubject || safeSubject.length > 200) return { error: 'Subject must be between 1 and 200 characters.' } as const;
  if (!safeBody || safeBody.length > 20_000) return { error: 'Body must be between 1 and 20,000 characters.' } as const;
  if (/<a\b/i.test(safeBody)) {
    return { error: 'Custom links are not allowed. The secure action button is added automatically.' } as const;
  }

  const allowed = new Set(definition.tags);
  const used = new Set([...templateTags(safeSubject), ...templateTags(safeBody)]);
  const unknown = [...used].filter(tag => !allowed.has(tag));
  if (unknown.length) return { error: `Unknown merge tag: {{${unknown[0]}}}.` } as const;
  const visibleTags = new Set([...templateTags(safeSubject), ...templateTags(sanitizePlainText(safeBody))]);
  const missing = definition.requiredTags.filter(tag => !visibleTags.has(tag));
  if (missing.length) return { error: `Required merge tag is missing: {{${missing[0]}}}.` } as const;
  return { definition, subject: safeSubject, body: safeBody } as const;
}

function merge(value: string, variables: EmailTemplateVariables) {
  return value.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_match, tag: string) => escapeHtml(variables[tag.toLowerCase()]));
}

function mergeSubject(value: string, variables: EmailTemplateVariables) {
  return value.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_match, tag: string) =>
    sanitizePlainText(String(variables[tag.toLowerCase()] ?? '')).replace(/[\u0000-\u001f\u007f]+/g, ' '),
  );
}

function emailShell(body: string, branding: EmailBrandingInput, actionUrl?: string, ctaLabel?: string) {
  const appName = branding.appName || 'the platform';
  const appUrl = safeHttpUrl(branding.appUrl) || '#';
  const logoUrl = safeHttpUrl(branding.logoUrl);
  const bannerUrl = safeHttpUrl(branding.emailBannerUrl);
  const safeActionUrl = safeHttpUrl(actionUrl);
  const header = bannerUrl
    ? `<tr><td><img src="${escapeHtml(bannerUrl)}" alt="${escapeHtml(appName)}" width="600" style="width:100%;height:auto;display:block;"></td></tr>`
    : logoUrl
      ? `<tr><td style="padding:20px 20px 0;"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(appName)}" style="height:48px;width:auto;display:block;object-fit:contain;"></td></tr>`
      : '';
  const cta = safeActionUrl && ctaLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td><a href="${escapeHtml(safeActionUrl)}" style="background:#2563eb;color:#fff;padding:14px 26px;text-decoration:none;font-weight:bold;display:inline-block;">${escapeHtml(ctaLabel)}</a></td></tr></table>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" style="max-width:600px;width:100%;margin:0 auto;" cellpadding="0" cellspacing="0">${header}<tr><td style="padding:20px;">${body}${cta}${branding.teamName ? `<p style="color:#374151;font-size:14px;">${escapeHtml(branding.teamName)}</p>` : ''}<p style="font-size:12px;color:#6b7280;margin-top:24px;">You received this because this email address is associated with ${escapeHtml(appName)}. <a href="${escapeHtml(appUrl)}" style="color:#2563eb;">Visit ${escapeHtml(appName)}</a></p></td></tr></table></td></tr></table></body></html>`;
}

export async function getEmailTemplateOverrides() {
  try {
    return await loadOverrides();
  } catch (error) {
    console.error('[email-templates] override load failed', error);
    return [];
  }
}

export async function applyEmailTemplate(input: {
  key: EmailTemplateKey;
  fallbackSubject: string;
  fallbackHtml: string;
  variables: EmailTemplateVariables;
  branding: EmailBrandingInput;
  actionUrl?: string;
  ctaLabel?: string;
}) {
  const definition = getEmailTemplateDefinition(input.key);
  if (!definition) return { subject: input.fallbackSubject, html: input.fallbackHtml, customized: false };
  const override = (await getEmailTemplateOverrides()).find(row => row.template_key === input.key);
  if (!override) return { subject: input.fallbackSubject, html: input.fallbackHtml, customized: false };
  const checked = validateEmailTemplateDraft(input.key, override.subject_template, override.body_template);
  if ('error' in checked) {
    console.error(`[email-templates] invalid stored template ${input.key}: ${checked.error}`);
    return { subject: input.fallbackSubject, html: input.fallbackHtml, customized: false };
  }
  const subject = mergeSubject(checked.subject, input.variables).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const body = merge(checked.body, input.variables);
  return {
    subject: subject || input.fallbackSubject,
    html: emailShell(body, input.branding, input.actionUrl, input.ctaLabel || definition.ctaLabel),
    customized: true,
  };
}

export function renderEmailTemplatePreview(input: {
  key: string;
  subject: string;
  body: string;
  variables: EmailTemplateVariables;
  branding: EmailBrandingInput;
}) {
  const checked = validateEmailTemplateDraft(input.key, input.subject, input.body);
  if ('error' in checked) return checked;
  return {
    subject: mergeSubject(checked.subject, input.variables).replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
    html: emailShell(merge(checked.body, input.variables), input.branding, input.branding.appUrl, checked.definition.ctaLabel),
  };
}
