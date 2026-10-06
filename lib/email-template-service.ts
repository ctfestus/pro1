import { unstable_cache } from 'next/cache';
import { adminClient } from '@/lib/admin-client';
import { sanitizePlainText, sanitizeRichText } from '@/lib/sanitize';
import { getEmailTemplateDefinition, type EmailTemplateKey } from '@/lib/email-template-registry';

export type EmailTemplateOverride = {
  template_key: string;
  subject_template: string;
  body_template: string;
  composition_mode: 'legacy_replace' | 'additive';
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
    .select('template_key, subject_template, body_template, composition_mode, updated_at, updated_by');
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

export function formatEmailDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return sanitizePlainText(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export function templateTags(value: string) {
  return [...value.matchAll(/{{\s*([a-z0-9_]+)\s*}}/gi)].map(match => match[1].toLowerCase());
}

export function hasVisibleEmailMessage(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/[\s\u00a0\u200b\u200c\u200d\ufeff]/g, '')
    .length > 0;
}

export function validateEmailTemplateDraft(key: string, subject: unknown, body: unknown, options?: { allowEmpty?: boolean }) {
  const definition = getEmailTemplateDefinition(key);
  if (!definition) return { error: 'Unknown email template.' } as const;
  if (typeof subject !== 'string' || typeof body !== 'string') return { error: 'Subject and body are required.' } as const;
  const safeSubject = sanitizePlainText(subject).replace(/[\r\n]+/g, ' ').trim();
  const sanitizedBody = sanitizeRichText(body).trim();
  const safeBody = hasVisibleEmailMessage(sanitizedBody) ? sanitizedBody : '';
  if (!options?.allowEmpty && !safeSubject && !safeBody) return { error: 'Add a custom subject or message before saving.' } as const;
  if (safeSubject.length > 200) return { error: 'Subject must be 200 characters or fewer.' } as const;
  if (safeBody.length > 20_000) return { error: 'Message must be 20,000 characters or fewer.' } as const;
  if (/<a\b/i.test(safeBody)) {
    return { error: 'Custom links are not allowed. Existing secure buttons remain in the system email.' } as const;
  }

  const allowed = new Set(definition.tags);
  const used = new Set([...templateTags(safeSubject), ...templateTags(safeBody)]);
  const unknown = [...used].filter(tag => !allowed.has(tag));
  if (unknown.length) return { error: `Unknown merge tag: {{${unknown[0]}}}.` } as const;
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

function emailShell(body: string, branding: EmailBrandingInput) {
  const appName = branding.appName || 'the platform';
  const appUrl = safeHttpUrl(branding.appUrl) || '#';
  const logoUrl = safeHttpUrl(branding.logoUrl);
  const bannerUrl = safeHttpUrl(branding.emailBannerUrl);
  const header = bannerUrl
    ? `<tr><td><img src="${escapeHtml(bannerUrl)}" alt="${escapeHtml(appName)}" width="600" style="width:100%;height:auto;display:block;"></td></tr>`
    : logoUrl
      ? `<tr><td style="padding:20px 20px 0;"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(appName)}" style="height:48px;width:auto;display:block;object-fit:contain;"></td></tr>`
      : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" style="max-width:600px;width:100%;margin:0 auto;" cellpadding="0" cellspacing="0">${header}<tr><td style="padding:20px;">${body}${branding.teamName ? `<p style="color:#374151;font-size:14px;">${escapeHtml(branding.teamName)}</p>` : ''}<p style="font-size:12px;color:#6b7280;margin-top:24px;">You received this because this email address is associated with ${escapeHtml(appName)}. <a href="${escapeHtml(appUrl)}" style="color:#2563eb;">Visit ${escapeHtml(appName)}</a></p></td></tr></table></td></tr></table></body></html>`;
}

export const SYSTEM_EMAIL_CONTENT_MARKER = '<!-- PLATFORM_SYSTEM_EMAIL_CONTENT -->';

function customMessageHtml(body: string) {
  if (!hasVisibleEmailMessage(body)) return '';
  return `<div data-custom-email-message="true" style="margin:0 0 20px;padding:16px;background:#f3f4f6;border-left:4px solid #2563eb;"><p style="margin:0 0 10px;font-size:12px;font-weight:bold;color:#4b5563;text-transform:uppercase;letter-spacing:.04em;">Message from your learning team</p>${body}</div>`;
}

export function disableEmailPreviewLinks(html: string) {
  return html
    .replace(/<a\b([^>]*)>/gi, (_match, attributes: string) => `<span${attributes.replace(/\s+href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '')}>`)
    .replace(/<\/a>/gi, '</span>');
}

export function preserveSystemEmailContent(fallbackHtml: string, customBody: string, branding: EmailBrandingInput) {
  const customBlock = customMessageHtml(customBody);
  if (!customBlock) return fallbackHtml;
  if (fallbackHtml.includes(SYSTEM_EMAIL_CONTENT_MARKER)) {
    return fallbackHtml.replace(SYSTEM_EMAIL_CONTENT_MARKER, `${SYSTEM_EMAIL_CONTENT_MARKER}${customBlock}`);
  }
  const bodyTag = fallbackHtml.match(/<body\b[^>]*>/i)?.[0];
  if (bodyTag) return fallbackHtml.replace(bodyTag, `${bodyTag}${customBlock}`);
  return emailShell(`${customBlock}${fallbackHtml}`, branding);
}

export function customBodyForCompositionMode(mode: EmailTemplateOverride['composition_mode'], body: string) {
  return mode === 'additive' ? body : '';
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
  const subject = checked.subject
    ? mergeSubject(checked.subject, input.variables).replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
    : input.fallbackSubject;
  const body = customBodyForCompositionMode(override.composition_mode, merge(checked.body, input.variables));
  return {
    subject: subject || input.fallbackSubject,
    html: preserveSystemEmailContent(input.fallbackHtml, body, input.branding),
    customized: true,
  };
}

export function renderEmailTemplatePreview(input: {
  key: string;
  subject: string;
  body: string;
  fallbackSubject: string;
  fallbackHtml: string;
  variables: EmailTemplateVariables;
  branding: EmailBrandingInput;
}) {
  const checked = validateEmailTemplateDraft(input.key, input.subject, input.body, { allowEmpty: true });
  if ('error' in checked) return checked;
  const customBody = merge(checked.body, input.variables);
  const html = preserveSystemEmailContent(input.fallbackHtml, customBody, input.branding);
  return {
    subject: checked.subject
      ? mergeSubject(checked.subject, input.variables).replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
      : input.fallbackSubject,
    html: disableEmailPreviewLinks(html),
  };
}
